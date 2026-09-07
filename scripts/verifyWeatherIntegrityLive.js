import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {thermalComfort,tier3FeelsLike} from '../public/weather-fusion/weather-math.js';
import {dailyFeels} from '../public/weather-fusion/hourly-feels.js';
import {DAN_TAKE_VERSION,visibleDanTakeItems,danTakeText} from '../public/weather-fusion/dans-take.js';
const base='https://sun-nourie-live.onrender.com',output='/tmp/weather-integrity-live.json';
const report={commit:process.env.GITHUB_SHA,checkedAt:new Date().toISOString(),fixture:false,locations:[],success:false};
const paths=['index.html','app.js','weather-math.js','utci.js','weather-display.js','personal-details.js','experience.js','hourly-feels.css','dans-take.js'];
const hash=s=>createHash('sha256').update(s).digest('hex');
const wanted=Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await fs.readFile('public/weather-fusion/'+p))])));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let ready=false,browser;
try{
 for(let attempt=0;attempt<24&&!ready;attempt++){
  try{
   const r=await fetch(base+'/api/weather-fusion/forecast?location=knightdale',{signal:AbortSignal.timeout(45000),cache:'no-store'}),f=await r.json();
   if(r.ok&&f.integrityVersion==='weather-nourie-integrity-v1'&&f.danTakeVersion===DAN_TAKE_VERSION){
    const result=await Promise.all(paths.map(async p=>{const r=await fetch(base+'/weather-fusion/'+p+'?review='+Date.now(),{signal:AbortSignal.timeout(20000),cache:'no-store'});return r.ok&&hash(await r.text())===wanted[p];}));
    ready=result.every(Boolean);
   }
  }catch(e){console.log('Waiting for reviewed deployment:',e.message);}
  if(!ready)await delay(15000);
 }
 assert.ok(ready,'Exact reviewed frontend bytes AND backend versions must be deployed');
 report.deployed={integrityVersion:'weather-nourie-integrity-v1',danTakeVersion:DAN_TAKE_VERSION,assets:wanted};
 console.log('EXACT_REVIEWED_DEPLOYMENT_VERIFIED',report.commit);
 browser=await chromium.launch({headless:true});
 const degrees=v=>Number.isFinite(v)?Math.round(v)+'°':'—';
 for(const place of [
  {id:'knightdale',name:'Knightdale / Raleigh',latitude:35.787,longitude:-78.4806},
  {id:'',name:'White Lake, NC',latitude:34.6385,longitude:-78.5025},
  {id:'',name:'Denver, CO',latitude:39.7392,longitude:-104.9903},
  {id:'',name:'Seattle, WA',latitude:47.6062,longitude:-122.3321}
 ]){
  const context=await browser.newContext({viewport:{width:390,height:1000}}),page=await context.newPage(),errors=[];
  await page.addInitScript(p=>localStorage.setItem('weather-fusion-place',JSON.stringify(p)),place);
  page.on('pageerror',e=>errors.push(e.message));
  let f,b;
  for(let attempt=0;attempt<2;attempt++){
   const forecast=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/forecast?')&&r.status()===200,{timeout:90000});
   const briefing=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/briefing?'),{timeout:90000}).catch(()=>null);
   await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded',timeout:90000});
   f=await (await forecast).json();
   const response=f.aiConfigured?await briefing:null;
   b=response?.ok()?await response.json():null;
   if(!f.aiConfigured||b?.signature===f.signature)break;
  }
  assert.equal(f.integrityVersion,'weather-nourie-integrity-v1');
  const at=Date.parse(f.assembledAt),calculated=thermalComfort(f.current,f.location,at);
  assert.equal(calculated.outdoors,f.comfort.outdoors);
  let numeric=0;
  for(const p of f.metricForecasts.series.feels){
   const expected=tier3FeelsLike({...p.inputs,condition:p.condition},f.location,Date.parse(p.time),'outdoors').value;
   assert.equal(Number.isFinite(p.value),Number.isFinite(expected));
   if(Number.isFinite(expected)){assert.ok(Math.abs(expected-p.value)<=.051);numeric++;}
   const h=f.hours.find(h=>Date.parse(h.time)===Date.parse(p.time));
   if(h){assert.equal(h.feelsLike,p.value);assert.equal(h.skyCover,p.inputs.skyCover);assert.equal(h.windMph,p.inputs.wind);}
  }
  const items=visibleDanTakeItems(b,f,Date.now()),text=danTakeText(items);
  await page.waitForFunction(()=>document.querySelector('#hourly .hour-current .hour-feels b')&&document.querySelector('.sun-person figcaption strong'),null,{timeout:75000});
  await page.waitForFunction(text=>document.querySelector('#today-uncertainty-text').textContent===text,text,{timeout:20000});
  assert.equal(await page.locator('#today-uncertainty').isVisible(),items.length>0);
  assert.equal((await page.locator('.today-uncertainty-label').textContent()).trim(),"Dan's take");
  for(const item of items){assert.ok(f.discussion.text.replace(/\s+/g,' ').includes(item.sourceQuote));assert.ok(Date.parse(item.eventEnd)>Date.now());}
  const shown=(await page.locator('#hourly .hour-current .hour-feels b').innerText()).trim();
  assert.equal(shown,degrees(calculated.rawOutdoors));
  assert.equal((await page.locator('.sun-person figcaption strong').innerText()).trim(),Number.isFinite(calculated.rawOutdoors)?shown:'Unavailable');
  // Evidence lives inside a native collapsed details element. Exercise the
  // user's actual open-details interaction before asserting visible text.
  const calculationDetails=page.locator('details').filter({has:page.locator('#thermal-input-evidence')});
  if((await calculationDetails.getAttribute('open'))===null)await calculationDetails.locator(':scope > summary').click();
  await page.locator('#thermal-input-evidence').waitFor({state:'visible'});
  assert.match(await page.locator('#thermal-input-evidence').innerText(),/Current station inputs/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const center=await page.locator('#daily .day-high').evaluateAll(cols=>cols.map(c=>{const a=c.querySelector(':scope>strong').getBoundingClientRect(),b=c.querySelector('.daily-feels b').getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2);}));
  assert.ok(center.every(x=>x<=1));
  const first=page.locator('#hourly .forecast-hour').first();
  if(await first.count()){
   const time=await first.getAttribute('data-time');
   const point=f.metricForecasts.series.feels.find(p=>Date.parse(p.time)===Date.parse(time));
   assert.ok(point,'Rendered hourly instant must have its own calculation inputs');
   await first.click();assert.equal((await page.locator('.sun-person figcaption strong').innerText()).trim(),Number.isFinite(point.value)?degrees(point.value):'Unavailable');
  }
  const last=dailyFeels(f,6,Date.now()).high?.high;
  if(last){const v=(await page.locator('#daily .day-row').nth(6).locator('.day-high .daily-feels b').innerText()).trim();assert.equal(v,degrees(last.value));}
  assert.deepEqual(errors,[]);
  const row={place:place.name,observation:f.current.time,station:f.current.station,currentInputs:calculated.inputEvidence,currentOutdoor:calculated.rawOutdoors,numericForecastHours:numeric,daySevenPeak:last?{time:last.time,value:last.value,inputs:last.inputs}:null,aiMode:b?.mode||null,aiReason:b?.reason||null,danTake:text,approvedChanges:items,maximumCenteringErrorPx:Math.max(...center),passed:true};
  report.locations.push(row);console.log('LIVE_REVIEW_PASSED',JSON.stringify(row));
  const safe=place.id||place.name.split(',')[0].toLowerCase().replace(/\s/g,'-');
  await page.locator('#daily').screenshot({path:'/tmp/weather-integrity-'+safe+'.png'});
  await context.close();
 }
 report.actualAICount=report.locations.filter(x=>x.aiMode==='ai').length;
 assert.ok(report.actualAICount>0,'At least one live AI generation must be verified, not only hidden fallback cards');
 report.success=true;
}finally{
 if(browser)await browser.close();await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
}
console.log('LIVE_WEATHER_INTEGRITY_VERIFIED');
