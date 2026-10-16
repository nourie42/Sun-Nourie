import test from 'node:test';
import assert from 'node:assert/strict';
import {buildForecast,localTime,nextDate,dateKey} from '../src/weatherFusion.js';
import {validateSnapshot} from '../src/weatherFusionDirect.js';
import {testInputs,snapshot} from './weatherFusion.fixtures.js';
import {dayGraphPoints} from '../public/weather-fusion/day-graph.js';
import {dailyForecastReadings} from '../public/weather-fusion/seven-day.js';
import {forecastPeriodSummary} from '../public/weather-fusion/forecast-story.js';
import {forecastProseConflict} from '../public/weather-fusion/forecast-consistency.js';
import {danTakeDisplay} from '../public/weather-fusion/dans-summary.js';
import {modelExplanationView} from '../public/weather-fusion/model-explanation.js';
import {dailyDisplay} from '../public/weather-fusion/weather-math.js';
import {calendarDayWindow,calendarDayTemperatures,timeAt} from '../public/weather-fusion/calendar-day.js';
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
test('an evening graph cannot include tomorrow even when called with the legacy Tonight flag',()=>{
 const f=forecast(),day=f.days[0];
 assert.equal(day.popNightLikelihood.value,93);
 const points=dayGraphPoints(f,0,true,now);
 assert.equal(Math.max(...points.map(p=>p.rainChance)),32);
 assert.ok(points.every(p=>dateKey(Date.parse(p.time),zone)===day.date));
 assert.equal(Math.max(...dayGraphPoints(f,1,true,now).map(p=>p.rainChance)),93);
});
test('ongoing peak hour remains in the graph when forecast assembly is between hours',()=>{
 const f=forecast(),minuteNow=now+19*60000;
 f.days[0].rainLikelihood.window.start=iso(minuteNow);
 assert.equal(dayGraphPoints(f,0,false,minuteNow)[0].time,iso(now));
});
test('17:59, 18:00 and 23:30 retain the same date while tomorrow’s 5 AM peak stays tomorrow',()=>{
 const date='2026-10-16',next=nextDate(date);
 for(const timeZone of ['America/New_York','America/Chicago','America/Los_Angeles','UTC']){
  const start=timeAt(date,0,timeZone),midnight=timeAt(next,0,timeZone),end=timeAt(nextDate(next),0,timeZone);
  const timeline=Array.from({length:(end-start)/H},(_,i)=>{const time=start+i*H;return {time:iso(time),end:iso(time+H),rainLikelihood:{value:time<midnight?16:time===timeAt(next,5,timeZone)?95:30},precipitation:time<midnight?.01:.02};});
  const likelihood=(value,start,end)=>({aggregation:'maximum-hourly',value,window:{start:iso(start),end:iso(end)},coverage:{complete:true}});
  const f={location:{timeZone},current:{},rainTimeline:timeline,hours:timeline.map(row=>({...row,temperature:Date.parse(row.time)<midnight?70:40,condition:'Cloudy'})),days:[
   {date,label:'Today',condition:'Cloudy',rainLikelihood:likelihood(16,start,midnight),popNightLikelihood:likelihood(95,timeAt(date,18,timeZone),timeAt(next,6,timeZone))},
   {date:next,label:'Sat',condition:'Rain',rainLikelihood:likelihood(95,midnight,end)},
  ]};
  for(const [hour,minutes] of [[17,59],[18,0],[23,30]]){
   const clock=timeAt(date,hour,timeZone)+minutes*60000,display=dailyDisplay(f.days[0],0,clock,timeZone,f);
   const rows=dailyForecastReadings(f,clock),points=dayGraphPoints(f,0,true,clock);
   assert.equal(display.phase,'overall',`${timeZone} ${hour}:${minutes}`);assert.equal(display.tonight,false);
   assert.equal(display.night,hour>=18);assert.equal(rows[0].pop,16);assert.equal(rows[1].pop,95);
   assert.ok(points.length);assert.ok(points.every(point=>dateKey(Date.parse(point.time),timeZone)===date));
   assert.equal(Math.max(...points.map(point=>point.rainChance)),16);
   assert.ok(Math.abs(rows[0].amount-points.length*.01)<1e-12);
   assert.equal(rows[0].high,70);assert.equal(rows[0].low,70);
  }
 }
});
test('local midnight boundaries retain 23-hour and 25-hour dates across DST',()=>{
 for(const timeZone of ['America/New_York','America/Chicago','America/Los_Angeles']){
  for(const [date,hours] of [['2026-03-08',23],['2026-11-01',25]]){
   const window=calendarDayWindow({date},1,now,timeZone);
   assert.equal((window.end-window.start)/H,hours);
   assert.equal(dateKey(window.start,timeZone),date);assert.equal(dateKey(window.end,timeZone),nextDate(date));
   const f={location:{timeZone},days:[{}, {date,rainLikelihood:{aggregation:'maximum-hourly'}}],hours:Array.from({length:hours+1},(_,i)=>({time:iso(window.start+i*H),temperature:i===hours?-99:i}))};
   const temperatures=calendarDayTemperatures(f,1,now),points=dayGraphPoints(f,1,true,now);
   assert.equal(temperatures.low,0);assert.equal(temperatures.high,hours-1);assert.equal(points.length,hours);
   assert.ok(points.every(point=>dateKey(Date.parse(point.time),timeZone)===date));
  }
 }
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
function discussionForecast(){
 const f={...weekend(),rainPeriodVersion:'local-calendar-v1'};
 f.location={...f.location,office:'RAH',latitude:35.787,longitude:-78.4806};
 f.discussion={id:'test-discussion',office:'RAH',issuanceTime:'2026-10-16T07:29:00Z',text:'.SYNOPSIS...\nRain will arrive Saturday with much colder air. Sunday will be cooler with fewer showers.\n&&'};
 f.feeds=[{id:'afd',status:'ready'}];return f;
}
test('a conflicting dry-weekend AI summary falls back to the discussion, without a numerical forecast list',()=>{
 const f=discussionForecast(),briefing={signature:f.signature,danSummary:'The weekend will be dry.'};
 const text=danTakeDisplay(briefing,f,friday);
 assert.match(text,/Rain will arrive Saturday with much colder air/);
 assert.doesNotMatch(text,/weekend will be dry|%|peak hourly|Today:/);
});
test('Weather Take preserves a valid easy-language discussion summary when a numeric blend is present',()=>{
 const f=discussionForecast(),summary='Rain will arrive Saturday. Much cooler air follows.';
 const text=danTakeDisplay({signature:f.signature,mode:'ai',danSummary:summary},f,friday);
 assert.equal(text,summary);
 assert.doesNotMatch(text,/Today:|%|high 81/);
});

 test('discussion excerpts read as complete standalone paragraphs',()=>{
 const f=forecast();
 f.discussion={id:'grammar-afd',office:'RAH',issuanceTime:iso(now-H),text:'.SYNOPSIS...\nRecord heat today will be swept offshore by a strong cold front and following sharply cooler and wet conditions that will develop tonight into Sat. There is still some potential for patchy frost Sun morning and again Mon morning.\n&&\n.LONG TERM /SATURDAY THROUGH MONDAY/...\nHowever, a good bit of uncertainty remains about this low and its impacts for central NC.\n'};
 f.feeds.push({id:'afd',status:'ready'});
 const text=danTakeDisplay(null,f,now);
 assert.match(text,/cold front\. Much cooler, wet weather will follow/);
 assert.match(text,/frost Sunday morning and again Monday morning/);
 assert.match(text,/Some uncertainty remains about the low-pressure system and its effects on central NC/);
 assert.doesNotMatch(text,/However|this low|and following/);
 });
