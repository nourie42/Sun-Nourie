import test from 'node:test';
import assert from 'node:assert/strict';
import {nextSunnyBreak} from '../public/weather-fusion/v3/js/fusion-engine.js';
import {todayHourlyPreview} from '../public/weather-fusion/v3/js/today-preview.js';

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
