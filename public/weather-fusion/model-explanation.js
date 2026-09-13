const HOUR = 3600000;
const GRAPHCAST_FEED = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/graphcast.json';
const GRAPHCAST_SOURCE = 'https://nvidia.github.io/earth2studio/main/modules/generated/models/px/GraphCastOperational/';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const chance = value => finite(value) && value >= 0 && value <= 100 ? value : null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[character]));
const names = {nws:'NWS',hrrr:'HRRR',ecmwf:'ECMWF',nbm:'NBM',graphcast:'GraphCast'};
const phaseNames = {overall:'Full day',daytime:'Daytime',overnight:'Overnight'};
let latest = null, latestNow = 0, selectedDate = null, selectedPhase = null;
let graphcastState = {key:null,status:'idle',point:null,runAt:null,checkedAt:0,message:''};

function zoneFor(forecast) {
  const zone = forecast?.location?.timeZone || 'America/New_York';
  try { new Intl.DateTimeFormat('en-US',{timeZone:zone}); return zone; }
  catch { return 'America/New_York'; }
}

function stamp(value, zone, includeDate = true) {
  const epoch = typeof value === 'number' ? value : Date.parse(value);
  if (!finite(epoch)) return 'Not supplied';
  return new Intl.DateTimeFormat('en-US',{
    timeZone:zone,...(includeDate?{weekday:'short',month:'short',day:'numeric'}:{}),hour:'numeric',minute:'2-digit',
  }).format(new Date(epoch)).replace(':00','');
}

function dayLabel(date, index) {
  const epoch = Date.parse(`${date}T12:00:00Z`);
  if (!finite(epoch)) return `Day ${index+1}`;
  return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(new Date(epoch));
}

function number(value, precision = 4) {
  return finite(value) ? Number(value.toFixed(precision)).toString() : '—';
}

function percent(value) { return chance(value) === null ? '—' : `${Math.round(value)}%`; }

function defaultPhase(index, now, zone) {
  if (index !== 0) return 'overall';
  const hour = Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(now)));
  return hour >= 15 ? 'overnight' : 'daytime';
}

function periodFor(day, phase) {
  return (phase === 'daytime' ? day?.popDayLikelihood : phase === 'overnight' ? day?.popNightLikelihood : day?.rainLikelihood) || {};
}

export function modelExplanationView(forecast, {index = 0,phase = null,now = Date.now()} = {}) {
  const days = forecast?.days || [], safeIndex = Math.max(0,Math.min(days.length-1,index)), day = days[safeIndex] || {};
  const zone = zoneFor(forecast), selected = Object.hasOwn(phaseNames,phase) ? phase : defaultPhase(safeIndex,now,zone);
  const period = periodFor(day,selected), start = Date.parse(period.window?.start), end = Date.parse(period.window?.end);
  const rows = (forecast?.rainTimeline || []).filter(row => {
    const time = Date.parse(row.time), stop = Date.parse(row.end) || time+HOUR;
    return finite(start) && finite(end) && finite(time) && time < end && stop > start;
  }).sort((a,b) => Date.parse(a.time)-Date.parse(b.time));
  const available = rows.filter(row => chance(row.rainLikelihood?.value) !== null);
  const maximum = available.length ? Math.max(...available.map(row=>row.rainLikelihood.value)) : null;
  const peakRow = available.find(row => row.time === period.peakTime && row.rainLikelihood.value === maximum) || available.find(row => row.rainLikelihood.value === maximum) || null;
  const value = chance(period.value), complete = period.coverage?.complete === true;
  const mismatch = value !== null && maximum !== null && (value !== maximum || (period.peakTime && !available.some(row=>row.time===period.peakTime && row.rainLikelihood.value===value)));
  return {index:safeIndex,day,zone,phase:selected,period,start,end,rows,maximum,peakRow,value,complete,mismatch,
    peak:peakRow?.rainLikelihood || period.peak || null,peakTime:peakRow?.time || period.peakTime || null,
    peakEnd:peakRow?.end || period.peakEnd || (peakRow ? new Date(Date.parse(peakRow.time)+HOUR).toISOString() : null)};
}

