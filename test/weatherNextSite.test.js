import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {convert,value,daysFrom,rowsFor,csvText,validateFeed,direction} from '../public/weather-fusion/weathernext-data.js';
import {weatherNextFixture} from '../scripts/weatherNextFixture.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const catalog=JSON.parse(read('public/weather-fusion/weathernext-catalog.json'));
const data=weatherNextFixture(catalog);

test('WeatherNext catalog exposes all 19 gridded and 2 station fields with six statistics',()=>{
  assert.equal(catalog.fields.filter(f=>f.grid==='surface').length,19);
  assert.equal(catalog.fields.filter(f=>f.grid==='station').length,2);
  assert.deepEqual(catalog.statistics,['mean','p10','p25','p50','p75','p90']);
  assert.equal(new Set(catalog.fields.map(f=>f.id)).size,21);
});
test('WeatherNext SI conversions preserve missing and signed values',()=>{
  assert.equal(convert(273.15,'temperature'),32);
  assert.equal(convert(null,'temperature'),null);
  assert.equal(convert(NaN,'rain'),null);
  assert.ok(convert(-4,'signed-speed')<0);
  assert.ok(Math.abs(convert(.0254,'rain')-1)<1e-10);
  assert.equal(convert(.75,'fraction'),75);
  assert.equal(convert(101325,'pressure'),1013.25);
  assert.equal(convert(3600000,'solar'),1000);
  assert.equal(direction(0,-5).compass,'N');
  assert.equal(direction(0,0),null);
});
test('WeatherNext keeps the 360-hour main run separate from the 48-hour interim run',()=>{
  assert.equal(rowsFor(data,'surface','knightdale').length,360);
  assert.equal(rowsFor(data,'interimSurface','knightdale').length,48);
  assert.notEqual(data.sources.surface.runAt,data.sources.interimSurface.runAt);
  assert.equal(validateFeed(data),data);
  assert.throws(()=>validateFeed({}));
});
test('WeatherNext daily summaries do not fabricate missing ocean data or daily percentiles',()=>{
  const r=rowsFor(data,'surface','knightdale')[0];
  const f=catalog.fields.find(f=>f.id==='sea_surface_temperature');
  assert.equal(value(r,f),null);
  const days=daysFrom(rowsFor(data,'surface','knightdale'),'America/New_York',Date.parse('2026-09-24T13:00Z'));
  assert.ok(days.length>=15);
  assert.equal(days[0].coverage,24);
  assert.equal(days.at(-1).partial,true);
  assert.ok(!Object.keys(days[0]).some(k=>/p90|probability/i.test(k)));
});
test('WeatherNext daily precipitation attributes midnight to the preceding hour/day',()=>{
  const rows=Array.from({length:24},(_,i)=>({time:new Date(Date.parse('2026-09-24T04:00Z')+(i+1)*3600000).toISOString(),values:{temperature_2m:{mean:290},total_precipitation_1hr:{mean:.001},wind_speed_10m:{mean:5}}}));
  const days=daysFrom(rows,'America/New_York',Date.parse('2026-09-24T05:00Z'));
  assert.equal(days.length,1);
  assert.equal(days[0].coverage,24);
  assert.equal(days[0].partial,false);
  assert.ok(Math.abs(days[0].rain-.024*39.37007874015748)<1e-8);
});
test('WeatherNext CSV includes every available statistical field',()=>{
  const csv=csvText(data,'surface','knightdale',catalog.fields);
  assert.equal(csv.split('\r\n').length,361);
  assert.match(csv,/temperature_2m_p90/);
  assert.match(csv,/experimental_tp_1hr_p50/);
  assert.match(csv,/mean_sea_level_pressure_mean/);
  assert.doesNotMatch(csv,/undefined|NaN/);
});
test('dedicated WeatherNext routes and files are explicitly served',()=>{
  const server=read('src/weatherFusion.js');
  for(const name of ['weathernext-site.html','weathernext-site.css','weathernext-site.js','weathernext-data.js','weathernext-catalog.json']) assert.ok(server.includes("'"+name+"'"));
  assert.match(server,/app\.get\(\['\/weathernext','\/weathernext\/','\/weather-fusion\/weathernext-site\.html'\]/);
  assert.doesNotMatch(read('public/weather-fusion/weathernext-site.js'),/credentials_json|private_key|Bearer /);
});
test('main weather navigation is a single row of five text-only borderless buttons',()=>{
  const html=read('public/weather-fusion/index.html');
  const css=read('public/weather-fusion/weather-polish.css');
  const nav=html.match(/<nav class="weather-jump-nav"[\s\S]*?<\/nav>/)[0];
  assert.equal((nav.match(/weather-jump-card/g)||[]).length,5);
  assert.doesNotMatch(nav,/<svg|<img|jump-visual|jump-arrow/);
  assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css,/\.weather-jump-card\{[^}]*border:0/);
});
test('Experimental Weather exposes only a link to WeatherNext, not the embedded comparison card',()=>{
  const html=read('public/weather-fusion/index.html'),model=read('public/weather-fusion/model-explanation.js');
  assert.match(html,/id="weathernext-site-link" href="\/weathernext\/"/);
  assert.doesNotMatch(html,/id="google-status"/);
  const view=model.slice(model.indexOf('export function modelExplanationHTML'),model.indexOf('function experimentalPath'));
  assert.doesNotMatch(view,/weatherNextCard\(/);
});
test('WeatherNext standalone page cannot regress to the shared weather shell or stale caching',()=>{
  const server=read('src/weatherFusion.js');
  const google=read('public/weather-fusion/weathernext-site.html');
  const main=read('public/weather-fusion/index.html');
  assert.match(server,/Cache-Control','no-store, max-age=0, must-revalidate/);
  assert.match(server,/X-Weather-Nourie-Page','weathernext-standalone-/);
  assert.match(server,/sendFile\(path\.join\(PUBLIC_DIR,'weathernext-site\.html'\)\)/);
  assert.doesNotMatch(google,/\/weather-fusion\/app\.js/);
  assert.match(google,/\/weather-fusion\/weathernext-data\.js\?v=/);
  assert.doesNotMatch(main,/Low on the left, high on the right/i);
});
test('dedicated WeatherNext page documents live surface/station data plus full upper-air product coverage',()=>{
  const html=read('public/weather-fusion/weathernext-site.html');
  assert.match(html,/Everything Google publishes for forecasting/);
  assert.match(html,/0\.05° station-trained output/);
  assert.match(html,/0\.1° gridded surface output/);
  assert.match(html,/0\.25° 3D atmosphere/);
  assert.match(html,/13 levels/);
  assert.match(html,/64/);
  assert.match(html,/360 hours/);
  assert.match(html,/48 hours/);
});
