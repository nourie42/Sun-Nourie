import test from 'node:test';
import assert from 'node:assert/strict';
import {createExposureWeatherService} from '../src/weatherFusionExposure.js';
const H=3600000,start=Date.parse('2026-10-16T08:00:00Z'),location={latitude:35.7871,longitude:-78.481};
function payload(){
 const time=Array.from({length:120},(_,i)=>(start-48*H+i*H)/1000),field=value=>time.map(()=>value);
 return {timezone:'America/New_York',hourly_units:{temperature_2m:'°F',wind_speed_10m:'mp/h',shortwave_radiation_instant:'W/m²',weather_code:'wmo code'},hourly:{time,temperature_2m:field(82),dew_point_2m:field(65),relative_humidity_2m:field(55),wind_speed_10m:field(10),cloud_cover:field(5),shortwave_radiation_instant:field(600),precipitation:field(0),uv_index:field(5),weather_code:field(0)},daily:{time:[start/1000],uv_index_max:[6]}};
}
test('surface/UV data retries a transient failed request before making sunny pavement unavailable',async()=>{
 let calls=0;const load=createExposureWeatherService({now:()=>start,request:async()=>{if(++calls===1)throw new Error('Source returned HTTP 503.');return payload();}});
 const f=await load(location);assert.equal(calls,2);assert.equal(f.meta.status,'ready');assert.equal(f.value.rows[48].temperature,82);assert.equal(f.value.rows[48].uvIndex,5);
});
test('a brief outage preserves verified pavement history and UV without pretending it was freshly fetched',async()=>{
 let time=start,fail=false,calls=0;const load=createExposureWeatherService({now:()=>time,request:async()=>{calls++;if(fail)throw new Error('Source returned HTTP 503.');return payload();}});
 const first=await load(location);fail=true;time+=31*60000;const next=await load(location);
 assert.equal(next.meta.status,'stale');assert.equal(next.meta.recovered,true);assert.equal(next.meta.fetchedAt,first.meta.fetchedAt);assert.notEqual(next.meta.checkedAt,first.meta.checkedAt);assert.deepEqual(next.value.rows,first.value.rows);assert.equal(calls,3);
 time=start+6*H+1;const expired=await load(location);assert.equal(expired.value,null);assert.equal(expired.meta.status,'unavailable');
});
test('cached sunny weather survives traffic and concurrent requests without extra provider calls',async()=>{
 let calls=0;const load=createExposureWeatherService({now:()=>start,request:async()=>{calls++;return payload();}});
 const values=await Promise.all(Array.from({length:12},()=>load(location)));
 assert.equal(calls,1);assert.ok(values.every(r=>r.meta.status==='ready'));await load(location);assert.equal(calls,1);
});
test('missing history, provider throttling, and other coordinates never fabricate surface temperatures or UV',async()=>{
 let calls=0;const load=createExposureWeatherService({now:()=>start,request:async url=>{calls++;if(new URL(url).searchParams.get('latitude')!=='35.7871')throw new Error('Source returned HTTP 429.');return payload();}});
 await load(location);const other=await load({latitude:47.2944,longitude:-101.6227});assert.equal(other.value,null);assert.equal(other.meta.status,'unavailable');assert.equal(calls,2);
 const bad=createExposureWeatherService({now:()=>start,request:async()=>({...payload(),hourly:{time:[]}})});
 assert.equal((await bad(location)).value,null);
});
