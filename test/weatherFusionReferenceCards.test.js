import test from 'node:test';
import assert from 'node:assert/strict';
import {comfortSceneState,precipitationActivity,referenceScene} from '../public/weather-fusion/exposure-scene.js';
import {pavementHTML,pavementEstimate} from '../public/weather-fusion/pavement.js';

test('illustrated weather stays synchronized across outdoor and pet scenes',()=>{
 for(const panel of [1,2]){
  assert.match(referenceScene(panel,true,'Clear',88),/data-scene="hot"/);
  assert.match(referenceScene(panel,true,'Clear',88),/comfort-reference-scenes-hot\.webp/);
  assert.doesNotMatch(referenceScene(panel,false,'Clear',88),/class="sky-sun"/);
  assert.match(referenceScene(panel,false,'Clear',88),/comfort-reference-scenes-dawn\.webp/);
  assert.match(referenceScene(panel,true,'Rain',88),/data-scene="rain"/);
  assert.match(referenceScene(panel,true,'Rain',88),/comfort-reference-scenes-rain\.webp/);
  assert.doesNotMatch(referenceScene(panel,true,'Rain',88),/class="sky-sun"/);
 }
 assert.match(referenceScene(1,true,'Clear',70),/class="sky-sun"/);
 assert.match(referenceScene(1,true,'Snow',30),/data-scene="cold"/);
 assert.match(referenceScene(1,true,'Clear',30),/comfort-reference-scenes-cold\.webp/);
 assert.deepEqual(comfortSceneState(true,'Clear',95),{key:'hot',asset:'comfort-reference-scenes-hot.webp'});
 assert.deepEqual(comfortSceneState(true,'Thunderstorms',95),{key:'rain',asset:'comfort-reference-scenes-rain.webp'},'actual weather takes precedence over heat');
 assert.deepEqual(comfortSceneState(false,'Clear',95),{key:'dawn',asset:'comfort-reference-scenes-dawn.webp'},'night uses visible pre-sunrise art, never a daytime heat-sun scene');
 const html=pavementHTML({status:'unavailable',daylight:false},88,{forecast:true,condition:'Rain'});
 assert.match(html,/at the selected forecast hour/);
 assert.match(html,/data-scene="rain"/);
 assert.doesNotMatch(html,/sky-sun|Paw burn risk/);
 const cold=pavementHTML({status:'unavailable',daylight:true},30,{condition:'Snow'});
 assert.match(cold,/data-scene="cold"/);
 assert.doesNotMatch(cold,/class="sky-sun"/);
});

test('scene policy distinguishes fog, low rain chance, active rain and pre-sunrise hours',()=>{
 assert.equal(precipitationActivity('Slight Chance Showers',{pop:20,precipitation:.01}),'possible');
 assert.equal(precipitationActivity('Chance Showers',{pop:70,precipitation:.08}),'active');
 assert.equal(precipitationActivity('Rain',{pop:20}),'active');
 assert.deepEqual(comfortSceneState(true,'Foggy',77,{pop:0}),{key:'fog',asset:'comfort-reference-scenes-fog.webp'});
 assert.deepEqual(comfortSceneState(true,'Slight Chance Thunderstorms',92,{pop:20}),{key:'watch',asset:'comfort-reference-scenes-watch.webp'});
 assert.deepEqual(comfortSceneState(true,'Slight Chance Thunderstorms',92,{pop:70}),{key:'rain',asset:'comfort-reference-scenes-rain.webp'});
 assert.deepEqual(comfortSceneState(false,'Clear',92,{pop:0}),{key:'dawn',asset:'comfort-reference-scenes-dawn.webp'});
});

test('active rain pauses pavement heat warnings',()=>{
 const result={status:'estimated',activePrecipitation:true,concrete:{value:110,high:140},asphalt:{value:118,high:145}};
 assert.equal(pavementHTML(result,92,{condition:'Rain'}).includes('Hot pavement possible'),false);
 assert.match(pavementHTML(result,92,{condition:'Rain'}),/Wet pavement · heat warning paused/);
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
