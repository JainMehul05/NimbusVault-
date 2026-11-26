"""Source-only preservation helper. Never imports or overwrites integration code."""

from pathlib import Path
import argparse
import json
import sqlite3
import subprocess
import zipfile
from datetime import datetime, timezone

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True, type=Path)
args = parser.parse_args()
source = args.source.resolve()
root = Path(__file__).resolve().parents[1]
backup = (
    root / ".private-backup" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
)
backup.mkdir(parents=True, exist_ok=False)
tracked = (
    subprocess.check_output(["git", "-C", str(source), "ls-files", "-z"])
    .decode()
    .split("\0")
)
with zipfile.ZipFile(backup / "source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for name in filter(None, tracked):
        path = source / name
        if path.is_file():
            archive.write(path, name)
database = source / "CloudVault/data/cloudvault.db"
if database.exists():
    with (
        sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as original,
        sqlite3.connect(backup / "cloudvault.db") as target,
    ):
        original.backup(target)
        assert target.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
(backup / "manifest.json").write_text(
    json.dumps(
        {
            "source_commit": subprocess.check_output(
                ["git", "-C", str(source), "rev-parse", "HEAD"]
            )
            .decode()
            .strip(),
            "integrity_check": "ok",
        },
        indent=2,
    ),
    encoding="utf-8",
)
print(
    "Private source and consistent SQLite backup created. Set owner-only permissions on the backup directory."
)
