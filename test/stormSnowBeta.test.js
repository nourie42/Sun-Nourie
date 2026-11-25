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
  const app = fs.readFileSync(new URL('../public/weather-fusion/v3/js/app.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../public/weather-fusion/v3/index.html', import.meta.url), 'utf8');
  for (const required of ['Rain Central', 'Snow Central', '/api/weather-fusion/storm-snow/history', '/api/weather-fusion/radar', '/api/weather-fusion/accuracy', 'calibrated distribution']) assert.ok(source.includes(required));
  assert.doesNotMatch(source, /not wired into this beta|Forecast history pending|regional beta layer pending/);
  assert.match(app, /storm-and-snow-beta\.js\?v=storm-snow-beta-v5/);
  assert.match(page, /app\.js\?v=storm-snow-beta-v5/);
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

import { buildStormModel, horizonWindow, rainSummary, snowSummary, parseSnowRange, historyTrend, qpfBand, contourValueAt, rangeText } from '../public/weather-fusion/v3/js/storm-and-snow-beta.js';

const zone = 'America/Chicago';
const at = iso => Date.parse(iso);
function stormForecast() {
  // Wed 11 AM CST (17Z). Hourly precipitation every hour through Fri 10 AM.
  const hours = [];
  for (let i = 0; i < 48; i += 1) {
    const time = new Date(at('2026-11-25T17:00:00Z') + i * 3600000).toISOString();
    hours.push({ time, precipitation: 0.05, pop: 90, temperature: 33, condition: i < 16 ? 'Snow' : 'Rain', precipitationBlend: { sources: [{ id: 'nws', value: 0.04 }, { id: 'ecmwf', value: 0.06 }] } });
  }
  return {
    timeZone: zone, location: { name: 'St. Louis, MO', latitude: 38.6, longitude: -90.2, timeZone: zone }, current: {},
    canonical: {
      assembledAt: '2026-11-25T17:00:00Z', hours,
      days: ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30'].map((date, index) => ({ date, qpf: index === 2 ? 1.2 : index > 2 ? 0.3 : 0.6, pop: 80, confidence: { score: 80, label: 'Moderate' }, qpfBlend: { sources: [{ id: 'nws', value: 0.2 }, { id: 'ecmwf', value: 0.4 }] } })),
      snow: { days: [
        { date: '2026-11-25', nwsRawIntervals: [{ start: '2026-11-25T18:00:00Z', end: '2026-11-26T00:00:00Z', value: 0.5 }, { start: '2026-11-26T00:00:00Z', end: '2026-11-26T06:00:00Z', value: 3.2 }],
          periods: [{ name: 'Today', start: '2026-11-25T11:00:00-06:00', end: '2026-11-25T18:00:00-06:00', wording: 'Rain And Snow', detail: 'New snow accumulation of less than one inch possible.', snowWording: true, pop: 94 },
                    { name: 'Tonight', start: '2026-11-25T18:00:00-06:00', end: '2026-11-26T06:00:00-06:00', wording: 'Snow', detail: 'New snow accumulation of 3 to 7 inches possible.', snowWording: true, pop: 100 }],
          snowEventWindows: [{ start: '2026-11-25T18:00:00Z', end: '2026-11-26T12:00:00Z' }] },
        { date: '2026-11-26', nwsRawIntervals: [{ start: '2026-11-26T06:00:00Z', end: '2026-11-26T12:00:00Z', value: 2.1 }, { start: '2026-11-26T12:00:00Z', end: '2026-11-26T18:00:00Z', value: 0.1 }] },
      ] },
    },
  };
}

test('NWS snow wording becomes an official range', () => {
  assert.deepEqual(parseSnowRange('Snow. New snow accumulation of 3 to 7 inches possible.'), [3, 7]);
  assert.deepEqual(parseSnowRange('Total daytime snow accumulation of less than a half inch possible.'), [0, 0.5]);
  assert.deepEqual(parseSnowRange('New snow accumulation of less than one inch possible.'), [0, 1]);
  assert.deepEqual(parseSnowRange('Little or no snow accumulation expected.'), [0, 0]);
  assert.equal(parseSnowRange('Chance of precipitation is 90%.'), null);
  assert.equal(rangeText(3, 8, 'snow'), '3–8″');
});

test('today & tonight snow follows NWS periods past midnight instead of stopping at 12 AM', () => {
  const model = buildStormModel(stormForecast(), at('2026-11-25T17:00:00Z'));
  const win = horizonWindow(model, 'today');
  assert.equal(new Date(win.end).toISOString(), '2026-11-26T12:00:00.000Z');
  const snow = snowSummary(model, win);
  assert.equal(snow.amount, 5.8);
  // Hourly snowfall keeps the NWS total and peaks where hourly precipitation does.
  assert.equal(snow.timing.heaviest.hourly, true);
  assert.equal(Math.round(snow.timing.series.reduce((total, row) => total + row.value, 0) * 10) / 10, 5.8);
  assert.equal(snow.ratio > 5 && snow.ratio < 9, true);
  assert.deepEqual(snow.range, [3, 8]);
  assert.equal(snow.chance, 100);
});

