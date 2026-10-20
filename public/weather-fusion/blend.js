/* Blend — how the Weather Nourie forecast is made.
 * Shows the canonical API blend, including Google WeatherNext when matching
 * input is available, beside a separate WeatherNext ensemble comparison feed.
 * Pure builders are exported for testing; DOM wiring runs in browser. */
import {calendarDayTemperatures,calendarDayWindow} from './calendar-day.js?v=calendar-days-v1';
import {currentSample} from './weather-display.js?v=low-rain-display-v1';
import {localDate,forecastRows,installForecastRefresh} from './weathernext-data.js';

const WN_FEED_URL = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext3.json';

const MODELS = [
  { id: 'nws', label: 'NWS', color: '#7fd4ff', desc: 'Official National Weather Service forecast' },
  { id: 'hrrr', label: 'HRRR', color: '#ffd479', desc: '3 km high-resolution rapid refresh' },
  { id: 'ecmwf', label: 'ECMWF', color: '#9dffb0', desc: 'European medium-range model' },
  { id: 'nbm', label: 'NBM', color: '#ff9d9d', desc: 'NWS National Blend of Models' },
];
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const round = (n) => (finite(n) ? Math.round(n) : null);
const rainValue=row=>row?.rainLikelihood&&Object.hasOwn(row.rainLikelihood,'value')?row.rainLikelihood.value:row?.pop??row?.officialPop;

function hourLabel(timeMs, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric' }).format(new Date(timeMs));
}

export function skyImage(hours, nowMs) {
  const h = (hours || []).find((x) => x.time <= nowMs && nowMs < x.time + 3600000) || hours?.[0] || null;
  const cond = String(h?.condition || '').toLowerCase();
  if (h?.isDay === false) return 'today-sky-night-v2.webp';
  if (/thunder|storm|tornado|hail/.test(cond)) return 'today-sky-storm.webp';
  if (/rain|shower|drizzle/.test(cond) || (h?.pop ?? 0) >= 40) return 'today-sky-rain.webp';
  if (/cloud|overcast|fog|mist|haze/.test(cond)) return 'today-sky-clouds.webp';
  return 'today-sky-clear.webp';
}

function wnPoint(feed, locationId) {
  return (feed?.points || []).find((p) => p.id === locationId) || null;
}

function wnHourMap(point) {
  const map = new Map();
  for (const r of point?.hourly || []) {
    const t = Date.parse(r.time);
    if (Number.isFinite(t)) map.set(t, r);
  }
  return map;
}

/** Every compared high/low uses the same complete calendar-hour window. */
export function completeTemperatureRange(rows,window,valueFor){
  const readings=new Map(),duplicates=new Set();
  for(const row of rows||[]){
    const time=Date.parse(row.time),value=valueFor(row);
    if(time<window.start||time>=window.end||!Number.isFinite(time))continue;
    if(readings.has(time))duplicates.add(time);
    readings.set(time,value);
  }
  const values=[];
  for(let time=window.start;time<window.end;time+=3600000){
    const value=readings.get(time);
    if(duplicates.has(time)||!finite(value))return {high:null,low:null};
    values.push(value);
  }
  return values.length?{high:Math.max(...values),low:Math.min(...values)}:{high:null,low:null};
}

