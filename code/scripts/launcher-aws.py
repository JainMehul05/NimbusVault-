"""One-click UI for the existing approved deployment; never provisions resources.

The advanced AWS runtime remains the single implementation of session authorization,
plan/credit guard, instance ownership and external stop schedule rearming.
"""
import contextlib
import io
import json
import runpy
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.runtime/aws-deployment'


def context():
    class Capture(io.StringIO):
        def reconfigure(self, **kwargs):
            pass
    old = sys.argv
    captured = Capture()
    try:
        sys.argv = ['aws-runtime.py', 'status']
        # Loading the adapter performs identity/ownership checks and a read-only status.
        with contextlib.redirect_stdout(captured):
            return runpy.run_path(str(ROOT / 'scripts/aws-runtime.py'))
    except SystemExit as error:
        raise SystemExit(captured.getvalue().strip() or str(error)) from error
    finally:
        sys.argv = old


def public_url(c):
    url = c.get('PUBLIC_URL')
    p = urlparse(url or '')
    aws_hosts = ('.cloudfront.net', '.execute-api.ap-southeast-2.amazonaws.com')  # AWS-generated public endpoints
    if (p.scheme != 'https' or not p.hostname or not p.hostname.endswith(aws_hosts)
            or p.username or p.password or p.port not in (None, 443) or p.query or p.fragment):
        raise RuntimeError('Public AWS HTTPS deployment (CloudFront or API Gateway) is not configured in the approved manifest. '
                           'No instance will be started. Complete the approved public deployment first; '
                           'a private SSM address is not a shareable website.')
    return url


def deadline(c, tags):
    value = tags.get('NimbusStopDeadline')
    if not value:
        raise RuntimeError('No authorized host deadline is recorded.')
    end = datetime.fromisoformat(value.replace('Z', '+00:00'))
    seconds = int((end - c['now']()).total_seconds())
    return end, seconds


def active_authorization(c, tags):
    auth = json.loads((PRIVATE / 'authorization.json').read_text())
    end, seconds = deadline(c, tags)
    if (auth.get('approved') is not True or auth.get('deployment_id') != c['target']['deployment_id']
            or auth.get('authorization_id') != tags.get('NimbusAuthorization') or seconds <= 0):
        raise RuntimeError('Running instance has no valid matching bounded authorization. Stop it; '
                           'the launcher never extends a live session silently.')
    _, credits = c['plan_state']()
    if credits <= c['RESERVE_USD'] or float(tags.get('NimbusInitialCredits', 'inf')) - credits >= 10:
        raise RuntimeError('Credit reserve/session-consumption boundary reached.')
    schedule = c['scheduler'].get_schedule(Name=c['SCHEDULE'], GroupName='default')
    if (schedule['State'] != 'ENABLED'
            or json.loads(schedule['Target']['Input']) != {'InstanceIds': [c['INSTANCE']]}):
        raise RuntimeError('The independent automatic stop schedule is not armed for this instance.')
    scheduled = datetime.strptime(schedule['ScheduleExpression'], 'at(%Y-%m-%dT%H:%M:%S)').replace(tzinfo=timezone.utc)
    session_end = datetime.fromisoformat(auth['session_end'].replace('Z', '+00:00'))
    if schedule.get('ScheduleExpressionTimezone') != 'UTC' or not c['now']() < scheduled <= session_end:
        raise RuntimeError('Independent stop time is missing, expired or outside the authorized session.')
    return end, seconds


def status(c):
    found, tags = c['instance']()
    print('AWS authentication: verified; approved deployment ownership matches.')
    plan, credits = c['plan_state']()
    print(f'Account: {plan["accountPlanType"]}/{plan["accountPlanStatus"]}; credits USD {credits:.6f}; '
          f'expires {plan["accountPlanExpirationDate"]:%Y-%m-%d}')
    print(f'EC2: {found["State"]["Name"]} ({c["INSTANCE"]})')
    try:
        end, seconds = deadline(c, tags)
        if found['State']['Name'] == 'stopped':
            seconds = 0
        elif found['State']['Name'] == 'running':
            end, seconds = active_authorization(c, tags)
        print(f'Host runtime remaining: {max(0, seconds) // 60} min {max(0, seconds) % 60} s; '
              f'deadline {end.isoformat()} (automatic stop may occur earlier).')
    except RuntimeError as error:
        print(f'Authorization NOT VERIFIED; do not rely on remaining runtime: {error}')
    try:
        url = public_url(c)
    except RuntimeError as error:
        print(f'Public website: NOT CONFIGURED. {error}')
        print('AWS AI readiness: not tested by the one-click launcher.')
        return
    ok, detail = c['public_health'](url, c['time'].monotonic() + 12)
    print(f'Public website: {"AVAILABLE" if ok else "UNAVAILABLE"} - {url} ({detail})')
    warm_file = PRIVATE / 'launcher-warmup.json'
    if warm_file.exists():
        warm = json.loads(warm_file.read_text())
        print(f'Last verified AWS MiniLM + AI-provider readiness: {warm["warmed_at"]}; '
              'historical, not proof that models remain loaded now.')
    else:
        print('AWS AI readiness: no launcher-verified warmup yet.')


