import test from 'node:test';
import assert from 'node:assert/strict';
import {rainTiming,rainTimingHTML} from '../public/weather-fusion/rain-timing.js';
import {carWashSummary} from '../public/weather-fusion/car-wash.js';
import {rainTrendSample} from '../public/weather-fusion/rain-trend.js';
import {dayGraphPoints} from '../public/weather-fusion/day-graph.js';
import {todayForecastHTML} from '../public/weather-fusion/today-card.js';
import {dailyForecastReadings,sevenDayCardHTML} from '../public/weather-fusion/seven-day.js';
const H=3600000,now=Date.parse('2026-10-16T22:30Z'),midnight=Date.parse('2026-10-17T04:00Z'),end=Date.parse('2026-10-18T04:00Z');
const iso=time=>new Date(time).toISOString();
function fixture(){
 const start=Date.parse('2026-10-16T21:00Z');
 const timeline=Array.from({length:31},(_,i)=>{const time=start+i*H;return {time:iso(time),end:iso(time+H),rainLikelihood:{value:time<midnight?16:time===Date.parse('2026-10-17T09:00Z')?95:30},precipitation:time<midnight?.01:.02};});
 const likelihood=(value,start,finish)=>({aggregation:'maximum-hourly',value,window:{start:iso(start),end:iso(finish)},coverage:{complete:true}});
 const hours=timeline.map(row=>({...row,temperature:Date.parse(row.time)<midnight?72-(Date.parse(row.time)-start)/H:41,condition:'Partly Cloudy'}));
 return {location:{timeZone:'America/New_York',latitude:35.7871,longitude:-78.481},current:{},days:[
  {date:'2026-10-16',label:'Today',low:10,high:100,condition:'Sunny',nightCondition:'Chance Rain',rainLikelihood:likelihood(16,start,midnight),popNightLikelihood:likelihood(95,now,Date.parse('2026-10-17T10:00Z'))},
  {date:'2026-10-17',label:'Sat',low:41,high:41,condition:'Rain',rainLikelihood:likelihood(95,midnight,end)},
 ],rainTimeline:timeline,hours,metricForecasts:{series:{temperature:hours.map(row=>({time:row.time,value:row.temperature}))}}};
}
test('16% today and 95% at 5 AM tomorrow stay on separate calendar cards and graphs',()=>{
 const f=fixture(),timing=rainTiming(f,0,true,now),points=dayGraphPoints(f,0,true,now);
 assert.equal(timing.value,16);assert.equal(timing.peakLabel,'Fri 6 PM');assert.equal(timing.split,false);
 assert.equal(timing.afterMidnight,null);assert.equal(timing.beforeMidnight,null);
 assert.equal(Math.max(...points.map(p=>p.rainChance)),16);
 assert.ok(points.every(p=>Date.parse(p.time)<midnight));
 const html=todayForecastHTML(f,now);
 assert.match(html,/<strong>16%<\/strong>/);assert.doesNotMatch(html,/Sat 5 AM|95%|Midnight–6 AM|Before midnight/);
 const [today,tomorrow]=dailyForecastReadings(f,now);
 assert.equal(today.pop,16);assert.equal(today.rainPeak,'');assert.equal(today.high,71);assert.equal(today.low,66);
 assert.equal(tomorrow.pop,95);assert.match(sevenDayCardHTML(tomorrow),/95%/);
 const nextPoints=dayGraphPoints(f,1,false,now);
 assert.equal(Math.max(...nextPoints.map(p=>p.rainChance)),95);
 assert.ok(nextPoints.every(p=>Date.parse(p.time)>=midnight&&Date.parse(p.time)<end));
 assert.equal(nextPoints.find(p=>p.rainChance===95).time,'2026-10-17T09:00:00.000Z');
});
test('same-date peak timing remains correct without a next-morning split',()=>{
 const f=fixture();f.rainTimeline[3].rainLikelihood.value=98;const timing=rainTiming(f,0,true,now);
 assert.equal(timing.value,98);assert.equal(timing.peakLabel,'Fri 8 PM');assert.equal(timing.split,false);
 assert.doesNotMatch(rainTimingHTML(timing),/Sat|Midnight|Before midnight/);
});
test('missing tomorrow hours do not corrupt today, while tomorrow remains unavailable',()=>{
 const f=fixture();f.rainTimeline.find(row=>row.time==='2026-10-17T06:00:00.000Z').rainLikelihood.value=null;
 assert.equal(rainTiming(f,0,true,now).value,16);
 assert.equal(rainTiming(f,1,false,now).value,null);
 assert.equal(dailyForecastReadings(f,now)[1].pop,null);
});
test('a gap in remaining calendar hours cannot manufacture a complete chance',()=>{
 const f=fixture();f.rainTimeline.splice(3,1);assert.equal(rainTiming(f,0,true,now).value,null);
});
test('an elapsed peak hour cannot appear as a remaining calendar forecast',()=>{
 const f=fixture();f.rainTimeline[1].rainLikelihood.value=100;const later=Date.parse('2026-10-17T00:15Z'),timing=rainTiming(f,0,true,later);
 assert.equal(timing.value,16);assert.equal(timing.peakLabel,'Fri 8 PM');
});
test('noncanonical legacy percentages do not get invented hourly timing',()=>{
 const f=fixture();f.days[0].rainLikelihood={value:16};assert.equal(rainTiming(f,0,true,now),null);assert.equal(rainTimingHTML(null),'');
});
test('a cached 95% elapsed peak drops to 16% in every primary calendar view',()=>{
 const f=fixture(),later=Date.parse('2026-10-17T00:15Z');
 f.rainTimeline[1].rainLikelihood.value=95;f.days[0].rainLikelihood.value=95;
 const timing=rainTiming(f,0,true,later),points=dayGraphPoints(f,0,true,later);
 assert.equal(timing.value,16);assert.equal(Math.max(...points.map(p=>p.rainChance)),16);
 assert.equal(dailyForecastReadings(f,later)[0].pop,16);
 assert.match(todayForecastHTML(f,later),/<strong>16%<\/strong>/);
 assert.doesNotMatch(todayForecastHTML(f,later),/<strong>95%<\/strong>/);
});
test('today ends at local midnight even when later hours exist in the cached snapshot',()=>{
 const f=fixture(),timing=rainTiming(f,0,true,midnight);
 assert.equal(timing.value,null);assert.equal(timing.peakLabel,'');
 assert.deepEqual(dayGraphPoints(f,0,true,midnight),[]);
});
test('car wash and rain-change history cannot retain an elapsed peak or borrow tomorrow rain',()=>{
 const f=fixture(),later=Date.parse('2026-10-17T00:15Z');f.assembledAt=iso(now);
 f.rainTimeline[1].rainLikelihood.value=95;f.days[0].rainLikelihood.value=95;
 f.days.push({date:'2026-10-18',pop:0,qpf:0});
 assert.equal(carWashSummary(f,later).chance,16);assert.equal(carWashSummary(f,later).decisions[0].chance,16);
 assert.equal(rainTrendSample(f,later).chance,16);assert.equal(f.days[0].rainLikelihood.value,95,'the source snapshot is not mutated');
});
