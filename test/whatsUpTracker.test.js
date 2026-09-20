import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  classifyHour, groupRuns, normalizeZip, parseWindMph, stormLevel, buildTrackerView,
  formatWindowLabel, TRACKER_VERSION,
} from '../src/whatsUpTracker.js';
import { registerWhatsUpRoutes } from '../src/whatsUpRoutes.js';

test('ZIP normalization accepts 5-digit and ZIP+4 only', () => {
  assert.equal(normalizeZip('27609'), '27609');
  assert.equal(normalizeZip(' 27545-1234 '), '27545');
  assert.equal(normalizeZip('2760'), null);
  assert.equal(normalizeZip('Raleigh'), null);
});

test('wind parser treats calm and ranges scientifically', () => {
  assert.deepEqual(parseWindMph('Calm'), { min: 0, max: 0, typical: 0 });
  assert.equal(parseWindMph('5 mph').typical, 5);
  assert.equal(parseWindMph('8 to 12 mph').typical, 10);
  assert.equal(parseWindMph(''), null);
});

test('storm thresholds match Weather Fusion timing philosophy', () => {
  assert.equal(stormLevel(74), null);
  assert.equal(stormLevel(75), 'elevated');
  assert.equal(stormLevel(89), 'elevated');
  assert.equal(stormLevel(90), 'definite');
  assert.equal(stormLevel(100), 'definite');
});

test('Rule A requires 72-feel band, light wind, dry dewpoint, and open sky', () => {
  const perfect = classifyHour({
    condition: 'Mostly Sunny', temperature: 72, dewpoint: 54, wind: '4 mph', pop: 10,
  });
  assert.equal(perfect.perfect, 'A');
  assert.equal(perfect.storm, null);

  assert.equal(classifyHour({ condition: 'Mostly Sunny', temperature: 72, dewpoint: 61, wind: '4 mph', pop: 10 }).perfect, null);
  assert.equal(classifyHour({ condition: 'Overcast', temperature: 72, dewpoint: 54, wind: '4 mph', pop: 10 }).perfect, null);
  assert.equal(classifyHour({ condition: 'Mostly Sunny', temperature: 72, dewpoint: 54, wind: '12 mph', pop: 10 }).perfect, 'B');
  assert.equal(classifyHour({ condition: 'Mostly Sunny', temperature: 72, dewpoint: 54, wind: '25 mph', pop: 10 }).perfect, null);
});

test('Rule B allows warmer hours only when the air is breezy and the sky is open', () => {
  const breezy = classifyHour({
    condition: 'Partly Cloudy', temperature: 81, dewpoint: 64, wind: '12 mph', pop: 20,
  });
  assert.equal(breezy.perfect, 'B');
  assert.equal(classifyHour({ condition: 'Partly Cloudy', temperature: 81, dewpoint: 64, wind: '3 mph', pop: 20 }).perfect, null);
  assert.equal(classifyHour({ condition: 'Partly Cloudy', temperature: 86, dewpoint: 50, wind: '12 mph', pop: 20 }).perfect, null);
});

test('storm-level rain chance blocks a perfect label on that hour', () => {
  const hour = classifyHour({
    condition: 'Sunny', temperature: 72, dewpoint: 50, wind: '3 mph',
    rainLikelihood: { value: 80, source: 'Weighted NWS probability plus tiered wet-model points' },
  });
  assert.equal(hour.perfect, null);
  assert.equal(hour.storm, 'elevated');
  assert.equal(hour.rainSource, 'Weather Nourie rain likelihood');
});

test('fusion rain chance is preferred over official PoP', () => {
  const hour = classifyHour({
    condition: 'Cloudy', temperature: 68, dewpoint: 60, wind: '6 mph',
    pop: 40,
    rainLikelihood: { value: 92 },
  });
  assert.equal(hour.rainChance, 92);
  assert.equal(hour.storm, 'definite');
});

test('consecutive qualifying hours collapse into clock windows', () => {
  const hours = [
    { time: '2026-09-20T13:00:00.000Z', keep: true },
    { time: '2026-09-20T14:00:00.000Z', keep: true },
    { time: '2026-09-20T15:00:00.000Z', keep: false },
    { time: '2026-09-20T16:00:00.000Z', keep: true },
  ];
  assert.equal(groupRuns(hours, (row) => row.keep).length, 2);
  assert.equal(formatWindowLabel(Date.parse('2026-09-20T13:00:00Z'), Date.parse('2026-09-20T15:00:00Z'), 'UTC'), '1pm–3pm');
});

