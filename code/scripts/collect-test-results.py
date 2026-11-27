"""Collect actual final suite summaries; never manufactures a passing count."""

import json
import re
import argparse
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--independent',action='store_true')
args=parser.parse_args()
definitions = [
    ("backend", "backend-release-tests.log", r"Tests:\s+(\d+) passed"),
    ("frontend", "frontend-release-tests.log", r"Tests\s+(\d+) passed"),
    ("python", "python-release-tests.log", r"(\d+) passed in"),
    ("infrastructure", "infra-tests.log", r"Tests\s+(\d+) passed"),
]
if args.independent:
    definitions=[(name,filename.replace('-release-tests','-independent-tests') if name!='infrastructure' else 'infra-independent-tests.log',pattern) for name,filename,pattern in definitions]
report = {
    "collected_at": datetime.now(timezone.utc).isoformat(),
    "suites": {},
    "benchmarks_counted_separately": True,
}
total = 0
for name, filename, pattern in definitions:
    path = root / ".runtime" / filename
    raw = path.read_bytes()
    text = raw.decode("utf-16" if raw.startswith(b"\xff\xfe") else "utf-8", errors="replace")
    matches = re.findall(pattern, text)
    if not matches or re.search(r"\b\d+ failed\b", text):
        raise SystemExit("No clean passing final suite summary: " + name)
    count = int(matches[-1])
    total += count
    report["suites"][name] = {
        "passed": count,
        "result": "passed",
        "log": ".runtime/" + filename,
        "log_completed_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
    }
report["total_passed"] = total
report["build_types_lint"] = {}
checks = [
    ("production_build", "build.log", "built in"),
    ("typescript", "typecheck.log", "tsc --noEmit"),
    ("eslint", "lint.log", "eslint"),
    ("python_ruff", "python-lint.log", "All checks passed"),
    ("latest_frontend_build", "frontend-final-build.log", "built in"),
    ("latest_frontend_lint", "frontend-final-lint.log", "eslint"),
]
if args.independent:
    checks = [check for check in checks if not check[0].startswith('latest_frontend_')]
for name, filename, success in checks:
    text = (root / ".runtime" / filename).read_text(encoding="utf-8", errors="replace")
    if success not in text or re.search(r"error TS\d+|npm error|\b[1-9]\d* problems\b", text):
        raise SystemExit("Final check not clean: " + name)
    report["build_types_lint"][name] = {"result": "passed", "log": ".runtime/" + filename}
report["result"] = "passed"
(root.parent / ('docs/INDEPENDENT_TEST_RESULTS.json' if args.independent else "docs/TEST_RESULTS.json")).write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
