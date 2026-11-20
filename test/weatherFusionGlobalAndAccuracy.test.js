import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNourieHistoricalPoint, scoreModelAgainstTruth } from '../src/weatherFusionAccuracy.js';

test('historical Weather Nourie blend and multi-metric accuracy scorer compute honest MAE, bias, and overall score', () => {
  const blend24 = computeNourieHistoricalPoint({ hrrr: 60, nbm: 62, ecmwf: 58, icon: 61, ukmo: 60, gem: 62, gfs: 65 }, 24);
  const expected = 60 * 0.30 + 62 * 0.34 + 58 * 0.16 + 61 * 0.08 + 60 * 0.06 + 62 * 0.03 + 65 * 0.03;
  assert.ok(Math.abs(blend24 - expected) < 1e-6);

  const stats = scoreModelAgainstTruth([
    { pred: 71, obs: 70, predWind: 8, obsWind: 6, predPrecip: 0, obsPrecip: 0, predCloud: 40, obsCloud: 50, predHumidity: 60, obsHumidity: 65 },
    { pred: 67, obs: 70, predWind: 10, obsWind: 10, predPrecip: 0.2, obsPrecip: 0.1, predCloud: 80, obsCloud: 90, predHumidity: 75, obsHumidity: 70 },
  ]);
  assert.equal(stats.maeF, 2);
  assert.equal(stats.biasF, -1);
  assert.equal(stats.within2F, 50);
  assert.equal(stats.within3F, 100);
  assert.equal(stats.windMaeMph, 1);
  assert.equal(stats.precipHitPct, 100);
  assert.equal(stats.cloudMaePct, 10);
  assert.equal(stats.humidityMaePct, 5);
  assert.ok(stats.overallScore > 80 && stats.overallScore <= 100);
  assert.ok(stats.scores.temp > 0 && stats.scores.rain > 0 && stats.scores.wind > 0 && stats.scores.cloud > 0);
});
