import test from 'node:test';
import assert from 'node:assert/strict';
import {computePavementProfile, pavementDayPeak} from '../public/weather-fusion/v3/js/physics.js';

const zone='America/New_York';
const start=Date.parse('2026-11-21T14:00:00Z'); // Saturday 9AM local
const hours=Array.from({length:80},(_,i)=>({time:new Date(start+i*3600000).toISOString(),tempF:i>=48?90:52,humidity:45,windMph:4,cloudCover:15,rainChance:0,precipIn:0}));

test('extending the horizon preserves all existing surface estimates and input data',()=>{
  const before=JSON.stringify(hours),normal=computePavementProfile(hours,47,35.787,-78.48),extended=computePavementProfile(hours,47,35.787,-78.48,72);
  assert.equal(normal.series.length,48);
  assert.equal(extended.series.length,72);
  assert.deepEqual(extended.series.slice(0,48),normal.series);
  assert.equal(extended.concreteTempF,normal.concreteTempF);
  assert.equal(extended.asphaltTempF,normal.asphaltTempF);
  assert.equal(JSON.stringify(hours),before);
});

test('Monday peak includes the selected day afternoon after the 48-hour slider horizon',()=>{
  const profile=computePavementProfile(hours,47,35.787,-78.48,80);
  const peak=pavementDayPeak(profile.series,hours[47].time,zone,start);
  const monday=profile.series.filter(row=>row.time>='2026-11-23T05:00:00Z'&&row.time<'2026-11-24T05:00:00Z');
  assert.equal(peak.dayKey,'2026-11-23');
  assert.equal(peak.dayLabel,'Mon');
  assert.equal(peak.isToday,false);
  assert.equal(peak.hours,24);
  assert.equal(peak.concreteF,Math.max(...monday.map(row=>row.concreteF)));
  assert.equal(peak.asphaltF,Math.max(...monday.map(row=>row.asphaltF)));
  assert.notEqual(peak.asphaltF,profile.peakAsphaltTodayF);
});

test('each selected calendar day has its own peak and Today applies only to the local current date',()=>{
  const profile=computePavementProfile(hours,0,35.787,-78.48,80);
  const today=pavementDayPeak(profile.series,hours[0].time,zone,start);
  const tomorrow=pavementDayPeak(profile.series,hours[24].time,zone,start);
  assert.equal(today.isToday,true);assert.equal(today.hours,15);
  assert.equal(tomorrow.isToday,false);assert.equal(tomorrow.dayLabel,'Sun');assert.equal(tomorrow.hours,24);
});

test('local midnight boundaries use the forecast location rather than UTC or browser timezone',()=>{
  const series=[{time:'2026-11-23T04:00:00Z',concreteF:130,asphaltF:140},{time:'2026-11-23T05:00:00Z',concreteF:50,asphaltF:55},{time:'2026-11-24T04:00:00Z',concreteF:65,asphaltF:70},{time:'2026-11-24T05:00:00Z',concreteF:150,asphaltF:160}];
  const peak=pavementDayPeak(series,'2026-11-23T13:00:00Z',zone,'2026-11-23T02:00:00Z');
  assert.equal(peak.isToday,false);assert.equal(peak.hours,2);assert.equal(peak.asphaltF,70);
  const west=pavementDayPeak(series,'2026-11-23T13:00:00Z','America/Los_Angeles',start);
  assert.equal(west.asphaltF,160);assert.equal(west.concreteF,150);
});

for(const [label,first,count] of [['spring','2026-03-08T05:00:00Z',23],['fall','2026-11-01T04:00:00Z',25]])test(`daylight saving ${label} day includes its actual ${count} published hours`,()=>{
  const t=Date.parse(first),series=Array.from({length:count+2},(_,i)=>({time:new Date(t+i*3600000).toISOString(),concreteF:i,asphaltF:i+1}));
  const peak=pavementDayPeak(series,first,zone,t);
  assert.equal(peak.hours,count);assert.equal(peak.asphaltF,count);
});

test('missing surface values or an invalid date stay unavailable',()=>{
  const series=[{time:hours[0].time,concreteF:null,asphaltF:58},{time:hours[0].time,concreteF:Infinity,asphaltF:null}];
  const peak=pavementDayPeak(series,hours[0].time,zone,start);
  assert.equal(peak.concreteF,null);assert.equal(peak.asphaltF,58);assert.equal(peak.hours,1);
  assert.equal(pavementDayPeak([],hours[0].time,zone,start).asphaltF,null);
  assert.equal(pavementDayPeak(series,'not-a-date',zone,start).dayKey,null);
});
