import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {modelStatus,validateSnapshot,weighted,intervalTotal,feelsLike,solarTimes,createDirectModels} from '../src/weatherFusionDirect.js';
import {buildForecast} from '../src/weatherFusion.js';
import {snapshot,testInputs} from './weatherFusion.fixtures.js';
const now=Date.parse('2026-09-05T16:00:00Z'),H=3600000;
const location={latitude:35.787,longitude:-78.4806};
test('model run age and valid time gate contribution',()=>{
 assert.equal(modelStatus('hrrr','2026-09-05T12:00Z','2026-09-07T12:00Z',now),'ready');
 assert.equal(modelStatus('hrrr','2026-09-04T12:00Z','2026-09-06T12:00Z',now),'stale');
 assert.equal(modelStatus('ecmwf','2026-09-05T00:00Z','2026-09-12T00:00Z',now),'ready');
 assert.equal(modelStatus('ecmwf','2026-09-03T00:00Z','2026-09-12T00:00Z',now),'stale');
 assert.equal(modelStatus('hrrr','2026-09-06T12:00Z','2026-09-08T12:00Z',now),'unavailable');
});
test('valid direct snapshots contribute; missing geographic coverage does not',()=>{
 assert.equal(validateSnapshot(snapshot(), 'hrrr',location,now).status,'ready');
 assert.equal(validateSnapshot(snapshot(), 'hrrr',{latitude:36,longitude:-78},now).status,'not-covered');
});
test('snapshot validation rejects wrong model units corrupt intervals and missing hours',()=>{
 for(const mutate of [d=>d.model='nbm',d=>d.points[0].hourly_units.temperature_2m='°C',d=>d.points[0].hourly.time[3]+=20,d=>d.points[0].precipitationIntervals[1].value=-1,d=>d.points[0].hourly.temperature_2m[2]='90']){
 const d=snapshot();mutate(d);assert.throws(()=>validateSnapshot(d,'hrrr',location,now));
 }
});
test('QPF integrates interval totals without double counting and preserves real zero',()=>{
 const a=now/1000;
 const rows=[{start:a,end:a+6*3600,value:.6},{start:a+6*3600,end:a+12*3600,value:1.2}];
 assert.equal(intervalTotal(rows,now+3*H,now+9*H),.9);
 assert.equal(intervalTotal(rows,now-H,now+H),null);
 assert.equal(intervalTotal(rows,now,now+13*H),null);
 assert.equal(intervalTotal([{start:a,end:a+3600,value:0}],now,now+H),0);
 assert.equal(intervalTotal([],now,now+H),null);
});
test('missing blend inputs are excluded rather than filled with zero',()=>{
 assert.equal(weighted({hrrr:0,ecmwf:1},{hrrr:.6,ecmwf:.4}).value,.4);
 assert.equal(weighted({hrrr:null,ecmwf:1},{hrrr:.6,ecmwf:.4}).value,1);
 assert.equal(weighted({hrrr:null,ecmwf:null},{hrrr:.6,ecmwf:.4}).value,null);
});
test('API feels-like helper uses the same Steadman equation family in hot mild and cold weather',()=>{
 const hot=feelsLike(95,47,5,72),mild=feelsLike(70,50,8,50),cold=feelsLike(30,70,15,20);
 for(const item of [hot,mild,cold])assert.match(item.method,/Steadman apparent temperature/);
 assert.ok(hot.value>95);assert.ok(cold.value<30);assert.ok(Number.isFinite(mild.value));
 assert.equal(feelsLike(70,null,0,null).value,null);
});
test('solar events are calculated independently of model availability',()=>{
 const s=solarTimes('2026-09-05',35.787,-78.4806);
 assert.ok(Date.parse(s.sunrise)<now);assert.ok(Date.parse(s.sunset)>now);
});
test('direct models materially change numeric forecast and the source signature',()=>{
 const models=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>[id,validateSnapshot(snapshot(id),id,location,now).value]));
 const a=buildForecast({...testInputs,models});
 assert.equal(a.modelContributions.length,3);
 assert.ok(a.days[0].highBlend.sources.some(s=>s.id==='hrrr'));
 assert.ok(a.days[0].highBlend.sources.some(s=>s.id==='nbm'));
 assert.ok(a.days[0].highBlend.sources.some(s=>s.id==='ecmwf'));
 assert.equal(a.precipitation.value,.24);
 assert.equal(a.precipitation.end,new Date(now+24*H).toISOString());
 assert.equal(a.days[0].qpfWindow.start,new Date(now).toISOString());
 const hotter=structuredClone(models);hotter.hrrr.hourly.temperature_2m.fill(105);
 const b=buildForecast({...testInputs,models:hotter});
 assert.notEqual(a.days[0].high,b.days[0].high);assert.notEqual(a.signature,b.signature);
 assert.equal(a.days[0].pop,testInputs.forecast.periods[1].probabilityOfPrecipitation.value);
 assert.equal(a.google.contributes,false);
});
test('expired or absent direct feeds do not manufacture a model value',async()=>{
 const s=createDirectModels({now:()=>now,fetchImpl:async()=>new Response('missing',{status:404})});
 const result=await s.load('hrrr',location);assert.equal(result.meta.status,'unavailable');assert.equal(result.meta.contributes,false);
});
test('no embedded model webpages or cosmetic feed-health replacements remain',()=>{
 const html=fs.readFileSync(new URL('../public/weather-fusion/index.html',import.meta.url),'utf8');
 const js=fs.readFileSync(new URL('../public/weather-fusion/app.js',import.meta.url),'utf8');
 assert.ok(!html.includes('<iframe'));assert.ok(!html.includes('MutationObserver'));
 assert.ok(!js.includes('embed.windy'));assert.ok(js.includes('L.imageOverlay')||js.includes('window.L.imageOverlay'));
 assert.ok(js.includes("api('models')"));
});
test('Weather Nourie keeps thermal qualifications at the bottom, without a fetch interceptor',()=>{
 const html=fs.readFileSync(new URL('../public/weather-fusion/index.html',import.meta.url),'utf8');
 const math=fs.readFileSync(new URL('../public/weather-fusion/weather-math.js',import.meta.url),'utf8');
 assert.match(html,/Weather <b>Nourie<\/b>/);
 assert.ok(!html.includes('Back to Sun-Nourie'));assert.ok(!html.includes('Weather Fusion'));
 assert.ok(!html.includes('originalFetch'));
 assert.match(html,/How’s it really gonna feel/);
 assert.ok(html.indexOf('id="scientific-stuff"')>html.indexOf('id="metrics"'));
 assert.match(html,/not measured sunlight/);assert.match(html,/not a claim that a person/);
 assert.ok(!math.includes('NWS wind chill'));assert.ok(!math.includes('NWS heat index'));
 assert.match(math,/Steadman apparent temperature \(all-weather shade\)/);assert.match(math,/radiationFeelsLike/);
 assert.match(html,/One formula in every season/);assert.match(html,/Stull \(2011\)/);
});
