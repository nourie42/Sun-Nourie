import test from 'node:test';
import assert from 'node:assert/strict';
import {dayGraphPoints,dayGraphHTML,installDayGraph} from '../public/weather-fusion/day-graph.js';
import {hourlyRainHTML} from '../public/weather-fusion/weather-display.js';

const H=3600000,now=Date.parse('2026-10-14T16:00:00Z');
const time=offset=>new Date(now+offset*H).toISOString();
const fixture=()=>({location:{timeZone:'America/New_York'},days:[{date:'2026-10-14',highWindow:{start:time(0)},lowWindow:{end:time(3)}}],hours:[],metricForecasts:{series:{}}});

test('day rain graph uses the same published hourly likelihood as the hourly cards',()=>{
 const f=fixture();
 f.hours=[{time:time(0),pop:80,rainLikelihood:{value:38,source:'NWS and model guidance'}},{time:time(1),pop:70,rainLikelihood:{value:0}},{time:time(2),pop:58}];
 const points=dayGraphPoints(f,0,false,now);
 assert.deepEqual(points.map(p=>p.rainChance),[38,0,58]);
 for(let i=0;i<points.length;i++)assert.match(hourlyRainHTML(f.hours[i]),new RegExp(`>${points[i].rainChance}%<`));
 assert.equal(points[0].rainChanceSource,'NWS and model guidance');
 assert.equal(points[2].rainChanceSource,'NWS hourly forecast');
});

test('rain stays missing for explicit blend gaps, invalid probabilities and deterministic-only amounts',()=>{
 const f=fixture();f.days[0].lowWindow.end=time(6);f.days[0].pop=90;
 f.hours=[{time:time(0),pop:80,rainLikelihood:{value:null}},{time:time(1),pop:85,precipitation:1,rainLikelihood:{value:101}},{time:time(2),pop:NaN},{time:time(3),precipitation:1},{time:time(5),rainLikelihood:{value:60},end:time(7)}];
 assert.deepEqual(dayGraphPoints(f,0,false,now).map(p=>p.rainChance),[null,null,null,null,null,null]);
 const html=dayGraphHTML(f,0,false,now);
 assert.match(html,/data-series="rainChance" d="\s*"/);
 assert.doesNotMatch(html,/NaN|undefined/);
});

test('extended rain timeline supplies matching local-day hours beyond the 48-hour strip',()=>{
 const f=fixture();f.days.push({date:'2026-10-17',highWindow:{start:time(67)},lowWindow:{end:time(70)}});
 f.hours=[{time:time(67),pop:99}];
 f.rainTimeline=[{time:'2026-10-17T07:00:00-04:00',end:time(68),rainLikelihood:{value:29}},{time:time(68),end:time(69),pop:90,rainLikelihood:{value:null}},{time:time(70),end:time(71),rainLikelihood:{value:100}}];
 const points=dayGraphPoints(f,1,false,now);
 assert.deepEqual(points.map(p=>p.time),[time(67),time(68),time(69)]);
 assert.deepEqual(points.map(p=>p.rainChance),[29,null,null]);
 f.rainTimeline=[];
 assert.equal(dayGraphPoints(f,1,false,now)[0].rainChance,null,'an empty canonical timeline never falls back to a conflicting raw probability');
});

test('rain graph uses a separate percent scale and leaves gaps between missing hours',()=>{
 const f=fixture();f.hours=[{time:time(0),pop:0},{time:time(2),pop:100}];
 const html=dayGraphHTML(f,0,false,now);
 assert.match(html,/Rain chance uses its own zero to 100 percent scale below/);
 assert.match(html,/data-series="rainChance" d="M40\.0,265\.0  M460\.0,215\.0"/);
 assert.match(html,/all five graph values/);
});

test('scrubbing updates rain percentage, missing state, time and shared cursor at the same hour',()=>{
 const f=fixture();f.hours=[{time:time(0),rainLikelihood:{value:38,source:'NWS & model guidance'}},{time:time(1),rainLikelihood:{value:null}},{time:time(2),pop:58}];
 const events=new Map(),input={value:'0',attrs:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){events.set(k,v);}};
 const readout={innerHTML:''},stamp={textContent:''},cursor={attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
 const svg={addEventListener(){},getBoundingClientRect:()=>({left:0,width:500})};
 const root={querySelector:selector=>({'#day-graph-hour':input,'.day-graph svg':svg,'.day-graph-time':stamp,'.day-graph-readout':readout,'.day-graph-cursor':cursor}[selector])};
 installDayGraph(root,f,0,false,now);
 assert.match(readout.innerHTML,/data-readout="rainChance" title="NWS &amp; model guidance"><span>Chance of rain<\/span><strong>38%<\/strong>/);
 assert.equal((readout.innerHTML.match(/data-readout=/g)||[]).length,5);
 input.value='1';events.get('input')();
 assert.match(readout.innerHTML,/data-readout="rainChance"><span>Chance of rain<\/span><strong>—<\/strong><small>Unavailable<\/small>/);
 assert.equal(stamp.textContent,'Wed 1:00 PM');
 assert.equal(cursor.attrs.d,'M250 25 V275');
 assert.equal(input.attrs['aria-valuetext'],stamp.textContent);
 input.value='2';events.get('input')();
 assert.match(readout.innerHTML,/data-readout="rainChance" title="NWS hourly forecast"><span>Chance of rain<\/span><strong>58%<\/strong>/);
});
