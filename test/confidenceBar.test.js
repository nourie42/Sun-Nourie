import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {confidenceWarningDetailHTML,confidenceWarningHTML,lowConfidenceWarning} from '../public/weather-fusion/confidence-bar.js';

const day=(date,components,weather={})=>({date,confidence:{overall:{scope:'overall',score:75,key:'moderate',label:'Moderate',components}},...weather});

test('quiet cloud disagreement never creates an event-confidence notice',()=>{
  assert.equal(lowConfidenceWarning([day('2026-11-23',{rain:100,temperature:100,sky:50},{condition:'Mostly Cloudy',pop:4,qpf:.001})]),null);
});

test('unrelated cloud uncertainty does not make a confident temperature swing look uncertain',()=>{
  const warning=lowConfidenceWarning([
    day('2026-11-23',{rain:90,temperature:95,sky:90},{condition:'Sunny',high:70,low:55}),
    day('2026-11-24',{rain:100,temperature:95,sky:45},{condition:'Cold and cloudy',high:50,low:35})
  ]);
  assert.equal(warning,null);
});

test('confident rain is not described as an uncertain rain event',()=>{
  const warning=lowConfidenceWarning([day('2026-11-25',{rain:95,temperature:45,sky:50},{condition:'Rain',pop:90,qpf:.7})]);
  assert.equal(warning,null);
});

test('an unsettled major storm reports an event-specific estimated change risk',()=>{
  const warning=lowConfidenceWarning([
    day('2026-11-23',{rain:90,temperature:90,sky:90},{condition:'Sunny',high:62,low:45}),
    day('2026-11-24',{rain:90,temperature:90,sky:90},{condition:'Sunny',high:64,low:47}),
    day('2026-11-25',{rain:52,temperature:95,sky:95},{condition:'Showers And Thunderstorms',pop:90,qpf:1.1,high:68,low:52})
  ]);
  assert.equal(warning.dayLabel,'Wednesday');
  assert.equal(warning.impactLabel,'storms');
  assert.equal(warning.changeRisk,55);
  assert.match(warning.text,/estimated 55% chance/i);
  assert.match(warning.text,/storm setup holds/i);
  assert.doesNotMatch(warning.text,/cloud cover|temperature|NWS|ECMWF|HRRR|NBM|model/i);
});

test('a confident storm cannot hide an uncertain major temperature swing on the same day',()=>{
  const warning=lowConfidenceWarning([
    day('2026-11-23',{rain:95,temperature:90,sky:90},{condition:'Sunny',high:60,low:45}),
    day('2026-11-24',{rain:95,temperature:50,sky:90},{condition:'Showers And Thunderstorms',pop:90,qpf:1,high:78,low:60})
  ]);
  assert.equal(warning.impactLabel,'temperature swing');
  assert.match(warning.text,/how large the temperature swing/i);
  assert.doesNotMatch(warning.text,/storm setup/i);
});

test('compact bar and popup both state the estimated percentage clearly',()=>{
  const warning=lowConfidenceWarning([day('2026-11-25',{rain:48,temperature:90,sky:90},{condition:'Rain',pop:85,qpf:.6})]);
  const bar=confidenceWarningHTML(warning),detail=confidenceWarningDetailHTML(warning);
  assert.match(bar,/Forecast still uncertain/);
  assert.match(bar,/>50%<\/span>/);
  assert.match(bar,/aria-valuetext="50 percent change risk"/);
  assert.match(detail,/estimated chance the important forecast details change/i);
  assert.match(detail,/not a historically calibrated probability/i);
});

test('confidence control remains a compact top row and opens its explanation',()=>{
  const index=readFileSync(new URL('../public/weather-fusion/v3/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/weather-fusion/v3/css/styles.css',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/weather-fusion/v3/js/app.js',import.meta.url),'utf8');
  assert.ok(index.indexOf('hero-confidence-slot')<index.indexOf('class="shell hero-stage"'));
  assert.match(css,/\.forecast-confidence-button\s*\{[^}]*min-height:\s*52px/s);
  assert.match(app,/button\.onclick=.*openModal\(`Forecast confidence/);
});
