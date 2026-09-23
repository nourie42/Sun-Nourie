import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {displayFeelsValue,displayedFeelsAt,feelsAt,summarizeFeels,GUSTY_FEELS_DISPLAY_MPH} from '../public/weather-fusion/hourly-feels.js';

const H=3600000;
const t='2026-09-23T22:00:00.000Z';

test('display-only feels floor never drops below dew point unless gusts are truly gusty',()=>{
 assert.equal(GUSTY_FEELS_DISPLAY_MPH,25);
 assert.equal(displayFeelsValue(47,60,10),60);
 assert.equal(displayFeelsValue(47,60,24.9),60);
 assert.equal(displayFeelsValue(47,60,25),47);
 assert.equal(displayFeelsValue(62,60,5),62);
 assert.equal(displayFeelsValue(47,null,5),47);
});

test('raw thermal series stays unchanged while displayed hourly and daily summaries use the floor',()=>{
 const forecast={metricForecasts:{series:{
  feels:[{time:t,value:47}],
  dewpoint:[{time:t,value:60}],
  gust:[{time:t,value:12}],
 }}};
 assert.equal(feelsAt(forecast,t),47,'raw feels-like series remains the model output');
 assert.equal(displayedFeelsAt(forecast,t),60,'visible feels-like is floored at the dew point');
 const summary=summarizeFeels(forecast,Date.parse(t)-H,Date.parse(t)+H,-Infinity);
 assert.equal(summary.low.value,60);
 assert.equal(summary.low.rawValue,47);
 assert.equal(forecast.metricForecasts.series.feels[0].value,47,'display rule must not mutate the API/model series');
});

test('long-term forecast markup includes sustained wind and optional gust context',()=>{
 const experience=readFileSync(new URL('../public/weather-fusion/experience.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/weather-fusion/scenario-layout.css',import.meta.url),'utf8');
 assert.match(experience,/class="day-wind-chip"/);
 assert.match(experience,/Wind \$\{lo\}–\$\{hi\} mph/);
 assert.match(experience,/G\$\{wind\.gust\}/);
 assert.match(css,/\.daily-panel \.day-wind-chip/);
});
