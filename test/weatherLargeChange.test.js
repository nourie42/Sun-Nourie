import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherChangeMessages,WEATHER_CHANGE_TITLE} from '../public/weather-fusion/weather-changes.js';
const now=Date.parse('2026-09-25T06:00Z');
function input(values=[60,60,60,60,60]){
 const days=values.map((v,i)=>({date:`2026-09-${25+i}`,pop:0,qpf:0,confidence:{key:'moderate'}}));
 const series={temperature:[],dewpoint:[]};
 values.forEach((v,i)=>{for(let h=7;h<19;h++)for(const key of Object.keys(series))series[key].push({time:`${days[i].date}T${h.toString().padStart(2,'0')}:00:00Z`,value:v});});
 return {location:{timeZone:'UTC'},days,metricForecasts:{series}};
}
const rain=d=>weatherChangeMessages(d,now).filter(s=>s.startsWith('Rain returns'));
test('approved title and no banner for unchanged weather',()=>{assert.equal(WEATHER_CHANGE_TITLE,'Large weather change alert');assert.deepEqual(weatherChangeMessages(input(),now),[]);});
test('continued rain never counts as a dry-to-wet change',()=>{const d=input();d.days.forEach(x=>Object.assign(x,{pop:90,qpf:.4}));assert.deepEqual(rain(d),[]);});
test('two low-rain forecast periods followed by qualifying rain give exact forecast values',()=>{const d=input();Object.assign(d.days[2],{pop:85,qpf:.4});assert.deepEqual(rain(d),['Rain returns Sunday after two low-rain forecast periods from now: 85% chance, with 0.4 inches expected and moderate confidence.']);});
test('rain threshold boundaries, missing data and low confidence do not alert',()=>{
 for(const change of [{pop:75},{qpf:.25},{pop:null},{qpf:null},{confidence:{key:'low'}}]){const d=input();Object.assign(d.days[2],{pop:85,qpf:.4},change);assert.deepEqual(rain(d),[]);}
 for(const change of [{qpf:null},{qpf:.01},{pop:null},{pop:80}]){const d=input();Object.assign(d.days[2],{pop:85,qpf:.4});Object.assign(d.days[0],change);assert.deepEqual(rain(d),[]);}
});
test('dry days must be consecutive and immediately before rain',()=>{const d=input();Object.assign(d.days[2],{pop:85,qpf:.4});d.days.splice(1,1);assert.deepEqual(rain(d),[]);});
test('20F exactly does not alert; rises and falls greater than 20F do',()=>{
 assert.deepEqual(weatherChangeMessages(input([60,60,60,60,80]),now),[]);
 assert.equal(weatherChangeMessages(input([60,60,60,60,81]),now).length,2);
 const cold=weatherChangeMessages(input([60,60,60,60,39]),now).join(' ');assert.match(cold,/colder/);assert.match(cold,/less humid/);
});
test('changes between later days count but sixth day does not',()=>{
 assert.equal(weatherChangeMessages(input([60,50,60,71,60]),now).length,2);
 assert.deepEqual(weatherChangeMessages(input([60,60,60,60,60,90]),now),[]);
});
test('missing hourly data cannot produce a temperature or dewpoint alert',()=>{const d=input([60,60,60,60,90]);d.metricForecasts.series={};assert.deepEqual(weatherChangeMessages(d,now),[]);});

test('falling dew points with three rainy days cannot imply rain-free weather',()=>{
 const d=input([65,44,43,43,43]);
 d.days.slice(0,3).forEach(day=>Object.assign(day,{pop:90,qpf:.4}));
 const text=weatherChangeMessages(d,now).find(s=>s.includes('humid'));
 assert.match(text,/air will feel less humid/);
 assert.match(text,/Rain is still possible during that period/);
 assert.doesNotMatch(text,/drier conditions|dry weather|dry stretch/);
});
test('a rise in dew point describes a relative change without claiming high humidity',()=>{
 const d=input([10,32,32,32,32]);
 const text=weatherChangeMessages(d,now).find(s=>s.includes('humid'));
 assert.match(text,/more humid/);
 assert.doesNotMatch(text,/high humidity|Rain is still/);
});
