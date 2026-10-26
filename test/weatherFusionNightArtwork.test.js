import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {COMFORT_SCENE_ASSETS,clothingForFeels,comfortSceneState,referenceScene} from '../public/weather-fusion/exposure-scene.js';
import {comfortArtworkContext} from '../public/weather-fusion/comfort-outlook.js';
import {sunShadeHTML} from '../public/weather-fusion/personal-details.js';
import {pavementHTML} from '../public/weather-fusion/pavement.js';

const location={latitude:42.60118,longitude:-76.18048,timeZone:'America/New_York'};
const selectedTime='2026-10-17T07:00:00Z'; // Saturday 3 AM in Cortland, NY.

function assertSingleNightScene(markup,{panel,asset,row,key,outfit}){
 assert.equal((markup.match(/<svg\b/g)||[]).length,1,'one complete illustration per card');
 assert.equal((markup.match(/<image\b/g)||[]).length,1,'night skies and clothing are part of the image');
 assert.doesNotMatch(markup,/<(?:filter|path|g|rect|clipPath|circle|ellipse)\b|wardrobe-|comfort-clothing|style=/,'night is not a filter or artwork pasted over a day scene');
 assert.match(markup,new RegExp(`data-scene="${key}"`));
 assert.match(markup,new RegExp(`data-visible-outfit="${outfit}"`));
 assert.match(markup,/data-daylight="false"/);
 assert.match(markup,/nighttime illustration with no daylight/);
 assert.ok(markup.includes(asset));
 assert.match(markup,/viewBox="0 0 300 300"/);
 assert.match(markup,new RegExp(`x="${-300*panel}" y="${-300*row}" width="900" height="600"`),'each card crops exactly one panel and one weather row');
}

