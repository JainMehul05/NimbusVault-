"""Private adapter: Express owns identity/permissions; this service owns local evidence.

Never run the donor main.py in the integrated application.
"""

import base64
import hashlib
import hmac
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from .config import settings
from .database import initialize, connect
from .embeddings import engine
from .extractor import extract
from . import rag, storage, cost_guard, cloud
from .services import now


@asynccontextmanager
async def lifespan(app):
    if len(os.environ.get("INTERNAL_SERVICE_TOKEN", "")) < 32:
        raise RuntimeError("A private service token is required")
    initialize()
    with connect() as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS conversation_owners(id TEXT PRIMARY KEY, actor TEXT NOT NULL)"
        )
    yield


app = FastAPI(
    title="NimbusVault private intelligence", lifespan=lifespan, docs_url=None, redoc_url=None
)


@app.middleware("http")
async def authenticate(request: Request, call_next):
    expected = os.environ.get("INTERNAL_SERVICE_TOKEN", "")
    if not expected or not hmac.compare_digest(
        request.headers.get("x-service-token", ""), expected
    ):
        return JSONResponse({"detail": "Private service authentication required"}, status_code=401)
    # Scope and actor are accepted only from the authenticated application server.
    actor = request.headers.get("x-actor-id", "")
    if request.url.path.startswith("/api/ai/"):
        try:
            UUID(actor)
            scope = json.loads(request.headers.get("x-file-scope", "[]"))
            if not isinstance(scope, list) or len(scope) > 250:
                raise ValueError()
            for key in scope:
                UUID(key)
        except (ValueError, TypeError):
            return JSONResponse({"detail": "Invalid trusted scope"}, status_code=400)
        request.state.actor = actor
        request.state.scope = scope
    return await call_next(request)


@app.get("/health")
def health():
    return {"status": "ok", "retrieval": "local", "cloud_default": False}


@app.post("/warmup")
async def warmup():
    await run_in_threadpool(engine.encode, ["NimbusVault local model readiness"])
    status = await rag.llm.status()
    if status["available"] and not rag.generation_lock.locked():
        import httpx

        async with rag.generation_lock:
            async with httpx.AsyncClient(trust_env=False, timeout=180) as client:
                response = await client.post(
                    settings.llm_url + "/api/generate",
                    json={
                        "model": settings.llm_model,
                        "prompt": "Reply READY",
                        "stream": False,
                        "keep_alive": "15m",
                        "options": {"num_predict": 1, "num_ctx": 6144},
                    },
                )
                response.raise_for_status()
                status["warmed"] = True
    return status


class Index(BaseModel):
    file_id: str
    filename: str = Field(max_length=255)
    object_key: str
    sha256: str
    content: str = Field(max_length=36_000_000)
    mime: str


