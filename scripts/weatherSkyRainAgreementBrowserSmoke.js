/** Exercise independent sky/rain and temperature grades in the actual dashboard. */
import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {fixture} from './weatherNourieFixture.js';
import {refreshCalendarConfidence} from '../src/weatherFusionDirect.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';

const root=fileURLToPath(new URL('../',import.meta.url)),out=process.env.WEATHER_AGREEMENT_PROOF_DIR||'/tmp/weather-sky-rain-agreement-proof';
await fs.mkdir(out,{recursive:true});
const NOW=Date.parse('2026-10-20T14:46:00Z'),SHIFT=45*86400000,H=3600000,iso=t=>new Date(t).toISOString();
function shiftDates(value){
 if(Array.isArray(value))return value.map(shiftDates);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,shiftDates(v)]));
 if(typeof value==='string'&&/^2026-\d\d-\d\dT\d\d:\d\d/.test(value)&&Number.isFinite(Date.parse(value)))return iso(Date.parse(value)+SHIFT);
 if(typeof value==='string'&&/^2026-\d\d-\d\d$/.test(value))return iso(Date.parse(value+'T12:00Z')+SHIFT).slice(0,10);
 return value;
}
function forecast(){
 const f=shiftDates(fixture('knightdale',NOW-SHIFT)),ids=['nws','ecmwf','nbm','wn'];
 f.assembledAt=iso(NOW);f.signature='sky-rain-split-browser';f.aiConfigured=false;f.alerts=[];
 const dayOf=time=>Math.round((Date.parse(new Intl.DateTimeFormat('en-CA',{timeZone:f.location.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time))+'T12:00Z')-Date.parse(f.days[0].date+'T12:00Z'))/(24*H));
 for(const row of f.metricForecasts.series.temperature){
  const day=dayOf(Date.parse(row.time)),values=day===2?{nws:69,ecmwf:70,nbm:71,wn:70}:{nws:60,ecmwf:70,nbm:82,wn:90};
  row.sources=ids.map(id=>({id,value:values[id],weight:.25}));row.value=Object.values(values).reduce((a,b)=>a+b,0)/4;row.temperatureAdjustment=null;
 }
 const temperatures=new Map(f.metricForecasts.series.temperature.map(row=>[row.time,row]));
 for(const point of f.metricForecasts.series.feels){
  const day=dayOf(Date.parse(point.time)),cloud=day===2?[0,0,90,90]:[0,0,0,0];
  point.inputs={...point.inputs,temperature:temperatures.get(point.time)?.value??70,dewpoint:45,humidity:50,wind:5,skyCover:day===2?45:0,condition:day===2?'Partly Cloudy':'Sunny',skySources:ids.map((id,i)=>({id,value:cloud[i],weight:.25}))};
  const comfort=thermalComfort(point.inputs,f.location,Date.parse(point.time));point.value=Number(comfort.rawOutdoors.toFixed(1));point.shadeValue=Number(comfort.rawShade.toFixed(1));point.daylight=comfort.daylight;
 }
 for(const row of f.rainTimeline){
  const day=dayOf(Date.parse(row.time)),values=day===2?[0,0,.12,.12]:[0,0,0,0];
  row.precipitationBlend={sources:ids.map((id,i)=>({id,value:values[i],weight:.25})),sourceValues:Object.fromEntries(ids.map((id,i)=>[id,values[i]]))};
  row.officialPop=day===2?50:0;row.precipitation=day===2?.06:0;row.rainLikelihood={value:day===2?50:0,mode:'blend'};
 }
 for(const row of f.hours){
  const temp=temperatures.get(row.time),day=dayOf(Date.parse(row.time));
  if(temp)row.temperature=temp.value;
  row.skyCover=day===2?45:0;row.condition=day===2?'Chance Rain':'Sunny';
 }
 for(const[index,day]of f.days.entries()){
  day.label=index?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long'}).format(new Date(day.date+'T12:00Z')):'Today';
  day.condition=index===2?'Chance Rain':'Sunny';day.qpf=index===2?1.44:0;
  day.qpfBlend={sourceValues:Object.fromEntries(ids.map(id=>[id,day.qpf])),sources:ids.map(id=>({id,value:day.qpf,weight:.25}))};
  day.rainLikelihood={value:index===2?50:0,coverage:{complete:true}};
  const values=f.metricForecasts.series.temperature.filter(row=>dayOf(Date.parse(row.time))===index).map(row=>row.value);
  if(values.length){day.high=Math.max(...values);day.low=Math.min(...values);}
 }
 return refreshCalendarConfidence(f,{now:NOW});
}
const payload=forecast();
assert.equal(payload.days[3].confidence.weather.key,'high');assert.equal(payload.days[3].confidence.temperature.key,'low');
assert.equal(payload.days[2].confidence.weather.key,'low');assert.equal(payload.days[2].confidence.temperature.key,'high');
assert.equal(payload.days[5].confidence.weather.key,'high','agreement does not lose points just because the date is farther away');
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  let data={};if(url.pathname.endsWith('/forecast'))data=payload;
  else if(url.pathname.endsWith('/alerts'))data={location:payload.location,alerts:[],feeds:[{id:'alerts',status:'ready'}]};
  else if(url.pathname.endsWith('/radar'))data={frames:[],status:'unavailable'};
  else if(url.pathname.endsWith('/models'))data={layers:{}};
  else if(url.pathname.endsWith('/bulletins'))data={mode:'official',signature:payload.signature,items:[]};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));return;
 }
 const name=decodeURIComponent(url.pathname).replace(/^\//,'')+(url.pathname.endsWith('/')?'index.html':'');
 const file=path.resolve(root,'public',name);
 if(!file.startsWith(path.join(root,'public')+'/')){res.writeHead(403);res.end();return;}
 try{const body=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York',geolocation:{latitude:35.787,longitude:-78.4806},permissions:['geolocation'],reducedMotion:'reduce'});
await context.route('https://raw.githubusercontent.com/**',route=>route.fulfill({contentType:'application/json',body:'{}'}));
await context.addInitScript(now=>{const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};},NOW);
const page=await context.newPage(),errors=[],bad=[],checks=[],base=`http://127.0.0.1:${server.address().port}`;
page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(base))bad.push([r.status(),r.url()]);});
const report={fixtureClock:iso(NOW),checks,errors,bad};
try{
 await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-week-day="3"]');
 assert.match(await page.locator('[data-week-day="3"] .seven-day-confidence').innerText(),/Sky\/rain agreement\s+High/);
 assert.match(await page.locator('[data-week-day="2"] .seven-day-confidence').innerText(),/Sky\/rain agreement\s+Low/);
 assert.match(await page.locator('[data-week-day="5"] .seven-day-confidence').innerText(),/Sky\/rain agreement\s+High/);
 assert.equal(await page.locator('.today-confidence-banner').count(),0,'temperature-only disagreement cannot create the primary weather warning');
 checks.push('clear/dry wide-temperature spread shows High sky/rain agreement; split cloud/rain stays Low');
 checks.push('later-date agreement is measured rather than forced High or reduced solely by forecast lead');
 for(const width of [320,390,430,1365]){
  await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow at'+width);
  const layout=await page.locator('[data-week-day="3"]').evaluate(el=>{
   const label=el.querySelector('.seven-day-confidence-label>span'),meter=el.querySelector('.seven-day-meter>span'),a=el.getBoundingClientRect(),b=label.getBoundingClientRect(),m=meter.getBoundingClientRect();
   return {font:parseFloat(getComputedStyle(label).fontSize),fits:b.left>=a.left&&b.right<=a.right&&m.bottom<=a.bottom+1};
  });
  assert.ok(layout.font>=12,'agreement label below12px at'+width);assert.ok(layout.fits,'confidence text/meter escapes compact card at'+width);
 }
 checks.push('12px wrapping agreement label and meter fit320/390/430px and desktop');
 await page.setViewportSize({width:390,height:844});await page.locator('#experimental-week').screenshot({path:path.join(out,'sky-rain-week-mobile.png')});
 await page.locator('[data-week-day="3"] .seven-day-confidence').click();await page.waitForSelector('#day-dialog .dialog-confidence[open]');
 const agreement=page.locator('#day-dialog .dialog-confidence'),temperature=agreement.locator('.dialog-temperature-confidence');
 assert.match(await agreement.locator(':scope>summary').innerText(),/Sky\/rain agreement: High/);
 assert.match(await temperature.locator(':scope>h3').innerText(),/Temperature confidence: Low/);
 assert.match(await temperature.innerText(),/30\.0°F/);assert.match(await agreement.locator('.confidence-weather-evidence').innerText(),/4 sources cover every hour/);
 await agreement.locator('.confidence-weather-readings>summary').click();assert.equal(await agreement.locator('.confidence-weather-source-table').count(),2);
 assert.match(await agreement.locator('.confidence-weather-source-table').first().innerText(),/0\.0%/);
 report.clearDryEvidence=await agreement.innerText();
 for(const width of [320,390,430,1365]){
  await page.setViewportSize({width,height:1000});assert.ok(await page.locator('#day-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog overflow at'+width);
  for(const table of await agreement.locator('table').all()){
   const t=await table.boundingBox(),d=await page.locator('#day-dialog').boundingBox();assert.ok(t.x>=d.x&&t.x+t.width<=d.x+d.width,'source table overflow at'+width);
  }
 }
 checks.push('primary sky/rain details and separate Low temperature grade show their actual source evidence without overflow');
 await page.setViewportSize({width:390,height:1000});await agreement.screenshot({path:path.join(out,'sky-rain-high-temperature-low-mobile.png')});
 await page.setViewportSize({width:1365,height:1000});await agreement.screenshot({path:path.join(out,'sky-rain-high-temperature-low-desktop.png')});
 await agreement.locator(':scope>summary').focus();await agreement.evaluate(el=>el.dataset.beforeRefresh='true');
 await page.locator('#refresh').evaluate(el=>el.click());
 await page.waitForFunction(()=>document.querySelector('#day-dialog .dialog-confidence')?.dataset.beforeRefresh===undefined);
 assert.ok(await page.locator('#day-dialog').evaluate(el=>el.open));assert.ok(await agreement.evaluate(el=>el.open));
 assert.ok(await page.evaluate(()=>document.activeElement?.matches('#day-dialog .dialog-confidence>summary')));
 assert.match(await agreement.locator(':scope>summary').innerText(),/Sky\/rain agreement: High/);
 checks.push('actual background refresh preserves the open day, confidence expansion and keyboard focus');
 await page.keyboard.press('Escape');await page.locator('[data-week-day="2"] .seven-day-confidence').click();
 assert.match(await agreement.locator(':scope>summary').innerText(),/Sky\/rain agreement: Low/);
 assert.match(await temperature.locator(':scope>h3').innerText(),/Temperature confidence: High/);
 assert.match(await page.locator('#day-dialog .dialog-confidence-notice').innerText(),/Low sky\/rain agreement/);
 report.splitEvidence=await agreement.innerText();checks.push('cloud/rain disagreement still creates a Low primary warning even with High temperature confidence');
 await page.setViewportSize({width:390,height:1000});await agreement.screenshot({path:path.join(out,'sky-rain-low-temperature-high-mobile.png')});
 assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);report.success=true;
}catch(error){report.error=error.stack;await page.screenshot({path:path.join(out,'sky-rain-browser-failure.png'),fullPage:true});throw error;}
finally{await fs.writeFile(path.join(out,'sky-rain-browser-report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify(report,null,2));
