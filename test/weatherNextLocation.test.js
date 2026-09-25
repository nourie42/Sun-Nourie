import test from 'node:test';import assert from 'node:assert/strict';import {generateKeyPairSync} from 'node:crypto';
import {createWeatherNextLocationProvider,locationPoint} from '../src/weatherNextLocation.js';
const now=Date.parse('2026-09-25T12:00Z');
const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const env={WEATHERNEXT_GCP_CREDENTIALS:JSON.stringify({project_id:'test-project',client_email:'test@test-project.iam.gserviceaccount.com',private_key:key}),WEATHERNEXT_BQ_TABLE:'test-project.weather.weathernext_3_0_0_0p1deg',WEATHERNEXT_MAX_BYTES_PER_QUERY:'100000000'};
const point=locationPoint({latitude:36,longitude:-79});
const ok=data=>({ok:true,json:async()=>data});
function mock({estimate=1000,pending=false}={}){
 const calls=[];
 const rows=(values)=>({jobComplete:true,schema:{fields:Object.keys(values).map(name=>({name}))},rows:[{f:Object.values(values).map(v=>({v}))}]});
 const fetchImpl=async(url,options={})=>{
  const body=options.body&&options.headers?.['Content-Type']==='application/json'?JSON.parse(options.body):null;calls.push({url,body});
  if(url.includes('weather.gov'))return ok({properties:{timeZone:'America/New_York',relativeLocation:{properties:{city:'Test City',state:'NC'}}}});
  if(url.includes('oauth2'))return ok({access_token:'test-token',expires_in:3600});
  if(body?.dryRun)return ok({totalBytesProcessed:String(estimate)});
  if(body?.query.includes('MAX(IF'))return ok(rows({main_run:'2026-09-25T06:00:00Z',newest_run:'2026-09-25T06:00:00Z'}));
  const result=rows({run_at:'2026-09-25T06:00:00Z',valid_time:'2026-09-25T13:00:00Z',lead_hours:'7',grid_lat:'36',grid_lon:'-79',temperature_2m_mean:'300',temperature_2m_p10:'298',temperature_2m_p90:'302',total_precipitation_1hr_mean:'0',wind_speed_10m_mean:null});
  if(body&&pending)return ok({jobComplete:false,jobReference:{projectId:'test-project',jobId:'test-job'}});
  return ok(result);
 };return {calls,fetchImpl};
}
test('no configuration means no outgoing calls',async()=>{
 let calls=0;const p=createWeatherNextLocationProvider({env:{},fetchImpl:()=>{calls++;}});assert.equal(p.configured,false);await assert.rejects(p.lookup(point),/awaiting server setup/);assert.equal(calls,0);
});
test('dry-run ceiling prevents query execution',async()=>{
 const m=mock({estimate:100000001});const p=createWeatherNextLocationProvider({env,fetchImpl:m.fetchImpl,now:()=>now});await assert.rejects(p.lookup(point),/query-cost limit/);
 assert.equal(m.calls.filter(c=>c.body&&!c.body.dryRun).length,0);
});
test('parameterized queries keep actual coordinates, preserve zero and missing fields, and use maximumBytesBilled',async()=>{
 const m=mock({pending:true}),p=createWeatherNextLocationProvider({env,fetchImpl:m.fetchImpl,now:()=>now});const feed=await p.lookup(point);
 assert.equal(feed.points[0].name,'Test City, NC');assert.equal(feed.points[0].latitude,36);
 const values=feed.sources.surface.points[0].hourly[0].values;assert.equal(values.total_precipitation_1hr.mean,0);assert.equal(values.wind_speed_10m.mean,null);
 const executed=m.calls.filter(c=>c.body&&!c.body.dryRun);assert.equal(executed.length,2);
 for(const c of executed){assert.equal(c.body.maximumBytesBilled,'100000000');assert.ok(c.body.requestId);assert.equal(c.body.useLegacySql,false);}
 assert.equal(executed[1].body.queryParameters.find(p=>p.name==='latitude').parameterValue.value,'36');assert.match(executed[1].body.query,/ST_INTERSECTS/);
 assert.ok(m.calls.some(c=>c.url.includes('test-job')));
});
test('new-location requests have a global per-process hourly ceiling',async()=>{
 const m=mock(),p=createWeatherNextLocationProvider({env,fetchImpl:m.fetchImpl,now:()=>now});for(let i=0;i<3;i++)await p.lookup(point);
 const before=m.calls.length;await assert.rejects(p.lookup(point),/query limit reached/);assert.equal(m.calls.length,before);
});
test('table identifiers cannot inject SQL',()=>{
 assert.equal(createWeatherNextLocationProvider({env:{...env,WEATHERNEXT_BQ_TABLE:'bad` SQL'}}).configured,false);
});
