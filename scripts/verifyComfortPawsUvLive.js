import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {EXPOSURE_VERSION} from '../src/weatherFusionExposure.js';
import {DAN_TAKE_VERSION} from '../public/weather-fusion/dans-take.js';
import {danCard} from '../public/weather-fusion/dans-summary.js';
import {hourlyUvValue,uvCategory} from '../public/weather-fusion/daily-uv.js';
import {walkerOutfit} from '../public/weather-fusion/pavement.js';
import {dayGraphPoints} from '../public/weather-fusion/day-graph.js';
import {currentSample} from '../public/weather-fusion/weather-display.js';
const base=process.env.WEATHER_BASE_URL||'https://sun-nourie-live.onrender.com';
const output=process.env.WEATHER_QA_DIR||'../qa';
await fs.mkdir(output,{recursive:true});
const assets=['index.html','app.js','weather-math.js','weather-display.js','current-inputs.js','daily-uv.js','dans-summary.js','dans-take.js','pavement.js','experience.js','exposure-scene.js','dewpoint-meter.js','weather-repair.css','hourly-feels.css','poodle-walk.png','poodle-walk-hot.png','poodle-walk-mild.png','poodle-walk-cold.png','comfort-reference-scenes.webp','comfort-reference-scenes-hot.webp','comfort-reference-scenes-rain.webp','comfort-reference-scenes-cold.webp','day-graph.js','forecast-confidence.js'];
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
  const expectedTake=danCard(briefing?.mode?briefing:{danTake:f.danTake},f).text;
  await page.waitForFunction(text=>document.querySelector('#today-uncertainty-text')?.textContent===text,expectedTake);
  await page.waitForFunction(()=>{const img=document.querySelector('.poodle-walk');return img?.complete&&img.naturalWidth>0;},null,{timeout:30000});
  const rendered=await page.evaluate(()=>{
   const q=s=>document.querySelector(s),text=s=>q(s)?.textContent.trim();
   const row=q('#daily .day-row'),low=row.querySelector('.day-low').getBoundingClientRect(),high=row.querySelector('.day-high').getBoundingClientRect();
   const a=q('.sun-person').getBoundingClientRect(),b=q('#pavement-content').getBoundingClientRect(),c=q('#skin-exposure').getBoundingClientRect();
   return {overflow:document.documentElement.scrollWidth>innerWidth+1,highRight:high.left>low.right,uvRows:[...document.querySelectorAll('#daily .daily-uv')].map(el=>el.textContent.trim()),heroUv:text('#hero-uv'),todayUv:text('#today-forecast .daily-uv'),take:text('#today-uncertainty-text'),takeSource:text('#today-take-source'),takeVisible:!q('#today-uncertainty').hidden,sun:text('.sun-person figcaption strong'),now:text('#hourly .hour-current .hour-feels b'),hero:text('#hero-feels strong'),metric:text('.metric-feels .metric-value'),caption:text('#comfort-extra-science'),hourUv:[...document.querySelectorAll('#hourly .hour')].map(el=>({time:el.classList.contains('hour-current')?Date.now():Date.parse(el.dataset.time),value:el.querySelector('.hour-uv b').textContent})),meta:[...document.querySelectorAll('.day-meta')].every(el=>{const a=el.querySelector('.forecast-confidence').getBoundingClientRect(),b=el.querySelector('.daily-uv').getBoundingClientRect();return b.left>=a.right&&Math.abs((b.top+b.bottom-a.top-a.bottom)/2)<2;}),pavement:text('#pavement-content'),ranges:text('.pavement-details'),image:q('.poodle-walk').complete&&q('.poodle-walk').naturalWidth>0,hands:[...document.querySelectorAll('.friendly-wave')].every(el=>getComputedStyle(el).animationName==='none'),lowerHands:document.querySelectorAll('.person-resting-hand').length,sameRow:Math.abs(a.top-b.top)<2,pawsRight:b.left>=a.right,pawsInside:b.left>=c.left&&b.right<=c.right&&q('#skin-exposure').contains(q('#pavement-content'))};
  });
  const current=currentSample(f);
  assert.ok(Number.isFinite(f.comfort.outdoors));assert.equal(current.comfort.outdoors,f.comfort.outdoors);
  for(const key of ['sun','now','hero','metric'])assert.equal(rendered[key],Math.round(f.comfort.outdoors)+'°',id+' '+key);
  assert.equal(rendered.overflow,false);assert.equal(rendered.highRight,true);assert.equal(rendered.uvRows.length,7);
  assert.ok(f.days.every(d=>Number.isFinite(d.uvMax)));
  f.days.forEach((d,i)=>assert.ok(rendered.uvRows[i].includes('Peak UV '+Math.round(d.uvMax)),id+' UV '+d.date));
  assert.ok(rendered.heroUv.includes('Peak UV today '+Math.round(f.days[0].uvMax)));
  assert.match(rendered.todayUv,new RegExp('Peak UV (?:today )?'+Math.round(f.days[0].uvMax)));
  assert.equal(rendered.takeVisible,Boolean(expectedTake));assert.equal(rendered.take,expectedTake);assert.ok(rendered.take.length<=380);assert.ok(!rendered.take||rendered.take.split(/\s+/).length<=55);assert.equal(rendered.takeSource,undefined);
  assert.equal(rendered.image,true);assert.equal(rendered.hands,true);assert.equal(rendered.lowerHands,2);
  assert.match(rendered.ranges,/range/i);assert.doesNotMatch(rendered.pavement,/Estimate unavailable/);
  assert.equal(rendered.pawsRight,true);assert.equal(rendered.pawsInside,true);assert.equal(rendered.sameRow,true);assert.equal(rendered.meta,true);
  assert.ok(rendered.hourUv.length>=40);for(const h of rendered.hourUv)assert.equal(h.value,String(uvCategory(hourlyUvValue(f,h.time)).index??'—'));
  assert.ok(new Set(rendered.hourUv.map(h=>h.value)).size>3);
  if(current.inputs.comfortEstimatedFields.length)assert.match(rendered.caption,/estimated from the current forecast hour/);
  await page.locator('.exposure-cards').screenshot({path:`${output}/live-exposure-${id}.png`});
  await page.locator('.today-panel').screenshot({path:`${output}/live-today-${id}.png`});
  await page.locator('.daily-panel').screenshot({path:`${output}/live-daily-${id}.png`});
  assert.equal(await page.locator('.poodle-walk').getAttribute('data-outfit'),walkerOutfit(current.feels).outfit);
  assert.doesNotMatch(await page.locator('#skin-exposure').innerText(),/station|paw care|Sidewalk ranges|source air temperature/i);
  assert.doesNotMatch(rendered.take,/subsidence|mid[ -]level|sinking air|instability|shear/i);
  for(const d of f.days){const actual=[...new Set(Object.values(d.confidence.contributions).flat().filter(s=>s.weight>0&&Number.isFinite(s.value)).map(s=>s.id))].sort();assert.deepEqual([...d.confidence.sourceIds].sort(),actual);}
  await page.locator('#daily [data-day="1"]').click();await page.waitForSelector('#day-dialog[open]');
  assert.equal(await page.locator('.day-graph [data-series]').count(),4);
  await page.locator('#day-graph-hour').fill('2');
  const graphPoint=dayGraphPoints(f,1)[2];
  for(const key of ['temperature','feels','dewpoint','uv'])assert.equal(await page.locator('[data-readout="'+key+'"] strong').innerText(),Number.isFinite(graphPoint[key])?Math.round(graphPoint[key])+(key==='uv'?'':'°'):'—');
  await page.locator('#day-content').screenshot({path:output+'/live-combined-day-'+id+'.png'});
  await page.locator('#close-day').click();
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
