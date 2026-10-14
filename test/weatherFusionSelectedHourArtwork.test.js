import test from 'node:test';
import assert from 'node:assert/strict';
import {comfortArtworkContext,comfortNarrative} from '../public/weather-fusion/comfort-outlook.js';
import {comfortSceneState,winterSceneExpected,clothingForFeels,selectedHourSnowPhase} from '../public/weather-fusion/exposure-scene.js';
import {pavementEstimate,pavementHTML,coldPawGuidance} from '../public/weather-fusion/pavement.js';
import {snowHourCondition,hourlySnowHTML,forecastSample} from '../public/weather-fusion/weather-display.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';

const morning='2026-10-15T11:00:00Z',evening='2026-10-16T02:00:00Z';
const forecast={location:{timeZone:'America/Denver',latitude:40,longitude:-105},hours:[
 {time:morning,temperature:51,condition:'Thunderstorms',snowfall:.04},
 {time:evening,temperature:28,condition:'Snow',snowfall:.2}
],snow:{possible:true,snowExpected:true,days:[{date:'2026-10-15',possible:true,snowExpected:true,best:4,nwsSnowfall:4,snowChance:90,periods:[{wording:'Thunderstorms then snow this evening'}]}]}};

test('51-degree 5AM thunderstorms stay rain even when that day and coarse interval contain snow',()=>{
 const sample={time:morning,now:false,temperature:51,feels:33,condition:'Thunderstorms',pop:90};
 const context={...comfortArtworkContext(forecast,sample),condition:sample.condition,pop:sample.pop};
 assert.equal(context.snowExpected,false);assert.equal(context.snowfall,null);assert.equal(context.snowChance,null);
 assert.equal(context.clothingFeels,33);
 assert.equal(comfortSceneState(false,sample.condition,sample.feels,context).key,'rain');
 assert.equal(comfortSceneState(false,sample.condition,sample.feels,context).asset,'comfort-integrated-rain-night.webp');
 assert.equal(snowHourCondition(forecast,sample),null);
 assert.equal(hourlySnowHTML(forecast,sample),'');
 assert.equal(coldPawGuidance(sample.feels,context),null);
 const result=pavementEstimate(forecast,{temperature:51},Date.parse(morning),context);
 assert.notEqual(result.status,'winter');
 const html=pavementHTML(result,sample.feels,{...context,forecast:true});
 assert.doesNotMatch(html,/snow-play-scene|Cold paws|Snow forecast|Rain occurring/);
 assert.match(html,/Rain forecast/);
});
test('selected evening snow retains snow play and winter paw care independently of the earlier storm',()=>{
 const sample={time:evening,now:false,temperature:28,feels:20,condition:'Snow',pop:90};
 const context={...comfortArtworkContext(forecast,sample),condition:sample.condition,pop:sample.pop};
 assert.equal(context.snowExpected,true);assert.equal(context.snowfall,.2);
 assert.equal(context.clothingFeels,20);
 assert.equal(comfortSceneState(false,sample.condition,sample.feels,context).key,'snow');
 assert.ok(coldPawGuidance(sample.feels,context));
 assert.equal(pavementEstimate(forecast,{temperature:28},Date.parse(evening),context).status,'winter');
});
test('warm observed Now never borrows evening snow, future clothing lows or same-hour forecast phase',()=>{
 const sample={time:'2026-10-15T09:00:00Z',now:true,temperature:63,feels:55,condition:'Sunny'};
 const data={...forecast,hours:[{time:morning,temperature:30,condition:'Snow',snowfall:.2},...forecast.hours.slice(1)]};
 const context={...comfortArtworkContext(data,sample,Date.parse(morning)+20*60000),condition:sample.condition};
 assert.equal(context.snowExpected,false);assert.equal(context.snowfall,null);assert.equal(context.clothingFeels,55);
 assert.equal(clothingForFeels(55,{clothingFeels:20}),'cool');
 assert.equal(comfortSceneState(true,sample.condition,sample.feels,context).asset,'comfort-integrated-cool-normal.webp');
 const surface={status:'estimated',daylight:true,concrete:{value:75},asphalt:{value:80}};
 assert.doesNotMatch(pavementHTML(surface,sample.feels,context),/Cold paws|Snow forecast|snow-play-scene/);
 const text=comfortNarrative({temperature:63,dewpoint:45,wind:6},{outdoors:55,daylight:true,weatherKind:'clear'},null,'America/Denver',context);
 assert.doesNotMatch(text,/Snow|remaining feels-like low|heavy coat/);
});
test('weak numeric snowfall is confined to an overlapping cold forecast hour with no conflicting phase',()=>{
 const data={hours:[{time:morning,temperature:32,condition:'Cloudy',snowfall:.1}],snow:forecast.snow};
 const sample={time:morning,now:false,temperature:32,feels:22,condition:'Cloudy'};
 const context=comfortArtworkContext(data,sample);
 assert.equal(context.snowExpected,true);assert.equal(context.snowForecastOnly,true);
 assert.equal(comfortArtworkContext(data,{...sample,time:'2026-10-15T12:00:00Z'}).snowExpected,false,'interval end is not an overlapping hour');
 assert.equal(comfortArtworkContext(data,{...sample,temperature:51}).snowExpected,false,'warm air vetoes coarse snow amount');
 assert.equal(comfortArtworkContext(data,{...sample,temperature:null}).snowExpected,true,'same selected hourly air can fill missing sample air');
 assert.equal(comfortArtworkContext({hours:[{time:morning,snowfall:.1}]},{...sample,temperature:null}).snowExpected,false,'unknown air does not justify snow artwork');
});
test('cold-only, liquid rain, thunder, sleet and freezing rain never acquire snow from numeric or daily flags',()=>{
 for(const condition of ['Sunny','Partly Cloudy','Rain','Thunderstorms','Sleet','Freezing Rain','Ice Pellets']){
  assert.equal(winterSceneExpected(condition,{snowScope:'hour',airTemperature:28,forecast:true,snowExpected:true,snowfall:.1,snowChance:90}),false,condition);
 }
 assert.equal(winterSceneExpected('Cloudy',{snowExpected:true}),false,'untimed daily flag is not selected-hour evidence');
 assert.equal(winterSceneExpected('Cloudy',{snowScope:'hour',airTemperature:28,now:true,snowExpected:true,snowfall:.1}),false,'current cloud report is not future snowfall');
 assert.equal(comfortSceneState(true,'Clear',20).key,'normal');
 assert.equal(winterSceneExpected('Rain And Snow'),true);assert.equal(winterSceneExpected('Snow With Thunder'),true);
 assert.equal(winterSceneExpected('Chance Flurries'),true);
});

