"""Publish root assets/journals/reports virtually; source folders are never relocated."""
from pathlib import Path
import mkdocs_gen_files

ROOT = Path(__file__).resolve().parents[1]

def publish_tree(source, destination):
    for path in sorted((ROOT / source).rglob("*")):
        if not path.is_file() or path.name.startswith("."):
            continue
        target = str(Path(destination) / path.relative_to(ROOT / source)).replace("\\", "/")
        with mkdocs_gen_files.open(target, "wb") as stream:
            stream.write(path.read_bytes())
        if path.suffix == ".md":
            mkdocs_gen_files.set_edit_path(target, path.relative_to(ROOT).as_posix())

publish_tree("assets", "assets")
publish_tree("journals", "journals")
for folder in ("project-proposal", "project-report-prototype-stage", "project-report-final"):
    publish_tree(folder, "academic/" + folder)
