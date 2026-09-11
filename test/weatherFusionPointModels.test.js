import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPointModels,validatePointModel} from '../src/weatherFusionPointModels.js';
import {createDirectModels} from '../src/weatherFusionDirect.js';
import {buildForecast} from '../src/weatherFusion.js';
import {mixWindDirection} from '../src/weatherFusionExperience.js';
import {testInputs,snapshot} from './weatherFusion.fixtures.js';
import {pavementWarning,pavementHTML} from '../public/weather-fusion/pavement.js';
import {peakComparisonHTML} from '../public/weather-fusion/weather-display.js';
import {warmestTodayWindow} from '../public/weather-fusion/comfort-outlook.js';
const now=Date.parse('2026-09-05T16:00:00Z'),H=3600000,location={latitude:35.99,longitude:-78.9};
function raw(id='hrrr',point=location){
 const offset=id==='hrrr'?0:id==='ecmwf'?1:2;
 const fields={temperature_2m:['°F',90-offset*3],dew_point_2m:['°F',65-offset*3],relative_humidity_2m:['%',60],precipitation:['inch',.02+offset*.01],wind_speed_10m:['mp/h',12+offset*3],wind_gusts_10m:['mp/h',20+offset*4],wind_direction_10m:['°',210],cloud_cover:['%',10+offset*30],pressure_msl:['hPa',1010+offset*2],visibility:['m',16093.44]};
 const time=Array.from({length:240},(_,i)=>(Date.parse('2026-09-05T00:00:00Z')+i*H)/1000);
 return {...point,hourly_units:{time:'unixtime',...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v[0]]))},hourly:{time,...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,time.map(()=>v[1])]))}};
}
const metadata={last_run_initialisation_time:(now-4*H)/1000};
const response=d=>new Response(JSON.stringify(d),{headers:{'content-type':'application/json'}});
test('named-model validation checks time, location, fields, units and initialization',()=>{
 const v=validatePointModel(raw(),metadata,'hrrr',location,now);
 assert.ok(v.verifiedModel);assert.equal(v.direct,undefined);assert.match(v.runScope,/successive runs/);
 assert.equal(v.hourly.visibility[20],10);assert.ok(Math.abs(v.hourly.pressure_msl[20]-1010/33.86389)<1e-8);
 const feet=raw();feet.hourly_units.visibility='ft';feet.hourly.visibility.fill(52800);assert.equal(validatePointModel(feet,metadata,'hrrr',location,now).hourly.visibility[20],10);
 assert.equal(v.precipitationIntervals[0].end-v.precipitationIntervals[0].start,3600);
 assert.ok(v.hourly.temperature_2m.at(-1)===null,'Never extend HRRR beyond its horizon');
 for(const mutate of [d=>d.latitude=34,d=>d.hourly_units.temperature_2m='°C',d=>d.hourly.time[3]+=1,d=>d.hourly.wind_speed_10m[5]=-2,d=>d.hourly.cloud_cover[6]=101,d=>d.hourly.dew_point_2m.pop()]){
  const d=raw();mutate(d);assert.throws(()=>validatePointModel(d,metadata,'hrrr',location,now));
 }
 assert.throws(()=>validatePointModel(raw(),{last_run_initialisation_time:(now-13*H)/1000},'hrrr',location,now),/stale/);
 const d=raw('nbm');d.hourly.pressure_msl.fill(null);d.hourly_units.pressure_msl='undefined';assert.ok(validatePointModel(d,metadata,'nbm',location,now).hourly.pressure_msl.every(v=>v===null));
});
test('searched coordinates use explicit requested models, deduplicate and never reuse another city',async()=>{
 const calls=[];let clock=now,fail=false;
 const load=createPointModels({now:()=>clock,fetchImpl:async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'error');if(fail)throw Error('offline');
  const u=new URL(url);if(u.pathname.includes('/static/'))return response(metadata);
  assert.equal(u.searchParams.get('models'),'gfs_hrrr');assert.equal(u.searchParams.get('timeformat'),'unixtime');
  return response(raw('hrrr',{latitude:+u.searchParams.get('latitude'),longitude:+u.searchParams.get('longitude')}));
 }});
 const [a,b]=await Promise.all([load('hrrr',location),load('hrrr',location)]);assert.equal(a,b);assert.equal(calls.length,2);
 await load('hrrr',location);assert.equal(calls.length,2);
 const other=await load('hrrr',{latitude:36.1,longitude:-79});assert.equal(other.latitude,36.1);assert.equal(calls.length,4);
 clock+=6*60000;fail=true;const kept=await load('hrrr',location);assert.match(kept.refreshWarning,/still-fresh/);
 clock+=13*H;await assert.rejects(()=>load('hrrr',location),/offline/);
});
test('uncovered native point cannot impersonate searched location during provider outage',async()=>{
 const direct=createDirectModels({now:()=>now,fetchImpl:async url=>url.includes('/models/')?response(snapshot(url.includes('ecmwf')?'ecmwf':url.includes('nbm')?'nbm':'hrrr')):new Response('',{status:503})});
 const r=await direct.load('hrrr',location);assert.equal(r.value,null);assert.equal(r.meta.contributes,false);assert.equal(r.meta.status,'unavailable');
});
function forecast(patch){
 const models=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>{const d=raw(id);if(patch&&id==='hrrr')patch(d);return [id,validatePointModel(d,metadata,id,location,now)];}));
 const grid={...testInputs.grid,...Object.fromEntries([['skyCover','percent',30],['windGust','mi_h-1',16],['dewpoint','degF',68],['windSpeed','mi_h-1',10]].map(([k,u,v])=>[k,{uom:'wmoUnit:'+u,values:[{validTime:'2026-09-05T00:00:00Z/P10D',value:v}]}]))};
 return buildForecast({...testInputs,location:{...location,name:'Durham'},models,grid,now});
}
test('actual three-source weights change temperature, moisture, wind, clouds, gusts and feels—not just rain',()=>{
 const f=forecast(),g=forecast(d=>{for(const [field,change] of Object.entries({temperature_2m:8,dew_point_2m:5,wind_speed_10m:6,wind_gusts_10m:9,cloud_cover:50,precipitation:.1}))d.hourly[field]=d.hourly[field].map(v=>v+change);});
 assert.deepEqual(f.days[0].confidence.sourceIds,['nws','hrrr','ecmwf']);assert.equal(f.days[0].confidence.sourceCount,3);
 for(const part of ['high','low','rain'])assert.deepEqual(f.days[0].confidence.contributions[part].map(s=>[s.id,s.weight]),[['nws',.4],['hrrr',.4],['ecmwf',.2]]);
 for(const field of ['temperature','dewpoint','wind','gust','cloud']){
  const a=f.metricForecasts.series[field].find(p=>Date.parse(p.time)===now+H),b=g.metricForecasts.series[field].find(p=>Date.parse(p.time)===now+H);
  assert.deepEqual(a.sources.map(s=>[s.id,s.weight]),[['nws',.4],['hrrr',.4],['ecmwf',.2]],field);assert.notEqual(a.value,b.value,field);
 }
 assert.notEqual(f.days[0].high,g.days[0].high);assert.notEqual(f.days[0].low,g.days[0].low);assert.notEqual(f.hours[1].feelsLike,g.hours[1].feelsLike);assert.notEqual(f.hours[1].humidity,g.hours[1].humidity);
 assert.equal(f.hours[1].feelsLikeInputs.dewpoint,f.hours[1].dewpoint);assert.equal(f.hours[1].feelsLikeInputs.skyCover,f.metricForecasts.series.cloud[1].value);
 assert.equal(f.current.temperature,testInputs.observation.temperature,'Observations are not forecasts');
 assert.deepEqual(f.days[1].highBlend.sources.map(s=>[s.id,s.weight]),[['nws',.6],['hrrr',.1],['ecmwf',.2],['nbm',.1]]);
 assert.deepEqual(f.days[2].highBlend.sources.map(s=>[s.id,s.weight]),[['nws',.6],['ecmwf',.25],['nbm',.15]]);
});
test('surface danger and uncertainty warnings sit above the walker, with no safe claim',()=>{
 const result=(value,high)=>({status:'estimated',concrete:{value:value-10,high:high-10},asphalt:{value,high}});
 assert.equal(pavementWarning(result(135,155)).level,'danger');assert.equal(pavementWarning(result(115,135)).level,'caution');
 assert.equal(pavementWarning(result(95,115)),null);assert.equal(pavementWarning({status:'unavailable'}),null);
 const html=pavementHTML(result(135,155),99);assert.ok(html.indexOf('Paw burn risk')<html.indexOf('<svg'));assert.ok(html.indexOf('For Pets')<html.indexOf('<svg'));assert.match(html,/data-outfit="hot"/);assert.match(html,/comfort-reference-scenes-hot\.webp/);assert.doesNotMatch(html,/>Sidewalk</);
});
test('peak time survives rounded ties and a hotter current observation',()=>{
 const summary={mode:'day',chosen:{time:'2026-09-05T19:00:00Z',value:96.4}};
 for(const current of [90,96.1,96.4,97])assert.match(peakComparisonHTML(summary,current),/3:00 PM/);
});
test('weather maps follow day-at-a-glance cards in the actual document',()=>{
 const html=fs.readFileSync(new URL('../public/weather-fusion/index.html',import.meta.url),'utf8');
 assert.ok(html.indexOf('id="metrics"')<html.indexOf('id="map-panel"'));assert.ok(html.indexOf('id="map-panel"')<html.indexOf('id="scientific-stuff"'));
});
test('forecast directions cross north correctly; opposed directions are unresolved',()=>{
 const north=mixWindDirection({nws:350,hrrr:10},{nws:.5,hrrr:.5}).value;
 assert.ok(Math.min(north,360-north)<.001);assert.equal(mixWindDirection({nws:0,hrrr:180},{nws:.5,hrrr:.5}).value,null);
});
test('afternoon warmest card stays a same-day high and retains its clock time after 3 PM',()=>{
 const forecast={location:{timeZone:'America/New_York'},metricForecasts:{series:{feels:[{time:'2026-09-05T20:00:00Z',value:99},{time:'2026-09-05T21:00:00Z',value:96},{time:'2026-09-06T10:00:00Z',value:71}]}}};
 const summary=warmestTodayWindow(forecast,Date.parse('2026-09-05T19:30:00Z'));
 assert.equal(summary.chosen.value,99);assert.match(peakComparisonHTML(summary,95),/Warmest feels like today/);assert.match(peakComparisonHTML(summary,95),/4:00 PM/);
 assert.match(peakComparisonHTML(null,85,'America/New_York',Date.parse('2026-09-06T03:30:00Z')),/11:30 PM/);
});
