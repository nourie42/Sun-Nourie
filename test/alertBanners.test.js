import test from 'node:test';
import assert from 'node:assert/strict';
import { bannerStateFromForecast, bannerStateFromNwsPeriods, updateAlertBanners } from '../public/weather-fusion/alert-banners.js';
import { classifyHour } from '../src/whatsUpTracker.js';
import { buildForecast } from '../src/weatherFusion.js';
import { inputs, now as fixtureNow, H } from './weatherFusion.fixtures.js';

const now = Date.parse('2026-09-20T16:00:00Z');
const later = (hours) => new Date(now + hours * 3600000).toISOString();

const perfectHour = {
  time: later(2),
  condition: 'Mostly Sunny',
  temperature: 72,
  dewpoint: 54,
  wind: '4 mph',
  pop: 10,
};
const stormHour = {
  time: later(4),
  condition: 'Thunderstorms',
  temperature: 78,
  dewpoint: 68,
  wind: '12 mph',
  rainLikelihood: { value: 90 },
};
const quietHour = {
  time: later(1),
  condition: 'Overcast',
  temperature: 66,
  dewpoint: 58,
  wind: '6 mph',
  pop: 20,
};

test('banner state uses the same perfect and storm rules as the tracker', () => {
  assert.equal(classifyHour(perfectHour).perfect, 'A');
  assert.equal(classifyHour(stormHour).storm, 'definite');
  assert.deepEqual(bannerStateFromForecast({ hours: [quietHour] }, now), { perfect: false, storm: false });
  assert.deepEqual(bannerStateFromForecast({ hours: [perfectHour] }, now), { perfect: true, storm: false });
  assert.deepEqual(bannerStateFromForecast({ hours: [stormHour] }, now), { perfect: false, storm: true });
  assert.deepEqual(bannerStateFromForecast({ hours: [perfectHour, stormHour] }, now), { perfect: true, storm: true });
});

test('past hours do not invent banners', () => {
  const past = { ...perfectHour, time: new Date(now - 2 * 3600000).toISOString() };
  assert.deepEqual(bannerStateFromForecast({ hours: [past] }, now), { perfect: false, storm: false });
});

test('updateAlertBanners shows both stacked links when both apply', () => {
  const perfect = { hidden: true };
  const storm = { hidden: true };
  const stack = { hidden: true };
  const root = {
    getElementById(id) {
      return { 'perfect-weather-banner': perfect, 'storm-weather-banner': storm, 'weather-alert-banners': stack }[id];
    },
  };
  const state = updateAlertBanners({ hours: [perfectHour, stormHour] }, now, root);
  assert.deepEqual(state, { perfect: true, storm: true });
  assert.equal(perfect.hidden, false);
  assert.equal(storm.hidden, false);
  assert.equal(stack.hidden, false);
});

test('server alertBanners flag unhides purple even when displayed hours miss Friday', () => {
  const perfect = { hidden: true };
  const storm = { hidden: true };
  const stack = { hidden: true };
  const root = {
    getElementById(id) {
      return { 'perfect-weather-banner': perfect, 'storm-weather-banner': storm, 'weather-alert-banners': stack }[id];
    },
  };
  const state = updateAlertBanners({ hours: [quietHour], alertBanners: { perfect: true, storm: false } }, now, root);
  assert.deepEqual(state, { perfect: true, storm: false });
  assert.equal(perfect.hidden, false);
  assert.equal(storm.hidden, true);
  assert.equal(stack.hidden, false);
});

test('NWS hourly periods beyond the 48-hour fusion slice still set banners', () => {
  const friday = {
    startTime: later(5 * 24),
    endTime: later(5 * 24 + 1),
    isDaytime: true,
    temperature: 72,
    temperatureUnit: 'F',
    shortForecast: 'Mostly Sunny',
    windSpeed: '4 mph',
    dewpoint: { value: 54, unitCode: 'wmoUnit:degF' },
    probabilityOfPrecipitation: { value: 10 },
  };
  assert.deepEqual(bannerStateFromNwsPeriods([friday], { hours: [] }, now), { perfect: true, storm: false });
  assert.deepEqual(bannerStateFromForecast({ hours: [quietHour], hourlyPeriods: [friday] }, now), { perfect: true, storm: false });
});

test('buildForecast attaches alertBanners from full NWS hourly, not just 48 display hours', () => {
  const friday = {
    startTime: new Date(fixtureNow + 5 * 24 * H).toISOString(),
    endTime: new Date(fixtureNow + 5 * 24 * H + H).toISOString(),
    isDaytime: true,
    temperature: 72,
    temperatureUnit: 'F',
    shortForecast: 'Mostly Sunny',
    windSpeed: '4 mph',
    dewpoint: { value: 54, unitCode: 'wmoUnit:degF' },
    probabilityOfPrecipitation: { value: 10 },
    relativeHumidity: { value: 50 },
  };
  const out = buildForecast({ ...inputs, hourly: { periods: [...inputs.hourly.periods, friday] } });
  assert.equal(out.hours.length, 48);
  assert.equal(out.alertBanners.perfect, true);
});
