// Denial checks only. No cloud operation should be reached by these requests.
const fs=require('fs');
(async()=>{
 const other=require('../.runtime/rehearsal-users.json').other;
 const journal=require('../.runtime/aws-rehearsal.json');
 const first=journal.mutations.find(m=>m.operation==='final application multipart upload').file_id;
 const base='http://127.0.0.1:3100/api/v1';
 const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:other.email,password:other.password})});
 if(!login.ok)throw new Error('Synthetic login failed');
 const token=(await login.json()).data.tokens.accessToken;
 const checks=[];
 for(const [url,headers,expected] of [
  [base+'/ai/cloud',{Authorization:'Bearer '+token},403],
  [base+'/files/'+first+'/download',{Authorization:'Bearer '+token},404],
  [base+'/ai/files/'+first,{Authorization:'Bearer '+token},404],
  [base+'/auth/me',{},401],
  ['http://127.0.0.1:8101/health',{},401],
 ]){
  const response=await fetch(url,{headers});
  if(response.status!==expected)throw new Error('Unexpected authorization status '+response.status+' for '+new URL(url).pathname);
  checks.push({path:new URL(url).pathname,status:response.status,expected});
 }
 const report={observed_at:new Date().toISOString(),checks,result:'passed',cloud_mutations:0};
 fs.writeFileSync('docs/ACCESS_BOUNDARY_ACCEPTANCE.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exit(1)});
