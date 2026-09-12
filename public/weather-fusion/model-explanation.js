const HOUR = 3600000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const chance = value => finite(value) && value >= 0 && value <= 100 ? value : null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const names = {nws:'NWS',hrrr:'HRRR',ecmwf:'ECMWF',nbm:'NBM'};
const phaseNames = {overall:'Full day',daytime:'Daytime',overnight:'Overnight'};
let latest = null, latestNow = 0, selectedDate = null, selectedPhase = null;

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
  return ['nws','hrrr','ecmwf'].map(id => {
    const used = sources.find(source => source.id === id && finite(source.value) && finite(source.weight) && source.weight > 0);
    const value = finite(likelihood?.sourceValues?.[id]) ? likelihood.sourceValues[id] : used?.value;
    return {id,value:finite(value)?value:null,amount:finite(likelihood?.sourceAmounts?.[id])?likelihood.sourceAmounts[id]:null,
      weight:used?.weight ?? null,points:used ? used.value*used.weight : null,runAt:used?.runAt || null};
  });
}

function sourceTable(likelihood, caption = 'Inputs for the highest hour') {
  const rows = sourceRows(likelihood).map(source => {
    const input = source.id === 'nws'
      ? source.value === null ? 'Unavailable' : `${number(source.value)}% probability`
      : source.amount === null ? 'Unavailable' : `${number(source.amount,8)} in`;
    const signal = source.id === 'nws' ? '' : source.value === null ? '' : `<small>QPF evidence: ${number(source.value)}/100</small>`;
    return `<tr><th scope="row">${names[source.id]}</th><td>${input}${signal}</td><td>${source.weight === null?'Not used':`${number(source.weight*100,4)}%`}</td><td>${source.points === null?'—':number(source.points,6)}</td></tr>`;
  }).join('');
  return `<table class="model-inputs"><caption>${esc(caption)}</caption><thead><tr><th scope="col">Source</th><th scope="col">Rain input</th><th scope="col">Weight</th><th scope="col">Points</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function arithmetic(likelihood) {
  if (!likelihood || chance(likelihood.value) === null) return '<p class="model-calculation">This hour does not have a usable rain estimate.</p>';
  const sources = sourceRows(likelihood).filter(source => source.weight !== null);
  if (!sources.length) return '<p class="model-calculation">The calculation inputs were not supplied.</p>';
  const formula = sources.map(source=>`${number(source.value)} × ${number(source.weight,6)}`).join(' + ');
  const weightedValue = finite(likelihood.weightedValue) ? likelihood.weightedValue : null;
  const rounded = finite(likelihood.rawValue) ? likelihood.rawValue : null;
  const zeroed = rounded !== null && rounded !== likelihood.value && likelihood.value === 0;
  const wet = (likelihood.wetSources || []).map(id=>names[id]||id);
  return `<div class="model-calculation"><p class="model-formula">${esc(formula)}${weightedValue===null?'':` ≈ ${number(weightedValue,8)}`}</p>
    <p>${rounded===null?'':`Rounded: <b>${number(rounded)}%</b>. `}Shown: <b>${percent(likelihood.value)}</b>.</p>
    ${zeroed?`<p class="model-zero-rule">Shown as 0% because the blend is below ${number(likelihood.uncorroboratedDisplayLimit)}% and fewer than two available sources support rain${wet.length?` (${esc(wet.join(', '))} only)`:''}.</p>`:''}</div>`;
}

function temperatureBlend(day, kind) {
  const blend = day?.[`${kind}Blend`], sources = (blend?.sources || []).filter(source=>finite(source.value)&&finite(source.weight)&&source.weight>0);
  if (!sources.length || !finite(day?.[kind])) return '';
  const rows = sources.map(source=>`<tr><th scope="row">${esc(names[source.id]||source.id)}</th><td>${number(source.value,4)}°F</td><td>${number(source.weight*100,4)}%</td></tr>`).join('');
  const formula = sources.map(source=>`${number(source.value,4)} × ${number(source.weight,6)}`).join(' + ');
  return `<div class="model-temperature"><h4>${kind==='high'?'High':'Low'}: ${Math.round(day[kind])}°F</h4><table class="model-inputs"><thead><tr><th scope="col">Source</th><th scope="col">Temperature</th><th scope="col">Weight</th></tr></thead><tbody>${rows}</tbody></table><p class="model-formula">${esc(formula)}${finite(blend.value)?` = ${number(blend.value,4)}°F`:''} → ${Math.round(day[kind])}°F</p></div>`;
}

function sourceStatus(forecast, view) {
  const peakSources = sourceRows(view.peak), models = forecast?.modelContributions || [], feeds = forecast?.feeds || [];
  return `<dl class="model-runs">${['nws','hrrr','ecmwf'].map(id => {
    const source = peakSources.find(row=>row.id===id), model = models.find(row=>row.id===id), feed = feeds.find(row=>row.id===(id==='nws'?'hourly':id)) || feeds.find(row=>row.id===id);
    const used = source?.weight !== null, issued = source?.runAt || (id === 'nws' ? feed?.id==='hourly'?feed.issuedAt:null : model?.runAt || feed?.issuedAt);
    const kind = id === 'nws' ? 'Issued' : 'Latest published run';
    return `<div><dt>${names[id]} <span>${used?'Used at peak':'Not used at peak'}</span></dt><dd>${kind}: ${esc(stamp(issued,view.zone))}${model?.runScope?`<small>${esc(model.runScope)}</small>`:''}${feed?.fetchedAt?`<small>Data fetched: ${esc(stamp(feed.fetchedAt,view.zone))}</small>`:''}${feed?.checkedAt?`<small>Last check: ${esc(stamp(feed.checkedAt,view.zone))}</small>`:''}${feed?.retrievalStatus==='last-verified'?'<small>Using last verified data; the latest refresh did not succeed.</small>':''}${feed?.refreshWarning?`<small>${esc(feed.refreshWarning)}</small>`:''}${feed?.status&&feed.status!=='ready'?`<small>Feed: ${esc(feed.status)}</small>`:''}</dd></div>`;
  }).join('')}</dl>`;
}

export function modelExplanationHTML(forecast, options = {}) {
  const view = modelExplanationView(forecast,options), {day,zone,period,rows,peak,phase} = view;
  const choices = (forecast?.days || []).map((row,index)=>`<option value="${index}"${index===view.index?' selected':''}>${esc(dayLabel(row.date,index))}</option>`).join('');
  const phaseOptions = Object.entries(phaseNames).map(([key,name])=>`<option value="${key}"${key===phase?' selected':''}>${name}</option>`).join('');
  const threshold = finite(peak?.traceThresholdInches) ? number(peak.traceThresholdInches,8) : null;
  const fullScale = finite(peak?.signalFullScaleInches) ? number(peak.signalFullScaleInches,8) : null;
  const temperatures = temperatureBlend(day,'high')+temperatureBlend(day,'low');
  const audit = rows.map(row=>`<details class="model-hour-audit" data-model-detail="hour-${esc(row.time)}"${row.time===view.peakTime?' data-peak="true"':''}><summary><span>${esc(stamp(row.time,zone))}</span><strong>${percent(row.rainLikelihood?.value)}</strong></summary>${sourceTable(row.rainLikelihood,'Hourly inputs')}${arithmetic(row.rainLikelihood)}</details>`).join('');
  return `<div class="model-explanation-heading"><h2 id="model-explanation-title">Why this forecast</h2><div class="model-selectors"><label>Day<select aria-label="Day" data-model-day>${choices}</select></label><label>Period<select aria-label="Period" data-model-phase>${phaseOptions}</select></label></div></div>
    <div class="model-period"><strong>${percent(view.value)}</strong><span>${phaseNames[phase]} · highest hourly blended estimate<small>${esc(stamp(period.window?.start,zone))} – ${esc(stamp(period.window?.end,zone))}</small></span></div>
    <p class="model-definition">This number is the highest hourly estimate in this period, not a separate probability of rain at any time during the whole period.</p>
    ${view.mismatch?`<p class="model-data-warning">Data mismatch: the period shows ${percent(view.value)}, but the highest supplied hour is ${percent(view.maximum)}.</p>`:''}
    ${!view.complete?`<p class="model-data-warning">Incomplete coverage: ${number(period.coverage?.availableHours)} of ${number(period.coverage?.expectedHours)} hours. The period estimate stays unavailable.${view.maximum===null?'':` Highest available hour: ${percent(view.maximum)}.`}</p>`:''}
    ${view.peakTime?`<h3>Highest hour: ${esc(stamp(view.peakTime,zone))}–${esc(stamp(view.peakEnd,zone,false))}</h3>`:''}
    ${sourceTable(peak)}${arithmetic(peak)}
    <details class="model-method" data-model-detail="method"><summary>How the inputs are used</summary><p>NWS supplies an official rain probability. HRRR and ECMWF supply rain amounts, not their own probabilities.${threshold===null?'':` An hourly amount below ${threshold} in is treated as trace-only and gets 0 evidence points.`}${fullScale===null?'':` Amounts from ${threshold} to ${fullScale} in scale from 10 to 100 evidence points; larger amounts stay at 100.`}</p><p>The listed weights are the weights actually used for this hour. Missing sources are excluded, not counted as dry, and the remaining weights are rescaled. This is an uncalibrated blend, not a proven model-accuracy ranking.</p><p>A weak blend below 25% is displayed as 0% unless at least two available sources support rain. This prevents one trace or low-probability input from putting rain on an otherwise dry hour.</p></details>
    <details class="model-hourly-list" data-model-detail="hours"><summary>All ${rows.length} forecast hours in this period</summary>${audit||'<p>No hourly calculation data was supplied.</p>'}</details>
    ${temperatures?`<details class="model-temperature-list" data-model-detail="temperatures"><summary>Temperature calculations</summary>${temperatures}</details>`:''}
    <details class="model-source-list" data-model-detail="sources"><summary>Source runs and availability</summary>${sourceStatus(forecast,view)}</details>`;
}

function experimentalPath() {
  return /\/weather-fusion\/experimental-weather\.html\/?$/.test(globalThis.location?.pathname || '');
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
  return view;
}

export function resetModelExplanation() {
  latest = null; selectedDate = null; selectedPhase = null;
  const panel = document.getElementById('model-explanation');
  if (!panel) return;
  panel.hidden = true; panel.innerHTML = ''; panel.onchange = null;
}
