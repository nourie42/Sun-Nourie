import test from 'node:test';
import assert from 'node:assert/strict';
import {comfortSceneState,precipitationActivity,referenceScene} from '../public/weather-fusion/exposure-scene.js';
import {pavementHTML,pavementEstimate} from '../public/weather-fusion/pavement.js';

test('illustrated weather stays synchronized across outdoor and pet scenes',()=>{
 const shadedRain=referenceScene(0,true,'Rain',88);
 assert.match(shadedRain,/sheltering beneath a leafy tree as steady rain falls nearby/);
 assert.doesNotMatch(shadedRain,/using rain gear and an umbrella/);
 for(const panel of [1,2]){
  assert.match(referenceScene(panel,true,'Clear',88),/data-scene="hot"/);
  assert.match(referenceScene(panel,true,'Clear',88),/comfort-reference-scenes-hot\.webp/);
  assert.doesNotMatch(referenceScene(panel,false,'Clear',88),/class="sky-sun"/);
  assert.match(referenceScene(panel,false,'Clear',88),/comfort-reference-scenes-dawn\.webp/);
  assert.match(referenceScene(panel,true,'Rain',88),/data-scene="rain"/);
  assert.match(referenceScene(panel,true,'Rain',88),/comfort-reference-scenes-rain\.webp/);
  assert.doesNotMatch(referenceScene(panel,true,'Rain',88),/class="sky-sun"/);
  if(panel===2){
   assert.match(referenceScene(panel,true,'Rain',88),/dog shakes rainwater from its fur/);
   assert.doesNotMatch(referenceScene(panel,true,'Rain',88),/data-pet-motion=|pet-rain-shake/,'the shake-off is a still image, not an animation layer');
  }
 }
 assert.doesNotMatch(referenceScene(2,true,'Clear',88),/data-pet-motion=/,'dry pet scenes stay still');
 assert.doesNotMatch(referenceScene(2,true,'Chance Showers',88,{pop:50}),/data-pet-motion=/,'umbrella-only scenes stay still');
 assert.match(referenceScene(1,true,'Clear',70),/class="sky-sun"/);
 assert.match(referenceScene(1,true,'Snow',30),/data-scene="cold"/);
 assert.match(referenceScene(1,true,'Clear',30),/comfort-reference-scenes-cold\.webp/);
 assert.deepEqual(comfortSceneState(true,'Clear',95),{key:'hot',asset:'comfort-reference-scenes-hot.webp'});
 assert.deepEqual(comfortSceneState(true,'Thunderstorms',95),{key:'rain',asset:'comfort-reference-scenes-rain.webp'},'observed rain without a probability takes precedence over heat');
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
 assert.equal(precipitationActivity('Chance Showers',{pop:19}),'none');
 assert.equal(precipitationActivity('Slight Chance Showers',{pop:20,precipitation:.2}),'possible');
 assert.equal(precipitationActivity('Chance Showers',{pop:49,precipitation:.2}),'possible');
 assert.equal(precipitationActivity('Chance Showers',{pop:50}),'possible');
 assert.equal(precipitationActivity('Chance Showers',{pop:80}),'possible');
 assert.equal(precipitationActivity('Chance Showers',{pop:81}),'active');
 assert.equal(precipitationActivity('Rain',{pop:20}),'possible');
 assert.equal(precipitationActivity('Fog',{pop:19}),'none');
 assert.equal(precipitationActivity('Fog',{pop:48}),'possible');
 assert.equal(precipitationActivity('Fog',{pop:100}),'active');
 assert.equal(precipitationActivity('Cloudy',{pop:0,radarThreat:true}),'active');
 assert.equal(precipitationActivity('Rain',{}),'active');
 assert.deepEqual(comfortSceneState(true,'Foggy',77,{pop:0}),{key:'fog',asset:'comfort-reference-scenes-fog.webp'});
 assert.deepEqual(comfortSceneState(true,'Foggy',77,{pop:48}),{key:'carry-umbrella',asset:'comfort-reference-scenes-carry-umbrella.svg'});
 assert.deepEqual(comfortSceneState(true,'Foggy',77,{pop:80}),{key:'carry-umbrella',asset:'comfort-reference-scenes-carry-umbrella.svg'});
 assert.deepEqual(comfortSceneState(true,'Foggy',77,{pop:81}),{key:'rain',asset:'comfort-reference-scenes-rain.webp'});
 assert.deepEqual(comfortSceneState(true,'Cloudy',77,{pop:0,rainAround:true}),{key:'rain',asset:'comfort-reference-scenes-rain.webp'});
 assert.deepEqual(comfortSceneState(true,'Rain',35,{pop:100}),{key:'rain',asset:'comfort-reference-scenes-rain.webp'},'active rain takes precedence over generic cold styling');
 assert.deepEqual(comfortSceneState(true,'Slight Chance Thunderstorms',92,{pop:20}),{key:'carry-umbrella',asset:'comfort-reference-scenes-carry-umbrella.svg'});
 assert.deepEqual(comfortSceneState(true,'Chance Showers',70,{pop:49}),{key:'carry-umbrella',asset:'comfort-reference-scenes-carry-umbrella.svg'});
 assert.deepEqual(comfortSceneState(true,'Chance Thunderstorms',92,{pop:50}),{key:'carry-umbrella',asset:'comfort-reference-scenes-carry-umbrella.svg'});
 assert.deepEqual(comfortSceneState(true,'Slight Chance Thunderstorms',92,{pop:80}),{key:'carry-umbrella',asset:'comfort-reference-scenes-carry-umbrella.svg'});
 assert.deepEqual(comfortSceneState(true,'Slight Chance Thunderstorms',92,{pop:81}),{key:'rain',asset:'comfort-reference-scenes-rain.webp'});
 assert.deepEqual(comfortSceneState(false,'Clear',92,{pop:0}),{key:'dawn',asset:'comfort-reference-scenes-dawn.webp'});
});

test('active rain pauses pavement heat warnings',()=>{
 const result={status:'estimated',activePrecipitation:true,concrete:{value:110,high:140},asphalt:{value:118,high:145}};
 assert.equal(pavementHTML(result,92,{condition:'Rain'}).includes('Hot pavement possible'),false);
 assert.match(pavementHTML(result,92,{condition:'Rain'}),/Wet pavement · heat warning paused/);
});
test('live radar threat forces rainy pet art and pauses pavement heat warnings',()=>{
 const result={status:'estimated',activePrecipitation:false,daylight:true,concrete:{value:110,high:140},asphalt:{value:118,high:145}};
 const html=pavementHTML(result,92,{condition:'Cloudy',pop:0,radarThreat:true,rainAround:true});
 assert.match(html,/Wet pavement · heat warning paused/);
 assert.match(html,/data-scene="rain"/);
 assert.doesNotMatch(html,/comfort-reference-scenes-hot\.webp|Hot pavement possible/);
});

test('dry radar state never renders rain artwork or a wet-pavement claim',()=>{
 const scene=referenceScene(1,false,'Partly cloudy',82,{pop:0});
 assert.match(scene,/data-scene="dawn"/);
 assert.doesNotMatch(scene,/comfort-reference-scenes-(rain|umbrella)\.webp/);
 const pavement=pavementHTML({status:'estimated',activePrecipitation:false,daylight:false,concrete:{value:82},asphalt:{value:84}},82,{condition:'Partly cloudy',pop:0});
 assert.doesNotMatch(pavement,/Wet pavement|Rain occurring|data-scene="rain"/);
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
