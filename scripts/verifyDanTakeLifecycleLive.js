import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {DAN_TAKE_VERSION,collectDanTakeEvidence,visibleDanTakeItems} from '../public/weather-fusion/dans-take.js';
const base='https://sun-nourie-live.onrender.com',dir='/tmp/dans-lifecycle-live';
await fs.mkdir(dir,{recursive:true});
const report={commit:process.env.GITHUB_SHA,checkedAt:new Date().toISOString(),fixture:false,success:false,checks:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const hash=v=>createHash('sha256').update(v).digest('hex');
const files=['index.html','app.js','dans-take.js'];
const wanted=Object.fromEntries(await Promise.all(files.map(async p=>[p,hash(await fs.readFile('public/weather-fusion/'+p))])));
async function json(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(85000)});return {status:r.status,data:await r.json()};}
let browser;
try{
 let deployed=false;
 for(let attempt=0;attempt<24&&!deployed;attempt++){
  try{
   const {status,data:f}=await json(base+'/api/weather-fusion/forecast?location=knightdale');
   if(status===200&&f.discussionSourceVersion==='nws-afd-monotonic-v1'&&f.danTakeVersion===DAN_TAKE_VERSION){
    const checks=await Promise.all(files.map(async p=>{const r=await fetch(base+'/weather-fusion/'+p+'?verify='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)});return r.ok&&hash(await r.text())===wanted[p];}));
    deployed=checks.every(Boolean);
   }
  }catch(e){console.log('Waiting for exact deployment:',e.message);}
  if(!deployed)await delay(15000);
 }
 assert.ok(deployed,'Exact source-selection marker and frontend files must be live');
 report.deployed={sourceVersion:'nws-afd-monotonic-v1',danTakeVersion:DAN_TAKE_VERSION,assets:wanted};
 const {data:official}=await json('https://api.weather.gov/products/types/AFD/locations/RAH/latest');
 report.independentOfficialLatest={id:official.id,issuedAt:official.issuanceTime};
 let f,b;
 for(let attempt=0;attempt<3;attempt++){
  f=(await json(base+'/api/weather-fusion/forecast?location=knightdale')).data;
  const response=await json(base+'/api/weather-fusion/briefing?location=knightdale&signature='+f.signature);
  if(response.status===409)continue;
  assert.equal(response.status,200);b=response.data;break;
 }
 assert.ok(b&&f.discussion);assert.ok(Date.parse(f.discussion.issuanceTime)>=Date.parse(official.issuanceTime),'The live application cannot be behind the separately checked official latest product');
 const evidence=collectDanTakeEvidence(f),items=visibleDanTakeItems(b.danTake||b,f);
 assert.ok(evidence.candidates.length>0,'This test requires a real current Raleigh uncertainty, not a quiet empty state');
 assert.ok(items.length>0,'The real supported Raleigh take must be present');
 assert.ok(items.some(i=>i.period.includes('This coming week')));
 report.initial={discussion:f.discussion,feed:f.feeds.find(p=>p.id==='afd'),aiMode:b.mode,generatedAt:b.generatedAt,items};
 console.log('LIVE_CURRENT_SOURCE',JSON.stringify({id:f.discussion.id,issuedAt:f.discussion.issuanceTime,items}));
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:390,height:1000}}),page=await context.newPage(),errors=[];
 await page.addInitScript(()=>localStorage.setItem('weather-fusion-place',JSON.stringify({id:'knightdale',name:'Knightdale / Raleigh',latitude:35.787,longitude:-78.4806})));
 page.on('pageerror',e=>errors.push(e.message));
 let latestForecast=null;
 page.on('response',async r=>{if(r.url().includes('/api/weather-fusion/forecast?')&&r.ok()){try{latestForecast=await r.json();}catch{}}});
 await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#today-uncertainty')?.hidden===false,{},{timeout:80000});
 await page.evaluate(()=>{
  window.danTakeVisibility=[];
  new MutationObserver(()=>window.danTakeVisibility.push({hidden:document.querySelector('#today-uncertainty').hidden,text:document.querySelector('#today-uncertainty-text').textContent})).observe(document.querySelector('#today-uncertainty'),{attributes:true,subtree:true,childList:true,characterData:true});
 });
 async function record(label){
  assert.ok(latestForecast?.discussion);
  const text=(await page.locator('#today-uncertainty-text').textContent()).trim();
  assert.ok(text&&await page.locator('#today-uncertainty').isVisible(),label+' must have a visible actual message');
  assert.match(text,/This coming week/);
  const restored=visibleDanTakeItems(latestForecast.danTake,latestForecast);
  assert.ok(restored.length>0,'Forecast response must itself carry the revalidated take for an immediate reload');
  for(const item of restored)assert.ok(latestForecast.discussion.text.replace(/\s+/g,' ').includes(item.sourceQuote));
  const entry={label,checkedAt:new Date().toISOString(),signature:latestForecast.signature,discussionId:latestForecast.discussion.id,issuedAt:latestForecast.discussion.issuanceTime,cachedItems:restored,visible:true,text};
  report.checks.push(entry);console.log('LIVE_CARD_PERSISTENCE',JSON.stringify(entry));
 }
 await record('initial-page');
 // Cross both the one-minute forecast and two-minute AFD-cache lifetimes.
 for(let i=0;i<2;i++){
  await delay(65000);
  const response=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/forecast?')&&r.ok(),{timeout:80000});
  await page.locator('#refresh').click();latestForecast=await (await response).json();
  await page.waitForTimeout(500);await record('refresh-'+(i+1));
 }
 const history=await page.evaluate(()=>window.danTakeVisibility);
 assert.ok(history.length>0);assert.ok(history.every(s=>!s.hidden),'Valid current-source take must not blink out during weather refreshes');
 report.observedRefreshVisibility=history;
 const response=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/forecast?')&&r.ok(),{timeout:80000});
 await page.reload({waitUntil:'domcontentloaded'});latestForecast=await (await response).json();
 await page.waitForFunction(()=>document.querySelector('#today-uncertainty')?.hidden===false,null,{timeout:15000});
 await record('full-page-reload');
 assert.deepEqual(errors,[]);
 assert.ok(new Set(report.checks.map(x=>x.signature)).size>=2,'Verification must include changed numerical forecast snapshots, not four reads of one cached snapshot');
 await page.locator('.today-panel').screenshot({path:dir+'/raleigh-dans-take.png'});
 report.browserErrors=errors;report.success=true;
}finally{
 if(browser)await browser.close();await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2)+'\n');
}
console.log('DAN_TAKE_LIVE_LIFECYCLE_VERIFIED');
