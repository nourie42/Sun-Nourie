import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeries} from '../public/weather-fusion/wn-blend.js';
const now=Date.parse('2026-10-24T12:30:00Z'),H=3600000,start=Date.parse('2026-10-24T12:00:00Z');
function fixture(){return {location:{timeZone:'UTC'},days:[{date:'2026-10-24',confidence:{weather:{evidence:{sky:{window:{start:new Date(now).toISOString(),end:new Date(start+2*H).toISOString()}}}}}}],hours:[],metricForecasts:{series:{cloud:[0,100].map((value,i)=>({time:new Date(start+i*H).toISOString(),value,sources:[{id:'nws',value:0},{id:'wn',value:100},{id:'hrrr',value}]}))}}};}
test('cloud comparison uses the assessed window and time-weighted percentages with all models',()=>{const f=fixture(),b=buildSeries(f,null,'cloud',now);assert.ok(Math.abs(b.forecastValues[0]-100/1.5)<1e-8);assert.deepEqual(b.modelMaps[0],{nws:0,wn:100,hrrr:100/1.5});});
test('missing coverage stays unavailable while zero cloud cover remains valid',()=>{const f=fixture();f.metricForecasts.series.cloud[1].sources=f.metricForecasts.series.cloud[1].sources.filter(s=>s.id!=='hrrr');const b=buildSeries(f,null,'cloud',now);assert.equal(b.modelMaps[0].hrrr,undefined);assert.equal(b.modelMaps[0].nws,0);});
test('duplicate cloud intervals cannot manufacture full coverage',()=>{const f=fixture();f.metricForecasts.series.cloud.push(structuredClone(f.metricForecasts.series.cloud[0]));const b=buildSeries(f,null,'cloud',now);assert.equal(b.forecastValues[0],null);assert.deepEqual(b.modelMaps[0],{});});
