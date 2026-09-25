import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {ensembleConfidence,addComparisonCompanions} from '../src/weatherComparisonCompanions.js';
import {buildGoogleComparison,registerWeatherComparisonRoutes} from '../src/weatherComparison.js';
import {feedFixture,now} from './weatherComparisonData.test.js';
test('ensemble indicator responds to spread, age, lead and missing data',()=>{
 const rows=Array.from({length:24},()=>({temperatureP10:70,temperatureP90:74,provenance:{runAt:new Date(now).toISOString()}}));
 const base=ensembleConfidence(rows,now);
 assert.equal(base.key,'high');
 assert.ok(ensembleConfidence(rows.map(r=>({...r,temperatureP90:90})),now).score<base.score);
 assert.ok(ensembleConfidence(rows,now+72*3600000,5).score<base.score);
 assert.equal(ensembleConfidence([],now).score,null);
});
test('supplemental UV and AQI never replace model weather fields',()=>{
 const out=buildGoogleComparison(feedFixture(),'knightdale',now);
 const before=JSON.stringify(out.hours.map(({temperature,dewpoint,precipitation})=>({temperature,dewpoint,precipitation})));
 const exposure=out.exposureWeather;
 addComparisonCompanions(out,{exposure:{uv:[{date:out.days[0].date,value:7}],rows:[{time:out.hours[0].time,uvIndex:3,temperature:999}]},airQuality:{aqi:30,hours:[{time:out.hours[0].time,aqi:35}]}});
 assert.equal(out.days[0].uvMax,7);assert.equal(out.uv.today,7);assert.equal(out.hours[0].uvIndex,3);
 assert.equal(out.airQuality.aqi,30);assert.equal(out.exposureWeather,exposure);
 assert.equal(JSON.stringify(out.hours.map(({temperature,dewpoint,precipitation})=>({temperature,dewpoint,precipitation}))),before);
 assert.equal(out.days[1].uvMax,null);
});
test('legacy comparison URLs redirect directly to standalone forecast preserving location',async t=>{
 const app=express();registerWeatherComparisonRoutes(app,{feedProvider:async()=>feedFixture(),now:()=>now,companionProvider:async()=>({})});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 for(const path of ['/weather-fusion/compare','/weather-fusion/compare/','/weather-fusion/compare.html']){
  const r=await fetch(base+path+'?location=knightdale',{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/weathernext/?location=knightdale');
 }
 const html=await (await fetch(base+'/weathernext/')).text();
 assert.match(html,/Experimental NVIDIA AI Weather/);assert.doesNotMatch(html,/Forecast data: Google/);
 assert.match(readFileSync('public/weather-fusion/index.html','utf8'),/class="forecast-compare-banner" href="\/weathernext\/"/);
});
