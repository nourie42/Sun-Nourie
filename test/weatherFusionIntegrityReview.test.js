import test from 'node:test';
import assert from 'node:assert/strict';
import {thermalComfort,tier3FeelsLike,solarElevation} from '../public/weather-fusion/weather-math.js';
import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
import {forecastSample} from '../public/weather-fusion/weather-display.js';
import {collectDanTakeEvidence,approveDanTake,visibleDanTakeItems} from '../public/weather-fusion/dans-take.js';
const H=3600000,now=Date.parse('2026-09-07T09:00Z');
const place={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York',office:'RAH'};
const current={temperature:79,dewpoint:68,wind:4.3,skyCover:10,condition:'Sunny'};
function f(){
 const times=Array.from({length:241},(_,i)=>new Date(now+i*H).toISOString());
 const rows=value=>times.map(time=>({time,value}));
 return {location:place,current:{...current,wind:0},assembledAt:new Date(now).toISOString(),hours:times.map(time=>({time,temperature:79,condition:'Mostly sunny, then a chance of thunderstorms',wind:'99 mph'})),days:[],metricForecasts:{notes:{},series:{temperature:rows(79),dewpoint:rows(68),wind:rows(4.3)}}};
}
for(const [name,location] of [['Raleigh',place],['Denver',{latitude:39.7392,longitude:-104.9903}],['Seattle',{latitude:47.6062,longitude:-122.3321}],['Jacksonville',{latitude:30.3322,longitude:-81.6557}]]){
 test(name+': identical inputs across sunrise do not generate an observation/forecast-method step',()=>{
  let previous=null,checks=0;
  for(let time=now;time<now+12*H;time+=10*60000){
   const e=solarElevation(time,location.latitude,location.longitude);
   const c=thermalComfort({...current,temperature:66,dewpoint:64},location,time);
   if(previous&&e>previous.e&&e<1){assert.ok(c.rawOutdoors>=previous.value-.001);checks++;}
   previous={e,value:c.rawOutdoors};
  }
  assert.ok(checks>10);
 });
}
test('warm/humid 75 degree boundary has no warmer-formula discontinuity',()=>{
 const a=tier3FeelsLike({...current,temperature:74.99},place,now,'outdoors');
 const b=tier3FeelsLike({...current,temperature:75.01},place,now,'outdoors');
 assert.ok(Math.abs(a.value-b.value)<.05);assert.equal(a.warmerResultOverride,false);
});
test('same-hour cloud grid wins over identical broad storm phrases through all 241 hours',()=>{
 const data=f();rebuildHourlyFeels(data,{now,temperatureAt:()=>null,humidityAt:()=>null,skyAt:()=>20});
 for(const p of data.metricForecasts.series.feels){
  assert.equal(p.inputs.skyCover,20);assert.equal(p.inputEvidence.skyCover,20);
  const expected=tier3FeelsLike({...p.inputs,condition:'Sunny'},place,Date.parse(p.time),'outdoors').value;
  assert.ok(Math.abs(expected-p.value)<.051);
 }
 assert.equal(data.hours.at(-1).wind,'4.3 mph');
 assert.equal(data.hours.at(-1).feelsLikeInputs.wind,4.3);
});
test('day seven uses its own cloud cover, never the current station or first-day cover',()=>{
 const data=f();rebuildHourlyFeels(data,{now,temperatureAt:()=>null,humidityAt:()=>null,skyAt:time=>time>=now+6*24*H?100:0});
 const p=data.metricForecasts.series.feels.find(p=>p.time==='2026-09-13T18:00:00.000Z');
 assert.equal(p.inputs.skyCover,100);assert.equal(p.value,p.shadeValue);
 assert.equal(forecastSample(data,p.time).comfort.sun,null);
});
test('solar estimate is continuous at a numeric cloud-category boundary',()=>{
 for(const threshold of [12,62]){
  const a=tier3FeelsLike({...current,skyCover:threshold-.01},place,Date.parse('2026-09-07T18:00Z'),'outdoors');
  const b=tier3FeelsLike({...current,skyCover:threshold+.01},place,Date.parse('2026-09-07T18:00Z'),'outdoors');
  assert.ok(Math.abs(a.value-b.value)<.01);
 }
});
test('forecast radiation and outputs do not change when current station inputs change',()=>{
 const a=f(),b=f();b.current={temperature:110,dewpoint:80,wind:0,condition:'Sunny'};
 for(const data of [a,b])rebuildHourlyFeels(data,{now,temperatureAt:()=>null,humidityAt:()=>null,skyAt:()=>35});
 assert.deepEqual(a.metricForecasts.series.feels,b.metricForecasts.series.feels);
});
test('invalid data stays unavailable; zero is preserved and extreme wind is not clamped to a plausible reading',()=>{
 assert.equal(tier3FeelsLike({...current,wind:45},place,now).value,null);
 assert.equal(tier3FeelsLike({...current,wind:-1},place,now).value,null);
 assert.equal(tier3FeelsLike({...current,wind:null},place,now).value,null);
 assert.equal(tier3FeelsLike({...current,wind:0},place,now).windUsedMps,.5);
 const data=f();rebuildHourlyFeels(data,{now,temperatureAt:()=>null,humidityAt:()=>null,skyAt:()=>20});
 data.metricForecasts.series.feels[1].value=999;assert.equal(forecastSample(data,data.hours[1].time),null);
});
test('actual RAH Friday-vs-Thursday-night wording is retained as this coming week',()=>{
 const data={signature:'source',location:place,feeds:[{id:'afd',status:'ready'}],discussion:{id:'RAH-test',office:'RAH',issuanceTime:'2026-09-07T07:01:00Z',text:'.DISCUSSION...\nAs of 300 AM Monday...\n\nThere is still some uncertainty with respect to when the front/trough will move through NC (most ensemble guidance suggests Friday vs Thursday night), but rain chances continue through Friday.'}};
 const e=collectDanTakeEvidence(data,now);assert.equal(e.candidates.length,1);
 const c=e.candidates[0];assert.equal(c.validFrom,'2026-09-10T22:00:00.000Z');assert.equal(c.eventEnd,'2026-09-12T04:00:00.000Z');assert.match(c.period,/^This coming week — Thursday.*Friday/);
 const b={mode:'ai',signature:data.signature,...approveDanTake([{evidenceId:c.id,summary:'The front could arrive earlier or later, changing when rain reaches the area.'}],data,now)};
 assert.equal(visibleDanTakeItems(b,data,now).length,1);
});
