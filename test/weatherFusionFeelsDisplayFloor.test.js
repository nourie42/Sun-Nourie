import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {displayFeelsValue,displayedFeelsAt,feelsAt,summarizeFeels,GUSTY_FEELS_DISPLAY_MPH} from '../public/weather-fusion/hourly-feels.js';

const H=3600000;
const t='2026-09-23T22:00:00.000Z';

test('gusts and dew point do not replace or floor the physical thermal estimate',()=>{
 assert.equal(GUSTY_FEELS_DISPLAY_MPH,25,'threshold remains only for highlighting wind chips');
 for(const gust of [null,12,24.9,25,25.1,40]){
  assert.equal(displayFeelsValue(33,50,gust),33);
  assert.equal(displayFeelsValue(0,20,gust),0);
 }
 assert.equal(displayFeelsValue(null,50,10),null);
 assert.equal(displayFeelsValue(Infinity,50,10),null);
});

test('visible hourly and daily summaries preserve the same calculated equivalent temperature',()=>{
 const forecast={metricForecasts:{series:{
  feels:[{time:t,value:33}],
  dewpoint:[{time:t,value:50}],
  gust:[{time:t,value:24.9}],
 }}};
 assert.equal(feelsAt(forecast,t),33);
 assert.equal(displayedFeelsAt(forecast,t),33);
 forecast.metricForecasts.series.gust[0].value=25.1;
 assert.equal(displayedFeelsAt(forecast,t),33,'crossing the gust threshold cannot cause a thermal cliff');
 const summary=summarizeFeels(forecast,Date.parse(t)-H,Date.parse(t)+H,-Infinity);
 assert.equal(summary.low.value,33);
 assert.equal(summary.low.rawValue,33);
 assert.equal(forecast.metricForecasts.series.feels[0].value,33);
});

test('long-term forecast markup includes sustained wind and optional gust context',()=>{
 const experience=readFileSync(new URL('../public/weather-fusion/experience.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/weather-fusion/scenario-layout.css',import.meta.url),'utf8');
 assert.match(experience,/class="day-wind-chip"/);
 assert.match(experience,/Wind \$\{lo\}–\$\{hi\} mph/);
 assert.match(experience,/G\$\{wind\.gust\}/);
 assert.match(css,/\.daily-panel \.day-wind-chip/);
});
