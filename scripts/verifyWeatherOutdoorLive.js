import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {OUTDOOR_FEELS_VERSION} from '../public/weather-fusion/outdoor-feels.js';
const base='https://sun-nourie-live.onrender.com';
const report={checkedAt:new Date().toISOString(),commit:process.env.GITHUB_SHA,base,fixture:false,success:false,locations:[]};
const output=process.env.WEATHER_OUTDOOR_REPORT||'/tmp/weather-outdoor-live.json';
const assets=['index.html','app.js','weather-display.js','experience.js','personal-details.js','hourly-feels.js','comfort-outlook.js','outdoor-feels.js','hourly-feels.css'];
const digest=body=>createHash('sha256').update(body).digest('hex');
const wanted=Object.fromEntries(await Promise.all(assets.map(async p=>[p,digest(await fs.readFile('public/weather-fusion/'+p))])));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let deployed=false;
for(let attempt=0;attempt<35;attempt++){
 try{
  const response=await fetch(base+'/api/weather-fusion/forecast?location=knightdale',{signal:AbortSignal.timeout(45000),cache:'no-store'});
  const f=await response.json();
  if(response.ok&&f.outdoorFeelsVersion===OUTDOOR_FEELS_VERSION){
   const matches=await Promise.all(assets.map(async p=>{
    const r=await fetch(base+'/weather-fusion/'+p+'?deployment-proof='+Date.now(),{signal:AbortSignal.timeout(20000),cache:'no-store'});
    return r.ok&&digest(await r.text())===wanted[p];
   }));
   if(matches.every(Boolean)){deployed=true;report.exactDeployedAssets=assets;report.outdoorFeelsVersion=f.outdoorFeelsVersion;break;}
  }
 }catch(error){console.log('Waiting for exact deployment:',error.message);}
 await delay(15000);
}
assert.ok(deployed,'The production backend marker and exact changed frontend bytes must match this commit');
console.log('DEPLOYMENT_VERIFIED',process.env.GITHUB_SHA,OUTDOOR_FEELS_VERSION);
const browser=await chromium.launch({headless:true});
const degrees=v=>Number.isFinite(v)?Math.round(v)+'°':'—';
try{
 for(const [id,name,latitude,longitude,width] of [
  ['knightdale','Knightdale / Raleigh',35.787,-78.4806,390],
  ['','White Lake, NC',34.6385,-78.5025,390],
  ['','Jacksonville, FL',30.3322,-81.6557,390],
  ['','Denver, CO',39.7392,-104.9903,1365]
 ]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  await page.addInitScript(place=>localStorage.setItem('weather-fusion-place',JSON.stringify(place)),{id,name,latitude,longitude});
  page.on('pageerror',error=>errors.push(error.message));
  const forecastResponse=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/forecast?')&&r.status()===200,{timeout:90000});
  await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded',timeout:90000});
  const f=await (await forecastResponse).json();
  assert.equal(f.outdoorFeelsVersion,OUTDOOR_FEELS_VERSION);
  await page.waitForFunction(()=>document.querySelector('#hourly .hour-current .hour-feels b')&&document.querySelector('.sun-person figcaption strong'),null,{timeout:75000});
  const expected=degrees(f.comfort.outdoors);
  const rendered=await page.evaluate(()=>({
   hero:document.querySelector('#hero-feels strong').textContent.trim(),
   now:document.querySelector('#hourly .hour-current .hour-feels b').textContent.trim(),
   outdoors:document.querySelector('.sun-person figcaption strong').textContent.trim(),
   shade:document.querySelector('.shade-person figcaption strong').textContent.trim(),
   metric:document.querySelector('.metric-feels .metric-value').textContent.trim(),
   exposure:document.querySelector('#hourly .hour-current .hour-exposure').textContent.trim(),
   noOverflow:document.documentElement.scrollWidth<=innerWidth+1
  }));
  for(const key of ['hero','now','metric'])assert.equal(rendered[key],expected,name+' '+key+' matches outdoor API value');
  assert.equal(rendered.outdoors,expected==='—'?'Unavailable':expected,name+' outdoor figure equals Now');
  assert.equal(rendered.shade,Number.isFinite(f.comfort.shade)?degrees(f.comfort.shade):'Unavailable');
  assert.equal(f.current.feelsLike,f.comfort.outdoors);
  assert.ok(rendered.exposure);assert.ok(rendered.noOverflow);
  for(const h of f.hours){
   const p=f.metricForecasts.series.feels.find(p=>Date.parse(p.time)===Date.parse(h.time));
   assert.equal(h.feelsLike,p.value);assert.equal(p.exposure,'outdoors');
  }
  const next=page.locator('#hourly .forecast-hour').first();
  let future=null;
  if(await next.count()){
   const time=await next.getAttribute('data-time'),value=f.metricForecasts.series.feels.find(p=>Date.parse(p.time)===Date.parse(time)).value;
   await next.click();
   const shown=(await page.locator('.sun-person figcaption strong').innerText()).trim();
   assert.equal(shown,Number.isFinite(value)?degrees(value):'Unavailable');
   future={time,api:value,displayed:shown,matched:true};
   await page.locator('#hourly .hour-current').click();
   assert.equal((await page.locator('.sun-person figcaption strong').innerText()).trim(),expected==='—'?'Unavailable':expected);
  }
  assert.deepEqual(errors,[]);
  const evidence={name,width,observationTime:f.current.time,assembledAt:f.assembledAt,air:f.current.temperature,condition:f.current.condition,apiOutdoor:f.comfort.outdoors,apiShade:f.comfort.shade,rendered,future,matched:true};
  report.locations.push(evidence);console.log('LIVE_EXPOSURE_EQUALITY',JSON.stringify(evidence));
  await context.close();
 }
 report.success=true;
}finally{
 await browser.close();await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
}
console.log('LIVE_OUTDOOR_VERIFICATION_PASSED',JSON.stringify({commit:report.commit,locations:report.locations.length,success:report.success}));
