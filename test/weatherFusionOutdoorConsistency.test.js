import test from 'node:test';
import assert from 'node:assert/strict';
import {thermalComfort,tier3FeelsLike} from '../public/weather-fusion/weather-math.js';
import {OUTDOOR_FEELS_VERSION,outdoorExposure} from '../public/weather-fusion/outdoor-feels.js';
import {currentSample,forecastSample,heroFeelsHTML,renderHourlyWeather} from '../public/weather-fusion/weather-display.js';
import {sunShadeHTML} from '../public/weather-fusion/personal-details.js';
import {feelsAt,dailyFeels} from '../public/weather-fusion/hourly-feels.js';
import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
const H=3600000,now=Date.parse('2026-09-06T21:50:00Z');
const location={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
function make(condition='Sunny',time=now,patch={}){
 const start=Math.floor(time/H)*H;
 const current={temperature:79,dewpoint:68,wind:0,humidity:null,condition,type:'observation',time:new Date(time-35*60000).toISOString(),...patch};
 const times=Array.from({length:48},(_,i)=>new Date(start+i*H).toISOString());
 const rows=value=>times.map(time=>({time,value}));
 const f={location,assembledAt:new Date(time).toISOString(),current,comfort:thermalComfort(current,location,time),
  days:[{date:'2026-09-06'}],hours:times.map(time=>({time,temperature:79,condition,pop:15})),
  metricForecasts:{notes:{},series:{temperature:rows(79),dewpoint:rows(68),wind:rows(0)}}};
 rebuildHourlyFeels(f,{now:time,temperatureAt:()=>({value:null}),humidityAt:()=>null});
 return f;
}
test('86 shade versus 94 sunlight: every main current display selects 94, not 86',()=>{
 const f=make();f.comfort={...f.comfort,shade:86,sun:94,outdoors:94,daylight:true,weatherKind:'clear'};
 const sample=currentSample(f,now);
 assert.equal(sample.feels,94);assert.match(heroFeelsHTML(sample),/<strong>94°<\/strong>/);
 assert.match(heroFeelsHTML(sample),/In direct sun/);
 const root={innerHTML:'',scrollLeft:35};globalThis.document={getElementById:()=>root};
 try{renderHourlyWeather(f,now);assert.match(root.innerHTML,/<span>Now<\/span>.*?Feels like<b>94°<\/b>/);assert.equal(root.scrollLeft,35);}
 finally{delete globalThis.document;}
 const figures=sunShadeHTML(f.comfort,f.location,now);
 assert.match(figures,/shade-person.*?<strong>86°<\/strong>/);assert.match(figures,/sun-person.*?<strong>94°<\/strong>/);
});
for(const [condition,time] of [['Sunny',now],['Partly Cloudy',now],['Overcast',now],['Rain',now],['Thunderstorms',now],['Snow',now],['Fog',now],['',now],['Clear',Date.parse('2026-09-07T03:00:00Z')]]){
 test(`same sky/exposure across API, Now and future preview: ${condition||'unknown'} ${time}`,()=>{
  const f=make(condition,time),sample=currentSample(f,time);
  assert.equal(f.outdoorFeelsVersion,OUTDOOR_FEELS_VERSION);
  assert.equal(sample.feels,f.comfort.outdoors);assert.equal(sample.feels,f.current.feelsLike);
  assert.equal(f.current.feelsLikeShade,f.comfort.shade);
  for(const h of f.hours){
   const point=f.metricForecasts.series.feels.find(p=>p.time===h.time),preview=forecastSample(f,h.time);
   assert.equal(point.exposure,'outdoors');assert.equal(h.feelsLike,point.value);
   assert.equal(preview.feels,point.value);assert.equal(preview.comfort.outdoors,point.value);
   assert.equal(preview.comfort.shade,point.shadeValue);
   assert.equal(feelsAt(f,h.time),point.value);
   assert.equal(f.metricForecasts.series.feelsShade.find(p=>p.time===h.time).value,point.shadeValue);
   if(preview.isDay&&['clear','partly-cloudy'].includes(preview.comfort.weatherKind))assert.equal(preview.comfort.sun,preview.feels);
   else assert.equal(preview.comfort.sun,null);
   const expected=tier3FeelsLike({...point.inputs,condition,type:'guidance'},location,Date.parse(h.time),'outdoors').value;
   assert.ok(Math.abs(expected-point.value)<=.051);
  }
 });
}
test('current readings keep the snapshot even when rendering happens later',()=>{
 const f=make();assert.deepEqual(currentSample(f,now).comfort,currentSample(f,now+60000).comfort);
 assert.equal(currentSample(f,now).time,f.current.time);
});
test('a rainy future hour does not reuse the sunny current observation',()=>{
 const f=make(),h=f.hours[1];h.condition='Rain';
 rebuildHourlyFeels(f,{now,temperatureAt:()=>({value:null}),humidityAt:()=>null});
 const future=forecastSample(f,h.time);assert.equal(future.comfort.sun,null);assert.equal(future.exposure.shortLabel,'In rain');
 assert.equal(future.comfort.outdoors,future.feels);assert.equal(future.inputs.condition,'Rain');
 assert.notEqual(future.feels,currentSample(f,now).feels);
});
test('zero is real; explicit missing is not replaced by an unrelated shade or sun reading',()=>{
 assert.equal(outdoorExposure({outdoors:0,shade:-1,daylight:false}).value,0);
 assert.equal(outdoorExposure({outdoors:null,shade:86,sun:94,daylight:true}).value,null);
 assert.equal(outdoorExposure({shade:86,sun:94,daylight:false}).value,86);
 const f=make('Sunny',now,{wind:null});assert.equal(currentSample(f,now).feels,null);
 f.metricForecasts.series.wind[1].value=null;rebuildHourlyFeels(f,{now,temperatureAt:()=>({value:null}),humidityAt:()=>null});
 assert.equal(forecastSample(f,f.hours[1].time).feels,null);
 assert.equal(forecastSample(f,f.hours[1].time).comfort.outdoors,null);
});
test('daily extrema use the very same outdoor hourly series',()=>{
 const f=make();const d=dailyFeels(f,0,now);
 for(const summary of [d.high,d.low])if(summary){
  assert.equal(feelsAt(f,summary.high.time),summary.high.value);
  assert.equal(feelsAt(f,summary.low.time),summary.low.value);
 }
});
