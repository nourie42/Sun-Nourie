import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const text = path => readFile(new URL(path, root), 'utf8');

test('Experimental Weather links to the separate WeatherNext site without embedding WeatherNext content', async () => {
  const html = await text('public/weather-fusion/index.html');
  const js = await text('public/weather-fusion/model-explanation.js');
  assert.match(html, /id="weathernext-site-link" href="\/weathernext\/"/);
  assert.doesNotMatch(html, /id="google-status"/);
  const explanation = js.slice(js.indexOf('export function modelExplanationHTML'), js.indexOf('function experimentalPath'));
  assert.doesNotMatch(explanation, /weatherNextCard\(/);
  const renderer = js.slice(js.indexOf('export function renderModelExplanation'), js.indexOf('export function resetModelExplanation'));
  assert.doesNotMatch(renderer, /installWeatherNextMapControl|syncWeatherNextStatus|queueWeatherNextLoad/);
});

test('WeatherNext remains separate from the current PoP math', async () => {
  const js = await text('public/weather-fusion/model-explanation.js');
  assert.match(js, /return \['nws','hrrr','ecmwf','nbm'\]\.map/);
  assert.doesNotMatch(js, /return \['nws','hrrr','ecmwf','nbm','weathernext'\]\.map/);
});

test('WeatherNext collector reads BigQuery surface statistics without inventing PoP', async () => {
  const py = await text('scripts/weather_weathernext3_collect.py');
  assert.match(py, /from google\.cloud import bigquery/);
  assert.match(py, /weathernext_3_0_0_0p1deg/);
  assert.match(py, /temperature_2m_mean/);
  assert.match(py, /total_precipitation_1hr_mean/);
  assert.match(py, /"comparisonOnly": True/);
  assert.match(py, /"timeStepHours": 1/);
  assert.match(py, /TIMESTAMP_SUB\(CURRENT_TIMESTAMP\(\), INTERVAL 2 DAY\)/);
  assert.doesNotMatch(py, /probabilityOfPrecipitation|hourlyPop|rainChance/);
});

test('scheduled workflow uses keyless Workload Identity and the linked WeatherNext table', async () => {
  const yml = await text('.github/workflows/weathernext3-data.yml');
  assert.match(yml, /id-token: write/);
  assert.match(yml, /workload_identity_provider/);
  assert.doesNotMatch(yml, /WEATHERNEXT_GCP_CREDENTIALS|credentials_json/);
  assert.match(yml, /homeassist-470415\.weathernext_3\.weathernext_3_0_0_0p1deg/);
  assert.match(yml, /weather_weathernext3_collect\.py/);
  assert.match(yml, /models\/weathernext3\.json/);
});
