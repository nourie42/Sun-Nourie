import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {buildForecast} from '../src/weatherFusion.js';
import {currentSample} from '../public/weather-fusion/weather-display.js';
import {comfortWindow} from '../public/weather-fusion/comfort-outlook.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';

const dir='/tmp/weather-personal-results';await fs.mkdir(dir,{recursive:true});
const epoch=Date.parse('2026-09-06T13:00:00Z');
const H=3600000;
const location={name:'Knightdale / Raleigh',latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
const rows=(value,n=241)=>Array.from({length:n},(_,i)=>({time:new Date(Math.floor(epoch/H)*H+i*H).toISOString(),value:typeof value==='function'?value(i):value}));
const fixture=()=>{
 const current={temperature:79,dewpoint:68,wind:4,humidity:65,condition:'Cloudy',type:'observation',time:new Date(epoch-20*60000).toISOString(),pressurePa:101300,pressure:29.91,pressureTrend:{status:'ready',direction:'falling',deltaMb:-1.2,hours:3}};
 const days=Array.from({length:7},(_,i)=>({date:new Date(Date.parse('2026-09-06T12:00:00Z')+i*24*H).toISOString().slice(0,10),label:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i],high:84+i,low:65+i,condition:'Cloudy',detail:'Cloudy.',nightCondition:'Mostly Cloudy',nightDetail:'Mostly cloudy.',pop:20,popNight:15,uvMax:5,confidence:{label:'Good',score:78,key:'good',factors:[],note:''}}));
 const hours=Array.from({length:48},(_,i)=>({time:new Date(Math.floor(epoch/H)*H+i*H).toISOString(),temperature:79+i*.08,condition:'Cloudy',pop:20}));
 const metricForecasts={notes:{},series:{temperature:rows(i=>79+i*.04),dewpoint:rows(68),wind:rows(4),humidity:rows(65),pressure:rows(1013),visibility:rows(10),feels:rows(i=>80+i*.03),feelsShade:rows(i=>77+i*.02),feelsSun:rows(null),uv:rows(4)}};
 const f={location,assembledAt:new Date(epoch).toISOString(),current,days,hours,metricForecasts,feeds:[{id:'nws',status:'ready',contributes:true,label:'NWS'},{id:'afd',status:'ready',contributes:true,label:'Local discussion'},{id:'hrrr',status:'ready',contributes:true,label:'HRRR'},{id:'ecmwf',status:'ready',contributes:true,label:'ECMWF IFS'},{id:'nbm',status:'ready',contributes:true,label:'National Blend'},{id:'alerts',status:'ready',contributes:true,label:'Alerts'}],discussion:{office:'RAH',issuanceTime:new Date(epoch-2*H).toISOString(),text:'Cloudy with a few showers possible later.',url:'https://api.weather.gov/products/example'},alerts:[{id:'https://api.weather.gov/alerts/example',event:'Flash Flood Warning',severity:'Severe',description:'Heavy rain is causing flash flooding.',instruction:'Move to higher ground now.',sent:new Date(epoch-H).toISOString(),expires:new Date(epoch+3*H).toISOString(),areaDesc:'Wake County'},{id:'watch',event:'Flood Watch',severity:'Moderate',description:'Flooding is possible.',instruction:'Monitor conditions.',sent:new Date(epoch-H).toISOString(),expires:new Date(epoch+6*H).toISOString(),areaDesc:'Wake County'}],specialDiscussions:[{id:'discussion',event:'SPC special weather discussion',description:'Storms may organize.',areaDesc:'Regional special discussion covering this point; not a warning.',sent:new Date(epoch-H).toISOString(),expires:new Date(epoch+2*H).toISOString(),url:'https://www.spc.noaa.gov/products/md/md2000.html'}],methodology:'UTCI Tier-3 operational fallback',solar:{sunrise:new Date(epoch-2*H).toISOString(),sunset:new Date(epoch+9*H).toISOString()},signature:'fixture',aiConfigured:false};
 f.comfort=thermalComfort(current,location,epoch);f.current.feelsLike=f.comfort.outdoors;f.current.feelsLikeShade=f.comfort.shade;return f;
};
const html=await fs.readFile('public/weather-fusion/index.html','utf8');
const app=await fs.readFile('public/weather-fusion/app.js','utf8');
const server=(await import('node:http')).createServer(async(req,res)=>{
 const path=new URL(req.url,'http://x').pathname;
 if(path==='/api/weather-fusion/forecast'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(fixture()));}
 if(path==='/api/weather-fusion/bulletins'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({mode:'official',signature:'fixture',summaries:[]}));}
 if(path==='/weather-fusion/'||path==='/weather-fusion/index.html'){res.setHeader('content-type','text/html');return res.end(html);}
 if(path.startsWith('/weather-fusion/')){try{const b=await fs.readFile('public'+path);res.setHeader('content-type',path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'application/octet-stream');return res.end(b);}catch{}}
 res.statusCode=404;res.end('not found');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const results=[];
