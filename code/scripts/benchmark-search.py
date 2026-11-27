"""Real local MiniLM benchmark through private adapter, in an ephemeral database."""

import argparse
import base64
import hashlib
import json
import os
import statistics
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "intelligence"))
os.environ["AWS_OPERATIONS_ENABLED"] = "false"
os.environ["NIMBUS_LOCAL_RETRIEVAL"] = "true"
os.environ["INTERNAL_SERVICE_TOKEN"] = "synthetic-local-benchmark-private-token-32"
from fastapi.testclient import TestClient  # noqa: E402
from app.config import settings  # noqa: E402
from app.internal import app  # noqa: E402
from app.benchmark_guard import install as install_aws_guard  # noqa: E402

aws_evidence = install_aws_guard()

parser = argparse.ArgumentParser()
parser.add_argument("--label", required=True)
parser.add_argument("--output", help="Report path; use /tmp on a read-only Linux runtime")
parser.add_argument("--fresh-held-out", action="store_true")
parser.add_argument("--independent", action="store_true")
parser.add_argument("--modes", nargs="+", default=["semantic", "hybrid"])
args = parser.parse_args()
corpus_path = root / "benchmarks/corpus.json"
corpus = json.loads(corpus_path.read_text())
if args.fresh_held_out:
    corpus["search"].extend(json.loads((root / "benchmarks/fresh-held-out.json").read_text()))
if args.independent:
    corpus["search"].extend(json.loads((root / "benchmarks/independent-search.json").read_text()))
ids = {
    key: str(uuid5(NAMESPACE_URL, "nimbus-synthetic-benchmark/" + key))
    for key in corpus["documents"]
}
reverse = {value: key for key, value in ids.items()}
report = {
    "started_at": datetime.now(timezone.utc).isoformat(),
    "label": args.label,
    "corpus_sha256": hashlib.sha256(corpus_path.read_bytes()).hexdigest(),
    "model": settings.embedding_model,
    "isolated_local_only": True,
    "aws_calls": 0,
    "aws_sdk_instrumentation": aws_evidence,
    "cases": [],
}
output = root / args.output if args.output else root.parent / f"docs/SEARCH_BENCHMARK_{args.label.upper()}.json"
headers = {
    "x-service-token": os.environ["INTERNAL_SERVICE_TOKEN"],
    "x-actor-id": str(uuid5(NAMESPACE_URL, "nimbus-synthetic-benchmark/owner")),
}
with tempfile.TemporaryDirectory(prefix="nimbus-benchmark-") as temporary:
    settings.data_dir = Path(temporary)
    with TestClient(app) as client:
        for key, document in corpus["documents"].items():
            raw = document["text"].encode()
            response = client.post(
                "/index",
                headers=headers,
                json={
                    "file_id": ids[key],
                    "filename": document["filename"],
                    "object_key": f"cloudvault/files/{ids[key]}/{document['filename']}",
                    "sha256": hashlib.sha256(raw).hexdigest(),
                    "mime": "text/plain",
                    "content": base64.b64encode(raw).decode(),
                },
            )
            response.raise_for_status()
        for case in corpus["search"]:
            scope = case.get("scope") or [
                k for k, v in corpus["documents"].items() if v["authorized"]
            ]
            for mode in args.modes:
                started = time.perf_counter()
                response = client.post(
                    "/api/ai/search",
                    headers={**headers, "x-file-scope": json.dumps([ids[k] for k in scope])},
                    json={"query": case["query"], "mode": mode, "limit": 10},
                )
                response.raise_for_status()
                data = response.json()
                ranked = list(dict.fromkeys(reverse[s["file_id"]] for s in data["sources"]))
                expected = set(case["expected"])
                rank = next((i for i, k in enumerate(ranked, 1) if k in expected), None)
                report["cases"].append(
                    {
                        **case,
                        "mode": mode,
                        "ranked_documents": ranked,
                        "scores": [round(s["similarity"], 4) for s in data["sources"]],
                        "top1": bool(ranked and ranked[0] in expected) if expected else None,
                        "top3": bool(expected & set(ranked[:3])) if expected else None,
                        "recall_at_3": len(expected & set(ranked[:3])) / len(expected)
                        if expected
                        else None,
                        "reciprocal_rank": 1 / rank if rank else 0,
                        "correct_abstention": not ranked if not expected else None,
                        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
                        "unauthorized_leak": "hidden" in ranked,
                    }
                )
                output.write_text(json.dumps(report, indent=2))
        report["summary"] = {}
        for mode in args.modes:
            for split in [
                "tuning",
                "held_out",
                *(["fresh_held_out"] if args.fresh_held_out else []),
                *(["independent"] if args.independent else []),
                "all",
            ]:
                cases = [
                    c
                    for c in report["cases"]
                    if c["mode"] == mode and (split == "all" or c["split"] == split)
                ]
                relevant = [c for c in cases if c["expected"]]
                negative = [c for c in cases if not c["expected"]]
                report["summary"][mode + "_" + split] = {
                    "queries": len(cases),
                    "relevant_queries": len(relevant),
                    "top1_accuracy": statistics.mean(c["top1"] for c in relevant),
                    "top3_success": statistics.mean(c["top3"] for c in relevant),
                    "recall_at_3": statistics.mean(c["recall_at_3"] for c in relevant),
                    "mrr": statistics.mean(c["reciprocal_rank"] for c in relevant),
                    "negative_queries": len(negative),
                    "correct_abstentions": sum(c["correct_abstention"] for c in negative),
                    "unauthorized_leaks": sum(c["unauthorized_leak"] for c in cases),
                    "median_latency_ms": statistics.median(c["latency_ms"] for c in cases),
                    "p95_latency_ms": sorted(c["latency_ms"] for c in cases)[
                        max(0, int(len(cases) * 0.95) - 1)
                    ],
                }
report["finished_at"] = datetime.now(timezone.utc).isoformat()
output.write_text(json.dumps(report, indent=2))
print(json.dumps(report["summary"], indent=2))
