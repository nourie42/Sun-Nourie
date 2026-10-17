import {calendarDayWindow} from './calendar-day.js?v=calendar-days-v1';
import {hideLowRainChance} from './rain-display.js?v=low-rain-display-v1';

// This is an isolated, client-side preview. It never writes weights back to the
// server or substitutes a model's rainfall signal for a rain probability.
const HOUR = 3600000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const CUSTOM_MODELS = Object.freeze([
  {id:'nws', name:'NWS', color:'#7fd4ff'},
  {id:'hrrr', name:'HRRR', color:'#ffb47d'},
  {id:'ecmwf', name:'ECMWF', color:'#b48cff'},
  {id:'nbm', name:'NBM', color:'#7de8a8'},
  {id:'wn', name:'NVIDIA WeatherNext', color:'#ffd479'},
]);
const MODEL_IDS = CUSTOM_MODELS.map(model => model.id);
const METRICS = {
  temperature:{label:'Temperature', unit:'°F', format:value => `${Math.round(value)}°`},
  precipitation:{label:'Liquid precipitation', unit:'in / hour', format:value => `${value.toFixed(3)} in`},
  wind:{label:'Wind', unit:'mph', format:value => `${Math.round(value)} mph`},
  dewpoint:{label:'Dew point', unit:'°F', format:value => `${Math.round(value)}°`},
};
const number = (value, places=1) => Number(value.toFixed(places));
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const modelName = id => CUSTOM_MODELS.find(model => model.id === id)?.name || id;

export function validateCustomWeights(weights = {}) {
  const entries = MODEL_IDS.map(id => [id, weights[id] ?? 0]);
  if (entries.some(([,value]) => !finite(value) || value < 0 || value > 100)) {
    return {valid:false, total:null, error:'Enter a percentage from 0 to 100 for each selected model.'};
  }
  const total = entries.reduce((sum,[,value]) => sum + value, 0);
  if (Math.abs(total - 100) > .00001) return {valid:false, total, error:`Your selected shares total ${number(total)}%. Set them to 100%, or choose Balance to 100%.`};
  return {valid:true, total:100, error:''};
}

/** Deterministic tenths of a percent, retaining the chosen proportions. */
export function normalizeCustomWeights(weights = {}, selected = MODEL_IDS) {
  const ids = MODEL_IDS.filter(id => selected.includes(id));
  const out = Object.fromEntries(MODEL_IDS.map(id => [id, 0]));
  if (!ids.length) return out;
  const values = ids.map(id => finite(weights[id]) && weights[id] > 0 ? weights[id] : 0);
  const sum = values.reduce((a,b) => a+b, 0);
  const raw = values.map(value => sum ? value / sum * 1000 : 1000 / ids.length);
  const units = raw.map(Math.floor);
  let remaining = 1000 - units.reduce((a,b) => a+b, 0);
  const order = ids.map((_,index) => index).sort((a,b) => (raw[b]-units[b]) - (raw[a]-units[a]) || a-b);
  for (let index=0; index<remaining; index++) units[order[index % order.length]]++;
  ids.forEach((id,index) => {out[id] = units[index]/10;});
  return out;
}

/** Missing values never become zero; the requested shares are rescaled only
 * among the selected sources that actually publish this metric at this hour. */
export function blendCustomSources(values = {}, weights = {}) {
  const selected = MODEL_IDS.filter(id => finite(weights[id]) && weights[id] > 0);
  const available = selected.filter(id => finite(values[id]));
  const missing = selected.filter(id => !finite(values[id]));
  const availableWeight = available.reduce((sum,id) => sum + weights[id], 0);
  const effectiveWeights = Object.fromEntries(available.map(id => [id, weights[id] / availableWeight * 100]));
  const value = availableWeight > 0 ? available.reduce((sum,id) => sum + values[id] * weights[id] / availableWeight, 0) : null;
  return {value, availableWeight, effectiveWeights, missing, renormalized:availableWeight > 0 && missing.length > 0};
}

