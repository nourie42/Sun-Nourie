import test from 'node:test';
import assert from 'node:assert/strict';
import {thermalRisk,thermalRiskHTML} from '../public/weather-fusion/thermal-risk.js';
test('UTCI heat and cold stress boundaries use unrounded Fahrenheit readings',()=>{
 for(const [value,key] of [[89.6,'strong-heat'],[100.4,'very-strong-heat'],[114.8,'extreme-heat'],[8.6,'strong-cold'],[-16.6,'very-strong-cold'],[-40,'extreme-cold']])assert.equal(thermalRisk(value).key,key);
 for(const value of [89.59,8.61,70,null,undefined,NaN,Infinity,'105'])assert.equal(thermalRisk(value),null);
 assert.equal(thermalRisk(100.39).key,'strong-heat');
 assert.equal(thermalRisk(-16.59).key,'strong-cold');
});
test('risk markup is absent for normal or missing readings, with explicit estimate labels for risks',()=>{
 for(const value of [70,null,undefined,NaN])assert.equal(thermalRiskHTML(value),'');
 assert.match(thermalRiskHTML(105),/Very strong heat stress/);
 assert.match(thermalRiskHTML(105,true),/High heat risk/);
 assert.match(thermalRiskHTML(0,true),/Cold stress/);
 assert.match(thermalRiskHTML(105),/not an official alert/);
});
