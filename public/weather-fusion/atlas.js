/** Atlas only adds presentation. All numbers come from the main forecast event.
 * It never fetches another forecast, recalculates a blend, or rewrites shared cards.
 */
import {rainChanceValue} from './weather-math.js';
const H = 3600000;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = {nws:'NWS forecasters',hrrr:'NOAA HRRR',ecmwf:'ECMWF IFS',nbm:'National Blend'};
const colors = {nws:'#86d5df',hrrr:'#efbd76',ecmwf:'#b5a2dd',nbm:'#91c9a8'};
const statusNames = {ready:'Available',stale:'Stale · excluded',unavailable:'Unavailable','not-configured':'Not configured','not-covered':'Outside coverage'};
const definitions = {
  temperature:{label:'Temperature',unit:'°F',color:'#efbd76'},
  rain:{label:'Rain chance',unit:'%',color:'#83d6e0'},
  wind:{label:'Wind',unit:'mph',color:'#b5a2dd'}
};
function dateLabel(time,timeZone,options={}) {
  try { return new Intl.DateTimeFormat('en-US',{timeZone:timeZone||'America/New_York',hour:'numeric',...options}).format(new Date(time)); }
  catch { return 'Time unavailable'; }
}
const number = (v,unit='') => finite(v) ? `${Math.round(v)}${unit}` : 'Unavailable';

