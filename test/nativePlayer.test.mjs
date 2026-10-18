import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFrameForSample,buildNativePlayerFrames,createNativePlaybackBridge,installNativePlayer} from '../public/weather-fusion/native-player.js';
import {hourlyDisplaySamples} from '../public/weather-fusion/weather-display.js?v=low-rain-display-v1';
import {rebuildHourlyFeels} from '../src/weatherFusionHourlyFeels.js';
import {selectPhotoScene} from '../public/weather-fusion/player/photo-scene.js';

// Only pure exports are used below. No browser or rendering assertions are made.
globalThis.HTMLElement??=class {};
globalThis.customElements??={get(){return true;},define(){}};
const {normalizeForecast,outfitForFrame,playbackTiming,weatherDescription,WeatherSkyPlayer}=await import('../public/weather-fusion/player/sky-player.js');
const HOUR=3600000,now=Date.parse('2026-10-18T14:00:00Z');
const iso=i=>new Date(now+i*HOUR).toISOString();
const location={name:'Raleigh',latitude:35.78,longitude:-78.64,timeZone:'America/New_York'};
const sample=(overrides={})=>({id:iso(1),time:iso(1),now:false,temperature:60,feels:55,pop:0,isDay:true,condition:'Partly Cloudy',inputs:{temperature:60,wind:0,gust:0,skyCover:40},...overrides});
const forecast=(overrides={})=>({location:{...location},hours:[{time:iso(1),temperature:60,condition:'Partly Cloudy',precipitation:0}],metricForecasts:{series:{}},...overrides});

test('native samples preserve canonical feels, actual zeroes and missing inputs through player normalization',()=>{
  const source=forecast(),s=sample(),before=structuredClone(source);
  const [frame]=normalizeForecast([nativeFrameForSample(source,s,now)]);
  assert.equal(frame.temperature,60);assert.equal(frame.feelsLike,55);assert.equal(frame.windSpeed,0);assert.equal(frame.windGust,0);
  assert.equal(frame.precipitationProbability,0);assert.equal(frame.precipitation,0);assert.equal(frame.nativeSampleId,iso(1));
  const [missing]=normalizeForecast([nativeFrameForSample(forecast({hours:[]}),sample({feels:null,pop:null,isDay:null,inputs:{}}),now)]);
  for(const key of ['feelsLike','precipitationProbability','precipitation','windSpeed','windGust','cloudCover','isDay'])assert.equal(missing[key],null,key);
  assert.deepEqual(source,before,'adapting a scene never changes native forecast evidence');
  assert.equal(nativeFrameForSample(source,sample({temperature:null}),now),null);
});

test('selected scene inputs retain validated coordinates, dew point and the selected timestamp through normalization',()=>{
  const source=forecast(),selected=sample({time:'2026-10-18T12:35:00-04:00',id:'2026-10-18T12:35:00-04:00',inputs:{dewpoint:48,wind:0,gust:0,skyCover:20},windDirection:'WNW'});
  const [frame]=normalizeForecast([nativeFrameForSample(source,selected,now)]);
  assert.equal(frame.latitude,location.latitude);assert.equal(frame.longitude,location.longitude);assert.equal(frame.dewpoint,48);assert.equal(frame.windDirection,292.5);assert.equal(frame.cloudCover,20);
  assert.equal(frame.time,'2026-10-18T16:35:00.000Z');assert.equal(frame.sourceTime,frame.time);assert.equal(frame.nativeSampleId,frame.time);
  const invalid=nativeFrameForSample(forecast({location:{...location,latitude:91,longitude:-181}}),selected,now);
  assert.equal(invalid.latitude,null);assert.equal(invalid.longitude,null);
  const [bad]=normalizeForecast([{...frame,latitude:true,longitude:'',dewpoint:null,sourceTime:'invalid'}]);
  assert.equal(bad.latitude,null);assert.equal(bad.longitude,null);assert.equal(bad.dewpoint,null);assert.equal(bad.sourceTime,null);
  const [origin]=normalizeForecast([{...frame,latitude:0,longitude:0,dewpoint:0}]);assert.equal(origin.latitude,0);assert.equal(origin.longitude,0);assert.equal(origin.dewpoint,0);
});

