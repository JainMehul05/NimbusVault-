"""Generate a reviewable, scoped role proposal locally. This script makes NO AWS calls."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
target = ROOT / '.runtime/aws-deployment'
discovery = json.loads((target / 'discovery.json').read_text())
resources = json.loads((ROOT / '.runtime/cloud-resources.json').read_text(encoding='utf-8-sig'))
account = discovery['identity']['Account']
region = 'ap-southeast-2'
outputs = resources['serverless_outputs']
env = dict(line.split('=', 1) for line in (ROOT / '.env').read_text().splitlines() if '=' in line)
bucket = env['S3_BUCKET']
role = 'nimbusvault-ec2-demo-20261127'
prefix = 'cloudvault/deployment/nimbus/20261127/'
statements = []


def allow(sid, actions, arns, **extra):
    statements.append({'Sid': sid, 'Effect': 'Allow', 'Action': actions, 'Resource': arns, **extra})


allow('AccountIdentityAndPlan', ['sts:GetCallerIdentity', 'freetier:GetAccountPlanState'], '*')
allow('ExistingBucketDiagnostics', ['s3:GetBucketLocation', 's3:GetEncryptionConfiguration',
      's3:GetBucketPublicAccessBlock', 's3:ListBucket'], f'arn:aws:s3:::{bucket}')
allow('ManagedOriginalReadWrite', ['s3:GetObject', 's3:PutObject'], [
    f'arn:aws:s3:::{bucket}/cloudvault/files/*',
    f'arn:aws:s3:::{bucket}/cloudvault/staging/nimbus/*'])
allow('DerivedRead', ['s3:GetObject'], f'arn:aws:s3:::{bucket}/cloudvault/derived/*')
allow('DeploymentDownloadOnly', ['s3:GetObject'], f'arn:aws:s3:::{bucket}/{prefix}*')
allow('ExistingMetadata', ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query',
      'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DescribeTable'],
      f"arn:aws:dynamodb:{region}:{account}:table/{resources['table']}")
allow('RestrictedVectorRead', ['s3vectors:GetIndex', 's3vectors:QueryVectors',
      's3vectors:GetVectors', 's3vectors:ListVectors'],
      f"arn:aws:s3vectors:{region}:{account}:bucket/{resources['vector_bucket']}/index/{resources['vector_index']}")
allow('SignedStatusRoute', ['execute-api:Invoke'],
      f"arn:aws:execute-api:{region}:{account}:{outputs['ApiId']}/*/GET/status")
allow('ExistingFunctionRead', ['lambda:GetFunctionConfiguration'],
      f"arn:aws:lambda:{region}:{account}:function:{outputs['FunctionName']}")
allow('ExistingConsumerRead', ['lambda:GetEventSourceMapping'],
      f"arn:aws:lambda:{region}:{account}:event-source-mapping:{outputs['MappingId']}")
allow('ExistingRuleRead', ['events:DescribeRule', 'events:ListTargetsByRule'],
      f'arn:aws:events:{region}:{account}:rule/cloudvault-v3-dev-uploads')
allow('ExistingApiConfiguration', ['apigateway:GET'],
      [f"arn:aws:apigateway:{region}::/apis/{outputs['ApiId']}",
       f"arn:aws:apigateway:{region}::/apis/{outputs['ApiId']}/*"])
parameters = json.loads((target / 'existing-queues-parameters.json').read_text())['parameter_names']
parameter_arns = [f'arn:aws:ssm:{region}:{account}:parameter/' + name.lstrip('/') for name in parameters]
allow('ExistingStandardParameters', ['ssm:GetParameter', 'ssm:GetParameters'],
      parameter_arns)
# AmazonSSMManagedInstanceCore also permits parameter reads. Explicitly bound
# those inherited permissions so the application role cannot read other secrets.
statements.append({'Sid': 'NoUnrelatedParameterReads', 'Effect': 'Deny',
    'Action': ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
    'NotResource': parameter_arns})
allow('ExistingStackRead', ['cloudformation:DescribeStacks', 'cloudformation:ListStackResources',
      'cloudformation:GetTemplate'], f'arn:aws:cloudformation:{region}:{account}:stack/cloudvault-v3-dev/*')
allow('ExistingWorkflowRead', ['states:DescribeStateMachine', 'states:ListExecutions'], outputs['WorkflowArn'])
allow('ExistingExecutionRead', ['states:DescribeExecution', 'states:GetExecutionHistory'],
      outputs['WorkflowArn'].replace(':stateMachine:', ':execution:') + ':*')
allow('ExistingQueuesReadOnly', ['sqs:GetQueueAttributes', 'sqs:GetQueueUrl'], [
    outputs['QueueArn'], outputs['QueueArn'].rsplit(':', 1)[0] + ':' + outputs['DlqUrl'].rsplit('/', 1)[1]])
allow('ExistingLogRead', ['logs:DescribeLogStreams', 'logs:GetLogEvents', 'logs:FilterLogEvents'],
      f"arn:aws:logs:{region}:{account}:log-group:/aws/lambda/{outputs['FunctionName']}:*")
# These list/metric operations have no applicable resource-level ARN support.
allow('RegionalReadOnlyDiagnostics', ['cloudwatch:GetMetricStatistics', 'cloudwatch:ListMetrics',
      'lambda:ListEventSourceMappings', 'logs:DescribeLogGroups',
      'ec2:DescribeInstances', 'ec2:DescribeVolumes', 'ec2:DescribeSecurityGroups'], '*',
      Condition={'StringEquals': {'aws:RequestedRegion': region}})
statements.extend([
    {'Sid': 'NeverUpgradeOrProvision', 'Effect': 'Deny',
     'Action': ['freetier:UpgradeAccountPlan', 'ec2:RunInstances', 'iam:CreateRole',
                'iam:PutRolePolicy', 'cloudformation:CreateStack', 'cloudformation:UpdateStack'],
     'Resource': '*'},
    {'Sid': 'NeverDeletePreservedData', 'Effect': 'Deny',
     'Action': ['s3:DeleteObject', 's3:DeleteObjectVersion', 'dynamodb:DeleteItem',
                's3vectors:DeleteVectors', 'sqs:PurgeQueue', 'sqs:DeleteMessage'], 'Resource': '*'},
    {'Sid': 'OriginalsMustBeCreateOnly', 'Effect': 'Deny', 'Action': 's3:PutObject',
     'Resource': f'arn:aws:s3:::{bucket}/cloudvault/files/*',
     'Condition': {'StringNotEquals': {'s3:if-none-match': '*'}}},
])
policy = {'Version': '2012-10-17', 'Statement': statements}
(target / 'runtime-policy-draft.json').write_text(json.dumps(policy, indent=2))
(target / 'role-trust.json').write_text(json.dumps({'Version': '2012-10-17', 'Statement': [{
    'Effect': 'Allow', 'Principal': {'Service': 'ec2.amazonaws.com'}, 'Action': 'sts:AssumeRole'}]}, indent=2))
subnet = next(s for s in discovery['checks']['subnets']['result']['Subnets']
              if s['DefaultForAz'] and s['MapPublicIpOnLaunch'])
ami = discovery['checks']['ubuntu_24_04']['result'][0]
proposal = {'status': 'DRAFT_NOT_AUTHORIZED', 'resources_created': [],
            'region': region, 'role_name': role, 'instance_profile_name': role,
            'security_group_name': 'nimbusvault-ec2-demo', 'vpc_id': subnet['VpcId'],
            'subnet_id': subnet['SubnetId'], 'availability_zone': subnet['AvailabilityZone'],
            'ami': {k: ami[k] for k in ['ImageId', 'Name', 'OwnerId', 'Architecture', 'RootDeviceName']},
            'instance_type': 'm7i-flex.large', 'instances': 1, 'ebs_gib_proposed': 30,
            'storage_type': 'gp3', 'encrypted': True, 'public_ipv4': 'auto-assigned; no Elastic IP',
            'ingress': [], 'egress': [{'protocol': 'tcp', 'port': 443, 'destination': '0.0.0.0/0'}],
            'metadata': {'HttpTokens': 'required', 'HttpPutResponseHopLimit': 2},
            'max_session_hours_proposed': 4, 'boot_stop_timer_minutes': 225,
            'max_credit_consumption_usd_proposed': 10, 'minimum_credit_reserve_usd': 10,
            'source_transfer_prefix': prefix, 'bucket': bucket,
            'ssm_core_policy': 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
            'instance_role_privileges_pending': [],
            'safety_role_name': 'nimbusvault-ec2-safety-20261127',
            'scheduler_resources_requiring_explicit_approval': [
                'nimbusvault-ec2-stop-20261127', 'nimbusvault-restore-rule-20261127',
                'nimbusvault-restore-consumer-20261127'],
            'external_stop_minutes_after_approval_start': 230,
            'restore_schedule_minutes_after_native_window_start': 15,
            'scheduler_retry_limit': 1,
            'synthetic_writes_proposed': {'original_objects_max': 3, 'max_total_original_bytes': 1048576,
                 'workflow_executions_max': 3, 'restricted_vector_queries_max': 5,
                 'vector_uploads': 0, 'legacy_object_overwrites_or_deletions': 0,
                 'dlq_receives_or_failure_injection': 0},
            'public_https': False, 'personal_credentials_transferred': False}
(target / 'resource-proposal.json').write_text(json.dumps(proposal, indent=2))
print('Local role/network/resource draft generated. No AWS resources created or modified.')
