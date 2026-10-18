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
const validCoordinate=(value,limit)=>finite(value)&&Math.abs(value)<=limit?value:null;
const compassPoints=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const windDegrees=value=>{
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='string'){
    if(!value.trim()||!value.trim().replace(/°$/,'').trim())return null;
    const compass=compassPoints.indexOf(value.trim().toUpperCase());if(compass>=0)return compass*22.5;
  }
  const degrees=typeof value==='number'?value:Number(String(value).trim().replace(/°$/,''));
  return Number.isFinite(degrees)?((degrees%360)+360)%360:null;
};

/** Adapts an already validated native sample, keeping probability and amount separate. */
export function nativeFrameForSample(forecast,sample,now=Date.now()){
  if(!sample||!finite(sample.temperature)||epoch(sample.time)===null)return null;
  const context=comfortArtworkContext(forecast,sample,now);
  const selectedTime=sample.now&&finite(now)?now:epoch(sample.time);
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
    // 'Now' follows the current instant for the sun/moon. Keep the weather
    // source timestamp separately; a station or model hour can be older.
    time:new Date(selectedTime).toISOString(),sourceTime:new Date(epoch(sample.time)).toISOString(),
    latitude:validCoordinate(forecast?.location?.latitude,90),longitude:validCoordinate(forecast?.location?.longitude,180),
    temperature:sample.temperature,feelsLike:known(sample.feels),dewpoint:known(sample.inputs?.dewpoint),
    precipitationProbability:known(sample.pop),precipitation:amount,cloudCover:sky,
    windSpeed:known(sample.inputs?.wind),windGust:known(sample.inputs?.gust),
    windDirection:windDegrees(sample.windDirection??sample.inputs?.windDirection??hour?.windDirectionDegrees??hour?.windDirection),weatherCode:wmoForKind[kind]??null,
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

/** Keep the scene opt-in: a closed tab neither loads the player nor owns a renderer. */
export function installNativePlayer({selectComfortHour,loadPlayer=()=>import('./player/sky-player.js?v=approved-her-smooth-v7')}={}){
  if(typeof document==='undefined')return null;
  const host=document.getElementById('nourie-player');if(!host)return null;
  if(host[INSTALL_KEY])return host[INSTALL_KEY];
  if(typeof selectComfortHour!=='function')throw new TypeError('Pass the app’s existing selectComfortHour binding.');
  const button=document.getElementById('open-native-player');
  let disposed=false,isOpen=false,pending=globalThis.__weatherNourieForecast||null,bridge=null,player=null,modulePromise=null,pendingSelection=null,syncVersion=0;
  const loading=document.createElement('p');loading.className='native-player-loading';loading.setAttribute('role','status');
  const note=document.createElement('p');note.className='native-player-note';note.textContent='Pause to update the Shade, Sun and For Pets cards below.';
  const status=document.createElement('p');status.className='native-player-status';status.hidden=true;status.setAttribute('role','status');
  // A bookmark or a remembered scroll position must never open the scene.
  host.hidden=true;host.replaceChildren();button?.setAttribute('aria-expanded','false');
  function applyPending(){
    if(!bridge||!pending)return;
    const request=++syncVersion;bridge.setForecast(pending);
    const selection=pendingSelection;
    if(selection)queueMicrotask(()=>{if(!disposed&&isOpen&&request===syncVersion&&pendingSelection===selection){bridge.handleNativeSelection(selection);pendingSelection=null;}});
  }
  const onForecast=event=>{pending=event.detail;if(isOpen)applyPending();};
  const onLocationChanging=event=>{++syncVersion;pending=null;pendingSelection=null;bridge?.reset(event.detail?.location||event.detail||null);};
  const onVisibility=()=>{if(document.hidden)player?.pause();};
  document.addEventListener('weather-nourie:forecast',onForecast);document.addEventListener('weather-nourie:location-changing',onLocationChanging);document.addEventListener('visibilitychange',onVisibility);
  const hourly=document.getElementById('hourly');
  const onHourlyClick=event=>{
    const selected=event.target?.closest?.('[data-comfort-time]');
    if(!selected||!hourly?.contains(selected))return;
    if(isOpen&&bridge)bridge.handleNativeSelection(selected.dataset.comfortTime);
    else pendingSelection=selected.dataset.comfortTime;
  };
  hourly?.addEventListener('click',onHourlyClick,true);
  async function ensurePlayer(){
    try{
      if(!player){
        modulePromise??=loadPlayer();await modulePromise;
        if(disposed||!isOpen)return null;
        if(!player){
          player=document.createElement('weather-sky-player');player.setAttribute('data-native','');player.setAttribute('data-mode','live');
          bridge=createNativePlaybackBridge({player,selectComfortHour,onUnavailable:message=>{status.hidden=!message;status.textContent=message;}});
        }
      }
      if(disposed||!isOpen)return null;
      // Reattach the same element, retaining the selected person and hour. Its
      // connected callback creates a fresh world after close disposed the GPU.
      host.replaceChildren(player,note,status);applyPending();return player;
    }catch(error){
      modulePromise=null;
      if(!disposed&&isOpen){loading.textContent='The weather player could not load. Close and reopen this tab to retry.';loading.classList.add('is-error');}
      console.error('Weather player could not load',error);return null;
    }
  }
  const onToggle=()=>{void controller.toggle();};
  const controller={
    ready:null,get isOpen(){return isOpen;},get player(){return player;},get frames(){return bridge?.frames||[];},
    open(){
      if(disposed)return Promise.resolve(null);
      isOpen=true;host.hidden=false;button?.setAttribute('aria-expanded','true');
      if(!player){loading.classList.remove('is-error');loading.textContent='Preparing your weather scene…';host.replaceChildren(loading);}
      controller.ready=ensurePlayer();
      host.scrollIntoView?.({behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
      return controller.ready;
    },
    close(){
      if(disposed)return;
      ++syncVersion;isOpen=false;host.hidden=true;button?.setAttribute('aria-expanded','false');
      // Detaching calls disconnectedCallback, stopping ambient animation and
      // disposing textures/renderers as well as pausing forecast playback.
      player?.pause();player?.remove();
    },
    toggle(){if(isOpen){controller.close();return Promise.resolve(null);}return controller.open();},
    setForecast(forecast){pending=forecast;if(isOpen)applyPending();},
    reset(location=null){++syncVersion;pending=null;pendingSelection=null;bridge?.reset(location);},
    dispose(){if(disposed)return;controller.close();disposed=true;document.removeEventListener('weather-nourie:forecast',onForecast);document.removeEventListener('weather-nourie:location-changing',onLocationChanging);document.removeEventListener('visibilitychange',onVisibility);hourly?.removeEventListener('click',onHourlyClick,true);button?.removeEventListener('click',onToggle);bridge?.dispose();player?.remove();if(host[INSTALL_KEY]===controller)delete host[INSTALL_KEY];}
  };
  button?.addEventListener('click',onToggle);host[INSTALL_KEY]=controller;
  return controller;
}
