import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isProtectedWeatherPath, isPublicWeatherPath } from '../src/weatherSiteAccess.js';
import { atlasSeries, atlasFreshness, atlasBlend, atlasConfidence, atlasChart } from '../public/weather-fusion/atlas.js';

const HOUR = 3600000;
const now = Date.parse('2026-10-14T12:00:00Z');
const iso = offset => new Date(now + offset * HOUR).toISOString();
const row = (offset, values = {}) => ({ time: iso(offset), temperature: 70, windMph: 8, rainLikelihood: { value: 20 }, ...values });

test('Atlas reads the canonical main forecast without recomputing its values', () => {
  const data = {
    hours: [row(0, { temperature: 72, temperatureBlend: { value: 72.4 }, rainLikelihood: { value: 53.333333 }, pop: 10 }), row(1, { temperature: 74 })],
    metricForecasts: { series: { temperature: [{ time: iso(0), value: 99 }] } },
  };
  const before = JSON.stringify(data);
  const series = atlasSeries(data, { now });
  assert.equal(series[0].temperature, 72);
  assert.equal(series[0].rain, 53.333333);
  assert.equal(series[0].value, 72);
  assert.equal(atlasSeries(data, { now, metric: 'rain' })[0].value, 53.333333);
  assert.equal(JSON.stringify(data), before, 'Atlas is presentation-only');
});

test('Atlas preserves true zeros and canonical missing values', () => {
  const series = atlasSeries({ hours: [
    row(0, { temperature: 0, windMph: 0, rainLikelihood: { value: 0 } }),
    row(1, { temperature: null, windMph: null, rainLikelihood: { value: null }, pop: 90 }),
    row(2, { temperature: undefined, windMph: undefined, rainLikelihood: { value: 120 }, pop: 80 }),
  ] }, { now });
  assert.deepEqual(series.map(point => point.temperature), [0, null, null]);
  assert.deepEqual(series.map(point => point.rain), [0, null, null]);
  assert.deepEqual(series.map(point => point.wind), [0, null, null]);
  assert.deepEqual(atlasSeries(null, { now }), []);
});

test('Atlas uses actual elapsed forecast time, excluding past and distant rows', () => {
  const series = atlasSeries({ hours: [row(-2), row(0), row(2), row(23), row(25), { time: 'not a date', temperature: 65 }] }, { now });
  assert.deepEqual(series.map(point => point.time), [now, now + 2 * HOUR, now + 23 * HOUR]);
  assert.ok(series.every(point => Number.isFinite(point.time)));
});

test('Atlas sorts and deduplicates canonical hours while retaining the current hour', () => {
  const series = atlasSeries({ hours: [row(2), row(0), row(1), row(2, { temperature: 79 })] }, { now: now + 20 * 60000 });
  assert.deepEqual(series.map(point => point.time), [now, now + HOUR, now + 2 * HOUR]);
  assert.equal(series.at(-1).value, 79);
});

test('Atlas does not reinterpret incomplete canonical rain as a dry forecast', () => {
  const series = atlasSeries({ hours: [row(0, { rainLikelihood: { value: null, coverage: { complete: false } }, pop: 0 })] }, { now, metric: 'rain' });
  assert.equal(series[0].value, null);
});

test('Atlas source shares come from the selected actual daily blend', () => {
  const data = {
    days: [{ date: '2026-10-14', label: 'Today', high: 76, highBlend: { value: 76, sources: [{ id: 'nws', value: 74, weight: .5 }, { id: 'ecmwf', value: 78, weight: .5 }] } }],
    feeds: [{ id: 'nws', status: 'ready' }, { id: 'ecmwf', status: 'ready' }, { id: 'hrrr', status: 'stale' }, { id: 'nbm', status: 'unavailable' }],
    modelContributions: [{ id: 'ecmwf', runAt: iso(-6) }],
    blendPolicy: { sameDay: { nws: .4, hrrr: .3, ecmwf: .1, nbm: .2 } },
  };
  const model = atlasBlend(data);
  assert.equal(model.sources.find(source => source.id === 'nws').weight, .5);
  assert.equal(model.sources.find(source => source.id === 'ecmwf').weight, .5);
  assert.equal(model.sources.find(source => source.id === 'ecmwf').runAt, iso(-6));
  for (const id of ['hrrr', 'nbm']) {
    const source = model.sources.find(item => item.id === id);
    assert.ok(!source || source.weight == null || source.weight === 0, `${id} must not be assigned a fabricated share`);
  }
});

