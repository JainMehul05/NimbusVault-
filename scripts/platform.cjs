const {spawnSync}=require('node:child_process');
const path=require('node:path');
const operation=process.argv[2];
if(!['start','stop','setup'].includes(operation)) throw new Error('Unsupported operation');
const root=path.resolve(__dirname,'..');
if(process.platform!=='win32') {
  console.error('Linux EC2: use docs/LINUX_STANDALONE_BASELINE.md. Windows launchers are intentionally blocked; provision native Linux Python and Ollama before starting services.');
  process.exit(1);
}
const result=spawnSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,operation+'.ps1'),...process.argv.slice(3)],{cwd:root,stdio:'inherit'});
process.exit(result.status??1);
