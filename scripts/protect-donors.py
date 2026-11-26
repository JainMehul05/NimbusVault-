from pathlib import Path
import sqlite3, shutil, subprocess, json, zipfile, os
source=Path(r'C:\Users\hp\Downloads\cloudvault')
final=Path(r'C:\Users\hp\Downloads\nimbus vault final')
backup=final/'.private-backup'
backup.mkdir(exist_ok=True)
with zipfile.ZipFile(backup/'cloudvault-source.zip','w',zipfile.ZIP_DEFLATED) as z:
    tracked=subprocess.check_output(['git','-C',str(source),'ls-files','-z']).decode().split('\0')
    for name in filter(None,tracked):
        p=source/name
        if p.is_file(): z.write(p,name)
for name in ['.env','.runtime/cloud-resources.json','.runtime/cloud-config.json']:
    p=source/'CloudVault'/name
    if p.exists():
        dest=backup/name
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(p,dest)
src=sqlite3.connect((source/'CloudVault/data/cloudvault.db').as_uri()+'?mode=ro',uri=True)
dst=sqlite3.connect(backup/'cloudvault.db')
src.backup(dst)
counts={t:dst.execute(f'SELECT count(*) FROM {t}').fetchone()[0] for t in ['files','chunks','conversations','exchanges']}
assert dst.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
(backup/'manifest.json').write_text(json.dumps({'donor_commit':subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD']).decode().strip(),'counts':counts,'integrity_check':'ok','active_migration':'none; owner unassigned'},indent=2))
src.close();dst.close()
print(json.dumps(counts))
for part in ['app','tests']:
    shutil.copytree(source/'CloudVault/backend'/part,final/'intelligence'/part,ignore=shutil.ignore_patterns('__pycache__'),dirs_exist_ok=True)
for name in ['requirements.txt','requirements.lock','pyproject.toml']:
    shutil.copy2(source/'CloudVault/backend'/name,final/'intelligence'/name)
shutil.copytree(source/'CloudVault/infrastructure',final/'infrastructure',dirs_exist_ok=True)
shutil.copy2(source/'NOTICE',final/'NOTICE.cloudvault')
shutil.copy2(source/'LICENSE',final/'LICENSE.cloudvault')
(final/'docs/donor-cloudvault').mkdir(exist_ok=True)
for name in ['AWS_RESOURCE_INVENTORY.md','AWS_LIVE_VERIFICATION.md','FINAL_HANDOVER.md']:
    shutil.copy2(source/'CloudVault/docs'/name,final/'docs/donor-cloudvault'/name)
with (final/'.gitignore').open('a') as f:
    f.write('\n# Integration private/runtime data\n.private-backup/\n.runtime/\n.env\n.env.local\nbackend/.env\nintelligence/.env\nintelligence/data/\nintelligence/.venv/\n__pycache__/\n*.db\n*.db-wal\n*.db-shm\n')
