import test from 'node:test';
import assert from 'node:assert/strict';
import {buildForecast,localTime,nextDate} from '../src/weatherFusion.js';
import {precipitationLikelihood,summarizeRainTimeline,validateSnapshot,solarTimes} from '../src/weatherFusionDirect.js';
import {addExperience} from '../src/weatherFusionExperience.js';
import {snapshot,testInputs} from './weatherFusion.fixtures.js';

const H=3600000,now=testInputs.now,iso=time=>new Date(time).toISOString();
const zone='America/New_York';

function inputs({chance=39,amount=.001,hrrrHours=30,hourCount=180}={}) {
  const data=structuredClone(testInputs);
  data.forecast.periods.forEach(period=>{period.probabilityOfPrecipitation.value=chance;});
  data.hourly.periods=Array.from({length:hourCount},(_,index)=>({
    ...data.hourly.periods[index%data.hourly.periods.length],
    startTime:iso(now+index*H),endTime:iso(now+(index+1)*H),
    probabilityOfPrecipitation:{value:chance}
  }));
  data.feeds.find(feed=>feed.id==='hourly').issuedAt=iso(now-H);
  data.models=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>{
    const native=snapshot(id),point=native.points[0];
    point.precipitationIntervals.forEach(row=>{row.value=amount;});
    if(id==='hrrr')point.precipitationIntervals=point.precipitationIntervals.filter(row=>row.end*1000<=now+hrrrHours*H);
    return [id,validateSnapshot(native,id,data.location,now).value];
  }));
  return data;
}

function matchingRows(data,summary) {
  const start=Date.parse(summary.window.start),end=Date.parse(summary.window.end);
  return data.rainTimeline.filter(row=>Date.parse(row.time)<end&&Date.parse(row.end)>start);
}

test('trace drizzle cannot create an inflated daily score',()=>{
  const data=buildForecast(inputs());
  const day=data.days[1],rows=matchingRows(data,day.rainLikelihood);
  assert.equal(day.rainLikelihood.value,26);
  assert.equal(day.rainLikelihood.value,Math.max(...rows.map(row=>row.rainLikelihood.value)));
  assert.deepEqual(new Set(rows.map(row=>row.rainLikelihood.value)),new Set([0,26]));
  assert.equal(day.rainLikelihood.coverage.complete,true);
  assert.equal(day.officialPop,39,'raw NWS period probability remains separate');
});

test('every day and night percentage is the peak of identical canonical hourly evidence',()=>{
  const data=buildForecast(inputs({chance:45,amount:.008}));
  for(const day of data.days)for(const name of ['rainLikelihood','popDayLikelihood','popNightLikelihood']) {
    const summary=day[name],rows=matchingRows(data,summary);
    assert.equal(summary.aggregation,'maximum-hourly');
    assert.equal(summary.coverage.complete,true,`${day.date} ${name}`);
    assert.equal(summary.value,Math.max(...rows.map(row=>row.rainLikelihood.value)));
    const peak=data.rainTimeline.find(row=>row.time===summary.peakTime);
    assert.deepEqual(summary.peak,peak.rainLikelihood);
    assert.deepEqual(summary.sources,peak.rainLikelihood.sources);
  }
  for(const hour of data.hours) {
    const row=data.rainTimeline.find(row=>Date.parse(row.time)===Date.parse(hour.time));
    assert.deepEqual(hour.rainLikelihood,row.rainLikelihood);
    assert.equal(hour.precipitation,row.precipitation);
    assert.deepEqual(hour.precipitationBlend,row.precipitationBlend);
  }
});

test('daily peak beyond the 48-hour strip remains auditable on the full hourly timeline',()=>{
  const data=inputs({chance:0,amount:0});
  const peakTime=localTime('2026-09-08',16,zone);
  const peak=data.hourly.periods.find(row=>Date.parse(row.startTime)===peakTime);
  peak.probabilityOfPrecipitation.value=81;
  const forecast=buildForecast(data),day=forecast.days.find(row=>row.date==='2026-09-08');
  assert.equal(forecast.hours.length,48);
  assert.ok(forecast.rainTimeline.length>48);
  assert.equal(day.rainLikelihood.peakTime,iso(peakTime));
  assert.equal(day.rainLikelihood.value,54);
  assert.equal(day.rainLikelihood.peak.sourceValues.nws,81);
  assert.equal(day.rainLikelihood.peak.sources.find(source=>source.id==='nws').runAt,iso(now-H));
  assert.equal(day.rainLikelihood.peak.sources.find(source=>source.id==='ecmwf').runAt,forecast.modelContributions.find(source=>source.id==='ecmwf').runAt);
  assert.equal(day.rainLikelihood.peak.calibrated,false);
});

