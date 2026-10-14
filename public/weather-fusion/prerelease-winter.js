/** Prerelease-only winter view. Canonical main-weather values are never changed.
 * Threshold probabilities, deterministic amounts and occurrence probabilities
 * are distinct products; unavailable or mismatched inputs never become zero. */
const HOUR = 3600000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = {wpc:'NWS WPC winter guidance',ecmwf:'ECMWF',weathernext:'Google WeatherNext',gfs:'GFS',hrrr:'HRRR',nam:'NAM'};
const LONG_WEIGHTS = Object.freeze({wpc:.60,ecmwf:.20,weathernext:.10,gfs:.10});
const SHORT_WEIGHTS = Object.freeze({wpc:.60,hrrr:.25,nam:.15});
const snowWords = /\bsnow\b|snowfall|flurr|blizzard/i;
const sleetWords = /sleet|ice pellets/i;
const iceWords = /freezing rain|freezing drizzle|ice storm/i;
const inches = value => finite(value) ? `${value.toFixed(1)} in` : 'Unavailable';
const dayText = (value, zone) => {
  try { return new Intl.DateTimeFormat('en-US',{timeZone:zone||'America/New_York',weekday:'short',month:'short',day:'numeric',hour:'numeric'}).format(new Date(value)); }
  catch { return 'Time unavailable'; }
};

export function winterWeights(start, end, now=Date.now()) {
  const a=Date.parse(start), b=Date.parse(end);
  if(!finite(a)||!finite(b)||b<=a||b<=now)return {kind:'unavailable',weights:null,reason:'A future, nonempty forecast interval is required.'};
  const boundary=now+24*HOUR;
  if(a<boundary&&b>boundary)return {kind:'split-required',weights:null,reason:'Split this interval at the 24-hour boundary before blending.'};
  return b<=boundary?{kind:'within-24h',weights:SHORT_WEIGHTS}:{kind:'beyond-24h',weights:LONG_WEIGHTS};
}

/** Only like-for-like, complete, current products may enter the requested blend.
 * No source is substituted or reweighted when a requested input is absent. */
export function blendWinterInputs(inputs,{start,end,metric,unit,statistic,threshold=null,now=Date.now()}={}) {
  const policy=winterWeights(start,end,now), sources=[];
  if(!policy.weights)return {...policy,status:'unavailable',value:null,sources};
  const probability=statistic==='probability';
  if(!['snow','freezing-rain','sleet'].includes(metric)||!['probability','expected-amount'].includes(statistic)||!(probability?unit==='percent':unit==='inches'))return {...policy,status:'unavailable',value:null,sources,reason:'The requested variable, statistic and unit must describe the same winter product.'};
  for(const [id,weight] of Object.entries(policy.weights)) {
    const candidates=(Array.isArray(inputs)?inputs:[]).filter(row=>row.source===id);
    const row=candidates.length===1?candidates[0]:null, issued=Date.parse(row?.issuedAt);
    const ready=!!row&&row.status==='ready'&&row.complete===true&&finite(row.value)&&row.value>=0&&(!probability||row.value<=100)&&
      row.metric===metric&&row.unit===unit&&row.statistic===statistic&&(row.threshold??null)===threshold&&
      Date.parse(row.start)===Date.parse(start)&&Date.parse(row.end)===Date.parse(end)&&
      finite(issued)&&issued<=now+5*60000&&now-issued<=36*HOUR;
    sources.push({id,label:labels[id],weight,status:ready?'ready':'unavailable',value:ready?row.value:null});
  }
  const complete=sources.every(row=>row.status==='ready');
  return {...policy,status:complete?'ready':'unavailable',value:complete?sources.reduce((sum,row)=>sum+row.value*row.weight,0):null,sources,
    reason:complete?'Requested weights applied to compatible, aligned products.':'A matching winter product is missing, stale or incompatible. No weights have been redistributed.'};
}

