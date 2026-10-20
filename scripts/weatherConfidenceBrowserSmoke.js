import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {fixture} from './weatherNourieFixture.js';
import {refreshCalendarConfidence} from '../src/weatherFusionDirect.js';

const root=fileURLToPath(new URL('../',import.meta.url)),out=process.env.WEATHER_CONFIDENCE_PROOF_DIR||'/tmp/weather-confidence-proof';
await fs.mkdir(out,{recursive:true});
const NOW=Date.parse('2026-10-19T18:46:00Z'),SHIFT=44*86400000,H=3600000;
const iso=t=>new Date(t).toISOString();
function shiftDates(value){
 if(Array.isArray(value))return value.map(shiftDates);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,shiftDates(v)]));
 if(typeof value==='string'&&/^2026-\d\d-\d\dT\d\d:\d\d/.test(value)&&Number.isFinite(Date.parse(value)))return iso(Date.parse(value)+SHIFT);
 if(typeof value==='string'&&/^2026-\d\d-\d\d$/.test(value))return iso(Date.parse(value+'T12:00Z')+SHIFT).slice(0,10);
 return value;
}
let revision=0;
function forecast(){
 const f=shiftDates(fixture('knightdale',NOW-SHIFT));
 for(const [i,day] of f.days.entries())day.label=i?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long'}).format(new Date(day.date+'T12:00Z')):'Today';
 f.assembledAt=iso(NOW+revision*60000);f.signature='confidence-comparison-'+revision;f.aiConfigured=false;f.alerts=[];f.google={contributes:true};
 const start=Date.parse('2026-10-20T04:00:00Z'),end=start+24*H;
 const highs={nws:72,hrrr:72,ecmwf:69,nbm:70,wn:73},night={nws:60.4,hrrr:59,ecmwf:57,nbm:58,wn:revision?54:52};
 const rows=f.metricForecasts.series.temperature;
 for(const row of rows){
  const t=Date.parse(row.time);if(t<start||t>=end)continue;
  const hour=(t-start)/H;
  row.sources=Object.entries(highs).map(([id,high])=>({id,value:hour===22?night[id]:high-Math.abs(hour-14),weight:.2,runAt:iso(NOW-3*H)}));
  row.value=Number((row.sources.reduce((sum,s)=>sum+s.value*s.weight,0)).toFixed(1));
  const actual=f.hours.find(h=>h.time===row.time);if(actual)actual.temperature=row.value;
 }
 const tomorrow=rows.filter(r=>Date.parse(r.time)>=start&&Date.parse(r.time)<end),day=f.days[1];
 day.high=Math.max(...tomorrow.map(r=>r.value));day.low=Math.min(...tomorrow.map(r=>r.value));
 return refreshCalendarConfidence(f,{now:NOW});
}
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/')){
  const f=forecast();let value={};
  if(u.pathname.endsWith('/forecast'))value=f;
  else if(u.pathname.endsWith('/alerts'))value={location:f.location,alerts:[],feeds:[{id:'alerts',status:'ready'}]};
  else if(u.pathname.endsWith('/radar'))value={frames:[],status:'unavailable'};
  else if(u.pathname.endsWith('/models'))value={layers:{}};
  else if(u.pathname.endsWith('/bulletins'))value={mode:'official',signature:f.signature,items:[]};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));return;
 }
 const name=decodeURIComponent(u.pathname).replace(/^\//,'')+(u.pathname.endsWith('/')?'index.html':'');
 const file=path.resolve(root,'public',name);
 if(!file.startsWith(path.join(root,'public')+'/')){res.writeHead(403);res.end();return;}
 try{const bytes=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York',geolocation:{latitude:35.787,longitude:-78.4806},permissions:['geolocation'],reducedMotion:'reduce'});
await context.addInitScript(now=>{const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};},NOW);
const page=await context.newPage(),errors=[],bad=[];page.on('pageerror',e=>errors.push(e.message));
const base='http://127.0.0.1:'+server.address().port;
page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(base))bad.push([r.status(),r.url()]);});
const report={scenario:'Same snapshot: daily highs69–73°F, hourly disagreement8.4°F at10PM',errors,bad};
try{
 await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-week-day="1"]');await page.waitForSelector('#wn-compare-chart svg',{state:'attached'});
 await page.locator('[data-week-day="1"]').click();await page.locator('#day-dialog .dialog-confidence > summary').click();
 let evidence=await page.locator('#day-dialog .confidence-temperature-evidence').innerText();
 assert.match(evidence,/69\.0–73\.0°F.*4\.0°F apart/);assert.match(evidence,/8\.4°F.*Tue, Oct 20, 10:00 PM EDT/s);
 assert.match(await page.locator('[data-confidence-source="nws"]').innerText(),/72\.0°.*60\.4°/s);
 assert.match(await page.locator('[data-confidence-source="wn"]').innerText(),/73\.0°.*52\.0°/s);
 report.initialEvidence=evidence;
 for(const width of [320,390,430,1365]){
  await page.setViewportSize({width,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'main overflow at'+width);
  assert.ok(await page.locator('#day-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog overflow at'+width);
  const table=await page.locator('.confidence-temperature-evidence table').boundingBox(),dialog=await page.locator('#day-dialog').boundingBox();
  assert.ok(table.x>=dialog.x&&table.x+table.width<=dialog.x+dialog.width,'temperature table fits at'+width);
 }
 await page.setViewportSize({width:390,height:844});
 await page.locator('.confidence-temperature-evidence').screenshot({path:path.join(out,'confidence-evidence-mobile.png')});
 await page.locator('#day-dialog .dialog-confidence').evaluate(el=>el.open=true);
 revision=1;await page.locator('#refresh').evaluate(el=>el.click());
 await page.waitForFunction(()=>document.querySelector('#day-dialog [data-confidence-hourly-gap]')?.textContent.includes('6.4°F'));
 assert.ok(await page.locator('#day-dialog').evaluate(el=>el.open));assert.ok(await page.locator('#day-dialog .dialog-confidence').evaluate(el=>el.open));
 assert.doesNotMatch(await page.locator('.confidence-temperature-evidence').innerText(),/8\.4°F/);
 report.refreshedEvidence=await page.locator('.confidence-temperature-evidence').innerText();
 await page.keyboard.press('Escape');await page.locator('#open-compare').click();await page.waitForSelector('#wn-compare-chart svg');
 const title=await page.locator('#wn-compare-title').innerText();assert.match(title,/Daily high temperature/);
 await page.locator('#wn-compare-chart').evaluate(el=>{const svg=el.querySelector('svg'),dot=svg.querySelector('[data-series="nourie"][data-index="1"]'),r=svg.getBoundingClientRect();el._wnShow(r.left+Number(dot.getAttribute('cx'))*r.width/svg.viewBox.baseVal.width);});
 const tooltip=await page.locator('#wn-compare-chart .wn-tip').innerText();
 assert.match(tooltip,/Daily highs/);assert.match(tooltip,/NWS\s+72\.0°/);assert.match(tooltip,/ECMWF\s+69\.0°/);assert.match(tooltip,/Google WeatherNext\s+73\.0°/);assert.match(tooltip,/4\.0°F/);
 report.chartTitle=title;report.chartTooltip=tooltip;
 await page.locator('#wn-compare-chart').screenshot({path:path.join(out,'confidence-model-chart-mobile.png')});
 assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);report.success=true;
}catch(e){report.error=e.stack;await page.screenshot({path:path.join(out,'confidence-browser-failure.png'),fullPage:true});throw e;}
finally{await fs.writeFile(path.join(out,'confidence-browser-report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));}
console.log(JSON.stringify(report,null,2));
