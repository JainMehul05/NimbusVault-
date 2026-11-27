"""Operate the single approved NimbusVault EC2 instance. Never creates instances.

  start [--hours N] [--yes]   new bounded session: confirm, guard, deadline tags, fresh external
                              stop schedule, start, robust readiness, public URL check
  stop                        stop, verify 'stopped', close the session (schedule removed, tag expired)
  status | url | doctor       read-only state / public URL / diagnosis
  connect | warmup | backup   private SSM administration (connect: http://127.0.0.1:3200)
"""
import argparse
import base64
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.runtime/aws-deployment'
HOURLY_USD = 0.1197 + 0.005          # m7i-flex.large + public IPv4, ap-southeast-2 (rechecked 27 Nov 2026)
MAX_HOURS, RESERVE_USD = 4, 10.0
SCHEDULE = 'nimbusvault-ec2-session-stop'
LEGACY_SCHEDULES = ['nimbusvault-ec2-stop-20261127']


class Failure(Exception):
    """A categorised, user-facing failure."""

    def __init__(self, category, message):
        super().__init__(f'{category}: {message}')
        self.category = category


def iso(d):
    return d.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def now():
    return datetime.now(timezone.utc).replace(microsecond=0)


parser = argparse.ArgumentParser()
parser.add_argument('operation', choices=['start', 'connect', 'status', 'warmup', 'stop', 'backup', 'url', 'doctor'])
parser.add_argument('--hours', type=float, default=2.0)
parser.add_argument('--yes', action='store_true', help='skip the interactive confirmation (only after explicit approval)')
parser.add_argument('--no-stop-on-failure', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()

manifest = PRIVATE / 'approved-instance.json'
if not manifest.exists():
    print('No approved EC2 deployment exists. Preparation does not authorize provisioning.')
    raise SystemExit(0 if args.operation in ('status', 'doctor', 'url') else 1)
target = json.loads(manifest.read_text())
if target.get('approved') is not True or target.get('region') != 'ap-southeast-2':
    raise SystemExit('An explicit, scoped approval manifest is required')
INSTANCE = target['instance_id']
PUBLIC_URL = target.get('public_url')
sdk = Config(connect_timeout=5, read_timeout=20, retries={'max_attempts': 4, 'mode': 'standard'})
try:
    session = boto3.Session(profile_name='default', region_name=target['region'])
    account = session.client('sts', config=sdk).get_caller_identity()['Account']
except (NoCredentialsError, ClientError, BotoCoreError) as error:
    raise SystemExit(f'AWS authentication failure ({type(error).__name__}). Sign in for profile "default" '
                     '(e.g. `aws login` / `aws sso login`) and retry. No instance operation was performed.')
if account != target['account_id']:
    raise SystemExit('AWS authentication failure: wrong account for this deployment; nothing was changed.')
ec2, ssm = session.client('ec2', config=sdk), session.client('ssm', config=sdk)
scheduler = session.client('scheduler', config=sdk)


def instance():
    found = ec2.describe_instances(InstanceIds=[INSTANCE])['Reservations'][0]['Instances'][0]
    tags = {t['Key']: t['Value'] for t in found.get('Tags', [])}
    if tags.get('NimbusVaultDeployment') != target['deployment_id']:
        raise SystemExit('Instance ownership tag does not match the approved manifest')
    return found, tags


def plan_state():
    try:
        plan = session.client('freetier', region_name='us-east-1', config=sdk).get_account_plan_state()
    except (ClientError, BotoCoreError) as error:
        raise Failure('Financial guard failure', f'credit state unavailable ({type(error).__name__}); failing closed')
    credits = plan.get('accountPlanRemainingCredits', {})
    if (plan.get('accountPlanType') != 'FREE' or plan.get('accountPlanStatus') != 'ACTIVE'
            or credits.get('unit') != 'USD' or plan['accountPlanExpirationDate'] <= now()):
        raise Failure('Financial guard failure', 'account is not an ACTIVE, unexpired FREE plan')
    return plan, float(credits['amount'])


def ssm_online(deadline):
    while time.monotonic() < deadline:
        info = ssm.describe_instance_information(Filters=[{'Key': 'InstanceIds', 'Values': [INSTANCE]}])
        if any(i['PingStatus'] == 'Online' for i in info['InstanceInformationList']):
            return True
        time.sleep(5)
    return False


def run_remote(script_path, script_args=(), timeout=420):
    """Run a local script on the host through SSM; returns (status, stdout)."""
    body = Path(script_path).read_text(encoding='utf-8').replace('\r\n', '\n')
    encoded = base64.b64encode(body.encode()).decode()
    command = ssm.send_command(
        InstanceIds=[INSTANCE], DocumentName='AWS-RunShellScript', TimeoutSeconds=60,
        Parameters={'commands': [f'echo {encoded} | base64 -d > /tmp/nimbus-step.sh',
                                 'bash /tmp/nimbus-step.sh ' + ' '.join(script_args)],
                    'executionTimeout': [str(timeout)]})['Command']['CommandId']
    local_deadline = time.monotonic() + timeout + 60
    while time.monotonic() < local_deadline:
        time.sleep(4)
        try:
            result = ssm.get_command_invocation(CommandId=command, InstanceId=INSTANCE)
        except ssm.exceptions.InvocationDoesNotExist:
            continue
        if result['Status'] not in ('Pending', 'InProgress', 'Delayed'):
            return result['Status'], result.get('StandardOutputContent', '') + result.get('StandardErrorContent', '')
    return 'LocalTimeout', ''


def public_health(url, deadline):
    """Verify the public endpoint from this laptop with full certificate verification."""
    last = 'no response'
    context = ssl.create_default_context()
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url.rstrip('/') + '/api/v1/health', timeout=10, context=context) as r:
                payload = json.loads(r.read())
                if r.status == 200 and payload.get('data', {}).get('status') == 'ok':
                    return True, 'ok'
                last = f'HTTP {r.status}'
        except ssl.SSLError as error:
            return False, f'TLS failure: {error.reason}'
        except Exception as error:  # 502/503/504 while CloudFront reaches a booting origin
            last = f'{type(error).__name__}: {str(error)[:80]}'
        time.sleep(5)
    return False, last


