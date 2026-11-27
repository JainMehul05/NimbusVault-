"""Read-only checks for the UCS503P source layout and exact academic recovery."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = ("assets", "code", "docs", "journals", "project-proposal",
            "project-report-prototype-stage", "project-report-final", ".github/workflows")
for name in REQUIRED:
    path = ROOT / name
    assert path.is_dir() and any(p.is_file() for p in path.rglob("*")), name
for name in ("backend", "frontend", "intelligence", "deployment", "scripts", "infra"):
    assert not (ROOT / name).exists(), "Duplicate application at root: " + name
    assert (ROOT / "code" / name).is_dir(), name
protected = json.loads((ROOT / "docs/protected-academic-trees.json").read_text(encoding="utf-8"))
for name, expected in protected["directories"].items():
    actual = subprocess.check_output(["git", "rev-parse", "HEAD:" + name], cwd=ROOT).decode().strip()
    assert actual == expected, "Protected academic tree changed: " + name
for name in ("Start NimbusVault.bat", "Stop NimbusVault.bat", "Start NimbusVault AWS.bat",
             "Stop NimbusVault AWS.bat", "NimbusVault Status.bat"):
    assert (ROOT / "code" / name).is_file(), name
files = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
allowed_roots = set(REQUIRED) - {".github/workflows"}
allowed_roots.update((".github", ".gitattributes", ".gitignore", "LICENSE", "LICENSE.template", "Makefile", "README.md", "mkdocs.yml", "pyproject.toml", "uv.lock"))
for migration in ("0_init", "20261123000000_security_fixes_and_ai_documents", "20261125000000_phase5_hardening"):
    assert "code/backend/prisma/migrations/" + migration + "/migration.sql" in files, "Missing tracked Prisma migration: " + migration
index_modes = {line.split("\t", 1)[1]: line.split()[0] for line in subprocess.check_output(["git", "ls-files", "--stage"], cwd=ROOT).decode().splitlines()}
for executable in ("scripts/localstack-init.sh", "scripts/smoke-test.sh", "infra/scripts/bootstrap.sh", "infra/scripts/common.sh", "infra/scripts/deploy.sh", "infra/scripts/push-image.sh", "infra/scripts/teardown.sh", "infra/scripts/verify.sh"):
    assert index_modes.get("code/" + executable) == "100755", "Executable mode lost: " + executable
for name in filter(None, files):
    assert name.split("/")[0] in allowed_roots, "Unexpected root item: " + name
    path = Path(name)
    assert not any(p in path.parts for p in ("node_modules", ".venv", ".runtime", ".private-backup")), name
    assert path.suffix.lower() not in (".gguf", ".safetensors", ".exe", ".dll", ".db", ".sqlite", ".lnk"), name
    assert not (path.name.startswith(".env") and not path.name.endswith(".example")), name
print("PASS: required university folders, single code tree, owner-managed academic tree IDs, launchers and tracked-file exclusions")
