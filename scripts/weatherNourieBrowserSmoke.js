/** Repeatable UX tests with explicit fixture weather; no production AI charges. */
import {chromium} from 'playwright';
import express from 'express';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fixture} from './weatherNourieFixture.js';
const dir='/tmp/weather-review';await fs.mkdir(dir,{recursive:true});
let missing=false;
const app=express();app.get('/api/weather-fusion/forecast',(req,res)=>{const data=fixture(req.query.location);if(missing)for(const row of data.metricForecasts.series.pressure)row.value=null;res.json(data);});
app.get('/api/weather-fusion/radar',(_req,res)=>res.json({frames:[],status:'unavailable'}));app.get('/api/weather-fusion/models',(_req,res)=>res.json({layers:{}}));
app.use('/weather-fusion',express.static('public/weather-fusion'));const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const report={data:'Fixture weather, not a live forecast',checks:[],browserErrors:[]};
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>report.browserErrors.push(e.message));
 await page.addInitScript(()=>{window.testNow=Date.parse('2026-09-05T18:59:59Z');Date.now=()=>window.testNow;});
 await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-metric="feels"]');assert.equal(await page.locator('[data-day="0"] .day-name').innerText(),'Today');
 await page.evaluate(()=>window.testNow=Date.parse('2026-09-05T19:00:00Z'));await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('[data-day="0"] .day-name').textContent==='Tonight');
 assert.ok(!(await page.locator('[data-day="0"]').innerText()).includes('—'));
 const left=await page.locator('[data-day="1"] .day-high').boundingBox(),right=await page.locator('[data-day="1"] .day-low').boundingBox();assert.ok(left.x<right.x);
 assert.ok((await page.locator('[data-day="1"] .temp-fill').getAttribute('style')).includes('left:0;'));
 assert.equal(await page.locator('.back-link').count(),0);assert.ok(!(await page.locator('body').innerText()).includes('Weather Fusion'));
 assert.match(await page.locator('#skin-exposure').innerText(),/How’s it really gonna feel/);
 assert.ok(!(await page.locator('#skin-exposure').innerText()).includes('wet bulb'));
 report.checks.push('3 PM boundary','high-first days','Tonight low','Weather Nourie branding','plain top section');
 for(const key of ['feels','precipitation','wind','humidity','pop','visibility','pressure','solar']) {
  await page.locator(`[data-metric="${key}"]`).click();assert.ok(await page.locator('#metric-dialog').isVisible());
  assert.ok(!(await page.locator('#chart-value').innerText()).includes('Not available'));
  await page.locator('#chart-scrubber').fill('4');await page.locator('#chart-scrubber').press('ArrowRight');assert.equal(await page.locator('#chart-scrubber').inputValue(),'5');
  if(key==='humidity'){await page.screenshot({path:dir+'/humidity.png'});await page.locator('[data-hours="48"]').click();assert.ok(Number(await page.locator('#chart-scrubber').getAttribute('max'))>30);}
  if(key==='solar')await page.screenshot({path:dir+'/sunset.png'});
  await page.keyboard.press('Escape');assert.ok(!(await page.locator('#metric-dialog').isVisible()));
  report.checks.push(key+' interactive chart + keyboard + Escape');
 }
 missing=true;await page.locator('#refresh').click();await page.waitForTimeout(250);await page.locator('[data-metric="pressure"]').click();
 assert.ok(await page.locator('#chart-empty').isVisible());assert.equal(await page.locator('.graph-line').count(),0);await page.keyboard.press('Escape');missing=false;
 report.checks.push('missing pressure has no fabricated forecast line');
 await page.locator('[data-place="greenville"]').click();await page.waitForFunction(()=>document.querySelector('#city-name').textContent.includes('Greenville')&&document.querySelector('#skin-values').textContent.includes('shade'));
 for(const width of [320,390,430,1365]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow at ${width}`);report.checks.push(`width ${width}`);if(width===390||width===1365){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:dir+`/page-${width}.png`,fullPage:true});}}
 await page.locator('[data-day="1"]').click();assert.match(await page.locator('#day-content').innerText(),/WEATHER NOURIE/);await page.locator('#close-day').click();
 assert.deepEqual(report.browserErrors,[]);report.success=true;
} finally {await browser.close();await new Promise(r=>server.close(r));await fs.writeFile(dir+'/ux-report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
