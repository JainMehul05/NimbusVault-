"""Mode-appropriate literal/filename/BM25 cases, new isolated indexed fixtures."""

import base64
import hashlib
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "intelligence"))
os.environ["AWS_OPERATIONS_ENABLED"] = "false"
os.environ["AWS_WRITES_ENABLED"] = "false"
os.environ["NIMBUS_LOCAL_RETRIEVAL"] = "true"
os.environ["INTERNAL_SERVICE_TOKEN"] = "independent-mode-benchmark-token-32-characters"
from fastapi.testclient import TestClient  # noqa:E402
from app.config import settings  # noqa:E402
from app.internal import app  # noqa:E402

one, two = str(uuid4()), str(uuid4())
headers = {
    "x-service-token": os.environ["INTERNAL_SERVICE_TOKEN"],
    "x-actor-id": str(uuid4()),
    "x-file-scope": json.dumps([one]),
}
documents = [
    (
        one,
        "audit-runbook.txt",
        "Recovery code TX-713 requires a verified backup. The maximum repair window is 45 minutes.",
    ),
    (two, "private-runbook.txt", "The secret code TX-999 grants unrestricted access."),
]
cases = [
    ("filename", "audit-runbook", True),
    ("filename", "private-runbook", False),
    ("filename", "absent-file", False),
    ("exact", "verified backup", True),
    ("exact", "45 minutes", True),
    ("exact", "TX-999", False),
    ("exact", "imaginary spacecraft", False),
    ("lexical", "TX-713", True),
    ("lexical", "repair window", True),
    ("lexical", "TX-999", False),
    ("lexical", "spacecraft", False),
    ("semantic", "How long may a repair take?", True),
    ("hybrid", "What must be checked before recovery?", True),
]
report = {
    "observed_at": datetime.now(timezone.utc).isoformat(),
    "isolated_new_synthetic_documents": True,
    "aws_calls": 0,
    "cases": [],
}
with tempfile.TemporaryDirectory(prefix="nimbus-mode-audit-") as temporary:
    settings.data_dir = Path(temporary)
    with TestClient(app) as client:
        for key, name, text in documents:
            raw = text.encode()
            client.post(
                "/index",
                headers=headers,
                json={
                    "file_id": key,
                    "filename": name,
                    "object_key": f"cloudvault/files/{key}/{name}",
                    "sha256": hashlib.sha256(raw).hexdigest(),
                    "mime": "text/plain",
                    "content": base64.b64encode(raw).decode(),
                },
            ).raise_for_status()
        for mode, query, expected in cases:
            start = time.perf_counter()
            response = client.post(
                "/api/ai/search", headers=headers, json={"mode": mode, "query": query}
            )
            response.raise_for_status()
            found = response.json()["sources"]
            passed = bool(found) == expected and all(s["file_id"] == one for s in found)
            report["cases"].append(
                {
                    "mode": mode,
                    "query": query,
                    "expected_match": expected,
                    "actual_matches": len(found),
                    "latency_ms": round((time.perf_counter() - start) * 1000, 2),
                    "passed": passed,
                }
            )
        # Reindexing the same immutable bytes preserves passage IDs and doesn't duplicate.
        prior = client.post(
            "/api/ai/search", headers=headers, json={"query": "TX-713", "mode": "exact"}
        ).json()["sources"][0]["chunk_id"]
        raw = documents[0][2].encode()
        client.post(
            "/index",
            headers=headers,
            json={
                "file_id": one,
                "filename": "audit-runbook.txt",
                "object_key": f"cloudvault/files/{one}/audit-runbook.txt",
                "sha256": hashlib.sha256(raw).hexdigest(),
                "mime": "text/plain",
                "content": base64.b64encode(raw).decode(),
            },
        ).raise_for_status()
        after = client.post(
            "/api/ai/search", headers=headers, json={"query": "TX-713", "mode": "exact"}
        ).json()["sources"]
        report["stable_passage_after_reindex"] = len(after) == 1 and after[0]["chunk_id"] == prior
report["passed"] = sum(c["passed"] for c in report["cases"])
report["total"] = len(cases)
report["result"] = (
    "passed"
    if report["passed"] == len(cases) and report["stable_passage_after_reindex"]
    else "failed"
)
(root.parent / "docs/INDEPENDENT_SEARCH_MODES.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
if report["result"] != "passed":
    raise SystemExit(1)
