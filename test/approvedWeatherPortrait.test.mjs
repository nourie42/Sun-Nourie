import test from 'node:test';
import assert from 'node:assert/strict';
import {accessSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {approvedState,approvedOutfit} from '../public/weather-fusion/player/approved-weather-world.js';
import {PORTRAIT_FILES,selectWeatherPortrait} from '../public/weather-fusion/player/approved-portrait-selection.js';
import {solarElevation} from '../public/weather-fusion/weather-math.js';
import {clothingForFeels} from '../public/weather-fusion/exposure-scene.js';

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

test('temperatures in the 30s select the existing insulated coat scene and winter guidance',()=>{
  for(const feelsLike of [30,32,35,39.9,41.9]){
    for(const [time,isDay] of [['2026-10-18T16:00:00Z',true],['2026-10-19T04:00:00Z',false]]){
      for(const nativeCondition of ['Clear','Partly Cloudy','Overcast','Fog','Haze','Dust','Windy']){
        const f={...frame,time,isDay,temperature:45,feelsLike,nativeCondition};
        const state=approvedState(f),outfit=approvedOutfit(f);
        assert.equal(state.cold,true,`${nativeCondition}: ${feelsLike}`);
        assert.match(state.file,/-feels-below-32f\.webp$/,'legacy filename identifies the existing insulated parka artwork');
        assert.equal(outfit.cold,true);
        assert.match(outfit.label,/Winter coat/);
        assert.match(outfit.label,/hat, gloves and boots/);
        assert.ok(outfit.hat&&outfit.scarf&&outfit.gloves&&outfit.boots);
        assert.equal(outfit.snow,false,'cold air must not create snowfall');
      }
    }
  }
});

test('cold liquid rain gets winter rainwear without becoming snow or freezing rain',()=>{
  for(const [nativeCondition,weather] of [['Drizzle','drizzle'],['Rain','rain'],['Heavy Rain','heavy-rain'],['Thunderstorms','storm'],['Thunderstorms with hail','hail']]){
    for(const isDay of [true,false]){
      for(const feelsLike of [20,30,35,41.9]){
        const f={...frame,time:isDay?'2026-10-18T16:00:00Z':'2026-10-19T04:00:00Z',isDay,temperature:40,feelsLike,nativeCondition};
        const state=approvedState(f),outfit=approvedOutfit(f);
        assert.equal(state.weather,weather);
        assert.equal(state.file,`weather-her-${weather}-${isDay?'day':'night'}-feels-below-42f.webp`);
        assert.equal(state.background,`weather-her-bg-${weather}-${isDay?'day':'night'}-feels-below-60f.webp`);
        assert.equal(outfit.cold,true);
        assert.match(outfit.label,/Insulated winter raincoat/);
        assert.equal(outfit.snow,false);
        assert.ok(PORTRAIT_FILES.includes(state.file));
      }
    }
  }
});

test('winter clothing stops at the native 42-degree threshold while mild weather keeps its approved scene',()=>{
  for(const [feelsLike,cold,fileBand] of [[41.9,true,'below-32f'],[42,false,'32-59f'],[55,false,'32-59f'],[65,false,'60-74f'],[80,false,'75f-plus']]){
    const f={...frame,time:'2026-10-18T16:00:00Z',feelsLike};
    assert.equal(approvedOutfit(f).cold,cold,String(feelsLike));
    assert.equal(approvedState(f).file,`weather-her-clear-day-feels-${fileBand}.webp`);
  }
  assert.equal(approvedState({...frame,time:'2026-10-18T16:00:00Z',nativeCondition:'Rain',feelsLike:42}).file,'weather-her-rain-day-feels-below-60f.webp');
  assert.equal(approvedState({...frame,time:'2026-10-18T16:00:00Z',nativeCondition:'Rain',feelsLike:65}).file,'weather-her-rain-day-feels-60f-plus.webp');
});

test('clothing always uses feels like even when an old air-temperature preference is present',()=>{
  const f={...frame,time:'2026-10-18T16:00:00Z',temperature:48,feelsLike:36.4};
  const before=structuredClone(f);
  const feels=approvedOutfit(f),air=approvedOutfit({...f,outfitBasis:'air'});
  assert.equal(feels.cold,true);
  assert.match(feels.label,/Winter coat/);
  assert.equal(feels.portrait.value,36.4);
  assert.equal(air.cold,true);
  assert.match(air.label,/Winter coat/);
  assert.equal(air.portrait.value,36.4);
  assert.equal(air.portrait.basis,'Feels like');
  assert.deepEqual(f,before);
  const fallback=approvedOutfit({...f,temperature:30,feelsLike:null});
  assert.equal(fallback.cold,true);
  assert.match(fallback.advice,/Air temperature \(feels like unavailable\) 30°F/);
  const missing=approvedOutfit({...f,temperature:null,feelsLike:null});
  assert.equal(missing.label,'Outfit unavailable');
  assert.equal(missing.cold,false);
});

test('65-degree air with a 58-degree feels-like reading keeps the jacket photograph and caption together',()=>{
  const f=Object.freeze({...frame,time:'2026-10-18T16:00:00Z',temperature:65,feelsLike:58,outfitBasis:'air'});
  const state=approvedState(f),outfit=approvedOutfit(f);
  assert.equal(state.value,58);
  assert.equal(state.basis,'Feels like');
  assert.equal(state.clothing,'cool');
  assert.equal(state.file,'weather-her-clear-day-feels-32-59f.webp');
  assert.equal(outfit.garment,'cool');
  assert.equal(outfit.label,'Jacket and long pants');
  assert.equal(outfit.portrait.file,state.file);
});

test('every clothing boundary agrees with the native comfort policy for all weather families',()=>{
  const families=[
    ['Clear','clear','four'],['Partly cloudy','partly-cloudy','four'],['Overcast','cloudy','four'],
    ['Fog','fog','three'],['Haze','haze','three'],['Dust','dust','three'],['Windy','wind','three'],
    ['Drizzle','drizzle','wet'],['Rain','rain','wet'],['Heavy rain','heavy-rain','wet'],
    ['Thunderstorms','storm','wet'],['Thunderstorms with hail','hail','wet']
  ];
  for(const feelsLike of [-20,0,30,41.9,42,58,59.9,60,64.9,65,73.9,74,74.9,75,87.9,88,105]){
    const clothing=clothingForFeels(feelsLike);
    for(const [nativeCondition,weather,family] of families){
      for(const isDay of [true,false]){
        const f=Object.freeze({...frame,nativeCondition,temperature:99,feelsLike,outfitBasis:'air',isDay,time:isDay?'2026-10-18T16:00:00Z':'2026-10-19T04:00:00Z'});
        const state=approvedState(f),outfit=approvedOutfit(f);
        const detail=`${weather}, ${feelsLike}°F, ${isDay?'day':'night'}`;
        assert.equal(state.value,feelsLike,detail);
        assert.equal(state.clothing,clothing,detail);
        assert.equal(outfit.garment,clothing,detail);
        assert.equal(outfit.cold,clothing==='cold',detail);
        assert.equal(outfit.cool,clothing==='cool',detail);
        const band=family==='wet'?(clothing==='cold'?'below-42f':clothing==='cool'?'below-60f':'60f-plus'):
          clothing==='cold'?'below-32f':clothing==='cool'?'32-59f':family==='four'?(clothing==='mild'?'60-74f':'75f-plus'):'60f-plus';
        assert.equal(state.file,`weather-her-${weather}-${isDay?'day':'night'}-feels-${band}.webp`,detail);
        assert.ok(PORTRAIT_FILES.includes(state.file),detail);
        assert.equal(state.weather,weather,detail);
      }
    }
  }
});

test('snow uses heavy winter clothing without using cold temperatures to invent snowfall',()=>{
  for(const [nativeCondition,weather] of [['Snow','snow'],['Heavy snow','heavy-snow']]){
    for(const feelsLike of [30,58,74,88]){
      const f=Object.freeze({...frame,nativeCondition,temperature:60,feelsLike,time:'2026-10-18T16:00:00Z'});
      const state=approvedState(f),outfit=approvedOutfit(f);
      assert.equal(state.clothing,clothingForFeels(feelsLike,{snowExpected:true}));
      assert.equal(state.weather,weather);
      assert.equal(state.file,`weather-her-${weather}-day-feels-below-32f.webp`);
      assert.equal(outfit.garment,'cold');
      assert.ok(outfit.cold&&outfit.hat&&outfit.scarf&&outfit.gloves&&outfit.boots);
      assert.equal(outfit.snow,true);
    }
  }
  const explicit=approvedState({...frame,feelsLike:58,nativeSnowExpected:true,time:'2026-10-18T16:00:00Z'});
  assert.equal(explicit.clothing,'cold','native selected-hour snow clothing guidance remains authoritative');
  for(const nativeCondition of ['Clear','Rain','Freezing rain','Sleet']){
    const f={...frame,nativeCondition,feelsLike:20,time:'2026-10-18T16:00:00Z'};
    assert.equal(approvedOutfit(f).snow,false,nativeCondition);
  }
});

test('direct portrait callers cannot re-enable air-based clothing and missing feels-like is disclosed',()=>{
  const row=Object.freeze({condition:'Clear',temperature:65,feels:58,isDay:true});
  for(const mode of ['air','feels',undefined]){
    const state=selectWeatherPortrait(row,{mode});
    assert.equal(state.value,58);
    assert.equal(state.basis,'Feels like');
    assert.equal(state.clothing,'cool');
  }
  for(const feels of [null,undefined,NaN,Infinity]){
    const state=selectWeatherPortrait({...row,temperature:0,feels},{mode:'air'});
    assert.equal(state.value,0);
    assert.equal(state.basis,'Air temperature (feels like unavailable)');
    assert.equal(state.clothing,'cold');
  }
});

test('ice precipitation keeps its phase and feels-like clothing category',()=>{
  for(const [nativeCondition,weather] of [['Sleet','sleet'],['Freezing rain','freezing-rain']]){
    for(const feelsLike of [30,42,58,65,74,88]){
      const f={...frame,nativeCondition,feelsLike,time:'2026-10-18T16:00:00Z'};
      const state=approvedState(f),outfit=approvedOutfit(f);
      assert.equal(state.weather,weather);
      assert.equal(state.clothing,clothingForFeels(feelsLike));
      assert.equal(outfit.garment,clothingForFeels(feelsLike));
      assert.equal(outfit.snow,false);
      assert.equal(state.file,`weather-her-${weather}-day-feels-${feelsLike<42?'below-32f':'32-49f'}.webp`);
    }
  }
});

test('dawn and dusk use the insulated coat without changing the selected time or weather',()=>{
  for(const [time,light] of [['2026-10-18T11:25:00Z','dawn'],['2026-10-18T22:30:00Z','dusk']]){
    const f={...frame,time,feelsLike:35};
    assert.equal(approvedState(f).file,`weather-her-${light}-feels-below-32f.webp`);
    assert.match(approvedOutfit(f).label,/Winter coat/);
  }
});

test('the scene catalogue keeps all approved photographs and adds ten cold-rain variants',()=>{
  assert.equal(PORTRAIT_FILES.length,100);
  assert.equal(new Set(PORTRAIT_FILES).size,100);
  const missing=selectWeatherPortrait({condition:'Clear',temperature:null,feels:null,isDay:true});
  assert.equal(missing.available,false);
});

test('every selectable portrait and matching background ships with the player',()=>{
  const root=new URL('../public/weather-fusion/',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('weather-her-manifest.json',root),'utf8'));
  assert.equal(manifest.count,PORTRAIT_FILES.length);
  assert.deepEqual(manifest.images.map(image=>image.file).sort(),[...PORTRAIT_FILES].sort());
  for(const image of manifest.images){
    const photo=readFileSync(new URL(image.file,root));
    assert.equal(createHash('sha256').update(photo).digest('hex'),image.sha256,image.file);
    accessSync(new URL(image.background,root));
  }
});
