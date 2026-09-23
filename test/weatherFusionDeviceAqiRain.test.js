import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rainObservedNow,displayedRainChance,observedRainLabel} from '../public/weather-fusion/rain-display.js';
import {aqiBand,airQualityHTML} from '../public/weather-fusion/air-quality.js';
import {airQualityUrl,normalizeAirQuality,addAirQuality} from '../src/weatherFusionAirQuality.js';

const read=name=>readFileSync(new URL('../public/weather-fusion/'+name,import.meta.url),'utf8');

test('observed rain makes the current-day display 100 percent without rewriting future forecast probabilities',()=>{
 const now=Date.parse('2026-09-23T12:00:00Z');
 const forecast={current:{radarPrecipitation:{status:'ready',atLocation:true,observedAt:new Date(now-2*60000).toISOString()}}};
 assert.equal(rainObservedNow(forecast,now),true);
 const current=displayedRainChance(forecast,48,{dayIndex:0,now});
 assert.deepEqual(current,{value:100,forecastValue:48,observed:true});
 assert.match(observedRainLabel(current),/Rain now/);
 assert.deepEqual(displayedRainChance(forecast,39,{dayIndex:1,now}),{value:39,forecastValue:39,observed:false});
 forecast.current.radarPrecipitation.observedAt=new Date(now-30*60000).toISOString();
 assert.equal(rainObservedNow(forecast,now),false);
 assert.equal(displayedRainChance(forecast,48,{dayIndex:0,now}).value,48);
});

test('air quality feed normalizes current US AQI and computes a next-24-hour peak',()=>{
 const url=new URL(airQualityUrl({latitude:35.8,longitude:-78.5}));
 assert.equal(url.hostname,'air-quality-api.open-meteo.com');
 assert.match(url.searchParams.get('current'),/us_aqi/);
 const t=Date.parse('2026-09-23T12:00:00Z')/1000;
 const normalized=normalizeAirQuality({current:{time:t,us_aqi:72,pm2_5:18.4,pm10:29.1,ozone:61,nitrogen_dioxide:8},hourly:{time:[t,t+3600,t+7200],us_aqi:[72,88,81]}});
 assert.equal(normalized.aqi,72);assert.equal(normalized.pm25,18.4);
 const out={assembledAt:'2026-09-23T12:00:00.000Z'};
 addAirQuality(out,normalized);
 assert.equal(out.airQuality.next24HourPeak,88);
 assert.equal(aqiBand(72).label,'Moderate');
 const html=airQualityHTML({airQuality:out.airQuality,location:{name:'Knightdale, NC'}});
 assert.match(html,/LOCAL AQI/);
 assert.match(html,/Knightdale, NC/);
 assert.doesNotMatch(html,/U\.S\. AQI/);
 assert.match(html,/PM2\.5/);
});

test('regular and experimental weather share device-location, jump-nav, AQI and 12px readability assets',()=>{
 const html=read('index.html'),app=read('app.js'),css=read('weather-polish.css');
 assert.doesNotMatch(html,/data-place="knightdale"|data-place="greenville"|Knightdale \/ Raleigh|Greenville, NC/);
 assert.match(html,/id="device-location-label"/);
 assert.match(html,/href="#map-panel" class="weather-jump-card" aria-label="Weather Map"/);
 assert.match(html,/href="#dewpoint-gross-meter" class="weather-jump-card"[\s\S]*?>Gross Meter</);
 assert.match(html,/href="#your-day" class="weather-jump-card"[\s\S]*?>Your Day</);
 assert.match(html,/href="#daily-panel" class="weather-jump-card" aria-label="7-Day Forecast"[\s\S]*?>7-Day</);
 assert.match(html,/id="air-quality"/);
 assert.match(app,/startDeviceLocation\(\);/);
 assert.match(app,/navigator\.geolocation\.getCurrentPosition/);
 assert.match(app,/weather-fusion-device-place/);
 assert.doesNotMatch(app,/presets\.knightdale|weather-fusion-place/);
 assert.match(css,/font-size:12px!important/);
 assert.match(css,/gross-number/);
 assert.match(css,/\.weather-jump-card\{[^}]*min-height:82px/);
 assert.match(css,/\.jump-radar\{[^}]*conic-gradient/);
 assert.match(css,/@media\(max-width:760px\)[\s\S]*\.weather-jump-card:nth-child\(5\)\{grid-column:1\/-1\}/);
 assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.ok(html.indexOf('id="metrics"')<html.indexOf('id="air-quality"'),'Your Day cards must appear directly before local air quality');
 assert.match(html,/Current local AQI \+ next 24 hours/);
});

test('phone daily row keeps the remainder label aligned and AQI uses the shared blue card treatment',()=>{
 const experience=read('experience.js'),scenario=read('scenario-layout.css'),polish=read('weather-polish.css');
 assert.match(experience,/day-name-mobile/);
 assert.match(experience,/p\.remainder\?'Today':p\.label/);
 assert.match(scenario,/\.day-name-full\{display:none\}/);
 assert.match(scenario,/\.day-name-mobile\{display:inline;white-space:nowrap\}/);
 assert.match(polish,/\.air-quality-panel\{[^}]*linear-gradient\(135deg,#104773,#073b63 60%,#073153\)/);
});

test('the server explicitly allows and adds the air-quality source',()=>{
 const server=readFileSync(new URL('../src/weatherFusion.js',import.meta.url),'utf8');
 assert.match(server,/air-quality-api\.open-meteo\.com/);
 assert.match(server,/airQuality: feed\('air-quality'/);
 assert.match(server,/addAirQuality\(output,airQuality\)/);
});
