require('dotenv').config({path:'.env',quiet:true});
const {PrismaClient}=require('@prisma/client');const fs=require('fs'),crypto=require('crypto');
(async()=>{
 const path='.runtime/rehearsal-users.json'; if(fs.existsSync(path)){console.log('Reusing existing isolated rehearsal accounts.');return}
 const db=new PrismaClient();const users={};
 for(const role of ['owner','other']){
  const record={email:`rehearsal-${role}-${Date.now()}@example.test`,password:crypto.randomBytes(24).toString('hex')};
  const response=await fetch('http://127.0.0.1:3100/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`Nimbus Rehearsal ${role}`, ...record})});
  if(!response.ok)throw new Error('Test registration failed: '+response.status);
  const body=await response.json();record.id=body.data.user.id;users[role]=record;
 }
 await db.user.update({where:{id:users.owner.id},data:{role:'admin'}});
 fs.writeFileSync(path,JSON.stringify(users)); await db.$disconnect();console.log('Two isolated synthetic accounts created; one designated test administrator. No legacy data assigned.');
})().catch(e=>{console.error(e.message);process.exit(1)});
