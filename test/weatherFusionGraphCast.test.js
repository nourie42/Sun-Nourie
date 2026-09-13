import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('GraphCast remains experimental comparison-only and cannot change hourly PoP', async () => {
  const js = await text('public/weather-fusion/model-explanation.js');
  assert.match(js, /GraphCast Operational/);
  assert.match(js, /WeatherNext 1-Graph/);
  assert.match(js, /comparison only/i);
  assert.match(js, /contributes 0 points/i);
  assert.match(js, /6-hour precipitation windows stay separate/);
  assert.match(js, /return \['nws','hrrr','ecmwf','nbm'\]\.map/);
  assert.doesNotMatch(js, /return \['nws','hrrr','ecmwf','nbm','graphcast'\]\.map/);
});

test('GraphCast map control is visible but disabled until real six-hour frames exist', async () => {
  const js = await text('public/weather-fusion/model-explanation.js');
  assert.match(js, /button\.disabled=true/);
  assert.match(js, /graphcast-map-pending/);
  assert.match(js, /GraphCast rain/);
  assert.match(js, /map activates after GPU-generated frames are published/i);
});

test('GraphCast comparison is designed for narrow mobile screens', async () => {
  const css = await text('public/weather-fusion/model-explanation.css');
  assert.match(css, /\.graphcast-windows\{display:grid/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(css, /\.graphcast-windows\{grid-template-columns:1fr\}/);
  assert.match(css, /\.graphcast-meta\{grid-template-columns:1fr\}/);
  assert.match(css, /\.model-table-scroll\{[^}]*overflow-x:auto/);
  assert.match(css, /@media\(max-width:400px\)/);
});

test('Earth2Studio collector preserves native six-hour GraphCast precipitation windows', async () => {
  const py = await text('scripts/weather_graphcast_collect.py');
  assert.match(py, /GraphCastOperational/);
  assert.match(py, /STEPS = 28/);
  assert.match(py, /"tp06"/);
  assert.match(py, /"comparisonOnly": True/);
  assert.match(py, /"timeStepHours": 6/);
  assert.match(py, /"precipitationUnits": "inch per 6-hour window"/);
  assert.doesNotMatch(py, /probabilityOfPrecipitation|hourlyPop|rainChance/);
});
