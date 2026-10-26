import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFileSync} from 'node:fs';
import {registerWeatherComparisonRoutes} from '../src/weatherComparison.js';
import {createWeatherNextMapSource,validateWeatherNextMaps,WEATHERNEXT_MAPS_SCHEMA,MAP_BOUNDS} from '../src/weatherNextMaps.js';
import {catalogFixture,runAt,now,HOUR} from './weatherNextMapsFixture.js';
import {feedFixture} from './weatherComparisonData.test.js';


test('a good catalog becomes absolute, ordered, time-checked frames',()=>{
 const out=validateWeatherNextMaps(catalogFixture(),now);
 assert.equal(out.status,'ready');
 assert.deepEqual(Object.keys(out.layers).sort(),['precipitation','temperature']);
 const t=out.layers.temperature;
 assert.equal(t.frames[0].url,'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/weathernext-maps/wn3-2026102512-temperature-009.png');
 assert.deepEqual(t.frames.map(f=>f.hour).slice(0,3),[9,12,15]);
 assert.equal(t.frames.at(-1).hour,48);
 assert.deepEqual(t.frames[0].bounds,MAP_BOUNDS);
 assert.equal(t.legend.colors.length,t.legend.thresholds.length+1);
 assert.equal(out.model,'Google WeatherNext 3');
 assert.equal(out.statistic,'ensemble mean');
});

test('frames that are in the past, mismatched or unsafe are dropped, never trusted',()=>{
 const c=catalogFixture();
 const files=c.layers.temperature.frames,good=files.find(f=>f.hour===15);
 const before=validateWeatherNextMaps(catalogFixture(),now).layers.temperature.frames.length;
 files.push({...good,file:'weathernext-maps/../server.js'});
 files.push({...good,file:'weathernext-maps/wn3-2026102506-temperature-015.png'});
 files.push({...good,hour:99});
 files.push({...good,file:'weathernext-maps/wn3-2026102512-wind-015.png'});
 files.push({...good,bounds:[[0,0],[1,1]]});
 files.push({...good,time:new Date(runAt+16*HOUR).toISOString()});
 files.push({...good,field:'wind'});
 files.push({file:'weathernext-maps/wn3-2026102512-temperature-001.png',hour:1,time:new Date(runAt+HOUR).toISOString(),bounds:MAP_BOUNDS,field:'temperature'});
 const out=validateWeatherNextMaps(c,now);
 assert.equal(out.layers.temperature.frames.length,before);
 assert.deepEqual(out.layers.temperature.frames.map(f=>f.hour).slice(0,3),[9,12,15]);
 assert.ok(out.layers.temperature.frames.every(f=>f.url.startsWith('https://raw.githubusercontent.com/')));
});

test('layers with a damaged legend or no frames are omitted instead of guessed',()=>{
 const c=catalogFixture();
 c.layers.temperature.legend.colors.pop();
 const out=validateWeatherNextMaps(c,now);
 assert.equal(out.layers.temperature,undefined);
 assert.ok(out.layers.precipitation);
 const bad=catalogFixture();
 bad.layers.precipitation.legend.colors[0]='url(javascript:alert(1))';
 bad.layers.temperature.frames=[];
 const none=validateWeatherNextMaps(bad,now);
 assert.equal(none.status,'unavailable');
 assert.deepEqual(none.layers,{});
});

test('wrong schema, bounds, or future initialization time are rejected',()=>{
 assert.throws(()=>validateWeatherNextMaps({...catalogFixture(),schema:'other'},now),/Unrecognized/);
 assert.throws(()=>validateWeatherNextMaps({...catalogFixture(),bounds:[[0,0],[1,1]]},now),/bounds/);
 assert.throws(()=>validateWeatherNextMaps({...catalogFixture(),runAt:new Date(now+5*HOUR).toISOString()},now),/initialization/);
 assert.throws(()=>validateWeatherNextMaps({...catalogFixture(),runAt:'2026-10-25T12:30:00Z'},now),/initialization/);
});

