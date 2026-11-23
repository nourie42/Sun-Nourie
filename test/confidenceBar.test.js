import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {confidenceWarningDetailHTML,confidenceWarningHTML,lowConfidenceWarning} from '../public/weather-fusion/confidence-bar.js';

const day=(date,score,components,weather={})=>({date,confidence:{overall:{scope:'overall',key:score<70?'low':score<85?'moderate':'high',label:score<70?'Low':score<85?'Moderate':'High',score,components}},...weather});

test('quiet cloud disagreement does not create a confidence bar',()=>{
  assert.equal(lowConfidenceWarning([day('2026-11-23',82,{rain:90,temperature:90,sky:58},{condition:'Mostly Cloudy',pop:4,qpf:.001})]),null);
});

test('confidence bar selects the most impactful unsettled day',()=>{
  const warning=lowConfidenceWarning([
    day('2026-11-23',82,{rain:90,temperature:90,sky:55},{condition:'Mostly Cloudy',pop:4,qpf:.001}),
    day('2026-11-24',62,{rain:48,temperature:87,sky:86},{condition:'Rain Showers',pop:80,qpf:.3,high:56,low:45}),
    day('2026-11-25',84,{rain:100,temperature:68,sky:100},{condition:'Showers And Thunderstorms',pop:99,qpf:1.4,high:65,low:48})
  ]);
  assert.equal(warning.dayLabel,'Wednesday');
  assert.equal(warning.impactLabel,'storms');
  assert.equal(warning.level,'Moderate');
  assert.match(warning.text,/most impactful forecast day/i);
  assert.match(warning.text,/don’t agree yet about temperatures/i);
  assert.doesNotMatch(warning.text,/NWS|ECMWF|HRRR|NBM|model/i);
});

test('compact bar keeps the explanation behind a tap target',()=>{
  const warning=lowConfidenceWarning([day('2026-11-25',62,{rain:48,temperature:76,sky:82},{condition:'Rain',pop:85,qpf:.6})]);
  const bar=confidenceWarningHTML(warning),detail=confidenceWarningDetailHTML(warning);
  assert.match(bar,/forecast-confidence-button/);
  assert.match(bar,/aria-haspopup="dialog"/);
  assert.match(bar,/role="meter"/);
  assert.doesNotMatch(bar,/don’t agree yet/i);
  assert.match(detail,/don’t agree yet about rain/i);
  assert.match(detail,/Rain<\/span><strong data-level="low">Low agreement/i);
  assert.doesNotMatch(`${bar}${detail}`,/>\s*\d+%\s*</);
});

test('confidence control is a compact top row and opens its explanation',()=>{
  const index=readFileSync(new URL('../public/weather-fusion/v3/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/weather-fusion/v3/css/styles.css',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/weather-fusion/v3/js/app.js',import.meta.url),'utf8');
  assert.ok(index.indexOf('hero-confidence-slot')<index.indexOf('class="shell hero-stage"'));
  assert.match(css,/\.forecast-confidence-button\s*\{[^}]*min-height:\s*52px/s);
  assert.match(css,/grid-template-columns:\s*24px minmax\(80px,1fr\) auto 52px 13px/);
  assert.match(app,/button\.onclick=.*openModal\(`Forecast confidence/);
});
