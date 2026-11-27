"""Operate only an explicitly approved existing instance. Never provisions resources."""
import argparse
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.runtime/aws-deployment'
parser = argparse.ArgumentParser()
parser.add_argument('operation', choices=['start', 'connect', 'status', 'warmup', 'stop', 'backup'])
args = parser.parse_args()
manifest = PRIVATE / 'approved-instance.json'
if not manifest.exists():
    print('No approved EC2 deployment exists. Preparation does not authorize provisioning.')
    raise SystemExit(0 if args.operation == 'status' else 1)
target = json.loads(manifest.read_text())
if target.get('approved') is not True or target.get('region') != 'ap-southeast-2':
    raise SystemExit('An explicit, scoped approval manifest is required')
session = boto3.Session(profile_name='default', region_name=target['region'])
sdk = Config(connect_timeout=4, read_timeout=12, retries={'max_attempts': 1})
sts = session.client('sts', config=sdk)
if sts.get_caller_identity()['Account'] != target['account_id']:
    raise SystemExit('Wrong account; no instance operation performed')
ec2 = session.client('ec2', config=sdk)
instance_id = target['instance_id']
instance = ec2.describe_instances(InstanceIds=[instance_id])['Reservations'][0]['Instances'][0]
tags = {x['Key']: x['Value'] for x in instance.get('Tags', [])}
if tags.get('NimbusVaultDeployment') != target['deployment_id']:
    raise SystemExit('Instance ownership tag does not match the approved manifest')
if args.operation == 'status':
    print(json.dumps({'instance_id': instance_id, 'state': instance['State']['Name'],
                      'instance_type': instance['InstanceType'], 'region': target['region']}))
    raise SystemExit(0)
if args.operation != 'stop':
    approval = json.loads((PRIVATE / 'authorization.json').read_text())
    expires = datetime.fromisoformat(approval['expires_at'].replace('Z', '+00:00'))
    if (approval.get('approved') is not True or approval.get('deployment_id') != target['deployment_id']
            or expires <= datetime.now(timezone.utc)):
        raise SystemExit('This bounded runtime authorization is absent or expired')
    plan = session.client('freetier', region_name='us-east-1', config=sdk).get_account_plan_state()
    if (plan.get('accountPlanType') != 'FREE' or plan.get('accountPlanStatus') != 'ACTIVE'
            or plan.get('accountPlanRemainingCredits', {}).get('unit') != 'USD'
            or plan.get('accountPlanRemainingCredits', {}).get('amount', 0) <= 10
            or plan['accountPlanExpirationDate'] <= datetime.now(timezone.utc)):
        raise SystemExit('Free-plan, expiration and credit reserve verification failed')
if args.operation == 'start':
    # A start cannot silently extend an already running session or create an instance.
    if instance['State']['Name'] != 'stopped':
        raise SystemExit('Instance must be stopped; running instances are not re-timed')
    if (expires - datetime.now(timezone.utc)).total_seconds() < 900:
        raise SystemExit('At least 15 approved minutes must remain before starting')
    if not target.get('external_stop_schedule_arn'):
        raise SystemExit('The independent approved stop safeguard has not been recorded')
    # The recorded absolute deadline must cover this exact approval, not an old session.
    stop_deadline = datetime.fromisoformat(target['stop_deadline'].replace('Z', '+00:00'))
    if (target.get('stop_authorization_id') != approval.get('authorization_id')
            or not approval.get('authorization_id')
            or stop_deadline > expires
            or (stop_deadline - datetime.now(timezone.utc)).total_seconds() < 900):
        raise SystemExit('The independent stop schedule must be rearmed within approved scope first')
    schedule = session.client('scheduler', config=sdk).get_schedule(
        Name=target['external_stop_schedule_arn'].rsplit('/', 1)[1], GroupName='default')
    expected_expression = 'at(' + stop_deadline.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S') + ')'
    if (schedule['State'] != 'ENABLED' or schedule['ScheduleExpression'] != expected_expression
            or schedule.get('ScheduleExpressionTimezone', 'UTC') != 'UTC'
            or schedule['Target']['Arn'] != 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances'
            or json.loads(schedule['Target']['Input']) != {'InstanceIds': [instance_id]}):
        raise SystemExit('Actual independent stop schedule does not match this exact approved session')
    ec2.start_instances(InstanceIds=[instance_id])
    try:
        ec2.get_waiter('instance_running').wait(
            InstanceIds=[instance_id], WaiterConfig={'Delay': 5, 'MaxAttempts': 48})
        ssm = session.client('ssm', config=sdk)
        readiness_deadline = time.monotonic() + 240
        while time.monotonic() < readiness_deadline:
            info = ssm.describe_instance_information(Filters=[{'Key': 'InstanceIds', 'Values': [instance_id]}])
            if any(item['PingStatus'] == 'Online' for item in info['InstanceInformationList']):
                break
            time.sleep(5)
        else:
            raise RuntimeError('Approved instance did not become reachable through SSM')
        response = ssm.send_command(InstanceIds=[instance_id], DocumentName='AWS-RunShellScript',
            Parameters={'commands': ['curl --fail --silent --retry 20 --retry-delay 3 --retry-connrefused --max-time 5 http://127.0.0.1:3100/api/v1/health >/dev/null']},
            TimeoutSeconds=120)
        ssm.get_waiter('command_executed').wait(
            CommandId=response['Command']['CommandId'], InstanceId=instance_id,
            WaiterConfig={'Delay': 5, 'MaxAttempts': 25})
    except Exception:
        ec2.stop_instances(InstanceIds=[instance_id])
        raise
    print('Approved existing instance running; SSM online and application health verified. No resources created.')
