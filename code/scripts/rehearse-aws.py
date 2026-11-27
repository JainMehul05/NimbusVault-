"""One approved native-event rehearsal via the final NimbusVault API.

Leaves synthetic originals intact, restores the exact previous rule/consumer state in finally.
Requires a running final app with guarded AWS flags enabled and an isolated test administrator.
"""

from pathlib import Path
import argparse
import datetime
import hashlib
import json
import sys
import time
import httpx
from dotenv import load_dotenv

root = Path(__file__).resolve().parents[1]
load_dotenv(root / ".env")
sys.path.insert(0, str(root / "intelligence"))
from app import cloud, cost_guard  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("--approved-rehearsal", action="store_true")
args = parser.parse_args()
if not args.approved_rehearsal:
    raise SystemExit(
        "No mutation: pass --approved-rehearsal only with owner authorization."
    )
report_path = root / ".runtime/aws-rehearsal.json"
if report_path.exists():
    raise SystemExit(
        "A rehearsal journal already exists. Review it; never repeat uploads blindly."
    )
report = {
    "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "origin": "final NimbusVault API http://127.0.0.1:3100",
    "mutations": [],
    "checks": {},
}


def save():
    report_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    (root.parent / "docs/AWS_REHEARSAL.json").write_text(
        json.dumps(report, indent=2, default=str), encoding="utf-8"
    )


def mutation(name, details=None):
    report["mutations"].append(
        {
            "operation": name,
            "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            **(details or {}),
        }
    )
    save()


