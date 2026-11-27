"""Real Qwen acceptance, isolated synthetic scope; no uploads or AWS operations."""

import base64
import argparse
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
parser = argparse.ArgumentParser()
parser.add_argument("--cases", default="benchmarks/ai-cases.json")
parser.add_argument("--output", default="../docs/AI_QUALITY_BENCHMARK.json")
args = parser.parse_args()
sys.path.insert(0, str(root / "intelligence"))
os.environ["AWS_OPERATIONS_ENABLED"] = "false"
os.environ["AWS_WRITES_ENABLED"] = "false"
os.environ["NIMBUS_LOCAL_RETRIEVAL"] = "true"
os.environ["INTERNAL_SERVICE_TOKEN"] = "synthetic-local-benchmark-private-token-32"
from fastapi.testclient import TestClient  # noqa: E402
from app.config import settings  # noqa: E402
from app.internal import app  # noqa: E402
from app import llm  # noqa: E402
from app.benchmark_guard import install as install_aws_guard  # noqa: E402

aws_evidence = install_aws_guard()

raw_outputs = []
original_generate = llm.generate


async def traced_generate(question, sources):
    result = await original_generate(question, sources)
    raw_outputs.append(result[0].model_dump())
    return result


llm.generate = traced_generate

corpus = json.loads((root / "benchmarks/corpus.json").read_text())
cases_path = root / args.cases
cases = json.loads(cases_path.read_text())
ids = {k: str(uuid5(NAMESPACE_URL, "nimbus-synthetic-benchmark/" + k)) for k in corpus["documents"]}
reverse = {v: k for k, v in ids.items()}
headers = {
    "x-service-token": os.environ["INTERNAL_SERVICE_TOKEN"],
    "x-actor-id": str(uuid5(NAMESPACE_URL, "nimbus-synthetic-benchmark/owner")),
}
report = {
    "started_at": datetime.now(timezone.utc).isoformat(),
    "cases_sha256": hashlib.sha256(cases_path.read_bytes()).hexdigest(),
    "actual_model": settings.llm_model,
    "isolated_local_only": True,
    "aws_calls": 0,
    "aws_sdk_instrumentation": aws_evidence,
    "cases": [],
}
output = root / args.output
threads = {}
with tempfile.TemporaryDirectory(prefix="nimbus-ai-benchmark-") as temporary:
    settings.data_dir = Path(temporary)
    with TestClient(app) as client:
        for key, doc in corpus["documents"].items():
            raw = doc["text"].encode()
            client.post(
                "/index",
                headers=headers,
                json={
                    "file_id": ids[key],
                    "filename": doc["filename"],
                    "object_key": f"cloudvault/files/{ids[key]}/{doc['filename']}",
                    "sha256": hashlib.sha256(raw).hexdigest(),
                    "mime": "text/plain",
                    "content": base64.b64encode(raw).decode(),
                },
            ).raise_for_status()
        for case in cases:
            raw_outputs.clear()
            scope = [ids[k] for k in case["scope"]]
            body = {"question": case["question"], "file_ids": scope}
            if case.get("thread") in threads:
                body["conversation_id"] = threads[case["thread"]]
            started = time.perf_counter()
            response = client.post(
                "/api/ai/ask", headers={**headers, "x-file-scope": json.dumps(scope)}, json=body
            )
            elapsed = (time.perf_counter() - started) * 1000
            response.raise_for_status()
            answer = response.json()
            answer["benchmark_raw_model_outputs"] = list(raw_outputs)
            if case.get("thread") and answer.get("conversation_id"):
                threads[case["thread"]] = answer["conversation_id"]
            sources = answer.get("sources", [])
            by_label = {s["citation"]: s for s in sources}
            claims = answer.get("claims", [])
            valid_quotes = all(
                label in by_label
                and " ".join(quote.casefold().split())
                in " ".join(by_label[label]["passage"].casefold().split())
                for claim in claims
                for label, quote in zip(claim["citations"], claim["quotes"])
            )
            actual = set(reverse[s["file_id"]] for s in sources)
            expected = set(case.get("sources", []))
            facts = case.get("facts", [])
            covered = [
                fact for fact in facts if fact.casefold() in answer.get("answer", "").casefold()
            ]
            no_leak = actual.issubset(case["scope"]) and "81270" not in answer.get("answer", "")
            insufficient = answer.get("mode") == "insufficient"
            passed = (
                (
                    insufficient
                    if case.get("insufficient")
                    else answer.get("mode") == "generated"
                    and len(covered) == len(facts)
                    and expected.issubset(actual)
                )
                and valid_quotes
                and no_leak
            )
            report["cases"].append(
                {
                    **case,
                    "answer": answer,
                    "latency_ms": round(elapsed, 2),
                    "facts_covered": covered,
                    "fact_coverage": len(covered) / len(facts) if facts else None,
                    "exact_quotation_checks_pass": valid_quotes,
                    "permission_scope_pass": no_leak,
                    "expected_source_coverage": expected.issubset(actual),
                    "acceptance_pass": passed,
                }
            )
            output.write_text(json.dumps(report, indent=2))
            print(
                case["id"],
                answer["mode"],
                "PASS" if passed else "REVIEW",
                round(elapsed),
                flush=True,
            )
positive = [c for c in report["cases"] if not c.get("insufficient")]
negative = [c for c in report["cases"] if c.get("insufficient")]
report["summary"] = {
    "questions": len(cases),
    "acceptance_passes": sum(c["acceptance_pass"] for c in report["cases"]),
    "positive_questions": len(positive),
    "real_generated": sum(c["answer"]["mode"] == "generated" for c in positive),
    "mean_fact_coverage": statistics.mean(c["fact_coverage"] for c in positive),
    "correct_insufficient": sum(c["answer"]["mode"] == "insufficient" for c in negative),
    "insufficient_cases": len(negative),
    "quotation_check_failures": sum(not c["exact_quotation_checks_pass"] for c in report["cases"]),
    "permission_failures": sum(not c["permission_scope_pass"] for c in report["cases"]),
    "median_total_latency_ms": statistics.median(c["latency_ms"] for c in report["cases"]),
}
report["finished_at"] = datetime.now(timezone.utc).isoformat()
output.write_text(json.dumps(report, indent=2))
print(json.dumps(report["summary"], indent=2))
