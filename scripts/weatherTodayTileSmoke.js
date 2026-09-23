import {chromium} from 'playwright';
import express from 'express';
import assert from 'node:assert/strict';
import {fixture} from './weatherNourieFixture.js';

let forecastCalls = 0;
const app = express();
app.get('/api/weather-fusion/forecast', (req, res) => {
  const data = fixture(req.query.location);
  const second = forecastCalls++ > 0;
  const chance = second ? 60 : 40;
  data.assembledAt = second ? '2026-09-05T21:59:00.000Z' : '2026-09-05T21:58:00.000Z';
  data.days[0].rainLikelihood = {
    ...(data.days[0].rainLikelihood || {}),
    value: chance,
    aggregation: 'maximum-hourly',
    coverage: {complete:true},
    window: {start:'2026-09-05T21:00:00.000Z', end:'2026-09-06T11:00:00.000Z'},
  };
  res.json(data);
});
app.get('/api/weather-fusion/radar', (_req,res) => res.json({frames:[],status:'unavailable'}));
app.get('/api/weather-fusion/models', (_req,res) => res.json({layers:{}}));
app.get('/api/weather-fusion/bulletins', (req,res) => res.json({mode:'official',signature:req.query.signature || null,items:[]}));
app.use('/weather-fusion', express.static('public/weather-fusion'));

const server = await new Promise(resolve => {
  const instance = app.listen(0,'127.0.0.1',() => resolve(instance));
});
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true});

try {
  const context=await browser.newContext({viewport:{width:390,height:844},geolocation:{latitude:35.787,longitude:-78.4806},permissions:['geolocation']});
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.testNow = Date.parse('2026-09-05T21:59:59Z');
    Date.now = () => window.testNow;
  });
  await page.goto(base + '/weather-fusion/', {waitUntil:'domcontentloaded'});
  await page.waitForSelector('#today-forecast .today-weather-card');

  assert.equal(await page.locator('#today-forecast .day-name').innerText(), 'Remainder of Today');
  assert.match(await page.locator('#today-forecast .today-feels').innerText(), /Feels like\s+\d+°/);

  const feels = await page.locator('#today-forecast .today-feels').boundingBox();
  const metrics = await page.locator('#today-forecast .today-metrics').boundingBox();
  assert.ok(feels && metrics, 'Today tile must render feels-like and metrics');
  assert.ok(feels.y + feels.height <= metrics.y - 2,
    `Feels-like overlaps metrics: feels bottom ${feels.y + feels.height}, metrics top ${metrics.y}`);

  const firstTrend = await page.locator('#today-forecast [data-rain-trend]').innerText();
  assert.match(firstTrend, /first update/i);
  assert.match(await page.locator('#today-forecast .today-symbol').innerText(), /40%/);

  await page.locator('#refresh').click();
  await page.waitForFunction(() => document.querySelector('#today-forecast [data-rain-trend]')?.textContent?.includes('+20 pts'));
  assert.match(await page.locator('#today-forecast .today-symbol').innerText(), /60%/);
  assert.match(await page.locator('#today-forecast [data-rain-trend]').innerText(), /↑ \+20 pts · was 40%/);

  for (const width of [320,390,430]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow at ${width}px`);
    const f = await page.locator('#today-forecast .today-feels').boundingBox();
    const m = await page.locator('#today-forecast .today-metrics').boundingBox();
    assert.ok(f && m && f.y + f.height <= m.y - 2, `Today tile overlap at ${width}px`);
  }

  console.log(JSON.stringify({
    ok:true,
    checks:[
      'Remainder of Today uses the visible tile',
      'Feels-like stays above wind/UV metrics',
      'Rain chance updates 40% → 60%',
      'Rain chance change shows +20 pts and previous 40%',
      'No overlap at 320, 390, or 430 px'
    ]
  }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
