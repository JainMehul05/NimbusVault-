"""Replay unchanged search and Qwen acceptance cases on the running Linux CPU stack."""
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
private = root / '.runtime/aws-deployment'
compose = ['docker', 'compose', '--env-file', str(private / 'local/compose.env'),
           '-f', str(root / 'deployment/compose.ec2.yml'), 'exec', '-T', 'intelligence']
cases = json.loads((root / 'benchmarks/ai-cases.json').read_text()) + json.loads(
    (root / 'benchmarks/independent-ai.json').read_text())
assert len(cases) == 40
subprocess.run(compose + ['python', '-c',
    "import sys,pathlib; pathlib.Path('/tmp/all-40-cases.json').write_text(sys.stdin.read())"],
    input=json.dumps(cases), text=True, check=True)
subprocess.run(compose + ['python', '/app/scripts/benchmark-ai.py', '--cases',
    '/tmp/all-40-cases.json', '--output', '/tmp/ai-40-final.json'], check=True)
(private / 'linux-ai-40-final.json').write_bytes(subprocess.check_output(compose + ['cat', '/tmp/ai-40-final.json']))
subprocess.run(compose + ['python', '/app/scripts/benchmark-search.py', '--label', 'linux-final',
    '--fresh-held-out', '--independent', '--modes', 'semantic', 'hybrid', 'lexical',
    '--output', '/tmp/search-84-final.json'], check=True)
(private / 'linux-search-84-final.json').write_bytes(subprocess.check_output(compose + ['cat', '/tmp/search-84-final.json']))
