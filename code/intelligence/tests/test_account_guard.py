import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import pytest
from app import cost_guard


@pytest.mark.parametrize("actual,matched", [("111111111111", True), ("222222222222", False)])
def test_final_account_must_match_existing_workflow(tmp_path, monkeypatch, actual, matched):
    monkeypatch.setattr(cost_guard.settings, 'aws_expected_account', '')
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
            "accountPlanRemainingCredits": {"amount": 100, "unit": "USD"},
            "accountPlanExpirationDate": datetime.now(timezone.utc) + timedelta(days=1),
        }
    )
    monkeypatch.setattr(cost_guard, "billing_client", lambda: fake)
    assert cost_guard.permitted() is False


@pytest.mark.parametrize('expiry,unit,amount,expected', [
    ('future', 'USD', 100, True),
    ('past', 'USD', 100, False),
    ('missing', 'USD', 100, False),
    ('future', 'INR', 100, False),
    ('future', 'USD', 10, False),
])
def test_deployment_guard_expiry_currency_and_reserve(tmp_path, monkeypatch, expiry, unit, amount, expected):
    monkeypatch.setattr(cost_guard, 'ROOT', tmp_path)
    monkeypatch.setattr(cost_guard.settings, 'data_dir', tmp_path / 'data')
    monkeypatch.setattr(cost_guard.settings, 'aws_min_credit_reserve_usd', 10)
    monkeypatch.setattr(cost_guard, '_cached', (0.0, False))
    monkeypatch.setattr(cost_guard, 'account_matches', lambda: True)
    plan = {'accountPlanType': 'FREE', 'accountPlanStatus': 'ACTIVE',
            'accountPlanRemainingCredits': {'amount': amount, 'unit': unit}}
    if expiry != 'missing':
        plan['accountPlanExpirationDate'] = datetime.now(timezone.utc) + timedelta(days=1 if expiry == 'future' else -1)
    monkeypatch.setattr(cost_guard, 'billing_client', lambda: SimpleNamespace(get_account_plan_state=lambda: plan))
    assert cost_guard.permitted() is expected


def test_guard_cache_cannot_outlive_plan_expiry(tmp_path, monkeypatch):
    monkeypatch.setattr(cost_guard, 'ROOT', tmp_path)
    monkeypatch.setattr(cost_guard.settings, 'data_dir', tmp_path / 'data')
    monkeypatch.setattr(cost_guard, '_cached', (0.0, False))
    monkeypatch.setattr(cost_guard, 'account_matches', lambda: True)
    plan = {'accountPlanType': 'FREE', 'accountPlanStatus': 'ACTIVE',
            'accountPlanRemainingCredits': {'amount': 100, 'unit': 'USD'},
            'accountPlanExpirationDate': datetime.now(timezone.utc) + timedelta(seconds=5)}
    monkeypatch.setattr(cost_guard, 'billing_client', lambda: SimpleNamespace(get_account_plan_state=lambda: plan))
    assert cost_guard.permitted()
    assert 0 < cost_guard._cached[0] - cost_guard.time.monotonic() <= 5


def test_instance_role_session_does_not_require_personal_profile(monkeypatch):
    from app import storage

    captured = []
    monkeypatch.setattr(storage.settings, 'aws_auth_mode', 'instance-role')
    def fake_session(**kwargs):
        captured.append(kwargs)
        return SimpleNamespace(events=SimpleNamespace(register=lambda *args: None))

    monkeypatch.setattr(storage.boto3, 'Session', fake_session)
    storage.session.cache_clear()
    storage.session()
    storage.session.cache_clear()
    assert captured[0]['profile_name'] is None
