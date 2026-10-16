import test from 'node:test';
import assert from 'node:assert/strict';
import {buildForecast,localTime,nextDate,dateKey} from '../src/weatherFusion.js';
import {validateSnapshot} from '../src/weatherFusionDirect.js';
import {testInputs,snapshot} from './weatherFusion.fixtures.js';
import {dayGraphPoints} from '../public/weather-fusion/day-graph.js';
import {dailyForecastReadings} from '../public/weather-fusion/seven-day.js';
import {forecastPeriodSummary} from '../public/weather-fusion/forecast-story.js';
import {forecastProseConflict,pointForecastOverview} from '../public/weather-fusion/forecast-consistency.js';
import {danTakeDisplay} from '../public/weather-fusion/dans-summary.js';
import {modelExplanationView} from '../public/weather-fusion/model-explanation.js';
const H=3600000,zone='America/New_York',now=testInputs.now,iso=t=>new Date(t).toISOString();
function forecast(){
 const input=structuredClone(testInputs),tomorrow=nextDate(dateKey(now,zone)),target=localTime(tomorrow,5,zone);
 input.hourly.periods=Array.from({length:180},(_,i)=>({...input.hourly.periods[0],startTime:iso(now+i*H),endTime:iso(now+(i+1)*H),probabilityOfPrecipitation:{value:now+i*H<localTime(tomorrow,0,zone)?80:53}}));
 input.models=Object.fromEntries(['hrrr','ecmwf','nbm'].map(id=>{
  const raw=snapshot(id);raw.points[0].precipitationIntervals.forEach(r=>{r.value=id!=='hrrr'&&r.start*1000===target?.02:0;});
  return [id,validateSnapshot(raw,id,input.location,now).value];
 }));
 return buildForecast(input);
}
test('93% at 5 AM tomorrow cannot inflate a 32% Today tile or its detail graph',()=>{
 const f=forecast(),day=f.days[0],next=f.days[1];
 assert.equal(day.rainLikelihood.value,32);
 assert.equal(next.rainLikelihood.value,93);
 assert.equal(dateKey(Date.parse(next.rainLikelihood.peakTime),zone),next.date);
 for(const d of f.days.slice(0,2)){
  assert.equal(dateKey(Date.parse(d.rainLikelihood.window.start),zone),d.date);
  assert.equal(Date.parse(d.rainLikelihood.window.end),localTime(nextDate(d.date),0,zone));
 }
 const points=dayGraphPoints(f,0,false,now),today=dailyForecastReadings(f,now)[0];
 assert.ok(points.every(p=>dateKey(Date.parse(p.time),zone)===day.date));
 assert.equal(Math.max(...points.map(p=>p.rainChance)),today.pop);
 assert.equal(today.pop,32);
 assert.equal(forecastPeriodSummary(f,0,'overall',now).chance,32);
 const view=modelExplanationView(f,{now});
 assert.equal(view.phase,'overall');
});
test('the daily precipitation amount is the sum of matching calendar hours, not tomorrow morning',()=>{
 const f=forecast();
 for(const [i,d] of f.days.slice(0,2).entries()){
  const start=Math.max(now,localTime(d.date,0,zone)),end=localTime(nextDate(d.date),0,zone);
  const rows=f.rainTimeline.filter(r=>Date.parse(r.time)<end&&Date.parse(r.end)>start);
  const total=rows.reduce((sum,r)=>sum+r.precipitation*Math.max(0,Math.min(end,Date.parse(r.end))-Math.max(start,Date.parse(r.time)))/H,0);
  assert.ok(Math.abs(d.qpf-total)<.000051);
  assert.ok(Math.abs(dailyForecastReadings(f,now)[i].amount-total)<1e-10);
 }
});
test('Tonight can explicitly include the next morning, while the labeled day stays separate',()=>{
 const f=forecast(),day=f.days[0];
 assert.equal(day.popNightLikelihood.value,93);
 const points=dayGraphPoints(f,0,true,now);
 assert.equal(Math.max(...points.map(p=>p.rainChance)),93);
 assert.ok(points.some(p=>dateKey(Date.parse(p.time),zone)!==day.date));
});
test('ongoing peak hour remains in the graph when forecast assembly is between hours',()=>{
 const f=forecast(),minuteNow=now+19*60000;
 f.days[0].rainLikelihood.window.start=iso(minuteNow);
 assert.equal(dayGraphPoints(f,0,false,minuteNow)[0].time,iso(now));
});
function weekend(){
 const base=Date.parse('2026-10-16T08:19:00Z');
 const rainTimeline=Array.from({length:80},(_,i)=>{const t=Math.floor(base/H)*H+i*H,date=dateKey(t,zone),wet=date==='2026-10-17';return {time:iso(t),end:iso(t+H),rainLikelihood:{value:wet?93:10},precipitation:wet?.025:0};});
 const days=['2026-10-16','2026-10-17','2026-10-18'].map((date,i)=>({date,label:['Today','Saturday','Sunday'][i],rainLikelihood:{value:i===1?93:10}}));
 return {location:{timeZone:zone},signature:'current-forecast',days,rainTimeline};
}
const friday=Date.parse('2026-10-16T08:19:00Z');
test('dry-weekend prose is rejected when the actual Saturday forecast is wet',()=>{
 const f=weekend();
 for(const text of ['The weekend will be dry.','Dry conditions continue through Saturday and Sunday.','Saturday will stay rain-free.','No rain this weekend.','The weekend will be cooler. It will be dry.'])assert.equal(forecastProseConflict(text,f,friday)?.kind,'dry-during-forecast-rain',text);
 assert.equal(forecastProseConflict('Dry air may cause static indoors.',f,friday),null);
 assert.equal(forecastProseConflict('Rain Saturday, but Sunday will be dry.',f,friday),null);
 assert.equal(forecastProseConflict('Saturday will be wet and dry weather returns Sunday.',f,friday),null);
 assert.equal(forecastProseConflict('Rain Saturday, dry Sunday.',f,friday),null);
});
test('one rainy day cannot be rewritten as rain throughout the entire weekend',()=>{
 assert.equal(forecastProseConflict('Rain throughout the weekend.',weekend(),friday)?.kind,'rain-throughout-dry-period');
});
test('a conflicting summary is replaced with the same point rain chances used by the tiles',()=>{
 const f=weekend(),briefing={signature:f.signature,danSummary:'The weekend will be dry.'};
 const text=danTakeDisplay(briefing,f,friday);
 assert.match(text,/Saturday: rain likely \(93% peak hourly chance\)/);
 assert.match(text,/Sunday: a low rain chance \(10% peak hourly chance\)/);
 assert.doesNotMatch(text,/weekend will be dry/);
 assert.equal(text,pointForecastOverview(f,friday));
});

test('public Weather Take always describes the current point blend rather than regional or AI generalizations',()=>{
 const f={...weekend(),rainPeriodVersion:'local-calendar-v1'};
 f.days[0].high=81;
 const text=danTakeDisplay({signature:f.signature,danSummary:'Record heat today. A pleasant weekend is ahead.'},f,friday);
 assert.match(text,/high 81°/);
 assert.match(text,/Saturday: rain likely/);
 assert.doesNotMatch(text,/Record heat|pleasant weekend/);
});
