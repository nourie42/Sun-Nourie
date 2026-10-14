import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceScene,winterSceneExpected,clothingForFeels} from '../public/weather-fusion/exposure-scene.js';
import {comfortArtworkContext} from '../public/weather-fusion/comfort-outlook.js';
import {pavementEstimate,pavementHTML,pavementDetailsHTML,coldPawGuidance} from '../public/weather-fusion/pavement.js';
import {sunShadeHTML} from '../public/weather-fusion/personal-details.js';

test('snow artwork has real bundled people, snow play and a bounding dog in all three panels',()=>{
 for(const panel of [0,1,2]){
  const html=referenceScene(panel,true,'Cloudy',22,{snowExpected:true,snowForecastOnly:true,snowScope:'hour',airTemperature:28,forecast:true});
  assert.match(html,/data-outfit="cold"/);
  assert.match(html,/data-garment="heavy-coat-and-trousers"/);
  assert.match(html,/warm hat, scarf, mittens and boots/);
  assert.match(html,/illustration of forecast snow/);
  assert.match(html,/class="reference-art"/);
  assert.match(html,/comfort-integrated-snow-play\.webp/);
  assert.equal((html.match(/<image\b/g)||[]).length,1);
  assert.doesNotMatch(html,/<(?:path|g|filter|clipPath|rect)\b/);
 }
 assert.match(referenceScene(0,true,'Snow',20),/building a snowman beneath a snowy tree/);
 assert.match(referenceScene(1,false,'Snow',20),/playing with snowballs/);
 assert.match(referenceScene(2,true,'Snow',20),/playing in the snow with a light brown poodle/);
 assert.match(referenceScene(1,false,'Snow',20),/comfort-integrated-snow-play-dawn\.webp/);
});
test('cold dry days wear visible heavy coats without inventing snow',()=>{
 for(const panel of [0,1,2]){
  const html=referenceScene(panel,true,'Clear',15);
  assert.match(html,/comfort-integrated-cold-normal\.webp/);
  assert.doesNotMatch(html,/wardrobe-|<path\b|clipPath/);
  assert.match(html,/data-garment="heavy-coat-and-trousers"/);
  assert.doesNotMatch(html,/snow-play-scene/);
 }
 assert.equal(clothingForFeels(70,{clothingFeels:35}),'mild','a later low cannot change clothing for an available selected-hour feels-like');
 assert.equal(clothingForFeels(70,{snowExpected:true}),'cold');
});
test('freezing rain and sleet alone do not become snowball artwork',()=>{
 for(const condition of ['Freezing Rain','Sleet','Ice Pellets']){
  assert.equal(winterSceneExpected(condition),false);
  const html=referenceScene(1,true,condition,22);
  assert.doesNotMatch(html,/snow-play-scene/);
  assert.match(html,/data-outfit="cold"/);
 }
 assert.equal(winterSceneExpected('Clear',{snowfall:.1}),false);
 assert.equal(winterSceneExpected('Cloudy',{snowfall:.1,snowScope:'hour',airTemperature:30,forecast:true}),true);
 assert.equal(winterSceneExpected('Clear',{snowfall:0}),false);
 assert.equal(winterSceneExpected('Chance Snow Showers'),true);
});
test('daily snow flags and untimed wording do not become selected-hour artwork',()=>{
 const f={location:{timeZone:'America/Denver'},hours:[],snow:{possible:true,days:[
  {date:'2026-10-14',possible:true,snowExpected:false,periods:[{wording:'Freezing rain'}]},
  {date:'2026-10-15',possible:true,snowExpected:true}
 ]}};
 const sample={time:'2026-10-15T00:30:00Z',condition:'Cloudy',feels:25,now:false};
 assert.equal(comfortArtworkContext(f,sample).snowExpected,false,'UTC tomorrow is still local today');
 assert.equal(comfortArtworkContext(f,{...sample,time:'2026-10-15T18:00:00Z'}).snowExpected,false);
 const older={...f,snow:{days:[{date:'2026-10-14',possible:true,periods:[{wording:'Chance snow showers'}]}]}};
 assert.equal(comfortArtworkContext(older,sample).snowExpected,false);
});
test('winter paw tile stops showing dry-surface numbers and provides cold/snow/deicer care',()=>{
 const now=Date.parse('2026-10-14T18:00:00Z'),context={condition:'Snow',snowExpected:true,clothingFeels:15,forecast:true};
 const result=pavementEstimate({location:{latitude:40,longitude:-105}},{temperature:25},now,{...context,checkedAt:now});
 assert.equal(result.status,'winter');
 assert.equal(result.concrete,null);assert.equal(result.asphalt,null);
 const html=pavementHTML(result,20,context);
 assert.match(html,/Cold paws/);assert.match(html,/playing in the snow with a light brown poodle/);
 assert.match(html,/rinse off deicer/);assert.doesNotMatch(html,/Est\. surface temp|Asphalt \d|\d+°/);
 const details=pavementDetailsHTML(result);
 assert.match(details,/Paw temperature and snow-covered surface temperature are not estimated/);
 assert.match(details,/lifts a paw, limps or shivers/);
 assert.equal(coldPawGuidance(70,{condition:'Sunny'}),null);
});
test('snow context passes through the shade/outdoor pair while current readings stay unchanged',()=>{
 const html=sunShadeHTML({shade:45,outdoors:47,daylight:true,weatherKind:'cloudy'},
  {latitude:40,longitude:-105},Date.parse('2026-10-14T18:00:00Z'),{condition:'Cloudy',compact:true,snowExpected:true,snowForecastOnly:true,clothingFeels:20,snowScope:'hour',airTemperature:28,forecast:true});
 assert.equal((html.match(/snow-play-scene/g)||[]).length,2);
 assert.match(html,/Snow · dress warmly/);
 assert.match(html,/>45°</);assert.match(html,/>47°</);
});
