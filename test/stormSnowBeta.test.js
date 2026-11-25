import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildStormSnowSnapshot, compareStormSnowSnapshots, createStormSnowBetaService } from '../src/weatherFusionBeta.js';
import { accumulationMapDescriptors } from '../public/weather-fusion/v3/js/storm-and-snow-beta.js';

const now = Date.parse('2026-11-25T20:00:00.000Z');
const hour = (time, precipIn, rainChance, condition = 'Rain') => ({ time, precipIn, rainChance, condition });

function forecast(overrides = {}) {
  return {
    version: 'weather-nourie-fusion-v3',
    signature: overrides.signature || 'forecast-a',
    assembledAt: overrides.assembledAt || '2026-11-25T20:00:00.000Z',
    fetchedAt: overrides.fetchedAt || '2026-11-25T20:01:00.000Z',
    timeZone: 'America/New_York',
    location: { name: 'Raleigh, NC', latitude: 35.787, longitude: -78.481, timeZone: 'America/New_York' },
    hours: [
      hour('2026-11-25T21:00:00.000Z', overrides.precip1 ?? 0.1, 45),
      hour('2026-11-25T22:00:00.000Z', overrides.precip2 ?? 0.2, overrides.rainChance ?? 70),
      { time: '2026-11-26T18:00:00.000Z', condition: 'Cloudy' },
    ],
    days: [
      { dayKey: '2026-11-25', dayName: 'Today', totalQpfIn: 0.9, rainChance: 35, confidence: { level: 'medium', score: 62 } },
      { dayKey: '2026-11-26', dayName: 'Thu', confidence: { level: 'low', score: 40 } },
    ],
    canonical: {
      snow: {
        days: [{
          date: '2026-11-25',
          displaySnowfall: { value: overrides.snowAmount ?? 2.3, range: [1, 4], source: 'WPC expected snowfall' },
          snowChance: overrides.snowChance ?? 60,
          snowExpected: true,
          snowEventWindows: [{ start: '2026-11-25T22:00:00.000Z', end: '2026-11-26T04:00:00.000Z', source: 'NWS event window' }],
          wpc: [{ inches: 1, probabilityRange: [40, 69], start: '2026-11-25T18:00:00.000Z', end: '2026-11-26T18:00:00.000Z' }],
        }],
        version: 'snow-v1',
      },
    },
    ...overrides,
  };
}

test('snapshot preserves real hourly rain amounts and keeps missing amounts unavailable', () => {
  const snapshot = buildStormSnowSnapshot(forecast(), now);
  assert.equal(snapshot.days[0].rain.amount, 0.3);
  assert.equal(snapshot.days[0].rain.chance, 70);
  assert.equal(snapshot.days[1].rain.amount, null);
  assert.equal(snapshot.days[0].snow.amount, 2.3);
  assert.deepEqual(snapshot.days[0].snow.range, [1, 4]);
  assert.equal(snapshot.days[0].snow.chanceKind, 'peak hourly snow-type occurrence');
});

test('beta history deduplicates an issued forecast and records a later revision', () => {
  let clock = now;
  const service = createStormSnowBetaService({ now: () => clock });
  service.recordForecast(forecast());
  service.recordForecast(forecast());
  clock += 3600000;
  service.recordForecast(forecast({ signature: 'forecast-b', assembledAt: '2026-11-25T21:00:00.000Z', precip1: 0.4, precip2: 0.5, snowAmount: 3.1 }));
  const history = service.getHistory({ latitude: 35.787, longitude: -78.481, center: 'rain', date: '2026-11-25' });
  assert.equal(history.snapshots.length, 2);
  assert.equal(history.snapshots[0].day.rain.amount, 0.3);
  assert.equal(history.snapshots[1].day.rain.amount, 0.9);
  assert.equal(history.thresholds.rainAmountIn, 0.25);
});

test('material-change comparison uses amount, probability and timing thresholds', () => {
  const first = buildStormSnowSnapshot(forecast(), now);
  const second = buildStormSnowSnapshot(forecast({ signature: 'forecast-b', assembledAt: '2026-11-25T21:00:00.000Z', precip1: 0.4, precip2: 0.5, rainChance: 90 }), now + 3600000);
  const previous = { day: first.days[0] };
  const current = { day: second.days[0] };
  const change = compareStormSnowSnapshots(previous, current, 'rain');
  assert.equal(change.amountDelta, 0.6);
  assert.equal(change.probabilityDelta, 20);
  assert.equal(change.material, true);
  assert.equal(change.materialAmount, true);
  assert.equal(change.materialProbability, true);
});

test('beta UI contains functional data paths and no interim placeholder contract', () => {
  const source = fs.readFileSync(new URL('../public/weather-fusion/v3/js/storm-and-snow-beta.js', import.meta.url), 'utf8');
  for (const required of ['Rain Central', 'Snow Central', '/api/weather-fusion/storm-snow/history', '/api/weather-fusion/radar', '/api/weather-fusion/accuracy', 'calibrated distribution']) assert.ok(source.includes(required));
  assert.doesNotMatch(source, /not wired into this beta|Forecast history pending|regional beta layer pending/);
});

test('accumulation map selection excludes radar and snow probability layers', () => {
  const day = { dayKey: '2026-11-25', hours: [{ time: '2026-11-25T20:00:00Z' }, { time: '2026-11-25T21:00:00Z' }] };
  const common = { start: '2026-11-25T18:00:00Z', end: '2026-11-26T18:00:00Z' };
  const forecastData = { timeZone: 'America/New_York', days: [day], canonical: { snow: { days: [{ date: day.dayKey }], maps: [
    { id: 'wpc-qpf-day1', kind: 'arcgis', unit: 'in', ...common },
    { id: 'wpc-snow-day1-4', kind: 'arcgis', unit: '%', ...common },
    { id: 'model-snow-grid', kind: 'geojson', quantity: 'snowfall', unit: 'in', ...common },
    { id: 'radar', kind: 'radar', ...common },
    { id: 'old-qpf', kind: 'arcgis', unit: 'in', start: '2026-11-20T18:00:00Z', end: '2026-11-21T18:00:00Z' },
  ] } } };
  assert.deepEqual(accumulationMapDescriptors(forecastData, day, 'rain').map(item => item.id), ['wpc-qpf-day1']);
  assert.deepEqual(accumulationMapDescriptors(forecastData, day, 'snow').map(item => item.id), ['model-snow-grid']);
});
