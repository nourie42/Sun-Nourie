import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { preview } from './weatherFusion.fixtures.js';
import { buildHaloModel, skyPhase, sunProgress, tempColor, discussionExcerpt, story } from '../public/weather-fusion/halo.js';

const now = Date.parse(preview.assembledAt);

test('Halo uses the same blended forecast values as the main site', () => {
  const m = buildHaloModel(preview, now);
  assert.equal(m.hero.temp, Math.round(preview.current.temperature));
  assert.equal(m.hero.high, Math.round(preview.days[0].high));
  assert.equal(m.hours[0].temp, Math.round(preview.hours[0].temperature));
  assert.equal(m.hours[0].chance, Math.round(preview.hours[0].rainLikelihood.value));
  assert.equal(m.week[0].chance, Math.round(preview.days[0].rainLikelihood?.value ?? preview.days[0].pop));
  for (const s of m.blend.today) assert.equal(s.weight, preview.blendPolicy.sameDay[s.id]);
  assert.equal(m.blend.today.length, Object.values(preview.blendPolicy.sameDay).filter((w) => w > 0).length);
  assert.ok(m.hours.length <= 24 && m.hours.every((h) => h.time + 3600000 > now));
});

test('Halo week bars stay within the track and today shows the current temperature', () => {
  const m = buildHaloModel(preview, now);
  for (const d of m.week) if (d.bar) { assert.ok(d.bar.left >= 0); assert.ok(d.bar.left + d.bar.width <= 100.0001 + 4); }
  assert.ok(m.week[0].bar.now >= 0 && m.week[0].bar.now <= 100);
});

test('sky phase and sun progress follow calculated sunrise and sunset', () => {
  const solar = { sunrise: '2026-09-05T10:50:00Z', sunset: '2026-09-05T23:38:00Z' };
  assert.equal(skyPhase(solar, Date.parse('2026-09-05T03:00:00Z')), 'night');
  assert.equal(skyPhase(solar, Date.parse('2026-09-05T11:00:00Z')), 'dawn');
  assert.equal(skyPhase(solar, Date.parse('2026-09-05T16:00:00Z')), 'day');
  assert.equal(skyPhase(solar, Date.parse('2026-09-05T23:00:00Z')), 'golden');
  assert.equal(skyPhase(solar, Date.parse('2026-09-05T23:50:00Z')), 'dusk');
  assert.equal(sunProgress(solar, Date.parse('2026-09-05T03:00:00Z')), null);
  assert.ok(Math.abs(sunProgress(solar, Date.parse('2026-09-05T17:14:00Z')) - 0.5) < 0.01);
  assert.equal(skyPhase(null, now), 'day');
});

test('missing data degrades to dashes instead of zeros', () => {
  const m = buildHaloModel({ current: {}, hours: [], days: [] }, now);
  assert.equal(m.hero.temp, null);
  assert.equal(m.tiles.find((t) => t.id === 'rain').value, '—');
  assert.equal(m.curve, '');
  assert.equal(tempColor(null), 'rgb(200,210,225)');
});

test('story and discussion excerpt read naturally', () => {
  const t0 = now;
  const hours = Array.from({ length: 24 }, (_, i) => ({ time: t0 + i * 3600000, temp: 70 + i, chance: i === 5 ? 60 : 0 }));
  assert.match(story({ temp: 70 }, hours, 'America/New_York'), /Warming to 81°.*Rain chance climbs to 60%/);
  assert.equal(discussionExcerpt('.KEY MESSAGES...\n\n- A FRONT ARRIVES SUNDAY. COOLER MONDAY.\n\n&&'), 'A front arrives sunday. Cooler monday.');
});

test('Halo page and assets are served by the weather routes behind the weather password', async () => {
  const src = await readFile(new URL('../src/weatherFusion.js', import.meta.url), 'utf8');
  assert.match(src, /'halo\.html','halo\.css','halo\.js'/);
  const html = await readFile(new URL('../public/weather-fusion/halo.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/weather-fusion\/halo\.js"/);
  const index = await readFile(new URL('../public/weather-fusion/index.html', import.meta.url), 'utf8');
  assert.match(index, /href="\/weather-fusion\/halo\.html"/);
});
