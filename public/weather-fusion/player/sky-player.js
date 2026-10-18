/** Nourie Weather · animated forecast scene player. All supplied text uses textContent. */
import {approvedOutfit} from './approved-weather-world.js?v=approved-her-smooth-v7';
const number = (v, fallback = 0) => v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const optionalNumber = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const boundedNumber = (v, min, max = Infinity) => { const n = optionalNumber(v); return n === null ? null : clamp(n,min,max); };
const coordinate = (value,limit) => typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=limit?value:null;
const compassPoints = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const windDegrees = value => {
  if(value===null||value===undefined||value==='')return null;
  if(typeof value==='string'){if(!value.trim()||!value.trim().replace(/°$/,'').trim())return null;const compass=compassPoints.indexOf(value.trim().toUpperCase());if(compass>=0)return compass*22.5;}
  const degrees=typeof value==='number'?value:Number(String(value).trim().replace(/°$/,''));
  return Number.isFinite(degrees)?((degrees%360)+360)%360:null;
};
export const PLAYBACK_SPEEDS = Object.freeze([1,2,4,8,16,32]);
const SPEED_STORAGE_KEY = 'nourie-weather-playback-speed';

/** Speed changes forecast sampling only. Scene animation uses real time. */
export function playbackTiming(speed = 4, frameCount = 0) {
  const normalizedSpeed = PLAYBACK_SPEEDS.includes(Number(speed)) ? Number(speed) : 4;
  const millisecondsPerHour = 2000 / normalizedSpeed;
  const hours = Math.max(0,Math.floor(number(frameCount)));
  return {speed:normalizedSpeed,millisecondsPerHour,secondsPerHour:millisecondsPerHour/1000,sweepSeconds:hours*millisecondsPerHour/1000,frameCount:hours};
}

/** A newly changed outfit gets a readable pause even at fast forecast speeds.
 * Repeated hours sharing its settled photograph do not reset this clock. */
export function playbackFrameDelay(speed=4,settledAt=null,now=globalThis.performance?.now()??Date.now()){
  const base=playbackTiming(speed).millisecondsPerHour;
  if(typeof settledAt!=='number'||!Number.isFinite(settledAt)||typeof now!=='number'||!Number.isFinite(now))return base;
  return Math.max(base,700-Math.max(0,now-settledAt));
}

/** How long playback waits before the next hour. An hour lasts its normal
 * forecast time from the moment it appears, and its photo dissolve happens inside
 * that time rather than after it, so slow speeds never stall at a change. A
 * changed photograph still stays at least 700 ms after it became the main picture. */
export function playbackAdvanceDelay(speed=4,{frameShownAt=null,settledAt=null,now=globalThis.performance?.now()??Date.now()}={}){
  const base=playbackTiming(speed).millisecondsPerHour;
  const known=value=>typeof value==='number'&&Number.isFinite(value);
  if(!known(now))return base;
  const dwell=known(frameShownAt)?Math.max(0,base-Math.max(0,now-frameShownAt)):base;
  const readable=known(settledAt)?Math.max(0,700-Math.max(0,now-settledAt)):0;
  return Math.max(dwell,readable);
}

export function outfitForFrame(frame = {}) {return approvedOutfit(frame);}

