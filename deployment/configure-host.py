"""Generate EC2-only secrets on the approved host, with cloud operations initially disabled."""
import json
import os
import secrets
import shutil
from pathlib import Path

root = Path('/opt/nimbusvault')
private = Path('/opt/nimbusvault-private')
if Path('/sys/devices/virtual/dmi/id/sys_vendor').read_text().strip() != 'Amazon EC2':
    raise SystemExit('EC2 host required')
approval = json.loads((private / 'authorized-instance.json').read_text())
if approval.get('approved') is not True or approval.get('region') != 'ap-southeast-2':
    raise SystemExit('Exact approved instance manifest required')
os.umask(0o077)
private.mkdir(mode=0o700, exist_ok=True)
environment = private / 'container.env'
if environment.exists():
    raise SystemExit('Existing secrets preserved; use explicit maintenance rather than regenerating')
password = secrets.token_hex(32)
values = {
    'DATABASE_URL': f'postgresql://nimbusvault:{password}@postgres:5432/nimbusvault?schema=public&connection_limit=8',
    'NIMBUS_DB_PASSWORD': password,
    'JWT_ACCESS_SECRET': secrets.token_hex(48), 'JWT_REFRESH_SECRET': secrets.token_hex(48),
    'INTERNAL_SERVICE_TOKEN': secrets.token_hex(48),
    'NODE_ENV': 'production', 'PORT': '3100', 'API_PREFIX': 'v1',
    'FRONTEND_URL': 'http://127.0.0.1:3200', 'COOKIE_SECURE': 'false',
    'COOKIE_SAMESITE': 'lax', 'REFRESH_COOKIE_NAME': 'nimbusvault_ec2_refresh',
    'SERVE_FRONTEND': 'true', 'BCRYPT_ROUNDS': '12', 'TRUST_PROXY': 'false',
    'INTELLIGENCE_ENABLED': 'true', 'AWS_REGION': 'ap-southeast-2',
    'AWS_EXPECTED_ACCOUNT': approval['account_id'], 'AWS_AUTH_MODE': 'instance-role',
    'AWS_MIN_CREDIT_RESERVE_USD': '10', 'AWS_OPERATIONS_ENABLED': 'false',
    'AWS_WRITES_ENABLED': 'false', 'AWS_EC2_METADATA_DISABLED': 'false',
    'AWS_S3_BUCKET': approval['bucket'], 'S3_BUCKET': approval['bucket'],
    'NIMBUS_LOCAL_RETRIEVAL': 'true', 'RUNTIME_MODE': 'container',
    'EMBEDDING_CACHE_DIR': '.runtime/standalone-ai/embedding-cache',
    'LLM_URL': 'http://ollama:11434', 'LLM_TIMEOUT': '180', 'LLM_THREADS': '2',
    'LLM_CORRECTION_TIMEOUT': '90', 'INTELLIGENCE_TIMEOUT_MS': '300000',
    'AI_WORKER_ENABLED': 'true', 'AI_WORKER_CONCURRENCY': '1',
    'AI_EMBEDDING_PROVIDER': 'none', 'AI_GENERATION_PROVIDER': 'none',
    'MAINTENANCE_ENABLED': 'false', 'TRASH_RETENTION_DAYS': '0', 'MAX_FILE_BYTES': '26214400',
}
environment.write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
intelligence_environment = private / 'intelligence.env'
allowed = {k: v for k, v in values.items() if k.startswith(('AWS_', 'LLM_')) or k in {
    'S3_BUCKET', 'INTERNAL_SERVICE_TOKEN', 'NIMBUS_LOCAL_RETRIEVAL', 'RUNTIME_MODE', 'EMBEDDING_CACHE_DIR'}}
intelligence_environment.write_text(''.join(f'{k}={v}\n' for k, v in allowed.items()))
configuration = private / 'configuration'
configuration.mkdir(mode=0o755)
for name in ['cloud-config.json', 'cloud-resources.json', 'vector-demo.json']:
    shutil.copyfile(root / 'deployment/configuration' / name, configuration / name)
    # Resource IDs and synthetic canary IDs are not secrets; unprivileged service
    # users must be able to read these particular bind-mounted files.
    os.chmod(configuration / name, 0o644)
compose = {'DEPLOYMENT_ENV_FILE': str(environment), 'INTELLIGENCE_ENV_FILE': str(intelligence_environment),
           'MODEL_ASSETS_DIR': '/opt/nimbusvault/model-assets',
           'CLOUD_CONFIGURATION_DIR': str(configuration), 'HOST_APP_PORT': '3100', **values}
(private / 'compose.env').write_text(''.join(f'{k}={v}\n' for k, v in compose.items()))
(root / 'SOURCE_CHECKPOINT').write_text(approval['source_commit'] + '\n')
print('Isolated host secrets generated privately; cloud operations and writes remain disabled.')
