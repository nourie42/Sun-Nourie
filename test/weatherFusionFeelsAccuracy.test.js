import test from 'node:test';
import assert from 'node:assert/strict';
import {thermalComfort,tier3FeelsLike} from '../public/weather-fusion/weather-math.js';
import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
import {forecastSample,renderHourlyWeather} from '../public/weather-fusion/weather-display.js';
import {comfortInputsHTML} from '../public/weather-fusion/experience.js';
import {sunShadeHTML} from '../public/weather-fusion/personal-details.js';
const H=3600000;
const location={latitude:47.2944,longitude:-101.6227,timeZone:'America/North_Dakota/Beulah'};
const night=Date.parse('2026-10-16T10:00:00Z');

import {utciF} from '../public/weather-fusion/utci.js';

// Above 60°F the NWS wind chill blend is inactive, so the value must match
// the independent pythermalcomfort 4.4.2 UTCI polynomial exactly.
// Ta = Tr = 15.55555556 C (60°F+); wind is sustained at 10 m, mph * 0.44704 m/s.
// https://pythermalcomfort.readthedocs.io/en/stable/_modules/pythermalcomfort/models/utci.html
test('warm windy overcast-night equivalent temperatures agree with an independent UTCI reference',()=>{
 for(const humidity of [90,100])for(const wind of [7,10,12,14]){
  const input={temperature:61,humidity,wind,skyCover:100,condition:'Thunderstorms'};
  const estimate=tier3FeelsLike(input,location,night,'outdoors');
  assert.equal(estimate.deltaMrtC,0,'night has no invented clear-sky radiation penalty');
  assert.equal(estimate.tr,61,'mean radiant temperature is explicitly assumed equal to air at night');
  assert.equal(estimate.windUsedMps,wind*.44704,'sustained 10 m wind is converted exactly once');
  assert.equal(estimate.windChillFloor,false,'no wind chill floor above 60°F');
  assert.ok(Math.abs(estimate.value-utciF(61,61,wind,humidity))<1e-6);
  assert.equal(thermalComfort(input,location,night).weatherKind,'cloudy','cloud is radiation input; thunder remains the displayed weather');
 }
});

