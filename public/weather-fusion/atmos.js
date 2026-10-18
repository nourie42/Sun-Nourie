/* Atmos — Weather Nourie drawn as a living sky.
 * One forecast request (/api/weather-fusion/forecast) drives the page. The sky,
 * the 48-hour clock and every section below read the same canonical values the
 * main page shows; Atmos only changes how they are drawn and explained. The
 * forecast lab re-weights the source values the server published, and only the
 * lab uses the visitor's recipe. Official alerts are shown unaltered and are
 * refreshed on their own cadence. */
import {buildTimeline,skyScene,mixScene,consensus,agreementLabel,presentSources,rainBreakdown,comfortGrid,perfectWindows,dailyOutlook,
 sunDay,COMFORT_BINS,comfortBin,SOURCES,SOURCE_ORDER,SOURCE_ABOUT,sourceLabel,countWord,compass,hourLabel,clockLabel,longDayLabel,weekdayLabel,localParts,
 PRESETS,validPlace,placeFromQuery,PERFECT_RULES,H,TRUST_STOPS,TRUST_LABELS,NORMAL_STOP,LAB_PRESETS,normalTrust,isNourieTrust,matchingPreset,
 recipeShares,sourceCoverage,customForecast,labDifferences,rainOutlook,relativeHour,dressingTimeline} from './atmos-model.js?v=atmos-v6';
import {createSky,moonIllumination,moonPhaseName,moonPosition,sunPosition,directionWord} from './atmos-sky.js?v=atmos-v6';
import {fetchJsonWithDeadline} from './request-deadline.js?v=loading-recovery-v1';
import {withLiveAlerts,retainUnverifiedAlerts,alertLocationKey,alertHealth,ALERT_REFRESH_MS} from './live-alerts.js?v=county-warnings-v3';
import {pavementEstimate,petSurfaceSubtitle} from './pavement.js?v=current-rain-20261017-v3';
import {uvCategory} from './daily-uv.js?v=weather-art-labels-v10';
import {aqiBand} from './air-quality.js?v=mobile-repair-v1';
import {dewpointFeelLevel,forecastFeelLevel} from './dewpoint-meter.js?v=feel-chart-v3';
import {currentSample,forecastSample} from './weather-display.js?v=low-rain-display-v1';
import {timeAt} from './calendar-day.js?v=calendar-days-v1';

const $=id=>document.getElementById(id);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const deg=v=>finite(v)?`${Math.round(v)}°`:'–';
const inches=v=>!finite(v)?'–':v>0&&v<.01?'under 0.01 in':`${v.toFixed(2)} in`;
const chance=v=>!finite(v)?'–':v<5?'<5%':`${Math.round(v)}%`;
const pct=v=>`${Math.round(v*100)}%`;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const DEVICE_KEY='weather-fusion-device-place',PLACE_KEY='atmos-place',RECIPE_KEY='atmos-recipe';
const PLAY_HOURS_PER_SECOND=3.2,PLAY_DRIFT=36,REFRESH_MS=10*60000;
const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)');

let place=null,forecast=null,steps=[],blendRows=[],grid=[],days=[],selected=0,briefing=null,radarMeta=null,alertSnapshot=null;
let generation=0,controller=null,loadedAt=0,playing=false,playhead=0,playFrame=0,lastPlay=0,tween=null,skyIndex=0,openDay=null;
let trust=normalTrust(readJSON(RECIPE_KEY)),labView='temp',lab=null,labFrame=0;
const zone=()=>forecast?.location?.timeZone||'America/New_York';
const step=()=>steps[selected]||null;

/* ---------- Sky ---------- */
const sky=createSky($('sky'),{reducedMotion:!!motion?.matches});
motion?.addEventListener?.('change',event=>{sky.reducedMotion=event.matches;});
function sceneAt(position){
 if(!steps.length)return null;
 const i=clamp(Math.floor(position),0,steps.length-1),j=Math.min(steps.length-1,i+1),f=clamp(position-i,0,1);
 const a=steps[i],b=steps[j];
 return {time:a.time+(b.time-a.time)*f,scene:mixScene(skyScene(a),skyScene(b),f)};
}
function paintSky(position){
 skyIndex=position;
 const state=sceneAt(position);
 if(state){sky.setState(state);setBodySky(state);}
 renderSkyNote(state?.time);
 drawStripCursor(position);
}
/* The page's header band and background follow the sky shown: night, rain, sunset or day. */
let bodySky='';
function setBodySky(state){
 const loc=forecast?.location||place;if(!loc||!finite(state.time))return;
 const alt=sunPosition(state.time,loc.latitude,loc.longitude).altitude,s=state.scene;
 const next=alt<-4?'night':(s.storm||s.rain>.12)?'rain':(alt<8?'sunset':'day');
 if(next!==bodySky){bodySky=next;document.body.dataset.sky=next;}
}
function renderSkyNote(time){
 const note=$('sky-note');
 if(!note||!forecast||!finite(time))return;
 const {latitude,longitude}=forecast.location,sun=sunPosition(time,latitude,longitude);
 if(sun.altitude>-0.833){note.textContent=`Sun ${Math.max(0,Math.round(sun.altitude))}° above the horizon`;return;}
 const moon=moonPosition(time,latitude,longitude),light=moonIllumination(time);
 note.textContent=`${moonPhaseName(light.phase)}, ${Math.round(light.fraction*100)}% lit, ${moon.altitude<0?'below the horizon':`${Math.round(moon.altitude)}° up in the ${directionWord(moon.azimuth)}`}`;
}

/* ---------- Dressed for the hour ---------- */
// The illustrated people sit under the sky. A figure keeps its picture until its clothes really change (the
// model settles them), and only the feels-like numbers are rewritten each hour, so nothing flickers while the
// time-lapse runs.
let dressing=[];
const sampleAt=s=>s?.isNow?currentSample(forecast,Date.now()):forecastSample(forecast,new Date(s.time).toISOString());
const wearKey=person=>`${person.scene}|${person.outfit}|${person.daylight}`;
function wearHTML(person){
 return `<figure class="wear" data-key="${esc(wearKey(person))}" data-daylight="${person.daylight}">${person.art}<figcaption><span class="wear-label">${esc(person.label)}</span><strong class="wear-feel">${deg(person.feel)}</strong><small class="wear-text">${esc(person.text)}</small></figcaption></figure>`;
}
function renderDressed(s){
 const el=$('dressed'),note=$('dressed-note'),people=(dressing[selected]||[]).filter(Boolean);
 if(!el||!s||!people.length)return;
 el.hidden=false;if(note)note.hidden=false;
 const figures=[...el.querySelectorAll('.wear')];
 if(figures.length!==people.length){el.innerHTML=people.map(wearHTML).join('');return;}
 people.forEach((person,i)=>{
  if(figures[i].dataset.key!==wearKey(person)){figures[i].outerHTML=wearHTML(person);return;}
  figures[i].querySelector('.wear-feel').textContent=deg(person.feel);
  figures[i].querySelector('.wear-text').textContent=person.text;
 });
}

/* ---------- Loading ---------- */
function readJSON(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
function writeJSON(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* optional */}}
function initialPlace(){
 const fromUrl=placeFromQuery(location.search);if(fromUrl)return fromUrl;
 const saved=readJSON(PLACE_KEY);if(validPlace(saved))return saved;
 const device=readJSON(DEVICE_KEY);if(validPlace(device))return {id:'device',name:'',latitude:device.latitude,longitude:device.longitude};
 return {...PRESETS[0]};
}
function query(extra={}){
 const preset=PRESETS.find(p=>p.id===place?.id);
 return new URLSearchParams(preset?{location:preset.id,...extra}:{latitude:place.latitude,longitude:place.longitude,...extra});
}
function api(path,params,signal,timeoutMs=45000){
 return fetchJsonWithDeadline(`/api/weather-fusion/${path}?${params}`,{signal,timeoutMs,cache:'no-store',headers:{Accept:'application/json'}});
}
function status(text,error=false){const node=$('status');node.textContent=text;node.classList.toggle('error',error);}
async function load({keepHour=true}={}){
 if(!validPlace(place))return;
 const id=++generation;
 controller?.abort();controller=new AbortController();
 const keepTime=keepHour&&step()&&!step().isNow?step().time:null;
 $('refresh').classList.add('busy');
 if(!forecast)status('Checking the latest forecasts');
 const slow=setTimeout(()=>{if(id===generation)status('The forecast sources are slow right now. Atmos will keep trying.');},10000);
 try{
  const data=await api('forecast',query(),controller.signal);
  if(id!==generation)return;
  if(radarMeta&&sameSpot(radarMeta.location,data.location)&&Date.now()-Date.parse(radarMeta.precipitation?.observedAt)<=10*60000)data.current.radarPrecipitation=radarMeta.precipitation;
  forecast=alertSnapshot?withLiveAlerts(data,alertSnapshot):data;loadedAt=Date.now();
  briefing=briefing?.signature===data.signature?briefing:null;
  rebuild(keepTime);
  status('');
  void loadRadar(id);
  void loadBriefing(id);
 }catch(error){
  if(id!==generation||error.name==='AbortError')return;
  if(error.status===401){status('Your weather sign-in expired. Sign in again to keep Atmos updating.',true);addSignIn();return;}
  status(forecast?`Couldn’t refresh. Showing the forecast checked at ${clockLabel(Date.parse(forecast.assembledAt),zone())}.`:(error.message||'The forecast is unavailable right now. Tap refresh to try again.'),true);
 }finally{clearTimeout(slow);if(id===generation)$('refresh').classList.remove('busy');}
}
function addSignIn(){
 const node=$('status');if(node.querySelector('a'))return;
 const link=document.createElement('a');link.href=`/weather-fusion/login?returnTo=${encodeURIComponent('/weather-fusion/atmos.html')}`;link.textContent=' Sign in';node.append(link);
}
const sameSpot=(a,b)=>finite(a?.latitude)&&finite(b?.latitude)&&Math.abs(a.latitude-b.latitude)<.0002&&Math.abs(a.longitude-b.longitude)<.0002;
async function loadRadar(id){
 try{
  const data=await api('radar',query(),controller.signal,20000);
  if(id!==generation||!forecast||!data?.precipitation||data.status!=='ready')return;
  radarMeta=data;
  if(!sameSpot(data.location,forecast.location))return;
  forecast.current.radarPrecipitation=data.precipitation;
  rebuild(step()&&!step().isNow?step().time:null,{quiet:true});
 }catch{/* radar is optional; the forecast stays visible */}
}
async function loadBriefing(id){
 if(!forecast?.aiConfigured||briefing?.signature===forecast.signature){renderTake();return;}
 try{
  const data=await api('briefing',query({signature:forecast.signature}),controller.signal,90000);
  if(id!==generation||data?.signature!==forecast?.signature)return;
  briefing=data;renderTake();
 }catch{renderTake();}
}
let alertBusy=false;
async function refreshAlerts(){
 if(!forecast||alertBusy||document.hidden)return;
 alertBusy=true;const spot={...forecast.location};
 try{
  const data=await api('alerts',new URLSearchParams({latitude:spot.latitude,longitude:spot.longitude}),undefined,15000);
  if(!forecast||alertLocationKey(data.location)!==alertLocationKey(forecast.location))return;
  alertSnapshot=retainUnverifiedAlerts(alertSnapshot||forecast,data);
 }catch{
  if(forecast)alertSnapshot={location:spot,alerts:alertSnapshot?.alerts||forecast.alerts||[],feeds:[{id:'alerts',status:'unavailable',message:'Independent warning refresh failed.'}]};
 }finally{
  alertBusy=false;
  if(forecast&&alertSnapshot){forecast=withLiveAlerts(forecast,alertSnapshot);renderAlerts();}
 }
}

/* ---------- Building ---------- */
function rebuild(keepTime=null,{quiet=false}={}){
 const now=Date.now();
 $('main').hidden=false;$('clock').hidden=false;$('jump').hidden=false;
 const built=safe('timeline',()=>buildTimeline(forecast,now),[]);
 if(!built.length){status('The hourly forecast is missing from this update.',true);return;}
 steps=built;
 dressing=safe('dressing',()=>dressingTimeline(steps,sampleAt),[]);
 blendRows=safe('blend',()=>consensus(steps),[]);
 grid=safe('grid',()=>comfortGrid(forecast,now),[]);
 days=safe('days',()=>dailyOutlook(forecast,now),[]);
 const keep=keepTime?steps.findIndex(s=>s.time===keepTime):-1;
 selected=keep>=0?keep:0;
 const input=$('hour');input.max=String(steps.length-1);input.value=String(selected);
 sky.setLocation(forecast.location.latitude,forecast.location.longitude);
 renderPlace();renderAlerts();renderTake();
 drawStrip();renderBlendChart();renderRainChart();renderGrid();renderDays();renderSources();
 section('lab',()=>{renderLabControls();updateLab();});
 section('street-air',renderAir);
 select(selected,{instant:true,quiet});
 requestAnimationFrame(()=>{sky.resize();drawStrip();});
}
function safe(name,fn,fallback){
 try{return fn();}catch(error){console.error(`Atmos ${name} failed`,error);return fallback;}
}
function section(id,fn){
 try{fn();}catch(error){
  console.error(`Atmos ${id} failed`,error);
  const node=$(id),message='<p class="lead section-error">This part of the forecast could not be drawn. The rest of the page is unaffected.</p>';
  if(!node)return;
  if(node.classList.contains('glass')){if(!node.querySelector('.section-error'))node.insertAdjacentHTML('beforeend',message);}
  else node.innerHTML=message;
 }
}

