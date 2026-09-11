import test from 'node:test';
import assert from 'node:assert/strict';
import {todayForecastHTML,periodWeatherStats,shortForecastCondition} from '../public/weather-fusion/today-card.js';
import {hourlyWindHTML,windDirectionLabel} from '../public/weather-fusion/weather-display.js';
const now=Date.parse('2026-09-11T12:00:00Z'),H=3600000;
function fixture(){
 const rows=values=>values.map((value,i)=>({time:new Date(now+i*H).toISOString(),value}));
 return {location:{timeZone:'America/New_York'},days:[{date:'2026-09-11',high:95,low:74,condition:'Slight Chance Showers And Thunderstorms',nightCondition:'Mostly Clear',pop:23,popNight:10,uvMax:7,highWindow:{start:new Date(now).toISOString(),end:new Date(now+3*H).toISOString()},lowWindow:{start:'2026-09-11T23:00:00Z',end:'2026-09-12T11:00:00Z'},confidence:{label:'High',key:'high',score:85}}],metricForecasts:{series:{wind:rows([4,6,8,100]),humidity:rows([60,68,76,100]),feels:rows([90,103,98])}}};
}
test('Today metrics use their forecast period and never substitute current conditions',()=>{
 const f=fixture();f.current={wind:99,humidity:99};
 assert.deepEqual(periodWeatherStats(f,now),{wind:6,humidity:68});
 const html=todayForecastHTML(f,now);
 for(const value of ['Today','95°','74°','103°','23%','6 mph','68%','Forecast confidence','UV Index'])assert.ok(html.includes(value),value);
 assert.match(html,/data-today-forecast/);assert.doesNotMatch(html,/99 mph|99%|Sunrise|Sunset/);
});
test('Tonight keeps the overnight low and never repeats the daytime high',()=>{
 const html=todayForecastHTML(fixture(),Date.parse('2026-09-11T23:00:00Z'));
 assert.match(html,/Tonight/);assert.match(html,/74°/);assert.doesNotMatch(html,/95°/);assert.match(html,/10%/);
});
test('missing metrics remain blank while real zero wind and humidity are retained',()=>{
 const f=fixture();f.metricForecasts.series.wind=[];f.metricForecasts.series.humidity=[];
 assert.deepEqual(periodWeatherStats(f,now),{wind:null,humidity:null});
 f.metricForecasts.series.wind=[{time:new Date(now).toISOString(),value:0}];f.metricForecasts.series.humidity=[{time:new Date(now).toISOString(),value:0}];
 assert.deepEqual(periodWeatherStats(f,now),{wind:0,humidity:0});
 assert.equal(windDirectionLabel(null),'—');assert.equal(windDirectionLabel(360),'N');assert.equal(windDirectionLabel(225),'SW');assert.equal(windDirectionLabel('ssw'),'SSW');
 assert.match(hourlyWindHTML({inputs:{wind:0},windDirection:230}),/0 mph/);assert.match(hourlyWindHTML({inputs:{wind:0},windDirection:230}),/Calm/);
 assert.match(hourlyWindHTML({inputs:{wind:null}}),/— mph/);assert.match(hourlyWindHTML({inputs:{wind:7.7},windDirection:201.4}),/8 mph/);
});
test('compact descriptions preserve uncertainty and the complete forecast is accessible',()=>{
 assert.equal(shortForecastCondition('Mostly Sunny then Slight Chance Showers And Thunderstorms'),'Mostly sunny, then storms possible');
 assert.match(todayForecastHTML(fixture(),now),/title="Slight Chance Showers And Thunderstorms"/);
 const f=fixture();f.days[0].condition='<script>alert(1)</script>';assert.doesNotMatch(todayForecastHTML(f,now),/<script>/);
});
