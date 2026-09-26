import test from 'node:test';
import assert from 'node:assert/strict';
import {sunShadeHTML} from '../public/weather-fusion/personal-details.js';
import {sunExposureTemperature} from '../public/weather-fusion/outdoor-feels.js';

const now=Date.parse('2026-09-10T18:00:00Z');
const location={latitude:35.787,longitude:-78.4806,timeZone:'America/New_York'};

test('Shade and sun cards compare modeled feels-like values, never air temperature versus feels-like',()=>{
  const comfort={
    daylight:true,
    weatherKind:'clear',
    radiantCondition:'Mostly Sunny',
    shade:88,
    sun:90,
    outdoors:90,
    inputEvidence:{temperature:91,skyCover:20}
  };
  const html=sunShadeHTML(comfort,location,now,{compact:true});
  const shade=html.match(/shade-person[\s\S]*?<figcaption><strong>([^<]+)<\/strong>/)?.[1];
  const sun=html.match(/sun-person[\s\S]*?<figcaption><strong>([^<]+)<\/strong>/)?.[1];
  assert.equal(shade,'88°','Shade must display the modeled shade feels-like, not the 91° source air temperature');
  assert.equal(sun,'90°');
  assert.ok(!html.includes('<strong>91°</strong>'),'Source air temperature must not be painted into the Shade comparison card');
});

test('Shade stays unavailable when the modeled shade value is unavailable',()=>{
  const html=sunShadeHTML({daylight:true,weatherKind:'clear',sun:90,outdoors:90,shade:null,inputEvidence:{temperature:91}},location,now,{compact:true});
  const shade=html.match(/shade-person[\s\S]*?<figcaption><strong>([^<]+)<\/strong>/)?.[1];
  assert.equal(shade,'Unavailable','Do not silently substitute air temperature for a missing modeled shade feels-like');
});

test('main sun reading and the sun figure use one air-plus-radiant estimate',()=>{
  const sample={temperature:68,comfort:{daylight:true,weatherKind:'clear',rawShade:58,rawOutdoors:67,shade:58,outdoors:67,sun:67}};
  const display=sunExposureTemperature(sample);
  assert.deepEqual(display,{active:true,value:77,solarLift:9});
  const html=sunShadeHTML(sample.comfort,location,now,{compact:true,sunExposure:display.value});
  assert.match(html,/sun-person[\s\S]*?<figcaption><strong>77°<\/strong>/);
  assert.match(html,/shade-person[\s\S]*?<figcaption><strong>58°<\/strong>/);
});

test('night and cloud cover do not invent a sun-exposure temperature',()=>{
  for(const comfort of [{daylight:false,weatherKind:'clear',rawShade:58,rawOutdoors:67},{daylight:true,weatherKind:'cloudy',rawShade:58,rawOutdoors:67},{daylight:true,weatherKind:'clear',rawShade:null,rawOutdoors:67}]){
    assert.deepEqual(sunExposureTemperature({temperature:68,comfort}),{active:false,value:null,solarLift:null});
  }
});
