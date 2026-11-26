// Two local answers using an existing synthetic original. No AWS requests or writes.
const fs=require('fs');
(async()=>{
 const processes=require('../.runtime/processes.json');
 if(!processes.some(p=>p.name==='ollama'))throw new Error('No recorded owned model runtime; refusing to unload a shared model');
 const user=require('../.runtime/rehearsal-users.json').owner;
 const journal=require('../.runtime/aws-rehearsal.json');
 const id=journal.mutations.find(m=>m.operation==='final application multipart upload').file_id;
 const base='http://127.0.0.1:3100/api/v1';
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:user.password})});
 if(!login.ok)throw new Error('Login failed');
 const token=(await login.json()).data.tokens.accessToken;
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const file=await fetch(base+'/ai/files/'+id,{headers});
 if(!file.ok||(await file.json()).data.status!=='ready')throw new Error('Indexed fixture did not survive restart');
 const findHistory=value=>{
   if(!value||typeof value!=='object')return null;
   if(value.conversationId&&value.mode==='generated')return value.conversationId;
   for(const child of Object.values(value)){const match=findHistory(child);if(match)return match}
   return null;
 };
 const originalHistory=findHistory(journal.checks);
 if(!originalHistory)throw new Error('No original rehearsal history reference');
 const history=await fetch(base+'/ai/conversations/'+originalHistory,{headers});
 if(!history.ok||(await history.json()).data.exchanges.length<1)throw new Error('Original conversation did not survive restart');
 const unload=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'qwen2.5:3b',keep_alive:0})});
 if(!unload.ok)throw new Error('Owned local model unload failed');
 const report={observed_at:new Date().toISOString(),indexed_fixture_persisted:true,original_conversation_persisted:true,account_persisted:true,aws_calls:0,runs:[]};
 for(const phase of ['cold_model','warm_model']){
  const start=performance.now();
  const pending=fetch(base+'/ai/ask',{method:'POST',headers,body:JSON.stringify({question:'Where do MiniLM embeddings and Qwen answer generation run?',fileIds:[id]})});
  await new Promise(resolve=>setTimeout(resolve,200));
  const managementStart=performance.now();
  const stats=await fetch(base+'/files/statistics',{headers});
  if(!stats.ok)throw new Error('File management failed during generation');
  const managementMs=performance.now()-managementStart;
  const response=await pending;
  const data=(await response.json()).data;
  if(!response.ok||data.mode!=='generated'||!data.citations.length)throw new Error('Real local generation failed');
  report.runs.push({phase,total_ms:Math.round(performance.now()-start),file_management_during_generation_ms:Math.round(managementMs),mode:data.mode,timings:data.timings});
 }
 report.result='passed';
 fs.writeFileSync('docs/RUNTIME_PERFORMANCE_ACCEPTANCE.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exit(1)});
