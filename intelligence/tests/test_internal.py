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


def test_reindex_preserves_exact_passage_ids(private):
    from app.database import connect

    client, h = private
    text = "Aurora uses sunlight for renewable electricity."
    key = add(client, h, text)
    with connect() as db:
        before = [r["id"] for r in db.execute("SELECT id FROM chunks WHERE file_id=?", (key,))]
    raw = text.encode()
    payload = {
        "file_id": key,
        "filename": "policy.txt",
        "object_key": f"cloudvault/files/{key}/policy.txt",
        "sha256": hashlib.sha256(raw).hexdigest(),
        "mime": "text/plain",
        "content": base64.b64encode(raw).decode(),
    }
    assert client.post("/index", headers=h, json=payload).status_code == 200
    with connect() as db:
        after = [r["id"] for r in db.execute("SELECT id FROM chunks WHERE file_id=?", (key,))]
    assert before == after
    payload["object_key"] = "cloudvault/files/other/original.txt"
    assert client.post("/index", headers=h, json=payload).status_code == 409


def test_invented_purpose_relationship_is_rejected():
    from app.llm import GroundedAnswer
    from app.rag import validate_claims

    passage = "Project Borealis uses violet balloons. Its synthetic access number is 914."
    result = GroundedAnswer.model_validate(
        {
            "insufficient": False,
            "claims": [
                {
                    "text": "Project Borealis uses violet balloons for its synthetic access number.",
                    "sources": [1],
                    "quotes": [passage],
                }
            ],
        }
    )
    assert validate_claims(result, [{"citation": 1, "passage": passage}]) == []