try{
 for(const width of [320,360,390,514,768,1365]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
  await page.addInitScript(({location,epoch})=>{localStorage.setItem('weather-fusion-place',JSON.stringify(location));Date.now=()=>epoch;},{location,epoch});
  await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('.sun-shade-comparison figure'));
  assert.equal((await page.locator('.brand small').innerText()).trim(),'Because Apple, Google and Samsung weather suck');
  assert.equal((await page.locator('#skin-kicker').innerText()).trim(),'How it actually feels right now');
  assert.equal(await page.locator('#daily .forecast-confidence').count(),7);
  assert.ok((await page.locator('#daily .forecast-confidence').allTextContents()).every(t=>t.includes('Forecast confidence')));
  const layout=await page.evaluate(()=>{
   const note=document.querySelector('#today-uncertainty'),graphic=document.querySelector('#today-forecast'),b=document.querySelector('#nws-bulletins'),h=document.querySelector('.hourly-panel'),title=document.querySelector('#gross-title'),gross=document.querySelector('#dewpoint-gross-meter');
   return {noteAlign:getComputedStyle(note).textAlign,noteWeight:Number(getComputedStyle(note).fontWeight),noteFont:parseFloat(getComputedStyle(note).fontSize),graphicFont:parseFloat(getComputedStyle(graphic.querySelector('.day-name')).fontSize),bulletinsBelow:document.querySelector('.today-panel').nextElementSibling===b,hourlyAfter:b.nextElementSibling===h,grossTitleSize:parseFloat(getComputedStyle(title).fontSize),grossTitleWeight:Number(getComputedStyle(title).fontWeight),grossHeight:gross.getBoundingClientRect().height,noOverflow:document.documentElement.scrollWidth<=innerWidth+1};
  });
  assert.equal(layout.noteAlign,'center');assert.ok(layout.noteWeight>=700);assert.ok(layout.noteFont<layout.graphicFont);assert.ok(layout.bulletinsBelow&&layout.hourlyAfter);assert.ok(layout.grossTitleSize>=16&&layout.grossTitleWeight>=700);assert.ok(layout.grossHeight<910,'Gross Meter should be compact');assert.ok(layout.noOverflow,'Document must fit the viewport');
  assert.equal(await page.locator('.today-uncertainty-label').innerText(),"Dan's take");
  const knightdaleFixture=fixture(),knightdaleCurrent=currentSample(knightdaleFixture,epoch),knightdalePeak=comfortWindow(knightdaleFixture,epoch+1);
  assert.equal(await page.locator('.sun-shade-comparison figure').count(),3);
  const exposureText=await page.locator('.sun-shade-comparison').innerText();
  assert.ok(exposureText.includes(Math.round(knightdaleCurrent.feels)+'°'),'Current exposure tile must use the same feels-like reading as the hero');
  assert.ok(!/Unavailable|null°/.test(exposureText),'Cloudy weather must keep a numeric outdoor estimate');
  assert.equal(await page.locator('.sun-shade-comparison > figure[data-weather="cloudy"]').count(),2);
  const cloudyCard=await page.locator('.sun-person').innerText();
  assert.match(cloudyCard,/Cloudy/);assert.match(cloudyCard,/Warm outdoors/);
  assert.equal(await page.locator('.sun-person .sky-sun').count(),0,'Cloudy exposure must not draw a direct-sun icon');
  assert.ok(!(await page.locator('#skin-exposure').innerText()).includes('~'));assert.ok(!(await page.locator('#skin-explanation').innerText()).includes('warmer than in shade'));
  const firstHourly=page.locator('#hourly .hour').first();
  assert.equal((await firstHourly.locator('> span').first().innerText()).trim(),'Now');
  assert.equal((await firstHourly.locator('> strong').innerText()).trim(),Math.round(knightdaleCurrent.temperature)+'°');
  assert.equal((await firstHourly.locator('.hour-feels b').innerText()).trim(),Math.round(knightdaleCurrent.feels)+'°');
  if(knightdalePeak){assert.equal((await page.locator('#skin-values .comfort-later strong').innerText()).trim(),Math.round(Math.max(knightdaleCurrent.feels,knightdalePeak.chosen.value))+'°');}
  assert.match(await page.locator('#alerts').innerText(),/AI plain-language summary/);assert.match(await page.locator('#alerts').innerText(),/Move to higher ground now/);assert.equal(await page.locator('#alerts img').count(),0);
  assert.equal(await page.locator('#alerts .bulletin-warning').count(),1);assert.equal(await page.locator('#alerts .bulletin-watch').count(),1);assert.equal(await page.locator('#alerts .bulletin-discussion').count(),1);
  for(const n of [24,48,168,240]){await page.locator(`[data-gross-hours="${n}"]`).click();assert.ok(await page.locator('.gross-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.ok(await page.locator('.gross-chart').evaluate(el=>el.getBoundingClientRect().height<=230));await page.locator('#gross-scrubber').fill('12');assert.match(await page.locator('.gross-selected-time').innerText(),/forecast/);}
  await page.locator('[data-metric="pressure"]').click();assert.match(await page.locator('#chart-value').innerText(),/mb/);assert.ok(!(await page.locator('#chart-value').innerText()).includes('inHg'));await page.keyboard.press('Escape');
  assert.match(await page.locator('.metric-pressure .metric-value').innerText(),/1013.*mb/s);assert.match(await page.locator('.metric-pressure .metric-note').innerText(),/Dropping/);
  await page.locator('#daily [data-day="1"]').click();assert.match(await page.locator('#day-dialog .day-graph').innerText(),/Gross · dew point/);assert.equal(await page.locator('[data-readout="dewpoint"] strong').count(),1);await page.keyboard.press('Escape');
  if(width===390||width===1365){await page.screenshot({path:`${dir}/weather-personal-${width}.png`,fullPage:true});await page.locator('#skin-exposure').screenshot({path:`${dir}/sun-shade-${width}.png`});}
  results.push({width,...layout});await context.close();
 }
 await fs.writeFile(dir+'/report.json',JSON.stringify({success:true,fixture:true,checks:results},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
console.log('WEATHER_PERSONAL_BROWSER_PASSED',results.map(r=>r.width).join(','));
