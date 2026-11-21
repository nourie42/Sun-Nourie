import test from 'node:test';
import assert from 'node:assert/strict';
import {outlookItems} from '../public/weather-fusion/outlook-panel.js';
const now=Date.parse('2026-11-21T15:00:00Z'),empty={rain:[],perfect:[],timeZone:'America/New_York'};
const quiet=()=>({location:{timeZone:'America/New_York'},days:[],riskOutlooks:[]});
test('quiet weather does not invent flood, rain, change or perfect-weather alerts',()=>{assert.deepEqual(outlookItems(quiet(),now,empty),[]);});
test('only applicable, unexpired risk outlooks become risk buttons',()=>{
 const f=quiet();f.riskOutlooks=[{id:'old',kind:'wpc',level:'High',expires:new Date(now-1).toISOString()},{id:'current',kind:'wpc',level:'Marginal',title:'Marginal risk of flooding rain today',expires:new Date(now+3600000).toISOString()}];
 const items=outlookItems(f,now,empty);assert.equal(items.length,1);assert.equal(items[0].label,'Flood Risk');assert.equal(items[0].preview,'Marginal');assert.equal(items[0].risk.id,'current');
});
test('rain peak and perfect-weather timing come directly from qualifying windows',()=>{
 const view={...empty,rain:[{hours:[{rainChance:38},{rainChance:71},{rainChance:null}]}],perfect:[{start:now+3600000,hours:[]}]};
 const items=outlookItems(quiet(),now,view);assert.deepEqual(items.map(i=>i.kind),['rain','perfect']);assert.equal(items[0].preview,'Peak 71%');assert.equal(items[1].preview,'In 1 hour');assert.equal(items[0].view,view);
});
test('removing qualifying windows removes their buttons',()=>{
 assert.equal(outlookItems(quiet(),now,{...empty,perfect:[{start:now,hours:[]}]}).length,1);
 assert.equal(outlookItems(quiet(),now,empty).length,0);
});
test('change alerts require the existing complete-day change calculation',()=>{
 const f=quiet();f.days=[{date:'2026-11-21',pop:0,qpf:0},{date:'2026-11-22',pop:0,qpf:0}];
 const dewpoint=[];for(let d=0;d<2;d++)for(let h=0;h<12;h++)dewpoint.push({time:new Date(Date.parse('2026-11-21T12:00:00Z')+(d*24+h)*3600000).toISOString(),value:d?40:70});
 f.metricForecasts={series:{dewpoint}};
 const items=outlookItems(f,now,empty);assert.equal(items.length,1);assert.equal(items[0].kind,'change');assert.equal(items[0].preview,'Air feels less humid');
 f.metricForecasts.series.dewpoint.pop();assert.equal(outlookItems(f,now,empty).length,0,'Incomplete data must not trigger a change alert');
});
test('stale forecasts do not advertise current rain, change or perfect-weather alerts',()=>{
 const view={...empty,snapshotFreshness:{status:'stale'},rain:[{hours:[{rainChance:90}]}],perfect:[{start:now,hours:[]}]};
 assert.deepEqual(outlookItems(quiet(),now,view),[]);
});
