/** Verify modeled Now provenance and current-fact expiry in the real main page. */
import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {fixture} from './weatherNourieFixture.js';
import {alignGuidanceCurrentWithHourly} from '../src/weatherFusionCurrent.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';

const root=fileURLToPath(new URL('../',import.meta.url)),out=process.env.WEATHER_CURRENT_FACTS_PROOF_DIR||'/tmp/weather-current-facts-proof';
await fs.mkdir(out,{recursive:true});
const NOW=Date.parse('2026-10-20T09:28:00Z'),H=3600000,SHIFT=45*86400000,epoch=Math.floor(NOW/H)*H,iso=t=>new Date(t).toISOString();
function shiftDates(value){
 if(Array.isArray(value))return value.map(shiftDates);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,shiftDates(item)]));
 if(typeof value==='string'&&/^2026-\d\d-\d\dT\d\d:\d\d/.test(value)&&Number.isFinite(Date.parse(value)))return iso(Date.parse(value)+SHIFT);
 if(typeof value==='string'&&/^2026-\d\d-\d\d$/.test(value))return iso(Date.parse(value+'T12:00Z')+SHIFT).slice(0,10);
 return value;
}
const base=shiftDates(fixture('knightdale',Date.parse('2026-09-05T16:00:00Z')));
Object.assign(base,{assembledAt:iso(NOW),aiConfigured:false,alerts:[],riskOutlooks:[]});
base.current={...base.current,type:'guidance',temperature:51.8,dewpoint:44.2,wind:7.4,humidity:75,time:iso(epoch),
 condition:'Clear',skyCover:0,localEstimate:{source:'NOAA National Blend',reason:'Station was not accepted.'}};
const inputs={temperature:46,dewpoint:38,humidity:73,wind:7,skyCover:0,condition:'Clear'},comfort=thermalComfort(inputs,base.location,epoch);
const point={...base.metricForecasts.series.feels[0],time:iso(epoch),inputs,value:Number(comfort.rawOutdoors.toFixed(1)),shadeValue:Number(comfort.rawShade.toFixed(1)),sunValue:null,daylight:false,condition:'Clear'};
const currentValues={temperature:46,dewpoint:38,humidity:73,wind:7,gust:12,visibility:10,pressure:30,pop:0,precipitation:0,cloud:0};
for(const[key,rows]of Object.entries(base.metricForecasts.series)){
 const row=key==='feels'?point:{...rows[0],time:iso(epoch),value:currentValues[key]??null,source:'Canonical current-hour forecast blend'};
 base.metricForecasts.series[key]=[row,...rows.filter(row=>Date.parse(row.time)!==epoch)];
}
base.hours=[{...base.hours[0],time:iso(epoch),temperature:46,dewpoint:38,wind:7,windMph:7,humidity:73,skyCover:0,condition:'Clear',isDay:false,pop:0,precipitation:0,feelsLike:point.value},...base.hours.filter(row=>Date.parse(row.time)!==epoch)];
base.comfort={...base.comfort,outdoors:999}; // A retained value must never drive current facts.
const before=base.current.temperature;
alignGuidanceCurrentWithHourly(base,NOW);
assert.equal(before,51.8);assert.equal(base.current.temperature,46);assert.equal(base.current.feelsLike,point.value);
let mode='fresh';
function payload(){
 const value=structuredClone(base);value.signature='current-facts-browser-'+mode;
 if(mode==='stale')value.assembledAt=iso(NOW-3*H);
 if(mode==='missing'){
  Object.assign(value.current,{type:'unavailable',temperature:null,dewpoint:null,humidity:null,wind:null,feelsLike:null,feelsLikeShade:null,feelsLikeSun:null});
  for(const[key,rows]of Object.entries(value.metricForecasts.series))for(const row of rows)if(Date.parse(row.time)===epoch){row.value=null;if(key==='feels')row.inputs={temperature:null,dewpoint:null,humidity:null,wind:null};}
 }
 return value;
}
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  const forecast=payload();let value={};
  if(url.pathname.endsWith('/forecast'))value=forecast;
  else if(url.pathname.endsWith('/alerts'))value={location:forecast.location,alerts:[],feeds:[]};
  else if(url.pathname.endsWith('/radar'))value={frames:[],status:'unavailable'};
  else if(url.pathname.endsWith('/models'))value={layers:{}};
  else if(url.pathname.endsWith('/bulletins'))value={mode:'official',signature:forecast.signature,items:[]};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));return;
 }
 const relative=decodeURIComponent(url.pathname).replace(/^\//,'')+(url.pathname.endsWith('/')?'index.html':'');
 const file=path.resolve(root,'public',relative);
 if(!file.startsWith(path.join(root,'public')+'/')){res.writeHead(403);res.end();return;}
 try{const body=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'America/New_York',geolocation:{latitude:35.787,longitude:-78.4806},permissions:['geolocation'],reducedMotion:'reduce'});
