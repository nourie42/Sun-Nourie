/* Atmos — Weather Nourie drawn as a living sky.
 * One forecast request (/api/weather-fusion/forecast) drives the page. The sky,
 * the 48-hour clock and every instrument below read the same canonical values
 * the main page shows; Atmos only changes how they are drawn and explained.
 * Official alerts are shown unaltered and are refreshed on their own cadence. */
import {buildTimeline,skyScene,mixScene,consensus,agreementLabel,presentSources,rainBreakdown,comfortGrid,perfectWindows,dailyOutlook,
 sunDay,COMFORT_BINS,comfortBin,SOURCES,sourceLabel,countWord,compass,hourLabel,clockLabel,longDayLabel,localParts,PRESETS,validPlace,placeFromQuery,PERFECT_RULES,H} from './atmos-model.js?v=atmos-v1';
import {createSky,moonIllumination,moonPhaseName,moonPosition,sunPosition,directionWord} from './atmos-sky.js?v=atmos-v1';
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
const round=v=>finite(v)?Math.round(v):null;
const deg=v=>finite(v)?`${Math.round(v)}°`:'–';
const inches=v=>!finite(v)?'–':v>0&&v<.01?'under 0.01 in':`${v.toFixed(2)} in`;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const DEVICE_KEY='weather-fusion-device-place',PLACE_KEY='atmos-place';
const PLAY_HOURS_PER_SECOND=3.2,PLAY_DRIFT=36,REFRESH_MS=10*60000;
const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)');

let place=null,forecast=null,steps=[],blendRows=[],grid=[],days=[],selected=0,briefing=null,radarMeta=null,alertSnapshot=null;
let generation=0,controller=null,loadedAt=0,playing=false,playhead=0,playFrame=0,lastPlay=0,tween=null,skyIndex=0,openDay=null;
const zone=()=>forecast?.location?.timeZone||'America/New_York';
const step=()=>steps[selected]||null;

/* ---------- Sky ---------- */
const sky=createSky($('sky'),{reducedMotion:!!motion?.matches,ground:'#0D1714'});
motion?.addEventListener?.('change',event=>{sky.reducedMotion=event.matches;});
function layoutSky(){
 const panel=$('panel'),hero=$('hero');
 sky.setHorizon(panel.getBoundingClientRect().top-hero.getBoundingClientRect().top);
 hero.style.setProperty('--trees',`${sky.treeHeight}px`);
}
function sceneAt(position){
 if(!steps.length)return null;
 const i=clamp(Math.floor(position),0,steps.length-1),j=Math.min(steps.length-1,i+1),f=clamp(position-i,0,1);
 const a=steps[i],b=steps[j];
 return {time:a.time+(b.time-a.time)*f,scene:mixScene(skyScene(a),skyScene(b),f)};
}
function paintSky(position){
 skyIndex=position;
 const state=sceneAt(position);
 if(state)sky.setState(state);
 renderSkyNote(state?.time);
 drawStripCursor(position);
}
function renderSkyNote(time){
 const note=$('sky-note');
 if(!note||!forecast||!finite(time))return;
 const {latitude,longitude}=forecast.location,sun=sunPosition(time,latitude,longitude);
 // Keep the label on the side of the sky away from the sun or moon it describes.
 const side=body=>((body.azimuth-75)/210)>.55?'left':'right';
 if(sun.altitude>-0.833){
  note.textContent=`Sun ${Math.max(0,Math.round(sun.altitude))}° above the horizon`;
  note.dataset.side=side(sun);
  return;
 }
 const moon=moonPosition(time,latitude,longitude),light=moonIllumination(time);
 const lit=Math.round(light.fraction*100);
 note.textContent=`${moonPhaseName(light.phase)}, ${lit}% lit, ${moon.altitude<0?'below the horizon':`${Math.round(moon.altitude)}° up in the ${directionWord(moon.azimuth)}`}`;
 note.dataset.side=moon.altitude<0?'right':side(moon);
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
let alertTimer=0,alertBusy=false;
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
 $('instruments').hidden=false;$('clock').hidden=false;
 const built=safe('timeline',()=>buildTimeline(forecast,now),[]);
 if(!built.length){status('The hourly forecast is missing from this update.',true);return;}
 steps=built;
 blendRows=safe('blend',()=>consensus(steps),[]);
 grid=safe('grid',()=>comfortGrid(forecast,now),[]);
 days=safe('days',()=>dailyOutlook(forecast,now),[]);
 const keep=keepTime?steps.findIndex(s=>s.time===keepTime):-1;
 selected=keep>=0?keep:0;
 const input=$('hour');input.max=String(steps.length-1);input.value=String(selected);
 sky.setLocation(forecast.location.latitude,forecast.location.longitude);
 renderPlace();renderAlerts();renderTake();
 drawStrip();renderBlendChart();renderRainChart();renderGrid();renderDays();renderSources();
 section('street-air',renderAir);
 select(selected,{instant:true,quiet});
 requestAnimationFrame(()=>{layoutSky();drawStrip();});
}
function safe(name,fn,fallback){
 try{return fn();}catch(error){console.error(`Atmos ${name} failed`,error);return fallback;}
}
function section(id,fn){
 try{fn();}catch(error){console.error(`Atmos ${id} failed`,error);const node=$(id);if(node)node.innerHTML='<p class="dek">This part of the forecast could not be drawn. The rest of the page is unaffected.</p>';}
}

