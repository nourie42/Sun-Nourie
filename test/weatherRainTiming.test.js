import test from 'node:test';
import assert from 'node:assert/strict';
import {rainTiming,rainTimingHTML} from '../public/weather-fusion/rain-timing.js';
import {carWashSummary} from '../public/weather-fusion/car-wash.js';
import {rainTrendSample} from '../public/weather-fusion/rain-trend.js';
import {dayGraphPoints} from '../public/weather-fusion/day-graph.js';
import {todayForecastHTML} from '../public/weather-fusion/today-card.js';
import {dailyForecastReadings,sevenDayCardHTML} from '../public/weather-fusion/seven-day.js';
const H=3600000,now=Date.parse('2026-10-16T22:30Z'),end=Date.parse('2026-10-17T10:00Z');
function fixture(){
 const timeline=Array.from({length:12},(_,i)=>({time:new Date(Date.parse('2026-10-16T22:00Z')+i*H).toISOString(),end:new Date(Date.parse('2026-10-16T23:00Z')+i*H).toISOString(),rainLikelihood:{value:i<6?16:i===11?95:30},precipitation:0}));
 const likelihood=(value,finish)=>({aggregation:'maximum-hourly',value,window:{start:new Date(now).toISOString(),end:new Date(finish).toISOString()},coverage:{complete:true}});
 return {location:{timeZone:'America/New_York',latitude:35.7871,longitude:-78.481},current:{},days:[{date:'2026-10-16',label:'Today',low:58,high:86,condition:'Sunny',nightCondition:'Chance Rain',rainLikelihood:likelihood(16,Date.parse('2026-10-17T04:00Z')),popNightLikelihood:likelihood(95,end)}],rainTimeline:timeline,hours:timeline,metricForecasts:{series:{}}};
}
test('16% this evening and 95% at 5 AM are explicitly different, matching the overnight graph',()=>{
 const f=fixture(),timing=rainTiming(f,0,true,now),points=dayGraphPoints(f,0,true,now);
 assert.equal(timing.beforeMidnight.value,16);assert.equal(timing.afterMidnight.value,95);
 assert.equal(timing.value,95);assert.equal(timing.peakLabel,'Sat 5 AM');
 assert.equal(Math.max(...points.map(p=>p.rainChance)),timing.value);
 assert.match(rainTimingHTML(timing),/Before midnight.*16%.*Midnight–6 AM.*95%.*Sat 5 AM/s);
 const html=todayForecastHTML(f,now);
 assert.match(html,/today-rain-peak">Peak Sat 5 AM/);assert.match(html,/Before midnight.*16%.*Midnight–6 AM.*95%/s);
 const row=dailyForecastReadings(f,now)[0];assert.equal(row.pop,95);assert.equal(row.rainPeak,'Sat 5 AM');assert.match(sevenDayCardHTML(row),/seven-day-rain-peak" title="Peak Sat 5 AM">5AM/);
});
test('a peak before midnight is not mislabeled as a tomorrow-morning peak',()=>{
 const f=fixture();f.rainTimeline[2].rainLikelihood.value=98;const timing=rainTiming(f,0,true,now);
 assert.equal(timing.value,98);assert.equal(timing.peakLabel,'Fri 8 PM');assert.equal(timing.beforeMidnight.value,98);assert.equal(timing.afterMidnight.value,95);
});
test('missing overnight hours remain unavailable instead of appearing dry',()=>{
 const f=fixture();f.rainTimeline[8].rainLikelihood.value=null;const timing=rainTiming(f,0,true,now);
 assert.equal(timing.value,null);assert.equal(timing.beforeMidnight.value,16);assert.equal(timing.afterMidnight.value,null);assert.match(rainTimingHTML(timing),/Midnight–6 AM.*Unavailable/s);
});
test('gaps cannot manufacture a complete overnight chance',()=>{
 const f=fixture();f.rainTimeline.splice(8,1);const timing=rainTiming(f,0,true,now);
 assert.equal(timing.afterMidnight.value,null);
});
test('an expired peak hour cannot appear as a remaining forecast',()=>{
 const f=fixture();f.rainTimeline[0].rainLikelihood.value=100;const later=Date.parse('2026-10-17T00:15Z');const timing=rainTiming(f,0,true,later);
 assert.equal(timing.value,95);assert.equal(timing.peakLabel,'Sat 5 AM');
});
test('noncanonical legacy percentages do not get invented hourly timing',()=>{
 const f=fixture();f.days[0].popNightLikelihood={value:95};assert.equal(rainTiming(f,0,true,now),null);assert.equal(rainTimingHTML(null),'');
});

test('a cached 95% peak that has ended drops to the same 16% remaining hours in every primary view',()=>{
 const f=fixture(),later=Date.parse('2026-10-17T00:15Z');
 f.rainTimeline.forEach(row=>row.rainLikelihood.value=16);f.rainTimeline[0].rainLikelihood.value=95;
 const timing=rainTiming(f,0,true,later),points=dayGraphPoints(f,0,true,later);
 assert.equal(timing.value,16);assert.equal(Math.max(...points.map(p=>p.rainChance)),16);
 assert.equal(dailyForecastReadings(f,later)[0].pop,16);
 assert.match(todayForecastHTML(f,later),/<strong>16%<\/strong>/);
 assert.doesNotMatch(todayForecastHTML(f,later),/<strong>95%<\/strong>/);
});

test('an ended canonical window stays unavailable instead of falling back to its old percentage',()=>{
 const f=fixture();const timing=rainTiming(f,0,true,end+H);assert.equal(timing.value,null);assert.equal(timing.peakLabel,'');
});
test('car wash and rain-change history cannot retain an elapsed 95% peak',()=>{
 const f=fixture(),later=Date.parse('2026-10-17T00:15Z');f.assembledAt=new Date(now).toISOString();
 f.rainTimeline.forEach(row=>row.rainLikelihood.value=16);f.rainTimeline[0].rainLikelihood.value=95;
 f.days[0].rainLikelihood.value=95;
 f.days.push({date:'2026-10-17',pop:0,qpf:0},{date:'2026-10-18',pop:0,qpf:0});
 assert.equal(carWashSummary(f,later).chance,16);assert.equal(carWashSummary(f,later).decisions[0].chance,16);
 assert.equal(rainTrendSample(f,later).chance,16);assert.equal(f.days[0].rainLikelihood.value,95,'the source snapshot is not mutated');
});