/* ---------- Selecting an hour ---------- */
function select(index,{instant=false,fromPlay=false}={}){
 if(!steps.length)return;
 const next=clamp(Math.round(index),0,steps.length-1);
 const changed=next!==selected||instant;
 selected=next;
 $('hour').value=String(next);
 $('hour').setAttribute('aria-valuetext',hourText(steps[next]));
 if(!fromPlay){
  if(instant||sky.reducedMotion)paintSky(next);
  else startTween(next);
 }
 if(!changed&&!instant)return;
 renderHero();renderTicker();
 section('blend-hour',renderBlendHour);
 section('feel-ladder',renderFeel);
 section('rain-detail',renderRainDetail);
 highlightCharts();
 section('street-pavement',renderPavement);
 section('street-sun',renderSun);
 section('dressed',()=>renderDressed(step()));
}
function hourText(s){
 if(!s)return '';
 const when=s.isNow?'Now':`${longDayLabel(s.time,zone())} ${hourLabel(s.time,zone())}`;
 return `${when}, ${deg(s.temperature)}, ${s.condition}`;
}
function startTween(target){
 cancelAnimationFrame(tween?.frame||0);
 const from=skyIndex,start=performance.now(),duration=Math.min(900,260+Math.abs(target-from)*28);
 const frame=time=>{
  const t=clamp((time-start)/duration,0,1),e=1-Math.pow(1-t,3);
  paintSky(from+(target-from)*e);
  if(t<1)tween.frame=requestAnimationFrame(frame);else tween=null;
 };
 tween={frame:requestAnimationFrame(frame)};
}

/* ---------- Play ---------- */
function setPlaying(value){
 playing=value&&steps.length>1;
 for(const button of [$('play'),$('tick-play')]){
  button.setAttribute('aria-pressed',String(playing));
  button.setAttribute('aria-label',playing?'Pause the time-lapse':'Play the next 48 hours in the sky');
 }
 $('play-text').textContent=playing?'Pause':'Play';
 sky.setTimeScale(playing?PLAY_DRIFT:1);
 cancelAnimationFrame(playFrame);clearTimeout(playFrame);
 renderCaption();
 if(!playing)return;
 cancelAnimationFrame(tween?.frame||0);tween=null;
 playhead=selected>=steps.length-1?0:selected;lastPlay=0;
 if(sky.reducedMotion){
  // Reduced motion: step hour by hour without animating the sky.
  const stepOnce=()=>{if(!playing)return;if(selected>=steps.length-1){setPlaying(false);return;}select(selected+1,{instant:true});playFrame=setTimeout(stepOnce,700);};
  playFrame=setTimeout(stepOnce,400);return;
 }
 const frame=time=>{
  if(!playing)return;
  const dt=lastPlay?Math.min(64,time-lastPlay):16;lastPlay=time;
  playhead=Math.min(steps.length-1,playhead+dt/1000*PLAY_HOURS_PER_SECOND);
  paintSky(playhead);
  const index=Math.floor(playhead);
  if(index!==selected)select(index,{fromPlay:true});
  if(playhead>=steps.length-1){setPlaying(false);select(steps.length-1,{instant:true});return;}
  playFrame=requestAnimationFrame(frame);
 };
 playFrame=requestAnimationFrame(frame);
}
function togglePlay(){
 setPlaying(!playing);
 if(playing&&$('sky-frame').getBoundingClientRect().bottom<80)$('hero').scrollIntoView({behavior:sky.reducedMotion?'auto':'smooth'});
}

/* ---------- Hero ---------- */
function renderPlace(){
 const name=place?.name||forecast?.location?.name||'Selected location';
 $('place-name').textContent=name;$('place-button-label').textContent=name;
 document.title=`Atmos · ${name}`;
}
const DEW_SHORT={parched:'Very dry',crisp:'Crisp',dry:'Dry',nice:'Comfortable','nice-breeze':'Breeze helps',humid:'A bit humid',gross:'Sticky',nogo:'Muggy',nope:'Very muggy',unknown:''};
const FEEL_NOW={c3:'Feels freezing right now.',c2:'Feels cold right now.',c1:'Feels cool right now.',n:'Feels comfortable right now.',w1:'Feels warm right now.',w2:'Feels hot right now.',w3:'Feels very hot right now.'};
function dayWord(time,now=Date.now()){
 const z=zone(),a=localParts(now,z).date,b=localParts(time,z).date;
 const days=Math.round((Date.parse(`${b}T12:00:00Z`)-Date.parse(`${a}T12:00:00Z`))/86400000);
 return days<=0?'today':days===1?'tomorrow':longDayLabel(time,z);
}
/** "tomorrow 10 AM–2 PM" for a short stretch, "starts Monday 7 AM" for a long one. */
function windowText(w,from=w.start){
 const z=zone(),start=hourLabel(from,z),end=hourLabel(w.end,z),same=localParts(from,z).date===localParts(w.end-1,z).date;
 if(!same||w.end-from>10*H)return `starts ${dayWord(from)} ${start}`;
 const a=start.split(' '),b=end.split(' ');
 return `${dayWord(from)} ${a[1]===b[1]?`${a[0]}–${end}`:`${start}–${end}`}`;
}
function headlineText(){
 const s=steps[0];if(!s)return '';
 const now=Date.now(),z=zone(),parts=[];
 const cell=grid.flatMap(row=>row.cells).find(c=>c&&c.time===s.hourStart);
 if(cell?.perfect)parts.push('A perfect hour to be outside.');
 else{const bin=comfortBin(s.feels);if(bin)parts.push(FEEL_NOW[bin.key]);}
 const outlook=rainOutlook(steps);
 if(outlook.kind==='now')parts.push('Rain is falling now.');
 else if(outlook.kind==='storm')parts.push(`Storms possible ${relativeHour(outlook.step.time,now,z)}.`);
 else if(outlook.kind==='likely')parts.push(`Rain likely ${relativeHour(outlook.step.time,now,z)} (${outlook.step.rainShown}%).`);
 else if(outlook.kind==='chance')parts.push(`A chance of rain ${relativeHour(outlook.step.time,now,z)} (${outlook.step.rainShown}%).`);
 else if(outlook.kind==='slight')parts.push('Only a slight chance of rain in the next two days.');
 else if(outlook.kind==='dry')parts.push('No rain expected in the next two days.');
 // Suggest a stretch people can use: the first perfect hour between 7 AM and 10 PM.
 const awake=w=>{for(let t=w.start;t<w.end;t+=H){const h=localParts(t,z).hour;if(h>=7&&h<=21)return t;}return null;};
 const next=perfectWindows(grid).map(w=>({w,from:awake(w)})).find(({w,from})=>w.start>s.hourStart&&from!==null);
 if(!cell?.perfect&&next){const text=windowText(next.w,next.from);parts.push(text.startsWith('starts')?`The next perfect stretch ${text}.`:`Next perfect stretch: ${text}.`);}
 return parts.join(' ');
}
const FEEL_AT={c3:'Feels freezing.',c2:'Feels cold.',c1:'Feels cool.',n:'Feels comfortable.',w1:'Feels warm.',w2:'Feels hot.',w3:'Feels very hot.'};
/** One plain sentence for a picked hour, so the top of the page reads the same way for every hour. */
function hourHeadline(s){
 const parts=[],cell=grid.flatMap(row=>row.cells).find(c=>c&&c.time===s.hourStart),bin=comfortBin(s.feels);
 if(cell?.perfect)parts.push('A perfect hour to be outside.');else if(bin)parts.push(FEEL_AT[bin.key]);
 if(s.kind==='storm'&&(s.rainShown??0)>=30)parts.push(`Storms possible, ${s.rainShown}% chance of rain.`);
 else if((s.rainShown??0)>=50)parts.push(`Rain likely, ${s.rainShown}% chance.`);
 else if((s.rainShown??0)>=30)parts.push(`A chance of rain, ${s.rainShown}%.`);
 else if(finite(s.rain))parts.push(s.rain>=10?'A slight chance of rain.':'Rain is unlikely.');
 if(finite(s.gust)&&s.gust>=30)parts.push(`Gusts to ${Math.round(s.gust)} mph.`);
 return parts.join(' ');
}
function renderHero(){
 const s=step();if(!s)return;
 const z=zone();
 $('when').textContent=s.isNow?`Now, ${longDayLabel(s.time,z)} ${clockLabel(s.time,z)}`:`${longDayLabel(s.time,z)} at ${hourLabel(s.time,z)}`;
 $('temp-value').innerHTML=`${finite(s.temperature)?Math.round(s.temperature):'––'}<span>°</span>`;
 $('temp-label').textContent=finite(s.temperature)?`${Math.round(s.temperature)} degrees`:'Temperature unavailable';
 renderDayLine(s);
 const condition=s.rainNow?'Rain now':s.condition;
 $('condition').textContent=condition;$('condition').classList.toggle('long',condition.length>22);
 const feels=$('feels');
 if(finite(s.feels)){
  const shade=finite(s.shade)&&Math.round(s.shade)!==Math.round(s.feels)?`, ${deg(s.shade)} in the shade`:'';
  feels.innerHTML=`Feels like <strong>${deg(s.feels)}</strong>${esc(shade)}`+(s.risk?`<br><span class="risk" data-level="${esc(s.risk.level)}" title="Estimated UTCI, not an official alert"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.5 20h19z M12 10v4.5M12 17.5v.01"/></svg>${esc(s.risk.label)}</span>`:'');
 }else feels.textContent='Feels-like is unavailable for this hour.';
 $('headline').textContent=s.isNow?headlineText():hourHeadline(s);
 $('read-rain').textContent=s.rainNow?'Now':s.rainShown!==null?`${s.rainShown}%`:finite(s.rain)?'<5%':'–';
 $('read-rain-note').textContent=s.isNow?(s.rainNote||'this hour'):(finite(s.precip)&&s.precip>=.01?inches(s.precip):'this hour');
 $('read-wind').textContent=finite(s.wind)?`${Math.round(s.wind)} mph`:'–';
 $('read-wind-note').textContent=[finite(s.windDir)?`from the ${compass(s.windDir)}`:'',finite(s.gust)&&s.gust>(s.wind||0)+2?`gusts ${Math.round(s.gust)}`:''].filter(Boolean).join(', ')||'sustained';
 $('read-dew').textContent=deg(s.dewpoint);
 $('read-dew-note').textContent=DEW_SHORT[(s.isNow?dewpointFeelLevel:forecastFeelLevel)(s.dewpoint,s.wind).key]||'';
 $('read-humidity').textContent=finite(s.humidity)?`${Math.round(s.humidity)}%`:'–';
 $('read-humidity-note').textContent=finite(s.wetBulb)?`wet bulb ${deg(s.wetBulb)}`:'relative humidity';
 $('now-button').hidden=s.isNow;
 renderCaption();
}
/** The day's high and low under the temperature, and that day's peak UV, for the hour picked. */
function renderDayLine(s){
 const z=zone(),date=localParts(s.time,z).date,day=days.find(d=>d.date===date)||null,range=$('high-low');
 range.innerHTML=day&&finite(day.high)&&finite(day.low)?`High ${deg(day.high)}<span>Low ${deg(day.low)}</span>`:'';
 range.hidden=!range.innerHTML;
 const uvDay=forecast.days?.find(d=>d.date===date)??forecast.days?.[0],uv=uvDay&&finite(uvDay.uvMax)?uvCategory(uvDay.uvMax):null;
 $('hero-uv').textContent=uv?`Peak UV ${Math.round(uvDay.uvMax)}, ${uv.label.toLowerCase()}`:'';
}
function renderCaption(){
 const s=step(),node=$('clock-caption');if(!node)return;
 if(playing)node.textContent='Playing the next 48 hours. Watch the sky, the clouds and the numbers change.';
 else if(!s||s.isNow)node.textContent='Press Play to watch the next 48 hours happen in the sky, or drag along the timeline to any hour.';
 else node.textContent=`Showing ${longDayLabel(s.time,zone())} at ${hourLabel(s.time,zone())}. Every section below follows the hour you pick.`;
}
function renderTake(){
 const node=$('take');
 if(briefing?.mode==='ai'&&briefing.signature===forecast?.signature&&briefing.headline){
  node.innerHTML=`<b>Nourie take, from the latest NWS discussion</b><q>${esc(briefing.headline)}</q>`;
  node.hidden=false;
 }else node.hidden=true;
}
function renderTicker(){
 const s=step();if(!s)return;
 $('tick-time').textContent=s.isNow?'Now':`${longDayLabel(s.time,zone()).slice(0,3)} ${hourLabel(s.time,zone())}`;
 const rain=s.rainShown!==null?`, ${s.rainShown}% rain`:'';
 $('tick-summary').textContent=`${deg(s.temperature)}, ${s.rainNow?'rain now':s.condition.toLowerCase()}${s.rainNow?'':rain}`;
 $('tick-prev').disabled=selected<=0;$('tick-next').disabled=selected>=steps.length-1;
}
function alertLevel(event=''){return /warning/i.test(event)?'warning':/watch/i.test(event)?'watch':'advisory';}
function renderAlerts(){
 const root=$('alerts');if(!forecast){root.hidden=true;$('alerts-panel').hidden=true;return;}
 const list=(forecast.alerts||[]).slice().sort((a,b)=>['warning','watch','advisory'].indexOf(alertLevel(a.event))-['warning','watch','advisory'].indexOf(alertLevel(b.event)));
 const health=alertHealth(forecast);
 const official=`https://forecast.weather.gov/MapClick.php?lat=${forecast.location.latitude}&lon=${forecast.location.longitude}`;
 const icon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>';
 root.innerHTML=list.map(alert=>`<a class="alert" data-level="${alertLevel(alert.event)}" href="${esc(official)}" rel="noopener">${icon}<div><strong>${esc(alert.event||'Weather alert')}</strong><span>${esc(alert.headline||alert.areaDesc||'Open the official NWS alert for details.')}</span></div></a>`).join('')
  +(health.verified?'':`<p class="alert-check">${esc(health.message)} <a href="${esc(official)}" rel="noopener">Official NWS forecast</a></p>`);
 root.hidden=!list.length&&health.verified;
 $('alerts-panel').hidden=root.hidden;
}

