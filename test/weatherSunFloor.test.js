import test from 'node:test';
import assert from 'node:assert/strict';
import {thermalComfort,tier3FeelsLike,SUN_FEELS_LIKE_RULE} from '../public/weather-fusion/weather-math.js';

// Real Knightdale, NC inputs from Oct 25, 2026 (9 AM EDT, clear sky, 8.9 mph NE wind).
const location={latitude:35.78765,longitude:-78.48056};
const nineAm=Date.parse('2026-10-25T13:00:00Z');
const sunny={type:'guidance',condition:'Sunny',temperature:54,dewpoint:50.2,wind:8.9,humidity:86.9,skyCover:13.4,solarRadiation:227.2};
const raw=(input,at=nineAm,exposure='outdoors')=>tier3FeelsLike({...sunny,...input},location,at,exposure).value;

test('rule defaults: on, full effect below 10 mph, gone by 15 mph',()=>{
 assert.deepEqual({...SUN_FEELS_LIKE_RULE},{enabled:true,calmWindMph:10,windyMph:15});
});

test('in direct sun with light wind, feels-like is never below the air temperature',()=>{
 const comfort=thermalComfort(sunny,location,nineAm);
 assert.equal(comfort.sun,54,'was 53 at 54 degrees air before the rule');
 assert.equal(comfort.outdoors,54);
 assert.equal(comfort.inputEvidence.sunFloorApplied,true);
 assert.ok(comfort.shade<comfort.sun,'shade still reads cooler than sun');
 assert.match(comfort.method,/sun-never-below-air-temperature floor/);
});

test('every light-wind sunny case is at least the air temperature',()=>{
 for(const wind of [0,1,3,5,8.9,9.9]){
  for(const temperature of [35,45,54,60,68,75,85]){
   const c=thermalComfort({...sunny,temperature,dewpoint:temperature-8,wind},location,nineAm);
   if(c.sun!==null)assert.ok(raw({temperature,dewpoint:temperature-8,wind})>=temperature-1e-9,`air ${temperature}, wind ${wind}: ${raw({temperature,dewpoint:temperature-8,wind})}`);
  }
 }
});

test('windy sun is left exactly as the model computes it',()=>{
 const off=(input)=>{const unfloored=tier3FeelsLike({...sunny,...input},location,nineAm,'outdoors');return unfloored.valueBeforeSunFloor;};
 for(const wind of [15,18,25]){
  const result=tier3FeelsLike({...sunny,wind},location,nineAm,'outdoors');
  assert.equal(result.sunFloorApplied,false);
  assert.equal(result.value,off({wind}));
  assert.ok(result.value<sunny.temperature,`wind ${wind}: ${result.value}`);
 }
});

test('no sudden jumps: wind, cloud and sunrise change the value smoothly',()=>{
 const step=(from,to,n,fn)=>{let previous=fn(from),worst=0;for(let i=1;i<=n;i++){const x=from+(to-from)*i/n,v=fn(x);worst=Math.max(worst,Math.abs(v-previous));previous=v;}return worst;};
 // 0.1 mph wind steps across the whole fade zone and beyond
 assert.ok(step(5,20,150,wind=>raw({wind}))<.6,'wind');
 // 0.5 percent cloud steps through the partly-cloudy boundary (62%) and out to overcast
 assert.ok(step(0,100,200,skyCover=>raw({skyCover,solarRadiation:undefined}))<.6,'cloud');
 // one-minute steps through sunrise: the sun itself warms ~0.5 F/min here, so the floor
 // must add no jump of its own on top of that.
 const sunrise=Date.parse('2026-10-25T11:20:00Z');
 const clear={skyCover:0,solarRadiation:undefined};
 const base=step(0,40,40,m=>tier3FeelsLike({...sunny,...clear},location,sunrise+m*60000,'outdoors').valueBeforeSunFloor);
 const withFloor=step(0,40,40,m=>raw(clear,sunrise+m*60000));
 assert.ok(withFloor<1,`sunrise step ${withFloor}`);
 assert.ok(withFloor<=base+.4,`floor adds ${withFloor-base} to the largest one-minute step`);
});

test('hours already warmer than the air are untouched',()=>{
 const ten=thermalComfort({...sunny,temperature:58,dewpoint:51.5,wind:10.2,humidity:78.9,skyCover:10.7,solarRadiation:410.1},location,Date.parse('2026-10-25T14:00:00Z'));
 assert.equal(ten.sun,61);
 assert.equal(ten.inputEvidence.sunFloorApplied,false);
});

test('no sun, no floor: night and shade keep their own values',()=>{
 const night=thermalComfort({...sunny,temperature:50,dewpoint:47,wind:5,solarRadiation:0},location,Date.parse('2026-10-25T07:00:00Z'));
 assert.equal(night.sun,null);
 assert.ok(night.outdoors<50);
 assert.equal(night.inputEvidence.sunFloorApplied,false);
 const shade=tier3FeelsLike({...sunny,wind:3},location,nineAm,'shade');
 assert.equal(shade.sunFloorApplied,false);
 assert.equal(shade.value,shade.valueBeforeSunFloor,'shade value is never lifted');
});

test('overcast gets no sun floor because no direct sun is assumed',()=>{
 const cloudy=thermalComfort({...sunny,condition:'Overcast',skyCover:100,solarRadiation:undefined,wind:3},location,nineAm);
 assert.equal(cloudy.sun,null);
 assert.equal(cloudy.inputEvidence.sunFloorApplied,false);
});
