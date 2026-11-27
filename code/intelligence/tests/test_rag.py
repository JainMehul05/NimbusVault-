import hashlib
import pytest
from test_core import client as client
from app.database import connect, initialize
from app.config import Settings
from app.retrieval import retrieve
from app import llm
from app.llm import GroundedAnswer, Claim
from app.rag import validate_claims


def upload(c, name, text):
    response = c.post("/api/files/upload", files={"file": (name, text.encode(), "text/plain")})
    assert response.status_code == 201, response.text
    return c.get("/api/files/" + response.json()["id"]).json()


def corpus(c):
    return [
        upload(
            c,
            "security.txt",
            "Network security protects information from intruders. Firewalls filter malicious traffic and multifactor authentication reduces stolen-password risk.",
        ),
        upload(
            c,
            "encryption.txt",
            "Encryption transforms readable information into ciphertext. TLS protects data in transit and AES protects data at rest. Key management and rotation are essential controls.",
        ),
        upload(
            c,
            "energy.txt",
            "Renewable energy uses sunlight and wind to generate electricity. Solar panels reduce dependence on fossil fuels.",
        ),
    ]


async def available():
    return {"available": True, "reason": None}


async def unavailable():
    return {"available": False, "reason": "Runtime unavailable in this test"}


def test_diverse_scoped_evidence(client):
    c, _ = client
    files = corpus(c)
    sources, coverage = retrieve(
        "How can we protect information with encryption and network security?"
    )
    assert {files[0]["id"], files[1]["id"]} <= {s["file_id"] for s in sources}
    assert coverage["context_characters"] <= 10000
    assert len({s["chunk_id"] for s in sources}) == len(sources)
    sources, _ = retrieve("How does encryption protect information?", [files[1]["id"]])
    assert sources and all(s["file_id"] == files[1]["id"] for s in sources)


def test_citation_validation():
    sources = [
        {"citation": 1, "passage": "TLS protects data in transit. AES protects data at rest."}
    ]
    good = GroundedAnswer(
        insufficient=False,
        claims=[
            Claim(
                text="TLS protects transmission.",
                sources=[1],
                quotes=["TLS protects data in transit."],
            )
        ],
    )
    assert len(validate_claims(good, sources)) == 1
    for claim in [
        Claim(
            text="TLS and AES protect data at rest and in transit, respectively.",
            sources=[1],
            quotes=["TLS protects data in transit. AES protects data at rest."],
        ),
        Claim(
            text="TLS encrypts data in transit, protecting it from eavesdropping and man-in-the-middle attacks.",
            sources=[1],
            quotes=["TLS protects data in transit."],
        ),
        Claim(
            text="TLS protects data in transit with 100 percent guaranteed security.",
            sources=[1],
            quotes=["TLS protects data in transit."],
        ),
        Claim(
            text="Farmers grow vegetables using sunlight.",
            sources=[1],
            quotes=["TLS protects data in transit."],
        ),
        Claim(text="Fabrication.", sources=[99], quotes=["TLS protects data in transit."]),
        Claim(text="Unsupported claim.", sources=[1], quotes=["A made up quotation"]),
        Claim(
            text="Visit https://evil.example", sources=[1], quotes=["TLS protects data in transit."]
        ),
    ]:
        assert validate_claims(GroundedAnswer(insufficient=False, claims=[claim]), sources) == []


