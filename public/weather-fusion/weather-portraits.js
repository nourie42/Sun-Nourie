/** Approved single-person weather photographs. This presentation layer never
 * changes a forecast number or infers precipitation type from temperature. */
export const WEATHER_PORTRAITS_VERSION='weather-portraits-v1';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const stamp=v=>typeof v==='number'?v:Date.parse(v);
const four=['below-32f','32-59f','60-74f','75f-plus'];
const three=['below-32f','32-59f','60f-plus'];
const wet=['below-60f','60f-plus'];
const winter=['below-32f','32-49f'];
export const PORTRAIT_BANDS=Object.freeze({clear:four,cloudy:four,'partly-cloudy':four,drizzle:wet,rain:wet,'heavy-rain':wet,storm:wet,hail:wet,fog:three,haze:three,dust:three,wind:three,snow:winter,'heavy-snow':winter,sleet:winter,'freezing-rain':winter,dawn:three,dusk:three});
export const PORTRAIT_FILES=Object.entries(PORTRAIT_BANDS).flatMap(([condition,bands])=>['dawn','dusk'].includes(condition)?bands.map(b=>`weather-her-${condition}-feels-${b}.webp`):['day','night'].flatMap(light=>bands.map(b=>`weather-her-${condition}-${light}-feels-${b}.webp`)));
const allowed=new Set(PORTRAIT_FILES);
export function portraitWeather(row={}){
 const text=String(row.condition||'').toLowerCase();
 // Keep phase priority explicit: freezing rain and sleet are not snow.
 if(/freezing (?:rain|drizzle)|ice storm|glaze/.test(text))return 'freezing-rain';
 if(/sleet|ice pellets|wintry mix|rain.*snow|snow.*rain/.test(text))return 'sleet';
 if(/hail/.test(text))return 'hail';
 if(/blizzard|heavy snow|snow squall/.test(text))return 'heavy-snow';
 if(/snow|flurr/.test(text))return 'snow';
 if(/thunder|\btstm\b|\bstorm/.test(text))return 'storm';
 if(/heavy rain|downpour|torrential/.test(text))return 'heavy-rain';
 if(/drizzle/.test(text))return 'drizzle';
 if(/rain|shower/.test(text)||row.rainNow===true)return 'rain';
 if(/fog|mist/.test(text))return 'fog';
 if(/smoke|haze|hazy/.test(text))return 'haze';
 if(/dust|sandstorm/.test(text))return 'dust';
 if(/windy|blowing|gale/.test(text))return 'wind';
 if(/partly|scattered clouds/.test(text))return 'partly-cloudy';
 if(/mostly (?:sunny|clear)|\bclear\b|\bsunny\b|\bfair\b/.test(text))return 'clear';
 if(/cloud|overcast|broken/.test(text))return 'cloudy';
 if(finite(row.skyCover)&&row.skyCover>=0&&row.skyCover<=100)return row.skyCover<20?'clear':row.skyCover<70?'partly-cloudy':'cloudy';
 return null;
}
export function selectWeatherPortrait(row={},options={}){
 const weather=portraitWeather(row),air=finite(row.temperature)?row.temperature:null,feels=finite(row.feels)?row.feels:null;
 const mode=options.mode==='air'?'air':'feels';
 const value=mode==='air'?air:feels??air;
 const basis=mode==='air'?'Air temperature':feels!==null?'Feels like':air!==null?'Air temperature (feels like unavailable)':'Temperature unavailable';
 if(!weather||value===null||typeof row.isDay!=='boolean')return {available:false,reason:!weather?'Weather condition unavailable':value===null?'Temperature unavailable':'Day/night information unavailable',air,feels,basis};
 let family=weather,light=row.isDay?'day':'night';
 const time=stamp(row.time);
 if(['clear','partly-cloudy'].includes(weather)&&finite(time)){
  for(const solar of options.solar||[]){
   const rise=stamp(solar?.sunrise),set=stamp(solar?.sunset);
   if(finite(rise)&&Math.abs(time-rise)<=30*60000){family='dawn';light='dawn';break;}
   if(finite(set)&&Math.abs(time-set)<=30*60000){family='dusk';light='dusk';break;}
  }
 }
 const bands=PORTRAIT_BANDS[family];
 const band=bands===wet?(value<60?'below-60f':'60f-plus'):bands===winter?(value<32?'below-32f':'32-49f'):value<32?'below-32f':value<60?'32-59f':bands===four?(value<75?'60-74f':'75f-plus'):'60f-plus';
 const file=`weather-her-${family}${['dawn','dusk'].includes(family)?'':'-'+light}-feels-${band}.webp`;
 if(!allowed.has(file))throw new Error('Unrecognized approved weather portrait');
 return {available:true,file,background:file.replace('weather-her-','weather-her-bg-'),weather,light,band,value,basis,air,feels,condition:String(row.condition||weather),illustrative:true};
}
const url=file=>`/weather-fusion/${file}?v=${WEATHER_PORTRAITS_VERSION}`;
const degree=value=>finite(value)?`${Math.round(value)}°F`:'Unavailable';
const loaded=new Map();
function loadPicture(file){
 if(loaded.has(file))return loaded.get(file);
 const pending=new Promise((resolve,reject)=>{
  const image=new Image();image.decoding='async';
  const timeout=setTimeout(()=>{image.onload=image.onerror=null;loaded.delete(file);reject(new Error('Image load timed out'));},15000);
  image.onload=()=>{clearTimeout(timeout);resolve(image);};
  image.onerror=()=>{clearTimeout(timeout);loaded.delete(file);reject(new Error('Image unavailable'));};
  image.src=url(file);
 });
 loaded.set(file,pending);
 if(loaded.size>14)loaded.delete(loaded.keys().next().value);
 return pending;
}
function styles(){
 if(document.getElementById('weather-portrait-styles'))return;
 const style=document.createElement('style');style.id='weather-portrait-styles';
 style.textContent=`
 .weather-portrait{position:relative;width:100%;margin:0;text-align:left;overflow:hidden;border-radius:18px;background:#122239;color:#fff}
 .weather-portrait-picture{position:relative;aspect-ratio:16/9;background:#14233f;overflow:hidden}
 .weather-portrait-image{display:block;width:100%;height:100%;object-fit:cover;object-position:55% center;animation:portrait-reveal .3s ease}
 .weather-portrait-image[hidden]{display:none}
 .weather-portrait-status{position:absolute;inset:0;display:grid;place-items:center;padding:24px;color:#e8f2ff;background:#14233f;text-align:center}
 .weather-portrait-status[hidden]{display:none}
 .weather-portrait-caption{padding:14px 16px;display:grid;gap:8px;background:rgba(9,20,37,.9)}
 .weather-portrait-readings{display:flex;flex-wrap:wrap;gap:10px 24px;font-size:17px;font-weight:650}
 .weather-portrait-time{font-size:14px;font-weight:700}
 .weather-portrait-caption small{font-size:12px;color:#cbd8e9;line-height:1.5}
 .weather-portrait-mode{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px}
 .weather-portrait-mode select{color:#fff;background:#233e60;border:1px solid #6c839f;border-radius:9px;padding:8px;font:inherit;min-height:40px}
 .weather-photo-player h2{font-size:17px;letter-spacing:.04em;margin:0 0 12px}
 .weather-photo-controls{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap}
 .weather-photo-controls button{min-height:44px;padding:8px 16px;border-radius:999px;border:1px solid #9cacc3;background:rgba(20,40,65,.85);color:white;font:inherit;cursor:pointer}
 .weather-photo-controls input{min-width:120px;flex:1;accent-color:#cfe8ff}
 .weather-photo-controls output{font-size:13px;min-width:90px}
 body.weather-portrait-main .reference-scene{display:none!important}
 body.weather-portrait-atmos #dressed,body.weather-portrait-atmos #dressed-note,body.weather-portrait-atmos #sky,body.weather-portrait-atmos #sky-note{display:none!important}
 body.weather-portrait-atmos #sky-frame{height:auto!important;aspect-ratio:auto!important;max-height:none!important}
 body.her-background-loaded .atmosphere{background-image:linear-gradient(180deg,rgba(5,14,29,.4),rgba(5,14,29,.82)),var(--weather-portrait-background)!important;background-position:center!important;background-size:cover!important}
 body.her-background-loaded .atmosphere:before,body.her-background-loaded .atmosphere>*{display:none!important}
 @keyframes portrait-reveal{from{opacity:.35}to{opacity:1}}
 @media(max-width:600px){.weather-portrait-picture{aspect-ratio:3/4}.weather-portrait-readings{font-size:16px}.weather-portrait-caption{padding:12px}.weather-photo-controls{gap:8px}}
 @media(prefers-reduced-motion:reduce){.weather-portrait-image{animation:none}}
 `;
 document.head.append(style);
}
/** Latest selection owns both the photo and background. A slow old response can
 * never repaint a newer hour, and a failed asset is not shown as current. */