/* ---------- 48-hour strip ---------- */
const AXIS_EVERY=6;
function slotScale(n,left,right,width){const span=Math.max(1,width-left-right),stepWidth=span/Math.max(1,n);return {x:i=>left+stepWidth*(i+.5),step:stepWidth,index:x=>clamp(Math.floor((x-left)/stepWidth),0,n-1)};}
function axisLabels(scale,y){
 const z=zone(),items=[];
 steps.forEach((s,i)=>{
  const {hour}=localParts(s.time,z);
  if(!(i===0||(!s.isNow&&hour%AXIS_EVERY===0)))return;
  const day=hour===0&&!s.isNow;
  const label=i===0?'Now':day?longDayLabel(s.time,z).slice(0,3):hourLabel(s.time,z).replace(' ','').toLowerCase();
  // About 6.6px per character at 11.5–12px.
  const x=i===0?scale.x(0)-scale.step/2:scale.x(i),w=label.length*6.6+(day?2:0),left=i===0?x:x-w/2;
  items.push({label,x,left,right:left+w,day,start:i===0,rank:i===0?0:day?1:2});
 });
 // Place "Now" and the day names first, then hours wherever they still fit.
 const placed=[];
 for(const item of items.slice().sort((a,b)=>a.rank-b.rank||a.x-b.x)){
  if(placed.some(p=>item.left<p.right+8&&item.right>p.left-8))continue;
  placed.push(item);
 }
 return placed.sort((a,b)=>a.x-b.x).map(p=>`<text x="${p.x.toFixed(1)}" y="${y}" text-anchor="${p.start?'start':'middle'}" class="${p.day?'day':''}">${esc(p.label)}</text>`).join('');
}
function drawStrip(){
 const svg=$('strip-svg'),box=$('strip');if(!svg||!steps.length)return;
 const width=box.clientWidth,height=box.clientHeight,plot=height-24;
 const scale=slotScale(steps.length,0,0,width);
 let night='',run=null;
 const nightRect=(from,to)=>`<rect class="strip-night" x="${(scale.x(from)-scale.step/2).toFixed(1)}" y="0" width="${(scale.step*(to-from)).toFixed(1)}" height="${plot}" rx="4"/>`;
 steps.forEach((s,i)=>{if(!s.isDay){if(run===null)run=i;}else if(run!==null){night+=nightRect(run,i);run=null;}});
 if(run!==null)night+=nightRect(run,steps.length);
 const bars=steps.map((s,i)=>finite(s.rain)&&s.rain>0?`<rect class="strip-rain" x="${(scale.x(i)-Math.max(1,scale.step-2)/2).toFixed(1)}" y="${(plot-s.rain/100*(plot*.55)).toFixed(1)}" width="${Math.max(1,scale.step-2).toFixed(1)}" height="${(s.rain/100*(plot*.55)).toFixed(1)}" rx="1"/>`:'').join('');
 const temps=steps.map(s=>s.temperature).filter(finite),lo=Math.min(...temps),hi=Math.max(...temps),span=Math.max(4,hi-lo);
 const ty=v=>8+(1-(v-lo)/span)*(plot*.5);
 let path='',pen=false;
 steps.forEach((s,i)=>{if(!finite(s.temperature)){pen=false;return;}path+=`${pen?'L':'M'}${scale.x(i).toFixed(1)} ${ty(s.temperature).toFixed(1)}`;pen=true;});
 svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
 svg.innerHTML=`${night}${bars}<path class="strip-temp" d="${path}"/><g class="strip-axis"><line x1="0" x2="${width}" y1="${plot+.5}" y2="${plot+.5}"/>${axisLabels(scale,height-4)}</g><g class="strip-cursor" id="strip-cursor"><line y1="0" y2="${plot}"/><circle r="6" cy="${plot}"/></g>`;
 drawStripCursor(skyIndex);
}
function drawStripCursor(position){
 const cursor=$('strip-cursor'),box=$('strip');if(!cursor||!steps.length)return;
 const scale=slotScale(steps.length,0,0,box.clientWidth);
 const i=clamp(position,0,steps.length-1),x=scale.x(0)+i*scale.step;
 cursor.setAttribute('transform',`translate(${x.toFixed(1)} 0)`);
}
function bindStrip(){
 const box=$('strip');let dragging=false;
 const pick=event=>{const rect=box.getBoundingClientRect();const scale=slotScale(steps.length,0,0,rect.width);select(scale.index(event.clientX-rect.left));};
 box.addEventListener('pointerdown',event=>{if(!steps.length)return;dragging=true;box.setPointerCapture?.(event.pointerId);setPlaying(false);pick(event);});
 box.addEventListener('pointermove',event=>{if(dragging)pick(event);});
 const end=()=>{dragging=false;};
 box.addEventListener('pointerup',end);box.addEventListener('pointercancel',end);
 $('hour').addEventListener('input',event=>{setPlaying(false);select(Number(event.target.value));});
}

/* ---------- Blend ---------- */
const sourceColor=id=>SOURCES[id]?`var(--src-${id})`:'var(--src-other)';
function chartFrame(el,height){const width=Math.max(260,el.clientWidth||320);return {width,height};}
function niceTicks(lo,hi,target=5){
 const raw=(hi-lo)/target,mag=10**Math.floor(Math.log10(raw||1)),stepSize=[1,2,2.5,5,10].map(m=>m*mag).find(m=>m>=raw)||mag*10;
 const start=Math.floor(lo/stepSize)*stepSize,ticks=[];for(let v=start;v<=hi+1e-9;v+=stepSize)ticks.push(Math.round(v*100)/100);return ticks;
}
function linePath(points){let d='',pen=false;for(const p of points){if(!p){pen=false;continue;}d+=`${pen?'L':'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;pen=true;}return d;}
function shareList(weights){
 return Object.entries(weights||{}).filter(([,v])=>finite(v)&&v>0).sort(([a],[b])=>SOURCE_ORDER.indexOf(a)-SOURCE_ORDER.indexOf(b)).map(([id,v])=>`${sourceLabel(id)} ${Math.round(v*1000)/10}%`).join(', ');
}
function renderBlendChart(){
 section('blend-chart',()=>{
  const el=$('blend-chart'),{width,height}=chartFrame(el,el.clientWidth<600?220:280);
  const ids=presentSources(blendRows),values=blendRows.flatMap(r=>[r.min,r.max,r.blend]).filter(finite);
  $('blend-title').textContent=ids.length>1?`${countWord(ids.length)} forecasts, one temperature`:'The forecast behind the number';
  if(!values.length){el.innerHTML='<p class="lead">Source-by-source temperatures are not available for this place. The blend still uses every source that is.</p>';$('blend-keys').innerHTML='';return;}
  const left=44,right=10,top=12,bottom=26,plot=height-top-bottom;
  const ticks=niceTicks(Math.min(...values)-1,Math.max(...values)+1,4),lo=ticks[0],hi=ticks.at(-1);
  const y=v=>top+(1-(v-lo)/(hi-lo||1))*plot,scale=slotScale(blendRows.length,left,right,width);
  let band='',segment=[];
  const flush=()=>{if(segment.length>1){const upper=segment.map(([x,a])=>`${x.toFixed(1)} ${y(a).toFixed(1)}`),lower=segment.slice().reverse().map(([x,,b])=>`${x.toFixed(1)} ${y(b).toFixed(1)}`);band+=`<path class="band" d="M${upper.join('L')}L${lower.join('L')}Z"/>`;}segment=[];};
  blendRows.forEach((r,i)=>{if(finite(r.max)&&finite(r.min)&&r.sources.length>1)segment.push([scale.x(i),r.max,r.min]);else flush();});flush();
  const models=ids.map(id=>`<path class="model-line" stroke="${sourceColor(id)}" d="${linePath(blendRows.map((r,i)=>{const s=r.sources.find(x=>x.id===id);return s?[scale.x(i),y(s.value)]:null;}))}"/>`).join('');
  const blend=`<path class="blend-line" d="${linePath(blendRows.map((r,i)=>finite(r.blend)?[scale.x(i),y(r.blend)]:null))}"/>`;
  const gridLines=ticks.map(t=>`<line class="grid-line" x1="${left}" x2="${width-right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="${left-8}" y="${(y(t)+4).toFixed(1)}" text-anchor="end">${t}°</text>`).join('');
  el.innerHTML=`<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="Temperature from each forecast source and the blend">${gridLines}${band}${models}${blend}<g class="axis">${axisLabels(scale,height-6)}</g><g id="blend-cursor"></g><rect class="hit" x="${left}" y="0" width="${width-left-right}" height="${height}"/></svg>`;
  $('blend-keys').innerHTML=ids.map(id=>`<span class="key"><i style="--c:${sourceColor(id)}"></i>${esc(sourceLabel(id))}</span>`).join('')+`<span class="key"><i class="blend"></i>Weather Nourie blend</span><span class="key"><i class="band"></i>Spread between forecasts</span>`;
  bindChart(el,()=>steps.length,i=>blendTip(i));
  el.dataset.lo=lo;el.dataset.hi=hi;el.dataset.top=top;el.dataset.plot=plot;el.dataset.left=left;el.dataset.right=right;
  const policy=forecast.blendPolicy||{};
  $('blend-science').innerHTML=`<p><strong>Starting shares.</strong> ${esc(shareList(policy.sameDay))||'Not published in this update'}. Temperature uses these shares every hour. When a forecast does not cover an hour, the others split its share.</p>
   <p>The shares are Weather Nourie’s chosen starting weights, not a measured accuracy ranking. ${forecast.google?.contributes?'WeatherNext holds its 10% share only while its data is fresh for this place.':'WeatherNext is not contributing for this place right now.'}</p>
   <p>Want to see what different shares would do? Try <a href="#lab">Make your own forecast</a>.</p>`;
 });
}
function blendTip(i){
 const r=blendRows[i],s=steps[i];if(!r||!s)return '';
 const rows=r.sources.map(src=>`<span class="row"><i style="--c:${sourceColor(src.id)}"></i><b>${deg(src.value)}</b>${esc(sourceLabel(src.id))}</span>`).join('');
 return `<strong>${esc(s.isNow?'This hour':`${longDayLabel(s.time,zone()).slice(0,3)} ${hourLabel(s.time,zone())}`)}: ${deg(r.blend)} blended</strong>${rows}`;
}
function updateBlendCursor(){
 const el=$('blend-chart'),g=$('blend-cursor');if(!el||!g)return;
 const r=blendRows[selected];if(!r){g.innerHTML='';return;}
 const width=el.querySelector('svg')?.viewBox.baseVal.width||el.clientWidth,{lo,hi,top,plot,left,right}=Object.fromEntries(Object.entries(el.dataset).map(([k,v])=>[k,Number(v)]));
 const scale=slotScale(blendRows.length,left,right,width),x=scale.x(selected),y=v=>top+(1-(v-lo)/(hi-lo||1))*plot;
 g.innerHTML=`<line class="cursor-line" x1="${x}" x2="${x}" y1="${top-4}" y2="${top+plot}"/>`+r.sources.map(s=>`<circle class="cursor-dot" cx="${x}" cy="${y(s.value).toFixed(1)}" r="4.5" fill="${sourceColor(s.id)}"/>`).join('')+(finite(r.blend)?`<circle class="cursor-dot" cx="${x}" cy="${y(r.blend).toFixed(1)}" r="6" fill="var(--ink)"/>`:'');
}
function renderBlendHour(){
 const el=$('blend-hour'),s=step();
 let r=blendRows[selected],note='';
 if(r&&!r.sources.length&&s?.isNow){const next=blendRows.findIndex(x=>x.sources.length);if(next>=0){r=blendRows[next];note='The current hour’s model values are not published yet, so this shows the next forecast hour.';}}
 if(!r||!r.sources.length){el.innerHTML='<h3>No source breakdown for this hour</h3><p class="sub">The blend is still shown wherever the sources publish this hour.</p>';return;}
 const spread=finite(r.max)&&finite(r.min)?r.max-r.min:null;
 const when=s?.isNow?'This hour':`${longDayLabel(s.time,zone())} at ${hourLabel(s.time,zone())}`;
 const lo=Math.floor(Math.min(r.min,r.blend??r.min)-3),hi=Math.ceil(Math.max(r.max,r.blend??r.max)+3),width=Math.max(240,el.clientWidth||300),height=74,x=v=>14+(v-lo)/(hi-lo||1)*(width-28);
 const placed=[];
 const dots=r.sources.slice().sort((a,b)=>(b.weight||0)-(a.weight||0)).map(src=>{
  const cx=x(src.value),radius=4+Math.sqrt(src.weight||.05)*11;let cy=34;
  for(let lift=0;lift<4&&placed.some(p=>Math.abs(p.x-cx)<p.r+radius-2&&p.y===cy);lift++)cy=34+(lift%2?1:-1)*Math.ceil((lift+1)/2)*13;
  placed.push({x:cx,y:cy,r:radius});
  return `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="${radius.toFixed(1)}" fill="${sourceColor(src.id)}" stroke="#fff" stroke-width="2" opacity=".95"><title>${esc(sourceLabel(src.id))} ${deg(src.value)}, ${Math.round((src.weight||0)*100)}% share</title></circle>`;
 }).join('');
 const ticks=niceTicks(lo,hi,4).filter(t=>t>=lo&&t<=hi).map(t=>`<line class="grid-line" x1="${x(t)}" x2="${x(t)}" y1="12" y2="58"/><text x="${x(t)}" y="72" text-anchor="middle">${t}°</text>`).join('');
 const blendMark=finite(r.blend)?`<line x1="${x(r.blend)}" x2="${x(r.blend)}" y1="8" y2="60" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/><text x="${x(r.blend)}" y="4" text-anchor="middle" style="fill:var(--ink);font-weight:700">${deg(r.blend)}</text>`:'';
 const rows=r.sources.map(src=>`<tr><th scope="row"><span class="who"><i style="--c:${sourceColor(src.id)}"></i>${esc(sourceLabel(src.id))}</span></th><td>${deg(src.value)}</td><td>${finite(src.weight)?`${Math.round(src.weight*100)}%`:'–'}</td></tr>`).join('');
 el.innerHTML=`<h3>${esc(when)}</h3><p class="sub">${esc(agreementLabel(spread))}${finite(spread)?`: ${Math.round(spread)}° between the warmest and coolest forecast`:''}.</p>
  <div class="tug"><svg width="${width}" height="${height+4}" viewBox="0 0 ${width} ${height+4}" role="img" aria-label="Each forecast on a temperature line; bigger dots count for more">${ticks}${blendMark}${dots}</svg></div>
  <table class="source-table"><thead><tr><th scope="col">Forecast</th><td>Says</td><td>Counts for</td></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">Blend</th><td>${deg(r.blend)}</td><td>100%</td></tr></tfoot></table>
  <p class="verdict">${note?esc(note)+' ':''}${s?.isNow&&!note?`The big number at the top is the station reading, ${deg(s.temperature)}. These are this hour’s forecasts.`:'Bigger dots count for more of the blend.'}</p>`;
}

