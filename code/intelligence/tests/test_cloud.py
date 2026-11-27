import json
import numpy as np
import pytest
from botocore.exceptions import ClientError
from test_core import client as client
from app import cloud
from app.database import connect
from app import cost_guard, storage


def test_cloud_dense_scopes_and_stale_vectors(client, monkeypatch):
    monkeypatch.setenv('NIMBUS_LOCAL_RETRIEVAL', 'false')
    rows = [
        {"id": 1, "file_id": "a", "text": "active"},
        {"id": 2, "file_id": "b", "text": "outside scope"},
    ]
    requests = []

    class VectorClient:
        def query_vectors(self, **request):
            requests.append(request)
            return {
                "distanceMetric": "cosine",
                "vectors": [
                    {"key": cloud.vector_key(rows[0]), "distance": 0.2},
                    {"key": cloud.vector_key(rows[1]), "distance": 0},
                    {"key": "deleted:old:revision", "distance": 0},
                ],
            }

    monkeypatch.setattr(
        cloud,
        "configuration",
        lambda: {"vectors_enabled": True, "vector_bucket": "test", "vector_index": "test"},
    )
    monkeypatch.setattr(cloud, "client", lambda _: VectorClient())
    scores, diagnostic = cloud.dense_scores(rows, np.eye(2), np.array([1.0, 0.0]), ["a"])
    assert scores[0] == pytest.approx(0.8)
    assert scores[1] == -1
    assert diagnostic["provider"] == "s3vectors" and not diagnostic["fallback"]
    assert {"file_id": {"$in": ["a"]}} in requests[0]["filter"]["$and"]


def test_cloud_failure_is_labeled_local_fallback(client, monkeypatch):
    monkeypatch.setenv('NIMBUS_LOCAL_RETRIEVAL', 'false')
    class Denied:
        def query_vectors(self, **_):
            raise ClientError({"Error": {"Code": "AccessDeniedException"}}, "QueryVectors")

    monkeypatch.setattr(
        cloud,
        "configuration",
        lambda: {"vectors_enabled": True, "vector_bucket": "test", "vector_index": "test"},
    )
    monkeypatch.setattr(cloud, "client", lambda _: Denied())
    scores, diagnostic = cloud.dense_scores(
        [{"id": 1, "file_id": "a", "text": "active"}], np.array([[1.0, 0.0]]), np.array([1.0, 0.0])
    )
    assert scores.tolist() == [1.0]
    assert (
        diagnostic["provider"] == "local_fallback"
        and diagnostic["reason"] == "AccessDeniedException"
    )


def test_local_dense_mode_never_constructs_a_cloud_vector_client(monkeypatch):
    monkeypatch.setenv('NIMBUS_LOCAL_RETRIEVAL', 'true')

    def forbidden(_):
        raise AssertionError('Normal local retrieval must make zero AWS vector calls')

    monkeypatch.setattr(cloud, 'client', forbidden)
    scores, diagnostic = cloud.dense_scores(
        [{'id': 1, 'file_id': 'synthetic', 'text': 'synthetic evidence'}],
        np.array([[1.0, 0.0]]), np.array([1.0, 0.0]), ['synthetic'],
    )
    assert scores.tolist() == [1.0]
    assert diagnostic['provider'] == 'local' and diagnostic['aws_calls'] == 0


def test_outbox_keeps_failed_conditional_write(client, monkeypatch):
    c, _ = client
    uploaded = c.post(
        "/api/files/upload",
        files={"file": ("cloud.txt", b"Private cloud storage retains original files.")},
    ).json()
    monkeypatch.setattr(
        cloud, "configuration", lambda: {"metadata_enabled": True, "table": "isolated"}
    )

    class Conflict:
        def put_item(self, **_):
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem")

    monkeypatch.setattr(cloud, "client", lambda _: Conflict())
    cloud.enqueue(uploaded["id"])
    assert cloud.flush()["synced"] == 0
    with connect() as db:
        row = dict(db.execute("SELECT * FROM cloud_outbox").fetchone())
    assert row["attempts"] == 1 and row["last_error"] == "ConditionalCheckFailedException"
    assert json.loads(row["payload"])["id"] == uploaded["id"]


def test_real_aggregate_values_and_spa_routes(client):
    c, _ = client
    text = b"Drip irrigation prevents avoidable water loss."
    c.post("/api/files/upload", files={"file": ("water.txt", text)})
    data = c.get("/api/analytics?days=7").json()
    assert data["source"] == "persistent_file_records" and data["total_files"] == 1
    assert data["total_bytes"] == len(text) and data["chunks"] == 1
    assert sum(d["files"] for d in data["activity"]) == 1
    assert sum(d["bytes"] for d in data["storage"]) == len(text)
    assert c.get("/api/analytics?days=300").status_code == 422
    assert c.get("/workspace/files").status_code == 200
    assert c.get("/workspace/not-a-page").status_code == 404
    assert c.get("/api/not-a-route").status_code == 404


@pytest.mark.parametrize(
    "kind,status,credits,allowed",
    [
        ("FREE", "ACTIVE", 100, True),
        ("PAID", "ACTIVE", 100, False),
        ("FREE", "EXPIRED", 100, False),
        ("FREE", "ACTIVE", 0.5, False),
    ],
)
def test_free_plan_guard_fails_closed(tmp_path, monkeypatch, kind, status, credits, allowed):
    from datetime import datetime, timedelta, timezone

    monkeypatch.setattr(cost_guard, "ROOT", tmp_path)
    monkeypatch.setattr(cloud.settings, "data_dir", tmp_path / "data")
    monkeypatch.setattr(cost_guard, "_cached", (0.0, False))
    monkeypatch.setattr(cost_guard, 'account_matches', lambda: True)

    class Billing:
        def get_account_plan_state(self):
            return {
                "accountPlanType": kind,
                "accountPlanStatus": status,
                "accountPlanRemainingCredits": {"amount": credits, "unit": "USD"},
                "accountPlanExpirationDate": datetime.now(timezone.utc) + timedelta(days=1),
            }

    monkeypatch.setattr(cost_guard, "billing_client", lambda: Billing())
    assert cost_guard.permitted() is allowed


def test_s3_guard_never_builds_client_when_plan_is_unverified(monkeypatch):
    monkeypatch.setattr(cost_guard, "permitted", lambda: False)

    def forbidden():
        raise AssertionError("AWS client must not be constructed")

    monkeypatch.setattr(storage, "_s3_client", forbidden)
    with pytest.raises(cost_guard.FreePlanRequiredError):
        storage.s3()


def test_vector_cleanup_is_restricted_to_owned_file(monkeypatch):
    deleted = []

    class Vectors:
        def list_vectors(self, **_):
            return {
                "vectors": [
                    {"key": "file-a:old"},
                    {"key": "file-a:new"},
                    {"key": "file-b:old"},
                    {"key": "canary:0"},
                ]
            }

        def delete_vectors(self, **request):
            deleted.extend(request["keys"])

    monkeypatch.setattr(
        cloud,
        "configuration",
        lambda: {"vectors_enabled": True, "vector_bucket": "isolated", "vector_index": "isolated"},
    )
    monkeypatch.setattr(cloud, "client", lambda _: Vectors())
    cloud.remove_vectors("file-a", keep_keys={"file-a:new"})
    assert deleted == ["file-a:old"]
