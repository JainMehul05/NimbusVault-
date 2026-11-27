"""One guarded read-only recheck of a prior timed-out service observation."""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

root = Path(__file__).resolve().parents[1]
load_dotenv(root / ".env")
sys.path.insert(0, str(root / "intelligence"))
from app import cloud, cost_guard

if not cost_guard.permitted():
    raise SystemExit("Current Free-plan/reserve guard rejected read-only recheck")
path = root.parent / "docs/AWS_CURRENT_STATUS.json"
report = json.loads(path.read_text())
previous = report["services"]["Step Functions"]
history = root.parent / "docs/verification-history/step-functions-prior-timeout.json"
if not history.exists():
    history.write_text(json.dumps(previous, indent=2))
resources = json.loads((root / ".runtime/cloud-resources.json").read_text(encoding="utf-8-sig"))
result = cloud.client("stepfunctions").describe_state_machine(
    stateMachineArn=resources["serverless_outputs"]["WorkflowArn"]
)
report["services"]["Step Functions"] = {
    "status": "verified_read_only",
    "state": result["status"],
    "observed_at": datetime.now(UTC).isoformat(),
    "prior_timeout_rechecked": True,
}
path.write_text(json.dumps(report, indent=2))
(root / ".runtime/aws-audit.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report["services"]["Step Functions"]))
