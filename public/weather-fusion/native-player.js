/** Use the page's canonical hourly forecast; this module never fetches weather. */
import {hourlyDisplaySamples} from './weather-display.js?v=low-rain-display-v1';
import {forecastValue} from './hourly-feels.js?v=current-rain-20261017-v3';
import {weatherState} from './weather-state.js?v=current-rain-20261017-v3';
import {comfortArtworkContext} from './comfort-outlook.js?v=current-rain-20261017-v3';
import {clothingForFeels,precipitationActivity} from './exposure-scene.js?v=current-rain-20261017-v3';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const known=value=>finite(value)?value:null;
const HOUR=3600000;
const INSTALL_KEY=Symbol.for('weather-nourie.native-player');
const kinds=new Set(['clear','partly-cloudy','cloudy','rain','storm','snow','fog','unknown']);
const wmoForKind={clear:0,'partly-cloudy':2,cloudy:3,rain:61,storm:95,snow:71,fog:45,unknown:null};
const epoch=value=>{const t=Date.parse(value);return Number.isFinite(t)?t:null;};
const normalizedId=value=>value==='now'?'now':epoch(value)!==null?new Date(epoch(value)).toISOString():null;

/** Adapts an already validated native sample, keeping probability and amount separate. */
export function nativeFrameForSample(forecast,sample,now=Date.now()){
  if(!sample||!finite(sample.temperature)||epoch(sample.time)===null)return null;
  const context=comfortArtworkContext(forecast,sample,now);
  const selectedTime=sample.now?now:epoch(sample.time);
  const hour=(forecast?.hours||[]).find(row=>{const start=epoch(row.time);return start!==null&&start<=selectedTime&&selectedTime<start+HOUR;});
  const condition=String(sample.condition||'Sky conditions unavailable');
  const weather=weatherState(condition,sample.inputs?.skyCover);
  const activity=precipitationActivity(condition,{...context,pop:sample.pop,rainAround:sample.rainAround===true,radarThreat:sample.radarThreat===true,rainExpected:sample.rainExpected===true});
  // The displayed condition's snow/ice bucket is broader than actual snowfall.
  // Preserve the native selected-hour phase evidence, including timed vetoes.
  const snow=context.snowExpected===true;
  const kind=snow?'snow':weather.kind==='snow'?'rain':weather.kind;
  const sky=known(sample.inputs?.skyCover)??known(forecastValue(forecast,'cloud',hour?.time||sample.time));
  const amount=known(sample.precipitation)??known(forecastValue(forecast,'precipitation',hour?.time||sample.time))??known(hour?.precipitation);
  const nativeSampleId=normalizedId(sample.id??(sample.now?'now':sample.time));
  if(!nativeSampleId)return null;
  return {
    time:new Date(epoch(sample.time)).toISOString(),temperature:sample.temperature,feelsLike:known(sample.feels),
    precipitationProbability:known(sample.pop),precipitation:amount,cloudCover:sky,
    windSpeed:known(sample.inputs?.wind),windGust:known(sample.inputs?.gust),weatherCode:wmoForKind[kind]??null,
    isDay:typeof sample.isDay==='boolean'?sample.isDay:null,
    nativePolicy:true,nativeSampleId,nativeCondition:condition,nativeWeatherKind:kinds.has(kind)?kind:'unknown',
    nativePrecipitationActivity:activity,nativeSnowExpected:snow,
    nativeClothing:clothingForFeels(sample.feels,context)
  };
}

export function buildNativePlayerFrames(forecast,now=Date.now()){
  if(!forecast?.location)return [];
  return hourlyDisplaySamples(forecast,now).map(sample=>nativeFrameForSample(forecast,sample,now)).filter(Boolean).slice(0,336);
}
const locationKey=forecast=>{
  const l=forecast?.location;if(!l)return '';
  return `${known(l.latitude)}|${known(l.longitude)}|${l.timeZone||''}`;
};
const matchingIndex=(frames,id)=>{
  const key=normalizedId(id);if(!key)return -1;
  return frames.findIndex(frame=>frame.nativeSampleId===key);
};

