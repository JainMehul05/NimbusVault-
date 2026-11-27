"""Run a local shell script (or inline command) on the approved instance through SSM Run Command.

usage: aws-ssm-run.py [--timeout S] (--file script.sh [args...] | --cmd "command")
Only targets the instance recorded in approved-instance.json. Prints stdout/stderr and exits
with the remote status. Never sends credentials; the host uses its own instance role.
"""
import argparse
import base64
import json
import shlex
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import time
from pathlib import Path

import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[1]
target = json.loads((ROOT / '.runtime/aws-deployment/approved-instance.json').read_text())
parser = argparse.ArgumentParser()
parser.add_argument('--timeout', type=int, default=900)
parser.add_argument('--file')
parser.add_argument('--cmd')
parser.add_argument('args', nargs='*')
a = parser.parse_args()
if a.file:
    body = Path(a.file).read_text(encoding='utf-8').replace('\r\n', '\n')
    encoded = base64.b64encode(body.encode()).decode()
    commands = [f'echo {encoded} | base64 -d > /tmp/nimbus-step.sh',
                'bash /tmp/nimbus-step.sh ' + ' '.join(shlex.quote(x) for x in a.args)]
else:
    commands = [a.cmd]
session = boto3.Session(profile_name='default', region_name=target['region'])
ssm = session.client('ssm', config=Config(retries={'max_attempts': 5, 'mode': 'standard'}, read_timeout=30))
command_id = ssm.send_command(InstanceIds=[target['instance_id']], DocumentName='AWS-RunShellScript',
                              Parameters={'commands': commands, 'executionTimeout': [str(a.timeout)]},
                              TimeoutSeconds=60)['Command']['CommandId']
deadline = time.monotonic() + a.timeout + 120
while time.monotonic() < deadline:
    time.sleep(4)
    try:
        r = ssm.get_command_invocation(CommandId=command_id, InstanceId=target['instance_id'])
    except ssm.exceptions.InvocationDoesNotExist:
        continue
    except Exception:
        continue
    if r['Status'] not in ('Pending', 'InProgress', 'Delayed'):
        sys.stdout.write(r.get('StandardOutputContent', ''))
        if r.get('StandardErrorContent'):
            sys.stdout.write('\n--- stderr ---\n' + r['StandardErrorContent'][-6000:])
        print(f"\n[ssm {command_id} {r['Status']} rc={r.get('ResponseCode')}]")
        raise SystemExit(0 if r['Status'] == 'Success' else 1)
raise SystemExit(f'SSM command {command_id} still running after local wait')