test('Now uses the current instant for astronomy while retaining the original weather source time',()=>{
  const source=forecast({hours:[{time:iso(0),windDirectionDegrees:180},{time:iso(1),windDirectionDegrees:90}]}),selectedNow=now+37*60000,observed=now-25*60000;
  const [frame]=normalizeForecast([nativeFrameForSample(source,sample({id:'now',now:true,time:new Date(observed).toISOString()}),selectedNow)]);
  assert.equal(frame.time,new Date(selectedNow).toISOString());assert.equal(frame.sourceTime,new Date(observed).toISOString());assert.equal(frame.nativeSampleId,'now');
  assert.equal(frame.windDirection,180,'only the interval containing Now supplies an absent direction');
  const futureOnly=nativeFrameForSample(forecast({hours:[{time:iso(1),windDirectionDegrees:90}]}),sample({id:'now',now:true,time:new Date(observed).toISOString()}),selectedNow);
  assert.equal(futureOnly.windDirection,null,'a future hour never supplies current wind direction');
});

test('numeric and compass wind directions normalize without creating a direction from missing or variable wind',()=>{
  for(const [input,expected] of [[0,0],[360,0],[-90,270],['225°',225],[' nne ',22.5],['SW',225],['VRB',null],[null,null],['',null],['  ',null],['°',null]]){
    const adapted=nativeFrameForSample(forecast({hours:[]}),sample({windDirection:input}),now);
    assert.equal(adapted.windDirection,expected,String(input));
    const [standalone]=normalizeForecast([{time:iso(1),temperature:60,windDirection:input}]);
    assert.equal(standalone.windDirection,expected,`standalone ${input}`);
  }
});

test('native garment thresholds match the existing comfort cards rather than the old fork thresholds',()=>{
  for(const [feels,expected] of [[41.9,'cold'],[42,'cool'],[64.9,'cool'],[65,'mild'],[73.9,'mild'],[74,'mild'],[87.9,'mild'],[88,'hot']]){
    const frame=nativeFrameForSample(forecast(),sample({feels}),now),outfit=outfitForFrame(frame);
    assert.equal(outfit.garment,expected,`${feels}° uses the native clothing range`);
    assert.equal(selectPhotoScene(frame,outfit).garment,expected);
  }
});

test('chance rain stays possible, explicit storms and native current-rain evidence remain active',()=>{
  for(const [condition,pop,rainExpected,activity] of [['Chance Rain',38,false,'possible'],['Chance Rain',61,false,'active'],['Thunderstorms',38,false,'active'],['Partly Cloudy',4,true,'active']]){
    const frame=nativeFrameForSample(forecast(),sample({condition,pop,rainExpected,precipitation:.02}),now),outfit=outfitForFrame(frame),scene=selectPhotoScene(frame,outfit);
    assert.equal(frame.nativePrecipitationActivity,activity,condition);
    assert.equal(outfit.rain,activity==='active',condition);
    assert.equal(scene.precipitation,activity==='active'?'rain':null,condition);
    if(activity==='possible'){assert.equal(outfit.umbrella,false);assert.match(outfit.advice,/keep it closed/);assert.equal(scene.overcast,true);}
    if(condition==='Thunderstorms'){assert.equal(outfit.storm,true);assert.equal(scene.showPerson,false);assert.equal(outfit.umbrella,false);}
  }
});

test('selected-hour snow is distinct from freezing rain and a later daily accumulation',()=>{
  const f=forecast({hours:[{time:iso(1),temperature:30,condition:'Freezing Rain',precipitation:.01,snowfall:1}],snow:{days:[{snowfall:8}]}});
  const ice=nativeFrameForSample(f,sample({temperature:30,feels:25,condition:'Freezing Rain'}),now),iceOutfit=outfitForFrame(ice);
  assert.equal(ice.nativeSnowExpected,false);assert.equal(iceOutfit.snow,false);assert.equal(selectPhotoScene(ice,iceOutfit).precipitation,'rain');
  const snow=nativeFrameForSample(f,sample({temperature:30,feels:25,condition:'Snow'}),now),snowOutfit=outfitForFrame(snow);
  assert.equal(snow.nativeSnowExpected,true);assert.equal(snowOutfit.garment,'cold');assert.equal(selectPhotoScene(snow,snowOutfit).key,'snow');
});

