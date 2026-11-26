import json
from types import SimpleNamespace
import pytest
from app import cost_guard


@pytest.mark.parametrize("actual,matched", [("111111111111", True), ("222222222222", False)])
def test_final_account_must_match_existing_workflow(tmp_path, monkeypatch, actual, matched):
    monkeypatch.setattr(cost_guard, "ROOT", tmp_path)
    monkeypatch.setenv("NIMBUS_LOCAL_RETRIEVAL", "true")
    (tmp_path / ".runtime").mkdir()
    (tmp_path / ".runtime/cloud-resources.json").write_text(
        json.dumps(
            {
                "serverless_outputs": {
                    "WorkflowArn": "arn:aws:states:ap-southeast-2:111111111111:stateMachine:fixture"
                }
            }
        )
    )
    fake = SimpleNamespace(get_caller_identity=lambda: {"Account": actual})
    monkeypatch.setattr(
        cost_guard.boto3,
        "Session",
        lambda **_: SimpleNamespace(client=lambda *args, **kwargs: fake),
    )
    assert cost_guard.account_matches() is matched


def test_active_free_plan_still_rejected_when_account_mismatches(tmp_path, monkeypatch):
    monkeypatch.setattr(cost_guard, "ROOT", tmp_path)
    monkeypatch.setattr(cost_guard.settings, "data_dir", tmp_path / "data")
    monkeypatch.setattr(cost_guard, "_cached", (0, False))
    monkeypatch.setattr(cost_guard, "account_matches", lambda: False)
    fake = SimpleNamespace(
        get_account_plan_state=lambda: {
            "accountPlanType": "FREE",
            "accountPlanStatus": "ACTIVE",
            "accountPlanRemainingCredits": {"amount": 100},
        }
    )
    monkeypatch.setattr(cost_guard, "billing_client", lambda: fake)
    assert cost_guard.permitted() is False
