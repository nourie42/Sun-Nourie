import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDirectModels} from '../src/weatherFusionDirect.js';
import {validateCoordinates} from '../src/weatherFusion.js';
const now=Date.parse('2026-09-01T12:00:00Z');
const location={latitude:35.787,longitude:-78.4806};

test('coordinate validation is finite, bounded, and rejects coercion and arrays',()=>{
 for(const point of [[35.7,-78.4],[0,0],[-90,180],[90,-180]])assert.deepEqual(validateCoordinates(...point),point);
 for(const point of [[91,0],[-91,0],[0,181],[0,-181],[NaN,0],[Infinity,0],['35',-78],[[35],-78],[35,null]])assert.throws(()=>validateCoordinates(...point));
});
test('direct NOAA/ECMWF source requires exact complete provider inputs',async()=>{
 let count=0;
 const service=createDirectModels({now:()=>now,fetchImpl:async url=>{
  count++;
  if(String(url).includes('nomads'))return new Response('not-a-grib',{status:200,headers:{'Content-Type':'application/octet-stream'}});
  return new Response('missing',{status:404});
 }});
 const result=await service.load('hrrr',location);assert.equal(result.meta.status,'unavailable');assert.equal(result.meta.contributes,false);assert.ok(count>0);
});
test('expired or absent direct feeds do not manufacture a model value',async()=>{
 const s=createDirectModels({now:()=>now,fetchImpl:async()=>new Response('missing',{status:404})});
 const result=await s.load('hrrr',location);assert.equal(result.meta.status,'unavailable');assert.equal(result.meta.contributes,false);
});
test('no embedded model webpages or cosmetic feed-health replacements remain',()=>{
 const html=fs.readFileSync(new URL('../public/weather-fusion/index.html',import.meta.url),'utf8');
 const js=fs.readFileSync(new URL('../public/weather-fusion/app.js',import.meta.url),'utf8');
 assert.ok(!html.includes('<iframe'));assert.ok(!html.includes('MutationObserver'));
 assert.ok(!js.includes('embed.windy'));assert.ok(js.includes('L.imageOverlay')||js.includes('window.L.imageOverlay'));
 assert.ok(js.includes("api('models')"));
});
test('Weather Nourie keeps thermal qualifications at the bottom, without a fetch interceptor',()=>{
 const html=fs.readFileSync(new URL('../public/weather-fusion/index.html',import.meta.url),'utf8');
 const math=fs.readFileSync(new URL('../public/weather-fusion/weather-math.js',import.meta.url),'utf8');
 assert.match(html,/Weather <b>Nourie<\/b>/);
 assert.ok(!html.includes('Back to Sun-Nourie'));assert.ok(!html.includes('Weather Fusion'));
 assert.ok(!html.includes('originalFetch'));
 assert.match(html,/How does it feel outside right now/);
 assert.ok(html.indexOf('id="scientific-stuff"')>html.indexOf('id="metrics"'));
 assert.match(html,/not measured sunlight/);assert.match(html,/not a claim that a person/);
 assert.ok(!math.includes('NWS wind chill'));assert.ok(!math.includes('NWS heat index'));
 assert.match(math,/UTCI Tier-3 fallback/);assert.match(math,/tier3FeelsLike/);
 assert.match(html,/One all-season fallback/);assert.match(html,/Stull approximation/);
});
