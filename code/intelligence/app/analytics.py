"""Read-only, local aggregate analytics. No synthetic history or cloud request polling."""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Query
from .database import connect
from . import cloud
from . import cost_guard

router = APIRouter(prefix="/api", tags=["Workspace analytics"])


@router.get("/cloud/jobs")
def cloud_jobs():
    try:
        records = cloud.jobs()
        safe = [
            {
                k: v
                for k, v in row.items()
                if k
                in {
                    "test_fixture",
                    "file_id",
                    "correlation_id",
                    "state",
                    "history",
                    "size",
                    "created_at",
                    "updated_at",
                    "cloud_extraction",
                }
            }
            for row in records[:20]
        ]
        return {
            "jobs": safe,
            "source": "dynamodb",
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception:
        return {
            "jobs": [],
            "source": "unavailable",
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }


@router.post("/cloud/reconcile")
def reconcile_cloud():
    return {"metadata": cloud.flush(limit=10), "jobs": cloud.complete_jobs(limit=3)}


@router.get("/analytics")
def analytics(days: int = Query(7, ge=1, le=30)):
    with connect() as db:
        rows = [
            dict(r)
            for r in db.execute(
                "SELECT extension,size,created_at,status FROM files WHERE status NOT IN ('upload_failed','uploading')"
            )
        ]
        chunks = db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    types = defaultdict(lambda: {"files": 0, "bytes": 0})
    statuses = defaultdict(int)
    today = datetime.now(timezone.utc).date()
    activity = {
        (today - timedelta(days=n)).isoformat(): {"files": 0, "bytes": 0}
        for n in range(days - 1, -1, -1)
    }
    for row in rows:
        category = row["extension"] or "other"
        types[category]["files"] += 1
        types[category]["bytes"] += row["size"]
        statuses[row["status"]] += 1
        date = row["created_at"][:10]
        if date in activity:
            activity[date]["files"] += 1
            activity[date]["bytes"] += row["size"]
    return {
        "source": "persistent_file_records",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "timezone": "UTC",
        "days": days,
        "storage": [
            {"type": k, **v}
            for k, v in sorted(types.items(), key=lambda p: p[1]["bytes"], reverse=True)
        ],
        "activity": [{"date": k, **v} for k, v in activity.items()],
        "statuses": dict(statuses),
        "total_files": len(rows),
        "total_bytes": sum(r["size"] for r in rows),
        "chunks": chunks,
    }


@router.get("/cloud/status")
def cloud_status():
    from pathlib import Path
    import json
    from .config import ROOT

    cfg = cloud.configuration()
    path = Path(ROOT) / ".runtime/cloud-resources.json"
    try:
        resources = json.loads(path.read_text())
    except (OSError, ValueError):
        resources = {}
    services = [
        {
            "name": "Amazon S3",
            "role": "Private original files",
            "status": "live_verified" if resources.get("s3_verified") else "configured",
            "boundary": "aws",
        },
        {
            "name": "S3 Vectors",
            "role": "Semantic query execution",
            "status": "live_verified"
            if resources.get("vector_canary_verified") and cfg.get("vectors_enabled")
            else "not_active",
            "boundary": "aws",
        },
        {
            "name": "DynamoDB",
            "role": "File metadata and job state",
            "status": "live_verified"
            if resources.get("metadata_canary_verified") and cfg.get("metadata_enabled")
            else "not_active",
            "boundary": "aws",
        },
    ]
    for name, key, role in [
        ("Lambda", "lambda_verified", "Bounded cloud processing"),
        ("SQS", "queue_verified", "Ingestion and dead-letter handling"),
        ("EventBridge", "events_verified", "Managed upload event routing"),
        ("Step Functions", "workflow_verified", "Cloud-stage orchestration"),
        ("CloudWatch", "logs_verified", "Execution logs and native metrics"),
        ("API Gateway", "api_verified", "IAM-authenticated metadata API"),
        ("Parameter Store", "parameters_verified", "Cached non-secret configuration"),
    ]:
        services.append(
            {
                "name": name,
                "role": role,
                "status": "live_verified" if resources.get(key) else "not_active",
                "boundary": "aws",
            }
        )
    with connect() as db:
        pending = db.execute("SELECT COUNT(*) FROM cloud_outbox").fetchone()[0]
    monitoring = {}
    try:
        recorded = json.loads((Path(ROOT) / ".runtime/cloud-monitoring.json").read_text())
        for name, series in recorded["native_lambda_metrics"].items():
            points = series["datapoints"]
            monitoring[name] = (
                None
                if not points
                else sum(p["Sum"] for p in points)
                if series["statistic"] == "Sum"
                else max(points, key=lambda p: p["Timestamp"])["Average"]
            )
        monitoring.update(
            checked_at=recorded["checked_at"], window_minutes=recorded["window_minutes"]
        )
    except (OSError, ValueError, KeyError):
        monitoring = {"checked_at": None}
    return {
        "region": "ap-southeast-2",
        "services": services,
        "dense_backend": "s3vectors" if cfg.get("vectors_enabled") else "local",
        "metadata_backend": "dynamodb" if cfg.get("metadata_enabled") else "local",
        "generation": "Local Qwen2.5 3B / Ollama",
        "embedding": "Local MiniLM 384D",
        "pending_metadata_sync": pending,
        "monitoring": monitoring,
        "pipeline_paused": resources.get("pipeline_paused", True),
        "financial_guard": cost_guard.status(),
        "evidence_checked_at": resources.get("operations", [{}])[-1].get("at")
        if resources.get("operations")
        else None,
        "note": "Live verified means a recorded successful operation; it is not a continuous availability guarantee.",
    }
