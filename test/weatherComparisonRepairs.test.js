import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {ensembleConfidence,addComparisonCompanions} from '../src/weatherComparisonCompanions.js';
import {buildGoogleComparison,comparisonApp,registerWeatherComparisonRoutes} from '../src/weatherComparison.js';
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
test('comparison app adapter accepts the repository CRLF browser client',()=>{
 const original=readFileSync('public/weather-fusion/app.js','utf8');
 const transformed=comparisonApp(original,{source:'google',point:{id:'knightdale',name:'Knightdale / Raleigh',latitude:35.787,longitude:-78.4806},explicitLocation:true});
 assert.match(transformed,/installComparisonPane/);
 assert.match(transformed,/compareBridge\.requestForecast/);
 assert.match(transformed,/if\(COMPARE\.explicitLocation\)chooseLocation\([\s\S]*else startDeviceLocation\(\);/);
});
test('legacy comparison URLs redirect directly to standalone forecast preserving location',async t=>{
 const app=express();registerWeatherComparisonRoutes(app,{feedProvider:async()=>feedFixture(),now:()=>now,companionProvider:async()=>({})});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 for(const path of ['/weather-fusion/compare','/weather-fusion/compare/','/weather-fusion/compare.html']){
  const r=await fetch(base+path+'?location=knightdale',{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/weathernext/?location=knightdale');
 }
 const html=await (await fetch(base+'/weathernext/')).text();
 assert.match(html,/NVIDIA Forecast/);assert.doesNotMatch(html,/Experimental NVIDIA AI Weather|Forecast data: Google/);
 const nearby=await (await fetch(base+'/weathernext/?latitude=35.7798&longitude=-78.5355')).text();
 assert.match(nearby,/compare\/app\.js\?source=google&amp;location=selected&amp;explicit=1&amp;latitude=35\.7798&amp;longitude=-78\.5355/);
 assert.match(nearby,/name=Selected%20location/);
 assert.match(nearby,/NVIDIA Forecast/);
 assert.doesNotMatch(nearby,/Experimental NVIDIA AI Weather/);
 assert.equal((nearby.match(/id="city-search"/g)||[]).length,1,'The NVIDIA page uses the same single location search.');
 assert.equal((nearby.match(/id="locate"/g)||[]).length,1,'Device location is an action on that same search control.');
 assert.match(readFileSync('public/weather-fusion/compare-bridge.js','utf8'),/https:\/\/deepmind\.google\.com\/science\/weatherlab/);
 assert.match(readFileSync('public/weather-fusion/index.html','utf8'),/class="weather-jump-card jump-next" href="\/weathernext\/"/);
});
test('an exact-coordinate NVIDIA page does not wait for the published-location feed',async t=>{
 let feedCalls=0;const app=express();registerWeatherComparisonRoutes(app,{feedProvider:async()=>{feedCalls++;throw new Error('published point feed unavailable');},now:()=>now});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const response=await fetch(`http://127.0.0.1:${server.address().port}/weathernext/?latitude=43.6532&longitude=-79.3832&name=Toronto`);
 const html=await response.text();assert.equal(response.status,200);assert.equal(feedCalls,0);assert.match(html,/name=Toronto/);assert.match(html,/NVIDIA Forecast/);
});
test('an approved published WeatherNext point serves its exact nearby selected coordinates',async t=>{
 const app=express(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 registerWeatherComparisonRoutes(app,{feedProvider:async()=>feedFixture(),now:()=>now,companionProvider:async()=>({}),accessOptions:{origin:base}});
 const response=await fetch(base+'/api/weather-fusion/compare/location',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','x-weathernext-request':'1'},body:JSON.stringify({latitude:35.78765,longitude:-78.48056})});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.comparison.point.id,'knightdale');
});