export function normalizeForecast(frames) {
  if(!Array.isArray(frames))return [];
  return frames.slice(0,336).filter(f=>f&&typeof f==='object'&&typeof f.time==='string'&&!Number.isNaN(Date.parse(f.time))&&f.temperature!==null&&f.temperature!==''&&Number.isFinite(Number(f.temperature))).map(f=>({
    time:new Date(f.time).toISOString(),sourceTime:typeof f.sourceTime==='string'&&!Number.isNaN(Date.parse(f.sourceTime))?new Date(f.sourceTime).toISOString():null,
    latitude:coordinate(f.latitude,90),longitude:coordinate(f.longitude,180),
    temperature:number(f.temperature,65),feelsLike:optionalNumber(f.feelsLike),dewpoint:optionalNumber(f.dewpoint??f.dewPoint),
    precipitationProbability:boundedNumber(f.precipitationProbability,0,100),precipitation:boundedNumber(f.precipitation,0),cloudCover:boundedNumber(f.cloudCover,0,100),
    windSpeed:boundedNumber(f.windSpeed,0),windGust:boundedNumber(f.windGust,0),windDirection:windDegrees(f.windDirection),weatherCode:optionalNumber(f.weatherCode),isDay:typeof f.isDay==='boolean'?f.isDay:null,
    ...(f.nativePolicy===true?{nativePolicy:true,nativeSampleId:f.nativeSampleId==='now'?'now':typeof f.nativeSampleId==='string'&&!Number.isNaN(Date.parse(f.nativeSampleId))?new Date(f.nativeSampleId).toISOString():null,
      nativeCondition:typeof f.nativeCondition==='string'?f.nativeCondition.slice(0,240):'',nativeWeatherKind:['clear','partly-cloudy','cloudy','rain','storm','snow','fog','unknown'].includes(f.nativeWeatherKind)?f.nativeWeatherKind:'unknown',
      nativePrecipitationActivity:['none','possible','active'].includes(f.nativePrecipitationActivity)?f.nativePrecipitationActivity:'none',nativeSnowExpected:f.nativeSnowExpected===true,
      nativeClothing:['cold','cool','mild','warm','hot'].includes(f.nativeClothing)?f.nativeClothing:null}:{} )
  }));
}
export const weatherDescription = (f,o=outfitForFrame(f)) => {
  if(f.nativePolicy===true&&f.nativeCondition)return f.isDay===false?f.nativeCondition.replace(/partly sunny/gi,'Partly cloudy').replace(/mostly sunny/gi,'Mostly clear').replace(/sunny/gi,'Clear'):f.nativeCondition;
  if(o.storm)return 'Thunderstorms';if(o.snow)return 'Snow';if(o.rain)return 'Rain';
  const code=optionalNumber(f.weatherCode),cloud=optionalNumber(f.cloudCover);
  if([45,48].includes(code))return 'Fog';
  if(code===3||(cloud!==null&&cloud>=80))return 'Overcast';
  if(code===2||(cloud!==null&&cloud>=45))return 'Partly cloudy';
  if([0,1].includes(code)||cloud!==null)return f.isDay===false?'Mostly clear night':f.isDay===true?'Mostly sunny':'Mostly clear';
  return 'Conditions unavailable';
};
const outfitKey = o => o.portrait?.available?o.portrait.wardrobe:'unavailable';
/** Actual clothing/accessory changes only, without inventing changes on stable days. */
export function outfitTransitions(frames = []) {
  const changes=[];let previous='';
  frames.forEach((frame,index)=>{const outfit=outfitForFrame(frame),key=outfitKey(outfit);if(index>0&&key!==previous)changes.push({index,time:frame.time,outfit});previous=key;});
  return changes;
}
export function createScenarioForecast(name, start = new Date(), hours = 24) {
  const presets={
    'cold-rain':{temperature:42,feelsLike:37,weatherCode:63,precipitation:.08,precipitationProbability:90,cloudCover:100,windSpeed:9,windGust:14,isDay:true},
    hot:{temperature:91,feelsLike:97,weatherCode:0,precipitation:0,precipitationProbability:0,cloudCover:10,windSpeed:5,windGust:8,isDay:true},
    cold:{temperature:31,feelsLike:24,weatherCode:2,precipitation:0,precipitationProbability:5,cloudCover:50,windSpeed:10,windGust:16,isDay:true},
    comfortable:{temperature:72,feelsLike:72,weatherCode:1,precipitation:0,precipitationProbability:0,cloudCover:22,windSpeed:6,windGust:9,isDay:true},
    night:{temperature:67,feelsLike:65,weatherCode:0,precipitation:0,precipitationProbability:0,cloudCover:10,windSpeed:4,windGust:6,isDay:false}
  };
  const preset=presets[name]||presets.comfortable;
  let stamp=new Date(start).getTime();if(!Number.isFinite(stamp))stamp=Date.now();stamp=Math.floor(stamp/3600000)*3600000;
  return Array.from({length:clamp(Math.floor(number(hours,24)),1,336)},(_,i)=>({...preset,time:new Date(stamp+i*3600000).toISOString()}));
}
const cssURL = new URL('./sky-player.css?v=approved-her-smooth-v7',import.meta.url).href;
const compactSeconds = seconds => seconds>=60?`${Math.floor(seconds/60)}m ${Math.round(seconds%60)}s`:`${Number(seconds.toFixed(seconds<1?3:1))}s`;

