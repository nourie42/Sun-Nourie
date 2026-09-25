import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeNwsRain,fetchNwsRain,addNwsRain} from '../src/weatherComparisonRain.js';
import {buildGoogleComparison} from '../src/weatherComparison.js';
import {feedFixture,now} from './weatherComparisonData.test.js';
const H=3600000;
const period=(start,end,value)=>({startTime:start,endTime:end,probabilityOfPrecipitation:{value}});
const raw=periods=>({properties:{updateTime:new Date(now).toISOString(),periods}});
test('NWS normalization retains zero, rejects invalid probabilities and stale forecasts',()=>{
 const data=raw([period('2026-09-05T11:00Z','2026-09-05T23:00Z',0),period('2026-09-05T23:00Z','2026-09-06T11:00Z',null)]);
 assert.deepEqual(normalizeNwsRain(data,now).periods.map(p=>p.value),[0,null]);
 assert.equal(normalizeNwsRain(data,now+25*H),null);
 assert.equal(normalizeNwsRain({...data,properties:{...data.properties,updateTime:null}},now),null);
 data.properties.periods[0].probabilityOfPrecipitation.value=101;assert.equal(normalizeNwsRain(data,now).periods[0].value,null);
});
test('NWS probabilities are aligned independently and do not replace WeatherNext amounts or temperatures',()=>{
 const out=buildGoogleComparison(feedFixture(),'knightdale',now);
 const before=JSON.stringify(out.days.map(d=>({high:d.high,low:d.low,qpf:d.qpf})));
 const rain={daily:normalizeNwsRain(raw([period('2026-09-05T10:00Z','2026-09-05T22:00Z',20),period('2026-09-05T22:00Z','2026-09-06T10:00Z',80)]),now),hourly:normalizeNwsRain(raw([period('2026-09-05T22:00Z','2026-09-05T23:00Z',0),period('2026-09-05T23:00Z','2026-09-06T00:00Z',60)]),now)};
 addNwsRain(out,rain);
 assert.equal(out.days[0].popDay,20);assert.equal(out.days[0].popNight,80);assert.equal(out.days[0].pop,80);
 assert.equal(out.hours[0].pop,0);assert.equal(out.hours[1].pop,60);assert.equal(out.hours[2].pop,null);
 assert.equal(out.days[1].pop,null);assert.match(out.days[0].rainLikelihood.source,/NWS/);
 assert.equal(JSON.stringify(out.days.map(d=>({high:d.high,low:d.low,qpf:d.qpf}))),before);
 assert.match(out.days[0].detail,/not the probability of rain over the combined 24 hours/);
});
test('NWS errors remain unavailable, never zero',()=>{
 const out=buildGoogleComparison(feedFixture(),'knightdale',now);addNwsRain(out,null);
 assert.equal(out.days[0].pop,null);assert.equal(out.hours[0].pop,null);
 assert.equal(out.feeds.at(-1).status,'unavailable');
});
test('NWS point endpoint cannot redirect probability fetching to another origin',async()=>{
 const calls=[];
 const result=await fetchNwsRain({latitude:35,longitude:-78},async url=>{calls.push(url);return {ok:true,json:async()=>({properties:{forecast:'https://example.com/private',forecastHourly:'https://example.com/private'}})};},now);
 assert.equal(result.daily,null);assert.equal(result.hourly,null);assert.equal(calls.length,1);
 assert.ok(calls.every(url=>new URL(url).origin==='https://api.weather.gov'));
});