test('Atlas confidence retains the server index and its uncertainty explanation', () => {
  const confidence = { score: 45, label: 'Very low', key: 'very-low', factors: ['limited temperature comparison', 'NWS day/night period unavailable'] };
  const before = JSON.stringify(confidence);
  const result = atlasConfidence({ days: [{ date: '2026-10-14', label: 'Today', confidence }] });
  assert.equal(result[0].score, 45);
  assert.equal(result[0].key, 'very-low');
  assert.deepEqual(result[0].factors, confidence.factors);
  assert.equal(JSON.stringify(confidence), before);
  const missing = atlasConfidence({ days: [{ date: '2026-10-15', label: 'Thursday' }] });
  assert.ok(!missing.length || missing[0].score == null, 'missing confidence must never become 0 or high confidence');
  for (const key of ['high', 'moderate', 'low', 'very-low']) {
    const item = atlasConfidence({ days: [{ confidence: { ...confidence, key } }] })[0];
    assert.equal(item.key, key, `canonical confidence category ${key}`);
  }
});

test('Atlas reports missing and old snapshots honestly', () => {
  const missing = atlasFreshness({}, now);
  const old = atlasFreshness({ assembledAt: iso(-8) }, now);
  const fresh = atlasFreshness({ assembledAt: iso(0) }, now);
  assert.ok(missing.label && old.label && fresh.label);
  assert.notEqual(missing.state, fresh.state);
  assert.notEqual(old.state, fresh.state);
  assert.match(old.label, /stale|old|8\s*h|480\s*m|refresh/i);
  assert.notEqual(atlasFreshness({ assembledAt: iso(1) }, now).state, fresh.state, 'future timestamps are not fresh');
});

test('Atlas SVG is labelled, finite, and safely handles missing data', () => {
  const series = atlasSeries({ hours: [row(0), row(1, { temperature: null }), row(2, { temperature: 75 })] }, { now });
  const chart = atlasChart(series, { metric: 'temperature', timeZone: 'America/New_York' });
  assert.match(chart, /<svg\b/);
  assert.match(chart, /role=["']img["']/);
  assert.match(chart, /aria-label|aria-labelledby|<title/);
  assert.doesNotMatch(chart, /NaN|Infinity|undefined/);
  assert.doesNotMatch(atlasChart([], { metric: 'temperature', timeZone: 'America/New_York' }), /NaN|Infinity|undefined/);
});

test('Atlas charts break lines at missing values and omitted forecast hours', () => {
  for (const hours of [[row(0), row(1, { temperature: null }), row(2)], [row(0), row(3)]]) {
    const chart = atlasChart(atlasSeries({ hours }, { now }), { metric: 'temperature', timeZone: 'UTC' });
    const lineGroup = chart.match(/<g fill="none"[^>]*>(.*?)<\/g>/s)?.[1];
    assert.ok(lineGroup, 'forecast line group must exist');
    assert.equal([...lineGroup.matchAll(/<path\b/g)].length, 2, 'no interpolation across missing forecast coverage');
  }
});

test('Atlas preserves the main application DOM and shared data loader', async () => {
  const html = await readFile(new URL('../public/weather-fusion/atlas.html', import.meta.url), 'utf8');
  const main = await readFile(new URL('../public/weather-fusion/index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs break the shared application');
  const mainIds = [...main.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  for (const id of mainIds) assert.ok(ids.includes(id), `Missing shared main page element ${id}`);
  assert.match(html, /src="\/weather-fusion\/app\.js\?/);
  assert.match(html, /src="\/weather-fusion\/atlas\.js\?/);
  assert.match(html, /href="\/weather-fusion\/atlas\.css\?/);
  for (const layer of ['radar', 'hrrr', 'ecmwf', 'nbm', 'temperature', 'wind', 'clouds']) assert.match(html, new RegExp(`data-layer="${layer}"`));
  assert.match(html, /prefers-reduced-motion|atlas\.css/);
});

test('Atlas routes retain the existing weather access policy', async () => {
  const routes = await readFile(new URL('../src/weatherFusion.js', import.meta.url), 'utf8');
  assert.match(routes, /'atlas\.html','atlas\.css','atlas\.js'/);
  for (const pathname of ['/weather-fusion/atlas', '/weather-fusion/atlas/', '/weather-fusion/atlas.html']) {
    assert.equal(isProtectedWeatherPath(pathname), true, pathname);
    assert.equal(isPublicWeatherPath(pathname), false, pathname);
  }
  for (const pathname of ['/weather-fusion/atlas.js', '/weather-fusion/atlas.css']) assert.equal(isPublicWeatherPath(pathname), true, pathname);
  assert.equal(isPublicWeatherPath('/weather-fusion/'), true);
});