def close_session(reason):
    for name in [SCHEDULE, *LEGACY_SCHEDULES]:
        try:
            scheduler.delete_schedule(Name=name, GroupName='default')
        except scheduler.exceptions.ResourceNotFoundException:
            pass
    ec2.create_tags(Resources=[INSTANCE], Tags=[{'Key': 'NimbusStopDeadline', 'Value': iso(now())}])
    auth_file = PRIVATE / 'authorization.json'
    if auth_file.exists():
        auth = json.loads(auth_file.read_text())
        auth.update(approved=False, closed_at=iso(now()), closed_reason=reason)
        auth_file.write_text(json.dumps(auth, indent=2))


def stop_and_verify():
    ec2.stop_instances(InstanceIds=[INSTANCE])
    ec2.get_waiter('instance_stopped').wait(InstanceIds=[INSTANCE], WaiterConfig={'Delay': 5, 'MaxAttempts': 60})


def start():
    hours = args.hours
    if not 0.25 <= hours <= MAX_HOURS:
        raise Failure('Invalid authorization', f'--hours must be between 0.25 and {MAX_HOURS}')
    found, _ = instance()
    if found['State']['Name'] != 'stopped':
        raise Failure('EC2 state', f"instance is '{found['State']['Name']}'; only a stopped instance is started (use aws:status / aws:stop)")
    plan, credits = plan_state()
    estimate = round(hours * HOURLY_USD + 0.02, 2)
    if credits - estimate < RESERVE_USD:
        raise Failure('Financial guard failure', f'credits {credits:.2f} would fall below the USD {RESERVE_USD:.0f} reserve')
    print(f'NimbusVault session request\n  Instance   {INSTANCE} (m7i-flex.large, ap-southeast-2)\n'
          f'  Runtime    at most {hours:g} h (automatic stop)\n  Estimated  ≈ USD {estimate} of AWS credits\n'
          f'  Account    FREE / ACTIVE, credits USD {credits:.2f}, plan expires {plan["accountPlanExpirationDate"]:%Y-%m-%d}\n'
          f'  Out-of-pocket: ₹0 (the plan is never upgraded)')
    if not args.yes and input('Type YES to authorize this session: ').strip() != 'YES':
        raise SystemExit('Not authorized; nothing was changed.')
    begin = now()
    session_end = begin + timedelta(hours=hours)
    host_deadline, external_stop = session_end - timedelta(minutes=10), session_end - timedelta(minutes=5)
    auth = {'approved': True, 'authorization_id': 'session-' + uuid.uuid4().hex[:8], 'deployment_id': target['deployment_id'],
            'approved_at': iso(begin), 'expires_at': iso(external_stop), 'session_end': iso(session_end),
            'max_runtime_hours': hours, 'initial_credits_usd': credits, 'estimated_credits_usd': estimate}
    (PRIVATE / 'authorization.json').write_text(json.dumps(auth, indent=2))
    ec2.create_tags(Resources=[INSTANCE], Tags=[
        {'Key': 'NimbusStopDeadline', 'Value': iso(host_deadline)},
        {'Key': 'NimbusInitialCredits', 'Value': f'{credits:.6f}'},
        {'Key': 'NimbusAuthorization', 'Value': auth['authorization_id']}])
    for name in [SCHEDULE, *LEGACY_SCHEDULES]:          # stale, completed or failed schedules
        try:
            scheduler.delete_schedule(Name=name, GroupName='default')
        except scheduler.exceptions.ResourceNotFoundException:
            pass
    scheduler.create_schedule(
        Name=SCHEDULE, GroupName='default', ScheduleExpression=f'at({external_stop:%Y-%m-%dT%H:%M:%S})',
        ScheduleExpressionTimezone='UTC', FlexibleTimeWindow={'Mode': 'OFF'}, State='ENABLED',
        ActionAfterCompletion='DELETE', Description=f"Independent stop for {auth['authorization_id']}",
        Target={'Arn': 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances',
                'RoleArn': f"arn:aws:iam::{account}:role/nimbusvault-ec2-safety-20261127",
                'Input': json.dumps({'InstanceIds': [INSTANCE]}),
                'RetryPolicy': {'MaximumRetryAttempts': 3, 'MaximumEventAgeInSeconds': 600}})
    schedule = scheduler.get_schedule(Name=SCHEDULE, GroupName='default')
    if schedule['State'] != 'ENABLED' or json.loads(schedule['Target']['Input']) != {'InstanceIds': [INSTANCE]}:
        raise Failure('Scheduler failure', 'independent stop schedule could not be verified; instance not started')
    print(f'Safeguards armed: host poweroff {iso(host_deadline)}, external stop {iso(external_stop)}, watchdog every 2 min.')
    started = time.monotonic()
    ec2.start_instances(InstanceIds=[INSTANCE])
    try:
        try:
            ec2.get_waiter('instance_running').wait(InstanceIds=[INSTANCE], WaiterConfig={'Delay': 5, 'MaxAttempts': 48})
        except Exception:
            raise Failure('EC2 startup failure', 'instance did not reach running')
        if not ssm_online(time.monotonic() + 240):
            raise Failure('SSM unavailable', 'instance did not register with Systems Manager within 240 s')
        status, output = run_remote(ROOT / 'deployment/ec2-ready.sh', ['330'], timeout=420)
        print('\n'.join(line for line in output.splitlines() if line.startswith(('STAGE', 'READY', 'DIAGNOSTICS')) or not output.count('STAGE')))
        if status != 'Success':
            stage = next((l for l in output.splitlines() if 'FAIL' in l), 'readiness did not complete')
            category = {'docker': 'Docker failure', 'compose': 'Application stack failure', 'postgres': 'Database unhealthy',
                        'backend': 'Backend unhealthy', 'intelligence': 'Intelligence unavailable', 'ollama': 'Ollama unavailable',
                        'origin-guard': 'Origin protection failure'}.get(stage.split()[1].rstrip(':') if stage.startswith('STAGE') else '', 'Host readiness failure')
            print(output[-3000:])
            raise Failure(category, stage)
        if PUBLIC_URL:
            ok, detail = public_health(PUBLIC_URL, time.monotonic() + 180)
            if not ok:
                raise Failure('TLS failure' if detail.startswith('TLS') else 'Public endpoint failure', f'{PUBLIC_URL} — {detail}')
    except Failure:
        if not args.no_stop_on_failure:
            print('Stopping the instance to protect credits (diagnostics above).')
            stop_and_verify()
            close_session('failed start')
        raise
    print(f'\nReady in {time.monotonic() - started:.0f} s.')
    if PUBLIC_URL:
        print(f'Public website: {PUBLIC_URL}   (visitors need only this link)')
    print(f'Session ends by {iso(session_end)} UTC. Warm the AI: npm run aws:warmup. Stop early: npm run aws:stop.')


