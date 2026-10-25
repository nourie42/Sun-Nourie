import test from 'node:test';
import assert from 'node:assert/strict';
import {thermalComfort,tier3FeelsLike,solarElevation} from '../public/weather-fusion/weather-math.js';
import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
import {forecastSample,renderHourlyWeather} from '../public/weather-fusion/weather-display.js';
import {comfortInputsHTML} from '../public/weather-fusion/experience.js';
import {sunShadeHTML} from '../public/weather-fusion/personal-details.js';
const H=3600000;
const location={latitude:47.2944,longitude:-101.6227,timeZone:'America/North_Dakota/Beulah'};
const night=Date.parse('2026-10-16T10:00:00Z');

import {utciF} from '../public/weather-fusion/utci.js';

test('the reported sunny 65 F afternoon keeps correct inputs and raises the high-sun radiant estimate',()=>{
 const place={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
 const time=Date.parse('2026-10-19T19:00:00Z'); // Monday 3 PM EDT, not UTC 3 PM.
 const input={temperature:65,dewpoint:43.8,wind:12,skyCover:10.6716,condition:'Sunny'};
 const before=structuredClone(input);
 const shade=tier3FeelsLike(input,place,time,'shade');
 const outdoor=tier3FeelsLike(input,place,time,'outdoors');
 // Independent pythermalcomfort 3.8.0, round_output=False. These pins verify
 // the UTCI calculation at the model's estimated MRT; they do not validate
 // that unmeasured radiant environment or a particular person's comfort.
 const reference={shade:51.21991736056883,outdoor:58.30233341527084};
 assert.ok(Math.abs(solarElevation(time,place.latitude,place.longitude)*180/Math.PI-36.0633)<.001);
 for(const estimate of [shade,outdoor]){
  assert.ok(Math.abs(estimate.rh-46.11676183545536)<1e-10);
  assert.equal(estimate.windUsedMps,5.36448,'12 mph is standard 10 m wind, converted once');
  assert.equal(estimate.windChillFloor,false,'NWS wind chill is not extrapolated into this 65 F case');
 }
 assert.ok(Math.abs(shade.value-reference.shade)<1e-8);
 assert.ok(Math.abs(outdoor.valueBeforeSunFloor-utciF(input.temperature,outdoor.tr,input.wind,outdoor.rh))<1e-8,'the UTCI equation stays unchanged at the revised estimated MRT (before the separate sun floor)');
 assert.ok(outdoor.valueBeforeSunFloor>reference.outdoor+2&&outdoor.valueBeforeSunFloor<reference.outdoor+5,'the requested midday solar adjustment raises this example moderately');
 assert.ok(outdoor.tr>shade.tr,'direct sunlight increases the estimated radiant temperature');
 assert.ok(outdoor.value>shade.value+7,'sunlight is included rather than silently using shade');
 assert.ok(tier3FeelsLike({...input,wind:6},place,time,'outdoors').value>65,'a lighter breeze can feel warmer than air');
 assert.match(comfortInputsHTML({temperature:65,feels:58.3,condition:'Sunny',inputs:{wind:12}}),/Comfort estimate includes sun, wind and humidity\./,'even a sub-10 F difference is identified as modeled comfort');
 assert.deepEqual(input,before,'thermal estimation cannot rewrite the source forecast');
});

for(const temperature of [35,65,85])test(`${temperature} F: clouds, solar position and wind affect the same outdoor estimate`,()=>{
 const place={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
 const highSun=Date.parse('2026-10-19T17:00:00Z'),nightTime=Date.parse('2026-10-20T03:00:00Z');
 const input={temperature,humidity:50,wind:12,skyCover:0,condition:'Sunny'};
 const sun=thermalComfort(input,place,highSun);
 const cloud=thermalComfort({...input,skyCover:100,condition:'Overcast'},place,highSun);
 const dark=thermalComfort({...input,condition:'Clear'},place,nightTime);
 const lighterWind=thermalComfort({...input,wind:6},place,highSun);
 assert.equal(sun.daylight,true);assert.equal(dark.daylight,false);
 assert.ok(sun.inputEvidence.meanRadiantTemperatureF>cloud.inputEvidence.meanRadiantTemperatureF);
 assert.equal(cloud.rawShade,cloud.rawOutdoors,'overcast has no direct-beam addition');
 assert.equal(dark.inputEvidence.meanRadiantTemperatureF,temperature,'no invented sun load at night');
 assert.equal(dark.rawShade,dark.rawOutdoors);
 assert.ok(sun.rawOutdoors>=cloud.rawOutdoors);
 assert.ok(sun.rawOutdoors>=dark.rawOutdoors);
 assert.ok(lighterWind.rawOutdoors>sun.rawOutdoors,'a stronger breeze increases cooling');
 if(temperature>=65)assert.ok(sun.rawOutdoors>cloud.rawOutdoors+5,'mild and hot sunshine visibly raises equivalent temperature');
 // At 35 F the existing NWS cold-wind floor can equalize sun and shade.
 // It must not make adding sunshine lower the estimate.
});

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
  assert.match(caption,/Comfort estimate includes sun, wind and humidity\./);
 }
});

test('visible selected-hour context escapes provider wording and does not label missing readings as zero',()=>{
 const html=comfortInputsHTML({temperature:null,feels:null,condition:'<img src=x>',inputs:{wind:null}});
 assert.match(html,/Air —/);assert.match(html,/Wind unavailable/);assert.match(html,/&lt;img src=x&gt;/);
 assert.doesNotMatch(html,/<img|Air 0/);
 assert.doesNotMatch(html,/Comfort estimate includes/,'missing feels-like is not presented as an available estimate');
});
