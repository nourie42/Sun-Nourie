import test from 'node:test';
import assert from 'node:assert/strict';
import {todayForecastHTML,periodWeatherStats,shortForecastCondition,todaySkyProfile,todaySkySceneHTML,moonPhaseAt,moonPhaseHTML} from '../public/weather-fusion/today-card.js';
import {hourlyRainHTML,hourlyWindHTML,windDirectionLabel} from '../public/weather-fusion/weather-display.js';
const now=Date.parse('2026-09-11T12:00:00Z'),H=3600000;
function fixture(){
 const rows=values=>values.map((value,i)=>({time:new Date(now+i*H).toISOString(),value}));
 return {location:{timeZone:'America/New_York'},days:[{date:'2026-09-11',high:95,low:74,condition:'Slight Chance Showers And Thunderstorms',nightCondition:'Mostly Clear',pop:23,popNight:10,uvMax:7,highWindow:{start:new Date(now).toISOString(),end:new Date(now+3*H).toISOString()},lowWindow:{start:'2026-09-11T23:00:00Z',end:'2026-09-12T11:00:00Z'},confidence:{label:'High',key:'high',score:85}}],metricForecasts:{series:{wind:rows([4,6,8,100]),humidity:rows([60,68,76,100]),feels:rows([90,103,98])}}};
}
test('Today metrics use their forecast period and never substitute current conditions',()=>{
 const f=fixture();f.current={wind:99,humidity:99};
 assert.deepEqual(periodWeatherStats(f,now),{wind:6,humidity:68});
 const html=todayForecastHTML(f,now);
 for(const value of ['Today','95°','74°','103°','23%','6 mph','UV Index','Click for more details'])assert.ok(html.includes(value),value);
 assert.match(html,/Rain chance/);assert.doesNotMatch(html,/NWS chance/);
 assert.doesNotMatch(html,/>Humidity<|>Precipitation</);
 assert.match(html,/data-today-forecast/);assert.doesNotMatch(html,/99 mph|99%|Sunrise|Sunset/);
});
test('Today sky adds clouds and precipitation by forecast scenario',()=>{
 assert.equal(todaySkyProfile({condition:'Mostly Sunny',pop:10}).scene,'clear');
 assert.equal(todaySkyProfile({condition:'Mostly Sunny',pop:22}).scene,'few-clouds');
 assert.equal(todaySkyProfile({condition:'Mostly Cloudy',pop:48}).scene,'cloudy');
 assert.equal(todaySkyProfile({condition:'Slight Chance Thunderstorms',pop:22,detail:'Atmospheric lift may support a storm.'}).scene,'few-clouds');
 assert.equal(todaySkyProfile({condition:'Chance Thunderstorms',pop:40,detail:'Atmospheric lift may support a storm.'}).scene,'building');
 assert.equal(todaySkyProfile({condition:'Thunderstorms',pop:75}).scene,'storm');
 assert.equal(todaySkyProfile({condition:'Overcast with Rain',pop:80}).scene,'overcast-rain');
 assert.match(todaySkySceneHTML(todaySkyProfile({condition:'Thunderstorms',pop:75})),/today-sky-storm\.webp/);
 assert.match(todaySkySceneHTML(todaySkyProfile({condition:'Overcast with Rain',pop:80})),/today-sky-rain\.webp/);
 assert.match(todaySkySceneHTML(todaySkyProfile({condition:'Clear',pop:0},true)),/today-sky-night-v2\.webp/);
});
test('Tonight moon follows the astronomical phase for the displayed date',()=>{
 const phases=[
  ['2026-09-11T03:27:00Z','New moon',0],
  ['2026-09-18T20:44:00Z','First quarter',.25],
  ['2026-09-26T16:49:00Z','Full moon',.5],
  ['2026-10-03T13:25:00Z','Last quarter',.75]
 ];
 for(const [date,name,fraction] of phases){const phase=moonPhaseAt(Date.parse(date));assert.equal(phase.name,name);assert.ok(Math.abs(phase.fraction-fraction)<.01,`${name}: ${phase.fraction}`);}
 assert.match(moonPhaseHTML(Date.parse(phases[2][0])),/Full moon, 100 percent illuminated/);
 assert.match(todaySkySceneHTML(todaySkyProfile({condition:'Clear'},true),Date.parse(phases[1][0])),/First quarter/);
 assert.doesNotMatch(todaySkySceneHTML(todaySkyProfile({condition:'Clear'},false),Date.parse(phases[1][0])),/today-moon/);
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
test('hourly card shows the Weather Nourie consensus rather than relabeling NWS as the blend',()=>{
 assert.match(hourlyRainHTML({pop:21,rainLikelihood:{value:48,sourceValues:{nws:21,hrrr:100,ecmwf:0}}}),/>48%</);
 assert.doesNotMatch(hourlyRainHTML({pop:21,rainLikelihood:{value:48,sourceValues:{nws:21,hrrr:100,ecmwf:0}}}),/% NWS|HRRR: rain/);
 assert.match(hourlyRainHTML({pop:22}),/>22%</);
});
test('Today and Tonight prefer their matching blended rain likelihood',()=>{
 const f=fixture();f.days[0].popDayLikelihood={value:8};f.days[0].popNightLikelihood={value:3};f.days[0].rainLikelihood={value:12};
 assert.match(todayForecastHTML(f,now),/>8%<\/strong><small>Rain chance/);
 assert.match(todayForecastHTML(f,Date.parse('2026-09-11T23:00:00Z')),/>3%<\/strong><small>Rain chance/);
});
test('unavailable canonical rain never silently changes to the NWS percentage or sky intensity',()=>{
 const f=fixture(),missing={value:null,aggregation:'maximum-hourly',coverage:{complete:false}};
 f.days[0].popDay=80;f.days[0].popNight=70;f.days[0].popDayLikelihood=missing;f.days[0].popNightLikelihood=missing;
 assert.match(todayForecastHTML(f,now),/>—<\/strong><small>Rain chance/);
 assert.match(todayForecastHTML(f,Date.parse('2026-09-11T23:00:00Z')),/>—<\/strong><small>Rain chance/);
 assert.equal(todaySkyProfile(f.days[0]).pop,null);assert.equal(todaySkyProfile(f.days[0],true).pop,null);
 assert.doesNotMatch(hourlyRainHTML({pop:80,rainLikelihood:{value:null}}),/>80%</);
 assert.match(hourlyRainHTML({pop:80,rainLikelihood:{value:null}}),/>—<\/small>/);
 assert.match(hourlyRainHTML({pop:80,rainLikelihood:{value:0}}),/>0%</);
});
