import test from 'node:test';
import assert from 'node:assert/strict';
import {comfortDisplayMode,overnightComfort,comfortWeatherKind} from '../public/weather-fusion/experience.js';
import {comfortWindow,comfortNarrative} from '../public/weather-fusion/comfort-outlook.js';

const zone='America/New_York';
const evening=Date.parse('2026-09-05T23:19:00Z'); // 7:19 PM EDT
const times=Array.from({length:12},(_,i)=>new Date(Date.parse('2026-09-06T00:00:00Z')+i*3600000).toISOString());
const forecast={
 location:{timeZone:zone},
 current:{temperature:79,dewpoint:73,humidity:84,wind:2,condition:'Clear'},
 days:[{condition:'Mostly Clear',nightCondition:'Chance Showers And Thunderstorms',pop:10,popNight:31}],
 metricForecasts:{series:{
  feels:times.map((time,i)=>({time,value:[87,85,83,81,79,77,76,75,74,73,72,72][i]})),
  dewpoint:times.map((time,i)=>({time,value:[73,73,72,72,71,71,70,70,70,69,69,69][i]})),
  wind:times.map((time,i)=>({time,value:[2,2,3,3,3,4,4,4,5,5,5,5][i]})),
 }}
};

test('Weather Nourie switches the real-feel card to overnight mode at 6 PM local time and leaves overnight at 5 AM',()=>{
 assert.equal(comfortDisplayMode(Date.parse('2026-09-05T21:59:00Z'),zone),'day');
 assert.equal(comfortDisplayMode(Date.parse('2026-09-05T22:00:00Z'),zone),'overnight');
 assert.equal(comfortDisplayMode(evening,zone),'overnight');
 assert.equal(comfortDisplayMode(Date.parse('2026-09-06T09:30:00Z'),zone),'day'); // 5:30 AM
 assert.equal(comfortDisplayMode(Date.parse('2026-09-06T10:00:00Z'),zone),'day'); // 6 AM
});

test('evening real-feel stops at local midnight and ignores the next morning minimum',()=>{
 const summary=overnightComfort(forecast,evening);
 assert.ok(summary);
 assert.equal(summary.low,81);
 assert.equal(summary.high,87);
 assert.equal(summary.end,'2026-09-06T03:00:00.000Z'); // 11 PM EDT, before midnight
 assert.equal(summary.lowTime,'2026-09-06T03:00:00.000Z');
 assert.match(summary.label,/before midnight/);
 const text=comfortNarrative(forecast.current,{outdoors:82},summary,zone);
 assert.match(text,/before midnight is 81° at 11:00 PM/);
 assert.doesNotMatch(text,/72°|tonight|7:00 AM/);
});

test('daytime remaining peak includes a warmer evening but excludes tomorrow',()=>{
 const f={location:{timeZone:zone},metricForecasts:{series:{feels:[
  {time:'2026-09-05T18:00:00Z',value:75}, // 2 PM
  {time:'2026-09-06T01:00:00Z',value:83}, // 9 PM
  {time:'2026-09-06T04:00:00Z',value:99}, // midnight, tomorrow
 ]}}};
 const summary=comfortWindow(f,Date.parse('2026-09-05T17:30:00Z'));
 assert.equal(summary.chosen.value,83);
 assert.equal(summary.chosen.time,'2026-09-06T01:00:00.000Z');
});

test('no remaining hour before midnight does not borrow tomorrow morning',()=>{
 assert.equal(overnightComfort(forecast,Date.parse('2026-09-06T03:30:00Z')),null);
});

test('the evening cutoff follows the selected timezone across a DST weekend',()=>{
 const time=Date.parse('2026-11-02T04:30:00Z'); // 10:30 PM CST in North Dakota
 const f={location:{timeZone:'America/Chicago'},metricForecasts:{series:{feels:[
  {time:'2026-11-02T05:00:00Z',value:20}, // 11 PM on Nov 1
  {time:'2026-11-02T06:00:00Z',value:5}, // midnight on Nov 2
  {time:'2026-11-02T11:00:00Z',value:0},
 ]}}};
 const summary=comfortWindow(f,time);
 assert.equal(summary.chosen.value,20);
 assert.equal(summary.chosen.time,'2026-11-02T05:00:00.000Z');
});

test('tile artwork follows the relevant near-term weather and nighttime state',()=>{
 assert.equal(comfortWeatherKind(forecast,evening),'night');
 const rainy=structuredClone(forecast);rainy.current.condition='Rain';assert.equal(comfortWeatherKind(rainy,evening),'rain');
 const clear=structuredClone(forecast);clear.current.condition='Clear';assert.equal(comfortWeatherKind(clear,evening),'night');
 const daytime=structuredClone(clear);daytime.current.condition='Sunny';assert.equal(comfortWeatherKind(daytime,Date.parse('2026-09-05T17:00:00Z')),'sun');
});
