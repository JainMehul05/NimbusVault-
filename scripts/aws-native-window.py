"""Bounded native AWS workflow rehearsal for approved Session A (one window of 15 minutes or less).

1. Preconditions: rule DISABLED, mapping Disabled, ingestion queue empty twice, no running executions.
2. Arm two independent one-time Scheduler restores (rule disable, mapping disable) at +15 min BEFORE enabling.
3. Enable mapping and rule, wait until effective.
4. Upload the hash-approved canary through the EC2 application (genuine S3 PutObject).
5. Trace the native event: Step Functions execution, DynamoDB job, Lambda logs/metrics.
6. Restore idle (disable rule, disable mapping) in a finally block and verify, regardless of outcome.
Never sends messages to SQS, never receives/purges queues, never touches the DLQ.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.runtime/aws-deployment'
RULE, MAPPING = 'cloudvault-v3-dev-uploads', '95cd8e63-6d36-46b0-b928-29bf1aed1af7'
session = boto3.Session(profile_name='default', region_name='ap-southeast-2')
cfg = Config(retries={'max_attempts': 5, 'mode': 'standard'}, read_timeout=30)
events, lam, sqs = session.client('events', config=cfg), session.client('lambda', config=cfg), session.client('sqs', config=cfg)
sfn, ddb, sch = session.client('stepfunctions', config=cfg), session.client('dynamodb', config=cfg), session.client('scheduler', config=cfg)
logs, cw = session.client('logs', config=cfg), session.client('cloudwatch', config=cfg)
account = session.client('sts').get_caller_identity()['Account']
iso = lambda d=None: (d or datetime.now(timezone.utc)).strftime('%Y-%m-%dT%H:%M:%SZ')
evidence = {'environment': 'actual_aws_native_workflow_from_ec2_application', 'timeline': [], 'restored': {}}
out = PRIVATE / os.environ.get('NIMBUS_NATIVE_REPORT', 'ec2-native-workflow.json')


def note(event, **detail):
    evidence['timeline'].append({'at': iso(), 'event': event, **detail})
    print(iso(), event, json.dumps(detail, default=str)[:300])
    out.write_text(json.dumps(evidence, indent=2, default=str))


queue = sqs.get_queue_url(QueueName='cloudvault-v3-dev-ingestion')['QueueUrl']
dlq = sqs.get_queue_url(QueueName='cloudvault-v3-dev-dlq')['QueueUrl']
machine = f'arn:aws:states:ap-southeast-2:{account}:stateMachine:cloudvault-v3-dev-workflow'


def depth(url):
    a = sqs.get_queue_attributes(QueueUrl=url, AttributeNames=['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'])['Attributes']
    return int(a['ApproximateNumberOfMessages']), int(a['ApproximateNumberOfMessagesNotVisible'])


rule_state = events.describe_rule(Name=RULE)['State']
mapping_state = lam.get_event_source_mapping(UUID=MAPPING)['State']
first = depth(queue); time.sleep(10); second = depth(queue)
running = sfn.list_executions(stateMachineArn=machine, statusFilter='RUNNING')['executions']
dlq_before = depth(dlq)
note('preconditions', rule=rule_state, mapping=mapping_state, queue=[first, second], running=len(running), dlq=dlq_before)
if rule_state != 'DISABLED' or mapping_state != 'Disabled' or first != (0, 0) or second != (0, 0) or running:
    raise SystemExit('Preconditions not met; window not opened')

opened = datetime.now(timezone.utc).replace(microsecond=0)
restore_at = opened + timedelta(minutes=15)
role = f'arn:aws:iam::{account}:role/nimbusvault-ec2-safety-20261127'
for name, target, payload in [
        ('nimbusvault-restore-rule-20261127', 'arn:aws:scheduler:::aws-sdk:eventbridge:disableRule', {'Name': RULE}),
        ('nimbusvault-restore-consumer-20261127', 'arn:aws:scheduler:::aws-sdk:lambda:updateEventSourceMapping',
         {'Uuid': MAPPING, 'Enabled': False})]:
    try:
        sch.delete_schedule(Name=name, GroupName='default')  # only our own Session A schedule names
    except sch.exceptions.ResourceNotFoundException:
        pass
    sch.create_schedule(Name=name, GroupName='default', ScheduleExpression='at(' + restore_at.strftime('%Y-%m-%dT%H:%M:%S') + ')',
                        ScheduleExpressionTimezone='UTC', FlexibleTimeWindow={'Mode': 'OFF'}, State='ENABLED',
                        ActionAfterCompletion='NONE', Description='Independent idle restoration for NimbusVault Session A',
                        Target={'Arn': target, 'RoleArn': role, 'Input': json.dumps(payload),
                                'RetryPolicy': {'MaximumRetryAttempts': 3, 'MaximumEventAgeInSeconds': 600}})
    note('restore_schedule_armed', name=name, at=iso(restore_at))
ledger = json.loads((PRIVATE / 'resource-ledger.json').read_text())
ledger['created'] += [{'type': 'scheduler-schedule', 'name': n, 'at': iso(restore_at)} for n in
                      ['nimbusvault-restore-rule-20261127', 'nimbusvault-restore-consumer-20261127']]
ledger['modified'] += [{'resource': RULE, 'change': 'temporarily ENABLED', 'window_opened': iso(opened)},
                       {'resource': MAPPING, 'change': 'temporarily Enabled', 'window_opened': iso(opened)}]
(PRIVATE / 'resource-ledger.json').write_text(json.dumps(ledger, indent=2))

try:
    lam.update_event_source_mapping(UUID=MAPPING, Enabled=True)
    for _ in range(60):
        if lam.get_event_source_mapping(UUID=MAPPING)['State'] == 'Enabled':
            break
        time.sleep(5)
    events.enable_rule(Name=RULE)
    note('window_open', rule=events.describe_rule(Name=RULE)['State'], mapping=lam.get_event_source_mapping(UUID=MAPPING)['State'])
    upload_started = datetime.now(timezone.utc)
    label = os.environ.get('NIMBUS_NATIVE_LABEL', 'canary')
    subprocess.run([sys.executable, str(ROOT / 'scripts/verify-ec2-application.py'), 'upload', label], check=True)
    state = json.loads((PRIVATE / 'ec2-acceptance-state.json').read_text())
    file_id = state['files'][label]['id']
    note('canary_uploaded_via_ec2', file_id=file_id)
    execution = None
    for _ in range(60):
        for item in sfn.list_executions(stateMachineArn=machine, maxResults=10)['executions']:
            if item['startDate'] >= upload_started - timedelta(seconds=5):
                detail = sfn.describe_execution(executionArn=item['executionArn'])
                if json.loads(detail['input']).get('file_id') == file_id:
                    execution = detail
        if execution and execution['status'] != 'RUNNING':
            break
        time.sleep(5)
        if execution:
            execution = sfn.describe_execution(executionArn=execution['executionArn'])
    if not execution:
        note('no_native_execution_observed')
    else:
        history = sfn.get_execution_history(executionArn=execution['executionArn'], maxResults=200)['events']
        note('step_functions_execution', name=execution['name'], status=execution['status'],
             started=execution['startDate'], stopped=execution.get('stopDate'),
             states=[e['stateEnteredEventDetails']['name'] for e in history if 'stateEnteredEventDetails' in e],
             input_keys=sorted(json.loads(execution['input'])))
        job = ddb.get_item(TableName='cloudvault-v3-dev', Key={'pk': {'S': 'WORKSPACE#default'}, 'sk': {'S': 'JOB#' + execution['name']}})
        payload = json.loads(job['Item']['payload']['S']) if 'Item' in job else {}
        note('dynamodb_job', state=job.get('Item', {}).get('state', {}).get('S'), cloud_extraction=payload.get('cloud_extraction'),
             sha256_matches=payload.get('sha256') == state['files'][label]['sha256'], history=[h['stage'] for h in payload.get('history', [])],
             artifact_key_prefix=(payload.get('artifact_key') or '')[:20])
        evidence['execution_name'] = execution['name']
    evidence['file_id'] = file_id
finally:
    events.disable_rule(Name=RULE)
    lam.update_event_source_mapping(UUID=MAPPING, Enabled=False)
    for _ in range(60):
        if lam.get_event_source_mapping(UUID=MAPPING)['State'] == 'Disabled':
            break
        time.sleep(5)
    closed = datetime.now(timezone.utc)
    evidence['restored'] = {'rule': events.describe_rule(Name=RULE)['State'],
                            'mapping': lam.get_event_source_mapping(UUID=MAPPING)['State'],
                            'window_minutes': round((closed - opened).total_seconds() / 60, 2),
                            'queue_after': depth(queue), 'dlq_after': depth(dlq), 'dlq_before': dlq_before}
    note('window_closed_idle_restored', **evidence['restored'])

end = datetime.now(timezone.utc)
streams = logs.describe_log_streams(logGroupName='/aws/lambda/cloudvault-v3-dev-worker', orderBy='LastEventTime', descending=True, limit=3)['logStreams']
log_events = logs.filter_log_events(logGroupName='/aws/lambda/cloudvault-v3-dev-worker', startTime=int(opened.timestamp() * 1000))['events']
reports = [e['message'].strip() for e in log_events if e['message'].startswith('REPORT')]
note('cloudwatch_logs', events=len(log_events), lambda_reports=len(reports), sample_report=reports[0][:160] if reports else None,
     latest_stream_at=streams[0].get('lastEventTimestamp') if streams else None)
note('metrics_note', detail='CloudWatch Lambda metrics are published with a delay; collected after the window by a later read')
