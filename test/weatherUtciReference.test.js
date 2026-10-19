import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {utciC} from '../public/weather-fusion/utci.js';
import {thermalComfort,tier3FeelsLike} from '../public/weather-fusion/weather-math.js';

const reference=JSON.parse(readFileSync(new URL('./fixtures/utci-ecmwf-reference.json',import.meta.url),'utf8'));
test('UTCI arithmetic agrees with 320 independently generated ECMWF reference vectors',()=>{
 assert.equal(reference.vectors.length,320);
 for(const row of reference.vectors){
  const value=utciC(row.t,row.tr,row.v,row.rh);
  assert.ok(Number.isFinite(value));
  assert.ok(Math.abs(value-row.reference)<1e-9,JSON.stringify({...row,actual:value}));
 }
});

test('the published UTCI vapour-pressure domain is enforced, with zero humidity retained',()=>{
 assert.equal(utciC(40,40,2,80),null,'very high vapour pressure is beyond the fitted5kPa domain');
 assert.ok(Number.isFinite(utciC(40,40,2,50)));
 assert.ok(Number.isFinite(utciC(40,40,2,0)));
 assert.ok(Number.isFinite(utciC(40,40,2,80,{limit:false})),'extrapolation requires an explicit caller opt-out');
});

test('cold-weather blending is identified as a custom adjustment rather than pure UTCI',()=>{
 const time=Date.parse('2026-10-19T06:00:00Z'),location={latitude:35.787,longitude:-78.4806};
 const cold=tier3FeelsLike({temperature:36,humidity:70,wind:13,skyCover:95},location,time);
 assert.equal(cold.windChillFloor,true);
 assert.match(cold.method,/custom cold-weather blend/);
 const warm=tier3FeelsLike({temperature:75,humidity:50,wind:5},location,time);
 assert.doesNotMatch(warm.method,/custom cold-weather blend/);
});

test('unavailable radiation inputs are disclosed instead of described as measured sky evidence',()=>{
 const time=Date.parse('2026-10-19T16:00:00Z'),input={temperature:59,dewpoint:42,wind:11};
 const missingSky=thermalComfort(input,{latitude:35.787,longitude:-78.4806},time);
 assert.match(missingSky.inputEvidence.radiationBasis,/Sky data unavailable/);
 assert.equal(missingSky.sun,null);
 const missingPosition=thermalComfort(input,{},time);
 assert.match(missingPosition.inputEvidence.radiationBasis,/Solar position unavailable/);
 assert.equal(missingPosition.daylight,null);
});
