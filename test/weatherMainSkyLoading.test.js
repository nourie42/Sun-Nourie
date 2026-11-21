import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,access} from 'node:fs/promises';
import {forecastSky,classifySky} from '../public/weather-fusion/sky-display.js';
import {fixture} from '../scripts/weatherNourieFixture.js';
const noon=Date.parse('2026-09-05T22:00:00Z');
function skyFixture(condition='Mostly Cloudy',cloud=94,now=noon){
 const f=fixture('knightdale',now);
 f.assembledAt=new Date(now).toISOString();
 Object.assign(f.current,{type:'guidance',time:new Date(now).toISOString(),condition,skyCover:cloud,radarPrecipitation:null});
 Object.assign(f.hours[0],{time:new Date(Math.floor(now/3600000)*3600000).toISOString(),condition,pop:0,precipitation:0,rainLikelihood:{value:0}});
 return f;
}
test('overcast current conditions use a genuine sun-free scene, regardless of daytime or a stale clear label',async()=>{
 const f=skyFixture(),before=JSON.stringify(f),sky=forecastSky(f,noon);
 assert.equal(sky.state,'cloudy');assert.equal(sky.header,'cloudy');assert.equal(sky.image,'weather-her-bg-cloudy-day-feels-32-59f.webp');
 assert.equal(classifySky('Sunny',94),'cloudy');
 await access(new URL('../public/weather-fusion/'+sky.image,import.meta.url));
 assert.equal(JSON.stringify(f),before);
});
test('rain, snow and fog keep their own scenes instead of being replaced by clear sky',()=>{
 for(const [condition,kind]of [['Rain','rain'],['Snow','snow'],['Fog','fog'],['Thunderstorms','storm']]){
  assert.equal(forecastSky(skyFixture(condition,95),noon).kind,kind);
 }
});
test('loading and expired readings do not imply sunshine',()=>{
 assert.deepEqual(forecastSky(null,noon),{kind:'unknown',state:'unknown',header:'unknown',image:null});
 const f=skyFixture();assert.equal(forecastSky(f,noon+3*3600000).state,'unknown');
});
test('cloudy nighttime stays dark and never uses the sunny cloud photograph',()=>{
 const night=noon+11*3600000,sky=forecastSky(skyFixture('Overcast',100,night),night);
 assert.equal(sky.state,'night');assert.equal(sky.header,'night-cloudy');assert.equal(sky.image,'weather-her-bg-cloudy-night-feels-32-59f.webp');
});
test('a supported clear daytime report can still select the existing clear scene',()=>{
 assert.equal(forecastSky(skyFixture('Clear',2),noon).image,'today-sky-clear.webp');
});
const prefetchSource=await readFile(new URL('../public/weather-fusion/forecast-prefetch.js',import.meta.url),'utf8');
async function boot(values={},extra={}){
 const calls=[];const context={URLSearchParams,AbortController,DOMException,Date,setTimeout,clearTimeout,localStorage:{getItem:key=>values[key]??null},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({signature:'real-response'})}},...extra};
 vm.runInNewContext(prefetchSource,context);
 if(context.__weatherNouriePrefetch)await context.__weatherNouriePrefetch.promise;
 return {context,calls};
}
test('startup starts one request for the saved chosen point and retains the exact response',async()=>{
 const {context,calls}=await boot({'weather-fusion-selected-city':JSON.stringify({latitude:35.6127,longitude:-77.3664})});
 assert.equal(calls.length,1);assert.match(calls[0].url,/latitude=35.6127&longitude=-77.3664/);
 assert.deepEqual(await context.__weatherNouriePrefetch.promise,{signature:'real-response'});
 vm.runInNewContext(prefetchSource,context);assert.equal(calls.length,1);
});
test('startup never invents a fallback city or prefetches invalid stored coordinates',async()=>{
 for(const values of [{},{'weather-fusion-selected-city':'broken json'},{'weather-fusion-selected-city':JSON.stringify({latitude:0,longitude:0})}])assert.equal((await boot(values)).calls.length,0);
});
test('a main request already in progress prevents a late startup script from duplicating it',async()=>{
 const {calls}=await boot({'weather-fusion-device-place':JSON.stringify({latitude:35.787,longitude:-78.4806})},{__weatherNourieForecastStarted:true});assert.equal(calls.length,0);
});