test('periods with an uncovered hour stay unavailable and retain the available peak for inspection',()=>{
  const start=now,rows=[0,2].map((offset,index)=>({time:iso(start+offset*H),end:iso(start+(offset+1)*H),rainLikelihood:{value:index?65:0,sources:[]}}));
  const summary=summarizeRainTimeline(rows,start,start+3*H);
  assert.equal(summary.value,null);
  assert.equal(summary.availablePeak,65);
  assert.equal(summary.peakTime,iso(start+2*H));
  assert.deepEqual(summary.coverage,{expectedHours:3,availableHours:2,complete:false});
  assert.equal(summarizeRainTimeline([],start,start+H).value,null);
  assert.equal(summarizeRainTimeline(rows,start,start).value,null);
});

test('duplicate hours cannot hide missing coverage and partial boundaries are exact',()=>{
  const start=now,row={time:iso(start),end:iso(start+H),rainLikelihood:{value:42,sources:[]}};
  assert.equal(summarizeRainTimeline([row,row],start,start+2*H).coverage.complete,false);
  const summary=summarizeRainTimeline([row],start+H/2,start+H);
  assert.equal(summary.value,42);
  assert.deepEqual(summary.coverage,{expectedHours:.5,availableHours:.5,complete:true});
});

test('period coverage follows the actual 23- and 25-hour daylight-saving windows',()=>{
  for(const [date,next,count] of [['2026-03-07','2026-03-08',23],['2026-10-31','2026-11-01',25]]) {
    const start=localTime(date,7,zone),end=localTime(next,7,zone);
    const rows=Array.from({length:count},(_,index)=>({time:iso(start+index*H),end:iso(start+(index+1)*H),rainLikelihood:{value:index===count-1?42:5,sources:[]}}));
    const summary=summarizeRainTimeline(rows,start,end);
    assert.equal(summary.value,42);
    assert.deepEqual(summary.coverage,{expectedHours:count,availableHours:count,complete:true});
    assert.equal(summarizeRainTimeline(rows.slice(1),start,end).value,null);
  }
});

test('daily and next-24-hour amounts sum the same canonical hourly graph values',()=>{
  const data=inputs({chance:50,amount:.0111});
  data.models.ecmwf.precipitationIntervals.forEach(row=>{row.value=.0222;});
  const forecast=buildForecast(data);
  const total=(start,end)=>Number(forecast.rainTimeline.filter(row=>Date.parse(row.time)>=Date.parse(start)&&Date.parse(row.end)<=Date.parse(end)).reduce((sum,row)=>sum+row.precipitation,0).toFixed(4));
  for(const day of forecast.days)assert.equal(day.qpf,total(day.qpfWindow.start,day.qpfWindow.end));
  assert.equal(forecast.precipitation.value,total(forecast.precipitation.start,forecast.precipitation.end));
});

test('two dry sources and a score below 10 yield zero consistently in hourly and daily cards',()=>{
  const data=buildForecast(inputs({chance:10,amount:0}));
  for(const row of data.rainTimeline)assert.equal(row.rainLikelihood.value,0);
  for(const hour of data.hours)assert.equal(hour.rainLikelihood.value,0);
  for(const day of data.days)assert.equal(day.rainLikelihood.value,0);
});

test('weak uncorroborated guidance stays zero until the blend reaches 25',()=>{
  const dryAmounts={sourceValues:{nws:.01,hrrr:0,ecmwf:0}};
  const below=precipitationLikelihood(62,dryAmounts),boundary=precipitationLikelihood(62.5,dryAmounts);
  assert.equal(below.weightedValue,24.8);
  assert.equal(below.rawValue,25);
  assert.equal(below.value,0);
  assert.equal(boundary.weightedValue,25);
  assert.equal(boundary.value,25);
  assert.deepEqual(below.drySources,['hrrr','ecmwf']);
  assert.equal(precipitationLikelihood(9,{sourceValues:{nws:.01,hrrr:null,ecmwf:null}}).value,9,'one source is not two dry models');
});

test('source evidence preserves exact amounts, trace threshold and normalized arithmetic',()=>{
  const score=precipitationLikelihood(39,{sourceValues:{nws:.001,hrrr:null,ecmwf:.016}});
  assert.equal(score.traceThresholdInches,.01);
  assert.equal(score.signalFullScaleInches,.1);
  assert.equal(score.sourceValues.hrrr,null);
  assert.equal(score.qpfSupport.ecmwf,16);
  assert.equal(score.sourceValues.ecmwf,6.24);
  assert.equal(score.sourceAmounts.ecmwf,.016);
  assert.equal(score.weightedValue,28.08);
  assert.equal(score.value,28);
  assert.deepEqual(score.sources.map(row=>[row.id,row.weight]),[['nws',.666667],['ecmwf',.333333]]);
  assert.equal(precipitationLikelihood(39,{sourceValues:{ecmwf:.0049}}).sourceValues.ecmwf,0);
  const data=buildForecast(inputs({amount:.001})),row=data.rainTimeline[0];
  assert.equal(row.precipitationBlend.sourceValues.hrrr,.001);
  assert.equal(row.precipitationBlend.sourceValues.ecmwf,.001);
  assert.equal(row.precipitationBlend.start,row.time);
  assert.equal(row.precipitationBlend.end,row.end);
  assert.ok(row.precipitationBlend.sources.every(source=>source.runAt!==undefined));
  const below=buildForecast(inputs({chance:0,amount:.00499})).rainTimeline[0];
  assert.equal(below.rainLikelihood.sourceAmounts.hrrr,.00499);
  assert.equal(below.rainLikelihood.sourceValues.hrrr,0,'source evidence is not rounded up across the wet threshold');
  assert.equal(below.rainLikelihood.qpfSupport.hrrr,0);
  assert.equal(below.rainLikelihood.value,0);
});

