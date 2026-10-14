import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {weatherNextFreshness} from '../src/weatherNextFreshness.js';
import {selectGoogleForecast} from '../src/weatherComparisonData.js';
const now = Date.parse('2026-10-14T10:00:00Z'), H = 3600000;
const point = {id:'knightdale',latitude:35.787,longitude:-78.4806,name:'Knightdale'};
test('current collection timestamps cannot make an old Google model run ready',()=>{
 const old={runAt:'2026-10-12T00:00:00Z',generatedAt:new Date(now).toISOString(),status:'ready',points:[{...point,hourly:[{time:'2026-10-15T00:00:00Z'}]}]};
 assert.equal(weatherNextFreshness(old,now).status,'stale');
 assert.equal(weatherNextFreshness(old,now).runAgeHours,58);
 const future={...old,runAt:new Date(now+H).toISOString()};
 assert.equal(weatherNextFreshness(future,now).status,'unavailable');
 assert.equal(weatherNextFreshness({...old,runAt:new Date(now-36*H-1000).toISOString()},now).status,'stale');
});
test('expired interim guidance is unavailable even if its generatedAt is current',()=>{
 const source={runAt:new Date(now-50*H).toISOString(),generatedAt:new Date(now).toISOString(),points:[{...point,hourly:[{time:new Date(now-H).toISOString()}]}]};
 assert.equal(weatherNextFreshness(source,now).status,'unavailable');
});
test('compact adapter preserves initialization provenance and marks old models stale',()=>{
 const runAt=new Date(now-48*H).toISOString(),feed={schema:'weather-nourie-weathernext3-v1',runAt,generatedAt:new Date(now).toISOString(),points:[{...point,hourly:[{time:new Date(now).toISOString(),temperatureF:42},{time:new Date(now+H).toISOString(),temperatureF:43}]}]};
 const selected=selectGoogleForecast(feed,point.id,now);
 assert.equal(selected.runs[0].status,'stale');assert.equal(selected.runs[0].runAt,runAt);
 assert.equal(selected.rows[0].provenance.status,'stale');
});
test('full collector remains cost guarded and refreshes on all four main model cycles',()=>{
 const full=readFileSync('.github/workflows/weathernext-full-data.yml','utf8');
 assert.match(full,/schedule:\s*\n(?:[^\n]*\n)*?\s*- cron: '45 2,8,14,20 \* \* \*'/);
 assert.match(full,/max-bytes-per-query 700000000000/);
 assert.match(full,/weathernext-full-cost-stop\.json/);
 const compact=readFileSync('.github/workflows/weathernext3-data.yml','utf8');
 assert.match(compact,/for attempt in 1 2 3 4 5/);assert.match(compact,/git rebase FETCH_HEAD/);
});
