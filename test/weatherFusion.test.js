import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinates, localTime, dateKey, nextDate, durationMs, sumHourly, gridQpf, guidanceBlend, normalizeModel, parseRadarTimes, Cache, buildForecast, createWeatherService, registerWeatherFusionRoutes } from '../src/weatherFusion.js';
import {H,now,base,times,model,periods,hourlyPeriods,grid,inputs,snapshot} from './weatherFusion.fixtures.js';
test('coordinate validation is finite, bounded, and rejects coercion and arrays', () => {
  assert.equal(coordinates({ location: 'greenville' }).longitude, -77.3664);
  for (const q of [{ latitude: '', longitude: '' }, { latitude: [35], longitude: -78 }, { latitude: 'Infinity', longitude: -78 }, { latitude: 0, longitude: 0 }, { latitude: '35foo', longitude: -78 }]) assert.throws(() => coordinates(q));
});
test('local 7 AM is converted across daylight saving transitions', () => {
  assert.equal(localTime('2026-09-05', 7, 'America/New_York'), Date.parse('2026-09-05T11:00:00Z'));
  assert.equal(localTime('2026-01-05', 7, 'America/New_York'), Date.parse('2026-01-05T12:00:00Z'));
  assert.equal(localTime('2026-03-08', 7, 'America/New_York') - localTime('2026-03-07', 7, 'America/New_York'), 23 * H);
  assert.equal(localTime('2026-11-01', 7, 'America/New_York') - localTime('2026-10-31', 7, 'America/New_York'), 25 * H);
  assert.equal(dateKey(Date.parse('2026-09-06T01:00:00Z'), 'America/New_York'), '2026-09-05');
});
test('calendar dates include leap days and month boundaries', () => { assert.equal(nextDate('2028-02-28'), '2028-02-29'); assert.equal(nextDate('2026-12-31'), '2027-01-01'); });
test('duration parser handles days/hours/minutes and rejects malformed units', () => { assert.equal(durationMs('P1DT3H30M'), 27.5 * H); assert.equal(durationMs('PT120S'), 120000); assert.equal(durationMs('bad'), null); });
test('hourly QPF sums preceding-hour values with strict coverage, retaining zero', () => {
  const r = [{ time: H, precipitation: 1 }, { time: 2 * H, precipitation: 2 }, { time: 3 * H, precipitation: 50 }];
  assert.equal(sumHourly(r, 0, 2 * H), 3);
  assert.equal(sumHourly(r.slice(1), 0, 2 * H), null);
  assert.equal(sumHourly([{ time: H, precipitation: 0 }], 0, H), 0);
  assert.equal(sumHourly([{ time: H, precipitation: null }], 0, H), null);
});
test('DST rain windows require 23 or 25 complete model hours, not 24', () => {
  for (const date of ['2026-03-07', '2026-10-31']) {
    const a = localTime(date, 7, 'America/New_York'), b = localTime(nextDate(date), 7, 'America/New_York');
    const r = Array.from({ length: (b - a) / H }, (_, i) => ({ time: a + (i + 1) * H, precipitation: 1 }));
    assert.equal(sumHourly(r, a, b), (b - a) / H);
  }
});
test('NWS QPF prorates interval overlaps and converts millimeters to inches', () => {
  const a = Date.parse('2026-09-04T04:00:00Z');
  assert.equal(gridQpf(grid, a, a + 24 * H), .1);
  assert.equal(gridQpf({ quantitativePrecipitation: { uom: 'wmoUnit:in', values: [{ validTime: '2026-09-04T04:00:00Z/PT6H', value: 1 }] } }, a + 3 * H, a + 6 * H), .5);
  assert.equal(gridQpf({}, a, a + H), null);
  assert.equal(gridQpf(grid, a - H, a + H), null);
});
test('blend renormalizes available sources without substituting zero', () => {
  assert.equal(guidanceBlend(1, 2).value, 1.4);
  assert.deepEqual(guidanceBlend(null, 2).sources, [{ name: 'ECMWF IFS', weight: 1 }]);
  assert.equal(guidanceBlend(null, null).value, null);
  assert.equal(guidanceBlend(0, 0).value, 0);
  assert.equal(guidanceBlend(1, 2).calibrated, false);
});
test('model normalization checks units, nulls and finite horizon', () => {
  const m = model(); assert.ok(normalizeModel(m, now, 48).length > 0);
  assert.ok(normalizeModel(m, now, 48).every((r) => r.time <= now + 48 * H));
  m.hourly_units.temperature_2m = '°C'; assert.deepEqual(normalizeModel(m, now), []);
});
test('radar frames come only from advertised timestamps', () => {
  assert.deepEqual(parseRadarTimes('<Dimension name="time">2026-09-05T15:00:00Z,2026-09-05T15:10:00Z</Dimension>', now), ['2026-09-05T15:00:00.000Z', '2026-09-05T15:10:00.000Z']);
  assert.deepEqual(parseRadarTimes('<xml/>', now), []);
  assert.deepEqual(parseRadarTimes('<Dimension name="time">2024-01-01T00:00:00Z</Dimension>', now), []);
  const range = parseRadarTimes('<Dimension name="time">2026-09-05T14:00:00Z/2026-09-05T16:00:00Z/PT2M</Dimension>', now);
  assert.ok(range.length <= 13); assert.equal(range.at(-1), '2026-09-05T16:00:00.000Z');
});
test('cache de-duplicates in-flight requests, expires entries and bounds size', async () => {
  let t = 0, calls = 0; const cache = new Cache(2, () => t);
  const load = async () => { calls += 1; return 42; };
  assert.deepEqual(await Promise.all([cache.get('a', 5, load), cache.get('a', 5, load)]), [42, 42]);
  assert.equal(calls, 1); t = 6; await cache.get('a', 5, load); assert.equal(calls, 2);
  await cache.get('b', 5, load); await cache.get('c', 5, load); assert.equal(cache.values.size, 2);
});
test('NWS fallback keeps probability separate and uses the remaining precipitation window', () => {
  const f = buildForecast(inputs);
  assert.equal(f.days[0].high, 84); assert.equal(f.days[0].low, 65);
  assert.equal(f.days[0].popDay, 0); assert.equal(f.days[0].pop, 30); assert.equal(f.days[0].qpf, .079);
  assert.equal(f.current.type, 'observation'); assert.equal(f.days[0].qpfWindow.end, '2026-09-06T11:00:00.000Z');
  assert.equal(f.hours[0].pop, 0); assert.equal(f.hours[0].precipitation, .004);
  assert.ok(Date.parse(f.solar.sunset) > Date.parse('2026-09-05T23:30:00Z'));
  assert.ok(Date.parse(f.solar.sunset) < Date.parse('2026-09-05T23:45:00Z'));
});
test('empty feeds never create zero rain or high-confidence claims', () => {
  const f = buildForecast({ ...inputs, forecast: null, hourly: null, grid: null, observation: null, discussion: null, models: { hrrr: null, ecmwf: null, nbm: null } });
  assert.equal(f.days[0].qpf, null); assert.equal(f.days[0].high, null); assert.equal(f.days[0].pop, null);
  assert.equal(f.days[0].agreement, 'Limited guidance'); assert.equal(f.current.temperature, null);
});
test('source signature changes for temperature and discussion revisions, not retrieval time', () => {
  const a = buildForecast(inputs), b = buildForecast({ ...inputs, forecast: { periods: periods.map((p, i) => i ? p : { ...p, temperature: 99 }) } });
  assert.notEqual(a.signature, b.signature);
  assert.notEqual(a.signature, buildForecast({ ...inputs, discussion: { ...inputs.discussion, text: 'Revised official discussion' } }).signature);
  assert.equal(a.signature, buildForecast({ ...inputs, feeds: inputs.feeds.map((f) => ({ ...f, fetchedAt: '2026-09-05T16:01:00Z' })) }).signature);
});
function response(data) { return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }); }
function mockFetch(url, options) {
  const u = new URL(url);
  if (u.hostname === 'raw.githubusercontent.com' && u.pathname.includes('/models/')) return response(snapshot(u.pathname.split('/').at(-1).replace('.json','')));
  if (u.pathname.startsWith('/points/')) return response({ properties: { ...inputs.point, forecast: 'https://api.weather.gov/gridpoints/RAH/1,1/forecast', forecastHourly: 'https://api.weather.gov/gridpoints/RAH/1,1/forecast/hourly', forecastGridData: 'https://api.weather.gov/gridpoints/RAH/1,1', relativeLocation: { properties: { city: 'Knightdale', state: 'NC' } } } });
  if (u.pathname.endsWith('/forecast/hourly')) return response({ properties: { periods: hourlyPeriods } });
  if (u.pathname.endsWith('/forecast')) return response({ properties: { periods, updateTime: '2026-09-05T14:00:00Z' } });
  if (u.pathname === '/gridpoints/RAH/1,1') return response({ properties: grid });
  if (u.pathname === '/alerts/active') return response({ features: [] });
  if (u.pathname.includes('/products/types/AFD/')) return response({ '@graph': [{ '@id': 'https://api.weather.gov/products/test-afd', productCode: 'AFD', issuanceTime: '2026-09-05T14:00:00Z' }] });
  if (u.pathname === '/products/test-afd') return response({ id: 'test-afd', issuanceTime: '2026-09-05T14:00:00Z', productText: inputs.discussion.text });
  if (u.hostname === 'api.openai.com') return response({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ headline: 'A partly sunny day ahead', summary: 'Partly sunny conditions remain favored. A weak front could bring showers tomorrow.', nearTerm: 'Clouds will linger overnight.', extended: 'The next front brings a less settled pattern.', uncertainty: 'Shower coverage remains uncertain.', sources: ['nws', 'afd', 'hrrr', 'ecmwf', 'nbm'] }) }] }] });
  throw new Error(`Unexpected URL ${url}`);
}
test('service fetches latest matching AFD, exposes no credentials, and uses named models', async () => {
  const calls = [];
  const service = createWeatherService({ now: () => now, env: { OPEN_METEO_API_KEY: 'TEST-SECRET-DO-NOT-EXPOSE' }, fetchImpl: async (...args) => { calls.push(args); return mockFetch(...args); } });
  const f = await service.getForecast({ location: 'knightdale' });
  assert.equal(f.discussion.office, 'RAH'); assert.ok(f.discussion.text.includes('TEST FIXTURE'));
  assert.ok(calls.some(([url]) => url.includes('/models/hrrr.json'))); assert.ok(calls.some(([url]) => url.includes('/models/ecmwf.json')));
  assert.ok(!JSON.stringify(f).includes('TEST-SECRET'));
  for (const id of ['hrrr', 'ecmwf', 'nbm']) assert.equal(f.feeds.find((feed) => feed.id === id).status, 'ready');
  assert.ok(calls.every(([, options]) => options.redirect === 'error'));
});
test('direct NOAA/ECMWF data works without an intermediary API key', async () => {
  const calls = [];
  const s = createWeatherService({ now: () => now, env: {}, fetchImpl: async (...args) => { calls.push(args[0]); return mockFetch(...args); } });
  const f = await s.getForecast({ location: 'knightdale' });
  assert.equal(f.feeds.find((x) => x.id === 'hrrr').status, 'ready'); assert.ok(calls.every((u) => !u.includes('open-meteo')));
  const b = await s.getBriefing({ location: 'knightdale' }); assert.equal(b.mode, 'nws-summary');
});
test('briefing rejects mismatched snapshots and never displays stale AI as current', async () => {
  const s = createWeatherService({ now: () => now, env: {}, fetchImpl: mockFetch });
  await assert.rejects(() => s.getBriefing({ location: 'knightdale', signature: 'wrong' }), (e) => e.status === 409);
});
test('AI uses Responses API, validates its sources, and is cached by signature', async () => {
  let count = 0; const s = createWeatherService({ now: () => now, env: { OPENAI_API_KEY: 'TEST-KEY', WEATHER_FUSION_NONCOMMERCIAL: 'true' }, fetchImpl: async (url, options) => {
    if (url.includes('api.openai.com')) { count += 1; const b = JSON.parse(options.body); assert.equal(b.store, false); assert.equal(b.text.format.strict, true); assert.ok(b.input.includes('TEST FIXTURE')); const facts=JSON.parse(b.input); assert.equal(facts.modelContributions.length,3); assert.ok(facts.days[0].highBlend.sources.some(x=>x.id==='hrrr')); assert.ok(facts.next24HoursPrecipitation.sources.some(x=>x.id==='ecmwf')); }
    return mockFetch(url, options);
  } });
  assert.equal((await s.getBriefing({ location: 'knightdale' })).mode, 'ai');
  assert.equal((await s.getBriefing({ location: 'knightdale' })).mode, 'ai'); assert.equal(count, 1);
});
test('invalid numerical AI prose falls back to NWS text', async () => {
  const s = createWeatherService({ now: () => now, env: { OPENAI_API_KEY: 'TEST', WEATHER_FUSION_NONCOMMERCIAL: 'true' }, fetchImpl: async (url, options) => {
    if (url.includes('api.openai.com')) return response({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"headline":"Temperature 999","summary":"bad","nearTerm":"bad","extended":"bad","uncertainty":"bad","sources":["nws","afd"]}' }] }] });
    return mockFetch(url, options);
  } });
  const b = await s.getBriefing({ location: 'knightdale' }); assert.equal(b.mode, 'nws-summary'); assert.ok(!JSON.stringify(b).includes('999'));
});
test('fresh NWS forecast and AFD are required for AI', async () => {
  let aiCalled = false;
  const s = createWeatherService({ now: () => now, env: { OPENAI_API_KEY: 'TEST' }, fetchImpl: async (url, options) => { if (url.includes('/products/')) throw new Error('outage'); if (url.includes('api.openai.com')) aiCalled = true; return mockFetch(url, options); } });
  const b = await s.getBriefing({ location: 'knightdale' }); assert.equal(b.mode, 'nws-summary'); assert.equal(aiCalled, false);
});
test('weather routes register without changing any existing route', () => {
  const routes = []; registerWeatherFusionRoutes({ get: (...args) => routes.push(args) }, { env: {}, fetchImpl: mockFetch });
  assert.ok(routes.some(([p]) => Array.isArray(p) && p.includes('/weather-fusion')));
  assert.ok(routes.some(([p]) => p === '/api/weather-fusion/forecast'));
  assert.ok(!routes.some(([p]) => p === '/'));
});
