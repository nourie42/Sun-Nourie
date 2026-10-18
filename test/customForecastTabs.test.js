import test from 'node:test';
import assert from 'node:assert/strict';
import {CUSTOM_FORECAST_TABS,modelComparisonPoint} from '../public/weather-fusion/custom-forecast.js';
import {CUSTOM_FORECAST_METRICS} from '../public/weather-fusion/custom-forecast-model.js';

function comparison({date='2026-10-19',start='2026-10-19T04:00:00Z',end='2026-10-20T04:00:00Z',baseline=70,selected=68,metricId='high',selectedId='hrrr'}={}){
  return {selectedId,label:'HRRR',metricId,baseline:[baseline],selected:selectedId?[selected]:[],days:[{date,metric:{window:{start:Date.parse(start),end:Date.parse(end)}}}]};
}

test('the personal forecast offers six everyday measurements without changing the full model API',()=>{
  assert.deepEqual(CUSTOM_FORECAST_TABS.map(tab=>tab.label),['Temperature','Feels like','Rain chance','Rainfall','Wind','Snow']);
  assert.equal(new Set(CUSTOM_FORECAST_TABS.map(tab=>tab.id)).size,6);
  assert.ok(CUSTOM_FORECAST_TABS.every(tab=>CUSTOM_FORECAST_METRICS.some(metric=>metric.id===tab.id)));
  assert.equal(CUSTOM_FORECAST_METRICS.length,18,'other consumers keep the full metric API');
});

test('a daily point shows its actual local calendar period and both model values',()=>{
  const result=modelComparisonPoint(comparison(),0,'America/New_York');
  assert.equal(result.dateLabel,'Monday, Oct 19, 2026');
  assert.equal(result.periodLabel,'Oct 19, 12:00 AM EDT – Oct 20, 12:00 AM EDT');
  assert.equal(result.baseline,'70°');assert.equal(result.selected,'68°');assert.equal(result.modelLabel,'HRRR');
});

test('remaining today starts at the actual remaining forecast instant, without inventing a peak hour',()=>{
  const source=comparison({date:'2026-10-18',start:'2026-10-19T01:37:00Z',end:'2026-10-19T04:00:00Z'}),before=JSON.stringify(source);
  const result=modelComparisonPoint(source,0,'America/New_York');
  assert.equal(result.dateLabel,'Sunday, Oct 18, 2026');
  assert.equal(result.periodLabel,'Oct 18, 9:37 PM EDT – Oct 19, 12:00 AM EDT');
  assert.equal(JSON.stringify(source),before,'inspecting a point never mutates the forecast');
});

test('the 25-hour fallback date retains both actual timezone offsets',()=>{
  const result=modelComparisonPoint(comparison({date:'2026-11-01',start:'2026-11-01T04:00:00Z',end:'2026-11-02T05:00:00Z'}),0,'America/New_York');
  assert.equal(result.periodLabel,'Nov 1, 12:00 AM EDT – Nov 2, 12:00 AM EST');
  assert.equal(result.dateLabel,'Sunday, Nov 1, 2026');
});

test('real zeros stay visible and a missing model point is not displayed as zero',()=>{
  const result=modelComparisonPoint(comparison({metricId:'amount',baseline:0,selected:null}),0,'America/Los_Angeles');
  assert.equal(result.baseline,'0.00 in');assert.equal(result.selected,'Not supplied');
  assert.equal(result.periodLabel,'Oct 18, 9:00 PM PDT – Oct 19, 9:00 PM PDT');
});

test('unavailable period metadata stays unavailable and baseline-only mode has no invented model',()=>{
  const source=comparison({selectedId:null});source.days[0].metric.window=null;
  const result=modelComparisonPoint(source,0,'America/New_York');
  assert.equal(result.periodLabel,'Daily period not supplied.');assert.equal(result.modelLabel,null);assert.equal(result.selected,'Not supplied');
  assert.equal(modelComparisonPoint(source,2),null);
  assert.equal(modelComparisonPoint(null),null);
});
