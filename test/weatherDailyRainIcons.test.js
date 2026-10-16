import test from 'node:test';
import assert from 'node:assert/strict';
import {dailySkyCover,rainAwareCondition,displayedRainChance} from '../public/weather-fusion/rain-display.js';
import {weatherState,conditionForRainChance} from '../public/weather-fusion/weather-state.js';

test('a small daily rain chance uses the known ordinary sky, without a rainy icon',()=>{
 for(const [cover,kind] of [[5,'clear'],[45,'partly-cloudy'],[95,'cloudy']]){
  for(const condition of ['Chance Rain Showers','Slight Chance Showers And Thunderstorms']){
   const shown=rainAwareCondition(condition,12,{},false,cover);
   assert.equal(weatherState(shown).kind,kind);
  }
 }
 assert.equal(rainAwareCondition('Mostly Sunny with a slight chance of showers',12),'Mostly Sunny');
 assert.equal(rainAwareCondition('Chance Rain Showers',12),'Cloudy');
 assert.equal(rainAwareCondition('',12),'Cloudy');
 assert.equal(rainAwareCondition('Fog',12),'Fog');
});

test('daily rain threshold preserves likely rain, frozen precipitation, and observed rain',()=>{
 assert.equal(weatherState(rainAwareCondition('Chance Rain Showers',34)).kind,'cloudy');
 assert.equal(weatherState(rainAwareCondition('Chance Rain Showers',35)).kind,'rain');
 assert.equal(weatherState(rainAwareCondition('Sunny',60)).kind,'rain');
 assert.equal(rainAwareCondition('Chance Snow',12),'Chance Snow');
 assert.equal(rainAwareCondition('Slight Chance Freezing Rain',12),'Slight Chance Freezing Rain');
 assert.equal(rainAwareCondition('Rain now',12),'Rain now');
 assert.equal(rainAwareCondition('Rain',null),'Rain');
 const now=Date.parse('2026-10-16T23:15:00Z');
 const observed=displayedRainChance({current:{radarPrecipitation:{status:'ready',atLocation:true,observedAt:new Date(now).toISOString()}}},12,{now});
 assert.equal(observed.value,100);assert.equal(observed.observed,true);
 // Selected hourly conditions remain literal; the daily simplification must
 // not silently turn an hourly thunder forecast into sunshine.
 assert.equal(conditionForRainChance('Thunderstorms',12),'Thunderstorms');
});

test('daily wording does not import a following-night storm into this calendar date',()=>{
 assert.equal(rainAwareCondition('Sunny',40,{nightCondition:'Thunderstorms',nightDetail:'Thunderstorms tomorrow morning'}),'Sunny, chance of showers');
});

test('daily sky cover excludes elapsed hours and every hour after local midnight',()=>{
 const now=Date.parse('2026-10-16T23:15:00Z'); // 7:15 PM EDT
 const f={location:{timeZone:'America/New_York'},hours:[
  {time:'2026-10-16T22:00:00Z',skyCover:0},
  {time:'2026-10-16T23:00:00Z',skyCover:80},
  {time:'2026-10-17T03:00:00Z',skyCover:100},
  {time:'2026-10-17T04:00:00Z',skyCover:0}
 ]};
 assert.equal(dailySkyCover(f,{date:'2026-10-16'},0,now),90);
 assert.equal(dailySkyCover(f,{date:'2026-10-17'},1,now),0);
 assert.equal(dailySkyCover(f,{date:'2026-10-18'},2,now),null);
});

test('same-time metric sky fallback fills missing hours without double-counting valid hourly cover',()=>{
 const f={location:{timeZone:'America/New_York'},hours:[{time:'2026-10-17T16:00:00Z',skyCover:20}],metricForecasts:{series:{
  skyCover:[{time:'2026-10-17T16:00:00Z',value:100},{time:'2026-10-17T17:00:00Z',value:40}],
  feels:[{time:'2026-10-17T18:00:00Z',inputs:{skyCover:60}},{time:'2026-10-18T04:00:00Z',inputs:{skyCover:100}}]
 }}};
 assert.equal(dailySkyCover(f,{date:'2026-10-17'},1,0),40);
 assert.equal(dailySkyCover(f,{date:'invalid'},1,0),null);
});

test('local date filtering respects a different time zone through the DST transition',()=>{
 const f={location:{timeZone:'America/Denver'},hours:[
  {time:'2026-11-01T05:00:00Z',skyCover:10}, // Oct 31, 11 PM
  {time:'2026-11-01T06:00:00Z',skyCover:90}, // Nov 1, midnight
  {time:'2026-11-01T07:00:00Z',skyCover:90},
  {time:'2026-11-01T08:00:00Z',skyCover:90}, // repeated 1 AM
  {time:'2026-11-02T07:00:00Z',skyCover:0} // Nov 2, midnight
 ]};
 assert.equal(dailySkyCover(f,{date:'2026-10-31'},0,Date.parse('2026-11-01T05:10:00Z')),10);
 assert.equal(dailySkyCover(f,{date:'2026-11-01'},1,0),90);
});