test('the adapter uses the same validated native hourly selection and UTCI values as the main site',()=>{
  const series=values=>values.map((value,i)=>({time:iso(i),value}));
  const f={location,current:{temperature:60,dewpoint:48,wind:6,time:iso(0)},assembledAt:iso(0),hours:[60,62,64].map((temperature,i)=>({time:iso(i),temperature,condition:'Partly Cloudy'})),days:[],metricForecasts:{series:{temperature:series([60,62,64]),dewpoint:series([48,48,48]),wind:series([6,6,6])},notes:{}}};
  rebuildHourlyFeels(f,{now,temperatureAt:()=>({value:null}),humidityAt:()=>null});
  const samples=hourlyDisplaySamples(f,now),frames=buildNativePlayerFrames(f,now);
  assert.ok(frames.length>=3);assert.deepEqual(frames.map(frame=>frame.nativeSampleId),samples.map(s=>s.id));
  samples.forEach((s,i)=>{assert.equal(frames[i].temperature,s.temperature);assert.equal(frames[i].feelsLike,s.feels);});
  const missingTime=f.hours[1].time;f.metricForecasts.series.feels=f.metricForecasts.series.feels.filter(row=>row.time!==missingTime);
  assert.ok(!buildNativePlayerFrames(f,now).some(frame=>frame.nativeSampleId===missingTime),'an invalid native hourly sample is not fabricated');
});

class TestPlayer extends EventTarget {
  constructor(){super();this._forecast=[];this._index=0;this.playing=false;this.attributes=new Map();}
  get forecast(){return this._forecast;}
  set forecast(frames){this._forecast=normalizeForecast(frames);this._index=Math.min(this._index,Math.max(0,frames.length-1));if(!frames.length)this.pause();}
  get currentFrame(){return this._forecast[this._index]||null;}
  setAttribute(name,value){this.attributes.set(name,value);}
  getAttribute(name){return this.attributes.get(name)??null;}
  emit(type,detail){const event=new Event(type);event.detail=detail;this.dispatchEvent(event);}
  setFrame(index){if(!this._forecast.length)return;this._index=index;this.emit('framechange',{index,frame:this.currentFrame});}
  play(){if(!this._forecast.length||this.playing)return;this.playing=true;this.emit('playbackchange',{playing:true});}
  pause(){if(!this.playing)return;this.playing=false;this.emit('playbackchange',{playing:false});}
}
const fixtureFrames=()=>[0,1,2].map(i=>({...nativeFrameForSample(forecast(),sample({id:i?iso(i):'now',time:iso(i),now:i===0}),now)}));
function setup(){
  const player=new TestPlayer(),commits=[],jobs=[],unavailable=[];
  const bridge=createNativePlaybackBridge({player,selectComfortHour:id=>commits.push(id),samplesForForecast:f=>f.frames,scheduleMicrotask:job=>jobs.push(job),now:()=>now,onUnavailable:message=>unavailable.push(message)});
  const snapshot={location:{...location},frames:fixtureFrames()};
  const flush=()=>{while(jobs.length)jobs.shift()();};
  return {player,commits,jobs,unavailable,bridge,snapshot,flush};
}

test('forecast playback leaves comfort cards alone until paused, while a paused scrub commits its selected native hour',()=>{
  const {player,commits,bridge,snapshot,flush}=setup();bridge.setForecast(snapshot);flush();assert.deepEqual(commits,[]);
  player.play();player.setFrame(1);player.setFrame(2);assert.deepEqual(commits,[]);
  player.pause();assert.deepEqual(commits,[iso(2)]);
  player.setFrame(1);assert.deepEqual(commits,[iso(2),iso(1)]);
  player.setAttribute('data-mode','sample');player.setFrame(0);assert.deepEqual(commits,[iso(2),iso(1)],'sample scenes cannot enter native comfort');
  bridge.dispose();
});

test('native hourly clicks pause and align the player without duplicating the main app comfort callback',()=>{
  const {player,commits,bridge,snapshot,flush}=setup();bridge.setForecast(snapshot);flush();player.play();
  assert.equal(bridge.handleNativeSelection('2026-10-18T11:00:00-04:00'),true);assert.equal(player.playing,false);assert.equal(player.currentFrame.nativeSampleId,iso(1));assert.deepEqual(commits,[]);
  assert.equal(bridge.handleNativeSelection(iso(20)),false);assert.equal(player.currentFrame.nativeSampleId,iso(1));assert.deepEqual(commits,[]);
  bridge.dispose();
});

test('same-location refresh preserves selected time and playback without updating comfort during refresh',()=>{
  const {player,commits,bridge,snapshot,flush}=setup();bridge.setForecast(snapshot);flush();player.play();player.setFrame(2);
  const refreshed={...snapshot,frames:[...fixtureFrames(),{...fixtureFrames()[2],time:iso(3),nativeSampleId:iso(3)}]};
  bridge.setForecast(refreshed);flush();assert.equal(player.currentFrame.nativeSampleId,iso(2));assert.equal(player.playing,true);assert.deepEqual(commits,[]);
  bridge.dispose();
});