export function atlasSeries(data,{now=Date.now(),hours=24,metric='temperature'}={}) {
  const rows = Array.isArray(data?.hours) ? data.hours : [];
  const end = now + Math.min(48,Math.max(1,hours))*H;
  const byTime = new Map();
  for(const row of rows){
    const time=Date.parse(row.time);
    if(!finite(time)||time+H<=now||time>=end)continue;
    const temperature=finite(row.temperature)?row.temperature:null;
    const rain=rainChanceValue(row.rainLikelihood,row.pop);
    const wind=finite(row.windMph)&&row.windMph>=0?row.windMph:null;
    const point={time,temperature,rain,wind};
    byTime.set(time,{...point,value:point[metric]??null});
  }
  return [...byTime.values()].sort((a,b)=>a.time-b.time);
}
export function atlasFreshness(data,now=Date.now()) {
  const assembled=Date.parse(data?.assembledAt);
  if(!finite(assembled))return {state:'unknown',label:'Forecast timestamp unavailable'};
  const age=now-assembled;
  if(age < -5*60000)return {state:'unknown',label:'Forecast timestamp could not be verified'};
  const minutes=Math.max(0,Math.floor(age/60000));
  if(minutes>=20)return {state:'stale',label:`Snapshot checked ${minutes<120?`${minutes} min`:`${Math.floor(minutes/60)} hr`} ago · refresh needed`};
  return {state:'checked',label:minutes<1?'Sources checked just now':`Sources checked ${minutes} min ago`};
}
export function atlasBlend(data,dayIndex=0) {
  const day=data?.days?.[dayIndex]||null;
  const applied=Array.isArray(day?.highBlend?.sources)?day.highBlend.sources:[];
  const ids=[...new Set([...Object.keys(names),...applied.map(source=>source.id)])];
  const sources=ids.map(id=>{
    const source=applied.find(row=>row.id===id);
    const feed=data?.feeds?.find(row=>row.id===id);
    const model=data?.modelContributions?.find(row=>row.id===id);
    return {id,label:names[id]||id,value:finite(source?.value)?source.value:null,
      weight:finite(source?.weight)&&source.weight>=0&&source.weight<=1?source.weight:null,
      status:feed?.status||'unavailable',runAt:model?.runAt||feed?.issuedAt||null};
  });
  return {day,sources,total:sources.reduce((sum,row)=>sum+(row.weight||0),0)};
}
export function atlasConfidence(data) {
  return (Array.isArray(data?.days)?data.days:[]).slice(0,7).map(day=>({
    date:day.date,label:day.label||day.date||'Forecast day',
    score:finite(day.confidence?.score)?Math.max(0,Math.min(100,day.confidence.score)):null,
    key:['high','moderate','low','very-low'].includes(day.confidence?.key)?day.confidence.key:'unknown',confidenceLabel:day.confidence?.label||'Unavailable',
    factors:Array.isArray(day.confidence?.factors)?day.confidence.factors:[]
  }));
}
export function atlasChart(series,{metric='temperature',timeZone='America/New_York'}={}) {
  const def=definitions[metric]||definitions.temperature;
  const values=series.filter(row=>finite(row.value));
  if(!values.length)return '<p class="atlas-empty">This forecast series is unavailable. Missing weather data is never treated as zero.</p>';
  const width=1080,height=235,pad={l:48,r:20,t:28,b:38};
  const first=series[0].time,last=series.at(-1).time;
  let lo=Math.floor((Math.min(...values.map(row=>row.value))-3)/5)*5;
  let hi=Math.ceil((Math.max(...values.map(row=>row.value))+3)/5)*5;
  if(metric==='rain'){lo=0;hi=100;}
  if(metric==='wind'){lo=0;hi=Math.max(10,Math.ceil((Math.max(...values.map(row=>row.value))+2)/5)*5);}
  const x=t=>pad.l+(t-first)/Math.max(H,last-first)*(width-pad.l-pad.r);
  const y=v=>pad.t+(hi-v)/(hi-lo)*(height-pad.t-pad.b);
  const segments=[];let segment=[];let previous=null;
  for(const row of series){
    if(!finite(row.value)||(previous!==null&&row.time-previous>1.5*H)){
      if(segment.length)segments.push(segment);segment=[];
    }
    if(finite(row.value))segment.push(row);
    previous=row.time;
  }
  if(segment.length)segments.push(segment);
  const line=segments.map(rows=>`<path d="${rows.map((row,i)=>`${i?'L':'M'}${x(row.time).toFixed(2)},${y(row.value).toFixed(2)}`).join(' ')}"/>`).join('');
  const area=segments.filter(rows=>rows.length>1).map(rows=>`<path d="M${x(rows[0].time).toFixed(2)},${height-pad.b} ${rows.map(row=>`L${x(row.time).toFixed(2)},${y(row.value).toFixed(2)}`).join(' ')} L${x(rows.at(-1).time).toFixed(2)},${height-pad.b} Z"/>`).join('');
  const ticks=Array.from({length:5},(_,i)=>lo+(hi-lo)*i/4);
  const tickIds=[...new Set([0,Math.round((series.length-1)*.25),Math.round((series.length-1)*.5),Math.round((series.length-1)*.75),series.length-1])];
  const label=`${def.label} forecast from ${dateLabel(first,timeZone,{weekday:'short'})} to ${dateLabel(last,timeZone,{weekday:'short'})}. Low ${number(Math.min(...values.map(p=>p.value)),def.unit)}, high ${number(Math.max(...values.map(p=>p.value)),def.unit)}. Missing values break the line.`;
  return `<div class="atlas-chart-scroll"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}"><defs><linearGradient id="atlas-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${def.color}" stop-opacity=".18"/><stop offset="100%" stop-color="${def.color}" stop-opacity="0"/></linearGradient></defs>${ticks.map(v=>`<line x1="${pad.l}" x2="${width-pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#91a8bb20" stroke-dasharray="3 6"/><text x="${pad.l-12}" y="${y(v)+4}" fill="#90a5b5" font-size="12" text-anchor="end">${Math.round(v)}${metric==='temperature'?'°':metric==='rain'?'%':''}</text>`).join('')}<g fill="url(#atlas-chart-fill)">${area}</g><g fill="none" stroke="${def.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${line}</g>${values.map(row=>`<circle cx="${x(row.time)}" cy="${y(row.value)}" r="2.1" fill="${def.color}"/>`).join('')}${tickIds.map(i=>`<text x="${x(series[i].time)}" y="${height-10}" fill="#90a5b5" font-size="12" text-anchor="${i===0?'start':i===series.length-1?'end':'middle'}">${esc(dateLabel(series[i].time,timeZone,{weekday:'short'}))}</text>`).join('')}</svg></div>`;
}

