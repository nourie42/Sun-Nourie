import test from 'node:test';
import assert from 'node:assert/strict';
import {dewpointFeelLevel,dewpointDryLevel,forecastFeelLevel,heatedIndoorHumidity,dryForecastSummary} from '../public/weather-fusion/dewpoint-meter.js';

test('Feel Meter distinguishes very dry winter air from comfortable lower moisture',()=>{
 assert.equal(dewpointFeelLevel(20).key,'parched');
 assert.match(dewpointFeelLevel(20).label,/zap/i);
 assert.match(dewpointFeelLevel(20).note,/outdoor humidity can still be high/i);
 assert.equal(dewpointFeelLevel(40).key,'crisp');
 assert.equal(dewpointDryLevel(50).key,'pleasant');
 assert.match(forecastFeelLevel(20).label,/sparks/i);
 assert.equal(dewpointFeelLevel(null).key,'unknown');
});

test('heated-air humidity reflects moisture rather than outdoor relative humidity',()=>{
 assert.equal(heatedIndoorHumidity(20),16);
 assert.ok(Math.abs(heatedIndoorHumidity(35)-30)<=1);
 assert.equal(heatedIndoorHumidity(68),100);
 assert.equal(heatedIndoorHumidity(null),null);
 assert.equal(heatedIndoorHumidity(70),null);
});

test('dry forecast counts available hours, keeps missing values unknown and reports the range',()=>{
 const now=Date.parse('2026-10-14T00:00:00Z');
 const points=[20,30,null,40,60];
 const forecast={metricForecasts:{series:{dewpoint:points.map((value,i)=>({time:new Date(now+i*3600000).toISOString(),value}))}}};
 const result=dryForecastSummary(forecast,now,6);
 assert.equal(result.available,4);
 assert.equal(result.partial,true);
 assert.equal(result.veryDryHours,2);
 assert.equal(result.dryHours,3);
 assert.equal(result.low,20);
 assert.equal(result.high,60);
 assert.match(result.label,/2 of 4 available/i);
 assert.match(result.note,/doorknob zap/i);
 assert.equal(dryForecastSummary({},now,6).available,0);
});
