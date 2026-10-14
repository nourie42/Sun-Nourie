import test from 'node:test';
import assert from 'node:assert/strict';
import {Cache} from '../src/weatherFusion.js';
import {retainOfficialFeed,criticalOfficialUrl,validateOfficialPayload} from '../src/weatherFusionOfficialRecovery.js';
const M=60000,H=60*M,start=Date.parse('2026-10-14T15:00:00Z');
const url='https://api.weather.gov/gridpoints/RAH/80,58/forecast/hourly';
const envelope=()=>({fetchedAt:new Date(start).toISOString(),data:{properties:{periods:[{startTime:new Date(start).toISOString(),endTime:new Date(start+H).toISOString(),temperature:77,shortForecast:'Sunny'}]}}});
test('official refresh failure retains verified future guidance without resetting its age',async()=>{
 let now=start,attempts=0;const cache=new Cache(5,()=>now),saved=envelope();
 await cache.get(url,2*M,async()=>saved);now+=3*M;
 const onError=(error,value)=>{if(!retainOfficialFeed(url,value,now))throw error;return {...value,recovered:true};};
 const load=async()=>{attempts++;throw new Error('NWS temporary outage');};
 const first=await cache.get(url,2*M,load,{onError});assert.equal(first.recovered,true);assert.equal(first.fetchedAt,saved.fetchedAt);
 now+=M;const second=await cache.get(url,2*M,load,{onError});assert.equal(second.fetchedAt,saved.fetchedAt);assert.equal(attempts,2,'failed refreshes cannot turn stale data into a fresh cache hit');
 now=start+31*M;await assert.rejects(cache.get(url,2*M,load,{onError}),/temporary outage/);
});
test('expired, unverified or non-official data cannot become retained official guidance',()=>{
 const saved=envelope();assert.equal(retainOfficialFeed(url,saved,start+5*M),true);
 assert.equal(retainOfficialFeed(url,saved,start+H),false);
 assert.equal(retainOfficialFeed(url,{...saved,fetchedAt:null},start),false);
 assert.equal(retainOfficialFeed('https://external.invalid/forecast',saved,start+M),false);
 assert.equal(retainOfficialFeed(url,{...saved,data:{properties:{periods:[]}}},start+M),false);
});
test('verified NWS location references can recover within 48 hours without adopting a guessed timezone',()=>{
 const point='https://api.weather.gov/points/47.2944,-101.6227',saved={fetchedAt:new Date(start).toISOString(),data:{properties:{timeZone:'America/North_Dakota/Beulah',forecast:'https://api.weather.gov/gridpoints/BIS/50,50/forecast',forecastHourly:'https://api.weather.gov/gridpoints/BIS/50,50/forecast/hourly',forecastGridData:'https://api.weather.gov/gridpoints/BIS/50,50'}}};
 assert.equal(retainOfficialFeed(point,saved,start+25*H),true);assert.equal(retainOfficialFeed(point,saved,start+49*H),false);
 saved.data.properties.forecast='https://external.invalid/forecast';assert.equal(retainOfficialFeed(point,saved,start+H),false);
});
test('malformed successful responses cannot replace the last verified forecast',async()=>{
 let now=start;const cache=new Cache(5,()=>now),saved=envelope();await cache.get(url,M,async()=>saved);now+=2*M;
 const bad={properties:{periods:[]}};assert.throws(()=>validateOfficialPayload(url,bad),/usable periods/);
 const recovered=await cache.get(url,M,async()=>{validateOfficialPayload(url,bad);return {data:bad,fetchedAt:new Date(now).toISOString()};},{onError:(error,value)=>{assert.equal(retainOfficialFeed(url,value,now),true);return value;}});
 assert.deepEqual(recovered,saved);
});
test('official request capacity is independent of saturated optional sources',async()=>{
 const optional=new Cache(60),official=new Cache(5);let release;const gate=new Promise(resolve=>release=resolve);
 const pending=Array.from({length:50},(_,i)=>optional.get(`optional-${i}`,M,()=>gate));
 await assert.rejects(optional.get('extra',M,async()=>true),/busy/);
 assert.equal(criticalOfficialUrl(url),true);assert.equal(criticalOfficialUrl('https://api.open-meteo.com/v1/forecast'),false);
 assert.equal(await official.get(url,M,async()=>77),77);release(true);await Promise.all(pending);
});