function sourceValues(row, nonnegative = false) {
  const values = {};
  for (const source of row?.sources || []) if (MODEL_IDS.includes(source.id) && finite(source.value) && (!nonnegative || source.value >= 0)) values[source.id] = source.value;
  return values;
}
function metricMaps(forecast) {
  const series = forecast?.metricForecasts?.series || {};
  const maps = {};
  for (const key of ['temperature','wind','dewpoint']) maps[key] = new Map((series[key] || []).map(row => [Date.parse(row.time), row]));
  maps.precipitation = new Map((forecast?.rainTimeline || []).filter(row => {
    const start = Date.parse(row.time), end = Date.parse(row.end);
    return finite(start) && end-start === HOUR;
  }).map(row => [Date.parse(row.time), row]));
  return maps;
}
function precipitationValues(row) {
  // sourceValues represent amounts for exactly the row's one-hour interval.
  // rainLikelihood.sourceValues are wet/dry points and must not enter this sum.
  return Object.fromEntries(Object.entries(row?.precipitationBlend?.sourceValues || {}).filter(([id,value]) => MODEL_IDS.includes(id) && finite(value) && value >= 0));
}
function officialChance(row) {
  return finite(row?.officialPop) && row.officialPop >= 0 && row.officialPop <= 100 ? row.officialPop : null;
}

export function customModelAvailability(forecast) {
  const maps = metricMaps(forecast);
  return Object.fromEntries(MODEL_IDS.map(id => {
    const times = new Set();
    const metrics = [];
    for (const [key,map] of Object.entries(maps)) {
      let count=0;
      for (const [time,row] of map) {
        const values = key === 'precipitation' ? precipitationValues(row) : sourceValues(row,key === 'wind');
        if (finite(values[id]) && finite(time)) {times.add(time); count++;}
      }
      if (count) metrics.push(METRICS[key].label.toLowerCase());
    }
    return [id,{available:times.size > 0, hours:times.size, first:times.size ? Math.min(...times) : null, last:times.size ? Math.max(...times) : null, metrics}];
  }));
}

/** Seven local calendar dates, using only timestamp-matched published values.
 * A daily total or extrema require every displayed hour; partial tails stay null. */
export function buildCustomForecast(forecast, weights, now = Date.now()) {
  const validation = validateCustomWeights(weights);
  if (!validation.valid) return {...validation, hours:[], days:[]};
  const timeZone = forecast?.location?.timeZone || 'America/New_York';
  const dates = (forecast?.days || []).slice(0,7);
  const windows = dates.map((day,index) => calendarDayWindow(day,index,now,timeZone));
  if (!windows.length || windows.some(window => !finite(window.start) || !finite(window.end))) return {valid:false,total:100,error:'The forecast dates are unavailable. Refresh to try again.',hours:[],days:[]};
  const start = windows[0].start, end = windows.at(-1).end;
  if (end <= start || end-start > 8*24*HOUR) return {valid:false,total:100,error:'The forecast date range is unavailable. Refresh to try again.',hours:[],days:[]};
  const maps = metricMaps(forecast), hours = [];
  for (let time=start; time<end; time+=HOUR) {
    const row = {time, officialPop:officialChance(maps.precipitation.get(time))};
    for (const key of Object.keys(METRICS)) {
      const input = maps[key].get(time);
      const values = key === 'precipitation' ? precipitationValues(input) : sourceValues(input,key === 'wind');
      const main = key === 'precipitation' ? input?.precipitation : input?.value;
      row[key] = {...blendCustomSources(values,weights), sourceValues:values, main:finite(main) && (key !== 'precipitation' || main >= 0) ? main : null};
    }
    hours.push(row);
  }
  const days = dates.map((day,index) => {
    const window = windows[index], selected = hours.filter(row => row.time >= window.start && row.time < window.end);
    const complete = key => selected.length > 0 && selected.every(row => finite(row[key].value));
    const temps = selected.map(row => row.temperature.value);
    const probabilities = selected.map(row => row.officialPop);
    return {date:day.date, window, expectedHours:(window.end-window.start)/HOUR,
      high:complete('temperature') ? Math.max(...temps) : null,
      low:complete('temperature') ? Math.min(...temps) : null,
      precipitation:complete('precipitation') ? selected.reduce((sum,row) => sum + row.precipitation.value,0) : null,
      wind:complete('wind') ? selected.reduce((sum,row) => sum + row.wind.value,0)/selected.length : null,
      officialPop:probabilities.length && probabilities.every(finite) ? Math.max(...probabilities) : null,
      renormalizedHours:selected.filter(row => ['temperature','precipitation','wind'].some(key => row[key].renormalized)).length,
      availableHours:selected.filter(row => ['temperature','precipitation','wind'].some(key => finite(row[key].value))).length,
      incompleteHours:selected.filter(row => ['temperature','precipitation','wind'].some(key => !finite(row[key].value))).length,
      temperatureHours:selected.filter(row => finite(row.temperature.value)).length,
      precipitationHours:selected.filter(row => finite(row.precipitation.value)).length,
    };
  });
  return {valid:true,total:100,error:'',timeZone,hours,days,weights:{...weights}};
}