await context.route('https://raw.githubusercontent.com/**',route=>route.fulfill({contentType:'application/json',body:'{}'}));
await context.addInitScript(now=>{
 const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 localStorage.setItem('weather-fusion-device-place',JSON.stringify({latitude:35.787,longitude:-78.4806,name:'Knightdale, NC',source:'device'}));
},NOW);
const page=await context.newPage(),report={clock:iso(NOW),data:'Controlled regression fixtures, not observed weather truth',beforeModelFallback:before,scenarios:[],errors:[],failedLocalRequests:[]},origin=`http://127.0.0.1:${server.address().port}`;
page.on('pageerror',e=>report.errors.push(e.message));page.on('response',res=>{if(res.status()>=400&&res.url().startsWith(origin))report.failedLocalRequests.push([res.status(),res.url()]);});
async function readFacts(){return page.locator('.gross-facts b').allTextContents();}
async function ready(){await page.waitForFunction(signature=>globalThis.__weatherNourieForecast?.signature===signature&&document.querySelector('.gross-facts b'),'current-facts-browser-'+mode);}
async function refresh(next){mode=next;await page.locator('#refresh').click();await ready();}
try{
 await page.goto(origin+'/weather-fusion/',{waitUntil:'domcontentloaded'});await ready();
 assert.equal(await page.locator('.current-temp-label').innerText(),'Estimated current temperature');
 assert.match(await page.locator('#observation-label').innerText(),/Selected-location current-hour forecast blend.*model estimate valid 5:00 AM/);
 assert.equal(await page.locator('#observation-label').isVisible(),true);
 const provider=page.locator('#weathernext-site-link');assert.equal(await provider.innerText(),'Google WeatherNext');assert.equal(await provider.getAttribute('aria-label'),'Open Google WeatherNext forecast');
 await page.screenshot({path:out+'/current-estimate-source-mobile.png'});
 assert.equal((await page.locator('#temperature').innerText()).replace(/\s/g,''),'46°');
 await page.locator('#temperature').click();await page.waitForSelector('#metric-dialog[open]');
 const graph=await page.locator('#metric-dialog').innerText();assert.match(graph,/Temperature\s+46°/);assert.match(graph,/5:00 AM/);await page.keyboard.press('Escape');
 await page.locator('#open-gross').click();await page.locator('#dewpoint-gross-meter').waitFor({state:'visible'});
 const fresh=await readFacts();assert.deepEqual(fresh,['38°','73%','46°',Math.round(point.value)+'°']);
 await page.locator('#dewpoint-gross-meter').screenshot({path:out+'/current-facts-fresh-mobile.png'});
 for(const width of[320,390,430,1365]){
  await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow at'+width);
  assert.equal(await page.locator('#observation-label').isVisible(),true);
 }
 await page.setViewportSize({width:390,height:844});
 report.scenarios.push({mode:'fresh',temperature:46,graphInitial:graph,facts:fresh});
 await refresh('stale');const stale=await readFacts();assert.deepEqual(stale,['—','—','—','—']);
 const staleGust=await page.evaluate(async()=>{const{currentSample}=await import('/weather-fusion/weather-display.js');return currentSample(globalThis.__weatherNourieForecast,Date.now()).inputs.gust;});assert.equal(staleGust,null,'an expired current sample cannot borrow its populated forecast gust');
 assert.match(await page.locator('#status').innerText(),/stale/i);
 assert.doesNotMatch(await page.locator('#observation-label').innerText(),/model estimate valid/);
 await page.locator('#dewpoint-gross-meter').screenshot({path:out+'/current-facts-stale-mobile.png'});report.scenarios.push({mode:'stale',facts:stale,gust:staleGust});
 await refresh('missing');const missing=await readFacts();assert.deepEqual(missing,['—','—','—','—']);
 assert.ok(await page.locator('#gross-scrubber').isEnabled(),'future forecast remains available while current readings are missing');
 await page.locator('#dewpoint-gross-meter').screenshot({path:out+'/current-facts-missing-mobile.png'});report.scenarios.push({mode:'missing',facts:missing});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedLocalRequests,[]);
 report.ok=true;
}catch(error){report.ok=false;report.error=error.stack;await page.screenshot({path:out+'/failure.png',fullPage:true});throw error;}
finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({ok:true,scenarios:report.scenarios.map(row=>row.mode),out}));
