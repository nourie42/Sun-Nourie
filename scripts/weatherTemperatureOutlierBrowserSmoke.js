/** Compare disclosed raw temperatures/weights with the confidence gap in Chromium. */
import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {fixture} from './weatherNourieFixture.js';
import {weightedTemperature,refreshCalendarConfidence} from '../src/weatherFusionDirect.js';

const root=fileURLToPath(new URL('../',import.meta.url)),out=process.env.WEATHER_OUTLIER_PROOF_DIR||'/tmp/weather-temperature-outlier-proof';
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
let differentHours=false,mixedHours=false;
function forecast(){
 const f=shiftDates(fixture('knightdale',NOW-SHIFT));
 for(const[i,day]of f.days.entries())day.label=i?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long'}).format(new Date(day.date+'T12:00Z')):'Today';
 f.assembledAt=iso(NOW);f.signature='outlier-proof-'+differentHours+'-'+mixedHours;f.aiConfigured=false;f.alerts=[];
 const index=2,start=Date.parse('2026-10-21T04:00:00Z'),end=start+24*H;
 for(const row of f.metricForecasts.series.temperature){
  const time=Date.parse(row.time);if(time<start||time>=end)continue;
  const values=mixedHours?(time===start?{nws:60,ecmwf:61,nbm:70,wn:80}:time===start+H?{nws:60,ecmwf:61,nbm:62,wn:80}:{nws:60,ecmwf:61,nbm:62,wn:63}):!differentHours?{nws:60,ecmwf:61,nbm:62,wn:80}:time===start?{nws:60,ecmwf:60.5,nbm:61,wn:80}:{nws:60,ecmwf:61,nbm:62,wn:70};
  const blend=weightedTemperature(values,index);
  Object.assign(row,{value:blend.value,sources:blend.sources,temperatureAdjustment:blend.temperatureAdjustment});
 }
 const day=f.days[index],qpfValues={nws:.1,ecmwf:0,nbm:0,wn:0};
 Object.assign(day,{qpf:.03,qpfBlend:{sourceValues:qpfValues,sources:Object.keys(qpfValues).map(id=>({id,value:qpfValues[id],weight:.25}))},rainLikelihood:{coverage:{complete:true},value:0}});
 return refreshCalendarConfidence(f,{now:NOW});
}
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  const f=forecast();let data={};
  if(url.pathname.endsWith('/forecast'))data=f;
  else if(url.pathname.endsWith('/alerts'))data={location:f.location,alerts:[],feeds:[{id:'alerts',status:'ready'}]};
  else if(url.pathname.endsWith('/radar'))data={frames:[],status:'unavailable'};
  else if(url.pathname.endsWith('/models'))data={layers:{}};
  else if(url.pathname.endsWith('/bulletins'))data={mode:'official',signature:f.signature,items:[]};
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
const page=await context.newPage(),errors=[],bad=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const base=`http://127.0.0.1:${server.address().port}`;
page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(base))bad.push([r.status(),r.url()]);});
const report={fixtureClock:iso(NOW),scenario:'Original20°F gap with agreeing sources2°F apart; raw temperatures and actual reduced weights remain disclosed',checks,errors,bad};
async function tableFits(selector,width){
 await page.setViewportSize({width,height:900});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow at'+width);
 assert.ok(await page.locator('#day-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog overflow at'+width);
 const table=await page.locator(selector).boundingBox(),dialog=await page.locator('#day-dialog').boundingBox();
 assert.ok(table&&table.x>=dialog.x&&table.x+table.width<=dialog.x+dialog.width,'confidence table fits at'+width);
}
try{
 await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-week-day="2"]');await page.locator('[data-week-day="2"]').click();
 await page.locator('#day-dialog .dialog-confidence > summary').click();
 const section=page.locator('#day-dialog .confidence-temperature-evidence'),primary=section.locator('.confidence-temperature-primary table');
 const initial=await section.innerText();report.initialEvidence=initial;
 assert.match(initial,/Full model gap:\s*20\.0°F/);assert.match(initial,/Gap used for confidence:\s*2\.0°F/);
 assert.match(initial,/keeps 10%.*other 90% goes to ECMWF/);
 assert.deepEqual(await primary.locator('thead th').allTextContents(),['Source','Daily high','At that hour','Weight']);
 assert.equal(await primary.locator('tbody tr').count(),4);
 for(const[id,value]of Object.entries({nws:60,ecmwf:61,nbm:62,wn:80})){
  const cells=await primary.locator(`[data-confidence-source="${id}"] td`).allTextContents();
  assert.equal(cells[0],value.toFixed(1)+'°');assert.equal(cells[1],value.toFixed(1)+'°');
 }
 assert.match(await primary.locator('[data-confidence-source="wn"]').innerText(),/reduced weight.*80\.0°.*80\.0°.*1\.4%.*was 13\.7%/s);
 assert.match(await primary.locator('[data-confidence-source="ecmwf"]').innerText(),/61\.0°.*61\.0°.*24\.7%.*was 12\.3%/s);
 assert.equal(await section.locator('.confidence-rating-values').count(),0,'same-hour comparisons share the primary table');
 checks.push('primary table has four columns, original temperatures, actual reduced weight and ECMWF transfer');
 checks.push('20°F full range and2°F confidence range are both disclosed without hiding the outlier');
 for(const width of [320,390,430,1365])await tableFits('.confidence-temperature-primary table',width);
 checks.push('primary evidence fits320,390,430 and1365px');
 await page.setViewportSize({width:390,height:844});await section.screenshot({path:path.join(out,'temperature-outlier-evidence-mobile.png')});
 differentHours=true;await page.locator('#refresh').evaluate(el=>el.click());
 await page.waitForSelector('#day-dialog .confidence-rating-values');
 assert.ok(await page.locator('#day-dialog').evaluate(el=>el.open));
 assert.ok(await page.locator('#day-dialog .dialog-confidence').evaluate(el=>el.open));
 const updated=await section.innerText();report.differentHourEvidence=updated;
 assert.match(updated,/Full model gap:\s*20\.0°F/);assert.match(updated,/Gap used for confidence:\s*2\.0°F/);
 assert.match(await primary.locator('caption').innerText(),/12:00 AM EDT/);
 await section.locator('.confidence-rating-values summary').click();
 const rating=section.locator('.confidence-temperature-rating table');
 assert.match(await rating.locator('caption').innerText(),/1:00 AM EDT/);
 assert.equal(await rating.locator('thead th').count(),4);
 assert.match(await primary.locator('[data-confidence-source="wn"]').innerText(),/80\.0°.*80\.0°/s);
 assert.match(await rating.locator('[data-confidence-rated-source="wn"]').innerText(),/80\.0°.*70\.0°.*1\.4%/s);
 assert.match(await rating.locator('[data-confidence-rated-source="nbm"]').innerText(),/62\.0°.*62\.0°/s);
 checks.push('refresh preserves open details and shows a second four-column table when scoring uses another hour');
 for(const width of [390,1365])await tableFits('.confidence-temperature-rating table',width);
 checks.push('second evidence table fits mobile and desktop');
 await page.setViewportSize({width:390,height:900});await section.screenshot({path:path.join(out,'temperature-outlier-different-hours-mobile.png')});
 await page.setViewportSize({width:1365,height:1000});await section.screenshot({path:path.join(out,'temperature-outlier-different-hours-desktop.png')});
 mixedHours=true;await page.locator('#refresh').evaluate(el=>el.click());
 await page.waitForFunction(()=>document.querySelector('.confidence-weight-changes summary')?.textContent.includes('(1 hour)'));
 const mixedEvidence=await section.innerText();report.mixedHourEvidence=mixedEvidence;
 assert.match(mixedEvidence,/Full model gap:\s*20\.0°F/);assert.match(mixedEvidence,/Gap used for confidence:\s*20\.0°F/);
 assert.match(await primary.locator('caption').innerText(),/12:00 AM EDT/);
 const unadjustedRow=await primary.locator('[data-confidence-source="wn"]').innerText();
 assert.match(unadjustedRow,/80\.0°.*80\.0°.*13\.7%/s);assert.doesNotMatch(unadjustedRow,/reduced weight|was/);
 assert.equal(await section.locator('.confidence-rating-values').count(),0,'raw/rating maxima share the unadjusted hour');
 await section.locator('.confidence-weight-changes summary').click();
 const disclosure=await section.locator('.confidence-weight-changes').innerText();report.mixedHourDisclosure=disclosure;
 assert.match(disclosure,/1:00 AM EDT.*NVIDIA WeatherNext:\s*13\.7% → 1\.4%/s);
 assert.match(disclosure,/12\.3 percentage points transferred to ECMWF/);
 assert.equal(await section.locator('.confidence-weight-changes p').count(),1);
 checks.push('an adjusted hour remains disclosed when the largest confidence gap occurs at an unadjusted hour');
 for(const width of [390,1365])await tableFits('.confidence-temperature-primary table',width);
 await page.setViewportSize({width:390,height:900});await section.screenshot({path:path.join(out,'temperature-outlier-mixed-hours-mobile.png')});
 assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);report.success=true;
}catch(error){report.error=error.stack;await page.screenshot({path:path.join(out,'temperature-outlier-failure.png'),fullPage:true});throw error;}
finally{await fs.writeFile(path.join(out,'temperature-outlier-browser-report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify(report,null,2));
