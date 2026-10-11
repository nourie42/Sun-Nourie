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
  assert.match(css,/\.seven-day-card\{[^}]*border:1px solid #168cd645;border-radius:20px;background:linear-gradient\(160deg,#06477775,#07375777\)/);
  assert.match(css,/\.seven-day-card\[aria-pressed="true"\]\{border-color:#31bcffa6;background:linear-gradient\(155deg,#087bc3,#084878 72%\);box-shadow:inset 0 0 15px #29b9ff18/);
  assert.match(css,/#today-uncertainty p\{font-weight:400\}/);
  assert.doesNotMatch(css,/font-weight:(?:700|750|800|850)/);
});

test('seven-day surfaces and temperatures use the surrounding forecast palette',()=>{
  const css=readFileSync(new URL('../public/weather-fusion/seven-day.css',import.meta.url),'utf8');
  const surrounding=readFileSync(new URL('../public/weather-fusion/forecast-cards.css',import.meta.url),'utf8');
  const daily=readFileSync(new URL('../public/weather-fusion/scenario-layout.css',import.meta.url),'utf8');
  for(const finish of [
    'background:radial-gradient(ellipse at 25% 0,#1688b426,transparent 70%),linear-gradient(135deg,#104773,#073b63 60%,#073153)',
    'background:radial-gradient(ellipse at 25% 0,#174b762b,transparent 68%),linear-gradient(145deg,#072b4a,#051d36 62%,#04172c)',
    'border-color:#5ba8d052',
    'box-shadow:inset 0 1px 2px #a3e8ff20,0 12px 28px #041d3626',
    'border:1px solid #168cd645',
    'background:linear-gradient(160deg,#06477775,#07375777)',
    'background:linear-gradient(155deg,#087bc3,#084878 72%)'
  ]){assert.ok(css.includes(finish),finish);assert.ok(surrounding.includes(finish),finish);}
  assert.match(css,/--week-cyan:#9addf8/);assert.match(daily,/\.day-low\{[^}]*color:#9addf8/);
  assert.match(css,/\.seven-day-temperatures strong\{[^}]*color:#fff/);
  assert.match(css,/\.seven-day-metric\{[^}]*color:#71d7ff/);
  assert.match(css,/\.seven-day-metric:last-child\{color:#97ddfa\}/);
  assert.match(css,/\.seven-day-carousel\{[^}]*border-radius:28px/);
  assert.match(css,/\.seven-day-carousel\{padding:6px 9px;border-radius:20px\}/);
});

test('Nourie Weather Take is also named correctly in model comparison text',()=>{
  assert.match(danTakeDisplay(null,{comparison:{source:'google'}},now),/^Nourie Weather Take/);
  assert.doesNotMatch(danTakeDisplay(null,{comparison:{source:'google'}},now),/Dan.s Take/);
});
