from io import BytesIO
import hashlib
import numpy as np
import pytest
from fastapi.testclient import TestClient
from botocore.exceptions import ClientError
from app.config import settings, Settings
from app.database import connect, initialize
from app.extractor import extract, check_archive
from app.security import safe_filename
from app.embeddings import engine
from app.main import app
from app import storage


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Load the real cached model before redirecting application data to test isolation.
    engine.load()
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    objects = {}

    def put(key, data, mime, file_id):
        objects[key] = data

    monkeypatch.setattr(storage, "upload", put)
    monkeypatch.setattr(storage, "read", lambda key: objects[key])
    monkeypatch.setattr(storage, "delete", lambda key: objects.pop(key, None))
    with TestClient(app) as c:
        yield c, objects


@pytest.mark.parametrize(
    "name,expected",
    [
        ("..\\x.txt", "x.txt"),
        ("/etc/a.txt", "a.txt"),
        ("bad<script>.txt", "bad_script_.txt"),
        ("研究.txt", "研究.txt"),
    ],
)
def test_names(name, expected):
    assert safe_filename(name) == expected


def test_invalid_name():
    with pytest.raises(ValueError):
        safe_filename("..")


def test_config():
    with pytest.raises(ValueError):
        Settings(aws_region="us-east-1")
    with pytest.raises(ValueError):
        Settings(s3_object_prefix="unrelated/")


def test_local_navigation_and_cross_site_mutations(client):
    c, _ = client
    assert c.get("/api/health", headers={"sec-fetch-site": "cross-site"}).status_code == 200
    assert (
        c.post("/api/import-test-object", headers={"sec-fetch-site": "cross-site"}).status_code
        == 403
    )


@pytest.mark.parametrize(
    "name,data,expected",
    [
        ("a.txt", "Unicode café".encode(), "café"),
        ("a.csv", b"name,value\nsolar,12", "solar"),
        ("a.json", b'{"topic":"cloud"}', "cloud"),
        ("a.py", b'print("hello")', "hello"),
        ("a.md", b"# Title", "Title"),
        ("a.html", b"<script>evil()</script><h1>Safe</h1>", "Safe"),
    ],
)
def test_text_extract(name, data, expected):
    sections = extract(name, data)
    assert expected in sections[0][1]
    if name.endswith(".html"):
        assert "evil" not in sections[0][1]


def test_formats():
    from docx import Document
    from openpyxl import Workbook
    from pypdf import PdfWriter

    doc = Document()
    doc.add_paragraph("Document content")
    doc.add_table(rows=1, cols=1).cell(0, 0).text = "Table content"
    b = BytesIO()
    doc.save(b)
    assert "Table content" in extract("a.docx", b.getvalue())[0][1]
    workbook = Workbook()
    workbook.active.append(["Solar", "power"])
    b = BytesIO()
    workbook.save(b)
    assert "Solar" in extract("a.xlsx", b.getvalue())[0][1]
    pdf = PdfWriter()
    pdf.add_blank_page(width=100, height=100)
    b = BytesIO()
    pdf.write(b)
    assert extract("scan.pdf", b.getvalue()) == []
    pdf.encrypt("secret")
    b = BytesIO()
    pdf.write(b)
    with pytest.raises(ValueError, match="Password"):
        extract("locked.pdf", b.getvalue())
    with pytest.raises(Exception):
        extract("corrupt.pdf", b"broken pdf")
    assert extract("x.bin", b"\x00\x01") is None
    assert extract("empty.txt", b"") == []
    with pytest.raises(Exception):
        extract("broken.json", b"{")


def test_zip_bomb_limit():
    from zipfile import ZipFile, ZIP_DEFLATED

    data = BytesIO()
    with ZipFile(data, "w", ZIP_DEFLATED) as z:
        z.writestr("huge", b"a" * (76 * 1024 * 1024))
    with pytest.raises(ValueError):
        check_archive(data.getvalue())


def test_real_model():
    vectors = engine.encode(
        [
            "A child is learning from examples.",
            "An algorithm learns from training observations.",
            "Wind turbines generate electricity.",
        ]
    )
    assert vectors.shape == (3, 384)
    np.testing.assert_allclose(np.linalg.norm(vectors, axis=1), 1, atol=1e-5)
    assert vectors[0] @ vectors[1] > vectors[0] @ vectors[2]
    chunks = engine.chunks(
        [("Page 1", "A cloud document contains important storage information. " * 150)]
    )
    assert len(chunks) > 1
    assert all(
        len(engine.load().tokenizer.encode(t)) <= engine.load().max_seq_length for _, t in chunks
    )
    assert all(section == "Page 1" for section, _ in chunks)


def test_workflow(client):
    c, objects = client
    original = b"Amazon S3 provides scalable object storage and remotely managed infrastructure."
    r = c.post("/api/files/upload", files={"file": ("storage.txt", original, "text/plain")})
    assert r.status_code == 201, r.text
    f = c.get("/api/files").json()["items"][0]
    assert f["status"] == "indexed"
    assert objects[f["object_key"]] == original
    assert f["sha256"] == hashlib.sha256(original).hexdigest()
    assert c.get("/api/files/" + f["id"] + "/download").content == original
    assert c.get("/api/files/" + f["id"] + "/preview").json()["text"].startswith("Amazon")
    for mode, query in [
        ("keyword", "REMOTELY MANAGED"),
        ("semantic", "Where can I store my digital files online?"),
        ("hybrid", "object storage"),
        ("filename", "storage"),
    ]:
        result = c.get("/api/search", params={"q": query, "mode": mode}).json()
        assert result["results"][0]["file"]["id"] == f["id"], result
    assert (
        c.get("/api/search", params={"q": "nonexistentphrase", "mode": "keyword"}).json()["total"]
        == 0
    )
    assert c.patch("/api/files/" + f["id"], json={"name": "renamed.txt"}).status_code == 200
    assert c.get("/api/search", params={"q": "renamed", "mode": "filename"}).json()["total"] == 1
    assert c.get("/api/files", params={"extension": ".pdf"}).json()["total"] == 0
    initialize()
    assert (
        c.get("/api/search", params={"q": "remotely managed", "mode": "keyword"}).json()["total"]
        == 1
    )
    assert c.delete("/api/files/" + f["id"]).status_code == 400
    assert c.delete("/api/files/" + f["id"] + "?confirm=true").status_code == 200
    assert not objects
    with connect() as db:
        assert db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 0


