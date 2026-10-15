import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {COMFORT_SCENE_ASSETS,referenceScene,comfortSceneState} from '../public/weather-fusion/exposure-scene.js';
import {clothingArtwork} from '../public/weather-fusion/comfort-clothing.js';

test('weather/clothing matrix uses one complete existing asset per panel, with no apparel or sky compositing',()=>{
 const conditions=[['Clear',0],['Cloudy',0],['Fog',0],['Chance Showers',55],['Rain',90],['Snow',90],['Freezing Rain',90]];
 for(const feels of [20,55,70,80,95])for(const daylight of [true,false])for(const [condition,pop] of conditions)for(const panel of [0,1,2]){
  const state=comfortSceneState(daylight,condition,feels,{pop});
  assert.ok(COMFORT_SCENE_ASSETS.includes(state.asset),`${condition}/${feels} selects a declared complete scene`);
  const markup=referenceScene(panel,daylight,condition,feels,{pop});
  assert.equal((markup.match(/<image\b/g)||[]).length,1);
  assert.doesNotMatch(markup,/<(?:path|g|rect|filter|clipPath|circle|ellipse)\b|wardrobe-|comfort-clothing/);
  assert.match(markup,new RegExp(`x="${-300*panel}"`));
  const local=new URL(`../public/weather-fusion/${state.asset}`,import.meta.url);
  assert.ok(fs.statSync(local).size>10000,'a complete scene asset is present, not an empty placeholder');
 }
});
test('compatibility wardrobe API cannot draw misaligned hats, mittens or trousers for any pose',()=>{
 for(const outfit of ['cold','cool','mild','warm','hot'])for(const scene of ['normal','watch','rain','fog','dawn','night','snow','carry-umbrella'])for(const panel of [0,1,2]){
  assert.equal(clothingArtwork(panel,scene,outfit,'/different-pose.webp'),'');
 }
});
test('selected-hour clothing and selected snow change the complete scene without borrowing later cold or snow',()=>{
 assert.equal(comfortSceneState(true,'Cloudy',70,{clothingFeels:20}).asset,'comfort-integrated-mild-watch.webp');
 assert.equal(comfortSceneState(true,'Cloudy',20,{snowExpected:true,snowScope:'hour',airTemperature:28,forecast:true}).asset,'comfort-integrated-snow-play.webp');
 assert.equal(comfortSceneState(false,'Cloudy',20,{snowExpected:true,snowScope:'hour',airTemperature:28,forecast:true}).asset,'comfort-integrated-snow-play-dawn.webp');
 assert.equal(comfortSceneState(true,'Freezing Rain',20).asset,'comfort-integrated-cold-rain.webp');
 assert.equal(comfortSceneState(true,'Sleet',20).asset,'comfort-integrated-cold-watch.webp');
 assert.equal(comfortSceneState(true,'Clear',95,{clothingFeels:30}).asset,'comfort-reference-scenes-hot.webp');
 assert.doesNotMatch(referenceScene(1,true,'Freezing Rain',20),/snow-play-scene/);
});
