import test from 'node:test';
import assert from 'node:assert/strict';
import {conditionForDaylight} from '../public/weather-fusion/weather-state.js';
import {solarElevation} from '../public/weather-fusion/weather-math.js';
import {peakComparisonHTML} from '../public/weather-fusion/weather-display.js';

test('clear and sunny conditions become night descriptions without changing rain',()=>{
 assert.equal(conditionForDaylight('Sunny',false),'Clear');
 assert.equal(conditionForDaylight('Mostly Sunny',false),'Mostly clear');
 assert.equal(conditionForDaylight('Partly Sunny',false),'Partly cloudy');
 assert.equal(conditionForDaylight('Rain',false),'Rain');
 assert.equal(conditionForDaylight('Sunny',true),'Sunny');
});
test('Knightdale is dark at 5:58 PM EST on November 8',()=>{
 const t=Date.parse('2026-11-08T17:58:00-05:00');
 assert.ok(solarElevation(t,35.79,-78.48)<0);
});
