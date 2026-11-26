"""Explicit cloud providers with local fallback, stable revisions and durable outbox."""

import hashlib
import json
import time
from functools import lru_cache
from datetime import datetime, timezone
import numpy as np
import httpx
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.config import Config
from botocore.exceptions import ClientError
from .config import ROOT, settings
from .database import connect, get_file, public_file
from .storage import session
from . import cost_guard

_metadata_cache = None


def signed_get(path):
    cfg = configuration()
    url = cfg["api_endpoint"].rstrip("/") + path
    if not url.startswith("https://") or ".execute-api.ap-southeast-2.amazonaws.com/" not in url:
        raise ValueError("Only approved Sydney API endpoints are permitted")
    request = AWSRequest(method="GET", url=url)
    SigV4Auth(
        session().get_credentials().get_frozen_credentials(), "execute-api", "ap-southeast-2"
    ).add_auth(request)
    response = httpx.get(url, headers=dict(request.headers), timeout=8, trust_env=False)
    response.raise_for_status()
    return response.json()


def configuration():
    # Isolated tests never inherit real cloud activation.
    if settings.data_dir.resolve() != (ROOT / "data").resolve():
        return {}
    if not cost_guard.permitted():
        return {"disabled_reason": "free_plan_credit_guard"}
    try:
        return json.loads((ROOT / ".runtime/cloud-config.json").read_text())
    except (OSError, ValueError):
        return {}


@lru_cache
def client(service):
    return session().client(
        service, config=Config(connect_timeout=3, read_timeout=8, retries={"max_attempts": 1})
    )


def vector_key(row):
    digest = hashlib.sha256(row["text"].encode()).hexdigest()[:16]
    return f"{row['file_id']}:{row['id']}:{digest}"


