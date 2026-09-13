import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const text = path => readFile(new URL(path, root), 'utf8');

test('WeatherNext 3 is hosted and comparison-only, never part of the current PoP math', async () => {
  const js = await text('public/weather-fusion/model-explanation.js');
  assert.match(js, /Google WeatherNext 3/);
  assert.match(js, /64-member ensemble/);
  assert.match(js, /comparison only/i);
  assert.match(js, /contributes 0 points/i);
  assert.match(js, /models\/weathernext3\.json/);
  assert.match(js, /return \['nws','hrrr','ecmwf','nbm'\]\.map/);
  assert.doesNotMatch(js, /return \['nws','hrrr','ecmwf','nbm','weathernext'\]\.map/);
});

test('WeatherNext 3 card exposes hourly hosted statistics and keeps map disabled until configured', async () => {
  const js = await text('public/weather-fusion/model-explanation.js');
  assert.match(js, /temperatureP10F/);
  assert.match(js, /temperatureP90F/);
  assert.match(js, /precipitationP90Inches/);
  assert.match(js, /button\.disabled=true/);
  assert.match(js, /WeatherNext 3 map pending data access/);
});

test('WeatherNext collector reads BigQuery surface statistics without inventing PoP', async () => {
  const py = await text('scripts/weather_weathernext3_collect.py');
  assert.match(py, /from google\.cloud import bigquery/);
  assert.match(py, /weathernext_3_0_0_0p1deg/);
  assert.match(py, /temperature_2m_mean/);
  assert.match(py, /total_precipitation_1hr_mean/);
  assert.match(py, /"comparisonOnly": True/);
  assert.match(py, /"timeStepHours": 1/);
  assert.doesNotMatch(py, /probabilityOfPrecipitation|hourlyPop|rainChance/);
});

test('scheduled workflow publishes only after Google credentials and table are configured', async () => {
  const yml = await text('.github/workflows/weathernext3-data.yml');
  assert.match(yml, /WEATHERNEXT_GCP_CREDENTIALS/);
  assert.match(yml, /WEATHERNEXT_BQ_TABLE/);
  assert.match(yml, /weather_weathernext3_collect\.py/);
  assert.match(yml, /models\/weathernext3\.json/);
});
