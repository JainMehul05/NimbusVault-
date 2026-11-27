import hashlib
import asyncio
from contextlib import suppress
import logging
import mimetypes
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import quote
from uuid import uuid4
from fastapi import FastAPI, BackgroundTasks, UploadFile, File, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.concurrency import run_in_threadpool
from botocore.exceptions import BotoCoreError, ClientError
from pydantic import BaseModel, Field, field_validator
from .config import settings, ROOT
from .database import initialize, connect, get_file, public_file
from .security import safe_filename
from .services import index_file, now, index_lock
from .embeddings import engine
from .search import search
from . import storage
from . import cloud
from .cost_guard import FreePlanRequiredError
from .rag import router as ai_router
from .analytics import router as analytics_router


@asynccontextmanager
async def lifespan(app):
    initialize()

    async def resume_cloud():
        try:
            await run_in_threadpool(cloud.flush, 10)
            await run_in_threadpool(cloud.complete_jobs, 3)
        except Exception as error:
            logging.getLogger("cloudvault").warning(
                "Cloud resume deferred: %s", type(error).__name__
            )

    task = (
        asyncio.create_task(resume_cloud())
        if settings.data_dir.resolve() == (ROOT / "data").resolve()
        else None
    )
    try:
        yield
    finally:
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="CloudVault", version="3.0.0", lifespan=lifespan)
app.include_router(ai_router)
app.include_router(analytics_router)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])
ALLOWED_ORIGINS = {
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
}


@app.middleware("http")
async def protect(request: Request, call_next):
    origin = request.headers.get("origin")
    if (origin and origin not in ALLOWED_ORIGINS) or (
        request.method not in {"GET", "HEAD", "OPTIONS"}
        and request.headers.get("sec-fetch-site") == "cross-site"
    ):
        return JSONResponse({"detail": "Request origin is not allowed"}, status_code=403)
    length = request.headers.get("content-length")
    if request.url.path == "/api/files/upload" and not length:
        return JSONResponse(
            {"detail": "Content-Length is required for bounded uploads"}, status_code=411
        )
    if length and not length.isdigit():
        return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
    if (
        request.url.path == "/api/files/upload"
        and length
        and int(length) > (settings.max_upload_mb * 1024 * 1024 + 1024 * 1024)
    ):
        return JSONResponse({"detail": "Upload exceeds size limit"}, status_code=413)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'"
    )
    if request.url.path in {"/docs", "/redoc"}:
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://fastapi.tiangolo.com; frame-ancestors 'none'"
        )
    return response


@app.exception_handler(BotoCoreError)
@app.exception_handler(ClientError)
async def aws_error(request, error):
    code = (
        error.response.get("Error", {}).get("Code", "")
        if isinstance(error, ClientError)
        else type(error).__name__
    )
    if code in {"NoSuchKey", "404", "NotFound"}:
        return JSONResponse(
            {"detail": "Original S3 object was not found. Metadata has been retained."},
            status_code=404,
        )
    return JSONResponse(
        {
            "detail": "AWS request failed. Check internet access, bucket permissions and your session. If expired, run aws login --profile default.",
            "code": code,
        },
        status_code=503,
    )


@app.exception_handler(FreePlanRequiredError)
async def free_plan_required(request, error):
    return JSONResponse(
        {
            "detail": "AWS operations are paused: an active Free plan and more than USD1 eligible credit could not be verified. No paid-plan upgrade or personal spending is permitted. Local indexed search and history remain available."
        },
        status_code=503,
    )


@app.exception_handler(sqlite3.Error)
async def database_error(request, error):
    logging.getLogger("cloudvault").error("Database error: %s", type(error).__name__)
    return JSONResponse(
        {"detail": "Local database unavailable. Check disk space and retry."}, status_code=503
    )


@app.exception_handler(ValueError)
async def invalid(request, error):
    return JSONResponse({"detail": str(error)[:300]}, status_code=400)


def require(file_id):
    record = get_file(file_id)
    if not record:
        raise HTTPException(404, "File not found")
    return record


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "version": "3.0.0",
        "storage": "aws",
        "model_loaded": engine.model is not None,
    }


@app.get("/api/aws/status")
def aws_status():
    return storage.diagnostics()


@app.get("/api/settings")
def get_settings():
    return {
        "region": settings.aws_region,
        "bucket": settings.s3_bucket,
        "prefix": settings.s3_object_prefix,
        "storage_mode": "aws",
        "model": settings.embedding_model,
        "dimension": engine.model.get_embedding_dimension() if engine.model else None,
        "model_loaded": engine.model is not None,
        "model_error": engine.error,
        "max_upload_mb": settings.max_upload_mb,
        "chunk_tokens": 220,
        "overlap_tokens": 32,
        "max_extracted_chars": settings.max_extracted_chars,
        "version": "3.0.0",
        "index_location": "Local SQLite; original files are stored in private Amazon S3",
    }