def test_generated_answer_and_history(client, monkeypatch):
    c, _ = client
    files = corpus(c)
    monkeypatch.setattr(llm, "status", available)

    async def generate(question, sources):
        selected = [s for s in sources if s["file_id"] in {files[0]["id"], files[1]["id"]}]
        return GroundedAnswer(
            insufficient=False,
            claims=[
                Claim(
                    text=s["passage"].split(". ")[0] + ".",
                    sources=[s["citation"]],
                    quotes=[s["passage"].split(". ")[0] + "."],
                )
                for s in selected
            ],
        ), {"eval_count": 20}

    monkeypatch.setattr(llm, "generate", generate)
    response = c.post(
        "/api/ai/ask",
        json={"question": "How can encryption and network security protect information?"},
    )
    assert response.status_code == 200, response.text
    answer = response.json()
    assert answer["mode"] == "generated"
    assert len({s["file_id"] for s in answer["sources"]}) == 2
    conversation_id = answer["conversation_id"]
    follow = c.post(
        "/api/ai/ask",
        json={"question": "What about its protection?", "conversation_id": conversation_id},
    ).json()
    assert "Follow-up" in follow["retrieval_query"]
    assert "network security" in follow["retrieval_query"]
    initialize()
    saved = c.get("/api/ai/conversations/" + conversation_id).json()
    assert len(saved["exchanges"]) == 2
    assert c.get("/api/ai/conversations").json()[0]["id"] == conversation_id
    assert c.delete("/api/ai/conversations/" + conversation_id).status_code == 400
    assert c.delete("/api/ai/conversations/" + conversation_id + "?confirm=true").status_code == 200
    assert c.get("/api/ai/conversations/" + conversation_id).status_code == 404


def test_explicit_fallback_and_no_evidence(client, monkeypatch):
    c, _ = client
    corpus(c)
    monkeypatch.setattr(llm, "status", unavailable)
    answer = c.post(
        "/api/ai/ask", json={"question": "How does encryption protect information?"}
    ).json()
    assert (
        answer["mode"] == "extractive" and answer["sources"] and "not generated" in answer["answer"]
    )
    no = c.post(
        "/api/ai/ask",
        json={"question": "What was the final score of the 1827 lunar baseball championship?"},
    ).json()
    assert no["mode"] == "insufficient", no
    assert not no["claims"]


def test_invalid_generation_falls_back(client, monkeypatch):
    c, _ = client
    corpus(c)
    monkeypatch.setattr(llm, "status", available)
    calls = []

    async def bad(*args):
        calls.append(args[0])
        return GroundedAnswer(
            insufficient=False,
            claims=[
                Claim(
                    text="Invented answer", sources=[88], quotes=["This was never in any document"]
                )
            ],
        ), {}

    monkeypatch.setattr(llm, "generate", bad)
    answer = c.post(
        "/api/ai/ask", json={"question": "How does encryption protect information?"}
    ).json()
    assert answer["mode"] == "extractive"
    assert len(calls) == 2 and "Citation correction" in calls[1]
    assert "validation" in answer["warning"]
    assert all(88 not in claim["citations"] for claim in answer["claims"])


def test_bounded_citation_correction_recovers(client, monkeypatch):
    c, _ = client
    corpus(c)
    monkeypatch.setattr(llm, "status", available)
    calls = []

    async def generate(question, sources):
        calls.append(question)
        source = sources[0]
        quote = source["passage"].split(". ")[0] + "."
        identifier = 99 if len(calls) == 1 else source["citation"]
        return GroundedAnswer(
            insufficient=False,
            claims=[Claim(text=quote, sources=[identifier], quotes=[quote])],
        ), {}

    monkeypatch.setattr(llm, "generate", generate)
    answer = c.post(
        "/api/ai/ask", json={"question": "How does encryption protect information?"}
    ).json()
    assert answer["mode"] == "generated"
    assert len(calls) == 2 and answer["timings"]["correction_attempted"]
    assert all(99 not in claim["citations"] for claim in answer["claims"])


def test_partial_generation_omits_unsupported_claims(client, monkeypatch):
    c, _ = client
    corpus(c)
    monkeypatch.setattr(llm, "status", available)

    async def generate(question, sources):
        source = sources[0]
        quote = source["passage"].split(". ")[0] + "."
        return GroundedAnswer(
            insufficient=False,
            claims=[
                Claim(text=quote, sources=[source["citation"]], quotes=[quote]),
                Claim(text="Unsupported detail", sources=[99], quotes=["Invented quotation"]),
            ],
        ), {}

    monkeypatch.setattr(llm, "generate", generate)
    answer = c.post(
        "/api/ai/ask", json={"question": "How does encryption protect information?"}
    ).json()
    assert answer["mode"] == "generated" and len(answer["claims"]) == 1
    assert "omitted" in answer["warning"]
    assert "Unsupported detail" not in answer["answer"]