test('expired peak hours leave the remaining forecast when the current hour advances',()=>{
  const data=inputs({chance:5,amount:0});
  data.hourly.periods[0].probabilityOfPrecipitation.value=80;
  const first=buildForecast(data),later=buildForecast({...data,now:now+H});
  assert.equal(first.days[0].popDayLikelihood.value,32);
  assert.equal(later.days[0].popDayLikelihood.value,0);
  assert.equal(later.days[0].popDayLikelihood.window.start,iso(now+H));
  assert.ok(later.rainTimeline.every(row=>Date.parse(row.time)>=now+H));
});

test('an in-progress rainy hour stays in Today at 12:01 and its remaining amount is prorated',()=>{
  const data=inputs({chance:0,amount:0});
  data.models={};
  data.hourly.periods[0].probabilityOfPrecipitation.value=80;
  const initial=buildForecast(data),minuteLater=buildForecast({...data,now:now+60000});
  assert.equal(initial.days[0].popDayLikelihood.value,80);
  assert.equal(minuteLater.hours[0].rainLikelihood.value,80);
  assert.equal(minuteLater.days[0].popDayLikelihood.value,80);
  assert.equal(minuteLater.days[0].rainLikelihood.value,80);
  assert.equal(minuteLater.days[0].popDayLikelihood.window.start,iso(now+60000));
  assert.equal(minuteLater.days[0].popDayLikelihood.coverage.complete,true);
  assert.equal(minuteLater.days[0].qpfWindow.start,iso(now+60000));
  const dayEnd=Date.parse(minuteLater.days[0].qpfWindow.end);
  const amount=minuteLater.rainTimeline.reduce((sum,row)=>{
    const overlap=Math.max(0,Math.min(dayEnd,Date.parse(row.end))-Math.max(now+60000,Date.parse(row.time)));
    return sum+row.precipitation*overlap/H;
  },0);
  assert.equal(minuteLater.days[0].qpf,Number(amount.toFixed(4)));
  assert.equal(minuteLater.precipitation.start,iso(now+60000));
  assert.equal(minuteLater.precipitation.end,iso(now+60000+24*H));
  const next24=minuteLater.rainTimeline.reduce((sum,row)=>{
    const overlap=Math.max(0,Math.min(now+60000+24*H,Date.parse(row.end))-Math.max(now+60000,Date.parse(row.time)));
    return sum+row.precipitation*overlap/H;
  },0);
  assert.equal(minuteLater.precipitation.value,Number(next24.toFixed(4)));
  assert.equal(buildForecast({...data,now:now+H}).days[0].popDayLikelihood.value,0);
});

test('corroborated new model rain changes both the hourly and period result with its actual run stamp',()=>{
  const dry=inputs({chance:30,amount:0}),wet=structuredClone(dry);
  wet.models.hrrr.runAt=iso(now);
  wet.models.hrrr.precipitationIntervals.find(row=>row.start*1000===now).value=.02;
  const first=buildForecast(dry),updated=buildForecast(wet);
  assert.equal(first.hours[0].rainLikelihood.value,0);
  assert.equal(updated.hours[0].rainLikelihood.value,14);
  assert.equal(updated.days[0].popDayLikelihood.value,14);
  assert.equal(updated.days[0].popDayLikelihood.peak.sources.find(source=>source.id==='hrrr').runAt,iso(now));
  assert.notEqual(first.signature,updated.signature);
});

test('rain metrics preserve a missing canonical hourly score instead of exposing raw NWS probability',()=>{
  const data=inputs(),forecast=buildForecast(data),time=forecast.hours[0].time;
  forecast.hours[0].pop=87;
  forecast.hours[0].rainLikelihood={value:null,source:'Unavailable canonical forecast'};
  addExperience(forecast,{models:data.models,grid:data.grid,periods:data.forecast.periods,now,solarTimes,nextDate});
  assert.equal(forecast.metricForecasts.series.pop.find(row=>Date.parse(row.time)===Date.parse(time)).value,null);
  delete forecast.hours[0].rainLikelihood;
  addExperience(forecast,{models:data.models,grid:data.grid,periods:data.forecast.periods,now,solarTimes,nextDate});
  assert.equal(forecast.metricForecasts.series.pop.find(row=>Date.parse(row.time)===Date.parse(time)).value,87,'legacy snapshots without a likelihood still support their official probability');
});
