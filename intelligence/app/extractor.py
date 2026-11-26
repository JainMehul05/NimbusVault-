from io import BytesIO
from pathlib import Path
from html.parser import HTMLParser
from zipfile import ZipFile
import json
from charset_normalizer import from_bytes
from .config import settings

TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".css",
    ".sql",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".log",
    ".ini",
    ".c",
    ".cpp",
    ".java",
    ".rs",
    ".go",
    ".sh",
    ".ps1",
    ".html",
    ".htm",
}


class PlainHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def check_archive(data):
    with ZipFile(BytesIO(data)) as archive:
        infos = archive.infolist()
        if len(infos) > 5000 or sum(x.file_size for x in infos) > 75 * 1024 * 1024:
            raise ValueError("Document archive exceeds safe decompression limits")


def extract(name: str, data: bytes):
    ext = Path(name).suffix.lower()
    sections = []
    if ext in TEXT_EXTENSIONS:
        detected = from_bytes(data).best()
        text = str(detected) if detected is not None else data.decode("utf-8", errors="replace")
        if ext == ".json":
            text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        if ext in {".html", ".htm"}:
            parser = PlainHTML()
            parser.feed(text)
            text = " ".join(parser.parts)
        sections = [("Content", text)]
    elif ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(data), strict=False)
        if reader.is_encrypted:
            raise ValueError("Password-protected PDF: upload an unlocked copy")
        if len(reader.pages) > 500:
            raise ValueError("PDF exceeds 500-page extraction limit")
        for i, page in enumerate(reader.pages):
            sections.append((f"Page {i + 1}", page.extract_text() or ""))
            if sum(len(t) for _, t in sections) > settings.max_extracted_chars:
                raise ValueError("Extracted text exceeds the configured limit")
    elif ext == ".docx":
        from docx import Document

        check_archive(data)
        doc = Document(BytesIO(data))
        text = "\n".join(p.text for p in doc.paragraphs)
        text += "\n" + "\n".join(
            " | ".join(c.text for c in r.cells) for table in doc.tables for r in table.rows
        )
        sections = [("Document", text)]
    elif ext == ".xlsx":
        from openpyxl import load_workbook

        check_archive(data)
        workbook = load_workbook(BytesIO(data), read_only=True, data_only=True)
        try:
            total = 0
            for sheet in workbook:
                lines = []
                for number, row in enumerate(sheet.iter_rows(values_only=True)):
                    if number >= 50000:
                        raise ValueError("Spreadsheet exceeds 50,000 rows per sheet")
                    line = " | ".join(str(v) for v in row if v is not None)
                    total += len(line)
                    if total > settings.max_extracted_chars:
                        raise ValueError("Extracted text exceeds limit")
                    lines.append(line)
                sections.append((sheet.title, "\n".join(lines)))
        finally:
            workbook.close()
    else:
        return None
    if sum(len(t) for _, t in sections) > settings.max_extracted_chars:
        raise ValueError("Extracted text exceeds configured limit; split the document")
    return [(label, text.replace("\x00", "").strip()) for label, text in sections if text.strip()]
