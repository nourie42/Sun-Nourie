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

// Independent pythermalcomfort 4.4.2 reference, round_output=False.
// Ta = Tr = 10.55555556 C; wind is sustained at 10 m, mph * 0.44704 m/s.
// https://pythermalcomfort.readthedocs.io/en/stable/_modules/pythermalcomfort/models/utci.html
const reference={90:[42.697211613378634,36.590024402678175,33.00911003173638,29.874325854919185],100:[43.20077695078985,37.08424646031842,33.49101823958339,30.339090128925168]};
test('cool windy overcast-night equivalent temperatures agree with an independent UTCI reference',()=>{
 for(const humidity of [90,100])for(const [i,wind] of [7,10,12,14].entries()){
  const input={temperature:51,humidity,wind,skyCover:100,condition:'Thunderstorms'};
  const estimate=tier3FeelsLike(input,location,night,'outdoors');
  assert.equal(estimate.deltaMrtC,0,'night has no invented clear-sky radiation penalty');
  assert.equal(estimate.tr,51,'mean radiant temperature is explicitly assumed equal to air at night');
  assert.equal(estimate.windUsedMps,wind*.44704,'sustained 10 m wind is converted exactly once');
  assert.ok(Math.abs(estimate.value-reference[humidity][i])<1e-6);
  assert.equal(thermalComfort(input,location,night).weatherKind,'cloudy','cloud is radiation input; thunder remains the displayed weather');
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
