"""Measure CPU import/model initialization independently; no AWS or generation calls."""
import argparse
import json
import os
import sys
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--output', type=Path)
args = parser.parse_args()
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
sys.path.insert(0, str(args.root / 'intelligence'))
report = {'platform': sys.platform, 'python': sys.version.split()[0], 'phases_ms': {}, 'aws_calls': 0}
started = time.perf_counter()


def measured(name, fn):
    start = time.perf_counter()
    result = fn()
    report['phases_ms'][name] = round((time.perf_counter() - start) * 1000, 2)
    return result


torch = measured('torch_import', lambda: __import__('torch'))
measured('sentence_transformers_import', lambda: __import__('sentence_transformers'))
from app.embeddings import engine  # noqa: E402

measured('minilm_load', engine.load)
vector = measured('first_encode', lambda: engine.encode(['NimbusVault startup timing fixture']))
measured('warm_encode', lambda: engine.encode(['A different synthetic readiness query']))
report['dimension'] = int(vector.shape[1])
report['device'] = str(engine.model.device)
report['torch_version'] = torch.__version__
report['total_ms'] = round((time.perf_counter() - started) * 1000, 2)
assert report['dimension'] == 384 and report['device'] == 'cpu'
if args.output:
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
