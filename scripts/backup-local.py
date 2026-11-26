"""Consistent SQLite backup plus local configuration; never copies models or AWS sessions."""

from pathlib import Path
import argparse
import json
import shutil
import sqlite3

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--target", required=True, type=Path)
args = parser.parse_args()
target = args.target.resolve()
if not target.is_relative_to((root / ".private-backup").resolve()):
    raise SystemExit("Backups must stay under the private backup directory")
target.mkdir(parents=True, exist_ok=True)
with (
    sqlite3.connect(
        (root / "data/cloudvault.db").as_uri() + "?mode=ro", uri=True
    ) as original,
    sqlite3.connect(target / "evidence.db") as backup,
):
    original.backup(backup)
    assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    counts = {
        table: backup.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in ["files", "chunks", "conversations", "exchanges"]
    }
for name in [
    ".env",
    ".runtime/local-ai.json",
    ".runtime/cloud-resources.json",
    ".runtime/cloud-config.json",
    ".runtime/vector-demo.json",
]:
    source = root / name
    if source.exists():
        destination = target / "configuration" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
(target / "manifest.json").write_text(
    json.dumps(
        {
            "sqlite_integrity": "ok",
            "counts": counts,
            "postgres_format": "pg_dump custom",
            "model_weights_copied": False,
            "aws_session_copied": False,
        },
        indent=2,
    ),
    encoding="utf-8",
)
print("SQLite backup integrity passed; local configuration preserved privately.")
