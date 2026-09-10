import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceScene} from '../public/weather-fusion/exposure-scene.js';
import {pavementHTML,pavementEstimate} from '../public/weather-fusion/pavement.js';

test('illustrated weather stays synchronized across outdoor and pet scenes',()=>{
 for(const panel of [1,2]){
  assert.match(referenceScene(panel,true,'Clear',88),/class="sky-sun"/);
  assert.doesNotMatch(referenceScene(panel,false,'Clear',88),/class="sky-sun"/);
  assert.match(referenceScene(panel,false,'Clear',88),/class="sky-moon"/);
  assert.match(referenceScene(panel,true,'Rain',88),/class="sky-rain"/);
  assert.doesNotMatch(referenceScene(panel,true,'Rain',88),/class="sky-sun"/);
 }
 assert.equal(referenceScene(1,true,'Snow',30),null,'cold-weather outfits remain available');
 const html=pavementHTML({status:'unavailable',daylight:false},88,{forecast:true,condition:'Rain'});
 assert.match(html,/at the selected forecast hour/);
 assert.match(html,/sky-rain/);
 assert.doesNotMatch(html,/sky-sun|Paw burn risk/);
 const cold=pavementHTML({status:'unavailable',daylight:true},30,{condition:'Snow'});
 assert.match(cold,/sky-snow/);
 assert.doesNotMatch(cold,/class="sky-sun"/);
});

test('forecast pavement uses the selected hour while freshness uses the actual update time',()=>{
 const now=Date.parse('2026-09-10T18:00:00Z'),H=3600000;
 const f={assembledAt:new Date(now).toISOString(),location:{latitude:35.78,longitude:-78.48},exposureWeather:{rows:Array.from({length:61},(_,i)=>({time:new Date(now+(i-48)*H).toISOString(),temperature:85,dewpoint:65,wind:5,skyCover:10}))}};
 const current={temperature:85,dewpoint:65,wind:5,skyCover:10};
 const future=pavementEstimate(f,current,now+10*H,{checkedAt:now});
 assert.equal(future.status,'estimated');
 assert.equal(future.time,new Date(now+10*H).toISOString());
 assert.equal(future.daylight,false);
 assert.equal(pavementEstimate(f,current,now+10*H,{checkedAt:now+2*H}).status,'unavailable','stale feeds cannot masquerade as a fresh forecast');
 assert.equal(pavementEstimate(f,current,now+20*H,{checkedAt:now}).status,'unavailable','missing forecast coverage stays unavailable');
});
