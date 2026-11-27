import re
import unicodedata
from pathlib import PurePosixPath


def safe_filename(value: str) -> str:
    name = unicodedata.normalize("NFC", value.replace("\\", "/")).split("/")[-1]
    name = re.sub(r'[\x00-\x1f\x7f<>:"|?*]', "_", name).strip(" .")
    if not name or name in {".", ".."}:
        raise ValueError("A valid filename is required")
    suffix = PurePosixPath(name).suffix[:20]
    return name[: 180 - len(suffix)] + suffix if len(name) > 180 else name