def test_scope_validation_and_starred(client, monkeypatch):
    c, _ = client
    files = corpus(c)
    monkeypatch.setattr(llm, "status", unavailable)
    assert c.post("/api/ai/ask", json={"question": "x"}).status_code == 422
    assert (
        c.post(
            "/api/ai/ask", json={"question": "What is encryption?", "file_ids": ["missing"]}
        ).status_code
        == 400
    )
    assert c.patch("/api/files/" + files[0]["id"], json={"starred": True}).status_code == 200
    assert c.get("/api/files?starred=true").json()["items"][0]["id"] == files[0]["id"]
    answer = c.post(
        "/api/ai/ask",
        json={"question": "How does encryption protect information?", "file_ids": [files[1]["id"]]},
    ).json()
    assert all(s["file_id"] == files[1]["id"] for s in answer["sources"])
    assert (
        c.post(
            "/api/ai/ask",
            json={
                "question": "What about security?",
                "conversation_id": answer["conversation_id"],
                "file_ids": [files[0]["id"]],
            },
        ).status_code
        == 409
    )


def test_migration_preserves_bytes(client):
    c, _ = client
    record = upload(c, "before.txt", "Cloud storage preserves original digital documents.")
    with connect() as db:
        before = [
            (r["id"], hashlib.sha256(r["vector"]).hexdigest())
            for r in db.execute("SELECT id,vector FROM chunks")
        ]
        db.execute("ALTER TABLE files DROP COLUMN starred")
        db.execute("PRAGMA user_version=1")
    initialize()
    with connect() as db:
        after = [
            (r["id"], hashlib.sha256(r["vector"]).hexdigest())
            for r in db.execute("SELECT id,vector FROM chunks")
        ]
        assert db.execute("PRAGMA user_version").fetchone()[0] == 3
    assert before == after
    assert c.get("/api/files/" + record["id"]).json()["object_key"] == record["object_key"]
    assert (
        c.get("/api/search", params={"q": "Cloud storage", "mode": "keyword"}).json()["total"] == 1
    )


def test_private_configuration():
    with pytest.raises(ValueError):
        Settings(llm_url="https://remote.example")
    with pytest.raises(ValueError):
        Settings(llm_model="remote:cloud")


def test_cancelled_request_does_not_save_exchange(client):
    from uuid import uuid4

    c, _ = client
    corpus(c)
    request_id = str(uuid4())
    assert c.post("/api/ai/cancel", json={"request_id": request_id}).status_code == 200
    response = c.post(
        "/api/ai/ask",
        json={"question": "How does encryption protect information?", "request_id": request_id},
    )
    assert response.status_code == 499
    assert c.get("/api/ai/conversations").json() == []
    assert c.get("/api/ai/status").json()["busy"] is False


def test_safe_raster_preview(client):
    from io import BytesIO
    from PIL import Image

    c, _ = client
    buffer = BytesIO()
    Image.new("RGB", (10, 10), "blue").save(buffer, format="PNG")
    record = c.post("/api/files/upload", files={"file": ("safe.png", buffer.getvalue())}).json()
    preview = c.get("/api/files/" + record["id"] + "/image")
    assert preview.status_code == 200 and preview.headers["content-type"] == "image/jpeg"
    Image.open(BytesIO(preview.content)).verify()
    bad = c.post(
        "/api/files/upload", files={"file": ("unsafe.svg", b'<svg onload="alert(1)"/>')}
    ).json()
    assert c.get("/api/files/" + bad["id"] + "/image").status_code == 415
