"""Generate local secrets once; never print them or copy AWS credentials."""
from pathlib import Path
import argparse
import secrets
import shutil
import json

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--embedding-cache')
parser.add_argument('--ollama-binary')
parser.add_argument('--ollama-models')
args = parser.parse_args()
(root/'.runtime').mkdir(exist_ok=True)
(root/'intelligence/data').mkdir(parents=True,exist_ok=True)
env = root/'.env'
if not env.exists():
    password = secrets.token_hex(32)
    values = {
        'NIMBUS_DB_PASSWORD':password,
        'DATABASE_URL':f'postgresql://nimbusvault:{password}@127.0.0.1:55432/nimbusvault?schema=public',
        'JWT_ACCESS_SECRET':secrets.token_hex(32),'JWT_REFRESH_SECRET':secrets.token_hex(32),
        'INTERNAL_SERVICE_TOKEN':secrets.token_hex(32),'INTELLIGENCE_ENABLED':'true',
        'PORT':'3100','FRONTEND_URL':'http://127.0.0.1:3100','COOKIE_SECURE':'false','SERVE_FRONTEND':'true',
        'MAINTENANCE_ENABLED':'false','TRASH_RETENTION_DAYS':'0','AI_WORKER_ENABLED':'true','AI_WORKER_CONCURRENCY':'1',
        'AI_EMBEDDING_PROVIDER':'none','AI_GENERATION_PROVIDER':'none','MAX_FILE_BYTES':'26214400',
        'AWS_PROFILE':'default','AWS_REGION':'ap-southeast-2','AWS_OPERATIONS_ENABLED':'false','AWS_WRITES_ENABLED':'false',
        'NIMBUS_LOCAL_RETRIEVAL':'true',
    }
    if args.embedding_cache: values['EMBEDDING_CACHE_DIR']=args.embedding_cache
    env.write_text('\n'.join(f'{k}={v}' for k,v in values.items())+'\n')
for destination in ['backend/.env','intelligence/.env']:
    shutil.copy2(env,root/destination)
if args.ollama_binary and args.ollama_models:
    (root/'.runtime/local-ai.json').write_text(json.dumps({'binary':args.ollama_binary,'models':args.ollama_models}))
print('Local configuration generated; existing configuration preserved.')