test('warm direct sun projects solar gain onto a standing body without changing shade UTCI',()=>{
 // Captured Knightdale inputs at 2 PM EDT on 2026-10-20: the old horizontal
 // solar projection made the direct-sun result colder than the reported feel.
 const place={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
 const time=Date.parse('2026-10-20T18:00:00Z');
 const input={temperature:71,dewpoint:39.6,wind:11,skyCover:1.0931,condition:'Sunny'};
 const comfort=thermalComfort(input,place,time);
 const shade=tier3FeelsLike(input,place,time,'shade');
 assert.equal(comfort.sun,74);
 assert.ok(comfort.rawOutdoors>=73.5&&comfort.rawOutdoors<74.5,comfort.rawOutdoors);
 assert.ok(Math.abs(comfort.rawShade-59.516562899543516)<1e-9,'shade retains the standard 10 m UTCI input');
  assert.equal(shade.windUsedMps,11*.44704);
  assert.equal(comfort.inputEvidence.windUsedMps,11*.44704);
  assert.match(comfort.inputEvidence.windPolicy,/Source 10 m wind/);
  assert.match(comfort.inputEvidence.radiationModel,/standing-person effective radiant field/);
  assert.ok(comfort.inputEvidence.projectedAreaFactor>.23&&comfort.inputEvidence.projectedAreaFactor<.24);
  assert.ok(comfort.inputEvidence.meanRadiantTemperatureF>123&&comfort.inputEvidence.meanRadiantTemperatureF<125);
  const extreme=thermalComfort({...input,solarRadiation:5000,solarSource:'test model radiation'},place,time);
  assert.ok(extreme.absorbedRadiation<=130,'the final effective radiant field retains the documented ceiling');
  assert.ok(extreme.inputEvidence.solarScale<=1);
});

test('standing-person solar load fades smoothly with cloud and solar elevation',()=>{
 const place={latitude:35.787,longitude:-78.4806},day=Date.parse('2026-10-20T18:00:00Z');
 const input={temperature:71,dewpoint:40,wind:11,condition:'Sunny'};
 const clear=thermalComfort({...input,skyCover:0},place,day),overcast=thermalComfort({...input,skyCover:100},place,day);
 assert.ok(clear.rawOutdoors>overcast.rawOutdoors);
 assert.ok(Math.abs(overcast.rawOutdoors-overcast.rawShade)<1e-9,'overcast outdoors returns to shade');
 for(const boundary of [12,62]){
  const below=thermalComfort({...input,skyCover:boundary-.001},place,day).rawOutdoors;
  const above=thermalComfort({...input,skyCover:boundary+.001},place,day).rawOutdoors;
  assert.ok(Math.abs(below-above)<.01,`no cloud-category jump at ${boundary}%`);
 }
 const horizon=Date.parse('2026-10-20T11:24:00Z'),before=thermalComfort({...input,skyCover:0},place,horizon-60000),after=thermalComfort({...input,skyCover:0},place,horizon+60000);
 assert.ok(Math.abs(before.rawOutdoors-after.rawOutdoors)<1,'solar load fades near the horizon');
});

test('hourly rebuild carries timestamp-matched model radiation into the canonical feels series',()=>{
 const time='2026-10-20T18:00:00.000Z',epoch=Date.parse(time),point={time};
 const forecast={location:{latitude:35.787,longitude:-78.4806},current:null,
  hours:[{time,temperature:71,condition:'Sunny'}],metricForecasts:{notes:{},series:{
   temperature:[{...point,value:71}],dewpoint:[{...point,value:39.6}],wind:[{...point,value:11}],humidity:[]}}};
 rebuildHourlyFeels(forecast,{now:epoch,temperatureAt:()=>null,humidityAt:()=>null,
  skyAt:()=>({value:1.0931,source:'test sky'}),solarAt:()=>({value:703.1,source:'test shortwave'})});
 const feel=forecast.metricForecasts.series.feels[0];
 assert.equal(feel.inputs.solarRadiation,703.1);
 assert.equal(feel.inputs.solarSource,'test shortwave');
 assert.equal(feel.inputEvidence.solarRadiationWm2,703.1);
 assert.match(feel.inputEvidence.radiationBasis,/Same-hour model shortwave radiation/);
 assert.equal(Math.round(feel.value),74);
});

const nwsWindChill=(tF,windMph)=>{const p=Math.pow(windMph,.16);return 35.74+.6215*tF-35.75*p+.4275*tF*p;};
test('cold wind feels-like never falls below the NWS wind chill figure',()=>{
 // Daniel's reported case: 36°F air, 13 mph wind showed 8°F; NWS says 27°F.
 const cold=tier3FeelsLike({temperature:36,humidity:70,wind:13,skyCover:95},location,night,'outdoors');
 assert.equal(cold.windChillFloor,true);
 assert.ok(Math.abs(cold.value-nwsWindChill(36,13))<.6,'36°F/13mph reads the NWS wind chill, not 8°F');
 assert.ok(cold.value>25&&cold.value<30);
 for(const [temp,wind] of [[30,14],[20,20],[40,10]]){
  const estimate=tier3FeelsLike({temperature:temp,humidity:70,wind,skyCover:95},location,night,'outdoors');
  assert.ok(estimate.value>=nwsWindChill(temp,wind)-.6,`floor holds at ${temp}°F/${wind}mph`);
 }
 // Warm conditions are untouched.
 const warm=tier3FeelsLike({temperature:75,humidity:60,wind:14,skyCover:20},location,night,'outdoors');
 assert.equal(warm.windChillFloor,false);
 assert.ok(Math.abs(warm.value-utciF(75,75,14,60))<1e-6);
});

test('the wind chill blend has no step at its temperature or wind boundaries',()=>{
 for(const temp of [39.99,40.01,59.99,60.01,49.99,50.01]){
  const a=tier3FeelsLike({temperature:temp-.01,humidity:70,wind:14,skyCover:95},location,night).value;
  const b=tier3FeelsLike({temperature:temp+.01,humidity:70,wind:14,skyCover:95},location,night).value;
  assert.ok(Math.abs(a-b)<.1,`no step crossing ${temp}°F`);
 }
 // Monotonic through the ramp: warmer air never feels colder.
 let prev=-Infinity;
 for(let temp=30;temp<=65;temp+=1){
  const v=tier3FeelsLike({temperature:temp,humidity:70,wind:14,skyCover:95},location,night).value;
  assert.ok(v>=prev-.05,`monotonic at ${temp}°F`);
  prev=v;
 }
});

test('small wind changes and the 50 F boundary have no formula-selection discontinuity',()=>{
 for(const wind of [7,10,12,14]){
  const input={temperature:51,humidity:96,wind,skyCover:100,condition:'Thunderstorms'};
  const a=tier3FeelsLike({...input,wind:wind-.01},location,night).value;
  const b=tier3FeelsLike({...input,wind:wind+.01},location,night).value;
  assert.ok(Math.abs(a-b)<.05);
 }
 const a=tier3FeelsLike({temperature:49.99,humidity:96,wind:14,skyCover:100},location,night).value;
 const b=tier3FeelsLike({temperature:50.01,humidity:96,wind:14,skyCover:100},location,night).value;
 assert.ok(Math.abs(a-b)<.05);
});

function scenario(){
 const times=[0,1,2,3].map(i=>new Date(night-3*H+i*H).toISOString());
 const row=values=>times.map((time,i)=>({time,value:values[i]}));
 const forecast={location,current:{temperature:63,dewpoint:59,wind:5,condition:'Cloudy'},days:[],
  hours:times.map((time,i)=>({time,temperature:[50,50,51,51][i],condition:'Thunderstorms',pop:100})),
  metricForecasts:{notes:{},series:{temperature:row([50,50,51,51]),dewpoint:row([48,50,50,50]),wind:row([7,10,12,14]),gust:row([22,24.9,25.1,28])}}};
 rebuildHourlyFeels(forecast,{now:Date.parse(times[0]),temperatureAt:()=>null,humidityAt:()=>null,skyAt:()=>100});
 return forecast;
}
test('selected storm hours, hourly tiles and outdoor figure read the same timestamp and thermal value',()=>{
 const forecast=scenario();
 const root={innerHTML:'',scrollLeft:0};globalThis.document={getElementById:()=>root};
 try{renderHourlyWeather(forecast,Date.parse(forecast.hours[0].time)-1);}finally{delete globalThis.document;}
 for(const hour of forecast.hours){
  const point=forecast.metricForecasts.series.feels.find(p=>p.time===hour.time),sample=forecastSample(forecast,hour.time);
  assert.equal(sample.temperature,hour.temperature);
  assert.equal(sample.feels,point.value);
  assert.equal(sample.comfort.outdoors,sample.feels);
  assert.equal(sample.inputs.wind,point.inputs.wind);
  assert.equal(sample.inputs.skyCover,100);
  assert.equal(sample.condition,'Thunderstorms');
  assert.equal(sample.comfort.inputEvidence.meanRadiantTemperatureF,hour.temperature);
  assert.match(root.innerHTML,new RegExp(`data-time="${hour.time}"[\\s\\S]*?Feels <b>${Math.round(sample.feels)}°</b>`));
  const figure=sunShadeHTML(sample.comfort,location,Date.parse(sample.time),{compact:true,primaryFeels:sample.feels,condition:sample.condition,forecast:true});
  assert.match(figure,new RegExp(`<strong>${Math.round(sample.feels)}°</strong>`));
  assert.doesNotMatch(figure,/data-scene="snow-play"/);
  const caption=comfortInputsHTML(sample);
  assert.match(caption,new RegExp(`Air ${hour.temperature}° · Thunderstorms · Wind ${Math.round(sample.inputs.wind)} mph`));
  if(Math.abs(sample.temperature-sample.feels)>=10)assert.match(caption,/estimated thermal comfort temperature/);
 }
});

test('visible selected-hour context escapes provider wording and does not label missing readings as zero',()=>{
 const html=comfortInputsHTML({temperature:null,feels:null,condition:'<img src=x>',inputs:{wind:null}});
 assert.match(html,/Air —/);assert.match(html,/Wind unavailable/);assert.match(html,/&lt;img src=x&gt;/);
 assert.doesNotMatch(html,/<img|Air 0/);
});
