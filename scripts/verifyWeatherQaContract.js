import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deterministicRainSignal,precipitationLikelihood} from '../src/weatherFusionDirect.js';
import {weatherIcon} from '../public/weather-fusion/weather-display.js';
import {conditionForRainChance,weatherState} from '../public/weather-fusion/weather-state.js';
import {todaySkyProfile,confidenceBannerHTML} from '../public/weather-fusion/today-card.js';
import {precipitationActivity,comfortSceneState} from '../public/weather-fusion/exposure-scene.js';

const close=(a,b)=>Math.abs(a-b)<1e-8;

assert.equal(deterministicRainSignal(0),0);
assert.ok(close(deterministicRainSignal(0.004),100/3));
assert.ok(close(deterministicRainSignal(0.010),100/3));
assert.equal(deterministicRainSignal(0.0100001),100);
assert.equal(deterministicRainSignal(0.099),100);
assert.equal(deterministicRainSignal(0.10),100);

const boundary=precipitationLikelihood(7,{sourceValues:{hrrr:0,ecmwf:0.004,nbm:0.010}});
assert.equal(boundary.value,13);
assert.ok(close(boundary.sourcePoints.nws,2.8));
assert.equal(boundary.sourcePoints.hrrr,0);
assert.ok(close(boundary.sourcePoints.ecmwf,10/3));
assert.ok(close(boundary.sourcePoints.nbm,20/3));

assert.equal(conditionForRainChance('Rain',100),'Rain');
assert.equal(conditionForRainChance('Sunny',100),'Rain');
assert.equal(conditionForRainChance('Fog',100),'Rain');
assert.equal(conditionForRainChance('Sunny',69),'Sunny');
assert.equal(weatherState(conditionForRainChance('Rain',100)).kind,'rain');
assert.doesNotMatch(weatherIcon(conditionForRainChance('Rain',100)),/sky-lightning/);
assert.doesNotMatch(weatherIcon(conditionForRainChance('Sunny',100)),/sky-lightning|data-weather-kind="clear"/);
assert.match(weatherIcon(conditionForRainChance('Thunderstorms',20)),/sky-lightning/);

assert.equal(todaySkyProfile({condition:'Rain',pop:100}).scene,'overcast-rain');
assert.notEqual(todaySkyProfile({condition:'Rain',pop:100}).scene,'storm');
assert.equal(todaySkyProfile({condition:'Thunderstorms',pop:70}).scene,'storm');
assert.equal(todaySkyProfile({condition:'Slight Chance Showers And Thunderstorms then Patchy Fog',pop:100}).scene,'overcast-rain');

assert.equal(precipitationActivity('Fog',{pop:100}),'active');
assert.deepEqual(comfortSceneState(true,'Fog',65,{pop:100}),{key:'rain',asset:'comfort-reference-scenes-rain.webp'});
assert.deepEqual(comfortSceneState(true,'Fog',65,{pop:0}),{key:'fog',asset:'comfort-reference-scenes-fog.webp'});
assert.deepEqual(comfortSceneState(true,'Fog',65,{pop:19}),{key:'fog',asset:'comfort-reference-scenes-fog.webp'});
assert.deepEqual(comfortSceneState(true,'Fog',65,{pop:48}),{key:'carry-umbrella',asset:'comfort-reference-scenes-carry-umbrella.svg'});
assert.deepEqual(comfortSceneState(true,'Fog',65,{pop:80}),{key:'carry-umbrella',asset:'comfort-reference-scenes-carry-umbrella.svg'});
assert.deepEqual(comfortSceneState(true,'Fog',65,{pop:81}),{key:'rain',asset:'comfort-reference-scenes-rain.webp'});
assert.deepEqual(comfortSceneState(true,'Cloudy',65,{pop:0,rainAround:true}),{key:'rain',asset:'comfort-reference-scenes-rain.webp'});
assert.equal(precipitationActivity('Chance Showers',{pop:23}),'possible');
assert.deepEqual(comfortSceneState(true,'Chance Showers',70,{pop:23}),{key:'carry-umbrella',asset:'comfort-reference-scenes-carry-umbrella.svg'});
assert.deepEqual(comfortSceneState(true,'Chance Showers',70,{pop:50}),{key:'carry-umbrella',asset:'comfort-reference-scenes-carry-umbrella.svg'});

assert.match(confidenceBannerHTML({confidence:{key:'low',factors:['8.0°F high-temperature spread','0.40 in rainfall-guidance spread']}}),/Lower confidence today[\s\S]*Click for details/);
assert.equal(confidenceBannerHTML({confidence:{key:'high',factors:[]}}),'');

function walk(dir,files=[]){
  for(const name of readdirSync(dir)){
    if(['node_modules','.git','deal-desk'].includes(name))continue;
    const path=join(dir,name),stat=statSync(path);
    if(stat.isDirectory())walk(path,files);
    else files.push(path);
  }
  return files;
}
const literalSecret=/sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}/;
for(const file of walk(fileURLToPath(new URL('..',import.meta.url)))){
  const text=readFileSync(file,'utf8');
  assert.doesNotMatch(text,literalSecret,`literal OpenAI-style secret found in ${file}`);
}

console.log('WEATHER_QA_CONTRACT_OK');
