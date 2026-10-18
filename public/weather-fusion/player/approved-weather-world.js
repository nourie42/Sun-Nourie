/** The user's approved complete photographs, not the retired character atlases.
 * Forecast values remain owned by native-player.js. No weather is fetched here. */
import {selectWeatherPortrait} from './approved-portrait-selection.js?v=approved-her-smooth-v7';
import {solarElevation} from '../weather-math.js?v=current-rain-20261017-v3';
export const APPROVED_PLAYER_VERSION='approved-her-smooth-v7';
// The photographs themselves are unchanged, so their URLs keep their own version
// and returning visitors do not download every weather picture again.
export const PHOTO_ASSET_VERSION='approved-her-consistent-v6';
// A change of weather or clothes dissolves into the next photograph with a gentle
// start and finish. Playback dissolves are long; at faster forecast speeds they are
// shorter so a day still plays briskly. Manual steps stay quick and responsive.
export const PLAY_DISSOLVE_MS=Object.freeze({1:1200,2:1050,4:900,8:760,16:640,32:560});
export const STEP_DISSOLVE_MS=420;
export const DISSOLVE_EASING='cubic-bezier(.37,0,.63,1)';
export function photoDissolveMs({playing=false,speed=4}={}){return playing?PLAY_DISSOLVE_MS[Number(speed)]??PLAY_DISSOLVE_MS[4]:STEP_DISSOLVE_MS;}
// When a newer hour arrives before a dissolve finishes, a photograph that has barely
// started (under 5% visible) can be dropped without a visible jump; anything more is
// held exactly as visible as it is until the newer photograph covers it.
export const HOLD_FROM_OPACITY=0.05;
export function supersededPhotoAction(opacity){return Number.isFinite(opacity)&&opacity>=HOLD_FROM_OPACITY?'hold':'drop';}
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const WMO={0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Fog',51:'Drizzle',53:'Drizzle',55:'Drizzle',56:'Freezing drizzle',57:'Freezing drizzle',61:'Rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',71:'Snow',73:'Snow',75:'Heavy snow',77:'Snow',80:'Rain showers',81:'Rain showers',82:'Heavy rain',85:'Snow showers',86:'Heavy snow',95:'Thunderstorms',96:'Thunderstorms with hail',99:'Thunderstorms with hail'};
export function approvedState(frame={}){
 const condition=frame.nativePolicy===true?frame.nativeCondition||'Conditions unavailable':WMO[frame.weatherCode]||frame.condition||'Conditions unavailable';
 const row={condition,temperature:frame.temperature,feels:frame.feelsLike,isDay:frame.isDay,time:frame.time,skyCover:frame.cloudCover,snowExpected:frame.nativeSnowExpected===true};
 const options={};
 // Use the selected location and forecast instant, never the phone's clock.
 const t=Date.parse(frame.time);
 if(finite(t)&&finite(frame.latitude)&&finite(frame.longitude)){
  const e=solarElevation(t,frame.latitude,frame.longitude),later=solarElevation(t+15*60000,frame.latitude,frame.longitude);
  // solarElevation returns radians; twilight spans 4.5 degrees from the horizon.
  if(finite(e)&&finite(later)&&Math.abs(e)<=4.5*Math.PI/180)options.solar=[{[later>e?'sunrise':'sunset']:frame.time}];
 }
 return selectWeatherPortrait(row,options);
}
export function approvedOutfit(frame={}){
 const state=approvedState(frame),weather=state.weather;
 const snow=['snow','heavy-snow'].includes(weather),storm=['storm','hail'].includes(weather);
 const rain=['rain','drizzle','heavy-rain','freezing-rain','sleet'].includes(weather);
 const cold=state.available&&state.clothing==='cold',cool=state.clothing==='cool',warm=state.clothing==='warm',hot=state.clothing==='hot';
 const label=!state.available?'Outfit unavailable':cold?rain||storm?'Insulated winter raincoat, long pants, hat, gloves and boots':'Winter coat, long pants, hat, gloves and boots':snow||['sleet','freezing-rain'].includes(weather)?'Winter layers, long pants and weather boots':rain||storm?cool?'Rain jacket and long pants':'Light rainwear':cool?'Jacket and long pants':hot?'Light athletic top and shorts':warm?'Light top and shorts':'Light top and long pants';
 const basis=state.available?`${state.basis} ${Math.round(state.value)}°F`:state.reason;
 const safety=storm?'Thunder or hail: seek shelter indoors. ':'';
 const layers=cold?'Wear an insulated coat over warm layers, with a hat, scarf, gloves and warm boots. ':'';
 return {temperature:state.value??null,garment:state.available?state.clothing:'unknown',top:label,bottom:warm||hot?'shorts':'long pants',hat:cold,scarf:cold,boots:cold||snow||rain,gloves:cold,sunglasses:false,umbrella:false,snow,rain,storm,possibleRain:frame.nativePrecipitationActivity==='possible',windy:finite(frame.windSpeed)&&frame.windSpeed>=18,hot,warm,cold,cool,extras:[],label,advice:`${safety}${basis}. ${layers}AI-generated weather and clothing illustration, not a live photograph.`,portrait:state};
}
const path=file=>`/weather-fusion/${file}?v=${PHOTO_ASSET_VERSION}`;
const cache=new Map(),CACHE_LIMIT=24;
function load(file){
 if(cache.has(file)){const hit=cache.get(file);cache.delete(file);cache.set(file,hit);return hit;}
 const task=new Promise((resolve,reject)=>{
  const img=new Image();img.decoding='async';
  const forget=()=>{if(cache.get(file)===task)cache.delete(file);};
  const timer=setTimeout(()=>{img.onload=img.onerror=null;forget();reject(new Error('Weather photo timed out'));},15000);
  img.onload=()=>{clearTimeout(timer);resolve(img);};
  img.onerror=()=>{clearTimeout(timer);forget();reject(new Error('Weather photo unavailable'));};
  img.src=path(file);
 });
 cache.set(file,task);if(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);return task;
}
export async function createWeatherWorld(host,{initialFrame={}}={}){
 if(!host)throw new TypeError('Weather scene host is required');
 let generation=0,disposed=false,current=null,pending=null,lastFrame=initialFrame,lastPhotoSettledAt=null,playing=false,speed=4;
 // Photographs that were part-way through a dissolve when a newer hour arrived. Each
 // stays exactly as visible as it was until the newest photograph covers it.
 const held=[];
 const clock=()=>globalThis.performance?.now()??Date.now();
 const reducedMotion=()=>!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const message=document.createElement('div');message.className='approved-photo-message';message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.textContent='Loading this hour’s weather picture…';
 host.replaceChildren(message);host.dataset.renderer=APPROVED_PLAYER_VERSION;host.dataset.transitioning='false';
 function clearMetadata(){host.dataset.loaded='false';for(const key of ['asset','background','band','light'])delete host.dataset[key];}
 function photoAlt(state){return `The selected woman, ${state.condition}, ${state.light}, clothing based on ${state.basis.toLowerCase()} ${Math.round(state.value)} degrees Fahrenheit.`;}
 function markComplete(state){
  current.state=state;current.image.alt=photoAlt(state);message.hidden=true;message.classList.remove('is-updating');host.setAttribute('aria-busy','false');
  host.dataset.loaded='true';host.dataset.loading='false';host.dataset.transitioning='false';host.dataset.asset=state.file;host.dataset.band=state.band;host.dataset.light=state.light;
 }
 function cleanup(work){
  clearTimeout(work.decodeTimer);clearTimeout(work.transitionTimer);clearTimeout(work.statusTimer);clearTimeout(work.warmTimer);
  if(work.raf!=null)cancelAnimationFrame(work.raf);work.raf=null;
 }
 function settle(work,result){
  if(work.done)return;work.done=true;cleanup(work);
  if(pending===work)pending=null;
  work.resolve(result);
 }
 function cancelPending(){
  if(!pending)return;
  const work=pending;work.cancelLoad();work.animation?.cancel();work.image.remove();settle(work,false);host.dataset.transitioning='false';
 }
 function dropHeld(){for(const layer of held.splice(0)){layer.animation?.cancel();layer.image.remove();}}
 function visibleOpacity(image){const value=parseFloat(globalThis.getComputedStyle?.(image)?.opacity);return Number.isFinite(value)?value:0;}
 // A newer hour arrived before this dissolve finished. Nothing on screen jumps: a
 // photograph that is visibly fading in is held where it is, and the newer
 // photograph dissolves over it.
 function supersede(work){
  const opacity=work.revealed?visibleOpacity(work.image):0;
  cleanup(work);work.cancelLoad();
  if(work.animation&&supersededPhotoAction(opacity)==='hold'){
   work.animation.pause();work.image.classList.replace('approved-weather-photo-incoming','approved-weather-photo-held');
   held.push({image:work.image,animation:work.animation});
  }else{work.animation?.cancel();work.image.remove();}
  settle(work,false);
 }
 function hideScene(text){
  dropHeld();if(current)current.image.remove();current=null;
  clearMetadata();host.dataset.loading='false';host.dataset.transitioning='false';host.setAttribute('aria-busy','false');message.classList.remove('is-updating');message.hidden=false;message.textContent=text;
 }
 function update(frame){
  if(disposed)return Promise.resolve(false);
  lastFrame=frame;const state=approvedState(frame);host.dataset.frameTime=frame.time||'';
  if(!state.available){++generation;cancelPending();hideScene(state.reason);return Promise.resolve(false);}
  // Repeated hours can share one photograph. Reuse the in-flight handoff rather
  // than restarting its decode or making an already visible person disappear.
  if(pending?.file===state.file){pending.state=state;return pending.promise;}
  ++generation;
  if(pending)supersede(pending);
  // The same photograph already fills the scene: keep it and update its description.
  if(current?.file===state.file&&!held.length){markComplete(state);return Promise.resolve(true);}
  clearMetadata();host.dataset.loading='true';host.dataset.transitioning='false';host.setAttribute('aria-busy','true');
  message.classList.remove('is-updating');message.hidden=!!current;message.textContent='Loading this hour’s weather picture…';
  const image=document.createElement('img');image.className='approved-weather-photo approved-weather-photo-incoming';image.width=1200;image.height=675;image.decoding='async';image.hidden=true;image.alt='';
  let resolve,cancelLoad;
  const promise=new Promise(done=>{resolve=done;}),cancelled=new Promise(done=>{cancelLoad=done;});
  const work={file:state.file,state,image,token:generation,promise,resolve,cancelLoad,done:false,raf:null,revealed:false,animation:null,visibleAt:null};pending=work;host.insertBefore(image,message);
  // A long stop-and-go scrub cannot pile up photographs: past six held layers, the
  // one contributing least to the picture is removed, which changes it the least.
  while(held.length>6){
   let remaining=1,least=0,leastWeight=Infinity;
   for(let i=held.length-1;i>=0;i--){const o=visibleOpacity(held[i].image),w=o*remaining;remaining*=1-o;if(w<leastWeight){leastWeight=w;least=i;}}
   const [layer]=held.splice(least,1);layer.animation?.cancel();layer.image.remove();
  }
  const latest=()=>!disposed&&!work.done&&pending===work&&work.token===generation;
  // Preloaded photographs decode almost at once; the notice is only for slow loads.
  if(current)work.statusTimer=setTimeout(()=>{if(latest()&&!work.revealed){message.classList.add('is-updating');message.textContent='Updating scene…';message.hidden=false;}},600);
  function complete(){
   if(!latest())return;
   const old=current;
   // Hand over from the animation to the stylesheet's full opacity in the same frame.
   image.style.opacity='';image.classList.remove('approved-weather-photo-incoming');image.classList.add('approved-weather-photo-current');work.animation?.cancel();
   current={file:work.file,image,state:work.state};lastPhotoSettledAt=work.visibleAt??clock();
   // Everything beneath is now fully covered, so removing it changes nothing visible.
   dropHeld();if(old&&old.image!==image)old.image.remove();markComplete(work.state);settle(work,true);
  }
  void(async()=>{
   try{
    await Promise.race([load(state.file),cancelled]);
    if(!latest())return;
    image.src=path(state.file);image.alt=photoAlt(work.state);
    // Decode the actual display element. A ready preloader alone does not
    // guarantee that this element has a paintable image, especially on mobile.
    await Promise.race([image.decode(),cancelled,new Promise((_,reject)=>{work.decodeTimer=setTimeout(()=>reject(new Error('Weather photo decode timed out')),15000);})]);
    clearTimeout(work.decodeTimer);if(!latest())return;
    clearTimeout(work.statusTimer);message.hidden=true;message.classList.remove('is-updating');
    if(!current||reducedMotion()||typeof image.animate!=='function'){image.hidden=false;complete();return;}
    // Only the incoming photo fades. The photographs beneath stay as they are, so
    // there is no dark flash, zoom, blur or simulated body movement. It is first
    // shown almost transparent for two frames, so the dissolve begins on a photo
    // the browser has already painted and its first step is not a jump.
    image.style.opacity='0.001';image.hidden=false;work.revealed=true;host.dataset.transitioning='true';
    await Promise.race([cancelled,new Promise(done=>{
     work.warmTimer=setTimeout(done,120);
     work.raf=requestAnimationFrame(()=>{work.raf=requestAnimationFrame(()=>{work.raf=null;done();});});
    })]);
    clearTimeout(work.warmTimer);if(!latest())return;
    const duration=photoDissolveMs({playing,speed});
    // The new photograph is the main picture from the middle of its dissolve.
    work.visibleAt=clock()+duration/2;
    work.animation=image.animate([{opacity:0.001},{opacity:1}],{duration,easing:DISSOLVE_EASING,fill:'forwards'});
    work.animation.finished.then(complete,()=>{});
    // Timers keep running where animation frames pause, as in background tabs.
    work.transitionTimer=setTimeout(complete,duration+250);
   }catch{
    if(!latest())return;
    image.remove();hideScene('The picture for this hour could not load. Choose another hour or reopen the player to retry.');settle(work,false);
   }
  })();
  return promise;
 }
 await update(initialFrame);
 return {
  setFrame(frame){return update(frame);},
  setCharacter(){/* One approved person only; old saved selections are deliberately ignored. */},
  setPlaying(value){playing=!!value;host.dataset.playing=String(playing);},
  setSpeed(value){speed=PLAY_DISSOLVE_MS[Number(value)]?Number(value):4;},resize(){},
  preload(frames=[]){
   if(disposed)return;
   const distinct=new Set([current?.file,pending?.file]);let queued=0;
   // Several consecutive hours often use the same photo. Look ahead to the
   // next distinct scenes instead of repeatedly preloading the same two hours.
   for(const frame of frames){
    const state=approvedState(frame);if(!state.available||distinct.has(state.file))continue;
    distinct.add(state.file);void load(state.file).catch(()=>{});if(++queued>=2)break;
   }
  },
  dispose(){disposed=true;++generation;cancelPending();dropHeld();current=null;host.replaceChildren();clearMetadata();host.dataset.loading='false';host.dataset.transitioning='false';host.setAttribute('aria-busy','false');},
  get currentFrame(){return lastFrame;},
  get lastPhotoSettledAt(){return lastPhotoSettledAt;}
 };
}