test('rain totals split a day exactly using hourly guidance and keep per-source ranges', () => {
  const model = buildStormModel(stormForecast(), at('2026-11-25T17:00:00Z'));
  const today = rainSummary(model, horizonWindow(model, 'today'));
  // 19 hours x 0.05 of liquid, but NWS wording has snow for the first 16: only 3 hours are rain.
  assert.equal(Math.round(today.amount * 100) / 100, 0.15);
  assert.equal(Math.round(today.parts.snow * 100) / 100, 0.8);
  assert.ok(today.frozenShare > 0.8);
  // Source totals (0.76 and 1.14 of all liquid) keep only the rain share.
  assert.deepEqual(today.range.map(value => Math.round(value * 100) / 100), [0.12, 0.18]);
  const next = rainSummary(model, horizonWindow(model, '1-3'));
  // Thu after 6 AM from 18 hourly values (0.9) + whole Fri daily total (1.2) + whole Sat daily total (0.3).
  assert.equal(Math.round(next.amount * 100) / 100, 2.4);
  assert.equal(next.portions.find(row => row.day.key === '2026-11-28').mode, 'daily');
});

test('forecast changes compare snapshots over the same remaining window', () => {
  const model = buildStormModel(stormForecast(), at('2026-11-25T17:00:00Z'));
  const win = horizonWindow(model, 'today');
  const hours = (start, count, amount) => Array.from({ length: count }, (_, i) => ({ time: new Date(at(start) + i * 3600000).toISOString(), amount }));
  const snapshots = {
    '2026-11-25': [
      { issuedAt: '2026-11-25T15:00:00Z', day: { rain: { amount: 0.81, chance: 80, hours: hours('2026-11-25T15:00:00Z', 15, 0.09) } } },
      { issuedAt: '2026-11-25T17:00:00Z', day: { rain: { amount: 0.35, chance: 90, hours: hours('2026-11-25T17:00:00Z', 13, 0.05) } } },
    ],
    '2026-11-26': [
      { issuedAt: '2026-11-25T15:00:00Z', day: { rain: { amount: 1, chance: 80, hours: hours('2026-11-26T06:00:00Z', 24, 0.09) } } },
      { issuedAt: '2026-11-25T17:00:00Z', day: { rain: { amount: 1, chance: 90, hours: hours('2026-11-26T06:00:00Z', 24, 0.05) } } },
    ],
  };
  const trend = historyTrend(snapshots, model, 'rain', win);
  assert.equal(trend.status, 'ready');
  // Both snapshots are evaluated from 17Z onward: 19 h x 0.09 vs 19 h x 0.05.
  assert.equal(Math.round(trend.first.amount * 100) / 100, 1.71);
  assert.equal(Math.round(trend.last.amount * 100) / 100, 0.95);
  assert.equal(trend.direction, 'down');
});

test('WPC contour values describe their published band', () => {
  assert.equal(qpfBand('2.5'), '2.50–3.00″');
  assert.equal(qpfBand('0.01'), '0.01–0.10″');
  const square = (value, size) => ({ type: 'Feature', properties: { value }, geometry: { type: 'Polygon', coordinates: [[[-size, -size], [size, -size], [size, size], [-size, size], [-size, -size]]] } });
  assert.equal(contourValueAt({ features: [square(1, 2), square(4, 1)] }, 0, 0), 4);
  assert.equal(contourValueAt({ features: [square(1, 2)] }, 5, 5), null);
});

test('radar pixels are recolored by NOAA precipitation type', async () => {
  const { precipFlag, radarColor, reflectivityDbz } = await import('../public/weather-fusion/v3/js/storm-and-snow-beta.js');
  assert.equal(precipFlag(200, 200, 200), 'snow');
  assert.equal(precipFlag(110, 255, 255), 'rain');
  assert.equal(precipFlag(150, 0, 150), 'hail');
  assert.equal(precipFlag(20, 20, 20), null);
  // NOAA legend colors: about 20 dBZ is bright green, 40 dBZ yellow, 50 dBZ red.
  assert.ok(Math.abs(reflectivityDbz(51, 214, 97) - 20) <= 1);
  assert.ok(Math.abs(reflectivityDbz(245, 204, 21) - 40) <= 1);
  assert.ok(Math.abs(reflectivityDbz(212, 7, 8) - 50) <= 1);
  assert.notDeepEqual(radarColor('snow', 25), radarColor('rain', 25));
  assert.equal(radarColor('rain', 2), null);
});

test('history answers every date of a period in one request', () => {
  const service = createStormSnowBetaService({ now: () => now });
  service.recordForecast(forecast());
  const history = service.getHistory({ latitude: 35.787, longitude: -78.481, center: 'rain', dates: '2026-11-25,2026-11-26' });
  assert.deepEqual(Object.keys(history.byDate), ['2026-11-25', '2026-11-26']);
  assert.equal(history.byDate['2026-11-25'].length, 1);
  assert.equal(history.snapshots.length, 1);
  assert.throws(() => service.getHistory({ latitude: 35.787, longitude: -78.481, center: 'rain', dates: 'bad' }), error => error.status === 400);
});
