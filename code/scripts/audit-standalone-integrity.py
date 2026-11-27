from pathlib import Path
import os,json,hashlib,sqlite3,argparse
parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,required=True)
parser.add_argument('--backup',type=Path,required=True)
args=parser.parse_args()
r=Path(__file__).resolve().parents[1]; source=args.source.resolve(); target=args.backup.resolve()
if not source.is_dir() or not target.is_dir():
 raise SystemExit('Both original and separate recovery backup must exist')
excluded={'.venv','node_modules','__pycache__','.ruff_cache','models','ollama-models','ollama'}
def manifest(root,prune=False):
 result={}
 for base,dirs,files in os.walk(root):
  if prune:dirs[:]=[x for x in dirs if x not in excluded]
  for name in files:
   p=Path(base)/name
   if name == 'RECOVERY_HASH_MANIFEST.json' or name.endswith(('.db-wal','.db-shm')):continue
   with p.open('rb') as f:result[str(p.relative_to(root))]=hashlib.file_digest(f,'sha256').hexdigest()
 return result
report={}
for name,a,b in [('ollama',source/'CloudVault/.runtime/ollama',r/'.runtime/standalone-ai/ollama'),('qwen',source/'CloudVault/data/ollama-models',r/'.runtime/standalone-ai/models'),('minilm',source/'CloudVault/data/models',r/'.runtime/standalone-ai/embedding-cache')]:
 x,y=manifest(a),manifest(b);x={k:v for k,v in x.items() if '.locks' not in Path(k).parts};y={k:v for k,v in y.items() if '.locks' not in Path(k).parts}
 report[name]={'source_files':len(x),'destination_files':len(y),'identical':x==y,'destination_hashes':y};print(name,report[name]['identical'],flush=True)
 (r/'.runtime/standalone-integrity.json').write_text(json.dumps(report,indent=2))
report['qwen_blob_integrity']=all(v==Path(k).name.removeprefix('sha256-') for k,v in report['qwen']['destination_hashes'].items() if 'blobs' in Path(k).parts and Path(k).name.startswith('sha256-'))
x,y=manifest(source,True),manifest(target,True)
report['recovery_backup']={'path':str(target),'files':len(y),'non_database_hashes_match':all(y.get(k)==v for k,v in x.items() if not k.endswith('.db')),'hashes':y,'sqlite':{}}
for k in x:
 if not k.endswith('.db'):continue
 with sqlite3.connect((source/k).as_uri()+'?mode=ro',uri=True) as a,sqlite3.connect((target/k).as_uri()+'?mode=ro',uri=True) as b:
  assert b.execute('pragma integrity_check').fetchone()[0]=='ok'
  tables=[z[0] for z in a.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
  q=lambda t:'"'+t.replace('"','""')+'"'
  same=all(sorted(a.execute('select * from '+q(t)).fetchall(),key=repr)==sorted(b.execute('select * from '+q(t)).fetchall(),key=repr) for t in tables)
  report['recovery_backup']['sqlite'][k]={'integrity':'ok','all_rows_match':same,'tables':len(tables)}
report['project_reparse_points']=[str(p.relative_to(r)) for d in ['.runtime/standalone-ai','data','intelligence/data'] for p in (r/d).rglob('*') if p.is_symlink() or p.is_junction()]
(r/'.runtime/standalone-integrity.json').write_text(json.dumps(report,indent=2));(target/'RECOVERY_HASH_MANIFEST.json').write_text(json.dumps(report['recovery_backup'],indent=2));print('backup',report['recovery_backup']['non_database_hashes_match'],report['recovery_backup']['sqlite'],flush=True)

assert all(report[k]['identical'] and report[k]['source_files'] > 0 for k in ['ollama','qwen','minilm'])
assert report['qwen_blob_integrity'] and report['recovery_backup']['non_database_hashes_match']
assert all(v['all_rows_match'] for v in report['recovery_backup']['sqlite'].values())
assert not report['project_reparse_points']
