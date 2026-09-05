/** Actual HTTP + browser integration checks, not a screenshot-only mock. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.WEATHER_BASE_URL || 'http://127.0.0.1:3123';
const live=process.env.WEATHER_LIVE_CHECK==='true';
const dir=process.env.WEATHER_REPORT_DIR || '/tmp/weather-browser-results';
await fs.mkdir(dir,{recursive:true});
async function json(path){
 const res=await fetch(base+path,{signal:AbortSignal.timeout(75000)});
 assert.ok(res.ok,`${path}: HTTP ${res.status}`);return res.json();
}
const report={checkedAt:new Date().toISOString(),base,locations:[],maps:[],browserErrors:[],liveAI:live};
for(const location of ['knightdale','greenville']){
 const data=await json('/api/weather-fusion/forecast?location='+location);
 assert.equal(data.version,'weather-fusion-v2-direct');
 assert.equal(data.directModelStatus,'ready',`${location}: ${JSON.stringify(data.feeds)}`);
 assert.equal(data.modelContributions.length,3);
 assert.equal(data.days.length,7);assert.ok(data.days.slice(1).every(d=>Number.isFinite(d.high)&&Number.isFinite(d.low)));
 assert.ok(Number.isFinite(data.current.apparent));assert.ok(Number.isFinite(data.precipitation.value));
 assert.equal(data.discussion.office,location==='knightdale'?'RAH':'MHX');
 assert.ok(data.days[1].highBlend.sources.some(s=>s.id==='nbm'));
 assert.ok(data.days[0].qpfBlend.sources.some(s=>s.id==='hrrr'));
 assert.ok(data.days[0].qpfBlend.sources.some(s=>s.id==='ecmwf'));
 let ai=null;
 if(live){
  assert.equal(data.aiConfigured,true,'Live AI must be configured');
  ai=await json('/api/weather-fusion/briefing?location='+location);
  assert.equal(ai.mode,'ai',JSON.stringify(ai));
  for(const id of ['nws','afd','hrrr','ecmwf','nbm'])assert.ok(ai.sources.includes(id),'AI did not cite '+id);
 }
 report.locations.push({location,version:data.version,feelsLike:data.current.apparent,next24HourPrecipitationIn:data.precipitation.value,models:data.modelContributions,office:data.discussion.office,ai:ai?{mode:ai.mode,sources:ai.sources,headline:ai.headline}:null});
}
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:1365,height:1000}});
 const page=await context.newPage();
 page.on('pageerror',error=>report.browserErrors.push(error.message));
 await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded',timeout:75000});
 await page.waitForFunction(()=>document.querySelectorAll('#metrics .metric-value').length===8,null,{timeout:75000});
 assert.equal(await page.locator('iframe').count(),0);
 assert.ok(!(await page.locator('#metrics').innerText()).includes('—°'),'Feels-like metric is still missing');
 await page.locator('#map-panel').scrollIntoViewIfNeeded();
 for(const layer of ['hrrr','ecmwf','nbm','temperature','wind','clouds']){
  await page.locator(`[data-layer="${layer}"]`).click();
  await page.waitForFunction(()=>{
    const selected=document.querySelector('.map-tabs .selected')?.dataset.layer;
    const imgs=[...document.querySelectorAll('.leaflet-image-layer')];
    return selected!=='radar'&&imgs.some(i=>i.complete&&i.naturalWidth>0)&&!document.querySelector('#radar-stamp').textContent.includes('loading')&&document.querySelector('#map-error').hidden;
  },null,{timeout:60000});
  const src=await page.locator('.leaflet-image-layer').last().getAttribute('src');
  assert.ok(src.includes('weather-fusion-data/maps/'));
  report.maps.push({layer,loaded:true,src,caption:await page.locator('#map-caption').innerText()});
 }
 // Exercise frame selection, playback, and switch-back isolation.
 await page.locator('[data-layer="hrrr"]').click();
 await page.waitForFunction(()=>!document.querySelector('#radar-time').disabled,null,{timeout:30000});
 await page.locator('#radar-time').evaluate(el=>{el.value='2';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForTimeout(1500);
 await page.locator('#radar-play').click();await page.waitForTimeout(1900);await page.locator('#radar-play').click();
 await page.locator('[data-layer="radar"]').click();
 await page.waitForFunction(()=>!document.querySelector('#radar-time').disabled,null,{timeout:45000});
 const radar=await json('/api/weather-fusion/radar');assert.ok(radar.frames.length>0);
 report.maps.push({layer:'radar',advertisedFrames:radar.frames.length,status:radar.status});
 await page.locator('[data-day="1"]').click();assert.ok(await page.locator('#day-dialog').isVisible());
 assert.ok((await page.locator('#day-content').innerText()).includes('Weather Fusion'));
 await page.locator('#close-day').click();
 await page.locator('[data-place="greenville"]').click();
 await page.waitForFunction(()=>document.querySelector('#city-name').textContent.includes('Greenville')&&document.querySelectorAll('#metrics .metric-value').length===8,null,{timeout:75000});
 await page.locator('[data-layer="temperature"]').click();
 await page.waitForFunction(()=>document.querySelector('#map-error').hidden,null,{timeout:45000});
 await page.screenshot({path:dir+'/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelectorAll('#metrics .metric-value').length===8,null,{timeout:75000});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'Mobile document overflows horizontally');
 await page.locator('[data-layer="ecmwf"]').click();
 await page.waitForFunction(()=>document.querySelector('#map-error').hidden && document.querySelectorAll('.leaflet-image-layer').length>0,null,{timeout:60000});
 await page.screenshot({path:dir+'/mobile.png',fullPage:true});
 assert.deepEqual(report.browserErrors,[]);
 report.success=true;
}finally{await browser.close();await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));
