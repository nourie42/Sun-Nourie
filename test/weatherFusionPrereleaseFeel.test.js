import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  dewpointGrossLevel, forecastGrossLevel, dewpointDryLevel, forecastDryLevel,
  currentDewpointValue, dewpointPoints, graphGeometry, formatDewpointValue,
  feelMeterScale, renderDewpointMeter, resetDewpointMeter,
} from '../public/weather-fusion/prerelease-dewpoint-meter.js';
import { dewpointPoints as mainPoints, dewpointGrossLevel as mainLevel } from '../public/weather-fusion/dewpoint-meter.js';

const HOUR = 3600000;
const now = Date.parse('2026-10-14T12:30:00Z');
const time = offset => new Date(Date.parse('2026-10-14T13:00:00Z') + offset * HOUR).toISOString();
const forecast = values => ({
  location: { timeZone: 'America/New_York' },
  current: { dewpoint: 0, humidity: 0, temperature: 52, wind: 8 },
  comfort: { outdoors: 50 },
  metricForecasts: { series: {
    dewpoint: values.map((value, i) => ({ time: time(i), value })),
    wind: values.map((_value, i) => ({ time: time(i), value: 8 })),
  } },
});

test('Dry view gives specific humorous copy in every original dew-point band', () => {
  for (const [value, key] of [[-15, 'parched'], [0, 'parched'], [34.99, 'parched'], [35, 'crisp'], [44.99, 'crisp'], [45, 'pleasant'], [54.99, 'pleasant'], [55, 'comfortable'], [59.99, 'comfortable'], [60, 'sticky'], [64.99, 'sticky'], [65, 'humid'], [80, 'humid']]) {
    assert.equal(dewpointDryLevel(value).key, key);
    assert.equal(forecastDryLevel(value).key, key);
    assert.notEqual(dewpointDryLevel(value).label, forecastDryLevel(value).label);
  }
  assert.match(dewpointDryLevel(25).label, /doorknobs/i);
  assert.match(dewpointDryLevel(40).label, /static zap/i);
  assert.match(forecastDryLevel(25).label, /heated rooms may.*doorknobs/i);
  assert.match(forecastDryLevel(40).label, /heated rooms may.*static/i);
  assert.match(dewpointDryLevel(40).note, /depends on indoor humidity and materials/i);
});

test('Humid view keeps existing thresholds and exact wind exception without altering the main meter', () => {
  for (const value of [-10, 0, 49, 50, 59.9, 60, 63, 63.1, 64.9, 65, 70, 75, 90]) {
    for (const wind of [null, 0, 7.99, 8, 15]) assert.equal(dewpointGrossLevel(value, wind).key, mainLevel(value, wind).key);
  }
  assert.equal(forecastGrossLevel(63, 8).key, 'nice-breeze');
  assert.match(mainLevel(49).label, /ashy/);
  assert.match(dewpointGrossLevel(49).note, /Dry view/);
});

test('Unknown dew points stay unknown and zero remains a valid exact reading', () => {
  for (const missing of [null, undefined, '', '0', NaN, Infinity, -Infinity]) {
    assert.equal(dewpointDryLevel(missing).key, 'unknown');
    assert.equal(forecastDryLevel(missing).key, 'unknown');
    assert.equal(dewpointGrossLevel(missing).key, 'unknown');
    assert.equal(formatDewpointValue(missing), '—');
    assert.equal(feelMeterScale(missing, 'dry').position, null);
  }
  for (const value of [0, -14.25, 33.125, 64.99]) assert.equal(formatDewpointValue(value), `${value}°`);
  assert.equal(formatDewpointValue(null, 'Unavailable'), 'Unavailable');
  assert.equal(dewpointDryLevel(0).key, 'parched');
});

test('Forecast filtering preserves exact values, missing hours, deduplication and time boundaries', () => {
  const f = forecast([0, null, 33.125, 60]);
  f.metricForecasts.series.dewpoint.push(
    { time: time(-1), value: 55 },
    { time: time(1), value: -12.5 },
    { time: '2026-10-14T09:00:00-04:00', value: 99 },
    { time: 'not-a-date', value: 67 },
    { time: time(24), value: 45 },
  );
  const before = structuredClone(f);
  const points = dewpointPoints(f, now, 24);
  assert.deepEqual(points.map(p => p.value), [0, -12.5, 33.125, 60]);
  assert.deepEqual(points, mainPoints(f, now, 24));
  assert.deepEqual(f, before);
  assert.equal(dewpointPoints(f, Date.parse(time(0)), 24)[0].value, 0);
  assert.equal(dewpointPoints(f, Date.parse(time(0)) + 1, 24)[0].value, -12.5);
  assert.deepEqual(dewpointPoints({}, now), []);
  assert.equal(dewpointPoints(forecast([0, null]), now)[1].value, null);
});

