import test from 'node:test';
import assert from 'node:assert/strict';
import {carWashSummary,carWashHTML} from '../public/weather-fusion/car-wash.js';
import {forecastOutlookDetails} from '../public/weather-fusion/outlook-details.js';
import {renderDailyRows} from '../public/weather-fusion/experience.js';

const H=3600000,now=Date.parse('2026-10-16T23:30:00Z'),midnight=Date.parse('2026-10-17T04:00:00Z');
const iso=time=>new Date(time).toISOString();
function fixture(){
 const hours=Array.from({length:29},(_,i)=>{
  const time=Date.parse('2026-10-16T23:00:00Z')+i*H,today=time<midnight;
  return {time:iso(time),end:iso(time+H),temperature:today?70-i:i===10?95:50,wind:today?5:100,
   condition:today?'Clear':'Rain',skyCover:today?0:100,isDay:false,
   rainLikelihood:{value:today?16:i===10?95:30},precipitation:today?.01:.2};
 });
 const likelihood=(value,start,end)=>({value,aggregation:'maximum-hourly',coverage:{complete:true},window:{start:iso(start),end:iso(end)}});
 return {assembledAt:iso(now),location:{timeZone:'America/New_York'},current:{condition:'Clear'},hours,rainTimeline:hours,
  days:[{date:'2026-10-16',label:'Today',high:90,low:10,condition:'Sunny',nightCondition:'Thunderstorms',rainLikelihood:likelihood(16,now,midnight),popNightLikelihood:likelihood(95,now,midnight+6*H)},
   {date:'2026-10-17',label:'Saturday',high:40,low:20,condition:'Rain',rainLikelihood:{...likelihood(95,midnight,midnight+24*H),peakTime:iso(midnight+5*H)}},
   {date:'2026-10-18',label:'Sunday',condition:'Clear',high:55,low:45,rainLikelihood:{value:0}}],
  metricForecasts:{series:Object.fromEntries(['temperature','wind'].map(key=>[key,hours.map(row=>({time:row.time,value:row[key]}))]))}};
}

test('car wash current date temperature, wind and rain exclude tomorrow morning',()=>{
 const summary=carWashSummary(fixture(),now);
 assert.equal(summary.chance,16);assert.equal(summary.facts.temperature,'66°–70°');assert.equal(summary.facts.wind,'5 mph');
 assert.equal(summary.days[0].low,66);assert.equal(summary.days[0].high,70);assert.equal(summary.days[0].condition,'Clear');
 assert.equal(summary.days[1].chance,95);assert.equal(summary.days[1].high,95);
 assert.match(summary.reason,/next three days: 95% chance Saturday/);
 assert.doesNotMatch(carWashHTML(summary).match(/<article class="car-wash-day"[\s\S]*?<\/article>/)?.[0]||'',/sky-rain|sky-lightning/);
});

test('local outlook keeps 95% morning rain and its temperatures under tomorrow',()=>{
 const details=forecastOutlookDetails(fixture(),now),today=details.nearTerm.split('\n')[0],tomorrow=details.nearTerm.split('\n')[1];
 assert.match(today,/Today, through midnight: Clear\. High near 70°, low around 66°\. Only a small rain chance: 16%/);
 assert.doesNotMatch(today,/95%|Thunder|10°|50°/);
 assert.match(tomorrow,/Saturday: Rain\. High near 95°, low around 50°\. Rain chance: 95%/);
 assert.doesNotMatch(details.nearTerm,/Tonight:/);
});

test('daily row wind and gust range stops at the clicked date midnight',()=>{
 const f=fixture(),daily={innerHTML:''},previousDocument=globalThis.document,previousNow=Date.now;
 f.metricForecasts.series.gust=f.hours.map(row=>({time:row.time,value:row.wind+5}));
 globalThis.document={getElementById:id=>id==='daily'?daily:null};Date.now=()=>now;
 try{
  renderDailyRows(f,()=>'<svg></svg>');
  const first=daily.innerHTML.match(/<button class="day-row [\s\S]*?<\/button>/)?.[0]||'';
  assert.match(first,/Wind 5 mph/);assert.doesNotMatch(first,/Wind 5–100|gust 105|G105/);
 }finally{Date.now=previousNow;globalThis.document=previousDocument;}
});

test('the legacy daily row drops an ended cached peak to the remaining same-date hours',()=>{
 const f=fixture(),daily={innerHTML:''},previousDocument=globalThis.document,previousNow=Date.now;
 f.days[0].rainLikelihood.value=95;
 f.days[0].rainLikelihood.window.start=iso(Date.parse('2026-10-16T22:00:00Z'));
 const elapsed={...f.hours[0],time:'2026-10-16T22:00:00Z',end:'2026-10-16T23:00:00Z',rainLikelihood:{value:95}};
 f.hours.unshift(elapsed);f.rainTimeline=f.hours;
 globalThis.document={getElementById:id=>id==='daily'?daily:null};Date.now=()=>now;
 try{
  renderDailyRows(f,()=>'<svg></svg>');
  const first=daily.innerHTML.match(/<button class="day-row [\s\S]*?<\/button>/)?.[0]||'';
  assert.match(first,/Rain chance 16 percent/);assert.doesNotMatch(first,/95 percent|95%/);
 }finally{Date.now=previousNow;globalThis.document=previousDocument;}
});
