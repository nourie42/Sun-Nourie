import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,''),out=process.env.WEATHER_ACCURACY_PROOF_DIR||'/tmp/weather-accuracy-proof';
await fs.mkdir(out,{recursive:true});
const {fixture}=await import(pathToFileURL(root+'/scripts/weatherNourieFixture.js'));
const {thermalComfort}=await import(pathToFileURL(root+'/public/weather-fusion/weather-math.js'));
const NOW=Date.parse('2026-10-19T16:10:00Z'),H=3600000,shift=44*86400000;
const iso=t=>new Date(t).toISOString();
function shiftDates(value){
 if(Array.isArray(value))return value.map(shiftDates);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,shiftDates(v)]));
 if(typeof value==='string'&&/^2026-\d\d-\d\dT\d\d:\d\d/.test(value)&&Number.isFinite(Date.parse(value)))return iso(Date.parse(value)+shift);
 if(typeof value==='string'&&/^2026-\d\d-\d\d$/.test(value))return iso(Date.parse(value+'T12:00Z')+shift).slice(0,10);
 return value;
}
function makeForecast(mode='cool'){
 const f=shiftDates(fixture('knightdale',Date.parse('2026-09-05T16:00:00Z')));
 f.assembledAt=iso(NOW);f.signature='browser-accuracy-'+mode;f.location.name='Knightdale, NC';f.aiConfigured=false;f.feeds=[];f.alerts=[];f.riskOutlooks=[];
 const tempFor=t=>mode==='perfect'?74:Math.min(66,59+Math.max(0,Math.floor((t-NOW)/H)+1)*3);
 f.current={...f.current,type:'observation',time:iso(NOW-9*60000),temperature:mode==='perfect'?74:59,dewpoint:42,humidity:52,wind:11,gust:11,skyCover:0,condition:'Sunny',textDescription:'Sunny',station:'KRDU'};
 for(const p of f.metricForecasts.series.feels){
  const t=Date.parse(p.time),inputs={...p.inputs,temperature:tempFor(t),dewpoint:42,wind:11,humidity:52,skyCover:0,condition:'Sunny'};
  const comfort=thermalComfort(inputs,f.location,t);
  Object.assign(p,{inputs,value:Number(comfort.rawOutdoors.toFixed(1)),shadeValue:Number(comfort.rawShade.toFixed(1)),daylight:comfort.daylight,condition:'Sunny'});
  for(const [key,value]of Object.entries({temperature:inputs.temperature,dewpoint:42,wind:11,gust:11,humidity:52})){
   const q=f.metricForecasts.series[key]?.find(r=>r.time===p.time);if(q)q.value=value;
  }
 }
 for(const row of [...f.hours,...f.rainTimeline]){
  const p=f.metricForecasts.series.feels.find(p=>p.time===row.time);
  Object.assign(row,{temperature:tempFor(Date.parse(row.time)),dewpoint:42,humidity:52,wind:11,windMph:11,gust:11,skyCover:0,condition:'Sunny',isDay:p?.daylight,precipitation:0,pop:0,officialPop:0,rainLikelihood:{value:0},feelsLike:p?.value,apparent:p?.value});
  if(row.temperatureBlend)row.temperatureBlend.value=row.temperature;
 }
 for(const day of f.days)Object.assign(day,{condition:'Sunny',nightCondition:'Clear',uvMax:5,pop:0,popDay:0,popNight:0,qpf:0,rainLikelihood:{value:0},popDayLikelihood:{value:0},popNightLikelihood:{value:0}});
 f.uv={today:5,hourly:f.metricForecasts.series.feels.map(p=>({time:p.time,value:p.daylight?5:0}))};
 f.airQuality={source:'Open-Meteo / CAMS',time:iso(Math.floor(NOW/H)*H),aqi:28,pm25:5,pm10:10,next24HourPeak:80,hours:f.metricForecasts.series.feels.map((p,i)=>({time:p.time,aqi:i?80:28}))};
 f.exposureWeather={fetchedAt:iso(NOW),rows:Array.from({length:100},(_,i)=>({time:iso(Math.floor(NOW/H)*H-48*H+i*H),temperature:59,dewpoint:42,humidity:52,wind:11,skyCover:0,solar:0,rain:0}))};
 if(mode==='stale'){f.assembledAt=iso(NOW-3*H);f.current.time=iso(NOW-3*H);f.airQuality.time=iso(NOW-3*H);f.exposureWeather.fetchedAt=iso(NOW-3*H);}
 return f;
}
let mode='cool';
const report={fixtureClock:iso(NOW),data:'Controlled fixtures; browser consistency verification, not observed-weather validation',scenarios:[],runtimeErrors:[],consoleErrors:[],failedLocalRequests:[]};
const mime={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/')){
  let value={};if(u.pathname.endsWith('/forecast'))value=makeForecast(mode);
  else if(u.pathname.endsWith('/bulletins'))value={mode:'official',signature:u.searchParams.get('signature'),items:[]};
  else if(u.pathname.endsWith('/alerts'))value={location:makeForecast(mode).location,alerts:[],feeds:[]};
  else if(u.pathname.endsWith('/radar'))value={frames:[],status:'unavailable'};
  else if(u.pathname.endsWith('/models'))value={layers:{}};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));return;
 }
 const relative=decodeURIComponent(u.pathname).replace(/^\//,'')+(u.pathname.endsWith('/')?'index.html':'');
 const file=path.resolve(root,'public',relative);
 if(!file.startsWith(root+'/public/')){res.writeHead(403);res.end();return;}
 try{const body=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844},geolocation:{latitude:35.787,longitude:-78.4806},permissions:['geolocation'],reducedMotion:'reduce'});