test('tracker view names perfect and storm windows from hourly NWS periods', () => {
  const hourlyPeriods = [
    {
      startTime: '2026-09-20T14:00:00.000Z', endTime: '2026-09-20T15:00:00.000Z',
      temperature: 72, temperatureUnit: 'F', dewpoint: { value: 12, unitCode: 'wmoUnit:degC' },
      windSpeed: '5 mph', shortForecast: 'Sunny', isDaytime: true,
      probabilityOfPrecipitation: { value: 5 }, relativeHumidity: { value: 40 },
    },
    {
      startTime: '2026-09-20T15:00:00.000Z', endTime: '2026-09-20T16:00:00.000Z',
      temperature: 73, temperatureUnit: 'F', dewpoint: { value: 13, unitCode: 'wmoUnit:degC' },
      windSpeed: '5 mph', shortForecast: 'Mostly Sunny', isDaytime: true,
      probabilityOfPrecipitation: { value: 10 },
    },
    {
      startTime: '2026-09-20T18:00:00.000Z', endTime: '2026-09-20T19:00:00.000Z',
      temperature: 76, temperatureUnit: 'F', dewpoint: { value: 18, unitCode: 'wmoUnit:degC' },
      windSpeed: '9 mph', shortForecast: 'Chance Showers', isDaytime: true,
      probabilityOfPrecipitation: { value: 80 },
    },
  ];
  const view = buildTrackerView({
    zip: '27609',
    place: { name: 'Raleigh, NC, 27609', latitude: 35.8, longitude: -78.6, timeZone: 'UTC', office: 'RAH', source: 'test' },
    hourlyPeriods,
    periodForecasts: [{
      startTime: '2026-09-20T12:00:00.000Z', endTime: '2026-09-20T00:00:00.000Z',
      isDaytime: true, temperature: 78, temperatureUnit: 'F', shortForecast: 'Partly Sunny',
      detailedForecast: 'A mix of sun and a later shower.',
    }],
    now: Date.parse('2026-09-20T13:30:00.000Z'),
  });
  assert.equal(view.version, TRACKER_VERSION);
  assert.equal(view.days.length, 1);
  assert.equal(view.days[0].perfectWindows.length, 1);
  assert.match(view.days[0].perfectWindows[0].label, /2pm–4pm/);
  assert.equal(view.days[0].perfectWindows[0].temperatureMin, 72);
  assert.equal(view.days[0].perfectWindows[0].temperatureMax, 73);
  assert.equal(view.days[0].perfectWindows[0].dewpointMin, 54);
  assert.equal(view.days[0].perfectWindows[0].windMax, 5);
  assert.equal(view.days[0].stormWindows[0].level, 'elevated');
  assert.equal(view.days[0].stormWindows[0].rainPeak, 80);
  assert.match(view.summary.headline, /pleasant stretch/i);
  assert.doesNotMatch(view.summary.headline, /rule/i);
  assert.doesNotMatch(JSON.stringify(view), /Rule A|Rule B|Executive Summary/i);
  assert.equal(view.assumptions, undefined);
  assert.equal(view.status.nws, 'ready');
});

test('API validates ZIP and returns classified hours from NWS + fusion', async () => {
  const responses = {
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/2/query?where=ZCTA5%3D%2727609%27&returnGeometry=true&returnExtentOnly=true&outSR=4326&f=json": {
      extent: { xmin: -78.645, xmax: -78.635, ymin: 35.825, ymax: 35.835 },
    },
    'https://api.weather.gov/points/35.83,-78.64': {
      properties: {
        forecast: 'https://api.weather.gov/gridpoints/RAH/50,50/forecast',
        forecastHourly: 'https://api.weather.gov/gridpoints/RAH/50,50/forecast/hourly',
        timeZone: 'America/New_York', cwa: 'RAH',
        relativeLocation: { properties: { city: 'Raleigh', state: 'NC' } },
      },
    },
    'https://api.weather.gov/gridpoints/RAH/50,50/forecast/hourly': {
      properties: { periods: [{
        startTime: '2026-09-20T16:00:00.000Z', endTime: '2026-09-20T17:00:00.000Z',
        temperature: 72, temperatureUnit: 'F', dewpoint: { value: 54, unitCode: 'wmoUnit:degF' },
        windSpeed: '3 mph', shortForecast: 'Sunny', isDaytime: true,
        probabilityOfPrecipitation: { value: 8 },
      }] },
    },
    'https://api.weather.gov/gridpoints/RAH/50,50/forecast': {
      properties: { periods: [{ startTime: '2026-09-20T15:00:00.000Z', endTime: '2026-09-20T23:00:00.000Z', isDaytime: true, temperature: 78, temperatureUnit: 'F', shortForecast: 'Sunny' }] },
    },
  };
  const fetchImpl = async (url) => {
    const data = responses[url];
    if (!data) throw new Error(`unexpected ${url}`);
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(data) };
  };
  const getForecast = async () => ({
    location: { timeZone: 'America/New_York', office: 'RAH' },
    hours: [{ time: '2026-09-20T16:00:00.000Z', rainLikelihood: { value: 12, source: 'Weighted NWS probability plus tiered wet-model points' } }],
    rainTimeline: [{ time: '2026-09-20T16:00:00.000Z', officialPop: 8, rainLikelihood: { value: 12 } }],
  });
  const app = express();
  registerWhatsUpRoutes(app, { fetchImpl, getForecast, now: () => Date.parse('2026-09-20T15:30:00.000Z') });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bad = await fetch(`${base}/api/whats-up/tracker?zip=abc`);
    assert.equal(bad.status, 400);
    const badBody = await bad.json();
    assert.match(badBody.error, /5-digit/i);

    const page = await fetch(`${base}/whats-up`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /zip/i);

    const redirect = await fetch(`${base}/whatsup`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/whats-up');

    const ok = await fetch(`${base}/api/whats-up/tracker?zip=27609`);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.place.office, 'RAH');
    assert.equal(body.place.geocodeSource, 'U.S. Census TIGERweb ZCTA');
    assert.equal(body.status.rainFusion, 'ready');
    assert.equal(body.days[0].hours[0].perfect, true);
    assert.equal(body.days[0].hours[0].temperature, 72);
    assert.equal(body.days[0].hours[0].rainChance, 12);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
