import {chromium} from 'playwright';
import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {registerWeatherFusionRoutes} from '../src/weatherFusion.js';
import {fixture as fusionFixture} from './weatherNourieFixture.js';
import {weatherNextFixture} from './weatherNextFixture.js';
const catalog=JSON.parse(await fs.readFile('public/weather-fusion/weathernext-catalog.json','utf8'));
const output=process.env.WEATHER_QA_DIR||'/tmp/weathernext-site-qa';await fs.mkdir(output,{recursive:true});
const app=express();
app.get('/api/weather-fusion/forecast',(req,res)=>res.json(fusionFixture(req.query.location)));
app.get('/api/weather-fusion/*',(_req,res)=>res.status(503).json({error:'Optional source disabled in deterministic test'}));
registerWeatherFusionRoutes(app,{fetchImpl:async()=>{throw Error('No external provider queries during fixture test');}});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.WEATHER_BROWSER_PATH||undefined});
const report={success:false,viewports:[],checks:[]};
try{
 for(const width of [320,360,390,430,768,1440]){
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let offline=false;
  await page.route('**/models/weathernext-full.json',route=>route.fulfill({status:offline?503:200,contentType:'application/json',body:offline?'{}':JSON.stringify(weatherNextFixture(catalog))}));
  await page.addInitScript(()=>{Date.now=()=>Date.parse('2026-09-24T13:00:00Z');});
  await page.goto(base+'/weather-fusion/weathernext-site.html',{waitUntil:'networkidle'});
  await page.waitForSelector('#forecast:not([hidden])');
  assert.equal(await page.locator('#variable option').count(),21);
  assert.equal(await page.locator('#hour').getAttribute('max'),'347','Visible model hours start at the current 13:00Z hour; original run hours remain in downloads.');
  assert.match(await page.locator('#valid-time').innerText(),/9:00 AM/);
  assert.equal(await page.locator('#source-cards article').count(),4);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`site overflow ${width}`);
  await page.screenshot({path:`${output}/weathernext-${width}.png`,fullPage:true});
  for(const f of catalog.fields){
   await page.selectOption('#variable',f.id);
   assert.equal(await page.locator('#percentiles .stat').count(),6);
   assert.ok(!(await page.locator('#conditions').innerText()).match(/undefined|NaN/));
   if(f.id==='sea_surface_temperature')assert.match(await page.locator('#chart').innerText(),/No published values/);
   else assert.equal(await page.locator('#chart svg').count(),1,f.id);
  }
  await page.selectOption('#variable','temperature_2m');await page.selectOption('#statistic','p50');
  assert.equal(await page.locator('.stat.active span').innerText(),'P50 · median');
  const initial=await page.locator('#hour-label').innerText();
  await page.locator('#hour').evaluate(el=>{el.value='100';});await page.locator('#hour').dispatchEvent('input');
  assert.notEqual(await page.locator('#hour-label').innerText(),initial);
  await page.locator('#days button').nth(2).click();
  assert.ok(Number(await page.locator('#hour').getAttribute('max'))<=24);
  await page.locator('#all-hours').click();assert.equal(await page.locator('#hour').getAttribute('max'),'347');
  await page.selectOption('#run','interimSurface');assert.equal(await page.locator('#hour').getAttribute('max'),'46');
  await page.selectOption('#location','greenville');assert.match(await page.locator('#location-title').innerText(),/Greenville/);
  await page.selectOption('#run','surface');
  const dl=page.waitForEvent('download');await page.locator('#download-csv').click();const downloaded=await dl;
  await downloaded.saveAs(`${output}/export-${width}.csv`);assert.equal((await fs.readFile(`${output}/export-${width}.csv`,'utf8')).split('\r\n').length,361);
  offline=true;const old=await page.locator('#temperature').innerText();await page.locator('#refresh').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Refresh failed'));
  assert.equal(await page.locator('#temperature').innerText(),old);
  assert.equal(await page.locator('#forecast').isVisible(),true);
  assert.deepEqual(errors,[]);
  await context.close();
  const shellContext=await browser.newContext({viewport:{width,height:900},geolocation:{latitude:35.787,longitude:-78.4806},permissions:['geolocation']});
  const shell=await shellContext.newPage();
  await shell.addInitScript(()=>{Date.now=()=>Date.parse('2026-09-05T22:00:00Z');});
  await shell.route('https://unpkg.com/**',r=>r.abort());
  for(const path of ['/weather-fusion/','/weather-fusion/experimental-weather.html']){
   await shell.goto(base+path,{waitUntil:'domcontentloaded'});
   await shell.waitForSelector('.weather-jump-card');
   await shell.waitForFunction(()=>{const n=document.querySelector('.weather-jump-nav');return n&&getComputedStyle(n).display==='grid';},null,{timeout:10000});
   await shell.waitForFunction(()=>document.documentElement.dataset.weatherPage);
   const nav=await shell.locator('.weather-jump-nav').evaluate(el=>{const cards=[...el.children],rects=cards.map(e=>e.getBoundingClientRect()),labels=[...el.querySelectorAll('.jump-label')],styles=cards.map(e=>getComputedStyle(e)),labelStyles=labels.map(e=>getComputedStyle(e));return {count:cards.length,art:el.querySelectorAll('svg,img,picture,.jump-visual,.jump-arrow').length,overflow:el.scrollWidth>el.clientWidth+1,labels:labels.map(e=>e.textContent),heights:rects.map(r=>r.height),fonts:[...styles,...labelStyles].map(s=>parseFloat(s.fontSize)),weights:[...styles,...labelStyles].map(s=>s.fontWeight),families:[...styles,...labelStyles].map(s=>s.fontFamily),columns:getComputedStyle(el).gridTemplateColumns.split(/\s+/).length,rows:new Set(rects.map(r=>Math.round(r.top))).size,borders:styles.map(s=>parseFloat(s.borderTopWidth))}});
   assert.equal(nav.count,8);assert.equal(nav.art,0);assert.equal(nav.overflow,false);assert.equal(nav.columns,width<=800?4:8);assert.equal(nav.rows,width<=800?2:1);assert.ok(nav.heights.every(v=>Math.abs(v-46)<.1));assert.ok(nav.fonts.every(v=>v===13));assert.ok(nav.weights.every(v=>v==='700'));assert.equal(new Set(nav.families).size,1);assert.ok(nav.borders.every(v=>v===1));
   assert.deepEqual(nav.labels,['Map','Your Day','7-Day','AQI','Car Wash','Feel Meter','Snow','Compare']);
   assert.equal(await shell.locator('#weathernext-site-link').isVisible(),path.includes('experimental'));
   assert.equal(await shell.locator('.weathernext-card,[data-model="weathernext3"],#google-status').count(),0);
  }
  await shell.locator('.weather-jump-nav').screenshot({path:`${output}/plain-buttons-${width}.png`});
  assert.equal(await shell.locator('#weathernext-site-link').getAttribute('href'),'/weathernext/');
  await shellContext.close();report.viewports.push(width);
 }
 // A first-load failure must not display fabricated or placeholder forecast values.
 const context=await browser.newContext();const p=await context.newPage();
 await p.route('**/models/weathernext-full.json',r=>r.fulfill({status:503,body:'{}'}));
 await p.goto(base+'/weather-fusion/weathernext-site.html',{waitUntil:'networkidle'});
 assert.equal(await p.locator('#forecast').isVisible(),false);assert.match(await p.locator('#status').innerText(),/No forecast loaded/);await context.close();
 report.success=true;report.checks=['All 21 field selectors and six ensemble statistics','360-hour main and separate 48-hour interim runs','Hour slider and daily/full-horizon navigation','Location selection','CSV actual download and 360 records','Refresh failure retains original values and timestamps','First-load failure displays no invented forecast','Eight equal weather actions with four mobile columns, eight desktop columns and matching typography','Experimental-only link and no embedded WeatherNext card','Production static route allowlist','No horizontal overflow or JavaScript errors'];
}finally{await fs.writeFile(output+'/report.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify(report,null,2));
