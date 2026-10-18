/** The user's approved complete photographs, not the retired character atlases.
 * Forecast values remain owned by native-player.js. No weather is fetched here. */
import {selectWeatherPortrait} from './approved-portrait-selection.js?v=approved-her-prerelease-v2';
import {solarElevation} from '../weather-math.js?v=current-rain-20261017-v3';
export const APPROVED_PLAYER_VERSION='approved-her-prerelease-v3';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const WMO={0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Fog',51:'Drizzle',53:'Drizzle',55:'Drizzle',56:'Freezing drizzle',57:'Freezing drizzle',61:'Rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',71:'Snow',73:'Snow',75:'Heavy snow',77:'Snow',80:'Rain showers',81:'Rain showers',82:'Heavy rain',85:'Snow showers',86:'Heavy snow',95:'Thunderstorms',96:'Thunderstorms with hail',99:'Thunderstorms with hail'};
export function approvedState(frame={}){
 const condition=frame.nativePolicy===true?frame.nativeCondition||'Conditions unavailable':WMO[frame.weatherCode]||frame.condition||'Conditions unavailable';
 const row={condition,temperature:frame.temperature,feels:frame.feelsLike,isDay:frame.isDay,time:frame.time,skyCover:frame.cloudCover};
 const options={mode:frame.outfitBasis==='air'?'air':'feels'};
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
 const cold=state.band==='below-32f',cool=['32-59f','below-60f','32-49f'].includes(state.band),hot=state.band==='75f-plus';
 const label=!state.available?'Outfit unavailable':cold?'Warm parka, long pants, hat, scarf and boots':snow||['sleet','freezing-rain'].includes(weather)?'Winter layers, long pants and weather boots':rain||storm?cool?'Rain jacket and long pants':'Light rainwear':cool?'Jacket and long pants':hot?'Light athletic top and shorts':'Light top and long pants';
 const basis=state.available?`${state.basis} ${Math.round(state.value)}°F`:state.reason;
 const safety=storm?'Thunder or hail: seek shelter indoors. ':'';
 return {temperature:state.value??null,garment:!state.available?'unknown':rain?'rain':cold?'cold':cool?'cool':hot?'hot':'mild',top:label,bottom:hot?'shorts':'long pants',hat:cold,scarf:cold,boots:cold||snow||rain,gloves:cold,sunglasses:false,umbrella:false,snow,rain,storm,possibleRain:frame.nativePrecipitationActivity==='possible',windy:finite(frame.windSpeed)&&frame.windSpeed>=18,hot,cold,cool,extras:[],label,advice:`${safety}${basis}. AI-generated weather and clothing illustration, not a live photograph.`,portrait:state};
}
const path=file=>`/weather-fusion/${file}?v=${APPROVED_PLAYER_VERSION}`;
const cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file);
 const task=new Promise((resolve,reject)=>{
  const img=new Image();img.decoding='async';
  const timer=setTimeout(()=>{img.onload=img.onerror=null;cache.delete(file);reject(new Error('Weather photo timed out'));},15000);
  img.onload=()=>{clearTimeout(timer);resolve(img);};
  img.onerror=()=>{clearTimeout(timer);cache.delete(file);reject(new Error('Weather photo unavailable'));};
  img.src=path(file);
 });
 cache.set(file,task);if(cache.size>24)cache.delete(cache.keys().next().value);return task;
}
function backgroundStyles(){
 if(document.getElementById('approved-player-background-style'))return;
 const style=document.createElement('style');style.id='approved-player-background-style';
 style.textContent='body.approved-player-background .atmosphere{background-image:linear-gradient(180deg,rgba(6,18,34,.28),rgba(6,18,34,.8)),var(--approved-weather-background)!important;background-size:cover!important;background-position:center!important}body.approved-player-background .atmosphere:before,body.approved-player-background .atmosphere>*{display:none!important}';document.head.append(style);
}
const backgroundOwner=Symbol.for('nourie.approved-weather-background-owner');
export async function createWeatherWorld(host,{initialFrame={}}={}){
 if(!host)throw new TypeError('Weather scene host is required');
 backgroundStyles();const owner={};let generation=0,disposed=false,visible='',lastFrame=initialFrame;
 const image=document.createElement('img');image.className='approved-weather-photo';image.width=1200;image.height=675;image.decoding='async';image.hidden=true;image.alt='';
 const message=document.createElement('div');message.className='approved-photo-message';message.textContent='Loading this hour’s weather picture…';
 host.replaceChildren(image,message);host.dataset.renderer=APPROVED_PLAYER_VERSION;
 function clearBackground(){if(document.body[backgroundOwner]===owner){document.body.classList.remove('approved-player-background');document.body.style.removeProperty('--approved-weather-background');delete document.body[backgroundOwner];}}
 async function update(frame){
  if(disposed)return false;lastFrame=frame;const token=++generation,state=approvedState(frame);
  host.dataset.frameTime=frame.time||'';
  if(!state.available){visible='';image.hidden=true;message.hidden=false;message.textContent=state.reason;host.dataset.loaded='false';clearBackground();return false;}
  if(visible===state.file){host.dataset.loaded='true';return true;}
  visible='';image.hidden=true;message.hidden=false;message.textContent='Loading this hour’s weather picture…';host.dataset.loaded='false';clearBackground();
  try{
   await Promise.all([load(state.file),load(state.background)]);
   if(disposed||token!==generation)return false;
   image.src=path(state.file);image.alt=`The selected woman, ${state.condition}, ${state.light}, clothing based on ${state.basis.toLowerCase()} ${Math.round(state.value)} degrees Fahrenheit.`;
   // The visible element can need its own decode even when its preloader is ready.
   // Do not mark it loaded or change the background while the actual image is blank.
   await image.decode();
   if(disposed||token!==generation)return false;
   image.hidden=false;message.hidden=true;visible=state.file;
   host.dataset.loaded='true';host.dataset.asset=state.file;host.dataset.background=state.background;host.dataset.band=state.band;host.dataset.light=state.light;
   document.body[backgroundOwner]=owner;document.body.style.setProperty('--approved-weather-background',`url("${path(state.background)}")`);document.body.classList.add('approved-player-background');return true;
  }catch{
   if(disposed||token!==generation)return false;
   message.hidden=false;message.textContent='The picture for this hour could not load. Choose another hour or reopen the player to retry.';image.hidden=true;clearBackground();return false;
  }
 }
 await update(initialFrame);
 return {setFrame(frame){return update(frame);},setCharacter(){/* One approved person only; old saved selections are deliberately ignored. */},setPlaying(value){host.dataset.playing=String(!!value);},resize(){},preload(frames=[]){for(const frame of frames.slice(0,2)){const state=approvedState(frame);if(state.available){void load(state.file).catch(()=>{});void load(state.background).catch(()=>{});}}},dispose(){disposed=true;++generation;clearBackground();host.replaceChildren();host.dataset.loaded='false';},get currentFrame(){return lastFrame;}};
}
