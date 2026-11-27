"""Read-only comparison with the original pre-integration backup; no document content output."""
import argparse
import hashlib
import json
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = args.source.resolve()
backup = root / '.private-backup'
original_db = source / 'CloudVault/data/cloudvault.db'
report = {'observed_at': datetime.now(timezone.utc).isoformat(), 'read_only': True, 'legacy_owner_assignment': 'none', 'tables': {}}
def digest_rows(connection, table):
    rows = connection.execute(f'SELECT * FROM {table} ORDER BY rowid').fetchall()
    return len(rows), hashlib.sha256(repr(rows).encode()).hexdigest()
with sqlite3.connect(f'{original_db.as_uri()}?mode=ro', uri=True) as original, sqlite3.connect(f'{(backup / "cloudvault.db").as_uri()}?mode=ro', uri=True) as saved:
    for table in ['files', 'chunks', 'conversations', 'exchanges']:
        current = digest_rows(original, table)
        previous = digest_rows(saved, table)
        report['tables'][table] = {'rows': current[0], 'identical_to_initial_backup': current == previous}
        if current != previous:
            raise SystemExit('Original donor table differs from preserved initial backup: ' + table)
report['private_configuration'] = {}
for relative in ['.env', '.runtime/cloud-resources.json', '.runtime/cloud-config.json']:
    old = source / 'CloudVault' / relative
    snapshot = backup / relative
    if old.exists() and snapshot.exists():
        same = hashlib.sha256(old.read_bytes()).digest() == hashlib.sha256(snapshot.read_bytes()).digest()
        report['private_configuration'][relative] = {'unchanged': same}
        if not same:
            raise SystemExit('Original configuration differs: ' + relative)
result = subprocess.run(['git', '-C', str(source), 'status', '--porcelain'], capture_output=True, text=True, check=True)
report['original_tracked_tree_clean'] = not result.stdout.strip()
if not report['original_tracked_tree_clean']:
    raise SystemExit('Original Git tree changed')
report['result'] = 'passed'
(root.parent / 'docs/PRESERVATION_LOCAL_AUDIT.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