export function winterSignal(data,now=Date.now()) {
  const assembled=Date.parse(data?.assembledAt), fresh=finite(assembled)&&now-assembled<=90*60000&&assembled<=now+5*60000;
  const rows=Array.isArray(data?.snow?.days)?data.snow.days:[];
  const futureHours=(data?.hours||[]).filter(hour=>{const t=Date.parse(hour.time);return finite(t)&&t+HOUR>now;});
  const words=[...rows.flatMap(row=>(row.periods||[]).map(period=>period.wording)),...futureHours.map(hour=>hour.condition||''),...(data?.days||[]).map(day=>day.condition||'')].join(' ');
  const supplement=data?.prereleaseWinter, checked=Date.parse(supplement?.assembledAt);
  const supplementFresh=finite(checked)&&checked<=now+5*60000&&now-checked<=30*60000;
  const modelSnow=supplementFresh&&Object.values(supplement?.sources||{}).some(source=>['ready','partial'].includes(source.status)&&(source.intervals||[]).some(row=>finite(row.value)&&row.value>0&&Date.parse(row.end)>now&&Date.parse(row.start)<now+7*24*HOUR));
  const snow=modelSnow||rows.some(row=>[row.nwsSnowfall,row.models?.ecmwf,row.models?.gfs].some(value=>finite(value)&&value>0)||row.wpc?.length)||snowWords.test(words);
  const freezingRain=iceWords.test(words), sleet=sleetWords.test(words);
  const possible=!!(snow||freezingRain||sleet||data?.snow?.wssi);
  const feeds=data?.feeds||[], nwsReady=feeds.some(feed=>feed.id==='nws'&&feed.status==='ready');
  const modelReady=feeds.some(feed=>feed.id==='snow-models'&&feed.status==='ready');
  const knownDays=rows.filter(row=>finite(row.models?.ecmwf)&&finite(row.models?.gfs));
  const enoughCoverage=rows.length>0&&knownDays.length===rows.length&&nwsReady&&modelReady;
  const status=!fresh?'unavailable':possible?'possible':enoughCoverage?'none':'unavailable';
  return {status,snow:!!snow,freezingRain,sleet,days:rows,fresh,
    title:status==='possible'?'Snow & ice outlook':status==='none'?'No snow in the available forecast':'Snow forecast unavailable',
    note:!fresh?'Refresh to check a current winter forecast.':status==='none'?`No snow signal in the available ${rows.length}-day forecast. Forecasts can change.`:status==='possible'?'Review the timing, source guidance and winter maps.':'The winter sources do not cover this forecast completely. Missing data does not mean no snow.'};
}

function sourceGuidanceHTML(supplement,zone,now) {
  const checked=Date.parse(supplement?.assembledAt);
  if(!finite(checked)||checked>now+5*60000||now-checked>30*60000)return '<section class="winter-model-guidance"><h3>Individual snowfall models</h3><p>Current model coverage is unavailable. Refresh to check HRRR, NAM, ECMWF and GFS. Missing amounts are not zero.</p></section>';
  const sources=supplement.sources||{};
  const cards=['hrrr','nam','ecmwf','gfs'].map(id=>{
    const source=sources[id],ready=['ready','partial'].includes(source?.status);
    return `<article class="winter-source-card"><div><strong>${esc(source?.label||labels[id])}</strong><span>${ready?'Available coverage':esc(source?.status||'Unavailable')}</span></div>${ready?`<p>Through ${esc(dayText(source.coverageEnd,zone))} · ${esc(source.coveredHours)} complete hourly values</p><small>Latest feed run: ${esc(dayText(source.metadata?.latestRunAt,zone))}. The point API does not identify the run of each returned value.</small>`:`<p>${esc(source?.reason||'This model could not be checked.')}</p>`}</article>`;
  }).join('');
  const windows=(supplement.windows||[]).slice(0,7).map((window,index)=>`<details class="winter-window"${index===0?' open':''}><summary>${index===0?'Next 24 complete forecast hours':esc(dayText(window.start,zone))+' · 24 hours'}</summary><p>${esc(dayText(window.start,zone))} → ${esc(dayText(window.end,zone))}</p><dl>${['hrrr','nam','ecmwf','gfs'].map(id=>{const amount=window.sourceAmounts?.[id];return `<div><dt>${labels[id]}</dt><dd>${amount?.complete&&finite(amount.value)?inches(amount.value):'Unavailable'}${!amount?.complete?`<small>${esc(amount?.coveredHours??0)}/${esc(amount?.expectedHours??24)} hours</small>`:''}</dd></div>`;}).join('')}</dl></details>`).join('');
  return `<section class="winter-model-guidance"><h3>Individual snowfall models</h3><p>Aligned, complete-hour amounts in inches. These are separate model forecasts, not a combined storm total or probability.</p>${cards}<div class="winter-model-windows">${windows}</div><p>Hourly provider values may be interpolated from coarser model steps. Only complete periods receive a total; a dash or “unavailable” never means zero snow.</p></section>`;
}