elif args.operation == 'stop':
    # Stopping reduces risk: a low/expired credit balance must not prevent stopping
    # the correctly pinned, previously approved instance.
    ec2.stop_instances(InstanceIds=[instance_id])
    ec2.get_waiter('instance_stopped').wait(
        InstanceIds=[instance_id], WaiterConfig={'Delay': 5, 'MaxAttempts': 48})
    print('Approved EC2 instance verified stopped. EBS storage remains allocated.')
elif args.operation == 'connect':
    plugin = next((PRIVATE / 'tools/ssm-portable').rglob('session-manager-plugin.exe'), None)
    environment = os.environ.copy()
    if plugin:
        environment['PATH'] = str(plugin.parent) + os.pathsep + environment.get('PATH', '')
    print('Private SSM forwarding: http://127.0.0.1:3200 (not a public website)')
    raise SystemExit(subprocess.call([
        'aws', 'ssm', 'start-session', '--profile', 'default', '--region', target['region'],
        '--target', instance_id, '--document-name', 'AWS-StartPortForwardingSession',
        '--parameters', json.dumps({'portNumber': ['3100'], 'localPortNumber': ['3200']}),
    ], env=environment))
else:
    if instance['State']['Name'] != 'running':
        raise SystemExit('Approved instance must be running')
    ssm = session.client('ssm', config=sdk)
    if args.operation == 'warmup':
        command = "cd /opt/nimbusvault && docker compose --env-file /opt/nimbusvault-private/compose.env -f deployment/compose.ec2.yml exec -T intelligence python -c \"import os,urllib.request; r=urllib.request.Request('http://127.0.0.1:8101/warmup',data=b'',headers={'x-service-token':os.environ['INTERNAL_SERVICE_TOKEN']}); print(urllib.request.urlopen(r,timeout=300).status)\""
    else:
        command = 'cd /opt/nimbusvault && bash deployment/backup-linux.sh'
    response = ssm.send_command(InstanceIds=[instance_id], DocumentName='AWS-RunShellScript',
                                Parameters={'commands': [command]}, TimeoutSeconds=600)
    command_id = response['Command']['CommandId']
    deadline = time.monotonic() + 620
    while time.monotonic() < deadline:
        try:
            result = ssm.get_command_invocation(CommandId=command_id, InstanceId=instance_id)
        except ssm.exceptions.InvocationDoesNotExist:
            time.sleep(2)
            continue
        if result['Status'] not in ['Pending', 'InProgress', 'Delayed']:
            print(json.dumps({'operation': args.operation, 'status': result['Status'], 'command_id': command_id}))
            raise SystemExit(0 if result['Status'] == 'Success' else 1)
        time.sleep(2)
    raise SystemExit('Bounded SSM operation timed out; inspect the recorded command')