await context.addInitScript(({now})=>{
 const NativeDate=Date;class FixedDate extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}globalThis.Date=FixedDate;
 localStorage.setItem('weather-fusion-device-place',JSON.stringify({latitude:35.787,longitude:-78.4806,name:'Knightdale, NC',source:'device'}));
},{now:NOW});
const page=await context.newPage();
page.on('pageerror',e=>report.runtimeErrors.push(e.message));
page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(base))report.failedLocalRequests.push([r.status(),r.url().slice(base.length)]);});
async function visit(url){await page.goto(base+url,{waitUntil:'domcontentloaded'});}
async function mainReady(){await page.waitForFunction(()=>globalThis.__weatherNourieForecast&&document.querySelector('#today-forecast .today-feels'));}
async function snapshot(name){await page.screenshot({path:out+'/'+name+'.png',fullPage:true});}
try{
 await visit('/weather-fusion/');await mainReady();
 const cool=await page.evaluate(async()=>{
  const f=globalThis.__weatherNourieForecast;
  const {currentSample}=await import('/weather-fusion/weather-display.js');
  const {buildForecastWindows}=await import('/weather-fusion/forecast-windows.js');
  return {canonical:currentSample(f,Date.now()).feels,currentHour:document.querySelector('#hourly .hour-current .hour-feels b')?.textContent,sun:document.querySelector('.sun-person figcaption strong')?.textContent,peak:document.querySelector('#today-forecast .today-feels')?.textContent,pets:document.querySelector('#pavement-content figcaption')?.textContent,perfect:buildForecastWindows(f,Date.now()).perfect.length,visiblePerfect:document.querySelectorAll('[data-forecast-window="perfect"]').length};
 });
 assert.equal(cool.currentHour,Math.round(cool.canonical)+'°');assert.equal(cool.sun,Math.round(cool.canonical)+'°');assert.equal(cool.perfect,0);assert.equal(cool.visiblePerfect,0);assert.match(cool.peak,/Peak forecast feels like/);assert.match(cool.peak,/PM · outdoors/);assert.match(cool.pets,/Concrete surface/);
 for(const width of [320,390,430,1365]){
  await page.setViewportSize({width,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow width'+width);
  const feels=await page.locator('#today-forecast .today-feels').boundingBox(),metrics=await page.locator('#today-forecast .today-metrics').boundingBox();
  assert.ok(feels.y+feels.height<=metrics.y+1,`peak/metrics overlap at${width}: ${JSON.stringify({feels,metrics})}`);
 }
 await page.setViewportSize({width:390,height:844});await snapshot('accuracy-cool-mobile');report.scenarios.push({name:'cool59-degree-main',...cool});
 mode='perfect';await page.locator('#refresh').click();await page.waitForSelector('[data-forecast-window="perfect"]');await page.locator('[data-forecast-window="perfect"]').click();await page.waitForSelector('#forecast-window-dialog[open]');
 const rows=await page.evaluate(()=>[...document.querySelectorAll('#forecast-window-dialog tbody tr')].map(r=>({time:r.dataset.forecastHour,feels:r.cells[1]?.textContent,heading:r.closest('table').querySelector('th:nth-child(2)')?.textContent})));
 const expected=makeForecast('perfect').metricForecasts.series.feels;
 assert.ok(rows.length);for(const row of rows){assert.equal(row.feels,Math.round(expected.find(p=>p.time===row.time)?.value)+'°');assert.equal(row.heading,'Feels like outdoors');}
 await snapshot('accuracy-perfect-mobile');await page.keyboard.press('Escape');report.scenarios.push({name:'perfect-forecast-canonical',rows});
 mode='stale';await page.locator('#refresh').click();await page.waitForFunction(()=>globalThis.__weatherNourieForecast?.signature==='browser-accuracy-stale');
 const stale=await page.evaluate(()=>({hero:document.querySelector('#temperature')?.textContent,currentHour:document.querySelector('#hourly .hour-current .hour-feels b')?.textContent,sun:document.querySelector('.sun-person figcaption strong')?.textContent,pavement:document.querySelector('#pavement-content')?.textContent,perfect:document.querySelectorAll('[data-forecast-window="perfect"]').length,air:document.querySelector('#air-quality-content')?.textContent}));
 assert.match(stale.hero,/—/);assert.equal(stale.currentHour,'—');assert.match(stale.sun,/Unavailable|—/);assert.equal(stale.perfect,0);assert.match(stale.air,/unavailable/i);await snapshot('accuracy-stale-mobile');report.scenarios.push({name:'stale-main',...stale});
 mode='cool';await visit('/weather-fusion/atmos.html?location=knightdale');await page.waitForFunction(()=>document.querySelector('#street-air')?.textContent.includes('Current modeled AQI'));
 const initialAir=await page.locator('#street-air').innerText();await page.locator('#hour').evaluate(el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>document.querySelector('#street-air')?.textContent.includes('Selected-hour AQI forecast'));
 const nextAir=await page.locator('#street-air').innerText();assert.match(initialAir,/28/);assert.match(nextAir,/80/);assert.doesNotMatch(nextAir,/PM2\.5|next 24/i);report.scenarios.push({name:'atmos-selected-hour-aqi',initialAir,nextAir});await snapshot('accuracy-atmos-selected-mobile');
 assert.deepEqual(report.runtimeErrors,[]);assert.ok(!report.consoleErrors.some(e=>/panel failed|display failed|failed to draw|section.*failed/i.test(e)),JSON.stringify(report.consoleErrors));
 report.success=true;
}catch(error){report.error={message:error.message,stack:error.stack};await snapshot('accuracy-failure').catch(()=>{});throw error;}
finally{await fs.writeFile(out+'/browser-accuracy-report.json',JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify(report,null,2));