export function winterDetailHTML(data,now=Date.now()) {
  const signal=winterSignal(data,now), zone=data?.location?.timeZone;
  const sourceCards=signal.days.filter(row=>row.possible||[row.nwsSnowfall,row.models?.ecmwf,row.models?.gfs].some(value=>finite(value)&&value>0)).map(row=>`<article class="winter-day"><h3>${esc(row.label||row.date)}</h3><p>${esc((row.periods||[]).map(period=>period.wording).join(' · ')||'Accumulating snow appears in model guidance.')}</p><dl><div><dt>NWS forecast snow</dt><dd>${inches(row.nwsSnowfall)}</dd></div><div><dt>ECMWF model snow</dt><dd>${inches(row.models?.ecmwf)}</dd></div><div><dt>GFS model snow</dt><dd>${inches(row.models?.gfs)}</dd></div></dl><small>Separate source amounts for ${esc(row.date)}. Coverage can differ; these are not the requested weighted blend.</small>${row.wpc?.length?`<p class="winter-threshold">WPC: ${row.wpc.map(item=>`${esc(item.category)} category for at least ${esc(item.inches)} in`).join('; ')}. Threshold guidance, not the chance of any snow.</p>`:''}</article>`).join('');
  const guidance=sourceGuidanceHTML(data?.prereleaseWinter,zone,now);
  const shares=weights=>Object.entries(weights).map(([id,weight])=>`<div><span>${labels[id]}</span><strong>${Math.round(weight*100)}%</strong></div>`).join('');
  return `<div class="dialog-eyebrow">${esc(data?.location?.name||'Choose a location')}</div><h2 id="winter-title">${esc(signal.title)}</h2><p class="winter-intro">${esc(signal.note)}</p>
    ${signal.status==='possible'?`<div class="winter-types">${[['Snow',signal.snow],['Freezing rain',signal.freezingRain],['Sleet',signal.sleet]].map(([label,yes])=>`<div><strong>${label}</strong><span>${yes?'Forecast signal':'No signal in available wording'}</span><small>Type-specific chance unavailable</small></div>`).join('')}</div>${sourceCards}`:''}
    <details class="winter-blend winter-model-disclosure"><summary>Model amounts &amp; source status</summary>${guidance}</details>
    <details class="winter-blend"><summary>Winter blend · source coverage</summary><p>The requested winter blend is separate from the main weather blend. Its numeric snow, freezing-rain and sleet chances are unavailable until every required source provides the same variable, units and valid period.</p><h3>Within 24 hours</h3><div class="winter-shares">${shares(SHORT_WEIGHTS)}</div><h3>Beyond 24 hours</h3><div class="winter-shares">${shares(LONG_WEIGHTS)}</div><p class="winter-coverage">WPC here supplies threshold categories, not an expected snowfall amount or a chance of any snow. Google WeatherNext has no verified snow/ice/sleet product in this feed. HRRR, NAM CONUS nest, ECMWF IFS and GFS provide individual snowfall amounts when their stated coverage is available. Deterministic amounts do not supply type-specific probabilities. Missing shares stay missing; they are never reassigned.</p></details>
    <section class="winter-maps" aria-labelledby="winter-map-title"><h3 id="winter-map-title">Winter maps</h3><p>Official guidance, shown separately from the unavailable custom blend.</p><div class="winter-map-tabs" role="group" aria-label="Winter map product"><button type="button" data-winter-map="snow" aria-pressed="false">Snow totals</button><button type="button" data-winter-map="qpf" aria-pressed="false">Expected precip</button><button type="button" data-winter-map="probability" aria-pressed="false">Heavy snow risk</button></div><p id="winter-map-status" role="status">Choose a map to load its verified issue and valid times.</p><div id="winter-map-canvas" hidden aria-label="Official winter forecast map"></div><div id="winter-map-legend"></div><a id="winter-map-source" href="https://www.wpc.ncep.noaa.gov/pwpf/wwd_prob_guidance.php" target="_blank" rel="noopener noreferrer">Open official WPC winter guidance ↗</a></section>
    <p class="winter-footnote">Forecast checked ${esc(dayText(data?.assembledAt,zone))}. Amounts are guidance, not a guarantee. Follow official NWS alerts for your location.</p>`;
}

