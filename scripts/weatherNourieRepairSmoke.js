/** Regression tests use marked synthetic weather + delayed/failing image loads.
 * Production checks are separate (weatherFusionBrowserSmoke.js).
 */
import {chromium} from 'playwright';
import express from 'express';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildForecast,localTime,nextDate} from '../src/weatherFusion.js';
import {testInputs} from '../test/weatherFusion.fixtures.js';
const H=3600000,zone='America/New_York',dir='/tmp/weather-repair-results';await fs.mkdir(dir,{recursive:true});
let now=Date.parse('2026-09-06T09:40:00Z');
function fixture(place){
 const input=structuredClone(testInputs),t=Math.floor(now/H)*H,date=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 input.now=now;input.location=place==='greenville'?{...input.location,id:place,name:'Greenville, NC',latitude:35.6127,longitude:-77.3664}:input.location;
 input.observation={...input.observation,time:new Date(now-20*60000).toISOString(),stationDistanceKm:25,temperature:73,dewpoint:73,humidity:100,wind:0};
 input.hourly.periods=Array.from({length:48},(_,i)=>({...input.hourly.periods[0],startTime:new Date(t+i*H).toISOString(),endTime:new Date(t+(i+1)*H).toISOString(),temperature:72+Math.round(10*Math.sin(i/7)),dewpoint:{value:21,unitCode:'wmoUnit:degC'},windSpeed:'3 mph',isDaytime:i%24<12}));
 input.forecast.periods=Array.from({length:14},(_,i)=>{const isDaytime=i%2===0,start=localTime(nextDate(date,Math.floor(i/2)),isDaytime?7:19,zone);return {...input.forecast.periods[i],isDaytime,startTime:new Date(start).toISOString(),endTime:new Date(start+12*H).toISOString()};});
 input.grid={quantitativePrecipitation:{uom:'wmoUnit:in',values:[{validTime:new Date(t-H).toISOString()+'/P11D',value:.5}]},windSpeed:{uom:'wmoUnit:mi_h-1',values:[{validTime:new Date(t-H).toISOString()+'/P8D',value:3}]},dewpoint:{uom:'wmoUnit:degF',values:[{validTime:new Date(t-H).toISOString()+'/P8D',value:68}]}};
 input.models=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>{const count=id==='hrrr'?49:241,time=Array.from({length:count},(_,i)=>(t-H+i*H)/1000);return [id,{direct:true,runAt:new Date(t-H).toISOString(),resolution:'TEST FIXTURE',hourly_units:{temperature_2m:'°F',dew_point_2m:'°F',wind_speed_10m:'mp/h',pressure_msl:'inHg',visibility:'mi'},hourly:{time,temperature_2m:time.map((_,i)=>73+7*Math.sin(i/8)),dew_point_2m:time.map((_,i)=>65+6*Math.sin(i/18)),wind_speed_10m:time.map(()=>4),pressure_msl:time.map((_,i)=>30+Math.sin(i/6)*.1),visibility:time.map(()=>10),relative_humidity_2m:time.map(()=>80)},precipitationIntervals:time.slice(1).map(v=>({start:v-3600,end:v,value:.002}))}];}));
 return {...buildForecast(input),aiConfigured:false,directModelStatus:'ready'};
}
const app=express();app.get('/api/weather-fusion/forecast',(req,res)=>res.json(fixture(req.query.location)));
app.get('/api/weather-fusion/radar',(_req,res)=>res.json({frames:[],status:'unavailable',message:'Radar disabled in this labeled test fixture.'}));
let root='';app.get('/api/weather-fusion/models',(_req,res)=>res.json({layers:Object.fromEntries(['hrrr','ecmwf','nbm','temperature','wind','clouds'].map(name=>[name,{model:name==='hrrr'?'hrrr':name==='nbm'?'nbm':'ecmwf',label:'TEST '+name,runAt:new Date(now-H).toISOString(),sourceUrl:'https://www.weather.gov/',frames:Array.from({length:9},(_,i)=>({url:`${root}/fixture-image/${name}/${i}.svg`,time:new Date(now+i*H).toISOString(),bounds:[[32.5,-85],[38,-74]],units:'test',field:'reflectivity'}))}]))}));
app.get('/fixture-image/:name/:frame',(req,res)=>{const i=Number(req.params.frame.split('.')[0]);setTimeout(()=>{if(i===7)return res.status(503).send('Test image failure');res.type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280"><rect width="440" height="280" fill="none"/><circle cx="${60+i*20}" cy="100" r="45" fill="${req.params.name==='hrrr'?'#83d7bf':'#b0d5ff'}" fill-opacity="0.6"/><text x="30" y="200" fill="white">TEST ${req.params.name} ${i}</text></svg>`);},i===1?2600:i===2?500:80);});
app.use('/weather-fusion',express.static('public/weather-fusion'));
const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});root=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true}),report={fixture:true,checks:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.clock.install({time:new Date(now)});
 await page.route('**/basemap.nationalmap.gov/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')}));
 await page.goto(root+'/weather-fusion/',{waitUntil:'domcontentloaded'});await page.waitForSelector('#gross-scrubber');
 assert.doesNotMatch(await page.locator('#skin-exposure').innerText(),/tonight|overnight/i);
 assert.match(await page.locator('#skin-values').innerText(),/right now.*warmest today/s);
 assert.equal(await page.locator('[data-day="0"] .day-name').innerText(),'Today');
 const center=await page.locator('.gross-number').boundingBox(),tile=await page.locator('#dewpoint-gross-meter').boundingBox();
 assert.ok(Math.abs(center.x+center.width/2-tile.x-tile.width/2)<2,'Dewpoint number must be centered');
 for(const range of [24,48,168,240]){
  await page.locator(`[data-gross-hours="${range}"]`).click();
  assert.equal(await page.locator('#dewpoint-gross-meter').getAttribute('data-hours'),String(range));
  const font=await page.locator('.gross-x').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert.ok(font>=12);
  const svg=await page.locator('.gross-chart').boundingBox();assert.equal(svg.height,300);
  await page.locator('#gross-scrubber').fill('8');assert.match(await page.locator('.gross-selected-time').innerText(),/forecast/);
 }
 report.checks.push('5:40 AM uses today','current value centered','24h/48h/7d/10d controls','300px graph with 12px labels','interactive hourly selection');
 await page.locator('[data-gross-hours="48"]').click();
 for(const width of [320,390,430,1365]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(250);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`document overflows ${width}`);
  if(width===390||width===1365){await page.locator('#dewpoint-gross-meter').screenshot({path:dir+`/gross-${width}.png`});await page.locator('.hero').screenshot({path:dir+`/hero-${width}.png`});}
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-layer="hrrr"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-weather-model-frame="visible"]'));
 const seek=async n=>page.locator('#radar-time').evaluate((e,n)=>{e.value=String(n);e.dispatchEvent(new Event('input',{bubbles:true}));},n);
 await seek(1);await seek(2);await seek(3);await page.waitForTimeout(3000);
 assert.equal(await page.locator('.leaflet-image-layer').count(),1);assert.match(await page.locator('[data-weather-model-frame="visible"]').getAttribute('src'),/hrrr\/3/);
 await seek(1);await page.locator('[data-layer="nbm"]').click();await page.waitForTimeout(3000);
 assert.equal(await page.locator('.leaflet-image-layer').count(),1);assert.match(await page.locator('[data-weather-model-frame="visible"]').getAttribute('src'),/nbm/);
 await seek(7);await page.waitForFunction(()=>!document.querySelector('#map-error').hidden);assert.equal(await page.locator('.leaflet-image-layer').count(),0);
 await seek(0);await page.waitForFunction(()=>document.querySelector('[data-weather-model-frame="visible"]'));
 await page.locator('#radar-play').click();await page.waitForTimeout(5200);await page.locator('#radar-play').click();await page.waitForTimeout(2800);
 assert.equal(await page.locator('.leaflet-image-layer').count(),1);
 await page.locator('#map-panel').screenshot({path:dir+'/map-fixture.png'});
 report.checks.push('rapid HRRR seeks with slow/out-of-order loading','HRRR to NBM mid-load','failed frame clears previous image','playback never strands an overlay');
 for(const key of ['feels','precipitation','wind','humidity','pop','visibility','pressure','solar']){
  await page.locator(`[data-metric="${key}"]`).click();assert.ok(await page.locator('#metric-dialog').isVisible());
  await page.locator('#chart-scrubber').fill('3');await page.keyboard.press('Escape');
 }
 await page.locator('[data-place="greenville"]').click();await page.waitForFunction(()=>document.querySelector('#city-name').textContent.includes('Greenville')&&document.querySelector('#gross-scrubber'));
 now=Date.parse('2026-09-06T18:59:59Z');await page.clock.setFixedTime(new Date(now));await page.locator('#refresh').click();await page.waitForTimeout(500);
 assert.equal(await page.locator('[data-day="0"] .day-name').innerText(),'Today');
 now=Date.parse('2026-09-06T19:00:00Z');await page.clock.setFixedTime(new Date(now));await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#condition').textContent.includes('Tonight'));
 assert.equal(await page.locator('[data-day="0"] .day-name').innerText(),'Tonight');
 assert.match(await page.locator('#skin-values').innerText(),/coolest tonight/);
 report.checks.push('all eight metric dialogs','location switching','14:59:59 -> 15:00 local boundary');
 assert.deepEqual(report.errors,[]);report.success=true;
}finally{await fs.writeFile(dir+'/repair-report.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify(report,null,2));
