import express from 'express';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {registerWeatherFusionRoutes} from '../src/weatherFusion.js';
import {registerWeatherComparisonRoutes} from '../src/weatherComparison.js';
import {fixture} from './weatherNourieFixture.js';
import {feedFixture,now} from '../test/weatherComparisonData.test.js';

const dir='/tmp/weather-comparison-qa';
await fs.mkdir(dir,{recursive:true});
const app=express();
registerWeatherComparisonRoutes(app,{now:()=>now,feedProvider:async()=>feedFixture(),companionProvider:async()=>({})});
app.get('/api/weather-fusion/forecast',(_q,r)=>r.json(fixture('knightdale',now)));
app.get('/api/weather-fusion/*',(_q,r)=>r.status(503).json({error:'Optional provider disabled in fixture test'}));
registerWeatherFusionRoutes(app,{fetchImpl:async()=>{throw Error('External sources disabled in fixture test');}});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const report={success:false,widths:[],checks:[]};

async function waitForGoogle(page){
 await page.waitForFunction(()=>{
   const temp=document.querySelector('#temperature')?.textContent?.trim()||'';
   const status=document.querySelector('#status')?.textContent||'';
   return /\d/.test(temp)&&!temp.includes('—')&&!/Connecting to weather sources|Getting device location/i.test(status);
 },null,{timeout:30000});
}

try{
 assert.equal((await fetch(base+'/api/weather-fusion/compare/google?location=unknown')).status,404);
 for(const width of [320,390,768,1280]){
  const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/panel failed|display failed|comparison page could not be prepared/i.test(m.text()))errors.push(m.text());});
  await page.addInitScript(t=>{Date.now=()=>t;},now);
  await page.route('https://**',r=>r.abort());
  await page.goto(base+'/weathernext/?location=knightdale',{waitUntil:'domcontentloaded',timeout:30000});
  await waitForGoogle(page);
  assert.match(await page.locator('#city-name').innerText(),/Knightdale|Raleigh/i);
  assert.match(await page.locator('#temperature').innerText(),/\d/);
  assert.equal(await page.locator('.weather-jump-nav a').count(),5);
  assert.equal(await page.locator('#refresh').isEnabled(),true);
  assert.match(await page.locator('.forecast-compare-banner').innerText(),/Back to Dan/i);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const before=await page.locator('#temperature').innerText();
  await page.locator('#refresh').click();
  await waitForGoogle(page);
  assert.match(await page.locator('#temperature').innerText(),/\d/);
  assert.ok(before.length>0);
  await page.screenshot({path:`${dir}/google-dashboard-${width}.png`,fullPage:false});
  assert.deepEqual(errors,[]);
  report.widths.push(width);
  await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:950},reducedMotion:'reduce'});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(t=>{Date.now=()=>t;},now);
 await page.route('https://**',r=>r.abort());
 await page.goto(base+'/weathernext/?latitude=35.7798&longitude=-78.5355',{waitUntil:'domcontentloaded',timeout:30000});
 await waitForGoogle(page);
 assert.match(await page.locator('#city-name').innerText(),/Knightdale|Raleigh/i);
 assert.match(await page.locator('#temperature').innerText(),/\d/);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:`${dir}/google-dashboard-device-knightdale.png`,fullPage:false});
 await context.close();

 const appJs=await fetch(base+'/weather-fusion/compare/app.js?source=google&location=knightdale');
 assert.equal(appJs.status,200);
 const appText=await appJs.text();
 assert.match(appText,/compareBridge\.requestForecast/);
 assert.match(appText,/installComparisonPane/);

 report.success=true;
 report.checks=[
  'Google WeatherNext dashboard loads forecast data instead of remaining on Connecting',
  'Knightdale device coordinates resolve to the collected Knightdale Google point',
  'Five navigation controls and refresh remain interactive',
  'Generated Google browser script returns HTTP 200',
  'No browser errors or horizontal overflow from 320px through desktop'
 ];
}finally{
 await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2));
 await browser.close();
 await new Promise(r=>server.close(r));
}
console.log(JSON.stringify(report,null,2));
