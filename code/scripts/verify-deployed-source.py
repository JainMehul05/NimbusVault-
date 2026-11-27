"""Read the existing Lambda code package and compare source; never deploys."""

import base64
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "intelligence"))
from dotenv import load_dotenv  # noqa:E402

load_dotenv(root / ".env")
from app import cloud, cost_guard  # noqa:E402
import httpx  # noqa:E402

if not cost_guard.permitted():
    raise SystemExit("Current account / active Free plan / reserve not verified")
resources = json.loads((root / ".runtime/cloud-resources.json").read_text(encoding="utf-8-sig"))
package = cloud.client("lambda").get_function(
    FunctionName=resources["serverless_outputs"]["FunctionName"]
)
with httpx.stream("GET", package["Code"]["Location"], timeout=10, trust_env=False) as response:
    response.raise_for_status()
    data = b""
    for part in response.iter_bytes():
        data += part
        if len(data) > 1024 * 1024:
            raise SystemExit("Code package exceeded bounded 1 MiB inspection limit")
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    deployed = archive.read(
        package["Configuration"]["Handler"].rsplit(".", 1)[0].replace(".", "/") + ".py"
    )
local = (root / "infrastructure/worker.py").read_bytes()
report = {
    "observed_at": datetime.now(timezone.utc).isoformat(),
    "read_only": True,
    "code_package_hash_verified": base64.b64encode(hashlib.sha256(data).digest()).decode()
    == package["Configuration"]["CodeSha256"],
    "deployed_worker_matches_local_source": deployed.replace(b"\r\n", b"\n")
    == local.replace(b"\r\n", b"\n"),
    "package_bytes": len(data),
    "mutations": [],
}
(root.parent / "docs/DEPLOYED_SOURCE_AUDIT.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report))
