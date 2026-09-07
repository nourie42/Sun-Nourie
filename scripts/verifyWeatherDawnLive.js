import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {DAN_TAKE_VERSION,collectDanTakeEvidence,visibleDanTakeItems,danTakeText} from '../public/weather-fusion/dans-take.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';
import {sourceTransition} from '../public/weather-fusion/source-transition.js';
const base='https://sun-nourie-live.onrender.com',out='/tmp/weather-dawn-live';
await fs.mkdir(out,{recursive:true});
const report={commit:process.env.GITHUB_SHA,checkedAt:new Date().toISOString(),fixture:false,success:false,locations:[],referenceInputs:[]};
const hash=s=>createHash('sha256').update(s).digest('hex');
const assets=['index.html','app.js','dans-take.js','source-transition.js','weather-display.js','experience.js','personal-details.js','hourly-feels.css'];
const wanted=Object.fromEntries(await Promise.all(assets.map(async p=>[p,hash(await fs.readFile('public/weather-fusion/'+p))])));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const degrees=n=>Number.isFinite(n)?Math.round(n)+'°':'—';
async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(80000),cache:'no-store'});assert.ok(r.ok,url+' '+r.status);return r.json();}
let deployed=false,browser;
try{
 for(let i=0;i<35&&!deployed;i++){
  try{
   const f=await json(base+'/api/weather-fusion/forecast?location=knightdale');
   if(f.dawnVersion==='weather-nourie-dawn-v1'){
    const checks=await Promise.all(assets.map(async p=>{const r=await fetch(base+'/weather-fusion/'+p+'?verify='+Date.now(),{signal:AbortSignal.timeout(20000),cache:'no-store'});return r.ok&&hash(await r.text())===wanted[p];}));
    deployed=checks.every(Boolean);
   }
  }catch(e){console.log('Waiting for exact deployment:',e.message);}
  if(!deployed)await delay(15000);
 }
 assert.ok(deployed,'Backend marker and all changed browser files must match the reviewed commit');
 report.deployedAssets=wanted;report.version=DAN_TAKE_VERSION;
 console.log('EXACT_DAWN_DEPLOYMENT_VERIFIED',report.commit);
 browser=await chromium.launch({headless:true});
 const places=[{id:'knightdale',name:'Knightdale / Raleigh',latitude:35.787,longitude:-78.4806},{id:'',name:'White Lake, NC',latitude:34.6385,longitude:-78.5025},{id:'',name:'Denver, CO',latitude:39.7392,longitude:-104.9903},{id:'',name:'Seattle, WA',latitude:47.6062,longitude:-122.3321}];
 for(const [index,place] of places.entries()){
  const width=index===2?1365:390,context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(place=>localStorage.setItem('weather-fusion-place',JSON.stringify(place)),place);
  let f,take,matched=false;
  for(let attempt=0;attempt<3&&!matched;attempt++){
   const forecastPromise=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/forecast?')&&r.status()===200,{timeout:90000});
   const takePromise=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/dans-take?'),{timeout:100000});takePromise.catch(()=>{});
   await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded',timeout:90000});
   f=await (await forecastPromise).json();assert.equal(f.dawnVersion,'weather-nourie-dawn-v1');
   const response=await takePromise;
   if(!response.ok())continue;
   take=await response.json();matched=take.signature===f.signature;
  }
  assert.ok(matched,'Independent take must match the actual displayed forecast');
  assert.equal(take.danTakeVersion,DAN_TAKE_VERSION);
  const now=Date.now(),evidence=collectDanTakeEvidence(f,now),items=visibleDanTakeItems(take,f,now),text=danTakeText(items);
  if(evidence.candidates.length){
   assert.equal(take.mode,'ai','Actual AI must work where the current local discussion supplies candidates');
   if(place.id==='knightdale'){
    assert.ok(items.length>0,'Acceptance must demonstrate a real visible Raleigh take, not a blank card');
    if(evidence.candidates.some(c=>/QPF/.test(c.quote))&&evidence.candidates.some(c=>/timing|when the front|Friday vs Thursday/.test(c.quote)))assert.ok(items.length>=2,'Retain distinct timing and rainfall-amount concerns');
   }
  }else assert.equal(items.length,0,'No fabricated concern in a quiet discussion');
  await page.waitForFunction(expected=>document.querySelector('#today-uncertainty-text')?.textContent===expected,text,{timeout:15000});
  assert.equal(await page.locator('#today-uncertainty').isVisible(),items.length>0);
  await page.waitForFunction(()=>document.querySelector('#hourly-source-note')&&!document.querySelector('#hourly-source-note').hidden,null,{timeout:30000});
  await page.waitForTimeout(1200);
  assert.equal((await page.locator('#today-uncertainty-text').textContent()).trim(),text,'Main outlook must not erase the independent take');
  const calculated=thermalComfort(f.current,f.location,Date.parse(f.assembledAt));
  const shown=(await page.locator('#hourly .hour-current .hour-feels b').textContent()).trim();
  assert.equal(shown,degrees(calculated.rawOutdoors));
  assert.equal((await page.locator('.sun-person figcaption strong').textContent()).trim(),Number.isFinite(calculated.rawOutdoors)?shown:'Unavailable');
  let checkedHours=0;
  for(const p of f.metricForecasts.series.feels){
   const c=thermalComfort({...p.inputs,condition:p.condition},f.location,Date.parse(p.time));
   if(Number.isFinite(p.value)){assert.ok(Number.isFinite(c.rawOutdoors));assert.ok(Math.abs(p.value-c.rawOutdoors)<=.051);}
   else assert.ok(!Number.isFinite(c.rawOutdoors));
   const h=f.hours.find(h=>h.time===p.time);
   if(h){assert.equal(h.windMph,p.inputs.wind);assert.equal(h.humidity,p.inputs.humidity);assert.equal(h.dewpoint,p.inputs.dewpoint);assert.equal(h.isDay,c.daylight);checkedHours++;}
   if(Number.isFinite(c.rawOutdoors))report.referenceInputs.push({place:place.name,time:p.time,temperature:p.inputs.temperature,humidity:c.humidity,wind:p.inputs.wind,tr:c.inputEvidence.meanRadiantTemperatureF,actual:c.rawOutdoors});
  }
  report.referenceInputs.push({place:place.name,time:f.current.time,temperature:f.current.temperature,humidity:calculated.humidity,wind:f.current.wind,tr:calculated.inputEvidence.meanRadiantTemperatureF,actual:calculated.rawOutdoors});
  const centers=await page.locator('#daily .day-high').evaluateAll(cols=>cols.map(c=>{const a=c.querySelector(':scope>strong').getBoundingClientRect(),b=c.querySelector('.daily-feels b').getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2);}));
  assert.equal(centers.length,7);assert.ok(centers.every(x=>x<=1));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);
  const transition=sourceTransition(f,now),row={place:place.name,width,checkedAt:new Date(now).toISOString(),current:f.current,comfort:calculated,sourceTransition:transition,discussion:{id:f.discussion?.id,issuedAt:f.discussion?.issuanceTime,office:f.discussion?.office},candidateCount:evidence.candidates.length,take,renderedTake:text,checkedHours,centeringErrorsPx:centers,seventhDay:f.days.at(-1)};
  report.locations.push(row);console.log('LIVE_DAWN_CHECK',JSON.stringify({place:place.name,items:items.length,text,now:shown,transition,checkedHours}));
  if(index===0){
   await page.locator('.today-panel').screenshot({path:out+'/live-dans-take.png'});
   await page.locator('#hourly-source-note > details > summary').click();
   await page.locator('.hourly-panel').screenshot({path:out+'/live-hourly.png'});
   await page.locator('.daily-panel').screenshot({path:out+'/live-seven-days.png'});
  }
  await context.close();
 }
 assert.ok(report.locations.some(r=>r.take.mode==='ai'&&r.take.forecastChanges.length),'At least one actual positive AI take is required');
 report.success=true;
}finally{if(browser)await browser.close();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));}
console.log('LIVE_DAWN_AND_DISCUSSION_PASSED',report.commit);
