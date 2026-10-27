import test from 'node:test';import assert from 'node:assert/strict';
import {buildForecast} from '../src/weatherFusion.js';
import {inputs,now} from './weatherFusion.fixtures.js';
import {buildSeries} from '../public/weather-fusion/wn-blend.js';
import {rainTiming,rainTimingHTML} from '../public/weather-fusion/rain-timing.js';
const H=3600000;
function forecast(){const f=structuredClone(inputs);for(const m of Object.values(f.models)){m.verifiedModel=true;m.runAt=new Date(now).toISOString();m.hourly.cloud_cover=m.hourly.time.map(()=>0);m.hourly.precipitation=m.hourly.time.map(()=>0);m.precipitationIntervals=m.hourly.time.slice(1).map(t=>({start:t-3600,end:t,value:0}));}return buildForecast({...f,blendV2:true});}
test('official NWS published QPF and probability do not discard available model agreement evidence',()=>{
 const f=forecast(),weather=f.days[0].confidence.weather;
 assert.notEqual(weather.key,'unavailable');assert.ok(weather.evidence.rain.comparedHours>0);
 assert.ok(weather.evidence.rain.completeSources.includes('hrrr'));
 const rain=f.rainTimeline.find(r=>r.precipitationBlend.comparisonSources?.length>=3);
 assert.ok(rain);assert.ok(rain.precipitationBlend.sources.length>=3,'published QPF averages NWS with the available models');assert.ok(rain.precipitationBlend.sources.some(s=>s.id==='nws'));
 assert.ok(rain.precipitationBlend.comparisonSources.length>=3,'raw model amounts independently establish agreement');
 assert.equal(rain.rainLikelihood.value,rain.officialPop);assert.equal(weather.evidence.rain.fallbackHours,0,'deliberate official probability does not imply missing model amounts');
});
test('V2 availability explanation names official probabilities without claiming model forecast data is absent',()=>{
 const f=forecast(),timing=rainTiming(f,0,false,now);const html=rainTimingHTML(timing);
 assert.equal(html,'');assert.doesNotMatch(html,/model data is unavailable/);
});
test('comparison includes valid noncontributing temperatures without changing forecast weights',()=>{
 const f=forecast(),p=f.metricForecasts.series.temperature[0];
 assert.ok(p.comparisonSources?.length>=3);
 // The comparison-only source can be inspected without inserting it into the house forecast.
 for(const row of f.metricForecasts.series.temperature)row.comparisonSources=[...(row.comparisonSources||row.sources||[]),{id:'wn',value:65,weight:0,comparisonOnly:true}];
 const graph=buildSeries(f,null,'temp',now);
 assert.equal(graph.modelMaps[0].wn,65);assert.equal(graph.contributingHighs[0].wn,undefined);
});
test('a genuinely missing set of model rain inputs stays unavailable',()=>{
 const f=forecast();for(const row of f.rainTimeline)row.precipitationBlend.comparisonSources=[{id:'nws',value:0,weight:1}];
 return import('../src/weatherFusionConditionConfidence.js').then(({addConditionConfidence})=>{addConditionConfidence(f,{now});assert.equal(f.days[0].confidence.weather.key,'unavailable');});
});

test('native WeatherNext 3 amount intervals are compared as expected amounts, never as rain probabilities',async()=>{
 const {validateWeatherNext3}=await import('../src/weatherFusionWeatherNext3.js');
 const run=Date.parse('2026-10-24T00:00:00Z');
 const feed={schema:'weather-nourie-weathernext3-v1',model:'Google WeatherNext 3',sourceTable:'project.dataset.weathernext_3_0_0_0p1deg',status:'ready',runAt:new Date(run).toISOString(),generatedAt:new Date(run+H).toISOString(),units:{temperature:'degF',wind:'mph',dewpoint:'degF',cloudCover:'percent',precipitation:'inch per 1-hour window'},timeStepHours:1,ensembleMembers:64,horizonHours:168,points:[{latitude:35.787,longitude:-78.4806,hourly:[1,2].map(h=>({time:new Date(run+h*H).toISOString(),temperatureF:60,windMph:8,dewpointF:50,skyCoverPercent:20,precipitationInches:.02}))}]};
 const m=validateWeatherNext3(feed,{latitude:35.787,longitude:-78.4806},run+H);
 assert.equal(m.precipitationIntervals[0].start,run/1000);assert.equal(m.precipitationIntervals[0].end,run/1000+3600);assert.equal(m.precipitationIntervals[0].value,.02);
 assert.equal(m.hourly.wind_speed_10m[0],8);assert.equal(m.hourly.cloud_cover[0],20);assert.equal(m.hourly.probabilityOfPrecipitation,undefined);
});

test('intentional official probability does not trigger model outage retries',async()=>{
 const {forecastNeedsModelRetry}=await import('../public/weather-fusion/forecast-refresh.js');const f=forecast();
 f.days[0].confidence.coverage.temperature.complete=true;f.days[0].confidence.coverage.rain.complete=true;
 assert.equal(forecastNeedsModelRetry(f,now),false);
 f.feeds.find(s=>s.id==='hrrr').status='unavailable';assert.equal(forecastNeedsModelRetry(f,now),true);
});

test('GEFS honors provider retry-after rather than refetching on every page load',async()=>{
 const {createGefs}=await import('../src/weatherFusionGefs.js');let clock=now,calls=0;
 const load=createGefs({now:()=>clock,fetchImpl:async()=>{calls++;return {ok:false,status:429,headers:{get:()=> '120'}};}});
 const place={latitude:35.787,longitude:-78.4806};const first=await load(place);const attempts=calls;
 assert.equal(first.meta.status,'unavailable');assert.match(first.meta.message,/rate limit/);assert.ok(first.meta.retryAfter);
 await load(place);await load({...place,latitude:35.8});assert.equal(calls,attempts);
 clock+=121000;await load(place);assert.ok(calls>attempts);
});
test('Compare keeps the real source availability reason for an unavailable model',()=>{
 const f=forecast();f.feeds.push({id:'gefs',status:'unavailable',message:'GEFS provider rate limit'});
 const b=buildSeries(f,null,'temp',now);assert.equal(b.sourceAvailability.gefs.message,'GEFS provider rate limit');
});