test('Current value uses only the observation or the containing hour, never a future dry forecast', () => {
  const f = forecast([12.345]);
  assert.equal(currentDewpointValue(f, now), 0);
  f.current.dewpoint = null;
  assert.equal(currentDewpointValue(f, now), null);
  f.metricForecasts.series.dewpoint.push({ time: time(-1), value: -5.125 });
  assert.equal(currentDewpointValue(f, now), -5.125);
  assert.equal(currentDewpointValue(f, Date.parse(time(0))), 12.345);
  assert.equal(currentDewpointValue({}, now), null);
});

test('Phone geometry keeps the complete chosen horizon and gaps without changing values', () => {
  const pts = dewpointPoints(forecast([null, 0, -12.5]), now);
  for (const width of [240, 280, 320, 390, 430]) {
    for (const hours of [24, 48, 168, 240]) {
      const g = graphGeometry(pts, hours, width, Date.parse(time(0)));
      assert.equal(g.W, width);
      assert.equal(g.x(g.first), g.L);
      assert.equal(g.x(g.last), width - g.R);
      assert.ok(g.x(pts[1].epoch) > g.L, 'Leading missing hour must retain its space');
      assert.ok(Number.isFinite(g.y(0)) && Number.isFinite(g.y(-12.5)));
    }
  }
  const scale = feelMeterScale(0, 'dry');
  assert.equal(scale.position, 0);
  assert.equal(feelMeterScale(90, 'dry').position, 100);
  assert.equal(feelMeterScale(40, 'dry').position, (40 - 25) / 45 * 100);
  assert.notDeepEqual(scale.labels, feelMeterScale(0, 'humid').labels);
});

