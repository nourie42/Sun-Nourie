import test from 'node:test';
import assert from 'node:assert/strict';
import {addConditionConfidence} from '../src/weatherFusionConditionConfidence.js';
import {calendarDayWindow} from '../public/weather-fusion/calendar-day.js';
import {solarElevation} from '../public/weather-fusion/weather-math.js';
import {solarTimes} from '../src/weatherFusionDirect.js';

const H=3600000,iso=time=>new Date(time).toISOString();
const IDS=['nws','ecmwf','nbm'];
const sources=value=>IDS.map(id=>({id,value,weight:1/IDS.length}));
function fixture({date='2026-10-20',clock='2026-10-20T04:00:00Z',zone='America/New_York',latitude=35.787,longitude=-78.4806,index=0,daylight=true}={}){
  const now=Date.parse(clock),day={date,confidence:{key:'high',score:100,temperatureSpread:0,coverage:{},contributions:{high:[],low:[]}}};
  const full=calendarDayWindow(day,1,now,zone),feels=[],rain=[];
  for(let time=full.start;time<full.end;time+=H){
    const point={time:iso(time),value:65,inputs:{skyCover:10,skySources:sources(10)}};
    if(typeof daylight==='boolean')point.daylight=daylight;
    feels.push(point);
    rain.push({time:iso(time),end:iso(time+H),precipitation:0,officialPop:0,
      rainLikelihood:{value:0},precipitationBlend:{value:0,sources:sources(0),sourceValues:Object.fromEntries(IDS.map(id=>[id,0]))}});
  }
  const days=Array.from({length:index},()=>({}));days.push(day);
  return {now,day,out:{assembledAt:iso(now),location:{timeZone:zone,latitude,longitude},days,metricForecasts:{series:{feels,cloud:[]}},rainTimeline:rain}};
}
function calculate(f){addConditionConfidence(f.out,{now:f.now});return f.day.confidence.weather;}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.0011,`${actual} should equal ${expected}`);

for(const [date,clock,count] of [
  ['2026-03-08','2026-03-08T05:00:00Z',23],
  ['2026-11-01','2026-11-01T04:00:00Z',25],
])test(`condition evidence covers every real hour of the ${count}-hour DST calendar date`,()=>{
  const f=fixture({date,clock}),weather=calculate(f);
  assert.equal(weather.evidence.rain.expectedHours,count);
  assert.equal(weather.evidence.rain.coveredHours,count);
  assert.equal(weather.evidence.rain.hours.length,count);
  assert.equal(new Set(weather.evidence.rain.hours.map(hour=>hour.time)).size,count,'Repeated wall-clock hours are separate UTC intervals.');
  assert.equal(weather.evidence.rain.complete,true);
  assert.deepEqual(weather.evidence.rain.completeSources,IDS);
  assert.equal(weather.key,'high');
});

test('the in-progress hour keeps its evidence and is clipped to the exact remaining minutes',()=>{
  const f=fixture({clock:'2026-10-20T09:35:00Z'}),weather=calculate(f),rain=weather.evidence.rain;
  assert.equal(weather.evidence.window.start,'2026-10-20T09:35:00.000Z');
  assert.equal(weather.evidence.window.end,'2026-10-21T04:00:00.000Z');
  assert.equal(rain.hours[0].time,'2026-10-20T09:35:00.000Z');
  assert.equal(rain.hours[0].end,'2026-10-20T10:00:00.000Z');
  near(rain.hours[0].durationHours,25/60);
  near(rain.expectedHours,18+25/60);
  near(rain.coveredHours,rain.expectedHours);
  assert.equal(weather.key,'high');
  f.out.rainTimeline=f.out.rainTimeline.filter(row=>row.time!=='2026-10-20T09:00:00.000Z');
  const missing=calculate(f);
  assert.notEqual(missing.key,'high','The first future hour cannot replace missing evidence for the current partial hour.');
  assert.equal(missing.evidence.rain.hours[0].sources.length,0);
});

