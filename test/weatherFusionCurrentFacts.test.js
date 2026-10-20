import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {currentFeelMeterFacts,currentDewpointValue} from '../public/weather-fusion/dewpoint-meter.js';
import {currentSample} from '../public/weather-fusion/weather-display.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';
import {currentReadingFreshness} from '../public/weather-fusion/weather-freshness.js';

const NOW=Date.parse('2026-10-20T09:23:00Z'),H=3600000,iso=t=>new Date(t).toISOString();
function fixture(){return {
 assembledAt:iso(NOW),location:{latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'},
 current:{type:'guidance',time:iso(NOW-23*60000),temperature:46,dewpoint:38,humidity:73,wind:7,condition:'Clear',skyCover:0,
  localEstimate:{source:'Selected-location current-hour forecast blend'}},
 comfort:{outdoors:999},hours:[],metricForecasts:{series:{dewpoint:[]}}
};}

test('Feel Meter facts use current custom feels, not a retained comfort object',()=>{
 const f=fixture(),facts=currentFeelMeterFacts(f,NOW);
 assert.deepEqual({...facts,feels:undefined},{dewpoint:38,humidity:73,temperature:46,wind:7,feels:undefined});
 assert.equal(facts.feels,currentSample(f,NOW).feels);
 assert.notEqual(facts.feels,f.comfort.outdoors);
});

test('all Feel Meter current facts expire together when the snapshot ages',()=>{
 const f=fixture(),later=NOW+91*60000;
 f.metricForecasts.series.dewpoint=[{time:iso(later-10*60000),value:65}];
 assert.deepEqual(currentFeelMeterFacts(f,later),{dewpoint:null,humidity:null,temperature:null,feels:null,wind:null});
 assert.equal(currentDewpointValue(f,later),null,'even an overlapping forecast row cannot revive the stale snapshot');
});

test('expired station and invalid future timestamps cannot leave supporting facts visible',()=>{
 for(const [type,time]of [['observation',NOW-76*60000],['guidance',NOW+6*60000]]){
  const f=fixture();Object.assign(f.current,{type,time:iso(time)});
  assert.deepEqual(currentFeelMeterFacts(f,NOW),{dewpoint:null,humidity:null,temperature:null,feels:null,wind:null});
 }
});

test('explicitly unavailable current data stays missing despite a populated forecast hour',()=>{
 const f=fixture();f.current.type='unavailable';
 f.metricForecasts.series.dewpoint=[{time:iso(NOW-23*60000),value:65}];
 assert.deepEqual(currentFeelMeterFacts(f,NOW),{dewpoint:null,humidity:null,temperature:null,feels:null,wind:null});
});

test('missing current facts do not borrow the next hour or cached feels; real zero remains valid',()=>{
 const f=fixture();Object.assign(f.current,{temperature:null,dewpoint:null,humidity:null,wind:null});
 f.metricForecasts.series.dewpoint=[{time:iso(Math.floor(NOW/H)*H+H),value:65}];
 assert.deepEqual(currentFeelMeterFacts(f,NOW),{dewpoint:null,humidity:null,temperature:null,feels:null,wind:null});
 Object.assign(f.current,{temperature:0,dewpoint:-8,humidity:0,wind:0});
 const zero=currentFeelMeterFacts(f,NOW);assert.equal(zero.temperature,0);assert.equal(zero.humidity,0);assert.equal(zero.wind,0);
});

const app=readFileSync(new URL('../public/weather-fusion/app.js',import.meta.url),'utf8');
const sourceFunction=app.slice(app.indexOf('function currentSourceDisplay('),app.indexOf('\nfunction render(data)'));
const context={Date,finite:Number.isFinite,currentReadingFreshness,clock:value=>new Date(value).toISOString().slice(11,16)};
runInNewContext(`${sourceFunction}\nthis.describe=currentSourceDisplay;`,context);

test('modeled current temperature has a visible estimate label, model source and valid time',()=>{
 const f=fixture(),display=context.describe(f,NOW);
 assert.equal(display.temperatureLabel,'Estimated current temperature');
 assert.match(display.sourceLabel,/Selected-location current-hour forecast blend/);
 assert.match(display.sourceLabel,/model estimate valid 09:00/);
 assert.doesNotMatch(display.sourceLabel,/observed/);
});

test('accepted observations retain their station attribution and stale data loses an estimate claim',()=>{
 const f=fixture();Object.assign(f.current,{type:'observation',station:'KLHZ',stationName:'Franklin County Airport'});
 const observed=context.describe(f,NOW);
 assert.equal(observed.temperatureLabel,'Current temperature');assert.match(observed.sourceLabel,/Franklin County Airport · observed 09:00/);
 const expired=context.describe(f,NOW+91*60000);
 assert.match(expired.sourceLabel,/stale/);assert.doesNotMatch(expired.sourceLabel,/model estimate valid|observed 09:00/);
});

test('canonical modeled Now shares its forecast-hour exposure clock and exact published custom feels',()=>{
 const f=fixture(),now=Date.parse('2026-10-20T11:40:00Z'),hour=iso(Date.parse('2026-10-20T11:00:00Z'));
 f.assembledAt=iso(now);Object.assign(f.current,{time:hour,thermalTime:hour,thermalCondition:'Clear',
  localEstimate:{source:'Selected-location current-hour forecast blend',basis:'canonical-hourly-blend'},
  feelsLike:40.9,feelsLikeShade:39.7,feelsLikeSun:null});
 const thermal=thermalComfort(f.current,f.location,Date.parse(hour));
 const canonical=Number(thermal.rawOutdoors.toFixed(1)),shade=Number(thermal.rawShade.toFixed(1));
 f.current.feelsLike=canonical;f.current.feelsLikeShade=shade;
 const current=currentSample(f,now);
 assert.equal(current.comfort.daylight,false,'the selected hour is before sunrise even though the snapshot is after sunrise');
 assert.equal(current.feels,canonical);assert.equal(current.comfort.shade,shade);assert.equal(current.comfort.sun,null);
 assert.equal(currentFeelMeterFacts(f,now).feels,canonical);
 const observation=structuredClone(f);observation.current.type='observation';
 assert.equal(currentSample(observation,now).comfort.daylight,true,'an accepted observation keeps the current snapshot exposure clock');
 assert.notEqual(currentSample(observation,now).feels,canonical,'forecast feels metadata cannot override a station calculation');
});

test('canonical current feels missing values remain unavailable instead of borrowing another exposure',()=>{
 const f=fixture();Object.assign(f.current,{thermalTime:f.current.time,feelsLike:null,feelsLikeShade:null,feelsLikeSun:null,
  localEstimate:{basis:'canonical-hourly-blend'}});
 const sample=currentSample(f,NOW);
 assert.equal(sample.feels,null);assert.equal(sample.comfort.shade,null);assert.equal(sample.comfort.sun,null);
 assert.equal(currentFeelMeterFacts(f,NOW).feels,null);
});

test('an unavailable current sample cannot revive gusts from an overlapping forecast hour',()=>{
 const f=fixture(),hour=f.current.time;
 f.hours=[{time:hour,condition:'Clear'}];
 f.metricForecasts.series.gust=[{time:hour,value:24}];
 const fresh=currentSample(f,NOW);
 assert.equal(fresh.inputs.gust,24,'a fresh current reading retains the existing same-hour gust fallback');
 f.assembledAt=iso(NOW-91*60000);
 assert.equal(currentSample(f,NOW).inputs.gust,null,'expired snapshots cannot display a forecast gust as current');
 f.assembledAt=iso(NOW);f.current.type='observation';f.current.time=iso(NOW-76*60000);
 assert.equal(currentSample(f,NOW).inputs.gust,null,'an expired station reading cannot display a forecast gust as current');
 f.current.time=hour;f.current.type='unavailable';
 assert.equal(currentSample(f,NOW).inputs.gust,null,'explicitly unavailable readings remain missing');
});
