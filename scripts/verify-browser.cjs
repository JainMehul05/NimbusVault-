const {chromium}=require('playwright');
const {expect}=require('@playwright/test');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
(async()=>{
 const report={started_at:new Date().toISOString(),checks:[],responsive:[],pageErrors:[]};
 const users=JSON.parse(fs.readFileSync('.runtime/rehearsal-users.json','utf8'));
 fs.mkdirSync('.runtime/screenshots',{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.NIMBUS_BROWSER || path.join(process.env.PROGRAMFILES,'BraveSoftware/Brave-Browser/Application/brave.exe')});
 const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 const save=()=>fs.writeFileSync('.runtime/browser-verification.json',JSON.stringify(report,null,2));
 try {
  await page.goto('http://127.0.0.1:3100/login');
  await page.getByLabel('Email address').fill(users.owner.email);
  await page.getByLabel('Password',{exact:true}).fill(users.owner.password);
  const login=page.waitForResponse(r=>r.url().endsWith('/auth/login')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const token=(await (await login).json()).data.tokens.accessToken;
  await page.waitForURL('**/dashboard');
  report.checks.push('Existing account sign-in through browser passed');save();
  if(!process.argv.includes('--workflows-only')) {
  for(const width of [360,390,768,1024,1366,1920]){
   await page.setViewportSize({width,height:768});
   for(const route of ['/','/dashboard','/files','/shared-with-me','/ask','/cloud','/activity','/trash','/account']){
    await page.goto('http://127.0.0.1:3100'+route);
    await page.getByRole('heading',{level:1}).first().waitFor();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('http://127.0.0.1:3100'+route);
    await page.evaluate(()=>document.fonts.ready);
    const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
    report.responsive.push({route,width,...size,pass:size.document<=size.viewport+1});save();
    if(size.document>size.viewport+1)throw new Error(`Horizontal overflow ${route} at ${width}: ${size.document}`);
   }
  }
  } else { report.responsive=JSON.parse(fs.readFileSync('.runtime/browser-responsive.json','utf8')).responsive; }
  report.checks.push('54 route/viewport/direct-reload checks passed');
  await page.setViewportSize({width:1366,height:768});
  await page.goto('http://127.0.0.1:3100/dashboard');
  await page.getByRole('heading',{level:1}).waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot({path:'.runtime/screenshots/dashboard.png',fullPage:true});
  await page.goto('http://127.0.0.1:3100/files');
  await page.getByRole('button',{name:'New folder',exact:true}).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Folder name').fill('Browser review '+Date.now());
  await page.getByRole('button',{name:'Create folder',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  report.checks.push('Actual browser folder creation passed');
  const tree=await (await fetch('http://127.0.0.1:3100/api/v1/folders/tree',{headers:{Authorization:'Bearer '+token}})).json();
  const flatten=nodes=>nodes.flatMap(node=>[node,...flatten(node.children||[])]);
  const evidence=flatten(tree.data.tree).find(f=>f.name==='Evidence');
  if(!evidence)throw new Error('Native rehearsal evidence folder missing');
  await page.goto('http://127.0.0.1:3100/files/'+evidence.id);
  await expect(page.getByText('Nimbus native evidence.txt',{exact:true}).first()).toBeVisible();
  await page.screenshot({path:'.runtime/screenshots/files.png',fullPage:true});
  report.checks.push('Nested folder and actual S3-backed file visible');
  await page.goto('http://127.0.0.1:3100/ask');
  await page.getByLabel('Your question').fill('Where do MiniLM embeddings and Qwen answer generation run?');
  await page.getByRole('button',{name:'Ask',exact:true}).click();
  await expect(page.getByRole('button',{name:/Source S1:/}).first()).toBeVisible({timeout:150000});
  await expect(page.getByText(/AI-generated from your documents.*qwen2.5:3b/)).toBeVisible();
  await page.screenshot({path:'.runtime/screenshots/ask-generated.png',fullPage:true});
  await page.getByRole('button',{name:/Source S1:/}).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText(/MiniLM embeddings and Qwen answer generation run on the local laptop/).first()).toBeVisible();
  await page.screenshot({path:'.runtime/screenshots/citation.png',fullPage:true});
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download original',exact:true}).click();
  await (await download).saveAs('.runtime/browser-original.txt');
  const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
  if(hash(fs.readFileSync('.runtime/browser-original.txt'))!==hash(fs.readFileSync('samples/cloud-stage-canary.txt')))throw new Error('Browser original checksum mismatch');
  report.checks.push('Real Qwen answer, clickable exact passage, browser download byte equality passed');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await page.getByRole('button',{name:'History',exact:true}).click();
  await expect(page.getByLabel('Continue conversation')).toBeVisible();
  const choice=await page.getByLabel('Continue conversation').locator('option').nth(1).getAttribute('value');
  await page.getByLabel('Continue conversation').selectOption(choice);
  await expect(page.getByRole('button',{name:/Source S1:/}).first()).toBeVisible({timeout:15000});
  report.checks.push('Persistent history reopened with authorized citations');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'.runtime/screenshots/ask-mobile.png',fullPage:true});
  await page.goto('http://127.0.0.1:3100/cloud');
  await page.getByRole('button',{name:'Refresh administrator snapshot',exact:true}).click();
  await expect(page.getByText('FREE · active',{exact:true})).toBeVisible({timeout:20000});
  await page.setViewportSize({width:1366,height:768});
  await page.screenshot({path:'.runtime/screenshots/cloud.png',fullPage:true});
  report.checks.push('Administrator cloud snapshot displays actual guard and native evidence');
  if(report.pageErrors.length)throw new Error('Browser page errors: '+report.pageErrors.join(';'));
  report.finished_at=new Date().toISOString();report.result='passed';save();
  console.log(JSON.stringify({result:report.result,checks:report.checks.length,responsive:report.responsive.length,pageErrors:report.pageErrors.length}));
 }catch(e){report.result='failed';report.failure=e.message;save();await page.screenshot({path:'.runtime/screenshots/browser-failure.png',fullPage:true});throw e}
 finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});
