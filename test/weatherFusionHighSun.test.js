import test from 'node:test';
import assert from 'node:assert/strict';
import {tier3FeelsLike,solarElevation} from '../public/weather-fusion/weather-math.js';
import {utciF} from '../public/weather-fusion/utci.js';
const place={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
const input={temperature:65,dewpoint:43.8,wind:12,skyCover:10.6716,condition:'Sunny'};
function baseline(sample,time,exposure='outdoors') {
 const elevation=solarElevation(time,place.latitude,place.longitude);
 const sun=Math.max(0,Math.sin(elevation))**.72,cloud=sample.skyCover/100;
 const delta=elevation>0?((18-10*cloud)*sun+(exposure==='outdoors'?130*sun*(1-cloud):0))/6.1:0;
 const actual=tier3FeelsLike(sample,place,time,exposure);
 return utciF(sample.temperature,sample.temperature+delta*1.8,sample.wind,actual.rh);
}
test('11 AM–3 PM sunshine increases the modeled outdoor estimate without changing shade or inputs',()=>{
 const original=structuredClone(input);
 for(let localHour=11;localHour<=15;localHour++) {
  const time=Date.parse(`2026-10-19T${localHour+4}:00:00Z`);
  const actual=tier3FeelsLike(input,place,time,'outdoors');
  assert.ok(actual.value>baseline(input,time)+3);
  assert.ok(actual.value<baseline(input,time)+6);
  assert.equal(tier3FeelsLike(input,place,time,'shade').value,baseline(input,time,'shade'));
  assert.equal(actual.windUsedMps,12*.44704);
 }
 assert.deepEqual(input,original);
});
test('night, low sun and full overcast get no additional sunlight warming',()=>{
 for(const [iso,cloud] of [['2026-10-20T03:00:00Z',10],['2026-10-19T12:00:00Z',10],['2026-10-19T17:00:00Z',100]]) {
  const sample={...input,skyCover:cloud},time=Date.parse(iso);
  assert.equal(tier3FeelsLike(sample,place,time,'outdoors').valueBeforeSunFloor,baseline(sample,time));
 }
});
test('cloud attenuation reduces the extra warming and solar position wins over timezone labels',()=>{
 const time=Date.parse('2026-10-19T17:00:00Z');
 const extra=cloud=>{const sample={...input,skyCover:cloud};return tier3FeelsLike(sample,place,time,'outdoors').valueBeforeSunFloor-baseline(sample,time);};
 assert.ok(extra(0)>extra(50));assert.ok(extra(50)>extra(90));assert.equal(extra(100),0);
 assert.deepEqual(tier3FeelsLike(input,place,time,'outdoors'),tier3FeelsLike(input,{...place,timeZone:'Asia/Tokyo'},time,'outdoors'));
 assert.equal(tier3FeelsLike({...input,wind:null},place,time,'outdoors').value,null);
 assert.equal(tier3FeelsLike({...input,dewpoint:null},place,time,'outdoors').value,null);
});
test('the sun adjustment remains continuous through the daytime without hourly jumps',()=>{
 let previous;
 for(let time=Date.parse('2026-10-19T11:00:00Z');time<=Date.parse('2026-10-20T00:00:00Z');time+=60000) {
  const value=tier3FeelsLike(input,place,time,'outdoors').valueBeforeSunFloor-baseline(input,time);
  if(previous!==undefined)assert.ok(Math.abs(value-previous)<.15);
  previous=value;
 }
});
