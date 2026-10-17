import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshCalendarConfidence} from '../src/weatherFusionDirect.js';
import {forecastConfidence} from '../public/weather-fusion/forecast-confidence.js';
import {calendarDayWindow} from '../public/weather-fusion/calendar-day.js';

const H=3600000,now=Date.parse('2026-10-17T02:20:00Z');
function fixture({zone='America/New_York',date='2026-10-16',clock=now,ids=['nws','hrrr','ecmwf']}={}) {
 const day={date},window=calendarDayWindow(day,0,clock,zone),length=(window.end-window.start)/H;
 const rows=Array.from({length},(_,i)=>({time:new Date(window.start+i*H).toISOString(),value:65-i,
  sources:ids.map(id=>({id,value:65-i,weight:1/ids.length,runAt:'2026-10-16T22:00:00Z'}))}));
 const rainRows=rows.map(row=>({time:row.time,end:new Date(Date.parse(row.time)+H).toISOString(),rainLikelihood:{value:12}}));
 Object.assign(day,{qpf:.02,rainLikelihood:{value:12,coverage:{complete:true,expectedHours:length,availableHours:length}},
  qpfBlend:{sourceValues:Object.fromEntries(ids.map(id=>[id,.02])),sources:ids.map(id=>({id,value:.02,weight:1/ids.length,coverageHours:length}))}});
 return {assembledAt:new Date(clock).toISOString(),location:{timeZone:zone},days:[day],metricForecasts:{series:{temperature:rows}},rainTimeline:rainRows};
}
const apply=f=>refreshCalendarConfidence(f,{now:Date.parse(f.assembledAt)}).days[0].confidence;

test('two agreeing weather models and complete official guidance earn high same-day confidence',()=>{
 const f=fixture(),c=apply(f);
 assert.equal(c.key,'high');assert.equal(c.score,100);
 assert.equal(c.temperatureSpread,0);assert.equal(c.coverage.temperature.complete,true);
 assert.deepEqual(c.coverage.temperature.completeSources,['nws','hrrr','ecmwf']);
 assert.match(c.summary,/agree closely/);assert.deepEqual(c.reasons,[]);
});

test('two complete, closely agreeing forecast sources can earn High without inventing more sources',()=>{
 const c=apply(fixture({ids:['nws','ecmwf']}));
 assert.equal(c.key,'high');assert.equal(c.sourceCount,2);assert.equal(c.score,95);
 assert.deepEqual(c.sourceIds,['nws','ecmwf']);
});

test('real hourly temperature and rainfall disagreements reduce confidence and say why',()=>{
 const f=fixture();
 for(const row of f.metricForecasts.series.temperature)row.sources.find(source=>source.id==='ecmwf').value+=15;
 f.days[0].qpfBlend.sourceValues.ecmwf=1.02;
 f.days[0].qpfBlend.sources.find(source=>source.id==='ecmwf').value=1.02;
 const c=apply(f);
 assert.notEqual(c.key,'high');assert.equal(c.temperatureSpread,15);
 assert.match(c.summary,/15\.0°F/);assert.match(c.summary,/1\.00 inches/);
});

test('equal daily highs do not conceal disagreement about which hour becomes cold',()=>{
 const f=fixture();
 f.metricForecasts.series.temperature[0].sources.find(source=>source.id==='ecmwf').value=50;
 f.metricForecasts.series.temperature[1].sources.find(source=>source.id==='ecmwf').value=65;
 const c=apply(f);
 assert.equal(f.days[0].highSpread,0);assert.equal(c.temperatureSpread,15);
 assert.match(c.summary,/15\.0°F/);
});

test('missing rain models keep confidence limited even when the temperature sources agree',()=>{
 const f=fixture();
 f.rainTimeline[0].rainLikelihood.mode='nws-fallback';
 const c=apply(f);
 assert.equal(c.key,'moderate');assert.ok(c.score<85);
 assert.equal(c.coverage.rain.officialFallback,true);
 assert.match(c.summary,/Rain-model inputs are missing/);
 assert.doesNotMatch(c.summary,/Rainfall guidance differs by 0\.00/);
});

test('single-source rain and temperature cannot claim measured model agreement',()=>{
 const c=apply(fixture({ids:['nws']}));
 assert.notEqual(c.key,'high');assert.equal(c.sourceCount,1);
 assert.match(c.summary,/Fewer than two temperature sources/);
 assert.match(c.summary,/Fewer than two rainfall sources/);
});

test('a missing temperature hour is disclosed and cannot result in High',()=>{
 const f=fixture();f.metricForecasts.series.temperature.pop();
 const c=apply(f);
 assert.equal(c.coverage.temperature.complete,false);assert.ok(c.score<=65);
 assert.match(c.summary,/temperature forecast hours are missing/);
});

test('confidence for today ends at local midnight, excluding tomorrow’s disagreement',()=>{
 const f=fixture();
 f.metricForecasts.series.temperature.push({time:'2026-10-17T04:00:00Z',value:60,sources:[{id:'nws',value:40,weight:.5},{id:'ecmwf',value:80,weight:.5}]});
 f.rainTimeline.push({time:'2026-10-17T04:00:00Z',end:'2026-10-17T05:00:00Z',rainLikelihood:{mode:'nws-fallback',value:95}});
 const c=apply(f);
 assert.equal(c.window.end,'2026-10-17T04:00:00.000Z');assert.equal(c.key,'high');assert.equal(c.temperatureSpread,0);
 assert.equal(c.coverage.rain.officialFallback,false);
 assert.equal(c.contributions.low[0].value,64);
});

test('confidence windows respect the selected timezone and DST calendar length',()=>{
 for(const [zone,date,clock,expected] of [
  ['America/Chicago','2026-10-16','2026-10-17T02:20Z',3],
  ['America/New_York','2026-11-01','2026-11-01T04:00Z',25],
  ['America/New_York','2026-03-08','2026-03-08T05:00Z',23]
 ]) {
  const c=apply(fixture({zone,date,clock:Date.parse(clock)}));
  assert.equal(c.coverage.temperature.expectedHours,expected,`${zone} ${date}`);
  assert.equal(c.coverage.temperature.complete,true);assert.equal(c.key,'high');
 }
});

test('zero rainfall spread never produces a disagreement reason and lead time still counts',()=>{
 const base={highSpread:0,qpfSpread:0,guidanceCount:2,sourceIds:['nws','ecmwf'],officialCoverage:1,
  temperatureCoverage:true,rainCoverage:true,temperatureSourceCount:2,rainSourceCount:2};
 const today=forecastConfidence(base),later=forecastConfidence({...base,dayIndex:5});
 assert.ok(later.score<today.score);assert.doesNotMatch(today.summary,/disagree|differs/);
 assert.match(later.summary,/5 days away/);
});
