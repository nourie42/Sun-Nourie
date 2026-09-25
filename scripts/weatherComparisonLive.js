import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base='https://sun-nourie-live.onrender.com',dir='/tmp/weather-comparison-live';await fs.mkdir(dir,{recursive:true});
async function text(path){const r=await fetch(base+path,{signal:AbortSignal.timeout(20000),cache:'no-store'});return r.ok?await r.text():'';}
let deployed=false;
for(let i=0;i<60;i++){
 try{const [main,compare,bridge]=await Promise.all([text('/weather-fusion/?compare-check='+Date.now()),text('/weather-fusion/compare/?compare-check='+Date.now()),text('/weather-fusion/compare-bridge.js?compare-check='+Date.now())]);if(main.includes('id="weather-compare-link"')&&compare.includes('compare-v1-20260925')&&bridge.includes('performance.now()+500')){deployed=true;break;}}catch{}
 await new Promise(r=>setTimeout(r,10000));
}
assert.ok(deployed,'The tested comparison build has not deployed.');
const response=await fetch(base+'/api/weather-fusion/compare/locations',{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);const {points}=await response.json();assert.ok(points.length>0);
const point=points.find(p=>p.id==='knightdale')||points[0];
const dataResponse=await fetch(base+'/api/weather-fusion/compare/google?location='+encodeURIComponent(point.id),{signal:AbortSignal.timeout(40000)});assert.equal(dataResponse.status,200);const data=await dataResponse.json();assert.equal(data.comparison.source,'google');assert.ok(data.hours.some(h=>Date.parse(h.time)>=Date.now()&&Number.isFinite(h.temperature)));assert.ok(data.feeds.every(f=>f.id.startsWith('google-')));
const browser=await chromium.launch({headless:true});const report={deployed:true,liveData:true,point:point.id,runs:data.comparison.runs,viewports:[]};
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/weather-fusion/compare/?location='+encodeURIComponent(point.id),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#compare-status')?.textContent.includes('Both forecasts loaded'),null,{timeout:120000});
  for(const source of ['fusion','google']){const frame=page.frames().find(f=>f.url().includes('source='+source));assert.ok(frame);assert.equal(await frame.locator('.today-weather-card').count(),1);assert.ok(await frame.locator('.today-sky[src*="/weather-fusion/"]').count()>=1);}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('[data-view="both"]').click();await page.locator('[data-section="today-forecast"]').click();await page.screenshot({path:`${dir}/live-${width}.png`,fullPage:false});
  assert.deepEqual(errors,[]);report.viewports.push(width);await context.close();
 }
}finally{await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2));await browser.close();}
console.log('Live verification: Compare Google is on the main page; the comparison loads both actual forecasts and the original Today artwork.');console.log(JSON.stringify(report,null,2));