def dense_scores(rows, matrix, vector, scope=None):
    started = time.perf_counter()
    cfg = configuration()
    allowed = set(scope or [])
    if cfg.get("vectors_enabled"):
        try:
            with connect() as db:
                pending_ids = {r["file_id"] for r in db.execute("SELECT file_id FROM cloud_outbox")}
            if pending_ids & {r["file_id"] for r in rows if not allowed or r["file_id"] in allowed}:
                raise ValueError("Cloud index synchronization is pending")
            filters = [{"scope": {"$eq": "corpus"}}, {"model": {"$eq": settings.embedding_model}}]
            if allowed:
                filters.append({"file_id": {"$in": sorted(allowed)}})
            request = dict(
                vectorBucketName=cfg["vector_bucket"],
                indexName=cfg["vector_index"],
                queryVector={"float32": vector.tolist()},
                topK=min(100, max(1, len(rows))),
                returnDistance=True,
                returnMetadata=True,
                queryMode="ENHANCED",
                filter={"$and": filters},
            )
            scores = np.full(len(rows), -1.0, dtype=np.float32)
            active = {
                vector_key(row): i
                for i, row in enumerate(rows)
                if not allowed or row["file_id"] in allowed
            }
            calls = 0
            for _ in range(5):
                result = client("s3vectors").query_vectors(**request)
                calls += 1
                if result.get("distanceMetric") != "cosine":
                    raise ValueError("Unexpected vector distance metric")
                for found in result.get("vectors", []):
                    index = active.get(found["key"])
                    if index is not None:
                        scores[index] = max(-1.0, min(1.0, 1.0 - float(found["distance"])))
                if not result.get("nextToken"):
                    break
                request["nextToken"] = result["nextToken"]
            return scores, {
                "provider": "s3vectors",
                "aws_calls": calls,
                "latency_ms": round((time.perf_counter() - started) * 1000, 2),
                "fallback": False,
            }
        except Exception as error:
            reason = (
                error.response["Error"]["Code"]
                if isinstance(error, ClientError)
                else type(error).__name__
            )
            return matrix @ vector, {
                "provider": "local_fallback",
                "aws_calls": 1,
                "fallback": True,
                "reason": reason,
                "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            }
    return matrix @ vector, {
        "provider": "local_fallback" if cfg.get("disabled_reason") else "local",
        "aws_calls": 0,
        "fallback": bool(cfg.get("disabled_reason")),
        "reason": cfg.get("disabled_reason"),
        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def enqueue(file_id, tombstone=False):
    global _metadata_cache
    _metadata_cache = None
    cfg = configuration()
    if cfg.get("disabled_reason"):
        try:
            cfg = json.loads((ROOT / ".runtime/cloud-config.json").read_text())
        except (OSError, ValueError):
            cfg = {}
    if not cfg.get("metadata_enabled"):
        return
    record = get_file(file_id)
    if not record:
        return
    stamp = datetime.now(timezone.utc).isoformat()
    payload = public_file(record)
    payload["deleted"] = tombstone
    with connect() as db:
        db.execute(
            "INSERT INTO cloud_outbox(file_id,revision,payload,attempts,updated_at) VALUES(?,?,?,0,?) ON CONFLICT(file_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,attempts=0,updated_at=excluded.updated_at",
            (file_id, stamp, json.dumps(payload), stamp),
        )


def flush(limit=10):
    cfg = configuration()
    if not cfg.get("metadata_enabled"):
        return {"synced": 0, "enabled": False}
    with connect() as db:
        pending = [
            dict(r)
            for r in db.execute(
                "SELECT * FROM cloud_outbox WHERE attempts<3 ORDER BY updated_at LIMIT ?",
                (min(limit, 100),),
            )
        ]
    synced = 0
    for item in pending:
        try:
            if json.loads(item["payload"]).get("deleted"):
                remove_vectors(item["file_id"])
            client("dynamodb").put_item(
                TableName=cfg["table"],
                Item={
                    "pk": {"S": "WORKSPACE#default"},
                    "sk": {"S": "FILE#" + item["file_id"]},
                    "revision": {"S": item["revision"]},
                    "payload": {"S": item["payload"]},
                },
                ConditionExpression="attribute_not_exists(revision) OR revision<=:revision",
                ExpressionAttributeValues={":revision": {"S": item["revision"]}},
            )
            with connect() as db:
                db.execute(
                    "DELETE FROM cloud_outbox WHERE file_id=? AND revision=?",
                    (item["file_id"], item["revision"]),
                )
            synced += 1
        except ClientError as error:
            code = error.response["Error"]["Code"]
            with connect() as db:
                db.execute(
                    "UPDATE cloud_outbox SET attempts=attempts+1,last_error=? WHERE file_id=? AND revision=?",
                    (code, item["file_id"], item["revision"]),
                )
    return {"synced": synced, "enabled": True}


def sync_file(file_id):
    cfg = configuration()
    if not cfg.get("metadata_enabled"):
        return
    enqueue(file_id)
    if cfg.get("vectors_enabled"):
        with connect() as db:
            rows = [dict(r) for r in db.execute("SELECT * FROM chunks WHERE file_id=?", (file_id,))]
        vectors = [
            {
                "key": vector_key(row),
                "data": {"float32": np.frombuffer(row["vector"], dtype=np.float32).tolist()},
                "metadata": {
                    "scope": "corpus",
                    "file_id": file_id,
                    "chunk_id": row["id"],
                    "model": row["model"],
                    "revision": vector_key(row).split(":")[-1],
                },
            }
            for row in rows
        ]
        for start in range(0, len(vectors), 100):
            client("s3vectors").put_vectors(
                vectorBucketName=cfg["vector_bucket"],
                indexName=cfg["vector_index"],
                vectors=vectors[start : start + 100],
            )
        remove_vectors(file_id, keep_keys={v["key"] for v in vectors})
    flush()


def remove_vectors(file_id, keep_keys=None):
    """Only this file's owned keys; called for explicit deletion/reindex, never canaries."""
    cfg = configuration()
    if not cfg.get("vectors_enabled"):
        return
    keep = set(keep_keys or [])
    request = {
        "vectorBucketName": cfg["vector_bucket"],
        "indexName": cfg["vector_index"],
        "maxResults": 100,
    }
    stale = []
    for _ in range(10):
        result = client("s3vectors").list_vectors(**request)
        stale.extend(
            v["key"]
            for v in result.get("vectors", [])
            if v["key"].startswith(file_id + ":") and v["key"] not in keep
        )
        if not result.get("nextToken"):
            break
        request["nextToken"] = result["nextToken"]
    else:
        raise ValueError("Vector cleanup safety limit reached")
    for start in range(0, len(stale), 100):
        client("s3vectors").delete_vectors(
            vectorBucketName=cfg["vector_bucket"],
            indexName=cfg["vector_index"],
            keys=stale[start : start + 100],
        )


def metadata_rows():
    global _metadata_cache
    cfg = configuration()
    if not cfg.get("metadata_enabled"):
        return None, "local"
    if _metadata_cache and _metadata_cache[0] > time.monotonic():
        return _metadata_cache[1], _metadata_cache[2] + "_cached"
    try:
        request = {
            "TableName": cfg["table"],
            "KeyConditionExpression": "pk=:pk AND begins_with(sk,:prefix)",
            "ExpressionAttributeValues": {
                ":pk": {"S": "WORKSPACE#default"},
                ":prefix": {"S": "FILE#"},
            },
            "ConsistentRead": True,
            "Limit": 100,
        }
        records = None
        source = "dynamodb"
        if cfg.get("api_enabled"):
            try:
                result = signed_get("/files")
                if not result.get("truncated"):
                    records = result["items"]
                    source = "dynamodb_via_iam_api"
            except Exception:
                source = "dynamodb_direct_api_fallback"
        if records is None:
            records = []
            for _ in range(10):
                result = client("dynamodb").query(**request)
                records.extend(json.loads(r["payload"]["S"]) for r in result["Items"])
                if not result.get("LastEvaluatedKey"):
                    break
                request["ExclusiveStartKey"] = result["LastEvaluatedKey"]
            else:
                raise ValueError("Cloud metadata safety limit reached")
        with connect() as db:
            pending = {
                r["file_id"]: json.loads(r["payload"])
                for r in db.execute("SELECT file_id,payload FROM cloud_outbox")
            }
        merged = {r["id"]: r for r in records}
        merged.update(pending)
        output = [r for r in merged.values() if not r.get("deleted")]
        source = source + "_pending_sync" if pending else source
        _metadata_cache = (time.monotonic() + 2, output, source)
        return output, source
    except Exception:
        return None, "local_cached_fallback"


def metadata_detail(file_id):
    cfg = configuration()
    if not cfg.get("metadata_enabled"):
        return None
    with connect() as db:
        pending = db.execute(
            "SELECT payload FROM cloud_outbox WHERE file_id=?", (file_id,)
        ).fetchone()
    if pending:
        return {**json.loads(pending["payload"]), "metadata_source": "local_pending_cloud_sync"}
    try:
        result = client("dynamodb").get_item(
            TableName=cfg["table"],
            Key={"pk": {"S": "WORKSPACE#default"}, "sk": {"S": "FILE#" + file_id}},
            ConsistentRead=True,
        )
        record = json.loads(result["Item"]["payload"]["S"]) if "Item" in result else None
        return (
            {**record, "metadata_source": "dynamodb"}
            if record and not record.get("deleted")
            else None
        )
    except Exception:
        return None


def jobs():
    cfg = configuration()
    if not cfg.get("metadata_enabled"):
        return []
    request = {
        "TableName": cfg["table"],
        "KeyConditionExpression": "pk=:pk AND begins_with(sk,:prefix)",
        "ExpressionAttributeValues": {":pk": {"S": "WORKSPACE#default"}, ":prefix": {"S": "JOB#"}},
        "Limit": 20,
        "ConsistentRead": True,
    }
    records = []
    for _ in range(5):
        result = client("dynamodb").query(**request)
        records.extend(json.loads(r["payload"]["S"]) for r in result["Items"])
        if not result.get("LastEvaluatedKey"):
            break
        request["ExclusiveStartKey"] = result["LastEvaluatedKey"]
    return sorted(records, key=lambda r: r.get("created_at", ""), reverse=True)


def complete_jobs(limit=3):
    cfg = configuration()
    completed = []
    for job in [r for r in jobs() if r.get("state") == "awaiting_local_embedding"][:limit]:
        record = get_file(job["file_id"])
        if not record or record["status"] != "indexed":
            continue
        if job.get("sha256") and job["sha256"] != record["sha256"]:
            continue  # Never index a changed/deleted original against stale cloud evidence.
        sync_file(record["id"])
        stamp = datetime.now(timezone.utc).isoformat()
        payload = {
            **job,
            "state": "searchable",
            "updated_at": stamp,
            "history": [
                *job.get("history", []),
                {"stage": "local_embedding_and_cloud_vector_sync", "at": stamp},
            ][-8:],
        }
        client("dynamodb").update_item(
            TableName=cfg["table"],
            Key={"pk": {"S": "WORKSPACE#default"}, "sk": {"S": job["job_key"]}},
            UpdateExpression="SET #state=:done,payload=:payload",
            ConditionExpression="#state=:waiting",
            ExpressionAttributeNames={"#state": "state"},
            ExpressionAttributeValues={
                ":done": {"S": "searchable"},
                ":waiting": {"S": "awaiting_local_embedding"},
                ":payload": {"S": json.dumps(payload)},
            },
        )
        completed.append(job["file_id"])
    return {"completed": len(completed), "file_ids": completed}
