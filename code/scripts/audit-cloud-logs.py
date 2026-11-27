"""Inspect a bounded log sample for safe structure; never exports message contents."""

import json
import re
import sys
from pathlib import Path
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "intelligence"))
from dotenv import load_dotenv  # noqa:E402

load_dotenv(root / ".env")
from app import cloud, cost_guard  # noqa:E402

if not cost_guard.permitted():
    raise SystemExit("Approved account / active Free plan / reserve could not be verified")
cfg = json.loads((root / ".runtime/cloud-resources.json").read_text(encoding="utf-8-sig"))
group = "/aws/lambda/" + cfg["serverless_outputs"]["FunctionName"]
streams = cloud.client("logs").describe_log_streams(
    logGroupName=group, orderBy="LastEventTime", descending=True, limit=1
)["logStreams"]
events = (
    cloud.client("logs").get_log_events(
        logGroupName=group, logStreamName=streams[0]["logStreamName"], limit=5
    )["events"]
    if streams
    else []
)
keys = set()
sensitive = 0
structured = 0
for event in events:
    text = event["message"].strip()
    if re.search(r"(?:AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN .*PRIVATE KEY", text):
        sensitive += 1
    try:
        record = json.loads(text)
        if isinstance(record, dict):
            structured += 1
            keys.update(record)
            if set(record) & {
                "password",
                "token",
                "credentials",
                "authorization",
                "text",
                "question",
                "answer",
                "content",
            }:
                sensitive += 1
    except ValueError:
        pass
report = {
    "observed_at": datetime.now(timezone.utc).isoformat(),
    "read_only": True,
    "sample_limit": 5,
    "sampled_events": len(events),
    "structured_events": structured,
    "structured_field_names": sorted(keys),
    "sensitive_field_or_key_findings": sensitive,
    "contents_exported": False,
    "scope": "Latest bounded sample only; source logging reviewed separately, not a complete log-content audit.",
}
(root.parent / "docs/INDEPENDENT_LOG_SAFETY.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report))
