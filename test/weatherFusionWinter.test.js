import test from 'node:test';
import assert from 'node:assert/strict';
import { addSnowOutlook, wpcProbabilityRange, WPC_LAYERS, createWpcWinterService } from '../src/weatherFusionSnow.js';
import { winterWeights, winterIntervalAmount, blendWinterAmounts, normalizeWinterModel, normalizeWinterProbabilities, winterModelUrl } from '../src/weatherFusionWinterModels.js';
const H = 3600000, now = Date.parse('2026-10-14T12:00:00Z');
const location = { latitude: 35.787, longitude: -78.4806, timeZone: 'America/New_York' };
const output = dates => ({ location, days: dates.map(date => ({ date, label: date })), hours: [], riskOutlooks: [] });
const intervals = (start, count, value) => Array.from({ length: count }, (_, index) => ({ start: start + index * H, end: start + (index + 1) * H, value }));

test('winter amount policy switches at the next 24-hour boundary and keeps requested missing coverage', () => {
  assert.deepEqual(winterWeights(new Date(now + 23 * H).toISOString(), now), { wpc: 60, hrrr: 25, nam: 15 });
  assert.deepEqual(winterWeights(new Date(now + 24 * H).toISOString(), now), { wpc: 60, ecmwf: 20, weathernext: 10, gfs: 10 });
  const result = blendWinterAmounts({ wpc: null, hrrr: 4, nam: 2 }, { wpc: 60, hrrr: 25, nam: 15 });
  assert.equal(result.value, 3.25); assert.equal(result.coverage, 40);
  assert.deepEqual(result.actualWeights, { wpc: 0, hrrr: 62.5, nam: 37.5 });
  assert.equal(result.status, 'partial');
  const dry = blendWinterAmounts({ hrrr: 0, nam: 0 }, { wpc: 60, hrrr: 25, nam: 15 });
  assert.equal(dry.value, 0); assert.equal(dry.coverage, 40);
  assert.equal(blendWinterAmounts({}, { wpc: 60, hrrr: 25, nam: 15 }).value, null);
});

test('snowfall integration prorates boundaries and rejects missing or overlapping model hours', () => {
  const rows = intervals(now, 3, 1);
  assert.equal(winterIntervalAmount(rows, now + H / 2, now + 2.5 * H).value, 2);
  assert.equal(winterIntervalAmount([rows[0], rows[2]], now, now + 3 * H).value, null);
  assert.equal(winterIntervalAmount([...rows, rows[1]], now, now + 3 * H).value, null);
  assert.equal(winterIntervalAmount(intervals(now, 3, 0), now, now + 3 * H).value, 0);
});

test('NBM native type probabilities remain separate from snowfall weights and missing values', () => {
  const times = Array.from({ length: 24 }, (_, i) => (now + (i + 1) * H) / 1000);
  const data = { latitude: location.latitude, longitude: location.longitude, hourly_units: { time: 'unixtime', snowfall_probability: '%', freezing_rain_probability: '%', ice_pellets_probability: '%' }, hourly: { time: times, snowfall_probability: times.map((_, i) => i === 0 ? 80 : 20), freezing_rain_probability: times.map(() => 35), ice_pellets_probability: times.map(() => null) } };
  const probability = normalizeWinterProbabilities(data, { last_run_initialisation_time: now / 1000 }, location, now);
  const out = output(['2026-10-14']);
  addSnowOutlook(out, { now, winterModels: { probabilities: probability, hrrr: { intervals: intervals(now, 30, 0), label: 'HRRR' }, nam: { intervals: intervals(now, 30, 0), label: 'NAM' } } });
  const day = out.snow.days[0];
  assert.equal(day.snowChance, 80); assert.equal(day.freezingRainChance, 35); assert.equal(day.sleetChance, null);
  assert.equal(day.probabilitySource, 'NWS NBM'); assert.match(day.probabilityMethod, /not a combined daily/);
  assert.deepEqual(day.blend.weights, { wpc: 60, hrrr: 25, nam: 15 });
  assert.equal(day.blend.coverage, 40); assert.equal(day.snowExpected, true);
  assert.equal(day.sleetPossible, false);
  assert.throws(() => normalizeWinterProbabilities({ ...data, hourly_units: { ...data.hourly_units, snowfall_probability: 'mm' } }, { last_run_initialisation_time: now / 1000 }, location, now), /units/);
});

