"""Read-only IAM custom-policy simulation; never creates or attaches a policy."""
import json
from pathlib import Path

import boto3
from botocore.config import Config

root = Path(__file__).resolve().parents[1]
private = root / '.runtime/aws-deployment'
proposal = json.loads((private / 'resource-proposal.json').read_text())
policy = json.loads((private / 'runtime-policy-draft.json').read_text())
parameters = next(s['Resource'] for s in policy['Statement'] if s.get('Sid') == 'ExistingStandardParameters')
iam = boto3.Session(profile_name='default').client('iam', config=Config(
    connect_timeout=4, read_timeout=12, retries={'max_attempts': 1}))
bucket = 'arn:aws:s3:::' + proposal['bucket'] + '/cloudvault/files/synthetic-policy-check/a.txt'
checks = [
    ('deny_upgrade', 'freetier:UpgradeAccountPlan', '*', 'explicitDeny', []),
    ('deny_arbitrary_launch', 'ec2:RunInstances', '*', 'explicitDeny', []),
    ('deny_original_delete', 's3:DeleteObject', bucket, 'explicitDeny', []),
    ('deny_unconditional_overwrite', 's3:PutObject', bucket, 'explicitDeny', []),
    ('allow_create_only_put', 's3:PutObject', bucket, 'allowed', [
        {'ContextKeyName': 's3:if-none-match', 'ContextKeyValues': ['*'], 'ContextKeyType': 'string'}]),
    ('allow_exact_parameter', 'ssm:GetParameter', parameters[0], 'allowed', []),
    ('deny_other_parameter', 'ssm:GetParameter', parameters[0] + '/unrelated', 'explicitDeny', []),
]
# Simulate inherited SSM-core broad GetParameter as well: explicit deny must win.
inherited = {'Version': '2012-10-17', 'Statement': [
    {'Effect': 'Allow', 'Action': 'ssm:GetParameter', 'Resource': '*'}]}
report = {'kind': 'READ_ONLY_SIMULATION', 'mutations': [], 'checks': {}}
for name, action, resource, expected, context in checks:
    response = iam.simulate_custom_policy(PolicyInputList=[json.dumps(policy), json.dumps(inherited)],
        ActionNames=[action], ResourceArns=[resource], ContextEntries=context)
    decision = response['EvaluationResults'][0]['EvalDecision']
    report['checks'][name] = {'decision': decision, 'expected': expected, 'pass': decision == expected}
(private / 'iam-policy-final.json').write_text(json.dumps(report, indent=2))
assert all(c['pass'] for c in report['checks'].values()), report
print('Seven scoped IAM simulations passed. No policy or resource was created or modified.')
