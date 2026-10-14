import test from 'node:test';
import assert from 'node:assert/strict';
import { PRERELEASE_WINTER_MODELS, PRERELEASE_WINTER_WEIGHTS, prereleaseWinterModelUrl, prereleaseWinterMetadataUrl,
  normalizePrereleaseWinterModel, sumPrereleaseWinterIntervals, prereleaseWinterPeriod, createPrereleaseWinterService } from '../src/weatherFusionPrereleaseWinter.js';

const HOUR = 3600000, now = Date.parse('2026-10-14T10:30:00Z'), location = { latitude: 42.36, longitude: -71.06 };
const iso = value => new Date(value).toISOString(), whole = Math.floor(now / HOUR) * HOUR;
function fixture(id = 'hrrr', options = {}) {
  const run = Date.parse('2026-10-14T06:00:00Z'), hours = options.hours ?? 240;
  const times = Array.from({ length: hours }, (_, i) => (whole + i * HOUR) / 1000);
  const forecast = { fetchedAt: iso(now), data: { latitude: location.latitude, longitude: location.longitude, utc_offset_seconds: 0,
    hourly_units: { time: 'unixtime', snowfall: 'cm' }, hourly: { time: times, snowfall: times.map(() => options.value ?? 2.54) } } };
  const metadata = { fetchedAt: iso(now), data: { last_run_initialisation_time: run / 1000,
    last_run_modification_time: (run + HOUR) / 1000, last_run_availability_time: (run + 2 * HOUR) / 1000,
    data_end_time: (run + PRERELEASE_WINTER_MODELS[id].horizonHours * HOUR) / 1000,
    temporal_resolution_seconds: id === 'ecmwf' ? 10800 : 3600, update_interval_seconds: id === 'hrrr' ? 3600 : 21600 } };
  return { forecast, metadata };
}
function normalized(id = 'hrrr', options) { const { forecast, metadata } = fixture(id, options); return normalizePrereleaseWinterModel(forecast, metadata, id, location, now); }
function interval(start, value = 1) { return { start: iso(start), end: iso(start + HOUR), value, unit: 'inches' }; }

