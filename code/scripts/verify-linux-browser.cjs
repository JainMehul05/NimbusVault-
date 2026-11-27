// Browser acceptance of the local Linux stack. No upload or cloud mutation.
const {chromium}=require('playwright');
const {expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const directory=path.resolve('.runtime/aws-deployment');
const user=JSON.parse(fs.readFileSync(path.join(directory,'linux-synthetic-users.json'),'utf8')).owner;
const prior=JSON.parse(fs.readFileSync(path.join(directory,'linux-application.json'),'utf8'));
const base='http://127.0.0.1:33100';
(async()=>{
 const report={environment:'local_linux_docker_not_ec2',responsive:[],checks:[],pageErrors:[],aws_mutations:[]};
 const screenshots=path.join(directory,'screenshots');fs.mkdirSync(screenshots,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.NIMBUS_BROWSER||path.join(process.env.PROGRAMFILES,'BraveSoftware/Brave-Browser/Application/brave.exe')});
 const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 const save=()=>fs.writeFileSync(path.join(directory,'linux-browser.json'),JSON.stringify(report,null,2));
 try {
  const sentinel='11111111-1111-4111-8111-111111111111.windows-sentinel';
  await page.context().addCookies([{name:'refreshToken',value:sentinel,url:base+'/api/v1/auth',httpOnly:true,sameSite:'Lax'}]);
  await page.goto(base+'/login');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password',{exact:true}).fill(user.password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL('**/dashboard');report.checks.push('Real browser login');
  const cookies=await page.context().cookies(base+'/api/v1/auth');
  if(cookies.find(c=>c.name==='refreshToken')?.value!==sentinel || !cookies.some(c=>c.name==='nimbusvault_ec2_refresh'))throw new Error('Cloud login overwrote the Windows refresh cookie');
  report.checks.push('Windows refresh cookie preserved alongside isolated Linux cookie');
  // Preserve the real SPA auth state; do not bypass or raise refresh limits.
  // These are SPA route/viewport checks, not 54 fresh cookie-refresh requests.
  for(const width of [360,390,768,1024,1366,1920]){
   await page.setViewportSize({width,height:768});
   for(const route of ['/','/dashboard','/files','/shared-with-me','/ask','/cloud','/activity','/trash','/account']){
    await page.evaluate(target=>{history.pushState({},'',target);dispatchEvent(new PopStateEvent('popstate'));},route);
    await page.waitForURL(base+route);await page.waitForTimeout(250);
    await page.getByRole('heading',{level:1}).first().waitFor();await page.evaluate(()=>document.fonts.ready);
    const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    report.responsive.push({route,width,...size,pass:size.document<=size.viewport+1});save();
    if(size.document>size.viewport+1)throw new Error('Horizontal overflow '+route+' at '+width);
   }
  }
  await page.setViewportSize({width:1366,height:768});
  await page.evaluate(()=>{history.pushState({},'','/dashboard');dispatchEvent(new PopStateEvent('popstate'));});
  await page.waitForTimeout(300);await page.screenshot({path:path.join(screenshots,'linux-dashboard.png'),fullPage:true});
  await page.evaluate(()=>{history.pushState({},'','/ask');dispatchEvent(new PopStateEvent('popstate'));});
  await page.getByRole('button',{name:'History',exact:true}).click();
  await page.getByLabel('Continue conversation').selectOption(prior.synthetic_answer.conversationId);
  await expect(page.getByRole('button',{name:/Source S1:/}).first()).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:/Source S1:/}).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({path:path.join(screenshots,'linux-citation.png'),fullPage:true});
  report.checks.push('Persisted real Qwen answer and clickable citation displayed');
  report.s3_download='Not exercised: local preparation does not authorize live S3 writes';
  if(report.pageErrors.length)throw new Error('Browser page errors');
  report.result='passed';save();console.log(JSON.stringify({result:report.result,responsive:report.responsive.length,checks:report.checks,pageErrors:report.pageErrors.length}));
 }catch(error){report.result='failed';report.failure=error.message;save();throw error}
 finally{await browser.close()}
})().catch(error=>{console.error(error.message);process.exit(1)});