@app.post("/index")
def index(payload: Index):
    UUID(payload.file_id)
    data = base64.b64decode(payload.content, validate=True)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "Document too large")
    if hashlib.sha256(data).hexdigest() != payload.sha256:
        raise HTTPException(409, "Original checksum mismatch")
    sections = extract(payload.filename, data)
    if sections is None:
        raise HTTPException(415, "Unsupported document")
    chunks = list(dict.fromkeys(engine.chunks(sections)))
    vectors = engine.encode([text for _, text in chunks]) if chunks else []
    timestamp = now()
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        previous = db.execute(
            "SELECT sha256,object_key FROM files WHERE id=?", (payload.file_id,)
        ).fetchone()
        if previous and (
            previous["sha256"] != payload.sha256 or previous["object_key"] != payload.object_key
        ):
            raise HTTPException(
                409, "An immutable original cannot be replaced under an existing file ID"
            )
        retained = {
            (r["section"], r["text"]): r["id"]
            for r in db.execute(
                "SELECT id,section,text FROM chunks WHERE file_id=? AND model=? AND dimension=384",
                (payload.file_id, settings.embedding_model),
            )
        }
        db.execute(
            """INSERT INTO files(id,original_name,name,object_key,size,mime,extension,sha256,created_at,updated_at,status,chunk_count,extracted_text,indexed_at)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,chunk_count=excluded.chunk_count,extracted_text=excluded.extracted_text,indexed_at=excluded.indexed_at,updated_at=excluded.updated_at""",
            (
                payload.file_id,
                payload.filename,
                payload.filename,
                payload.object_key,
                len(data),
                payload.mime,
                Path(payload.filename).suffix.lower(),
                payload.sha256,
                timestamp,
                timestamp,
                "indexed",
                len(chunks),
                "\n\n".join(t for _, t in sections),
                timestamp,
            ),
        )
        active = []
        for (section, text), vector in zip(chunks, vectors):
            if (section, text) in retained:
                key = retained[(section, text)]
                db.execute("UPDATE chunks SET vector=? WHERE id=?", (vector.tobytes(), key))
                active.append(key)
                continue
            db.execute(
                "INSERT INTO chunks(file_id,text,section,vector,model,dimension) VALUES(?,?,?,?,?,?)",
                (
                    payload.file_id,
                    text,
                    section,
                    vector.tobytes(),
                    settings.embedding_model,
                    len(vector),
                ),
            )
            active.append(db.execute("SELECT last_insert_rowid()").fetchone()[0])
        for row in db.execute(
            "SELECT id FROM chunks WHERE file_id=?", (payload.file_id,)
        ).fetchall():
            if row["id"] not in active:
                db.execute("DELETE FROM chunks WHERE id=?", (row["id"],))
    cloud.enqueue(payload.file_id)
    if os.environ.get("AWS_WRITES_ENABLED") == "true":
        try:
            cloud.flush(limit=1)
        except Exception:
            pass  # Durable outbox remains pending; local indexing has genuinely completed.
    return {
        "chunkCount": len(chunks),
        "text": "\n\n".join(t for _, t in sections),
        "model": settings.embedding_model,
    }


@app.post("/api/ai/ask")
async def ask(payload: rag.Ask, request: Request):
    scope = request.state.scope
    if not scope:
        return {
            "mode": "insufficient",
            "answer": "No authorized indexed documents are available.",
            "sources": [],
            "model": None,
        }
    if payload.file_ids and not set(payload.file_ids).issubset(scope):
        raise HTTPException(403, "Scope denied")
    payload.file_ids = payload.file_ids or scope
    if payload.conversation_id:
        with connect() as db:
            row = db.execute(
                "SELECT actor FROM conversation_owners WHERE id=?", (payload.conversation_id,)
            ).fetchone()
            previous = db.execute(
                "SELECT scope FROM conversations WHERE id=?", (payload.conversation_id,)
            ).fetchone()
        if (
            not row
            or row["actor"] != request.state.actor
            or not previous
            or not set(json.loads(previous["scope"])).issubset(scope)
        ):
            raise HTTPException(404, "Conversation unavailable after access change")
        payload.file_ids = json.loads(previous["scope"])
    result = await rag.ask(payload, request)
    with connect() as db:
        db.execute(
            "INSERT OR IGNORE INTO conversation_owners VALUES(?,?)",
            (result["conversation_id"], request.state.actor),
        )
    return result


@app.post("/api/ai/cancel")
async def cancel(payload: rag.Cancellation, request: Request):
    # Request IDs are random, actor-prefixed by Express via a per-actor registry.
    return await rag.cancel(payload)


@app.get("/api/ai/conversations")
def conversations(request: Request):
    with connect() as db:
        return [
            dict(r)
            for r in db.execute(
                "SELECT c.* FROM conversations c JOIN conversation_owners o ON o.id=c.id WHERE o.actor=? ORDER BY updated_at DESC LIMIT 50",
                (request.state.actor,),
            )
            if set(json.loads(r["scope"])).issubset(request.state.scope)
        ]


@app.get("/api/ai/conversations/{conversation_id}")
def history(conversation_id: str, request: Request):
    if conversation_id not in {r["id"] for r in conversations(request)}:
        raise HTTPException(404, "Conversation unavailable")
    return rag.conversation_detail(conversation_id)