function svgChart(rows, key, selectedIndex, width) {
  const metric = METRICS[key], W=Math.max(270,Math.round(width || 340)), height=240;
  const pad={left:48,right:12,top:18,bottom:36}, innerW=W-pad.left-pad.right, innerH=height-pad.top-pad.bottom;
  const vals=rows.flatMap(row => [row[key].value,row[key].main]).filter(finite);
  if (!vals.length) return '<p class="cf-empty">No selected model publishes this variable for these hours.</p>';
  let min=Math.min(...vals), max=Math.max(...vals);
  const spread=max-min || (key==='precipitation' ? .02 : 4);
  min=key==='precipitation'||key==='wind' ? Math.max(0,min-spread*.12) : min-spread*.12;
  max+=spread*.12;
  const x=index => pad.left+index/Math.max(1,rows.length-1)*innerW;
  const y=value => pad.top+(max-value)/(max-min)*innerH;
  const line = field => {
    let path='', drawing=false;
    rows.forEach((row,index) => {
      const value=row[key][field];
      if (!finite(value)) {drawing=false;return;}
      path+=`${drawing?'L':'M'}${x(index).toFixed(1)},${y(value).toFixed(1)} `; drawing=true;
    });
    return path;
  };
  const ticks=Array.from({length:4},(_,index) => {
    const value=min+(max-min)*index/3, pos=y(value);
    const label=key==='precipitation' ? value.toFixed(max<.1?3:2) : Math.round(value);
    return `<line x1="${pad.left}" x2="${W-pad.right}" y1="${pos}" y2="${pos}" class="cf-grid"/><text x="${pad.left-8}" y="${pos+4}" text-anchor="end">${label}</text>`;
  }).join('');
  const labels=[0,Math.round((rows.length-1)/2),rows.length-1].map((index,i) => {
    const text=new Intl.DateTimeFormat('en-US',{timeZone:rows.timeZone,weekday:'short',hour:'numeric'}).format(rows[index].time);
    return `<text x="${x(index)}" y="${height-10}" text-anchor="${i===0?'start':i===2?'end':'middle'}">${safe(text)}</text>`;
  }).join('');
  const selected=rows[selectedIndex], value=selected?.[key]?.value;
  return `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${safe(metric.label)}: your preview in white and Weather Nourie in blue. Use the hour slider for exact values."><title>${safe(metric.label)} forecast comparison</title>${ticks}<path class="cf-main-line" d="${line('main')}"/><path class="cf-preview-line" d="${line('value')}"/><line class="cf-guide" x1="${x(selectedIndex)}" x2="${x(selectedIndex)}" y1="${pad.top}" y2="${height-pad.bottom}"/>${finite(value)?`<circle class="cf-selected-dot" cx="${x(selectedIndex)}" cy="${y(value)}" r="5"/>`:''}${labels}</svg>`;
}

