import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildForecast, normalizeModel, createWeatherService} from '../src/weatherFusion.js';
import {modelWeatherCondition, conditionGuidanceAt, recoverForecastHours, recoverDailyConditions} from '../src/weatherFusionFallback.js';
import {validatePointModel,createPointModels} from '../src/weatherFusionPointModels.js';
import {normalizeExposureWeather} from '../src/weatherFusionExposure.js';

const H=3600000, now=Date.parse('2026-10-14T15:54:00Z');
const start=Math.floor(now/H)*H;
const location={latitude:35.787,longitude:-78.4806,name:'Knightdale, NC',timeZone:'America/New_York'};
function model(id='nbm',code=0) {
 const times=Array.from({length:242},(_,i)=>(start-H+i*H)/1000);
 const value=id==='nbm'?77:81;
 return {verifiedModel:true,model:id,runAt:new Date(start-3*H).toISOString(),validUntil:new Date(start+240*H).toISOString(),timezone:'GMT',
  hourly_units:{time:'unixtime',temperature_2m:'°F',precipitation:'inch',wind_speed_10m:'mp/h',weather_code:'wmo code'},
  hourly:{time:times,temperature_2m:times.map(()=>value),precipitation:times.map(()=>0),wind_speed_10m:times.map(()=>6),wind_gusts_10m:times.map(()=>8),
   wind_direction_10m:times.map(()=>210),dew_point_2m:times.map(()=>55),relative_humidity_2m:times.map(()=>46),cloud_cover:times.map(()=>3),weather_code:times.map(()=>code)},
  precipitationIntervals:times.slice(1).map(end=>({start:end-3600,end,value:0}))};
}
function context(models={nbm:model()}) {
 return {models,rows:Object.fromEntries(Object.entries(models).map(([id,value])=>[id,normalizeModel(value,now)])),location,now};
}
function forecast(models,patch={}) {
 return buildForecast({location,point:{timeZone:location.timeZone,cwa:'RAH'},now,models,feeds:[{id:'nws',status:'unavailable'},{id:'hourly',status:'unavailable'}],
  forecast:null,hourly:null,grid:null,observation:null,discussion:null,...patch});
}
function pointPayload(id,coordinates) {
 const raw=model(id).hourly;
 const fields={temperature_2m:['°F',raw.temperature_2m],dew_point_2m:['°F',raw.dew_point_2m],relative_humidity_2m:['%',raw.relative_humidity_2m],precipitation:['inch',raw.precipitation],
  wind_speed_10m:['mp/h',raw.wind_speed_10m],wind_gusts_10m:['mp/h',raw.wind_gusts_10m],wind_direction_10m:['°',raw.wind_direction_10m],cloud_cover:['%',raw.cloud_cover],
  pressure_msl:['hPa',raw.time.map(()=>1010)],visibility:['m',raw.time.map(()=>16000)],weather_code:['wmo code',raw.weather_code]};
 return {...coordinates,timezone:'GMT',hourly:{time:raw.time,...Object.fromEntries(Object.entries(fields).map(([key,[,values]])=>[key,values]))},
  hourly_units:{time:'unixtime',...Object.fromEntries(Object.entries(fields).map(([key,[unit]])=>[key,unit]))}};
}
test('cold-start service survives a total NWS outage with explicit named-model hours and a local timezone',async()=>{
 const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 const service=createWeatherService({now:()=>now,env:{},fetchImpl:async url=>{
  const u=new URL(url);
  if(u.hostname==='api.open-meteo.com'&&u.pathname.includes('/static/meta.json'))return json({last_run_initialisation_time:(start-3*H)/1000});
  if(u.hostname==='api.open-meteo.com'&&u.pathname==='/v1/forecast'){
   const latitude=Number(u.searchParams.get('latitude')),longitude=Number(u.searchParams.get('longitude'));
   const fields=u.searchParams.get('hourly')||'',named=u.searchParams.get('models');
   if(fields.includes('temperature_2m')&&named)return json(pointPayload(named==='ncep_nbm_conus'?'nbm':named==='gfs_hrrr'?'hrrr':'ecmwf',{latitude,longitude}));
   if(fields.includes('uv_index')){
    const data=pointPayload('nbm',{latitude,longitude});data.timezone=latitude>45?'America/Chicago':'America/New_York';
    data.hourly.shortwave_radiation_instant=data.hourly.time.map(()=>250);data.hourly_units.shortwave_radiation_instant='W/m²';
    data.hourly.uv_index=data.hourly.time.map(()=>3);data.hourly_units.uv_index='';return json(data);
   }
  }
  return new Response('{}',{status:503});
 }});
 const recovered=await service.getForecast({location:'knightdale'});
 assert.equal(recovered.hours.length,48);assert.equal(recovered.current.condition,'Sunny');
 assert.equal(recovered.days[0].condition,'Sunny');assert.equal(recovered.location.timeZone,'America/New_York');
 assert.equal(recovered.feeds.find(feed=>feed.id==='nws').status,'unavailable');
 assert.equal(recovered.feeds.find(feed=>feed.id==='hourly').status,'unavailable');
 assert.ok(recovered.hours.every(hour=>hour.forecastSource==='model-guidance'));
 assert.ok(recovered.modelContributions.length===3);
 assert.ok(recovered.hours[0].temperatureBlend.sources.every(source=>source.id!=='nws'));
 const hazen=await service.getForecast({location:'hazen'});
 assert.equal(hazen.location.timeZone,'America/Chicago');assert.equal(hazen.hours.length,48);
 if(process.env.WEATHER_RECOVERY_FIXTURE_PATH)fs.writeFileSync(process.env.WEATHER_RECOVERY_FIXTURE_PATH,JSON.stringify(recovered));
});
test('WMO phase and thunder come from the published code, not air temperature',()=>{
 assert.equal(modelWeatherCondition(95),'Thunderstorms');
 assert.equal(modelWeatherCondition(73),'Snow');
 assert.equal(modelWeatherCondition(66),'Freezing Rain');
 assert.equal(modelWeatherCondition(0,false),'Clear');
 assert.equal(modelWeatherCondition(null),null);assert.equal(modelWeatherCondition(12),null);
 const models={nbm:model('nbm',95)};
 assert.equal(conditionGuidanceAt({...context(models),time:start}).condition,'Thunderstorms');
});
test('official text outage keeps 48 real model hours and meaningful daily/current conditions',()=>{
 const f=forecast({nbm:model(),ecmwf:model('ecmwf')});
 assert.equal(f.hours.length,48);
 assert.equal(f.current.condition,'Sunny');
 assert.equal(f.days[0].condition,'Sunny');
 assert.match(f.days[0].conditionSource,/National Blend.*model guidance/);
 const h=f.hours[0];
 assert.equal(h.officialTemperature,null);assert.equal(h.officialPop,null);assert.equal(h.pop,null);
 assert.equal(h.forecastSource,'model-guidance');
 assert.ok(h.temperatureBlend.sources.every(source=>source.id!=='nws'));
 for(const field of ['temperature','wind','dewpoint']) {
  const point=f.metricForecasts.series[field].find(row=>Date.parse(row.time)===start);
  assert.ok(point.sources.every(source=>source.id!=='nws'),`${field} model recovery must not be counted twice as NWS`);
 }
 assert.ok(f.hours.every(hour=>Number.isFinite(hour.feelsLike)));
 assert.equal(f.hours[10].condition,'Clear');
 assert.ok(f.days[0].official.high===null&&f.days[0].official.condition===null);
 assert.equal(f.feeds[0].status,'unavailable');
});
test('a partial official strip preserves its exact wording and fills only gaps',()=>{
 const official={time:new Date(start+H).toISOString(),temperature:71,condition:'Chance Rain Showers',isDay:true,pop:30,wind:'5 mph',dewpoint:58,humidity:60};
 const hours=recoverForecastHours({...context(),hours:[official]});
 assert.equal(hours.length,48);assert.equal(hours[1],official);
 assert.equal(hours[0].forecastSource,'model-guidance');
 assert.equal(hours[2].condition,'Sunny');
});
test('cloud-only recovery requires actual zero precipitation for the same interval',()=>{
 const models={nbm:model()},ctx=context(models);
 for(const row of ctx.rows.nbm)row.weather_code=null;
 const at=ctx.rows.nbm.find(row=>row.time===start+H);
 at.precipitation=.04;
 assert.equal(conditionGuidanceAt({...ctx,time:start}).condition,null,'A wet interval is not guessed to be sunny or snowy');
 at.precipitation=null;
 assert.equal(conditionGuidanceAt({...ctx,time:start}).condition,null,'Missing precipitation does not mean dry');
 at.precipitation=0;
 assert.equal(conditionGuidanceAt({...ctx,time:start}).condition,'Sunny');
 ctx.rows.nbm.find(row=>row.time===start).cloud_cover=null;
 assert.equal(conditionGuidanceAt({...ctx,time:start}).condition,null,'Missing cloud cover does not mean clear');
});
test('surface weather code is an independent labelled fallback when named-model code is absent',()=>{
 const models={nbm:model()},ctx=context(models);
 for(const row of ctx.rows.nbm)row.weather_code=null;
 const exposureWeather={rows:[{time:new Date(start).toISOString(),weatherCode:80}]};
 const recovered=conditionGuidanceAt({...ctx,exposureWeather,time:start});
 assert.equal(recovered.condition,'Rain Showers');
 assert.match(recovered.conditionSource,/Open-Meteo.*model guidance/);
 assert.equal(conditionGuidanceAt({...ctx,exposureWeather,time:start+H}).condition,'Sunny','Code cannot be held flat into another hour');
});
test('daily recovery leaves official wording intact and selects supported wet hours',()=>{
 const models={nbm:model()},ctx=context(models);
 ctx.rows.nbm.find(row=>row.time===start+2*H).weather_code=80;
 const days=[{date:'2026-10-14',condition:'Forecast unavailable'},{date:'2026-10-15',condition:'Mostly Sunny'}];
 recoverDailyConditions(days,ctx);
 assert.equal(days[0].condition,'Rain Showers');
 assert.equal(days[1].condition,'Mostly Sunny');assert.equal(days[1].conditionSource,undefined);
});
test('an available official hourly strip recovers day wording before model guidance',()=>{
 const hours=[{time:new Date(start).toISOString(),temperature:77,condition:'Partly Sunny',conditionSource:'NWS hourly forecast',isDay:true}];
 const days=[{date:'2026-10-14',condition:'Forecast unavailable'}];
 recoverDailyConditions(days,{...context({nbm:model('nbm',95)}),hours});
 assert.equal(days[0].condition,'Partly Sunny');assert.equal(days[0].conditionSource,'NWS hourly forecast');
});
test('no valid selected-point model remains unavailable rather than inventing hours or dry probabilities',()=>{
 const f=forecast({});
 assert.equal(f.hours.length,0);assert.equal(f.days[0].condition,'Forecast unavailable');
 assert.equal(f.days[0].pop,null);assert.equal(f.days[0].high,null);
 const unverified=forecast({nbm:{...model(),verifiedModel:false}});
 assert.equal(unverified.hours.length,0);
});
test('optional weather codes preserve old model validation and reject invalid code units',()=>{
 const time=Array.from({length:24},(_,i)=>(start-4*H+i*H)/1000);
 const fields={temperature_2m:['°F',77],dew_point_2m:['°F',55],relative_humidity_2m:['%',46],precipitation:['inch',0],wind_speed_10m:['mp/h',6],wind_gusts_10m:['mp/h',8],wind_direction_10m:['°',210],cloud_cover:['%',3],pressure_msl:['hPa',1010],visibility:['m',16000]};
 const data={latitude:location.latitude,longitude:location.longitude,hourly:{time,...Object.fromEntries(Object.entries(fields).map(([key,[,value]])=>[key,time.map(()=>value)]))},hourly_units:{time:'unixtime',...Object.fromEntries(Object.entries(fields).map(([key,[unit]])=>[key,unit]))}};
 const metadata={last_run_initialisation_time:(start-4*H)/1000};
 assert.equal(validatePointModel(data,metadata,'nbm',location,now).hourly.weather_code,undefined);
 data.hourly.weather_code=time.map(()=>95);data.hourly_units.weather_code='wmo code';
 assert.equal(validatePointModel(data,metadata,'nbm',location,now).hourly.weather_code[0],95);
 data.hourly_units.weather_code='%';
 assert.equal(validatePointModel(data,metadata,'nbm',location,now).hourly.weather_code,undefined);
 const raw={timezone:location.timeZone,hourly_units:{temperature_2m:'°F',wind_speed_10m:'mp/h',shortwave_radiation_instant:'W/m²',weather_code:'wmo code'},hourly:{time:[start/1000],temperature_2m:[77],wind_speed_10m:[6],weather_code:[95]}};
 assert.equal(normalizeExposureWeather(raw).rows[0].weatherCode,95);
});
test('unsupported optional weather-code query cannot discard usable named-model measurements',async()=>{
 const calls=[],load=createPointModels({now:()=>now,fetchImpl:async url=>{
  calls.push(url);const u=new URL(url);
  if(u.pathname.includes('/static/meta.json'))return new Response(JSON.stringify({last_run_initialisation_time:(start-3*H)/1000}));
  if(u.searchParams.get('hourly').split(',').includes('weather_code'))return new Response('{}',{status:400});
  const data=pointPayload('nbm',location);delete data.hourly.weather_code;delete data.hourly_units.weather_code;
  return new Response(JSON.stringify(data));
 }});
 const value=await load('nbm',location);
 assert.ok(value.verifiedModel);assert.equal(value.hourly.temperature_2m[0],77);assert.equal(value.hourly.weather_code,undefined);
 assert.equal(calls.filter(url=>url.includes('/v1/forecast')).length,2);
});
