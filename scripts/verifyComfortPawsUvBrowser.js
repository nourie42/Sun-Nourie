import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import {fixture} from './weatherNourieFixture.js';
import {addExposureWeather} from '../src/weatherFusionExposure.js';
const app=express();app.use('/weather-fusion',express.static('public/weather-fusion'));
const server=process.env.WEATHER_BASE_URL?null:await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=process.env.WEATHER_BASE_URL||`http://127.0.0.1:${server.address().port}`;
const output=process.env.WEATHER_QA_DIR||'../qa';
const H=3600000,now=Date.parse('2026-09-05T17:00:00Z');
await fs.mkdir(output,{recursive:true});
function data(location='knightdale'){
 const f=fixture(location,now),start=now-48*H;
 const rows=Array.from({length:240},(_,i)=>{const epoch=start+i*H,hour=new Date(epoch).getUTCHours()-4,sun=Math.max(0,Math.sin((hour-6)/12*Math.PI));return {time:new Date(epoch).toISOString(),temperature:73+17*sun,dewpoint:65,humidity:55,wind:5,skyCover:10,solar:800*sun,rain:0,uvIndex:7.2*sun};});
 addExposureWeather(f,{source:'Open-Meteo',rows,uv:f.days.map((d,i)=>({date:d.date,value:7.2-i*.3}))});
 f.current.wind=null;f.current.dewpoint=null;f.current.humidity=null;
 f.aiConfigured=true;f.discussion={id:'test-afd-'+location,office:f.location.office,issuanceTime:new Date(now-H).toISOString(),text:'.SYNOPSIS...\nHot and humid weather continues today. A cooler, rainy Sunday is coming.\n&&\n.WHAT HAS CHANGED...\nSunday rainfall amounts remain uncertain.\n&&'};
 f.feeds=f.feeds.filter(x=>x.id!=='afd');f.feeds.push({id:'afd',status:'ready'});
 return f;
}
const launch={headless:true};if(process.env.WEATHER_BROWSER_PATH)launch.executablePath=process.env.WEATHER_BROWSER_PATH;
const browser=await chromium.launch(launch),report={success:false,viewports:[],scenarios:[]};
try{
 for(const width of [320,390,1440]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(time=>{const NativeDate=Date;window.__weatherTestNow=time;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[window.__weatherTestNow]));}static now(){return window.__weatherTestNow;}};},now);
  let delayLocation=false,failLocation=false;
  await page.route('**/api/weather-fusion/**',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname.endsWith('/forecast')){
    if(delayLocation)await new Promise(r=>setTimeout(r,500));
    if(failLocation)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture provider outage'})});
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data(u.searchParams.get('location')||'knightdale'))});
   }
   return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture optional feed outage'})});
  });
  await page.goto(base+'/weather-fusion/',{waitUntil:'networkidle'});
  await page.waitForSelector('#pavement-content[data-status="estimated"]');
  const result=await page.evaluate(()=>{
   const q=s=>document.querySelector(s),text=s=>q(s)?.textContent.trim();
   const row=q('#daily .day-row'),low=row.querySelector('.day-low').getBoundingClientRect(),high=row.querySelector('.day-high').getBoundingClientRect();
   return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,highRight:high.left>low.right,uvRows:document.querySelectorAll('#daily .daily-uv').length,heroUv:text('#hero-uv'),todayUv:text('#today-forecast .daily-uv'),todayTake:text('#today-uncertainty-text'),takeVisible:!q('#today-uncertainty').hidden,sun:text('.sun-person figcaption strong'),now:text('#hourly .hour-current .hour-feels b'),hero:text('#hero-feels strong'),metric:text('.metric-feels .metric-value'),caption:text('.comfort-preview-heading'),image:q('.poodle-walk').complete&&q('.poodle-walk').naturalWidth>0,hands:[...document.querySelectorAll('.friendly-wave')].every(el=>getComputedStyle(el).animationName==='none'),lowerHands:document.querySelectorAll('.person-resting-hand').length};
  });
  assert.equal(result.overflow,false);assert.equal(result.highRight,true);assert.equal(result.uvRows,7);
  assert.match(result.heroUv,/Peak UV today 7/);assert.match(result.todayUv,/Peak UV 7/);
  assert.equal(result.sun,result.now);assert.equal(result.sun,result.hero);assert.equal(result.sun,result.metric);
  assert.doesNotMatch(result.sun,/Unavailable|—/);assert.match(result.caption,/current forecast hour/);
  assert.doesNotMatch(result.todayTake,/Hot and humid|cooler, rainy|NWS discussion/);assert.match(result.todayTake,/Sunday rainfall amounts remain uncertain/);assert.ok(result.todayTake.split(/\s+/).length<=55);
  assert.equal(result.takeVisible,true);assert.equal(result.image,true);assert.equal(result.hands,true);assert.equal(result.lowerHands,2);
  const placement=await page.evaluate(()=>{const q=s=>document.querySelector(s),a=q('.sun-person').getBoundingClientRect(),b=q('#pavement-content').getBoundingClientRect(),c=q('#skin-exposure').getBoundingClientRect();return {sameRow:Math.abs(a.top-b.top)<2,pawsRight:b.left>=a.right,inside:b.left>=c.left&&b.right<=c.right&&q('#skin-exposure').contains(q('#pavement-content')),three:q('.sun-shade-comparison').children.length,meta:[...document.querySelectorAll('.day-meta')].every(el=>{const f=el.querySelector('.forecast-confidence').getBoundingClientRect(),u=el.querySelector('.daily-uv').getBoundingClientRect();return u.left>=f.right&&Math.abs((u.top+u.bottom)/2-(f.top+f.bottom)/2)<2;})};});
  assert.deepEqual(placement,{sameRow:true,pawsRight:true,inside:true,three:3,meta:true});
  assert.equal(await page.locator('#skin-kicker').innerText(),'How does it feel outside right now?');
  assert.equal(await page.locator('#today-take-source').count(),0);
  const uvHours=await page.evaluate(async()=>{const {hourlyUvValue,uvCategory}=await import('/weather-fusion/daily-uv.js?v=compact-comfort-hourly-uv-v2');const f=await fetch('/api/weather-fusion/forecast?location=knightdale').then(r=>r.json());return [...document.querySelectorAll('#hourly .hour')].map(el=>{const t=el.classList.contains('hour-current')?Date.now():Date.parse(el.dataset.time);return {shown:el.querySelector('.hour-uv b')?.textContent,expected:String(uvCategory(hourlyUvValue(f,t)).index??'—')};});});
  assert.equal(uvHours.length,1+data().hours.filter(h=>Date.parse(h.time)>now).length);for(const hour of uvHours)assert.equal(hour.shown,hour.expected);
  assert.ok(new Set(uvHours.map(h=>h.shown)).size>3);assert.ok(uvHours.some(h=>h.shown==='0'));
  await page.locator('.exposure-cards').screenshot({path:`${output}/exposure-${width}.png`});
  await page.locator('.today-panel').screenshot({path:`${output}/today-${width}.png`});
  await page.locator('.daily-panel').screenshot({path:`${output}/daily-${width}.png`});
  await page.locator('#daily [data-day="1"]').click();await page.waitForSelector('#day-dialog[open]');await page.locator('#close-day').click();
  await page.locator('#hourly .forecast-hour').first().click();await page.waitForSelector('[data-comfort-reset]');
  assert.match(await page.locator('#skin-kicker').innerText(),/How will it feel/);
  await page.locator('[data-comfort-reset]').click();
  // Repeated renders must keep hands and use the same current estimate.
  for(let i=0;i<3;i++){await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').classList.contains('loading'));}
  assert.equal(await page.locator('.sun-person figcaption strong').innerText(),result.sun);
  await page.evaluate(time=>window.__weatherTestNow=time,now+3*H);
  await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#today-forecast .tonight-row'));
  assert.match(await page.locator('#today-forecast .daily-uv').innerText(),/Peak UV today 7/);
  // Location clearing is checked while delayed and then failed.
  delayLocation=true;failLocation=true;
  await page.locator('[data-place="greenville"]').click();
  assert.equal(await page.locator('#hero-uv').innerText(),'Peak UV today —');
  assert.equal(await page.locator('#pavement-content').count(),0);
  assert.doesNotMatch(await page.locator('#today-uncertainty-text').innerText(),/Hot and humid/);
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('failed'));
  assert.equal(await page.locator('#pavement-content').count(),0);assert.equal(await page.locator('#today-uncertainty').isVisible(),false);
  assert.deepEqual(errors,[]);report.viewports.push(result);
  report.scenarios.push('Repeated refresh, future preview/reset, daily dialog, Tonight daily UV, missing wind/moisture, AI outage, location outage at '+width+'px');
  await context.close();
 }
 // Verify all clothing states, including small mobile hands.
 const page=await browser.newPage({viewport:{width:1100,height:600}});
 await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded'});
 await page.evaluate(async()=>{const {exposureScene}=await import('/weather-fusion/exposure-scene.js?v=compact-comfort-hourly-uv-v2');document.body.innerHTML='<div id="outfits" style="display:flex;background:#304763;padding:20px">'+[25,48,65,80,96].map(t=>'<div style="width:200px">'+exposureScene(true,true,'Clear',t)+'</div>').join('')+'</div>';});
 await page.locator('#outfits').screenshot({path:`${output}/all-outfits.png`});
 assert.equal(await page.locator('.person-resting-hand').count(),5);assert.equal(await page.locator('.friendly-wave').count(),5);
 report.scenarios.push('All five clothing states have two hands');report.success=true;
}finally{await fs.writeFile(`${output}/browser-report.json`,JSON.stringify(report,null,2));await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify(report,null,2));