test('sky agreement compares remaining daylight while rain includes the remaining night',()=>{
  const f=fixture({clock:'2026-10-20T09:00:00Z'});
  for(const row of f.out.metricForecasts.series.feels){
    const time=Date.parse(row.time);row.daylight=time>=Date.parse('2026-10-20T11:00Z')&&time<Date.parse('2026-10-20T22:00Z');
    if(!row.daylight)row.inputs.skySources.find(source=>source.id==='ecmwf').value=100;
  }
  let weather=calculate(f);
  assert.equal(weather.evidence.sky.scope,'daylight');
  assert.equal(weather.evidence.sky.expectedHours,11);
  assert.equal(weather.evidence.sky.score,100,'Nighttime cloud disagreement cannot describe the daytime sky.');
  assert.equal(weather.key,'high');
  const night=f.out.rainTimeline.find(row=>row.time==='2026-10-21T01:00:00.000Z');
  night.precipitationBlend.sources.find(source=>source.id==='ecmwf').value=.1;
  weather=calculate(f);
  assert.notEqual(weather.key,'high','Overnight rain disagreement is still part of the remaining date.');
  assert.equal(weather.evidence.rain.worstHour.time,'2026-10-21T01:00:00.000Z');
});

test('after sunset sky agreement explicitly switches to the remaining night and stops at local midnight',()=>{
  const f=fixture({clock:'2026-10-20T23:35:00Z'});
  for(const row of f.out.metricForecasts.series.feels)row.daylight=Date.parse(row.time)<Date.parse('2026-10-20T22:00:00Z');
  const midnight='2026-10-21T04:00:00.000Z';
  f.out.metricForecasts.series.feels.push({time:midnight,daylight:false,inputs:{skySources:sources(10).map(row=>({...row,value:row.id==='ecmwf'?100:10}))}});
  f.out.rainTimeline.push({time:midnight,end:'2026-10-21T05:00:00Z',officialPop:100,precipitationBlend:{sources:sources(.1)}});
  const weather=calculate(f);
  assert.equal(weather.evidence.sky.scope,'remaining-night');
  assert.equal(weather.evidence.sky.window.start,'2026-10-20T23:35:00.000Z');
  assert.equal(weather.evidence.sky.window.end,midnight);
  near(weather.evidence.sky.expectedHours,4+25/60);
  assert.equal(weather.key,'high','Tomorrow’s cloud/rain conflict cannot change tonight’s agreement.');
});

test('after sunset the remaining partial hour cannot retain its sunny hour-start flag',()=>{
  const f=fixture({clock:'2026-10-20T22:55:00Z'}),{latitude,longitude}=f.out.location;
  const sunset=Date.parse(solarTimes('2026-10-20',latitude,longitude).sunset);
  assert.ok(sunset<f.now,'The current time is after astronomical sunset in Knightdale.');
  for(const row of f.out.metricForecasts.series.feels)row.daylight=solarElevation(Date.parse(row.time),latitude,longitude)>0;
  assert.equal(f.out.metricForecasts.series.feels.find(row=>row.time==='2026-10-20T22:00:00.000Z').daylight,true,'The 6pm forecast was sampled before sunset.');
  const weather=calculate(f),sky=weather.evidence.sky;
  assert.equal(sky.scope,'remaining-night');
  assert.equal(sky.hours[0].time,'2026-10-20T22:55:00.000Z');
  assert.equal(sky.hours[0].daylight,false);
  near(sky.expectedHours,5+5/60);
  assert.equal(weather.key,'high');
});

test('after sunrise a remaining partial hour no longer inherits its nighttime hour-start flag',()=>{
  const f=fixture({clock:'2026-10-20T11:55:00Z'}),{latitude,longitude}=f.out.location;
  const sunrise=Date.parse(solarTimes('2026-10-20',latitude,longitude).sunrise);
  assert.ok(sunrise<f.now);
  for(const row of f.out.metricForecasts.series.feels)row.daylight=solarElevation(Date.parse(row.time),latitude,longitude)>0;
  assert.equal(f.out.metricForecasts.series.feels.find(row=>row.time==='2026-10-20T11:00:00.000Z').daylight,false);
  const sky=calculate(f).evidence.sky;
  assert.equal(sky.scope,'daylight');
  assert.equal(sky.hours[0].time,'2026-10-20T11:55:00.000Z');
  assert.equal(sky.hours[0].daylight,true);
});

test('polar night uses nighttime evidence and polar day retains the full daylight date',()=>{
  for(const [date,clock,scope] of [
    ['2026-12-21','2026-12-21T00:00:00Z','remaining-night'],
    ['2026-06-21','2026-06-21T00:00:00Z','daylight'],
  ]){
    const weather=calculate(fixture({date,clock,zone:'UTC',latitude:80,longitude:0,daylight:null}));
    assert.equal(weather.evidence.sky.scope,scope);
    assert.equal(weather.evidence.sky.expectedHours,24);
    assert.equal(weather.evidence.sky.complete,true);
    assert.equal(weather.key,'high');
  }
});

