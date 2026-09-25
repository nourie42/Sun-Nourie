import test from 'node:test';import assert from 'node:assert/strict';
import {weatherChangeMessages} from '../public/weather-fusion/weather-changes.js';
import {withoutAviation} from '../src/weatherFusion.js';
const now=Date.parse('2026-09-25T10:00Z');
function input(delta=21){const days=Array.from({length:5},(_,i)=>({date:'2026-09-'+(25+i),pop:80,qpf:.3,confidence:{key:'moderate',label:'Moderate'}}));
const series={temperature:[],dewpoint:[]};
for(let i=0;i<5;i++)for(let h=7;h<19;h++)for(const key of Object.keys(series))series[key].push({time:days[i].date+'T'+String(h).padStart(2,'0')+':00:00Z',value:50+(i===4?delta:0)});
return {location:{timeZone:'UTC'},days,metricForecasts:{series}};}
test('strict five-day temperature and dewpoint threshold uses daytime hourly averages',()=>{assert.equal(weatherChangeMessages(input(20),now).length,0);assert.equal(weatherChangeMessages(input(),now).length,2);assert.match(weatherChangeMessages(input(-21),now).join(' '),/drier conditions/);});
test('continued rain is not a large weather change',()=>{assert.doesNotMatch(weatherChangeMessages(input(),now).join(' '),/More rain|Rain returns/);});
test('aviation is excluded while later public forecast sections survive',()=>{const text='.SYNOPSIS...\nSunny.\n.AVIATION /12Z/...\nIFR at terminals.\n&&\n.LONG TERM...\nRain Sunday.';const clean=withoutAviation(text);assert.doesNotMatch(clean,/IFR|AVIATION/);assert.match(clean,/Sunny|Rain Sunday/);});
