import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeries,dailyHighComparison} from '../public/weather-fusion/wn-blend.js';

const H=3600000,start=Date.parse('2026-10-19T04:00:00Z'),now=start+14*H+46*60000;
const iso=time=>new Date(time).toISOString();
function forecast(){
 const temperature=Array.from({length:48},(_,i)=>{
  const hour=i%24,highs={nws:72,ecmwf:69,wn:73};
  const sources=Object.entries(highs).map(([id,high])=>({id,value:hour===22?{nws:60.4,ecmwf:57,wn:52}[id]:high-Math.abs(hour-14),weight:1/3}));
  return {time:iso(start+i*H),value:sources.reduce((sum,p)=>sum+p.value,0)/sources.length,sources};
 });
 return {assembledAt:iso(now),location:{timeZone:'America/New_York'},current:{},hours:[],rainTimeline:[],
  days:[{date:'2026-10-19',high:71.3,low:52,pop:0,condition:'Sunny',confidence:{window:{start:iso(start+14*H),end:iso(start+24*H)}}},
   {date:'2026-10-20',high:71.3,low:52,pop:0,condition:'Sunny',confidence:{window:{start:iso(start+24*H),end:iso(start+48*H)}}}],
  metricForecasts:{series:{temperature}}};
}

test('daily-high comparison separates a4-degree high range from an8.4-degree same-hour gap',()=>{
 const f=forecast(),before=structuredClone(f),built=buildSeries(f,null,'temp',now),comparison=dailyHighComparison(built,1);
 assert.deepEqual(built.modelMaps[1],{nws:72,ecmwf:69,wn:73});
 assert.equal(comparison.published.spread,4);assert.equal(comparison.contributing.spread,4);
 const night=f.metricForecasts.series.temperature.find(p=>p.time===iso(start+46*H)).sources.map(p=>p.value);
 assert.ok(Math.abs(Math.max(...night)-Math.min(...night)-8.4)<1e-9);
 assert.deepEqual(f,before,'comparison does not rewrite source forecast or confidence');
});

test('temperature charts keep the snapshot confidence window across a later render hour',()=>{
 const f=forecast(),initial=buildSeries(f,null,'temp',now),later=buildSeries(f,null,'temp',now+2*H);
 assert.deepEqual(initial.windows,later.windows);
 assert.deepEqual(initial.modelMaps,later.modelMaps);
 assert.deepEqual(initial.forecastValues,later.forecastValues);
 assert.equal(later.windows[0].start,start+14*H);
 assert.equal(later.assembledAt,f.assembledAt);
});

test('a complete published model with zero blend weight is excluded from the contributing range',()=>{
 const f=forecast();for(const point of f.metricForecasts.series.temperature)point.sources.push({id:'gfs',value:90.25,weight:0});
 const built=buildSeries(f,null,'temp',now),comparison=dailyHighComparison(built,1);
 assert.equal(built.modelMaps[1].gfs,90.25);
 assert.equal(Object.hasOwn(built.contributingHighs[1],'gfs'),false);
 assert.equal(comparison.published.high.id,'gfs');assert.equal(comparison.published.high.value,90.25);
 assert.equal(comparison.contributing.spread,4);
});

test('an incomplete model day does not invent a daily high from its available hours',()=>{
 const f=forecast();f.metricForecasts.series.temperature.find(p=>p.time===iso(start+25*H)).sources=f.metricForecasts.series.temperature.find(p=>p.time===iso(start+25*H)).sources.filter(s=>s.id!=='wn');
 const built=buildSeries(f,null,'temp',now),comparison=dailyHighComparison(built,1);
 assert.equal(Object.hasOwn(built.modelMaps[1],'wn'),false);
 assert.equal(Object.hasOwn(built.contributingHighs[1],'wn'),false);
 assert.equal(comparison.contributing.spread,3);
});

test('range keeps raw model precision and excludes the blended forecast value',()=>{
 const f=forecast();for(const point of f.metricForecasts.series.temperature){point.sources[0].value+=.04;point.sources[1].value+=.14;point.value=100;}
 const built=buildSeries(f,null,'temp',now),comparison=dailyHighComparison(built,1);
 assert.equal(built.forecastValues[1],100);
 assert.equal(comparison.published.low.value,69.14);assert.equal(comparison.published.high.value,73);
 assert.ok(Math.abs(comparison.published.spread-3.86)<1e-9);
});

test('an invalid confidence window falls back to the current calendar window',()=>{
 const f=forecast();f.days[0].confidence.window={start:'invalid',end:iso(start+24*H)};
 assert.equal(buildSeries(f,null,'temp',now).windows[0].start,Math.floor(now/H)*H);
});
