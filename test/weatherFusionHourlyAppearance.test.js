import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {forecastWeatherArtwork,renderHourlyWeather} from '../public/weather-fusion/weather-display.js';
import {sevenDayForecast,sevenDayCardHTML} from '../public/weather-fusion/seven-day.js';
import {danTakeDisplay} from '../public/weather-fusion/dans-summary.js';
import {preview,now} from './weatherFusion.fixtures.js';

function rendered(experimental) {
  const root={innerHTML:'',scrollLeft:92};
  globalThis.document={getElementById:id=>id==='hourly'?root:null};
  try {renderHourlyWeather(preview,now,{experimental});return root;}
  finally {delete globalThis.document;}
}

test('experimental artwork changes neither hourly values nor preview targets',()=>{
  const regular=rendered(false),experimental=rendered(true);
  const withoutArt=html=>html.replace(/<svg[^>]*data-weather-kind="[^"]*"[^>]*>[\s\S]*?<\/svg>|<span class="seven-day-art"[^>]*><\/span>/g,'');
  assert.equal(withoutArt(experimental.innerHTML),withoutArt(regular.innerHTML));
  assert.equal(experimental.scrollLeft,92);
  assert.match(experimental.innerHTML,/<svg width="44" height="44"/);
  assert.doesNotMatch(experimental.innerHTML,/class="seven-day-art"/);
  assert.doesNotMatch(regular.innerHTML,/class="seven-day-art"/);
});

test('daily and hourly use identical artwork, including night and missing sky',()=>{
  const day=sevenDayForecast(preview,now)[0];
  for(const condition of ['Sunny','Mostly Sunny','Partly Cloudy','Rain','Thunderstorms','Snow','Fog',''])for(const isDay of [true,false]) {
    const art=forecastWeatherArtwork(condition,isDay);
    assert.ok(sevenDayCardHTML({...day,condition,isDay}).includes(art));
    assert.match(art,/data-weather-kind=/);
  }
  assert.match(forecastWeatherArtwork('Sunny',false),/class="sky-moon"/);
  assert.doesNotMatch(forecastWeatherArtwork('Sunny',false),/class="sky-sun"/);
  assert.doesNotMatch(forecastWeatherArtwork('',true),/seven-day-art/);
});

test('hourly styling and artwork are scoped to the experimental page',()=>{
  const css=readFileSync(new URL('../public/weather-fusion/seven-day.css',import.meta.url),'utf8');
  const week=readFileSync(new URL('../public/weather-fusion/seven-day.js',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/weather-fusion/app.js',import.meta.url),'utf8');
  assert.match(css,/html\[data-weather-page="experimental"\] #hourly button\.hour\{[^}]*border:1px solid #437b93/);
  assert.doesNotMatch(week,/experimental-week-art|seven-day-art\.css/);
  assert.match(app,/renderHourlyWeather\(data,Date\.now\(\),\{experimental:experimentalPage\}\)/);
});

test('quiet forecasts reserve emphasis for headings and temperatures',()=>{
  const css=readFileSync(new URL('../public/weather-fusion/seven-day.css',import.meta.url),'utf8');
  assert.match(css,/\.seven-day-heading h2\{[^}]*font-weight:600/);
  assert.match(css,/\.seven-day-temperatures strong\{[^}]*font-weight:600/);
  assert.match(css,/\.seven-day-metric strong\{[^}]*font-weight:400/);
  assert.match(css,/\.seven-day-confidence-label strong\{[^}]*font-weight:500/);
  assert.match(css,/\.seven-day-card\{[^}]*border-radius:8px;background:#073550/);
  assert.match(css,/\.seven-day-card\[aria-pressed="true"\]\{[^}]*box-shadow:none/);
  assert.match(css,/#today-uncertainty p\{font-weight:400\}/);
  assert.match(css,/#hourly \.hour-uv>b\{font-weight:400\}/);
  assert.doesNotMatch(css,/font-weight:(?:700|750|800|850)/);
});

test('Nourie Weather Take is also named correctly in model comparison text',()=>{
  assert.match(danTakeDisplay(null,{comparison:{source:'google'}},now),/^Nourie Weather Take/);
  assert.doesNotMatch(danTakeDisplay(null,{comparison:{source:'google'}},now),/Dan.s Take/);
});
