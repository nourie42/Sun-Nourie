import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCurrentConditions} from '../src/weatherFusionCurrent.js';
import {createExposureWeatherService,normalizeExposureWeather} from '../src/weatherFusionExposure.js';
import {normalizeAirQuality,addAirQuality,MAX_AIR_QUALITY_AGE_MS} from '../src/weatherFusionAirQuality.js';

const H=3600000,now=Date.parse('2026-10-19T16:03:00Z'),epoch=Math.floor(now/H)*H;
const location={latitude:35.787,longitude:-78.4806};
const observation={type:'observation',station:'TEST',temperature:59,apparent:71,time:new Date(now-20*60000).toISOString(),stationDistanceKm:25};
const currentHour={time:new Date(epoch).toISOString(),temperature:60,condition:'Sunny',apparent:54};

test('an unverified station distance cannot bypass observation freshness and local-source checks',()=>{
 for(const distance of [undefined,null,-1,Infinity]){
  const current=validateCurrentConditions({...observation,stationDistanceKm:distance},[currentHour],{},now);
  assert.equal(current.type,'guidance');
  assert.equal(current.sourceValidation.accepted,false);
  assert.equal(current.sourceValidation.stationDistanceKm,null);
  assert.match(current.sourceValidation.reason,/distance could not be verified/);
 }
});

test('future or expired hourly forecasts cannot be relabelled as current weather',()=>{
 for(const time of [epoch+H,epoch-H]){
  const current=validateCurrentConditions(observation,[{...currentHour,time:new Date(time).toISOString()}],{},now);
  assert.equal(current.type,'unavailable');
  assert.equal(current.temperature,null);
  assert.equal(current.apparent,null);
 }
});

test('rejected source apparent temperature cannot leak into selected-location guidance',()=>{
 const model={nbm:[{time:epoch,temperature_2m:60,dew_point_2m:42,wind_speed_10m:11}]};
 const current=validateCurrentConditions(observation,[currentHour],model,now);
 assert.equal(current.type,'guidance');
 assert.equal(current.apparent,54);
 assert.equal(current.apparentSource,'Selected-location current-hour estimate');
 const noApparent=validateCurrentConditions(observation,[{...currentHour,apparent:null}],model,now);
 assert.equal(noApparent.apparent,null);
 assert.equal(noApparent.apparentSource,'Unavailable');
});

function exposurePayload(at=epoch){
 const time=Array.from({length:120},(_,i)=>(at-48*H+i*H)/1000),field=value=>time.map(()=>value);
 return {timezone:'America/New_York',hourly_units:{temperature_2m:'°F',wind_speed_10m:'mp/h',shortwave_radiation_instant:'W/m²',dew_point_2m:'°F',relative_humidity_2m:'%',cloud_cover:'%',precipitation:'mm'},hourly:{time,temperature_2m:field(59),dew_point_2m:field(42),relative_humidity_2m:field(50),wind_speed_10m:field(11),cloud_cover:field(0),shortwave_radiation_instant:field(400),precipitation:field(0),uv_index:field(5)}};
}

test('an old surface forecast cannot become fresh just because it was retrieved now',async()=>{
 const load=createExposureWeatherService({now:()=>now,request:async()=>exposurePayload(epoch-40*24*H)});
 const result=await load(location);
 assert.equal(result.value,null);
 assert.equal(result.meta.status,'unavailable');
 assert.equal(result.meta.fetchedAt,null);
});

test('surface forecasts must cover the current hour rather than just a historical or future hour',async()=>{
 for(const mutate of [raw=>{raw.hourly.time=raw.hourly.time.map(t=>t+200*3600);},raw=>{raw.hourly.temperature_2m[48]=null;}]){
  const raw=exposurePayload();mutate(raw);
  const load=createExposureWeatherService({now:()=>now,request:async()=>raw});
  assert.equal((await load(location)).meta.status,'unavailable');
 }
 const load=createExposureWeatherService({now:()=>now,request:async()=>exposurePayload()});
 assert.equal((await load(location)).meta.status,'ready');
});

test('a cached surface response is revalidated when its current-hour coverage ends',async()=>{
 const raw=exposurePayload();raw.hourly.temperature_2m[49]=null;
 let time=epoch+59*60000,calls=0;
 const load=createExposureWeatherService({now:()=>time,request:async()=>{calls++;return raw;}});
 assert.equal((await load(location)).meta.status,'ready');
 time=epoch+H+60000;
 const result=await load(location);
 assert.equal(result.value,null);
 assert.equal(result.meta.status,'unavailable');
 assert.ok(calls>1,'a cache hit without current-hour coverage must attempt a refresh');
});

test('explicitly conflicting optional surface units stay missing instead of being relabelled',()=>{
 const raw=exposurePayload();raw.hourly_units.dew_point_2m='°C';raw.hourly_units.precipitation='inch';
 const row=normalizeExposureWeather(raw).rows[48];
 assert.equal(row.dewpoint,null);assert.equal(row.rain,null);
 assert.equal(row.temperature,59);assert.equal(row.wind,11);
});

test('invalid surface percentages, negative fields and invalid date ranges stay missing',()=>{
 const raw=exposurePayload();
 for(const key of ['wind_speed_10m','shortwave_radiation_instant','precipitation','uv_index'])raw.hourly[key][48]=-1;
 raw.hourly.cloud_cover[48]=101;raw.hourly.relative_humidity_2m[48]=101;
 raw.hourly.time[0]=Number.MAX_VALUE;
 const normalized=normalizeExposureWeather(raw),row=normalized.rows.find(r=>r.time===new Date(epoch).toISOString());
 for(const key of ['wind','solar','rain','uvIndex','skyCover','humidity'])assert.equal(row[key],null,key);
 assert.equal(normalized.rows.length,119);
 assert.equal(normalizeExposureWeather({...raw,timezone:'Not/A_Timezone'}),null);
});

const aqPayload=(patch={})=>({current:{time:epoch/1000,us_aqi:28,pm2_5:3,...patch},hourly:{time:[epoch/1000,(epoch+H)/1000],us_aqi:[28,35]}});

test('AQI requires a nonnegative reading and valid timestamp',()=>{
 for(const patch of [{us_aqi:-1},{time:null},{time:'invalid'},{time:Number.MAX_VALUE}])assert.equal(normalizeAirQuality(aqPayload(patch)),null);
 const raw=aqPayload({pm2_5:-1});raw.hourly.us_aqi[1]=-1;
 const aq=normalizeAirQuality(raw);assert.equal(aq.pm25,null);assert.equal(aq.hours[1].aqi,null);
});

test('stale and future-dated air quality cannot be shown as current local AQI',()=>{
 for(const reportedAt of [now-MAX_AIR_QUALITY_AGE_MS-1,now+5*60000+1]){
  const out={assembledAt:new Date(now).toISOString()};
  addAirQuality(out,normalizeAirQuality(aqPayload({time:reportedAt/1000})));
  assert.equal(out.airQuality,null);
 }
 const out={assembledAt:new Date(now).toISOString()};addAirQuality(out,normalizeAirQuality(aqPayload()));
 assert.equal(out.airQuality.aqi,28);
});

test('the next 24-hour AQI peak excludes the following window boundary',()=>{
 const aq=normalizeAirQuality(aqPayload());
 aq.hours=[{time:new Date(now).toISOString(),aqi:28},{time:new Date(now+23*H).toISOString(),aqi:40},{time:new Date(now+24*H).toISOString(),aqi:150}];
 const out={assembledAt:new Date(now).toISOString()};addAirQuality(out,aq);
 assert.equal(out.airQuality.next24HourPeak,40);
});
