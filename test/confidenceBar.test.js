import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {confidenceWarningDetailHTML,confidenceWarningHTML,lowConfidenceWarning} from '../public/weather-fusion/confidence-bar.js';

const day=(date,components,weather={})=>({date,confidence:{overall:{scope:'overall',score:75,key:'moderate',label:'Moderate',components}},...weather});
const today=()=>day('2026-11-24',{rain:100,temperature:100,sky:90},{condition:'Sunny',high:60,low:42,pop:0,qpf:0});
const rainPeak=(sourceValues,wetSources=[],drySources=[])=>({rainLikelihood:{peak:{sourceValues,wetSources,drySources}}});

test('quiet cloud disagreement never creates a future event-confidence notice',()=>{
  assert.equal(lowConfidenceWarning([today(),day('2026-11-25',{rain:100,temperature:100,sky:50},{condition:'Mostly Cloudy',pop:4,qpf:.001})]),null);
});

test('unrelated cloud uncertainty does not make a confident temperature swing look uncertain',()=>{
  const warning=lowConfidenceWarning([
    day('2026-11-24',{rain:90,temperature:95,sky:90},{condition:'Sunny',high:70,low:55}),
    day('2026-11-25',{rain:100,temperature:95,sky:45},{condition:'Cold and cloudy',high:50,low:35})
  ]);
  assert.equal(warning,null);
});

test('confident rain with similar amounts is not described as uncertain',()=>{
  const warning=lowConfidenceWarning([today(),day('2026-11-25',{rain:95,temperature:90,sky:90},{condition:'Rain',pop:90,qpf:.7,fullWindowQpf:{sourceValues:{a:.62,b:.7,c:.78}}})]);
  assert.equal(warning,null);
});

test('wet-versus-dry disagreement is found even when the displayed rain chance is low',()=>{
  const sunday=day('2026-11-29',{rain:50,temperature:95,sky:53},{condition:'Sunny',pop:18,qpf:.03,
    ...rainPeak({nws:16,nbm:12,ecmwf:0,wn:100,weathernext3:100,gefs:0},['wn','weathernext3'],['ecmwf','gefs'])});
  const warning=lowConfidenceWarning([today(),today(),today(),today(),today(),sunday]);
  assert.equal(warning.items[0].dayLabel,'Sunday');
  assert.equal(warning.items[0].kind,'rain chance');
  assert.match(warning.items[0].text,/whether it rains enough to matter/i);
  assert.doesNotMatch(warning.items[0].text,/wind|cloud/i);
});

test('an isolated short-coverage gust cannot create a wind warning',()=>{
  const thursday=day('2026-11-26',{rain:100,temperature:68,sky:100},{condition:'Showers And Thunderstorms',pop:100,qpf:1.1,wind:'10 to 21 mph',guidance:{short:{gust:49,coverageHours:2},a:{gust:36,coverageHours:24},b:{gust:28,coverageHours:24}},fullWindowQpf:{sourceValues:{a:1,b:1.1,c:1.15}}});
  assert.equal(lowConfidenceWarning([today(),today(),thursday]),null);
});

test('hazardous wind needs real hazard wording or multi-source support',()=>{
  const windy=day('2026-11-25',{rain:95,temperature:95,sky:95},{condition:'Damaging winds possible',detail:'A high wind watch is in effect.',guidance:{a:{gust:55,coverageHours:24},b:{gust:46,coverageHours:24},c:{gust:31,coverageHours:24}}});
  const warning=lowConfidenceWarning([today(),windy]);
  assert.equal(warning.items[0].kind,'hazardous wind');
  assert.match(warning.items[0].text,/whether winds become hazardous/i);
});

test('the popup lists up to three important uncertain future days',()=>{
  const days=[today()];
  for(let index=1;index<=4;index++)days.push(day(`2026-11-${24+index}`,{rain:50,temperature:90,sky:90},{condition:'Chance Rain',pop:20,qpf:.03,...rainPeak({a:100,b:100,c:0,d:0},['a','b'],['c','d'])}));
  const warning=lowConfidenceWarning(days);
  assert.equal(warning.items.length,3);
  assert.equal(warning.title,'3 important days');
  assert.equal(warning.modalTitle,'Forecast confidence · 3 days');
  const detail=confidenceWarningDetailHTML(warning);
  assert.equal((detail.match(/forecast-confidence-item"/g)||[]).length,3);
});

test('a confident storm cannot hide an uncertain major temperature swing on the same day',()=>{
  const warning=lowConfidenceWarning([
    day('2026-11-24',{rain:95,temperature:90,sky:90},{condition:'Sunny',high:60,low:45}),
    day('2026-11-25',{rain:95,temperature:50,sky:90},{condition:'Showers And Thunderstorms',pop:90,qpf:1,high:78,low:60,fullWindowQpf:{sourceValues:{a:.9,b:1,c:1.1}}})
  ]);
  assert.equal(warning.items[0].kind,'temperature swing');
  assert.match(warning.items[0].text,/how sharp the temperature change/i);
  assert.doesNotMatch(warning.items[0].text,/storm setup|wind/i);
});

test('compact bar shows the maximum estimate and popup gives each day its own percentage',()=>{
  const days=[today(),day('2026-11-25',{rain:48,temperature:90,sky:90},{condition:'Rain',pop:85,qpf:.6}),day('2026-11-26',{rain:42,temperature:90,sky:90},{condition:'Chance Rain',pop:20,qpf:.03,...rainPeak({a:100,b:100,c:0,d:0},['a','b'],['c','d'])})];
  const warning=lowConfidenceWarning(days),bar=confidenceWarningHTML(warning),detail=confidenceWarningDetailHTML(warning);
  assert.match(bar,/Forecast still uncertain/);
  assert.match(bar,/Up to \d+%/);
  assert.match(bar,/maximum change risk/);
  assert.match(detail,/most important unsettled parts/i);
  assert.match(detail,/not historically calibrated probabilities/i);
});

test('confidence control remains a compact top row and opens the multi-day explanation',()=>{
  const index=readFileSync(new URL('../public/weather-fusion/v3/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/weather-fusion/v3/css/styles.css',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/weather-fusion/v3/js/app.js',import.meta.url),'utf8');
  assert.ok(index.indexOf('id="forecast-confidence-bar"')>index.indexOf('class="shell hero-stage"'));
  assert.ok(index.indexOf('id="forecast-confidence-bar"')<index.indexOf('id="today-forecast"'));
  assert.match(css,/\.forecast-confidence-button\s*\{[^}]*min-height:\s*52px/s);
  assert.match(css,/\.forecast-confidence-list/);
  assert.match(app,/openModal\(warning\.modalTitle/);
});