export function installCustomForecast(options = {}) {
  if (typeof document === 'undefined') return null;
  const root=options.root || document.getElementById('custom-forecast-panel');
  const button=options.button || document.getElementById('open-custom-forecast');
  if (!root || root.dataset.customForecastInstalled === 'true') return null;
  root.dataset.customForecastInstalled='true';
  root.classList.add('custom-forecast');
  let forecast=globalThis.__weatherNourieForecast || null, preview=null, key='temperature', range=48, hourIndex=0;
  let weights={nws:36,hrrr:27,ecmwf:9,nbm:18,wn:10}, selected=new Set(MODEL_IDS), initialized=false;
  root.setAttribute('aria-labelledby','cf-title');
  root.innerHTML=`<header class="cf-header"><div><p class="cf-eyebrow">Your personal preview</p><h2 id="cf-title">Make your own forecast</h2></div><button type="button" class="cf-close" aria-label="Close Make your own forecast">×</button></header>
    <p class="cf-intro">Choose models and give each a share. Compare your preview with the Weather Nourie forecast.</p><p class="cf-place"></p>
    <fieldset class="cf-models"><legend>Choose your model shares</legend><div class="cf-model-list"></div></fieldset>
    <div class="cf-actions"><p class="cf-total" role="status" aria-live="polite"></p><button type="button" class="cf-balance">Balance to 100%</button><button type="button" class="cf-reset">Reset shares</button></div>
    <p class="cf-validation" role="alert" hidden></p>
    <div class="cf-results" hidden><div class="cf-chart-controls"><label>Show<select class="cf-metric" aria-label="Forecast variable">${Object.entries(METRICS).map(([id,metric])=>`<option value="${id}">${metric.label}</option>`).join('')}</select></label><label>Range<select class="cf-range" aria-label="Forecast range"><option value="48">48 hours</option><option value="168">7 days</option></select></label></div>
    <div class="cf-legend"><span><i class="cf-preview-swatch"></i>Your preview</span><span><i class="cf-main-swatch"></i>Weather Nourie</span></div>
    <div class="cf-chart"></div><label class="cf-hour-label" for="cf-hour">Explore each forecast hour</label><input id="cf-hour" class="cf-hour" type="range" min="0" max="0" value="0" step="1"><div class="cf-hour-reading" aria-live="polite" aria-atomic="true"></div>
    <details class="cf-effective"><summary>Shares used for this hour</summary><div></div></details>
    <h3 class="cf-days-title">Your next 7 days</h3><p class="cf-days-note">Each day ends at local midnight. Today includes the remaining forecast hours.</p><div class="cf-days"></div></div>
    <p class="cf-loading" role="status">Waiting for this location’s forecast…</p>
    <details class="cf-method"><summary>How this preview works</summary><p>Your shares apply to each matching model value, for each hour and variable. If a selected model does not cover an hour, its share is spread across the selected models that do. If none covers it, the value is Unavailable. Daily values require every displayed hour.</p><p>Liquid precipitation is an amount in inches, including the water equivalent of any snow. It is not a rain probability. The official NWS rain chance is shown separately and does not change with your shares. Model rainfall signals are never presented as model probabilities.</p><p>This preview changes only this panel. Weather Nourie’s published forecast stays unchanged.</p></details>`;
  const q=selector => root.querySelector(selector);
  const effective = () => Object.fromEntries(MODEL_IDS.map(id => [id,selected.has(id) ? weights[id] : 0]));
  const formatTime=time => new Intl.DateTimeFormat('en-US',{timeZone:preview?.timeZone || forecast?.location?.timeZone || 'America/New_York',weekday:'short',month:'short',day:'numeric',hour:'numeric'}).format(time);
  function renderModels() {
    const availability=customModelAvailability(forecast);
    q('.cf-model-list').innerHTML=CUSTOM_MODELS.map(model => {
      const status=availability[model.id], available=status.available;
      return `<div class="cf-model-row" style="--cf-model-color:${model.color}"><label class="cf-model-select"><input type="checkbox" data-cf-model="${model.id}" ${selected.has(model.id)?'checked':''}><span>${model.name}</span></label><label class="cf-weight-label"><span class="cf-sr-only">${model.name} share</span><input type="number" data-cf-weight="${model.id}" min="0" max="100" step="0.1" inputmode="decimal" value="${weights[model.id]}" ${!selected.has(model.id)?'disabled':''}><span aria-hidden="true">%</span></label><small>${available?`Published through ${safe(formatTime(status.last))}`:'Unavailable for this location'}</small></div>`;
    }).join('');
    for (const input of root.querySelectorAll('[data-cf-model]')) input.addEventListener('change',()=>{
      const id=input.dataset.cfModel;
      if (input.checked) selected.add(id); else selected.delete(id);
      q(`[data-cf-weight="${id}"]`).disabled=!input.checked;
      update();
    });
    for (const input of root.querySelectorAll('[data-cf-weight]')) input.addEventListener('input',()=>{
      weights[input.dataset.cfWeight]=input.value.trim()==='' ? NaN : Number(input.value);
      update();
    });
  }
  function displayRows() {
    const rows=preview.hours.slice(0,range === 48 ? 48 : undefined);
    rows.timeZone=preview.timeZone;
    return rows;
  }
  function drawHour() {
    const rows=displayRows();
    hourIndex=Math.max(0,Math.min(hourIndex,rows.length-1));
    q('.cf-hour').max=String(Math.max(0,rows.length-1));
    q('.cf-hour').value=String(hourIndex);
    const row=rows[hourIndex];
    if (!row) return;
    const metric=METRICS[key], result=row[key];
    q('.cf-chart').innerHTML=svgChart(rows,key,hourIndex,q('.cf-chart').clientWidth);
    const chance=finite(row.officialPop)&&!hideLowRainChance(row.officialPop)?`<p class="cf-official">Official NWS rain chance: ${Math.round(row.officialPop)}% · separate from your preview</p>`:'';
    q('.cf-hour-reading').innerHTML=`<p class="cf-selected-time">${safe(formatTime(row.time))}</p><div class="cf-reading-values"><p><span>Your preview</span><strong>${finite(result.value)?safe(metric.format(result.value)):'Unavailable'}</strong></p><p><span>Weather Nourie</span><strong>${finite(result.main)?safe(metric.format(result.main)):'Unavailable'}</strong></p></div><p class="cf-unit">${safe(metric.label)} · ${safe(metric.unit)}</p>${chance}${result.missing.length?`<p class="cf-coverage">${result.renormalized?'Shares adjusted':'No selected source available'}: ${safe(result.missing.map(modelName).join(', '))} ${result.missing.length===1?'has':'have'} no matching ${metric.label.toLowerCase()} value for this hour.</p>`:'<p class="cf-coverage">All selected models cover this variable at this hour.</p>'}`;
    q('.cf-effective > div').innerHTML=Object.keys(result.effectiveWeights).length?`<ul>${Object.entries(result.effectiveWeights).map(([id,weight])=>`<li>${safe(modelName(id))}: <strong>${number(weight)}%</strong> · ${safe(metric.format(result.sourceValues[id]))}</li>`).join('')}</ul>`:'<p>Unavailable. No unselected model is substituted.</p>';
    q('.cf-chart').onclick=event=>{
      const bounds=q('.cf-chart').getBoundingClientRect();
      const usable=Math.max(1,bounds.width-60);
      hourIndex=Math.max(0,Math.min(rows.length-1,Math.round((event.clientX-bounds.left-48)/usable*(rows.length-1))));
      drawHour();
    };
  }
  function drawDays() {
    q('.cf-days').innerHTML=preview.days.map((day,index)=>{
      const date=new Date(`${day.date}T12:00:00Z`);
      const weekday=index===0?'Today':new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short'}).format(date);
      const dateLabel=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(date);
      return `<article class="cf-day"><h4>${weekday}</h4><p class="cf-day-date">${dateLabel}</p><dl><div><dt>${index===0?'Remaining high / low':'High / low'}</dt><dd>${finite(day.high)&&finite(day.low)?`${Math.round(day.high)}° / ${Math.round(day.low)}°`:'Unavailable'}</dd></div><div><dt>Liquid precip.</dt><dd>${finite(day.precipitation)?`${day.precipitation.toFixed(2)} in`:'Unavailable'}</dd></div><div><dt>Average wind</dt><dd>${finite(day.wind)?`${Math.round(day.wind)} mph`:'Unavailable'}</dd></div>${finite(day.officialPop)&&!hideLowRainChance(day.officialPop)?`<div class="cf-day-official"><dt>NWS hourly peak</dt><dd>${Math.round(day.officialPop)}%</dd></div>`:''}</dl><p class="cf-day-adjustment">${!day.availableHours?'No selected model coverage':day.renormalizedHours?`Shares adjusted in ${day.renormalizedHours} of ${day.expectedHours} hours`:day.incompleteHours?'Selected models end before this day is complete':'Requested shares used'}</p>${!finite(day.high)||!finite(day.precipitation)?'<p class="cf-day-partial">Incomplete model coverage</p>':''}</article>`;
    }).join('');
  }
  function update() {
    const requested=effective(), validation=validateCustomWeights(requested);
    q('.cf-total').textContent=validation.total===null?'Check model shares':`Total: ${number(validation.total)}%`;
    q('.cf-total').classList.toggle('cf-valid',validation.valid);
    q('.cf-validation').textContent=validation.error;
    q('.cf-validation').hidden=validation.valid;
    q('.cf-loading').hidden=!!forecast;
    q('.cf-models').disabled=!forecast;
    q('.cf-balance').disabled=!forecast;
    q('.cf-reset').disabled=!forecast;
    q('.cf-place').textContent=forecast?.location?.name || '';
    if (!forecast || !validation.valid) {q('.cf-results').hidden=true;preview=null;return;}
    preview=buildCustomForecast(forecast,requested);
    q('.cf-results').hidden=!preview.valid;
    if (!preview.valid) {q('.cf-validation').hidden=false;q('.cf-validation').textContent=preview.error;return;}
    drawHour();drawDays();
  }
  function useForecast(next) {
    if (!next?.location) return;
    forecast=next;
    q('.cf-loading').textContent='Waiting for this location’s forecast…';
    if (!initialized) {
      const defaults=forecast?.blendPolicy?.sameDay;
      if (defaults) weights=normalizeCustomWeights(Object.fromEntries(MODEL_IDS.map(id=>[id,(defaults[id]||0)*100])));
      const availability=customModelAvailability(forecast);
      selected=new Set(MODEL_IDS.filter(id=>availability[id].available && weights[id]>0));
      weights=normalizeCustomWeights(weights,[...selected]);
      initialized=true;
    }
    renderModels();update();
  }
  q('.cf-close').addEventListener('click',()=>{root.hidden=true;button?.setAttribute('aria-expanded','false');button?.focus();});
  button?.setAttribute('aria-controls',root.id);
  button?.setAttribute('aria-expanded',String(!root.hidden));
  button?.addEventListener('click',()=>{
    root.hidden=!root.hidden;button.setAttribute('aria-expanded',String(!root.hidden));
    if (!root.hidden) {if (preview?.valid) drawHour();root.scrollIntoView({behavior:'smooth',block:'start'});}
  });
  q('.cf-balance').addEventListener('click',()=>{weights=normalizeCustomWeights(weights,[...selected]);renderModels();update();});
  q('.cf-reset').addEventListener('click',()=>{initialized=false;if (forecast) useForecast(forecast);});
  q('.cf-metric').addEventListener('change',event=>{key=event.target.value;if(preview?.valid)drawHour();});
  q('.cf-range').addEventListener('change',event=>{range=Number(event.target.value);if(preview?.valid)drawHour();});
  q('.cf-hour').addEventListener('input',event=>{hourIndex=Number(event.target.value);if(preview?.valid)drawHour();});
  const receiveForecast=event=>useForecast(event.detail);
  const resetForecast=()=>{forecast=null;preview=null;hourIndex=0;q('.cf-loading').textContent='Loading the forecast for the new location…';renderModels();update();};
  document.addEventListener('weather-nourie:forecast',receiveForecast);
  document.addEventListener('weather-nourie:reset',resetForecast);
  let observer=null;
  if (typeof ResizeObserver !== 'undefined') {observer=new ResizeObserver(()=>{if(!root.hidden && preview?.valid)drawHour();});observer.observe(q('.cf-chart'));}
  if (forecast) useForecast(forecast); else {renderModels();update();}
  return {setForecast:useForecast, getPreview:()=>preview, getWeights:()=>effective(), destroy:()=>{observer?.disconnect();document.removeEventListener('weather-nourie:forecast',receiveForecast);document.removeEventListener('weather-nourie:reset',resetForecast);}};
}