function installAtlas(){
  const $=id=>document.getElementById(id);
  if(!$('atlas-trend'))return;
  let forecast=null,metric='temperature',hours=24,selectedHour=0,selectedDay=0;
  function setLayers(enabled){document.querySelectorAll('[data-layer]').forEach(button=>{button.disabled=!enabled;button.title=enabled?'':'Choose a location to load weather maps';});}
  function updateFreshness(){
    const fresh=forecast?atlasFreshness(forecast):{state:'unknown',label:'Awaiting weather data'};
    $('atlas-freshness').textContent=fresh.label;
    $('atlas-freshness').dataset.state=fresh.state;
    const offline=!navigator.onLine;
    const warning=offline?'You’re offline. Displayed weather is a previous snapshot. Reconnect for updates.':forecast&&fresh.state!=='checked'?'Forecast freshness could not be verified. Refresh before relying on this snapshot.':'';
    $('atlas-connection').textContent=warning;$('atlas-connection').hidden=!warning;
  }
  function renderReadout(rows){
    const row=rows[Math.min(selectedHour,rows.length-1)];
    if(!row)return;
    $('atlas-hour-readout').innerHTML=`<strong>${esc(dateLabel(row.time,forecast?.location?.timeZone,{weekday:'short',minute:'2-digit'}))}</strong><span>Temperature <b>${number(row.temperature,'°F')}</b></span><span>Rain chance <b>${number(row.rain,'%')}</b></span><span>Wind <b>${number(row.wind,' mph')}</b></span>`;
  }
  function renderTrend(){
    const rows=atlasSeries(forecast,{hours,metric});
    selectedHour=Math.min(selectedHour,Math.max(0,rows.length-1));
    $('atlas-trend-title').textContent=`The next ${hours} hours`;
    $('atlas-trend').innerHTML=`<div class="atlas-chart-tools"><div role="group" aria-label="Trend variable">${Object.entries(definitions).map(([key,def])=>`<button type="button" data-atlas-metric="${key}" aria-pressed="${metric===key}">${def.label}</button>`).join('')}</div><div role="group" aria-label="Trend length">${[24,48].map(n=>`<button type="button" data-atlas-hours="${n}" aria-pressed="${hours===n}">${n}h</button>`).join('')}</div></div>${atlasChart(rows,{metric,timeZone:forecast?.location?.timeZone})}${rows.length?`<div id="atlas-hour-readout" class="atlas-hour-readout" aria-live="polite"></div><label class="atlas-scrub-label" for="atlas-hour">Explore the hourly forecast</label><input id="atlas-hour" class="atlas-hour-slider" type="range" min="0" max="${rows.length-1}" value="${selectedHour}"><details class="atlas-data-detail"><summary>View hourly values</summary><div class="atlas-table-wrap"><table><caption>Canonical Nourie hourly forecast. A dash means unavailable.</caption><thead><tr><th scope="col">Time</th><th scope="col">°F</th><th scope="col">Rain %</th><th scope="col">Wind mph</th></tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${esc(dateLabel(row.time,forecast?.location?.timeZone,{weekday:'short'}))}</th><td>${number(row.temperature).replace('Unavailable','—')}</td><td>${number(row.rain).replace('Unavailable','—')}</td><td>${number(row.wind).replace('Unavailable','—')}</td></tr>`).join('')}</tbody></table></div></details>`:''}<p class="atlas-chart-note">The same hourly values as the main forecast. Rain chance is the site’s uncalibrated blend score; it isn’t an official NWS probability. Lines stop at data gaps.</p>`;
    renderReadout(rows);
    $('atlas-hour')?.addEventListener('input',event=>{selectedHour=Number(event.target.value);renderReadout(rows);});
  }
  function renderBlend(){
    const blend=atlasBlend(forecast,selectedDay),days=forecast?.days||[];
    const applied=blend.sources.filter(source=>finite(source.weight)&&source.weight>0);
    $('atlas-blend').innerHTML=`<label class="atlas-blend-picker" for="atlas-blend-day">Applied high-temperature blend <select id="atlas-blend-day">${days.slice(0,7).map((day,i)=>`<option value="${i}"${i===selectedDay?' selected':''}>${esc(day.label||day.date)}</option>`).join('')}</select></label>${applied.length?`<div class="atlas-blend-bar" role="img" aria-label="${esc(applied.map(source=>`${source.label} ${Math.round(source.weight*100)} percent`).join(', '))}">${applied.map(source=>`<span style="flex:${source.weight};background:${colors[source.id]||'#91a8b5'}"></span>`).join('')}</div>`:'<p class="atlas-empty">Applied blend contributions are unavailable for this day.</p>'}${blend.sources.map(source=>`<div class="atlas-source-row"><span class="atlas-source-name"><i style="background:${colors[source.id]||'#91a8b5'}"></i>${esc(source.label)}<small>${esc(source.runAt?`Issued ${dateLabel(source.runAt,forecast?.location?.timeZone,{month:'short',day:'numeric',minute:'2-digit'})}`:'Issue time unavailable')}</small></span><span class="atlas-source-numbers"><strong>${finite(source.weight)&&source.weight>0?`${Math.round(source.weight*100)}%`:'Not used'}</strong><small>${finite(source.weight)&&source.weight>0?`${number(source.value,'°F')} guidance`:esc(statusNames[source.status]||'Status unavailable')}</small></span></div>`).join('')}<p>These are the actual weights applied to this day’s high, not a model-skill ranking. Missing sources are excluded; weights can vary by day and field. Current conditions and official alerts keep their own sources.</p><a class="atlas-inline-link" href="#scientific-stuff">Explore the full method <span aria-hidden="true">↗</span></a>`;
    $('atlas-blend-day')?.addEventListener('change',event=>{selectedDay=Number(event.target.value);renderBlend();});
  }
  function renderConfidence(){
    const days=atlasConfidence(forecast);
    $('atlas-confidence').innerHTML=days.length?`<div class="atlas-confidence-list">${days.map(day=>`<details class="atlas-confidence-day"><summary><span>${esc(day.label)}<small class="atlas-confidence-label">${esc(day.confidenceLabel)}</small></span><span class="atlas-confidence-track"><i style="width:${day.score??0}%" data-confidence="${day.key}"></i></span><strong>${finite(day.score)?`${Math.round(day.score)}<small>/100</small>`:'—'}</strong></summary><div class="atlas-confidence-reasons">${day.factors.length?`<ul>${day.factors.map(factor=>`<li>${esc(factor)}</li>`).join('')}</ul>`:'Confidence evidence is unavailable for this day.'}</div></details>`).join('')}</div><p>A relative index from the main forecast, not the probability of being right. Tap a day to see how lead time, source coverage and disagreement affect its score.</p>`:'<p class="atlas-empty">Daily confidence is unavailable.</p>';
  }
  function reset(){
    forecast=null;selectedHour=0;selectedDay=0;setLayers(false);
    for(const id of ['atlas-trend','atlas-blend','atlas-confidence'])$(id).innerHTML='<p class="atlas-empty">Waiting for the selected location’s forecast…</p>';
    updateFreshness();
  }
  function render(data){
    if(!data||!Array.isArray(data.hours))return;
    const changed=forecast?.location?.latitude!==data.location?.latitude||forecast?.location?.longitude!==data.location?.longitude;
    forecast=data;if(changed){selectedHour=0;selectedDay=0;}
    renderTrend();renderBlend();renderConfidence();updateFreshness();setLayers(true);
  }
  $('atlas-trend').addEventListener('click',event=>{
    const variable=event.target.closest('[data-atlas-metric]'),length=event.target.closest('[data-atlas-hours]');
    if(!forecast)return;
    if(variable){metric=variable.dataset.atlasMetric;renderTrend();$('atlas-trend').querySelector(`[data-atlas-metric="${metric}"]`)?.focus({preventScroll:true});}
    if(length){hours=Number(length.dataset.atlasHours);renderTrend();$('atlas-trend').querySelector(`[data-atlas-hours="${hours}"]`)?.focus({preventScroll:true});}
  });
  function describeMap(){
    const layer=document.querySelector('[data-layer][aria-pressed="true"]')?.dataset.layer||'radar';
    const descriptions={radar:'NOAA observed radar',hrrr:'HRRR forecast reflectivity',ecmwf:'ECMWF accumulated precipitation',nbm:'NBM interval precipitation',temperature:'Forecast temperature',wind:'Forecast wind speed',clouds:'Forecast cloud cover'};
    $('radar-map').setAttribute('aria-label',`Interactive ${descriptions[layer]||'weather'} map`);
    $('radar-time').setAttribute('aria-label',layer==='radar'?'Observed radar time':'Model forecast valid time');
    const playing=$('radar-play').textContent.trim()==='Ⅱ';
    $('radar-play').setAttribute('aria-label',`${playing?'Pause':'Play'} ${layer==='radar'?'radar':'forecast map'} animation`);
  }
  document.querySelectorAll('[data-layer]').forEach(button=>button.addEventListener('click',describeMap));
  new MutationObserver(describeMap).observe($('radar-play'),{childList:true,subtree:true,characterData:true});
  setLayers(false);describeMap();
  document.addEventListener('weather-nourie:forecast',event=>render(event.detail));
  // chooseLocation clears the canonical temperature immediately. Observe that
  // reset instead of fetching, intercepting requests, or retaining the old city.
  const locationIsLoading=()=>$('temperature').textContent.trim().startsWith('—')&&$('observation-label').textContent==='Awaiting the new location’s sources';
  new MutationObserver(()=>{if(locationIsLoading())reset();}).observe($('temperature'),{childList:true,subtree:true,characterData:true});
  window.addEventListener('offline',updateFreshness);window.addEventListener('online',updateFreshness);
  setInterval(()=>{if(!document.hidden)updateFreshness();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateFreshness();});
  // The first forecast may arrive before this module finishes loading.
  if(globalThis.__weatherNourieForecast&&!locationIsLoading())render(globalThis.__weatherNourieForecast);
  document.querySelectorAll('.atlas-header-nav a').forEach(link=>link.addEventListener('click',()=>{
    document.querySelectorAll('.atlas-header-nav a').forEach(node=>node.classList.toggle('atlas-nav-active',node===link));
  }));
}
if(typeof document!=='undefined')installAtlas();
