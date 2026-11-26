"""Scan only Git-visible files; report paths/counts, never matching secret values."""
import json
import re
import subprocess
from pathlib import Path
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1]
listed = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root)
paths = sorted(set(listed.decode().split('\0')) - {''})
secrets = []
for line in (root / '.env').read_text(encoding='utf-8-sig').splitlines():
    key, separator, value = line.partition('=')
    if separator and any(word in key for word in ['SECRET', 'TOKEN', 'PASSWORD']) and len(value) >= 24:
        secrets.append(value.encode())
patterns = [re.compile(rb'(?:AKIA|ASIA)[0-9A-Z]{16}'), re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')]
findings = []
count = 0
for name in paths:
    path = root / name
    if not path.is_file():
        continue
    count += 1
    raw = path.read_bytes()
    if any(secret in raw for secret in secrets) or any(pattern.search(raw) for pattern in patterns):
        findings.append(name)
private = ['.env', 'backend/.env', 'intelligence/.env', '.runtime/processes.json', 'data/cloudvault.db', '.private-backup/cloudvault.db']
ignored = {name: subprocess.run(['git', 'check-ignore', '-q', name], cwd=root).returncode == 0 for name in private}
report = {'observed_at':datetime.now(timezone.utc).isoformat(),'files_scanned':count,'secret_matching_paths':findings,'private_runtime_ignored':ignored,'result':'passed' if not findings and all(ignored.values()) else 'failed'}
(root / 'docs/SOURCE_SAFETY_AUDIT.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
if report['result'] != 'passed':
    raise SystemExit(1)