/* ---------- Make your own forecast ---------- */
function labSources(){
 if(!forecast)return [];
 const coverage=sourceCoverage(forecast,Date.now()),shares=recipeShares(forecast,trust);
 const listed=new Set([...shares.today,...shares.later].map(row=>row.id));
 return SOURCE_ORDER.filter(id=>coverage[id]||listed.has(id)).map(id=>({id,coverage:coverage[id]||null}));
}
function coverageText(entry){
 if(!entry)return 'Not available here right now';
 const z=zone(),ahead=(entry.last-Date.now())/H;
 if(ahead>=200)return 'Covers all 10 days';
 if(ahead>=48)return `Reaches ${longDayLabel(entry.last,z)}`;
 return `Reaches ${weekdayLabel(entry.last,z)} ${hourLabel(entry.last,z)}`;
}
let labKey='';
function renderLabControls(){
 const sources=labSources(),available=new Set(sources.filter(s=>s.coverage).map(s=>s.id));
 // A refresh that changes nothing about the sliders leaves them alone, so a drag in progress is never interrupted.
 const key=`${zone()}|${sources.map(({id,coverage})=>`${id}:${coverageText(coverage)}`).join(',')}`;
 if(key===labKey&&$('lab-sliders').children.length)return;
 labKey=key;
 const presets=LAB_PRESETS.filter(p=>!['hrrr','ecmwf','wn'].includes(p.id)||available.has(p.id));
 $('lab-presets').innerHTML=presets.map(p=>`<button type="button" data-preset="${p.id}" aria-pressed="false">${esc(p.label)}</button>`).join('');
 $('lab-presets').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{
  const preset=LAB_PRESETS.find(p=>p.id===button.dataset.preset);if(!preset)return;
  trust=normalTrust(preset.trust);syncSliders();updateLab();
 }));
 $('lab-sliders').innerHTML=sources.map(({id,coverage})=>{
  const value=TRUST_STOPS.indexOf(trust[id]);
  return `<li class="slider-row${coverage?'':' unavailable'}" data-id="${id}" style="--c:${sourceColor(id)}">
   <div class="slider-head"><label for="trust-${id}"><i></i>${esc(sourceLabel(id))}</label><output id="trust-${id}-out" for="trust-${id}"></output></div>
   <div class="slider-track"><span class="normal-tick" aria-hidden="true"></span><input type="range" id="trust-${id}" min="0" max="${TRUST_STOPS.length-1}" step="1" value="${value<0?NORMAL_STOP:value}" aria-describedby="trust-${id}-foot" ${coverage?'':'disabled'}></div>
   <p class="slider-foot" id="trust-${id}-foot"><span>${esc(coverageText(coverage))}</span><span aria-hidden="true">Off · Normal · 4×</span></p></li>`;
 }).join('')||'<li class="lead">No forecast sources are published for this place right now.</li>';
 $('lab-meet-list').innerHTML=sources.map(({id})=>`<div style="--c:${sourceColor(id)}"><dt><i></i>${esc(sourceLabel(id))}: ${esc(SOURCES[id]?.name||'')}</dt><dd>${esc(SOURCE_ABOUT[id]||'')}</dd></div>`).join('');
 $('lab-sliders').querySelectorAll('input[type=range]').forEach(input=>input.addEventListener('input',()=>{
  const id=input.closest('.slider-row').dataset.id;
  trust={...trust,[id]:TRUST_STOPS[Number(input.value)]??1};
  scheduleLab();
 }));
 renderLabScience();
}
function syncSliders(){
 $('lab-sliders').querySelectorAll('input[type=range]').forEach(input=>{
  const id=input.closest('.slider-row').dataset.id,index=TRUST_STOPS.indexOf(trust[id]);
  input.value=String(index<0?NORMAL_STOP:index);
 });
}
function scheduleLab(){cancelAnimationFrame(labFrame);labFrame=requestAnimationFrame(()=>section('lab',updateLab));}
function updateLab(){
 if(!forecast)return;
 lab=customForecast(forecast,trust,Date.now());
 writeJSON(RECIPE_KEY,trust);
 const shares=recipeShares(forecast,trust),today=new Map(shares.today.map(r=>[r.id,r]));
 $('lab-sliders').querySelectorAll('.slider-row').forEach(row=>{
  const id=row.dataset.id,input=row.querySelector('input'),index=Number(input.value),label=TRUST_LABELS[index]||'Normal';
  const share=today.get(id);
  const text=row.classList.contains('unavailable')?'Not available':share?`${label} · ${pct(share.share)} today`:`${label} · not in today’s mix`;
  row.querySelector('output').textContent=text;
  input.setAttribute('aria-valuetext',text);
  input.style.setProperty('--fill',`${index/(TRUST_STOPS.length-1)*100}%`);
  row.classList.toggle('changed',trust[id]!==1);
 });
 const preset=matchingPreset(trust);
 $('lab-presets').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.preset===preset)));
 $('lab-reset').disabled=lab.exact;
 renderMix(shares);
 $('lab-summary').innerHTML=labSummary();
 renderLabChart();
 renderLabTable();
}
function renderMix(shares){
 const bar=(title,rows)=>{
  if(!rows.length)return '';
  const segments=rows.filter(r=>r.share>0).map(r=>`<span style="flex-basis:${(r.share*100).toFixed(2)}%;--c:${sourceColor(r.id)}" ${r.id==='nbm'?'data-light':''} title="${esc(sourceLabel(r.id))} ${pct(r.share)}">${r.share>=.12?pct(r.share):''}</span>`).join('');
  const legend=rows.map(r=>`${sourceLabel(r.id)} ${pct(r.share)}`).join(' · ');
  return `<div class="mix-row"><p>${esc(title)}</p><div class="mix-bar" role="img" aria-label="${esc(`${title}: ${legend}`)}">${segments||''}</div><p class="mix-legend">${esc(legend)}</p></div>`;
 };
 $('lab-mix').innerHTML=bar('Your mix for temperature, and for rain today',shares.today)+bar('Your mix for rain after today',shares.later);
}
function dayPossessive(day){return day.index===0?'Today’s':`${day.longLabel}’s`;}
function labSummary(){
 if(!lab)return '';
 if(lab.exact)return 'These are Weather Nourie’s own shares, so this is exactly the forecast on the main page. <strong>Move a slider</strong> or pick a starting point to make it yours.';
 const d=labDifferences(lab),parts=[];
 if(d.temperature&&Math.abs(d.temperature.delta)>=1){
  const t=d.temperature;
  parts.push(`Biggest change: ${esc(dayPossessive(t.day))} ${t.kind} becomes <strong>${t.mine}°</strong> instead of ${t.base}°.`);
 }
 if(d.rain&&Math.abs(d.rain.delta)>=5){
  const r=d.rain;
  parts.push(`${esc(dayPossessive(r.day))} rain chance becomes <strong>${chance(r.mine)}</strong> instead of ${chance(r.base)}.`);
 }
 if(finite(d.meanHigh)&&Math.abs(d.meanHigh)>=.5&&d.days>=3)parts.push(`Across the ${countWord(d.days).toLowerCase()} days, your highs run ${Math.abs(d.meanHigh).toFixed(1)}° ${d.meanHigh>0?'warmer':'cooler'} on average.`);
 // Say so when the forecasts left in the mix stop short of Weather Nourie's horizon.
 const covered=key=>lab.days.filter(day=>finite(day[key].high)).at(-1);
 const mine=covered('mine'),base=covered('base');
 if(base&&(!mine||mine.index<base.index))parts.push(mine?`The forecasts you kept don’t reach past ${mine.index===0?'today':mine.longLabel}, so later days are left blank.`:'The forecasts you kept don’t cover a full day, so the days are left blank.');
 if(!parts.length)parts.push('Your recipe barely changes this forecast. Right now the forecasts mostly agree, so the mix matters less.');
 return parts.join(' ');
}
function renderLabChart(){
 const el=$('lab-chart');if(!el||!lab)return;
 const rows=chartRows();
 const {width,height}=chartFrame(el,el.clientWidth<600?200:360);
 if(rows.length<2){el.innerHTML='<p class="lead">There is not enough hourly data to chart this yet.</p>';$('lab-keys').innerHTML='';return;}
 const left=44,right=10,top=12,bottom=26,plot=height-top-bottom,t0=rows[0].time,t1=rows.at(-1).time;
 const x=t=>left+(t-t0)/(t1-t0||1)*(width-left-right);
 let lo,hi,ticks;
 if(labView==='rain'){lo=0;hi=100;ticks=[0,25,50,75,100];}
 else{const values=rows.flatMap(r=>[r.base,r.mine]).filter(finite);ticks=niceTicks(Math.min(...values)-1,Math.max(...values)+1,4);lo=ticks[0];hi=ticks.at(-1);}
 const y=v=>top+(1-(v-lo)/(hi-lo||1))*plot;
 const z=zone();let seps='',labels='',lastLabel=-Infinity;
 for(const r of rows){
  const parts=localParts(r.time,z);
  if(parts.hour!==0)continue;
  const px=x(r.time);seps+=`<line class="day-sep" x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${top}" y2="${top+plot}"/>`;
  const mid=Math.min(x(r.time+12*H),width-right-12);
  if(mid-lastLabel>=28){labels+=`<text x="${mid.toFixed(1)}" y="${height-6}" text-anchor="middle" class="day">${esc(weekdayLabel(r.time,z))}</text>`;lastLabel=mid;}
 }
 const gridLines=ticks.map(t=>`<line class="grid-line" x1="${left}" x2="${width-right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="${left-8}" y="${(y(t)+4).toFixed(1)}" text-anchor="end">${t}${labView==='rain'?'%':'°'}</text>`).join('');
 const points=key=>rows.map(r=>finite(r[key])?[x(r.time),y(r[key])]:null);
 let area='';
 if(labView==='rain'){
  let run=[];
  const flush=()=>{if(run.length>1)area+=`<path class="mine-area" d="M${run[0][0].toFixed(1)} ${y(0).toFixed(1)}L${run.map(p=>`${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}L${run.at(-1)[0].toFixed(1)} ${y(0).toFixed(1)}Z"/>`;run=[];};
  for(const p of points('mine')){if(p)run.push(p);else flush();}flush();
 }
 el.innerHTML=`<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="${labView==='rain'?'Hourly rain chance':'Hourly temperature'}, your forecast and Weather Nourie’s">${gridLines}${seps}${area}<path class="mine-line" d="${linePath(points('mine'))}"/><path class="base-dash" d="${linePath(points('base'))}"/><g class="axis">${labels}</g><rect class="hit" x="${left}" y="0" width="${width-left-right}" height="${height}"/></svg>`;
 el.dataset.left=left;el.dataset.right=right;
 $('lab-keys').innerHTML=`<span class="key"><i class="mine"></i>Your forecast</span><span class="key"><i class="dash"></i>Weather Nourie</span>`;
 bindLabChart(el);
}
function chartRows(){
 const rows=(labView==='rain'?lab?.rain:lab?.temperature)||[],has=r=>finite(r.base)||finite(r.mine);
 const first=rows.findIndex(has),last=rows.findLastIndex(has);
 return first<0?[]:rows.slice(first,last+1);
}
function labTip(row){
 if(!row)return '';
 const z=zone(),when=`${weekdayLabel(row.time,z)} ${hourLabel(row.time,z)}`;
 const fmt=v=>labView==='rain'?chance(v):deg(v);
 return `<strong>${esc(when)}</strong><span class="row"><i style="--c:var(--mine)"></i><b>${fmt(row.mine)}</b>Your forecast</span><span class="row"><i style="--c:var(--ink)"></i><b>${fmt(row.base)}</b>Weather Nourie</span>`;
}
function bindLabChart(el){
 if(el.dataset.bound)return;el.dataset.bound='1';
 const nearest=event=>{
  const rows=chartRows(),svg=el.querySelector('svg');if(!rows.length||!svg)return null;
  const rect=el.getBoundingClientRect(),k=svg.viewBox.baseVal.width/rect.width,px=(event.clientX-rect.left)*k;
  const left=Number(el.dataset.left),right=Number(el.dataset.right),w=svg.viewBox.baseVal.width;
  const t=rows[0].time+(px-left)/(w-left-right)*(rows.at(-1).time-rows[0].time);
  let best=rows[0];for(const r of rows)if(Math.abs(r.time-t)<Math.abs(best.time-t))best=r;return best;
 };
 el.addEventListener('pointermove',event=>{if(event.pointerType==='touch')return;showTip(labTip(nearest(event)),event.clientX,event.clientY);});
 el.addEventListener('pointerleave',hideTip);
 el.addEventListener('click',event=>showTip(labTip(nearest(event)),event.clientX,event.clientY));
}
function renderLabTable(){
 const table=$('lab-table');if(!lab)return;
 const rows=lab.days.filter(d=>[d.base.high,d.base.low,d.mine.high,d.mine.low].some(finite));
 const cell=(mine,base,format,unit='')=>{
  if(!finite(mine)&&!finite(base))return '<td>–</td>';
  if(lab.exact)return `<td><b>${format(mine)}${finite(mine)?unit:''}</b></td>`;
  const same=format(mine)===format(base);
  return `<td><b>${format(mine)}${finite(mine)?unit:''}</b><small${same?'':' class="diff"'}>${same?'same':`WN ${format(base)}${finite(base)?unit:''}`}</small></td>`;
 };
 const temp=v=>finite(v)?`${Math.round(v)}°`:'–',amount=v=>finite(v)?(v>0&&v<.005?'0.00':v.toFixed(2)):'–';
 table.innerHTML=`<caption>${lab.exact?'Your 10 days, which right now match Weather Nourie’s exactly.':'Your 10 days. Underneath, “WN” is Weather Nourie’s number when yours is different.'}</caption>
  <thead><tr><th scope="col">Day</th><th scope="col">High</th><th scope="col">Low</th><th scope="col">Rain</th><th scope="col">Total, in</th></tr></thead>
  <tbody>${rows.map(d=>{
   const changed=!lab.exact&&(temp(d.mine.high)!==temp(d.base.high)||temp(d.mine.low)!==temp(d.base.low)||chance(d.mine.rain)!==chance(d.base.rain)||amount(d.mine.amount)!==amount(d.base.amount));
   return `<tr${changed?' class="changed"':''}><th scope="row">${esc(d.label)}<small>${esc(d.dateLabel)}</small></th>${cell(d.mine.high,d.base.high,temp)}${cell(d.mine.low,d.base.low,temp)}${cell(d.mine.rain,d.base.rain,chance)}${cell(d.mine.amount,d.base.amount,amount)}</tr>`;
  }).join('')}</tbody>`;
}
function renderLabScience(){
 const policy=forecast?.blendPolicy||{};
 $('lab-science').innerHTML=`<p><strong>The mix.</strong> Every hour, Weather Nourie averages the forecasts that cover that hour using fixed shares (${esc(shareList(policy.sameDay))||'its starting shares'}). Your sliders multiply each forecast’s share: Off removes it, 2× doubles it. The shares are then rescaled to add up to 100%.</p>
  <p><strong>Two recipes.</strong> Temperature uses the same recipe every day. For rain after today, Weather Nourie switches to a long-range recipe that leans on the European model (${esc(shareList(policy.extendedRain))||'its long-range shares'}). Your sliders tilt that recipe the same way.</p>
  <p><strong>Rain is a score.</strong> The NWS chance fills its share in proportion, and a model adds its whole share for at least 0.01 inch of rain that another source backs up, or a third of it for a trace. Past the end of the NWS hourly forecast its share adds nothing, just as on the main page.</p>
  <p><strong>Days.</strong> A day’s high and low are its warmest and coolest hours, and its rain chance is its highest hour, the same way the main page reads its hourly forecast. Rain totals add up each hour’s mix of the forecasts’ own rainfall.</p>
  <p><strong>Missing hours.</strong> When a forecast does not reach an hour (HRRR stops after a day or two, the NWS hourly forecast after about a week), the forecasts that do reach it share its weight. If none of the forecasts you kept reach an hour, that hour is left blank.</p>
  <p>Your recipe only changes this section. The sky, the clock and the rest of the page keep Weather Nourie’s forecast. It is saved in this browser for next time.</p>`;
}

/* ---------- Feel ---------- */
function binColor(bin){return bin?`var(--${bin.key})`:'var(--none)';}
const MARKS={air:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="#fff" stroke="var(--ink)" stroke-width="2.2"/></svg>',
 shade:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="var(--ink-3)" stroke="#fff" stroke-width="1.5"/></svg>',
 out:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="var(--ink)" stroke="#fff" stroke-width="1.5"/></svg>'};
function renderFeel(){
 const s=step(),ladder=$('feel-ladder'),dew=$('feel-dew');if(!s)return;
 const air=s.temperature,shade=s.shade,out=s.feels,vals=[air,shade,out].filter(finite);
 const when=s.isNow?'Right now':`${longDayLabel(s.time,zone())} at ${hourLabel(s.time,zone())}`;
 if(!vals.length)ladder.innerHTML=`<div class="ladder"><h3>${esc(when)}</h3><p class="sub">Feels-like inputs are missing for this hour.</p></div>`;
 else{
  const width=Math.max(260,ladder.clientWidth||320),lo=Math.floor((Math.min(...vals)-16)/5)*5,hi=Math.ceil((Math.max(...vals)+16)/5)*5;
  const x=v=>8+(v-lo)/(hi-lo)*(width-16);
  const zones=COMFORT_BINS.map((bin,i)=>{const from=Math.max(lo,bin.min),to=Math.min(hi,COMFORT_BINS[i+1]?.min??Infinity);return to>from?{bin,from,to}:null;}).filter(Boolean);
  const bands=zones.map(z=>{const w=x(z.to)-x(z.from);return `<rect x="${x(z.from).toFixed(1)}" y="13" width="${Math.max(0,w-2).toFixed(1)}" height="12" rx="3" fill="${binColor(z.bin)}"/>${w>78?`<text x="${(x(z.from)+4).toFixed(1)}" y="45">${esc(z.bin.label)}</text>`:''}`;}).join('');
  const dot={air:`<circle r="7" fill="#fff" stroke="var(--ink)" stroke-width="2.5"/>`,shade:`<circle r="7" fill="var(--ink-3)" stroke="#fff" stroke-width="2"/>`,out:`<circle r="9" fill="var(--ink)" stroke="#fff" stroke-width="2"/>`};
  const markers=[['shade',shade],['air',air],['out',out]].filter(([,v])=>finite(v)).map(([k,v])=>`<g transform="translate(${x(v).toFixed(1)} 19)">${dot[k]}</g>`).join('');
  const notes=[];
  if(finite(out)&&finite(shade)&&s.isDay&&Math.abs(out-shade)>=1)notes.push(`Out in the sun it feels <strong>${Math.round(Math.abs(out-shade))}° ${out>shade?'warmer':'cooler'}</strong> than in the shade.`);
  if(finite(shade)&&finite(air)&&Math.abs(shade-air)>=1)notes.push(`In the shade it feels <strong>${Math.round(Math.abs(shade-air))}° ${shade>air?'warmer':'cooler'}</strong> than the thermometer says, because of the moisture and wind.`);
  if(finite(out)&&finite(air)&&Math.abs(out-air)<1)notes.push('This hour it feels about the same as the thermometer says.');
  if(s.risk)notes.push(`<strong>${esc(s.risk.label)}</strong> on the UTCI heat and cold scale. An estimate, not an official alert.`);
  ladder.innerHTML=`<div class="ladder"><h3>${esc(when)}</h3><p class="sub">Air temperature, how it feels in the shade, and how it feels out in the open, on the same colors as the best-times chart.</p>
   <svg width="${width}" height="52" viewBox="0 0 ${width} 52" role="img" aria-label="Air ${deg(air)}, shade ${deg(shade)}, outdoors ${deg(out)}">${bands}${markers}</svg>
   <dl class="trio"><div><dt>${MARKS.air}Air</dt><dd>${deg(air)}</dd></div><div><dt>${MARKS.shade}Shade</dt><dd>${deg(shade)}</dd></div><div><dt>${MARKS.out}Outdoors</dt><dd>${deg(out)}</dd></div></dl>
   <ul class="ladder-notes">${notes.map(n=>`<li>${n}</li>`).join('')}</ul></div>`;
 }
 const level=(s.isNow?dewpointFeelLevel:forecastFeelLevel)(s.dewpoint,s.wind);
 const width=Math.max(240,dew.clientWidth||300),dx=v=>9+(clamp(v,20,80)-20)/60*(width-18);
 const bands=[[20,50,'var(--dew-dry)'],[50,60,'var(--dew-nice)'],[60,70,'var(--dew-sticky)'],[70,80,'var(--dew-muggy)']].map(([a,b,c])=>`<rect x="${dx(a).toFixed(1)}" y="8" width="${(dx(b)-dx(a)-2).toFixed(1)}" height="12" rx="3" fill="${c}"/>`).join('');
 const labels=[[20,'Dry'],[50,'Nice'],[60,'Sticky'],[70,'Muggy']].map(([v,l])=>`<text x="${dx(v).toFixed(1)}" y="40">${l}</text>`).join('');
 const marker=finite(s.dewpoint)?`<circle cx="${dx(s.dewpoint).toFixed(1)}" cy="14" r="8" fill="var(--ink)" stroke="#fff" stroke-width="2.5"/>`:'';
 dew.innerHTML=`<div class="dew-card"><h3>How sticky it feels</h3><p class="sub">The dew point measures the moisture in the air, which relative humidity hides.</p>
  <p class="dew-number"><strong>${deg(s.dewpoint)}</strong><span>dew point${finite(s.humidity)?`<br>${Math.round(s.humidity)}% humidity`:''}${finite(s.wetBulb)?`, wet bulb ${deg(s.wetBulb)}`:''}</span></p>
  <p class="dew-verdict">${esc(level.label)}</p><p class="dew-note">${esc(level.note||'')}</p>
  <div class="dew-scale"><svg width="${width}" height="46" viewBox="0 0 ${width} 46" role="img" aria-label="Dew point ${deg(s.dewpoint)} on a dry to muggy scale">${bands}${marker}${labels}</svg></div></div>`;
}

/* ---------- Rain ---------- */
function renderRainChart(){
 section('rain-chart',()=>{
  const el=$('rain-chart'),{width,height}=chartFrame(el,el.clientWidth<600?176:210);
  const left=44,right=10,top=12,bottom=26,plot=height-top-bottom,scale=slotScale(steps.length,left,right,width);
  const y=v=>top+(1-v/100)*plot,barW=Math.max(2,Math.min(18,scale.step-2));
  const ids=new Set();
  const cols=steps.map((s,i)=>{
   const b=rainBreakdown(s.rainLikelihood);if(!b)return '';
   let base=0,segs='';
   for(const row of b.rows){if(!(row.points>0))continue;ids.add(row.id);const h=row.points/100*plot,gap=h>3?1:0;segs+=`<rect x="${(scale.x(i)-barW/2).toFixed(1)}" y="${(y(base)-h+gap).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(.5,h-gap*2).toFixed(1)}" rx="1.5" fill="${sourceColor(row.id)}"/>`;base+=row.points;}
   return `<g class="rain-col" data-i="${i}">${segs}</g>`;
  }).join('');
  const gridLines=[0,25,50,75,100].map(t=>`<line class="${t?'grid-line':'base-line'}" x1="${left}" x2="${width-right}" y1="${y(t)}" y2="${y(t)}"/><text x="${left-8}" y="${y(t)+4}" text-anchor="end">${t}%</text>`).join('');
  el.innerHTML=`<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="Rain chance by hour, stacked by source">${gridLines}${cols}<g class="axis">${axisLabels(scale,height-6)}</g><g id="rain-cursor"></g><rect class="hit" x="${left}" y="0" width="${width-left-right}" height="${height}"/></svg>`;
  const order=SOURCE_ORDER.filter(id=>ids.has(id)).concat([...ids].filter(id=>!SOURCES[id]));
  $('rain-keys').innerHTML=order.map(id=>`<span class="key"><i class="swatch" style="--c:${sourceColor(id)}"></i>${esc(sourceLabel(id))}</span>`).join('')||'<span>No forecast shows rain in the next 48 hours.</span>';
  bindChart(el,()=>steps.length,i=>rainTip(i));
  el.dataset.left=left;el.dataset.right=right;el.dataset.top=top;el.dataset.plot=plot;
  const policy=forecast.blendPolicy||{};
  $('rain-science').innerHTML=`<p><strong>It is a score, not a single forecast’s chance.</strong> The official NWS chance fills its share in proportion. A model adds its whole share when it forecasts at least 0.01 inch of rain in the hour and another source backs it up, a third of its share for a trace (0.001 to 0.01 inch) or for heavier rain nobody else shows, and nothing below 0.001 inch.</p>
   <p><strong>Shares today:</strong> ${esc(shareList(policy.sameDay))||'not published'}. <strong>After today:</strong> ${esc(shareList(policy.extendedRain))||'not published'}; HRRR is left out after today.</p>
   <p>If a model the score needs is missing, the page shows the official NWS chance instead, so missing data never reads as dry weather. Chances under 5% are not printed.</p>`;
 });
}
function rainTip(i){
 const s=steps[i],b=rainBreakdown(s?.rainLikelihood);if(!s)return '';
 const title=`${s.isNow?'This hour':`${longDayLabel(s.time,zone()).slice(0,3)} ${hourLabel(s.time,zone())}`}: ${b&&finite(b.total)?`${b.total}%`:'no score'}`;
 return `<strong>${esc(title)}</strong>${(b?.rows||[]).map(r=>`<span class="row"><i style="--c:${sourceColor(r.id)}"></i><b>${Math.round(r.points*10)/10}</b>${esc(sourceLabel(r.id))}</span>`).join('')}`;
}
function updateRainCursor(){
 const el=$('rain-chart');if(!el)return;
 el.querySelectorAll('.rain-col').forEach(col=>col.classList.toggle('dim',Number(col.dataset.i)!==selected));
 const g=$('rain-cursor');if(!g)return;
 const width=el.querySelector('svg')?.viewBox.baseVal.width||el.clientWidth,left=Number(el.dataset.left),right=Number(el.dataset.right),top=Number(el.dataset.top);
 const x=slotScale(steps.length,left,right,width).x(selected);
 g.innerHTML=`<path d="M${x-6} ${top-10}h12l-6 7z" fill="var(--ink)"/>`;
}
function renderRainDetail(){
 const el=$('rain-detail'),s=step();if(!s)return;
 const b=rainBreakdown(s.rainLikelihood);
 const when=s.isNow?'This hour':`${longDayLabel(s.time,zone())} at ${hourLabel(s.time,zone())}`;
 let table;
 if(!b)table=`<div><h3 class="sr-only">${esc(when)}</h3><p class="lead">No source breakdown is published for this hour${finite(s.rain)?`; the chance is ${Math.round(s.rain)}%`:''}.</p></div>`;
 else table=`<div class="hour-card"><h3>${esc(when)}: ${finite(b.total)?`${b.total}% chance`:'no score'}</h3><p class="sub">${s.isNow&&s.rainNote?`Radar right now: ${esc(s.rainNote)}. `:''}The chance is the sum of these points.</p>
  <table class="source-table"><thead><tr><th scope="col">Forecast</th><td>Points</td><td class="note">Why</td></tr></thead><tbody>${b.rows.map(r=>`<tr><th scope="row"><span class="who"><i style="--c:${sourceColor(r.id)}"></i>${esc(sourceLabel(r.id))}</span></th><td>${(Math.round(r.points*10)/10).toString()}</td><td class="note">${esc(r.note)}</td></tr>`).join('')}</tbody>
  <tfoot><tr><th scope="row">Total</th><td>${finite(b.total)?`${b.total}%`:'–'}</td><td class="note"></td></tr></tfoot></table></div>`;
 const p=forecast.precipitation,values=Object.entries(p?.sourceValues||{}).filter(([,v])=>finite(v));
 const top=Math.max(.1,...values.map(([,v])=>v));
 const amounts=finite(p?.value)?`<div><h3 class="amount-title">Next 24 hours: ${inches(p.value)}</h3><p class="amount-sub">Blended rainfall from ${esc(clockLabel(Date.parse(p.start),zone()))}. Each forecast’s own total:</p><ul class="amounts">${values.sort(([a],[b])=>SOURCE_ORDER.indexOf(a)-SOURCE_ORDER.indexOf(b)).map(([id,v])=>`<li><span>${esc(sourceLabel(id))}</span><span class="meter"><i style="--c:${sourceColor(id)};width:${(v/top*100).toFixed(1)}%"></i></span><b>${v.toFixed(2)} in</b></li>`).join('')}</ul><p class="amount-foot">Liquid equivalent from the models, not measured rainfall.</p></div>`:'';
 el.innerHTML=table+amounts;
}

/* ---------- Best hours grid ---------- */
const DARK_BINS=new Set(['c3','c2','w3']);
function renderGrid(){
 section('golden-grid',()=>{
  const el=$('golden-grid'),{width}=chartFrame(el,0),label=width<520?46:64,headerH=20,rowH=width<520?24:30,gap=2;
  const cols=24,cellW=(width-label)/cols,height=headerH+grid.length*(rowH+gap);
  const r=PERFECT_RULES;
  $('golden-science').innerHTML=`<p><strong>A perfect hour</strong> is ${r.band.min}–${r.band.max}° with wind at ${r.calm} mph or less and a dew point under ${r.dewpoint}°, or ${r.breezyBand.min}–${r.breezyBand.max}° with an ${r.breeze.min}–${r.breeze.max} mph breeze. Either way the sky has to be clear or partly cloudy, with no storm risk. These are the same rules the main page uses.</p>
   <p><strong>Every other hour</strong> is colored by its feels-like temperature. Comfortable is 65–79°, centered on the ${r.ideal}° ideal. The warm side follows the UTCI heat-stress limits (78.8°, 89.6° and 100.4°F); the cold side steps down through cool, cold and freezing.</p>
   <p>A dot marks an hour with a rain chance of 50% or more.</p>`;
  const header=[0,6,12,18].map(h=>`<text x="${(label+cellW*h).toFixed(1)}" y="13">${h===0?'12a':h===12?'12p':h<12?`${h}a`:`${h-12}p`}</text>`).join('');
  const rows=grid.map((row,ri)=>{
   const y=headerH+ri*(rowH+gap);
   const cells=row.cells.map((cell,h)=>{
    const x=label+h*cellW;
    if(!cell)return `<rect x="${(x+1.5).toFixed(1)}" y="${y+1.5}" width="${Math.max(1,cellW-3).toFixed(1)}" height="${rowH-3}" rx="3" fill="none" stroke="var(--line-2)" stroke-width="1"/>`;
    const fill=cell.perfect?'var(--gold)':binColor(cell.bin);
    const light=!cell.perfect&&DARK_BINS.has(cell.bin?.key);
    const dot=finite(cell.rain)&&cell.rain>=50?`<circle cx="${(x+cellW/2).toFixed(1)}" cy="${y+rowH/2}" r="${cell.rain>=75?3.2:2.4}" fill="${light?'#fff':'var(--ink)'}" pointer-events="none"/>`:'';
    return `<rect class="cell" data-t="${cell.time}" x="${x.toFixed(1)}" y="${y}" width="${cellW.toFixed(1)}" height="${rowH}" rx="3" fill="${fill}" opacity="${cell.past?.32:1}"/>${dot}`;
   }).join('');
   return `<text class="row-label" x="0" y="${y+rowH/2+4}">${esc(row.label)}</text>${cells}`;
  }).join('');
  el.innerHTML=`<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="Seven days by twenty-four hours, colored by how each hour will feel, with perfect hours in gold">${header}${rows}</svg>`;
  el.dataset.label=label;el.dataset.cell=cellW;el.dataset.row=rowH+gap;el.dataset.header=headerH;
  bindGrid(el);
  $('golden-legend').innerHTML='<span class="key"><i class="perfect"></i>Perfect</span>'+COMFORT_BINS.map(bin=>`<span class="key"><i class="swatch" style="--c:var(--${bin.key})"></i>${esc(bin.label)} ${esc(bin.range)}</span>`).join('')+'<span class="key"><i class="rain-mark"></i>Rain likely</span>';
  const windows=perfectWindows(grid),z=zone();
  const describe=w=>{
   const rules=w.rules.includes('A')&&w.rules.includes('B')?'Calm to breezy':w.rules.includes('A')?'Calm and dry':'Pleasant breeze';
   const temps=finite(w.low)?(Math.round(w.low)===Math.round(w.high)?`${deg(w.low)}`:`${Math.round(w.low)}–${deg(w.high)}`):'';
   return `${rules}${temps?`, ${temps}`:''}${w.rules.includes('A')&&finite(w.dewpoint)?`, dew point ${deg(w.dewpoint)}`:''}`;
  };
  const list=windows.slice(0,4).map(w=>{
   const inClock=steps.findIndex(s=>!s.isNow&&s.time===w.start);
   const span=`${longDayLabel(w.start,z)} ${hourLabel(w.start,z)} to ${localParts(w.end,z).date!==localParts(w.start,z).date?`${longDayLabel(w.end,z).slice(0,3)} `:''}${hourLabel(w.end,z)}`;
   return `<li><span class="span">${esc(span)}</span><span class="why">${esc(describe(w))}, ${w.hours} hour${w.hours===1?'':'s'}</span>${inClock>=0?`<button type="button" data-jump="${inClock}">Show it in the sky</button>`:''}</li>`;
  }).join('');
  $('golden-windows').innerHTML=windows.length?`<h3>Coming up</h3><ul class="window-list">${list}</ul>`:'<h3>No perfect hours this week</h3><p class="none">None of the next seven days has an hour that meets the rules. The colors still show the most comfortable stretches.</p>';
  $('golden-windows').querySelectorAll('[data-jump]').forEach(button=>button.addEventListener('click',()=>{setPlaying(false);select(Number(button.dataset.jump));$('hero').scrollIntoView({behavior:sky.reducedMotion?'auto':'smooth'});}));
 });
}
function gridCell(el,event){
 const rect=el.getBoundingClientRect(),svg=el.querySelector('svg');if(!svg)return null;
 const k=svg.viewBox.baseVal.width/rect.width,x=(event.clientX-rect.left)*k,y=(event.clientY-rect.top)*k;
 const col=Math.floor((x-Number(el.dataset.label))/Number(el.dataset.cell)),row=Math.floor((y-Number(el.dataset.header))/Number(el.dataset.row));
 return grid[row]?.cells[col]||null;
}
function bindGrid(el){
 if(el.dataset.bound)return;el.dataset.bound='1';
 el.addEventListener('pointermove',event=>{if(event.pointerType==='touch')return;const cell=gridCell(el,event);if(cell)showTip(cellTip(cell),event.clientX,event.clientY);else hideTip();});
 el.addEventListener('pointerleave',hideTip);
 el.addEventListener('click',event=>{const cell=gridCell(el,event);if(!cell)return;const i=steps.findIndex(s=>s.hourStart===cell.time&&!s.isNow);if(i>=0){setPlaying(false);select(i);}showTip(cellTip(cell),event.clientX,event.clientY);});
}
function cellTip(cell){
 const z=zone(),verdict=cell.perfect?`Perfect hour (${cell.perfect==='A'?'calm and dry':'pleasant breeze'})`:cell.bin?.label||'';
 return `<strong>${esc(`${longDayLabel(cell.time,z).slice(0,3)} ${hourLabel(cell.time,z)}`)}</strong>${esc(verdict)}<br>Feels like ${deg(cell.feels)}, thermometer ${deg(cell.temperature)}<br>Dew point ${deg(cell.dewpoint)}, wind ${finite(cell.wind)?Math.round(cell.wind)+' mph':'–'}<br>Rain ${finite(cell.rain)?chance(cell.rain):'–'}, ${esc(cell.condition||'')}`;
}
function updateGridSelection(){
 const s=step(),el=$('golden-grid');if(!el)return;
 el.querySelectorAll('.cell.selected').forEach(c=>c.classList.remove('selected'));
 if(!s)return;
 el.querySelector(`.cell[data-t="${s.hourStart}"]`)?.classList.add('selected');
}

/* ---------- Ten days ---------- */
const WX={
 sun:'<circle class="sun-core" cx="12" cy="12" r="4.2"/><path class="sun-core" d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
 moon:'<path d="M15.8 3.6a8.4 8.4 0 1 0 4.6 12.7 7 7 0 0 1-4.6-12.7z"/>',
 cloud:'<path d="M7.2 18.5h9.9a3.9 3.9 0 0 0 .3-7.8 5.4 5.4 0 0 0-10.4 1.4 3.2 3.2 0 0 0 .2 6.4z"/>',
 partSun:'<circle class="sun-core" cx="8.6" cy="8" r="3"/><path class="sun-core" d="M8.6 2.5v1.3M3.1 8h1.3M4.7 4.1l.9.9M12.5 4.1l-.9.9"/><path d="M8.7 19.5h8.8a3.5 3.5 0 0 0 .3-7 4.9 4.9 0 0 0-9.3 1.3 2.9 2.9 0 0 0 .2 5.7z"/>',
 partMoon:'<path d="M10.5 3.2a5 5 0 1 0 3.2 8.4 4.2 4.2 0 0 1-3.2-8.4z"/><path d="M8.7 19.5h8.8a3.5 3.5 0 0 0 .3-7 4.9 4.9 0 0 0-9.3 1.3 2.9 2.9 0 0 0 .2 5.7z"/>',
 rain:'<path d="M7.2 14.5h9.9a3.9 3.9 0 0 0 .3-7.8 5.4 5.4 0 0 0-10.4 1.4 3.2 3.2 0 0 0 .2 6.4z"/><path class="drop" d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>',
 storm:'<path d="M7.2 14h9.9a3.9 3.9 0 0 0 .3-7.8 5.4 5.4 0 0 0-10.4 1.4 3.2 3.2 0 0 0 .2 6.4z"/><path class="sun-core" d="M12.8 14.5l-2.3 3.6h3l-2.2 3.6"/>',
 snow:'<path d="M7.2 14h9.9a3.9 3.9 0 0 0 .3-7.8 5.4 5.4 0 0 0-10.4 1.4 3.2 3.2 0 0 0 .2 6.4z"/><path d="M8.5 18v.01M12 19.5v.01M15.5 18v.01M10 21.5v.01M14 21.5v.01"/>',
 fog:'<path d="M4 9h16M6 13h13M4 17h15"/>',
};
function wxIcon(kind,isDay){
 const key=kind==='clear'?(isDay?'sun':'moon'):kind==='partly-cloudy'?(isDay?'partSun':'partMoon'):kind==='storm'?'storm':kind==='rain'?'rain':kind==='snow'?'snow':kind==='fog'?'fog':'cloud';
 return `<svg class="wx" viewBox="0 0 24 24" aria-hidden="true">${WX[key]}</svg>`;
}
function renderDays(){
 section('day-list',()=>{
  const list=$('day-list');
  const values=days.flatMap(d=>[d.low,d.high,...(d.spread?[d.spread.low[0],d.spread.high[1]]:[])]).filter(finite);
  if(!values.length){list.innerHTML='<li><p class="lead">Daily highs and lows are not available in this update.</p></li>';return;}
  const lo=Math.min(...values),hi=Math.max(...values),pos=v=>((v-lo)/(hi-lo||1)*100).toFixed(2);
  const current=forecast.current?.temperature;
  list.innerHTML=days.map((d,i)=>{
   const confidence=d.confidence?.key||'unknown',lowConfidence=confidence==='low'||confidence==='very-low';
   const span=finite(d.low)&&finite(d.high)?`<span class="span" style="left:calc(${pos(d.low)}% - 5px);width:calc(${(pos(d.high)-pos(d.low)).toFixed(2)}% + 10px);background:linear-gradient(90deg,${binColor(comfortBin(d.low))},${binColor(comfortBin(d.high))})"></span>`:'';
   const whiskers=d.spread?[d.spread.low,d.spread.high].filter(([a,b])=>finite(a)&&finite(b)&&b-a>=1).map(([a,b])=>`<span class="whisker" style="left:${pos(a)}%;width:${(pos(b)-pos(a)).toString()}%"></span>`).join(''):'';
   const nowMark=i===0&&finite(current)&&current>=lo&&current<=hi?`<span class="now-mark" style="left:${pos(current)}%" title="Now ${deg(current)}"></span>`:'';
   const label=`${d.label}, ${d.dateLabel}. ${d.condition}. Low ${deg(d.low)}, high ${deg(d.high)}.${d.rainShown!==null?` Rain chance ${d.rainShown}%.`:''} Confidence ${d.confidence?.label||'unavailable'}.`;
   return `<li><button class="day-row" type="button" aria-expanded="${openDay===d.date}" aria-controls="day-more-${i}" aria-label="${esc(label)}">
     <span class="day-name">${esc(d.label)}<small>${esc(d.dateLabel)}</small><span class="conf" data-level="${esc(confidence)}" aria-hidden="true"><i></i><i></i><i></i></span></span>
     ${wxIcon(d.kind,d.isDay)}
     <span class="day-rain">${d.rainShown!==null?`${d.rainShown}%`:''}</span>
     <span class="day-low">${deg(d.low)}</span>
     <span class="range"><span class="track"></span>${whiskers}${span}${nowMark}</span>
     <span class="day-high">${deg(d.high)}</span>
    </button>${lowConfidence?'<span class="day-flag">Lower confidence than usual. Tap to see why.</span>':''}
    <div class="day-more" id="day-more-${i}" ${openDay===d.date?'':'hidden'}>${dayDetail(d)}</div></li>`;
  }).join('');
  list.querySelectorAll('.day-row').forEach((button,i)=>button.addEventListener('click',()=>{
   const more=$(`day-more-${i}`),open=more.hidden;more.hidden=!open;button.setAttribute('aria-expanded',String(open));openDay=open?days[i].date:null;
  }));
 });
}
function dayDetail(d){
 const facts=[];
 if(finite(d.amount))facts.push(`<li>Rain total <b>${inches(d.amount)}</b></li>`);
 if(finite(d.wind))facts.push(`<li>Average wind <b>${Math.round(d.wind)} mph</b></li>`);
 if(d.official&&(finite(d.official.high)||finite(d.official.low)))facts.push(`<li>NWS alone says <b>${deg(d.official.high)} / ${deg(d.official.low)}</b></li>`);
 if(finite(d.uvMax))facts.push(`<li>Peak UV <b>${Math.round(d.uvMax)}, ${esc(uvCategory(d.uvMax).label.toLowerCase())}</b></li>`);
 const spread=d.spread?`<div><strong>What each forecast says for the high</strong><ul class="spread-list">${d.spread.highs.map(s=>`<li><i style="--c:${sourceColor(s.id)}"></i>${esc(sourceLabel(s.id))} ${deg(s.value)}</li>`).join('')}</ul></div>`:'';
 const conf=d.confidence?`<p><strong>${esc(d.confidence.label)} confidence.</strong> ${esc(d.confidence.summary||'')} <span>${esc(d.confidence.note||'')}</span></p>`:'';
 return `${d.detail?`<p>${esc(d.detail)}</p>`:''}<ul class="day-facts">${facts.join('')}</ul>${spread}${conf}`;
}

/* ---------- Street level ---------- */
function renderPavement(){
 const el=$('street-pavement'),s=step();if(!s||!forecast)return;
 const now=Date.now();
 const sample=s.isNow?currentSample(forecast,now):forecastSample(forecast,new Date(s.time).toISOString());
 if(!sample){el.innerHTML='<h3 id="pavement-title">Pavement for paws</h3><p class="note">This hour’s inputs are incomplete, so there is no surface estimate.</p>';return;}
 const context={forecast:!s.isNow,condition:sample.condition,pop:sample.pop,precipitation:s.precip,rainExpected:sample.rainExpected===true,rainAround:sample.rainAround===true,radarThreat:sample.radarThreat===true};
 const result=pavementEstimate(forecast,sample.inputs,s.isNow?now:s.time,{checkedAt:now,...context});
 const title=`<h3 id="pavement-title">Pavement for paws</h3><p class="sub">${esc(petSurfaceSubtitle(result))}</p>`;
 if(result.status!=='estimated'){
  el.innerHTML=`${title}<p class="note">${esc(result.note||result.reason||'A surface estimate is unavailable.')}</p><p class="note">${esc(result.advice||'Check the actual surface with the back of your hand before a walk.')}</p>`;return;
 }
 const items=[['Concrete',result.concrete],['Asphalt',result.asphalt]];
 const lo=Math.min(40,Math.floor((Math.min(result.concrete.low,result.asphalt.low)-5)/10)*10),hi=Math.max(150,Math.ceil((result.asphalt.high+5)/10)*10);
 const width=Math.max(240,el.clientWidth-32||280),x=v=>(clamp(v,lo,hi)-lo)/(hi-lo)*(width-12)+6;
 const bars=items.map(([label,r],i)=>{const y=14+i*40;return `<text x="6" y="${y}">${label} ${deg(r.value)}</text><rect x="${x(r.low)}" y="${y+6}" width="${Math.max(2,x(r.high)-x(r.low))}" height="12" rx="5" fill="var(--w2)" opacity=".28"/><rect x="${x(lo)}" y="${y+9}" width="${Math.max(2,x(r.value)-x(lo))}" height="6" rx="3" fill="${r.value>=135?'var(--critical)':r.value>=115?'var(--w2)':'var(--ink-2)'}"/>`;}).join('');
 const paw=135<=hi?`<line class="paw-line" x1="${x(135)}" x2="${x(135)}" y1="2" y2="76"/><text x="${x(135)-4}" y="94" text-anchor="end" style="fill:var(--critical)">135° can burn paws</text>`:'';
 el.innerHTML=`${title}<p class="big"><strong>${deg(result.concrete.value)}</strong><span>concrete, asphalt ${deg(result.asphalt.value)}</span></p><svg width="${width}" height="100" viewBox="0 0 ${width} 100" role="img" aria-label="Estimated surface temperatures with their ranges">${bars}${paw}</svg><p class="note">${esc(result.note)} ${esc(result.advice)}</p>`;
}
function dayBounds(time){
 const z=zone(),{date}=localParts(time,z),next=new Date(Date.parse(`${date}T12:00:00Z`)+24*H).toISOString().slice(0,10);
 return {date,start:timeAt(date,0,z),end:timeAt(next,0,z)};
}
function renderSun(){
 const el=$('street-sun'),s=step();if(!s||!forecast)return;
 const {date,start,end}=dayBounds(s.time),published=forecast.metricForecasts?.solar?.find(d=>d.date===date)||(forecast.solar&&date===localParts(Date.parse(forecast.solar.sunrise),zone()).date?forecast.solar:null);
 const sun=sunDay(forecast.location,start,end,published),z=zone();
 const width=Math.max(240,el.clientWidth-32||280),height=122,horizon=84,x=t=>6+(t-start)/(end-start)*(width-12),y=e=>horizon-e/90*(horizon-10)*1.15;
 let above='',below='',wasUp=null;
 for(let t=start;t<=end;t+=20*60000){
  const e=sunPosition(t,forecast.location.latitude,forecast.location.longitude).altitude,up=e>=0,seg=`${x(t).toFixed(1)} ${y(Math.max(e,-10)).toFixed(1)}`;
  if(up)above+=(wasUp===true?'L':'M')+seg;else below+=(wasUp===false?'L':'M')+seg;
  wasUp=up;
 }
 const at=s.isNow?Date.now():s.time,here=sunPosition(at,forecast.location.latitude,forecast.location.longitude).altitude;
 const marker=`<circle cx="${x(at).toFixed(1)}" cy="${y(Math.max(here,-10)).toFixed(1)}" r="8" fill="${here>0?'var(--gold)':'#CBD5E1'}" stroke="${here>0?'#fff':'var(--ink-3)'}" stroke-width="2.5"/>`;
 const day=forecast.days?.find(d=>d.date===date),uv=finite(day?.uvMax)?uvCategory(day.uvMax):null;
 const length=finite(sun.dayLength)?`${Math.floor(sun.dayLength/H)} h ${Math.round(sun.dayLength%H/60000)} m`:'–';
 el.innerHTML=`<h3 id="sun-title">Sun and UV</h3><p class="sub">${esc(longDayLabel(start+12*H,z))}${finite(sun.peakElevation)?`, the sun peaks ${Math.round(sun.peakElevation)}° high`:''}</p>
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="The sun’s path across the day"><line class="horizon-line" x1="0" x2="${width}" y1="${horizon}" y2="${horizon}"/><path class="sun-arc-night" d="${below}"/><path class="sun-path" d="${above}"/>${marker}
  ${finite(sun.sunrise)?`<text x="${x(sun.sunrise)}" y="${horizon+28}" text-anchor="middle">${esc(clockLabel(sun.sunrise,z))}</text>`:''}${finite(sun.sunset)?`<text x="${x(sun.sunset)}" y="${horizon+28}" text-anchor="middle">${esc(clockLabel(sun.sunset,z))}</text>`:''}</svg>
  <ul class="facts"><li><b>${length}</b>of daylight</li><li><b>${finite(sun.noon)?esc(clockLabel(sun.noon,z)):'–'}</b>sun highest</li><li><b>${finite(sun.goldenEveningStart)?esc(clockLabel(sun.goldenEveningStart,z)):'–'}</b>golden hour begins</li><li><b>${uv?`${uv.index}, ${esc(uv.label.toLowerCase())}`:'–'}</b>peak UV${finite(s.uv)?`, ${Math.round(s.uv)} this hour`:''}</li></ul>
  <p class="note">Sunrise and sunset are calculated astronomical times. Golden hour starts when the sun drops below 6°. ${uv&&uv.index>=3?'Sun protection is recommended at UV 3 and above.':''}</p>`;
}
function renderAir(){
 const el=$('street-air'),aq=forecast?.airQuality;
 if(!aq||!finite(aq.aqi)){el.innerHTML='<h3 id="air-title">Air quality</h3><p class="note">Current air-quality data is unavailable for this place. The weather forecast is unaffected.</p>';return;}
 const band=aqiBand(aq.aqi),color={good:'var(--aqi-good)',moderate:'var(--aqi-moderate)',sensitive:'var(--aqi-sensitive)',unhealthy:'var(--aqi-unhealthy)','very-unhealthy':'var(--aqi-very-unhealthy)',hazardous:'var(--aqi-hazardous)'}[band.key]||'var(--none)';
 const parts=[finite(aq.pm25)?`<li><b>${aq.pm25.toFixed(1)}</b>PM2.5, µg/m³</li>`:'',finite(aq.ozone)?`<li><b>${Math.round(aq.ozone)}</b>ozone, µg/m³</li>`:'',finite(aq.next24HourPeak)?`<li><b>${Math.round(aq.next24HourPeak)}</b>next 24 h peak</li>`:''].join('');
 el.innerHTML=`<h3 id="air-title">Air quality</h3><p class="sub">U.S. AQI from ${esc(aq.source||'Open-Meteo / CAMS')}</p><div class="aqi-ring"><strong>${Math.round(aq.aqi)}</strong><span class="aqi-pill" style="--aqi:${color}">${esc(band.label)}</span></div><p class="note">${esc(band.summary)}</p>${parts?`<ul class="facts">${parts}</ul>`:''}`;
}

/* ---------- Sources ---------- */
function renderSources(){
 section('source-copy',()=>{
  const runs=(forecast.modelContributions||[]).filter(m=>m.runAt).map(m=>`${sourceLabel(m.id)} from ${clockLabel(Date.parse(m.runAt),zone())} ${longDayLabel(Date.parse(m.runAt),zone()).slice(0,3)}`).join(', ');
  const names={nws:'NWS forecast',hourly:'NWS hourly',grid:'NWS grid',afd:'Forecast discussion',observation:'Station observation',hrrr:'HRRR',ecmwf:'ECMWF',nbm:'NBM',alerts:'Alerts',wn:'WeatherNext','air-quality':'Air quality',exposure:'UV and surface weather'};
  const feeds=(forecast.feeds||[]).filter(f=>names[f.id]).map(f=>`<li data-status="${esc(f.status)}"><i></i>${esc(names[f.id])}${f.status==='ready'?'':`: ${esc(String(f.status).replace('-',' '))}`}</li>`).join('');
  $('source-copy').innerHTML=`${runs?`<p><strong>Model runs in this update.</strong> ${esc(runs)}.</p>`:''}
   <p><strong>The science.</strong> Feels-like follows the UTCI with an estimated sun load and an NWS wind-chill floor in the cold. Wet bulb uses Stull’s approximation. Pavement is a two-layer surface energy balance over the past two days of model weather, not a sidewalk sensor. The perfect-hour rules and the rain score are the same ones the main page uses.</p>
   <ul class="feed-list" aria-label="Source status">${feeds}</ul>
   <p>Updated ${esc(clockLabel(Date.parse(forecast.assembledAt),zone()))}. Sources: NOAA and the National Weather Service, NOAA HRRR and NBM, ECMWF Open Data (CC BY 4.0), Open-Meteo and CAMS air quality.</p>`;
 });
}

/* ---------- Tooltips & charts ---------- */
const tip=$('tip');
let tipScroll=0;
function showTip(html,x,y){
 if(!html){hideTip();return;}
 tip.innerHTML=html;tip.hidden=false;tipScroll=scrollY;
 const w=tip.offsetWidth,h=tip.offsetHeight;
 tip.style.left=`${clamp(x+14,8,innerWidth-w-8)}px`;tip.style.top=`${clamp(y-h-14,8,innerHeight-h-8)}px`;
}
function hideTip(){tip.hidden=true;}
function bindChart(el,count,content){
 if(el.dataset.bound)return;el.dataset.bound='1';
 const index=event=>{const svg=el.querySelector('svg');if(!svg)return -1;const rect=el.getBoundingClientRect(),k=svg.viewBox.baseVal.width/rect.width;return slotScale(count(),Number(el.dataset.left),Number(el.dataset.right),svg.viewBox.baseVal.width).index((event.clientX-rect.left)*k);};
 el.addEventListener('pointermove',event=>{if(event.pointerType==='touch')return;const i=index(event);if(i>=0)showTip(content(i),event.clientX,event.clientY);});
 el.addEventListener('pointerleave',hideTip);
 el.addEventListener('click',event=>{const i=index(event);if(i<0)return;setPlaying(false);select(i);if(event.pointerType!=='mouse')showTip(content(i),event.clientX,event.clientY);});
}
function highlightCharts(){updateBlendCursor();updateRainCursor();updateGridSelection();}

/* ---------- Places ---------- */
function renderPlaces(results=PRESETS,hint='Saved places'){
 $('place-hint').textContent=hint;
 $('place-list').innerHTML=results.map((p,i)=>`<li><button type="button" data-i="${i}" ${sameSpot(p,place)?'aria-current="true"':''}>${esc(p.name)}</button></li>`).join('')||'<li class="place-hint">No U.S. matches. Try a city and state, or a ZIP code.</li>';
 $('place-list').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>choosePlace(results[Number(button.dataset.i)])));
}
function choosePlace(next){
 if(!validPlace(next))return;
 place={id:next.id||'search',name:next.name||'',latitude:next.latitude,longitude:next.longitude};
 writeJSON(PLACE_KEY,place);
 $('place-dialog').close();
 setPlaying(false);forecast=null;briefing=null;alertSnapshot=null;steps=[];
 $('place-name').textContent=place.name||'Loading';sky.setLocation(place.latitude,place.longitude);
 status('Loading the forecast');
 void load({keepHour:false}).then(()=>refreshAlerts());
}
let searchTimer=0,searchId=0;
function bindPlaces(){
 $('place-button').addEventListener('click',()=>{renderPlaces();$('place-search').value='';$('place-dialog').showModal();});
 $('place-search').addEventListener('input',event=>{
  clearTimeout(searchTimer);const text=event.target.value.trim(),id=++searchId;
  if(text.length<2){renderPlaces();return;}
  searchTimer=setTimeout(async()=>{
   try{const data=await api('search',new URLSearchParams({q:text}),undefined,15000);if(id===searchId)renderPlaces((data.results||[]).filter(validPlace),'Matches');}
   catch{if(id===searchId)renderPlaces([],'Search is unavailable right now');}
  },250);
 });
 $('locate').addEventListener('click',()=>{
  if(!navigator.geolocation){$('place-hint').textContent='This browser cannot share its location. Search for a city instead.';return;}
  $('place-hint').textContent='Finding your location';
  navigator.geolocation.getCurrentPosition(position=>{
   const spot={id:'device',name:'',latitude:Number(position.coords.latitude.toFixed(4)),longitude:Number(position.coords.longitude.toFixed(4))};
   if(!validPlace(spot)){$('place-hint').textContent='Atmos covers the contiguous United States. Search for a U.S. city instead.';return;}
   writeJSON(DEVICE_KEY,{id:'device',name:'Device location',latitude:spot.latitude,longitude:spot.longitude,source:'device'});
   choosePlace(spot);
  },()=>{$('place-hint').textContent='Location is off for this site. Search for a city instead.';},{enableHighAccuracy:false,timeout:12000,maximumAge:600000});
 });
}