test('lack of winter guidance is unavailable and freezing-rain wording alone does not trigger snow artwork', () => {
  const unknown = output(['2026-10-14']); addSnowOutlook(unknown, { now });
  assert.equal(unknown.snow.status, 'unavailable'); assert.equal(unknown.snow.days[0].best, null);
  assert.equal(unknown.snow.days[0].snowChance, null);
  const ice = output(['2026-10-14']);
  addSnowOutlook(ice, { now, periods: [{ startTime: '2026-10-14T12:00:00Z', endTime: '2026-10-14T18:00:00Z', shortForecast: 'Freezing Rain', probabilityOfPrecipitation: { value: 90 } }] });
  assert.equal(ice.snow.possible, true); assert.equal(ice.snow.days[0].freezingRainPossible, true);
  assert.equal(ice.snow.days[0].snowExpected, false); assert.equal(ice.snow.days[0].freezingRainChance, null);
});

test('WPC threshold categories are retained as ranges and never supply snowfall amounts', async () => {
  assert.deepEqual(wpcProbabilityRange('Moderate (40-69%)'), [40, 69]);
  assert.deepEqual(wpcProbabilityRange('Slight'), [10, 39]);
  assert.equal(wpcProbabilityRange('not available'), null);
  assert.deepEqual(WPC_LAYERS.filter(row => row[3] === 'ice').map(row => row[0]), [4, 9, 14]);
  const cached = async url => ({ fetchedAt: new Date(now).toISOString(), data: { features: [{ attributes: { outlook: 'High', dn: 3, start_time: '2026-10-14 12:00:00', end_time: '2026-10-15 12:00:00', issue_time: '2026-10-14 10:00:00', qpf: 1.5 } }] } });
  const service = createWpcWinterService({ cached, now: () => now });
  const source = await service(location);
  assert.equal(source.value.amounts.length, 0); assert.equal(source.value.amountStatus, 'unavailable');
  assert.ok(source.value.maps.some(map => map.unit === 'in' && map.id === 'wpc-qpf-day1'));
  const out = output(['2026-10-14']); addSnowOutlook(out, { now, wpcWinter: source.value });
  assert.equal(out.snow.days[0].best, null);
  assert.equal(out.snow.days[0].snowChance, null);
  assert.deepEqual(out.snow.days[0].wpc[0].probabilityRange, [70, 100]);
});

test('named models use verified identifiers, convert depth, and retain independent freezing-rain evidence', () => {
  assert.equal(new URL(winterModelUrl('nam', location)).searchParams.get('models'), 'ncep_nam_conus');
  assert.equal(new URL(winterModelUrl('nam', location)).searchParams.get('hourly'), 'snowfall,weather_code');
  assert.equal(new URL(winterModelUrl('gfs', location)).searchParams.get('models'), 'ncep_gfs_global');
  for (const id of ['ecmwf', 'gfs', 'hrrr', 'nam']) assert.equal(new URL(winterModelUrl(id, location)).searchParams.get('hourly'), 'snowfall,weather_code');
  const times = Array.from({ length: 24 }, (_, i) => (now + (i + 1) * H) / 1000);
  const data = { latitude: location.latitude, longitude: location.longitude, hourly_units: { time: 'unixtime', snowfall: 'cm' }, hourly: { time: times, snowfall: times.map((_, i) => i === 1 ? null : 2.54), weather_code: times.map(() => 66), categorical_freezing_rain: times.map(() => 1) } };
  const model = normalizeWinterModel(data, { last_run_initialisation_time: now / 1000 }, 'hrrr', location, now);
  assert.ok(Math.abs(model.intervals[0].value - 1) < 1e-9); assert.equal(model.intervals[1].value, null);
  assert.equal(model.intervals[1].freezingRainSignal, true);
  assert.equal(winterIntervalAmount(model.intervals, now, now + 24 * H).value, null);
  assert.throws(() => normalizeWinterModel(data, { last_run_initialisation_time: (now - 13 * H) / 1000 }, 'hrrr', location, now), /stale/);
});

test('next 24-hour window is stable for map point lookups made during the same hour', () => {
  const a = output(['2026-10-14']), b = output(['2026-10-14']);
  addSnowOutlook(a, { now: now + 10 * 60000 }); addSnowOutlook(b, { now: now + 12 * 60000 });
  assert.equal(a.snow.blendWindows[0].start, b.snow.blendWindows[0].start);
  assert.equal(a.snow.blendWindows[0].end, b.snow.blendWindows[0].end);
});

test('partial-day ranges do not mix elapsed snowfall with remaining model windows', () => {
  const out = output(['2026-10-14']);
  addSnowOutlook(out, { now, grid: { snowfallAmount: { uom: 'wmoUnit:mm', values: [{ validTime: '2026-10-14T04:00:00Z/PT6H', value: 254 }] } }, winterModels: { hrrr: { label: 'HRRR', intervals: intervals(now, 30, .1) }, nam: { label: 'NAM', intervals: intervals(now, 30, .1) } } });
  const row = out.snow.days[0];
  assert.equal(row.range, null);
  assert.deepEqual(row.calendarRange, [1.6, 10]);
  assert.equal(row.best, 1.6);
  assert.equal(row.nwsCovered, false);
});
