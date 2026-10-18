import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedHourSkyState,selectedCloudCover,projectSelectedCelestial,windBearing} from '../public/weather-fusion/player/selected-hour-sky.js';
import {solarElevation} from '../public/weather-fusion/weather-math.js';

const place={latitude:35.787,longitude:-78.4806};
const frame={...place,time:'2026-10-19T16:00:00Z',isDay:true,cloudCover:20,weatherCode:0,windSpeed:8,windDirection:'SW'};

test('selected forecast time and coordinates drive the shared sun and lunar geometry',()=>{
  const state=selectedHourSkyState(frame);
  assert.equal(state.time,Date.parse(frame.time));
  assert.deepEqual(state.location,place);
  assert.ok(Math.abs(state.astronomy.sun.altitude-solarElevation(state.time,place.latitude,place.longitude)*180/Math.PI)<1e-6);
  const afternoon=selectedHourSkyState({...frame,time:'2026-10-19T20:00:00Z'});
  assert.ok(afternoon.astronomy.sun.azimuth>state.astronomy.sun.azimuth);
  const night=selectedHourSkyState({...frame,time:'2026-10-20T04:00:00Z',isDay:true});
  assert.equal(night.lighting,'night','a stale daylight flag cannot make midnight sunny');
  assert.equal(night.nightAmount,1);
  assert.ok(night.astronomy.moonLight.fraction>=0&&night.astronomy.moonLight.fraction<=1);
});

test('missing coordinates never silently use the default city or invent celestial positions',()=>{
  for(const values of [{latitude:null},{longitude:undefined},{latitude:91},{longitude:-181},{time:'invalid'}]){
    const state=selectedHourSkyState({...frame,...values});
    assert.equal(state.astronomy,null);
  }
  const unlocated=selectedHourSkyState({...frame,latitude:null,isDay:false});
  assert.equal(unlocated.location,null);assert.equal(unlocated.lighting,'night');
});

test('cloud amount follows the selected hourly measurement including zero and dense overcast',()=>{
  for(const percent of [0,20,50,95,100]){
    const state=selectedHourSkyState({...frame,cloudCover:percent,nativeCondition:'Cloudy'});
    assert.equal(state.scene.cover,percent/100);assert.equal(state.cloudBasis,'hourly');
  }
  assert.equal(selectedCloudCover({...frame,cloudCover:null,nativeCondition:'Partly cloudy'}).cover,.5);
  assert.deepEqual(selectedCloudCover({}),{cover:0,basis:'unavailable'});
});

test('falling precipitation requires this hour’s active native weather evidence',()=>{
  const native={...frame,nativePolicy:true,nativeWeatherKind:'rain',nativeCondition:'Chance of showers',precipitationProbability:90,precipitation:.08};
  const possible=selectedHourSkyState({...native,nativePrecipitationActivity:'possible'});
  assert.equal(possible.scene.rain,0);assert.equal(possible.scene.snow,0);
  const active=selectedHourSkyState({...native,nativePrecipitationActivity:'active'});
  assert.ok(active.scene.rain>0);assert.equal(active.scene.storm,false);
  const snow=selectedHourSkyState({...native,nativeWeatherKind:'snow',nativePrecipitationActivity:'active',nativeSnowExpected:true});
  assert.ok(snow.scene.snow>0);assert.equal(snow.scene.rain,0);
  const storm=selectedHourSkyState({...native,nativeWeatherKind:'storm',nativePrecipitationActivity:'active'});
  assert.equal(storm.scene.storm,true);
});

test('wind bearing accepts actual numeric and compass guidance without inventing a direction',()=>{
  assert.equal(windBearing('SW'),225);assert.equal(windBearing('NNW'),337.5);
  assert.equal(windBearing(-90),270);assert.equal(windBearing(null),null);
  const state=selectedHourSkyState(frame);assert.equal(state.scene.windDir,225);assert.equal(state.scene.wind,8);
  assert.equal(selectedHourSkyState({...frame,windDirection:null}).windDirectionKnown,false);
});

test('the stated south-facing camera moves celestial objects with their computed angle',()=>{
  const options={width:400,height:500,horizon:.58};
  const east=projectSelectedCelestial({altitude:20,azimuth:90},options);
  const west=projectSelectedCelestial({altitude:20,azimuth:270},options);
  assert.ok(east.visible&&west.visible);assert.ok(east.x<west.x);
  assert.equal(east.y,west.y);
  assert.equal(projectSelectedCelestial({altitude:-10,azimuth:180},options).visible,false);
  assert.equal(projectSelectedCelestial({altitude:20,azimuth:0},options).visible,false);
});