/* ---------- Page wiring ---------- */
function setLabView(view){
 labView=view;
 for(const [id,name] of [['lab-tab-temp','temp'],['lab-tab-rain','rain']]){
  const tab=$(id),on=name===view;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;
 }
 $('lab-chart').setAttribute('aria-labelledby',view==='rain'?'lab-tab-rain':'lab-tab-temp');
 section('lab-chart',renderLabChart);
}
function bindControls(){
 bindStrip();bindPlaces();
 $('play').addEventListener('click',togglePlay);$('tick-play').addEventListener('click',togglePlay);
 $('tick-prev').addEventListener('click',()=>{setPlaying(false);select(selected-1);});
 $('tick-next').addEventListener('click',()=>{setPlaying(false);select(selected+1);});
 $('now-button').addEventListener('click',()=>{setPlaying(false);select(0);});
 $('refresh').addEventListener('click',()=>void load());
 $('lab-reset').addEventListener('click',()=>{trust=normalTrust({});syncSliders();section('lab',updateLab);});
 $('lab-tab-temp').addEventListener('click',()=>setLabView('temp'));
 $('lab-tab-rain').addEventListener('click',()=>setLabView('rain'));
 for(const id of ['lab-tab-temp','lab-tab-rain'])$(id).addEventListener('keydown',event=>{
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
  const next=labView==='temp'?'rain':'temp';setLabView(next);$(next==='rain'?'lab-tab-rain':'lab-tab-temp').focus();
 });
 document.addEventListener('keydown',event=>{if(event.key==='Escape')hideTip();});
 // Small scroll-anchoring nudges from content changes leave the tooltip; real scrolling hides it.
 window.addEventListener('scroll',()=>{if(!tip.hidden&&Math.abs(scrollY-tipScroll)>24)hideTip();},{passive:true});
 let resizeTimer=0,lastWidth=innerWidth;
 window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{
  if(steps.length&&innerWidth!==lastWidth){lastWidth=innerWidth;drawStrip();renderBlendChart();renderRainChart();renderGrid();section('lab-chart',renderLabChart);select(selected,{instant:true});}
 },150);});
 if('ResizeObserver' in window)new ResizeObserver(()=>sky.resize()).observe($('sky-frame'));
 else window.addEventListener('resize',()=>sky.resize());
 const clockObserver=new IntersectionObserver(([entry])=>{const past=!entry.isIntersecting&&entry.boundingClientRect.top<0;$('ticker').classList.toggle('on',past&&steps.length>0);},{threshold:0,rootMargin:'-60px 0px 0px 0px'});
 clockObserver.observe($('clock'));
 const skyObserver=new IntersectionObserver(([entry])=>sky.setVisible(entry.isIntersecting),{threshold:0});
 skyObserver.observe($('sky-frame'));
 document.addEventListener('visibilitychange',()=>{
  sky.setVisible(!document.hidden);
  if(!document.hidden&&forecast&&Date.now()-loadedAt>2*60000)void load();
 });
 setInterval(()=>{if(!document.hidden)void load();},REFRESH_MS);
 setInterval(()=>void refreshAlerts(),ALERT_REFRESH_MS);
}

place=initialPlace();
$('place-name').textContent=place.name||'Finding your forecast';
$('place-button-label').textContent=place.name||'Change place';
sky.setLocation(place.latitude,place.longitude);
sky.resize();
sky.setState({time:Date.now()});
sky.start();
bindControls();
if(document.fonts?.ready)document.fonts.ready.then(()=>{if(steps.length){drawStrip();renderGrid();}});
void load({keepHour:false}).then(()=>refreshAlerts());
