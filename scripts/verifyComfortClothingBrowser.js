import {chromium} from 'playwright';
import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {registerWeatherFusionRoutes} from '../src/weatherFusion.js';
const output=process.env.WEATHER_QA_DIR||'/tmp/clothing-qa';await fs.mkdir(output,{recursive:true});
const app=express();
app.get('/clothing-qa',(_req,res)=>res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/weather-fusion/comfort-cinematic.css"><style>*{box-sizing:border-box}body{margin:0;background:#294462;font-family:Arial,sans-serif;color:white;padding:12px}#skin-exposure{max-width:1080px;margin:auto}#cases{display:grid;gap:12px} .art-row{display:flex;max-width:900px}.art-row>svg{width:33.333%;height:auto}</style></head><body><section id="skin-exposure"><h2 class="skin-kicker">How it actually feels right now</h2><div id="skin-values"></div></section><div id="cases"></div></body></html>'));
registerWeatherFusionRoutes(app,{fetchImpl:async()=>{throw Error('External forecast requests are disabled in clothing-only test');}});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.WEATHER_BROWSER_PATH||undefined});
const report={success:false,widths:[],scenarios:[]};
try{
 for(const width of [320,390,768,1100]){
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/clothing-qa',{waitUntil:'networkidle'});
  await page.evaluate(async()=>{
   const {sunShadeHTML}=await import('/weather-fusion/personal-details.js');
   const {pavementHTML}=await import('/weather-fusion/pavement.js');
   const comfort={shade:50,outdoors:60,sun:null,daylight:false,weatherKind:'cloudy'};
   const context={condition:'Mostly Cloudy',pop:6};
   document.querySelector('#skin-values').innerHTML=sunShadeHTML(comfort,{latitude:35.787,longitude:-78.4806},Date.parse('2026-09-24T23:00Z'),context);
   document.querySelector('.sun-shade-comparison').insertAdjacentHTML('beforeend',pavementHTML({status:'estimated',daylight:false,concrete:{value:63,low:61,high:65},asphalt:{value:64,low:62,high:66}},60,context));
  });
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.comfort-clothing').count(),3);
  assert.equal(await page.locator('.wardrobe-trousers').count(),3);
  assert.equal(await page.locator('.wardrobe-jacket').count(),3);
  assert.deepEqual(await page.locator('figcaption>strong').allTextContents(),['50°','60°','63°']);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const geometry=await page.locator('.exposure-person').evaluateAll(es=>es.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
  await page.locator('#skin-exposure').screenshot({path:`${output}/cold-night-${width}.png`});
  const before=await page.addStyleTag({content:'.comfort-clothing{display:none!important}'});
  await page.locator('#skin-exposure').screenshot({path:`${output}/before-${width}.png`});
  await before.evaluate(e=>e.remove());
  assert.deepEqual(await page.locator('.exposure-person').evaluateAll(es=>es.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))),geometry);
  assert.deepEqual(errors,[]);await page.close();report.widths.push(width);
 }
 const page=await browser.newPage({viewport:{width:1100,height:950}});
 await page.goto(base+'/clothing-qa',{waitUntil:'networkidle'});
 for(const [name,condition,daylight,pop] of [['day','Clear',true,0],['night','Clear',false,0],['cloudy','Cloudy',true,0],['fog','Fog',true,0],['carry','Chance Showers',true,40],['rain','Rain',true,90]]){
  await page.evaluate(async({condition,daylight,pop})=>{
   const {referenceScene}=await import('/weather-fusion/exposure-scene.js');
   document.querySelector('#skin-exposure').hidden=true;
   document.querySelector('#cases').innerHTML=[50,68,82,95].map(t=>`<section><h2>${t}° feels like</h2><div class="art-row">${[0,1,2].map(panel=>referenceScene(panel,daylight,condition,t,{pop})).join('')}</div></section>`).join('');
  },{condition,daylight,pop});
  await page.waitForTimeout(500);
  const rows=page.locator('.art-row');
  assert.equal(await rows.nth(0).locator('.comfort-clothing').count(),3);
  assert.equal(await rows.nth(1).locator('.wardrobe-trousers').count(),3);
  assert.equal(await rows.nth(2).locator('.comfort-clothing').count(),0);
  assert.equal(await rows.nth(3).locator('.comfort-clothing').count(),0);
  await page.locator('#cases').screenshot({path:`${output}/outfits-${name}.png`});
  report.scenarios.push(name);
 }
 await page.close();report.success=true;
}finally{await fs.writeFile(output+'/report.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify(report));
