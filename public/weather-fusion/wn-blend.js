import {hideLowRainChance} from './rain-display.js?v=low-rain-display-v1';
/** Compare the published Weather Nourie forecast with individual model guidance. */
import {dailyForecastReadings} from './seven-day.js?v=low-rain-display-v1';
import {calendarDayWindow} from './calendar-day.js?v=calendar-days-v1';
import {COMPARISON_DAY_LIMIT,comparisonChartData,comparisonLinePath,comparisonIsolatedPoints,comparisonYAxis,comparisonDayValues} from './wn-compare.js?v=selectable-seven-day-v1';
const WN_FEED = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext-full.json';
const MS_PER_DAY = 86400000;

const VARIABLES = {
  temp:     { label: 'Temperature',   unit: '°F',  fmt: (v) => `${Math.round(v)}°` },
  rain:     { label: 'Precipitation', unit: 'in',  fmt: (v) => `${v.toFixed(2)}"` },
  wind:     { label: 'Wind',          unit: 'mph', fmt: (v) => `${Math.round(v)}` },
  dewpoint: { label: 'Dewpoint',      unit: '°F',  fmt: (v) => `${Math.round(v)}°` },
  pop:      { label: 'Rain chance',   unit: '%',   fmt: (v) => `${Math.round(v)}%` },
  uv:       { label: 'UV Index',      unit: '',    fmt: (v) => `${Math.round(v)}` },
  snow:     { label: 'Snow',          unit: 'in',  fmt: (v) => `${v.toFixed(1)}"` },
  aqi:      { label: 'AQI',           unit: '',    fmt: (v) => `${Math.round(v)}` },
};
let curVar = 'temp';

