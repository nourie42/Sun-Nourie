import test from 'node:test';
import assert from 'node:assert/strict';
import {currentWeatherDisplay} from '../public/weather-fusion/current-weather.js';
import {currentSample,hourlyRainHTML} from '../public/weather-fusion/weather-display.js';
import {currentHero} from '../public/weather-fusion/current-temperature.js';
import {sunShadeHTML} from '../public/weather-fusion/personal-details.js';
import {pavementHTML} from '../public/weather-fusion/pavement.js';
import {comfortSceneState} from '../public/weather-fusion/exposure-scene.js';

const now=Date.parse('2026-10-17T09:20:51.820Z');
// Selected fields from the production Knightdale response at 5:20 AM EDT.
// A rejected remote station leaves current local guidance, not a dry observation.
function knightdale(){return {
 location:{latitude:35.7871,longitude:-78.481,timeZone:'America/New_York'},
 assembledAt:new Date(now).toISOString(),
 current:{temperature:58,dewpoint:57.4,humidity:98,wind:13.6,condition:'Chance Rain',type:'guidance',conditionSource:'Selected-location current-hour forecast',time:'2026-10-17T09:00:00Z',radarPrecipitation:{status:'ready',observedAt:'2026-10-17T09:20:11Z',atLocation:false,close:false,nearby:false,inArea:true,nearestRainMiles:12,nearestRainDirection:'NE'}},
 hours:[{time:'2026-10-17T09:00:00Z',condition:'Chance Rain',temperature:60,pop:47,officialPop:47,rainLikelihood:{value:54},precipitation:.0286622,skyCover:95.4846},{time:'2026-10-17T10:00:00Z',condition:'Rain Likely',pop:72,rainLikelihood:{value:63},precipitation:.03082825}],
 days:[{pop:100,condition:'Rain'}]
};}

test('Knightdale current-hour rain survives radar gaps without becoming a fabricated observation',()=>{
 const f=knightdale(),s=currentSample(f,now),hero=currentHero(f,false,now);
 assert.equal(hero.condition,'Chance Rain');assert.equal(s.condition,hero.condition);
 assert.equal(s.pop,54);assert.equal(s.rainLikelihood.source,'Selected-location current-hour forecast');
 assert.equal(s.currentPrecipitation.active,false);assert.equal(s.currentPrecipitation.forecast,true);
 assert.equal(s.currentPrecipitation.label,'54% this hour');assert.equal(s.rainExpected,true);
 assert.equal(s.comfort.weatherKind,'rain');assert.equal(s.isDay,false);
 assert.match(hourlyRainHTML(s),/54% this hour/);assert.doesNotMatch(hourlyRainHTML(s),/Dry now|Rain now/);
});

test('all three current panels show night rain gear and forecast-qualified captions',()=>{
 const f=knightdale(),s=currentSample(f,now),context={compact:true,condition:s.condition,pop:s.pop,rainExpected:s.rainExpected,forecast:false,primaryFeels:s.feels};
 const surface={status:'estimated',daylight:false,concrete:{value:65},asphalt:{value:67}};
 const html=sunShadeHTML(s.comfort,f.location,now,{...context,pavement:pavementHTML(surface,s.feels,context)});
 assert.equal((html.match(/data-scene="rain"/g)||[]).length,3);
 assert.equal((html.match(/data-daylight="false" data-weather="rain"/g)||[]).length,3);
 assert.equal((html.match(/comfort-night-cool-rain-fog\.webp/g)||[]).length,3);
 assert.match(html,/Rain forecast · take an umbrella/);assert.doesNotMatch(html,/Rain outside/);
 assert.match(html,/Asphalt 67°/);
});

test('a dry current observation stays dry even when this hour and later hours forecast rain',()=>{
 const f=knightdale();f.current.type='observation';f.current.condition='Cloudy';f.current.conditionSource='Station weather report';
 const s=currentSample(f,now);assert.equal(s.condition,'Cloudy');assert.equal(s.pop,0);assert.equal(s.rainExpected,false);
 assert.equal(comfortSceneState(false,s.condition,s.feels,s).key,'night');
});

test('distant rain and a wet future/day cannot replace dry weather at the current point',()=>{
 const f=knightdale();f.current.condition='Cloudy';f.hours[0]={...f.hours[0],condition:'Cloudy',precipitation:0,pop:0,rainLikelihood:{value:0}};
 const s=currentSample(f,now);assert.equal(s.currentPrecipitation.label,'Rain in area');assert.equal(s.pop,0);
 assert.equal(s.condition,'Cloudy');assert.equal(s.rainExpected,false);assert.equal(comfortSceneState(false,s.condition,s.feels,s).key,'night');
 f.hours.shift();assert.equal(currentWeatherDisplay(f,now).pointRainForecast,false);
});

test('stale guidance and low rain chances do not claim active current rain',()=>{
 const f=knightdale();f.assembledAt=new Date(now-91*60000).toISOString();
 let s=currentSample(f,now);assert.equal(s.rainExpected,false);assert.equal(s.pop,0);
 f.assembledAt=new Date(now).toISOString();f.hours[0].rainLikelihood.value=12;
 s=currentSample(f,now);assert.equal(s.pop,12);assert.equal(s.rainExpected,false);assert.equal(s.currentPrecipitation.active,false);
 assert.equal(comfortSceneState(false,s.condition,s.feels,s).key,'carry-umbrella');
});

test('reported or detected rain always uses umbrellas even if the forecast is dry',()=>{
 const f=knightdale();f.hours[0]={...f.hours[0],condition:'Cloudy',precipitation:0,rainLikelihood:{value:0}};
 for(const evidence of ['station','radar']){
  f.current.type=evidence==='station'?'observation':'guidance';f.current.condition=evidence==='station'?'Light Rain':'Cloudy';
  f.current.radarPrecipitation.atLocation=evidence==='radar';
  const s=currentSample(f,now);assert.equal(s.pop,100);assert.equal(s.currentPrecipitation.label,'Rain now');
  assert.equal(comfortSceneState(false,s.condition,s.feels,s).key,'rain');
 }
});

// The API rounds nearestRainMiles for display. Its explicit close flag uses the
// actual distance, so 5 displayed miles can still be outside the 5-mile radius.
test('rounded nearby radar distance cannot override the point forecast probability',()=>{
 const f=knightdale();f.current.radarPrecipitation.nearestRainMiles=5;
 const s=currentSample(f,now);assert.equal(s.radarThreat,false);assert.equal(s.pop,54);
 assert.equal(s.condition,'Chance Rain');assert.equal(s.rainExpected,true);
 f.current.radarPrecipitation.close=true;
 assert.equal(currentSample(f,now).currentPrecipitation.label,'Rain Around');
});
