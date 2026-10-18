import test from 'node:test';
import assert from 'node:assert/strict';
import {hideLowRainChance} from '../public/weather-fusion/rain-display.js';
import {sevenDayCardHTML} from '../public/weather-fusion/seven-day.js';
import {hourlyRainHTML} from '../public/weather-fusion/weather-display.js';
import {todayForecastHTML} from '../public/weather-fusion/today-card.js';
import {carWashHTML,carWashSummary} from '../public/weather-fusion/car-wash.js';
import {forecastPeriodSummary} from '../public/weather-fusion/forecast-story.js';
import {buildSeries} from '../public/weather-fusion/wn-blend.js';
import {dayGraphPoints} from '../public/weather-fusion/day-graph.js';
import {buildForecast} from '../src/weatherFusion.js';
import {testInputs} from './weatherFusion.fixtures.js';

function forecast(chance){
 const f=buildForecast(structuredClone(testInputs));
 for(const row of [...f.rainTimeline,...f.hours])row.rainLikelihood={...row.rainLikelihood,value:chance};
 for(const day of f.days)for(const key of ['rainLikelihood','popDayLikelihood','popNightLikelihood'])if(day[key])day[key]={...day[key],value:chance};
 return f;
}

test('the display cutoff excludes 0 through under 5 and retains 5, observations and missing states',()=>{
 for(const value of [0,1,2,4,4.999])assert.equal(hideLowRainChance(value),true);
 for(const value of [5,5.1,100,null,undefined,NaN,-1])assert.equal(hideLowRainChance(value),false);
 const observed=hourlyRainHTML({now:true,pop:2,currentPrecipitation:{forecast:false,label:'Rain now',source:'Observed radar'}});
 assert.match(observed,/Rain now/);assert.doesNotMatch(observed,/2%/);
 assert.match(hourlyRainHTML({rainLikelihood:{value:null}}),/—/);
});

test('daily and hourly cards omit low percentages from visible and accessible text without altering the input',()=>{
 for(const value of [0,1,4]){
  const day={index:1,date:'2026-10-18',label:'Sun',dateLabel:'Oct 18',condition:'Sunny',high:60,low:42,pop:value,amount:0,wind:10};
  const before=structuredClone(day),html=sevenDayCardHTML(day);
  assert.match(html,/data-rain-chance-hidden/);
  assert.doesNotMatch(html,/Rain chance [014]%|Rain chance: [014]%/);
  assert.doesNotMatch(hourlyRainHTML({rainLikelihood:{value}}),/hour-pop|%/);
  assert.deepEqual(day,before);
 }
 const shown=sevenDayCardHTML({pop:5});assert.match(shown,/Rain chance: 5%/);assert.doesNotMatch(shown,/data-rain-chance-hidden/);
 assert.match(hourlyRainHTML({rainLikelihood:{value:5}}),/5%/);
});

test('low rain chances disappear from Today, car wash and prose while their underlying forecasts remain exact',()=>{
 for(const value of [0,2,4]){
  const f=forecast(value),now=testInputs.now,before=structuredClone(f),story=forecastPeriodSummary(f,0,'overall',now);
  assert.equal(story.chance,value);assert.doesNotMatch(story.summary,/\b[0-4]%/);
  assert.doesNotMatch(todayForecastHTML(f,now),/Rain chance [0-4] percent|<strong>[0-4]%<\/strong>/);
  assert.doesNotMatch(carWashHTML(carWashSummary(f,now)),/💧 [0-4]%|<b>[0-4]%<\/b>/);
  assert.ok(dayGraphPoints(f,1,false,now).some(p=>p.rainChance===value));
  assert.equal(buildSeries(f,null,'pop',now).forecastValues[1],value);
  assert.deepEqual(f,before,'formatting does not change model inputs, amounts, decisions or source evidence');
 }
 const f=forecast(5),now=testInputs.now;
 assert.match(todayForecastHTML(f,now),/<strong>5%<\/strong>/);
 assert.match(carWashHTML(carWashSummary(f,now)),/💧 5%/);
 assert.match(forecastPeriodSummary(f,0,'overall',now).summary,/5%/);
});