test('3 AM screenshot: 38-degree chance showers, feels 13, uses closed-umbrella night artwork in all three cards',()=>{
 const condition='Chance Rain Showers';
 const forecast={location,hours:[{time:selectedTime,temperature:38,condition,snowfall:.04}],snow:{snowExpected:true,days:[{date:'2026-10-17',snowExpected:true,best:4}]}};
 const sample={time:selectedTime,now:false,temperature:38,feels:13,condition,pop:14};
 const context={...comfortArtworkContext(forecast,sample),condition,pop:14,forecast:true,compact:true};
 assert.equal(context.snowExpected,false,'a daily total or coarse snow allocation cannot replace the selected liquid-rain hour');
 const pavement=pavementHTML({status:'estimated',daylight:false,concrete:{value:42},asphalt:{value:42}},sample.feels,context);
 const html=sunShadeHTML({shade:13,outdoors:13,daylight:false,weatherKind:'rain',radiantCondition:condition},location,Date.parse(selectedTime),{...context,pavement});
 const illustrations=html.match(/<svg\b[^>]*class="reference-scene[\s\S]*?<\/svg>/g)||[];
 assert.equal(illustrations.length,3,'shade, outdoor and pet cards all retain the selected hour');
 illustrations.slice(0,2).forEach((markup,panel)=>assertSingleNightScene(markup,{panel,asset:'comfort-night-cold-dry-chance.webp',row:1,key:'carry-umbrella',outfit:'cold'}));
 const pet=illustrations[2];
 assert.equal((pet.match(/<image\b/g)||[]).length,1);
 assert.match(pet,/pet-walker-night-cold-carry-umbrella\.webp/);
 assert.match(pet,/data-walker-slot="night-cold-carry-umbrella"/);
 assert.match(pet,/data-scene="carry-umbrella"/);
 assert.match(pet,/data-visible-outfit="cold"/);
 assert.match(pet,/data-daylight="false"/);
 assert.match(pet,/x="0" y="0" width="300" height="300"/);
 assert.match(pet,/style="filter:none"/,'generated night art retains its finished lighting');
 assert.doesNotMatch(pet,/<(?:filter|path|g|rect|clipPath|circle|ellipse)\b/);
 assert.match(html,/<span class="exposure-label">Night<\/span>/);
 assert.match(html,/13°/);
 assert.match(html,/Asphalt 42°/);
 assert.doesNotMatch(html,/snow-play-scene|Snow forecast|comfort-integrated-cold-carry-umbrella\.webp|comfort-integrated-cold-dawn\.webp/);
});

const outfits=[['cold',13],['cool',55],['mild',70],['warm',80],['hot',95]];
const conditions=[
 ['Clear',0,'night','dry-chance',0],
 ['Partly Cloudy',0,'night','dry-chance',0],
 ['Cloudy',0,'night','dry-chance',0],
 ['Chance Rain Showers',14,'carry-umbrella','dry-chance',1],
 ['Slight Chance Thunderstorms',38,'carry-umbrella','dry-chance',1],
 ['Rain',90,'rain','rain-fog',0],
 ['Showers And Thunderstorms',38,'rain','rain-fog',0],
 ['Freezing Rain',90,'rain','rain-fog',0],
 ['Fog',0,'fog','rain-fog',1],
];

for(const [outfit,feels] of outfits){
 test(`${outfit} weather scenes keep all night conditions distinct from the matching day art`,()=>{
  assert.equal(clothingForFeels(feels),outfit);
  for(const [condition,pop,key,group,row] of conditions){
   const context={pop,forecast:true},night=comfortSceneState(false,condition,feels,context),day=comfortSceneState(true,condition,feels,context);
   // The existing ice policy bundles people in cold-weather clothing even
   // when an inconsistent provider value reports a warmer feels-like.
   const expectedOutfit=condition==='Freezing Rain'?'cold':outfit;
   const profile=expectedOutfit==='hot'?'warm':expectedOutfit;
   const asset=`comfort-night-${profile}-${group}.webp`;
   assert.deepEqual(night,{key,asset,rows:2,row},`${condition} keeps both darkness and its precipitation state`);
   assert.notEqual(day.asset,night.asset,`${condition} cannot borrow the daytime sky at night`);
   assert.ok(COMFORT_SCENE_ASSETS.includes(asset));
   for(const panel of [0,1,2]){
    assertSingleNightScene(referenceScene(panel,false,condition,feels,context),{panel,asset,row,key,outfit:expectedOutfit});
    assert.match(referenceScene(panel,true,condition,feels,context),/data-daylight="true"/);
   }
  }
 });
}

test('night fog has its own image row and never inherits the clear moonlit or daytime fog scene',()=>{
 const fog=comfortSceneState(false,'Fog',55,{pop:0});
 const clear=comfortSceneState(false,'Clear',55,{pop:0});
 assert.notEqual(fog.asset,clear.asset);
 assert.equal(fog.row,1);
 assert.notEqual(fog.asset,comfortSceneState(true,'Fog',55,{pop:0}).asset);
 for(const panel of [0,1,2]){
  const html=referenceScene(panel,false,'Fog',55,{pop:0});
  assert.match(html,/diffuse fog with no direct sunlight/);
  assertSingleNightScene(html,{panel,asset:fog.asset,row:1,key:'fog',outfit:'cool'});
 }
});

test('snow has a separate nighttime scene while trace amounts and cold alone do not create snow',()=>{
 const evidence={snowScope:'hour',airTemperature:38,forecast:true,snowExpected:true,snowfall:.04,snowChance:90,pop:14};
 assert.equal(comfortSceneState(false,'Chance Rain Showers',13,evidence).key,'carry-umbrella');
 assert.equal(comfortSceneState(false,'Clear',13,{pop:0}).key,'night');
 assert.equal(comfortSceneState(false,'Cloudy',13,{snowExpected:true,pop:0}).key,'night','an untimed daily snow flag is not hourly snowfall evidence');
 const snow=comfortSceneState(false,'Snow',13,{pop:90});
 assert.equal(snow.asset,'comfort-integrated-snow-play-dawn.webp');
 assert.notEqual(snow.asset,comfortSceneState(true,'Snow',13,{pop:90}).asset);
 for(const panel of [0,1,2]){
  const markup=referenceScene(panel,false,'Snow',13,{pop:90});
  assert.match(markup,/data-scene="snow"/);
  assert.match(markup,/data-daylight="false"/);
  assert.match(markup,/nighttime illustration with no daylight/);
  assert.equal((markup.match(/<image\b/g)||[]).length,1);
 }
});

test('all complete night atlases are present as substantial real image assets',()=>{
 for(const profile of ['cold','cool','mild','warm'])for(const group of ['dry-chance','rain-fog']){
  const asset=`comfort-night-${profile}-${group}.webp`;
  assert.ok(COMFORT_SCENE_ASSETS.includes(asset));
  const local=new URL(`../public/weather-fusion/${asset}`,import.meta.url);
  assert.ok(fs.statSync(local).size>10000,`${asset} is a complete image, not an empty placeholder`);
 }
});
