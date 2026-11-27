"""Publish root assets/journals/reports virtually; source folders are never relocated."""
from pathlib import Path
import subprocess
import mkdocs_gen_files

ROOT = Path(__file__).resolve().parents[2]

def publish_tree(source, destination):
    # Never export ignored build environments, raw captures or private working files.
    names = subprocess.check_output(["git", "ls-files", "-z", "--", source], cwd=ROOT).decode().split("\0")
    for name in sorted(filter(None, names)):
        path = ROOT / name
        if not path.is_file() or path.name.startswith("."):
            continue
        if path.is_symlink() or path.is_junction() or not path.resolve().is_relative_to(ROOT.resolve()):
            raise RuntimeError("Documentation source must be a normal in-repository file: " + name)
        target = str(Path(destination) / path.relative_to(ROOT / source)).replace("\\", "/")
        with mkdocs_gen_files.open(target, "wb") as stream:
            stream.write(path.read_bytes())
        if path.suffix == ".md":
            mkdocs_gen_files.set_edit_path(target, path.relative_to(ROOT).as_posix())

publish_tree("assets", "assets")
publish_tree("journals", "journals")
for folder in ("project-proposal", "project-report-prototype-stage", "project-report-final"):
    publish_tree(folder, "academic/" + folder)
