"""Fail closed for optional cloud work unless the existing Free plan is active."""

import threading
import time
import json
from datetime import datetime, timezone
from functools import lru_cache
import boto3
from botocore.config import Config
from .config import settings, ROOT

_lock = threading.Lock()
_cached = (0.0, False)
_details = {}


class FreePlanRequiredError(Exception):
    pass


@lru_cache
def billing_client():
    return boto3.Session(
        profile_name=settings.aws_profile if settings.aws_auth_mode == 'profile' else None,
        region_name='us-east-1',
    ).client(
        "freetier", config=Config(connect_timeout=3, read_timeout=5, retries={"max_attempts": 0})
    )


def account_matches():
    """The final app pins the account from the existing approved workflow ARN."""
    expected = settings.aws_expected_account
    if not expected:
        resources = json.loads((ROOT / ".runtime/cloud-resources.json").read_text(encoding="utf-8-sig"))
        expected = resources["serverless_outputs"]["WorkflowArn"].split(":")[4]
    if len(expected) != 12 or not expected.isdigit():
        return False
    identity = (
        boto3.Session(
            profile_name=settings.aws_profile if settings.aws_auth_mode == 'profile' else None,
            region_name=settings.aws_region,
        )
        .client(
            "sts", config=Config(connect_timeout=3, read_timeout=5, retries={"max_attempts": 0})
        )
        .get_caller_identity()
    )
    return identity["Account"] == expected


def permitted():
    global _cached, _details
    if settings.data_dir.resolve() != (ROOT / "data").resolve():
        return False
    with _lock:
        if _cached[0] > time.monotonic():
            return _cached[1]
        try:
            plan = billing_client().get_account_plan_state()
            expiry = plan.get('accountPlanExpirationDate')
            if isinstance(expiry, str):
                expiry = datetime.fromisoformat(expiry.replace('Z', '+00:00'))
            valid_until = (expiry - datetime.now(timezone.utc)).total_seconds() if expiry else 0
            allowed = (
                plan["accountPlanType"] == "FREE"
                and plan["accountPlanStatus"] == "ACTIVE"
                and valid_until > 0
                and plan.get("accountPlanRemainingCredits", {}).get("unit") == 'USD'
                and float(plan.get("accountPlanRemainingCredits", {}).get("amount", 0)) > settings.aws_min_credit_reserve_usd
                and account_matches()
            )
            _details = {
                "checked_at": datetime.now(timezone.utc).isoformat(),
                "plan": plan.get("accountPlanType"),
                "status": plan.get("accountPlanStatus"),
                "credits_usd": plan.get("accountPlanRemainingCredits", {}).get("amount"),
                "expires_at": str(plan.get("accountPlanExpirationDate", "")),
            }
        except Exception:
            allowed = False
            _details = {
                "checked_at": datetime.now(timezone.utc).isoformat(),
                "plan": "unverified",
                "status": "unavailable",
            }
        _cached = (time.monotonic() + (min(60, valid_until) if allowed else 10), allowed)
        return allowed


def status():
    allowed = permitted()
    return {
        **_details,
        "allowed": allowed,
        "minimum_credit_reserve_usd": settings.aws_min_credit_reserve_usd,
        "cache_seconds": 60,
        "paid_upgrade_permitted": False,
    }
