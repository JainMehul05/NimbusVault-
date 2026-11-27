// Existing synthetic fixture only; no uploads, cloud writes, or account changes.
const fs = require('fs');
(async () => {
  const phase = process.argv[2];
  if (!['cloud-paused', 'model-stopped'].includes(phase)) throw new Error('Specify a verification phase');
  const user = require('../.runtime/rehearsal-users.json').owner;
  const journal = require('../.runtime/aws-rehearsal.json');
  const id = journal.mutations.find(m => m.operation === 'final application multipart upload').file_id;
  const base = 'http://127.0.0.1:3100/api/v1';
  const login = await fetch(base + '/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:user.email,password:user.password})});
  if (!login.ok) throw new Error('Synthetic account login failed');
  const token = (await login.json()).data.tokens.accessToken;
  const headers = {Authorization:'Bearer '+token, 'Content-Type':'application/json'};
  const query = await fetch(base+'/ai/search', {method:'POST',headers,body:JSON.stringify({query:'MiniLM embeddings',mode:'exact',fileIds:[id]})});
  const found = (await query.json()).data;
  if (!query.ok || !found.results?.length || found.awsCalls !== 0) throw new Error('Local cached search failed');
  const response = await fetch(base+'/ai/ask', {method:'POST',headers,body:JSON.stringify({question:'Where do MiniLM embeddings and Qwen answer generation run?',fileIds:[id]})});
  const answer = (await response.json()).data;
  const expected = phase === 'cloud-paused' ? 'generated' : 'extractive';
  if (!response.ok || answer.mode !== expected || !answer.citations.length) throw new Error('Wrong degraded answer mode: '+JSON.stringify(answer));
  const download = await fetch(base+'/files/'+id+'/download', {headers});
  if (download.status !== 503) throw new Error('Paused AWS download was not denied: '+download.status);
  const report = {observed_at:new Date().toISOString(),phase,result:'passed',local_search:true,answer_mode:answer.mode,citations:answer.citations.length,cloud_download_status:download.status,warning:answer.warning,aws_operations_enabled:false};
  fs.writeFileSync(require('node:path').resolve(__dirname, '../../docs') + '/'+(phase==='cloud-paused'?'AWS_PAUSED_ACCEPTANCE':'MODEL_UNAVAILABLE_ACCEPTANCE')+'.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exit(1)});
