"""AWS-managed Python runtime handler. No model, credentials or private text logging."""
import datetime
import hashlib
import json
import os
import time
import urllib.parse
from uuid import UUID
import boto3
from botocore.exceptions import ClientError

S3 = boto3.client('s3')
DDB = boto3.client('dynamodb')
SFN = boto3.client('stepfunctions')
BUCKET = os.environ['ORIGINAL_BUCKET']
TABLE = os.environ['METADATA_TABLE']
PREFIX = 'cloudvault/files/'
DERIVED = 'cloudvault/derived/'
WORKFLOW = os.environ['WORKFLOW_ARN']
FIXTURE_SHAS = set(os.environ['APPROVED_FIXTURE_SHA256'].split(','))


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def save_job(job, state):
    payload = {k: v for k, v in job.items() if k not in ('failure', 'text')}
    payload.update(state=state, updated_at=stamp())
    payload['history'] = [*job.get('history', []), {'stage': state, 'at': payload['updated_at']}][-8:]
    DDB.put_item(TableName=TABLE, Item={'pk': {'S': 'WORKSPACE#default'}, 'sk': {'S': job['job_key']}, 'file_id': {'S': job['file_id']}, 'state': {'S': state}, 'payload': {'S': json.dumps(payload)}})
    return {**payload}


def validate_key(bucket, key):
    if bucket != BUCKET or not key.startswith(PREFIX) or '\x00' in key or len(key) > 1024:
        raise ValueError('UnmanagedObject')
    parts = key[len(PREFIX):].split('/')
    if len(parts) != 2 or not parts[1]:
        raise ValueError('InvalidManagedKey')
    UUID(parts[0])
    return parts[0]


def dispatch(message):
    if message.get('Event') == 's3:TestEvent':
        return
    detail = message.get('detail', {})
    bucket = detail.get('bucket', {}).get('name')
    obj = detail.get('object', {})
    key = obj.get('key', '')  # EventBridge keys are raw; S3 notification keys below are encoded.
    if 'Records' in message:
        source = message['Records'][0]['s3']
        bucket = source['bucket']['name']; obj = source['object']
        key = urllib.parse.unquote_plus(obj['key'])
    file_id = validate_key(bucket, key)
    revision = str(obj.get('sequencer') or obj.get('etag') or obj.get('eTag') or message.get('id'))
    name = 'cv-' + hashlib.sha256((key+revision).encode()).hexdigest()[:60]
    job = {'file_id': file_id, 'bucket': bucket, 'key': key, 'event_revision': revision, 'event_etag': obj.get('etag') or obj.get('eTag'), 'job_key': 'JOB#'+name, 'correlation_id': name, 'created_at': stamp()}
    try:
        SFN.start_execution(stateMachineArn=WORKFLOW, name=name, input=json.dumps(job, sort_keys=True))
    except ClientError as error:
        if error.response['Error']['Code'] != 'ExecutionAlreadyExists':
            raise


def stage(action, job):
    validate_key(job['bucket'], job['key'])
    if action == 'validate':
        head = S3.head_object(Bucket=BUCKET, Key=job['key'])
        if job.get('event_etag') and head['ETag'].strip('"') != job['event_etag'].strip('"'):
            raise ValueError('StaleEvent')
        job.update(size=head['ContentLength'], mime=head.get('ContentType', 'application/octet-stream'))
        return save_job(job, 'validated')
    if action == 'extract':
        if job['size'] > 1024*1024:
            job.update(cloud_extraction='local_required_size_limit')
        else:
            result = S3.get_object(Bucket=BUCKET, Key=job['key'])
            try:
                raw = result['Body'].read(1024*1024+1)
            finally:
                result['Body'].close()
            if len(raw) != job['size']:
                raise ValueError('ObjectSizeMismatch')
            digest = hashlib.sha256(raw).hexdigest();job['sha256'] = digest
            # Only the explicitly approved non-sensitive fixture may persist cloud text.
            if digest in FIXTURE_SHAS and len(raw) <= 256*1024:
                text = raw.decode('utf-8-sig')
                artifact = DERIVED + job['file_id']+'/'+digest+'/text.json'
                try:
                    S3.put_object(Bucket=BUCKET, Key=artifact, Body=json.dumps({'file_id': job['file_id'], 'sha256': digest, 'sections': [{'section': 'Content', 'text': text}]}).encode(), ContentType='application/json', ServerSideEncryption='AES256', IfNoneMatch='*')
                except ClientError as error:
                    if error.response['Error']['Code'] not in {'PreconditionFailed', '412'}:
                        raise
                job.update(artifact_key=artifact, cloud_extraction='approved_plain_text')
            else:
                job.update(cloud_extraction='local_required_privacy_scope')
        return save_job(job, 'cloud_extracted_or_classified')
    if action == 'persist':
        return save_job(job, 'cloud_stage_complete')
    if action == 'await_embedding':
        return save_job(job, 'awaiting_local_embedding')
    if action == 'fail':
        job['error_code'] = 'CloudStageFailed'
        return save_job(job, 'failed')
    raise ValueError('UnknownStage')


def api(event):
    path = event.get('rawPath', '')
    if path == '/status':
        body = {'status': 'ok', 'service': 'CloudVault cloud metadata', 'at': stamp()}
    else:
        prefix = 'JOB#' if path == '/jobs' else 'FILE#'
        result = DDB.query(TableName=TABLE, KeyConditionExpression='pk=:pk AND begins_with(sk,:prefix)', ExpressionAttributeValues={':pk': {'S': 'WORKSPACE#default'}, ':prefix': {'S': prefix}}, ConsistentRead=True, Limit=100)
        body = {'items': [json.loads(r['payload']['S']) for r in result['Items']], 'truncated': bool(result.get('LastEvaluatedKey')), 'source': 'dynamodb_via_iam_api'}
    return {'statusCode': 200, 'headers': {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}, 'body': json.dumps(body)}


def handler(event, context):
    started = time.perf_counter()
    correlation = event.get('job', {}).get('correlation_id', 'dispatch')
    try:
        if 'requestContext' in event:
            return api(event)
        if event.get('stage'):
            return stage(event['stage'], event['job'])
        failures = []
        for record in event.get('Records', []):
            try:
                dispatch(json.loads(record['body']))
            except Exception:
                failures.append({'itemIdentifier': record['messageId']})
        return {'batchItemFailures': failures}
    finally:
        print(json.dumps({'correlation_id': correlation, 'stage': event.get('stage', 'dispatch_or_api'), 'duration_ms': round((time.perf_counter()-started)*1000, 2), 'request_id': context.aws_request_id}))
