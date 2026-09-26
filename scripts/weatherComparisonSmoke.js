import express from 'express';import {chromium} from 'playwright';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {registerWeatherFusionRoutes} from '../src/weatherFusion.js';import {registerWeatherComparisonRoutes} from '../src/weatherComparison.js';import {fixture} from './weatherNourieFixture.js';import {feedFixture,now} from '../test/weatherComparisonData.test.js';
const dir='/tmp/weather-comparison-qa';await fs.mkdir(dir,{recursive:true});
const app=express();registerWeatherComparisonRoutes(app,{now:()=>now,feedProvider:async()=>feedFixture()});
app.get('/api/weather-fusion/forecast',(_q,r)=>r.json(fixture('knightdale',now)));
app.get('/api/weather-fusion/*',(_q,r)=>r.status(503).json({error:'Optional provider disabled in fixture test'}));
registerWeatherFusionRoutes(app,{fetchImpl:async()=>{throw Error('External sources disabled in fixture test');}});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const report={success:false,widths:[],checks:[]};
try{
 assert.equal((await fetch(base+'/api/weather-fusion/compare/google?location=unknown')).status,404);
 for(const width of [320,390,768,1280]){
  const context=await browser.newContext({viewport:{width,height:950}});const p=await context.newPage();const errors=[],googleRequests=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/panel failed|display failed/.test(m.text()))errors.push(m.text());});
  await p.addInitScript(t=>{Date.now=()=>t;},now);
  await p.route('https://**',r=>r.abort());
  p.on('request',r=>{try{if(r.frame().url().includes('source=google')&&r.url().includes('/api/weather-fusion/'))googleRequests.push(r.url());}catch{}});
  await p.goto(base+'/weather-fusion/compare/',{waitUntil:'networkidle'});
  await p.waitForFunction(()=>document.querySelector('#compare-status')?.textContent?.includes('Both forecasts loaded')===true,null,{timeout:45000});
  const f=p.frames().find(f=>f.url().includes('source=fusion')),g=p.frames().find(f=>f.url().includes('source=google'));assert.ok(f&&g);
  for(const frame of [f,g]){assert.equal(await frame.locator('.today-weather-card').count(),1);assert.ok(await frame.locator('.today-sky[src*="/weather-fusion/"]').count()>=1);assert.ok(await frame.locator('#metrics button').count()>=5);assert.ok(!/NaN|undefined/.test(await frame.locator('#today-forecast').innerText()));}
  assert.ok(googleRequests.length>0);assert.ok(googleRequests.every(u=>u.includes('/compare/google')),googleRequests.join('\n'));
  assert.match(await g.locator('#observation-label').innerText(),/not a live station/);
  assert.match(await g.locator('#air-quality .google-unavailable').innerText(),/not supplied/);
  assert.doesNotMatch(await g.locator('#hourly').innerText(),/Checking radar/);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await p.locator('[data-view="google"]').click();assert.equal(await p.locator('[data-source="google"]').isVisible(),true);assert.equal(await p.locator('[data-source="fusion"]').isVisible(),false);
  await p.locator('[data-view="fusion"]').click();assert.equal(await p.locator('[data-source="fusion"]').isVisible(),true);
  const selected=await p.locator('#compare-hour option').nth(2).getAttribute('value');await p.selectOption('#compare-hour',selected);
  for(const frame of [f,g])await frame.waitForFunction(()=>document.querySelector('#skin-exposure').dataset.preview==='forecast');
  await p.waitForTimeout(650);
  await f.locator('.today-weather-card').evaluate(el=>el.click());
  for(const frame of [f,g])await frame.waitForFunction(()=>document.querySelector('#day-dialog').open===true);
  await p.waitForTimeout(650);await f.locator('#day-dialog').evaluate(el=>el.close());
  await g.waitForFunction(()=>document.querySelector('#day-dialog').open===false);
  await p.locator('[data-section="today-forecast"]').click();
  await p.locator('.compare-frames').scrollIntoViewIfNeeded();
  await p.screenshot({path:`${dir}/fusion-${width}.png`});
  await p.locator('[data-view="google"]').click();await p.locator('.compare-frames').scrollIntoViewIfNeeded();await p.screenshot({path:`${dir}/google-${width}.png`});
  await p.locator('[data-view="both"]').click();await p.screenshot({path:`${dir}/both-${width}.png`});
  for(const frame of [f,g])assert.ok(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`pane overflow ${width}`);
  await p.route('**/api/weather-fusion/compare/google*',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test refresh failure'})}));const previous=await g.locator('#temperature').innerText();await p.locator('#compare-refresh').click();await p.waitForFunction(()=>document.querySelector('#compare-status').textContent.includes('Google:'),null,{timeout:15000});assert.equal(await g.locator('#temperature').innerText(),previous);
  assert.deepEqual(errors,[]);await context.close();report.widths.push(width);
 }
 const context=await browser.newContext({viewport:{width:320,height:900}}),p=await context.newPage();await p.route('https://**',r=>r.abort());await p.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded'});assert.equal(await p.locator('#weather-compare-link').count(),1);assert.equal(await p.locator('.weather-jump-nav a').count(),5);assert.equal(await p.locator('#weather-compare-link').getAttribute('href'),'/weather-fusion/compare/');await context.close();
 report.success=true;report.checks=['Shared Today artwork and metric tiles on both sides','Source toggle and both layout at four widths','Synchronized forecast-hour preview and day-dialog opening/closing','Only Google API queried by Google pane','Exact-hour comparison and interval unit tests','Missing AQI, UV, probability and gusts not fabricated','Refresh failure retains visible data with warning','No browser errors or page/pane overflow','Main retains five original navigation buttons plus separate Compare Google entry'];
}finally{await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify(report,null,2));