test('location reset cancels queued old snapshots and rejects stale frame and pause commits',()=>{
  const {player,commits,bridge,snapshot,flush}=setup();bridge.setForecast(snapshot);flush();player.play();player.setFrame(2);
  bridge.setForecast(snapshot);bridge.reset({name:'Boston'});flush();
  assert.equal(player.forecast.length,0);assert.equal(bridge.forecast,null);assert.equal(player.locationName,'Boston');
  player.emit('framechange',{frame:snapshot.frames[2]});player.emit('playbackchange',{playing:false});assert.deepEqual(commits,[]);
  const next={location:{...location,name:'Boston',latitude:42.36,longitude:-71.06},frames:fixtureFrames()};bridge.setForecast(next);flush();assert.equal(player.currentFrame.nativeSampleId,'now');assert.deepEqual(commits,[]);
  bridge.dispose();
});

test('only the latest queued forecast is installed and disposal removes event effects',()=>{
  const {player,commits,bridge,snapshot,flush}=setup(),next={...snapshot,location:{...location,name:'Boston',latitude:42.36}};
  bridge.setForecast(snapshot);bridge.setForecast(next);flush();assert.equal(player.locationName,'Boston');
  bridge.dispose();player.setFrame(1);player.play();player.pause();bridge.setForecast(snapshot);flush();assert.deepEqual(commits,[]);assert.equal(player.locationName,'Boston');
});

test('all playback speeds keep forecast sampling independent of physical animation time',()=>{
  for(const speed of [1,2,4,8,16,32]){const timing=playbackTiming(speed,24);assert.equal(timing.millisecondsPerHour,2000/speed);assert.equal(timing.sweepSeconds,48/speed);}
  assert.equal(playbackTiming(32).millisecondsPerHour,62.5);assert.equal(playbackTiming('invalid').speed,4);
});

test('actual manual-seek and day-skip methods stop on the chosen hour and commit it once',()=>{
  // Invoke the real component controller methods on an EventTarget; this does
  // not construct a shadow tree or claim to test browser layout/rendering.
  class SeekHarness extends EventTarget {
    constructor(){super();this._forecast=[];this._index=0;this._playing=false;this._timer=null;this.attributes=new Map();}
    get forecast(){return this._forecast;}set forecast(value){this._forecast=normalizeForecast(value);}
    get currentFrame(){return this._forecast[this._index]||null;}get playing(){return this._playing;}
    getAttribute(name){return this.attributes.get(name)??null;}setAttribute(name,value){this.attributes.set(name,value);}
    _render(){}
  }
  for(const method of ['setFrame','seekFrame','skipDays','pause'])SeekHarness.prototype[method]=WeatherSkyPlayer.prototype[method];
  globalThis.CustomEvent??=class extends Event{constructor(type,options={}){super(type,options);this.detail=options.detail;}};
  const player=new SeekHarness(),commits=[],jobs=[];
  const frames=Array.from({length:49},(_,i)=>({...fixtureFrames()[0],time:iso(i),nativeSampleId:i?iso(i):'now'}));
  const bridge=createNativePlaybackBridge({player,selectComfortHour:id=>commits.push(id),samplesForForecast:f=>f.frames,scheduleMicrotask:job=>jobs.push(job)});
  bridge.setForecast({location,frames});jobs.shift()();player._playing=true;
  player.seekFrame(3);assert.equal(player.playing,false);assert.equal(player.currentFrame.nativeSampleId,iso(3));assert.deepEqual(commits,[iso(3)],'pause commits the new hour, never the old one');
  player._playing=true;player.skipDays(1);assert.equal(player.playing,false);assert.equal(player.currentFrame.nativeSampleId,iso(27));assert.deepEqual(commits,[iso(3),iso(27)]);
  player._playing=true;player.setFrame(28);assert.equal(player.playing,true);assert.deepEqual(commits,[iso(3),iso(27)],'timer frames continue playing without card commits');
  bridge.dispose();
});

test('night descriptions use clear skies rather than sunshine without altering the forecast',()=>{
  const frame={nativePolicy:true,nativeCondition:'Mostly Sunny',isDay:false};
  assert.equal(weatherDescription(frame),'Mostly clear');
  assert.equal(frame.nativeCondition,'Mostly Sunny');
  assert.equal(weatherDescription({...frame,nativeCondition:'Partly Sunny'}),'Partly cloudy');
  assert.equal(weatherDescription({...frame,isDay:true}),'Mostly Sunny');
  assert.equal(weatherDescription({...frame,nativeCondition:'Rain Showers'}),'Rain Showers');
});


