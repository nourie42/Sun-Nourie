import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {weatherIcon,renderHourlyWeather} from '../public/weather-fusion/weather-display.js';
import {sevenDayForecast,sevenDayCardHTML} from '../public/weather-fusion/seven-day.js';
import {danTakeDisplay} from '../public/weather-fusion/dans-summary.js';
import {preview,now} from './weatherFusion.fixtures.js';

function rendered(experimental) {
  const root={innerHTML:'',scrollLeft:92};
  globalThis.document={getElementById:id=>id==='hourly'?root:null};
  try {renderHourlyWeather(preview,now,{experimental});return root;}
  finally {delete globalThis.document;}
}

test('experimental hourly uses the original markup, values and preview targets',()=>{
  const regular=rendered(false),experimental=rendered(true);
  assert.equal(experimental.innerHTML,regular.innerHTML);
  assert.equal(experimental.scrollLeft,92);
  assert.match(experimental.innerHTML,/<svg width="32" height="32"/);
  assert.doesNotMatch(experimental.innerHTML,/class="seven-day-art"/);
  assert.doesNotMatch(regular.innerHTML,/class="seven-day-art"/);
});

test('daily keeps flat icons without modifying original hourly artwork',()=>{
  const day=sevenDayForecast(preview,now)[0];
  for(const condition of ['Sunny','Mostly Sunny','Partly Cloudy','Rain','Thunderstorms','Snow','Fog',''])for(const isDay of [true,false]) {
    const art=weatherIcon(condition,isDay,44);
    assert.ok(sevenDayCardHTML({...day,condition,isDay}).includes(art));
    assert.match(art,/data-weather-kind=/);
  }
  assert.match(weatherIcon('Sunny',false,44),/class="sky-moon"/);
  assert.doesNotMatch(weatherIcon('',true,44),/seven-day-art/);
});

test('seven-day styling never overrides the original hourly forecast',()=>{
  const css=readFileSync(new URL('../public/weather-fusion/seven-day.css',import.meta.url),'utf8');
  const week=readFileSync(new URL('../public/weather-fusion/seven-day.js',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/weather-fusion/app.js',import.meta.url),'utf8');
  assert.doesNotMatch(css,/#hourly|\.hourly-panel|\.hour-feels|\.hour-uv|\.hour-wind/);
  assert.doesNotMatch(week,/experimental-week-art|seven-day-art\.css/);
  assert.match(app,/renderHourlyWeather\(data,Date\.now\(\)\)/);
});

test('quiet daily cards reserve emphasis for headings and temperatures',()=>{
  const css=readFileSync(new URL('../public/weather-fusion/seven-day.css',import.meta.url),'utf8');
  assert.match(css,/\.seven-day-heading h2\{[^}]*font-weight:600/);
  assert.match(css,/\.seven-day-temperatures strong\{[^}]*font-weight:600/);
  assert.match(css,/\.seven-day-metric strong\{[^}]*font-weight:400/);
  assert.match(css,/\.seven-day-confidence-label strong\{[^}]*font-weight:400/);
  assert.match(css,/\.seven-day-card\{[^}]*border-radius:8px;background:#073550/);
  assert.match(css,/\.seven-day-card\[aria-pressed="true"\]\{[^}]*box-shadow:none/);
  assert.match(css,/#today-uncertainty p\{font-weight:400\}/);
  assert.doesNotMatch(css,/font-weight:(?:700|750|800|850)/);
});

test('Nourie Weather Take is also named correctly in model comparison text',()=>{
  assert.match(danTakeDisplay(null,{comparison:{source:'google'}},now),/^Nourie Weather Take/);
  assert.doesNotMatch(danTakeDisplay(null,{comparison:{source:'google'}},now),/Dan.s Take/);
});
