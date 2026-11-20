import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGlobalGridPayload } from '../src/weatherFusionGlobalGlobe.js';
import { computeNourieHistoricalPoint, scoreModelAgainstTruth } from '../src/weatherFusionAccuracy.js';

test('global grid builds 48 UTC frames and physically exact wind blowing vectors', () => {
  const hrs = Array.from({ length: 48 }, (_, i) => new Date(Date.UTC(2026, 10, 20, i, 0, 0)).toISOString().slice(0, 16));
  const points = Array.from({ length: 14 * 30 }, (_, idx) => ({
    hourly: {
      time: hrs,
      cloud_cover: hrs.map(() => (idx === 0 ? 75 : 20)),
      precipitation: hrs.map(() => 0.4),
      // 270 deg = wind blowing FROM West TO East (+u > 0, v ~ 0)
      wind_speed_10m: hrs.map(() => 20),
      wind_direction_10m: hrs.map(() => 270),
      temperature_2m: hrs.map(() => 64),
    },
  }));
  const payload = buildGlobalGridPayload(points, '2026-11-20T00:00:00.000Z');
  assert.equal(payload.nLat, 14);
  assert.equal(payload.nLon, 30);
  assert.equal(payload.frames.length, 48);
  assert.equal(payload.frames[0].cloud[0], 75);
  assert.equal(payload.frames[0].cloud[1], 20);
  assert.ok(payload.frames[0].u[0] > 19.5, 'westerly wind (270 deg) must advect eastward (+u)');
  assert.ok(Math.abs(payload.frames[0].v[0]) < 0.1);
});

test('historical Weather Nourie blend and accuracy scorer compute honest MAE, bias, and hit rates', () => {
  const blend24 = computeNourieHistoricalPoint({ hrrr: 60, nbm: 62, ecmwf: 58, gfs: 65 }, 24);
  assert.ok(Math.abs(blend24 - (60 * 0.34 + 62 * 0.38 + 58 * 0.18 + 65 * 0.05) / 0.95) < 1e-6);

  const stats = scoreModelAgainstTruth([
    { pred: 71, obs: 70, predWind: 8, obsWind: 6, predPrecip: 0, obsPrecip: 0 },
    { pred: 67, obs: 70, predWind: 10, obsWind: 10, predPrecip: 0.2, obsPrecip: 0.1 },
  ]);
  assert.equal(stats.maeF, 2);
  assert.equal(stats.biasF, -1);
  assert.equal(stats.within2F, 50);
  assert.equal(stats.within3F, 100);
  assert.equal(stats.windMaeMph, 1);
  assert.equal(stats.precipHitPct, 100);
});
