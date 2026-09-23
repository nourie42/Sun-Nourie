import {chromium} from 'playwright';
import express from 'express';
import assert from 'node:assert/strict';
import {fixture} from './weatherNourieFixture.js';

const now=Date.parse('2026-09-05T21:59:00Z');
const app=express();
app.get('/api/weather-fusion/forecast',(req,res)=>{
  const data=fixture(req.query.location,now);
  data.assembledAt=new Date(now).toISOString();
  res.json(data);
});
app.get('/api/weather-fusion/radar',(_req,res)=>res.json({
  frames:[new Date(now).toISOString()],
  status:'ready',
  location:{latitude:35.787,longitude:-78.4806},
  precipitation:{
    status:'ready',
    observedAt:new Date(now).toISOString(),
    atLocation:true,
    close:true,
    nearby:true,
    inArea:true,
    approaching:false,
    nearestRainMiles:0,
    nearestRainDirection:null,
    classification:{station:'KRAX',observedAt:null,reflectivityFallback:true}
  }
}));
app.get('/api/weather-fusion/models',(_req,res)=>res.json({layers:{}}));
app.get('/api/weather-fusion/bulletins',(req,res)=>res.json({mode:'official',signature:req.query.signature||null,items:[],summaries:[]}));
app.use('/weather-fusion',express.static('public/weather-fusion'));

const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844},geolocation:{latitude:35.787,longitude:-78.4806},permissions:['geolocation']});
  const page=await context.newPage();
  await page.addInitScript(epoch=>{Date.now=()=>epoch;},now);
  await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#observation-label')?.textContent?.includes('Rain now'),null,{timeout:30000});

  assert.equal(await page.locator('#condition').innerText(),'Rain now');
  assert.match(await page.locator('#observation-label').innerText(),/Rain now · observed radar over this location/);
  assert.match(await page.locator('#hero-feels').innerText(),/In rain/i);
  assert.match(await page.locator('#hourly .hour-current').innerText(),/Rain now/);

  assert.equal(await page.locator('#skin-exposure .sun-person .exposure-label').innerText(),'Rain');
  assert.match(await page.locator('#skin-exposure .sun-person .exposure-subtitle').innerText(),/Raining now/);
  assert.match(await page.locator('#skin-exposure .shade-person .exposure-subtitle').innerText(),/Rain outside/);
  assert.match(await page.locator('#skin-exposure .pavement-person .exposure-subtitle').innerText(),/Wet pavement/);

  for(const selector of ['.shade-person','.sun-person','.pavement-person']){
    const scene=page.locator('#skin-exposure '+selector+' svg.reference-scene');
    assert.equal(await scene.getAttribute('data-scene'),'rain',selector+' must use rain artwork');
    const href=await scene.locator('image.reference-art').getAttribute('href');
    assert.match(href,/comfort-reference-scenes-rain\.webp/);
  }
  assert.equal(await page.locator('#skin-exposure image.reference-art[href*="hot"]').count(),0,'live rain must not leave sunny heat artwork');

  console.log(JSON.stringify({
    ok:true,
    checks:[
      'Hero says Rain now',
      'Radar source label says rain over this location',
      'Feels-like label says In rain',
      'Now hourly card says Rain now',
      'Shade, outdoor, and pet cards all use rain artwork',
      'Pet card says Wet pavement'
    ]
  },null,2));
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
