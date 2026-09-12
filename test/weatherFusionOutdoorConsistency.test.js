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
test('current display independently calculates inputs and rejects a painted 999 degree cache',()=>{
 const f=make(),expected=thermalComfort(f.current,f.location,now);
 f.comfort={...expected,shade:999,sun:999,outdoors:999};const sample=currentSample(f,now);
 assert.equal(sample.feels,expected.outdoors);assert.notEqual(sample.feels,999);
 assert.ok(heroFeelsHTML(sample).includes('<strong>'+expected.outdoors+'°</strong>'));
 const root={innerHTML:'',scrollLeft:35};globalThis.document={getElementById:()=>root};
 try{renderHourlyWeather(f,now);assert.ok(root.innerHTML.includes('Feels <b>'+expected.outdoors+'°</b>'));assert.equal(root.scrollLeft,35);}finally{delete globalThis.document;}
 assert.ok(!sunShadeHTML(sample.comfort,f.location,now).includes('999°'));
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
test('Now reports the observed precipitation state while future hours preserve canonical rain',()=>{
 const f=make();
 for(const hour of f.hours){hour.pop=90;hour.rainLikelihood={value:null};}
 assert.equal(currentSample(f,now).pop,0);
 assert.deepEqual(currentSample(f,now).currentPrecipitation,{active:false,label:'Dry at station',source:'The nearby station reports no precipitation; radar is checked separately.'});
 assert.equal(forecastSample(f,f.hours[1].time).pop,null);
 f.hours[1].rainLikelihood.value=0;
 assert.equal(forecastSample(f,f.hours[1].time).pop,0);
 f.current.condition='Rain';
 assert.equal(currentSample(f,now).pop,100);
 assert.equal(currentSample(f,now).currentPrecipitation.label,'Rain now');
 f.current.type='forecast';
 assert.equal(currentSample(f,now).pop,null,'without a station observation Now retains the canonical current-hour estimate');
});
test('fresh observed radar overrides a dry station label and keeps nearby rain distinct',()=>{
 const f=make('Cloudy');
 f.current.radarPrecipitation={status:'ready',observedAt:new Date(now).toISOString(),atLocation:true,nearby:true,scanRadiusMiles:12};
 let sample=currentSample(f,now);assert.equal(sample.currentPrecipitation.label,'Rain on radar');assert.equal(sample.currentPrecipitation.active,true);assert.equal(sample.condition,'Rain');
 f.current.radarPrecipitation.atLocation=false;
 sample=currentSample(f,now);assert.equal(sample.currentPrecipitation.label,'Rain nearby');assert.equal(sample.currentPrecipitation.active,false);assert.equal(sample.currentPrecipitation.nearby,true);assert.equal(sample.condition,'Cloudy');
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
 const f=make('Sunny',now,{wind:null});assert.ok(Number.isFinite(currentSample(f,now).feels));assert.deepEqual(currentSample(f,now).inputs.comfortEstimatedFields,['wind']);
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