/** Event/controller layer is separate from DOM installation for meaningful tests. */
export function createNativePlaybackBridge({player,selectComfortHour,samplesForForecast=buildNativePlayerFrames,scheduleMicrotask=queueMicrotask,now=Date.now,onUnavailable=()=>{}}){
  if(!player?.addEventListener||typeof selectComfortHour!=='function')throw new TypeError('A forecast player and the native comfort selector are required.');
  let frames=[],snapshot=null,place='',updating=false,disposed=false,version=0;
  const currentFrame=()=>player.currentFrame||frames[player._index??0]||null;
  function commit(){
    if(disposed||updating||player.playing||!snapshot)return;
    if(['sample','demo'].includes(player.getAttribute?.('data-mode')))return;
    const frame=currentFrame(),id=normalizedId(frame?.nativeSampleId);
    if(!id||matchingIndex(frames,id)<0)return;
    selectComfortHour(id);
  }
  const onFrame=()=>{if(!player.playing)commit();};
  const onPlayback=event=>{if(event.detail?.playing===false)commit();};
  player.addEventListener('framechange',onFrame);player.addEventListener('playbackchange',onPlayback);
  function applyForecast(forecast){
    if(disposed)return;
    const next=samplesForForecast(forecast,now()),key=locationKey(forecast),samePlace=!!place&&place===key;
    const previous=currentFrame(),wasPlaying=player.playing===true;
    updating=true;
    try{
      if(!samePlace)player.pause();
      frames=next;snapshot=forecast;place=key;
      player.setAttribute('data-mode','live');player.setAttribute('data-native','');
      player.locationName=String(forecast?.location?.name||'Selected location');player.timezone=forecast?.location?.timeZone||'';
      player.forecast=frames;
      let index=samePlace?matchingIndex(frames,previous?.nativeSampleId):-1;
      if(index<0&&samePlace&&epoch(previous?.time)!==null&&frames.length){let delta=Infinity;frames.forEach((frame,i)=>{const d=Math.abs(epoch(frame.time)-epoch(previous.time));if(d<delta){delta=d;index=i;}});}
      if(frames.length)player.setFrame(Math.max(0,index));
      if(samePlace&&wasPlaying&&frames.length&&!player.playing)player.play();
      onUnavailable(frames.length?'':'The weather scene is waiting for a valid hourly temperature.');
    }finally{updating=false;}
  }
  function setForecast(forecast){
    const request=++version;
    // Native app dispatches the snapshot before rendering its comfort singleton.
    scheduleMicrotask(()=>{if(!disposed&&request===version)applyForecast(forecast);});
  }
  function handleNativeSelection(id){
    if(disposed)return false;
    const index=matchingIndex(frames,id);updating=true;
    try{player.pause();if(index>=0){player.setFrame(index);onUnavailable('');}else onUnavailable('A scene is unavailable for this hour because temperature data is missing.');}
    finally{updating=false;}
    // The original delegated #hourly handler performs the comfort update once.
    return index>=0;
  }
  function reset(location=null){
    if(disposed)return;++version;updating=true;
    try{player.pause();frames=[];snapshot=null;place='';player.forecast=[];player.locationName=String(location?.name||'Selected location');onUnavailable('Loading the selected location’s hourly forecast…');}
    finally{updating=false;}
  }
  function dispose(){if(disposed)return;disposed=true;++version;player.removeEventListener('framechange',onFrame);player.removeEventListener('playbackchange',onPlayback);updating=true;try{player.pause();}finally{updating=false;}}
  return {setForecast,handleNativeSelection,reset,dispose,get frames(){return frames.map(frame=>({...frame}));},get forecast(){return snapshot;}};
}

export function installNativePlayer({selectComfortHour}={}){
  if(typeof document==='undefined')return null;
  const host=document.getElementById('nourie-player');if(!host)return null;
  if(host[INSTALL_KEY])return host[INSTALL_KEY];
  if(typeof selectComfortHour!=='function')throw new TypeError('Pass the app’s existing selectComfortHour binding.');
  let disposed=false,pending=globalThis.__weatherNourieForecast||null,bridge=null,player=null;
  const loading=document.createElement('p');loading.className='native-player-loading';loading.setAttribute('role','status');loading.textContent='Preparing your weather scene…';host.replaceChildren(loading);
  const onForecast=event=>{pending=event.detail;if(bridge)bridge.setForecast(pending);};
  document.addEventListener('weather-nourie:forecast',onForecast);
  const onLocationChanging=event=>{pending=null;bridge?.reset(event.detail?.location||event.detail||null);};
  const onVisibility=()=>{if(document.hidden)player?.pause();};
  document.addEventListener('weather-nourie:location-changing',onLocationChanging);document.addEventListener('visibilitychange',onVisibility);
  const hourly=document.getElementById('hourly');
  const onHourlyClick=event=>{const button=event.target?.closest?.('[data-comfort-time]');if(button&&hourly?.contains(button))bridge?.handleNativeSelection(button.dataset.comfortTime);};
  hourly?.addEventListener('click',onHourlyClick,true);
  const controller={
    ready:null,get player(){return player;},get frames(){return bridge?.frames||[];},
    setForecast(forecast){pending=forecast;bridge?.setForecast(forecast);},
    reset(location=null){pending=null;bridge?.reset(location);},
    dispose(){if(disposed)return;disposed=true;document.removeEventListener('weather-nourie:forecast',onForecast);document.removeEventListener('weather-nourie:location-changing',onLocationChanging);document.removeEventListener('visibilitychange',onVisibility);hourly?.removeEventListener('click',onHourlyClick,true);bridge?.dispose();player?.remove();if(host[INSTALL_KEY]===controller)delete host[INSTALL_KEY];}
  };
  host[INSTALL_KEY]=controller;
  controller.ready=import('./player/sky-player.js?v=people-v1').then(()=>{
    if(disposed)return null;
    player=document.createElement('weather-sky-player');player.setAttribute('data-native','');player.setAttribute('data-mode','live');
    const note=document.createElement('p');note.className='native-player-note';note.textContent='Pause to update the Shade, Sun and For Pets cards below.';
    const status=document.createElement('p');status.className='native-player-status';status.hidden=true;status.setAttribute('role','status');
    host.replaceChildren(player,note,status);
    bridge=createNativePlaybackBridge({player,selectComfortHour,onUnavailable:message=>{status.hidden=!message;status.textContent=message;}});
    if(pending)bridge.setForecast(pending);
    return player;
  }).catch(error=>{if(!disposed){loading.textContent='The weather player could not load. The forecast and comfort cards remain available.';loading.classList.add('is-error');}console.error('Weather player could not load',error);return null;});
  return controller;
}
