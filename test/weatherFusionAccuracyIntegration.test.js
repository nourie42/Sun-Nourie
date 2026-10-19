import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildForecast,registerWeatherFusionRoutes,ACCURACY_VERSION} from '../src/weatherFusion.js';
import {testInputs} from './weatherFusion.fixtures.js';
import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
import {currentSample,forecastSample,sampleCaption,heroFeelsHTML,peakComparisonHTML} from '../public/weather-fusion/weather-display.js';
import {currentHero} from '../public/weather-fusion/current-temperature.js';
import {currentWeatherDisplay} from '../public/weather-fusion/current-weather.js';
import {currentDewpointValue} from '../public/weather-fusion/dewpoint-meter.js';
import {forecastSnapshotFreshness,currentReadingFreshness} from '../public/weather-fusion/weather-freshness.js';
import {buildForecastWindows} from '../public/weather-fusion/forecast-windows.js';
import {warmestTodayWindow} from '../public/weather-fusion/comfort-outlook.js';
import {sunShadeHTML} from '../public/weather-fusion/personal-details.js';
import {buildSeries} from '../public/weather-fusion/wn-blend.js';

const H=3600000,now=Date.parse('2026-10-19T16:03:00Z'),start=Math.floor(now/H)*H;
const iso=t=>new Date(t).toISOString();
const location={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};
function screenshotForecast(){
 const hours=[64,65,66,66,65].map((temperature,i)=>({time:iso(start+i*H),temperature,condition:'Sunny',isDay:true,skyCover:0,dewpoint:42,windMph:11,pop:0,precipitation:0,rainLikelihood:{value:0}}));
 const points=key=>hours.map(row=>({time:row.time,value:row[key]}));
 const f={assembledAt:iso(now),location,days:[{date:'2026-10-19',high:66,low:51,condition:'Sunny'}],hours,rainTimeline:hours,
  current:{type:'observation',temperature:59,dewpoint:42,wind:11,skyCover:0,condition:'Sunny',time:iso(start),station:'TEST',stationDistanceKm:4},
  metricForecasts:{notes:{},series:{temperature:points('temperature'),dewpoint:points('dewpoint'),wind:points('windMph')}}};
 rebuildHourlyFeels(f,{now,temperatureAt:()=>null,humidityAt:()=>null,skyAt:()=>0});
 return f;
}

test('the reported October19 values reproduce without generating false perfect-weather hours',()=>{
 const f=screenshotForecast(),current=currentSample(f,now);
 assert.equal(current.comfort.shade,46);
 assert.equal(current.feels,54);
 assert.equal(currentHero(f,true,now).temperature,59);
 assert.equal(buildForecastWindows(f,now).perfect.length,0);
 for(const hour of f.hours)assert.equal(forecastSample(f,hour.time).feels,hour.feelsLike);
 const peak=warmestTodayWindow(f,now);
 assert.ok(peak.chosen.value>current.feels);
 assert.match(peakComparisonHTML(peak,current.comfort.sun,location.timeZone,now),/from now/);
});

test('an open tab cannot keep stale observed numbers, rain-now claims or dew-point comfort',()=>{
 const f=screenshotForecast();f.current.condition='Rain';f.current.radarPrecipitation={status:'ready',atLocation:true};
 const later=now+76*60000,sample=currentSample(f,later);
 assert.equal(currentReadingFreshness(f,later).status,'stale');
 assert.equal(sample.temperature,null);assert.equal(sample.feels,null);
 assert.equal(currentHero(f,true,later).temperature,null);
 assert.equal(currentDewpointValue(f,later),null);
 assert.equal(currentWeatherDisplay(f,later).currentPrecipitation.active,false);
 assert.equal(currentWeatherDisplay(f,later).currentLikelihood.value,null);
 assert.match(sampleCaption(sample),/unavailable/);
 assert.match(heroFeelsHTML(sample),/unavailable/);
 assert.doesNotMatch(heroFeelsHTML(sample),/54°/);
});

test('new source data cannot disguise an expired snapshot and browser rendering never changes its clock',()=>{
 const f=screenshotForecast(),original=f.assembledAt;
 const later=now+91*60000;f.current.time=iso(later);
 assert.equal(forecastSnapshotFreshness(f,later).status,'stale');
 assert.equal(currentSample(f,later).feels,null);
 assert.equal(warmestTodayWindow(f,later),null);
 assert.equal(buildForecastWindows(f,later).perfect.length,0);
 assert.equal(f.assembledAt,original);
});

test('independently fresh radar rain survives expired thermal data and expires on its own clock',()=>{
 const f=screenshotForecast(),later=now+91*60000;
 f.current.radarPrecipitation={status:'ready',observedAt:iso(later),atLocation:true};
 const sample=currentSample(f,later);
 assert.equal(sample.temperature,null);assert.equal(sample.feels,null);
 assert.equal(sample.currentPrecipitation.label,'Rain now');assert.equal(sample.pop,100);
 assert.equal(currentHero(f,true,later).condition,'Rain now');
 const expired=currentSample(f,later+21*60000);
 assert.equal(expired.currentPrecipitation.active,false);assert.equal(expired.pop,null);
});

test('future or invalid source timestamps cannot be displayed as current',()=>{
 for(const time of [iso(now+6*60000),'not-a-time',null]){
  const f=screenshotForecast();f.current.time=time;
  assert.equal(currentSample(f,now).temperature,null);
  assert.equal(currentHero(f,true,now).temperature,null);
 }
});

test('a missing shade estimate cannot silently borrow the outdoor reading',()=>{
 const html=sunShadeHTML({daylight:true,weatherKind:'clear',shade:null,outdoors:71,sun:71},location,now,{primaryFeels:71,compact:true});
 assert.match(html,/shade-person[^]*?<strong>Unavailable<\/strong>/);
 assert.match(html,/sun-person[^]*?<strong>71°<\/strong>/);
});

test('without an observation or current-hour guidance the first future hour stays a forecast',()=>{
 const input=structuredClone(testInputs);input.observation=null;input.models={};
 input.hourly.periods=input.hourly.periods.map(p=>({...p,startTime:iso(Date.parse(p.startTime)+H),endTime:iso(Date.parse(p.endTime)+H)}));
 const f=buildForecast(input);
 assert.equal(f.current.type,'unavailable');assert.equal(f.current.temperature,null);assert.equal(f.current.feelsLike,null);
 assert.ok(Date.parse(f.hours[0].time)>input.now);
 assert.equal(f.accuracyVersion,ACCURACY_VERSION);
});

test('the published route serves the freshness dependency with revalidation',()=>{
 const routes=new Map(),app={get(paths,handler){for(const path of Array.isArray(paths)?paths:[paths])routes.set(path,handler);}};
 registerWeatherFusionRoutes(app,{env:{},now:()=>now,fetchImpl:async()=>{throw Error('No network expected');}});
 const handler=routes.get('/weather-fusion/weather-freshness.js');assert.equal(typeof handler,'function');
 const headers={},res={setHeader(k,v){headers[k]=v;},sendFile(path){assert.match(readFileSync(path,'utf8'),/forecastSnapshotFreshness/);}};
 handler({},res);assert.equal(headers['Cache-Control'],'no-cache');
});

test('WeatherNext daily AQI ignores corrupt timestamps and negative readings',()=>{
 const f=screenshotForecast();
 f.airQuality={hours:[{time:'bad',aqi:500},{time:iso(start),aqi:-10},{time:iso(start),aqi:28}]};
 const series=buildSeries(f,null,'aqi',now);
 assert.deepEqual(series.single,[28]);
});