test('old runs are labelled stale, then unavailable',()=>{
 const fresh=validateWeatherNextMaps(catalogFixture(),runAt+10*HOUR);
 assert.equal(fresh.status,'ready');
 const stale=validateWeatherNextMaps(catalogFixture(),runAt+40*HOUR);
 assert.equal(stale.status,'stale');
 assert.match(stale.message,/36 hours/);
 const dead=validateWeatherNextMaps(catalogFixture(),runAt+100*HOUR);
 assert.equal(dead.status,'unavailable');
});

test('source caches, reports not-published for 404, and keeps the last verified run on a blip',async()=>{
 let calls=0,mode='ok',clock=now;
 const fetchImpl=async()=>{calls++;
  if(mode==='404')return new Response('',{status:404});
  if(mode==='boom')throw new Error('network down');
  if(mode==='big')return new Response('x'.repeat(700000),{status:200});
  return new Response(JSON.stringify(catalogFixture()),{status:200});};
 const source=createWeatherNextMapSource({fetchImpl,now:()=>clock,ttlMs:300000});
 const first=await source();assert.equal(first.status,'ready');
 await source();assert.equal(calls,1,'second call within the TTL is served from cache');
 clock+=301000;mode='boom';
 const kept=await source();
 assert.equal(kept.status,'last-verified');assert.ok(kept.layers.temperature);assert.match(kept.message,/last verified/);
 clock+=7*HOUR;
 const gone=await source();
 assert.equal(gone.status,'unavailable');assert.deepEqual(gone.layers,{});

 mode='404';clock+=10*60000;
 const fresh=createWeatherNextMapSource({fetchImpl,now:()=>clock});
 const missing=await fresh();assert.equal(missing.status,'not-published');assert.deepEqual(missing.layers,{});

 mode='big';
 const oversized=await createWeatherNextMapSource({fetchImpl,now:()=>clock})();
 assert.equal(oversized.status,'unavailable');
});

test('concurrent requests share one catalog fetch',async()=>{
 let calls=0;
 const source=createWeatherNextMapSource({fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,20));return new Response(JSON.stringify(catalogFixture()),{status:200});},now:()=>now});
 const results=await Promise.all([source(),source(),source()]);
 assert.equal(calls,1);
 assert.ok(results.every(r=>r.status==='ready'));
});

test('API route serves the validated catalog uncached, and the browser files are reachable',async t=>{
 const app=express();
 registerWeatherComparisonRoutes(app,{feedProvider:async()=>feedFixture(),now:()=>now,companionProvider:async()=>({}),mapsProvider:async()=>validateWeatherNextMaps(catalogFixture(),now)});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 const api=await fetch(base+'/api/weather-fusion/weathernext-maps');
 assert.equal(api.status,200);assert.match(api.headers.get('cache-control'),/no-store/);
 const body=await api.json();
 assert.equal(body.schema,WEATHERNEXT_MAPS_SCHEMA);assert.equal(body.status,'ready');
 for(const name of ['weathernext-maps.js','weathernext-maps.css']){
  const r=await fetch(base+'/weather-fusion/'+name);
  assert.equal(r.status,200,name);
  assert.ok((await r.text()).length>500,name);
 }
});

test('the forecast page still loads when the map module is missing (dynamic import, guarded)',()=>{
 const bridge=readFileSync('public/weather-fusion/compare-bridge.js','utf8');
 assert.doesNotMatch(bridge,/^import .*weathernext-maps/m,'a static import would let a map error take down the forecast');
 assert.match(bridge,/await import\('\/weather-fusion\/weathernext-maps\.js/);
 assert.match(bridge,/catch\(error\)\{[^}]*console\.error/);
});

test('map markup avoids the original page\'s ids and data-layer hooks',()=>{
 const source=readFileSync('public/weather-fusion/weathernext-maps.js','utf8');
 assert.doesNotMatch(source,/data-layer=/);
 const ids=[...source.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 assert.ok(ids.length>8);
 assert.ok(ids.every(id=>id.startsWith('wn-')),ids.join(','));
 const appIds=new Set([...readFileSync('public/weather-fusion/index.html','utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
 assert.deepEqual(ids.filter(id=>appIds.has(id)),[]);
});
