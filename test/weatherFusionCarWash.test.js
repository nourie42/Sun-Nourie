import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR_WASH_RAIN_LIMIT,
  isExperimentalWeatherPage,
  dailyRainChance,
  hourlyRainChance,
  carWashDayDecision,
  bestWashWindow,
  carWashSummary,
  carWashHTML,
} from '../public/weather-fusion/car-wash.js';

const HOUR = 3600000;
const start = Date.parse('2026-09-12T07:00:00Z');
const iso = offset => new Date(start + offset * HOUR).toISOString();
const dates = ['2026-09-12','2026-09-13','2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18'];

function day(date, chance, extra = {}) {
  return {date,low:65,high:82,condition:'Mostly Sunny',rainLikelihood:{value:chance},...extra};
}

function fixture(chances = [10,10,10,30,10,10,10]) {
  const hours = Array.from({length:12},(_,index) => ({
    time:iso(index),isDay:true,temperature:72+index,
    pop:90,rainLikelihood:{value:index < 5 ? 8 : 30},
  }));
  return {
    location:{timeZone:'UTC'},
    current:{type:'observation',condition:'Clear'},
    days:dates.map((date,index) => day(date,chances[index])),
    hours,
    metricForecasts:{series:{
      wind:hours.map((hour,index) => ({time:hour.time,value:4+index%3})),
      temperature:hours.map(hour => ({time:hour.time,value:hour.temperature})),
    }},
  };
}

test('car-wash threshold is strict: three days below 25% wash, exactly 25% waits',()=>{
  assert.equal(CAR_WASH_RAIN_LIMIT,25);
  assert.deepEqual(carWashDayDecision([day(dates[0],24),day(dates[1],24),day(dates[2],24)]),{
    index:0,state:'wash',canWash:true,chance:24,chances:[24,24,24],reason:'Three low-rain days are lined up.'
  });
  const exact = carWashDayDecision([day(dates[0],24),day(dates[1],25),day(dates[2],0)]);
  assert.equal(exact.state,'wait');
  assert.equal(exact.canWash,false);
  assert.equal(exact.blocker,1);
  assert.match(exact.reason,/25%/);
});

test('incomplete three-day data stays CHECK instead of inventing a wash forecast',()=>{
  const incomplete = carWashDayDecision([day(dates[0],5),day(dates[1],5)]);
  assert.equal(incomplete.state,'check');
  assert.equal(incomplete.canWash,false);
  assert.match(incomplete.reason,/not available/);
  const missing = carWashDayDecision([day(dates[0],5),day(dates[1],null),day(dates[2],5)]);
  assert.equal(missing.state,'check');
});

test('car-wash math uses the Weather Nourie blend before raw provider percentages',()=>{
  assert.equal(dailyRainChance({pop:90,rainLikelihood:{value:8}}),8);
  assert.equal(dailyRainChance({pop:90,popDayLikelihood:{value:7},popNightLikelihood:{value:13}}),13);
  assert.equal(hourlyRainChance({pop:90,rainLikelihood:{value:6}}),6);
  assert.equal(hourlyRainChance({pop:12}),12);
});

test('a whole-day fallback requires both day and night periods',()=>{
  assert.equal(dailyRainChance({popDayLikelihood:{value:8}}),null);
  assert.equal(dailyRainChance({popNightLikelihood:{value:8}}),null);
  assert.equal(dailyRainChance({popDay:8}),null);
  assert.equal(dailyRainChance({popNight:8}),null);
  assert.equal(dailyRainChance({popDayLikelihood:{value:8},popNightLikelihood:{value:12}}),12);
  assert.equal(carWashDayDecision([
    {date:dates[0],popDayLikelihood:{value:8}},day(dates[1],8),day(dates[2],8),
  ]).state,'check');
});

test('after 3 PM today uses the remaining tonight chance while earlier hours use the whole day',()=>{
  const forecast=fixture([70,8,8,8,8,8,8]);
  forecast.days[0].popNightLikelihood={value:8};
  const before=carWashSummary(forecast,Date.parse('2026-09-12T14:59:00Z'));
  assert.equal(before.state,'wait');
  assert.equal(before.chance,70);
  const after=carWashSummary(forecast,Date.parse('2026-09-12T15:00:00Z'));
  assert.equal(after.state,'wash');
  assert.equal(after.chance,8);
  assert.deepEqual(after.decisions[0].chances,[8,8,8]);
});

test('low rain chance never rewrites the forecast condition or its weather icon',()=>{
  const forecast=fixture([5,5,5,5,5,5,5]);
  forecast.days[0].condition='Slight Chance Thunderstorms';
  const summary=carWashSummary(forecast,start);
  assert.equal(summary.days[0].condition,'Slight Chance Thunderstorms');
  const firstCard=carWashHTML(summary).match(/<article class="car-wash-day"[\s\S]*?<\/article>/)?.[0]||'';
  assert.match(firstCard,/data-weather-kind="storm"/);
  assert.match(firstCard,/sky-lightning/);
});

test('five displayed days each apply the same rolling three-day rule',()=>{
  const summary = carWashSummary(fixture(),start);
  assert.deepEqual(summary.decisions.map(item => item.state),['wash','wait','wait','wait','wash']);
  assert.deepEqual(summary.days.map(item => item.chances),[
    [10,10,10],[10,10,30],[10,30,10],[30,10,10],[10,10,10],
  ]);
});

test('an observed shower overrides today even when the three-day outlook is dry',()=>{
  const forecast = fixture([5,5,5,5,5,5,5]);
  forecast.current = {type:'observation',condition:'Rain Showers'};
  const summary = carWashSummary(forecast,start);
  assert.equal(summary.state,'wait');
  assert.equal(summary.canWash,false);
  assert.equal(summary.decisions[0].activeWeather,true);
  assert.match(summary.reason,/happening now/);
});

test('best wash window follows contiguous blended hourly chances, not conflicting raw POP',()=>{
  const forecast = fixture([5,5,5,5,5,5,5]);
  forecast.hours.forEach((hour,index) => {
    hour.pop = index < 5 ? 95 : 0;
    hour.rainLikelihood.value = index < 5 ? 8 : 35;
  });
  const window = bestWashWindow(forecast,0,start);
  assert.ok(window);
  assert.equal(window.hours,5);
  assert.equal(window.rainChance,8);
  assert.equal(window.label,'7AM–12PM');
});

test('experimental detection is exact and car-wash markup is dynamic, five-day, and escaped',()=>{
  assert.equal(isExperimentalWeatherPage('/weather-fusion/experimental-weather.html'),true);
  assert.equal(isExperimentalWeatherPage('/weather-fusion/experimental-weather.html/'),true);
  assert.equal(isExperimentalWeatherPage('/weather-fusion/'),false);
  const summary = carWashSummary(fixture([5,5,5,5,5,5,5]),start);
  summary.reason = '<img src=x onerror=alert(1)>';
  const html = carWashHTML(summary);
  assert.match(html,/Car Wash Forecast/);
  assert.match(html,/car-wash-background\.webp/);
  assert.equal((html.match(/class="car-wash-day"/g)||[]).length,5);
  assert.doesNotMatch(html,/<img src=x onerror/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html,/<div class="car-wash-footer">/);
  assert.doesNotMatch(html,/<footer>/);
});
