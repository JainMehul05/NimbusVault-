const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch({headless:true,executablePath:process.env.NIMBUS_BROWSER||path.join(process.env.PROGRAMFILES,'BraveSoftware/Brave-Browser/Application/brave.exe')});
const p=await b.newPage({viewport:{width:1366,height:768}});const base=process.env.NIMBUS_ORIGIN;const dir=path.resolve('.runtime/aws-deployment/screenshots');
const t0=Date.now();await p.goto(base+'/',{waitUntil:'load'});const load=Date.now()-t0;await p.waitForTimeout(800);await p.screenshot({path:path.join(dir,'public-landing.png')});
await p.goto(base+'/register');await p.getByLabel('Invitation code').waitFor({timeout:15000});await p.screenshot({path:path.join(dir,'public-register-invite.png')});
const nav=await p.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return {ttfb:Math.round(n.responseStart),domContentLoaded:Math.round(n.domContentLoadedEventEnd),load:Math.round(n.loadEventEnd)}});
console.log(JSON.stringify({landing_load_ms:load,register_nav:nav,url:p.url()}));await b.close();})().catch(e=>{console.error(e.message);process.exit(1)});
