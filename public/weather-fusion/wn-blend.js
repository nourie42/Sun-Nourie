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
  humidity: { label: 'Humidity',      unit: '%',   fmt: (v) => `${Math.round(v)}%` },
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

function renderChart(container, built, varDef, varId) {
  const { days } = built;
  // Size the SVG to its real pixel width so text stays legible on phones.
  const W = Math.max(320, Math.round(container.clientWidth || 900));
  const phone = W < 600;
  const H = phone ? 340 : 380, PL = phone ? 40 : 52, PR = phone ? 12 : 18, PT = 30, PB = 34;
  const FS = phone ? 12 : 14;
  const series = { newBlend: [], oldBlend: [], nws: [], hrrr: [], nbm: [], ecmwf: [], wn: [], single: [] };

  if (built.perModel) {
    days.forEach((d, i) => {
      const src = { ...built.modelMaps[i], wn: built.wnVals[i] };
      series.newBlend.push(blendVal(src, NEW_WEIGHTS));
      series.oldBlend.push(blendVal(src, OLD_WEIGHTS));
      for (const id of ['nws', 'hrrr', 'nbm', 'ecmwf']) series[id].push(finite(src[id]) ? src[id] : null);
      series.wn.push(finite(src.wn) ? src.wn : null);
    });
  } else {
    days.forEach((d, i) => series.single.push(built.single[i] ?? null));
  }

  const allV = Object.values(series).flat().filter((v) => v != null);
  if (!allV.length) {
    container.innerHTML = '<p class="muted" style="font-size:14px">No data for this variable.</p>';
    return;
  }
  let lo = Math.min(...allV), hi = Math.max(...allV);
  // Zoom the y-axis to the data range with a little padding
  const pad = Math.max(varDef.unit === 'in' ? 0.02 : 0.5, (hi - lo) * 0.1);
  lo = varDef.unit === '%' || varDef.unit === '' ? Math.max(0, lo - pad) : lo - pad;
  if (varDef.unit === 'in') lo = Math.max(0, lo);
  hi += pad;

  const n = days.length;
  const X = (i) => PL + (i / Math.max(1, n - 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const path = (pts) => {
    let d = '';
    pts.forEach((p, i) => { if (p != null) d += `${d ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p).toFixed(1)}`; });
    return d;
  };

  const labels = days.map((d, i) => {
    const dt = new Date(d.date + 'T12:00:00');
    const name = i === 0 ? 'Today' : dt.toLocaleDateString('en-US', { weekday: 'short' });
    return (phone && i % 2) ? '' : `<text x="${X(i).toFixed(0)}" y="${H - 10}" text-anchor="middle" font-size="${FS}" font-weight="600" fill="#d5e1f2">${name}</text>`;
  }).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const ylabels = ticks.map((v) =>
    `<line x1="${PL}" x2="${W - PR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="rgba(255,255,255,.14)" stroke-width="1"/>`
    + `<text x="${PL - 6}" y="${(Y(v) + 4).toFixed(0)}" text-anchor="end" font-size="${FS}" fill="#d5e1f2">${varDef.fmt(v)}</text>`).join('');

  let order;
  if (built.perModel) {
    order = [
      { id: 'wn', w: 2, dash: '6,4', op: 0.9 },
      { id: 'nws', w: 2.5, op: 0.8 }, { id: 'hrrr', w: 2.5, op: 0.8 },
      { id: 'nbm', w: 2.5, op: 0.8 }, { id: 'ecmwf', w: 2.5, op: 0.8 },
      { id: 'oldBlend', w: 2.5, dash: '9,5', op: 0.9 },
      { id: 'newBlend', w: 4, op: 1 },
    ];
  } else {
    order = [{ id: 'single', w: 3.5, op: 1 }];
  }
  const lines = order.map(({ id, w, dash, op }) => {
    const dAttr = path(series[id]);
    if (!dAttr) return '';
    return `<path d="${dAttr}" fill="none" stroke="${COLORS[id]}" stroke-width="${w}"`
      + `${dash ? ` stroke-dasharray="${dash}"` : ''} opacity="${op}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');

  // Value labels on the primary line
  const primary = built.perModel ? series.newBlend : series.single;
  const dots = primary.map((v, i) => v == null ? '' :
    `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="4.5" fill="${built.perModel ? COLORS.newBlend : COLORS.single}"/>`
    + `<text x="${X(i).toFixed(0)}" y="${(Y(v) - 12).toFixed(0)}" text-anchor="middle" font-size="${FS}" fill="#ffffff" font-weight="700" paint-order="stroke" stroke="rgba(0,0,0,.45)" stroke-width="3">${(phone && i % 2) ? '' : varDef.fmt(v)}</text>`
  ).join('');

  let legend;
  if (built.perModel) {
    legend = [
      ['newBlend', 'Weather Nourie blend'], ['oldBlend', 'Current'],
      ['nws', 'NWS 36%'], ['hrrr', 'HRRR 27%'], ['nbm', 'NBM 18%'], ['ecmwf', 'ECMWF 9%'],
      ...(series.wn.some((v) => v != null) ? [['wn', 'WN 10%']] : []),
    ].map(([id, label]) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.07);font-size:11px;line-height:1.4;color:#d5deee;white-space:nowrap">`
      + `<i style="width:12px;height:3px;border-radius:2px;background:${COLORS[id]};display:inline-block"></i>${label}</span>`).join('');
  } else {
    legend = `<span style="font-size:11px;color:#d5deee">${varId === 'aqi' ? 'Daily max AQI (Open-Meteo / CAMS)' : varId === 'uv' ? 'Daily max UV index' : ''}</span>`;
  }

  container.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:4px;padding:2px 0 8px">${legend}</div>`
    + `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:100%;height:auto;display:block" role="img" aria-label="${varDef.label} comparison chart">${ylabels}${labels}${lines}${dots}</svg>`;
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
  if (varId !== 'humidity' && varId !== 'uv' && varId !== 'aqi' && wnCache?.ageDays != null && wnCache.ageDays > 2) {
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