let latest=null, dialog=null, map=null, mapGeneration=0;
function closeMap(){mapGeneration++;if(map){map.remove();map=null;}}
function ensureDialog(){
  if(dialog)return dialog;
  dialog=document.createElement('dialog');dialog.id='prerelease-winter-dialog';dialog.className='winter-dialog';dialog.setAttribute('aria-labelledby','winter-title');
  dialog.innerHTML='<button type="button" class="dialog-close" id="close-winter" aria-label="Close snow forecast">×</button><div id="winter-content"></div>';
  document.body.append(dialog);
  dialog.querySelector('#close-winter').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{closeMap();document.getElementById('open-snow')?.setAttribute('aria-expanded','false');if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');});
  return dialog;
}
function openWinter(){
  const sheet=ensureDialog();closeMap();
  sheet.querySelector('#winter-content').innerHTML=winterDetailHTML(latest);
  sheet.querySelectorAll('[data-winter-map]').forEach(button=>button.addEventListener('click',()=>loadWinterMap(button.dataset.winterMap)));
  if(!sheet.open)sheet.showModal();document.body.classList.add('dialog-open');
  document.getElementById('open-snow')?.setAttribute('aria-expanded','true');
}
async function loadWinterMap(kind){
  const token=++mapGeneration;
  if(map){map.remove();map=null;}
  const canvas=document.getElementById('winter-map-canvas'), status=document.getElementById('winter-map-status');
  canvas.hidden=true;document.getElementById('winter-map-legend').innerHTML='';
  dialog.querySelectorAll('[data-winter-map]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.winterMap===kind)));
  status.textContent='Checking current official map metadata…';
  try {
    const {loadOfficialWinterMap}=await import('./prerelease-winter-maps.js');
    await loadOfficialWinterMap({kind,data:latest,canvas,status,legend:document.getElementById('winter-map-legend'),source:document.getElementById('winter-map-source'),isCurrent:()=>token===mapGeneration&&dialog.open,setMap:value=>{map=value;}});
  } catch {if(token===mapGeneration)status.textContent='This map is unavailable. Blank maps do not mean no snow. Use the official guidance link.';}
}
export function renderSnowOutlook(data){
  latest=data;
  let root=document.getElementById('prerelease-winter');if(!root)return;
  const signal=winterSignal(data);
  root.hidden=signal.status!=='possible';
  root.innerHTML=signal.status==='possible'?`<button type="button" class="winter-open-tile" aria-haspopup="dialog" aria-controls="prerelease-winter-dialog"><span class="winter-snowflake" aria-hidden="true">❄</span><span><strong>Snow & ice outlook</strong><small>${esc(signal.note)}</small></span><span aria-hidden="true">›</span></button>`:'';
  root.querySelector('button')?.addEventListener('click',openWinter);
  const tab=document.getElementById('open-snow');
  if(tab&&!tab.dataset.winterBound){tab.dataset.winterBound='true';tab.addEventListener('click',openWinter);}
  if(dialog?.open)openWinter();
}
export function resetWinterOutlook(){latest=null;closeMap();if(dialog?.open)dialog.close();const root=document.getElementById('prerelease-winter');if(root){root.hidden=true;root.innerHTML='';}}
if(typeof document!=='undefined'){
  const install=()=>{const tab=document.getElementById('open-snow');if(tab&&!tab.dataset.winterBound){tab.dataset.winterBound='true';tab.addEventListener('click',openWinter);}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
}
