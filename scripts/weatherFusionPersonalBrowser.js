import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
import {thermalComfort,shadeFeelsLike} from '../public/weather-fusion/weather-math.js';
import {feelsAt,dailyFeels} from '../public/weather-fusion/hourly-feels.js';
import {currentSample,hourlyDisplaySamples} from '../public/weather-fusion/weather-display.js';
import {comfortWindow} from '../public/weather-fusion/comfort-outlook.js';
/** Deterministic integration coverage. Fixture weather is never deployed or published. */
import express from 'express';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {bulletinFacts} from '../public/weather-fusion/bulletin-facts.js';
const epoch=Date.parse('2026-09-06T13:00:00Z'),H=3600000;
const report={checks:[],browserErrors:[],fixture:true};
const dir=process.env.WEATHER_REPORT_DIR||'/tmp/weather-personal-results';await fs.mkdir(dir,{recursive:true});
function fixture(place='knightdale'){
 const green=place==='greenville',name=green?'Greenville, NC':'Knightdale / Raleigh';
 const series=Object.fromEntries(['temperature','feels','dewpoint','wind','humidity','pop','visibility','pressure','precipitation'].map(key=>[key,Array.from({length:240},(_,i)=>({time:new Date(epoch+i*H).toISOString(),value:key==='pressure'?29.91+i*.001:key==='precipitation'?.01:key==='dewpoint'?72-i%9:key==='wind'?8:key==='humidity'?70:key==='pop'?30:key==='visibility'?10:key==='feels'?80+i%8:75+i%10,inputs:{temperature:75+i%10,dewpoint:72-i%9,wind:8}}))]));
 const days=Array.from({length:7},(_,i)=>({date:`2026-09-${String(6+i).padStart(2,'0')}`,label:i?'Mon':'Today',high:84+i,low:65+i,condition:'Cloudy',nightCondition:'Partly cloudy',detail:'Warm with rain possible.',nightDetail:'Some clouds overnight.',pop:30,popDay:30,popNight:20,qpf:.1,qpfWindow:{start:new Date(epoch+i*24*H-2*H).toISOString(),end:new Date(epoch+(i+1)*24*H-2*H).toISOString()}}));
 const result={signature:place+'-personal-fixture',assembledAt:new Date(epoch).toISOString(),location:{id:place,name,latitude:green?35.6127:35.787,longitude:green?-77.3664:-78.4806,timeZone:'America/New_York',office:green?'MHX':'RAH'},current:{temperature:green?71:75,condition:'Cloudy',time:new Date(epoch).toISOString(),type:'observation',station:'KRDU',stationName:'Fixture station',dewpoint:72,wind:8,humidity:70,pressure:29.91,pressurePa:101300,pressureTrend:{status:'ready',direction:green?'rising':'falling',deltaMb:green?.8:-1.2,hours:3},visibility:10},comfort:{shade:80,sun:84,wetBulb:70,humidity:70,method:'Steadman apparent temperature',note:'Environmental estimate, not skin temperature.'},hours:series.temperature.slice(0,48).map(p=>({...p,temperature:p.value,condition:'Cloudy',isDay:true,pop:30,wind:'8 mph',windDirection:'SW'})),days,precipitation:{value:.1},feeds:['nws','afd','hrrr','ecmwf','nbm','alerts'].map(id=>({id,label:id.toUpperCase(),status:'ready',contributes:true,issuedAt:new Date(epoch-H).toISOString(),url:'https://api.weather.gov/'})),alerts:[{id:'https://api.weather.gov/alerts/fixture-'+place,event:'Flash Flood Warning',status:'Actual',sent:new Date(epoch-H).toISOString(),expires:new Date(epoch+12*H).toISOString(),areaDesc:name,severity:'Severe',description:'Heavy rain can cause flooding. <img src=x onerror=alert(1)>',instruction:'Move to higher ground now. Do not drive through flooded roads.'},{id:'https://api.weather.gov/alerts/watch-'+place,event:'Flood Watch',status:'Actual',sent:new Date(epoch-H).toISOString(),expires:new Date(epoch+12*H).toISOString(),areaDesc:name,description:'Flooding is possible.'}],discussion:{id:'afd-'+place,office:green?'MHX':'RAH',issuanceTime:new Date(epoch-H).toISOString(),text:'Rain may be widespread in the region this afternoon.',url:'https://api.weather.gov/products/fixture-'+place},modelContributions:[],aiConfigured:true,methodology:'Fixture data for automated layout checks only.',metricForecasts:{series,notes:{pressure:'Forecast mean sea-level pressure, separate from station observations.'},solar:days.map(d=>({date:d.date,sunrise:d.date+'T10:30:00Z',sunset:d.date+'T23:30:00Z'}))},solar:{sunrise:'2026-09-06T10:30:00Z',sunset:'2026-09-06T23:30:00Z'}};
 result.specialDiscussions=[{id:'https://www.spc.noaa.gov/products/md/md2000.html',url:'https://www.spc.noaa.gov/products/md/md2000.html',event:'SPC special weather discussion',productType:'SPC-MD',applicable:true,sent:new Date(epoch-H).toISOString(),expires:new Date(epoch+12*H).toISOString(),areaDesc:'Special discussion covering this location',description:'Heavy rain may develop.'}];
 result.feeds.push({id:'special-discussions',status:'ready'});
 result.comfort=thermalComfort(result.current,result.location,epoch);
 rebuildHourlyFeels(result,{now:epoch,temperatureAt:()=>({value:null}),humidityAt:()=>null});
 return result;
}
const app=express();app.use('/weather-fusion',express.static('public/weather-fusion'));
app.get('/api/weather-fusion/:kind',(req,res)=>{
 const f=fixture(req.query.location||'knightdale');
 if(req.params.kind==='forecast')return res.json(f);
 if(req.params.kind==='briefing')return res.json({signature:f.signature,mode:'ai',generatedAt:f.assembledAt,headline:'Local outlook',summary:'Warm with rain possible.',uncertainty:`Rain timing could change around ${f.location.name}.`,nearTerm:'Clouds tonight.',extended:'A warmer week.',sources:['nws','afd']});
 if(req.params.kind==='bulletins')return res.json({signature:f.signature,mode:'ai',summaries:bulletinFacts(f,epoch).map(i=>({id:i.id,sourceKey:i.sourceKey,summary:'Rain could affect travel. Follow the official instructions below.'}))});
 if(req.params.kind==='radar')return res.json({frames:[],message:'Radar intentionally not loaded by this deterministic layout test.'});
 if(req.params.kind==='models')return res.json({layers:{}});
 res.json({results:[]});
});
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try{
 for(const width of [320,360,390,514,768,1365]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  await page.addInitScript(time=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}};},epoch);
  await page.route('https://unpkg.com/**',route=>route.fulfill({contentType:route.request().url().includes('.css')?'text/css':'application/javascript',body:''}));
  page.on('pageerror',e=>report.browserErrors.push(e.message));
  await page.goto(base+'/weather-fusion/',{waitUntil:'networkidle'});
  await page.waitForSelector('#gross-title');
  await page.waitForFunction(()=>document.querySelector('#today-uncertainty-text')?.textContent.includes('Knightdale'));
  assert.equal((await page.locator('.current-temp-label').innerText()).trim(),'Current temperature');
  assert.equal((await page.locator('#temperature').innerText()).trim(),'75°');
  assert.equal(await page.locator('#condition').isVisible(),false);assert.equal(await page.locator('#high-low').isVisible(),false);
  assert.equal((await page.locator('.brand small').innerText()).trim(),'Because Apple, Google and Samsung weather suck');
  const layout=await page.evaluate(()=>{
   const note=document.querySelector('#today-uncertainty'),graphic=document.querySelector('#today-forecast'),b=document.querySelector('#nws-bulletins'),h=document.querySelector('.hourly-panel'),title=document.querySelector('#gross-title'),gross=document.querySelector('#dewpoint-gross-meter');
   return {noteAlign:getComputedStyle(note).textAlign,noteWeight:Number(getComputedStyle(note).fontWeight),noteFont:parseFloat(getComputedStyle(note).fontSize),graphicFont:parseFloat(getComputedStyle(graphic.querySelector('.day-name')).fontSize),bulletinsBelow:document.querySelector('.today-panel').nextElementSibling===b,hourlyAfter:b.nextElementSibling===h,grossTitleSize:parseFloat(getComputedStyle(title).fontSize),grossTitleWeight:Number(getComputedStyle(title).fontWeight),grossHeight:gross.getBoundingClientRect().height,noOverflow:document.documentElement.scrollWidth<=innerWidth+1};
  });
  assert.equal(layout.noteAlign,'center');assert.ok(layout.noteWeight>=700);assert.ok(layout.noteFont<layout.graphicFont);assert.ok(layout.bulletinsBelow&&layout.hourlyAfter);assert.ok(layout.grossTitleSize>=16&&layout.grossTitleWeight>=700);assert.ok(layout.grossHeight<910,'Gross Meter should be compact');assert.ok(layout.noOverflow,'Document must fit the viewport');
  assert.equal(await page.locator('.today-uncertainty-label').innerText(),"What could change - Dan's take");
  const knightdaleFixture=fixture(),knightdaleCurrent=currentSample(knightdaleFixture,epoch),knightdalePeak=comfortWindow(knightdaleFixture,epoch+1);
  assert.equal(await page.locator('.sun-shade-comparison figure').count(),2);
  const exposureText=await page.locator('.sun-shade-comparison').innerText();
  assert.ok(exposureText.includes(Math.round(knightdaleCurrent.feels)+'°'),'Current exposure tile must use the same feels-like reading as the hero');
  assert.ok(!/Unavailable|null°/.test(exposureText),'Cloudy weather must keep a numeric outdoor estimate');
  assert.equal(await page.locator('.sun-shade-comparison [data-weather="cloudy"]').count(),2);
  assert.match(await page.locator('.sun-person').innerText(),/Under clouds/);
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
  await page.locator('#daily [data-day="1"]').click();assert.match(await page.locator('#day-dialog .day-gross').innerText(),/Gross Meter/);assert.match(await page.locator('#day-dialog .day-gross').innerText(),/72°/);await page.keyboard.press('Escape');
  if(width===390||width===1365){await page.screenshot({path:`${dir}/weather-personal-${width}.png`,fullPage:true});await page.locator('#skin-exposure').screenshot({path:`${dir}/sun-shade-${width}.png`});}
  await page.locator('[data-place="greenville"]').click();await page.waitForFunction(()=>document.querySelector('#today-uncertainty-text')?.textContent.includes('Greenville'));
  assert.equal((await page.locator('#temperature').innerText()).trim(),'71°');assert.match(await page.locator('.metric-pressure .metric-note').innerText(),/Rising/);assert.ok(!(await page.locator('#alerts').innerText()).includes('Knightdale'));
  const activeFixture=fixture('greenville'),activeCurrent=currentSample(activeFixture,epoch),activeSamples=hourlyDisplaySamples(activeFixture,epoch);
  assert.match(await page.locator('#hero-feels').innerText(),new RegExp('Feels like '+Math.round(activeCurrent.feels)+'°'));
  const hourlyLabels=await page.locator('#hourly .hour-feels b').allTextContents();
  assert.deepEqual(hourlyLabels,activeSamples.map(sample=>Math.round(sample.feels)+'°'));
  const hourlyAir=await page.locator('#hourly .hour > strong').allTextContents();
  assert.deepEqual(hourlyAir,activeSamples.map(sample=>Math.round(sample.temperature)+'°'));
  assert.equal((await page.locator('#hourly .hour').first().locator('> span').first().innerText()).trim(),'Now');
  assert.equal(await page.locator('#daily .daily-feels').count(),14);
  assert.ok(!(await page.locator('#alerts').innerText()).includes('forecast discussion'));
  assert.equal(await page.locator('.person-eyes').count(),2);
  assert.equal(await page.locator('.friendly-wave').count(),2);
  assert.ok(await page.locator('.exposure-tree').evaluate(el=>el.getBBox().height>el.closest('svg').querySelector('.exposure-person-art').getBBox().height*1.5));
  await page.locator('#daily [data-day="2"]').click();
  assert.equal(await page.locator('#day-dialog .day-feels').count(),1);
  assert.match(await page.locator('#day-dialog .day-gross-verdict').innerText(),/will|should/);
  assert.ok(!(await page.locator('#day-dialog .day-gross-verdict').innerText()).includes('gettin'));
  await page.keyboard.press('Escape');
  await page.locator('#temperature').click();
  await page.locator('#chart-scrubber').fill('6');
  assert.match(await page.locator('#chart-companion').innerText(),new RegExp(Math.round(feelsAt(activeFixture,activeFixture.metricForecasts.series.temperature[6].time))+'°'));
  await page.keyboard.press('Escape');
  report.checks.push({width,...layout,pairedHourly:true,futureTense:true,wavingFaces:true,tallTree:true,fullRanges:[24,48,168,240],sunShade:true,pressureMb:true,locationSwitch:true,dayGross:true,nwsAI:true});await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 await page.addInitScript(time=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}};},Date.parse('2026-09-07T02:00:00Z'));
 await page.route('https://unpkg.com/**',route=>route.fulfill({body:'',contentType:'application/javascript'}));
 page.on('pageerror',e=>report.browserErrors.push(e.message));await page.goto(base+'/weather-fusion/',{waitUntil:'networkidle'});
 assert.equal((await page.locator('#temperature').innerText()).trim(),'75°');assert.match(await page.locator('.sun-person').innerText(),/Under clouds/);assert.equal(await page.locator('.sun-person .sky-sun').count(),0);assert.ok((await page.locator('.sun-person').innerText()).includes(Math.round(fixture().comfort.shade)+'°'));report.nightCurrentTemperature=true;
 assert.deepEqual(report.browserErrors,[]);report.success=true;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));