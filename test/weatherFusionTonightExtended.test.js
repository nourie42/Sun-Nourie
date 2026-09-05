import test from 'node:test';
import assert from 'node:assert/strict';
import {heroWeather} from '../public/weather-fusion/hero-mode.js';
import {addExperience} from '../src/weatherFusionExperience.js';

const H=3600000;
const zone='America/New_York';
const baseData={
 location:{timeZone:zone},
 current:{temperature:79,condition:'Partly Cloudy',type:'observation'},
 days:[{high:86,low:70,condition:'Partly Cloudy',nightCondition:'Mostly Clear'}],
 hours:[{condition:'Partly Cloudy'}],
};

test('after 3 PM the hero shows only tonight low and nighttime condition',()=>{
 const before=heroWeather(baseData,Date.parse('2026-09-05T18:59:59Z'));
 assert.equal(before.tonight,false);assert.equal(before.temperature,79);assert.match(before.range,/High 86°/);
 const after=heroWeather(baseData,Date.parse('2026-09-05T19:00:00Z'));
 assert.equal(after.tonight,true);assert.equal(after.temperature,70);assert.equal(after.condition,'Mostly Clear');assert.equal(after.isDay,false);
 assert.ok(!after.range.includes('70°'),'Tonight temperature must not be duplicated under the hero');
});

test('extended Gross Meter dew point uses real model hours out to ten days',()=>{
 const now=Date.parse('2026-09-05T16:00:00Z'),start=Math.ceil(now/H)*H;
 const times=Array.from({length:241},(_,i)=>(start+i*H)/1000);
 const ecmwf={direct:true,runAt:new Date(start-H).toISOString(),hourly_units:{dew_point_2m:'°F',wind_speed_10m:'mp/h'},hourly:{
  time:times,
  dew_point_2m:times.map((_,i)=>55+i/240*18),
  wind_speed_10m:times.map(()=>7),
 }};
 const out={
  location:{timeZone:zone,latitude:35.787,longitude:-78.4806},
  current:{temperature:78,humidity:60,dewpoint:63,wind:5,condition:'Partly Cloudy'},
  hours:[{time:new Date(start).toISOString(),temperature:78,humidity:60,dewpoint:63,wind:'5 mph',precipitation:0,pop:10}],
  days:Array.from({length:7},(_,i)=>({date:new Date(Date.parse('2026-09-05T12:00:00Z')+i*86400000).toISOString().slice(0,10)})),
 };
 addExperience(out,{models:{ecmwf},grid:{},periods:[],now,solarTimes:()=>({sunrise:null,sunset:null}),nextDate:d=>d});
 const dew=out.metricForecasts.series.dewpoint.filter(p=>Number.isFinite(p.value));
 assert.ok(dew.length>=239,`only ${dew.length} dew-point hours`);
 assert.ok(Date.parse(dew.at(-1).time)-Date.parse(dew[0].time)>=9.8*86400000);
 assert.equal(out.metricForecasts.dewpointHorizonHours,240);
 const wind=out.metricForecasts.series.wind.filter(p=>Number.isFinite(p.value));
 assert.ok(wind.length>=239,'extended wind should accompany dew point for the Gross Meter breeze rule');
});
