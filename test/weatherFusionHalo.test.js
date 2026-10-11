import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preview } from './weatherFusion.fixtures.js';
import { buildModel, buildSeries, layoutChart, nightBands, solarDays, niceStep, dailySummary, dayPoints, skyPhase, sunProgress, tempColor, discussionExcerpt, story, H } from '../public/weather-fusion/halo.js';

const now = Date.parse(preview.assembledAt);
const tz = preview.location.timeZone;

test('Halo shows the same blended values as the main site', () => {
  const m = buildModel(preview, now);
  assert.equal(m.hero.temp, Math.round(preview.current.temperature));
  assert.equal(m.hero.high, Math.round(preview.days[0].high));
  const first = m.strip.find((h) => h.type === 'hour');
  assert.equal(first.label, 'Now');
  assert.equal(first.temp, Math.round(preview.hours[0].temperature));
  assert.equal(first.chance, Math.round(preview.hours[0].rainLikelihood.value));
  for (const s of m.blend.today) assert.equal(s.weight, preview.blendPolicy.sameDay[s.id]);
  assert.ok(m.strip.every((h) => h.time + H > now && h.time < now + 25 * H));
});

test('chart series prefer canonical hourly rows and extend with the longer metric series', () => {
  const s = buildSeries(preview);
  const t0 = Date.parse(preview.hours[0].time);
  assert.equal(s.temperature.find((p) => p.t === t0).v, preview.hours[0].temperature);
  assert.ok(s.temperature.at(-1).t > Date.parse(preview.hours.at(-1).time), 'extends past the 48 hourly rows');
  assert.equal(s.precip[0].v, preview.rainTimeline[0].rainLikelihood.value);
  assert.ok(s.temperature.every((p, i, a) => i === 0 || p.t > a[i - 1].t), 'sorted and de-duplicated');
});

test('chart layout produces a bounded, labelled scale and splits gaps', () => {
  const t0 = Date.parse('2026-09-05T04:00:00Z');
  const pts = Array.from({ length: 24 }, (_, i) => ({ t: t0 + i * H, v: i === 10 ? null : 60 + i }));
  const L = layoutChart({ points: pts, t0, t1: t0 + 23 * H, width: 400, height: 200, tz });
  assert.ok(L.lo <= 60 && L.hi >= 83);
  assert.equal(L.paths.length, 2, 'a missing hour breaks the line instead of drawing through zero');
  assert.ok(L.yTicks.length >= 3 && L.xTicks.some((t) => t.label === '12PM'));
  assert.equal(L.hiPt.v, 83);
  const bars = layoutChart({ points: pts, t0, t1: t0 + 23 * H, width: 400, height: 200, domain: [0, 100], tz });
  assert.equal(bars.lo, 0); assert.equal(bars.hi, 100);
  assert.ok(bars.bars.every((b) => b.y >= bars.pad.t && b.h >= 0));
  assert.equal(niceStep(17 / 4), 5);
});

test('night bands come from per-day calculated sunrise and sunset', () => {
  const sol = solarDays(preview);
  assert.ok(sol.length >= 2);
  const t0 = sol[0].rise - 2 * H, t1 = sol[1].set;
  const bands = nightBands(sol, t0, t1);
  assert.deepEqual(bands[0], [t0, sol[0].rise]);
  assert.deepEqual(bands[1], [sol[0].set, sol[1].rise]);
});

test('daily summaries describe the selected day in plain language', () => {
  const s = buildSeries(preview);
  const key = preview.days[1].date;
  const temps = dayPoints(s.temperature, key, tz);
  assert.match(dailySummary('temperature', temps, [], 'Sunday', tz), /^Sunday, expect a high of \d+° around \d+(AM|PM) and a low of \d+°/);
  assert.match(dailySummary('precip', [{ t: now, v: 5 }], [], 'Today', tz), /not expected/);
  assert.match(dailySummary('humidity', [], [], 'Today', tz), /No humidity forecast/);
});

test('sky phase and sun progress follow calculated sunrise and sunset', () => {
  const solar = { sunrise: '2026-09-05T10:50:00Z', sunset: '2026-09-05T23:38:00Z' };
  assert.equal(skyPhase(solar, Date.parse('2026-09-05T03:00:00Z')), 'night');
  assert.equal(skyPhase(solar, Date.parse('2026-09-05T11:00:00Z')), 'dawn');
  assert.equal(skyPhase(solar, Date.parse('2026-09-05T16:00:00Z')), 'day');
  assert.equal(skyPhase(solar, Date.parse('2026-09-05T23:00:00Z')), 'golden');
  assert.equal(skyPhase(solar, Date.parse('2026-09-05T23:50:00Z')), 'dusk');
  assert.ok(Math.abs(sunProgress(solar, Date.parse('2026-09-05T17:14:00Z')) - 0.5) < 0.01);
});