@app.get("/api/stats")
def stats():
    with connect() as db:
        summary = dict(
            db.execute(
                "SELECT COUNT(*) total_files, COALESCE(SUM(size),0) total_bytes FROM files WHERE status NOT IN ('upload_failed','uploading')"
            ).fetchone()
        )
        summary["statuses"] = {
            r["status"]: r["n"]
            for r in db.execute("SELECT status, COUNT(*) n FROM files GROUP BY status")
        }
        summary["types"] = {
            r["extension"] or "other": r["n"]
            for r in db.execute("SELECT extension, COUNT(*) n FROM files GROUP BY extension")
        }
        summary["recent"] = [
            public_file(r)
            for r in db.execute("SELECT * FROM files ORDER BY created_at DESC LIMIT 5")
        ]
        summary["chunks"] = db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    return summary


@app.get("/api/files")
def files(
    q: str = Query("", max_length=200),
    extension: str = "",
    sort: Literal["name", "size", "created_at"] = "created_at",
    direction: Literal["asc", "desc"] = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    starred: bool = False,
    status: str = Query("", max_length=30),
):
    cloud_rows, source = cloud.metadata_rows()
    if cloud_rows is not None:
        matching = [
            r
            for r in cloud_rows
            if q.casefold() in r["name"].casefold()
            and (not extension or r["extension"] == extension)
            and (not starred or r.get("starred"))
            and (not status or r["status"] == status)
        ]
        matching.sort(key=lambda r: r[sort], reverse=direction == "desc")
        return {
            "items": matching[(page - 1) * page_size : page * page_size],
            "total": len(matching),
            "page": page,
            "page_size": page_size,
            "metadata_source": source,
        }
    clause = "WHERE instr(lower(name),lower(?))>0 AND (?='' OR extension=?) AND (?=0 OR starred=1) AND (?='' OR status=?)"
    args = (q, extension, extension, int(starred), status, status)
    with connect() as db:
        total = db.execute("SELECT COUNT(*) FROM files " + clause, args).fetchone()[0]
        rows = db.execute(
            f"SELECT * FROM files {clause} ORDER BY {sort} {direction} LIMIT ? OFFSET ?",
            (*args, page_size, (page - 1) * page_size),
        ).fetchall()
    return {
        "items": [public_file(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "metadata_source": source,
    }


@app.post("/api/files/upload", status_code=201)
def upload(background: BackgroundTasks, file: UploadFile = File(...)):
    name = safe_filename(file.filename or "")
    data = file.file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "File exceeds configured upload limit")
    file_id = str(uuid4())
    key = settings.s3_object_prefix + file_id + "/" + name
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    timestamp = now()
    # Persist a recovery record before cloud mutation. A failed upload remains clearly failed.
    with connect() as db:
        db.execute(
            "INSERT INTO files(id,original_name,name,object_key,size,mime,extension,sha256,created_at,updated_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                file_id,
                name,
                name,
                key,
                len(data),
                mime,
                Path(name).suffix.lower(),
                hashlib.sha256(data).hexdigest(),
                timestamp,
                timestamp,
                "uploading",
            ),
        )
    try:
        storage.upload(key, data, mime, file_id)
    except Exception:
        with connect() as db:
            db.execute(
                "UPDATE files SET status='upload_failed',error='Cloud upload failed; select the file again to retry.' WHERE id=?",
                (file_id,),
            )
        raise
    with connect() as db:
        db.execute("UPDATE files SET status='pending' WHERE id=?", (file_id,))
    cloud.enqueue(file_id)
    background.add_task(index_file, file_id)
    return public_file(require(file_id))


@app.get("/api/files/{file_id}")
def detail(file_id: str):
    local = public_file(require(file_id))
    return cloud.metadata_detail(file_id) or {
        **local,
        "metadata_source": "local_cached_fallback"
        if cloud.configuration().get("metadata_enabled")
        else "local",
    }


@app.get("/api/files/{file_id}/download")
def download(file_id: str):
    record = require(file_id)
    data = storage.read(record["object_key"])
    return Response(
        data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(record['name'])}",
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/files/{file_id}/preview")
def preview(file_id: str):
    record = require(file_id)
    with connect() as db:
        sections = [
            {"chunk_id": r["id"], "section": r["section"], "text": r["text"]}
            for r in db.execute(
                "SELECT id,section,text FROM chunks WHERE file_id=? ORDER BY id LIMIT 80",
                (file_id,),
            )
        ]
    return {
        "name": record["name"],
        "text": record["extracted_text"][:50000],
        "truncated": len(record["extracted_text"]) > 50000,
        "status": record["status"],
        "note": "Safe extracted-text preview. Images and scanned PDFs require OCR.",
        "sections": sections,
        "file": public_file(record),
    }


@app.get("/api/files/{file_id}/image")
def image_preview(file_id: str):
    from io import BytesIO
    from PIL import Image, UnidentifiedImageError

    record = require(file_id)
    if record["extension"] not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        raise HTTPException(415, "Only safe raster formats have image previews")
    try:
        Image.MAX_IMAGE_PIXELS = 25_000_000
        with Image.open(BytesIO(storage.read(record["object_key"]))) as image:
            image.thumbnail((1600, 1600))
            output = BytesIO()
            image.convert("RGB").save(output, format="JPEG", quality=85)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
        raise HTTPException(415, "This image cannot be safely previewed") from None
    return Response(
        output.getvalue(),
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=120"},
    )


