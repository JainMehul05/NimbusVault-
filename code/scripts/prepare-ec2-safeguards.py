"""Write local safety-role and schedule drafts. No AWS calls or authorization."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
private = root / '.runtime/aws-deployment'
proposal = json.loads((private / 'resource-proposal.json').read_text())
discovery = json.loads((private / 'discovery.json').read_text())
resources = json.loads((root / '.runtime/cloud-resources.json').read_text(encoding='utf-8-sig'))
account = discovery['identity']['Account']
region = proposal['region']
outputs = resources['serverless_outputs']
names = proposal['scheduler_resources_requiring_explicit_approval']
schedules = [f'arn:aws:scheduler:{region}:{account}:schedule/default/{name}' for name in names]
role = f"arn:aws:iam::{account}:role/{proposal['safety_role_name']}"
trust = {'Version': '2012-10-17', 'Statement': [{
    'Effect': 'Allow', 'Principal': {'Service': 'scheduler.amazonaws.com'},
    'Action': 'sts:AssumeRole', 'Condition': {
        'StringEquals': {'aws:SourceAccount': account},
        'ArnEquals': {'aws:SourceArn': f'arn:aws:scheduler:{region}:{account}:schedule-group/default'}}}]}
policy = {'Version': '2012-10-17', 'Statement': [
    {'Sid': 'StopOnlyApprovedTaggedInstance', 'Effect': 'Allow', 'Action': 'ec2:StopInstances',
     'Resource': f'arn:aws:ec2:{region}:{account}:instance/INSTANCE_ID_AFTER_EXPLICIT_APPROVAL',
     'Condition': {'StringEquals': {'ec2:ResourceTag/NimbusVaultDeployment': 'nimbusvault-ec2-demo-20261127'}}},
    {'Sid': 'RestoreOnlyExistingUploadRule', 'Effect': 'Allow', 'Action': 'events:DisableRule',
     'Resource': f'arn:aws:events:{region}:{account}:rule/cloudvault-v3-dev-uploads'},
    {'Sid': 'RestoreOnlyExistingConsumer', 'Effect': 'Allow', 'Action': 'lambda:UpdateEventSourceMapping',
     'Resource': f"arn:aws:lambda:{region}:{account}:event-source-mapping:{outputs['MappingId']}"}]}
targets = [
    ('ec2:stopInstances', {'InstanceIds': ['INSTANCE_ID_AFTER_EXPLICIT_APPROVAL']}),
    ('eventbridge:disableRule', {'Name': 'cloudvault-v3-dev-uploads'}),
    ('lambda:updateEventSourceMapping', {'Uuid': outputs['MappingId'], 'Enabled': False})]
drafts = []
for name, arn, (operation, payload) in zip(names, schedules, targets):
    drafts.append({'Name': name, 'ArnForReview': arn, 'GroupName': 'default',
        'ScheduleExpression': 'at(ABSOLUTE_UTC_DEADLINE_AFTER_EXPLICIT_APPROVAL)',
        'ScheduleExpressionTimezone': 'UTC', 'FlexibleTimeWindow': {'Mode': 'OFF'},
        'State': 'ENABLED', 'ActionAfterCompletion': 'NONE',
        'Target': {'Arn': 'arn:aws:scheduler:::aws-sdk:' + operation,
                   'RoleArn': role, 'Input': json.dumps(payload),
                   'RetryPolicy': {'MaximumRetryAttempts': 1, 'MaximumEventAgeInSeconds': 60}}})
for name, content in [('safety-role-trust.json', trust), ('safety-role-policy-draft.json', policy),
                      ('safety-schedule-drafts.json', drafts)]:
    (private / name).write_text(json.dumps(content, indent=2))
print('Three local drafts written. Placeholders intentionally prevent execution; no AWS calls made.')
