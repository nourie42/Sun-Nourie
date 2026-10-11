import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastSourceHealth} from '../public/weather-fusion/forecast-status.js';

const forecast=(extra=[])=>({days:[{high:80,low:60}],hours:[{temperature:75}],feeds:[{id:'nws',status:'ready'},{id:'hourly',status:'ready'},{id:'alerts',status:'ready'},...extra]});

test('healthy forecasts keep the ordinary update line without extra warnings',()=>{
  assert.deepEqual(forecastSourceHealth(forecast()),{requiredIssues:[],note:''});
});

test('the Knightdale UV rate limit does not mark a usable forecast stale or failed',()=>{
  const data=forecast([{id:'exposure',label:'UV and surface-weather forecast',status:'unavailable',message:'Source returned HTTP 429.'}]);
  const original=structuredClone(data),health=forecastSourceHealth(data);
  assert.deepEqual(health.requiredIssues,[]);
  assert.match(health.note,/Forecast available\. UV\/surface weather unavailable/);
  assert.doesNotMatch(health.note,/stale|Daily forecast unavailable|Hourly forecast unavailable/);
  assert.match(health.note,/Scientific Stuff/);
  assert.deepEqual(data,original);
});

test('stale optional models are named without branding the core forecast stale',()=>{
  const health=forecastSourceHealth(forecast([{id:'hrrr',status:'stale'}]));
  assert.deepEqual(health.requiredIssues,[]);
  assert.match(health.note,/Forecast available\. HRRR stale/);
});

test('retained still-fresh verified guidance is not labeled unavailable',()=>{
  const health=forecastSourceHealth(forecast([{id:'hrrr',status:'ready',retrievalStatus:'last-verified',message:'Latest fetch failed; retaining verified fresh data.'}]));
  assert.equal(health.note,'');assert.deepEqual(health.requiredIssues,[]);
});

test('location-limited and unconfigured sources remain disclosed',()=>{
  const health=forecastSourceHealth(forecast([{id:'hrrr',status:'not-covered'},{id:'ecmwf',status:'not-configured'}]));
  assert.deepEqual(health.requiredIssues,[]);
  assert.match(health.note,/HRRR limited for this location/);
  assert.match(health.note,/ECMWF not configured/);
});

for(const [id,label] of [['nws','Daily forecast'],['hourly','Hourly forecast']])for(const status of ['unavailable','stale'])test(`${label} ${status} remains a real warning`,()=>{
  const data=forecast();data.feeds.find(feed=>feed.id===id).status=status;
  const health=forecastSourceHealth(data);
  assert.equal(health.requiredIssues.length,1);
  assert.match(health.note,new RegExp(`${label} ${status}`));
  assert.doesNotMatch(health.note,/Forecast available/);
});

test('empty or placeholder-only forecasts cannot claim to be available',()=>{
  for(const mutate of [data=>data.days=[],data=>data.hours=[],data=>{data.days=[{high:null,low:null}];data.hours=[{temperature:null}];}]){
    const data=forecast();mutate(data);
    const health=forecastSourceHealth(data);
    assert.ok(health.requiredIssues.length);
    assert.doesNotMatch(health.note,/Forecast available/);
  }
  const missing=forecastSourceHealth(null);
  assert.equal(missing.requiredIssues.length,2);
  assert.doesNotMatch(missing.note,/Forecast available/);
});

test('legitimate zero-degree temperatures remain usable readings',()=>{
  const data=forecast();data.days=[{high:0,low:0}];data.hours=[{temperature:0}];
  assert.deepEqual(forecastSourceHealth(data),{requiredIssues:[],note:''});
});

test('official alert source failures stay prominent even when temperatures are available',()=>{
  const data=forecast();data.feeds.find(feed=>feed.id==='alerts').status='unavailable';
  const health=forecastSourceHealth(data);
  assert.equal(health.requiredIssues.length,1);
  assert.match(health.note,/Forecast available\. Official alerts unavailable/);
  assert.match(health.note,/Check weather\.gov for official warnings/);
});

test('a long source-failure list stays bounded while the detailed register remains available',()=>{
  const health=forecastSourceHealth(forecast(['exposure','hrrr','ecmwf','nbm','air-quality'].map(id=>({id,status:'unavailable'}))));
  assert.match(health.note,/2 other source limitations/);
  assert.match(health.note,/Scientific Stuff/);
});

test('WeatherNext comparison forecasts are evaluated by their own sources',()=>{
  const data={...forecast(),comparison:{source:'google'},feeds:[{id:'google-main',label:'WeatherNext main run',status:'ready'},{id:'nws-rain',label:'Supplemental rain chances',status:'unavailable'}]};
  const health=forecastSourceHealth(data);
  assert.deepEqual(health.requiredIssues,[]);
  assert.match(health.note,/Forecast available\. Supplemental rain chances unavailable/);
  assert.doesNotMatch(health.note,/Daily forecast unavailable|Hourly forecast unavailable/);
  data.feeds[0].status='stale';
  assert.equal(forecastSourceHealth(data).requiredIssues.length,1);
  assert.doesNotMatch(forecastSourceHealth(data).note,/Forecast available/);
});
