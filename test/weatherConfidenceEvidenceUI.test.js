import test from 'node:test';
import assert from 'node:assert/strict';
import {confidenceTemperatureEvidenceHTML,forecastConfidence,temperatureRangePrecision} from '../public/weather-fusion/forecast-confidence.js';

function confidence(){
 return {temperatureComparison:{basis:'maximum-same-hour-spread',
  dailyHigh:{spread:4,low:{id:'ecmwf',value:69},high:{id:'wn',value:73},sources:[{id:'nws',value:72},{id:'ecmwf',value:69},{id:'wn',value:73}]},
  worstHour:{time:'2026-10-21T02:00:00Z',spread:8.4,low:{id:'wn',value:52},high:{id:'nws',value:60.4},sources:[{id:'nws',value:60.4},{id:'ecmwf',value:58},{id:'wn',value:52}]}}};
}
const options={timeZone:'America/New_York',assembledAt:'2026-10-19T18:46:00Z'};
test('confidence evidence separates a 4°F daily-high range from an 8.4°F overnight disagreement',()=>{
 const html=confidenceTemperatureEvidenceHTML(confidence(),options);
 assert.match(html,/Daily highs from included sources:.*69\.0–73\.0°F.*4\.0°F apart/);
 assert.match(html,/Largest same-hour gap:.*8\.4°F.*Tue, Oct 20, 10:00 PM EDT.*52\.0–60\.4°F/);
 assert.match(html,/NWS<\/th><td>72\.0°<\/td><td>60\.4°/);
 assert.match(html,/Google WeatherNext<\/th><td>73\.0°<\/td><td>52\.0°/);
 assert.match(html,/Confidence checks hourly differences, including overnight\. The model chart compares daily highs\./);
 assert.match(html,/Forecast updated Mon, Oct 19, 2:46 PM EDT/);
});
test('same-hour and daily-high scoring reasons name the actual comparison without changing the rating',()=>{
 const shared={dayIndex:1,highSpread:8.4,qpfSpread:0,guidanceCount:4,officialDay:true,officialNight:true};
 const hourly=forecastConfidence({...shared,temperatureSpreadBasis:'same-hour'}),daily=forecastConfidence(shared);
 assert.equal(hourly.score,daily.score);
 assert.match(hourly.summary,/Hourly temperature forecasts differ by up to 8\.4°F, including overnight hours/);
 assert.match(daily.summary,/Forecast daily highs differ by 8\.4°F/);
 assert.match(hourly.factors.join(' '),/8\.4°F maximum same-hour temperature gap/);
});
test('displayed endpoint precision preserves the reported rounded gap',()=>{
 const c=confidence();Object.assign(c.temperatureComparison.worstHour,{spread:8.4,low:{id:'wn',value:52.06},high:{id:'nws',value:60.44}});
 const html=confidenceTemperatureEvidenceHTML(c,options);
 assert.match(html,/52\.06–60\.44°F/);
 assert.equal(temperatureRangePrecision({spread:4.002,low:{value:69.049},high:{value:73.051}}),2);
});
test('missing and single-source comparisons cannot invent a range or time',()=>{
 assert.equal(confidenceTemperatureEvidenceHTML({},options),'');
 const c=confidence();c.temperatureComparison.dailyHigh=null;c.temperatureComparison.worstHour=null;
 assert.match(confidenceTemperatureEvidenceHTML(c,options),/evidence is unavailable/);
 c.temperatureComparison.worstHour={...confidence().temperatureComparison.worstHour,time:'invalid'};
 assert.doesNotMatch(confidenceTemperatureEvidenceHTML(c,options),/8\.4°F|Invalid Date/);
});
test('an hourly-only source is disclosed without inventing a daily high',()=>{
 const c=confidence();c.temperatureComparison.worstHour.sources.push({id:'hrrr',value:55});
 const html=confidenceTemperatureEvidenceHTML(c,options);
 assert.match(html,/HRRR<\/th><td>Unavailable<\/td><td>55\.0°/);
});

test('a single published daily high remains visible while its spread is unavailable',()=>{
 const c=confidence();c.temperatureComparison.worstHour=null;c.temperatureComparison.dailyHigh={spread:null,low:{id:'wn',value:67.109},high:{id:'wn',value:67.109},sources:[{id:'wn',value:67.109}]};
 const html=confidenceTemperatureEvidenceHTML(c,options);
 assert.match(html,/Daily-high comparison is unavailable/);assert.match(html,/Google WeatherNext<\/th><td>67\.1°/);
 assert.doesNotMatch(html,/0\.0°F apart|Largest same-hour gap: <strong>/);
});
