import test from 'node:test';
import assert from 'node:assert/strict';
import {todayForecastHTML,periodWeatherStats,shortForecastCondition,todaySkyProfile,todaySkyProfileForForecast,todaySkySceneHTML,moonPhaseAt,moonPhaseHTML} from '../public/weather-fusion/today-card.js';
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
 assert.match(html,/aria-label="[^"]*Rain chance 23 percent\./);
 assert.doesNotMatch(html,/>Humidity<|>Precipitation</);
 assert.match(html,/data-today-forecast/);assert.doesNotMatch(html,/99 mph|99%|Sunrise|Sunset/);
});
test('main card says Remainder of Today from local noon until the Tonight switch',()=>{
 const noon=Date.parse('2026-09-11T16:00:00Z'),f=fixture();
 f.days[0].popDayLikelihood={value:30};
 f.days[0].popNightLikelihood={value:60};
 f.days[0].rainLikelihood={value:60};
 const html=todayForecastHTML(f,noon);
 assert.match(html,/class="today-weather-card today-remainder"/);
 assert.match(html,/>Remainder of Today<\/span>/);
 assert.match(html,/>60%<\/strong><small>Rain chance/,'the remainder tile includes the higher chance later tonight');
 assert.doesNotMatch(html,/class="today-weather-card today-remainder"[\s\S]*>Tonight<\/span>/);
});
test('Remainder of Today uses current and remaining hourly cloudiness instead of an earlier sunny daily phrase',()=>{
 const t=Date.parse('2026-09-11T21:44:00Z'),f=fixture(),day=f.days[0];
 day.condition='Mostly Sunny';day.highWindow={start:'2026-09-11T11:00:00Z',end:'2026-09-12T00:00:00Z'};
 f.current={condition:'Cloudy',skyCover:100,time:new Date(t).toISOString()};
 f.hours=[
  {time:'2026-09-11T22:00:00Z',condition:'Cloudy',skyCover:100},
  {time:'2026-09-11T23:00:00Z',condition:'Mostly Cloudy',skyCover:95}
 ];
 const profile=todaySkyProfileForForecast(f,day,{tonight:false,remainder:true},t);
 assert.equal(profile.scene,'cloudy');
 assert.equal(profile.hourlySkyOverride,true);
 const scene=todaySkySceneHTML(profile,t);
 assert.match(scene,/today-sky-overcast/);
 assert.match(scene,/<svg[^>]+today-sky-overcast/);
 assert.match(scene,/today-cloud-light|today-cloud-mid|today-cloud-dark/);
 assert.doesNotMatch(scene,/today-sky-clear\.webp|today-sky-clouds\.webp|sun/i);
});
test('Today sky adds clouds and precipitation by forecast scenario',()=>{
 assert.equal(todaySkyProfile({condition:'Mostly Sunny',pop:10}).scene,'clear');
 assert.equal(todaySkyProfile({condition:'Mostly Sunny',pop:22}).scene,'few-clouds');
 assert.equal(todaySkyProfile({condition:'Mostly Cloudy',pop:48}).scene,'cloudy');
 assert.equal(todaySkyProfile({condition:'Slight Chance Thunderstorms',pop:22,detail:'Atmospheric lift may support a storm.'}).scene,'building');
 assert.equal(todaySkyProfile({condition:'Chance Thunderstorms',pop:40,detail:'Atmospheric lift may support a storm.'}).scene,'building');
 assert.equal(todaySkyProfile({condition:'Thunderstorms',pop:75}).scene,'storm');
 assert.equal(todaySkyProfile({condition:'Slight Chance Showers And Thunderstorms then Patchy Fog',pop:100}).scene,'overcast-rain');
 assert.equal(todaySkyProfile({condition:'Overcast with Rain',pop:80}).scene,'overcast-rain');
 assert.equal(todaySkyProfile({condition:'Rain',pop:20}).scene,'cloudy','a rainy displayed condition never uses sunny artwork');
 assert.equal(todaySkyProfile({condition:'Chance Rain',pop:40}).scene,'cloudy','chance-rain days never use sunny artwork');
 assert.match(todaySkySceneHTML(todaySkyProfile({condition:'Thunderstorms',pop:75})),/today-sky-storm\.webp/);
 assert.match(todaySkySceneHTML(todaySkyProfile({condition:'Overcast with Rain',pop:80})),/today-sky-rain\.webp/);
 assert.match(todaySkySceneHTML(todaySkyProfile({condition:'Clear',pop:0},true)),/today-sky-night-v2\.webp/);
 const rainyTonight=todaySkySceneHTML(todaySkyProfile({nightCondition:'Rain',popNight:100},true));
 assert.match(rainyTonight,/today-sky-rain\.webp/,'a rainy night uses rain artwork');
 assert.doesNotMatch(rainyTonight,/today-sky-night-v2|today-moon|sky-lightning/,'plain rain does not show clear-night or lightning imagery');
 const stormyTonight=todaySkySceneHTML(todaySkyProfile({nightCondition:'Thunderstorms',popNight:100},true));
 assert.match(stormyTonight,/today-sky-rain\.webp/,'a stormy night avoids the daytime storm image and its sun');
 assert.doesNotMatch(stormyTonight,/today-sky-storm|today-moon/);
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
 assert.match(todayForecastHTML(fixture(),now),/data-weather-kind="storm"|sky-lightning/);
 const f=fixture();f.days[0].condition='<script>alert(1)</script>';assert.doesNotMatch(todayForecastHTML(f,now),/<script>/);
});
test('hourly card shows the Weather Nourie consensus rather than relabeling NWS as the blend',()=>{
 assert.match(hourlyRainHTML({pop:21,rainLikelihood:{value:48,sourceValues:{nws:21,hrrr:100,ecmwf:0}}}),/>48%</);
 assert.doesNotMatch(hourlyRainHTML({pop:21,rainLikelihood:{value:48,sourceValues:{nws:21,hrrr:100,ecmwf:0}}}),/% NWS|HRRR: rain/);
 assert.match(hourlyRainHTML({pop:22}),/>22%</);
});
test('hourly rain tooltip reports the points actually awarded to each source',()=>{
 const html=hourlyRainHTML({rainLikelihood:{value:15,sourceValues:{nws:7,hrrr:30,ecmwf:30,nbm:0},sourcePoints:{nws:2.8,hrrr:9,ecmwf:3,nbm:0}}});
 assert.match(html,/NWS base 7% \(\+2\.8 points\)/);
 assert.match(html,/HRRR rain yes \(\+9 points\)/);
 assert.match(html,/ECMWF rain yes \(\+3 points\)/);
 assert.match(html,/NBM rain no \(\+0 points\)/);
 assert.doesNotMatch(html,/HRRR rain yes \(\+30 points\)|ECMWF rain yes \(\+10 points\)/);
});
test('hourly rain tooltip omits a model explicitly marked unused',()=>{
 const html=hourlyRainHTML({rainLikelihood:{value:19,sourceValues:{nws:7,hrrr:100,ecmwf:30,nbm:0},sourcePoints:{nws:1.05,hrrr:null,ecmwf:18,nbm:0}}});
 assert.doesNotMatch(html,/HRRR rain/);
 assert.match(html,/NWS base 7% \(\+1\.05 points\)/);
 assert.match(html,/ECMWF rain yes \(\+18 points\)/);
});
test('Now labels the observed precipitation state instead of a whole-hour forecast probability',()=>{
 const dry={now:true,currentPrecipitation:{active:false,label:'Dry now',source:'Current station reports no precipitation.'},rainLikelihood:{value:28}};
 assert.match(hourlyRainHTML(dry),/>Dry now</);assert.doesNotMatch(hourlyRainHTML(dry),/28%/);
 assert.match(hourlyRainHTML({now:true,currentPrecipitation:{active:true,label:'Rain now',source:'Current station reports precipitation.'}}),/>Rain now</);
});
test('Today and Tonight prefer their matching blended rain likelihood',()=>{
 const f=fixture();f.days[0].popDayLikelihood={value:8};f.days[0].popNightLikelihood={value:3};f.days[0].rainLikelihood={value:12};
 assert.match(todayForecastHTML(f,now),/>12%<\/strong><small>Rain chance/);
 assert.match(todayForecastHTML(f,Date.parse('2026-09-11T23:00:00Z')),/>3%<\/strong><small>Rain chance/);
});
test('Today tile shows the full-day rain high, not the daytime-only peak',()=>{
 const f=fixture();
 f.days[0].popDayLikelihood={value:57};
 f.days[0].popNightLikelihood={value:88};
 f.days[0].rainLikelihood={value:88,peakTime:'2026-09-11T23:00:00Z'};
 const html=todayForecastHTML(f,now);
 assert.match(html,/>88%<\/strong>/);
 assert.doesNotMatch(html,/>57%<\/strong>/);
 assert.match(html,/Rain chance · Peak this evening/);
});
test('Today tile always states how rain chance changed since the last update',()=>{
 const f=fixture();
 f.rainTrend={direction:'up',change:20,delta:20,from:40,to:60};
 assert.match(todayForecastHTML(f,Date.parse('2026-09-11T16:00:00Z')),/↑ \+20 pts · was 40%/);
 f.rainTrend={direction:'down',change:10,delta:-10,from:60,to:50};
 assert.match(todayForecastHTML(f,Date.parse('2026-09-11T16:00:00Z')),/↓ −10 pts · was 60%/);
 f.rainTrend={direction:'same',change:0,delta:0,from:50,to:50};
 assert.match(todayForecastHTML(f,Date.parse('2026-09-11T16:00:00Z')),/↔ 0 pts · unchanged/);
 delete f.rainTrend;
 assert.match(todayForecastHTML(f,Date.parse('2026-09-11T16:00:00Z')),/Change: — · first update/);
});
test('unavailable canonical rain never silently changes to the NWS percentage or sky intensity',()=>{
 const f=fixture(),missing={value:null,aggregation:'maximum-hourly',coverage:{complete:false}};
 f.days[0].popDay=80;f.days[0].popNight=70;f.days[0].popDayLikelihood=missing;f.days[0].popNightLikelihood=missing;f.days[0].rainLikelihood=missing;
 assert.match(todayForecastHTML(f,now),/>—<\/strong><small>Rain chance/);
 assert.match(todayForecastHTML(f,Date.parse('2026-09-11T23:00:00Z')),/>—<\/strong><small>Rain chance/);
 assert.equal(todaySkyProfile(f.days[0]).pop,null);assert.equal(todaySkyProfile(f.days[0],true).pop,null);
 assert.doesNotMatch(hourlyRainHTML({pop:80,rainLikelihood:{value:null}}),/>80%</);
 assert.match(hourlyRainHTML({pop:80,rainLikelihood:{value:null}}),/>—<\/small>/);
 assert.match(hourlyRainHTML({pop:80,rainLikelihood:{value:0}}),/>0%</);
});