function timedTransitionForecast(condition='Cloudy'){
 const location={latitude:42.60118,longitude:-76.18048,timeZone:'America/New_York'},hours=[],series={feels:[],temperature:[],dewpoint:[],wind:[],gust:[]};
 for(const time of ['2026-10-17T05:00:00Z','2026-10-17T06:00:00Z','2026-10-17T08:00:00Z']){
  const inputs={temperature:32,dewpoint:28,humidity:80,wind:5,skyCover:100,condition,type:'guidance'},computed=thermalComfort(inputs,location,Date.parse(time));
  hours.push({time,temperature:32,condition,skyCover:100,snowfall:.1});
  series.feels.push({time,value:Number(computed.rawOutdoors.toFixed(1)),inputs,condition});
  for(const [field,value] of [['temperature',32],['dewpoint',28],['wind',5]])series[field].push({time,value});
 }
 const period={start:'2026-10-16T18:00:00-04:00',end:'2026-10-17T06:00:00-04:00',snowTimed:true,snowPhaseWindows:[{start:'2026-10-17T06:00:00Z',end:'2026-10-17T08:00:00Z'}]};
 return {location,hours,metricForecasts:{series},snow:{days:[{date:'2026-10-16',snowExpected:false,periods:[{...period,snowPhaseWindows:[]}]},{date:'2026-10-17',snowExpected:true,periods:[period]}]}};
}
test('cached coarse snow allocations cannot precede or outlast the explicit NWS 2AM snow phase',()=>{
 const data=timedTransitionForecast();
 for(const [time,expected] of [['2026-10-17T05:00:00Z',false],['2026-10-17T06:00:00Z',true],['2026-10-17T08:00:00Z',false]]){
  assert.equal(selectedHourSnowPhase(data,time),expected,time);
  const sample=forecastSample(data,time);assert.ok(sample,'physical selected-hour sample remains available');
  assert.equal(/snow/i.test(sample.condition),expected,'selected condition respects the same timed veto as art');
  const context=comfortArtworkContext(data,sample);
  assert.equal(context.snowExpected,expected);assert.equal(context.snowfall,expected?.1:null);
  assert.equal(comfortSceneState(false,sample.condition,sample.feels,context).key==='snow',expected);
  assert.equal(!!hourlySnowHTML(data,sample),expected);
  assert.equal(coldPawGuidance(sample.feels,{...context,condition:sample.condition})!==null,expected);
 }
 const before=forecastSample(data,'2026-10-17T05:00:00Z');
 assert.equal(snowHourCondition(data,before),null);
 assert.equal(selectedHourSnowPhase({location:data.location,snow:{days:[]}},before.time),null,'missing clock evidence is unknown');
 assert.equal(selectedHourSnowPhase(data,'2026-10-17T10:00:00Z'),null,'an ended NWS period cannot establish the next period’s phase');
});
test('explicit selected-hour snow wording wins over a contradictory broad-period clock clause',()=>{
 const data=timedTransitionForecast('Snow'),sample=forecastSample(data,'2026-10-17T05:00:00Z');
 assert.equal(selectedHourSnowPhase(data,sample.time),false);
 assert.equal(sample.condition,'Snow');
 assert.equal(comfortArtworkContext(data,sample).snowExpected,true);
 assert.ok(hourlySnowHTML(data,sample));
 const unparsed={...data,snow:{days:data.snow.days.map(row=>({...row,periods:row.periods.map(period=>({...period,snowTimed:false}))}))}};
 assert.equal(selectedHourSnowPhase(unparsed,sample.time),null,'an untimed daily period cannot establish a clock-based veto');
});

