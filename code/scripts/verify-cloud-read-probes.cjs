const fs=require('fs');const users=require('../.runtime/rehearsal-users.json');
(async()=>{
 const login=await(await fetch('http://127.0.0.1:3100/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:users.owner.email,password:users.owner.password})})).json();
 const headers={Authorization:'Bearer '+login.data.tokens.accessToken,'Content-Type':'application/json'};
 for(const [route,file] of [['vector-demo','AWS_VECTOR_DEMO.json'],['probe','APP_CLOUD_PROBE.json']]) {
  const response=await fetch('http://127.0.0.1:3100/api/v1/ai/cloud/'+route,{method:'POST',headers,body:'{}'});
  const body=await response.json();if(!response.ok)throw new Error(route+' failed: '+response.status+' '+body.message);
  fs.writeFileSync(require('node:path').resolve(__dirname, '../../docs') + '/'+file,JSON.stringify(body.data,null,2));console.log(route+': '+JSON.stringify(body.data));
 }
})().catch(e=>{console.error(e.message);process.exit(1)});
