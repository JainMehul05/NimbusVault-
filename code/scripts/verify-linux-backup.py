"""Restore an isolated synthetic Linux PostgreSQL backup; preserve every database."""
import hashlib
import json
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
private = root / '.runtime/aws-deployment'
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
target = private / 'local-backups' / stamp
target.mkdir(parents=True)
compose = ['docker', 'compose', '--env-file', str(private / 'local/compose.env'),
           '-f', str(root / 'deployment/compose.ec2.yml'), 'exec', '-T']


def run(service, *args, data=None):
    return subprocess.check_output(compose + [service] + list(args), input=data)


dump = run('postgres', 'pg_dump', '-U', 'nimbusvault', '-d', 'nimbusvault', '-Fc')
(target / 'application.dump').write_bytes(dump)
listing = run('postgres', 'pg_restore', '--list', data=dump)
(target / 'restore-contents.txt').write_bytes(listing)
database = 'restore_audit_' + stamp.lower()
run('postgres', 'createdb', '-U', 'nimbusvault', '--template=template0', database)
run('postgres', 'pg_restore', '-U', 'nimbusvault', '-d', database, '--exit-on-error', data=dump)
query = 'SELECT (SELECT count(*) FROM users),(SELECT count(*) FROM files),(SELECT count(*) FROM document_indexes);'
original = run('postgres', 'psql', '-U', 'nimbusvault', '-d', 'nimbusvault', '-At', '-c', query)
restored = run('postgres', 'psql', '-U', 'nimbusvault', '-d', database, '-At', '-c', query)
assert original == restored
tables = run('postgres', 'psql', '-U', 'nimbusvault', '-d', 'nimbusvault', '-At', '-c',
             "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;").decode().splitlines()
for table in tables:
    quoted = '"' + table.replace('"', '""') + '"'
    sql = f'SELECT row_to_json(t)::text FROM {quoted} t ORDER BY row_to_json(t)::text;'
    assert run('postgres', 'psql', '-U', 'nimbusvault', '-d', 'nimbusvault', '-At', '-c', sql) == run(
        'postgres', 'psql', '-U', 'nimbusvault', '-d', database, '-At', '-c', sql), table
run('intelligence', 'python', '-c', "import sqlite3; a=sqlite3.connect('file:/app/data/cloudvault.db?mode=ro',uri=True); b=sqlite3.connect('/tmp/recovery-audit.db'); a.backup(b); assert b.execute('pragma integrity_check').fetchone()[0]=='ok'; b.close(); a.close()")
(target / 'evidence.db').write_bytes(run('intelligence', 'cat', '/tmp/recovery-audit.db'))
with sqlite3.connect(target / 'evidence.db') as db:
    assert db.execute('pragma integrity_check').fetchone()[0] == 'ok'
manifest = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in target.iterdir()}
(target / 'SHA256.json').write_text(json.dumps(manifest, indent=2))
report = {'environment': 'local_linux_synthetic_only', 'postgres_restore_passed': True,
          'postgres_all_public_tables_rows_match': len(tables),
          'original_and_restored_counts': original.decode().strip(), 'sqlite_integrity': 'ok',
          'retained_restore_database': database, 'private_backup': str(target),
          'aws_calls': 0, 'original_windows_databases_modified': False}
(private / 'linux-backup.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
