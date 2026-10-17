/* The Atmos sky and the main page's people share one selected hourly sample.
 * This module changes the presentation clock, never forecast values or art. */
import {buildTimeline,skyScene} from './atmos-model.js?v=atmos-v1';
import {createSky} from './atmos-sky.js?v=atmos-v1';
import {precipitationActivity} from './exposure-scene.js?v=current-rain-20261017-v3';
import {selectComfortHour} from './experience.js?v=forecast-studio-v1';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
const degrees=value=>finite(value)?`${Math.round(value)}°`:'—';
const samePlace=(a,b)=>a&&b&&a.latitude===b.latitude&&a.longitude===b.longitude;

/** Reuse the people’s precipitation rule: a closed umbrella represents a
 * possibility, so that sky shows clouds rather than rain falling on the viewer. */
export function playbackSkyState(step){
 if(!step)return null;
 const kind=step.rainNow&&!['rain','storm','snow'].includes(step.kind)?'rain':step.kind;
 const scene=skyScene({...step,kind});
 const precipitation=precipitationActivity(step.condition,{pop:step.rain,rainExpected:step.rainNow===true});
 if(precipitation!=='active'){
  scene.rain=0;
  scene.storm=false;
 }
 return {time:step.time,scene};
}

/** A discrete clock keeps the sky, hourly border and complete people images on
 * the same published hour, including the jump from daytime into nighttime. */
export function createPlaybackClock({onSelect=()=>{},onState=()=>{},schedule=setTimeout,cancel=clearTimeout,interval=900}={}){
 let steps=[],selected=-1,playing=false,timer=null,destroyed=false;
 const state=()=>({selected,playing,length:steps.length,step:steps[selected]||null});
 const notify=()=>onState(state());
 function clear(){if(timer!==null){cancel(timer);timer=null;}}
 function pause(){clear();const wasPlaying=playing;playing=false;if(wasPlaying)notify();}
 function select(index,{fromPlay=false,notifySelection=true}={}){
  if(destroyed||!steps.length)return false;
  if(!fromPlay)pause();
  const next=clamp(Math.round(Number(index)||0),0,steps.length-1),changed=next!==selected;
  selected=next;
  if(changed&&notifySelection)onSelect(steps[selected],selected);
  notify();
  return changed;
 }
 function tick(){
  timer=null;
  if(!playing||destroyed)return;
  select(selected+1,{fromPlay:true});
  if(selected>=steps.length-1){pause();return;}
  timer=schedule(tick,interval);
 }
 function play(){
  if(destroyed||playing||steps.length<2)return;
  if(selected>=steps.length-1)select(0);
  playing=true;notify();timer=schedule(tick,interval);
 }
 function setSteps(next,{keepTime=null,preservePlaying=false}={}){
  const resume=preservePlaying&&playing;
  pause();steps=Array.isArray(next)?next:[];
  const keep=keepTime===null?-1:steps.findIndex(step=>step.id===keepTime||step.time===keepTime);
  selected=steps.length?(keep>=0?keep:0):-1;
  notify();
  if(resume&&selected<steps.length-1)play();
 }
 function selectTime(time,{notifySelection=true}={}){
  const index=steps.findIndex(step=>time==='now'?step.isNow:step.id===time||step.time===time);
  return index>=0?select(index,{notifySelection}):false;
 }
 return {state,select,selectTime,setSteps,play,pause,toggle:()=>playing?pause():play(),
  destroy(){pause();destroyed=true;steps=[];selected=-1;}};
}

const playIcon='<svg class="weather-playback-play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const pauseIcon='<svg class="weather-playback-pause-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13M16 5.5v13"/></svg>';

