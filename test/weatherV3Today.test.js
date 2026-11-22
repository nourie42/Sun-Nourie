import test from 'node:test';
import assert from 'node:assert/strict';
import {nextSunnyBreak,outdoorExposureReadings} from '../public/weather-fusion/v3/js/fusion-engine.js';
import {todayHourlyPreview,todaySummary} from '../public/weather-fusion/v3/js/today-preview.js';

const location={latitude:35.7798,longitude:-78.5356};
const hour = (time,override={}) => ({
  time,isDay:true,condition:'Mostly Sunny',forecastCloudCover:35,forecastWindMph:8,
  rainChance:10,precipIn:0,tempF:63,...override
});

test('next sunny break follows the selected hour and requires daylight, sunny skies, and dry forecast evidence',()=>{
  const selected='2026-11-22T12:00:00Z';
  const hours48=[
    hour(selected),
    hour('2026-11-22T13:00:00Z',{condition:'Light Rain'}),
    hour('2026-11-22T14:00:00Z',{forecastCloudCover:96}),
    hour('2026-11-22T15:00:00Z',{precipIn:.03}),
    hour('2026-11-22T16:00:00Z',{rainChance:null}),
    hour('2026-11-22T17:00:00Z',{forecastCloudCover:null}),
    hour('2026-11-23T11:00:00Z'),
    hour('2026-11-23T15:00:00Z'),
    hour('2026-11-23T16:00:00Z',{condition:'Partly Cloudy',forecastCloudCover:55})
  ];
  const forecast={hours48,location};
  const now=Date.parse(selected)+1800000;
  assert.equal(nextSunnyBreak(forecast,selected,now),hours48[7]);
  assert.equal(nextSunnyBreak(forecast,hours48[7].time,now),hours48[8]);
  assert.equal(nextSunnyBreak(forecast,hours48[8].time,now),undefined);
});

test('Today shows published cloud and wind readings, including calm and clear, and leaves missing hours blank',()=>{
  const times=['2026-11-22T12:00:00Z','2026-11-22T13:00:00Z','2026-11-22T14:00:00Z'];
  const readings=[
    hour(times[0],{forecastCloudCover:0,forecastWindMph:0}),
    hour(times[1],{forecastCloudCover:null,forecastWindMph:null,cloudCover:81,windMph:6}),
    hour(times[2],{forecastCloudCover:100,forecastWindMph:20})
  ];
  const html=todayHourlyPreview(readings,'America/New_York');
  assert.match(html,/20 mph/);
  assert.match(html,/<g data-today-series="wind"><path d="M43\.0,166\.0 M322\.0,134\.0 /);
  assert.match(html,/<g data-today-series="cloud"><path d="M43\.0,112\.0 M322\.0,83\.0 /);
  assert.match(html,/Cloud cover/);
  assert.doesNotMatch(todayHourlyPreview([readings[1]],'America/New_York'),/Cloud cover|>Wind</);
});

test('rain and overcast share the human outdoor reading and a verified sunny comparison uses the same model',()=>{
  const sun = {feelsLikeF:65,shadeFeelsF:55,isDay:true,hasDirectSun:true,condition:'Sunny'};
  assert.deepEqual(outdoorExposureReadings(sun),{wet:false,outdoor:65,shade:55,compareSun:true,solarGain:10});
  const rainy={...sun,feelsLikeF:55,shadeFeelsF:57,rainFeelsF:50,condition:'Light Rain'};
  assert.deepEqual(outdoorExposureReadings(rainy),{wet:true,outdoor:55,shade:55,compareSun:false,solarGain:0});
  for (const hour of [{...sun,hasDirectSun:false},{...sun,isDay:false},{...sun,shadeFeelsF:72}]) {
    assert.equal(outdoorExposureReadings(hour).shade,65);
    assert.equal(outdoorExposureReadings(hour).compareSun,false);
  }
  assert.equal(outdoorExposureReadings(sun,true).compareSun,false);
  assert.equal(outdoorExposureReadings({...rainy,feelsLikeF:null}).outdoor,null);
});

test('the daily headline follows supported forecast weather, wind and high temperature',()=>{
  const wet={isDay:true,forecastCondition:'Light Rain',forecastCloudCover:95,rainChance:87,precipIn:.02,forecastWindMph:10};
  assert.equal(todaySummary([wet,wet],64),'Rainy and cool today, with a chilly breeze');
  const sun={isDay:true,forecastCondition:'Mostly Sunny',forecastCloudCover:16,rainChance:0,precipIn:0,forecastWindMph:5};
  assert.equal(todaySummary([sun,sun],39),'Sunny today but cold');
  assert.match(todaySummary([sun,wet,wet],71),/^Rainy and mild/);
  const overcast={...sun,forecastCondition:'Overcast',forecastCloudCover:97};
  assert.equal(todaySummary([overcast,overcast],56),'Cloudy and cool today');
  assert.equal(todaySummary([{}],null),'');
});
