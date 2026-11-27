"""Launch the single approved Session A instance and arm the external stop schedule.

Requires .runtime/aws-deployment/authorization.json (explicit user approval).
Refuses if any tagged instance already exists, so lost context cannot duplicate it.
If the independent Scheduler stop cannot be created, the instance is stopped at once.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.runtime/aws-deployment'
auth = json.loads((PRIVATE / 'authorization.json').read_text())
proposal = json.loads((PRIVATE / 'resource-proposal.json').read_text())
ledger_path = PRIVATE / 'resource-ledger.json'
ledger = json.loads(ledger_path.read_text())
assert auth['approved'] is True and proposal['status'] == 'APPROVED_SESSION_A'
TAG = auth['deployment_id']
session = boto3.Session(profile_name='default', region_name='ap-southeast-2')
cfg = Config(retries={'max_attempts': 5, 'mode': 'standard'}, connect_timeout=10, read_timeout=30)
ec2 = session.client('ec2', config=cfg)
scheduler = session.client('scheduler', config=cfg)
account = session.client('sts', config=cfg).get_caller_identity()['Account']
plan = session.client('freetier', region_name='us-east-1', config=cfg).get_account_plan_state()
credits = float(plan['accountPlanRemainingCredits']['amount'])
if not (plan['accountPlanType'] == 'FREE' and plan['accountPlanStatus'] == 'ACTIVE'
        and plan['accountPlanRemainingCredits']['unit'] == 'USD' and credits > 20
        and plan['accountPlanExpirationDate'] > datetime.now(timezone.utc)):
    raise SystemExit('Free-plan guard failed; nothing launched')
existing = ec2.describe_instances(Filters=[
    {'Name': 'tag:NimbusVaultDeployment', 'Values': [TAG]},
    {'Name': 'instance-state-name', 'Values': ['pending', 'running', 'stopping', 'stopped']}])['Reservations']
if existing:
    raise SystemExit('A tagged instance already exists; refusing to create a duplicate')

launch = datetime.now(timezone.utc).replace(microsecond=0)
host_deadline = launch + timedelta(minutes=225)   # on-instance absolute deadline (instance tag)
external_stop = launch + timedelta(minutes=230)   # independent Scheduler stop
session_end = launch + timedelta(hours=4)         # approved maximum runtime
iso = lambda d: d.strftime('%Y-%m-%dT%H:%M:%SZ')
tags = [{'Key': 'NimbusVaultDeployment', 'Value': TAG}, {'Key': 'Name', 'Value': 'nimbusvault-ec2-demo'},
        {'Key': 'NimbusStopDeadline', 'Value': iso(host_deadline)},
        {'Key': 'NimbusAuthorization', 'Value': auth['authorization_id']}]
security_group = next(r['id'] for r in ledger['created'] if r['type'] == 'security-group')
user_data = (ROOT / 'deployment/bootstrap-guard.sh').read_text().replace('\r\n', '\n')
instance = ec2.run_instances(
    ImageId=proposal['ami']['ImageId'], InstanceType='m7i-flex.large', MinCount=1, MaxCount=1,
    SubnetId=proposal['subnet_id'], SecurityGroupIds=[security_group],
    IamInstanceProfile={'Name': proposal['instance_profile_name']},
    InstanceInitiatedShutdownBehavior='stop', UserData=user_data,
    MetadataOptions={'HttpTokens': 'required', 'HttpPutResponseHopLimit': 2,
                     'HttpEndpoint': 'enabled', 'InstanceMetadataTags': 'enabled'},
    BlockDeviceMappings=[{'DeviceName': proposal['ami']['RootDeviceName'], 'Ebs': {
        'VolumeSize': 30, 'VolumeType': 'gp3', 'Encrypted': True, 'DeleteOnTermination': True}}],
    TagSpecifications=[{'ResourceType': 'instance', 'Tags': tags},
                       {'ResourceType': 'volume', 'Tags': tags[:2]}],
)['Instances'][0]
instance_id = instance['InstanceId']
ledger['created'].append({'type': 'ec2-instance', 'id': instance_id, 'launched_at': iso(launch)})
ledger_path.write_text(json.dumps(ledger, indent=2))
print('launched', instance_id, iso(launch))

try:
    arn = scheduler.create_schedule(
        Name='nimbusvault-ec2-stop-20261127', GroupName='default',
        ScheduleExpression='at(' + external_stop.strftime('%Y-%m-%dT%H:%M:%S') + ')',
        ScheduleExpressionTimezone='UTC', FlexibleTimeWindow={'Mode': 'OFF'}, State='ENABLED',
        ActionAfterCompletion='NONE', Description='Independent stop of the approved NimbusVault Session A instance',
        Target={'Arn': 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances',
                'RoleArn': f'arn:aws:iam::{account}:role/{proposal["safety_role_name"]}',
                'Input': json.dumps({'InstanceIds': [instance_id]}),
                'RetryPolicy': {'MaximumRetryAttempts': 3, 'MaximumEventAgeInSeconds': 600}},
    )['ScheduleArn']
except Exception as error:
    ec2.stop_instances(InstanceIds=[instance_id])
    raise SystemExit(f'Scheduler stop could not be armed ({type(error).__name__}); instance stop requested')
ledger['created'].append({'type': 'scheduler-schedule', 'name': 'nimbusvault-ec2-stop-20261127', 'at': iso(external_stop)})
ledger_path.write_text(json.dumps(ledger, indent=2))

auth.update({'expires_at': iso(external_stop), 'session_end': iso(session_end), 'launched_at': iso(launch),
             'initial_credits_usd': credits})
(PRIVATE / 'authorization.json').write_text(json.dumps(auth, indent=2))
(PRIVATE / 'approved-instance.json').write_text(json.dumps({
    'approved': True, 'region': 'ap-southeast-2', 'account_id': account, 'instance_id': instance_id,
    'deployment_id': TAG, 'external_stop_schedule_arn': arn, 'stop_deadline': iso(external_stop),
    'stop_authorization_id': auth['authorization_id'], 'host_deadline': iso(host_deadline)}, indent=2))
print(json.dumps({'instance_id': instance_id, 'host_deadline': iso(host_deadline),
                  'external_stop': iso(external_stop), 'session_end': iso(session_end), 'credits': credits}))
