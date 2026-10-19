import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshCalendarConfidence} from '../src/weatherFusionDirect.js';

const H=3600000,now=Date.parse('2026-10-19T12:00:00Z'),start=Date.parse('2026-10-20T00:00:00Z'),runAt='2026-10-19T06:00:00Z';
function fixture(){
 const rows=Array.from({length:24},(_,i)=>{
  const a=i===2?52:i===15?69:55,b=i===2?60.4:i===15?73:58;
  return {time:new Date(start+i*H).toISOString(),value:a*.4+b*.6,sources:[{id:'nws',value:a,weight:.4,runAt},{id:'nbm',value:b,weight:.6,runAt}]};
 });
 return {location:{timeZone:'UTC'},days:[{date:'2026-10-19'},{date:'2026-10-20',qpf:.2,qpfBlend:{sources:[{id:'nws',value:.2,weight:.4},{id:'nbm',value:.2,weight:.6}],sourceValues:{nws:.2,nbm:.2}},rainLikelihood:{coverage:{complete:true}}}],metricForecasts:{series:{temperature:rows}},rainTimeline:[]};
}
const calculate=out=>{refreshCalendarConfidence(out,{now});return out.days[1];};

test('confidence explains an 8.4-degree overnight gap separately from 69-to-73 daily highs',()=>{
 const day=calculate(fixture()),comparison=day.confidence.temperatureComparison;
 assert.equal(day.confidence.temperatureSpread,8.4);
 assert.equal(day.confidence.temperatureSpreadBasis,'same-hour');
 assert.equal(comparison.basis,'maximum-same-hour-spread');
 assert.deepEqual(comparison.window,{start:new Date(start).toISOString(),end:new Date(start+24*H).toISOString()});
 assert.deepEqual(comparison.worstHour,{time:new Date(start+2*H).toISOString(),spread:8.4,low:{id:'nws',value:52},high:{id:'nbm',value:60.4},sources:[{id:'nws',value:52,weight:.4,runAt},{id:'nbm',value:60.4,weight:.6,runAt}]});
 assert.equal(comparison.dailyHigh.spread,4);assert.equal(day.highSpread,4);
 assert.deepEqual(comparison.dailyHigh.low,{id:'nws',value:69});assert.deepEqual(comparison.dailyHigh.high,{id:'nbm',value:73});
 assert.ok(comparison.dailyHigh.sources.every(source=>source.complete&&source.coverageHours===24));
});

test('daily-high evidence preserves raw extrema instead of subtracting rounded chart labels',()=>{
 const out=fixture();out.metricForecasts.series.temperature[15].sources[0].value=69.049;out.metricForecasts.series.temperature[15].sources[1].value=73.051;
 const day=calculate(out),comparison=day.confidence.temperatureComparison;
 assert.deepEqual(comparison.dailyHigh.low,{id:'nws',value:69.049});assert.deepEqual(comparison.dailyHigh.high,{id:'nbm',value:73.051});
 assert.equal(comparison.dailyHigh.sources.find(source=>source.id==='nws').value,69.049);
 assert.equal(comparison.dailyHigh.spread,4);assert.equal(day.highSpread,4);
});

test('zero-weight invalid and out-of-window samples cannot invent a disagreement',()=>{
 const out=fixture(),rows=out.metricForecasts.series.temperature;
 rows[1].sources.push({id:'ecmwf',value:150,weight:0},{id:'wn',value:NaN,weight:.1},{id:'hrrr',value:Infinity,weight:.1});
 for(const time of [start-H,start+24*H])rows.push({time:new Date(time).toISOString(),value:60,sources:[{id:'nws',value:0,weight:.5},{id:'nbm',value:160,weight:.5}]});
 rows.push({time:'invalid',value:60,sources:[{id:'nws',value:0,weight:.5},{id:'nbm',value:160,weight:.5}]});
 const comparison=calculate(out).confidence.temperatureComparison;
 assert.equal(comparison.worstHour.spread,8.4);assert.equal(comparison.worstHour.sources.length,2);
 assert.deepEqual(comparison.dailyHigh.sources.map(source=>source.id),['nws','nbm']);
});

test('incomplete sources remain honest hourly evidence but cannot establish daily-high ranges',()=>{
 const out=fixture();out.metricForecasts.series.temperature[2].sources=out.metricForecasts.series.temperature[2].sources.filter(source=>source.id!=='nbm');
 const comparison=calculate(out).confidence.temperatureComparison;
 assert.equal(comparison.worstHour.spread,4);
 assert.equal(comparison.dailyHigh.spread,null);assert.equal(comparison.dailyHigh.sources.length,1);
});

test('insufficient valid source evidence produces null comparisons',()=>{
 const out=fixture();for(const row of out.metricForecasts.series.temperature)row.sources=row.sources.filter(source=>source.id==='nws');
 const day=calculate(out),comparison=day.confidence.temperatureComparison;
 assert.equal(comparison.worstHour,null);assert.equal(comparison.dailyHigh.spread,null);assert.equal(comparison.dailyHigh.sources.length,1);assert.equal(day.confidence.temperatureSpread,null);assert.equal(day.highSpread,null);
});