// Minimal event/DOM fixture exercises the actual renderer; phone visual QA is separate.
function domFixture({ sectionWidth = 320 } = {}) {
  const ids = new Map();
  let doc;
  class Node {
    constructor(tag = 'div') { this.tagName = tag; this.dataset = {}; this.style = {}; this.attributes = {}; this.events = {}; this.nodes = new Map(); this.textContent = ''; this.clientWidth = tag === 'section' ? sectionWidth : 320; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(name, callback) { this.events[name] = callback; }
    focus() { doc.activeElement = this; }
    contains(node) { return [...this.nodes.values()].includes(node); }
    closest() { return null; }
    insertAdjacentElement(_where, node) { ids.set(node.id, node); }
    remove() { ids.delete(this.id); }
    getBoundingClientRect() { return { left: 0, width: 320 }; }
    querySelector(selector) { return this.nodes.get(selector) ?? null; }
    querySelectorAll(selector) { return [...this.nodes.entries()].filter(([key]) => key.startsWith(selector.slice(0, -1) + '=')).map(([, node]) => node); }
    set innerHTML(html) {
      this.html = html;
      this.nodes.clear();
      for (const selector of ['.gross-selected-value', '.gross-selected-time', '.gross-selected-label', '.gross-selected', '.gross-cursor', '.gross-chart', '#gross-scrubber']) {
        const node = new Node();
        if (selector === '#gross-scrubber') {
          node.id = 'gross-scrubber';
          node.disabled = /id="gross-scrubber"[^>]* disabled/.test(html);
          node.setAttribute('max', html.match(/id="gross-scrubber"[^>]* max="(\d+)"/)[1]);
        }
        this.nodes.set(selector, node);
      }
      for (const match of html.matchAll(/<button type="button" data-(meter-mode|gross-hours)="([^"]+)" aria-pressed="([^"]+)"/g)) {
        const node = new Node('button');
        node.dataset[match[1] === 'meter-mode' ? 'meterMode' : 'grossHours'] = match[2];
        node.setAttribute('aria-pressed', match[3]);
        this.nodes.set(`[data-${match[1]}="${match[2]}"]`, node);
      }
    }
    get innerHTML() { return this.html; }
  }
  ids.set('skin-exposure', new Node());
  doc = { activeElement: null, getElementById: id => ids.get(id) ?? null, createElement: tag => new Node(tag), head: { append: node => ids.set(node.id, node) } };
  const win = { getComputedStyle: () => ({ paddingLeft: '10', paddingRight: '10' }), addEventListener() {} };
  return { doc, win, panel: () => ids.get('dewpoint-gross-meter') };
}

test('Actual Feel Meter renderer supports repeated mode/range changes, selection, focus, missing data and reset', () => {
  const oldDocument = globalThis.document, oldWindow = globalThis.window, oldObserver = globalThis.ResizeObserver;
  const fixture = domFixture({ sectionWidth: 0 });
  let resizeCallback, observerDisconnected = false;
  globalThis.ResizeObserver = class {
    constructor(callback) { resizeCallback = callback; }
    observe() {}
    disconnect() { observerDisconnected = true; }
  };
  globalThis.document = fixture.doc;
  globalThis.window = fixture.win;
  try {
    const f = forecast([0, null, 33.125, 61.25, 72.75]);
    renderDewpointMeter(f, now);
    let panel = fixture.panel();
    assert.match(panel.innerHTML, /viewBox="0 0 120 210"/);
    panel.clientWidth = 320;
    resizeCallback();
    assert.match(panel.innerHTML, /viewBox="0 0 298 210"/);
    assert.match(panel.innerHTML, /<strong>Feel Meter<\/strong>/);
    assert.doesNotMatch(panel.innerHTML, /Gross Meter|Dry Meter|Weather Meter/);
    assert.match(panel.innerHTML, /Indoor humidity is not measured/);
    assert.equal(panel.dataset.mode, 'humid');
    assert.equal(panel.querySelector('.gross-selected-value').textContent, '0°');
    assert.equal(fixture.doc.getElementById('weather-nourie-prerelease-feel-meter-css').href, '/weather-fusion/prerelease-feel-meter.css?v=feel-meter-v1');
    const select = index => panel.querySelector('#gross-scrubber').events.input({ target: { value: String(index) } });
    const click = selector => { const button = panel.querySelector(selector); button.focus(); button.events.click(); panel = fixture.panel(); };
    select(2);
    click('[data-meter-mode="dry"]');
    assert.equal(panel.dataset.mode, 'dry');
    assert.equal(panel.querySelector('.gross-selected-value').textContent, '33.125°');
    assert.match(panel.querySelector('.gross-selected-label').textContent, /doorknobs/);
    assert.equal(panel.querySelector('[data-meter-mode="dry"]').getAttribute('aria-pressed'), 'true');
    assert.equal(fixture.doc.activeElement, panel.querySelector('[data-meter-mode="dry"]'));
    assert.match(panel.innerHTML, /Driest in this view:<\/strong> 0°/);
    select(1);
    assert.equal(panel.querySelector('.gross-selected-value').textContent, 'Unavailable');
    assert.equal(panel.querySelector('.gross-selected').style.display, 'none');
    assert.match(panel.querySelector('#gross-scrubber').getAttribute('aria-valuetext'), /unavailable/);
    select(0);
    assert.equal(panel.querySelector('.gross-selected-value').textContent, '0°');
    assert.equal(panel.querySelector('.gross-selected').style.display, '');
    for (const hours of [24, 48, 168, 240, 48]) {
      click(`[data-gross-hours="${hours}"]`);
      assert.equal(panel.dataset.hours, String(hours));
      assert.equal(fixture.doc.activeElement, panel.querySelector(`[data-gross-hours="${hours}"]`));
    }
    select(3);
    click('[data-meter-mode="humid"]');
    assert.equal(panel.querySelector('.gross-selected-value').textContent, '61.25°');
    assert.match(panel.querySelector('.gross-selected-label').textContent, /breeze/i);
    assert.match(panel.innerHTML, /Muggiest in this view:<\/strong> 72.75°/);
    panel.querySelector('#gross-scrubber').focus();
    renderDewpointMeter(f, now);
    assert.equal(fixture.doc.activeElement, panel.querySelector('#gross-scrubber'));
    renderDewpointMeter({}, now);
    assert.equal(panel.querySelector('#gross-scrubber').disabled, true);
    assert.match(panel.innerHTML, /No forecast hours are available/);
    assert.match(panel.innerHTML, /<i hidden>/);
    assert.doesNotMatch(panel.innerHTML, /NaN|undefined|Infinity/);
    resetDewpointMeter();
    assert.equal(fixture.panel(), undefined);
    assert.equal(observerDisconnected, true);
  } finally {
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    globalThis.ResizeObserver = oldObserver;
  }
});

test('Isolated stylesheet retains main layout and provides phone controls without mutating main code', () => {
  const css = readFileSync(new URL('../public/weather-fusion/prerelease-feel-meter.css', import.meta.url), 'utf8');
  assert.match(css, /@import url\('\/weather-fusion\/dewpoint-meter\.css/);
  assert.match(css, /\.prerelease-feel-meter \.gross-mode-toggle \{ grid-column: 1; grid-row: 2; \}/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /:focus-visible/);
  const main = readFileSync(new URL('../public/weather-fusion/dewpoint-meter.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /prerelease|Feel Meter/);
});