function sourceRows(likelihood) {
  const sources = Array.isArray(likelihood?.sources) ? likelihood.sources : [];
  return ['nws','hrrr','ecmwf','nbm'].map(id => {
    const used = sources.find(source => source.id === id && finite(source.value) && finite(source.weight) && source.weight > 0);
    const value = finite(likelihood?.sourceValues?.[id]) ? likelihood.sourceValues[id] : used?.value;
    return {id,value:finite(value)?value:null,amount:finite(likelihood?.sourceAmounts?.[id])?likelihood.sourceAmounts[id]:null,
      officialProbability:id==='nws'&&finite(likelihood?.officialProbability)?likelihood.officialProbability:null,
      weight:used?.weight ?? null,points:finite(likelihood?.sourcePoints?.[id])?likelihood.sourcePoints[id]:finite(used?.points)?used.points:used ? used.value*used.weight : null,runAt:used?.runAt || null};
  });
}

function sourceTable(likelihood, caption = 'Inputs for the highest hour') {
  const rows = sourceRows(likelihood).map(source => {
    const input = source.id === 'nws'
      ? source.value === null ? 'Unavailable' : `${number(source.officialProbability)}% probability`
      : source.amount === null ? 'Unavailable' : `${number(source.amount,8)} in`;
    const reducedThreshold=finite(likelihood?.reducedQpfThresholdInches)?likelihood.reducedQpfThresholdInches:.1;
    const reducedPercent=finite(likelihood?.reducedPointFraction)?Math.round(likelihood.reducedPointFraction*100):30;
    const signal = source.id==='nws'||source.value === null ? ''
      : source.amount>0&&source.amount<reducedThreshold ? `<small>Light rain forecast: ${reducedPercent}% points</small>`
        : `<small>Rain forecast: ${source.value>0?'Yes':'No'}</small>`;
    const weight=source.weight===null?(source.id==='nws'&&source.value===null?'Unavailable':'Not used'):`${number(source.weight*100,4)}%`;
    return `<tr><th scope="row">${names[source.id]}</th><td>${input}${signal}</td><td>${weight}</td><td>${source.points === null?'—':number(source.points,6)}</td></tr>`;
  }).join('');
  return `<div class="model-table-scroll"><table class="model-inputs"><caption>${esc(caption)}</caption><thead><tr><th scope="col">Source</th><th scope="col">Rain input</th><th scope="col">Weight</th><th scope="col">Points</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function arithmetic(likelihood) {
  if (!likelihood || chance(likelihood.value) === null) return '<p class="model-calculation">This hour does not have a usable rain estimate.</p>';
  const sources = sourceRows(likelihood).filter(source => source.weight !== null);
  if (!sources.length) return '<p class="model-calculation">The calculation inputs were not supplied.</p>';
  const formula = sources.map(source=>number(source.points)).join(' + ');
  const weightedValue = finite(likelihood.weightedValue) ? likelihood.weightedValue : null;
  const rounded = finite(likelihood.rawValue) ? likelihood.rawValue : null;
  const capped=finite(likelihood.rawTotal)&&likelihood.rawTotal>100;
  return `<div class="model-calculation"><p class="model-formula">${esc(formula)}${weightedValue===null?'':` = ${number(weightedValue,8)}${capped?' → capped at 100':''}`}</p>
    <p>${rounded===null?'':`Rounded: <b>${number(rounded)}%</b>. `}Shown: <b>${percent(likelihood.value)}</b>.</p></div>`;
}

function temperatureBlend(day, kind) {
  const blend = day?.[`${kind}Blend`], sources = (blend?.sources || []).filter(source=>finite(source.value)&&finite(source.weight)&&source.weight>0);
  if (!sources.length || !finite(day?.[kind])) return '';
  const rows = sources.map(source=>`<tr><th scope="row">${esc(names[source.id]||source.id)}</th><td>${number(source.value,4)}°F</td><td>${number(source.weight*100,4)}%</td></tr>`).join('');
  const formula = sources.map(source=>`${number(source.value,4)} × ${number(source.weight,6)}`).join(' + ');
  return `<div class="model-temperature"><h4>${kind==='high'?'High':'Low'}: ${Math.round(day[kind])}°F</h4><div class="model-table-scroll"><table class="model-inputs"><thead><tr><th scope="col">Source</th><th scope="col">Temperature</th><th scope="col">Weight</th></tr></thead><tbody>${rows}</tbody></table></div><p class="model-formula">${esc(formula)}${finite(blend.value)?` = ${number(blend.value,4)}°F`:''} → ${Math.round(day[kind])}°F</p></div>`;
}

function sourceStatus(forecast, view) {
  const peakSources = sourceRows(view.peak), models = forecast?.modelContributions || [], feeds = forecast?.feeds || [];
  return `<dl class="model-runs">${['nws','hrrr','ecmwf','nbm'].map(id => {
    const source = peakSources.find(row=>row.id===id), model = models.find(row=>row.id===id), feed = feeds.find(row=>row.id===(id==='nws'?'hourly':id)) || feeds.find(row=>row.id===id);
    const used = source?.weight !== null, issued = source?.runAt || (id === 'nws' ? feed?.id==='hourly'?feed.issuedAt:null : model?.runAt || feed?.issuedAt);
    const kind = id === 'nws' ? 'Issued' : 'Latest published run';
    return `<div><dt>${names[id]} <span>${used?'Used at peak':'Not used at peak'}</span></dt><dd>${kind}: ${esc(stamp(issued,view.zone))}${model?.runScope?`<small>${esc(model.runScope)}</small>`:''}${feed?.fetchedAt?`<small>Data fetched: ${esc(stamp(feed.fetchedAt,view.zone))}</small>`:''}${feed?.checkedAt?`<small>Last check: ${esc(stamp(feed.checkedAt,view.zone))}</small>`:''}${feed?.retrievalStatus==='last-verified'?'<small>Using last verified data; the latest refresh did not succeed.</small>':''}${feed?.refreshWarning?`<small>${esc(feed.refreshWarning)}</small>`:''}${feed?.status&&feed.status!=='ready'?`<small>Feed: ${esc(feed.status)}</small>`:''}</dd></div>`;
  }).join('')}</dl>`;
}

function graphcastKey(forecast) {
  const lat=forecast?.location?.latitude,lon=forecast?.location?.longitude;
  return finite(lat)&&finite(lon)?`${lat.toFixed(4)},${lon.toFixed(4)}`:null;
}

function graphcastPoint(payload, forecast) {
  const lat=forecast?.location?.latitude,lon=forecast?.location?.longitude,points=Array.isArray(payload?.points)?payload.points:[];
  if(!finite(lat)||!finite(lon)||!points.length)return null;
  let best=null,distance=Infinity;
  for(const point of points){
    if(!finite(point?.latitude)||!finite(point?.longitude))continue;
    const d=Math.hypot(point.latitude-lat,(point.longitude-lon)*Math.cos(lat*Math.PI/180));
    if(d<distance){distance=d;best=point;}
  }
  return distance<=.35?best:null;
}

function graphcastWindows(point) {
  const rows=Array.isArray(point?.windows)?point.windows:Array.isArray(point?.intervals)?point.intervals:[];
  return rows.flatMap(row=>{
    const start=Date.parse(row.start),end=Date.parse(row.end);
    if(!finite(start)||!finite(end)||end<=start)return [];
    const rain=finite(row.precipitationInches)?Math.max(0,row.precipitationInches):null;
    const temperature=finite(row.temperatureF)?row.temperatureF:null,wind=finite(row.windMph)?Math.max(0,row.windMph):null;
    return [{start,end,rain,temperature,wind}];
  }).sort((a,b)=>a.start-b.start);
}

function graphcastCard(forecast, view) {
  const state=graphcastState,key=graphcastKey(forecast),same=key&&state.key===key,zone=view.zone;
  let body='';
  if(!same||state.status==='idle'||state.status==='loading'){
    body='<div class="graphcast-state">Checking the latest GraphCast / WeatherNext 1-Graph guidance for this location…</div>';
  }else if(state.status==='ready'){
    const windows=graphcastWindows(state.point).filter(row=>!finite(view.start)||!finite(view.end)||(row.start<view.end&&row.end>view.start));
    const cards=windows.slice(0,6).map(row=>`<div class="graphcast-window"><time>${esc(stamp(row.start,zone))}–${esc(stamp(row.end,zone,false))}</time><strong>${row.rain===null?'—':`${number(row.rain,2)} in`}</strong><span>${row.temperature===null?'Temperature unavailable':`${Math.round(row.temperature)}°F`} · ${row.wind===null?'wind unavailable':`${Math.round(row.wind)} mph wind`}</span></div>`).join('');
    body=`<div class="graphcast-meta"><div><small>Latest run</small><strong>${esc(stamp(state.runAt,zone))}</strong></div><div><small>Time step</small><strong>6-hour guidance</strong></div><div><small>Rain blend weight</small><strong>0% · comparison only</strong></div></div>${cards?`<div class="graphcast-windows">${cards}</div>`:'<div class="graphcast-state">This GraphCast feed does not contain a 6-hour window for the selected period.</div>'}`;
  }else if(state.status==='not-covered'){
    body='<div class="graphcast-state">The current GraphCast feed does not yet include this selected point. Your normal forecast remains unchanged.</div>';
  }else{
    body='<div class="graphcast-state">GraphCast is installed on the experimental page, but a current GPU-generated feed has not been published yet. It contributes 0 points and cannot change the displayed rain chance.</div>';
  }
  return `<section class="graphcast-card" aria-label="GraphCast experimental comparison"><div class="graphcast-head"><div><h3 class="graphcast-title"><span class="graphcast-orb" aria-hidden="true">G</span>GraphCast Operational</h3><p class="graphcast-copy">WeatherNext 1-Graph · 0.25° global AI guidance. Its 6-hour precipitation windows stay separate from the hourly NWS/HRRR/ECMWF/NBM percentage until the time-resolution handling is validated.</p></div><div class="graphcast-badges"><span class="graphcast-badge">Experimental</span><span class="graphcast-badge safe">Comparison only</span></div></div>${body}<p><a class="graphcast-link" href="${GRAPHCAST_SOURCE}" target="_blank" rel="noopener noreferrer">About the Earth2Studio GraphCast model ↗</a></p></section>`;
}

function queueGraphCastLoad(forecast) {
  if(typeof window==='undefined'||typeof fetch!=='function')return;
  const key=graphcastKey(forecast);if(!key)return;
  const retry=Date.now()-(graphcastState.checkedAt||0)>5*60000;
  if(graphcastState.key===key&&(graphcastState.status==='loading'||(!retry&&graphcastState.status!=='idle')))return;
  graphcastState={key,status:'loading',point:null,runAt:null,checkedAt:Date.now(),message:''};
  fetch(GRAPHCAST_FEED,{cache:'no-store',headers:{Accept:'application/json'}}).then(async response=>{
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    const point=graphcastPoint(payload,forecast);
    graphcastState={key,status:point?'ready':'not-covered',point,runAt:payload?.runAt||point?.runAt||null,checkedAt:Date.now(),message:''};
  }).catch(error=>{
    graphcastState={key,status:'pending',point:null,runAt:null,checkedAt:Date.now(),message:String(error?.message||error)};
  }).finally(()=>{
    if(latest===forecast&&experimentalPath())renderModelExplanation(latest,latestNow);
  });
}

export function modelExplanationHTML(forecast, options = {}) {
  const view = modelExplanationView(forecast,options), {day,zone,period,rows,peak,phase} = view;
  const choices = (forecast?.days || []).map((row,index)=>`<option value="${index}"${index===view.index?' selected':''}>${esc(dayLabel(row.date,index))}</option>`).join('');
  const phaseOptions = Object.entries(phaseNames).map(([key,name])=>`<option value="${key}"${key===phase?' selected':''}>${name}</option>`).join('');
  const temperatures = temperatureBlend(day,'high')+temperatureBlend(day,'low');
  const audit = rows.map(row=>`<details class="model-hour-audit" data-model-detail="hour-${esc(row.time)}"${row.time===view.peakTime?' data-peak="true"':''}><summary><span>${esc(stamp(row.time,zone))}</span><strong>${percent(row.rainLikelihood?.value)}</strong></summary>${sourceTable(row.rainLikelihood,'Hourly inputs')}${arithmetic(row.rainLikelihood)}</details>`).join('');
  return `<div class="model-explanation-heading"><h2 id="model-explanation-title">Why this forecast</h2><div class="model-selectors"><label>Day<select aria-label="Day" data-model-day>${choices}</select></label><label>Period<select aria-label="Period" data-model-phase>${phaseOptions}</select></label></div></div>
    <div class="model-period"><strong>${percent(view.value)}</strong><span>${phaseNames[phase]} · highest hourly blended estimate<small>${esc(stamp(period.window?.start,zone))} – ${esc(stamp(period.window?.end,zone))}</small></span></div>
    <p class="model-definition">This number is the highest hourly estimate in this period, not a separate probability of rain at any time during the whole period.</p>
    ${graphcastCard(forecast,view)}
    ${view.mismatch?`<p class="model-data-warning">Data mismatch: the period shows ${percent(view.value)}, but the highest supplied hour is ${percent(view.maximum)}.</p>`:''}
    ${!view.complete?`<p class="model-data-warning">Incomplete coverage: ${number(period.coverage?.availableHours)} of ${number(period.coverage?.expectedHours)} hours. The period estimate stays unavailable.${view.maximum===null?'':` Highest available hour: ${percent(view.maximum)}.`}</p>`:''}
    ${view.peakTime?`<h3>Highest hour: ${esc(stamp(view.peakTime,zone))}–${esc(stamp(view.peakEnd,zone,false))}</h3>`:''}
    ${sourceTable(peak)}${arithmetic(peak)}
    <details class="model-method" data-model-detail="method"><summary>How the inputs are used</summary><p>The NWS hourly probability fills its 40-point share proportionally. A 40% NWS chance contributes 16 points. HRRR is worth 30 points, ECMWF 10, and NBM 20. A positive model amount below 0.10 in gets 30% of that model's points. Exactly 0.10 in or more gets full points. Zero rain gets zero points.</p><p>The points are added and the result is capped at 100%. For example, NWS 7% contributes 2.8 points; ECMWF at 0.004 in contributes 3 points; and NBM at 0.012 in contributes 6 points. The total is 11.8%, shown as 12%. Rainfall amount is calculated separately. An unavailable model adds no points. This is an uncalibrated estimate, not a proven model-accuracy ranking. GraphCast is displayed separately and contributes 0 points while its 6-hour precipitation timing is validated.</p></details>
    <details class="model-hourly-list" data-model-detail="hours"><summary>All ${rows.length} forecast hours in this period</summary>${audit||'<p>No hourly calculation data was supplied.</p>'}</details>
    ${temperatures?`<details class="model-temperature-list" data-model-detail="temperatures"><summary>Temperature calculations</summary>${temperatures}</details>`:''}
    <details class="model-source-list" data-model-detail="sources"><summary>Source runs and availability</summary>${sourceStatus(forecast,view)}</details>`;
}

function experimentalPath() {
  return /\/weather-fusion\/experimental-weather\.html\/?$/.test(globalThis.location?.pathname || '');
}

function installGraphCastMapControl() {
  if(typeof document==='undefined'||!experimentalPath())return;
  const tabs=document.querySelector?.('.map-tabs');
  if(!tabs||tabs.querySelector?.('[data-graphcast-map]'))return;
  const button=document.createElement('button');
  button.type='button';button.disabled=true;button.className='graphcast-map-pending';button.dataset.graphcastMap='pending';
  button.textContent='GraphCast rain';button.title='GraphCast uses 6-hour precipitation windows. The map activates after GPU-generated frames are published.';
  button.setAttribute('aria-label','GraphCast rain map pending GPU forecast frames');
  tabs.append(button);
}

export function renderModelExplanation(forecast, now = Date.now()) {
  const panel = document.getElementById('model-explanation');
  if (!panel || !experimentalPath()) return null;
  const expanded = new Set(Array.from(panel.querySelectorAll?.('details[open][data-model-detail]') || [],detail=>detail.dataset.modelDetail));
  const active = document.activeElement, focusKey = panel.contains?.(active) ? active?.matches?.('[data-model-day]') ? '[data-model-day]' : active?.matches?.('[data-model-phase]') ? '[data-model-phase]' : null : null;
  const activeDetail = panel.contains?.(active) && active?.matches?.('summary') ? active.parentElement?.dataset?.modelDetail : null;
  latest = forecast; latestNow = now;
  const existing = (forecast?.days || []).findIndex(day=>day.date===selectedDate), index = existing < 0 ? 0 : existing;
  if (existing < 0) selectedPhase = null;
  const phase = existing < 0 ? null : selectedPhase, view = modelExplanationView(forecast,{index,phase,now});
  selectedDate = view.day.date;
  panel.hidden = false;
  panel.innerHTML = modelExplanationHTML(forecast,{index,phase:view.phase,now});
  for (const detail of panel.querySelectorAll?.('details[data-model-detail]') || []) {
    detail.open = expanded.has(detail.dataset.modelDetail);
    if (activeDetail === detail.dataset.modelDetail) detail.querySelector('summary')?.focus();
  }
  if (focusKey) panel.querySelector(focusKey)?.focus();
  panel.onchange = event => {
    const next = event.target;
    if (next?.matches?.('[data-model-day]')) {
      const dayIndex = Number(next.value);
      selectedDate = latest.days[dayIndex]?.date || null;
      selectedPhase = null;
    } else if (next?.matches?.('[data-model-phase]')) selectedPhase = next.value;
    else return;
    const key = next.matches('[data-model-day]') ? '[data-model-day]' : '[data-model-phase]';
    renderModelExplanation(latest,latestNow);
    panel.querySelector(key)?.focus();
  };
  installGraphCastMapControl();
  queueGraphCastLoad(forecast);
  return view;
}

export function resetModelExplanation() {
  latest = null; selectedDate = null; selectedPhase = null;
  const panel = document.getElementById('model-explanation');
  if (!panel) return;
  panel.hidden = true; panel.innerHTML = ''; panel.onchange = null;
}

if(typeof document!=='undefined')installGraphCastMapControl();
