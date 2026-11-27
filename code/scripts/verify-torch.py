"""Read-only local RECORD integrity + public upstream-version advisory comparison."""

import base64
import csv
import hashlib
import importlib.metadata
import io
import json
from pathlib import Path
from datetime import datetime, timezone
import httpx

root = Path(__file__).resolve().parents[1]
distribution = importlib.metadata.distribution("torch")
version = distribution.version
base_version = version.split("+")[0]
environment = (root / "intelligence/.venv").resolve()
report = {
    "observed_at": datetime.now(timezone.utc).isoformat(),
    "installed_version": version,
    "upstream_version_for_advisories": base_version,
    "installer": distribution.read_text("INSTALLER").strip(),
    "direct_url_available": bool(distribution.read_text("direct_url.json")),
    "mutations": [],
    "record_verified": 0,
    "record_mismatches": [],
    "record_unhashed": 0,
}
for name, digest, size in csv.reader(io.StringIO(distribution.read_text("RECORD"))):
    path = Path(distribution.locate_file(name)).resolve()
    if not path.is_relative_to(environment):
        raise SystemExit("Package RECORD escaped virtual environment; refusing external reads")
    if not digest:
        report["record_unhashed"] += 1
        continue
    algorithm, expected = digest.split("=", 1)
    value = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    if base64.urlsafe_b64encode(value.digest()).decode().rstrip("=") != expected:
        report["record_mismatches"].append(name)
    else:
        report["record_verified"] += 1
with httpx.Client(timeout=15, trust_env=False) as client:
    response = client.post(
        "https://api.osv.dev/v1/query",
        json={"package": {"name": "torch", "ecosystem": "PyPI"}, "version": base_version},
    )
    response.raise_for_status()
    report["osv_base_version_advisories"] = [
        {"id": v["id"], "summary": v.get("summary"), "references": v.get("references", [])}
        for v in response.json().get("vulns", [])
    ]
    report["pypi_base_version_status"] = client.get(
        "https://pypi.org/pypi/torch/" + base_version + "/json"
    ).status_code
    index = client.get("https://download.pytorch.org/whl/cpu/torch/")
    report["official_cpu_index_status"] = index.status_code
    report["installed_version_listed_in_cpu_index"] = (
        version in index.text or version.replace("+", "%2B") in index.text
    )
report["limitations"] = [
    "RECORD verifies installed-file consistency, not a signed provenance attestation.",
    "Base-version advisory matching does not audit CPU-build-specific changes. No package was upgraded.",
]
(root.parent / "docs/TORCH_ALTERNATIVE_REVIEW.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