test('the weather tab loads only on demand and detaches its renderer while preserving the chosen person and hour',async()=>{
  class Node extends EventTarget {
    constructor(){super();this.children=[];this.attributes=new Map();this.classList={add(){},remove(){}};this.hidden=false;}
    setAttribute(key,value){this.attributes.set(key,value);}getAttribute(key){return this.attributes.get(key);}
    replaceChildren(...children){for(const child of this.children)child.parentNode=null;this.children=children;children.forEach(child=>child.parentNode=this);}
    contains(child){return this.children.includes(child);}
    scrollIntoView(){}
  }
  class Player extends TestPlayer {
    remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;this.disconnections=(this.disconnections||0)+1;}}
  }
  const priorDocument=globalThis.document,priorSnapshot=globalThis.__weatherNourieForecast;
  const host=new Node(),button=new Node(),hourly=new Node(),doc=new EventTarget();
  doc.getElementById=id=>({'nourie-player':host,'open-native-player':button,hourly}[id]||null);
  doc.createElement=tag=>tag==='weather-sky-player'?new Player():new Node();
  globalThis.document=doc;delete globalThis.__weatherNourieForecast;
  let imports=0,resolveModule;
  const loaded=new Promise(resolve=>{resolveModule=resolve;});
  const controller=installNativePlayer({selectComfortHour(){},loadPlayer(){imports++;return loaded;}});
  const point=Math.floor(Date.now()/HOUR)*HOUR,series=values=>values.map((value,i)=>({time:new Date(point+i*HOUR).toISOString(),value}));
  const snapshot={location,current:{temperature:60,dewpoint:48,wind:6,time:new Date(point).toISOString()},assembledAt:new Date(point).toISOString(),hours:[60,62,64].map((temperature,i)=>({time:new Date(point+i*HOUR).toISOString(),temperature,condition:'Partly Cloudy'})),days:[],metricForecasts:{series:{temperature:series([60,62,64]),dewpoint:series([48,48,48]),wind:series([6,6,6])},notes:{}}};
  rebuildHourlyFeels(snapshot,{now:point,temperatureAt:()=>({value:null}),humidityAt:()=>null});
  const flush=async()=>{await Promise.resolve();await Promise.resolve();};
  try{
    controller.setForecast(snapshot);await flush();assert.equal(imports,0);assert.equal(host.hidden,true);assert.equal(controller.player,null);assert.equal(controller.ready,null);assert.equal(button.getAttribute('aria-expanded'),'false');
    const first=controller.open();assert.equal(imports,1);controller.close();const second=controller.open();resolveModule();await Promise.all([first,second]);await flush();
    const player=controller.player;assert.ok(player);assert.equal(controller.isOpen,true);assert.equal(host.hidden,false);assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(host.children.filter(child=>child===player).length,1);assert.ok(player.forecast.length>=2);
    player.character='black';player.setFrame(1);const selected=player.currentFrame.nativeSampleId;player.play();
    controller.close();assert.equal(player.playing,false);assert.equal(player.parentNode,null);assert.equal(player.disconnections,1);assert.equal(host.hidden,true);assert.equal(button.getAttribute('aria-expanded'),'false');
    await controller.open();await flush();assert.equal(controller.player,player);assert.equal(player.character,'black');assert.equal(player.currentFrame.nativeSampleId,selected);assert.equal(player.playing,false);assert.equal(imports,1);
    controller.close();
    const hourlySelection=new Node();hourlySelection.dataset={comfortTime:player.forecast[2].nativeSampleId};hourlySelection.closest=()=>hourlySelection;hourly.replaceChildren(hourlySelection);
    const selectEvent=new Event('click');Object.defineProperty(selectEvent,'target',{value:hourlySelection});hourly.dispatchEvent(selectEvent);
    controller.setForecast(snapshot);await controller.open();await flush();assert.equal(player.currentFrame.nativeSampleId,hourlySelection.dataset.comfortTime,'an hour chosen while closed is applied to the latest forecast');
    controller.close();
    const next={...snapshot,location:{...location,name:'Boston',latitude:42.36,longitude:-71.06}};
    const change=new Event('weather-nourie:location-changing');change.detail={location:next.location};doc.dispatchEvent(change);
    controller.setForecast(next);await flush();assert.equal(player.forecast.length,0,'a closed scene clears the previous location');
    await controller.open();await flush();assert.equal(player.locationName,'Boston');assert.equal(player.currentFrame.nativeSampleId,'now');assert.equal(player.currentFrame.latitude,42.36);assert.equal(player.currentFrame.longitude,-71.06);
  }finally{controller.dispose();globalThis.document=priorDocument;if(priorSnapshot===undefined)delete globalThis.__weatherNourieForecast;else globalThis.__weatherNourieForecast=priorSnapshot;}
});