export function installWeatherPlayback({root=document.getElementById('weather-playback-panel')}={}){
 if(!root||root.__weatherPlayback)return root?.__weatherPlayback||null;
 root.hidden=true;
 root.innerHTML=`<header class="weather-playback-header"><h2>Watch the weather</h2><span data-playback-range></span></header>
  <div class="weather-playback-view"><canvas data-playback-sky aria-hidden="true"></canvas><div class="weather-playback-caption"><p data-playback-time></p><strong data-playback-condition></strong></div></div>
  <div class="weather-playback-controls"><button type="button" class="weather-playback-toggle" data-playback-toggle aria-label="Play weather" aria-pressed="false">${playIcon}${pauseIcon}</button><label class="weather-playback-slider"><span class="sr-only">Preview forecast hour</span><input data-playback-hour type="range" min="0" max="0" step="1" value="0" aria-label="Preview forecast hour"></label><button type="button" class="weather-playback-now" data-playback-now>Now</button></div>
  <div class="weather-playback-readings"><span data-playback-air></span><span data-playback-feels></span><span data-playback-rain hidden></span></div>
  <p class="weather-playback-note">Sky preview, not a live camera. The people below show this same hour.</p>`;
 const find=selector=>root.querySelector(selector),canvas=find('[data-playback-sky]');
 const motion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
 let forecast=null,place=null,sky=null,inView=true,resizeFrame=0,selecting=false;
 try{sky=createSky(canvas,{reducedMotion:!!motion?.matches,ground:'#112432'});}catch{
  canvas.hidden=true;root.classList.add('weather-playback-no-canvas');
 }
 function motionState(){
  if(!sky)return;
  if(document.hidden||!inView||motion?.matches||!clock.state().length)sky.stop();
  else sky.start();
 }
 function draw(state){
  const {step,selected,playing,length}=state;
  root.hidden=!step;
  const toggle=find('[data-playback-toggle]');
  toggle.disabled=length<2;toggle.setAttribute('aria-pressed',String(playing));
  toggle.setAttribute('aria-label',playing?'Pause weather':'Play weather');
  root.dataset.playing=String(playing);
  if(!step){sky?.stop();return;}
  const zone=forecast?.location?.timeZone||'America/New_York';
  const when=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(step.time));
  const time=find('[data-playback-time]');
  time.setAttribute('aria-live',playing?'off':'polite');time.textContent=`${step.isNow?'Now · ':''}${when}`;
  find('[data-playback-condition]').textContent=step.condition;
  const slider=find('[data-playback-hour]');slider.max=String(Math.max(0,length-1));slider.value=String(selected);
  slider.setAttribute('aria-valuetext',`${step.isNow?'Now, ':''}${when}, ${step.condition}, air ${degrees(step.temperature)}, feels like ${degrees(step.feels)}`);
  find('[data-playback-now]').disabled=step.isNow;
  find('[data-playback-air]').textContent=`Air ${degrees(step.temperature)}`;
  find('[data-playback-feels]').textContent=`Feels ${degrees(step.feels)}`;
  const rain=find('[data-playback-rain]');rain.hidden=!finite(step.rainShown);
  rain.textContent=finite(step.rainShown)?`${Math.round(step.rainShown)}% rain chance`:'';
  if(step.isNow&&step.rainNow){rain.hidden=false;rain.textContent=step.rainNote||'Rain now';}
  root.dataset.time=step.isNow?'now':step.id;root.dataset.weather=step.kind;root.dataset.daylight=String(step.isDay);
  const stateForSky=playbackSkyState(step);
  sky?.setState(stateForSky);sky?.setTimeScale(playing?18:1);
  const approximate=!finite(step.skyCover);
  canvas.title=approximate?'Illustrative sky; cloud coverage follows the hourly forecast wording.':'Illustrative sky; cloud coverage follows the hourly cloud forecast.';
  sky?.render();motionState();
 }
 const clock=createPlaybackClock({
  interval:motion?.matches?1400:900,
  onSelect(step){selecting=true;try{selectComfortHour(step.isNow?'now':step.id);}finally{selecting=false;}},
  onState:draw,
 });
 function resize(){
  cancelAnimationFrame(resizeFrame);
  resizeFrame=requestAnimationFrame(()=>{sky?.resize();sky?.setHorizon(canvas.getBoundingClientRect().height*.88);});
 }
 function update(next){
  if(!next?.location||!Array.isArray(next.hours)){reset();return;}
  const prior=clock.state().step;
  const continuing=samePlace(place,next.location);
  const keepTime=continuing&&prior&&!prior.isNow?prior.id:null;
  forecast=next;place={latitude:next.location.latitude,longitude:next.location.longitude};
  let steps=[];
  try{steps=buildTimeline(next,Date.now());}catch{reset();return;}
  const first=steps[0],last=steps.at(-1),hours=first&&last?Math.round((last.time-first.time)/3600000):0;
  find('[data-playback-range]').textContent=hours>0?`Next ${hours} hours`:'';
  sky?.setLocation(place.latitude,place.longitude);clock.setSteps(steps,{keepTime,preservePlaying:continuing});resize();
 }
 function reset(){forecast=null;place=null;clock.setSteps([]);root.hidden=true;sky?.stop();}
 function onForecast(event){update(event.detail);}
 function onHour(event){
  if(selecting)return;
  const time=event.detail?.time??event.detail?.id??event.detail;
  const step=clock.state().step;
  if(step&&(time===(step.isNow?'now':step.id)))return;
  clock.selectTime(time,{notifySelection:false});
 }
 function onVisibility(){if(document.hidden)clock.pause();motionState();}
 function onMotion(event){clock.pause();if(sky)sky.reducedMotion=event.matches;motionState();}
 function onClick(event){if(event.target.closest('[data-playback-toggle]'))clock.toggle();if(event.target.closest('[data-playback-now]'))clock.selectTime('now');}
 function onInput(event){if(event.target.matches('[data-playback-hour]'))clock.select(Number(event.target.value));}
 root.addEventListener('click',onClick);root.addEventListener('input',onInput);
 document.addEventListener('weather-nourie:forecast',onForecast);document.addEventListener('weather-nourie:hour',onHour);document.addEventListener('weather-nourie:reset',reset);
 document.addEventListener('visibilitychange',onVisibility);window.addEventListener('resize',resize);motion?.addEventListener?.('change',onMotion);
 const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{inView=entries[0]?.isIntersecting!==false;motionState();},{rootMargin:'80px'}):null;
 observer?.observe(root);
 const controller={update,reset,clock,destroy(){clock.destroy();sky?.stop();cancelAnimationFrame(resizeFrame);observer?.disconnect();root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);document.removeEventListener('weather-nourie:forecast',onForecast);document.removeEventListener('weather-nourie:hour',onHour);document.removeEventListener('weather-nourie:reset',reset);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('resize',resize);motion?.removeEventListener?.('change',onMotion);delete root.__weatherPlayback;}};
 root.__weatherPlayback=controller;
 if(globalThis.__weatherNourieForecast)update(globalThis.__weatherNourieForecast);
 return controller;
}
