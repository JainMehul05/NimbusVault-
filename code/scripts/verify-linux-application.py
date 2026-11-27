"""Local Linux preparation acceptance. Seeds isolated synthetic metadata; NOT an S3 rehearsal."""
import base64
import concurrent.futures
import hashlib
import json
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.runtime/aws-deployment'
BASE = 'http://127.0.0.1:33100/api/v1'
COMPOSE = ['docker', 'compose', '--env-file', str(PRIVATE / 'local/compose.env'),
           '-f', str(ROOT / 'deployment/compose.ec2.yml')]
report = {'environment': 'local_linux_docker_cpu_not_ec2', 'aws_mutations': [],
          's3_upload_verified': False, 'checks': {}, 'synthetic_seeded_metadata': True}


def request(method, path, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    payload = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def docker(service, executable, code, data=None):
    return subprocess.check_output(COMPOSE + ['exec', '-T', service, executable, '-c' if executable == 'python' else '-e', code],
                                   input=json.dumps(data) if data is not None else '', encoding='utf-8')


users = {}
for role in ['owner', 'other']:
    user = {'name': 'Linux synthetic ' + role, 'email': f'linux-{role}-{uuid4().hex[:10]}@nimbus.invalid',
            'password': secrets.token_urlsafe(24)}
    status, body = request('POST', '/auth/register', user)
    assert status == 201, (status, body.get('message'))
    status, login = request('POST', '/auth/login', {'email': user['email'], 'password': user['password']})
    assert status == 200
    user['tokens'] = login['data']['tokens']
    user['id'] = login['data']['user']['id']
    users[role] = user
(PRIVATE / 'linux-synthetic-users.json').write_text(json.dumps(users, indent=2), encoding='utf-8')
report['checks']['registration_login_two_synthetic_accounts'] = True
corpus = json.loads((ROOT / 'benchmarks/corpus.json').read_text())
files = []
for key in ['processing', 'borealis']:
    document = corpus['documents'][key]
    raw = document['text'].encode()
    file_id = str(uuid4())
    payload = {'file_id': file_id, 'filename': 'linux-' + document['filename'],
               'object_key': f"cloudvault/files/{file_id}/linux-{document['filename']}",
               'sha256': hashlib.sha256(raw).hexdigest(), 'mime': 'text/plain',
               'content': base64.b64encode(raw).decode()}
    result = json.loads(docker('intelligence', 'python',
        "import os,json,sys,httpx; p=json.load(sys.stdin);r=httpx.post('http://127.0.0.1:8101/index',headers={'x-service-token':os.environ['INTERNAL_SERVICE_TOKEN']},json=p,timeout=120);r.raise_for_status();print(json.dumps(r.json()))", payload))
    files.append({'id': file_id, 'filename': payload['filename'], 'ownerId': users['owner']['id'],
                  's3Key': payload['object_key'], 'checksumSha256': payload['sha256'],
                  'sizeBytes': len(raw), 'text': document['text'], 'index_result': result})
seed = """const fs=require('fs'); const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{for(const f of JSON.parse(fs.readFileSync(0,'utf8'))){await p.file.create({data:{id:f.id,filename:f.filename,ownerId:f.ownerId,s3Key:f.s3Key,checksumSha256:f.checksumSha256,sizeBytes:BigInt(f.sizeBytes),mimeType:'text/plain',category:'document',status:'READY',aiStatus:'INDEXED',documentIndex:{create:{generation:1,textContent:f.text,textLength:f.text.length,chunkCount:f.index_result.chunkCount||1,embeddingModel:'sentence-transformers/all-MiniLM-L6-v2',embeddingDim:384,sourceChecksum:f.checksumSha256,indexedAt:new Date(),extractor:'isolated synthetic Linux preparation'}}}})}console.log(JSON.stringify({seeded:true,files:2}));})().finally(()=>p.$disconnect());"""
json.loads(docker('api', 'node', seed, files))
(PRIVATE / 'linux-synthetic-files.json').write_text(json.dumps(files, indent=2), encoding='utf-8')
owner = users['owner']['tokens']['accessToken']
other = users['other']['tokens']['accessToken']
scope = [f['id'] for f in files]
for mode in ['semantic', 'lexical', 'hybrid']:
    status, data = request('POST', '/ai/search', {'query': 'Borealis synthetic access number', 'mode': mode,
                                               'fileIds': scope}, owner)
    assert status == 200 and data['data']['results'], (mode, status)
    report['checks'][mode + '_fresh_index_search'] = True
question = {'question': 'Explain local MiniLM/Qwen processing and the Borealis synthetic access number.', 'fileIds': scope}
started = time.perf_counter()
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    future = pool.submit(request, 'POST', '/ai/ask', question, owner)
    time.sleep(0.5)
    management_started = time.perf_counter()
    assert request('GET', '/files/statistics', token=owner)[0] == 200
    report['file_management_during_generation_ms'] = round((time.perf_counter() - management_started) * 1000, 2)
    status, response = future.result()
assert status == 200, (status, response.get('message'))
answer = response['data']
assert answer['mode'] == 'generated', answer.get('warning')
assert '914' in answer['answer'] and {c['fileId'] for c in answer['citations']} == set(scope)
report['checks']['genuine_application_multi_document_qwen_and_citations'] = True
report['generation_ms'] = round((time.perf_counter() - started) * 1000, 2)
report['synthetic_answer'] = answer
assert request('GET', '/ai/conversations/' + answer['conversationId'], token=other)[0] == 404
assert request('GET', '/files/' + scope[0] + '/download', token=other)[0] == 404
report['checks']['cross_account_history_and_download_denied'] = True
assert request('POST', '/auth/login', {'email': users['owner']['email'], 'password': 'deliberately-wrong-password'})[0] == 401
report['checks']['invalid_password_rejected'] = True
report['result'] = 'passed'
(PRIVATE / 'linux-application.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'result': report['result'], 'checks': report['checks'], 'generation_ms': report['generation_ms']}))
