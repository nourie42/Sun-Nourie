import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {comfortSceneState,referenceScene,dogWalkerScene,walkerSlot,WALKER_SLOTS,PET_WALKER_FILES} from '../public/weather-fusion/exposure-scene.js';
import {PET_WALKER_ART} from '../public/weather-fusion/pet-walker-art.js';
import {pavementHTML} from '../public/weather-fusion/pavement.js';

const slotNames=new Set(WALKER_SLOTS.map(s=>s.slot));
const conditions=['Clear','Sunny','Partly Cloudy','Cloudy','Overcast','Fog','Light Rain','Rain','Thunderstorms','Light Snow','Snow'];
const feelsValues=[null,-10,20,35,41,42,50,64,65,70,73,74,80,87,88,100];
const contexts=[{},{pop:20},{pop:55},{pop:80},{rainExpected:true},{snowExpected:true,snowScope:'hour',airTemperature:30,forecast:true}];

test('every scene the site can pick for her maps to a listed slot, and every slot is reachable',()=>{
 const reached=new Set();
 for(const daylight of [true,false])for(const condition of conditions)for(const feels of feelsValues)for(const context of contexts){
  const scene=comfortSceneState(daylight,condition,feels,context),slot=walkerSlot(scene,daylight);
  assert.ok(slotNames.has(slot),`${daylight?'day':'night'} ${condition} ${feels} ${JSON.stringify(context)} -> ${slot}`);
  reached.add(slot);
 }
 const unreachable=[...slotNames].filter(slot=>!reached.has(slot));
 assert.deepEqual(unreachable,[],'slots that no weather can produce should not be on the shot list');
});

test('slot names match the clothes the scene sheet actually shows',()=>{
 const pick=(daylight,condition,feels,context={})=>walkerSlot(comfortSceneState(daylight,condition,feels,context),daylight);
 assert.equal(pick(false,'Clear',68),'night-mild-night');
 assert.equal(pick(false,'Clear',50),'night-cool-night');
 assert.equal(pick(false,'Clear',100),'night-warm-night');
 assert.equal(pick(false,'Rain',30),'night-cold-rain');
 assert.equal(pick(false,'Fog',68),'night-mild-fog');
 assert.equal(pick(true,'Clear',50),'day-cool-normal');
 assert.equal(pick(true,'Cloudy',30),'day-cold-watch');
 assert.equal(pick(true,'Rain',68,{pop:90}),'day-cool-rain','mild rain uses the cool-weather rain sheet');
 assert.equal(pick(true,'Clear',95),'day-hot-normal');
 assert.equal(pick(true,'Clear',null),'day-warm-normal');
 assert.equal(pick(true,'Light Snow',25),'snow-day');
 assert.equal(pick(false,'Light Snow',25),'snow-dawn');
});

test('every reachable weather selects its replacement pet art while the scene sheets stay unchanged',()=>{
 assert.equal(Object.keys(PET_WALKER_ART).length,WALKER_SLOTS.length);
 const reached=new Set();
 for(const daylight of [true,false])for(const condition of conditions)for(const feels of feelsValues)for(const context of contexts){
  const slot=walkerSlot(comfortSceneState(daylight,condition,feels,context),daylight);
  const walker=dogWalkerScene(daylight,condition,feels,context);
  reached.add(slot);
  assert.ok(PET_WALKER_ART[slot],slot);
  assert.ok(walker.includes(`data-walker-slot="${slot}"`),slot);
  assert.ok(walker.includes(`/weather-fusion/pet-walker-${slot}.webp?`),slot);
  assert.equal((walker.match(/<image\b/g)||[]).length,1,slot);
  assert.match(walker,/style="filter:none"/);
  for(const panel of [0,1])assert.doesNotMatch(referenceScene(panel,daylight,condition,feels,context),/pet-walker-|data-walker=/);
 }
 assert.deepEqual([...reached].sort(),[...slotNames].sort());
});

test('replacement art keeps the scene contract: one complete square image, same label and attributes',()=>{
 const original=referenceScene(2,false,'Clear',68,{}),walker=dogWalkerScene(false,'Clear',68,{});
 assert.equal((walker.match(/<image\b/g)||[]).length,1);
 assert.doesNotMatch(walker,/<(?:path|g|rect|filter|clipPath|circle|ellipse|defs)\b/);
 assert.match(walker,/<image class="reference-art" href="\/weather-fusion\/pet-walker-night-mild-night\.webp\?v=[^"]+" x="0" y="0" width="300" height="300" preserveAspectRatio="none"/);
 assert.match(walker,/role="img" aria-label="A woman walking a light brown toy poodle/);
 for(const attribute of ['aria-label','data-scene','data-outfit','data-garment','data-daylight','data-weather','class'])assert.equal(walker.match(new RegExp(`${attribute}="([^"]*)"`))[1],original.match(new RegExp(`${attribute}="([^"]*)"`))[1],attribute);
 assert.match(walker,/style="filter:none"/,'the supplied picture already shows its night lighting');
});

test('every installed picture exists, is declared for the server, and is named like its slot',()=>{
 for(const [slot,art] of Object.entries(PET_WALKER_ART)){
  assert.ok(slotNames.has(slot),`${slot} is not a real slot`);
  assert.equal(art.file,`pet-walker-${slot}.webp`);
  assert.ok(existsSync(`public/weather-fusion/${art.file}`),art.file);
  assert.ok(art.width>=300&&art.height>=300,'too small to display sharply');
  assert.equal(art.width,art.height,'replacement pictures are square, like the original panels');
 }
 assert.deepEqual(PET_WALKER_FILES.sort(),Object.values(PET_WALKER_ART).map(a=>a.file).sort());
 const server=readFileSync('src/weatherFusion.js','utf8');
 assert.match(server,/\.\.\.PET_WALKER_FILES/);
 assert.match(server,/'pet-walker-art\.js'/);
});

test('the For Pets card uses the new art across night, day and cool weather',()=>{
 const surface=daylight=>({status:'estimated',daylight,concrete:{value:60,low:55,high:65},asphalt:{value:62,low:55,high:70}});
 const night=pavementHTML(surface(false),68,{condition:'Clear',pop:0});
 assert.match(night,/data-walker-slot="night-mild-night"/);
 assert.match(night,/pet-walker-night-mild-night\.webp/);
 const cool=pavementHTML(surface(false),50,{condition:'Clear',pop:0});
 assert.match(cool,/data-walker-slot="night-cool-night"/);
 assert.match(cool,/pet-walker-night-cool-night\.webp/);
 assert.match(pavementHTML(surface(true),68,{condition:'Clear',pop:0}),/pet-walker-day-mild-normal\.webp/);
});
