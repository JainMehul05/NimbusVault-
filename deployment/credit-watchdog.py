"""Fail closed on authorization/Free-plan/credit uncertainty on the approved EC2 host.

Session limits come from instance tags (read through IMDSv2), written by `npm run aws:start` for
each explicitly authorized session: NimbusStopDeadline (absolute UTC) and NimbusInitialCredits.
Restarting the instance or the application therefore cannot extend a session. A root-only file
/opt/nimbusvault-private/watchdog-fault forces the failure path for live safeguard testing.
"""
import json
import subprocess
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PRIVATE = Path('/opt/nimbusvault-private')
MAX_SESSION_CONSUMPTION_USD = 10.0
MIN_RESERVE_USD = 10.0


def aws(*arguments):
    return json.loads(subprocess.check_output(['aws', *arguments, '--output', 'json',
        '--cli-connect-timeout', '4', '--cli-read-timeout', '8'], timeout=25))


def tag(name):
    token = urllib.request.urlopen(urllib.request.Request(
        'http://169.254.169.254/latest/api/token', method='PUT',
        headers={'X-aws-ec2-metadata-token-ttl-seconds': '60'}), timeout=3).read().decode()
    return urllib.request.urlopen(urllib.request.Request(
        f'http://169.254.169.254/latest/meta-data/tags/instance/{name}',
        headers={'X-aws-ec2-metadata-token': token}), timeout=3).read().decode().strip()


def check():
    if Path('/sys/devices/virtual/dmi/id/sys_vendor').read_text().strip() != 'Amazon EC2':
        raise SystemExit('EC2 only; no local action')
    manifest = PRIVATE / 'authorized-instance.json'
    if not manifest.exists():
        raise SystemExit('No authorized instance manifest; no action')
    fault = PRIVATE / 'watchdog-fault'
    if fault.exists() and fault.stat().st_uid == 0:
        raise RuntimeError('Injected watchdog fault (safeguard test)')
    approval = json.loads(manifest.read_text())
    now = datetime.now(timezone.utc)
    deadline = datetime.fromisoformat(tag('NimbusStopDeadline').replace('Z', '+00:00'))
    initial = float(tag('NimbusInitialCredits'))
    if approval.get('approved') is not True or now >= deadline:
        raise RuntimeError('Authorization expired')
    if aws('sts', 'get-caller-identity', '--region', 'ap-southeast-2')['Account'] != approval['account_id']:
        raise RuntimeError('Account mismatch')
    plan = aws('freetier', 'get-account-plan-state', '--region', 'us-east-1')
    credits = plan['accountPlanRemainingCredits']
    amount = float(credits['amount'])
    expiry = datetime.fromisoformat(plan['accountPlanExpirationDate'].replace('Z', '+00:00'))
    if (plan['accountPlanType'] != 'FREE' or plan['accountPlanStatus'] != 'ACTIVE'
            or credits['unit'] != 'USD' or expiry <= now or amount <= MIN_RESERVE_USD
            or initial - amount >= MAX_SESSION_CONSUMPTION_USD):
        raise RuntimeError('Free-plan/credit boundary reached')


if __name__ == '__main__':
    try:
        check()
    except SystemExit:
        raise
    except Exception as error:
        # Never prints credential values, API payloads or private user data.
        print('Approved host stopping after credit/authorization check failure:', type(error).__name__, str(error)[:80])
        subprocess.run(['systemctl', 'poweroff'], check=True)