export function createWeatherPortrait(host,{onModeChange}={}){
 if(!host)throw new TypeError('Portrait host is required');
 styles();let generation=0,lastRow=null,lastOptions={},mode='feels',visibleFile=null;
 const figure=document.createElement('figure');figure.className='weather-portrait';
 figure.innerHTML='<div class="weather-portrait-picture"><img class="weather-portrait-image" width="1200" height="675" alt="" hidden><p class="weather-portrait-status" role="status">Loading weather picture…</p></div><figcaption class="weather-portrait-caption"><div class="weather-portrait-time"></div><div class="weather-portrait-readings"><span class="portrait-air"></span><span class="portrait-feels"></span></div><label class="weather-portrait-mode">Outfit based on <select aria-label="Temperature used for clothing"><option value="feels">Feels like</option><option value="air">Air temperature</option></select></label><small class="portrait-basis"></small><small>AI-generated weather illustration, not a live photograph or a guarantee of comfort.</small></figcaption>';
 host.append(figure);
 const img=figure.querySelector('img'),status=figure.querySelector('[role="status"]'),select=figure.querySelector('select');
 function clearBackground(){document.body.classList.remove('her-background-loaded');document.body.style.removeProperty('--weather-portrait-background');}
 async function update(row,options={}){
  lastRow=row;lastOptions=options;const token=++generation,state=selectWeatherPortrait(row||{},{...options,mode});
  figure.dataset.selectedTime=String(row?.id||row?.time||'');
  figure.querySelector('.portrait-air').textContent=`Air ${degree(state.air)}`;
  figure.querySelector('.portrait-feels').textContent=`Feels like ${degree(state.feels)}`;
  let when=row?.isNow?'Now':'';
  try{when+=(when?' · ':'')+new Intl.DateTimeFormat('en-US',{timeZone:options.timeZone||'America/New_York',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(stamp(row?.time)));}catch{when=when||'Forecast hour';}
  figure.querySelector('.weather-portrait-time').textContent=`${when} · ${row?.condition||'Weather unavailable'}`;
  figure.querySelector('.portrait-basis').textContent=state.available?`${state.basis}: ${degree(state.value)} · ${state.light}. Rain, snow and other scenes follow the stated condition; forecast chances are not a claim that precipitation is certain.`:state.reason;
  if(!state.available){img.hidden=true;visibleFile=null;figure.dataset.loaded='false';status.hidden=false;status.textContent=state.reason;clearBackground();return false;}
  if(visibleFile===state.file){figure.dataset.loaded='true';return true;}
  img.hidden=true;status.hidden=false;status.textContent='Loading the picture for this hour…';figure.dataset.loaded='false';clearBackground();
  try{
   await Promise.all([loadPicture(state.file),loadPicture(state.background)]);
   if(token!==generation)return false;
   img.src=url(state.file);img.alt=`The selected woman in weather-appropriate clothing; ${state.condition}; ${state.light}; clothing based on ${state.basis.toLowerCase()} ${degree(state.value)}.`;
   img.hidden=false;status.hidden=true;visibleFile=state.file;figure.dataset.loaded='true';figure.dataset.asset=state.file;figure.dataset.band=state.band;figure.dataset.light=state.light;
   document.body.style.setProperty('--weather-portrait-background',`url("${url(state.background)}")`);document.body.classList.add('her-background-loaded');
   return true;
  }catch{
   if(token!==generation)return false;
   visibleFile=null;img.hidden=true;status.hidden=false;status.textContent='This weather picture could not load. The forecast above is unchanged.';clearBackground();return false;
  }
 }
 select.addEventListener('change',()=>{mode=select.value;void update(lastRow,lastOptions);onModeChange?.(mode);});
 return {update,get mode(){return mode;},preload(rows,options={}){for(const row of rows.slice(0,2)){const state=selectWeatherPortrait(row,{...options,mode});if(state.available){void loadPicture(state.file).catch(()=>{});void loadPicture(state.background).catch(()=>{});}}},destroy(){++generation;figure.remove();clearBackground();}};
}

/** Main-page bridge: the existing hourly strip and numerical panels remain the
 * source of truth; the added controls select that same hour, never a new feed. */
export async function installMainWeatherPortraits(){
 if(typeof document==='undefined'||!document.getElementById('hourly')||document.getElementById('weather-photo-player'))return;
 const [{buildTimeline},{selectComfortHour}]=await Promise.all([import('./atmos-model.js?v=atmos-v5'),import('./experience.js?v=low-rain-display-v1')]);
 if(document.getElementById('weather-photo-player'))return;
 const panel=document.createElement('section');panel.id='weather-photo-player';panel.className='glass weather-photo-player';panel.setAttribute('aria-label','Play your weather');
 panel.innerHTML='<h2>PLAY YOUR WEATHER</h2><div class="weather-photo-host"></div><div class="weather-photo-controls"><button type="button" class="portrait-play" aria-pressed="false">▶ Play</button><input class="portrait-hour" type="range" min="0" max="0" value="0" step="1" aria-label="Weather picture forecast hour"><button type="button" class="portrait-now">Now</button><output class="portrait-position">Waiting for forecast</output></div>';
 document.getElementById('hourly').closest('section').after(panel);document.body.classList.add('weather-portrait-main');
 const view=createWeatherPortrait(panel.querySelector('.weather-photo-host')),slider=panel.querySelector('input'),play=panel.querySelector('.portrait-play'),output=panel.querySelector('output');
 let forecast=null,rows=[],index=0,timer=null,playing=false;
 const options=()=>({solar:forecast?.metricForecasts?.solar||[forecast?.solar],timeZone:forecast?.location?.timeZone});
 function pause(){clearTimeout(timer);timer=null;playing=false;play.textContent='▶ Play';play.setAttribute('aria-pressed','false');}
 async function show(next,{sync=true}={}){
  if(!rows.length)return false;
  index=Math.max(0,Math.min(rows.length-1,Math.round(next)));const row=rows[index];slider.value=String(index);slider.setAttribute('aria-valuetext',`${row.label}, ${row.condition}, air ${degree(row.temperature)}, feels like ${degree(row.feels)}`);output.textContent=`${row.isNow?'Now':row.label} · ${index+1}/${rows.length}`;
  if(sync)selectComfortHour(row.id);
  const task=view.update(row,options());view.preload(rows.slice(index+1,index+3),options());return task;
 }
 async function advance(){if(!playing||document.hidden){pause();return;}const requested=index+1;if(requested>=rows.length){pause();return;}await show(requested);if(playing)timer=setTimeout(advance,1200);}
 play.addEventListener('click',()=>{if(playing){pause();return;}if(rows.length<2)return;playing=true;play.textContent='❚❚ Pause';play.setAttribute('aria-pressed','true');if(index===rows.length-1)void show(0);timer=setTimeout(advance,1200);});
 slider.addEventListener('input',()=>{pause();void show(Number(slider.value));});
 panel.querySelector('.portrait-now').addEventListener('click',()=>{pause();void show(0);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
 document.addEventListener('click',event=>{const button=event.target.closest?.('[data-comfort-time]');if(!button)return;const next=rows.findIndex(row=>row.id===button.dataset.comfortTime);if(next>=0){pause();void show(next,{sync:false});}});
 function receive(data){
  if(!data?.location||!Array.isArray(data.hours))return;
  const oldLocation=forecast?.location,same=oldLocation&&oldLocation.latitude===data.location.latitude&&oldLocation.longitude===data.location.longitude;
  const id=same?rows[index]?.id:'now';pause();forecast=data;rows=buildTimeline(data,Date.now());
  slider.max=String(Math.max(0,rows.length-1));slider.disabled=!rows.length;play.disabled=rows.length<2;
  if(!rows.length){void view.update(null,options());output.textContent='Hourly forecast unavailable';return;}
  void show(Math.max(0,rows.findIndex(row=>row.id===id)),{sync:false});
 }
 document.addEventListener('weather-nourie:forecast',event=>receive(event.detail));
 if(globalThis.__weatherNourieForecast)receive(globalThis.__weatherNourieForecast);
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{void installMainWeatherPortraits().catch(error=>console.error('Weather portrait setup failed',error));},{once:true});
 else void installMainWeatherPortraits().catch(error=>console.error('Weather portrait setup failed',error));
}