def stop():
    stop_and_verify()
    close_session('user stop')
    found, _ = instance()
    print(f"Instance {INSTANCE} verified {found['State']['Name']}. Session closed; EBS storage remains allocated."
          + (f' The public URL now returns an error page until the next aws:start.' if PUBLIC_URL else ''))


def status():
    found, tags = instance()
    print(json.dumps({'instance_id': INSTANCE, 'state': found['State']['Name'], 'instance_type': found['InstanceType'],
                      'session_deadline': tags.get('NimbusStopDeadline'), 'public_url': PUBLIC_URL}, indent=2))


def doctor():
    checks = []
    def check(name, fn):
        try:
            checks.append((name, 'OK', fn()))
        except Exception as error:
            checks.append((name, 'FAIL', f'{type(error).__name__}: {str(error)[:120]}'))
    check('AWS identity', lambda: 'correct account')
    check('Free plan / credits', lambda: f'USD {plan_state()[1]:.2f}')
    found, tags = instance()
    check('EC2', lambda: f"{found['State']['Name']} ({found['InstanceType']})")
    check('Session deadline tag', lambda: tags.get('NimbusStopDeadline', 'missing'))
    def schedule():
        s = scheduler.get_schedule(Name=SCHEDULE, GroupName='default')
        return f"{s['State']} {s['ScheduleExpression']}"
    if found['State']['Name'] == 'stopped':
        checks.append(('External stop schedule', 'OK', 'none (expected: sessions remove it when the instance stops)'))
    else:
        check('External stop schedule', schedule)
    if found['State']['Name'] == 'running':
        check('SSM', lambda: 'online' if ssm_online(time.monotonic() + 15) else (_ for _ in ()).throw(RuntimeError('not online')))
    if target.get('cloudfront_distribution_id'):
        cf = session.client('cloudfront', region_name='us-east-1', config=sdk)
        check('CloudFront distribution', lambda: cf.get_distribution(Id=target['cloudfront_distribution_id'])['Distribution']['Status'])
        check('CloudFront VPC origin', lambda: cf.get_vpc_origin(Id=target['vpc_origin_id'])['VpcOrigin']['Status'])
    if PUBLIC_URL and found['State']['Name'] == 'running':
        check('Public HTTPS', lambda: public_health(PUBLIC_URL, time.monotonic() + 20)[1])
    for name, result, detail in checks:
        print(f'{result:4}  {name}: {detail}')