test('explicit named model URLs prevent seamless substitutions and match metadata domains', () => {
  for (const [id, model] of Object.entries(PRERELEASE_WINTER_MODELS)) {
    const url = new URL(prereleaseWinterModelUrl(id, location));
    assert.equal(url.searchParams.get('models'), model.model);
    assert.equal(url.searchParams.get('hourly'), 'snowfall');
    assert.equal(url.searchParams.get('cell_selection'), 'nearest');
    assert.equal(url.searchParams.get('timeformat'), 'unixtime');
    assert.match(prereleaseWinterMetadataUrl(id), new RegExp(`/data/${model.model}/static/meta.json$`));
  }
  assert.equal(PRERELEASE_WINTER_MODELS.gfs.model, 'ncep_gfs013');
  assert.match(PRERELEASE_WINTER_MODELS.nam.label, /nest/);
  assert.throws(() => prereleaseWinterModelUrl('best_match', location));
  assert.throws(() => prereleaseWinterModelUrl('constructor', location));
  for (const invalid of [null, { latitude: 100, longitude: 0 }, { latitude: '42', longitude: 0 }, { latitude: 0, longitude: 181 }]) assert.throws(() => prereleaseWinterModelUrl('hrrr', invalid));
});
test('snowfall converts cm without hourly rounding and retains preceding-hour intervals', () => {
  const source = normalized();
  assert.equal(source.status, 'ready');
  assert.equal(source.unit, 'inches');
  assert.equal(source.statistic, 'deterministic-amount');
  assert.equal(source.intervals[0].start, iso(whole));
  assert.equal(source.intervals[0].end, iso(whole + HOUR));
  assert.equal(source.intervals[0].value, 1);
  assert.equal(source.intervals.at(-1).end, '2026-10-16T06:00:00.000Z');
  assert.deepEqual(source.probabilities, { snow: null, freezingRain: null, sleet: null });
  assert.equal(source.issuedAt, null); assert.equal(source.initializedAt, null);
  assert.equal(source.metadata.forecastRunBound, false);
  assert.equal(source.metadata.latestRunAt, '2026-10-14T06:00:00.000Z');
  const tiny = normalized('ecmwf', { value: .001 });
  const total = sumPrereleaseWinterIntervals(tiny.intervals, iso(whole), iso(whole + 24 * HOUR));
  assert.ok(Math.abs(total.value - .001 / 2.54 * 24) < 1e-12);
});
test('real zero remains numeric, missing values remain missing, all-null stays unavailable', () => {
  const zero = normalized('nam', { value: 0 });
  assert.equal(zero.status, 'ready'); assert.equal(zero.intervals[0].value, 0);
  const { forecast, metadata } = fixture('nam');
  forecast.data.hourly.snowfall[2] = null;
  const partial = normalizePrereleaseWinterModel(forecast, metadata, 'nam', location, now);
  assert.equal(partial.status, 'partial'); assert.equal(partial.intervals[1].value, null);
  assert.equal(sumPrereleaseWinterIntervals(partial.intervals, iso(whole), iso(whole + 3 * HOUR)).value, null);
  forecast.data.hourly.snowfall.fill(null);
  const absent = normalizePrereleaseWinterModel(forecast, metadata, 'nam', location, now);
  assert.equal(absent.status, 'unavailable'); assert.equal(absent.coveredHours, 0);
});
test('unit, numeric, position, offset and complete time-axis validation reject bad source data', () => {
  const mutations = [
    d => { d.hourly_units.snowfall = 'mm'; }, d => { d.hourly_units.snowfall = 'undefined'; },
    d => { d.hourly_units.time = 'iso8601'; }, d => { d.utc_offset_seconds = 3600; },
    d => { d.latitude += .5; }, d => { d.longitude = null; },
    d => { d.hourly.time[3] = d.hourly.time[2]; }, d => { d.hourly.time[3] += 3600; },
    d => { d.hourly.time[0] += .5; }, d => { d.hourly.time[0] += 1800; },
    d => { d.hourly.snowfall.pop(); }, d => { d.hourly.snowfall[2] = '0'; },
    d => { d.hourly.snowfall[2] = -1; }, d => { d.hourly.snowfall[2] = Infinity; },
    d => { d.hourly.snowfall[2] = 301; }, d => { d.error = true; },
  ];
  for (const mutation of mutations) {
    const { forecast, metadata } = fixture(); mutation(forecast.data);
    assert.throws(() => normalizePrereleaseWinterModel(forecast, metadata, 'hrrr', location, now));
  }
  const { forecast, metadata } = fixture(); forecast.data.hourly_units.snowfall = 'inch';
  assert.equal(normalizePrereleaseWinterModel(forecast, metadata, 'hrrr', location, now).intervals[0].value, 2.54);
});
test('separately fresh metadata never blesses a stale cached point forecast', () => {
  for (const change of ['old-point', 'future-point', 'missing-point', 'old-meta', 'old-run', 'future-run', 'availability-after-point', 'still-propagating', 'bad-resolution', 'bad-end']) {
    const { forecast, metadata } = fixture();
    if (change === 'old-point') forecast.fetchedAt = iso(now - HOUR);
    if (change === 'future-point') forecast.fetchedAt = iso(now + HOUR);
    if (change === 'missing-point') forecast.fetchedAt = null;
    if (change === 'old-meta') metadata.fetchedAt = iso(now - HOUR);
    if (change === 'old-run') metadata.data.last_run_initialisation_time = (now - 12 * HOUR) / 1000;
    if (change === 'future-run') metadata.data.last_run_initialisation_time = (whole + HOUR) / 1000;
    if (change === 'availability-after-point') metadata.data.last_run_availability_time = (now + 2 * 60000) / 1000;
    if (change === 'still-propagating') metadata.data.last_run_availability_time = (now - 5 * 60000) / 1000;
    if (change === 'bad-resolution') metadata.data.temporal_resolution_seconds = 1;
    if (change === 'bad-end') metadata.data.data_end_time = (now + 1000 * HOUR) / 1000;
    assert.throws(() => normalizePrereleaseWinterModel(forecast, metadata, 'hrrr', location, now), change);
  }
});
test('HRRR short cycles are capped at 18 hours, with no borrowed extended-cycle tail', () => {
  const { forecast, metadata } = fixture();
  const run = Date.parse('2026-10-14T07:00:00Z');
  metadata.data.last_run_initialisation_time = run / 1000;
  metadata.data.last_run_modification_time = (run + HOUR) / 1000;
  metadata.data.last_run_availability_time = (run + HOUR) / 1000;
  // A combined store can retain a tail from an earlier extended cycle.
  metadata.data.data_end_time = (run + 47 * HOUR) / 1000;
  const source = normalizePrereleaseWinterModel(forecast, metadata, 'hrrr', location, now);
  assert.equal(source.metadata.horizonHours, 18);
  assert.equal(source.coverageEnd, iso(run + 18 * HOUR));
  assert.equal(sumPrereleaseWinterIntervals(source.intervals, iso(whole), iso(whole + 24 * HOUR)).value, null);
});
test('complete interval totals reject duplicate, overlapping, missing and fractional hours', () => {
  const rows = [interval(whole), interval(whole + HOUR, 0), interval(whole + 2 * HOUR, 2)];
  assert.equal(sumPrereleaseWinterIntervals(rows, whole, whole + 3 * HOUR).value, 3);
  for (const changed of [rows.slice(0, 2), [...rows, rows[0]], [rows[0], rows[2]], rows.map((row, i) => i === 1 ? { ...row, value: null } : row), rows.map((row, i) => i === 1 ? { ...row, unit: 'cm' } : row), [{ ...rows[0], end: iso(whole + 2 * HOUR) }, ...rows.slice(1)]]) assert.equal(sumPrereleaseWinterIntervals(changed, whole, whole + 3 * HOUR).value, null);
  assert.equal(sumPrereleaseWinterIntervals(rows, whole + HOUR / 2, whole + 3 * HOUR).value, null);
  assert.equal(sumPrereleaseWinterIntervals(rows, whole, whole + 3.5 * HOUR).value, null);
  assert.equal(sumPrereleaseWinterIntervals(rows, whole, whole).value, null);
});
test('requested shares remain exact with null blend and null type-specific probabilities', () => {
  const sources = Object.fromEntries(Object.keys(PRERELEASE_WINTER_MODELS).map(id => [id, normalized(id)]));
  const near = prereleaseWinterPeriod(sources, iso(whole + HOUR), iso(whole + 12 * HOUR), now);
  assert.deepEqual(near.requestedBlend.requestedWeights, { wpc: .6, hrrr: .25, nam: .15 });
  assert.equal(near.sourceAmounts.hrrr.value, 11); assert.equal(near.sourceAmounts.nam.value, 11);
  assert.equal(near.requestedBlend.value, null); assert.deepEqual(near.requestedBlend.missingSources, ['wpc']);
  const later = prereleaseWinterPeriod(sources, iso(whole + 25 * HOUR), iso(whole + 49 * HOUR), now);
  assert.deepEqual(later.requestedBlend.requestedWeights, { wpc: .6, ecmwf: .2, weathernext: .1, gfs: .1 });
  assert.equal(later.sourceAmounts.ecmwf.value, 24); assert.equal(later.sourceAmounts.gfs.value, 24);
  assert.equal(later.requestedBlend.value, null); assert.deepEqual(later.probabilities, { snow: null, freezingRain: null, sleet: null });
  const crossing = prereleaseWinterPeriod(sources, iso(whole + 24 * HOUR), iso(whole + 25 * HOUR), now);
  assert.equal(crossing.kind, 'split-required'); assert.equal(crossing.requestedBlend.requestedWeights, null);
  assert.deepEqual(PRERELEASE_WINTER_WEIGHTS.within24h, { wpc: .6, hrrr: .25, nam: .15 });
});
test('service is opt-in, isolates source failures and never substitutes NDFD or probabilities', async () => {
  const calls = [];
  const service = createPrereleaseWinterService({ now: () => now, cached: async (url, ttl, options) => {
    calls.push({ url, ttl, options });
    const id = Object.keys(PRERELEASE_WINTER_MODELS).find(id => url.includes(PRERELEASE_WINTER_MODELS[id].model));
    if (id === 'nam') throw new Error('Test source failure');
    const records = fixture(id, { value: 0 });
    return url.endsWith('/meta.json') ? records.metadata : records.forecast;
  } });
  assert.equal(calls.length, 0);
  const result = await service(location);
  assert.equal(calls.length, 8);
  assert.ok(calls.every(call => call.url.startsWith('https://api.open-meteo.com/')));
  assert.equal(result.value.sources.nam.status, 'unavailable');
  assert.equal(result.value.sources.hrrr.status, 'ready');
  assert.equal(result.value.sources.wpc.value, null); assert.equal(result.value.sources.weathernext.value, null);
  assert.equal(result.value.sources.wpc.intervals.length, 0);
  assert.equal(result.value.requestedBlend.value, null);
  assert.equal(Object.hasOwn(result.value, 'periods'), false); assert.equal(result.value.windows.length, 7);
  assert.equal(result.value.windows[0].start, iso(whole + HOUR));
  assert.equal(result.value.windows[0].end, iso(whole + 25 * HOUR));
  assert.equal(result.value.windows[0].sourceAmounts.ecmwf.value, 0);
  assert.equal(result.value.windows[0].kind, 'split-required');
  assert.equal(result.meta.length, 6);
  assert.ok(result.meta.every(row => row.issuedAt === null && row.initializedAt === null && row.forecastRunBound === false));
  assert.equal(JSON.stringify(result).includes('NaN'), false);
});
