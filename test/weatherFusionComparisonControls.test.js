import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPARISON_DAY_LIMIT, comparisonChartData, comparisonLinePath, comparisonIsolatedPoints, comparisonYAxis, comparisonDayValues} from '../public/weather-fusion/wn-compare.js';
import {buildSeries} from '../public/weather-fusion/wn-blend.js';

const fixture = () => ({perModel:true,
  days:Array.from({length:10},(_,i)=>({date:`2026-10-${String(18+i).padStart(2,'0')}`})),
  forecastValues:[60,61,62,63,64,65,66,67,68,69],
  modelMaps:Array.from({length:10},(_,i)=>({nws:70+i,ecmwf:50+i,nbm:40+i,hrrr:i<2?30+i:null})),
  wnVals:[80,81,82,83,84,85,86,87,88,89]});

test('native comparison renders seven source calendar dates and every available model',()=>{
  const chart=comparisonChartData(fixture());
  assert.equal(COMPARISON_DAY_LIMIT,7);
  assert.equal(chart.days.length,7);
  assert.equal(chart.days.at(-1).date,'2026-10-24');
  assert.deepEqual(chart.series.nourie,[60,61,62,63,64,65,66]);
  assert.deepEqual(chart.visible,['nourie','nws','hrrr','nbm','ecmwf','wn']);
});

test('native buildSeries limits every field to the same seven actual forecast dates',()=>{
  const built=fixture(),fx={location:{timeZone:'America/New_York'},current:{},hours:[],rainTimeline:[],days:built.days.map((day,i)=>({...day,high:60+i,low:40+i,condition:'Clear',uvMax:i})),metricForecasts:{series:{}}};
  const series=buildSeries(fx,null,'uv',Date.parse('2026-10-18T14:00:00Z'));
  assert.equal(series.days.length,7);assert.equal(series.windows.length,7);
  assert.equal(series.forecastValues.length,7);assert.deepEqual(series.single,[0,1,2,3,4,5,6]);
});

test('selecting lines never recalculates or hides the canonical Weather Nourie forecast',()=>{
  const built=fixture(),original=JSON.stringify(built);
  const all=comparisonChartData(built),one=comparisonChartData(built,new Set(['nourie','nws','hrrr','nbm','wn']));
  assert.deepEqual(one.visible,['nourie','ecmwf']);
  assert.deepEqual(one.series.nourie,all.series.nourie);
  assert.deepEqual(comparisonDayValues(one,3),[{id:'nourie',value:63},{id:'ecmwf',value:53}]);
  assert.equal(JSON.stringify(built),original);
});

test('missing HRRR days end its line and remain unavailable in the selected-day values',()=>{
  const chart=comparisonChartData(fixture());
  assert.deepEqual(chart.series.hrrr,[30,31,null,null,null,null,null]);
  assert.equal(comparisonLinePath(chart.series.hrrr,i=>i*10,v=>v),'M0.0,30.0L10.0,31.0');
  assert.equal(comparisonDayValues(chart,6).find(row=>row.id==='hrrr').value,null);
});

test('null/interior missing days break SVG paths while real zero model values survive',()=>{
  assert.equal(comparisonLinePath([0,null,3,NaN,4],i=>i,v=>v),'M0.0,0.0M2.0,3.0M4.0,4.0');
  const built=fixture();built.modelMaps[0].nws=0;built.forecastValues[0]=0;
  const chart=comparisonChartData(built);
  assert.equal(chart.series.nws[0],0);assert.equal(chart.series.nourie[0],0);
});

test('a single valid model day becomes a visible dot instead of an invisible move-only line',()=>{
  assert.deepEqual(comparisonIsolatedPoints([0,null,3,4,null,6]),[{index:0,value:0},{index:5,value:6}]);
});

test('already-contributing WeatherNext source takes precedence over the comparison-only fallback',()=>{
  const built=fixture();built.modelMaps[0].wn=42;built.modelMaps[1].wn=null;
  assert.equal(comparisonChartData(built).series.wn[0],42);
  assert.equal(comparisonChartData(built).series.wn[1],null);
});

test('probability is always0–100 and empty or constant values never cause a zero-height axis',()=>{
  assert.deepEqual(comparisonYAxis([1,2,3],'%','pop'),{lo:0,hi:100});
  for(const [values,unit,variable]of[[[],'°F','temp'],[[0,0],'in','rain'],[[5,5],'mph','wind']]){
    const axis=comparisonYAxis(values,unit,variable);assert.ok(Number.isFinite(axis.lo)&&axis.hi>axis.lo);
  }
});

test('whole-number axes retain distinct labels for constant temperature and calm wind',()=>{
  for(const[values,unit,variable]of[[[65,65],'°F','temp'],[[0,0],'mph','wind'],[[0,0],'','uv']]){
    const{lo,hi}=comparisonYAxis(values,unit,variable);
    const labels=[0,.25,.5,.75,1].map(fraction=>Math.round(lo+fraction*(hi-lo)));
    assert.equal(new Set(labels).size,5);
  }
});

test('single-source UV and AQI views retain real values and ignore model-visibility settings',()=>{
  const chart=comparisonChartData({...fixture(),perModel:false,single:[0,null,2,3,4,5,6,7,8,9]},new Set(['single']));
  assert.deepEqual(chart.visible,['single']);assert.deepEqual(chart.series.single,[0,null,2,3,4,5,6]);
});
