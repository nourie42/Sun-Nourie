import test from 'node:test';
import assert from 'node:assert/strict';
import {CHANGES_VERSION,changeContext,validateChanges,activeChanges,changesText} from '../public/weather-fusion/forecast-changes.js';
import {tier3FeelsLike,thermalComfort} from '../public/weather-fusion/weather-math.js';
import {currentSample,forecastSample,hourlyDisplaySamples} from '../public/weather-fusion/weather-display.js';
import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
const now=Date.parse('2026-09-07T09:00Z'),location={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
const make=(text,issuanceTime='2026-09-07T07:00:00Z')=>({signature:'test',location,feeds:[{id:'afd',status:'ready'}],discussion:{id:'afd1',office:'RAH',issuanceTime,text,url:'https://api.weather.gov/products/afd1'}});
const source='.DISCUSSION...\nAs of 300 AM Monday...\n\nThere is uncertainty about the front moving through Friday vs Thursday night. Rainfall may be less widespread.';
const valid=data=>{const c=changeContext(data,now);return {mode:'ai',changesVersion:CHANGES_VERSION,signature:data.signature,forecastChanges:validateChanges(c.candidates.map(p=>({candidateId:p.id,summary:'A later arrival could delay showers and leave some areas drier.'})),c,now)};};
test('upcoming Thursday night–Friday is dated, not presented as today or yesterday',()=>{
 const f=make(source),b=valid(f);assert.equal(b.forecastChanges.length,1);
 assert.equal(b.forecastChanges[0].validFrom,'2026-09-10T22:00:00.000Z');assert.equal(b.forecastChanges[0].validUntil,'2026-09-12T04:00:00.000Z');
 assert.match(changesText(b,f,now),/Thursday night, Sep 10 through Friday, Sep 11/);
 assert.equal(b.forecastChanges[0].text,'There is uncertainty about the front moving through Friday vs Thursday night. Rainfall may be less widespread.');
});
for(const text of [
 '.DISCUSSION...\nAs of 300 AM Monday...\n\nThe front passed yesterday. Its timing was uncertain.',
 '.DISCUSSION...\nAs of 300 AM Monday...\n\nSunny through Wednesday with light winds.',
 '.DISCUSSION...\nAs of 300 AM Monday...\n\nForecast uncertainty remains.',
 '.DISCUSSION...\nAs of 300 AM Monday...\n\nDry through Wednesday with no meaningful uncertainty.',
 '.NEAR TERM /THROUGH SUNDAY/...\nAs of 300 PM Sunday...\n\nThe timing of the front this afternoon remains uncertain.'
])test('no unsupported, routine or ended concern: '+text.slice(-55),()=>assert.equal(changeContext(make(text),now).candidates.length,0));
test('a fresh aviation update does not revive a copied Sunday afternoon section',()=>{
 const text='.NEAR TERM /THROUGH SUNDAY/...\nAs of 300 PM Sunday...\n\nStorm timing this afternoon remains uncertain.\n\n&&\n\n.LONG TERM /THURSDAY THROUGH FRIDAY/...\nAs of 300 AM Monday...\n\nThe models differ on how quickly the next front arrives.\n\n&&\n\n.AVIATION /MONDAY/...\nAs of 400 AM Monday...\n\nFog is possible.';
 const c=changeContext(make(text,'2026-09-07T08:00:00Z'),now);assert.equal(c.candidates.length,1);assert.match(c.candidates[0].section,/LONG TERM/);
});
test('separate today and later-week concerns are retained without a generic combined statement',()=>{
 const c=changeContext(make('.DISCUSSION...\nAs of 300 AM Monday...\n\nIf clouds linger this morning, temperatures could be cooler.\n\nThe models disagree on front timing Thursday night into Friday.'),now);
 assert.equal(c.candidates.length,2);assert.match(c.candidates[0].periodLabel,/Monday/);assert.match(c.candidates[1].periodLabel,/Thursday/);
});
test('missing, stale and future-issued discussions produce no Dan take',()=>{
 assert.equal(changeContext({location},now).candidates.length,0);
 assert.equal(changeContext(make(source,'2026-09-06T07:00:00Z'),now).candidates.length,0);
 assert.equal(changeContext(make(source,'2026-09-08T07:00:00Z'),now).candidates.length,0);
 const f=make(source);f.feeds[0].status='stale';assert.equal(changeContext(f,now).candidates.length,0);
});
test('expiry is rechecked without another AI generation, including on an idle browser',()=>{
 const f=make('.DISCUSSION...\nAs of 300 AM Monday...\n\nCloud clearing this morning is uncertain.'),b=valid(f);
 assert.equal(activeChanges(b,f,now).length,1);assert.equal(activeChanges(b,f,Date.parse('2026-09-07T17:00Z')).length,0);
});
test('location, discussion ID and algorithm-version mismatches hide stale cards',()=>{
 const f=make(source),b=valid(f);
 assert.equal(activeChanges({...b,signature:'elsewhere'},f,now).length,0);
 assert.equal(activeChanges({...b,changesVersion:'old'},f,now).length,0);
 assert.equal(activeChanges(b,{...f,discussion:{...f.discussion,id:'newer-afd'}},now).length,0);
});
test('invented candidate IDs, injected instructions, dates and generic boilerplate cannot become a note',()=>{
 const c=changeContext(make(source),now);
 for(const p of [{candidateId:'fake',summary:'Rain could be heavier.'},{candidateId:'change-0',summary:'Forecasts can change.'},{candidateId:'change-0',summary:'The front may arrive tomorrow.'},{candidateId:'change-0',summary:'<img src=x onerror=alert(1)>'}])assert.equal(validateChanges([p],c,now).length,0);
 assert.deepEqual(validateChanges([],c,now),[]);
});
test('local day and DST are resolved in the location timezone',()=>{
 const f=make('.DISCUSSION...\nAs of 300 AM Sunday...\n\nThe timing of rain tonight is uncertain.','2026-11-01T08:00:00Z');f.location={...location,timeZone:'America/New_York'};
 const c=changeContext(f,Date.parse('2026-11-01T09:00Z'));assert.equal(c.candidates[0].validFrom,'2026-11-01T23:00:00.000Z');
 assert.equal(c.candidates[0].validUntil,'2026-11-02T11:00:00.000Z');
});
test('the app does not force a feels-like value above air temperature or switch at 75 F',()=>{
 const calculate=t=>tier3FeelsLike({temperature:t,dewpoint:65,wind:8,condition:'Overcast'},location,now,'outdoors');
 const a=calculate(74.99),b=calculate(75.01);assert.ok(Math.abs(b.value-a.value)<.1);assert.equal(a.warmerResultOverride,false);
 assert.equal(tier3FeelsLike({temperature:80,humidity:50,wind:45,condition:'Clear'},location,now).value,null);
 assert.equal(tier3FeelsLike({temperature:66,humidity:94,wind:-1},location,now).value,null);
});
test('current station inputs are independently evaluated instead of trusting a painted figure value',()=>{
 const f={location,assembledAt:new Date(now).toISOString(),current:{temperature:66,humidity:94,wind:0,condition:'Clear',type:'observation',time:new Date(now).toISOString()},comfort:{shade:999,outdoors:999}};
 const s=currentSample(f,now);assert.notEqual(s.feels,999);assert.equal(s.feels,Math.round(thermalComfort(f.current,location,now).rawOutdoors));
 assert.equal(s.comfort.inputEvidence.windMph,0);assert.equal(s.comfort.inputEvidence.windUsedMps,.5);
 assert.equal(s.comfort.solarAdjustment,0);assert.equal(s.comfort.sun,null);
});
test('the current-hour forecast remains separate and a corrupt forecast value cannot force the figure',()=>{
 const start=Math.floor(now/3600000)*3600000,times=[start,start+3600000].map(t=>new Date(t).toISOString());
 const rows=value=>times.map(time=>({time,value}));
 const f={location,assembledAt:new Date(now).toISOString(),current:{temperature:66,dewpoint:64,wind:0,condition:'Clear'},days:[],hours:times.map(time=>({time,temperature:65,condition:'Clear'})),metricForecasts:{notes:{},series:{temperature:rows(65),dewpoint:rows(63),wind:rows(4.3)}}};
 rebuildHourlyFeels(f,{now,temperatureAt:()=>({value:null}),humidityAt:()=>null});
 const display=hourlyDisplaySamples(f,now+60000);assert.equal(display.length,3);assert.notEqual(display[0].feels,display[1].feels);
 const value=f.hours[0].feelsLike;assert.ok(value<display[0].feels);assert.equal(forecastSample(f,times[0]).feels,value);
 f.metricForecasts.series.feels[0].value=999;assert.equal(forecastSample(f,times[0]),null);
});
