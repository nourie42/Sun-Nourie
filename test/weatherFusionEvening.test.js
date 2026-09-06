import test from 'node:test';
import assert from 'node:assert/strict';
import {comfortDisplayMode,overnightComfort,comfortWeatherKind} from '../public/weather-fusion/experience.js';

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

test('Weather Nourie switches the real-feel card to overnight mode at 3 PM local time and leaves overnight at 5 AM',()=>{
 assert.equal(comfortDisplayMode(Date.parse('2026-09-05T18:59:00Z'),zone),'day');
 assert.equal(comfortDisplayMode(Date.parse('2026-09-05T19:00:00Z'),zone),'overnight');
 assert.equal(comfortDisplayMode(evening,zone),'overnight');
 assert.equal(comfortDisplayMode(Date.parse('2026-09-06T09:30:00Z'),zone),'day'); // 5:30 AM
 assert.equal(comfortDisplayMode(Date.parse('2026-09-06T10:00:00Z'),zone),'day'); // 6 AM
});

test('evening real-feel uses the hourly forecast through the next local morning instead of a sun value',()=>{
 const summary=overnightComfort(forecast,evening);
 assert.ok(summary);
 assert.equal(summary.low,72);
 assert.equal(summary.high,87);
 assert.equal(summary.end,'2026-09-06T11:00:00.000Z'); // 7 AM EDT
 assert.equal(summary.lowTime,'2026-09-06T10:00:00.000Z');
});

test('tile artwork follows the relevant near-term weather and nighttime state',()=>{
 assert.equal(comfortWeatherKind(forecast,evening),'storm');
 const rainy=structuredClone(forecast);rainy.days[0].nightCondition='Chance Showers';assert.equal(comfortWeatherKind(rainy,evening),'rain');
 const clear=structuredClone(forecast);clear.days[0].nightCondition='Clear';clear.days[0].popNight=10;assert.equal(comfortWeatherKind(clear,evening),'night');
 const daytime=structuredClone(clear);daytime.current.condition='Sunny';assert.equal(comfortWeatherKind(daytime,Date.parse('2026-09-05T17:00:00Z')),'sun');
});
