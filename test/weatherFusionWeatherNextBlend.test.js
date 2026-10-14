import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeatherNextBlendSource, WEATHERNEXT_BLEND_FEED} from '../src/weatherFusionWeatherNext.js';
import {intervalTotal} from '../src/weatherFusionDirect.js';

const H = 3600000, NOW = Date.parse('2026-10-14T12:00:00Z');
const location = {latitude:35.787, longitude:-78.4806};
const point = {id:'knightdale', name:'Knightdale, NC', ...location, gridLatitude:35.8, gridLongitude:-78.5, timeZone:'America/New_York'};
const iso = time => new Date(time).toISOString();
const mean = value => ({mean:value});
function row(time, overrides={}) {
  return {time:iso(time), values:{temperature_2m:mean(300), dewpoint_temperature_2m:mean(290), wind_speed_10m:mean(2), u_component_of_wind_10m:mean(0), v_component_of_wind_10m:mean(-2), total_cloud_cover:mean(.4), mean_sea_level_pressure:mean(101325), total_precipitation_1hr:mean(.0254), ...overrides}};
}
function source(run=NOW-6*H, hours=12) {
  return {status:'ready', runAt:iso(run), fetchedAt:iso(NOW), points:[{...point, hourly:Array.from({length:hours}, (_,i) => row(NOW+i*H))}]};
}
function feed(sources={surface:source()}) {
  return {schema:'weather-nourie-weathernext-site-v1', model:'Google WeatherNext 3', generatedAt:iso(NOW), points:[point], sources, rawUnits:{temperature:'K', wind:'m/s', precipitation:'m per preceding hour', cloud:'fraction', pressure:'Pa'}};
}
function loader(data, now=()=>NOW) {
  return createWeatherNextBlendSource({now, fetchImpl:async()=>new Response(JSON.stringify(data), {status:200, headers:{'content-type':'application/json'}})});
}
const close = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-9, `${actual} != ${expected}`);

test('published SI guidance becomes a verified named-model point series with full precision', async () => {
  const {value, meta} = await loader(feed())(location);
  assert.equal(meta.status, 'ready'); assert.equal(meta.contributes, true);
  assert.equal(value.model, 'wn'); assert.equal(value.verifiedModel, true);
  assert.equal(meta.url, WEATHERNEXT_BLEND_FEED);
  assert.equal(value.hourly.time[0], NOW/1000);
  close(value.hourly.temperature_2m[0], 80.33000000000004);
  close(value.hourly.dew_point_2m[0], 62.33000000000004);
  close(value.hourly.wind_speed_10m[0], 2*2.2369362921);
  assert.equal(value.hourly.wind_direction_10m[0], 0);
  assert.equal(value.hourly.cloud_cover[0], 40);
  close(value.hourly.pressure_msl[0], 101325/3386.389);
  assert.equal(value.hourly_units.pressure_msl, 'inHg');
  assert.deepEqual(value.hourly.visibility, Array(12).fill(null));
  assert.deepEqual(value.hourly.wind_gusts_10m, Array(12).fill(null));
});

test('end-labelled precipitation belongs to the exact preceding hour, including real zero', async () => {
  const data = feed();
  data.sources.surface.points[0].hourly[0].values.total_precipitation_1hr.mean = 0;
  const {value} = await loader(data)(location);
  assert.equal(value.hourly.precipitation[0], 0);
  assert.deepEqual(value.precipitationIntervals[0], {start:(NOW-H)/1000, end:NOW/1000, value:0, runAt:iso(NOW-6*H), sourceId:'surface'});
  assert.equal(value.precipitationIntervals[1].value, 1);
  assert.equal(intervalTotal(value.precipitationIntervals, NOW, NOW+H), 1);
  assert.equal(intervalTotal(value.precipitationIntervals, NOW-H, NOW), 0);
});

test('negative or missing accumulations and missing timestamps remain gaps', async () => {
  const data = feed(), rows = data.sources.surface.points[0].hourly;
  rows[1].values.total_precipitation_1hr.mean = -1;
  delete rows[2].values.total_precipitation_1hr;
  rows.splice(3,1);
  const {value} = await loader(data)(location);
  assert.equal(value.hourly.precipitation[1], null);
  assert.equal(value.hourly.precipitation[2], null);
  assert.equal(value.hourly.time.includes((NOW+3*H)/1000), false);
  assert.equal(intervalTotal(value.precipitationIntervals, NOW, NOW+4*H), null);
});

test('initialization age is verified on every cache read, never from generatedAt', async () => {
  let clock = NOW;
  const data = feed({surface:source(NOW-36*H)});
  data.generatedAt = iso(NOW+24*H);
  const load = loader(data, ()=>clock);
  assert.equal((await load(location)).meta.status, 'ready');
  clock += 1;
  const result = await load(location);
  assert.equal(result.value, null); assert.equal(result.meta.status, 'unavailable'); assert.equal(result.meta.contributes, false);
});

test('future or malformed model initializations never contribute', async () => {
  for (const runAt of [iso(NOW+H), 'invalid', iso(NOW-6*H+1)]) {
    const data = feed(); data.sources.surface.runAt = runAt;
    const result = await loader(data)(location);
    assert.equal(result.value, null); assert.equal(result.meta.contributes, false);
  }
});

