"""Replay the exact original failed phrase against baseline and repaired retrieval."""

import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "intelligence"))
os.environ["AWS_OPERATIONS_ENABLED"] = "false"
os.environ["AWS_WRITES_ENABLED"] = "false"
os.environ["NIMBUS_LOCAL_RETRIEVAL"] = "true"
os.environ["INTERNAL_SERVICE_TOKEN"] = "synthetic-local-query-regression-token-32"
from fastapi.testclient import TestClient  # noqa:E402
from app.config import settings  # noqa:E402
from app.internal import app  # noqa:E402
from app.retrieval import retrieve  # noqa:E402

old = subprocess.check_output(
    ["git", "show", "8d07eda:intelligence/app/retrieval.py"], cwd=root
).decode()
baseline = types.ModuleType("app.retrieval_baseline")
baseline.__package__ = "app"
exec(compile(old, "<baseline retrieval at 8d07eda>", "exec"), baseline.__dict__)
raw = (root / "samples/cloud-stage-canary.txt").read_bytes()
key = str(uuid4())
with tempfile.TemporaryDirectory(prefix="nimbus-query-regression-") as temporary:
    settings.data_dir = Path(temporary)
    with TestClient(app) as client:
        client.post(
            "/index",
            headers={"x-service-token": os.environ["INTERNAL_SERVICE_TOKEN"]},
            json={
                "file_id": key,
                "filename": "approved-canary.txt",
                "object_key": f"cloudvault/files/{key}/approved-canary.txt",
                "sha256": hashlib.sha256(raw).hexdigest(),
                "mime": "text/plain",
                "content": base64.b64encode(raw).decode(),
            },
        ).raise_for_status()
        before, _ = baseline.retrieve("MiniLM Qwen local laptop", [key], mode="hybrid")
        after, coverage = retrieve("MiniLM Qwen local laptop", [key], mode="hybrid")
        report = {
            "observed_at": datetime.now(timezone.utc).isoformat(),
            "query": "MiniLM Qwen local laptop",
            "original_fixture_sha256": hashlib.sha256(raw).hexdigest(),
            "baseline_commit": "8d07eda",
            "baseline_results": len(before),
            "repaired_results": len(after),
            "repaired_cosine": after[0]["similarity"] if after else None,
            "threshold_unchanged": settings.evidence_threshold,
            "cause": "Whole-query cosine below original lexical rescue floor despite four exact anchors. Hybrid now accepts full scoped BM25 term coverage independently of dense similarity; dense-only threshold unchanged.",
            "aws_calls": coverage["retrieval_backend"]["aws_calls"],
            "isolated_synthetic_fixture": True,
        }
(root / "docs/RECOVERED_QUERY_REGRESSION.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report))
assert not before and after