assert cost_guard.permitted(), "Current Free plan/credit reserve failed"
resources = json.loads(
    (root / ".runtime/cloud-resources.json").read_text(encoding="utf-8-sig")
)
out = resources["serverless_outputs"]
events = cloud.client("events")
functions = cloud.client("lambda")
states = cloud.client("stepfunctions")
rule = events.describe_rule(Name="cloudvault-v3-dev-uploads")["State"]
mapping = functions.get_event_source_mapping(UUID=out["MappingId"])["State"]
assert rule in {"ENABLED", "DISABLED"} and mapping in {"Enabled", "Disabled"}, (
    "Consumers in transitional state"
)
report["prior_idle"] = {"rule": rule, "consumer": mapping}
queue_state = cloud.client("sqs").get_queue_attributes(
    QueueUrl=out["QueueUrl"],
    AttributeNames=[
        "ApproximateNumberOfMessages",
        "ApproximateNumberOfMessagesNotVisible",
    ],
)["Attributes"]
assert all(int(value) == 0 for value in queue_state.values()), (
    "Shared ingestion queue is not idle; do not process legacy work"
)
save()
credentials = json.loads(
    (root / ".runtime/rehearsal-users.json").read_text(encoding="utf-8")
)
try:
    if rule == "DISABLED":
        events.enable_rule(Name="cloudvault-v3-dev-uploads")
        mutation("enable existing event rule")
    if mapping == "Disabled":
        functions.update_event_source_mapping(UUID=out["MappingId"], Enabled=True)
        mutation("enable existing SQS consumer")
    for _ in range(30):
        if (
            functions.get_event_source_mapping(UUID=out["MappingId"])["State"]
            == "Enabled"
        ):
            break
        time.sleep(2)
    else:
        raise RuntimeError("Consumer did not enable within 60 seconds")
    with httpx.Client(base_url="http://127.0.0.1:3100/api/v1", timeout=180) as app:
        login = app.post(
            "/auth/login",
            json={
                "email": credentials["owner"]["email"],
                "password": credentials["owner"]["password"],
            },
        )
        login.raise_for_status()
        token = login.json()["data"]["tokens"]["accessToken"]
        app.headers["Authorization"] = "Bearer " + token
        raw = (root / "samples/cloud-stage-canary.txt").read_bytes()
        filename = "nimbus-native-" + str(int(time.time())) + ".txt"
        uploaded = app.post("/files", files={"file": (filename, raw, "text/plain")})
        uploaded.raise_for_status()
        file = uploaded.json()["data"]
        file_id = file["id"]
        mutation(
            "final application multipart upload",
            {
                "file_id": file_id,
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            },
        )
        for _ in range(45):
            document = app.get("/ai/files/" + file_id)
            document.raise_for_status()
            if document.json()["data"]["status"] in {"ready", "failed", "unsupported"}:
                break
            time.sleep(2)
        assert document.json()["data"]["status"] == "ready", document.json()
        report["checks"]["local_index_ready"] = True
        save()
        download = app.get("/files/" + file_id + "/download")
        download.raise_for_status()
        signed = download.json()["data"]["downloadUrl"]
        original = httpx.get(signed, timeout=20, trust_env=False)
        original.raise_for_status()
        assert original.content == raw
        report["checks"]["S3_original_byte_equality"] = True
        save()
        target = None
        for _ in range(40):
            candidates = [j for j in cloud.jobs() if j["file_id"] == file_id]
            if candidates:
                target = candidates[0]
                if target["state"] in {"awaiting_local_embedding", "failed"}:
                    break
            time.sleep(2)
        assert target and target["state"] == "awaiting_local_embedding", target
        report["checks"]["native_event_workflow"] = target
        save()
        completion = app.post("/ai/cloud/complete", json={"fileId": file_id})
        completion.raise_for_status()
        assert completion.json()["data"]["completed"] == 1, completion.json()
        mutation("final application scoped local completion", {"file_id": file_id})
        execution = (
            out["WorkflowArn"].replace(":stateMachine:", ":execution:")
            + ":"
            + target["correlation_id"]
        )
        history = states.get_execution_history(executionArn=execution, maxResults=100)
        assert any(e["type"] == "ExecutionSucceeded" for e in history["events"])
        report["checks"]["Step_Functions_execution_succeeded"] = True
        detail = cloud.metadata_detail(file_id)
        assert detail and detail["sha256"] == hashlib.sha256(raw).hexdigest()
        report["checks"]["DynamoDB_metadata_readback"] = True
        probe = app.post("/ai/cloud/probe")
        probe.raise_for_status()
        report["checks"]["final_application_live_probe"] = probe.json()["data"]
        assert (
            probe.json()["data"]["api_signed_ok"]
            and probe.json()["data"]["api_unsigned_status"] == 403
        )
        assert probe.json()["data"]["standard_parameters_read"] == 3
        # Real default-local retrieval from the final Express endpoint.
        search = app.post(
            "/ai/search", json={"query": "cloud pipeline validation", "mode": "hybrid"}
        )
        search.raise_for_status()
        report["checks"]["local_search"] = search.json()["data"]
        assert search.json()["data"]["awsCalls"] == 0
        answer = app.post(
            "/ai/ask",
            json={
                "question": "Where do MiniLM embeddings and Qwen answer generation run?",
                "fileIds": [file_id],
            },
        )
        answer.raise_for_status()
        report["checks"]["final_application_Qwen"] = answer.json()["data"]
        assert answer.json()["data"]["mode"] == "generated", answer.json()
        citation = answer.json()["data"]["citations"][0]
        passage = app.get(f"/ai/files/{file_id}/chunks/{citation['chunkIndex']}")
        passage.raise_for_status()
        report["checks"]["authorized_citation_open"] = bool(
            passage.json()["data"]["content"]
        )
        # Two distinct synthetic accounts/documents; no legacy owner assignment.
        with httpx.Client(
            base_url="http://127.0.0.1:3100/api/v1", timeout=180
        ) as other:
            signin = other.post(
                "/auth/login",
                json={
                    "email": credentials["other"]["email"],
                    "password": credentials["other"]["password"],
                },
            )
            signin.raise_for_status()
            other.headers["Authorization"] = (
                "Bearer " + signin.json()["data"]["tokens"]["accessToken"]
            )
            private_bytes = b"Project Borealis uses violet balloons. Its synthetic access number is 914. This document belongs only to the second rehearsal account."
            second = other.post(
                "/files",
                files={
                    "file": ("nimbus-private-borealis.txt", private_bytes, "text/plain")
                },
            )
            second.raise_for_status()
            second_id = second.json()["data"]["id"]
            mutation(
                "second isolated synthetic application upload",
                {
                    "file_id": second_id,
                    "bytes": len(private_bytes),
                    "sha256": hashlib.sha256(private_bytes).hexdigest(),
                },
            )
            for _ in range(30):
                state = other.get("/ai/files/" + second_id)
                state.raise_for_status()
                if state.json()["data"]["status"] in {"ready", "failed"}:
                    break
                time.sleep(2)
            assert state.json()["data"]["status"] == "ready", state.json()
            assert other.get("/files/" + file_id + "/download").status_code == 404
            assert (
                other.get(
                    f"/ai/files/{file_id}/chunks/{citation['chunkIndex']}"
                ).status_code
                == 404
            )
            denied = app.post(
                "/ai/search",
                json={
                    "query": "violet balloons synthetic access number",
                    "mode": "hybrid",
                },
            )
            denied.raise_for_status()
            assert all(
                r["fileId"] != second_id for r in denied.json()["data"]["results"]
            )
            own = other.post(
                "/ai/search", json={"query": "violet balloons", "mode": "hybrid"}
            )
            own.raise_for_status()
            assert any(r["fileId"] == second_id for r in own.json()["data"]["results"])
            top = app.post("/folders", json={"name": "Native rehearsal"})
            top.raise_for_status()
            top_id = top.json()["data"]["id"]
            nested = app.post(
                "/folders", json={"name": "Evidence", "parentFolderId": top_id}
            )
            nested.raise_for_status()
            nested_id = nested.json()["data"]["id"]
            app.patch(
                "/files/" + file_id + "/move", json={"folderId": nested_id}
            ).raise_for_status()
            app.patch(
                "/files/" + file_id + "/rename",
                json={"filename": "Nimbus native evidence.txt"},
            ).raise_for_status()
            app.post(
                "/sharing",
                json={
                    "resourceType": "FOLDER",
                    "resourceId": top_id,
                    "granteeEmail": credentials["other"]["email"],
                    "level": "VIEWER",
                },
            ).raise_for_status()
            assert other.get("/files/" + file_id + "/download").status_code == 200
            shared = other.post(
                "/ai/search",
                json={
                    "query": "MiniLM embeddings Qwen local laptop",
                    "fileIds": [file_id],
                },
            )
            shared.raise_for_status()
            assert any(r["fileId"] == file_id for r in shared.json()["data"]["results"])
            app.delete(
                f"/sharing/FOLDER/{top_id}/{credentials['other']['id']}"
            ).raise_for_status()
            assert other.get("/files/" + file_id + "/download").status_code == 404
            report["checks"]["two_user_private_search_download_citation_isolation"] = (
                True
            )
            report["checks"]["nested_folder_inherited_share_and_revoke"] = True
            # Local reversible trash/restore only. No S3 object or vector deletion.
            app.delete("/files/" + file_id).raise_for_status()
            assert app.get("/files/" + file_id + "/download").status_code == 404
            app.post("/trash/files/" + file_id + "/restore").raise_for_status()
            report["checks"]["logical_rename_move_trash_restore"] = True
        save()
except Exception as error:
    report["failure"] = {"type": type(error).__name__, "message": str(error)[:500]}
    save()
    raise
finally:
    if rule == "DISABLED":
        events.disable_rule(Name="cloudvault-v3-dev-uploads")
        mutation("restore event rule disabled")
    if mapping == "Disabled":
        functions.update_event_source_mapping(UUID=out["MappingId"], Enabled=False)
        mutation("restore SQS consumer disabled")
    for _ in range(30):
        observed = functions.get_event_source_mapping(UUID=out["MappingId"])["State"]
        if observed == mapping:
            break
        time.sleep(2)
    report["restored_idle"] = {
        "rule": events.describe_rule(Name="cloudvault-v3-dev-uploads")["State"],
        "consumer": observed,
    }
    report["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save()
