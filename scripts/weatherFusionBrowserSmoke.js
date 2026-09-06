/** Actual HTTP + browser integration checks, not a screenshot-only mock. */
import {createHash} from 'node:crypto';
import {REPAIR_VERSION} from '../src/weatherFusionPolicy.js';
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
// Do not mistake a previous deployment with the same old schema for this repair.
if(live){
 const paths=['personal-details.js','personal-details.css','bulletin-facts.js','bulletins.js','current-temperature.js','comfort-outlook.js','index.html','forecast-layout.css','app.js','experience.js','hero-mode.js','comfort-outlook.js','frame-player.js','dewpoint-meter.js','dewpoint-meter.css'];
 const wanted=Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await fs.readFile('public/weather-fusion/'+p)).digest('hex')])));
 let deployed=false;
 for(let attempt=0;attempt<35&&!deployed;attempt++){
   try{
     const d=await json('/api/weather-fusion/forecast?location=knightdale');
     if(d.repairVersion===REPAIR_VERSION){
       const actual=await Promise.all(paths.map(async p=>{const res=await fetch(base+'/weather-fusion/'+p+'?verify='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!res.ok)return false;return createHash('sha256').update(await res.text()).digest('hex')===wanted[p];}));
       deployed=actual.every(Boolean);
     }
   }catch{}
   if(!deployed)await new Promise(r=>setTimeout(r,15000));
 }
 assert.ok(deployed,'Production must serve the exact reviewed frontend files and repaired backend before testing');
}
// Check the actual rendered layout at both browser sizes, not just source strings.
async function checkForecastDetails(page){
 const details=await page.evaluate(()=>{
  const panel=document.querySelector('.today-panel');
  const row=document.querySelector('#today-forecast');
  const note=document.querySelector('#today-uncertainty');
  const text=document.querySelector('#today-uncertainty-text');
  const title=document.querySelector('#gross-title');
  const source=document.querySelector('#briefing-detail>div:last-child p');
  const next=panel.nextElementSibling;
  const hourly=next?.id==='nws-bulletins'?next.nextElementSibling:next;
  return {viewport:innerWidth,text:text.textContent,source:source.textContent.trim(),hidden:note.hidden,
   belowGraphic:note.getBoundingClientRect().top>=row.getBoundingClientRect().bottom,
   aboveHourly:note.getBoundingClientRect().bottom<=hourly.getBoundingClientRect().top,
   adjacentHourly:hourly.classList.contains('hourly-panel'),
   noteFont:parseFloat(getComputedStyle(text).fontSize),forecastFont:parseFloat(getComputedStyle(row.querySelector('.day-name')).fontSize),
   noteWeight:Number(getComputedStyle(text).fontWeight),titleWeight:Number(getComputedStyle(title).fontWeight),titleAlign:getComputedStyle(title).textAlign,
   noOverflow:note.scrollWidth<=note.clientWidth+1};
 });
 assert.equal(details.text,details.source,'The same outlook uncertainty must appear below the daily graphic');
 assert.equal(details.hidden,!details.source);
 assert.ok(details.adjacentHourly,'Hourly must follow the Today/Tonight and bulletin panels');
 if(!details.hidden){
  assert.ok(details.belowGraphic&&details.aboveHourly,'Uncertainty must sit between the graphic and hourly forecast');
  assert.ok(details.noteFont<details.forecastFont&&details.noteWeight>=700,'Uncertainty must be smaller and bold');
  assert.ok(details.noOverflow,'Uncertainty must wrap within its card');
 }
 assert.equal(details.titleAlign,'center');assert.ok(details.titleWeight>=700,'Gross Meter heading must be bold');
 assert.equal((await page.locator('.current-temp-label').innerText()).trim(),'Current temperature');
 assert.equal(await page.locator('#high-low').isVisible(),false);
 assert.equal(await page.locator('#condition').isVisible(),false);
 assert.equal(await page.locator('.sun-shade-comparison figure').count(),2);
 assert.ok(!(await page.locator('#skin-exposure').innerText()).includes('~'));
 assert.match(await page.locator('.brand small').innerText(),/Because Apple, Google and Samsung weather suck/);
 assert.equal(await page.locator('.today-uncertainty-label').innerText(),"What could change - Dan's take");
 return details;
}
const report={checkedAt:new Date().toISOString(),base,locations:[],maps:[],browserErrors:[],liveAI:live,skinExposure:null,dewpointGross:null,forecastDetails:[]};
for(const location of ['knightdale','greenville']){
 const data=await json('/api/weather-fusion/forecast?location='+location);
 assert.equal(data.version,'weather-fusion-v2-direct');
 assert.equal(data.repairVersion,REPAIR_VERSION);
 assert.deepEqual(data.blendPolicy.sameDay,{nws:.4,hrrr:.4,ecmwf:.2});
 const dp=data.metricForecasts.series.dewpoint;
 assert.equal(dp.length,new Set(dp.map(p=>Date.parse(p.time))).size,'No duplicate dew-point instants');
 assert.ok(dp.filter(p=>Number.isFinite(p.value)).length>=168,'Saved locations need at least seven days of populated dew-point forecast');
 assert.equal(data.experienceVersion,'weather-nourie-friendly-v1');
 assert.equal(data.directModelStatus,'ready',`${location}: ${JSON.stringify(data.feeds)}`);
 assert.equal(data.modelContributions.length,3);
 assert.equal(data.days.length,7);assert.ok(data.days.slice(1).every(d=>Number.isFinite(d.high)&&Number.isFinite(d.low)));
 assert.ok(Number.isFinite(data.current.apparent));assert.match(data.current.apparentSource,/Steadman apparent temperature/);assert.ok(Number.isFinite(data.precipitation.value));
 assert.equal(data.discussion.office,location==='knightdale'?'RAH':'MHX');
 assert.ok(data.days[1].highBlend.sources.some(s=>s.id==='nbm'));
 assert.ok(data.days[0].qpfBlend.sources.some(s=>s.id==='hrrr'));
 assert.ok(data.days[0].qpfBlend.sources.some(s=>s.id==='ecmwf'));
 let ai=null;
 if(live){
  assert.equal(data.aiConfigured,true,'Live AI must be configured');
  ai=await json('/api/weather-fusion/briefing?location='+location);
  assert.equal(ai.mode,'ai',JSON.stringify(ai));
  const bulletins=await json('/api/weather-fusion/bulletins?location='+location);
  if(data.discussion||data.alerts.length)assert.equal(bulletins.mode,'ai',JSON.stringify(bulletins));
  (report.nwsBulletins??=[]).push({location,mode:bulletins.mode,summaries:bulletins.summaries?.length||0,pressureTrend:data.current.pressureTrend||null});
  for(const id of ['nws','afd','hrrr','ecmwf','nbm'])assert.ok(ai.sources.includes(id),'AI did not cite '+id);
 }
 report.locations.push({location,version:data.version,feelsLike:data.current.apparent,feelsLikeMethod:data.current.apparentSource,next24HourPrecipitationIn:data.precipitation.value,models:data.modelContributions,office:data.discussion.office,ai:ai?{mode:ai.mode,sources:ai.sources,headline:ai.headline}:null});
}
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:1365,height:1000}});
 const page=await context.newPage();
 page.on('pageerror',error=>report.browserErrors.push(error.message));
 await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded',timeout:75000});
 await page.waitForFunction(()=>document.querySelectorAll('#metrics .metric-value').length===8,null,{timeout:75000});
 await page.waitForFunction(()=>{
  const value=document.querySelector('#skin-values')?.textContent||'';
  const science=document.querySelector('#skin-science')?.textContent||'';
  return /°.*(?:in the shade|right now)/.test(value)&&/Steadman apparent temperature/.test(science);
 },null,{timeout:30000});
 await page.waitForFunction(()=>document.querySelector('#dewpoint-gross-meter .gross-chart')&&/DEW POINT · GROSS METER/.test(document.querySelector('#dewpoint-gross-meter')?.innerText||''),null,{timeout:30000});
 assert.equal(await page.locator('iframe').count(),0);
 assert.ok(!(await page.locator('#metrics').innerText()).includes('—°'),'Feels-like metric is still missing');
 assert.match(await page.locator('.brand').innerText(),/WEATHER\s+NOURIE/i);
 const skinValue=await page.locator('#skin-values').innerText();
 const skinScience=await page.locator('#skin-science').textContent();
 const skinWhy=await page.locator('#skin-explanation').innerText();
 assert.ok(!skinValue.includes('Calculating')&&!skinValue.includes('Updating'));
 assert.ok(!skinWhy.includes('Sunshine can make it feel warmer. A breeze can help cool you down.'));
 assert.match(skinWhy,/dew point|wind|breeze|sun|radiation|moisture|air temperature/i);
 assert.match(await page.locator('#scientific-stuff').innerText(),/SCIENTIFIC STUFF/i);
 report.skinExposure={knightdale:skinValue,why:skinWhy,science:skinScience};
 report.dewpointGross={knightdale:await page.locator('#dewpoint-gross-meter').innerText()};
 report.forecastDetails.push(await checkForecastDetails(page));
 await page.locator('#map-panel').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-weather-base-pane img')].some(i=>i.complete&&i.naturalWidth>0),null,{timeout:60000});
 for(const style of ['street','satellite','dark']){
  await page.locator('#basemap').selectOption(style);
  await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-weather-base-pane img')].some(i=>i.complete&&i.naturalWidth>0),null,{timeout:60000});
  const urls=await page.locator('.leaflet-weather-base-pane img').evaluateAll(imgs=>imgs.filter(i=>i.complete&&i.naturalWidth>0).map(i=>i.src));
  assert.ok(urls.every(url=>url.includes('basemap.nationalmap.gov')));
  report.maps.push({layer:'basemap-'+style,loaded:true,provider:'USGS The National Map'});
 }
 const startOverlayAudit=async()=>page.evaluate(()=>{
   window.modelOverlayAudit=[];
   new MutationObserver(()=>{const all=[...document.querySelectorAll('.leaflet-image-layer')];window.modelOverlayAudit.push({total:all.length,visible:all.filter(i=>getComputedStyle(i).opacity!=='0').length});}).observe(document.querySelector('#radar-map'),{subtree:true,childList:true,attributes:true,attributeFilter:['style']});
 });
 await startOverlayAudit();
 for(const layer of ['hrrr','ecmwf','nbm','temperature','wind','clouds']){
  await page.locator(`[data-layer="${layer}"]`).click();
  await page.waitForFunction(()=>{
    const selected=document.querySelector('.map-tabs .selected')?.dataset.layer;
    const imgs=[...document.querySelectorAll('.leaflet-image-layer')];
    return selected!=='radar'&&imgs.some(i=>i.complete&&i.naturalWidth>0)&&!document.querySelector('#radar-stamp').textContent.includes('loading')&&document.querySelector('#map-error').hidden;
  },null,{timeout:60000});
  const src=await page.locator('.leaflet-image-layer').last().getAttribute('src');
  assert.ok(src.includes('weather-fusion-data/maps/'));
  assert.equal(await page.locator('.leaflet-image-layer').count(),1,layer+' must have only one settled image');
  if(['hrrr','nbm'].includes(layer)){
    await page.locator('#radar-play').click();await page.waitForTimeout(5500);
    if((await page.locator('#radar-play').innerText()).includes('Ⅱ'))await page.locator('#radar-play').click();
    await page.waitForFunction(()=>document.querySelectorAll('.leaflet-image-layer').length===1&&!document.querySelector('#radar-stamp').textContent.includes('loading'),null,{timeout:30000});
    assert.equal(await page.locator('#map-error').isVisible(),false);
  }
  report.maps.push({layer,loaded:true,src,caption:await page.locator('#map-caption').innerText()});
 }
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
 assert.ok((await page.locator('#day-content').innerText()).includes('WEATHER NOURIE'));
 assert.equal(await page.locator('#day-content .day-gross').count(),1);
 await page.locator('#close-day').click();
 await page.locator('[data-place="greenville"]').click();
 await page.waitForFunction(()=>document.querySelector('#city-name').textContent.includes('Greenville')&&document.querySelectorAll('#metrics .metric-value').length===8,null,{timeout:75000});
 await page.waitForFunction(()=>/°.*(?:in the shade|right now)/.test(document.querySelector('#skin-values')?.textContent||'')&&!/Updating/.test(document.querySelector('#skin-values')?.textContent||''),null,{timeout:30000});
 await page.waitForFunction(()=>document.querySelector('#dewpoint-gross-meter .gross-chart'),null,{timeout:30000});
 report.skinExposure.greenville=await page.locator('#skin-values').innerText();
 report.skinExposure.greenvilleWhy=await page.locator('#skin-explanation').innerText();
 report.dewpointGross.greenville=await page.locator('#dewpoint-gross-meter').innerText();
 await page.locator('[data-layer="temperature"]').click();
 await page.waitForFunction(()=>document.querySelector('#map-error').hidden,null,{timeout:45000});
 await page.evaluate(()=>document.activeElement?.blur());
 await page.screenshot({path:dir+'/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 const desktopAudit=await page.evaluate(()=>window.modelOverlayAudit||[]);
 assert.ok(desktopAudit.length>0,'Overlay audit must collect desktop samples');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelectorAll('#metrics .metric-value').length===8,null,{timeout:75000});
 await page.waitForFunction(()=>/°.*(?:in the shade|right now)/.test(document.querySelector('#skin-values')?.textContent||''),null,{timeout:30000});
 await page.waitForFunction(()=>document.querySelector('#dewpoint-gross-meter .gross-chart'),null,{timeout:30000});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'Mobile document overflows horizontally');
 report.forecastDetails.push(await checkForecastDetails(page));
 await startOverlayAudit();
 await page.locator('[data-layer="ecmwf"]').click();
 await page.waitForFunction(()=>document.querySelector('#map-error').hidden && document.querySelectorAll('.leaflet-image-layer').length>0,null,{timeout:60000});
 await page.evaluate(()=>document.activeElement?.blur());
 await page.screenshot({path:dir+'/mobile.png',fullPage:true});
 await page.locator('#dewpoint-gross-meter').screenshot({path:dir+'/gross-meter-mobile.png'});
 await page.locator('.hero').screenshot({path:dir+'/hero-mobile.png'});
 await page.locator('[data-gross-hours="168"]').click();
 assert.ok(await page.locator('.gross-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'The full 7-day graph must fit without horizontal scrolling');
 await page.locator('#gross-scrubber').fill('30');
 assert.match(await page.locator('.gross-selected-time').innerText(),/forecast/);
 await page.locator('#dewpoint-gross-meter').screenshot({path:dir+'/gross-meter-week.png'});
 await page.locator('[data-gross-hours="240"]').click();
 assert.ok(await page.locator('.gross-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'The full 10-day graph must fit without horizontal scrolling');
 await page.locator('#gross-scrubber').fill('30');
 assert.match(await page.locator('.gross-selected-time').innerText(),/forecast/);
 report.metricCharts=[];
 for(const key of ['feels','precipitation','wind','humidity','pop','visibility','pressure','solar']) {
  await page.locator(`[data-metric="${key}"]`).click();
  assert.ok(await page.locator('#metric-dialog').isVisible());
  const value=await page.locator('#chart-value').innerText();
  const available=!(await page.locator('#chart-empty').isVisible());
  if(['feels','precipitation','wind','humidity','pop','solar'].includes(key))assert.ok(available,`${key}: forecast not populated`);
  await page.locator('#chart-scrubber').fill('3');
  if(key==='humidity')await page.screenshot({path:dir+'/humidity-graph.png'});
  if(key==='pressure'){if(available)assert.match(value,/mb/);await page.screenshot({path:dir+'/pressure-graph.png'});}
  report.metricCharts.push({key,value,available});
  await page.keyboard.press('Escape');
 }
 const mobileAudit=await page.evaluate(()=>window.modelOverlayAudit||[]);
 assert.ok(mobileAudit.length>0,'Overlay audit must collect mobile samples');
 const audit=[...desktopAudit,...mobileAudit];
 assert.ok(audit.every(a=>a.total<=2&&a.visible<=1),'A model loop left overlapping or orphaned overlays');
 report.overlayAudit={samples:audit.length,maxTotal:Math.max(0,...audit.map(a=>a.total)),maxVisible:Math.max(0,...audit.map(a=>a.visible))};
 report.release=REPAIR_VERSION;
 assert.deepEqual(report.browserErrors,[]);
 report.success=true;
}finally{await browser.close();await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));