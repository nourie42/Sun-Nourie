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
  return {date,low:65,high:82,condition:'Mostly Sunny',rainLikelihood:{value:chance},popDayLikelihood:{value:chance},popNightLikelihood:{value:chance},...extra};
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
      dewpoint:hours.map(hour => ({time:hour.time,value:68})),
    }},
  };
}

test('the wash blocker names its actual peak hour rather than confusing daytime with overnight',()=>{
  const f=fixture([49,22,41,0,0,0,0]);
  f.days[0].popDayLikelihood={value:44};
  f.days[0].rainLikelihood.peakTime='2026-09-12T21:00:00Z';
  const summary=carWashSummary(f,start);
  assert.equal(summary.chance,44);
  assert.equal(summary.reason,'Rain chance reaches 49% Sat 9 PM.');
  assert.equal(summary.canWash,false);
});

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

test('missing canonical chances never fall back to conflicting raw NWS values',()=>{
  assert.equal(dailyRainChance({rainLikelihood:{value:null},popDay:70,popNight:80}),null);
  assert.equal(dailyRainChance({popDayLikelihood:{value:null},popDay:70},'daytime'),null);
  assert.equal(dailyRainChance({popNightLikelihood:{value:null},popNight:80},'overnight'),null);
  assert.equal(hourlyRainChance({rainLikelihood:{value:null},pop:90}),null);
  assert.equal(dailyRainChance({rainLikelihood:{value:5,aggregation:'maximum-hourly',coverage:{complete:false}},pop:90}),null);
  assert.equal(carWashDayDecision([day(dates[0],null,{popDay:1,popNight:1}),day(dates[1],5),day(dates[2],5)]).state,'check');
});

test('visible Today chance matches the daytime card while the wash rule still includes tonight',()=>{
  const forecast=fixture([65,8,8,8,8,8,8]);
  forecast.days[0].popDayLikelihood={value:15};
  forecast.days[0].popNightLikelihood={value:65};
  const summary=carWashSummary(forecast,Date.parse('2026-09-12T12:00:00Z'));
  assert.equal(summary.chance,15);
  assert.equal(summary.days[0].chance,15);
  assert.equal(summary.days[0].label,'Today');
  assert.equal(summary.decisions[0].chance,65);
  assert.equal(summary.state,'wait');
});

test('after 3 PM the visible Tonight chance does not discard remaining afternoon rain from wash eligibility',()=>{
  const forecast=fixture([70,8,8,8,8,8,8]);
  forecast.days[0].popNightLikelihood={value:8};
  forecast.days[0].nightCondition='Clear';
  const before=carWashSummary(forecast,Date.parse('2026-09-12T14:59:00Z'));
  assert.equal(before.state,'wait');
  assert.equal(before.chance,70);
  const after=carWashSummary(forecast,Date.parse('2026-09-12T15:00:00Z'));
  assert.equal(after.state,'wait');
  assert.equal(after.chance,8);
  assert.equal(after.days[0].label,'Tonight');
  assert.equal(after.days[0].isDay,false);
  assert.equal(after.days[1].isDay,true);
  assert.match(carWashHTML(after).match(/<article class="car-wash-day"[\s\S]*?<\/article>/)?.[0]||'',/sky-moon/);
  assert.deepEqual(after.decisions[0].chances,[70,8,8]);
});

