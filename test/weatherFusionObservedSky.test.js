import test from 'node:test';
import assert from 'node:assert/strict';
import {observedClearSky,applyObservedSky} from '../src/weatherFusionObservedSky.js';
import {validateCurrentConditions} from '../src/weatherFusionCurrent.js';
import {buildForecast} from '../src/weatherFusion.js';
import {validateSnapshot} from '../src/weatherFusionDirect.js';
import {testInputs,snapshot} from './weatherFusion.fixtures.js';
import {forecastSky} from '../public/weather-fusion/sky-display.js';
const now=Date.parse('2026-11-21T15:35:00Z'),time='2026-11-21T15:00:00Z';
const station=(patch={})=>({station:'TEST',stationDistanceKm:8,time:'2026-11-21T15:15:00Z',skyCover:'CLR',visibility:10,condition:'Clear',...patch});
const forecast=()=>({assembledAt:new Date(now).toISOString(),location:{latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'},current:{type:'guidance',temperature:56,condition:'Mostly Cloudy',time,skyCover:92.4,dewpoint:40.9,wind:7.7},hours:[{time,temperature:56,condition:'Mostly Cloudy',isDay:true,skyCover:92.4}],days:[{condition:'Patchy Fog then Sunny',high:64,low:57}]});
test('Knightdale distant clear airport cannot override the current sky or forecast',()=>{
 const f=forecast(),hours=structuredClone(f.hours),days=structuredClone(f.days),current=structuredClone(f.current);
 applyObservedSky(f,[station({station:'KJNX',stationDistanceKm:28.6,skyCover:'SCT'})],now);
 assert.equal(f.observedSky.applied,false);assert.deepEqual(f.current,current);assert.deepEqual(f.hours,hours);assert.deepEqual(f.days,days);
 assert.equal(forecastSky(f,now).kind,'cloudy');
});
test('sky fallback rejects a station beyond the existing 16.1km source limit',()=>{
 const obs={...station({stationDistanceKm:28.6,skyCover:'SCT'}),type:'observation',temperature:59};
 const f=forecast(),current=validateCurrentConditions(obs,f.hours,{},now);
 assert.equal(current.sourceValidation.accepted,false);assert.equal(current.condition,'Mostly Cloudy');assert.match(current.conditionSource,/Selected-location/);
});
test('nearest cloudy or rainy station prevents cherry-picking a farther clear report',()=>{
 for(const patch of [{skyCover:'OVC',condition:'Overcast'},{condition:'Light Rain'},{visibility:2}])assert.equal(observedClearSky([station({stationDistanceKm:12}),station({stationDistanceKm:4,...patch})],now),null);
});
test('missing, stale, distant or unverifiable clear reports cannot establish sunshine',()=>{
 for(const patch of [{stationDistanceKm:null},{stationDistanceKm:-1},{stationDistanceKm:'8'},{stationDistanceKm:16.2},{time:new Date(now-76*60000).toISOString()},{time:new Date(now+6*60000).toISOString()},{visibility:null},{visibility:4.9}])assert.equal(observedClearSky([station(patch)],now),null,JSON.stringify(patch));
});
test('a supported local observation updates only now and keeps its actual cloud category',()=>{
 for(const [skyCover,label,kind]of [['CLR','Sunny','clear'],['FEW','Mostly Sunny','clear'],['SCT','Partly Cloudy','partly-cloudy']]){
  const f=forecast(),hours=structuredClone(f.hours),days=structuredClone(f.days);
  applyObservedSky(f,[station({skyCover})],now);
  assert.equal(f.current.condition,label);assert.equal(f.current.weather.kind,kind);assert.equal(f.current.observedSky.applied,true);assert.equal(forecastSky(f,now).kind,kind);
  assert.deepEqual(f.hours,hours);assert.deepEqual(f.days,days);assert.equal(f.current.temperature,56);assert.equal(f.current.skyCover,92.4);
 }
});
test('accepted observations, unavailable current data, and precipitation retain their condition',()=>{
 for(const patch of [{type:'observation',condition:'Overcast'},{type:'unavailable',condition:'Current conditions unavailable'},{condition:'Light Rain'},{condition:'Snow'}]){
  const f=forecast();Object.assign(f.current,patch);const before=structuredClone(f.current);applyObservedSky(f,[station()],now);assert.deepEqual(f.current,before);
 }
});
test('distant clear reports leave every forecast calculation identical in both NC examples',()=>{
 for(const location of [testInputs.location,{id:'greenville',name:'Greenville, NC',latitude:35.6127,longitude:-77.3664}]){
  const input=structuredClone(testInputs);input.location=location;
  input.models=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>[id,validateSnapshot(snapshot(id),id,testInputs.location,testInputs.now).value]));
  input.observation={...input.observation,stationDistanceKm:28.6,skyCover:'SCT',visibility:10};
  const a=buildForecast(input);input.observation.skyObservations=[station({time:input.observation.time,stationDistanceKm:28.6,skyCover:'SCT'})];const b=buildForecast(input);
  for(const key of ['current','hours','days','metricForecasts','rainTimeline','comfort','blendPolicy','signature'])assert.deepEqual(b[key],a[key],location.id+' '+key);
 }
});
