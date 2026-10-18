import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeries} from '../public/weather-fusion/wn-blend.js';
import {calendarDayWindow} from '../public/weather-fusion/calendar-day.js';

const H=3600000,now=Date.parse('2026-10-17T09:45:57Z');
function fixture(date='2026-10-19',zone='America/New_York'){
 const days=[{date:'2026-10-17'},{date}];
 const w=calendarDayWindow(days[1],1,now,zone);
 const temperature=[];
 for(let time=w.start;time<w.end;time+=H)temperature.push({time:new Date(time).toISOString(),value:64,
  sources:[{id:'nws',value:64},{id:'hrrr',value:time<w.start+3*H?44.8:62},{id:'nbm',value:62},{id:'ecmwf',value:64},{id:'wn',value:65}]});
 return {location:{timeZone:zone},days:days.map(day=>({...day,high:64,low:44,rainLikelihood:{aggregation:'maximum-hourly'}})),hours:[],metricForecasts:{series:{temperature}}};
}
const hrrr=(f)=>buildSeries(f,null,'temp',now).modelMaps[1].hrrr;

test('captured Monday overnight HRRR tail is not a daily high; complete models remain',()=>{
 const f=fixture();f.metricForecasts.series.temperature.forEach((row,i)=>{if(i>=3)row.sources=row.sources.filter(s=>s.id!=='hrrr');});
 const built=buildSeries(f,null,'temp',now);
 assert.equal(Object.hasOwn(built.modelMaps[1],'hrrr'),false);
 assert.deepEqual(built.modelMaps[1],{nws:64,nbm:62,ecmwf:64,wn:65});
 assert.equal(f.metricForecasts.series.temperature[0].sources.find(s=>s.id==='hrrr').value,44.8,'available hourly HRRR guidance is retained');
});

test('HRRR remains visible on complete days, with genuine daily maximum and zero preserved',()=>{
 const f=fixture();assert.equal(hrrr(f),62);
 for(const row of f.metricForecasts.series.temperature)row.sources.find(s=>s.id==='hrrr').value=0;
 assert.equal(hrrr(f),0);
});

test('a missing beginning, interior hour or final hour cannot be masked by duplicate points',()=>{
 for(const missing of [0,12,23]){
  const f=fixture(),rows=f.metricForecasts.series.temperature;
  rows[missing].sources=rows[missing].sources.filter(s=>s.id!=='hrrr');
  rows.push(structuredClone(rows[missing===0?1:0]));
  assert.equal(hrrr(f),undefined,`missing hour ${missing}`);
 }
});

test('each model must independently cover its displayed date, including unavailable numeric inputs',()=>{
 const f=fixture(),rows=f.metricForecasts.series.temperature;
 rows[12].sources.find(s=>s.id==='nbm').value=null;
 rows[12].sources.find(s=>s.id==='ecmwf').value=NaN;
 const models=buildSeries(f,null,'temp',now).modelMaps[1];
 assert.equal(models.nbm,undefined);assert.equal(models.ecmwf,undefined);
 assert.equal(models.hrrr,62);assert.equal(models.wn,65);assert.equal(models.nws,64);
});

test('today requires only the remaining forecast hours through midnight',()=>{
 const f=fixture('2026-10-17');f.days=[f.days[1]];
 f.metricForecasts.series.temperature=f.metricForecasts.series.temperature.filter(row=>Date.parse(row.time)>=Math.floor(now/H)*H);
 assert.equal(buildSeries(f,null,'temp',now).modelMaps[0].hrrr,62);
 f.metricForecasts.series.temperature.pop();
 assert.equal(buildSeries(f,null,'temp',now).modelMaps[0].hrrr,undefined);
});

test('23-hour and 25-hour daylight-saving dates require their actual local calendar hours',()=>{
 for(const [date,count] of [['2026-03-08',23],['2026-11-01',25]]){
  const f=fixture(date),rows=f.metricForecasts.series.temperature;
  assert.equal(rows.length,count);assert.equal(hrrr(f),62);
  rows.at(-1).sources=rows.at(-1).sources.filter(s=>s.id!=='hrrr');
  assert.equal(hrrr(f),undefined);
 }
});

test('standalone WeatherNext also requires a complete temperature day, without changing rainfall rules',()=>{
 const f=fixture(),hourly=f.metricForecasts.series.temperature.map(row=>({time:row.time,values:{temperature_2m:{mean:273.15}}}));
 assert.equal(buildSeries(f,{hourly},'temp',now).wnVals[1],32);
 hourly.pop();assert.equal(buildSeries(f,{hourly},'temp',now).wnVals[1],null);
});
