/** Live HTTP and browser checks. Match deployed files before testing real feeds. */
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {THERMAL_VERSION} from '../public/weather-fusion/thermal-research.js';
import {hrrrTileManifest,HRRR_MAP_METADATA} from '../src/weatherFusionHrrrMap.js';
const base=process.env.WEATHER_BASE_URL||'http://127.0.0.1:3123',live=process.env.WEATHER_LIVE_CHECK==='true';
const dir=process.env.WEATHER_REPORT_DIR||'/tmp/weather-browser-results';await fs.mkdir(dir,{recursive:true});
const report={checkedAt:new Date().toISOString(),base,live,locations:[],maps:[],browserErrors:[],viewports:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function json(path){const r=await fetch(base+path,{signal:AbortSignal.timeout(75000)});assert.ok(r.ok,`${path} HTTP ${r.status}`);return r.json();}
const hash=b=>createHash('sha256').update(b).digest('hex');
let browser;
try{
 if(live){
  const paths=(await fs.readdir('public/weather-fusion')).filter(p=>/\.(?:js|css|html|txt)$/.test(p));
  const expected=Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await fs.readFile('public/weather-fusion/'+p))])));
  let matched=false;
  for(let i=0;i<40&&!matched;i++){
   try{const d=await json('/api/weather-fusion/forecast?location=knightdale');if(d.thermalVersion===THERMAL_VERSION){const checks=await Promise.all(paths.map(async p=>{const r=await fetch(base+'/weather-fusion/'+p+'?verify='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)});return r.ok&&hash(await r.text())===expected[p];}));matched=checks.every(Boolean);}}catch{}
   if(!matched)await delay(15000);
  }
  assert.ok(matched,'Live server must serve the exact reviewed frontend and UTCI backend');report.exactAssetCount=paths.length;
 }
 for(const location of ['knightdale','greenville']){
  const d=await json('/api/weather-fusion/forecast?location='+location);
  assert.equal(d.thermalVersion,THERMAL_VERSION);assert.equal(d.days.length,7);
  assert.equal(d.current.apparent,d.comfort.outdoors);assert.match(d.comfort.method,/UTCI/);
  assert.ok(Number.isFinite(d.comfort.outdoors)&&Number.isFinite(d.current.temperature),'Current temperature inputs must be present');
  for(const h of d.hours){const p=d.metricForecasts.series.feels.find(p=>Date.parse(p.time)===Date.parse(h.time));assert.ok(p);assert.equal(h.feelsLike,p.value);assert.equal(p.inputs.temperature,h.temperature);}
  assert.equal(d.metricForecasts.series.feels.length,new Set(d.metricForecasts.series.feels.map(p=>Date.parse(p.time))).size);
  assert.ok(d.metricForecasts.series.feels.filter(p=>Number.isFinite(p.value)).length>=168,'Seven-day feels-like needs real forecast coverage');
  assert.deepEqual(d.blendPolicy.sameDay,{nws:.4,hrrr:.4,ecmwf:.2});
  assert.ok(d.days.slice(1).every(p=>Number.isFinite(p.high)&&Number.isFinite(p.low)));
  assert.equal(d.feeds.find(f=>f.id==='alerts')?.status,'ready','Official alert status must be readable');
  let ai=null,bulletins=null;
  if(live&&d.aiConfigured){ai=await json('/api/weather-fusion/briefing?location='+location);assert.equal(ai.mode,'ai','Local outlook must use configured AI');bulletins=await json('/api/weather-fusion/bulletins?location='+location);if(d.alerts.length||d.specialDiscussions?.length)assert.equal(bulletins.mode,'ai');}
  report.locations.push({location,temperature:d.current.temperature,feelsLike:d.comfort.outdoors,shadeReference:d.comfort.shade,sky:d.current.condition,sourceTime:d.current.time,forecastHours:d.hours.length,aiMode:ai?.mode||null,bulletinMode:bulletins?.mode||null,feeds:d.feeds.map(f=>({id:f.id,status:f.status})),models:d.modelContributions});
 }
 const catalog=await json('/api/weather-fusion/models');assert.ok(catalog.layers.hrrr?.frames?.length);
 const hrrr=catalog.layers.hrrr;
 if(live){
  const r=await fetch(HRRR_MAP_METADATA,{cache:'no-store',signal:AbortSignal.timeout(15000)});assert.ok(r.ok);const provider=hrrrTileManifest(await r.json());
  assert.ok(Date.parse(hrrr.runAt)>=Date.parse(provider.runAt)-3600000,'HRRR must not remain several runs behind the provider');
  report.hrrr={servedInitialization:hrrr.runAt,providerInitialization:provider.runAt,provider:hrrr.provider,frameKind:hrrr.frames[0].kind,checkedAt:hrrr.checkedAt,product:hrrr.product};
 }
 browser=await chromium.launch({headless:true});
 for(const width of [1365,390]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
  page.on('pageerror',e=>report.browserErrors.push(e.message));
  await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded',timeout:75000});
  await page.waitForSelector('#hourly .hour-current',{timeout:75000});await page.waitForSelector('#dewpoint-gross-meter .gross-chart');
  const current=await page.locator('#hourly .hour-current>strong').innerText(),feels=await page.locator('#hourly .hour-current .hour-feels b').innerText();
  assert.equal((await page.locator('#temperature').innerText()).trim(),current);assert.ok((await page.locator('#hero-feels').innerText()).includes(feels));assert.equal(await page.locator('.sun-person figcaption strong').innerText(),feels);
  assert.notEqual(await page.locator('#hero-scene svg').getAttribute('data-weather-kind'),null);assert.equal(await page.locator('.sun-shade-comparison figure').count(),2);
  const peak=await page.locator('.comfort-later strong').innerText(),label=await page.locator('.comfort-later>span').innerText();
  if(label.includes('Warmest'))assert.ok(parseFloat(peak)>=parseFloat(feels));else if(label.includes('Coolest'))assert.ok(parseFloat(peak)<=parseFloat(feels));
  const low=await page.locator('#daily .day-low').first().evaluate(e=>{const a=e.getBoundingClientRect(),b=e.querySelector('.daily-feels').getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2);});assert.ok(low<1,'Low and night feels-like must share a center');
  const future=page.locator('#hourly .forecast-hour').nth(1),expected=await future.locator('.hour-feels b').innerText();await future.click();assert.equal(await page.locator('.sun-person figcaption strong').innerText(),expected);assert.match(await page.locator('.comfort-preview-heading').innerText(),/forecast/);await page.locator('[data-comfort-reset]').click();assert.equal(await page.locator('.sun-person figcaption strong').innerText(),feels);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Viewport must not overflow');
  for(const hours of [24,48,168,240]){await page.locator(`[data-gross-hours="${hours}"]`).click();assert.ok(await page.locator('.gross-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth+1));}
  await page.locator('#daily [data-day="1"]').click();assert.equal(await page.locator('#day-dialog').isVisible(),true);assert.equal(await page.locator('#day-dialog .day-feels').count(),1);assert.match(await page.locator('#day-dialog .day-gross-verdict').innerText(),/will|should/);await page.keyboard.press('Escape');
  for(const metric of ['feels','precipitation','wind','humidity','pop','visibility','pressure','solar']){await page.locator(`[data-metric="${metric}"]`).click();assert.equal(await page.locator('#metric-dialog').isVisible(),true);if(metric==='pressure'&&!(await page.locator('#chart-empty').isVisible()))assert.match(await page.locator('#chart-value').innerText(),/mb/);await page.keyboard.press('Escape');}
  await page.locator('#map-panel').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-weather-base-pane img')].some(i=>i.complete&&i.naturalWidth>0),null,{timeout:60000});
  await page.locator('[data-layer="radar"]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-weather-radar-pane img')].some(i=>i.complete&&i.naturalWidth>0)&&document.querySelector('#map-error').hidden&&!document.querySelector('#radar-stamp').textContent.includes('loading'),null,{timeout:60000});
  const radarProof=await page.evaluate(()=>({radarZ:Number(getComputedStyle(document.querySelector('.leaflet-weather-radar-pane')).zIndex),baseZ:Number(getComputedStyle(document.querySelector('.leaflet-weather-base-pane')).zIndex),urls:[...document.querySelectorAll('.leaflet-weather-radar-pane img')].filter(i=>i.complete&&i.naturalWidth).map(i=>i.src)}));
  assert.ok(radarProof.radarZ>radarProof.baseZ);assert.ok(radarProof.urls.length>0);
  await page.locator('#map-panel').screenshot({path:dir+`/live-radar-${width}.png`});report.maps.push({width,layer:'radar',loadedTiles:radarProof.urls.length,aboveBasemap:true,stamp:await page.locator('#radar-stamp').innerText()});
  for(const layer of ['hrrr','ecmwf','nbm','temperature','wind','clouds']){
   assert.ok(catalog.layers[layer]?.frames?.length,layer+' needs actual current frames');await page.locator(`[data-layer="${layer}"]`).click();
   await page.waitForFunction(()=>document.querySelector('[data-weather-model-frame="visible"]')&&document.querySelector('#map-error').hidden&&!document.querySelector('#radar-stamp').textContent.includes('loading'),null,{timeout:60000});
   const element=page.locator('[data-weather-model-frame="visible"]');assert.equal(await element.count(),1);
   const src=await element.getAttribute('data-frame-url');assert.ok(src?.includes('weather-fusion-data/maps/')||src?.includes('mesonet.agron.iastate.edu/cache/tile.py'));
   if(layer==='hrrr'||layer==='nbm'){
    await page.locator('#radar-play').click();await page.waitForTimeout(4200);if((await page.locator('#radar-play').innerText()).includes('Ⅱ'))await page.locator('#radar-play').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-weather-model-frame="visible"]').length===1&&!document.querySelector('#radar-stamp').textContent.includes('loading'));
    for(const button of ['.leaflet-control-zoom-out','.leaflet-control-zoom-out','.leaflet-control-zoom-in','.leaflet-control-zoom-in']){await page.locator(button).click();await page.waitForTimeout(400);}
    assert.equal(await page.locator('#map-error').isVisible(),false);assert.equal(await element.count(),1);
   }
   report.maps.push({width,layer,url:src,stamp:await page.locator('#radar-stamp').innerText(),caption:await page.locator('#map-caption').innerText()});
  }
  await page.locator('#map-panel').screenshot({path:dir+`/live-map-${width}.png`});await page.locator('.hero').screenshot({path:dir+`/live-hero-${width}.png`});
  await page.locator('[data-place="greenville"]').click();await page.waitForFunction(()=>document.querySelector('#city-name').textContent.includes('Greenville')&&document.querySelector('#hourly .hour-current'));
  await page.waitForFunction(()=>document.querySelector('#hero-feels').textContent.includes(document.querySelector('#hourly .hour-current .hour-feels b').textContent));
  report.viewports.push({width,current,feels,peak,peakLabel:label,lowCenterError:low,locationSwitch:true,dialogs:true,hourlyPreview:true});await context.close();
 }
 assert.deepEqual(report.browserErrors,[]);report.success=true;
}catch(error){report.error=String(error.stack||error);throw error;}
finally{await browser?.close();await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
