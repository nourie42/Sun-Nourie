import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedState} from '../public/weather-fusion/player/approved-weather-world.js';
import {solarElevation} from '../public/weather-fusion/weather-math.js';

const frame={
  latitude:35.787,longitude:-78.4806,
  temperature:63,feelsLike:54,isDay:true,
  nativePolicy:true,nativeCondition:'Mostly Sunny'
};
const degrees=time=>solarElevation(Date.parse(time),frame.latitude,frame.longitude)*180/Math.PI;

test('clear midday retains the daylight photograph, away from the solar horizon',()=>{
  const time='2026-10-18T16:00:00Z'; // Noon in Knightdale, NC.
  assert.ok(degrees(time)>40,'fixture must be full daylight');
  const state=approvedState({...frame,time});
  assert.equal(state.weather,'clear');
  assert.equal(state.light,'day');
  assert.equal(state.file,'weather-her-clear-day-feels-32-59f.webp');
});

test('clear midnight retains the authored night photograph',()=>{
  const time='2026-10-19T04:00:00Z'; // Midnight in Knightdale, NC.
  assert.ok(degrees(time)<-60,'fixture must be well after twilight');
  const state=approvedState({...frame,time,isDay:false,nativeCondition:'Clear'});
  assert.equal(state.weather,'clear');
  assert.equal(state.light,'night');
  assert.equal(state.file,'weather-her-clear-night-feels-32-59f.webp');
});

test('a rising sun close to the horizon selects the dawn photograph',()=>{
  const time='2026-10-18T11:25:00Z';
  assert.ok(Math.abs(degrees(time))<1);
  assert.ok(degrees('2026-10-18T11:40:00Z')>degrees(time));
  const state=approvedState({...frame,time,isDay:false,nativeCondition:'Clear'});
  assert.equal(state.light,'dawn');
  assert.equal(state.file,'weather-her-dawn-feels-32-59f.webp');
});

test('a setting sun close to the horizon selects the dusk photograph',()=>{
  const time='2026-10-18T22:30:00Z';
  assert.ok(Math.abs(degrees(time))<1);
  assert.ok(degrees('2026-10-18T22:45:00Z')<degrees(time));
  const state=approvedState({...frame,time});
  assert.equal(state.light,'dusk');
  assert.equal(state.file,'weather-her-dusk-feels-32-59f.webp');
});

test('precipitation and overcast conditions retain their own scenes during twilight',()=>{
  for(const [condition,weather] of [
    ['Overcast','cloudy'],['Rain','rain'],['Freezing rain','freezing-rain'],
    ['Sleet','sleet'],['Heavy snow','heavy-snow'],['Thunderstorms with hail','hail']
  ]){
    for(const [time,isDay] of [['2026-10-18T11:25:00Z',false],['2026-10-18T22:30:00Z',true]]){
      const state=approvedState({...frame,time,isDay,nativeCondition:condition});
      assert.equal(state.weather,weather,condition);
      assert.equal(state.light,isDay?'day':'night',condition);
      assert.ok(state.file.startsWith(`weather-her-${weather}-`),state.file);
    }
  }
});

test('missing coordinates do not invent dawn or dusk at another location',()=>{
  const state=approvedState({...frame,time:'2026-10-18T11:25:00Z',latitude:null,isDay:false,nativeCondition:'Clear'});
  assert.equal(state.light,'night');
  assert.equal(state.file,'weather-her-clear-night-feels-32-59f.webp');
});
