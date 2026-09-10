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
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:true}),page=await context.newPage(),errors=[];
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
   return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,highRight:high.left>low.right,uvRows:document.querySelectorAll('#daily .daily-uv').length,heroUv:text('#hero-uv'),todayUv:text('#today-forecast .daily-uv'),todayTake:text('#today-uncertainty-text'),takeVisible:!q('#today-uncertainty').hidden,sun:text('.sun-person figcaption strong'),now:text('#hourly .hour-current .hour-feels b'),hero:text('#hero-feels strong'),metric:text('.metric-feels .metric-value'),caption:text('#comfort-extra-science'),image:q('.poodle-walk').complete&&q('.poodle-walk').naturalWidth>0,hands:[...document.querySelectorAll('.friendly-wave')].every(el=>getComputedStyle(el).animationName==='none'),lowerHands:document.querySelectorAll('.person-resting-hand').length};
  });
  assert.equal(result.overflow,false);assert.equal(result.highRight,true);assert.equal(result.uvRows,7);
  assert.match(result.heroUv,/Peak UV today 7/);assert.match(result.todayUv,/Peak UV 7/);
  assert.equal(result.sun,result.now);assert.equal(result.sun,result.hero);assert.equal(result.sun,result.metric);
  assert.doesNotMatch(result.sun,/Unavailable|—/);assert.match(result.caption,/current forecast hour/);
  assert.doesNotMatch(result.todayTake,/Hot and humid|cooler, rainy|NWS discussion/);assert.match(result.todayTake,/Sunday rainfall amounts remain uncertain/);assert.ok(result.todayTake.split(/\s+/).length<=55);
  assert.equal(result.takeVisible,true);assert.equal(result.image,true);assert.equal(result.hands,true);assert.equal(result.lowerHands,2);
  const placement=await page.evaluate(()=>{const q=s=>document.querySelector(s),a=q('.sun-person').getBoundingClientRect(),b=q('#pavement-content').getBoundingClientRect(),c=q('#skin-exposure').getBoundingClientRect();return {sameRow:Math.abs(a.top-b.top)<2,pawsRight:b.left>=a.right,inside:b.left>=c.left&&b.right<=c.right&&q('#skin-exposure').contains(q('#pavement-content')),three:q('.sun-shade-comparison').children.length,meta:[...document.querySelectorAll('.day-meta')].every(el=>{const f=el.querySelector('.forecast-confidence').getBoundingClientRect(),u=el.querySelector('.daily-uv').getBoundingClientRect();return u.left>=f.right&&Math.abs((u.top+u.bottom)/2-(f.top+f.bottom)/2)<2;})};});
  assert.deepEqual(placement,{sameRow:true,pawsRight:true,inside:true,three:3,meta:true});
  assert.equal(await page.locator('#skin-kicker').innerText(),'How it actually feels right now');
  assert.deepEqual(await page.locator('#skin-values .exposure-label').allTextContents(),['Shade','Sun','For Pets']);
  assert.match(await page.locator('.comfort-later small').innerText(),/\d{1,2}:\d{2} [AP]M/);
  assert.ok(await page.locator('#map-panel').evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('#metrics').getBoundingClientRect().bottom));
  assert.ok(await page.locator('.pavement-warning').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('.poodle-walk').getBoundingClientRect().top));
  assert.equal(await page.locator('.pavement-warning').evaluate(el=>getComputedStyle(el).color),'rgb(67, 43, 6)');
  assert.equal(await page.locator('#today-take-source').count(),0);
  const uvHours=await page.evaluate(async()=>{const {hourlyUvValue,uvCategory}=await import('/weather-fusion/daily-uv.js?v=clear-weather-daygraph-v3');const f=await fetch('/api/weather-fusion/forecast?location=knightdale').then(r=>r.json());return [...document.querySelectorAll('#hourly .hour')].map(el=>{const t=el.classList.contains('hour-current')?Date.now():Date.parse(el.dataset.time);return {shown:el.querySelector('.hour-uv b')?.textContent,expected:String(uvCategory(hourlyUvValue(f,t)).index??'—')};});});
  assert.equal(uvHours.length,1+data().hours.filter(h=>Date.parse(h.time)>now).length);for(const hour of uvHours)assert.equal(hour.shown,hour.expected);
  assert.ok(new Set(uvHours.map(h=>h.shown)).size>3);assert.ok(uvHours.some(h=>h.shown==='0'));
  await page.locator('.exposure-cards').screenshot({path:`${output}/exposure-${width}.png`});
  await page.locator('.today-panel').screenshot({path:`${output}/today-${width}.png`});
  await page.locator('.daily-panel').screenshot({path:`${output}/daily-${width}.png`});
  await page.locator('#daily [data-day="1"]').click();await page.waitForSelector('#day-dialog[open]');
  assert.equal(await page.locator('.day-graph [data-series]').count(),4);
  assert.equal(await page.locator('.day-graph [data-readout]').count(),4);
  assert.equal(await page.locator('#day-content .day-feels,#day-content .day-gross').count(),0);
  const initialTime=await page.locator('.day-graph-time').innerText();
  await page.locator('#day-graph-hour').focus();await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.locator('.day-graph-time').innerText(),initialTime);
  const values=await page.evaluate(async()=>{const {dayGraphPoints}=await import('/weather-fusion/day-graph.js?v=clear-weather-daygraph-v3');const f=await fetch('/api/weather-fusion/forecast?location=knightdale').then(r=>r.json()),p=dayGraphPoints(f,1)[1];return Object.fromEntries(['temperature','feels','dewpoint','uv'].map(k=>[k,p[k]]));});
  for(const [key,value] of Object.entries(values))assert.equal(await page.locator('[data-readout="'+key+'"] strong').innerText(),Number.isFinite(value)?Math.round(value)+(key==='uv'?'':'°'):'—');
  const svg=page.locator('.day-graph svg'),box=await svg.boundingBox();await page.touchscreen.tap(box.x+box.width*.8,box.y+box.height*.5);
  assert.ok(Number(await page.locator('#day-graph-hour').inputValue())>1);
  assert.equal(await page.locator('#day-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await page.locator('#day-content').screenshot({path:output+'/combined-day-'+width+'.png'});
  await page.locator('#close-day').click();
  const riskChecks=await page.evaluate(async()=>{
   const {thermalRiskHTML}=await import('/weather-fusion/thermal-risk.js?v=comfort-only-banners-v8');
   const {dayGraphHTML,installDayGraph}=await import('/weather-fusion/day-graph.js?v=comfort-only-banners-v8');
   const f=await fetch('/api/weather-fusion/forecast?location=knightdale').then(r=>r.json());
   f.metricForecasts.series.feels.forEach((p,i)=>p.value=[105,70,0,null][i%4]);
   const root=document.createElement('div');root.style.width='280px';document.body.append(root);
   root.innerHTML=dayGraphHTML(f,1);installDayGraph(root,f,1);
   const slider=root.querySelector('input'),results=[];
   for(let i=0;i<4;i++){slider.value=i;slider.dispatchEvent(new Event('input'));const read=root.querySelector('[data-readout="feels"]'),banner=read.querySelector('.thermal-risk'),value=read.querySelector('strong');results.push({value:value.textContent,banner:banner?.textContent||'',above:!banner||banner.getBoundingClientRect().bottom<=value.getBoundingClientRect().top+1});}
   root.remove();
   const sun=document.querySelector('.sun-person .exposure-alert-slot'),saved=sun.innerHTML;sun.innerHTML=thermalRiskHTML(105,true);
   const b=sun.firstElementChild,p=document.querySelector('.pavement-warning'),br=b.getBoundingClientRect(),pr=p.getBoundingClientRect();
   if(Math.abs(br.width-pr.width)>1||Math.abs(br.height-pr.height)>1)throw Error('Human/pet banner dimensions differ');
   sun.innerHTML=saved;
   if([...document.querySelectorAll('.thermal-risk')].some(el=>!el.closest('.sun-shade-comparison')))throw Error('Risk banner outside people graphics');
   return {results,missing:thermalRiskHTML(null),normal:thermalRiskHTML(70),scale:[...document.querySelectorAll('.exposure-person-art')].map(el=>el.getAttribute('transform'))};
  });
  assert.equal(riskChecks.missing,'');assert.equal(riskChecks.normal,'');
  for(const r of riskChecks.results){assert.ok(r.above);assert.equal(r.banner,'');}
  assert.equal(new Set(riskChecks.results.map(r=>r.value)).size,4);
  assert.ok(riskChecks.scale.every(t=>t.includes('scale(1.85)')));
  const treeSize=await page.evaluate(()=>{const q=s=>document.querySelector(s).getBoundingClientRect(),t=q('.exposure-tree'),p=q('.shade-person .exposure-person-art'),b=q('.shade-person .exposure-alert-slot');return {ratio:t.height/p.height,top:t.top,personTop:p.top,bannerBottom:b.bottom};});
  assert.ok(treeSize.ratio>1.4,'Tree is visibly taller than the person');
  assert.ok(treeSize.top<treeSize.personTop-10,'Tree crown clears the person');
  assert.ok(treeSize.top>=treeSize.bannerBottom,'Tree does not overlap the banner');
  const concise=await page.locator('#skin-exposure').innerText();assert.doesNotMatch(concise,/station|paw care|source air temperature|Sidewalk ranges/i);
  assert.equal(await page.locator('#scientific-stuff #skin-explanation').count(),1);
  assert.equal(await page.locator('#scientific-stuff .pavement-details').count(),1);
  const walker=await page.locator('.poodle-walk').getAttribute('data-outfit');assert.ok(['hot','warm'].includes(walker));
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
 await page.evaluate(async()=>{const {exposureScene}=await import('/weather-fusion/exposure-scene.js?v=clear-weather-daygraph-v3');document.body.innerHTML='<div id="outfits" style="display:flex;background:#304763;padding:20px">'+[25,48,65,80,96].map(t=>'<div style="width:200px">'+exposureScene(true,true,'Clear',t)+'</div>').join('')+'</div>';});
 await page.locator('#outfits').screenshot({path:`${output}/all-outfits.png`});
 assert.equal(await page.locator('.person-resting-hand').count(),5);assert.equal(await page.locator('.friendly-wave').count(),5);
 report.scenarios.push('All five clothing states have two hands');
 await page.evaluate(async()=>{const {pavementHTML}=await import('/weather-fusion/pavement.js?v=clear-weather-daygraph-v3');document.body.innerHTML='<div id="walker-outfits" style="display:flex;background:#344f70;padding:20px">'+[30,48,65,80,104].map(t=>'<div style="width:220px"><h2>'+t+'° feels like</h2>'+pavementHTML({status:'estimated',concrete:{value:104},asphalt:{value:114}},t)+'</div>').join('')+'</div>';});
 await page.waitForFunction(()=>[...document.querySelectorAll('.poodle-walk')].every(i=>i.complete&&i.naturalWidth>0));
 assert.deepEqual(await page.locator('.poodle-walk').evaluateAll(els=>els.map(e=>e.dataset.outfit)),['cold','cool','mild','warm','hot']);
 await page.locator('#walker-outfits').screenshot({path:output+'/walker-outfits.png'});
 report.scenarios.push('All walker outfits load and match human feels-like, independent of 104-degree pavement');report.success=true;
}finally{await fs.writeFile(`${output}/browser-report.json`,JSON.stringify(report,null,2));await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify(report,null,2));
