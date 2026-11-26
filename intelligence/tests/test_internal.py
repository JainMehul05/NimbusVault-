"""Private adapter tests with real local embeddings; no AWS operations."""

import base64
import hashlib
import json
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app.config import settings
from app.embeddings import engine
from app.internal import app
from app import cloud, cost_guard


@pytest.fixture
def private(tmp_path, monkeypatch):
    engine.load()
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "test-private-service-token-32-characters-minimum")
    monkeypatch.setenv("NIMBUS_LOCAL_RETRIEVAL", "true")
    monkeypatch.setenv("AWS_OPERATIONS_ENABLED", "false")

    def forbidden():
        raise AssertionError("Local retrieval must not check AWS billing or call AWS")

    monkeypatch.setattr(cost_guard, "billing_client", forbidden)
    monkeypatch.setattr(cloud, "client", lambda *_: forbidden())
    actor = str(uuid4())
    headers = {
        "x-service-token": "test-private-service-token-32-characters-minimum",
        "x-actor-id": actor,
    }
    with TestClient(app) as client:
        yield client, headers


def add(client, headers, text, name="policy.txt"):
    key = str(uuid4())
    raw = text.encode()
    response = client.post(
        "/index",
        headers=headers,
        json={
            "file_id": key,
            "filename": name,
            "object_key": f"cloudvault/files/{key}/{name}",
            "sha256": hashlib.sha256(raw).hexdigest(),
            "mime": "text/plain",
            "content": base64.b64encode(raw).decode(),
        },
    )
    assert response.status_code == 200, response.text
    return key


def test_internal_requires_service_auth(private):
    client, _ = private
    assert client.get("/health").status_code == 401
    assert client.post("/api/ai/search", json={"query": "secret"}).status_code == 401


def test_forged_actor_rejected(private):
    client, h = private
    assert (
        client.post(
            "/api/ai/search", headers={**h, "x-actor-id": "forged"}, json={"query": "policy"}
        ).status_code
        == 400
    )


def test_scoped_real_semantic_and_empty_scope(private):
    client, h = private
    a = add(
        client,
        h,
        "Project Aurora uses solar panels to generate renewable electricity. Its annual energy target is 73 megawatt hours.",
        "solar.txt",
    )
    b = add(
        client,
        h,
        "Project Borealis stores a secret synthetic number of 914 purple balloons.",
        "private.txt",
    )
    for mode in ["semantic", "hybrid", "exact", "filename"]:
        query = {
            "semantic": "clean power produced from sunlight",
            "hybrid": "renewable electricity",
            "exact": "solar panels",
            "filename": "solar",
        }[mode]
        r = client.post(
            "/api/ai/search",
            headers={**h, "x-file-scope": json.dumps([a])},
            json={"query": query, "mode": mode},
        ).json()
        assert r["sources"] and {s["file_id"] for s in r["sources"]} == {a}
        assert b not in json.dumps(r) and r["retrieval_backend"]["aws_calls"] == 0
    empty = client.post(
        "/api/ai/search", headers={**h, "x-file-scope": "[]"}, json={"query": "purple balloons"}
    ).json()
    assert empty["sources"] == []


def test_history_actor_and_revocation(private):
    client, h = private
    a = add(
        client,
        h,
        "Aurora uses solar panels to generate renewable electricity. The energy target is 73 megawatt hours.",
    )
    scoped = {**h, "x-file-scope": json.dumps([a])}
    result = client.post(
        "/api/ai/ask",
        headers=scoped,
        json={"question": "What is the energy target?", "extractive": True},
    ).json()
    assert result["mode"] == "extractive" and result["sources"][0]["file_id"] == a
    cid = result["conversation_id"]
    assert client.get("/api/ai/conversations/" + cid, headers=scoped).status_code == 200
    assert (
        client.get(
            "/api/ai/conversations/" + cid, headers={**scoped, "x-actor-id": str(uuid4())}
        ).status_code
        == 404
    )
    assert (
        client.get("/api/ai/conversations/" + cid, headers={**h, "x-file-scope": "[]"}).status_code
        == 404
    )
    assert (
        client.post(
            "/api/ai/ask",
            headers={**h, "x-file-scope": "[]"},
            json={"question": "Tell me more", "conversation_id": cid},
        ).json()["sources"]
        == []
    )


def test_unapproved_cloud_and_integrity_fail_closed(private):
    client, h = private
    assert (
        client.post(
            "/storage",
            headers=h,
            json={"operation": "put", "key": "cloudvault/files/test.txt", "content": "eA=="},
        ).status_code
        == 503
    )
    assert (
        client.post(
            "/index",
            headers=h,
            json={
                "file_id": str(uuid4()),
                "filename": "a.txt",
                "object_key": "x",
                "sha256": "bad",
                "mime": "text/plain",
                "content": "eA==",
            },
        ).status_code
        == 409
    )


def test_real_local_qwen_grounding(private):
    from pathlib import Path

    client, h = private
    a = add(
        client,
        h,
        "Project Aurora generates renewable electricity using solar panels. Its annual energy target is 73 megawatt hours.",
        "aurora.txt",
    )
    scoped = {**h, "x-file-scope": json.dumps([a])}
    response = client.post(
        "/api/ai/ask",
        headers=scoped,
        json={
            "question": "What is the annual energy target for Project Aurora?",
            "request_id": str(uuid4()),
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    destination = Path(__file__).resolve().parents[2] / ".runtime/local-qwen-acceptance.json"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(result, indent=2), encoding="utf-8")
    assert result["mode"] == "generated", result
    assert result["model"] == "qwen2.5:3b"
    assert "73" in result["answer"]
    assert result["claims"] and all(c["quotes"] for c in result["claims"])