def start(c):
    url = public_url(c)  # Refuse a private-only manifest before any paid session or prompt.
    found, tags = c['instance']()
    if found['State']['Name'] == 'running':
        active_authorization(c, tags)
        print('Already running within its existing authorization; deadline will not be extended.')
    elif found['State']['Name'] == 'stopped':
        value = input('Maximum session hours [2; allowed 0.25 to 4]: ').strip() or '2'
        c['args'].hours = float(value)
        c['args'].yes = False  # The existing runtime always asks for explicit YES.
        try:
            c['start']()
        except Exception:
            # Also cover SDK/readiness errors not categorised by the advanced runtime.
            if c['instance']()[0]['State']['Name'] in ('running', 'pending'):
                c['stop']()
            raise
    else:
        raise RuntimeError(f'EC2 is {found["State"]["Name"]}; wait for the transition and retry.')
    try:
        found, tags = c['instance']()
        active_authorization(c, tags)
        print('Checking host safeguards, application readiness, fresh MiniLM and AI-provider readiness...')
        result, output = c['run_remote'](ROOT / 'deployment/launcher-ready.sh', timeout=420)
        # This script emits stage names only, no environment values or credentials.
        print(output[-1800:])
        if result != 'Success':
            raise RuntimeError('AWS safeguards/application/AI warmup failed.')
        ok, detail = c['public_health'](url, c['time'].monotonic() + 90)
        if not ok:
            raise RuntimeError(f'Public CloudFront HTTPS health failed: {detail}')
        with urllib.request.urlopen(url.rstrip('/') + '/api/v1/health', timeout=15) as response:
            health = json.load(response)['data']
            if health.get('host') != 'ec2' or health.get('service') != 'nimbusvault-backend':
                raise RuntimeError('Public endpoint does not identify the genuine EC2 NimbusVault application.')
        with urllib.request.urlopen(url.rstrip('/') + '/', timeout=15) as response:
            if response.status != 200 or b'<html' not in response.read(2_000_000).lower():
                raise RuntimeError('Public HTTPS frontend was not served.')
        end, seconds = active_authorization(c, c['instance']()[1])
        (PRIVATE / 'launcher-warmup.json').write_text(json.dumps({
            'warmed_at': c['iso'](c['now']()), 'authorization_id': tags['NimbusAuthorization']}))
        print(f'SUCCESS - Shareable NimbusVault website: {url}\n'
              f'Host deadline: {end.isoformat()}; at most {seconds // 60} minutes remaining.')
    except Exception:
        print('Stopping the owned instance after failed verification to protect credits.')
        c['stop']()
        raise


def stop(c):
    found, _ = c['instance']()
    if found['State']['Name'] == 'stopped':
        print('SUCCESS - Approved EC2 instance is already verified stopped; no restart or mutation performed.')
        return
    if found['State']['Name'] == 'running':
        try:
            result, _ = c['run_remote'](ROOT / 'deployment/launcher-stop.sh', timeout=110)
            print(f'Application drain through SSM: {result}')
        except Exception:
            print('SSM drain unavailable; requesting normal EC2 OS shutdown (never Force/SkipOsShutdown).')
    c['stop']()  # EC2 normal stop, waiter, ownership recheck and session closure.
    warm_file = PRIVATE / 'launcher-warmup.json'
    warm_file.unlink(missing_ok=True)
    print('SUCCESS - Actual EC2 stopped state verified. Persistent disk/data retained.')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    try:
        operation = sys.argv[1]
        c = context()
        {'start': start, 'stop': stop, 'status': status}[operation](c)
    except SystemExit as error:
        # Missing approval must remain a visible failed start, even if adapter status exits 0.
        print(f'Unable to operate the approved AWS deployment: {error}')
        raise SystemExit(1)
    except Exception as error:
        print(f'FAILED - {type(error).__name__}: {str(error)[:500]}')
        raise SystemExit(1)
