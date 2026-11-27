"""Exercise owned local Linux fixtures, active SIGTERM, restart and persistence. No AWS."""
import concurrent.futures
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
private = root / '.runtime/aws-deployment'
compose = ['docker', 'compose', '--env-file', str(private / 'local/compose.env'),
           '-f', str(root / 'deployment/compose.ec2.yml')]
base = 'http://127.0.0.1:33100/api/v1'
user = json.loads((private / 'linux-synthetic-users.json').read_text())['owner']
files = json.loads((private / 'linux-synthetic-files.json').read_text())
report = {'environment': 'local_linux_not_ec2', 'aws_mutations': [], 'checks': {}}


def request(method, path, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(base + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=320) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def run(*args):
    return subprocess.check_output(compose + list(args), encoding='utf-8', stderr=subprocess.STDOUT)


def counts():
    return run('exec', '-T', 'postgres', 'psql', '-U', 'nimbusvault', '-d', 'nimbusvault',
               '-At', '-c', 'SELECT (SELECT count(*) FROM users),(SELECT count(*) FROM files);').strip()


def login():
    code, data = request('POST', '/auth/login', {'email': user['email'], 'password': user['password']})
    assert code == 200, code
    return data['data']['tokens']['accessToken']


try:
    token = login()
    before = counts()
    report['counts_before'] = before
    payload = {'question': 'Explain local MiniLM/Qwen processing and the Borealis synthetic access number.',
               'fileIds': [f['id'] for f in files]}
    code, data = request('POST', '/ai/ask', payload, token)
    assert code == 200, (code, data)
    answer = data['data']
    assert answer['mode'] == 'generated' and '914' in answer['answer'], answer
    assert {c['fileId'] for c in answer['citations']} == set(payload['fileIds'])
    report['checks']['fresh_application_multi_document_qwen_and_citations'] = True
    conversation = answer['conversationId']
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(request, 'POST', '/ai/ask', payload, token)
        for _ in range(30):
            time.sleep(0.2)
            status = json.loads(run('exec', '-T', 'intelligence', 'python', '-c',
                "import os,json,urllib.request; r=urllib.request.Request('http://127.0.0.1:8101/api/ai/status',headers={'x-service-token':os.environ['INTERNAL_SERVICE_TOKEN'],'x-actor-id':'" + user['id'] + "','x-file-ids':'[]'}); print(urllib.request.urlopen(r).read().decode())"))
            if status.get('busy'):
                break
        else:
            raise AssertionError('No active generation observed before shutdown')
        started = time.monotonic()
        report['stop_output'] = run('stop', '-t', '35', 'api')
        report['active_shutdown_seconds'] = round(time.monotonic() - started, 2)
        try:
            code, data = future.result(timeout=40)
            report['active_request_status'] = code
            assert code in [200, 499, 503], (code, data)
        except (urllib.error.URLError, ConnectionError, TimeoutError) as error:
            report['active_request_transport'] = type(error).__name__
    state = json.loads(subprocess.check_output(['docker', 'inspect', 'nimbusvault-ec2-api-1'], encoding='utf-8'))[0]['State']
    report['exit'] = {k: state[k] for k in ['ExitCode', 'OOMKilled', 'Status']}
    assert state['ExitCode'] == 0 and not state['OOMKilled'], state
    assert report['active_shutdown_seconds'] < 35
    report['checks']['active_api_shutdown_clean_exit'] = True
    run('up', '-d', '--wait', 'api')
    token = login()
    assert request('GET', '/ai/conversations/' + conversation, token=token)[0] == 200
    run('stop', '-t', '35')
    run('up', '-d', '--wait')
    token = login()
    assert counts() == before
    assert request('GET', '/ai/conversations/' + conversation, token=token)[0] == 200
    code, data = request('POST', '/ai/search', {'query': 'Borealis synthetic access number',
                         'mode': 'hybrid', 'fileIds': payload['fileIds']}, token)
    assert code == 200 and data['data']['results']
    report['checks']['full_stack_restart_auth_data_history_embeddings_preserved'] = True
    report['result'] = 'passed'
finally:
    (private / 'linux-lifecycle.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
