import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {comfortClothingPlan} from '../public/weather-fusion/prerelease-experience.js';
import {referenceScene,comfortSceneState} from '../public/weather-fusion/prerelease-exposure-scene.js';
import {sunShadeHTML} from '../public/weather-fusion/prerelease-personal-details.js';
import {coldPawContext,pavementHTML,pavementDetailsHTML} from '../public/weather-fusion/prerelease-pavement.js';
import {referenceScene as liveScene} from '../public/weather-fusion/exposure-scene.js';

const now=Date.parse('2026-10-14T16:30:00Z');
const sample={now:true,time:new Date(now).toISOString(),condition:'Clear',isDay:true,feels:62,comfort:{shade:58,outdoors:62,daylight:true,weatherKind:'clear'},currentPrecipitation:{active:false,label:'Dry at station'}};
function forecast(rows,zone='America/New_York'){
 return {location:{timeZone:zone,latitude:40,longitude:-74},hours:rows.map(([time,value,condition='Clear',snowfall=0])=>({time,temperature:value,condition,snowfall})),metricForecasts:{series:{feels:rows.map(([time,value])=>({time,value})),dewpoint:[],gust:[]}}};
}
const surface={status:'estimated',daylight:true,concrete:{value:75,low:70,high:80},asphalt:{value:80,low:75,high:85}};

