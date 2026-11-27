"""Prepare an isolated local Linux rehearsal; no private data or AWS credentials copied."""
import json
import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
target = ROOT / '.runtime/aws-deployment/local'
target.mkdir(parents=True, exist_ok=True)
discovery = json.loads((target.parent / 'discovery.json').read_text())
account = discovery['identity']['Account']
configuration = target / 'configuration'
configuration.mkdir(exist_ok=True)
resources = json.loads((ROOT / '.runtime/cloud-resources.json').read_text(encoding='utf-8-sig'))
config = json.loads((ROOT / '.runtime/cloud-config.json').read_text(encoding='utf-8-sig'))
resources = {k: resources[k] for k in ['region', 'table', 'vector_bucket', 'vector_index', 'stack', 'serverless_outputs']}
(configuration / 'cloud-resources.json').write_text(json.dumps(resources, indent=2))
(configuration / 'cloud-config.json').write_text(json.dumps(config, indent=2))
(configuration / 'vector-demo.json').write_bytes((ROOT / '.runtime/vector-demo.json').read_bytes())
environment = target / 'container.env'
if not environment.exists():
    password = secrets.token_hex(32)
    values = {
        'DATABASE_URL': f'postgresql://nimbusvault:{password}@postgres:5432/nimbusvault?schema=public&connection_limit=8',
        'NIMBUS_DB_PASSWORD': password,
        'JWT_ACCESS_SECRET': secrets.token_hex(48), 'JWT_REFRESH_SECRET': secrets.token_hex(48),
        'INTERNAL_SERVICE_TOKEN': secrets.token_hex(48),
        'NODE_ENV': 'production', 'PORT': '3100', 'API_PREFIX': 'v1',
        'FRONTEND_URL': 'http://127.0.0.1:33100', 'COOKIE_SECURE': 'false',
        'COOKIE_SAMESITE': 'lax', 'SERVE_FRONTEND': 'true', 'BCRYPT_ROUNDS': '12',
        'REFRESH_COOKIE_NAME': 'nimbusvault_ec2_refresh',
        'TRUST_PROXY': 'false', 'INTELLIGENCE_ENABLED': 'true',
        'AWS_REGION': 'ap-southeast-2', 'AWS_EXPECTED_ACCOUNT': account,
        'AWS_AUTH_MODE': 'instance-role', 'AWS_MIN_CREDIT_RESERVE_USD': '10',
        'AWS_OPERATIONS_ENABLED': 'false', 'AWS_WRITES_ENABLED': 'false',
        'AWS_EC2_METADATA_DISABLED': 'true',
        'AWS_S3_BUCKET': 'existing-private-bucket-not-used-in-local-rehearsal',
        'S3_BUCKET': 'existing-private-bucket-not-used-in-local-rehearsal',
        'NIMBUS_LOCAL_RETRIEVAL': 'true', 'RUNTIME_MODE': 'container',
        'EMBEDDING_CACHE_DIR': '.runtime/standalone-ai/embedding-cache',
        'LLM_URL': 'http://ollama:11434', 'LLM_TIMEOUT': '180', 'LLM_THREADS': '2',
        'LLM_CORRECTION_TIMEOUT': '90', 'INTELLIGENCE_TIMEOUT_MS': '300000',
        'AI_WORKER_ENABLED': 'true', 'AI_WORKER_CONCURRENCY': '1',
        'AI_EMBEDDING_PROVIDER': 'none', 'AI_GENERATION_PROVIDER': 'none',
        'MAINTENANCE_ENABLED': 'false', 'TRASH_RETENTION_DAYS': '0',
        'MAX_FILE_BYTES': '26214400',
    }
    environment.write_text(''.join(f'{k}={v}\n' for k, v in values.items()), encoding='utf-8')
    os.chmod(environment, 0o600)
all_values = dict(line.split('=', 1) for line in environment.read_text().splitlines())
intelligence_environment = target / 'intelligence.env'
allowed = {k: v for k, v in all_values.items() if k.startswith(('AWS_', 'LLM_')) or k in {
    'S3_BUCKET', 'INTERNAL_SERVICE_TOKEN', 'NIMBUS_LOCAL_RETRIEVAL', 'RUNTIME_MODE', 'EMBEDDING_CACHE_DIR'}}
intelligence_environment.write_text(''.join(f'{k}={v}\n' for k, v in allowed.items()), encoding='utf-8')
os.chmod(intelligence_environment, 0o600)
compose = {
    'DEPLOYMENT_ENV_FILE': environment.as_posix(),
    'INTELLIGENCE_ENV_FILE': intelligence_environment.as_posix(),
    'MODEL_ASSETS_DIR': (ROOT / '.runtime/standalone-ai').as_posix(),
    'CLOUD_CONFIGURATION_DIR': configuration.as_posix(),
    'HOST_APP_PORT': '33100',
    **dict(line.split('=', 1) for line in environment.read_text().splitlines()),
}
(target / 'compose.env').write_text(''.join(f'{k}={v}\n' for k, v in compose.items()), encoding='utf-8')
print('Isolated Linux environment prepared. No Windows user/database/credentials copied; AWS disabled.')