/* ---- view model (pure) ---- */
export function buildBlendModel(forecast, wnFeed, locationId, nowMs = Date.now()) {
  const loc = forecast?.location || {};
  const timeZone = loc.timeZone || 'America/New_York';
  const current=currentSample({...forecast,location:loc},nowMs),cur=current.inputs;
  const calendarDays=(forecast?.days||[]).slice(0,7).map((day,index)=>({...day,...calendarDayTemperatures(forecast,index,nowMs)}));
  const hours = (forecast?.hours || [])
    .map((h) => ({ ...h, time: Date.parse(h.time) }))
    .filter((h) => Number.isFinite(h.time) && h.time + 3600000 > nowMs)
    .slice(0, 24);
  const sourceWeights=Object.fromEntries((hours[0]?.temperatureBlend?.sources||[]).filter(s=>finite(s.weight)).map(s=>[s.id,s.weight]));
  const weights=Object.keys(sourceWeights).length?sourceWeights:forecast?.blendPolicy?.sameDay||{};
  const weightLabel=Object.keys(sourceWeights).length?`${hourLabel(hours[0].time,timeZone)} temperature weights`:'Base temperature weights';
  const contrib = Object.fromEntries((forecast?.modelContributions || []).map((m) => [m.id, m]));

  const point = wnPoint(wnFeed, locationId);
  const wnAvailable = forecastRows(point?.hourly,nowMs).length>0;
  const wnRows = wnAvailable ? point.hourly : [];
  const wnMap = wnHourMap({hourly:wnRows});
  const wnAt = (t) => wnMap.get(t) || null;
  const today = localDate(nowMs, timeZone);

  const series = hours.map((h) => {
    const src = Object.fromEntries((h.temperatureBlend?.sources || []).map((s) => [s.id, s.value]));
    const gsrc = Object.fromEntries((h.gustBlend?.sources || []).map((s) => [s.id, s.value]));
    const wn = wnAt(h.time);
    const popSrc = h.rainLikelihood?.sourceValues || {};
    return {
      time: h.time,
      blend: finite(h.temperatureBlend?.value) ? h.temperatureBlend.value : h.temperature,
      models: Object.fromEntries(MODELS.map((m) => [m.id, src[m.id] ?? null])),
      wnMean: finite(src.wn)?src.wn:wn&&finite(wn.temperatureF)?wn.temperatureF:null,
      wnP10: wn && finite(wn.temperatureP10F) ? wn.temperatureP10F : null,
      wnP90: wn && finite(wn.temperatureP90F) ? wn.temperatureP90F : null,
      pop: round(rainValue(h)),
      popModels: Object.fromEntries(MODELS.map((m) => [m.id, finite(popSrc[m.id]) ? Math.round(popSrc[m.id]) : null])),
      dewpoint: finite(h.dewpoint) ? h.dewpoint : null,
      wnDewpoint: wn && finite(wn.dewpointF) ? wn.dewpointF : null,
      gust: finite(h.gustBlend?.value) ? h.gustBlend.value : (finite(h.gust) ? h.gust : null),
      gustModels: Object.fromEntries(MODELS.map((m) => [m.id, gsrc[m.id] ?? null])),
      wnWind: wn && finite(wn.windMph) ? wn.windMph : null,
    };
  });

  const h0 = series[0];
  const modelCards = MODELS.map((m) => ({
    ...m,
    weight: weights[m.id],
    runAt: contrib[m.id]?.runAt || null,
    resolution: contrib[m.id]?.resolution || null,
    nowTemp: h0 ? round(h0.models[m.id]) : null,
    ai: false,
  }));
  modelCards.push({
    id: 'weathernext', label: 'Google WeatherNext', color: '#b48cff',
    desc: 'Google WeatherNext forecast; separate ensemble guidance includes an uncertainty band',
    weight: weights.wn, runAt: contrib.wn?.runAt||wnFeed?.runAt||null, resolution: wnFeed?.gridResolutionDegrees ? `${wnFeed.gridResolutionDegrees}° grid` : null,
    nowTemp: h0 ? round(h0.wnMean) : null, ai: true,
  });

  const temperatureSeries=forecast?.metricForecasts?.series?.temperature||
    (forecast?.hours||[]).map(row=>({time:row.time,sources:row.temperatureBlend?.sources||[]}));
  const aiDays=[...new Set(forecastRows(wnRows,nowMs).map(row=>localDate(Date.parse(row.time),timeZone)))].sort().slice(0,7).map(date=>{
    const window=calendarDayWindow({date},date===today?0:1,nowMs,timeZone);
    const range=completeTemperatureRange(wnRows,window,row=>row.temperatureF),p10=completeTemperatureRange(wnRows,window,row=>row.temperatureP10F),p90=completeTemperatureRange(wnRows,window,row=>row.temperatureP90F);
    return {date,label:date===today?'Today':new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short'}).format(new Date(date+'T12:00:00Z')),high:round(range.high),low:round(range.low),band:finite(p10.low)&&finite(p90.high)?`${round(p10.low)}°–${round(p90.high)}° hourly range`:null};
  });
  const week=calendarDays.map((day,index)=>{
    const window=calendarDayWindow(day,index,nowMs,timeZone);
    const modelRanges=Object.fromEntries(MODELS.map(model=>[model.id,completeTemperatureRange(temperatureSeries,window,row=>row.sources?.find(source=>source.id===model.id)?.value)]));
    const contributingWn=completeTemperatureRange(temperatureSeries,window,row=>row.sources?.find(source=>source.id==='wn')?.value);
    const wn=finite(contributingWn.high)?contributingWn:completeTemperatureRange(wnRows,window,row=>row.temperatureF);
    const wnd=wnRows.filter(row=>{const t=Date.parse(row.time);return t>=window.start&&t<window.end;});
    const winds=wnd.map(row=>row.windMph).filter(finite);
    return {
      label:day.label||day.date,
      blendHigh:day.high,blendLow:day.low,
      modelHighs:Object.fromEntries(MODELS.map(model=>[model.id,modelRanges[model.id].high])),
      modelLows:Object.fromEntries(MODELS.map(model=>[model.id,modelRanges[model.id].low])),
      pop:round(rainValue(day)),
      gusts:Object.fromEntries(MODELS.map(model=>[model.id,finite(day.guidance?.[model.id]?.gust)?day.guidance[model.id].gust:null])),
      wnHigh:wn.high,wnLow:wn.low,wnWind:winds.length?Math.max(...winds):null,
    };
  });

  return {
    place: loc.name || 'Knightdale / Raleigh',
    updatedAt: forecast?.assembledAt || null,
    sky: skyImage(hours, nowMs),
    hero: {
      temp: round(cur.temperature),
      condition: current.condition || 'Conditions unavailable',
      high: round(calendarDays[0]?.high),
      low: round(calendarDays[0]?.low),
    },
    series,
    week,
    modelCards,
    weights,
    weightLabel,
    rainHours: series.slice(0, 12).map((s) => ({ time: s.time, pop: s.pop })),
    aiDays,
    wnAvailable,
    wnRunAt: wnFeed?.runAt || null,
    timeZone,
  };
}

/* ---- compare charts (pure) ----
 * One chart engine, four variables: temperature, rain chance, dew point, wind.
 * Each shows the house blend against the individual models (and WeatherNext
 * AI where it publishes that variable). */
export const CHART_VARS = [
  { id: 'temp', label: 'Temperature', unit: '°', sub: 'The white line is the house blend. Thin lines are the models. The violet band is Google WeatherNext AI\u2019s uncertainty range.' },
  { id: 'rain', label: 'Rain chance', unit: '%', sub: 'NWS supplies official probability. Other model lines are uncalibrated rain signals; white shows the custom blended rain likelihood.' },
  { id: 'dewpoint', label: 'Dew point', unit: '°', sub: 'Blended dew point against Google WeatherNext AI\u2019s call — watch the gap for mugginess.' },
  { id: 'wind', label: 'Wind gusts', unit: ' mph', sub: 'Each model\u2019s gust call against the blend. Dashed violet is WeatherNext AI\u2019s sustained wind.' },
];
export const WEEK_VARS = [
  { id: 'highs', label: 'Highs', unit: '°', sub: 'Each model\u2019s high within the same calendar date, against the blended high. Dashed violet is WeatherNext AI. Incomplete model dates are unavailable.' },
  { id: 'lows', label: 'Lows', unit: '°', sub: 'Each model\u2019s lowest temperature within the same calendar date, against the blended low. Incomplete model dates are unavailable.' },
  { id: 'rain', label: 'Rain', unit: '%', sub: 'Blended daily rain chance for the next 7 days.', bars: true },
  { id: 'wind', label: 'Wind', unit: ' mph', sub: 'Each model\u2019s daily gust call, 7 days out. Dashed violet is WeatherNext AI\u2019s peak wind.' },
];
export const RANGES = [
  { id: 'day', label: '24 hours' },
  { id: 'week', label: '7 days' },
];

function chartSeries(model, varId, range) {
  if (range === 'week') {
    const wk = model.week || [];
    switch (varId) {
      case 'lows':
        return {
          blend: wk.map((d) => d.blendLow),
          models: MODELS.map((m) => ({ ...m, vals: wk.map((d) => d.modelLows[m.id]) })),
          band: null,
          extra: [{ vals: wk.map((d) => d.wnLow), cls: 'arc-wn-mean', label: 'WeatherNext AI' }],
        };
      case 'rain':
        return { blend: wk.map((d) => d.pop), models: [], band: null, extra: null };
      case 'wind':
        return {
          blend: [],
          models: MODELS.map((m) => ({ ...m, vals: wk.map((d) => d.gusts[m.id]) })),
          band: null,
          extra: [{ vals: wk.map((d) => d.wnWind), cls: 'arc-wn-mean', label: 'WeatherNext AI' }],
        };
      default:
        return {
          blend: wk.map((d) => d.blendHigh),
          models: MODELS.map((m) => ({ ...m, vals: wk.map((d) => d.modelHighs[m.id]) })),
          band: null,
          extra: [{ vals: wk.map((d) => d.wnHigh), cls: 'arc-wn-mean', label: 'WeatherNext AI' }],
        };
    }
  }
  const pts = model.series || [];
  switch (varId) {
    case 'rain':
      return {
        blend: pts.map((p) => p.pop),
        models: MODELS.map((m) => ({ ...m, vals: pts.map((p) => p.popModels[m.id]) })),
        band: null, extra: null,
      };
    case 'dewpoint':
      return {
        blend: pts.map((p) => p.dewpoint),
        models: [],
        band: null,
        extra: [{ vals: pts.map((p) => p.wnDewpoint), cls: 'arc-wn-mean', label: 'WeatherNext AI' }],
      };
    case 'wind':
      return {
        blend: pts.map((p) => p.gust),
        models: MODELS.map((m) => ({ ...m, vals: pts.map((p) => p.gustModels[m.id]) })),
        band: null,
        extra: [{ vals: pts.map((p) => p.wnWind), cls: 'arc-wn-mean', label: 'WeatherNext AI' }],
      };
    default:
      return {
        blend: pts.map((p) => p.blend),
        models: MODELS.map((m) => ({ ...m, vals: pts.map((p) => p.models[m.id]) })),
        band: { lo: pts.map((p) => p.wnP10), hi: pts.map((p) => p.wnP90), mean: pts.map((p) => p.wnMean) },
        extra: null,
      };
  }
}

function smoothPath(xy) {
  let d = `M ${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[Math.max(0, i - 1)], p1 = xy[i], p2 = xy[i + 1], p3 = xy[Math.min(xy.length - 1, i + 2)];
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)},`
      + ` ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)},`
      + ` ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function buildChart(model, varId = 'temp', range = 'day') {
  const isWeek = range === 'week';
  const pts = isWeek
    ? (model.week || [])
    : (model.series || []).filter((s) => Number.isFinite(s.time));
  const varList = isWeek ? WEEK_VARS : CHART_VARS;
  const cfg = varList.find((c) => c.id === varId) || varList[0];
  const s = chartSeries(model, cfg.id, range);
  const W = 640, H = 250, PL = 12, PR = 12, PT = 30, PB = 42;
  const all = [...s.blend];
  for (const m of s.models) all.push(...m.vals);
  if (s.band) { all.push(...s.band.lo, ...s.band.hi); }
  if (s.extra) for (const e of s.extra) all.push(...e.vals);
  const nums = all.filter(finite);
  if (!nums.length || pts.length < (isWeek ? 3 : 4)) return '';
  let lo = Math.min(...nums), hi = Math.max(...nums);
  if (cfg.id === 'rain') { lo = 0; hi = Math.max(hi, 20); }
  else if (hi - lo < 6) { const mid = (hi + lo) / 2; lo = mid - 3; hi = mid + 3; }
  const X = (i) => PL + (i * (W - PL - PR)) / Math.max(1, pts.length - 1);
  const Y = (t) => PT + (1 - (t - lo) / (hi - lo)) * (H - PT - PB);
  const base = H - PB;
  const line = (vals) => {
    const xy = [];
    vals.forEach((v, i) => { if (finite(v)) xy.push([X(i), Y(v)]); });
    return xy.length >= 2 ? smoothPath(xy) : '';
  };
  const xLabel = (i) => isWeek ? pts[i].label : hourLabel(pts[i].time, model.timeZone);
  const vLabel = (v) => `${Math.round(v)}${cfg.unit === ' mph' ? '' : cfg.unit}`;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${cfg.label} model comparison, ${isWeek ? '7 days' : '24 hours'}">`;
  if (cfg.bars) {
    const bw = (W - PL - PR) / pts.length;
    s.blend.forEach((v, i) => {
      if (!finite(v)) return;
      const h = Math.max(2, base - Y(v));
      const fill = v >= 30 ? '#6aa8ff' : 'rgba(106,168,255,.45)';
      svg += `<rect x="${(PL + i * bw + bw * 0.2).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${(bw * 0.6).toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="${fill}"/>`;
    });
  } else {
    if (s.band) {
      const top = [], bot = [];
      pts.forEach((p, i) => {
        if (finite(s.band.lo[i]) && finite(s.band.hi[i])) { top.push([X(i), Y(s.band.hi[i])]); bot.unshift([X(i), Y(s.band.lo[i])]); }
      });
      if (top.length >= 2) {
        svg += `<polygon class="arc-wn-band" points="${top.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')} ${bot.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}"/>`;
        const meanD = line(s.band.mean);
        if (meanD) svg += `<path class="arc-wn-mean" d="${meanD}"/>`;
      }
    }
    for (const m of s.models) {
      const d = line(m.vals);
      if (d) svg += `<path class="arc-line" d="${d}" style="stroke:${m.color}"/>`;
    }
    if (s.extra) for (const e of s.extra) {
      const d = line(e.vals);
      if (d) svg += `<path class="${e.cls}" d="${d}"/>`;
    }
    const bd = line(s.blend);
    if (bd) svg += `<path class="arc-blend" d="${bd}"/>`;
  }
  if (!isWeek) {
    const b0 = s.blend.find(finite);
    svg += `<line class="arc-now" x1="${X(0).toFixed(1)}" y1="${PT - 6}" x2="${X(0).toFixed(1)}" y2="${base}"/>`;
    if (finite(b0)) svg += `<circle class="arc-now-dot" cx="${X(0).toFixed(1)}" cy="${Y(b0).toFixed(1)}" r="5"/>`;
  }
  const step = isWeek ? 1 : 4;
  for (let i = 0; i < pts.length; i += step) {
    svg += `<text x="${X(i).toFixed(1)}" y="${(H - 24).toFixed(1)}" text-anchor="middle">${xLabel(i)}</text>`;
    const bv = s.blend[i];
    if (finite(bv)) {
      const vy = cfg.bars ? (base - Math.max(2, base - Y(bv)) - 8) : (Y(bv) - 10);
      svg += `<text class="arc-temp" x="${X(i).toFixed(1)}" y="${vy.toFixed(1)}" text-anchor="middle">${vLabel(bv)}</text>`;
    }
  }
  return svg + '</svg>';
}

/* Back-compat: temperature chart */
export function buildBlendArc(model) { return buildChart(model, 'temp'); }

/* ---------- DOM wiring (browser only) ---------- */
function el(id) { return document.getElementById(id); }
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let skyFlip = false;
function setSky(image) {
  const url = `/weather-fusion/${image}`;
  const show = skyFlip ? el('sky-a') : el('sky-b');
  const hide = skyFlip ? el('sky-b') : el('sky-a');
  if (show.dataset.img === image) return;
  const pre = new Image();
  pre.onload = () => {
    show.style.backgroundImage = `url("${url}")`;
    show.dataset.img = image;
    show.classList.add('on');
    hide.classList.remove('on');
    skyFlip = !skyFlip;
  };
  pre.onerror = () => {};
  pre.src = url;
}
function countUp(node, target) {
  if (!node || !finite(target)) { if (node) node.textContent = target ?? '--'; return; }
  if (reducedMotion()) { node.textContent = target; return; }
  const t0 = performance.now(), dur = 900;
  const step = (t) => {
    const f = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - f, 3);
    node.textContent = Math.round(target * e);
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function fmtRunAt(iso) {
  if (!iso) return 'run time unknown';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'run time unknown';
  return 'run ' + new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(t));
}

/* Chart tabs: one engine, four variables */
function chartLegends(model, varId, range) {
  const w = model.weights;
  const wp = (id) => finite(w[id])?`${Math.round(w[id]*1000)/10}%`:'weight unavailable';
  if (range === 'week') {
    switch (varId) {
      case 'lows':
        return [{ color: '#fff', label: 'Blended low' },
          ...MODELS.map((m) => ({ color: m.color, label: m.label })),
          { color: '#b48cff', label: 'WeatherNext AI', dashed: true }];
      case 'rain':
        return [{ color: '#6aa8ff', label: 'Blended daily chance' }];
      case 'wind':
        return [...MODELS.map((m) => ({ color: m.color, label: m.label })),
          { color: '#b48cff', label: 'WeatherNext AI', dashed: true }];
      default:
        return [{ color: '#fff', label: 'Blended high' },
          ...MODELS.map((m) => ({ color: m.color, label: m.label })),
          { color: '#b48cff', label: 'WeatherNext AI', dashed: true }];
    }
  }
  switch (varId) {
    case 'rain':
      return [{ color: '#fff', label: 'Blended chance' },
        ...MODELS.map((m) => ({ color: m.color, label: m.label }))];
    case 'dewpoint':
      return [{ color: '#fff', label: 'Blended dew point' }, { color: '#b48cff', label: 'WeatherNext AI', dashed: true }];
    case 'wind':
      return [{ color: '#fff', label: 'Blended gust' },
        ...MODELS.map((m) => ({ color: m.color, label: m.label })),
        { color: '#b48cff', label: 'WeatherNext AI wind', dashed: true }];
    default:
      return [{ color: '#fff', label: 'House blend' },
        ...MODELS.map((m) => ({ color: m.color, label: `${m.label} ${wp(m.id)}` })),
        { band: true, label: 'WeatherNext AI uncertainty' }];
  }
}

function renderChartTabs(model, range, activeId) {
  const tabs = el('chart-tabs');
  tabs.innerHTML = '';
  const mkBtn = (label, selected, onClick, cls) => {
    const b = document.createElement('button');
    b.className = cls;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', selected ? 'true' : 'false');
    b.textContent = label;
    b.addEventListener('click', onClick);
    tabs.appendChild(b);
    return b;
  };
  for (const r of RANGES) mkBtn(r.label, r.id === range, () => renderChartTabs(model, r.id, r.id === 'week' ? 'highs' : 'temp'), 'tab range-tab');
  const sep = document.createElement('span');
  sep.className = 'tab-sep';
  sep.setAttribute('aria-hidden', 'true');
  tabs.appendChild(sep);
  const varList = range === 'week' ? WEEK_VARS : CHART_VARS;
  for (const v of varList) mkBtn(v.label, v.id === activeId, () => renderChartTabs(model, range, v.id), 'tab');
  const cfg = varList.find((c) => c.id === activeId) || varList[0];
  el('chart-sub').textContent = cfg.sub;
  el('blend-arc').innerHTML = buildChart(model, cfg.id, range);
  const legend = el('blend-legend');
  legend.innerHTML = '';
  for (const item of chartLegends(model, cfg.id, range)) {
    const s = document.createElement('span');
    if (item.band) {
      const sw = document.createElement('span'); sw.className = 'sw-band'; s.appendChild(sw);
    } else {
      const sw = document.createElement('i');
      sw.style.background = item.dashed
        ? `repeating-linear-gradient(90deg,${item.color} 0 6px,transparent 6px 10px)`
        : item.color;
      s.appendChild(sw);
    }
    s.appendChild(document.createTextNode(item.label));
    legend.appendChild(s);
  }
}

export function render(model) {
  setSky(model.sky);
  countUp(el('now-temp'), model.hero.temp);
  el('now-cond').textContent = model.hero.condition;
  const w = model.weights;
  el('blend-line').textContent = `${model.weightLabel} · ${[...MODELS,{id:'wn',label:'Google WeatherNext'}].filter(m=>finite(w[m.id])).map(m=>`${m.label} ${Math.round(w[m.id]*1000)/10}%`).join(' · ')||'Unavailable'}`;
  el('now-hilo').textContent = model.hero.high != null ? `H ${model.hero.high}°  ·  L ${model.hero.low ?? '--'}°` : '';
  renderChartTabs(model, 'day', 'temp');

  const cards = el('model-cards');
  cards.innerHTML = '';
  for (const m of model.modelCards) {
    const c = document.createElement('div');
    c.className = 'model-card' + (m.ai ? ' ai' : '');
    c.style.setProperty('--mc', m.color);
    const nm = document.createElement('div'); nm.className = 'mn'; nm.textContent = m.label; c.appendChild(nm);
    const mt = document.createElement('div'); mt.className = 'mt'; mt.textContent = m.nowTemp != null ? `${m.nowTemp}°` : '--'; c.appendChild(mt);
    const mm = document.createElement('div'); mm.className = 'mm';
    mm.textContent = `${m.desc}. ${fmtRunAt(m.runAt)}${m.resolution ? ` · ${m.resolution}` : ''}.`;
    c.appendChild(mm);
    const mw = document.createElement('div'); mw.className = 'mw';
    mw.textContent = finite(m.weight)?`Temperature weight ${Math.round(m.weight*1000)/10}%`:m.ai?'Matching contribution unavailable; comparison guidance':'Temperature weight unavailable';
    c.appendChild(mw);
    cards.appendChild(c);
  }
  const rb = el('rain-bars');
  rb.innerHTML = '';
  for (const r of model.rainHours) {
    const b = document.createElement('div'); b.className = 'rain-bar';
    const bar = document.createElement('div'); bar.className = 'bar';
    bar.style.height = `${Math.max(3, Math.round((r.pop || 0) * 1.1))}px`;
    const pl = document.createElement('div'); pl.className = 'pl'; pl.textContent = r.pop != null ? `${r.pop}%` : '—';
    const hl = document.createElement('div'); hl.className = 'hl'; hl.textContent = hourLabel(r.time, model.timeZone);
    b.append(bar, pl, hl);
    rb.appendChild(b);
  }
  el('ai-run-line').textContent = model.wnAvailable
    ? `WeatherNext ${fmtRunAt(model.wnRunAt)} · ${model.aiDays.length}-day outlook with uncertainty`
    : 'WeatherNext feed unavailable right now.';
  const ad = el('ai-days');
  ad.innerHTML = '';
  for (const d of model.aiDays) {
    const c = document.createElement('div'); c.className = 'day-card';
    const dd = document.createElement('div'); dd.className = 'd'; dd.textContent = d.label; c.appendChild(dd);
    const hl = document.createElement('div'); hl.className = 'hl';
    hl.append(document.createTextNode(`${d.high ?? '--'}° `));
    const sm = document.createElement('small'); sm.textContent = `/ ${d.low ?? '--'}°`; hl.appendChild(sm); c.appendChild(hl);
    if (d.band) { const bd = document.createElement('div'); bd.className = 'band'; bd.textContent = d.band; c.appendChild(bd); }
    ad.appendChild(c);
  }
  el('updated').textContent=Number.isFinite(Date.parse(model.updatedAt))?'Forecast updated '+new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:model.timeZone}).format(new Date(model.updatedAt)):'Forecast update time unavailable';
}

