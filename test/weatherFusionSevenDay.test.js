import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sevenDayForecast,sevenDayCardHTML,createSevenDayCarousel} from '../public/weather-fusion/seven-day.js';
import {dailyDisplay} from '../public/weather-fusion/weather-math.js';
import {displayedRainChance} from '../public/weather-fusion/rain-display.js';
import {forecastPeriodSummary} from '../public/weather-fusion/forecast-story.js';
import {preview,now,H} from './weatherFusion.fixtures.js';

test('seven day cards share the existing daily timing, rain, totals and confidence',()=>{
  const days=sevenDayForecast(preview,now);
  assert.equal(days.length,7);
  days.forEach((day,index)=>{
    const display=dailyDisplay(preview.days[index],index,now,preview.location.timeZone);
    assert.equal(day.high,display.tonight?null:display.primary);
    assert.equal(day.low,display.tonight?display.primary:display.secondary);
    assert.equal(day.pop,displayedRainChance(preview,display.pop,{dayIndex:index,now}).value);
    assert.equal(day.amount,forecastPeriodSummary(preview,index,display.phase,now).amount);
    assert.equal(day.confidence,preview.days[index].confidence);
  });
});

test('tonight switches the first card to the matching overnight forecast',()=>{
  const evening=now+8*H,first=sevenDayForecast(preview,evening)[0];
  const display=dailyDisplay(preview.days[0],0,evening,preview.location.timeZone);
  assert.equal(first.label,'Tonight');assert.equal(first.high,null);assert.equal(first.low,display.primary);
  assert.equal(first.isDay,false);
  assert.equal(first.amount,forecastPeriodSummary(preview,0,'overnight',evening).amount);
});

test('real zeros remain zero and missing inputs are never fabricated',()=>{
  const forecast=structuredClone(preview);
  forecast.days[0].qpf=0;forecast.days[0].pop=0;
  forecast.days[0].rainLikelihood=null;forecast.days[0].popDayLikelihood=null;forecast.days[0].popNightLikelihood=null;
  forecast.hours=[];delete forecast.rainTimeline;forecast.metricForecasts={series:{wind:[]}};
  const day=sevenDayForecast(forecast,now)[0];
  assert.equal(day.amount,0);assert.equal(day.wind,null);
  const html=sevenDayCardHTML(day);
  assert.match(html,/0\.00 in/);assert.doesNotMatch(html,/NaN|undefined/);
  forecast.days[0].qpf=null;forecast.days[0].confidence=null;
  const missing=sevenDayForecast(forecast,now)[0];
  assert.equal(missing.amount,null);assert.equal(missing.confidence,null);
  assert.doesNotMatch(sevenDayCardHTML(missing),/aria-valuenow=/);
});

test('observed rain follows the current-day policy and never spreads to later cards',()=>{
  const forecast=structuredClone(preview);
  forecast.current.radarPrecipitation={status:'ready',atLocation:true,time:new Date(now).toISOString()};
  const days=sevenDayForecast(forecast,now);
  assert.equal(days[0].observed,displayedRainChance(forecast,days[0].pop,{now}).observed);
  assert.ok(days.slice(1).every(day=>!day.observed));
});

test('the regular page does not mount a carousel or touch the document',()=>{
  assert.equal(createSevenDayCarousel({experimental:false}),null);
  assert.equal(createSevenDayCarousel({experimental:true}),null);
});

test('compact cards retain every forecast reading and the absolute confidence score',()=>{
  for(const [key,label,score] of [['high','High',95],['moderate','Moderate',75],['low','Low',60],['very-low','Very low',35]]){
    const day={...sevenDayForecast(preview,now)[0],confidence:{key,label,score,factors:[],note:'Relative index'}};
    const html=sevenDayCardHTML(day);
    assert.match(html,/seven-day-card-heading/);
    assert.match(html,/seven-day-weather/);
    assert.match(html,/Total precip/);
    assert.match(html,/Wind/);
    assert.ok(html.includes(`data-confidence="${key}"`));
    assert.ok(html.includes(`aria-valuenow="${score}"`));
    assert.ok(html.includes(`--confidence:${score}%`));
  }
});

test('all confidence meters share a fading red-yellow-green absolute scale',()=>{
  const polish=readFileSync(new URL('../public/weather-fusion/weather-polish.css',import.meta.url),'utf8');
  const week=readFileSync(new URL('../public/weather-fusion/seven-day.css',import.meta.url),'utf8');
  assert.match(polish,/--confidence-scale:linear-gradient\(90deg,var\(--confidence-low\).*var\(--confidence-medium\).*var\(--confidence-high\)/);
  assert.match(polish,/\[data-confidence="high"\]\{--confidence-color:var\(--confidence-high\)/);
  assert.match(polish,/\[data-confidence="moderate"\]\{--confidence-color:var\(--confidence-medium\)/);
  assert.match(polish,/\[data-confidence="low"\],\[data-confidence="very-low"\]\{--confidence-color:var\(--confidence-low\)/);
  assert.match(polish,/\.confidence-meter\{background:var\(--confidence-scale\)/);
  assert.match(polish,/\.confidence-meter em\{position:relative;background:transparent/);
  assert.match(week,/\.seven-day-meter\{[^}]*background:var\(--confidence-scale\)/);
  assert.match(week,/height:var\(--week-height,/);
});