/* ---------- Selecting an hour ---------- */
function select(index,{instant=false,fromPlay=false,quiet=false}={}){
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
  button.setAttribute('aria-label',playing?'Pause the time-lapse':'Play the next 48 hours as a time-lapse');
 }
 sky.setTimeScale(playing?PLAY_DRIFT:1);
 cancelAnimationFrame(playFrame);
 if(!playing)return;
 cancelAnimationFrame(tween?.frame||0);tween=null;
 playhead=selected>=steps.length-1?0:selected;lastPlay=0;
 if(sky.reducedMotion){
  // Reduced motion: step hour by hour without tweening the sky.
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
function togglePlay(){setPlaying(!playing);}

/* ---------- Hero ---------- */
function renderPlace(){
 const name=place?.name||forecast?.location?.name||'Selected location';
 $('place-name').textContent=name;$('place-button-label').textContent=name;
 document.title=`Atmos · ${name}`;
}
const DEW_SHORT={parched:'Very dry',crisp:'Crisp',dry:'Dry',nice:'Comfortable','nice-breeze':'Breeze helps',humid:'A bit humid',gross:'Sticky',nogo:'Muggy',nope:'Very muggy',unknown:''};
function renderHero(){
 const s=step();if(!s)return;
 const z=zone();
 $('when').textContent=s.isNow?`now, ${clockLabel(s.time,z)}`:`${longDayLabel(s.time,z)}, ${hourLabel(s.time,z)}`;
 $('temp-value').textContent=finite(s.temperature)?String(Math.round(s.temperature)):'––';
 $('temp-label').textContent=finite(s.temperature)?`${Math.round(s.temperature)} degrees`:'Temperature unavailable';
 const condition=s.rainNow?'Rain now':s.condition;
 $('condition').textContent=condition;$('condition').classList.toggle('long',condition.length>22);
 const feels=$('feels');
 if(finite(s.feels)){
  const shade=finite(s.shade)&&Math.round(s.shade)!==Math.round(s.feels)?`, ${deg(s.shade)} in the shade`:'';
  feels.innerHTML=`Feels like <strong>${deg(s.feels)}</strong> outdoors${esc(shade)}`+(s.risk?`<br><span class="risk" data-level="${esc(s.risk.level)}" title="Estimated UTCI, not an official alert"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.5 20h19z M12 10v4.5M12 17.5v.01"/></svg>${esc(s.risk.label)}</span>`:'');
 }else feels.textContent='Feels-like is unavailable for this hour.';
 const rain=s.rainNow?'Now':s.rainShown!==null?`${s.rainShown}%`:finite(s.rain)?'<5%':'–';
 $('read-rain').textContent=rain;
 $('read-rain-note').textContent=s.isNow?(s.rainNote||'this hour'):(finite(s.precip)&&s.precip>=.01?inches(s.precip):'this hour');
 $('read-wind').textContent=finite(s.wind)?`${Math.round(s.wind)} mph`:'–';
 $('read-wind-note').textContent=[finite(s.windDir)?compass(s.windDir):'',finite(s.gust)&&s.gust>(s.wind||0)+2?`gusts ${Math.round(s.gust)}`:''].filter(Boolean).join(', ')||'sustained';
 $('read-dew').textContent=deg(s.dewpoint);
 $('read-dew-note').textContent=DEW_SHORT[(s.isNow?dewpointFeelLevel:forecastFeelLevel)(s.dewpoint,s.wind).key]||'';
 $('read-humidity').textContent=finite(s.humidity)?`${Math.round(s.humidity)}%`:'–';
 $('read-humidity-note').textContent=finite(s.wetBulb)?`wet bulb ${deg(s.wetBulb)}`:'relative humidity';
 $('clock-time').textContent=s.isNow?'Drag through the next 48 hours, or press play':`${longDayLabel(s.time,z)} ${hourLabel(s.time,z)}`;
 $('clock-time').classList.toggle('hint',s.isNow);
 $('now-button').hidden=s.isNow;
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
 const root=$('alerts');if(!forecast){root.hidden=true;return;}
 const list=(forecast.alerts||[]).slice().sort((a,b)=>['warning','watch','advisory'].indexOf(alertLevel(a.event))-['warning','watch','advisory'].indexOf(alertLevel(b.event)));
 const health=alertHealth(forecast);
 const official=`https://forecast.weather.gov/MapClick.php?lat=${forecast.location.latitude}&lon=${forecast.location.longitude}`;
 const icon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/></svg>';
 root.innerHTML=list.map(alert=>`<a class="alert" data-level="${alertLevel(alert.event)}" href="${esc(official)}" rel="noopener">${icon}<div><strong>${esc(alert.event||'Weather alert')}</strong><span>${esc(alert.headline||alert.areaDesc||'Open the official NWS alert for details.')}</span></div></a>`).join('')
  +(health.verified?'':`<p class="alert-check">${esc(health.message)} <a href="${esc(official)}" rel="noopener">Official NWS forecast</a></p>`);
 root.hidden=!list.length&&health.verified;
 requestAnimationFrame(layoutSky);
}

/* ---------- 48-hour strip ---------- */
const AXIS_EVERY=6;
function slotScale(n,left,right,width){const span=Math.max(1,width-left-right),stepWidth=span/Math.max(1,n);return {x:i=>left+stepWidth*(i+.5),step:stepWidth,index:x=>clamp(Math.floor((x-left)/stepWidth),0,n-1)};}
function axisLabels(scale,y,minGap=30){
 const z=zone();let previous=-Infinity,out='';
 steps.forEach((s,i)=>{
  const {hour}=localParts(s.time,z);
  if(!(i===0||(!s.isNow&&hour%AXIS_EVERY===0)))return;
  const x=scale.x(i);if(x-previous<minGap)return;previous=x;
  const day=hour===0&&!s.isNow;
  const label=i===0?'Now':day?longDayLabel(s.time,z).slice(0,3):hourLabel(s.time,z).replace(' ','').toLowerCase();
  out+=`<text x="${x.toFixed(1)}" y="${y}" text-anchor="${i===0?'start':'middle'}" class="${day?'day':''}">${esc(label)}</text>`;
 });
 return out;
}
function drawStrip(){
 const svg=$('strip-svg'),box=$('strip');if(!svg||!steps.length)return;
 const width=box.clientWidth,height=box.clientHeight,plot=height-24;
 const scale=slotScale(steps.length,0,0,width);
 let night='',run=null;
 steps.forEach((s,i)=>{if(!s.isDay){if(run===null)run=i;}else if(run!==null){night+=`<rect class="strip-night" x="${scale.x(run)-scale.step/2}" y="0" width="${scale.step*(i-run)}" height="${plot}" rx="3"/>`;run=null;}});
 if(run!==null)night+=`<rect class="strip-night" x="${scale.x(run)-scale.step/2}" y="0" width="${scale.step*(steps.length-run)}" height="${plot}" rx="3"/>`;
 const bars=steps.map((s,i)=>finite(s.rain)&&s.rain>0?`<rect class="strip-rain" x="${(scale.x(i)-Math.max(1,scale.step-2)/2).toFixed(1)}" y="${(plot-s.rain/100*(plot*.55)).toFixed(1)}" width="${Math.max(1,scale.step-2).toFixed(1)}" height="${(s.rain/100*(plot*.55)).toFixed(1)}" rx="1"/>`:'').join('');
 const temps=steps.map(s=>s.temperature).filter(finite),lo=Math.min(...temps),hi=Math.max(...temps),span=Math.max(4,hi-lo);
 const ty=v=>6+(1-(v-lo)/span)*(plot*.5);
 let path='',pen=false;
 steps.forEach((s,i)=>{if(!finite(s.temperature)){pen=false;return;}path+=`${pen?'L':'M'}${scale.x(i).toFixed(1)} ${ty(s.temperature).toFixed(1)}`;pen=true;});
 svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
 svg.innerHTML=`${night}${bars}<path class="strip-temp" d="${path}"/><g class="strip-axis"><line x1="0" x2="${width}" y1="${plot+.5}" y2="${plot+.5}"/>${axisLabels(scale,height-4)}</g><g class="strip-cursor" id="strip-cursor"><line y1="0" y2="${plot}"/><circle r="5.5" cy="${plot}"/></g>`;
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
function renderBlendChart(){
 section('blend-chart',()=>{
  const el=$('blend-chart'),{width,height}=chartFrame(el,el.clientWidth<600?210:270);
  const ids=presentSources(blendRows),values=blendRows.flatMap(r=>[r.min,r.max,r.blend]).filter(finite);
  $('blend-title').textContent=ids.length>1?`${countWord(ids.length)} forecasts, one number`:'The forecast behind the number';
  if(!values.length){el.innerHTML='<p class="dek">Source-by-source temperatures are not available for this place. The blend still uses every source that is.</p>';$('blend-keys').innerHTML='';return;}
  const left=34,right=10,top=12,bottom=26,plot=height-top-bottom;
  const ticks=niceTicks(Math.min(...values)-1,Math.max(...values)+1,4),lo=ticks[0],hi=ticks.at(-1);
  const y=v=>top+(1-(v-lo)/(hi-lo||1))*plot,scale=slotScale(blendRows.length,left,right,width);
  let band='',segment=[];
  const flush=()=>{if(segment.length>1){const upper=segment.map(([x,a])=>`${x.toFixed(1)} ${y(a).toFixed(1)}`),lower=segment.slice().reverse().map(([x,,b])=>`${x.toFixed(1)} ${y(b).toFixed(1)}`);band+=`<path class="band" d="M${upper.join('L')}L${lower.join('L')}Z"/>`;}segment=[];};
  blendRows.forEach((r,i)=>{if(finite(r.max)&&finite(r.min)&&r.sources.length>1)segment.push([scale.x(i),r.max,r.min]);else flush();});flush();
  const models=ids.map(id=>`<path class="model-line" stroke="${sourceColor(id)}" d="${linePath(blendRows.map((r,i)=>{const s=r.sources.find(x=>x.id===id);return s?[scale.x(i),y(s.value)]:null;}))}"/>`).join('');
  const blend=`<path class="blend-line" d="${linePath(blendRows.map((r,i)=>finite(r.blend)?[scale.x(i),y(r.blend)]:null))}"/>`;
  const grid=ticks.map(t=>`<line class="grid-line" x1="${left}" x2="${width-right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="${left-8}" y="${(y(t)+4).toFixed(1)}" text-anchor="end">${t}°</text>`).join('');
  el.innerHTML=`<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="Temperature from each forecast source and the blend">${grid}${band}${models}${blend}<g class="axis">${axisLabels(scale,height-6)}</g><g id="blend-cursor"></g><rect class="hit" x="${left}" y="0" width="${width-left-right}" height="${height}"/></svg>`;
  $('blend-keys').innerHTML=ids.map(id=>`<span class="key"><i style="--c:${sourceColor(id)}"></i>${esc(sourceLabel(id))}</span>`).join('')+`<span class="key"><i class="blend"></i>Blend</span><span class="key"><i class="band"></i>Spread between sources</span>`;
  bindChart(el,blendRows.length,left,right,i=>blendTip(i));
  el.dataset.lo=lo;el.dataset.hi=hi;el.dataset.top=top;el.dataset.plot=plot;el.dataset.left=left;el.dataset.right=right;
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
 g.innerHTML=`<line class="cursor-line" x1="${x}" x2="${x}" y1="${top-4}" y2="${top+plot}"/>`+r.sources.map(s=>`<circle class="cursor-dot" cx="${x}" cy="${y(s.value).toFixed(1)}" r="4" fill="${sourceColor(s.id)}"/>`).join('')+(finite(r.blend)?`<circle class="cursor-dot" cx="${x}" cy="${y(r.blend).toFixed(1)}" r="5.5" fill="var(--frost)"/>`:'');
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
  return `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="${radius.toFixed(1)}" fill="${sourceColor(src.id)}" stroke="var(--pine)" stroke-width="2" opacity=".92"><title>${esc(sourceLabel(src.id))} ${deg(src.value)}, ${Math.round((src.weight||0)*100)}% share</title></circle>`;
 }).join('');
 const ticks=niceTicks(lo,hi,4).filter(t=>t>=lo&&t<=hi).map(t=>`<line class="grid-line" x1="${x(t)}" x2="${x(t)}" y1="12" y2="58"/><text x="${x(t)}" y="72" text-anchor="middle">${t}°</text>`).join('');
 const blendMark=finite(r.blend)?`<line x1="${x(r.blend)}" x2="${x(r.blend)}" y1="6" y2="60" stroke="var(--frost)" stroke-width="2.5" stroke-linecap="round"/><text x="${x(r.blend)}" y="4" text-anchor="middle" style="fill:var(--frost);font-weight:600">${deg(r.blend)}</text>`:'';
 const rows=r.sources.map(src=>`<tr><th scope="row"><span class="who"><i style="--c:${sourceColor(src.id)}"></i>${esc(sourceLabel(src.id))}</span></th><td>${deg(src.value)}</td><td>${finite(src.weight)?`${Math.round(src.weight*100)}%`:'–'}</td></tr>`).join('');
 el.innerHTML=`<h3>${esc(when)}</h3><p class="sub">${esc(agreementLabel(spread))}${finite(spread)?`: ${Math.round(spread)}° between the warmest and coolest forecast`:''}.</p>
  <div class="tug"><svg width="${width}" height="${height+4}" viewBox="0 0 ${width} ${height+4}" role="img" aria-label="Each source on a temperature line; bigger dots carry more weight">${ticks}${blendMark}${dots}</svg></div>
  <table class="source-table"><thead><tr><th scope="col">Source</th><td>Forecast</td><td>Share</td></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">Blend</th><td>${deg(r.blend)}</td><td>100%</td></tr></tfoot></table>
  <p class="verdict">${note?esc(note)+' ':''}${s?.isNow&&!note?`The sky above shows the station reading, ${deg(s.temperature)}. These are this hour’s forecasts.`:'Bigger dots carry a bigger share of the blend.'}</p>`;
}

/* ---------- Feel ---------- */
function binColor(bin){return bin?`var(--${bin.key})`:'var(--pine-3)';}
const MARKS={air:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="var(--pine)" stroke="var(--frost)" stroke-width="2"/></svg>',
 shade:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="var(--lichen)" stroke="var(--pine)" stroke-width="1.5"/></svg>',
 out:'<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="var(--frost)" stroke="var(--pine)" stroke-width="1.5"/></svg>'};
function renderFeel(){
 const s=step(),ladder=$('feel-ladder'),dew=$('feel-dew');if(!s)return;
 const air=s.temperature,shade=s.shade,out=s.feels,vals=[air,shade,out].filter(finite);
 const when=s.isNow?'Right now':`${longDayLabel(s.time,zone())} at ${hourLabel(s.time,zone())}`;
 if(!vals.length)ladder.innerHTML=`<div class="ladder"><h3>${esc(when)}</h3><p class="sub">Feels-like inputs are missing for this hour.</p></div>`;
 else{
  const width=Math.max(260,ladder.clientWidth||320),lo=Math.floor((Math.min(...vals)-16)/5)*5,hi=Math.ceil((Math.max(...vals)+16)/5)*5;
  const x=v=>8+(v-lo)/(hi-lo)*(width-16);
  const zones=COMFORT_BINS.map((bin,i)=>{const from=Math.max(lo,bin.min),to=Math.min(hi,COMFORT_BINS[i+1]?.min??Infinity);return to>from?{bin,from,to}:null;}).filter(Boolean);
  const bands=zones.map(z=>{const w=x(z.to)-x(z.from);return `<rect x="${x(z.from).toFixed(1)}" y="14" width="${Math.max(0,w-2).toFixed(1)}" height="10" rx="2" fill="${binColor(z.bin)}"/>${w>78?`<text x="${(x(z.from)+4).toFixed(1)}" y="44">${esc(z.bin.label)}</text>`:''}`;}).join('');
  const dot={air:`<circle r="7" fill="var(--pine)" stroke="var(--frost)" stroke-width="2.5"/>`,shade:`<circle r="7" fill="var(--lichen)" stroke="var(--pine)" stroke-width="2"/>`,out:`<circle r="9" fill="var(--frost)" stroke="var(--pine)" stroke-width="2"/>`};
  const markers=[['shade',shade],['air',air],['out',out]].filter(([,v])=>finite(v)).map(([k,v])=>`<g transform="translate(${x(v).toFixed(1)} 19)">${dot[k]}</g>`).join('');
  const notes=[];
  if(finite(out)&&finite(shade)&&s.isDay&&Math.abs(out-shade)>=1)notes.push(`Out in the sun it feels <strong>${Math.round(Math.abs(out-shade))}° ${out>shade?'warmer':'cooler'}</strong> than in the shade.`);
  if(finite(shade)&&finite(air)&&Math.abs(shade-air)>=1)notes.push(`In the shade it still feels <strong>${Math.round(Math.abs(shade-air))}° ${shade>air?'warmer':'cooler'}</strong> than the air temperature, from the moisture and wind.`);
  if(finite(out)&&finite(air)&&Math.abs(out-air)<1)notes.push('The feels-like matches the air temperature this hour.');
  if(s.risk)notes.push(`<strong>${esc(s.risk.label)}</strong> on the UTCI scale. An estimate, not an official alert.`);
  ladder.innerHTML=`<div class="ladder"><h3>${esc(when)}</h3><p class="sub">Placed on the same comfort colors as the best-hours grid.</p>
   <svg width="${width}" height="50" viewBox="0 0 ${width} 50" role="img" aria-label="Air ${deg(air)}, shade ${deg(shade)}, outdoors ${deg(out)}">${bands}${markers}</svg>
   <dl class="trio"><div><dt>${MARKS.air}Air</dt><dd>${deg(air)}</dd></div><div><dt>${MARKS.shade}Shade</dt><dd>${deg(shade)}</dd></div><div><dt>${MARKS.out}Outdoors</dt><dd>${deg(out)}</dd></div></dl>
   <ul class="ladder-notes">${notes.map(n=>`<li>${n}</li>`).join('')}</ul></div>`;
 }
 const level=(s.isNow?dewpointFeelLevel:forecastFeelLevel)(s.dewpoint,s.wind);
 const width=Math.max(240,dew.clientWidth||300),dx=v=>9+(clamp(v,20,80)-20)/60*(width-18);
 const bands=[[20,50,.12],[50,60,.24],[60,70,.4],[70,80,.62]].map(([a,b,o])=>`<rect x="${dx(a).toFixed(1)}" y="8" width="${(dx(b)-dx(a)-2).toFixed(1)}" height="10" rx="2" fill="var(--frost)" opacity="${o}"/>`).join('');
 const labels=[[20,'Dry'],[50,'Nice'],[60,'Sticky'],[70,'Muggy']].map(([v,l])=>`<text x="${dx(v).toFixed(1)}" y="38">${l}</text>`).join('');
 const marker=finite(s.dewpoint)?`<circle cx="${dx(s.dewpoint).toFixed(1)}" cy="13" r="8" fill="var(--frost)" stroke="var(--pine)" stroke-width="2.5"/>`:'';
 dew.innerHTML=`<div class="dew-card"><h3>Dew point, the Feel Meter</h3><p class="sub">The moisture in the air that relative humidity hides.</p>
  <p class="dew-number"><strong>${deg(s.dewpoint)}</strong><span>${finite(s.humidity)?`${Math.round(s.humidity)}% humidity`:''}${finite(s.wetBulb)?`<br>wet bulb ${deg(s.wetBulb)}`:''}</span></p>
  <p class="dew-verdict">${esc(level.label)}</p><p class="dew-note">${esc(level.note||'')}</p>
  <div class="dew-scale"><svg width="${width}" height="44" viewBox="0 0 ${width} 44" role="img" aria-label="Dew point ${deg(s.dewpoint)} on a dry to muggy scale">${bands}${marker}${labels}</svg></div></div>`;
}

/* ---------- Rain ---------- */
function renderRainChart(){
 section('rain-chart',()=>{
  const el=$('rain-chart'),{width,height}=chartFrame(el,el.clientWidth<600?168:200);
  const left=34,right=10,top=10,bottom=26,plot=height-top-bottom,scale=slotScale(steps.length,left,right,width);
  const y=v=>top+(1-v/100)*plot,barW=Math.max(2,Math.min(18,scale.step-2));
  const ids=new Set();
  const cols=steps.map((s,i)=>{
   const b=rainBreakdown(s.rainLikelihood);if(!b)return '';
   let base=0,segs='';
   for(const row of b.rows){if(!(row.points>0))continue;ids.add(row.id);const h=row.points/100*plot,gap=h>3?1:0;segs+=`<rect class="rain-bar" x="${(scale.x(i)-barW/2).toFixed(1)}" y="${(y(base)-h+gap).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(.5,h-gap*2).toFixed(1)}" rx="1.5" fill="${sourceColor(row.id)}"/>`;base+=row.points;}
   return `<g class="rain-col" data-i="${i}">${segs}</g>`;
  }).join('');
  const grid=[0,25,50,75,100].map(t=>`<line class="${t?'grid-line':'base-line'}" x1="${left}" x2="${width-right}" y1="${y(t)}" y2="${y(t)}"/><text x="${left-8}" y="${y(t)+4}" text-anchor="end">${t}%</text>`).join('');
  el.innerHTML=`<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="Rain score by hour, stacked by source">${grid}${cols}<g class="axis">${axisLabels(scale,height-6)}</g><g id="rain-cursor"></g><rect class="hit" x="${left}" y="0" width="${width-left-right}" height="${height}"/></svg>`;
  const order=['nws','hrrr','ecmwf','nbm','wn'].filter(id=>ids.has(id)).concat([...ids].filter(id=>!SOURCES[id]));
  $('rain-keys').innerHTML=order.map(id=>`<span class="key"><i class="swatch" style="--c:${sourceColor(id)}"></i>${esc(sourceLabel(id))}</span>`).join('')||'<span>No rain signal from any source in the next 48 hours.</span>';
  bindChart(el,steps.length,left,right,i=>rainTip(i));
  el.dataset.left=left;el.dataset.right=right;el.dataset.top=top;el.dataset.plot=plot;
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
 const width=el.querySelector('svg')?.viewBox.baseVal.width||el.clientWidth,left=Number(el.dataset.left),right=Number(el.dataset.right),top=Number(el.dataset.top),plot=Number(el.dataset.plot);
 const x=slotScale(steps.length,left,right,width).x(selected);
 g.innerHTML=`<path d="M${x-5} ${top-8}h10l-5 6z" fill="var(--sun)"/>`;
}
function renderRainDetail(){
 const el=$('rain-detail'),s=step();if(!s)return;
 const b=rainBreakdown(s.rainLikelihood);
 const when=s.isNow?'This hour':`${longDayLabel(s.time,zone())} at ${hourLabel(s.time,zone())}`;
 let table;
 if(!b)table=`<div><h3 class="sr-only">${esc(when)}</h3><p class="dek">No source breakdown is published for this hour${finite(s.rain)?`; the chance is ${Math.round(s.rain)}%`:''}.</p></div>`;
 else table=`<div class="hour-card"><h3>${esc(when)}: ${finite(b.total)?`${b.total}%`:'no score'}</h3><p class="sub">${s.isNow&&s.rainNote?`Radar right now: ${esc(s.rainNote)}. `:''}The score is the sum of these points.</p>
  <table class="source-table"><thead><tr><th scope="col">Source</th><td>Points</td><td class="note">Why</td></tr></thead><tbody>${b.rows.map(r=>`<tr><th scope="row"><span class="who"><i style="--c:${sourceColor(r.id)}"></i>${esc(sourceLabel(r.id))}</span></th><td>${(Math.round(r.points*10)/10).toString()}</td><td class="note">${esc(r.note)}</td></tr>`).join('')}</tbody>
  <tfoot><tr><th scope="row">Rain chance</th><td>${finite(b.total)?`${b.total}%`:'–'}</td><td class="note"></td></tr></tfoot></table></div>`;
 const p=forecast.precipitation,values=Object.entries(p?.sourceValues||{}).filter(([,v])=>finite(v));
 const top=Math.max(.1,...values.map(([,v])=>v));
 const amounts=finite(p?.value)?`<div><h3 class="amount-title" style="margin:0;font-size:17px;font-weight:620">Next 24 hours: ${inches(p.value)}</h3><p class="sub" style="margin:3px 0 12px;color:var(--lichen);font-size:14px">Blended liquid total from ${esc(clockLabel(Date.parse(p.start),zone()))}. Each source’s own total:</p><ul class="amounts">${values.sort(([a],[b])=>['nws','hrrr','ecmwf','nbm','wn'].indexOf(a)-['nws','hrrr','ecmwf','nbm','wn'].indexOf(b)).map(([id,v])=>`<li><span>${esc(sourceLabel(id))}</span><span class="meter"><i style="--c:${sourceColor(id)};width:${(v/top*100).toFixed(1)}%"></i></span><b>${v.toFixed(2)} in</b></li>`).join('')}</ul><p class="sub" style="margin-top:10px;color:var(--moss);font-size:13px">Liquid equivalent from the models, not measured rainfall.</p></div>`:'';
 el.innerHTML=table+amounts;
}

/* ---------- Best hours grid ---------- */
function renderGrid(){
 section('golden-grid',()=>{
  const el=$('golden-grid'),{width}=chartFrame(el,0),label=width<520?46:64,headerH=20,rowH=width<520?22:28,gap=2;
  const cols=24,cellW=(width-label)/cols,height=headerH+grid.length*(rowH+gap);
  const r=PERFECT_RULES;
  $('golden-dek').textContent=`Gold hours meet the perfect-weather rules: ${r.band.min}–${r.band.max}° with wind at ${r.calm} mph or less and a dew point under ${r.dewpoint}°, or ${r.breezyBand.min}–${r.breezyBand.max}° with an ${r.breeze.min}–${r.breeze.max} mph breeze. Either way the sky has to be clear or partly cloudy with no storm risk. Every other hour is colored by how far its feels-like is from ${r.ideal}°.`;
  const header=[0,6,12,18].map(h=>`<text x="${(label+cellW*h).toFixed(1)}" y="13">${h===0?'12a':h===12?'12p':h<12?`${h}a`:`${h-12}p`}</text>`).join('');
  const rows=grid.map((row,ri)=>{
   const y=headerH+ri*(rowH+gap);
   const cells=row.cells.map((cell,h)=>{
    const x=label+h*cellW;
    if(!cell)return `<rect x="${(x+1).toFixed(1)}" y="${y}" width="${Math.max(1,cellW-2).toFixed(1)}" height="${rowH}" rx="3" fill="none" stroke="var(--pine-3)" stroke-width="1"/>`;
    const fill=cell.perfect?'var(--sun)':binColor(cell.bin);
    const dot=finite(cell.rain)&&cell.rain>=50?`<circle cx="${(x+cellW/2).toFixed(1)}" cy="${y+rowH/2}" r="${cell.rain>=75?3:2.2}" fill="${cell.perfect?'var(--pine)':'var(--frost)'}"/>`:'';
    return `<rect class="cell" data-t="${cell.time}" x="${x.toFixed(1)}" y="${y}" width="${cellW.toFixed(1)}" height="${rowH}" rx="3" fill="${fill}" opacity="${cell.past?.3:1}"/>${dot}`;
   }).join('');
   return `<text class="row-label" x="0" y="${y+rowH/2+4}">${esc(row.label)}</text>${cells}`;
  }).join('');
  el.innerHTML=`<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="Seven days by twenty-four hours, colored by comfort with perfect hours in gold">${header}${rows}</svg>`;
  el.dataset.label=label;el.dataset.cell=cellW;el.dataset.row=rowH+gap;el.dataset.header=headerH;
  bindGrid(el);
  $('golden-legend').innerHTML=COMFORT_BINS.map(bin=>`<span class="key"><i class="swatch" style="--c:var(--${bin.key})"></i>${esc(bin.label)} ${esc(bin.range)}</span>`).join('')+'<span class="key"><i class="perfect"></i>Perfect hour</span><span class="key"><i class="rain-mark"></i>Rain likely, 50% or more</span>';
  const windows=perfectWindows(grid);
  const z=zone();
  const describe=w=>{
   const rules=w.rules.includes('A')&&w.rules.includes('B')?'Calm or breezy':w.rules.includes('A')?'Calm and dry':'Breezy';
   const temps=finite(w.low)?(Math.round(w.low)===Math.round(w.high)?`${deg(w.low)}`:`${Math.round(w.low)}–${deg(w.high)}`):'';
   return `${rules}${temps?`, ${temps}`:''}${w.rules.includes('A')&&finite(w.dewpoint)?`, dew point ${deg(w.dewpoint)}`:''}`;
  };
  const list=windows.slice(0,4).map(w=>{
   const inClock=steps.findIndex(s=>!s.isNow&&s.time===w.start);
   const span=`${longDayLabel(w.start,z)} ${hourLabel(w.start,z)} to ${localParts(w.end,z).date!==localParts(w.start,z).date?`${longDayLabel(w.end,z).slice(0,3)} `:''}${hourLabel(w.end,z)}`;
   return `<li><span class="span">${esc(span)}</span><span class="why">${esc(describe(w))}, ${w.hours} hour${w.hours===1?'':'s'}</span>${inClock>=0?`<button type="button" data-jump="${inClock}">See it in the sky</button>`:''}</li>`;
  }).join('');
  $('golden-windows').innerHTML=windows.length?`<h3>Coming up</h3><ul class="window-list">${list}</ul>`:'<h3>No perfect hours this week</h3><p class="dek" style="margin:0">None of the next seven days has an hour that meets the rules. The colors still show the most comfortable stretches.</p>';
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
 el.addEventListener('pointermove',event=>{const cell=gridCell(el,event);if(cell)showTip(cellTip(cell),event.clientX,event.clientY);else hideTip();});
 el.addEventListener('pointerleave',hideTip);
 el.addEventListener('click',event=>{const cell=gridCell(el,event);if(!cell)return;const i=steps.findIndex(s=>s.hourStart===cell.time&&!s.isNow);if(i>=0){setPlaying(false);select(i);}showTip(cellTip(cell),event.clientX,event.clientY);});
}
function cellTip(cell){
 const z=zone(),verdict=cell.perfect?`Perfect hour, rule ${cell.perfect==='A'?'A (calm and dry)':'B (breezy)'}`:cell.bin?.label||'';
 return `<strong>${esc(`${longDayLabel(cell.time,z).slice(0,3)} ${hourLabel(cell.time,z)}`)}</strong>${esc(verdict)}<br>Feels like ${deg(cell.feels)}, air ${deg(cell.temperature)}<br>Dew point ${deg(cell.dewpoint)}, wind ${finite(cell.wind)?Math.round(cell.wind)+' mph':'–'}<br>Rain ${finite(cell.rain)?Math.round(cell.rain)+'%':'–'}, ${esc(cell.condition||'')}`;
}
function updateGridSelection(){
 const s=step(),el=$('golden-grid');if(!el)return;
 el.querySelectorAll('.cell.selected').forEach(c=>c.classList.remove('selected'));
 if(!s)return;
 const target=el.querySelector(`.cell[data-t="${s.hourStart}"]`);target?.classList.add('selected');
}

/* ---------- Ten days ---------- */
const WX={
 sun:'<circle class="sun-core" cx="12" cy="12" r="4.2"/><path class="sun-core" d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
 moon:'<path d="M15.8 3.6a8.4 8.4 0 1 0 4.6 12.7 7 7 0 0 1-4.6-12.7z"/>',
 cloud:'<path d="M7.2 18.5h9.9a3.9 3.9 0 0 0 .3-7.8 5.4 5.4 0 0 0-10.4 1.4 3.2 3.2 0 0 0 .2 6.4z"/>',
 partSun:'<circle class="sun-core" cx="8.6" cy="8" r="3"/><path class="sun-core" d="M8.6 2.5v1.3M3.1 8h1.3M4.7 4.1l.9.9M12.5 4.1l-.9.9"/><path d="M8.7 19.5h8.8a3.5 3.5 0 0 0 .3-7 4.9 4.9 0 0 0-9.3 1.3 2.9 2.9 0 0 0 .2 5.7z"/>',
 partMoon:'<path d="M10.5 3.2a5 5 0 1 0 3.2 8.4 4.2 4.2 0 0 1-3.2-8.4z"/><path d="M8.7 19.5h8.8a3.5 3.5 0 0 0 .3-7 4.9 4.9 0 0 0-9.3 1.3 2.9 2.9 0 0 0 .2 5.7z"/>',
 rain:'<path d="M7.2 14.5h9.9a3.9 3.9 0 0 0 .3-7.8 5.4 5.4 0 0 0-10.4 1.4 3.2 3.2 0 0 0 .2 6.4z"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>',
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
  if(!values.length){list.innerHTML='<li><p class="dek">Daily highs and lows are not available in this update.</p></li>';return;}
  const lo=Math.min(...values),hi=Math.max(...values),pos=v=>((v-lo)/(hi-lo||1)*100).toFixed(2);
  const current=forecast.current?.temperature;
  list.innerHTML=days.map((d,i)=>{
   const confidence=d.confidence?.key||'unknown',lowConfidence=confidence==='low'||confidence==='very-low';
   const span=finite(d.low)&&finite(d.high)?`<span class="span" style="left:calc(${pos(d.low)}% - 4px);width:calc(${(pos(d.high)-pos(d.low)).toFixed(2)}% + 8px);background:linear-gradient(90deg,${binColor(comfortBin(d.low))},${binColor(comfortBin(d.high))})"></span>`:'';
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
    </button>${lowConfidence?'<span class="day-flag">Lower confidence. Tap for details.</span>':''}
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
 if(d.official&&(finite(d.official.high)||finite(d.official.low)))facts.push(`<li>NWS alone <b>${deg(d.official.high)} / ${deg(d.official.low)}</b></li>`);
 if(finite(d.uvMax))facts.push(`<li>Peak UV <b>${Math.round(d.uvMax)}, ${esc(uvCategory(d.uvMax).label.toLowerCase())}</b></li>`);
 const spread=d.spread?`<div><strong>Each forecast’s high</strong><ul class="spread-list">${d.spread.highs.map(s=>`<li><i style="--c:${sourceColor(s.id)}"></i>${esc(sourceLabel(s.id))} ${deg(s.value)}</li>`).join('')}</ul></div>`:'';
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
 const width=Math.max(240,el.clientWidth||300),x=v=>(clamp(v,lo,hi)-lo)/(hi-lo)*(width-12)+6;
 const bars=items.map(([label,r],i)=>{const y=14+i*40;return `<text x="6" y="${y}">${label} ${deg(r.value)}</text><rect x="${x(r.low)}" y="${y+6}" width="${Math.max(2,x(r.high)-x(r.low))}" height="10" rx="4" fill="var(--w2)" opacity=".35"/><rect x="${x(lo)}" y="${y+8}" width="${Math.max(2,x(r.value)-x(lo))}" height="6" rx="3" fill="${r.value>=135?'var(--critical)':r.value>=115?'var(--w3)':'var(--frost)'}"/>`;}).join('');
 const paw=135<=hi?`<line class="paw-line" x1="${x(135)}" x2="${x(135)}" y1="2" y2="74"/><text x="${x(135)-4}" y="92" text-anchor="end" style="fill:var(--serious)">135° paw burns</text>`:'';
 el.innerHTML=`${title}<p class="big"><strong>${deg(result.concrete.value)}</strong><span>concrete, asphalt ${deg(result.asphalt.value)}</span></p><svg width="${width}" height="98" viewBox="0 0 ${width} 98" role="img" aria-label="Estimated surface temperatures with their ranges">${bars}${paw}</svg><p class="note">${esc(result.note)} Ranges vary the material, wind and stored heat. ${esc(result.advice)}</p>`;
}
function dayBounds(time){
 const z=zone(),{date}=localParts(time,z),next=new Date(Date.parse(`${date}T12:00:00Z`)+24*H).toISOString().slice(0,10);
 return {date,start:timeAt(date,0,z),end:timeAt(next,0,z)};
}
function renderSun(){
 const el=$('street-sun'),s=step();if(!s||!forecast)return;
 const {date,start,end}=dayBounds(s.time),published=forecast.metricForecasts?.solar?.find(d=>d.date===date)||(forecast.solar&&date===localParts(Date.parse(forecast.solar.sunrise),zone()).date?forecast.solar:null);
 const sun=sunDay(forecast.location,start,end,published),z=zone();
 const width=Math.max(240,el.clientWidth||300),height=122,horizon=84,x=t=>6+(t-start)/(end-start)*(width-12),y=e=>horizon-e/90*(horizon-10)*1.15;
 let above='',below='',wasUp=null;
 for(let t=start;t<=end;t+=20*60000){
  const e=sunPosition(t,forecast.location.latitude,forecast.location.longitude).altitude,up=e>=0,seg=`${x(t).toFixed(1)} ${y(Math.max(e,-10)).toFixed(1)}`;
  if(up)above+=(wasUp===true?'L':'M')+seg;else below+=(wasUp===false?'L':'M')+seg;
  wasUp=up;
 }
 const here=sunPosition(s.isNow?Date.now():s.time,forecast.location.latitude,forecast.location.longitude).altitude;
 const marker=`<circle cx="${x(s.isNow?Date.now():s.time).toFixed(1)}" cy="${y(Math.max(here,-10)).toFixed(1)}" r="7" fill="${here>0?'var(--sun)':'var(--pine-3)'}" stroke="${here>0?'var(--pine)':'var(--moss)'}" stroke-width="2"/>`;
 const day=forecast.days?.find(d=>d.date===date),uv=finite(day?.uvMax)?uvCategory(day.uvMax):null;
 const length=finite(sun.dayLength)?`${Math.floor(sun.dayLength/H)} h ${Math.round(sun.dayLength%H/60000)} m`:'–';
 el.innerHTML=`<h3 id="sun-title">Sun and UV</h3><p class="sub">${esc(longDayLabel(start+12*H,z))}${finite(sun.peakElevation)?`, the sun peaks ${Math.round(sun.peakElevation)}° high`:''}</p>
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="The sun’s path across the day"><line class="horizon-line" x1="0" x2="${width}" y1="${horizon}" y2="${horizon}"/><path class="sun-arc-night" d="${below}"/><path class="sun-arc" d="${above}"/>${marker}
  ${finite(sun.sunrise)?`<text x="${x(sun.sunrise)}" y="${horizon+28}" text-anchor="middle">${esc(clockLabel(sun.sunrise,z))}</text>`:''}${finite(sun.sunset)?`<text x="${x(sun.sunset)}" y="${horizon+28}" text-anchor="middle">${esc(clockLabel(sun.sunset,z))}</text>`:''}</svg>
  <ul class="facts"><li><b>${length}</b>of daylight</li><li><b>${finite(sun.noon)?esc(clockLabel(sun.noon,z)):'–'}</b>solar noon</li><li><b>${finite(sun.goldenEveningStart)?esc(clockLabel(sun.goldenEveningStart,z)):'–'}</b>golden hour begins</li><li><b>${uv?`${uv.index}, ${esc(uv.label.toLowerCase())}`:'–'}</b>peak UV${finite(s.uv)?`, ${Math.round(s.uv)} this hour`:''}</li></ul>
  <p class="note">Sunrise and sunset are calculated astronomical times. Golden hour starts when the sun drops below 6°. ${uv&&uv.index>=3?'Sun protection is recommended at UV 3 and above.':''}</p>`;
}
function renderAir(){
 const el=$('street-air'),aq=forecast?.airQuality;
 if(!aq||!finite(aq.aqi)){el.innerHTML='<h3 id="air-title">Air quality</h3><p class="note">Current air-quality data is unavailable for this place. The weather forecast is unaffected.</p>';return;}
 const band=aqiBand(aq.aqi),color={good:'var(--good)',moderate:'var(--warning)',sensitive:'var(--serious)',unhealthy:'var(--critical)','very-unhealthy':'var(--critical)',hazardous:'var(--critical)'}[band.key]||'var(--moss)';
 const parts=[finite(aq.pm25)?`<li><b>${aq.pm25.toFixed(1)}</b>PM2.5, µg/m³</li>`:'',finite(aq.ozone)?`<li><b>${Math.round(aq.ozone)}</b>ozone, µg/m³</li>`:'',finite(aq.next24HourPeak)?`<li><b>${Math.round(aq.next24HourPeak)}</b>next 24 h peak</li>`:''].join('');
 el.innerHTML=`<h3 id="air-title">Air quality</h3><p class="sub">U.S. AQI from ${esc(aq.source||'Open-Meteo / CAMS')}</p><div class="aqi-ring"><strong>${Math.round(aq.aqi)}</strong><span class="aqi-pill" style="--aqi:${color}">${esc(band.label)}</span></div><p class="note">${esc(band.summary)}</p>${parts?`<ul class="facts">${parts}</ul>`:''}`;
}

/* ---------- Sources ---------- */
function renderSources(){
 section('source-copy',()=>{
  const policy=forecast.blendPolicy||{},share=weights=>Object.entries(weights||{}).filter(([,v])=>finite(v)&&v>0).sort(([a],[b])=>['nws','hrrr','ecmwf','nbm','wn'].indexOf(a)-['nws','hrrr','ecmwf','nbm','wn'].indexOf(b)).map(([id,v])=>`${sourceLabel(id)} ${Math.round(v*100)}%`).join(', ');
  const runs=(forecast.modelContributions||[]).filter(m=>m.runAt).map(m=>`${sourceLabel(m.id)} from ${clockLabel(Date.parse(m.runAt),zone())} ${longDayLabel(Date.parse(m.runAt),zone()).slice(0,3)}`).join(', ');
  const names={nws:'NWS forecast',hourly:'NWS hourly',grid:'NWS grid',afd:'Forecast discussion',observation:'Station observation',hrrr:'HRRR',ecmwf:'ECMWF',nbm:'NBM',alerts:'Alerts',wn:'WeatherNext','air-quality':'Air quality',exposure:'UV and surface weather'};
  const feeds=(forecast.feeds||[]).filter(f=>names[f.id]).map(f=>`<li data-status="${esc(f.status)}"><i></i>${esc(names[f.id])}${f.status==='ready'?'':`: ${esc(f.status.replace('-',' '))}`}</li>`).join('');
  $('source-copy').innerHTML=`<p><strong>The blend.</strong> Starting shares for today: ${esc(share(policy.sameDay))}${policy.extendedRain?`. Rain on later days: ${esc(share(policy.extendedRain))}`:''}. Shares are renormalized when a source is missing${forecast.google?.contributes?', and WeatherNext holds a 10% share while its data is fresh for this place':''}. These are starting weights, not a measured accuracy ranking.</p>
   ${runs?`<p><strong>Model runs in this update.</strong> ${esc(runs)}.</p>`:''}
   <p><strong>The science.</strong> Feels-like follows the UTCI with an estimated sun load and an NWS wind-chill floor in the cold. Wet bulb uses Stull’s approximation. Pavement is a two-layer surface energy balance over the past two days of model weather, not a sidewalk sensor. The perfect-hour rules and rain score are the same ones the main page uses.</p>
   <ul class="feed-list" aria-label="Source status">${feeds}</ul>
   <p>Updated ${esc(clockLabel(Date.parse(forecast.assembledAt),zone()))}. Sources: NOAA and the National Weather Service, NOAA HRRR and NBM, ECMWF Open Data (CC BY 4.0), Open-Meteo and CAMS air quality.</p>`;
 });
}

/* ---------- Tooltips & charts ---------- */
const tip=$('tip');
function showTip(html,x,y){
 if(!html){hideTip();return;}
 tip.innerHTML=html;tip.hidden=false;
 const w=tip.offsetWidth,h=tip.offsetHeight;
 tip.style.left=`${clamp(x+14,8,innerWidth-w-8)}px`;tip.style.top=`${clamp(y-h-14,8,innerHeight-h-8)}px`;
}
function hideTip(){tip.hidden=true;}
function bindChart(el,count,left,right,content){
 if(el.dataset.bound)return;el.dataset.bound='1';
 const index=event=>{const svg=el.querySelector('svg');if(!svg)return -1;const rect=el.getBoundingClientRect(),k=svg.viewBox.baseVal.width/rect.width;return slotScale(steps.length,Number(el.dataset.left),Number(el.dataset.right),svg.viewBox.baseVal.width).index((event.clientX-rect.left)*k);};
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
function bindControls(){
 bindStrip();bindPlaces();
 $('play').addEventListener('click',togglePlay);$('tick-play').addEventListener('click',togglePlay);
 $('tick-prev').addEventListener('click',()=>{setPlaying(false);select(selected-1);});
 $('tick-next').addEventListener('click',()=>{setPlaying(false);select(selected+1);});
 $('now-button').addEventListener('click',()=>{setPlaying(false);select(0);});
 $('refresh').addEventListener('click',()=>void load());
 document.addEventListener('keydown',event=>{if(event.key==='Escape')hideTip();});
 window.addEventListener('scroll',hideTip,{passive:true});
 let resizeTimer=0;
 let lastWidth=innerWidth;
 window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{layoutSky();if(steps.length&&innerWidth!==lastWidth){lastWidth=innerWidth;drawStrip();renderBlendChart();renderRainChart();renderGrid();select(selected,{instant:true});}},150);});
 const clockObserver=new IntersectionObserver(([entry])=>{const past=!entry.isIntersecting&&entry.boundingClientRect.top<0;$('ticker').classList.toggle('on',past&&steps.length>0);},{threshold:0,rootMargin:'-60px 0px 0px 0px'});
 clockObserver.observe($('clock'));
 const heroObserver=new IntersectionObserver(([entry])=>sky.setVisible(entry.isIntersecting),{threshold:0});
 heroObserver.observe($('hero'));
 document.addEventListener('visibilitychange',()=>{
  sky.setVisible(!document.hidden);
  if(!document.hidden&&forecast&&Date.now()-loadedAt>2*60000)void load();
 });
 setInterval(()=>{if(!document.hidden)void load();},REFRESH_MS);
 alertTimer=setInterval(()=>void refreshAlerts(),ALERT_REFRESH_MS);
}

place=initialPlace();
$('place-name').textContent=place.name||'Finding your forecast';
$('place-button-label').textContent=place.name||'Change place';
sky.setLocation(place.latitude,place.longitude);
layoutSky();
sky.setState({time:Date.now()});
sky.start();
bindControls();
if(document.fonts?.ready)document.fonts.ready.then(()=>{layoutSky();if(steps.length)drawStrip();});
void load({keepHour:false}).then(()=>refreshAlerts());