const COLORS = {
  nourie: '#ffffff',
  nws: '#7fd4ff', hrrr: '#ffb47d', nam: '#68e5dc', nbm: '#7de8a8', ecmwf: '#b48cff', wn: '#ffd479', gfs: '#ff8fc8',
  single: '#7fd4ff',
};
const K2F = (k) => (k - 273.15) * 9 / 5 + 32;
const MS2MPH = (ms) => ms * 2.23694;
const M2IN = (m) => m * 39.3701; // WeatherNext/ECMWF precipitation is in metres
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function getLoc() {
  const m = location.search.match(/[?&]location=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : 'knightdale';
}
// Local date key YYYY-MM-DD in the forecast's timezone
function localDateKey(ms, tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch { return new Date(ms).toISOString().slice(0, 10); }
}

async function loadWNFeed() {
  try {
    const feed = await fetchJSON(WN_FEED);
    const src = feed.sources?.surface;
    const pts = src?.points || [];
    return { pts, runAt: src?.runAt || feed.runAt };
  } catch { return null; }
}
// Pick the WeatherNext point for the forecast location; null if none is within ~25 km.
function pickWN(raw, fx) {
  if (!raw?.pts?.length) return null;
  const la = fx?.location?.latitude, lo = fx?.location?.longitude;
  let pt = null;
  if (finite(la) && finite(lo)) {
    let best = Infinity;
    for (const p of raw.pts) {
      if (!finite(p.latitude) || !finite(p.longitude)) continue;
      const dy = (p.latitude - la) * 111, dx = (p.longitude - lo) * 111 * Math.cos(la * Math.PI / 180);
      const dkm = Math.hypot(dx, dy);
      if (dkm < best) { best = dkm; pt = p; }
    }
    if (best > 25) pt = null;
  } else {
    pt = raw.pts.find((p) => (p.name || '').toLowerCase().includes('knightdale')) || null;
  }
  if (!pt?.hourly?.length) return null;
  const runAt = raw.runAt;
  const ageDays = runAt ? (Date.now() - new Date(runAt).getTime()) / MS_PER_DAY : null;
  return { hourly: pt.hourly, runAt, ageDays };
}

function seriesInWindow(series, window) {
  return (series || []).filter(point => {
    const time = Date.parse(point.time);
    return finite(time) && window && time >= window.start && time < window.end;
  });
}
function aggregate(values, method = 'max') {
  const available = values.filter(finite);
  if (!available.length) return null;
  return method === 'mean' ? available.reduce((sum, value) => sum + value, 0) / available.length
    : method === 'min' ? Math.min(...available) : Math.max(...available);
}
function completeHourlyCoverage(times, window) {
  if (!window || !finite(window.start) || !finite(window.end) || window.end <= window.start) return false;
  for (let time = window.start; time < window.end; time += 3600000) if (!times.has(time)) return false;
  return true;
}
function dailySources(series, windows, method, requireComplete = false) {
  return windows.map(window => {
    const sources = {}, coverage = {};
    for (const point of seriesInWindow(series, window)) for (const source of point.sources || []) {
      if (finite(source.value)) {
        (sources[source.id] ||= []).push(source.value);
        (coverage[source.id] ||= new Set()).add(Date.parse(point.time));
      }
    }
    // An overnight tail at a model's range limit is not a forecast daily high.
    return Object.fromEntries(Object.entries(sources)
      .filter(([id]) => !requireComplete || completeHourlyCoverage(coverage[id], window))
      .map(([id, values]) => [id, aggregate(values, method)]));
  });
}

function calendarRainSources(rows,window){
  const points=(rows||[]).filter(point=>{
    const start=Date.parse(point.time),end=Date.parse(point.end)||start+3600000;
    return finite(start)&&start<window.end&&end>window.start;
  }).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const ids=new Set(points.flatMap(point=>Object.keys(point.precipitationBlend?.sourceValues||{}))),out={};
  for(const id of ids){
    let cursor=window.start,total=0,complete=true;
    for(const point of points){
      const start=Date.parse(point.time),end=Date.parse(point.end)||start+3600000;
      const value=point.precipitationBlend?.sourceValues?.[id],left=Math.max(window.start,start),right=Math.min(window.end,end);
      if(left>cursor||!finite(value)||value<0||end<=start){complete=false;break;}
      total+=value*Math.max(0,right-Math.max(cursor,left))/(end-start);cursor=Math.max(cursor,right);
    }
    if(complete&&cursor>=window.end)out[id]=total;
  }
  return out;
}

// Aggregate WN hourly to daily
function wnDaily(wnHourly, varKey, agg, days, tz, convert, windows) {
  if (!wnHourly) return days.map(() => null);
  const byDay = {};
  const hours = [];
  for (const h of wnHourly) {
    const v = h.values?.[varKey];
    const raw = v && typeof v === 'object' ? v.mean : v;
    if (!finite(raw)) continue;
    const val = convert ? convert(raw) : raw;
    const t = Date.parse(h.time);
    if (!finite(t) || !finite(val) || (agg === 'sum' && val < 0)) continue;
    hours.push([t, val]);
    const key = localDateKey(t, tz);
    (byDay[key] = byDay[key] || []).push(val);
  }
  return days.map((d, i) => {
    const w = windows?.[i];
    if (w && (!finite(w.start) || !finite(w.end) || w.end <= w.start)) return null;
    // hourly accumulations are labelled at the END of the hour, so (start, end]
    const accumulation = agg === 'sum';
    const selected = w ? hours.filter(([t]) => accumulation ? t > w.start && t - 3600000 < w.end : t >= w.start && t < w.end) : null;
    const vals = selected ? selected.map(([, value]) => value) : byDay[d.dateKey];
    if (w && accumulation) {
      const intervals = [...new Map(selected).entries()].sort((a, b) => a[0] - b[0]);
      let covered = w.start, total = 0;
      for (const [end, value] of intervals) {
        const start = Math.max(w.start, end - 3600000), stop = Math.min(w.end, end);
        if (start > covered || stop <= start) return null;
        total += value * (stop - Math.max(start, covered)) / 3600000;
        covered = Math.max(covered, stop);
      }
      return covered >= w.end ? total : null;
    }
    if (w && varKey === 'temperature_2m' && !completeHourlyCoverage(new Set(selected.map(([time]) => time)), w)) return null;
    if (!vals?.length) return null;
    return accumulation ? vals.reduce((a, b) => a + b, 0) : aggregate(vals, agg);
  });
}

// Aggregate AQI hours to daily max
function aqiDaily(aqHours, days, tz) {
  if (!aqHours?.length) return days.map(() => null);
  const byDay = {};
  for (const h of aqHours) {
    if (!finite(h.aqi)) continue;
    const key = localDateKey(Date.parse(h.time), tz);
    const b = (byDay[key] = byDay[key] || []);
    b.push(h.aqi);
  }
  return days.map((d) => {
    const vals = byDay[d.dateKey];
    return vals?.length ? Math.max(...vals) : null;
  });
}

export function buildSeries(fx, wn, varId, now = Date.now()) {
  const tz = fx.location?.timeZone || 'America/New_York';
  const readings = dailyForecastReadings(fx, now, COMPARISON_DAY_LIMIT);
  const days = (fx.days || []).slice(0, COMPARISON_DAY_LIMIT).map(d => ({ date: d.date, dateKey: d.date, tonight: false }));
  const windows = days.map((day,index)=>{
    const calendar=calendarDayWindow(day,index,now,tz),published=readings[index]?.windWindow;
    return {start:varId!=='temp'&&finite(published?.start)?Math.max(calendar.start,published.start):calendar.start,
      end:varId==='temp'?calendar.end:finite(published?.end)?Math.min(calendar.end,published.end):calendar.end};
  });
  const out = { nwsFallback:varId==='pop'&&readings.some(day=>day.rainSourceFallback&&finite(day.pop)),days, perModel: true, wnVals: days.map(() => null), modelMaps: days.map(() => ({})), forecastValues: days.map(() => null), windows };

  if (varId === 'temp' || varId === 'rain') {
    out.forecastValues = readings.map(day => varId === 'temp' ? day.high : day.amount);
    days.forEach((d, i) => {
      const day = fx.days[i] || {}, key = varId === 'temp' ? 'highBlend' : 'qpfBlend';
      const blend = day[key] || {}, src = {};
      for (const source of blend.sources || []) {
        // A partial model accumulation is not a complete daily rain total.
        const value = varId === 'rain' && blend.sourceValues && Object.hasOwn(blend.sourceValues, source.id) ? blend.sourceValues[source.id] : source.value;
        if (finite(value)) src[source.id] = value;
      }
      out.modelMaps[i] = varId==='rain'&&Array.isArray(fx.rainTimeline)?calendarRainSources(fx.rainTimeline,windows[i]):src;
    });
    if(varId==='temp'){
      const temperatureSeries=fx.metricForecasts?.series?.temperature||fx.hours?.map(hour=>({time:hour.time,sources:hour.temperatureBlend?.sources}))||[];
      out.modelMaps=dailySources(temperatureSeries,windows,'max',true);
    }
    out.wnVals = wnDaily(fx.google?.contributes ? null : wn?.hourly, varId === 'temp' ? 'temperature_2m' : 'total_precipitation_1hr',
      varId === 'temp' ? 'max' : 'sum', days, tz, varId === 'temp' ? K2F : M2IN, windows);
  } else if (varId === 'pop') {
    // Per-model rain chance at each day's peak hour (from the server's rain-likelihood blend).
    // NWS is a true probability; HRRR/NBM/ECMWF are each model's wet/dry rain signal. WeatherNext has no PoP field.
    days.forEach((d, i) => {
      const day = fx.days[i] || {}, likelihood = day.rainLikelihood;
      const peak=(fx.rainTimeline||[]).filter(row=>{
        const start=Date.parse(row.time),end=Date.parse(row.end)||start+3600000;
        return start<windows[i].end&&end>windows[i].start&&finite(row.rainLikelihood?.value);
      })
        .reduce((best,row)=>!best||row.rainLikelihood.value>best.rainLikelihood.value?row:best,null);
      const sv = peak?.rainLikelihood?.sourceValues || likelihood?.peak?.sourceValues || {};
      const src = {}; for (const [id, v] of Object.entries(sv)) if (finite(v)) src[id] = v;
      out.modelMaps[i] = src;
    });
    out.forecastValues = readings.map(day => day.pop);
  } else if (varId === 'wind' || varId === 'dewpoint' || varId === 'humidity') {
    const key = varId === 'wind' ? 'wind' : varId;
    out.modelMaps = dailySources(fx.metricForecasts?.series?.[key], windows, varId === 'wind' ? 'mean' : 'max');
    out.forecastValues = varId === 'wind' ? readings.map(day => day.wind) : windows.map(window => aggregate(seriesInWindow(fx.metricForecasts?.series?.[key], window).map(point => point.value)));
    if (varId === 'wind') out.wnVals = wnDaily(fx.google?.contributes ? null : wn?.hourly, 'wind_speed_10m', 'mean', days, tz, MS2MPH, windows);
    if (varId === 'dewpoint') out.wnVals = wnDaily(fx.google?.contributes ? null : wn?.hourly, 'dewpoint_temperature_2m', 'max', days, tz, K2F, windows);
    // humidity: no WN feed
  } else if (varId === 'snow') {
    out.forecastValues = readings.map(day => finite(day.snowfall) ? day.snowfall : null);
    days.forEach((d, i) => {
      const r = (fx.snow?.days || []).find((x) => x.date === d.date), src = {};
      if (r?.nwsCovered === true && r.displaySnowfall?.source === 'NWS point forecast' && finite(r.displaySnowfall.value)) src.nws = r.displaySnowfall.value;
      for (const id of ['hrrr', 'nam']) if (finite(r?.nearTermModels?.[id])) src[id] = r.nearTermModels[id];
      if (r && finite(r.models?.ecmwf)) src.ecmwf = r.models.ecmwf;
      if (r && finite(r.models?.gfs)) src.gfs = r.models.gfs;
      out.modelMaps[i] = src;
    });
  } else if (varId === 'uv') {
    out.perModel = false;
    out.single = (fx.days || []).slice(0, COMPARISON_DAY_LIMIT).map((d) => (finite(d.uvMax) ? d.uvMax : null));
  } else if (varId === 'aqi') {
    out.perModel = false;
    out.single = aqiDaily(fx.airQuality?.hours, days, tz);
  }
  out.forecastValues = out.forecastValues.map(value => finite(value) ? value : null);
  return out;
}

const hiddenModels = new Set();
const NAMES = { nourie: 'Weather Nourie blend', nws: 'NWS', hrrr: 'HRRR', nam: 'NAM', nbm: 'NBM', ecmwf: 'ECMWF', wn: 'NVIDIA WeatherNext', gfs: 'GFS', single: '' };
function renderChart(container, built, varDef, varId) {
  container._wnDismiss?.();container._wnDismiss=null;
  const restoreDayFocus=document.activeElement?.id==='wn-compare-day';
  const chart=comparisonChartData(built,hiddenModels);
  const {days,series,ids,visible,values:allV}=chart;
  const displayName=id=>id==='nourie'&&built.nwsFallback?'Weather Nourie forecast':NAMES[id];
  // Size the SVG to its real pixel width so text stays legible on phones.
  const W = Math.max(240, Math.round(container.clientWidth || 900));
  const phone = W < 600;
  const H = phone ? 340 : 380, PL = phone ? 38 : 52, PR = phone ? 10 : 18, PT = 30, PB = 34;
  const FS = phone ? 11 : 14;
  if (!ids.some(id => series[id].some(finite))) {
    container.innerHTML = '<p class="muted" style="font-size:14px">No data for this variable.</p>';
    return;
  }
  const {lo,hi}=comparisonYAxis(allV,varDef.unit,varId);
  const n = days.length;
  const X = (i) => PL + (i / Math.max(1, n - 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const path = pts=>comparisonLinePath(pts,X,Y);
  const dayName = (d, i, long) => {
    const dt = new Date(d.date + 'T12:00:00');
    if (long) return `${d.tonight ? 'Tonight · ' : ''}${dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
    return i === 0 ? (d.tonight ? (phone ? 'Tnt' : 'Tonight') : phone ? 'Tdy' : 'Today') : dt.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, phone ? 2 : 3);
  };
  const labels = days.map((d, i) => `<text x="${X(i).toFixed(0)}" y="${H - 10}" text-anchor="middle" font-size="${FS}" font-weight="600" fill="#d5e1f2">${dayName(d, i)}</text>`).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const ylabels = ticks.map((v) =>
    `<line x1="${PL}" x2="${W - PR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="rgba(255,255,255,.14)" stroke-width="1"/>`
    + `<text x="${PL - 6}" y="${(Y(v) + 4).toFixed(0)}" text-anchor="end" font-size="${FS}" fill="#d5e1f2">${varDef.fmt(v)}</text>`).join('');
  const style = { wn: { w: 2.5, dash: '6,4', op: 0.9 }, nws: { w: 2.5, op: 0.85 }, hrrr: { w: 2.5, op: 0.85 }, nam: { w: 2.5, op: 0.85 }, nbm: { w: 2.5, op: 0.85 }, ecmwf: { w: 2.5, op: 0.85 }, gfs: { w: 2.5, op: 0.85 }, nourie: { w: 4, op: 1 }, single: { w: 4, op: 1 } };
  const drawOrder = ['wn', 'nws', 'hrrr', 'nam', 'nbm', 'ecmwf', 'gfs', 'nourie', 'single'].filter((id) => visible.includes(id));
  const lines = drawOrder.map((id) => { const s = style[id], d = path(series[id]); return d ? `<path data-series="${id}" d="${d}" fill="none" stroke="${COLORS[id]}" stroke-width="${s.w}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} opacity="${s.op}" stroke-linecap="round" stroke-linejoin="round"/>` : ''; }).join('');
  const isolated=drawOrder.filter(id=>id!=='nourie'&&id!=='single').flatMap(id=>comparisonIsolatedPoints(series[id]).map(({index,value})=>`<circle data-model-point="${id}" data-index="${index}" data-value="${value}" cx="${X(index).toFixed(1)}" cy="${Y(value).toFixed(1)}" r="3.5" fill="${COLORS[id]}" stroke="#18304a" stroke-width="1"/>`)).join('');
  const primaryId = visible.includes('nourie') ? 'nourie' : visible.includes('single') ? 'single' : visible[0];
  const dots = primaryId ? series[primaryId].map((v, i) => v == null ? '' :
    `<circle data-series="${primaryId}" data-date="${days[i].date}" data-index="${i}" data-value="${v}" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="4" fill="${COLORS[primaryId]}"/>`
    + ((phone && i % 2)||varId==='pop'&&hideLowRainChance(v) ? '' : `<text data-point-label="${i}" x="${X(i).toFixed(0)}" y="${(Y(v) - 11).toFixed(0)}" text-anchor="middle" font-size="${FS}" fill="#fff" font-weight="700" paint-order="stroke" stroke="rgba(0,0,0,.45)" stroke-width="3">${varDef.fmt(v)}</text>`)).join('') : '';
  const chip = (id) => { const off = hiddenModels.has(id);
    const tag = id === 'nourie' ? 'span' : 'button';
    const count=series[id].filter(finite).length;
    return `<${tag}${tag === 'button' ? ` type="button" aria-pressed="${!off}" aria-label="${displayName(id)} forecast line"` : ' aria-label="Published Weather Nourie forecast, always shown"'} class="wn-chip" data-model="${id}" style="display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:7px 11px;border-radius:999px;border:1px solid ${off ? 'rgba(255,255,255,.12)' : COLORS[id] + '99'};background:${off ? 'transparent' : 'rgba(255,255,255,.10)'};font-family:inherit;font-size:11px;font-weight:600;line-height:1.4;color:${off ? '#a5b5c8' : '#e8eef8'};white-space:nowrap;cursor:${tag === 'button' ? 'pointer' : 'default'};">`
      + `<i style="width:12px;height:3px;border-radius:2px;background:${COLORS[id]};opacity:${off ? 0.3 : 1};display:inline-block"></i>${tag==='button'?`<span aria-hidden="true">${off?'○':'✓'}</span>`:''}${displayName(id)}${id!=='nourie'&&count<days.length?`<small style="font-size:9px;opacity:.75">${count}/${days.length} days</small>`:''}</${tag}>`; };
  const legend = built.perModel ? ids.map(chip).join('')
    : `<span style="font-size:11px;color:#d5deee">${varId === 'aqi' ? 'Daily max AQI (Open-Meteo / CAMS)' : varId === 'uv' ? 'Daily max UV index' : ''}</span>`;
  const note = built.perModel ? `<p style="font-size:11px;color:#c4d9ed;margin:6px 0 0">${built.nwsFallback?'Official NWS rain chances are used where model data is unavailable.':'Weather Nourie blend is the forecast shown on this page.'} Other lines show individual models. Tap a model to show/hide its line, or tap the graph for values.${varId === 'temp' ? ' Daily highs require every forecast hour in the displayed day. Incomplete model days are unavailable.' : varId === 'rain' ? ' Rain totals use the same local calendar dates as the daily tiles, ending at midnight.' : varId === 'wind' ? ' Wind shows the average over that forecast period.' : varId === 'dewpoint' ? ' Dew point shows the highest reading over that forecast period.' : varId === 'pop' ? ' Individual model rain signals are not calibrated probabilities.' : varId === 'snow' ? ' Snow totals are inches for the same local calendar date. HRRR and NAM stop at their published forecast range; missing coverage is Unavailable. Overlapping zero lines mean the models forecast no snow. WPC uses different accumulation periods, and WeatherNext does not publish snowfall depth, so neither is substituted into these daily model lines.' : ''}</p>` : '';
  container.innerHTML = `<div role="group" aria-label="Select model lines" style="display:flex;flex-wrap:wrap;gap:6px;padding:2px 0 12px">${legend}</div>`
    + `<div class="wn-chart-wrap" style="position:relative;touch-action:pan-y">`
    + `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:100%;height:auto;display:block;cursor:crosshair" role="img" aria-label="${varDef.label}, seven-day model comparison chart"><title>${varDef.label} across seven forecast dates</title><desc>Weather Nourie is the published forecast. Selected model lines show their source values. Missing days stay gaps.</desc>${ylabels}${labels}${lines}${isolated}${dots}`
    + `<line class="wn-cross" x1="0" x2="0" y1="${PT - 10}" y2="${H - PB}" stroke="#fff" stroke-width="1.5" stroke-dasharray="3,3" opacity="0"/><g class="wn-cross-dots"></g></svg>`
    + `<div class="wn-tip" style="position:absolute;top:4px;display:none;min-width:130px;padding:8px 10px;border-radius:12px;background:rgba(10,20,40,.88);border:1px solid rgba(255,255,255,.22);color:#fff;font-size:12px;line-height:1.45;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.35)"></div></div>`
    + `<div style="margin:12px 0 10px"><label for="wn-compare-day" style="display:flex;justify-content:space-between;gap:12px;font-size:12px;color:#d5e1f2">Inspect a day <strong id="wn-compare-day-label"></strong></label><input id="wn-compare-day" type="range" min="0" max="${Math.max(0,n-1)}" step="1" value="0" aria-label="Inspect a day on the seven-day comparison" style="display:block;width:100%;height:28px;margin:8px 0;accent-color:#7fd4ff"><div class="wn-day-values" aria-live="polite" aria-atomic="true" style="display:flex;flex-wrap:wrap;gap:6px"></div></div>${note}`;
  container.querySelectorAll('button.wn-chip').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.model; if (hiddenModels.has(id)) hiddenModels.delete(id); else hiddenModels.add(id);
    renderChart(container, built, varDef, varId);
    container.querySelector(`button.wn-chip[data-model="${id}"]`)?.focus({preventScroll:true});
  }));
  const svg = container.querySelector('svg'), tip = container.querySelector('.wn-tip'), cross = container.querySelector('.wn-cross'), cdots = container.querySelector('.wn-cross-dots'), wrap = container.querySelector('.wn-chart-wrap');
  const daySlider=container.querySelector('#wn-compare-day'),dayLabel=container.querySelector('#wn-compare-day-label'),dayValues=container.querySelector('.wn-day-values');
  let shownIndex=-1;
  const showDay = (index,tooltip=true) => {
    const r=svg.getBoundingClientRect(),i=Math.max(0,Math.min(n-1,Math.round(index)));
    const x = X(i);
    container._wnSelectedIndex=i;daySlider.value=String(i);
    svg.querySelectorAll('[data-point-label]').forEach(label => { label.style.visibility = Number(label.dataset.pointLabel) === i ? 'hidden' : ''; });
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('opacity', '0.8');
    const rows = comparisonDayValues(chart,i).map(({id,value})=>[id,value]).filter(([id, value]) => (varId === 'temp' || varId === 'snow' || id === primaryId || finite(value))&&!(varId==='pop'&&hideLowRainChance(value)));
    cdots.innerHTML = rows.filter(([, value]) => finite(value)).map(([id, v]) => `<circle cx="${x}" cy="${Y(v).toFixed(1)}" r="5" fill="${COLORS[id]}" stroke="#0a1428" stroke-width="1.5"/>`).join('');
    if(shownIndex!==i){
    const label=dayName(days[i],i,true);
    dayLabel.textContent=label;
    daySlider.setAttribute('aria-valuetext',`${label}. ${rows.map(([id,value])=>`${displayName(id)||varDef.label}: ${finite(value)?varDef.fmt(value):'Unavailable'}`).join(', ')}`);
    dayValues.innerHTML=rows.length?rows.map(([id,value])=>`<span data-day-series="${id}" style="display:inline-flex;align-items:center;gap:6px;padding:7px 9px;border:1px solid rgba(255,255,255,.15);border-radius:9px;font-size:11px"><i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${COLORS[id]}"></i>${displayName(id)||varDef.label}<strong>${finite(value)?varDef.fmt(value):'Unavailable'}</strong></span>`).join(''):`<span style="font-size:11px;color:#c4d9ed">${varId==='pop'?'No rain chances of 5% or higher':'No model data for this day'}</span>`;
    tip.innerHTML = `<b style="display:block;margin-bottom:3px">${label}</b>`
      + (rows.length ? rows.map(([id, v]) => `<span data-tip-series="${id}" style="display:flex;justify-content:space-between;gap:10px"><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLORS[id]};margin-right:5px"></i>${displayName(id) || varDef.label}</span><b>${finite(v) ? varDef.fmt(v) : 'Unavailable'}</b></span>`).join('') : varId==='pop'?'<span>No rain chances of 5% or higher</span>':'<span>No model data</span>');
    shownIndex=i;
    }
    tip.style.display = tooltip?'block':'none';
    const px = (x / W) * r.width, tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(r.width - tw, px > r.width / 2 ? px - tw - 12 : px + 12))}px`;
  };
  const show=clientX=>{
    const r=svg.getBoundingClientRect(),sx=(clientX-r.left)*(W/Math.max(1,r.width));
    showDay(((sx-PL)/(W-PL-PR))*(n-1));
  };
  const hide = () => { tip.style.display = 'none'; cross.setAttribute('opacity', '0'); cdots.innerHTML = ''; svg.querySelectorAll('[data-point-label]').forEach(label => { label.style.visibility = ''; }); };
  let dragging = false;
  svg.addEventListener('pointerdown', (e) => { dragging = true; show(e.clientX); });
  svg.addEventListener('pointermove', (e) => { if (dragging || e.pointerType === 'mouse') show(e.clientX); });
  svg.addEventListener('pointerup', (e) => { dragging = false; if (e.pointerType === 'mouse') return; });
  svg.addEventListener('pointerleave', (e) => { dragging = false; if (e.pointerType === 'mouse') hide(); });
  svg.addEventListener('pointercancel', () => { dragging = false; });
  wrap.addEventListener('touchmove', (e) => { if (dragging && e.touches[0]) { show(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
  const dismiss=e=>{if(!wrap.contains(e.target))hide();};
  document.addEventListener('pointerdown',dismiss);
  container._wnDismiss=()=>document.removeEventListener('pointerdown',dismiss);
  daySlider.addEventListener('input',()=>showDay(Number(daySlider.value),false));
  showDay(container._wnSelectedIndex||0,false);
  if(restoreDayFocus)daySlider.focus({preventScroll:true});
  container._wnShow = show;
  container._wnShowDay=index=>showDay(index,false);
}

let forecastCache = null, wnCache = null, varId = 'temp';

async function render() {
  const chartEl = document.getElementById('wn-compare-chart');
  if (!chartEl || !forecastCache) return;
  varId = curVar;
  const varDef = VARIABLES[varId];
  const built = buildSeries(forecastCache, wnCache, varId);
  const title = document.getElementById('wn-compare-title');
  if (title) title.textContent = `${varDef.label} — 7-day comparison`;
  renderChart(chartEl, built, varDef, varId);

  const oldWarn = document.getElementById('wn-stale-warn');
  if (oldWarn) oldWarn.remove();
  if (varId !== 'pop' && varId !== 'snow' && varId !== 'uv' && varId !== 'aqi' && wnCache?.ageDays != null && wnCache.ageDays > 2) {
    const warn = document.createElement('p');
    warn.id = 'wn-stale-warn';
    warn.style.cssText = 'font-size:13px;color:#ffb47d;margin:10px 0 0';
    warn.textContent = `⚠ WeatherNext data is ${Math.round(wnCache.ageDays)} days old — WN line may not align.`;
    chartEl.appendChild(warn);
  }
}

async function init() {
  if (!document.querySelector('.hero')) return;
  const hero = document.querySelector('.hero');
  if (!hero || document.getElementById('wn-compare-section')) return;

  const section = document.createElement('section');
  section.id = 'wn-compare-section';
  section.hidden = true;
  section.style.marginTop = '16px';
  section.style.marginBottom = '16px';
  section.className = 'glass wn-blend-compare';
  section.style.padding = '18px';
  section.style.overflow = 'hidden';
  section.setAttribute('aria-label', 'Forecast model comparison');
  section.innerHTML = `
    <div class="section-top" style="border:0;padding-bottom:10px">
      <h2 id="wn-compare-title">FORECAST COMPARISON</h2>
    </div>
    <div id="wn-var-picker" role="group" aria-label="Pick a variable" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      ${Object.entries(VARIABLES).map(([id, v]) =>
        `<button data-var="${id}" aria-pressed="${id === curVar}" style="background:${id === curVar ? 'rgba(127,212,255,.22)' : 'rgba(255,255,255,.07)'};border:1px solid rgba(255,255,255,.16);color:#fff;border-radius:999px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer">${v.label}</button>`).join('')}
    </div>
    <div id="wn-compare-chart"><p class="muted" style="font-size:14px">Loading comparison…</p></div>`;
  hero.after(section);

  // Toggle like Car Wash
  const compareBtn = document.getElementById('open-compare');
  if (compareBtn) {
    compareBtn.onclick = () => {
      const isHidden = section.hidden;
      section.hidden = !isHidden;
      compareBtn.setAttribute('aria-expanded', String(isHidden));
      if (isHidden) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  document.getElementById('wn-var-picker').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    curVar = b.dataset.var;
    document.querySelectorAll('#wn-var-picker button').forEach((x) => {
      const on = x.dataset.var === curVar;
      x.style.background = on ? 'rgba(127,212,255,.22)' : 'rgba(255,255,255,.07)';
      x.setAttribute('aria-pressed', on);
    });
    render();
  };

  try {
    const loc = getLoc();
    const [forecast, wn] = await Promise.all([
      fetchJSON(`/api/weather-fusion/forecast?location=${encodeURIComponent(loc)}`),
      loadWNFeed(),
    ]);
    wnFeed = wn;
    // Prefer the page's own forecast (searched / located place) over the default location.
    const pageFx = globalThis.__weatherNourieForecast;
    forecastCache = pageFx?.days ? pageFx : forecast;
    wnCache = pickWN(wn, forecastCache);
    render();
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 200); });
    // the section starts hidden (width 0); re-render when it is opened
    if (compareBtn) compareBtn.addEventListener('click', () => setTimeout(render, 0));
  } catch (e) {
    document.getElementById('wn-compare-chart').innerHTML =
      `<p class="muted" style="font-size:14px">Couldn't load: ${e.message}</p>`;
  }
}

// Reload the comparison whenever the page loads a forecast for a (new) location.
let wnFeed = null;
if (typeof document !== 'undefined') {
document.addEventListener('weather-nourie:forecast', (e) => {
  const fx = e.detail; if (!fx?.days) return;
  forecastCache = fx;
  if (wnFeed) wnCache = pickWN(wnFeed, fx);
  try { render(); } catch {}
});
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
}