test('three complete agreeing sources can stay High on day three; a missing sky source is disclosed',()=>{
  const f=fixture({date:'2026-10-22',clock:'2026-10-20T09:00:00Z',index:2});
  assert.equal(calculate(f).key,'high','Lead time does not reduce the sky/rain agreement indicator.');
  const row=f.out.metricForecasts.series.feels.find(row=>row.time==='2026-10-22T16:00:00.000Z');
  row.inputs.skySources.find(source=>source.id==='ecmwf').value=null;
  const limited=calculate(f);
  assert.notEqual(limited.key,'high');
  assert.deepEqual(limited.evidence.sky.completeSources,['nws','nbm']);
});

test('cloud sources beyond the feels horizon still support day-three agreement without inventing absent feels evidence',()=>{
  const f=fixture({date:'2026-10-22',clock:'2026-10-20T09:00:00Z',index:2});
  f.out.metricForecasts.series.cloud=f.out.metricForecasts.series.feels.map(row=>({time:row.time,value:10,sources:sources(10)}));
  f.out.metricForecasts.series.feels=[];
  const cloudOnly=calculate(f);
  assert.equal(cloudOnly.key,'high');
  assert.equal(cloudOnly.evidence.sky.scope,'daylight');
  assert.deepEqual(cloudOnly.evidence.sky.completeSources,IDS);
  f.out.metricForecasts.series.feels=f.out.metricForecasts.series.cloud.map(row=>({time:row.time,value:65,daylight:true,inputs:{skyCover:null,skySources:[]}}));
  const missingCanonical=calculate(f);
  assert.equal(missingCanonical.key,'unavailable','An explicitly missing canonical sky source cannot borrow an unrelated cloud estimate.');
  assert.equal(missingCanonical.evidence.sky.coveredHours,0);
});

test('a missing official rain probability in the current partial hour is disclosed instead of becoming zero',()=>{
  const f=fixture({clock:'2026-10-20T09:35:00Z'});
  f.out.rainTimeline.find(row=>row.time==='2026-10-20T09:00:00.000Z').officialPop=null;
  const weather=calculate(f),rain=weather.evidence.rain;
  assert.notEqual(weather.key,'high');
  assert.equal(rain.hours[0].officialPop,null);
  assert.equal(rain.officialProbabilityComplete,false);
  near(rain.expectedHours-rain.officialProbabilityCoveredHours,25/60);
});

test('missing or null sky/rain evidence never becomes an agreeing zero forecast',()=>{
  for(const kind of ['sky','rain']){
    const f=fixture({clock:'2026-10-20T09:35:00Z'});
    if(kind==='sky')for(const row of f.out.metricForecasts.series.feels)row.inputs.skySources=sources(null);
    else for(const row of f.out.rainTimeline)row.precipitationBlend.sources=sources(null);
    const weather=calculate(f),component=weather.evidence[kind];
    assert.equal(weather.key,'unavailable');
    assert.equal(component.coveredHours,0);
    assert.equal(component.score,null);
    assert.deepEqual(component.completeSources,[]);
    assert.ok(component.hours.every(hour=>hour.category===null&&hour.sources.length===0));
  }
});

test('duplicate UTC rows cannot make an incomplete interval look fully supported',()=>{
  const f=fixture({clock:'2026-10-20T09:35:00Z'}),row=f.out.rainTimeline.find(row=>row.time==='2026-10-20T09:00:00.000Z');
  f.out.rainTimeline.push(structuredClone(row));
  const weather=calculate(f);
  assert.notEqual(weather.key,'high');
  assert.equal(weather.evidence.rain.complete,false);
  assert.equal(weather.evidence.rain.hours[0].sources.length,0);
});

test('short, coarse or unspecified rain intervals cannot stand in for a complete canonical forecast hour',()=>{
  for(const duration of [.5,3,null]){
    const f=fixture({clock:'2026-10-20T09:10:00Z'}),row=f.out.rainTimeline.find(row=>row.time==='2026-10-20T09:00:00.000Z');
    if(duration===null)delete row.end;else row.end=iso(Date.parse(row.time)+duration*H);
    const weather=calculate(f);
    assert.notEqual(weather.key,'high',`${duration}-hour rain intervals are not same-hour evidence.`);
    assert.equal(weather.evidence.rain.hours[0].sources.length,0);
  }
});