test('clothes use coldest remaining local-day hour; exclude past and next day without mutating data',()=>{
 const f=forecast([['2026-10-14T10:00:00Z',5],['2026-10-14T18:00:00Z',53],['2026-10-15T03:00:00Z',26],['2026-10-15T04:00:00Z',-4]]);
 const before=structuredClone({f,sample});
 const plan=comfortClothingPlan(f,now,sample);
 assert.equal(plan.clothingFeels,26);assert.equal(plan.coldest.time,'2026-10-15T03:00:00Z');assert.equal(plan.availableHours,2);
 assert.match(plan.note,/coldest available hour today/);assert.match(plan.note,/readings below are for now/);
 assert.deepEqual({f,sample},before);
});
test('local date boundary respects daylight-saving fallback',()=>{
 const at=Date.parse('2026-11-01T05:30:00Z'),s={...sample,time:new Date(at).toISOString()};
 const f=forecast([['2026-11-01T06:00:00Z',31],['2026-11-02T04:00:00Z',25],['2026-11-02T05:00:00Z',-10]]);
 assert.equal(comfortClothingPlan(f,at,s).clothingFeels,25);
});
test('missing future data never becomes zero and current cold still gets a coat',()=>{
 const f=forecast([['2026-10-14T18:00:00Z',null]]),plan=comfortClothingPlan(f,now,sample);
 assert.equal(plan.clothingFeels,58);assert.equal(plan.availableHours,0);assert.match(plan.note,/No later same-day/);
 const unknown=comfortClothingPlan(f,now,{...sample,feels:null,comfort:{shade:null}});
 assert.equal(unknown.clothingFeels,null);
 assert.equal(comfortClothingPlan(f,now,{...sample,feels:24,comfort:{shade:24}}).clothingFeels,24);
});
test('current numeric readings remain canonical when a later cold hour chooses heavy coats',()=>{
 const plan=comfortClothingPlan(forecast([['2026-10-15T02:00:00Z',20]]),now,sample);
 const html=sunShadeHTML(sample.comfort,{latitude:40,longitude:-74},now,{...plan,condition:'Clear',pop:0,primaryFeels:62,compact:true});
 assert.match(html,/<strong>58°<\/strong>/);assert.match(html,/<strong>62°<\/strong>/);
 assert.equal((html.match(/data-scene="heavy-coat"/g)||[]).length,2);
 assert.doesNotMatch(html,/snow-play/);
});
test('heavy coats have an actual dry-ground sprite; cold alone does not make snow',()=>{
 for(const panel of [0,1,2]){
  const html=referenceScene(panel,true,'Clear',60,{clothingFeels:22,pop:0});
  assert.match(html,/prerelease-comfort-heavy-coats.webp/);assert.match(html,/data-visible-outfit="cold"/);
  assert.match(html,/heavy puffer coat/);assert.doesNotMatch(html,/snow-play|comfort-reference-scenes-cold/);
 }
 assert.equal(comfortSceneState(true,'Clear',94,{clothingFeels:56}).key,'normal');
});
test('snow forecast changes the artwork with visible forecast qualification and distinct play poses',()=>{
 const f=forecast([['2026-10-14T22:00:00Z',35,'Chance Snow',0],['2026-10-15T00:00:00Z',29,'Snow',.2]]);
 const plan=comfortClothingPlan(f,now,sample);
 assert.equal(plan.artForecast,true);assert.equal(plan.snowArtwork,true);assert.equal(plan.clothingFeels,29);
 assert.match(plan.note,/Snow possible at/);assert.match(plan.note,/previews that forecast/);
 for(const [panel,action] of [[0,/rolling a snowball under a snowy tree/],[1,/playing with a snowball/],[2,/playing in snow with her leaping light brown toy poodle/]]){
  const html=referenceScene(panel,true,'Clear',62,plan);
  assert.match(html,/prerelease-comfort-snow-play.webp/);assert.match(html,/data-scene-basis="forecast"/);assert.match(html,action);
 }
});
test('actual observed snow is current; an unconfirmed snow estimate is still labeled forecast',()=>{
 const f=forecast([]),snow={...sample,condition:'Snow',feels:25,comfort:{shade:25},currentPrecipitation:{active:true,label:'Snow now'}};
 assert.equal(comfortClothingPlan(f,now,snow).artForecast,false);
 assert.equal(comfortClothingPlan(f,now,{...snow,currentPrecipitation:{active:false,label:'Checking radar'}}).artForecast,true);
});
test('grid snowfall triggers forecast art even when the text says clouds',()=>{
 const f=forecast([['2026-10-14T22:00:00Z',30,'Cloudy',.1]]),plan=comfortClothingPlan(f,now,sample);
 assert.equal(plan.snowArtwork,true);assert.match(plan.note,/Snow forecast at/);
 const tomorrow=comfortClothingPlan(forecast([['2026-10-15T04:00:00Z',22,'Snow',2]]),now,sample);
 assert.equal(tomorrow.snowArtwork,false);
});
test('selected hourly preview follows that hour and does not borrow the day low',()=>{
 const f=forecast([['2026-10-14T18:00:00Z',50],['2026-10-14T22:00:00Z',20,'Snow',.3]]);
 const plan=comfortClothingPlan(f,now,{...sample,now:false,time:'2026-10-14T18:00:00Z',feels:50,comfort:{shade:48}});
 assert.equal(plan.clothingFeels,48);assert.equal(plan.snowArtwork,false);assert.match(plan.note,/selected forecast hour/);
});
test('snow and freezing-rain pet cards give guidance, with no invented numerical paw readings',()=>{
 const context={condition:'Clear',snowArtwork:true,artForecast:true,clothingFeels:25};
 const html=pavementHTML(surface,62,context),details=pavementDetailsHTML(surface,context);
 assert.match(html,/data-pet-mode="cold"/);assert.match(html,/Snow forecast/);assert.match(html,/Paw care/);
 assert.doesNotMatch(html,/75°|80°|Est\. surface temp|Asphalt/);
 assert.match(details,/Human feels-like is not a paw temperature or a safe exposure limit/);
 assert.match(details,/We do not estimate paw temperature/);assert.match(details,/avma.org/);
 assert.equal(coldPawContext(surface,60,{condition:'Freezing Rain'}).frozen,true);
 assert.equal(comfortSceneState(true,'Freezing Rain',29).key,'heavy-coat','ice is not fabricated into snow play');
});
test('warm-weather pet cards retain canonical surface estimates',()=>{
 const html=pavementHTML(surface,74,{condition:'Clear',pop:0});
 assert.match(html,/75°/);assert.match(html,/Asphalt 80°/);assert.doesNotMatch(html,/data-pet-mode="cold"/);
});
test('live modules still use their original assets, and the prerelease assets exist',()=>{
 assert.match(liveScene(0,true,'Snow',25),/comfort-reference-scenes-cold.webp/);
 for(const file of ['prerelease-comfort-snow-play.webp','prerelease-comfort-heavy-coats.webp'])assert.ok(fs.statSync(new URL('../public/weather-fusion/'+file,import.meta.url)).size>1000);
 for(const file of ['prerelease-experience.js','prerelease-personal-details.js']){
  const source=fs.readFileSync(new URL('../public/weather-fusion/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/Gross Meter/);assert.match(source,/prerelease-dewpoint-meter\.js/);
 }
});

test('fresh individual winter model can show possible snow art without altering main readings',()=>{
 const f=forecast([['2026-10-14T18:00:00Z',53]]);f.prereleaseWinter={assembledAt:new Date(now).toISOString(),sources:{nam:{status:'ready',intervals:[{start:'2026-10-14T18:00:00Z',end:'2026-10-14T19:00:00Z',value:.1}]}}};
 const before=structuredClone(f),plan=comfortClothingPlan(f,now,sample);assert.equal(plan.snowArtwork,true);assert.equal(plan.snow.possible,true);assert.match(plan.note,/Snow possible/);assert.deepEqual(f,before);
 f.prereleaseWinter.assembledAt='2026-10-14T10:00:00Z';assert.equal(comfortClothingPlan(f,now,sample).snowArtwork,false);
});
