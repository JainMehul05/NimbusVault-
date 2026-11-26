const {chromium}=require('playwright');
const {expect}=require('@playwright/test');
const fs=require('fs'),path=require('path');
(async()=>{
 const report={observed_at:new Date().toISOString(),checks:[],pageErrors:[]};
 const user=require('../.runtime/rehearsal-users.json').owner;
 const id=require('../.runtime/aws-rehearsal.json').mutations.find(m=>m.operation==='final application multipart upload').file_id;
 const browser=await chromium.launch({headless:true,executablePath:path.join(process.env.PROGRAMFILES,'BraveSoftware/Brave-Browser/Application/brave.exe')});
 const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
 page.on('pageerror',e=>report.pageErrors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:3100/login');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password',{exact:true}).fill(user.password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByText('File types · 1 locally indexed',{exact:true})).toBeVisible();
  await expect(page.getByText('Uploads · last 7 days (UTC)',{exact:true})).toBeVisible();
  for(const width of [360,390,1366]){
   await page.setViewportSize({width,height:844});
   await page.goto('http://127.0.0.1:3100/dashboard');
   await page.waitForLoadState('networkidle');
   await expect(page.getByText('File types · 1 locally indexed',{exact:true})).toBeVisible();
   if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))throw new Error('Dashboard overflow');
   await page.screenshot({path:`.runtime/screenshots/dashboard-final-${width}.png`,fullPage:true});
   await page.goto('http://127.0.0.1:3100/ask?fileId='+id);
   await expect(page.getByText('Selected document only',{exact:true})).toBeVisible();
   if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))throw new Error('Scoped Ask overflow');
   report.checks.push({width,dashboard_real_statistics:true,document_scope_badge:true,no_horizontal_overflow:true});
  }
  report.result=report.pageErrors.length?'failed':'passed';
  if(report.result!=='passed')throw new Error('Browser page errors');
  fs.writeFileSync('docs/FINAL_UI_ACCEPTANCE.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});
