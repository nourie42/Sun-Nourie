import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read = name => readFileSync(new URL(`../public/weather-fusion/${name}`, import.meta.url), 'utf8');
const app = read('app.js'), html = read('index.html'), css = read('forecast-layout.css');
const start = app.indexOf('function renderBriefing(data) {');
const end = app.indexOf('\nasync function load(', start);
assert.ok(start >= 0 && end > start, 'Exercise the actual production briefing renderer');
const renderer = app.slice(start, end);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function harness({missingNote = false} = {}) {
  const ids = ['briefing-title','briefing-summary','ai-label','briefing-detail','briefing-stamp','outlook-science','today-uncertainty','today-uncertainty-text'];
  const elements = Object.fromEntries(ids.map(id => [id, {textContent:'',innerHTML:'',hidden:true}]));
  if (missingNote) { delete elements['today-uncertainty']; delete elements['today-uncertainty-text']; }
  const context = {$:id => elements[id] ?? null, forecast:{feeds:[]}, currentBriefing:null, esc:escape, clock:() => '8:00 AM'};
  runInNewContext(`${renderer}\nthis.renderBriefing = renderBriefing;`, context);
  return {elements, render:context.renderBriefing};
}

test('uncertainty is below the daily graphic and before the still-adjacent hourly panel', () => {
  const panel = html.match(/<section class="glass today-panel"[^>]*>([\s\S]*?)<\/section>/)?.[1];
  assert.ok(panel);
  assert.ok(panel.indexOf('id="today-forecast"') < panel.indexOf('id="today-uncertainty"'));
  assert.match(panel, /id="today-uncertainty"[^>]*hidden/);
  assert.match(panel, /<strong class="today-uncertainty-label">What could change - Dan's take<\/strong>/);
  assert.match(html, /<\/section>\s*<section class="glass hourly-panel"/);
  for (const id of ['today-forecast','today-uncertainty','today-uncertainty-text','hourly']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} must stay unique`);
  }
});

test('NWS fallback is displayed in both locations without replacing the forecast', () => {
  const {elements, render} = harness();
  const uncertainty = 'Forecasts can change, especially the timing of showers.';
  render({mode:'nws-summary', summary:'Warm with a chance of rain.', uncertainty});
  assert.equal(elements['today-uncertainty-text'].textContent, uncertainty);
  assert.equal(elements['today-uncertainty'].hidden, false);
  assert.ok(elements['briefing-detail'].innerHTML.includes(uncertainty));
  assert.equal(elements['briefing-summary'].textContent, 'Warm with a chance of rain.');
});

test('AI updates refresh the same note rather than append duplicate notes', () => {
  const {elements, render} = harness();
  render({uncertainty:'Old wording'});
  const note = elements['today-uncertainty'];
  render({mode:'ai', uncertainty:'Timing and how widespread the rain will be remain uncertain.'});
  assert.equal(elements['today-uncertainty'], note);
  assert.equal(elements['today-uncertainty'].hidden, false);
  assert.equal(elements['today-uncertainty-text'].textContent, 'Timing and how widespread the rain will be remain uncertain.');
  assert.ok(!elements['briefing-detail'].innerHTML.includes('Old wording'));
});

for (const uncertainty of [undefined, null, '', ' \n\t ', 42, {}]) {
  test(`empty or invalid uncertainty hides and clears old text (${JSON.stringify(uncertainty)})`, () => {
    const {elements, render} = harness();
    render({uncertainty:'Previous location'});
    render({uncertainty});
    assert.equal(elements['today-uncertainty'].hidden, true);
    assert.equal(elements['today-uncertainty-text'].textContent, '');
  });
}

test('location reset uses the existing renderer so old uncertainty is not retained', () => {
  const choose = app.slice(app.indexOf('function chooseLocation(value)'), app.indexOf('\nfunction showDay('));
  assert.match(choose, /renderBriefing\(\{ headline: 'Preparing your local outlook\.'/);
  const {elements, render} = harness();
  render({uncertainty:'Previous location'});
  render({headline:'Preparing your local outlook.', sources:[]});
  assert.equal(elements['today-uncertainty'].hidden, true);
  assert.equal(elements['today-uncertainty-text'].textContent, '');
});

test('untrusted outlook text remains text, not executable HTML', () => {
  const {elements, render} = harness();
  const uncertainty = '<img src=x onerror=alert(1)> & "rain"';
  render({uncertainty});
  assert.equal(elements['today-uncertainty-text'].textContent, uncertainty);
  assert.equal(elements['today-uncertainty-text'].innerHTML, '');
  assert.ok(elements['briefing-detail'].innerHTML.includes('&lt;img'));
  assert.ok(!elements['briefing-detail'].innerHTML.includes('<img'));
});

test('an older cached document without the new note cannot break the outlook', () => {
  const {elements, render} = harness({missingNote:true});
  assert.doesNotThrow(() => render({uncertainty:'Still usable'}));
  assert.ok(elements['briefing-detail'].innerHTML.includes('Still usable'));
});

test('note is smaller and bold, with wrapping rather than clipping', () => {
  assert.match(css, /\.today-uncertainty\{[^}]*font-size:14px;[^}]*font-weight:700;[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.today-uncertainty-label\{[^}]*font-weight:800/);
  assert.match(css, /\.today-uncertainty p\{[^}]*font-size:inherit;[^}]*font-weight:700/);
  assert.match(css, /@media\(max-width:600px\)\{\.today-uncertainty\{font-size:13px/);
});

test('Gross Meter heading is centered and bold without changing chart geometry', () => {
  assert.match(css, /#gross-title\{text-align:center;font-weight:800\}/);
  assert.ok(!/\.gross-(scroll|chart)\s*\{/.test(css));
});

test('changed assets are cache-busted and late briefing responses stay guarded', () => {
  assert.match(html, /forecast-layout\.css\?v=3-personal/);
  assert.match(html, /app\.js\?v=9-hourly/);
  assert.match(app, /if \(id === generation && briefing\.signature === forecast\?\.signature\) renderBriefing\(briefing\)/);
});
