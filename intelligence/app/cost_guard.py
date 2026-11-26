"""Fail closed for optional cloud work unless the existing Free plan is active."""

import threading
import time
import json
import os
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
    return boto3.Session(profile_name=settings.aws_profile, region_name=settings.aws_region).client(
        "freetier", config=Config(connect_timeout=3, read_timeout=5, retries={"max_attempts": 0})
    )


def account_matches():
    """The final app pins the account from the existing approved workflow ARN."""
    if os.environ.get("NIMBUS_LOCAL_RETRIEVAL") != "true":
        return True
    resources = json.loads((ROOT / ".runtime/cloud-resources.json").read_text(encoding="utf-8-sig"))
    expected = resources["serverless_outputs"]["WorkflowArn"].split(":")[4]
    identity = (
        boto3.Session(profile_name=settings.aws_profile, region_name=settings.aws_region)
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
            allowed = (
                plan["accountPlanType"] == "FREE"
                and plan["accountPlanStatus"] == "ACTIVE"
                and plan.get("accountPlanRemainingCredits", {}).get("amount", 0) > 1
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
        _cached = (time.monotonic() + 60, allowed)
        return allowed


def status():
    allowed = permitted()
    return {
        **_details,
        "allowed": allowed,
        "minimum_credit_reserve_usd": 1,
        "cache_seconds": 60,
        "paid_upgrade_permitted": False,
    }
