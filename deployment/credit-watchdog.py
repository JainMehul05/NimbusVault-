"""Fail closed on authorization/Free-plan/credit uncertainty on an approved EC2 host."""
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def aws(*arguments):
    return json.loads(subprocess.check_output(['aws', *arguments, '--output', 'json',
        '--cli-connect-timeout', '4', '--cli-read-timeout', '8'], timeout=25))


try:
    if Path('/sys/devices/virtual/dmi/id/sys_vendor').read_text().strip() != 'Amazon EC2':
        raise SystemExit('EC2 only; no local action')
    manifest = Path('/opt/nimbusvault-private/authorized-instance.json')
    if not manifest.exists():
        raise SystemExit('No authorized instance manifest; no action')
    approval = json.loads(manifest.read_text())
    now = datetime.now(timezone.utc)
    deadline = datetime.fromisoformat(approval['expires_at'].replace('Z', '+00:00'))
    if approval.get('approved') is not True or now >= deadline:
        raise RuntimeError('Authorization expired')
    if aws('sts', 'get-caller-identity', '--region', 'ap-southeast-2')['Account'] != approval['account_id']:
        raise RuntimeError('Account mismatch')
    plan = aws('freetier', 'get-account-plan-state', '--region', 'us-east-1')
    credits = plan['accountPlanRemainingCredits']
    amount = float(credits['amount'])
    expiry = datetime.fromisoformat(plan['accountPlanExpirationDate'].replace('Z', '+00:00'))
    if (plan['accountPlanType'] != 'FREE' or plan['accountPlanStatus'] != 'ACTIVE'
            or credits['unit'] != 'USD' or expiry <= now or amount <= 10
            or float(approval['initial_credits_usd']) - amount >= float(approval['max_credit_consumption_usd'])):
        raise RuntimeError('Free-plan/credit boundary reached')
except Exception as error:
    # Never prints credential values, API payloads or private user data.
    print('Approved host stopping after credit/authorization check failure:', type(error).__name__)
    subprocess.run(['systemctl', 'poweroff'], check=True)
