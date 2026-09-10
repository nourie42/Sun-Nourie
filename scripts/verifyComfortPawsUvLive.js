import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {EXPOSURE_VERSION} from '../src/weatherFusionExposure.js';
import {DAN_TAKE_VERSION} from '../public/weather-fusion/dans-take.js';
import {currentSample} from '../public/weather-fusion/weather-display.js';
const base=process.env.WEATHER_BASE_URL||'https://sun-nourie-live.onrender.com';
const output=process.env.WEATHER_QA_DIR||'../qa';
await fs.mkdir(output,{recursive:true});
const assets=['index.html','app.js','weather-math.js','weather-display.js','current-inputs.js','daily-uv.js','dans-summary.js','dans-take.js','pavement.js','experience.js','exposure-scene.js','dewpoint-meter.js','weather-repair.css','hourly-feels.css','poodle-walk.png'];
const digest=(body,name)=>createHash('sha256').update(name.endsWith('.png')?body:body.toString().replace(/\r\n/g,'\n')).digest('hex');
const expected=Object.fromEntries(await Promise.all(assets.map(async name=>[name,digest(await fs.readFile('public/weather-fusion/'+name),name)])));
const report={base,commit:process.env.GITHUB_SHA,checkedAt:new Date().toISOString(),fixture:false,success:false,locations:[]};
let deployed=false;
for(let attempt=0;attempt<35;attempt++){
 try{
  const f=await fetch(base+'/api/weather-fusion/forecast?location=knightdale',{signal:AbortSignal.timeout(45000),cache:'no-store'}).then(r=>r.json());
  if(f.exposureVersion===EXPOSURE_VERSION&&f.danTakeVersion===DAN_TAKE_VERSION){
   const matches=await Promise.all(assets.map(async name=>{
    const r=await fetch(base+'/weather-fusion/'+name+'?release-proof='+Date.now(),{signal:AbortSignal.timeout(20000),cache:'no-store'});
    return r.ok&&digest(Buffer.from(await r.arrayBuffer()),name)===expected[name];
   }));
   if(matches.every(Boolean)){deployed=true;report.exactAssets=assets;break;}
   console.log('Waiting for exact frontend assets',assets.filter((_,i)=>!matches[i]));
  }else console.log('Waiting for new backend',f.exposureVersion,f.danTakeVersion);
 }catch(error){console.log('Waiting for deployment',error.message);}
 await new Promise(r=>setTimeout(r,15000));
}
assert.ok(deployed,'Exact changed frontend assets and new backend contract must be deployed');
console.log('EXACT_DEPLOYMENT_VERIFIED',EXPOSURE_VERSION);
const launch={headless:true};if(process.env.WEATHER_BROWSER_PATH)launch.executablePath=process.env.WEATHER_BROWSER_PATH;
const browser=await chromium.launch(launch);
try{
 for(const [id,name,latitude,longitude,width] of [
  ['greenville','Greenville, NC',35.6127,-77.3664,390],
  ['knightdale','Knightdale / Raleigh',35.787,-78.4806,1440]
 ]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(place=>localStorage.setItem('weather-fusion-place',JSON.stringify(place)),{id,name,latitude,longitude});
  const forecastResponse=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/forecast?')&&r.status()===200,{timeout:90000});
  const briefingResponse=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/briefing?'),{timeout:90000}).then(r=>r.json()).catch(error=>({error:error.message}));
  await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded',timeout:90000});
  const f=await (await forecastResponse).json();
  await page.waitForSelector('#pavement-content[data-status="estimated"]',{timeout:90000});
  const briefing=await briefingResponse;
  await page.waitForFunction(()=>document.querySelector('#today-uncertainty-text')?.textContent.length>20);
  const rendered=await page.evaluate(()=>{
   const q=s=>document.querySelector(s),text=s=>q(s)?.textContent.trim();
   const row=q('#daily .day-row'),low=row.querySelector('.day-low').getBoundingClientRect(),high=row.querySelector('.day-high').getBoundingClientRect();
   const a=q('#skin-exposure').getBoundingClientRect(),b=q('#pavement-exposure').getBoundingClientRect(),c=q('#dewpoint-gross-meter').getBoundingClientRect();
   return {overflow:document.documentElement.scrollWidth>innerWidth+1,highRight:high.left>low.right,uvRows:[...document.querySelectorAll('#daily .daily-uv')].map(el=>el.textContent.trim()),heroUv:text('#hero-uv'),todayUv:text('#today-forecast .daily-uv'),take:text('#today-uncertainty-text'),takeSource:text('#today-take-source'),takeVisible:!q('#today-uncertainty').hidden,sun:text('.sun-person figcaption strong'),now:text('#hourly .hour-current .hour-feels b'),hero:text('#hero-feels strong'),metric:text('.metric-feels .metric-value'),caption:text('.comfort-preview-heading'),pavement:text('#pavement-content'),image:q('.poodle-walk').complete&&q('.poodle-walk').naturalWidth>0,hands:[...document.querySelectorAll('.friendly-wave')].every(el=>getComputedStyle(el).animationName==='none'),lowerHands:document.querySelectorAll('.person-resting-hand').length,sameRow:Math.abs(a.top-b.top)<2,pawsBeforeMeter:b.top<c.top};
  });
  const current=currentSample(f);
  assert.ok(Number.isFinite(f.comfort.outdoors));assert.equal(current.comfort.outdoors,f.comfort.outdoors);
  for(const key of ['sun','now','hero','metric'])assert.equal(rendered[key],Math.round(f.comfort.outdoors)+'°',id+' '+key);
  assert.equal(rendered.overflow,false);assert.equal(rendered.highRight,true);assert.equal(rendered.uvRows.length,7);
  assert.ok(f.days.every(d=>Number.isFinite(d.uvMax)));
  f.days.forEach((d,i)=>assert.ok(rendered.uvRows[i].includes('Peak UV '+Math.round(d.uvMax)),id+' UV '+d.date));
  assert.ok(rendered.heroUv.includes('Peak UV today '+Math.round(f.days[0].uvMax)));
  assert.match(rendered.todayUv,new RegExp('Peak UV (?:today )?'+Math.round(f.days[0].uvMax)));
  assert.equal(rendered.takeVisible,true);assert.ok(rendered.take.length>20);assert.match(rendered.takeSource,/NWS/);
  assert.equal(rendered.image,true);assert.equal(rendered.hands,true);assert.equal(rendered.lowerHands,2);
  assert.match(rendered.pavement,/Estimated range/);assert.doesNotMatch(rendered.pavement,/Estimate unavailable/);
  assert.equal(rendered.pawsBeforeMeter,true);if(width>1000)assert.equal(rendered.sameRow,true);
  if(current.inputs.comfortEstimatedFields.length)assert.match(rendered.caption,/estimated from the current forecast hour/);
  await page.locator('.exposure-cards').screenshot({path:`${output}/live-exposure-${id}.png`});
  await page.locator('.today-panel').screenshot({path:`${output}/live-today-${id}.png`});
  await page.locator('.daily-panel').screenshot({path:`${output}/live-daily-${id}.png`});
  assert.deepEqual(errors,[]);
  const result={id,width,assembledAt:f.assembledAt,station:f.current.station,rawWind:f.current.wind,estimatedFields:current.inputs.comfortEstimatedFields,feels:f.comfort.outdoors,uv:f.days.map(d=>({date:d.date,max:d.uvMax})),briefingMode:briefing.mode||briefing.error,rendered};
  report.locations.push(result);console.log('LIVE_LOCATION_VERIFIED',JSON.stringify(result));
  await context.close();
 }
 report.success=true;
}finally{
 await browser.close();await fs.writeFile(output+'/live-comfort-paws-uv.json',JSON.stringify(report,null,2)+'\n');
}
console.log('LIVE_COMFORT_PAWS_UV_PASSED');