def connect():
    plugin = next((PRIVATE / 'tools/ssm-portable').rglob('session-manager-plugin.exe'), None)
    environment = os.environ.copy()
    if plugin:
        environment['PATH'] = str(plugin.parent) + os.pathsep + environment.get('PATH', '')
    print('Private SSM administration forwarding: http://127.0.0.1:3200 (not the public website)')
    raise SystemExit(subprocess.call(['aws', 'ssm', 'start-session', '--profile', 'default', '--region', target['region'],
        '--target', INSTANCE, '--document-name', 'AWS-StartPortForwardingSession',
        '--parameters', json.dumps({'portNumber': ['3100'], 'localPortNumber': ['3200']})], env=environment))


def remote(command, label):
    found, _ = instance()
    if found['State']['Name'] != 'running':
        raise Failure('EC2 state', 'instance must be running (npm run aws:start)')
    command_id = ssm.send_command(InstanceIds=[INSTANCE], DocumentName='AWS-RunShellScript',
                                  Parameters={'commands': [command], 'executionTimeout': ['600']}, TimeoutSeconds=60)['Command']['CommandId']
    deadline = time.monotonic() + 660
    while time.monotonic() < deadline:
        time.sleep(3)
        try:
            result = ssm.get_command_invocation(CommandId=command_id, InstanceId=INSTANCE)
        except ssm.exceptions.InvocationDoesNotExist:
            continue
        if result['Status'] not in ('Pending', 'InProgress', 'Delayed'):
            print(json.dumps({'operation': label, 'status': result['Status']}))
            raise SystemExit(0 if result['Status'] == 'Success' else 1)
    raise Failure('SSM unavailable', f'{label} did not finish; inspect command {command_id}')


try:
    if args.operation == 'start':
        start()
    elif args.operation == 'stop':
        stop()
    elif args.operation == 'status':
        status()
    elif args.operation == 'url':
        print(PUBLIC_URL or 'No public URL is configured.')
    elif args.operation == 'doctor':
        doctor()
    elif args.operation == 'connect':
        connect()
    elif args.operation == 'warmup':
        remote("cd /opt/nimbusvault && docker compose --env-file /opt/nimbusvault-private/compose.env -f deployment/compose.ec2.yml exec -T intelligence python -c \"import os,urllib.request; r=urllib.request.Request('http://127.0.0.1:8101/warmup',data=b'',headers={'x-service-token':os.environ['INTERNAL_SERVICE_TOKEN']}); print(urllib.request.urlopen(r,timeout=300).status)\"", 'warmup')
    elif args.operation == 'backup':
        remote('cd /opt/nimbusvault && bash deployment/backup-linux.sh', 'backup')
except Failure as failure:
    raise SystemExit(f'{failure}')
except (ClientError, BotoCoreError) as error:
    raise SystemExit(f'AWS request failed ({type(error).__name__}): {str(error)[:200]}')