test('missing data degrades to dashes instead of zeros', () => {
  const m = buildModel({ current: {}, hours: [], days: [] }, now);
  assert.equal(m.hero.temp, null);
  assert.equal(m.tiles.find((t) => t.id === 'precip').value, '—');
  assert.equal(m.strip.length, 0);
  assert.equal(tempColor(null), 'rgb(200,210,225)');
});

test('story and discussion excerpt read naturally', () => {
  const hours = Array.from({ length: 24 }, (_, i) => ({ time: now + i * H, temp: 70 + i, chance: i === 5 ? 60 : 0 }));
  assert.match(story({ temp: 70 }, hours, tz), /Warming to 81°.*Rain chance climbs to 60%/);
  assert.equal(discussionExcerpt('.KEY MESSAGES...\n\n- A FRONT ARRIVES SUNDAY. COOLER MONDAY.\n\n&&'), 'A front arrives sunday. Cooler monday.');
});

test('Halo page and assets are served by the password-protected weather routes', async () => {
  const src = await readFile(new URL('../src/weatherFusion.js', import.meta.url), 'utf8');
  assert.match(src, /'halo\.html','halo\.css','halo\.js'/);
  const html = await readFile(new URL('../public/weather-fusion/halo.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/weather-fusion\/halo\.js"/);
  assert.match(html, /id="sheet"/);
  const index = await readFile(new URL('../public/weather-fusion/index.html', import.meta.url), 'utf8');
  assert.match(index, /href="\/weather-fusion\/halo\.html"/);
});

import { rainWindows, nextRainSentence, dayChangeSentence, confidenceExplanation, alertGuidance, uvWindow, nextTwelveSentence } from '../public/weather-fusion/halo-insights.js';

test('rain windows group contiguous wet hours and keep peak and amount', () => {
  const t0 = now;
  const pts = [0, 1, 2, 3, 6, 7].map((i) => ({ t: t0 + i * H, v: [10, 40, 65, 35, 80, 30][[0, 1, 2, 3, 6, 7].indexOf(i)], amt: 0.05 }));
  const w = rainWindows(pts, t0, t0 + 12 * H, 30);
  assert.equal(w.length, 2, 'a dry gap of more than 1.5 hours splits windows');
  assert.equal(w[0].peak, 65);
  assert.ok(Math.abs(w[0].amount - 0.15) < 1e-9);
  assert.equal(w[1].peak, 80);
});

test('next rain sentence says when rain starts, or that none is coming', () => {
  assert.equal(nextRainSentence([], now, tz), 'No rain is expected in the next 48 hours.');
  const w = [{ start: now + 2 * H, end: now + 4 * H, peak: 60, amount: 0.2 }];
  assert.match(nextRainSentence(w, now, tz), /^Rain starts around \d+(AM|PM) and runs to about \d+(AM|PM), peaking at 60%, about 0\.20 in total\.$/);
  const live = [{ start: now - H, end: now + H, peak: 45, amount: 0 }];
  assert.match(nextRainSentence(live, now, tz), /^Rain is in the forecast now/);
});

test('day change reads as plain language about warming, cooling and rain', () => {
  assert.equal(dayChangeSentence({ high: 80, chance: 10 }, { high: 84, chance: 10 }), 'Highs will be 4° warmer tomorrow.');
  assert.equal(dayChangeSentence({ high: 80, chance: 10 }, { high: 79, chance: 60 }), 'Highs will be about as warm tomorrow with rain chances rising.');
  assert.equal(dayChangeSentence({ high: 80, chance: 60 }, { high: 70, chance: 10 }), 'Highs will be 10° cooler tomorrow and drier.');
  assert.equal(dayChangeSentence(null, { high: 70 }), '');
});

test('confidence and alert guidance only restate documented categories', () => {
  assert.match(confidenceExplanation({ label: 'Low', factors: ['1 forecast source: NWS'] }), /^Models disagree; plans may change\. Basis: only one forecast source\.$/);
  assert.equal(confidenceExplanation({}), '');
  assert.match(alertGuidance('Flash Flood Warning'), /higher ground/);
  assert.match(alertGuidance('Flood Watch'), /possible/);
  assert.equal(alertGuidance('Special Weather Statement'), '');
});

test('UV window spans today\'s protective hours and reports the peak', () => {
  const day0 = Date.parse('2026-10-11T12:00:00Z');
  const pts = Array.from({ length: 10 }, (_, i) => ({ t: day0 + (i - 2) * H, v: [1, 2, 3, 5, 7, 8, 7, 5, 2, 1][i] }));
  const w = uvWindow(pts, day0, tz);
  assert.ok(w && w.peak === 8);
  assert.ok(w.to > w.from);
  assert.equal(uvWindow([], now, tz), null);
});

test('next-twelve sentence reports range and direction', () => {
  const hours = Array.from({ length: 12 }, (_, i) => ({ temp: 60 + i }));
  assert.equal(nextTwelveSentence(hours), 'Over the next 12 hours, temperatures stay between 60° and 71°, warming.');
  assert.equal(nextTwelveSentence([]), '');
});