@app.get("/api/ai/status")
async def ai_status():
    return await rag.ai_status()


@app.post("/api/ai/search")
async def search(request: Request):
    payload = await request.json()
    query = str(payload.get("query", "")).strip()
    if not 2 <= len(query) <= 500:
        raise HTTPException(400, "Invalid query")
    scope = request.state.scope
    if not scope:
        return {"sources": [], "retrieval_backend": {"provider": "local", "aws_calls": 0}}
    mode = payload.get("mode", "hybrid")
    if mode not in {"filename", "exact", "semantic", "hybrid", "lexical"}:
        raise HTTPException(400, "Invalid search mode")
    if mode in {"filename", "exact"}:
        names = payload.get("filenames", {}) if mode == "filename" else {}
        if not isinstance(names, dict):
            raise HTTPException(400, "Invalid filename metadata")
        with connect() as db:
            rows = [
                dict(r)
                for r in db.execute(
                    "SELECT c.*,f.name FROM chunks c JOIN files f ON f.id=c.file_id WHERE f.status='indexed' AND c.file_id IN ("
                    + ",".join("?" for _ in scope)
                    + ")",
                    scope,
                )
                if r["file_id"] in scope
                and query.casefold()
                in (
                    str(names.get(r["file_id"], r["name"])) if mode == "filename" else r["text"]
                ).casefold()
            ]
        sources = [
            {
                "file_id": r["file_id"],
                "chunk_id": r["id"],
                "filename": r["name"],
                "passage": r["text"],
                "section": r["section"],
                "similarity": 1.0,
                "score_kind": "literal",
            }
            for r in rows[:20]
        ]
    else:
        sources, _ = await run_in_threadpool(
            rag.retrieve, query, scope, min(20, int(payload.get("limit", 8))), mode
        )
    return {"sources": sources, "retrieval_backend": {"provider": "local", "aws_calls": 0}}


