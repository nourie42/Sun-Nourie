import test from 'node:test';
import assert from 'node:assert/strict';
import {thermalComfort,tier3FeelsLike,SUN_FEELS_LIKE_RULE} from '../public/weather-fusion/weather-math.js';

// Real Knightdale, NC inputs from Oct 25, 2026 (9 AM EDT, clear sky, 8.9 mph NE wind).
const location={latitude:35.78765,longitude:-78.48056};
const nineAm=Date.parse('2026-10-25T13:00:00Z');
const sunny={type:'guidance',condition:'Sunny',temperature:54,dewpoint:50.2,wind:8.9,humidity:86.9,skyCover:13.4};
const result=(input,at=nineAm,exposure='outdoors')=>tier3FeelsLike({...sunny,...input},location,at,exposure);
const raw=(...a)=>result(...a).value;

test('rule defaults: on, full effect below 10 mph, gone by 15 mph',()=>{
 assert.deepEqual({...SUN_FEELS_LIKE_RULE},{enabled:true,calmWindMph:10,windyMph:15});
});

test('in direct sun with light wind, feels-like is never below the air temperature',()=>{
 const comfort=thermalComfort(sunny,location,nineAm);
 assert.equal(comfort.sun,54,'was 49 at 54 degrees air before the rule');
 assert.equal(comfort.outdoors,54);
 assert.equal(comfort.inputEvidence.sunFloorApplied,true);
 assert.ok(comfort.shade<comfort.sun,'shade still reads cooler than sun');
});

test('every light-wind sunny case is at least the air temperature',()=>{
 for(const wind of [0,1,3,5,8.9,9.9]){
  for(const temperature of [35,45,54,60,68,75,85]){
   const v=raw({temperature,dewpoint:temperature-8,wind});
   assert.ok(v>=temperature-1e-9,`air ${temperature}, wind ${wind}: ${v}`);
  }
 }
});

test('windy sun is left exactly as the model computes it',()=>{
 for(const wind of [15,18,25]){
  const r=result({wind});
  assert.equal(r.sunFloorApplied,false);
  assert.equal(r.value,r.valueBeforeSunFloor);
  assert.ok(r.value<sunny.temperature,`wind ${wind}: ${r.value}`);
 }
});

test('no sudden jumps: wind, cloud and sunrise change the value smoothly',()=>{
 const step=(from,to,n,fn)=>{let previous=fn(from),worst=0;for(let i=1;i<=n;i++){const x=from+(to-from)*i/n,v=fn(x);worst=Math.max(worst,Math.abs(v-previous));previous=v;}return worst;};
 assert.ok(step(5,20,150,wind=>raw({wind}))<.6,'wind');
 assert.ok(step(0,100,200,skyCover=>raw({skyCover}))<.6,'cloud');
 const sunrise=Date.parse('2026-10-25T11:20:00Z');
 const clear={skyCover:0};
 const base=step(0,40,40,m=>result(clear,sunrise+m*60000).valueBeforeSunFloor);
 const withFloor=step(0,40,40,m=>raw(clear,sunrise+m*60000));
 assert.ok(withFloor<1,`sunrise step ${withFloor}`);
 assert.ok(withFloor<=base+.4,`floor adds ${withFloor-base} to the largest one-minute step`);
});

test('no sun, no floor: night and shade keep their own values',()=>{
 const night=thermalComfort({...sunny,temperature:50,dewpoint:47,wind:5},location,Date.parse('2026-10-25T07:00:00Z'));
 assert.equal(night.sun,null);
 assert.ok(night.outdoors<50);
 assert.equal(night.inputEvidence.sunFloorApplied,false);
 const shade=result({wind:3},nineAm,'shade');
 assert.equal(shade.sunFloorApplied,false);
 assert.equal(shade.value,shade.valueBeforeSunFloor,'shade value is never lifted');
});

test('overcast gets no sun floor because no direct sun is assumed',()=>{
 const cloudy=thermalComfort({...sunny,condition:'Overcast',skyCover:100,wind:3},location,nineAm);
 assert.equal(cloudy.sun,null);
 assert.equal(cloudy.inputEvidence.sunFloorApplied,false);
});