test('at 3:01 PM an 80% chance at 4 PM still means WAIT even with a dry night and next two days',()=>{
  const forecast=fixture([80,0,0,0,0,0,0]);
  const now=Date.parse('2026-09-12T15:01:00Z');
  forecast.days[0].rainLikelihood={value:80,aggregation:'maximum-hourly',coverage:{complete:true},window:{start:new Date(now).toISOString(),end:'2026-09-13T07:00:00Z'},peakTime:'2026-09-12T16:00:00Z'};
  forecast.days[0].popDayLikelihood={value:80,aggregation:'maximum-hourly',coverage:{complete:true}};
  forecast.days[0].popNightLikelihood={value:0,aggregation:'maximum-hourly',coverage:{complete:true}};
  forecast.hours.push({time:'2026-09-12T16:00:00Z',isDay:true,temperature:80,rainLikelihood:{value:80}});
  const summary=carWashSummary(forecast,now);
  assert.equal(summary.state,'wait');
  assert.equal(summary.canWash,false);
  assert.equal(summary.days[0].label,'Tonight');
  assert.equal(summary.chance,0);
  assert.deepEqual(summary.decisions[0].chances,[80,0,0]);
  assert.equal(bestWashWindow(forecast,0,now),null);
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

test('today facts never switch to a later recommended wash day',()=>{
 const forecast=fixture();
 forecast.days[0].low=70;forecast.days[0].high=90;
 forecast.days[0].rainLikelihood={value:40};forecast.days[0].popDayLikelihood={value:40};forecast.days[0].popNightLikelihood={value:40};
 forecast.days[1].rainLikelihood={value:40};forecast.days[1].popDayLikelihood={value:40};forecast.days[1].popNightLikelihood={value:40};
 forecast.days[2].rainLikelihood={value:40};forecast.days[2].popDayLikelihood={value:40};forecast.days[2].popNightLikelihood={value:40};
 forecast.days[3].low=50;forecast.days[3].high=60;
 const summary=carWashSummary(forecast,Date.parse('2026-09-12T12:00:00Z'));
 assert.equal(summary.state,'wait');
 assert.equal(summary.facts.temperature,'70°–90°');
 assert.notEqual(summary.facts.temperature,'50°–60°');
});

test('the low/high fact stays on the daily temperatures even when the wash window is shorter',()=>{
 const forecast=fixture([5,5,5,5,5,5,5]);
 forecast.days[0].low=65;forecast.days[0].high=90;
 const summary=carWashSummary(forecast,start);
 assert.equal(summary.canWash,true);
 assert.equal(summary.window.temperatureMin,72);
 assert.equal(summary.facts.temperature,'65°–90°');
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
  assert.match(html,/car-wash-corvette-hood\.webp/);
  assert.equal((html.match(/class="car-wash-day"/g)||[]).length,5);
  assert.doesNotMatch(html,/<img src=x onerror/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html,/<div class="car-wash-footer">/);
  assert.doesNotMatch(html,/<footer>/);
});

test('WAIT punctuation is after the word and the Corvette photo has no text overlays',()=>{
  const html=carWashHTML(carWashSummary(fixture([40,40,40,40,40,40,40]),start));
  assert.match(html,/class="car-wash-verdict wait"[^>]*>WAIT!<\/strong>/);
  assert.doesNotMatch(html,/>!<\/span>|! WAIT|!WAIT/);
  assert.equal((html.match(/class="car-wash-day-verdict">WAIT!</g)||[]).length,5);
  assert.match(html,/<div class="car-wash-photo"><img[^>]*src="\/weather-fusion\/car-wash-corvette-hood\.webp"[^>]*><\/div>/);
  assert.ok(html.indexOf('class="car-wash-hero"')<html.indexOf('class="car-wash-photo"'));
  assert.ok(html.indexOf('class="car-wash-photo"')<html.indexOf('class="car-wash-days-wrap"'));
  assert.doesNotMatch(html,/car-wash-overlay|Weather Nourie blend|Three-day rule applied/);
});

test('car-wash facts include the same Gross Meter scale used by the dew-point card',()=>{
  const summary=carWashSummary(fixture([5,5,5,5,5,5,5]),start),html=carWashHTML(summary);
  assert.deepEqual(summary.facts.gross,{title:'68° · GROSS',detail:'Gross Meter at wash time',value:68,level:'gross'});
  assert.match(html,/68° · GROSS/);
  assert.match(html,/Gross Meter at wash time/);
});
