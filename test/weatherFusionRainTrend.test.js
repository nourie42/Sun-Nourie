import test from 'node:test';
import assert from 'node:assert/strict';
import {rainTrendSample,updateRainTrend} from '../public/weather-fusion/rain-trend.js';

function storage() {
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
}

function forecast(chance,runAt,latitude=35.787) {
  const likelihood={value:chance,coverage:{complete:true}};
  return {assembledAt:runAt,location:{latitude,longitude:-78.481,timeZone:'UTC'},modelContributions:[{id:'hrrr',runAt}],days:[{date:'2026-09-12',rainLikelihood:likelihood,popDayLikelihood:likelihood,popNightLikelihood:likelihood}]};
}

test('Today rain trend compares distinct HRRR runs and only shows a decrease',()=>{
  const state=storage(),morning=Date.parse('2026-09-12T10:00:00Z');
  assert.equal(updateRainTrend(forecast(40,'2026-09-12T09:00:00Z'),morning,state),null);
  assert.equal(updateRainTrend(forecast(40,'2026-09-12T09:00:00Z'),morning,state),null,'a refresh of the same run is not a trend');
  assert.deepEqual(updateRainTrend(forecast(28,'2026-09-12T10:00:00Z'),morning,state),{
    direction:'down',change:12,from:40,to:28,previousRunAt:'2026-09-12T09:00:00Z',currentRunAt:'2026-09-12T10:00:00Z'
  });
  assert.equal(updateRainTrend(forecast(35,'2026-09-12T11:00:00Z'),morning,state),null,'the requested notice is only for a lowering trend');
});

test('trend history is isolated by location and Today/Tonight phase',()=>{
  const state=storage();
  const first=forecast(40,'2026-09-12T09:00:00Z');
  assert.match(rainTrendSample(first,Date.parse('2026-09-12T10:00:00Z')).key,/\|day$/);
  updateRainTrend(first,Date.parse('2026-09-12T10:00:00Z'),state);
  assert.equal(updateRainTrend(forecast(20,'2026-09-12T10:00:00Z',35.612),Date.parse('2026-09-12T10:00:00Z'),state),null);
  assert.equal(updateRainTrend(forecast(20,'2026-09-12T10:00:00Z'),Date.parse('2026-09-12T20:00:00Z'),state),null);
});
