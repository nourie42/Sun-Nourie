import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastNeedsModelRetry,forecastRefreshDue} from '../public/weather-fusion/forecast-refresh.js';
const now=Date.parse('2026-10-17T14:32:00Z'),M=60000,H=3600000;
const fixture=()=>({assembledAt:new Date(now).toISOString(),location:{timeZone:'America/New_York'},days:[{date:'2026-10-17',confidence:{key:'moderate'}}],feeds:['hrrr','ecmwf','nbm'].map(id=>({id,status:'ready'})),rainTimeline:[]});
test('healthy forecasts retain their normal refresh interval, including genuine Moderate confidence',()=>{
 const f=fixture();assert.equal(forecastNeedsModelRetry(f,now),false);
 assert.equal(forecastRefreshDue(f,now+8*M),false);assert.equal(forecastRefreshDue(f,now+9*M),true);
 assert.equal(f.days[0].confidence.key,'moderate');
});
test('a missing NBM source retries after two minutes rather than leaving the fallback on screen',()=>{
 const f=fixture();f.feeds[2].status='unavailable';
 assert.equal(forecastRefreshDue(f,now+119999),false);assert.equal(forecastRefreshDue(f,now+2*M),true);
});
test('a retained verified model with a failed refresh also receives an earlier retry',()=>{
 const f=fixture();f.feeds[0].retrievalStatus='last-verified';assert.equal(forecastRefreshDue(f,now+2*M),true);
});
test('missing required rain fields retry even when the overall model feed is ready',()=>{
 const f=fixture();f.rainTimeline=[{time:new Date(now).toISOString(),end:new Date(now+H).toISOString(),rainLikelihood:{mode:'nws-fallback',value:70,missingModels:['nbm']}}];
 assert.equal(forecastRefreshDue(f,now+2*M),true);
});
test('fallback beyond the next day or an elapsed fallback does not cause constant retries',()=>{
 const f=fixture();f.rainTimeline=[{time:new Date(now+25*H).toISOString(),end:new Date(now+26*H).toISOString(),rainLikelihood:{mode:'nws-fallback',value:50}},{time:new Date(now-H).toISOString(),end:new Date(now).toISOString(),rainLikelihood:{mode:'nws-fallback',value:95}}];
 assert.equal(forecastNeedsModelRetry(f,now),false);
});
test('a recovered source returns to the healthy interval without changing confidence or model inputs',()=>{
 const f=fixture();f.feeds[2].status='unavailable';assert.equal(forecastRefreshDue(f,now+2*M),true);
 f.feeds[2].status='ready';f.assembledAt=new Date(now+2*M).toISOString();f.days[0].confidence.key='high';const before=structuredClone(f);
 assert.equal(forecastRefreshDue(f,now+4*M),false);assert.deepEqual(f,before);
});
test('local midnight still refreshes immediately even for a newly fetched healthy forecast',()=>{
 const f=fixture();f.assembledAt='2026-10-18T03:59:30Z';assert.equal(forecastRefreshDue(f,Date.parse('2026-10-18T04:00:00Z')),true);
});

test('incomplete Today temperature or rainfall coverage retries after two minutes even when feeds report ready',()=>{
 for(const metric of ['temperature','rain']){
  const f=fixture();f.days[0].confidence={key:'low',score:65,coverage:{[metric]:{complete:false}}};
  const before=structuredClone(f);
  assert.equal(forecastRefreshDue(f,now+119999),false);
  assert.equal(forecastRefreshDue(f,now+2*M),true,metric);
  assert.deepEqual(f,before,'retry scheduling must not change the confidence rating or weather data');
 }
});
test('complete low-confidence guidance keeps the normal cadence when sources actually disagree',()=>{
 const f=fixture();f.days[0].confidence={key:'low',score:65,coverage:{temperature:{complete:true},rain:{complete:true}}};
 assert.equal(forecastNeedsModelRetry(f,now),false);
 assert.equal(forecastRefreshDue(f,now+2*M),false);
 assert.equal(forecastRefreshDue(f,now+9*M),true);
});
test('incomplete coverage on a later date does not accelerate a complete Today forecast',()=>{
 const f=fixture();f.days.push({date:'2026-10-18',confidence:{key:'low',coverage:{temperature:{complete:false},rain:{complete:false}}}});
 assert.equal(forecastNeedsModelRetry(f,now),false);
});
test('once hourly coverage recovers the normal interval resumes without forcing High',()=>{
 const f=fixture();f.days[0].confidence={key:'low',coverage:{temperature:{complete:false},rain:{complete:true}}};
 assert.equal(forecastRefreshDue(f,now+2*M),true);
 f.days[0].confidence={key:'moderate',coverage:{temperature:{complete:true},rain:{complete:true}}};
 f.assembledAt=new Date(now+2*M).toISOString();const before=structuredClone(f);
 assert.equal(forecastRefreshDue(f,now+4*M),false);assert.deepEqual(f,before);
});
