import test from 'node:test';
import assert from 'node:assert/strict';
import {displayForecastConfidence,displayTemperatureConfidence,forecastConfidenceLabel,confidenceDetailsHTML,confidenceWeatherEvidenceHTML} from '../public/weather-fusion/forecast-confidence.js';
import {sevenDayCardHTML} from '../public/weather-fusion/seven-day.js';
import {confidenceNotice,confidenceBannerHTML,todayForecastHTML} from '../public/weather-fusion/today-card.js';

const time='2026-10-21T16:00:00Z',window={start:time,end:'2026-10-22T04:00:00Z'};
function confidence(weatherKey='high',temperatureKey='low'){
 const ids=['nws','hrrr','ecmwf','nbm'],label=key=>key[0].toUpperCase()+key.slice(1);
 const hour={time,end:'2026-10-21T17:00:00Z',agreement:1,category:'clear',sources:ids.map(id=>({id,value:0,category:'clear',weight:.25}))};
 const weather={scope:'sky-and-rain',score:weatherKey==='high'?95:55,key:weatherKey,label:label(weatherKey),sourceIds:ids,sourceCount:4,summary:weatherKey==='high'?'Sky and rain forecasts agree closely.':'Cloud and rain forecasts disagree.',factors:['Four complete sky and rain sources'],note:'Model agreement is not a probability of correct weather.',evidence:{window,
  sky:{scope:'daylight',window,expectedHours:6,coveredHours:6,completeSources:ids,hours:[hour],worstHour:hour},
  rain:{window,expectedHours:12,coveredHours:12,completeSources:ids,hours:[],worstHour:{...hour,category:'dry',sources:hour.sources.map(s=>({...s,category:'dry'})),officialPop:0,probabilityConflict:false}}}};
 const temperature={score:temperatureKey==='low'?55:95,key:temperatureKey,label:label(temperatureKey),summary:'Temperature models differ by20°F.',factors:['20°F temperature gap'],note:'Temperature agreement only.',temperatureComparison:{basis:'maximum-same-hour-spread',worstHour:{time,spread:20,low:{id:'nws',value:60},high:{id:'wn',value:80},sources:[{id:'nws',value:60},{id:'wn',value:80}]},dailyHigh:{spread:20,low:{id:'nws',value:60},high:{id:'wn',value:80},sources:[{id:'nws',value:60},{id:'wn',value:80}]}}};
 return {...temperature,weather,temperature};
}
function card(c){return {index:2,label:'Wednesday',date:'2026-10-21',dateLabel:'Oct21',condition:'Sunny',shortCondition:'Sunny',high:72,low:50,pop:0,amount:0,wind:5,isDay:true,confidence:c};}

test('display helpers select independent weather/temperature grades and preserve legacy identity',()=>{
 const c=confidence();assert.equal(displayForecastConfidence(c),c.weather);assert.equal(displayTemperatureConfidence(c),c.temperature);
 const old={label:'Low',key:'low',score:55};assert.equal(displayForecastConfidence(old),old);assert.equal(displayTemperatureConfidence(old),old);
 assert.equal(forecastConfidenceLabel(c),'Sky/rain agreement');assert.equal(forecastConfidenceLabel(old),'Forecast confidence');
});
test('sunny sky/rain agreement remains High on the compact card despite Low temperature confidence',()=>{
 const html=sevenDayCardHTML(card(confidence()));
 assert.match(html,/class="seven-day-confidence" data-confidence="high"/);
 assert.match(html,/<span>Sky\/rain agreement<\/span><strong>High<\/strong>/);
 assert.match(html,/Sky\/rain agreement High/);
 assert.doesNotMatch(html,/Forecast confidence Low|>Low<\/strong>/);
 assert.equal(confidenceNotice(confidence()),null);assert.equal(confidenceBannerHTML({confidence:confidence()}),'');
});
test('cloud/rain disagreement retains a Low primary grade even when temperatures agree',()=>{
 const c=confidence('low','high'),html=sevenDayCardHTML(card(c));
 assert.match(html,/class="seven-day-confidence" data-confidence="low"/);assert.match(html,/<strong>Low<\/strong>/);
 assert.match(confidenceNotice(c).title,/Low sky\/rain agreement/);
 assert.match(confidenceNotice(c).text,/Cloud and rain forecasts disagree/);
});
test('the day dialog names both distinct grades and exposes actual sky/rain coverage',()=>{
 const html=confidenceDetailsHTML(confidence(),{timeZone:'America/New_York',assembledAt:time});
 assert.match(html,/<summary>Sky\/rain agreement: High · 4 sources<\/summary>/);
 assert.match(html,/Temperature confidence: Low/);assert.match(html,/20\.0°F/);
 assert.match(html,/6 of 6 daylight hours/);assert.match(html,/12 of 12 hours through local midnight/);
 assert.match(html,/4 sources cover every hour \(NWS, HRRR, ECMWF, NBM\)/);
 assert.match(html,/Compare sky and rain readings/);assert.match(html,/>0\.0%<\/td>/);assert.match(html,/>0\.000<\/td>/);
 assert.doesNotMatch(html,/Forecast confidence: Low/);
});
test('missing weather evidence stays unavailable without invented numbers or temperatures in the primary explanation',()=>{
 const c=confidence();c.weather.evidence.sky=null;c.weather.evidence.rain.worstHour=null;
 const html=confidenceWeatherEvidenceHTML(c);
 assert.match(html,/Sky: comparison unavailable/);assert.doesNotMatch(html,/Cloud cover|20°F|0 of 0/);
});
test('legacy snapshots retain the original confidence semantics instead of claiming sky agreement',()=>{
 const c={label:'Low',key:'low',score:55,factors:['limited guidance'],summary:'Some inputs are missing.',note:'Relative index.'};
 const html=confidenceDetailsHTML(c);assert.match(html,/<summary>Forecast confidence: Low/);assert.doesNotMatch(html,/Sky\/rain agreement|Temperature confidence:/);
 assert.match(confidenceNotice(c).title,/Lower confidence/);
});
test('Today accessibility and notices use the same weather grade as the main week card',()=>{
 const c=confidence(),data={location:{timeZone:'America/New_York'},current:{},days:[{...card(c),date:'2026-10-21',confidence:c}],hours:[],metricForecasts:{series:{}}};
 const html=todayForecastHTML(data,Date.parse(time));assert.match(html,/Sky\/rain agreement High\. Open details/);assert.doesNotMatch(html,/today-confidence-banner/);
 c.weather.key='low';c.weather.label='Low';c.weather.summary='Rain signals disagree.';
 assert.match(todayForecastHTML(data,Date.parse(time)),/Low sky\/rain agreement today/);
});
test('raw model evidence is escaped and missing source values remain unavailable',()=>{
 const c=confidence();c.weather.evidence.sky.worstHour.sources[0]={id:'<script>',value:null,category:'clear'};
 const html=confidenceWeatherEvidenceHTML(c);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/Unavailable/);
});
test('coverage counts compared hours rather than single-source hours and retains trace categories',()=>{
 const c=confidence();c.weather.evidence.sky.coveredHours=6;c.weather.evidence.sky.comparedHours=2;
 c.weather.evidence.rain.worstHour.sources[0]={id:'nws',value:.004,category:'trace'};
 const html=confidenceWeatherEvidenceHTML(c);assert.match(html,/2 of 6 daylight hours have comparisons/);assert.doesNotMatch(html,/6 of 6 daylight hours/);assert.match(html,/>0\.004<\/td><td>Trace<\/td>/);
});