def test_real_qwen_conflicting_policies(private):
    from pathlib import Path

    client, h = private
    a = add(
        client,
        h,
        "Policy North retains audit logs for 30 days. This is the North policy.",
        "north.txt",
    )
    b = add(
        client,
        h,
        "Policy South retains audit logs for 90 days. This is the South policy.",
        "south.txt",
    )
    scoped = {**h, "x-file-scope": json.dumps([a, b])}
    response = client.post(
        "/api/ai/ask",
        headers=scoped,
        json={
            "question": "Compare the audit-log retention periods in Policy North and Policy South.",
            "request_id": str(uuid4()),
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    (
        Path(__file__).resolve().parents[2] / ".runtime/conflicting-policies-acceptance.json"
    ).write_text(json.dumps(result, indent=2), encoding="utf-8")
    assert result["mode"] == "generated", result
    assert "30" in result["answer"] and "90" in result["answer"]
    assert {source["file_id"] for source in result["sources"]} == {a, b}


def test_multitopic_retrieval_covers_each_authorized_intent(private):
    client, h = private
    a = add(
        client,
        h,
        "Original documents are stored privately in Amazon S3. MiniLM embeddings and Qwen answer generation run on the local laptop.",
        "processing.txt",
    )
    b = add(
        client,
        h,
        "Project Borealis uses violet balloons. Its synthetic access number is 914.",
        "borealis.txt",
    )
    response = client.post(
        "/api/ai/search",
        headers={**h, "x-file-scope": json.dumps([a, b])},
        json={
            "query": "Explain local MiniLM/Qwen processing and the Borealis synthetic access number.",
            "mode": "hybrid",
        },
    )
    assert response.status_code == 200, response.text
    assert {s["file_id"] for s in response.json()["sources"]} == {a, b}
    assert response.json()["retrieval_backend"]["aws_calls"] == 0


def test_exact_unique_quote_can_align_known_source_label():
    from app.llm import GroundedAnswer
    from app.rag import align_citations

    passages = [
        {"citation": 1, "passage": "Policy North retains logs for 30 days."},
        {"citation": 2, "passage": "Policy South retains logs for 90 days."},
    ]
    answer = GroundedAnswer.model_validate(
        {
            "insufficient": False,
            "claims": [
                {
                    "text": "Policy South retains logs for 90 days.",
                    "sources": [1],
                    "quotes": ["Policy South retains logs for 90 days."],
                }
            ],
        }
    )
    aligned, count = align_citations(answer, passages)
    assert count == 1 and aligned.claims[0].sources == [2]
    answer.claims[0].sources = [99]
    aligned, count = align_citations(answer, passages)
    assert count == 0 and aligned.claims[0].sources == [99]


def test_filename_search_uses_current_trusted_names_within_scope(private):
    client, h = private
    own = add(client, h, "Authorized policy text.", "old-name.txt")
    other = add(client, h, "Other account private policy.", "renamed-policy.txt")
    scoped = {**h, "x-file-scope": json.dumps([own])}
    response = client.post(
        "/api/ai/search",
        headers=scoped,
        json={
            "query": "renamed",
            "mode": "filename",
            "filenames": {own: "renamed-policy.txt", other: "renamed-policy.txt"},
        },
    )
    assert response.status_code == 200
    assert {row["file_id"] for row in response.json()["sources"]} == {own}
    response = client.post(
        "/api/ai/search",
        headers=scoped,
        json={"query": "old-name", "mode": "filename", "filenames": {own: "renamed-policy.txt"}},
    )
    assert response.json()["sources"] == []


def test_original_short_model_keyword_query_is_recovered(private):
    from pathlib import Path

    client, h = private
    text = (Path(__file__).resolve().parents[2] / "samples/cloud-stage-canary.txt").read_text()
    key = add(client, h, text, "approved-canary.txt")
    response = client.post(
        "/api/ai/search",
        headers={**h, "x-file-scope": json.dumps([key])},
        json={"query": "MiniLM Qwen local laptop", "mode": "hybrid"},
    )
    assert response.status_code == 200
    assert {row["file_id"] for row in response.json()["sources"]} == {key}


def test_distinct_claims_from_same_quote_are_not_discarded():
    from app.rag import merge_verified_claims

    quote = "Evacuate to the western assembly point and contact coordinator Laila Chen."
    one = {"text": "The assembly point is western.", "citations": [1], "quotes": [quote]}
    two = {"text": "The coordinator is Laila Chen.", "citations": [1], "quotes": [quote]}
    assert merge_verified_claims([one], [two, one]) == [one, two]


def test_changed_security_trigger_is_rejected():
    from app.rag import validate_claims
    from app.llm import GroundedAnswer

    quote = "Reusing an old refresh token revokes its token family."
    answer = GroundedAnswer.model_validate(
        {
            "insufficient": False,
            "claims": [
                {
                    "text": "Revoking an old refresh token revokes its token family.",
                    "sources": [1],
                    "quotes": [quote],
                }
            ],
        }
    )
    assert validate_claims(answer, [{"citation": 1, "passage": quote}]) == []


def test_source_validation_handles_plural_and_adverb_inflections(private):
    from app.rag import validate_claims
    from app.llm import GroundedAnswer

    quote = "Its annual renewable energy target is 73 megawatt hours."
    answer = GroundedAnswer.model_validate(
        {
            "insufficient": False,
            "claims": [
                {
                    "text": "Project Aurora targets 73 megawatt hours of renewable energy annually.",
                    "sources": [1],
                    "quotes": [quote],
                }
            ],
        }
    )
    assert len(validate_claims(answer, [{"citation": 1, "passage": quote}])) == 1
    answer.claims[0].text = "Project Aurora targets 99 megawatt hours of renewable energy annually."
    assert validate_claims(answer, [{"citation": 1, "passage": quote}]) == []


def test_unstated_security_purpose_is_rejected(private):
    from app.rag import validate_claims
    from app.llm import GroundedAnswer

    quote = "Logout immediately revokes the active session."
    answer = GroundedAnswer.model_validate(
        {
            "insufficient": False,
            "claims": [
                {
                    "text": "Logout immediately revokes the active session to secure user accounts.",
                    "sources": [1],
                    "quotes": [quote],
                }
            ],
        }
    )
    assert validate_claims(answer, [{"citation": 1, "passage": quote}]) == []


def test_explicit_complementary_topics_require_coverage():
    from app.rag import missing_requested_coverage

    sources = [
        {
            "citation": 1,
            "file_id": "one",
            "passage": "MiniLM embeddings and Qwen generation run on the local laptop.",
        },
        {
            "citation": 2,
            "file_id": "two",
            "passage": "The Borealis synthetic access number is 914.",
        },
    ]
    one = {"text": "MiniLM runs locally.", "citations": [1], "quotes": [sources[0]["passage"]]}
    two = {
        "text": "The Borealis access number is 914.",
        "citations": [2],
        "quotes": [sources[1]["passage"]],
    }
    question = "Explain local MiniLM/Qwen processing and the Borealis synthetic access number."
    assert missing_requested_coverage(question, sources, [one])
    assert not missing_requested_coverage(question, sources, [one, two])


def test_exact_technical_identifier_can_rescue_hybrid_but_not_escape_scope(private):
    client, h = private
    own = add(client, h, "The error code NV-409 indicates a revision conflict.", "errors.txt")
    add(client, h, "The error code NV-999 is private.", "private-errors.txt")
    scoped = {**h, "x-file-scope": json.dumps([own])}
    found = client.post(
        "/api/ai/search", headers=scoped, json={"query": "NV-409", "mode": "hybrid"}
    )
    assert {s["file_id"] for s in found.json()["sources"]} == {own}
    denied = client.post(
        "/api/ai/search", headers=scoped, json={"query": "NV-999", "mode": "exact"}
    )
    assert denied.json()["sources"] == []


def test_query_facet_separates_a_named_topic_from_requested_property():
    from app.retrieval import query_facet

    assert "budget" in query_facet(
        "What is the confidential Juniper budget?", "Release Juniper is due in April."
    )
    assert "address" in query_facet(
        "What is Project Orion's mailing address?", "Project Orion uses solar power."
    )
    assert query_facet("solar electricity", "Panels generate electricity.") is None


def test_ask_scope_contract_matches_header_limit():
    from app.rag import Ask

    assert (
        len(
            Ask(question="What is supported?", file_ids=[str(uuid4()) for _ in range(250)]).file_ids
        )
        == 250
    )
    with pytest.raises(ValueError):
        Ask(question="What is supported?", file_ids=[str(uuid4()) for _ in range(251)])


def test_bm25_works_without_loading_or_querying_the_embedding_model(private, monkeypatch):
    client, h = private
    key = add(client, h, "Runbook identifier TX-713 means journal recovery.", "runbook.txt")

    def forbidden(*args, **kwargs):
        raise AssertionError("BM25 must not require dense embeddings")

    monkeypatch.setattr(engine, "encode", forbidden)
    monkeypatch.setattr(engine, "load", forbidden)
    response = client.post(
        "/api/ai/search",
        headers={**h, "x-file-scope": json.dumps([key])},
        json={"query": "TX-713", "mode": "lexical"},
    )
    assert response.status_code == 200
    assert {s["file_id"] for s in response.json()["sources"]} == {key}
    assert response.json()["sources"][0]["score_kind"] == "lexical"


def test_pure_semantic_does_not_accept_a_lexical_rescue(private, monkeypatch):
    import numpy as np
    from app import retrieval

    client, h = private
    key = add(client, h, "Quasar astrolabe wheels copper measurements.", "measurements.txt")
    other = add(client, h, "Binary files rest on a shelf.", "other.txt")
    monkeypatch.setattr(
        retrieval,
        "dense_scores",
        lambda rows, matrix, vector, scope: (
            np.full(len(rows), 0.25),
            {"provider": "local", "aws_calls": 0},
        ),
    )
    scope = {**h, "x-file-scope": json.dumps([key, other])}
    semantic = client.post(
        "/api/ai/search",
        headers=scope,
        json={"query": "Quasar astrolabe wheels copper", "mode": "semantic"},
    )
    hybrid = client.post(
        "/api/ai/search",
        headers=scope,
        json={"query": "Quasar astrolabe wheels copper", "mode": "hybrid"},
    )
    assert semantic.json()["sources"] == []
    assert {s["file_id"] for s in hybrid.json()["sources"]} == {key}


def test_matching_number_does_not_validate_the_wrong_named_policy(private):
    from app.rag import validate_claims
    from app.llm import GroundedAnswer

    sources = [
        {"citation": 1, "passage": "Policy North retains audit logs for 30 days."},
        {"citation": 2, "passage": "Policy South retains audit logs for 90 days."},
    ]
    answer = GroundedAnswer.model_validate(
        {
            "insufficient": False,
            "claims": [
                {
                    "text": "Policy North retains audit logs for 90 days.",
                    "sources": [2],
                    "quotes": [sources[1]["passage"]],
                }
            ],
        }
    )
    assert validate_claims(answer, sources) == []
    answer.claims[0].text = "Policy South retains audit logs for 90 days."
    assert len(validate_claims(answer, sources)) == 1
