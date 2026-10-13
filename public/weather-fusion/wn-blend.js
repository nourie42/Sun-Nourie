/** WN Blend comparison — 7-variable picker, 10-day daily view, glass tile.
 *  New weights: NWS 36%, HRRR 27%, NBM 18%, ECMWF 9%, WN 10%
 */
const WN_FEED = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext-full.json';
const NEW_WEIGHTS = { nws: 0.36, hrrr: 0.27, nbm: 0.18, ecmwf: 0.09, wn: 0.10 };
const OLD_WEIGHTS = { nws: 0.40, hrrr: 0.30, nbm: 0.20, ecmwf: 0.10 };
const MS_PER_DAY = 86400000;

const VARIABLES = {
  temp:     { label: 'Temperature',   unit: '°F',  fmt: (v) => `${Math.round(v)}°` },
  rain:     { label: 'Precipitation', unit: 'in',  fmt: (v) => `${v.toFixed(2)}"` },
  wind:     { label: 'Wind',          unit: 'mph', fmt: (v) => `${Math.round(v)}` },
  dewpoint: { label: 'Dewpoint',      unit: '°F',  fmt: (v) => `${Math.round(v)}°` },
  pop:      { label: 'Rain chance',   unit: '%',   fmt: (v) => `${Math.round(v)}%` },
  uv:       { label: 'UV Index',      unit: '',    fmt: (v) => `${Math.round(v)}` },
  aqi:      { label: 'AQI',           unit: '',    fmt: (v) => `${Math.round(v)}` },
};
let curVar = 'temp';

