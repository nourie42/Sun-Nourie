/** Deterministic PHONE UI preview. Every weather/map response is labelled test data. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import express from 'express';
import {preview,now} from '../test/weatherFusion.fixtures.js';
const root=fileURLToPath(new URL('..',import.meta.url)),output=path.resolve(process.env.PRERELEASE_SMOKE_OUTPUT||'/tmp/weather-prerelease-qa');
const require=createRequire(import.meta.url),H=3600000;
const primary={...preview.location,name:'TEST Knightdale, NC'},secondary={...preview.location,name:'TEST Asheville, NC',latitude:35.5951,longitude:-82.5515};
const iso=h=>new Date(now+h*H).toISOString();
const report={fixture:true,fixtureTime:iso(0),note:'All point forecasts and map images are synthetic test fixtures. No live forecasts, model runs, authentication or deployment are established by this browser test.',checks:[],screenshots:[],pageErrors:[],consoleErrors:[],externalRequests:[]};
let browser,context,page,server,base,scenario='clear',winterOutage=false,hold=false,release=null;
function fixtureFor(query){
 const data=structuredClone(preview);data.location={...((Number(query.latitude)-secondary.latitude)**2<.000001?secondary:primary)};data.signature=`phone-${scenario}-${data.location.name}`;
 data.aiConfigured=false;data.snow={days:data.days.slice(0,7).map((day,index)=>({date:day.date,label:index===0?'Today':day.label,index,nwsSnowfall:0,models:{ecmwf:0,gfs:0},periods:[],possible:false})),sources:{nwsGrid:true,models:true}};
 data.feeds.push({id:'snow-models',status:'ready',fetchedAt:iso(0)});
 data.current.dewpoint=20;data.metricForecasts.series.dewpoint.forEach(row=>row.value=20);
 if(scenario==='snow'||scenario==='cold'){
  for(const hour of data.hours){if(Date.parse(hour.time)>now){hour.temperature=25;if(scenario==='snow'&&Date.parse(hour.time)===now+2*H){hour.condition='Snow';hour.snowfall=.2;}}}
  for(const key of ['temperature','feels','shade','dewpoint'])for(const point of data.metricForecasts.series[key]||[])if(Date.parse(point.time)>now)point.value=key==='dewpoint'?10:20;
 }
 if(scenario==='snow')Object.assign(data.snow.days[0],{possible:true,nwsSnowfall:2,models:{ecmwf:2.5,gfs:1.5},periods:[{name:'This afternoon',wording:'Snow likely'}]});
 if(scenario==='ice'){data.hours[2].condition='Freezing Rain';data.snow.days[0].periods=[{name:'This afternoon',wording:'Freezing rain possible'}];}
 const modelIds=['hrrr','nam','ecmwf','gfs'];
 data.prereleaseWinter={assembledAt:iso(0),sources:Object.fromEntries(modelIds.map(id=>[id,{label:{hrrr:'HRRR CONUS (3 km)',nam:'NAM CONUS nest (3 km)',ecmwf:'ECMWF IFS (0.25°)',gfs:'GFS (0.11°, approximately 13 km)'}[id],status:'ready',coveredHours:id==='hrrr'?18:168,coverageEnd:iso(id==='hrrr'?18:168),metadata:{latestRunAt:iso(-3)},intervals:[{start:iso(1),end:iso(2),value:scenario==='snow'?.2:0}]}])),windows:Array.from({length:7},(_,i)=>({start:iso(i*24),end:iso((i+1)*24),sourceAmounts:Object.fromEntries(modelIds.map(id=>[id,{complete:id!=='hrrr',coveredHours:id==='hrrr'?(i?0:18):24,expectedHours:24,value:id==='hrrr'?null:scenario==='snow'&&i===0?2:0}]))}))};
 if(scenario==='missing'){data.snow=null;data.prereleaseWinter=null;data.feeds=data.feeds.filter(feed=>feed.id!=='snow-models');data.current.dewpoint=null;data.metricForecasts.series.dewpoint.forEach(row=>row.value=null);}
 if(scenario==='stale')data.assembledAt=iso(-4);
 return data;
}
async function capture(name,{fullPage=true}={}){const filename=name+'.png';await page.screenshot({path:path.join(output,filename),fullPage,animations:'disabled'});report.screenshots.push(filename);}
async function check(name,action){try{await action();report.checks.push({name,passed:true});console.log('PASS',name);}catch(error){report.checks.push({name,passed:false,error:error.stack});console.error('FAIL',name,error.message);await capture('failure-'+report.checks.length).catch(()=>{});}}
async function loaded(name=primary.name){await page.waitForFunction(name=>document.getElementById('city-name')?.textContent===name&&!!document.querySelector('.gross-chart')&&!document.getElementById('refresh')?.classList.contains('loading'),name);}
async function setScenario(value){scenario=value;await page.locator('#refresh').click();await page.waitForFunction(value=>globalThis.__weatherNourieForecast?.signature?.startsWith('phone-'+value)&&!document.getElementById('refresh')?.classList.contains('loading'),value);}
async function search(query,name){await page.locator('#city-search').fill(query);await page.locator('#search-results button').filter({hasText:name}).click();}
async function noOverflow(width){const box=await page.evaluate(()=>({viewport:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth,shell:document.querySelector('.shell').getBoundingClientRect().width}));assert.ok(box.html<=width+1&&box.body<=width+1,JSON.stringify(box));assert.ok(box.shell<=480.5,JSON.stringify(box));}
await mkdir(output,{recursive:true});
try{
 const {chromium}=await import('playwright'),leaflet=path.dirname(require.resolve('leaflet/dist/leaflet.js'));
 const html=(await readFile(path.join(root,'public/weather-fusion/prerelease.html'),'utf8')).replaceAll('https://unpkg.com/leaflet@1.9.4/dist/','/__test_leaflet/').replace('</body>','<aside id="phone-test-banner" style="position:fixed;z-index:2147483647;bottom:6px;right:6px;max-width:calc(100vw - 12px);padding:6px 9px;border:2px solid #261b00;border-radius:6px;background:#ffe082;color:#261b00;font:700 11px/1.4 system-ui;pointer-events:none">TEST DATA · PHONE PREVIEW<br>Synthetic forecasts & map tiles · not live</aside></body>');
 const app=express();
 app.get('/api/weather-fusion/search',(req,res)=>res.json({results:[/asheville/i.test(req.query.q||'')?secondary:primary]}));
 app.get('/api/weather-fusion/forecast',async(req,res)=>{assert.equal(req.query.prereleaseWinter,'1');if(hold)await new Promise(resolve=>release=resolve);if(!res.destroyed)res.json(fixtureFor(req.query));});
 app.get('/api/weather-fusion/alerts',(req,res)=>res.json({location:Math.abs(Number(req.query.latitude)-secondary.latitude)<.001?secondary:primary,alerts:[],feeds:[{id:'alerts',status:'ready',fetchedAt:iso(0)}]}));
 app.get('/api/weather-fusion/bulletins',(req,res)=>res.json({mode:'official',signature:req.query.signature,items:[]}));
 app.get('/api/weather-fusion/radar',(req,res)=>res.json({location:primary,status:'unavailable',frames:[],message:'TEST: radar unavailable.'}));
 app.get('/api/weather-fusion/models',(_req,res)=>res.json({layers:{}}));
 app.use('/api',(_req,res)=>res.status(503).json({error:'TEST: this feed is unavailable.'}));
 app.get('/weather-fusion/prerelease.html',(_req,res)=>res.type('html').send(html));app.use('/__test_leaflet',express.static(leaflet));app.use('/weather-fusion',express.static(path.join(root,'public/weather-fusion')));
 server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',timezoneId:'America/New_York'});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.href.startsWith(base+'/')||url.protocol==='data:')return route.continue();
  report.externalRequests.push(url.href);
  if(/mapservices.weather.noaa.gov/.test(url.hostname)){
   if(winterOutage)return route.fulfill({status:503,body:'TEST outage'});
   if(/GetCapabilities/i.test(url.search))return route.fulfill({contentType:'application/xml',body:`<WMS_Capabilities><Layer><Name>snow</Name><Dimension name="time" default="2015-04-10T00:00:00Z">${iso(2)},${iso(8)},${iso(14)}</Dimension></Layer></WMS_Capabilities>`});
   if(url.pathname.endsWith('/query'))return route.fulfill({contentType:'application/json',body:JSON.stringify({features:[{attributes:{issue_time:iso(-3),start_time:iso(0),end_time:iso(url.pathname.includes('qpf')?72:24)}}]})});
   if(url.pathname.endsWith('/legend'))return route.fulfill({contentType:'application/json',body:JSON.stringify({layers:[{layerId:9,legend:[{contentType:'image/png',imageData:png.toString('base64'),label:'TEST liquid equivalent'}]},{layerId:1,legend:[]}]})});
   return route.fulfill({contentType:'image/png',body:png});
  }
  if(url.hostname==='basemap.nationalmap.gov')return route.fulfill({contentType:'image/png',body:png});
  return route.fulfill({status:503,body:'TEST external resource disabled'});
 });
 page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.pageErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});await page.clock.setFixedTime(new Date(now));
 await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(_success,error){setTimeout(()=>error({code:1,message:'TEST denied'}),0);}}}));
 await page.goto(base+'/weather-fusion/prerelease.html',{waitUntil:'load'});
 await check('Snow tab is available before location and never calls missing data no snow',async()=>{await page.locator('#open-snow').click();await page.locator('#prerelease-winter-dialog[open]').waitFor();assert.match(await page.locator('#winter-content').innerText(),/Snow forecast unavailable/);assert.doesNotMatch(await page.locator('#winter-content').innerText(),/No snow in/);await page.keyboard.press('Escape');});
 await check('Phone search loads canonical forecast and complete no-snow state',async()=>{await search('Knightdale',primary.name);await loaded();await page.locator('#open-snow').click();assert.match(await page.locator('#winter-content').innerText(),/No snow in the available forecast/);assert.equal(await page.locator('#prerelease-winter').isVisible(),false);assert.equal(report.externalRequests.filter(url=>url.includes('mapservices.weather.noaa.gov')).length,0);await page.locator('#close-winter').click();});
 for(const width of [320,360,390,430,1440])await check(`Phone canvas, navigation and header at ${width}px`,async()=>{
  await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(180);await noOverflow(width);
  const controls=await page.locator('.weather-jump-card, #refresh, #locate').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {text:node.textContent,w:r.width,h:r.height,font:parseFloat(getComputedStyle(node.querySelector('.jump-label')||node).fontSize)};}));
  assert.ok(controls.every(c=>c.w>=43.5&&c.h>=43.5),JSON.stringify(controls));assert.ok(controls.filter(c=>!['↻','⌖'].includes(c.text.trim())).every(c=>c.font>=12),JSON.stringify(controls));
  await capture(`${width}-phone-main`);await capture(`${width}-phone-top`,{fullPage:false});
 });
 await page.setViewportSize({width:390,height:844});
 await check('Feel Meter first open and mode/range/keyboard controls work',async()=>{
  await page.locator('#open-gross').click();await page.locator('#dewpoint-gross-meter').waitFor({state:'visible'});await page.waitForTimeout(300);
  assert.match(await page.locator('#gross-title').innerText(),/Feel Meter/);assert.doesNotMatch(await page.locator('#gross-title').innerText(),/Gross Meter/);
  assert.ok((await page.locator('.gross-chart').boundingBox()).width>200);
  await page.locator('[data-meter-mode="dry"]').click();assert.match(await page.locator('.gross-verdict').innerText(),/doorknobs|static/i);
  for(const range of ['24','48','168','240']){await page.locator(`[data-gross-hours="${range}"]`).click();assert.equal(await page.locator(`[data-gross-hours="${range}"]`).getAttribute('aria-pressed'),'true');await noOverflow(390);}
  await page.locator('#gross-scrubber').focus();await page.keyboard.press('End');assert.ok(Number(await page.locator('#gross-scrubber').inputValue())>0);
  const selected=await page.locator('#gross-scrubber').inputValue();await page.locator('[data-meter-mode="gross"]').click();assert.equal(await page.locator('#gross-scrubber').inputValue(),selected);await page.locator('[data-meter-mode="dry"]').click();
  await page.locator('[data-gross-hours="48"]').click();await page.locator('#dewpoint-gross-meter').scrollIntoViewIfNeeded();await capture('390-feel-meter-dry',{fullPage:false});
 });
 await check('Missing dew point and winter feeds stay unavailable',async()=>{await setScenario('missing');assert.match(await page.locator('.gross-number').innerText(),/—/);await page.locator('#open-snow').click();assert.match(await page.locator('#winter-content').innerText(),/unavailable/i);assert.doesNotMatch(await page.locator('#winter-content').innerText(),/No snow in/);await page.locator('#close-winter').click();});
 await check('Upcoming snow shows heavy-coat snow play, qualified readings and matching tile',async()=>{
  await setScenario('snow');await page.locator('#prerelease-winter').waitFor({state:'visible'});assert.equal(await page.locator('#skin-values [data-scene="snow-play"]').count(),3);assert.equal(await page.locator('#skin-values [data-visible-outfit="cold"]').count(),3);assert.match(await page.locator('.comfort-outfit-note').innerText(),/previews that forecast/);assert.match(await page.locator('.pet-cold-caption').innerText(),/Paw care/);assert.doesNotMatch(await page.locator('.pet-cold-caption').innerText(),/\d+°/);
  await page.locator('#skin-exposure').scrollIntoViewIfNeeded();await capture('390-snow-art');await capture('390-snow-art-top',{fullPage:false});
  await page.locator('#prerelease-winter button').click();assert.match(await page.locator('#winter-content').innerText(),/2.0 in/);await capture('390-snow-details',{fullPage:false});await page.locator('.winter-model-disclosure summary').first().click();assert.match(await page.locator('.winter-model-guidance').innerText(),/18\/24 hours/);assert.match(await page.locator('.winter-model-guidance').innerText(),/Latest feed run/);await page.locator('.winter-model-disclosure summary').first().click();
 });
 await check('Snow totals load only on click with explicit six-hour valid periods',async()=>{
  const before=report.externalRequests.length;await page.locator('[data-winter-map="snow"]').click();await page.locator('#winter-snow-period').waitFor();await page.waitForFunction(()=>/NWS 6-hour snow amount/.test(document.getElementById('winter-map-status').textContent));
  assert.ok(report.externalRequests.slice(before).some(url=>/GetCapabilities/i.test(url)));
  await page.waitForTimeout(300);const tiles=report.externalRequests.filter(url=>/GetMap/i.test(url)&&url.includes('/ndfd/snow/'));
  assert.ok(tiles.length);assert.ok(tiles.every(url=>new URL(url).searchParams.get('time')||new URL(url).searchParams.get('TIME')));
  assert.match(await page.locator('#winter-map-legend').innerText(),/one interval, not the entire storm/);await page.locator('#winter-snow-period').selectOption(iso(8));await page.locator('#winter-map-canvas').scrollIntoViewIfNeeded();await capture('390-snow-total-map',{fullPage:false});
 });
 await check('Expected precip and heavy snow risk keep correct units and provenance',async()=>{
  await page.locator('[data-winter-map="qpf"]').click();await page.waitForFunction(()=>/72-hour expected precipitation/.test(document.getElementById('winter-map-status').textContent));assert.match(await page.locator('#winter-map-legend').innerText(),/not snowfall depth/);
  await page.locator('[data-winter-map="probability"]').click();await page.waitForFunction(()=>/probability of at least 4/.test(document.getElementById('winter-map-status').textContent));assert.match(await page.locator('#winter-map-legend').innerText(),/not exact chances/);
  assert.equal(await page.locator('#winter-map-canvas .leaflet-map-pane').count(),1);
 });
 await check('Map outage clears previous image and is not treated as no snow',async()=>{winterOutage=true;await page.locator('[data-winter-map="snow"]').click();await page.waitForFunction(()=>/map is unavailable/.test(document.getElementById('winter-map-status').textContent));assert.equal(await page.locator('#winter-map-canvas').isVisible(),false);assert.match(await page.locator('#winter-map-status').innerText(),/do not mean no snow/);winterOutage=false;await page.keyboard.press('Escape');await page.locator('#open-snow').click();await page.locator('#close-winter').click();});
 await check('Cold dry weather uses coats without inventing snow',async()=>{await setScenario('cold');assert.equal(await page.locator('#skin-values [data-scene="heavy-coat"]').count(),3);assert.equal(await page.locator('#skin-values [data-scene="snow-play"]').count(),0);assert.equal(await page.locator('#prerelease-winter').isVisible(),false);await page.locator('#skin-exposure').scrollIntoViewIfNeeded();await capture('390-cold-dry-art');});
 await check('Ice-only guidance opens winter without pretending it is snow',async()=>{await setScenario('ice');await page.locator('#prerelease-winter button').click();assert.match(await page.locator('.winter-types').innerText(),/Freezing rain\s+Forecast signal/);assert.match(await page.locator('.winter-types').innerText(),/Snow\s+No signal/);await page.locator('#close-winter').click();});
 await check('Changing location clears winter modal and previous readings',async()=>{
  await page.locator('#open-snow').click();await page.locator('#close-winter').click();hold=true;try{await search('Asheville',secondary.name);await page.waitForFunction(()=>/Awaiting the new location/.test(document.getElementById('observation-label').textContent));assert.equal(await page.locator('#prerelease-winter-dialog').getAttribute('open'),null);assert.equal(await page.locator('#prerelease-winter').isVisible(),false);assert.equal(await page.locator('#dewpoint-gross-meter').count(),0);await capture('390-location-pending');}finally{hold=false;release?.();release=null;}await loaded(secondary.name);
 });
 await check('Stale winter data is never presented as a verified no-snow forecast',async()=>{await setScenario('stale');await page.locator('#open-snow').click();assert.match(await page.locator('#winter-content').innerText(),/Refresh to check a current winter forecast/);await page.locator('#close-winter').click();});
 await check('Final phone variants remain usable after repeated flows',async()=>{await setScenario('snow');for(const width of [320,430]){await page.setViewportSize({width,height:844});await page.locator('#open-snow').click();await noOverflow(width);const dialog=await page.locator('#prerelease-winter-dialog').boundingBox();assert.ok(dialog.width<=width);await capture(`${width}-snow-dialog`,{fullPage:false});await page.keyboard.press('Escape');await page.locator('#open-gross').click();await noOverflow(width);}assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors.filter(x=>/Weather Nourie (?:panel|display) failed/.test(x)),[]);});
}catch(error){report.fatal=error.stack;console.error(error);await capture('fatal-error').catch(()=>{});}finally{hold=false;release?.();report.passed=!report.fatal&&report.checks.length>0&&report.checks.every(check=>check.passed);await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await context?.close().catch(()=>{});await browser?.close().catch(()=>{});if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});if(!report.passed)process.exitCode=1;console.log('Phone fixture report:',path.join(output,'report.json'));}