test('a newer stale/last-verified source cannot override a fresh main run', async () => {
  const main = source(), stale = source(NOW-H);
  stale.status = 'stale';
  stale.points[0].hourly.forEach(row => row.values.temperature_2m.mean = 310);
  const {value} = await loader(feed({surface:main, interimSurface:stale}))(location);
  assert.equal(value.runAt, main.runAt);
  close(value.hourly.temperature_2m[0], 80.33000000000004);
});

test('newest fresh interim hours win; the fresh main run extends the remaining horizon', async () => {
  const main = source(NOW-6*H, 60), interim = source(NOW-H, 3);
  interim.points[0].hourly.forEach(row => row.values.temperature_2m.mean = 310);
  const {value} = await loader(feed({surface:main, interimSurface:interim}))(location);
  assert.equal(value.runAt, interim.runAt);
  close(value.hourly.temperature_2m[0], 98.33000000000004);
  close(value.hourly.temperature_2m[3], 80.33000000000004);
  assert.equal(value.hourlyProvenance[0].runAt, interim.runAt);
  assert.equal(value.hourlyProvenance[3].runAt, main.runAt);
});

test('only same-run fresh station measurements may replace surface values', async () => {
  const main = source(), station = source();
  station.points[0].hourly.forEach(row => row.values.station_head_temperature_2m = mean(305));
  let data = feed({surface:main, station});
  let result = await loader(data)(location);
  close(result.value.hourly.temperature_2m[0], 89.33000000000004);
  station.status = 'last-verified';
  result = await loader(data)(location);
  close(result.value.hourly.temperature_2m[0], 80.33000000000004);
  station.status = 'ready'; station.runAt = iso(NOW-7*H);
  result = await loader(data)(location);
  close(result.value.hourly.temperature_2m[0], 80.33000000000004);
});

test('unpublished locations and mismatched actual grid points are explicitly unavailable', async () => {
  const load = loader(feed());
  for (const other of [{latitude:42.6012, longitude:-76.1805}, {latitude:35.987, longitude:-78.4806}]) {
    const result = await load(other); assert.equal(result.value, null); assert.equal(result.meta.status, 'unavailable');
  }
  const data = feed(); data.sources.surface.points[0].gridLatitude = 40;
  assert.equal((await loader(data)(location)).value, null);
  data.sources.surface.points[0] = {...data.sources.surface.points[0], gridLatitude:35.8, latitude:36};
  assert.equal((await loader(data)(location)).value, null);
});

test('duplicate and malformed hours are removed; remaining hours stay sorted without filling gaps', async () => {
  const data = feed(), rows = data.sources.surface.points[0].hourly;
  rows.push(row(NOW+H)); rows.push({time:'invalid', values:{}}); rows.push(row(NOW+H/2));
  rows.reverse();
  const {value} = await loader(data)(location);
  assert.equal(value.hourly.time.includes((NOW+H)/1000), false);
  assert.equal(value.hourly.time.includes((NOW+H/2)/1000), false);
  assert.equal(new Set(value.hourly.time).size, value.hourly.time.length);
  assert.deepEqual(value.hourly.time, [...value.hourly.time].sort((a,b)=>a-b));
});

test('invalid measurements become null independently, while real zeros survive', async () => {
  const data = feed(), rows = data.sources.surface.points[0].hourly;
  rows[0].values.temperature_2m.mean = -1;
  rows[0].values.wind_speed_10m.mean = -2;
  rows[0].values.total_cloud_cover.mean = 2;
  rows[0].values.mean_sea_level_pressure.mean = 1;
  rows[1].values.wind_speed_10m.mean = 0;
  rows[1].values.total_cloud_cover.mean = 0;
  const {value} = await loader(data)(location);
  for (const field of ['temperature_2m','wind_speed_10m','cloud_cover','pressure_msl']) assert.equal(value.hourly[field][0], null);
  assert.equal(value.hourly.wind_speed_10m[1], 0); assert.equal(value.hourly.cloud_cover[1], 0);
});

test('shared feed requests deduplicate across locations and cache for five minutes', async () => {
  let calls = 0, clock = NOW, release;
  const gate = new Promise(resolve => { release = resolve; });
  const data = feed();
  const load = createWeatherNextBlendSource({now:()=>clock, fetchImpl:async (url, options) => {
    calls++; assert.equal(url, WEATHERNEXT_BLEND_FEED); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    await gate; return new Response(JSON.stringify(data));
  }});
  const first = load(location), second = load({...location, latitude:35.79});
  release();
  assert.equal((await first).meta.status, 'ready'); assert.equal((await second).meta.status, 'ready'); assert.equal(calls, 1);
  clock += 299999;
  await load(location); assert.equal(calls, 1);
  clock += 1;
  await load(location); assert.equal(calls, 2);
});

test('fetch failures, oversized payloads, and invalid units produce unavailable metadata', async () => {
  const bad = feed(); bad.rawUnits.precipitation = 'mm';
  const cases = [
    async()=>{throw new Error('connection failed');},
    async()=>new Response('oops', {status:503}),
    async()=>new Response('{}', {headers:{'content-length':String(13*1024*1024)}}),
    async()=>new Response(JSON.stringify(bad))
  ];
  for (const fetchImpl of cases) {
    const result = await createWeatherNextBlendSource({fetchImpl, now:()=>NOW})(location);
    assert.equal(result.value, null); assert.equal(result.meta.status, 'unavailable'); assert.equal(result.meta.contributes, false);
  }
});