class Rename(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    starred: bool | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value):
        return safe_filename(value) if value is not None else None


@app.patch("/api/files/{file_id}")
def rename(file_id: str, payload: Rename):
    require(file_id)
    with connect() as db:
        if payload.name is not None:
            db.execute(
                "UPDATE files SET name=?,updated_at=? WHERE id=?", (payload.name, now(), file_id)
            )
        if payload.starred is not None:
            db.execute(
                "UPDATE files SET starred=?,updated_at=? WHERE id=?",
                (int(payload.starred), now(), file_id),
            )
    cloud.enqueue(file_id)
    try:
        cloud.flush()
    except Exception:
        pass  # Durable outbox retains the local edit for bounded reconciliation.
    return public_file(require(file_id))


@app.delete("/api/files/{file_id}")
def remove(file_id: str, confirm: bool = False):
    if not confirm:
        raise HTTPException(400, "Explicit deletion confirmation is required")
    with index_lock:
        record = require(file_id)
        if not record["owned"]:
            raise HTTPException(403, "Imported original objects are protected from deletion")
        storage.delete(record["object_key"])
        cloud.enqueue(file_id, tombstone=True)
        with connect() as db:
            db.execute("DELETE FROM files WHERE id=?", (file_id,))
        try:
            cloud.flush()
        except Exception:
            pass
    return {"deleted": file_id}


@app.post("/api/files/{file_id}/reindex", status_code=202)
def reindex(file_id: str, background: BackgroundTasks):
    record = require(file_id)
    if record["status"] in {"pending", "processing", "uploading"}:
        raise HTTPException(409, "File is already being processed")
    if record["status"] == "upload_failed":
        raise HTTPException(409, "Upload failed; upload the original file again")
    with connect() as db:
        db.execute("UPDATE files SET status='pending', error=NULL WHERE id=?", (file_id,))
    cloud.enqueue(file_id)
    background.add_task(index_file, file_id)
    return {"status": "pending"}


@app.post("/api/import-test-object", status_code=201)
def import_test(background: BackgroundTasks):
    key = "cloudvault-test.txt"
    with connect() as db:
        existing = db.execute("SELECT id FROM files WHERE object_key=?", (key,)).fetchone()
    if existing:
        return public_file(require(existing["id"]))
    data = storage.read(key)
    file_id, timestamp = str(uuid4()), now()
    with connect() as db:
        db.execute(
            "INSERT INTO files(id,original_name,name,object_key,size,mime,extension,sha256,created_at,updated_at,status,owned) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                file_id,
                key,
                key,
                key,
                len(data),
                "text/plain",
                ".txt",
                hashlib.sha256(data).hexdigest(),
                timestamp,
                timestamp,
                "pending",
                0,
            ),
        )
    background.add_task(index_file, file_id)
    return public_file(require(file_id))


@app.get("/api/reconcile")
def reconcile():
    objects = []
    for page in (
        storage.s3()
        .get_paginator("list_objects_v2")
        .paginate(Bucket=settings.s3_bucket, Prefix=settings.s3_object_prefix)
    ):
        objects.extend({"key": r["Key"], "size": r["Size"]} for r in page.get("Contents", []))
        if len(objects) > 10000:
            raise HTTPException(413, "Reconciliation limited to 10,000 objects")
    with connect() as db:
        records = {
            r["object_key"] for r in db.execute("SELECT object_key FROM files WHERE owned=1")
        }
    keys = {o["key"] for o in objects}
    return {
        "untracked_objects": [o for o in objects if o["key"] not in records],
        "missing_objects": sorted(records - keys),
        "note": "Read-only report; nothing is deleted or imported automatically.",
    }


@app.get("/api/search")
def find(
    q: str = Query(min_length=1, max_length=1000),
    mode: Literal["semantic", "keyword", "hybrid", "filename"] = "semantic",
    top_k: int = Query(10, ge=1, le=50),
    threshold: float = Query(0.25, ge=0, le=1),
    extension: str = "",
):
    if not q.strip():
        raise HTTPException(400, "Enter a search query")
    try:
        return search(q.strip(), mode, top_k, threshold, extension)
    except ValueError:
        raise
    except Exception as error:
        logging.getLogger("cloudvault").warning("Search failed: %s", type(error).__name__)
        raise HTTPException(
            503, "Search unavailable. Check the local model setup and retry."
        ) from None


DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def homepage():
        return FileResponse(DIST / "index.html")

    @app.get("/workspace")
    @app.get("/workspace/{page:path}")
    def workspace_page(page: str = ""):
        page = page.rstrip("/")
        if page and page not in {
            "files",
            "starred",
            "recent",
            "upload",
            "search",
            "ask",
            "cloud",
            "settings",
            "about",
            "help",
        }:
            raise HTTPException(404, "Workspace page not found")
        return FileResponse(DIST / "index.html")
