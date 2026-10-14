/** Deterministic local-only Atlas browser QA. No deployed site or live data. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import express from 'express';
import { preview, now as fixtureNow } from '../test/weatherFusion.fixtures.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(process.env.ATLAS_SMOKE_OUTPUT || '/tmp/weather-atlas-qa');
const require = createRequire(import.meta.url);
const primary = { ...preview.location, name: 'TEST Knightdale, NC' };
const secondary = { ...preview.location, name: 'TEST Asheville, NC', latitude: 35.5951, longitude: -82.5515 };
const layers = ['radar', 'hrrr', 'ecmwf', 'nbm', 'temperature', 'wind', 'clouds'];
const report = {
  fixture: true, fixtureTime: new Date(fixtureNow).toISOString(),
  note: 'Synthetic canonical fixture data only. External traffic is blocked; live radar, tiles, model maps, authentication and deployment are not validated by this browser harness.',
  checks: [], screenshots: [], pageErrors: [], consoleErrors: [], blockedExternal: [], apiRequests: [],
};
let browser, context, page, server, base;
let holdSecondary = false, releaseSecondary = null, sparse = false, forecastDelay = 0;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const locationFor = query => Math.abs(Number(query.latitude) - secondary.latitude) < .0001 ? secondary : primary;
function fixtureFor(query) {
  const data = structuredClone(preview);
  data.location = { ...locationFor(query) };
  data.signature = `${preview.signature}-${data.location.name}-${sparse ? 'missing' : 'complete'}`;
  data.aiConfigured = false;
  if (sparse) {
    Object.assign(data.hours[0], { temperature: null, windMph: null, wind: null, pop: 95, rainLikelihood: { value: null } });
  }
  return data;
}
async function screenshot(name) {
  if (!page || page.isClosed()) return;
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(output, filename), fullPage: true, animations: 'disabled' });
  report.screenshots.push(filename);
}
async function check(name, action) {
  const started = performance.now();
  try {
    await action();
    report.checks.push({ name, passed: true, durationMs: Math.round(performance.now() - started) });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.stack || String(error), durationMs: Math.round(performance.now() - started) });
    console.error(`FAIL ${name}: ${error.message}`);
    await screenshot(`failure-${report.checks.length}`).catch(() => {});
  }
}
async function waitForForecast(name) {
  await page.waitForFunction(expected => document.querySelector('#city-name')?.textContent === expected && !!document.querySelector('#atlas-trend svg') && !document.querySelector('#refresh')?.classList.contains('loading'), name);
}
async function searchFor(query, name) {
  await page.locator('#city-search').fill(query);
  const result = page.locator('#search-results button').filter({ hasText: name });
  await result.waitFor({ state: 'visible' });
  await result.click();
}
async function assertNoOverflow(width) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(dimensions.document <= width + 1 && dimensions.body <= width + 1, `Page-level overflow: ${JSON.stringify(dimensions)}`);
  const invalid = await page.locator('#atlas-trend, #atlas-blend, #atlas-confidence').allTextContents();
  assert.doesNotMatch(invalid.join(' '), /NaN|undefined|Infinity/);
}

await mkdir(output, { recursive: true });
try {
  const { chromium } = await import('playwright');
  const leafletRoot = path.dirname(require.resolve('leaflet/dist/leaflet.js'));
  const html = (await readFile(path.join(root, 'public/weather-fusion/atlas.html'), 'utf8'))
    .replaceAll('https://unpkg.com/leaflet@1.9.4/dist/', '/__atlas_test_leaflet/')
    .replace('<body ', '<body data-fixture="true" ')
    .replace('</body>', '<aside id="atlas-test-banner" style="position:fixed;z-index:2147483647;bottom:8px;right:8px;max-width:calc(100vw - 16px);padding:8px 12px;border:2px solid #261b00;border-radius:6px;background:#ffe082;color:#261b00;font:700 12px/1.4 system-ui;box-shadow:0 2px 12px #0008;pointer-events:none">TEST DATA · FIXTURE PREVIEW<br>2026-09-05 · Maps intentionally unavailable</aside></body>');
  const app = express();
  app.use('/api/weather-fusion', (req, _res, next) => { report.apiRequests.push(req.originalUrl); next(); });
  app.get('/api/weather-fusion/search', (req, res) => res.json({ results: [/asheville/i.test(req.query.q || '') ? secondary : primary] }));
  app.get('/api/weather-fusion/forecast', async (req, res) => {
    if (holdSecondary && locationFor(req.query) === secondary) await new Promise(resolve => { releaseSecondary = resolve; });
    if (forecastDelay) await delay(forecastDelay);
    if (!res.destroyed) res.json(fixtureFor(req.query));
  });
  app.get('/api/weather-fusion/alerts', (req, res) => res.json({ location: locationFor(req.query), alerts: [], feeds: [{ id: 'alerts', status: 'ready', fetchedAt: new Date(fixtureNow).toISOString() }] }));
  app.get('/api/weather-fusion/bulletins', (req, res) => res.json({ mode: 'official', signature: req.query.signature, items: [] }));
  app.get('/api/weather-fusion/radar', (req, res) => res.json({ location: locationFor(req.query), status: 'unavailable', frames: [], message: 'TEST DATA: observed radar is intentionally unavailable. Blank maps do not establish clear weather.' }));
  app.get('/api/weather-fusion/models', (_req, res) => res.json({ checkedAt: new Date(fixtureNow).toISOString(), layers: Object.fromEntries(layers.slice(1).map(id => [id, { status: 'unavailable', model: id, label: `${id.toUpperCase()} test model`, frames: [], message: 'TEST DATA: model frames intentionally unavailable.' }])) }));
  app.use('/api', (_req, res) => res.status(503).json({ error: 'TEST DATA: this source is intentionally unavailable.' }));
  app.get(['/weather-fusion/atlas.html', '/weather-fusion/atlas', '/weather-fusion/atlas/'], (_req, res) => res.type('html').send(html));
  app.use('/__atlas_test_leaflet', express.static(leafletRoot));
  app.use('/weather-fusion', express.static(path.join(root, 'public/weather-fusion')));
  server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', timezoneId: 'America/New_York' });
  await context.route('**/*', route => {
    const requestUrl = route.request().url();
    if (requestUrl.startsWith(`${base}/`) || requestUrl.startsWith('data:')) return route.continue();
    report.blockedExternal.push(requestUrl);
    return route.fulfill({ status: 503, contentType: 'text/plain', body: 'TEST DATA: external sources disabled.' });
  });
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition(_success, error) { setTimeout(() => error({ code: 1, message: 'Test permission denied' }), 0); } } });
  });
  await page.goto(`${base}/weather-fusion/atlas.html`, { waitUntil: 'load' });

  await check('Denied device location offers search and keeps every map layer disabled', async () => {
    await page.waitForFunction(() => /Allow device location|search for a city/i.test(document.querySelector('#status')?.textContent || ''));
    assert.equal(await page.locator('[data-layer]:disabled').count(), 7);
    assert.equal(await page.locator('#atlas-trend svg').count(), 0);
    await assertNoOverflow(390);
    await screenshot('390-location-denied');
  });
  await check('City search loads the exact canonical fixture and local Leaflet', async () => {
    await searchFor('Knightdale', primary.name);
    await waitForForecast(primary.name);
    await page.waitForFunction(() => !!window.L && !!document.querySelector('.leaflet-map-pane'));
    assert.equal(await page.locator('[data-layer]:disabled').count(), 0);
    const values = await page.evaluate(() => ({ temperature: globalThis.__weatherNourieForecast.hours[0].temperature, rain: globalThis.__weatherNourieForecast.hours[0].rainLikelihood.value }));
    assert.equal(values.temperature, preview.hours[0].temperature);
    assert.equal(values.rain, preview.hours[0].rainLikelihood.value);
    assert.match(await page.locator('#atlas-hour-readout').innerText(), new RegExp(`${Math.round(preview.hours[0].temperature)}°F`));
    assert.match(await page.locator('#atlas-freshness').innerText(), /checked just now/i);
  });
  await check('Radar and all six model layers fail safely with accurate accessible labels', async () => {
    for (const layer of layers) {
      await page.locator(`[data-layer="${layer}"]`).click();
      await page.waitForFunction(() => /unavailable|no verified|could not load|could not be loaded/i.test(document.querySelector('#map-error')?.textContent || ''));
      assert.equal(await page.locator(`[data-layer="${layer}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#radar-play').isDisabled(), true);
      assert.equal(await page.locator('#radar-time').isDisabled(), true);
      const label = await page.locator('#radar-map').getAttribute('aria-label');
      assert.match(label, layer === 'radar' ? /observed radar/i : /forecast|precipitation/i);
      assert.ok(await page.locator('#atlas-trend svg').count(), 'Map outages must not erase the point forecast');
    }
    await page.locator('[data-layer="radar"]').click();
  });
  await check('Trend variables, 24/48-hour controls and keyboard scrubber work', async () => {
    for (const metric of ['rain', 'wind', 'temperature']) {
      await page.locator(`[data-atlas-metric="${metric}"]`).click();
      assert.equal(await page.locator(`[data-atlas-metric="${metric}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#atlas-trend svg').count(), 1);
    }
    await page.locator('[data-atlas-hours="48"]').click();
    assert.match(await page.locator('#atlas-trend-title').innerText(), /48 hours/);
    assert.equal(Number(await page.locator('#atlas-hour').getAttribute('max')), 47);
    await page.locator('#atlas-hour').focus();
    await page.keyboard.press('End');
    assert.equal(await page.locator('#atlas-hour').inputValue(), '47');
    assert.match(await page.locator('#atlas-hour-readout').innerText(), /Temperature|Rain chance/);
    await page.locator('[data-atlas-hours="24"]').click();
    assert.equal(Number(await page.locator('#atlas-hour').getAttribute('max')), 23);
    await page.locator('#atlas-hour').focus();
    await page.keyboard.press('Home');
    await page.locator('#atlas-trend .atlas-data-detail summary').click();
    assert.equal(await page.locator('#atlas-trend tbody tr').count(), 24);
    await page.locator('#atlas-trend .atlas-data-detail summary').click();
  });
  await check('Confidence expands and daily applied model weights can be selected', async () => {
    const day = page.locator('.atlas-confidence-day').first();
    await day.locator('summary').click();
    assert.equal(await day.getAttribute('open'), '');
    assert.ok((await day.locator('.atlas-confidence-reasons').innerText()).trim());
    await day.locator('summary').click();
    await page.locator('#atlas-blend-day').selectOption('1');
    assert.equal(await page.locator('#atlas-blend-day').inputValue(), '1');
    assert.ok(await page.locator('#atlas-blend .atlas-source-row').count());
    await page.locator('#atlas-blend-day').selectOption('0');
  });
  await check('Daily forecast dialog opens and closes with Escape and close button', async () => {
    await page.locator('.weather-jump-card.jump-week').click();
    const day = page.locator('#daily [data-day]').first();
    await day.click();
    await page.locator('#day-dialog[open]').waitFor();
    assert.ok((await page.locator('#day-title').innerText()).trim());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#day-dialog').getAttribute('open'), null);
    await day.click();
    await page.locator('#close-day').click();
    assert.equal(await page.locator('#day-dialog').getAttribute('open'), null);
  });
  await check('Pending location change clears the old charts, confidence and source weights', async () => {
    holdSecondary = true;
    try {
      await searchFor('Asheville', secondary.name);
      await page.waitForFunction(() => document.querySelector('#city-name')?.textContent === 'TEST Asheville, NC' && /Waiting for the selected location/i.test(document.querySelector('#atlas-trend')?.textContent || ''));
      for (const id of ['atlas-trend', 'atlas-blend', 'atlas-confidence']) assert.match(await page.locator(`#${id}`).innerText(), /Waiting for the selected location/i);
      assert.equal(await page.locator('[data-layer]:disabled').count(), 7);
      await screenshot('390-location-pending');
      for (let tries = 0; !releaseSecondary && tries < 30; tries++) await delay(50);
      assert.ok(releaseSecondary, 'Expected a held second-location forecast request');
    } finally {
      holdSecondary = false;
      releaseSecondary?.();
      releaseSecondary = null;
    }
    await waitForForecast(secondary.name);
  });
  await check('Repeated refresh cancels obsolete work and recovers to usable controls', async () => {
    const before = report.apiRequests.filter(url => url.includes('/forecast?') && url.includes('latitude=')).length;
    forecastDelay = 250;
    try {
      await page.locator('#refresh').click();
      await page.locator('#refresh').click({ force: true });
      await waitForForecast(secondary.name);
    } finally { forecastDelay = 0; }
    const after = report.apiRequests.filter(url => url.includes('/forecast?') && url.includes('latitude=')).length;
    assert.ok(after >= before + 1, 'Refresh must request canonical forecast data');
    assert.equal(await page.locator('[data-layer]:disabled').count(), 0);
  });
  await check('Unavailable canonical values stay unavailable instead of falling back to a rain percentage', async () => {
    sparse = true;
    await page.locator('#refresh').click();
    await page.waitForFunction(() => globalThis.__weatherNourieForecast?.hours?.[0]?.temperature === null && !document.querySelector('#refresh').classList.contains('loading'));
    await page.locator('#atlas-hour').focus();
    await page.keyboard.press('Home');
    const readout = await page.locator('#atlas-hour-readout').innerText();
    assert.match(readout, /Temperature\s+Unavailable/);
    assert.match(readout, /Rain chance\s+Unavailable/);
    assert.match(readout, /Wind\s+Unavailable/);
    await screenshot('390-missing-hour-values');
    sparse = false;
    await page.locator('#refresh').click();
    await page.waitForFunction(() => globalThis.__weatherNourieForecast?.hours?.[0]?.temperature !== null && !document.querySelector('#refresh').classList.contains('loading'));
  });
  await check('Offline and stale snapshots are disclosed', async () => {
    await context.setOffline(true);
    await page.waitForFunction(() => !document.querySelector('#atlas-connection').hidden && /offline/i.test(document.querySelector('#atlas-connection').textContent));
    await screenshot('390-offline-snapshot');
    await context.setOffline(false);
    await waitForForecast(secondary.name);
    await page.clock.setFixedTime(new Date(fixtureNow + 30 * 60000));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => /refresh|freshness/i.test(document.querySelector('#atlas-connection')?.textContent || ''));
    assert.equal(await page.locator('#atlas-freshness').getAttribute('data-state'), 'stale');
    await page.clock.setFixedTime(new Date(fixtureNow));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  });
  for (const width of [320, 390, 768, 1440]) {
    await check(`Layout and controls fit ${width}px viewport without page overflow`, async () => {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(150);
      await assertNoOverflow(width);
      assert.equal(await page.locator('#atlas-test-banner').isVisible(), true);
      await screenshot(`${width}-atlas-fixture`);
      await page.locator('[data-atlas-metric="rain"]').click();
      assert.equal(await page.locator('[data-atlas-metric="rain"]').getAttribute('aria-pressed'), 'true');
      await assertNoOverflow(width);
      await page.locator('[data-atlas-metric="temperature"]').click();
    });
  }
  await check('No unhandled JavaScript errors or forecast display failures occurred', async () => {
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.consoleErrors.filter(message => /Weather Nourie (?:panel|display) failed/.test(message)), []);
  });
} catch (error) {
  report.fatal = error.stack || String(error);
  console.error(error);
  await screenshot('fatal-error').catch(() => {});
} finally {
  holdSecondary = false;
  releaseSecondary?.();
  report.passed = !report.fatal && report.checks.length > 0 && report.checks.every(check => check.passed);
  report.blockedExternal = [...new Set(report.blockedExternal)];
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  console.log(`Atlas fixture report: ${path.join(output, 'report.json')}`);
  if (!report.passed) process.exitCode = 1;
}
