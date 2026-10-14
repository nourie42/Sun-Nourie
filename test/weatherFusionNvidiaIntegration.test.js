import test from 'node:test';
import assert from 'node:assert/strict';
import {buildForecast} from '../src/weatherFusion.js';
import {validateSnapshot} from '../src/weatherFusionDirect.js';
import {SAME_DAY_WEIGHTS,EXTENDED_QPF_WEIGHTS,temperaturePolicy,precipitationPolicy,precipitationAmountPolicy} from '../src/weatherFusionPolicy.js';
import {sevenDayForecast} from '../public/weather-fusion/seven-day.js';
import {buildSeries} from '../public/weather-fusion/wn-blend.js';
import {humidityFromDewpoint,tier3FeelsLike} from '../public/weather-fusion/weather-math.js';
import {testInputs,snapshot,now,H} from './weatherFusion.fixtures.js';

const iso=time=>new Date(time).toISOString();
const close=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} should equal ${expected}`);
const weights=sources=>Object.fromEntries(sources.map(source=>[source.id,source.weight]));
const sameDay={nws:.36,hrrr:.27,ecmwf:.09,nbm:.18,wn:.10};
const extended={nws:.135,ecmwf:.54,nbm:.225,wn:.10};

function sourceInputs({withNvidia=true,patchNvidia}={}) {
  const input=structuredClone(testInputs);
  input.models=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>{
    const native=validateSnapshot(snapshot(id),id,input.location,now).value;
    native.hourly_units={...native.hourly_units,dew_point_2m:'°F',cloud_cover:'%',pressure_msl:'inHg',wind_direction_10m:'°'};
    for(const [field,value] of Object.entries({dew_point_2m:62,cloud_cover:30,pressure_msl:30,wind_direction_10m:210}))native.hourly[field]=native.hourly.time.map(()=>value);
    native.precipitationIntervals.forEach(row=>{row.value=id==='hrrr'?.02:id==='ecmwf'?.03:.01;});
    return [id,native];
  }));
  const gridFields={dewpoint:['degF',68],windSpeed:['mi_h-1',10],skyCover:['percent',20],pressure:['inHg',30.1]};
  for(const [field,[unit,value]] of Object.entries(gridFields))input.grid[field]={uom:'wmoUnit:'+unit,values:[{validTime:'2026-09-04T04:00:00Z/P10D',value}]};
  if(withNvidia){
    const time=Array.from({length:245},(_,index)=>(now-4*H+index*H)/1000);
    const values={temperature_2m:96,dew_point_2m:50,wind_speed_10m:20,wind_direction_10m:250,
      cloud_cover:90,pressure_msl:29.8,precipitation:.04};
    const wn={model:'wn',verifiedModel:true,timezone:'America/New_York',runAt:iso(now-4*H),validUntil:iso(time.at(-1)*1000),
      resolution:'TEST published NVIDIA grid',transport:'TEST normalized NVIDIA guidance',
      hourly_units:{time:'unixtime',temperature_2m:'°F',dew_point_2m:'°F',wind_speed_10m:'mp/h',wind_direction_10m:'°',cloud_cover:'%',pressure_msl:'inHg',precipitation:'inch'},
      hourly:{time,...Object.fromEntries(Object.entries(values).map(([field,value])=>[field,time.map(()=>value)]))},
      precipitationIntervals:time.slice(1).map(end=>({start:end-3600,end,value:.04}))};
    patchNvidia?.(wn);input.models.wn=wn;
    input.feeds.push({id:'wn',label:'TEST NVIDIA WeatherNext',status:'ready',contributes:true,issuedAt:wn.runAt,fetchedAt:iso(now)});
  }
  return input;
}

const at=(series,time)=>series.find(row=>Date.parse(row.time)===time);

test('the established NVIDIA 10 percent preserves original same-day and extended relative shares',()=>{
  assert.deepEqual(temperaturePolicy(0,true),sameDay);
  assert.deepEqual(temperaturePolicy(4,true),sameDay);
  assert.deepEqual(precipitationPolicy(0,true),sameDay);
  assert.deepEqual(precipitationAmountPolicy(0,true),sameDay);
  assert.deepEqual(precipitationPolicy(1,true),extended);
  assert.deepEqual(precipitationAmountPolicy(1,true),extended);
  assert.equal(temperaturePolicy(0),SAME_DAY_WEIGHTS);
  assert.equal(precipitationAmountPolicy(1),EXTENDED_QPF_WEIGHTS);
});

test('NVIDIA changes published daily and hourly temperatures with attributed 10 percent inputs',()=>{
  const input=sourceInputs(),forecast=buildForecast(input),baseline=buildForecast(sourceInputs({withNvidia:false}));
  const hour=forecast.hours[1];
  assert.deepEqual(weights(hour.temperatureBlend.sources),sameDay);
  assert.equal(hour.temperatureBlend.sources.find(source=>source.id==='wn').value,96);
  const raw=hour.temperatureBlend.sources.reduce((sum,source)=>sum+source.value*source.weight,0);
  assert.equal(hour.temperature,Math.round(raw));
  assert.notEqual(hour.temperature,baseline.hours[1].temperature);
  assert.deepEqual(weights(forecast.days[0].highBlend.sources),sameDay);
  assert.deepEqual(weights(forecast.days[0].lowBlend.sources),sameDay);
  assert.notEqual(forecast.days[0].high,baseline.days[0].high);
  assert.notEqual(forecast.days[0].low,baseline.days[0].low);
  assert.equal(forecast.google.contributes,true);assert.equal(forecast.google.requestedWeight,.1);
  assert.equal(forecast.google.runAt,input.models.wn.runAt);
  assert.ok(forecast.modelContributions.some(source=>source.id==='wn'&&source.runAt===input.models.wn.runAt));
});

test('NVIDIA contributes to hourly rain amounts and scores while later rain excludes HRRR',()=>{
  const forecast=buildForecast(sourceInputs()),first=at(forecast.rainTimeline,now+H),later=at(forecast.rainTimeline,now+30*H);
  assert.deepEqual(weights(first.precipitationBlend.sources),sameDay);
  assert.deepEqual(weights(first.rainLikelihood.sources),sameDay);
  close(first.precipitationBlend.sourceValues.wn,.04);
  assert.equal(first.rainLikelihood.sourceAmounts.wn,.04);
  assert.equal(first.rainLikelihood.sourcePoints.wn,10);
  assert.deepEqual(weights(later.precipitationBlend.sources),extended);
  assert.deepEqual(weights(later.rainLikelihood.sources),extended);
  assert.equal(later.rainLikelihood.sourcePoints.hrrr,null);
  assert.equal(later.precipitationBlend.sources.some(source=>source.id==='hrrr'),false);
  const expected=later.precipitationBlend.sources.reduce((sum,source)=>sum+source.value*source.weight,0);
  close(later.precipitation,expected,1e-7);
});

test('canonical rain cards and comparison still share the exact NVIDIA-inclusive timeline',()=>{
  const forecast=buildForecast(sourceInputs()),cards=sevenDayForecast(forecast,now);
  const amounts=buildSeries(forecast,null,'rain',now),chances=buildSeries(forecast,null,'pop',now);
  for(const [index,card] of cards.entries()){
    assert.equal(amounts.forecastValues[index],card.amount);
    assert.equal(chances.forecastValues[index],card.pop);
    const window=card.windWindow,rows=forecast.rainTimeline.filter(row=>Date.parse(row.time)>=window.start&&Date.parse(row.time)<window.end);
    close(card.amount,rows.reduce((sum,row)=>sum+row.precipitation,0),1e-7);
    assert.equal(card.pop,Math.max(...rows.map(row=>row.rainLikelihood.value)));
  }
});

test('NVIDIA weather fields drive matching hourly humidity and feels-like inputs',()=>{
  const forecast=buildForecast(sourceInputs()),epoch=now+H,hour=at(forecast.hours,epoch),series=forecast.metricForecasts.series;
  for(const field of ['temperature','dewpoint','wind','cloud','pressure']){
    const point=at(series[field],epoch);
    assert.deepEqual(weights(point.sources),sameDay,field);
    assert.ok(point.sources.some(source=>source.id==='wn'),field);
  }
  assert.ok(hour.windDirectionBlend.sources.some(source=>source.id==='wn'));
  const feel=at(series.feels,epoch),inputs=feel.inputs;
  assert.equal(inputs.temperature,hour.temperature);assert.equal(inputs.dewpoint,hour.dewpoint);
  assert.equal(inputs.wind,hour.windMph);assert.equal(inputs.skyCover,hour.skyCover);
  assert.equal(inputs.dewpoint,at(series.dewpoint,epoch).value);
  assert.equal(inputs.wind,at(series.wind,epoch).value);
  close(inputs.humidity,Math.round(humidityFromDewpoint(inputs.temperature,inputs.dewpoint)*10)/10);
  const estimate=tier3FeelsLike({...inputs,condition:hour.condition,type:'guidance'},forecast.location,epoch,'outdoors');
  close(feel.value,Math.round(estimate.value*10)/10);
  assert.equal(feel.value,hour.feelsLike);
});

test('missing NVIDIA fields restore the original field policy without suppressing other NVIDIA inputs',()=>{
  const forecast=buildForecast(sourceInputs({patchNvidia:wn=>{
    wn.hourly.dew_point_2m.fill(null);wn.hourly.pressure_msl.fill(null);
  }}));
  const baseline=buildForecast(sourceInputs({withNvidia:false})),epoch=now+H;
  for(const field of ['dewpoint','pressure']){
    const point=at(forecast.metricForecasts.series[field],epoch),old=at(baseline.metricForecasts.series[field],epoch);
    assert.equal(point.sources.some(source=>source.id==='wn'),false,field);
    assert.deepEqual(weights(point.sources),SAME_DAY_WEIGHTS,field);
    assert.equal(point.value,old.value,field);
  }
  assert.ok(at(forecast.metricForecasts.series.wind,epoch).sources.some(source=>source.id==='wn'));
  assert.ok(at(forecast.metricForecasts.series.cloud,epoch).sources.some(source=>source.id==='wn'));
});

test('an unavailable NVIDIA hour is neither interpolated nor fabricated as zero',()=>{
  const epoch=now+3*H,forecast=buildForecast(sourceInputs({patchNvidia:wn=>{
    const index=wn.hourly.time.indexOf(epoch/1000);
    for(const field of Object.keys(wn.hourly))if(field!=='time')wn.hourly[field][index]=null;
    wn.precipitationIntervals=wn.precipitationIntervals.filter(row=>row.start!==epoch/1000);
  }})),baseline=buildForecast(sourceInputs({withNvidia:false}));
  const hour=at(forecast.hours,epoch),old=at(baseline.hours,epoch),rain=at(forecast.rainTimeline,epoch),oldRain=at(baseline.rainTimeline,epoch);
  assert.equal(hour.temperatureBlend.sources.some(source=>source.id==='wn'),false);
  assert.deepEqual(weights(hour.temperatureBlend.sources),SAME_DAY_WEIGHTS);
  assert.equal(hour.temperature,old.temperature);
  assert.equal(rain.precipitationBlend.sourceValues.wn,null);
  assert.equal(rain.precipitationBlend.sources.some(source=>source.id==='wn'),false);
  assert.equal(rain.rainLikelihood.sources.some(source=>source.id==='wn'),false);
  assert.equal(rain.rainLikelihood.drySources.includes('wn'),false);
  assert.equal(rain.precipitation,oldRain.precipitation);
  assert.equal(rain.rainLikelihood.value,oldRain.rainLikelihood.value);
});

test('a published zero NVIDIA rainfall amount stays a genuine zero contributor',()=>{
  const forecast=buildForecast(sourceInputs({patchNvidia:wn=>{
    wn.precipitationIntervals.forEach(row=>{row.value=0;});wn.hourly.precipitation.fill(0);
  }})),rain=at(forecast.rainTimeline,now+H);
  assert.equal(rain.precipitationBlend.sourceValues.wn,0);
  assert.equal(rain.rainLikelihood.sourcePoints.wn,0);
  assert.equal(rain.rainLikelihood.sourceAmounts.wn,0);
  assert.ok(rain.rainLikelihood.drySources.includes('wn'));
  assert.equal(rain.precipitationBlend.sources.find(source=>source.id==='wn').weight,.1);
});

test('daily confidence includes actual NVIDIA temperature and precipitation contributions',()=>{
  const forecast=buildForecast(sourceInputs()),day=forecast.days[0];
  assert.ok(day.confidence.sourceIds.includes('wn'));assert.equal(day.confidence.sourceCount,5);
  for(const part of ['high','low','rain'])assert.ok(day.confidence.contributions[part].some(source=>source.id==='wn'),part);
});

test('restoring model guidance does not overwrite the current station observation',()=>{
  const input=sourceInputs(),forecast=buildForecast(input),baseline=buildForecast(sourceInputs({withNvidia:false}));
  for(const field of ['temperature','dewpoint','humidity','wind','gust','pressure','visibility','station','time']){
    assert.equal(forecast.current[field],input.observation[field],field);
    assert.equal(forecast.current[field],baseline.current[field],field);
  }
  assert.equal(forecast.current.type,'observation');
});

test('NVIDIA rainfall does not invent an official probability of precipitation',()=>{
  const input=sourceInputs();
  for(const period of input.hourly.periods)period.probabilityOfPrecipitation={value:null};
  const forecast=buildForecast(input),rain=at(forecast.rainTimeline,now+H);
  assert.equal(rain.officialPop,null);assert.equal(forecast.hours[1].officialPop,null);
  assert.equal(rain.rainLikelihood.officialProbability,null);
  assert.equal(rain.rainLikelihood.sourcePoints.nws,null);
  assert.ok(rain.rainLikelihood.sourcePoints.wn>0);
  assert.ok(rain.rainLikelihood.value>0,'the disclosed deterministic rain score remains separate from NWS probability');
});

test('unavailable or unverified NVIDIA models leave existing published numerical forecasts unchanged',()=>{
  const baseline=buildForecast(sourceInputs({withNvidia:false}));
  for(const model of [null,{...sourceInputs().models.wn,verifiedModel:false}]){
    const input=sourceInputs({withNvidia:false});input.models.wn=model;
    const forecast=buildForecast(input);
    assert.equal(forecast.google.contributes,false);
    assert.deepEqual(forecast.hours.map(hour=>[hour.temperature,hour.precipitation,hour.rainLikelihood.value,hour.feelsLike]),
      baseline.hours.map(hour=>[hour.temperature,hour.precipitation,hour.rainLikelihood.value,hour.feelsLike]));
    assert.deepEqual(forecast.days.map(day=>[day.high,day.low,day.qpf,day.rainLikelihood.value]),
      baseline.days.map(day=>[day.high,day.low,day.qpf,day.rainLikelihood.value]));
    assert.equal(forecast.modelContributions.some(source=>source.id==='wn'),false);
  }
});