let latestRequest=0,lastForecast=null,lastWnFeed=null,lastLocation=null;
async function load(locationId) {
  const request=++latestRequest;
  const err = el('error');
  err.hidden = true;
  el('now-cond').textContent = 'Loading…';
  try {
    const [fRes, wnRes] = await Promise.all([
      fetch(`/api/weather-fusion/forecast?location=${encodeURIComponent(locationId)}`, { credentials: 'same-origin' }),
      fetch(WN_FEED_URL, { cache:'no-store', signal: AbortSignal.timeout(25000) }).catch(() => null),
    ]);
    if (fRes.status === 401) {
      location.href = '/weather-fusion/login?returnTo=' + encodeURIComponent('/weather-fusion/blend.html');
      return;
    }
    if (!fRes.ok) throw new Error(`Weather service responded ${fRes.status}`);
    const forecast = await fRes.json();
    let wnFeed = null;
    if (wnRes && wnRes.ok) {
      try { wnFeed = await wnRes.json(); } catch { wnFeed = null; }
    }
    if(request===latestRequest){lastForecast=forecast;lastWnFeed=wnFeed;lastLocation=locationId;render(buildBlendModel(forecast,wnFeed,locationId));}
  } catch (e) {
    if(request!==latestRequest)return;
    if(lastForecast)render(buildBlendModel(lastForecast,lastWnFeed,lastLocation));
    err.hidden = false;
    err.textContent = 'Could not load the blend right now. Please retry in a bit.';
  }
}

function init() {
  const params = new URLSearchParams(location.search);
  const select = el('loc-select');
  const initial = params.get('location') || 'knightdale';
  if ([...select.options].some((o) => o.value === initial)) select.value = initial;
  select.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('location', select.value);
    history.replaceState(null, '', url);
    load(select.value);
  });
  load(select.value);
  installForecastRefresh(()=>load(select.value));
  setInterval(()=>{if(lastForecast)render(buildBlendModel(lastForecast,lastWnFeed,lastLocation));},60000);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
