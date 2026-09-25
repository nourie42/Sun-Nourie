import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerWeatherComparisonRoutes} from '../src/weatherComparison.js';
import {feedFixture,now} from './weatherComparisonData.test.js';
import {locationPoint} from '../src/weatherNextLocation.js';

const password='test-only-not-a-deployed-password',origin='https://weather.example';
async function server(t,options={}){
 const app=express();registerWeatherComparisonRoutes(app,{feedProvider:async()=>feedFixture(),companionProvider:async()=>({}),now:()=>now,accessOptions:{password,origin},...options});
 const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));t.after(()=>s.close());
 const base='http://127.0.0.1:'+s.address().port;
 const post=(path,body,cookie='',from=origin)=>fetch(base+'/api/weather-fusion/compare/'+path,{method:'POST',headers:{Origin:from,'X-WeatherNext-Request':'1','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
 return {base,post,unlock:async()=>{const r=await post('unlock',{password});assert.equal(r.status,200);return r.headers.get('set-cookie');}};
}
test('uncached GET and unauthorized POST cannot invoke a paid location lookup',async t=>{
 let calls=0;const {base,post}=await server(t,{locationProvider:{configured:true,lookup:async()=>{calls++;}}});
 assert.equal((await fetch(base+'/api/weather-fusion/compare/google?latitude=36&longitude=-79')).status,401);
 assert.equal((await post('location',{latitude:36,longitude:-79})).status,401);
 assert.equal((await post('unlock',{password:'wrong'})).status,401);assert.equal(calls,0);
});
test('password sessions use protected cookies; cross-origin attempts cannot unlock or query',async t=>{
 const {post,unlock}=await server(t);assert.equal((await post('unlock',{password},'','https://attacker.example')).status,403);
 const cookie=await unlock();assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
 assert.equal((await post('location',{latitude:36,longitude:-79},cookie,'https://attacker.example')).status,403);
});
test('missing password or backend configuration fails closed',async t=>{
 const first=await server(t,{accessOptions:{password:'',origin}});assert.equal((await first.post('unlock',{password})).status,503);
 const second=await server(t,{locationProvider:{configured:false}});const cookie=await second.unlock();
 const response=await second.post('location',{latitude:36,longitude:-79},cookie);assert.equal(response.status,503);assert.equal((await response.json()).code,'SETUP_REQUIRED');
});
test('authorized location is exact, concurrent requests deduplicate, public reads reuse cache',async t=>{
 let calls=0;
 const provider={configured:true,lookup:async point=>{calls++;await new Promise(r=>setTimeout(r,30));const feed=feedFixture();const p={...point,name:'Requested city',timeZone:'America/New_York'};feed.points=[p];for(const source of Object.values(feed.sources))source.points=source.points.map(row=>({...row,...p}));return feed;}};
 const {base,post,unlock}=await server(t,{locationProvider:provider});const cookie=await unlock();
 const responses=await Promise.all([post('location',{latitude:36,longitude:-79},cookie),post('location',{latitude:36,longitude:-79},cookie)]);
 assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(calls,1);
 const data=await (await fetch(base+'/api/weather-fusion/compare/google?latitude=36&longitude=-79')).json();
 assert.equal(data.location.latitude,36);assert.equal(data.location.longitude,-79);assert.equal(calls,1);
 assert.equal((await fetch(base+'/api/weather-fusion/compare/google?latitude=36.1&longitude=-79')).status,401);assert.equal(calls,1);
});
test('provider cannot substitute a different location',async t=>{
 const {post,unlock}=await server(t,{locationProvider:{configured:true,lookup:async()=>feedFixture()}});
 const r=await post('location',{latitude:36,longitude:-79},await unlock());assert.equal(r.status,503);
});
test('expired sessions and repeated incorrect passwords are rejected',async t=>{
 let clock=now;const {base,post,unlock}=await server(t,{now:()=>clock});const cookie=await unlock();
 clock+=25*3600000;
 assert.equal((await post('location',{latitude:36,longitude:-79},cookie)).status,401);
 for(let i=0;i<8;i++)assert.equal((await post('unlock',{password:'wrong'})).status,401);
 assert.equal((await post('unlock',{password})).status,429);
 const response=await fetch(base+'/api/weather-fusion/compare/access');assert.equal((await response.json()).unlocked,false);
});
test('coordinates reject empty, malformed, arrays and unsupported regions',()=>{
 for(const query of [{},{latitude:'',longitude:-79},{latitude:['36'],longitude:-79},{latitude:Infinity,longitude:0},{latitude:60,longitude:10}])assert.throws(()=>locationPoint(query));
 assert.equal(locationPoint({latitude:36.123456,longitude:-79}).latitude,36.123456);
});
test('main banner says password required without exposing the secret; preset forecasts stay public',async t=>{
 const {base}=await server(t);const html=await (await fetch(base+'/weather-fusion/')).text();
 assert.match(html,/aria-label="Password required">Password required/);assert.ok(!html.includes(password));
 assert.equal((await fetch(base+'/api/weather-fusion/compare/google?location=knightdale')).status,200);
});
