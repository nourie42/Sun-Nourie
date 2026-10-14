import test from 'node:test';
import assert from 'node:assert/strict';
import {clothingForFeels,referenceScene,comfortSceneState} from '../public/weather-fusion/exposure-scene.js';
import {clothingArtwork} from '../public/weather-fusion/comfort-clothing.js';
import {sunShadeHTML} from '../public/weather-fusion/personal-details.js';
import {pavementHTML} from '../public/weather-fusion/pavement.js';

const scenarios=[['Clear',true,0],['Clear',false,0],['Cloudy',true,0],['Fog',true,0],['Chance Showers',true,40],['Rain',true,90]];
test('outfit boundaries use displayed feels-like values, not nighttime or pavement temperature',()=>{
 for(const [f,want] of [[30,'cold'],[41,'cold'],[42,'cool'],[50,'cool'],[60,'cool'],[64.99,'cool'],[65,'mild'],[73.99,'mild'],[74,'warm'],[88,'hot']])assert.equal(clothingForFeels(f),want);
});
for(const [condition,daylight,pop] of scenarios){
 test(`visible cool-weather clothes in ${condition}, daylight=${daylight}`,()=>{
  for(const panel of [0,1,2]){
   const html=referenceScene(panel,daylight,condition,60,{pop});
   assert.match(html,/data-artwork="complete-image"/);
   assert.doesNotMatch(html,/<(?:path|clipPath|filter|rect|g)\b|wardrobe-|comfort-clothing/);
   assert.equal((html.match(/<image\b/g)||[]).length,1,'one complete illustration, never garments layered onto another pose');
   assert.match(html,/data-visible-outfit="cool"/);
   assert.match(html,/data-garment="(?:jacket-and-trousers|rainwear-and-trousers)"/);
   assert.match(html,/class="reference-art"/);
   const expected=comfortSceneState(daylight,condition,60,{pop});
   assert.ok(html.includes(`data-scene="${expected.key}"`));
   assert.ok(html.includes(expected.asset));
  }
 });
}
test('mild weather selects complete long-pants art and warm weather uses the original light-clothing scenes',()=>{
 for(const panel of [0,1,2]){
  assert.match(referenceScene(panel,false,'Clear',68,{pop:0}),/data-garment="long-trousers"/);
  assert.match(referenceScene(panel,false,'Clear',68,{pop:0}),/comfort-integrated-mild-dawn\.webp/);
  for(const t of [74,82,95]){
   const html=referenceScene(panel,false,'Clear',t,{pop:0});
   assert.match(html,/comfort-reference-scenes-dawn\.webp/);
   assert.doesNotMatch(html,/comfort-clothing|wardrobe-|<path\b/);
  }
 }
});
test('winter artwork is bundled snow play and missing readings keep the normal scene',()=>{
 assert.equal(clothingArtwork(0,'cold','cold'), '');
 for(const panel of [0,1,2]){
  const snow=referenceScene(panel,false,'Snow',30);
  assert.match(snow,/class="reference-scene snow-play-scene/);
  assert.match(snow,/data-garment="heavy-coat-and-trousers"/);
  assert.match(snow,/warm hat, scarf, mittens and boots/);
  assert.match(snow,/comfort-integrated-snow-play-dawn\.webp/);
  assert.doesNotMatch(snow,/comfort-clothing|<path\b/);
 }
 assert.match(referenceScene(0,true,'Clear',null),/comfort-reference-scenes.webp/,'missing NVIDIA feels-like values keep the same people artwork instead of switching to a fallback person');
 assert.equal(clothingArtwork(-1,'normal','cool'), '');
});
test('screenshot regression: shade 50, outdoors 60 and warm pavement do not produce shorts',()=>{
 const comfort={shade:50,outdoors:60,sun:null,daylight:false,weatherKind:'cloudy'};
 const copy=structuredClone(comfort);
 const human=sunShadeHTML(comfort,{latitude:35.787,longitude:-78.4806},Date.parse('2026-09-24T23:00Z'),{condition:'Mostly Cloudy',pop:6});
 assert.equal((human.match(/data-visible-outfit="cool"/g)||[]).length,2);
 assert.match(human,/50°/);assert.match(human,/60°/);
 const surface={status:'estimated',daylight:false,concrete:{value:95,low:90,high:100},asphalt:{value:100,low:95,high:105}};
 const pet=pavementHTML(surface,60,{condition:'Mostly Cloudy',pop:6});
 assert.match(pet,/data-visible-outfit="cool"/);assert.match(pet,/95°/);
 assert.deepEqual(comfort,copy);
});

