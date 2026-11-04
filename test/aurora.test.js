import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, dewpointWord, uvWord, aqiWord, tempWord } from '../public/weather-fusion/aurora.js';

function fixture(now = Date.now()) {
  const hours = Array.from({ length: 30 }, (_, i) => ({
    time: new Date(now - 3600000 + i * 3600000).toISOString(),
    temperature: 55 + (i % 10), pop: i === 8 ? 60 : 5,
    condition: 'Sunny', isDay: true, humidity: 50, dewpoint: 48, gust: 12,
  }));
  return {
    location: { name: 'Knightdale, NC', timeZone: 'America/New_York' },
    assembledAt: new Date(now).toISOString(),
    current: { temperature: 62, condition: 'Sunny', humidity: 48, dewpoint: 45, wind: 7, gust: 13, windDirection: 180, apparent: 62, visibility: null, pressure: null },
    hours,
    days: [
      { label: 'Today', high: 71, low: 49, condition: 'Sunny', detail: 'Sunny, with a high near 71.', pop: 10, qpf: 0, agreement: 'Close agreement', highSpread: 2, confidence: { label: 'High', key: 'high', summary: 'Forecast sources agree closely for these hours.' } },
      { label: 'Tue', high: 74, low: 52, condition: 'Partly cloudy', detail: 'Partly cloudy.', pop: 20, qpf: 0.02, agreement: 'Some disagreement', highSpread: 5, confidence: { label: 'Moderate', key: 'moderate', summary: 'Models differ a little.' } },
    ],
    solar: { sunrise: new Date(now - 3600000).toISOString(), sunset: new Date(now + 5 * 3600000).toISOString() },
    uv: { hourly: [{ time: new Date(Math.floor(now / 3600000) * 3600000).toISOString(), value: 5 }] },
    airQuality: { aqi: 32, time: new Date(now).toISOString() },
    alerts: [],
    methodology: 'Test methodology.',
  };
}

test('aurora model maps the shared forecast payload', () => {
  const now = Date.now();
  const m = buildModel(fixture(now), now);
  assert.equal(m.place, 'Knightdale, NC');
  assert.equal(m.hero.temp, 62);
  assert.equal(m.hero.high, 71);
  assert.equal(m.hero.low, 49);
  assert.equal(m.sky, 'clear-day');
  assert.equal(m.details.uv, 5);
  assert.equal(m.details.aqi, 32);
  assert.equal(m.details.windDir, 'S');
  assert.equal(m.days.length, 2);
  assert.equal(m.confidence.label, 'High');
});

test('aurora headline is plain English and uses the rain signal', () => {
  const now = Date.now();
  const m = buildModel(fixture(now), now);
  assert.match(m.headline, /rain is likely around/);
  assert.match(m.headline, /60% chance/);
});

test('aurora plain-English bands follow the standard scales', () => {
  assert.equal(dewpointWord(45).word, 'Comfortable');
  assert.equal(dewpointWord(67).word, 'Muggy');
  assert.equal(uvWord(2).word, 'Low');
  assert.equal(uvWord(9).word, 'Very high');
  assert.equal(aqiWord(32).word, 'Good');
  assert.equal(aqiWord(120).word, 'Unhealthy for sensitive groups');
  assert.equal(tempWord(95), 'very hot');
  assert.equal(tempWord(20), 'freezing');
});

test('aurora tolerates a sparse payload without inventing values', () => {
  const m = buildModel({ location: { name: 'X', timeZone: 'America/New_York' }, hours: [], days: [] });
  assert.equal(m.hero.temp, null);
  assert.equal(m.details.aqi, null);
  assert.equal(m.confidence, null);
});
