import test from 'node:test';import assert from 'node:assert/strict';
import {mainTrendSeries,trendReading,TREND_METRICS} from '../public/weather-fusion/main-hourly-trend.js';
import {mountChart,layoutChart} from '../public/weather-fusion/halo.js';
test('main graph shares Halo renderer and offers twelve simple weather variables',()=>{assert.equal(typeof mountChart,'function');assert.equal(Object.keys(TREND_METRICS).length,12);});
test('graph preserves actual hourly inputs, missing gaps, zero clouds and pressure units',()=>{
 const time='2026-10-24T12:00:00Z';const input={hours:[{time,temperature:68,wind:'8 mph'}],rainTimeline:[{time,precipitation:.02,rainLikelihood:{value:30}}],metricForecasts:{series:{feels:[{time,value:70,inputs:{skyCover:0}}],pressure:[{time,value:30}],humidity:[{time,value:50}]}},airQuality:{hours:[{time,aqi:40}]}};
 const s=mainTrendSeries(input);assert.equal(s.rainfall[0].v,.02);assert.equal(s.cloud[0].v,0);assert.ok(Math.abs(s.pressure[0].v-1015.9167)<.0001);assert.equal(s.aqi[0].v,40);assert.equal(s.temperature[0].v,68);assert.equal(trendReading('cloud',s.cloud[0]),'0%');assert.equal(trendReading('rainfall',{v:null}),'Unavailable');
 const layout=layoutChart({points:s.cloud,t0:Date.parse(time),t1:Date.parse(time)+48*3600000,width:412,height:260,domain:[0,100],tz:'America/New_York'});assert.equal(layout.vals[0].v,0);
});
