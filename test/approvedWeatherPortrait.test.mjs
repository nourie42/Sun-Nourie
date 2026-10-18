import test from 'node:test';
import assert from 'node:assert/strict';
import {accessSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {approvedState,approvedOutfit} from '../public/weather-fusion/player/approved-weather-world.js';
import {PORTRAIT_FILES,selectWeatherPortrait} from '../public/weather-fusion/player/approved-portrait-selection.js';
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

test('cold clothing respects the chosen air or feels-like value and preserves the forecast',()=>{
  const f={...frame,time:'2026-10-18T16:00:00Z',temperature:48,feelsLike:36.4};
  const before=structuredClone(f);
  const feels=approvedOutfit(f),air=approvedOutfit({...f,outfitBasis:'air'});
  assert.equal(feels.cold,true);
  assert.match(feels.label,/Winter coat/);
  assert.equal(feels.portrait.value,36.4);
  assert.equal(air.cold,false);
  assert.equal(air.label,'Jacket and long pants');
  assert.equal(air.portrait.value,48);
  assert.deepEqual(f,before);
  const fallback=approvedOutfit({...f,temperature:30,feelsLike:null});
  assert.equal(fallback.cold,true);
  assert.match(fallback.advice,/Air temperature \(feels like unavailable\) 30°F/);
  const missing=approvedOutfit({...f,temperature:null,feelsLike:null});
  assert.equal(missing.label,'Outfit unavailable');
  assert.equal(missing.cold,false);
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