def test_failures(client, monkeypatch):
    c, objects = client
    for name, data, status in [
        ("empty.txt", b"", "empty"),
        ("binary.bin", b"\x00\x01", "unsupported"),
        ("bad.pdf", b"broken", "failed"),
    ]:
        assert c.post("/api/files/upload", files={"file": (name, data)}).status_code == 201
        f = next(x for x in c.get("/api/files").json()["items"] if x["name"] == name)
        assert f["status"] == status
        assert f["object_key"] in objects
    assert c.get("/api/files/nope").status_code == 404
    assert c.get("/api/search", params={"q": "   "}).status_code == 400
    assert c.get("/api/search", params={"q": "x", "mode": "unknown"}).status_code == 422
    assert c.get("/api/search", params={"q": "x" * 1001}).status_code == 422
    assert (
        c.post(
            "/api/files/upload",
            headers={"Origin": "https://evil.example"},
            files={"file": ("x", b"x")},
        ).status_code
        == 403
    )
    assert c.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    assert (
        c.post("/api/files/upload", files={"file": ("large", b"x" * (1048576 + 1))}).status_code
        == 413
    )

    def denied(*args):
        raise ClientError({"Error": {"Code": "AccessDenied", "Message": "secret"}}, "PutObject")

    monkeypatch.setattr(storage, "upload", denied)
    r = c.post("/api/files/upload", files={"file": ("denied.txt", b"test")})
    assert r.status_code == 503
    assert "secret" not in r.text
    assert (
        next(x for x in c.get("/api/files").json()["items"] if x["name"] == "denied.txt")["status"]
        == "upload_failed"
    )


def test_duplicates_and_pagination(client):
    c, _ = client
    for _ in range(2):
        c.post("/api/files/upload", files={"file": ("duplicate.txt", b"cloud storage")})
    result = c.get("/api/files", params={"page_size": 1, "page": 2}).json()
    assert result["total"] == 2 and len(result["items"]) == 1
    all_files = c.get("/api/files").json()["items"]
    assert len({f["object_key"] for f in all_files}) == 2


def test_model_mismatch(client):
    c, _ = client
    c.post("/api/files/upload", files={"file": ("x.txt", b"cloud storage")})
    with connect() as db:
        db.execute("UPDATE chunks SET model='different'")
    assert c.get("/api/search", params={"q": "cloud storage"}).json()["total"] == 0
    assert c.get("/api/search", params={"q": "cloud", "mode": "keyword"}).json()["total"] == 1


def test_reindex_and_protected_import(client):
    c, objects = client
    objects["cloudvault-test.txt"] = b"CloudVault supports intelligent cloud storage."
    r = c.post("/api/import-test-object")
    assert r.status_code == 201
    file_id = r.json()["id"]
    assert c.post("/api/import-test-object").json()["id"] == file_id
    assert c.delete("/api/files/" + file_id + "?confirm=true").status_code == 403
    assert c.post("/api/files/" + file_id + "/reindex").status_code == 202
    assert c.get("/api/files/" + file_id).json()["status"] == "indexed"
    assert c.get("/api/files").json()["total"] == 1


def test_index_model_failure_retains_original(client, monkeypatch):
    c, objects = client

    def fail(*args):
        raise RuntimeError("sensitive model failure details")

    monkeypatch.setattr(engine, "chunks", fail)
    assert (
        c.post(
            "/api/files/upload", files={"file": ("failure.txt", b"An original document")}
        ).status_code
        == 201
    )
    record = c.get("/api/files").json()["items"][0]
    assert record["status"] == "failed"
    assert "sensitive" not in record["error"]
    assert c.get("/api/files/" + record["id"] + "/download").content == b"An original document"
    assert record["object_key"] in objects


def test_read_failure_and_cloud_stats(client, monkeypatch):
    c, _ = client
    record = c.post("/api/files/upload", files={"file": ("cloud.txt", b"Cloud original")}).json()

    def missing(*args):
        raise ClientError(
            {"Error": {"Code": "NoSuchKey", "Message": "private detail"}}, "GetObject"
        )

    monkeypatch.setattr(storage, "read", missing)
    assert c.get("/api/files/" + record["id"] + "/download").status_code == 404
    assert c.get("/api/files/" + record["id"]).status_code == 200
    with connect() as db:
        db.execute("UPDATE files SET status='upload_failed'")
    assert c.get("/api/stats").json()["total_bytes"] == 0


def test_s3_adapter_safety(monkeypatch):
    calls = []

    class FakeS3:
        def put_object(self, **kwargs):
            calls.append(kwargs)

    monkeypatch.setattr(storage, "s3", lambda: FakeS3())
    storage.upload("cloudvault/files/id/file.txt", b"original", "text/plain", "id")
    assert calls[0]["ServerSideEncryption"] == "AES256"
    assert calls[0]["IfNoneMatch"] == "*"
    assert "ACL" not in calls[0]
    with pytest.raises(ValueError):
        storage.delete("unrelated/object.txt")
