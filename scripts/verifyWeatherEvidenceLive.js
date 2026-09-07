import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {CHANGES_VERSION,changeContext,activeChanges,changesText} from '../public/weather-fusion/forecast-changes.js';
const base='https://sun-nourie-live.onrender.com',path='/tmp/weather-evidence-live.json';
const report={commit:process.env.GITHUB_SHA,checkedAt:new Date().toISOString(),base,fixture:false,locations:[],success:false};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(90000),cache:'no-store'});assert.ok(r.ok,`${url}: ${r.status}`);return r.json();}
const assets=(await fs.readdir('public/weather-fusion')).filter(n=>/\.(?:js|css)$/.test(n)||n==='index.html');
const sha=s=>createHash('sha256').update(s).digest('hex');
const expected=Object.fromEntries(await Promise.all(assets.map(async n=>[n,sha(await fs.readFile('public/weather-fusion/'+n))])));
let ready=false;
for(let i=0;i<30&&!ready;i++){
 try{
  const f=await get(base+'/api/weather-fusion/forecast?location=knightdale');
  if(f.thermalAuditVersion==='weather-nourie-thermal-audit-v1'&&f.changesVersion===CHANGES_VERSION){
   const matches=await Promise.all(assets.map(async n=>{const r=await fetch(base+'/weather-fusion/'+n+'?verify='+Date.now(),{signal:AbortSignal.timeout(20000),cache:'no-store'});return r.ok&&sha(await r.text())===expected[n];}));
   ready=matches.every(Boolean);
  }
 }catch(e){console.log('Deployment not yet verified:',e.message);}
 if(!ready)await delay(15000);
}
assert.ok(ready,'New backend markers and all served browser assets must match this commit');
report.exactDeployedAssetCount=assets.length;console.log('EXACT_DEPLOYMENT_VERIFIED',report.commit);
const browser=await chromium.launch({headless:true});
try{
 for(const [id,name,latitude,longitude,width] of [['knightdale','Knightdale / Raleigh',35.787,-78.4806,390],['greenville','Greenville, NC',35.6127,-77.3664,390],['','Denver, CO',39.7392,-104.9903,1365]]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  await page.addInitScript(place=>localStorage.setItem('weather-fusion-place',JSON.stringify(place)),{id,name,latitude,longitude});
  page.on('pageerror',e=>errors.push(e.message));
  const received=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/forecast?')&&r.status()===200,{timeout:90000});
  const briefingResponse=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/briefing?'),{timeout:90000}).catch(()=>null);
  await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded',timeout:90000});
  const f=await (await received).json();
  assert.equal(f.thermalAuditVersion,'weather-nourie-thermal-audit-v1');
  await page.waitForFunction(()=>document.querySelector('#hourly .hour-current .hour-feels b')&&document.querySelector('.sun-person figcaption strong'),null,{timeout:75000});
  const response=await briefingResponse;let b=null;
  if(response?.ok())b=await response.json();
  const active=activeChanges(b,f,Date.now()),wanted=changesText(b,f,Date.now());
  await page.waitForFunction(text=>document.querySelector('#today-uncertainty-text')?.textContent===text,wanted,{timeout:30000});
  assert.equal(await page.locator('#today-uncertainty').isVisible(),active.length>0);
  assert.equal((await page.locator('.today-uncertainty-label').textContent()).trim(),"Dan's take");
  assert.ok(!(await page.locator('#nws-bulletins').textContent()).includes('In plain words'));
  if(name==='Knightdale / Raleigh'&&f.aiConfigured&&changeContext(f).candidates.length){
   assert.equal(b?.mode,'ai','Actual AI synthesis must work, not just a deterministic mock');
   assert.ok(active.length,'The current local discussion contains a supported future possibility; the actual AI should explain it');
  }
  for(const c of active){assert.ok(f.discussion.text.replace(/\s+/g,' ').includes(c.text));assert.ok(Date.parse(c.validUntil)>Date.now());}
  const currentHour=f.metricForecasts.series.feels.find(p=>Date.parse(p.time)<=Date.now()&&Date.now()<Date.parse(p.time)+3600000);
  const view=await page.evaluate(()=>({now:document.querySelector('#hourly .hour-current .hour-feels b').textContent.trim(),outdoor:document.querySelector('.sun-person figcaption strong').textContent.trim(),shade:document.querySelector('.shade-person figcaption strong').textContent.trim(),nowSource:document.querySelector('#hourly .hour-current small').textContent.trim(),firstForecastTime:document.querySelector('#hourly .forecast-hour')?.dataset.time,firstForecast:document.querySelector('#hourly .forecast-hour .hour-feels b')?.textContent.trim(),sourceEvidence:document.querySelector('#thermal-input-evidence')?.textContent,danText:document.querySelector('#today-uncertainty-text').textContent,noOverflow:document.documentElement.scrollWidth<=innerWidth+1}));
  const degree=v=>Number.isFinite(v)?Math.round(v)+'°':'—';
  assert.equal(view.now,degree(f.comfort.rawOutdoors));assert.equal(view.outdoor,Number.isFinite(f.comfort.rawOutdoors)?degree(f.comfort.rawOutdoors):'Unavailable');
  assert.equal(view.nowSource,'Station estimate');assert.ok(view.noOverflow);
  if(currentHour&&Number.isFinite(currentHour.value)){assert.equal(Date.parse(view.firstForecastTime),Date.parse(currentHour.time));assert.equal(view.firstForecast,degree(currentHour.value));}
  assert.deepEqual(errors,[]);
  report.locations.push({name,width,current:f.current,comfort:f.comfort,currentHourForecast:currentHour||null,discussion:{id:f.discussion?.id,issuedAt:f.discussion?.issuanceTime,office:f.discussion?.office},briefingMode:b?.mode||null,forecastChanges:active,view,passed:true});
  console.log('LIVE_VERIFIED',name,'Dan items:',active.length,'Observed estimate:',view.now,'current-hour forecast:',view.firstForecast);
  await page.locator('#skin-exposure').screenshot({path:'/tmp/weather-evidence-'+(id||'denver')+'.png'});
  await context.close();
 }
 report.success=true;
}finally{await browser.close();await fs.writeFile(path,JSON.stringify(report,null,2)+'\n');}
console.log('LIVE_EVIDENCE_AND_THERMAL_RENDERING_PASSED');
