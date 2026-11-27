// Local account permissions and local inference only: no upload, cloud mutation or vector query.
const fs=require('fs'),crypto=require('crypto');const users=require('../.runtime/rehearsal-users.json');const journal=require('../.runtime/aws-rehearsal.json');
(async()=>{
 const report={started_at:new Date().toISOString(),checks:{}};
 const first=journal.mutations.find(m=>m.operation==='final application multipart upload').file_id;
 const second=journal.mutations.find(m=>m.operation==='second isolated synthetic application upload').file_id;
 const login=async u=>{const r=await fetch('http://127.0.0.1:3100/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:u.email,password:u.password})});if(!r.ok)throw new Error('Login '+r.status);return(await r.json()).data.tokens};
 const owner=await login(users.owner),other=await login(users.other);
 const call=async(tokens,method,route,body)=>{const r=await fetch('http://127.0.0.1:3100/api/v1'+route,{method,headers:{Authorization:'Bearer '+tokens.accessToken,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json()}};
 const ok=r=>{if(r.status>=400)throw new Error('API '+r.status+' '+r.body.message);return r.body.data};
 let shared=false;
 try{
  if((await call(owner,'GET','/files/'+second+'/download')).status!==404)throw new Error('Admin silently bypassed document authorization');
  ok(await call(other,'POST','/sharing',{resourceType:'FILE',resourceId:second,granteeEmail:users.owner.email,level:'VIEWER'}));shared=true;
  const multi=ok(await call(owner,'POST','/ai/ask',{question:'Explain local MiniLM/Qwen processing and the Borealis synthetic access number.',fileIds:[first,second]}));
  report.multi=multi;
  if(multi.mode!=='generated'||new Set(multi.citations.map(c=>c.fileId)).size!==2)throw new Error('Actual two-document grounded generation did not include both documents');
  report.checks.actual_multi_document_Qwen=true;
  const follow=ok(await call(owner,'POST','/ai/ask',{question:'What is the Borealis access number again?',conversationId:multi.conversationId,fileIds:[first,second]}));
  report.followup=follow;
  if(follow.mode!=='generated'||!follow.answer.includes('914'))throw new Error('Actual grounded follow-up failed');
  report.checks.actual_followup=true;
  const insufficient=ok(await call(owner,'POST','/ai/ask',{question:'What is the declared rocket launch date of the Antarctic expedition?',fileIds:[first,second]}));
  report.insufficient=insufficient;
  if(insufficient.status!=='insufficient_evidence')throw new Error('Insufficient-evidence case did not abstain');
  report.checks.actual_abstention=true;
  const before=ok(await call(owner,'GET','/ai/conversations')).map(x=>x.id).sort();
  const requestId=crypto.randomUUID();
  const env=fs.readFileSync('.env','utf8');
  const token=env.match(/^INTERNAL_SERVICE_TOKEN=(.+)$/m)[1].trim().replace(/^['"]|['"]$/g,'');
  let completed=false;
  const pending=call(owner,'POST','/ai/ask',{question:'Explain local MiniLM/Qwen processing and the Borealis synthetic access number.',fileIds:[first,second],requestId}).then(result=>{completed=true;return result});
  let observedBusy=false;
  for(let attempt=0;attempt<100&&!completed;attempt++){
   const status=await fetch('http://127.0.0.1:8101/api/ai/status',{headers:{'X-Service-Token':token,'X-Actor-Id':users.owner.id,'X-File-Scope':JSON.stringify([first,second])}});
   if(!status.ok)throw new Error('Private status '+status.status);
   if((await status.json()).busy){observedBusy=true;break}
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  report.cancellation_observed_busy=observedBusy;
  if(!observedBusy||completed)throw new Error('Could not observe active answer preparation before Stop');
  ok(await call(owner,'POST','/ai/cancel',{requestId}));
  const stopped=await pending;
  report.cancellation_attempt=stopped;
  if(stopped.status!==499)throw new Error('Generation did not stop: '+stopped.status);
  const after=ok(await call(owner,'GET','/ai/conversations')).map(x=>x.id).sort();
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Canceled generation was stored as completed history');
  report.checks.actual_stop_no_completed_history=true;
  const next=ok(await call(owner,'POST','/ai/ask',{question:'What is the Borealis synthetic access number?',fileIds:[second]}));
  if(next.mode!=='generated')throw new Error('Generation slot was not released after Stop');
  report.checks.generation_slot_released=true;
  ok(await call(other,'DELETE',`/sharing/FILE/${second}/${users.owner.id}`));shared=false;
  if((await call(owner,'GET','/ai/conversations/'+multi.conversationId)).status!==404)throw new Error('Revoked historical answer remained available');
  report.checks.actual_history_revocation=true;
  const stats=ok(await call(owner,'GET','/files/statistics'));
  if(stats.totalFiles!==1||stats.indexedFiles!==1)throw new Error('Dashboard scope includes another account');
  report.checks.actual_private_dashboard_statistics=true;
  const invalid=await fetch('http://127.0.0.1:3100/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:users.owner.email,password:'deliberately-wrong-test-password'})});
  if(invalid.status!==401)throw new Error('Invalid password accepted');
  report.checks.invalid_password_rejected=true;
  ok(await call(owner,'POST','/auth/logout',{refreshToken:owner.refreshToken,tokenFamily:owner.refreshTokenFamily}));
  if((await call(owner,'GET','/auth/me')).status!==401)throw new Error('Logged-out access token remained active');
  report.checks.logout_revokes_access_immediately=true;
  report.result='passed';
 }catch(e){report.result='failed';report.failure=e.message;throw e}
 finally{
  if(shared)await call(other,'DELETE',`/sharing/FILE/${second}/${users.owner.id}`);
  report.finished_at=new Date().toISOString();fs.writeFileSync('.runtime/local-flow-verification.json',JSON.stringify(report,null,2));fs.writeFileSync(require('node:path').resolve(__dirname, '../../docs/LOCAL_RAG_ACCEPTANCE.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({result:report.result,checks:report.checks,failure:report.failure}));
 }
})().catch(e=>{console.error(e.message);process.exit(1)});