@app.get("/passage/{file_id}/{chunk_id}")
def passage(file_id: str, chunk_id: int):
    with connect() as db:
        row = db.execute(
            "SELECT text,section FROM chunks WHERE id=? AND file_id=?", (chunk_id, file_id)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Passage missing")
    return dict(row)


class ResolvePassage(BaseModel):
    file_id: str
    passage: str = Field(min_length=1, max_length=12000)


@app.post("/passage/resolve")
def resolve_passage(payload: ResolvePassage):
    UUID(payload.file_id)
    with connect() as db:
        row = db.execute(
            "SELECT c.id,c.text,c.section FROM chunks c JOIN files f ON f.id=c.file_id WHERE c.file_id=? AND c.text=? AND c.model=? AND f.status='indexed' ORDER BY c.id LIMIT 1",
            (payload.file_id, payload.passage, settings.embedding_model),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Historical evidence is no longer in the current index")
    return dict(row)


def cloud_allowed(write=False):
    if os.environ.get("AWS_OPERATIONS_ENABLED") != "true" or (
        write and os.environ.get("AWS_WRITES_ENABLED") != "true"
    ):
        raise HTTPException(503, "AWS operations are paused pending approved verification")
    if not cost_guard.permitted():
        raise HTTPException(503, "Active Free plan and credit reserve could not be verified")


class StorageOperation(BaseModel):
    operation: str
    key: str = ""
    content: str = ""
    mime: str = "application/octet-stream"
    source: str = ""
    expires: int = Field(default=120, ge=1, le=300)
    length: int = 0
    disposition: str = Field(default="attachment", max_length=800)


@app.post("/storage")
def storage_operation(p: StorageOperation):
    cloud_allowed(p.operation in {"put", "copy", "delete", "presign-put"})
    for key in [p.key, p.source]:
        if key and (
            not key.startswith(settings.s3_object_prefix)
            and not key.startswith("cloudvault/staging/nimbus/")
        ):
            raise HTTPException(403, "Unmanaged object key")
    client = storage.s3()
    args = {"Bucket": settings.s3_bucket, "Key": p.key}
    if p.operation == "put":
        data = base64.b64decode(p.content, validate=True)
        storage.upload(p.key, data, p.mime, p.key[len(settings.s3_object_prefix) :].split("/")[0])
        stored = client.head_object(Bucket=settings.s3_bucket, Key=p.key, ChecksumMode="ENABLED")
        if (
            stored["ContentLength"] != len(data)
            or stored.get("ChecksumSHA256")
            != base64.b64encode(hashlib.sha256(data).digest()).decode()
        ):
            raise HTTPException(409, "Stored original size mismatch")
        return {"size": len(data), "checksumSha256": hashlib.sha256(data).hexdigest()}
    if p.operation == "get":
        data = storage.read(p.key)
        return {
            "content": base64.b64encode(data).decode(),
            "size": len(data),
            "contentType": p.mime,
        }
    if p.operation == "head":
        r = client.head_object(**args)
        return {
            "size": r["ContentLength"],
            "contentType": r.get("ContentType"),
            "lastModified": str(r["LastModified"]),
            "etag": r.get("ETag"),
        }
    if p.operation == "presign-get":
        return {
            "url": client.generate_presigned_url(
                "get_object",
                Params={
                    **args,
                    "ResponseContentDisposition": p.disposition,
                    "ResponseContentType": p.mime,
                },
                ExpiresIn=p.expires,
            ),
            "expiresIn": p.expires,
        }
    # Keep destructive mutation and client-to-S3 staging disabled in the first bounded rehearsal.
    raise HTTPException(
        409,
        "Operation disabled: use the authenticated multipart upload; deletion requires separate approval",
    )


@app.get("/cloud/status")
def cloud_status():
    import httpx

    local = {
        "embedding_loaded": engine.model is not None,
        "model": settings.llm_model,
        "runtime_available": False,
    }
    try:
        tags = httpx.get(settings.llm_url + "/api/tags", timeout=2, trust_env=False)
        tags.raise_for_status()
        local["runtime_available"] = any(
            m.get("name") == settings.llm_model for m in tags.json().get("models", [])
        )
    except (httpx.HTTPError, ValueError):
        pass
    try:
        from .config import ROOT

        snapshot = json.loads((ROOT / ".runtime/aws-audit.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        snapshot = {"services": {}, "status": "not audited in the final application"}
    proof = {}
    try:
        journal = json.loads((ROOT / ".runtime/aws-rehearsal.json").read_text(encoding="utf-8"))
        proof = {
            "history": journal.get("checks", {})
            .get("native_event_workflow", {})
            .get("history", []),
            "restored_idle": journal.get("restored_idle"),
            "finished_at": journal.get("finished_at"),
        }
    except (OSError, ValueError):
        pass
    try:
        probe = json.loads((ROOT / ".runtime/app-cloud-probe.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        probe = {}
    return {
        "audit": snapshot,
        "native_rehearsal": proof,
        "live_probe": probe,
        "local_intelligence": local,
        "guard": cost_guard.status()
        if os.environ.get("AWS_OPERATIONS_ENABLED") == "true"
        else {"allowed": False, "status": "paused"},
        "local_search_default": True,
        "cloud_vectors": "not enabled for multi-user accounts",
        "workflow": "paused until bounded rehearsal",
        "observed_at": now(),
    }


class Completion(BaseModel):
    file_id: str


@app.post("/cloud/complete")
def complete(payload: Completion):
    cloud_allowed(write=True)
    UUID(payload.file_id)
    return cloud.complete_jobs(limit=1, file_ids=[payload.file_id])


@app.post("/cloud/probe")
def probe():
    """Manual admin-only caller; returns counts/status, never private global file lists."""
    cloud_allowed()
    import httpx
    from datetime import datetime, timezone, timedelta
    from .config import ROOT

    resources = json.loads((ROOT / ".runtime/cloud-resources.json").read_text(encoding="utf-8-sig"))
    outputs = resources["serverless_outputs"]
    cfg = cloud.configuration()
    signed = cloud.signed_get("/status")
    unsigned = httpx.get(cfg["api_endpoint"].rstrip("/") + "/status", trust_env=False, timeout=8)
    stack = cloud.client("cloudformation").list_stack_resources(StackName="cloudvault-v3-dev")
    names = [
        r["PhysicalResourceId"]
        for r in stack["StackResourceSummaries"]
        if r["ResourceType"] == "AWS::SSM::Parameter"
    ]
    parameters = cloud.client("ssm").get_parameters(Names=names, WithDecryption=False)
    end = datetime.now(timezone.utc)
    metrics = cloud.client("cloudwatch").get_metric_statistics(
        Namespace="AWS/Lambda",
        MetricName="Invocations",
        Dimensions=[{"Name": "FunctionName", "Value": outputs["FunctionName"]}],
        StartTime=end - timedelta(minutes=30),
        EndTime=end,
        Period=1800,
        Statistics=["Sum"],
    )
    streams = cloud.client("logs").describe_log_streams(
        logGroupName="/aws/lambda/" + outputs["FunctionName"],
        orderBy="LastEventTime",
        descending=True,
        limit=1,
    )["logStreams"]
    logs = (
        cloud.client("logs").get_log_events(
            logGroupName="/aws/lambda/" + outputs["FunctionName"],
            logStreamName=streams[0]["logStreamName"],
            limit=5,
        )["events"]
        if streams
        else []
    )
    result = {
        "observed_at": now(),
        "api_signed_ok": signed.get("status") == "ok",
        "api_unsigned_status": unsigned.status_code,
        "standard_parameters_read": len(parameters["Parameters"]),
        "lambda_invocation_datapoints": metrics["Datapoints"],
        "native_log_event_count": len(logs),
        "latest_log_timestamp": max((e["timestamp"] for e in logs), default=None),
    }
    (ROOT / ".runtime/app-cloud-probe.json").write_text(
        json.dumps(result, default=str, indent=2), encoding="utf-8"
    )
    return result


@app.post("/cloud/vector-demo")
def vector_demo():
    """One configured non-sensitive fixture, never a global corpus query."""
    cloud_allowed()
    from .config import ROOT

    try:
        fixture = json.loads((ROOT / ".runtime/vector-demo.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(503, "An approved vector demonstration fixture is not configured")
    vector = engine.encode(["Where do MiniLM embeddings and Qwen answer generation run?"])[0]
    cfg = cloud.configuration()
    result = cloud.client("s3vectors").query_vectors(
        vectorBucketName=cfg["vector_bucket"],
        indexName=cfg["vector_index"],
        queryVector={"float32": vector.tolist()},
        topK=1,
        returnDistance=True,
        returnMetadata=True,
        queryMode="ENHANCED",
        filter={
            "$and": [
                {"file_id": {"$eq": fixture["file_id"]}},
                {"model": {"$eq": settings.embedding_model}},
                {"scope": {"$eq": "corpus"}},
            ]
        },
    )
    found = result.get("vectors", [])
    if (
        not found
        or result.get("distanceMetric") != "cosine"
        or found[0].get("metadata", {}).get("file_id") != fixture["file_id"]
        or found[0]["key"] not in fixture.get("allowed_keys", [])
    ):
        raise HTTPException(
            503, "The approved fixture did not produce a verified cloud vector match"
        )
    proof = {
        "provider": "AWS S3 Vectors",
        "scope": "existing hash-approved non-sensitive canary only",
        "matched": True,
        "cosine_similarity": 1 - float(found[0]["distance"]),
        "aws_calls": 1,
        "observed_at": now(),
        "default_retrieval": "local",
        "does_not_grant_legacy_document_access": True,
    }
    (ROOT / ".runtime/vector-demo-result.json").write_text(
        json.dumps(proof, indent=2), encoding="utf-8"
    )
    return proof
