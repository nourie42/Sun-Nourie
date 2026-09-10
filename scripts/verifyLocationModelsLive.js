import {exposureTitle} from '../public/weather-fusion/personal-details.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {createWeatherService} from '../src/weatherFusion.js';
import {pavementEstimate,pavementWarning} from '../public/weather-fusion/pavement.js';
import {currentSample} from '../public/weather-fusion/weather-display.js';
import {thermalRisk} from '../public/weather-fusion/thermal-risk.js';
const base=process.env.WEATHER_BASE_URL||'https://sun-nourie-live.onrender.com',output=process.env.WEATHER_QA_DIR||'../qa-model-coverage';
const local=process.env.WEATHER_LOCAL_PIPELINE==='1',service=local?createWeatherService({env:{}}):null;
const locations=[{id:'knightdale'},{id:'greenville'},{latitude:35.99,longitude:-78.9},{latitude:39.7392,longitude:-104.9903}];
const report={base,checkedAt:new Date().toISOString(),success:false,locations:[]};await fs.mkdir(output,{recursive:true});
if(!local){
 for(const name of ['index.html','app.js','experience.js','weather-display.js','comfort-outlook.js','personal-details.js','pavement.js','weather-repair.css','forecast-confidence.js','thermal-risk.js','exposure-scene.js','day-graph.js','hourly-feels.js']){
  const actual=await fetch(`${base}/weather-fusion/${name}?proof=${Date.now()}`).then(r=>r.text()),expected=await fs.readFile('public/weather-fusion/'+name,'utf8');
  assert.equal(actual.replace(/\r\n/g,'\n'),expected.replace(/\r\n/g,'\n'),'Exact deployed '+name);
 }
}
let browser;
try{
 if(!local)browser=await chromium.launch({headless:true,executablePath:process.env.WEATHER_BROWSER_PATH});
 for(const place of locations){
  const query=new URLSearchParams(place.id?{location:place.id}:place);
  const f=local?await service.getForecast(Object.fromEntries(query)):await fetch(`${base}/api/weather-fusion/forecast?${query}`,{signal:AbortSignal.timeout(55000)}).then(r=>r.json());
  assert.deepEqual(f.days[0].confidence.sourceIds,['nws','hrrr','ecmwf'],f.location?.name+' actual today sources');
  assert.equal(f.modelContributions.length,3);assert.ok(f.feeds.filter(x=>['hrrr','ecmwf','nbm'].includes(x.id)).every(x=>x.status==='ready'));
  for(const kind of ['high','low'])if(f.days[0][kind+'Blend']?.sources.length)assert.deepEqual(f.days[0][kind+'Blend'].sources.map(s=>[s.id,s.weight]),[['nws',.4],['hrrr',.4],['ecmwf',.2]],kind);
  const time=f.hours.find(h=>Date.parse(h.time)>Date.now()&&new Intl.DateTimeFormat('en-CA',{timeZone:f.location.timeZone}).format(new Date(h.time))===new Intl.DateTimeFormat('en-CA',{timeZone:f.location.timeZone}).format(new Date()))?.time;
  assert.ok(time,'A same-day future hour exists');
  const fields={};
  for(const field of ['temperature','dewpoint','wind','gust','cloud']){
   const p=f.metricForecasts.series[field].find(p=>Date.parse(p.time)===Date.parse(time));assert.ok(Number.isFinite(p.value),field);
   assert.deepEqual(p.sources.map(s=>[s.id,s.weight]),[['nws',.4],['hrrr',.4],['ecmwf',.2]],f.location.name+' '+field);
   const expected=p.sources.reduce((sum,s)=>sum+s.value*s.weight,0);assert.ok(Math.abs(p.value-expected)<(field==='temperature'?.51:.11),field+' weighted numeric value');fields[field]=p;
  }
  const hour=f.hours.find(h=>h.time===time);assert.equal(hour.feelsLikeInputs.temperature,hour.temperature);assert.equal(hour.feelsLikeInputs.wind,fields.wind.value);assert.equal(hour.feelsLikeInputs.dewpoint,fields.dewpoint.value);assert.equal(hour.feelsLikeInputs.skyCover,fields.cloud.value);
  const result={location:f.location,assembledAt:f.assembledAt,confidence:f.days[0].confidence,feeds:f.feeds.filter(x=>['hrrr','ecmwf','nbm'].includes(x.id)),fields};
  if(browser){
   const context=await browser.newContext({viewport:{width:place.id==='knightdale'?1440:390,height:950}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(place=>localStorage.setItem('weather-fusion-place',JSON.stringify(place)),f.location);
   const response=page.waitForResponse(r=>r.url().includes('/api/weather-fusion/forecast?')&&r.status()===200,{timeout:60000});
   await page.goto(base+'/weather-fusion/',{waitUntil:'domcontentloaded'});const shown=await(await response).json();
   await page.waitForSelector('#pavement-content');
   assert.equal(await page.locator('#skin-kicker').innerText(),'How it actually feels right now');
   assert.deepEqual(await page.locator('#skin-values .exposure-label').allTextContents(),['Shade',exposureTitle(currentSample(shown).comfort.radiantCondition,currentSample(shown).isDay,currentSample(shown).inputs.skyCover),'For Pets']);
   assert.ok(await page.locator('#map-panel').evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('#metrics').getBoundingClientRect().bottom));
   assert.match(await page.locator('.comfort-later small').innerText(),/\d{1,2}:\d{2} [AP]M/);
   assert.match(await page.locator('.comfort-later>span').first().innerText(),/Warmest feels like today/);
   assert.equal(await page.locator('.thermal-risk').evaluateAll(els=>els.some(el=>!el.closest('.sun-shade-comparison'))),false);
   assert.equal(await page.locator('.shade-person .thermal-risk').count(),0);
   const humanRisk=thermalRisk(currentSample(shown).feels);
   assert.equal(await page.locator('.sun-person .thermal-risk').count(),humanRisk?1:0);
   if(humanRisk){assert.equal(await page.locator('.sun-person .thermal-risk').innerText(),humanRisk.short);assert.ok(await page.locator('.sun-person .thermal-risk').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('.sun-person figcaption strong').getBoundingClientRect().top));}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   const expectedWarning=pavementWarning(pavementEstimate(shown,currentSample(shown).inputs));
   assert.equal(await page.locator('.pavement-warning').count(),expectedWarning?1:0);
   if(expectedWarning){assert.equal(await page.locator('.pavement-warning').innerText(),expectedWarning.label);assert.ok(await page.locator('.pavement-warning').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('.poodle-walk').getBoundingClientRect().top));}
   await page.locator('.exposure-cards').screenshot({path:output+'/live-'+(place.id||f.location.office)+'-comfort.png'});
   await page.locator('#daily [data-day="0"]').click();await page.locator('#day-dialog[open]').waitFor();
   assert.match(await page.locator('.dialog-confidence summary').innerText(),/3 sources/);
   assert.equal(await page.locator('.day-graph [data-series]').count(),4);
   assert.equal(await page.locator('#day-content .thermal-risk').count(),0);
   await page.locator('.dialog-confidence summary').click();assert.match(await page.locator('.dialog-confidence').innerText(),/NWS, HRRR, ECMWF/);
   await page.locator('#day-content').screenshot({path:output+'/live-'+(place.id||f.location.office)+'-confidence.png'});
   result.renderedConfidence=await page.locator('.dialog-confidence').innerText();assert.deepEqual(errors,[]);await context.close();
  }
  report.locations.push(result);console.log('VERIFIED',f.location.name,f.days[0].confidence.sourceIds.join('+'),Object.keys(fields).join(','));
 }
 report.success=true;
}finally{if(browser)await browser.close();await fs.writeFile(output+'/location-models-'+(local?'local':'live')+'.json',JSON.stringify(report,null,2));}
console.log('LOCATION_MODEL_VERIFICATION_PASSED');
