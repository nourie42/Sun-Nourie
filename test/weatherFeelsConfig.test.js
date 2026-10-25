import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCurrentConditions} from '../src/weatherFusionCurrent.js';
import {createFeelsConfigLoader,normalizeFeelsConfig,DEFAULT_CURRENT_SOURCE,FEELS_CONFIG_CACHE_MS,FEELS_CONFIG_RETRY_MS} from '../src/weatherFeelsConfig.js';

const H=3600000,now=Date.parse('2026-10-25T09:03:00Z'),epoch=Math.floor(now/H)*H;
// A close, fresh station that agrees with guidance: normally accepted as "current".
const station={type:'observation',station:'KATL',stationName:'Atlanta airport',temperature:53.6,wind:14,apparent:45,time:new Date(now-12*60000).toISOString(),stationDistanceKm:5};
const hour={time:new Date(epoch).toISOString(),temperature:52,condition:'Clear',apparent:41};
const models={nbm:[{time:epoch,temperature_2m:52,dew_point_2m:44,wind_speed_10m:10,relative_humidity_2m:70}]};
const reply=(body,{ok=true,status=200}={})=>async()=>({ok,status,text:async()=>typeof body==='string'?body:JSON.stringify(body)});

test('without a setting, an accepted station still drives current conditions (unchanged behavior)',()=>{
 const current=validateCurrentConditions(station,[hour],models,now);
 assert.equal(current.type,'observation');
 assert.equal(current.sourceValidation.accepted,true);
});

test('station-when-accepted keeps the accepted station',()=>{
 const current=validateCurrentConditions(station,[hour],models,now,{currentConditionsSource:'station-when-accepted'});
 assert.equal(current.type,'observation');
 assert.equal(current.temperature,53.6);
});

test('hourly-blend gives every location the same guidance path Knightdale uses',()=>{
 const current=validateCurrentConditions(station,[hour],models,now,{currentConditionsSource:'hourly-blend'});
 assert.equal(current.type,'guidance');
 assert.equal(current.temperature,52);
 assert.equal(current.sourceValidation.accepted,false);
 assert.equal(current.sourceValidation.methodSetting,'hourly-blend');
 assert.match(current.sourceValidation.reason,/hourly forecast blend as current conditions in every location/);
 // The station stays visible as provenance but cannot drive the numbers.
 assert.equal(current.localEstimate.referenceStation.station,'KATL');
});

test('hourly-blend never replaces a usable station with "unavailable"',()=>{
 const current=validateCurrentConditions(station,[],{},now,{currentConditionsSource:'hourly-blend'});
 assert.equal(current.type,'observation');
 assert.equal(current.temperature,53.6);
});

test('hourly-blend does not alter guidance that is already modeled',()=>{
 const modeled={type:'guidance',temperature:50};
 assert.equal(validateCurrentConditions(modeled,[hour],models,now,{currentConditionsSource:'hourly-blend'}),modeled);
});

test('settings are validated; anything unknown is rejected',()=>{
 assert.deepEqual(normalizeFeelsConfig({currentConditionsSource:'hourly-blend'}),{currentConditionsSource:'hourly-blend'});
 assert.deepEqual(normalizeFeelsConfig({currentConditionsSource:'station-when-accepted',extra:1}),{currentConditionsSource:'station-when-accepted'});
 for(const bad of [null,[],'hourly-blend',{},{currentConditionsSource:'Hourly-Blend'},{currentConditionsSource:7}])assert.equal(normalizeFeelsConfig(bad),null);
});

test('loader: default before any good file, then the remote value, cached for five minutes',async()=>{
 let t=now,calls=0,body={currentConditionsSource:'station-when-accepted'};
 const loader=createFeelsConfigLoader({now:()=>t,fetchImpl:async(...a)=>{calls++;return reply(body)(...a);}});
 const first=await loader.get();
 assert.equal(first.currentConditionsSource,'station-when-accepted');
 assert.equal(first.status,'remote');
 body={currentConditionsSource:'hourly-blend'};
 t+=FEELS_CONFIG_CACHE_MS-1000;
 assert.equal((await loader.get()).currentConditionsSource,'station-when-accepted');
 assert.equal(calls,1);
 t+=2000;
 const later=await loader.get();
 assert.equal(later.currentConditionsSource,'hourly-blend');
 assert.equal(calls,2);
});

test('loader: unreachable or invalid file falls back to the built-in default, then keeps the last good value',async()=>{
 let t=now,mode='down';
 const fetchImpl=async()=>{
  if(mode==='down')throw new Error('network down');
  if(mode==='http')return {ok:false,status:404,text:async()=>''};
  if(mode==='typo')return {ok:true,status:200,text:async()=>'{"currentConditionsSource":"hourly blend"}'};
  if(mode==='junk')return {ok:true,status:200,text:async()=>'not json'};
  return {ok:true,status:200,text:async()=>'{"currentConditionsSource":"station-when-accepted"}'};
 };
 const loader=createFeelsConfigLoader({now:()=>t,fetchImpl});
 const none=await loader.get();
 assert.equal(none.currentConditionsSource,DEFAULT_CURRENT_SOURCE);
 assert.equal(none.status,'default');
 assert.equal(none.checkedAt,null);
 for(const m of ['http','typo','junk']){mode=m;t+=FEELS_CONFIG_RETRY_MS+1;assert.equal((await loader.get()).currentConditionsSource,DEFAULT_CURRENT_SOURCE);}
 mode='good';t+=FEELS_CONFIG_RETRY_MS+1;
 assert.equal((await loader.get()).status,'remote');
 mode='typo';t+=FEELS_CONFIG_CACHE_MS+1;
 const kept=await loader.get();
 assert.equal(kept.currentConditionsSource,'station-when-accepted');
 assert.equal(kept.status,'last-good');
 assert.match(kept.error,/currentConditionsSource must be one of/);
});

test('loader: a failed check is not retried on every request',async()=>{
 let t=now,calls=0;
 const loader=createFeelsConfigLoader({now:()=>t,fetchImpl:async()=>{calls++;throw new Error('down');}});
 await loader.get();await loader.get();await loader.get();
 assert.equal(calls,1);
 t+=FEELS_CONFIG_RETRY_MS+1;
 await loader.get();
 assert.equal(calls,2);
});

test('loader: concurrent requests share one fetch',async()=>{
 let calls=0;
 const loader=createFeelsConfigLoader({now:()=>now,fetchImpl:async(...a)=>{calls++;return reply({currentConditionsSource:'hourly-blend'})(...a);}});
 await Promise.all([loader.get(),loader.get(),loader.get()]);
 assert.equal(calls,1);
});