const COLORS = {
  newBlend: '#ffffff', oldBlend: '#8b98b0',
  nws: '#7fd4ff', hrrr: '#ffb47d', nbm: '#7de8a8', ecmwf: '#b48cff', wn: '#ffd479',
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

function blendVal(sources, weights) {
  let sum = 0, wsum = 0;
  for (const [id, w] of Object.entries(weights)) {
    const v = sources[id];
    if (finite(v)) { sum += v * w; wsum += w; }
  }
  return wsum > 0 ? sum / wsum : null;
}

// Aggregate a metricForecasts series (per-model sources) to daily max per model
function dailySeriesMax(series, days, tz) {
  const byDay = {};
  for (const p of series || []) {
    const t = Date.parse(p.time);
    if (!Number.isFinite(t)) continue;
    const key = localDateKey(t, tz);
    const bucket = (byDay[key] = byDay[key] || {});
    for (const s of p.sources || []) {
      if (!finite(s.value)) continue;
      if (!finite(bucket[s.id]) || s.value > bucket[s.id]) bucket[s.id] = s.value;
    }
  }
  return days.map((d) => byDay[d.dateKey] || {});
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
    hours.push([t, val]);
    const key = localDateKey(t, tz);
    (byDay[key] = byDay[key] || []).push(val);
  }
  return days.map((d, i) => {
    const w = windows?.[i];
    // hourly accumulations are labelled at the END of the hour, so (start, end]
    const vals = w ? hours.filter(([t]) => t > w.start && t <= w.end).map(([, v]) => v) : byDay[d.dateKey];
    if (w && hours.length && (hours[0][0] > w.start + 3600000 || hours[hours.length - 1][0] < w.end)) return null; // partial window
    if (!vals?.length) return null;
    if (!vals?.length) return null;
    return agg === 'max' ? Math.max(...vals) : vals.reduce((a, b) => a + b, 0);
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

function buildSeries(fx, wn, varId) {
  const tz = fx.location?.timeZone || 'America/New_York';
  const days = (fx.days || []).slice(0, 10).map((d) => ({ date: d.date, dateKey: d.date }));
  const out = { days, perModel: true, wnVals: days.map(() => null), modelMaps: days.map(() => ({})) };

  if (varId === 'temp' || varId === 'rain') {
    const key = varId === 'temp' ? 'highBlend' : 'qpfBlend';
    days.forEach((d, i) => {
      const src = {};
      for (const s of ((fx.days[i] || {})[key]?.sources || [])) src[s.id] = s.value;
      out.modelMaps[i] = src;
    });
    // Rain: sum WN over the same window the other models use for that day (qpfBlend start/end, 7am-7am)
    const windows = varId === 'rain' ? days.map((d, i) => {
      const q = (fx.days[i] || {}).qpfBlend || {}, w = (fx.days[i] || {}).qpfWindow || {};
      const a = Date.parse(q.start || w.start), b = Date.parse(q.end || w.end);
      return Number.isFinite(a) && Number.isFinite(b) ? { start: a, end: b } : null;
    }) : null;
    out.wnVals = wnDaily(wn?.hourly, varId === 'temp' ? 'temperature_2m' : 'total_precipitation_1hr',
      varId === 'temp' ? 'max' : 'sum', days, tz, varId === 'temp' ? K2F : M2IN, windows);
  } else if (varId === 'pop') {
    // Per-model rain chance at each day's peak hour (from the server's rain-likelihood blend).
    // NWS is a true probability; HRRR/NBM/ECMWF are each model's wet/dry rain signal. WeatherNext has no PoP field.
    days.forEach((d, i) => {
      const sv = ((fx.days[i] || {}).rainLikelihood || {}).peak?.sourceValues || {};
      const src = {}; for (const [id, v] of Object.entries(sv)) if (finite(v)) src[id] = v;
      out.modelMaps[i] = src;
    });
    out.fixedBlend = days.map((d, i) => { const v = (fx.days[i] || {}).rainLikelihood?.value; return finite(v) ? v : null; });
  } else if (varId === 'wind' || varId === 'dewpoint' || varId === 'humidity') {
    const key = varId === 'wind' ? 'wind' : varId;
    out.modelMaps = dailySeriesMax(fx.metricForecasts?.series?.[key], days, tz);
    if (varId === 'wind') out.wnVals = wnDaily(wn?.hourly, 'wind_speed_10m', 'max', days, tz, MS2MPH);
    if (varId === 'dewpoint') out.wnVals = wnDaily(wn?.hourly, 'dewpoint_temperature_2m', 'max', days, tz, K2F);
    // humidity: no WN feed
  } else if (varId === 'uv') {
    out.perModel = false;
    out.single = (fx.days || []).slice(0, 10).map((d) => (finite(d.uvMax) ? d.uvMax : null));
  } else if (varId === 'aqi') {
    out.perModel = false;
    out.single = aqiDaily(fx.airQuality?.hours, days, tz);
  }
  return out;
}

const hiddenModels = new Set();
const LABELS = { newBlend: 'Weather Nourie blend', oldBlend: 'Current', nws: 'NWS 36%', hrrr: 'HRRR 27%', nbm: 'NBM 18%', ecmwf: 'ECMWF 9%', wn: 'WN 10%', single: '' };
const NAMES = { newBlend: 'Weather Nourie', oldBlend: 'Current blend', nws: 'NWS', hrrr: 'HRRR', nbm: 'NBM', ecmwf: 'ECMWF', wn: 'WeatherNext', single: '' };
function renderChart(container, built, varDef, varId) {
  const { days } = built;
  // Size the SVG to its real pixel width so text stays legible on phones.
  const W = Math.max(320, Math.round(container.clientWidth || 900));
  const phone = W < 600;
  const H = phone ? 340 : 380, PL = phone ? 38 : 52, PR = phone ? 10 : 18, PT = 30, PB = 34;
  const FS = phone ? 11 : 14;
  const series = { newBlend: [], fullBlend: [], oldBlend: [], nws: [], hrrr: [], nbm: [], ecmwf: [], wn: [], single: [] };
  const activeW = Object.fromEntries(Object.entries(NEW_WEIGHTS).filter(([id]) => !hiddenModels.has(id)));
  const activeSum = Object.values(activeW).reduce((a, b) => a + b, 0);
  // Is any model that feeds the blend (and has data for this variable) unchecked?
  const hasData = (id) => built.perModel && (id === 'wn' ? (built.wnVals || []).some(finite) : (built.modelMaps || []).some((m) => finite(m?.[id])));
  const blendChanged = Object.keys(NEW_WEIGHTS).some((id) => hiddenModels.has(id) && hasData(id));
  if (built.perModel) {
    days.forEach((d, i) => {
      const src = { ...built.modelMaps[i], wn: built.wnVals[i] };
      if (built.fixedBlend) {
        // All checked: show the site's official rain chance. Any feeding model unchecked: weighted value of the visible models.
        series.newBlend.push(blendChanged ? blendVal(src, activeW) : built.fixedBlend[i]);
        series.fullBlend.push(built.fixedBlend[i]); series.oldBlend.push(null);
      }
      else {
        // Unchecked models drop out of the Weather Nourie blend; remaining weights re-normalize.
        series.newBlend.push(blendVal(src, activeW));
        series.fullBlend.push(blendVal(src, NEW_WEIGHTS));
        series.oldBlend.push(blendVal(src, OLD_WEIGHTS));
      }
      for (const id of ['nws', 'hrrr', 'nbm', 'ecmwf']) series[id].push(finite(src[id]) ? src[id] : null);
      series.wn.push(finite(src.wn) ? src.wn : null);
    });
  } else {
    days.forEach((d, i) => series.single.push(built.single[i] ?? null));
  }
  const ids = built.perModel ? ['newBlend', 'oldBlend', 'nws', 'hrrr', 'nbm', 'ecmwf', 'wn'].filter((id) => series[id].some((v) => v != null)) : ['single'];
  const visible = ids.filter((id) => !hiddenModels.has(id));
  const allV = visible.flatMap((id) => series[id]).filter((v) => v != null);
  if (!ids.length || !series[ids[0]].some((v) => v != null)) {
    container.innerHTML = '<p class="muted" style="font-size:14px">No data for this variable.</p>';
    return;
  }
  let lo = allV.length ? Math.min(...allV) : 0, hi = allV.length ? Math.max(...allV) : 1;
  // Zoom the y-axis to the data range with a little padding
  const pad = Math.max(varDef.unit === 'in' ? 0.02 : 0.5, (hi - lo) * 0.1);
  lo = varDef.unit === '%' || varDef.unit === '' || varDef.unit === 'in' ? Math.max(0, lo - pad) : lo - pad;
  hi += pad;
  if (varDef.unit === '%') hi = Math.min(100, hi);
  const n = days.length;
  const X = (i) => PL + (i / Math.max(1, n - 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const path = (pts) => { let d = '', pen = false; pts.forEach((p, i) => { if (p != null) { d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p).toFixed(1)}`; pen = true; } else pen = false; }); return d; };
  const dayName = (d, i, long) => {
    const dt = new Date(d.date + 'T12:00:00');
    if (long) return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return i === 0 ? (phone ? 'Tdy' : 'Today') : dt.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, phone ? 2 : 3);
  };
  const labels = days.map((d, i) => `<text x="${X(i).toFixed(0)}" y="${H - 10}" text-anchor="middle" font-size="${FS}" font-weight="600" fill="#d5e1f2">${dayName(d, i)}</text>`).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const ylabels = ticks.map((v) =>
    `<line x1="${PL}" x2="${W - PR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="rgba(255,255,255,.14)" stroke-width="1"/>`
    + `<text x="${PL - 6}" y="${(Y(v) + 4).toFixed(0)}" text-anchor="end" font-size="${FS}" fill="#d5e1f2">${varDef.fmt(v)}</text>`).join('');
  const style = { wn: { w: 2.5, dash: '6,4', op: 0.9 }, nws: { w: 2.5, op: 0.85 }, hrrr: { w: 2.5, op: 0.85 }, nbm: { w: 2.5, op: 0.85 }, ecmwf: { w: 2.5, op: 0.85 }, oldBlend: { w: 2.5, dash: '9,5', op: 0.9 }, newBlend: { w: 4, op: 1 }, single: { w: 4, op: 1 } };
  const drawOrder = ['wn', 'nws', 'hrrr', 'nbm', 'ecmwf', 'oldBlend', 'newBlend', 'single'].filter((id) => visible.includes(id));
  const lines = drawOrder.map((id) => { const s = style[id], d = path(series[id]); return d ? `<path d="${d}" fill="none" stroke="${COLORS[id]}" stroke-width="${s.w}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} opacity="${s.op}" stroke-linecap="round" stroke-linejoin="round"/>` : ''; }).join('');
  const primaryId = visible.includes('newBlend') ? 'newBlend' : visible.includes('single') ? 'single' : visible[0];
  const dots = primaryId ? series[primaryId].map((v, i) => v == null ? '' :
    `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="4" fill="${COLORS[primaryId]}"/>`
    + ((phone && i % 2) ? '' : `<text x="${X(i).toFixed(0)}" y="${(Y(v) - 11).toFixed(0)}" text-anchor="middle" font-size="${FS}" fill="#fff" font-weight="700" paint-order="stroke" stroke="rgba(0,0,0,.45)" stroke-width="3">${varDef.fmt(v)}</text>`)).join('') : '';
  const chip = (id) => { const off = hiddenModels.has(id);
    return `<button type="button" class="wn-chip" data-model="${id}" aria-pressed="${!off}" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;border:1px solid ${off ? 'rgba(255,255,255,.12)' : COLORS[id] + '99'};background:${off ? 'transparent' : 'rgba(255,255,255,.10)'};font-family:inherit;font-size:11px;font-weight:600;line-height:1.4;color:${off ? '#7f8ca3' : '#e8eef8'};white-space:nowrap;cursor:pointer;${off ? 'text-decoration:line-through;' : ''}">`
      + `<i style="width:12px;height:3px;border-radius:2px;background:${COLORS[id]};opacity:${off ? 0.3 : 1};display:inline-block"></i>${chipLabel(id, off)}</button>`; };
  const chipLabel = (id, off) => {
    if (!(id in NEW_WEIGHTS)) return LABELS[id];
    if (built.fixedBlend && !blendChanged) return NAMES[id];
    if (off) return `${NAMES[id]} 0%`;
    return `${NAMES[id] === 'WeatherNext' ? 'WN' : NAMES[id]} ${Math.round((NEW_WEIGHTS[id] / (activeSum || 1)) * 100)}%`;
  };
  const legend = built.perModel ? ids.map(chip).join('')
    : `<span style="font-size:11px;color:#d5deee">${varId === 'aqi' ? 'Daily max AQI (Open-Meteo / CAMS)' : varId === 'uv' ? 'Daily max UV index' : ''}</span>`;
  const note = built.perModel ? `<p style="font-size:11px;color:#9fb0c8;margin:6px 0 0">Tap a chip to show/hide a model (hidden models drop out of the Weather Nourie blend) · tap or drag the graph for values. Models drop out as their forecast range ends (HRRR ~2 days, NWS ~7 days).${built.fixedBlend ? ' Rain chance: NWS is its official probability; HRRR, NBM and ECMWF show each model’s rain signal at the day’s peak hour; the blend is the Weather Nourie rain chance.' : ''}${blendChanged ? ' <b style="color:#ffd479">Blend recalculated without hidden models.</b>' : ''}</p>` : '';
  container.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:4px;padding:2px 0 8px">${legend}</div>`
    + `<div class="wn-chart-wrap" style="position:relative;touch-action:pan-y">`
    + `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:100%;height:auto;display:block;cursor:crosshair" role="img" aria-label="${varDef.label} comparison chart">${ylabels}${labels}${lines}${dots}`
    + `<line class="wn-cross" x1="0" x2="0" y1="${PT - 10}" y2="${H - PB}" stroke="#fff" stroke-width="1.5" stroke-dasharray="3,3" opacity="0"/><g class="wn-cross-dots"></g></svg>`
    + `<div class="wn-tip" role="status" aria-live="polite" style="position:absolute;top:4px;display:none;min-width:130px;padding:8px 10px;border-radius:12px;background:rgba(10,20,40,.88);border:1px solid rgba(255,255,255,.22);color:#fff;font-size:12px;line-height:1.45;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.35)"></div></div>${note}`;
  container.querySelectorAll('.wn-chip').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.model; if (hiddenModels.has(id)) hiddenModels.delete(id); else hiddenModels.add(id);
    renderChart(container, built, varDef, varId);
  }));
  const svg = container.querySelector('svg'), tip = container.querySelector('.wn-tip'), cross = container.querySelector('.wn-cross'), cdots = container.querySelector('.wn-cross-dots'), wrap = container.querySelector('.wn-chart-wrap');
  const show = (clientX) => {
    const r = svg.getBoundingClientRect(), sx = (clientX - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(n - 1, Math.round(((sx - PL) / (W - PL - PR)) * (n - 1))));
    const x = X(i);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('opacity', '0.8');
    const rows = visible.map((id) => [id, series[id][i]]).filter(([, v]) => v != null);
    const fb = series.fullBlend[i], nb = series.newBlend[i];
    const delta = blendChanged && fb != null && nb != null ? `<span style="display:block;color:#ffd479;font-size:11px;margin-top:3px">${built.fixedBlend ? 'Weighted from visible models. Official rain chance' : 'With all models'}: ${varDef.fmt(fb)} (${nb - fb >= 0 ? '+' : ''}${varId === 'rain' ? (nb - fb).toFixed(2) : Math.round(nb - fb)})</span>` : '';
    cdots.innerHTML = rows.map(([id, v]) => `<circle cx="${x}" cy="${Y(v).toFixed(1)}" r="5" fill="${COLORS[id]}" stroke="#0a1428" stroke-width="1.5"/>`).join('');
    tip.innerHTML = `<b style="display:block;margin-bottom:3px">${dayName(days[i], i, true)}</b>`
      + (rows.length ? rows.map(([id, v]) => `<span style="display:flex;justify-content:space-between;gap:10px"><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLORS[id]};margin-right:5px"></i>${NAMES[id] || varDef.label}</span><b>${varDef.fmt(v)}</b></span>`).join('') : '<span>No model data</span>') + delta;
    tip.style.display = 'block';
    const px = (x / W) * r.width, tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(r.width - tw, px > r.width / 2 ? px - tw - 12 : px + 12))}px`;
  };
  const hide = () => { tip.style.display = 'none'; cross.setAttribute('opacity', '0'); cdots.innerHTML = ''; };
  let dragging = false;
  svg.addEventListener('pointerdown', (e) => { dragging = true; show(e.clientX); });
  svg.addEventListener('pointermove', (e) => { if (dragging || e.pointerType === 'mouse') show(e.clientX); });
  svg.addEventListener('pointerup', (e) => { dragging = false; if (e.pointerType === 'mouse') return; });
  svg.addEventListener('pointerleave', (e) => { dragging = false; if (e.pointerType === 'mouse') hide(); });
  svg.addEventListener('pointercancel', () => { dragging = false; });
  wrap.addEventListener('touchmove', (e) => { if (dragging && e.touches[0]) { show(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
  document.addEventListener('pointerdown', (e) => { if (!wrap.contains(e.target)) hide(); }, { once: true });
  container._wnShow = show;
}

let forecastCache = null, wnCache = null, varId = 'temp';

async function render() {
  const chartEl = document.getElementById('wn-compare-chart');
  if (!chartEl || !forecastCache) return;
  varId = curVar;
  const varDef = VARIABLES[varId];
  const built = buildSeries(forecastCache, wnCache, varId);
  const title = document.getElementById('wn-compare-title');
  if (title) title.textContent = `${varDef.label} — 10-day comparison`;
  renderChart(chartEl, built, varDef, varId);

  const oldWarn = document.getElementById('wn-stale-warn');
  if (oldWarn) oldWarn.remove();
  if (varId !== 'pop' && varId !== 'uv' && varId !== 'aqi' && wnCache?.ageDays != null && wnCache.ageDays > 2) {
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
    forecastCache = forecast;
    wnCache = pickWN(wn, forecast);
    render();
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 200); });
    // the section starts hidden (width 0); re-render when it is opened
    if (compareBtn) compareBtn.addEventListener('click', () => setTimeout(render, 0));
  } catch (e) {
    document.getElementById('wn-compare-chart').innerHTML =
      `<p class="muted" style="font-size:14px">Couldn't load: ${e.message}</p>`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