class WeatherSkyPlayer extends HTMLElement {
  static get observedAttributes(){return ['data-mode','location-name','timezone','playback-speed','character'];}
  constructor(){
    super();this.attachShadow({mode:'open'});
    this._forecast=[];this._index=0;this._playing=false;this._timer=null;this._speed=4;this._playbackEpoch=0;this._sceneTask=null;
    this._character='approved';
    try{this._speed=playbackTiming(globalThis.localStorage?.getItem(SPEED_STORAGE_KEY)??4).speed;}catch{}
    this._locationName='Your forecast';this._timezone='';this._world=null;this._worldPromise=null;this._worldEpoch=0;this._worldFailed=false;this._inView=false;this._connected=false;
    this.shadowRoot.innerHTML=`<link rel="stylesheet" href="${cssURL}">
    <section class="player" aria-label="Animated weather illustration and outfit forecast">
      <header class="player-heading"><div class="heading-left"><span class="mini-play" aria-hidden="true">▶</span><h2>Play your weather</h2><span class="heading-detail">Your forecast, in motion</span></div><span class="mode-badge"><span></span><span class="mode-label">Forecast preview</span></span></header>
      <div class="scene" role="group" aria-label="Forecast scene awaiting weather data">
        <div class="world-stage" aria-hidden="true"></div><div class="overlay-shade" aria-hidden="true"></div>
        <div class="world-status"><span class="world-status-title">Preparing your forecast scene…</span><span class="world-status-note">Weather, sky, and what to wear.</span><button class="world-retry" type="button" hidden>Retry forecast scene</button></div>
        <div class="scene-top"><div class="frame-time"><span class="frame-day">YOUR DAY, HOUR BY HOUR</span><strong class="frame-hour">—</strong></div><span class="scene-status">FORECAST VIEW</span></div>
        <div class="scene-weather"><div class="temperature-line"><strong class="frame-temp">—</strong><span>°</span></div><p class="frame-condition">Weather in motion</p><span class="frame-feels">Choose a location to begin</span></div>
        <div class="location-tag"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="1.6"/></svg><span class="location-name"></span></div>
        <div class="outfit-bubble"><div class="outfit-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m8 4-5 3 2 5 3-1v9h8v-9l3 1 2-5-5-3c-1 3-7 3-8 0Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></div><div><span class="outfit-kicker">WHAT TO WEAR</span><p class="outfit-summary">Your outfit follows the weather.</p></div></div>
        <div class="empty-state" hidden><span>Let's step outside.</span><p>Choose a location to see the sky, the conditions, and what to wear.</p></div>
      </div>
      <div class="controls"><div class="playback-row"><div class="transport"><button class="play" type="button" aria-label="Play forecast animation"><svg class="play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z" fill="currentColor"/></svg><svg class="pause-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm7 0h4v14h-4z" fill="currentColor"/></svg><span class="play-word">Play forecast</span></button><button class="previous icon-button" type="button" aria-label="Previous forecast hour"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="next icon-button" type="button" aria-label="Next forecast hour"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div><div class="speed-group"><label class="speed-label"><span>Speed</span><select class="speed" aria-label="Forecast playback speed">${PLAYBACK_SPEEDS.map(speed=>`<option value="${speed}">${speed}×</option>`).join('')}</select></label><span class="playback-timing"></span></div></div>
      <div class="timeline-row"><button class="previous-day day-button" type="button" aria-label="Skip back 24 forecast hours">−24h</button><div class="timeline"><div class="range-wrap"><div class="outfit-markers" aria-label="Outfit change markers"></div><input class="scrubber" type="range" min="0" max="0" value="0" step="1" aria-label="Forecast time"></div><div class="timeline-labels"><span class="start-label">Now</span><span class="middle-label"></span><span class="end-label"></span></div></div><button class="next-day day-button" type="button" aria-label="Skip forward 24 forecast hours">+24h</button></div>
      <div class="timeline-caption"><span class="outfit-changes-note"></span><span class="frame-count"></span></div></div>
      <footer class="player-footer"><span class="advice-icon" aria-hidden="true">✦</span><p class="outfit-advice">Outfit guidance follows the forecast. Personal comfort varies.</p></footer><span class="sr-only announcement" role="status" aria-live="polite"></span>
    </section>`;
    this.$=selector=>this.shadowRoot.querySelector(selector);
    this.$('.play').addEventListener('click',()=>this._playing?this.pause():this.play());
    this.$('.previous').addEventListener('click',()=>this.seekFrame(this._index-1));this.$('.next').addEventListener('click',()=>this.seekFrame(this._index+1));
    this.$('.previous-day').addEventListener('click',()=>this.skipDays(-1));this.$('.next-day').addEventListener('click',()=>this.skipDays(1));
    this.$('.scrubber').addEventListener('input',event=>this.seekFrame(Number(event.target.value)));
    this.$('.speed').addEventListener('change',event=>{this.speed=Number(event.target.value);});
    this.$('.world-retry').addEventListener('click',()=>{this._worldFailed=false;this._disposeWorld();this._ensureWorld();});
    this.$('.speed').value=String(this._speed);
    this._renderPeople();
  }
  connectedCallback(){
    this._connected=true;this._worldFailed=false;this._locationName=this.getAttribute('location-name')||this._locationName;this.timezone=this.getAttribute('timezone')||this._timezone;
    const attrSpeed=this.getAttribute('playback-speed');if(attrSpeed!==null)this.speed=attrSpeed;
    this._render();this._renderTimeline();
    if(typeof IntersectionObserver==='function'){
      this._intersection?.disconnect();this._intersection=new IntersectionObserver(entries=>{this._inView=entries.some(entry=>entry.isIntersecting);if(this._inView)this._ensureWorld();},{rootMargin:'350px'});this._intersection.observe(this);
    }else{this._inView=true;this._ensureWorld();}
    if(typeof ResizeObserver==='function'){this._resizeObserver?.disconnect();this._resizeObserver=new ResizeObserver(()=>{this._world?.resize?.();});this._resizeObserver.observe(this.$('.world-stage'));}
  }
  disconnectedCallback(){this._connected=false;this.pause();this._intersection?.disconnect();this._intersection=null;this._resizeObserver?.disconnect();this._resizeObserver=null;this._disposeWorld();}
  attributeChangedCallback(name,oldValue,newValue){if(oldValue===newValue||!this.$)return;if(name==='location-name')this.locationName=newValue;if(name==='timezone')this.timezone=newValue;if(name==='data-mode')this._renderMode();if(name==='playback-speed')this.speed=newValue;if(name==='character')this.character=newValue;}
  get character(){return 'approved';}
  set character(value){this._character='approved';}
  _renderPeople(){}
  _outfitFor(frame){return outfitForFrame(frame);}
  get forecast(){return this._forecast.map(frame=>({...frame}));}
  set forecast(value){this._forecast=normalizeForecast(value);this._index=clamp(this._index,0,Math.max(0,this._forecast.length-1));if(!this._forecast.length)this.pause();this._renderTimeline();this._render();}
  get locationName(){return this._locationName;}
  set locationName(value){this._locationName=String(value||'Your forecast').slice(0,120);if(this.$)this.$('.location-name').textContent=this._locationName;}
  get timezone(){return this._timezone;}
  set timezone(value){try{new Intl.DateTimeFormat('en-US',{timeZone:String(value)}).format();this._timezone=String(value);}catch{this._timezone='';}if(this.$){this._renderTimeline();this._render();}}
  get speed(){return this._speed;}
  set speed(value){this._speed=playbackTiming(value).speed;try{globalThis.localStorage?.setItem(SPEED_STORAGE_KEY,String(this._speed));}catch{}this._world?.setSpeed?.(this._speed);if(this.$){this.$('.speed').value=String(this._speed);this._renderTiming();}if(this._playing)this._startTimer();}
  get currentFrame(){return this._forecast[this._index]||null;}
  get playing(){return this._playing;}
  setFrame(index){
    if(!this._forecast.length)return;
    this._index=((Math.trunc(number(index))%this._forecast.length)+this._forecast.length)%this._forecast.length;
    this._render();
    this.dispatchEvent(new CustomEvent('framechange',{detail:{index:this._index,frame:{...this.currentFrame},outfit:this._outfitFor(this.currentFrame)},bubbles:true,composed:true}));
    return this._sceneTask;
  }
  seekFrame(index){this.setFrame(index);this.pause();}
  skipDays(days){if(!this.currentFrame)return;const target=Date.parse(this.currentFrame.time)+number(days)*86400000;let nearest=0;let distance=Infinity;this._forecast.forEach((frame,index)=>{const delta=Math.abs(Date.parse(frame.time)-target);if(delta<distance){distance=delta;nearest=index;}});this.seekFrame(nearest);}
  play(){if(!this._forecast.length)return;const wasPlaying=this._playing;this._playing=true;this.$('.player').classList.add('playing');this.$('.play').setAttribute('aria-label','Pause forecast animation');this.$('.play-word').textContent='Pause forecast';this._ensureWorld();this._world?.setPlaying(true);this._startTimer();if(!wasPlaying)this.dispatchEvent(new CustomEvent('playbackchange',{detail:{playing:true},bubbles:true,composed:true}));}
  pause(){const wasPlaying=this._playing;this._playing=false;this._playbackEpoch=(this._playbackEpoch||0)+1;clearTimeout(this._timer);this._timer=null;if(this.$){this.$('.player').classList.remove('playing');this.$('.play').setAttribute('aria-label','Play forecast animation');this.$('.play-word').textContent='Play forecast';}this._world?.setPlaying(false);if(wasPlaying)this.dispatchEvent(new CustomEvent('playbackchange',{detail:{playing:false},bubbles:true,composed:true}));}
  async _awaitScene(){
    if(this._worldPromise)await this._worldPromise;
    let pending;
    do{pending=this._sceneTask;if(pending)await pending;}while(pending!==this._sceneTask);
  }
  _startTimer(){
    clearTimeout(this._timer);this._timer=null;
    const epoch=this._playbackEpoch=(this._playbackEpoch||0)+1;
    const active=()=>this._playing&&epoch===this._playbackEpoch&&this._forecast.length>0;
    const clock=()=>globalThis.performance?.now()??Date.now();
    const schedule=async()=>{
      // The hour's forecast time starts when it appears, so its photo dissolve
      // runs inside the hour. Even the fastest forecast speed still lets the
      // selected scene finish before advancing.
      const frameShownAt=clock();
      await this._awaitScene();
      if(!active())return;
      this._timer=setTimeout(async()=>{
        this._timer=null;if(!active())return;
        await this._awaitScene();if(!active())return;
        this.setFrame(this._index+1);void schedule();
      },playbackAdvanceDelay(this._speed,{frameShownAt,settledAt:this._world?.lastPhotoSettledAt,now:clock()}));
    };
    void schedule();
  }
  _format(time,options){return new Intl.DateTimeFormat('en-US',{...options,...(this._timezone?{timeZone:this._timezone}:{})}).format(new Date(time));}
  _renderMode(){const mode=this.getAttribute('data-mode');this.$('.mode-label').textContent=mode==='demo'||mode==='sample'?'Sample weather':mode==='live'?'Live forecast':'Forecast preview';this.$('.mode-badge').classList.toggle('is-sample',mode==='demo'||mode==='sample');}
  _renderTiming(){const timing=playbackTiming(this._speed,this._forecast.length);this.$('.playback-timing').textContent=`${compactSeconds(timing.secondsPerHour)} / hour + scene transitions`;}
  _renderTimeline(){
    if(!this.$)return;const frames=this._forecast;this._renderTiming();const markers=this.$('.outfit-markers');markers.replaceChildren();
    if(!frames.length){this.$('.outfit-changes-note').textContent='';return;}
    const changes=outfitTransitions(frames);
    this.$('.outfit-changes-note').textContent=changes.length?`${changes.length} outfit ${changes.length===1?'change':'changes'} · tap a marker to jump`:'Same attire throughout this forecast — conditions stay within one clothing range.';
    changes.forEach((change,index)=>{if(index>=64)return;const marker=document.createElement('button');marker.type='button';marker.className='outfit-marker';marker.style.left=`${change.index/Math.max(1,frames.length-1)*100}%`;const label=`${this._format(change.time,{weekday:'short',hour:'numeric'})}: ${change.outfit.label}`;marker.title=label;marker.setAttribute('aria-label',`Outfit changes at ${label}`);marker.addEventListener('click',()=>this.seekFrame(change.index));markers.append(marker);});
  }
  _render(){
    if(!this.$)return;this.$('.location-name').textContent=this._locationName;this._renderMode();
    const frames=this._forecast,frame=frames[this._index],empty=!frame;this.$('.empty-state').hidden=!empty;this.$('.player').classList.toggle('is-empty',empty);
    this.shadowRoot.querySelectorAll('.controls button,.controls input,.controls select').forEach(element=>element.disabled=empty);
    if(empty){this._world?.setFrame({});this.$('.frame-count').textContent='';this.$('.scene').setAttribute('aria-label','Forecast scene awaiting hourly weather data');if(this.hasAttribute('data-native')){this.$('.empty-state>span').textContent='Your forecast scene is on its way.';this.$('.empty-state p').textContent='The scene will appear when hourly temperature data is available.';}return;}
    const outfit=this._outfitFor(frame),description=weatherDescription(frame,outfit),scene=this.$('.scene');
    scene.dataset.garment=outfit.garment;scene.classList.toggle('is-storm',outfit.storm);
    scene.setAttribute('aria-label',`${this._locationName}, ${this._format(frame.time,{weekday:'long',hour:'numeric',minute:'2-digit'})}. ${Math.round(frame.temperature)} degrees Fahrenheit, ${description.toLowerCase()}. ${outfit.advice}`);
    this.$('.frame-day').textContent=this._format(frame.time,{weekday:'short',month:'short',day:'numeric'});this.$('.frame-hour').textContent=this._format(frame.time,{hour:'numeric',minute:'2-digit'});
    this.$('.frame-temp').textContent=String(Math.round(frame.temperature));this._swapText('.frame-condition',description);
    this.$('.frame-feels').textContent=`${frame.feelsLike===null?'Feels like unavailable':`Feels like ${Math.round(frame.feelsLike)}°`} · ${frame.windSpeed===null?'Wind unavailable':`${Math.round(frame.windSpeed)} mph wind`}`;
    this.$('.outfit-kicker').textContent=frame.feelsLike===null?'TEMPERATURE-BASED OUTFIT':'WHAT TO WEAR';this._swapText('.outfit-summary',outfit.storm?'Stay indoors until the storm passes.':outfit.label);this.$('.outfit-advice').textContent=outfit.advice;
    this.$('.scene-status').textContent=outfit.storm?'SEEK SHELTER':frame.isDay===null?'LIGHTING UNAVAILABLE':frame.isDay===false?'AFTER DARK':'DAYLIGHT';
    const range=this.$('.scrubber');range.max=String(frames.length-1);range.value=String(this._index);range.style.setProperty('--progress',`${frames.length>1?this._index/(frames.length-1)*100:0}%`);range.setAttribute('aria-valuetext',`${this._format(frame.time,{weekday:'short',hour:'numeric',minute:'2-digit'})}, ${Math.round(frame.temperature)} degrees, ${description}`);
    this.$('.start-label').textContent=this._format(frames[0].time,{weekday:'short',hour:'numeric'});this.$('.middle-label').textContent=frames.length>2?this._format(frames[Math.floor((frames.length-1)/2)].time,{weekday:'short',hour:'numeric'}):'';this.$('.end-label').textContent=frames.length>1?this._format(frames[frames.length-1].time,{weekday:'short',hour:'numeric'}):'';
    this.$('.frame-count').textContent=`HOUR ${this._index+1} OF ${frames.length}`;
    if(!this._playing)this.$('.announcement').textContent=`${this._format(frame.time,{hour:'numeric'})}. ${description}, ${Math.round(frame.temperature)} degrees. ${outfit.label}.`;
    this._syncWorld();if(this._inView&&this._connected)this._ensureWorld();
  }
  /** Weather and outfit words fade in with the photograph instead of snapping. */
  _swapText(selector,text){
    const element=this.$(selector);if(!element)return;
    const value=String(text);if(element.textContent===value)return;
    element.textContent=value;
    if(typeof element.animate==='function'&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
      element.animate([{opacity:.15},{opacity:1}],{duration:480,easing:'cubic-bezier(.37,0,.63,1)'});
    }
  }
  _syncWorld(){if(this._world&&this.currentFrame){try{const frame={...this.currentFrame};if(this._timezone){const parts=new Intl.DateTimeFormat('en-US',{timeZone:this._timezone,hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(new Date(frame.time));frame.localHour=Number(parts.find(p=>p.type==='hour')?.value||0)+Number(parts.find(p=>p.type==='minute')?.value||0)/60;}this._sceneTask=Promise.resolve(this._world.setFrame(frame,this._outfitFor(frame))).catch(error=>{this._handleWorldError(error);return false;});this._world.preload?.(this._forecast.slice(this._index+1));}catch(error){this._handleWorldError(error);}}}
  async _ensureWorld(){
    if(!this._connected||this._world||this._worldPromise||this._worldFailed)return;
    const epoch=++this._worldEpoch;this.$('.world-status').hidden=false;this.$('.world-status').classList.remove('has-error');this.$('.world-status-title').textContent='Preparing your forecast scene…';this.$('.world-status-note').textContent='Weather, sky, and what to wear.';this.$('.world-retry').hidden=true;
    this._worldPromise=(async()=>{
      const {createWeatherWorld}=await import('./approved-weather-world.js?v=approved-her-smooth-v7');
      if(!this._connected||epoch!==this._worldEpoch)return;
      const world=await createWeatherWorld(this.$('.world-stage'),{initialFrame:this.currentFrame||{},initialOutfit:this._outfitFor(this.currentFrame||{}),initialCharacter:this._character,onError:error=>{if(epoch===this._worldEpoch)this._handleWorldError(error);}});
      if(!this._connected||epoch!==this._worldEpoch||this._worldFailed){world?.dispose?.();return;}
      this._world=world;world.setCharacter?.(this._character);world.setSpeed?.(this._speed);this._syncWorld();if(this._worldFailed)return;world.setPlaying(this._playing);world.resize?.();this.$('.world-status').hidden=true;
      this.dispatchEvent(new CustomEvent('worldready',{bubbles:true,composed:true}));
    })().catch(error=>{if(epoch===this._worldEpoch)this._handleWorldError(error);}).finally(()=>{if(epoch===this._worldEpoch)this._worldPromise=null;});
    return this._worldPromise;
  }
  _handleWorldError(error){
    this._worldFailed=true;this._world?.dispose?.();this._world=null;this.$('.world-status').hidden=false;this.$('.world-status').classList.add('has-error');this.$('.world-status-title').textContent='The forecast scene could not load.';this.$('.world-status-note').textContent='The forecast still works. Try loading the scene again.';this.$('.world-retry').hidden=false;
    this.dispatchEvent(new CustomEvent('worlderror',{detail:{message:error?.message||'Forecast scene unavailable'},bubbles:true,composed:true}));
  }
  _disposeWorld(){this._worldEpoch++;this._worldPromise=null;this._world?.dispose?.();this._world=null;this._sceneTask=null;this.$('.world-stage').replaceChildren();}
}
if(!customElements.get('weather-sky-player'))customElements.define('weather-sky-player',WeatherSkyPlayer);
export {WeatherSkyPlayer};
