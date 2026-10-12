/** WN Blend comparison — variable picker, daily view.
 *  New weights: NWS 36%, HRRR 27%, NBM 18%, ECMWF 9%, WN 10%
 */
const WN_FEED = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext-full.json';
const NEW_WEIGHTS = { nws: 0.36, hrrr: 0.27, nbm: 0.18, ecmwf: 0.09, wn: 0.10 };
const OLD_WEIGHTS = { nws: 0.40, hrrr: 0.30, nbm: 0.20, ecmwf: 0.10 };

const VARIABLES = {
  temp: { label: 'Temperature', unit: '°F', blendKey: 'highBlend', wnKey: 'temperature_2m', wnAgg: 'max' },
  rain: { label: 'Precipitation', unit: 'in', blendKey: 'qpfBlend', wnKey: 'total_precipitation_1hr', wnAgg: 'sum' },
};
let curVar = 'temp';

const COLORS = {
  newBlend: '#ffffff', oldBlend: '#8b98b0',
  nws: '#7fd4ff', hrrr: '#ffb47d', nbm: '#7de8a8', ecmwf: '#b48cff', wn: '#ffd479',
};
const K2F = (k) => (k - 273.15) * 9 / 5 + 32;

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function getLoc() {
  const m = location.search.match(/[?&]location=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : 'knightdale';
}

async function loadWNFeed() {
  try {
    const feed = await fetchJSON(WN_FEED);
    const src = feed.sources?.surface;
    const pts = src?.points || [];
    const pt = pts.find((p) => (p.name || '').toLowerCase().includes('knightdale')) || pts[0];
    if (!pt?.hourly?.length) return null;
    const runAt = src?.runAt || feed.runAt;
    const ageDays = runAt ? (Date.now() - new Date(runAt).getTime()) / 86400000 : null;
    return { hourly: pt.hourly, runAt, ageDays };
  } catch { return null; }
}

// Aggregate WN hourly to daily
function wnDaily(wnHourly, varKey, agg, days) {
  if (!wnHourly) return days.map(() => null);
  const byDay = {};
  for (const h of wnHourly) {
    const v = h.values?.[varKey];
    const raw = typeof v === 'object' ? v.mean : v;
    if (raw == null) continue;
    const val = varKey === 'temperature_2m' ? K2F(raw) : raw / 25.4; // mm->in for precip
    const day = new Date(h.time).toISOString().slice(0, 10);
    (byDay[day] = byDay[day] || []).push(val);
  }
  return days.map((d) => {
    const vals = byDay[d.dateKey];
    if (!vals?.length) return null;
    return agg === 'max' ? Math.max(...vals) : vals.reduce((a, b) => a + b, 0);
  });
}

function blendVal(sources, weights) {
  let sum = 0, wsum = 0;
  for (const [id, w] of Object.entries(weights)) {
    const v = sources[id];
    if (typeof v === 'number' && Number.isFinite(v)) { sum += v * w; wsum += w; }
  }
  return wsum > 0 ? sum / wsum : null;
}

function renderChart(container, days, wnDailyVals, varDef) {
  const H = 260, W = 900, PL = 52, PR = 14, PT = 24, PB = 30;
  const series = { newBlend: [], oldBlend: [], nws: [], hrrr: [], nbm: [], ecmwf: [], wn: [] };

  days.forEach((d, i) => {
    const blend = d[varDef.blendKey];
    const src = {};
    for (const s of (blend?.sources || [])) src[s.id] = s.value;
    src.wn = wnDailyVals[i];
    series.newBlend.push({ v: blendVal(src, NEW_WEIGHTS) });
    series.oldBlend.push({ v: blendVal(src, OLD_WEIGHTS) });
    for (const id of ['nws', 'hrrr', 'nbm', 'ecmwf', 'wn']) series[id].push({ v: src[id] ?? null });
  });

  const allV = Object.values(series).flatMap((s) => s.map((p) => p.v)).filter((v) => v != null);
  if (!allV.length) {
    container.innerHTML = '<p class="muted">No data for this variable.</p>';
    return;
  }
  let lo = Math.min(...allV), hi = Math.max(...allV);
  const pad = Math.max(varDef.unit === '°F' ? 2 : 0.05, (hi - lo) * 0.15);
  lo = Math.max(0, lo - pad); hi += pad;

  const n = days.length;
  const X = (i) => PL + (i / Math.max(1, n - 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const path = (pts) => {
    let d = '';
    pts.forEach((p, i) => { if (p.v != null) d += `${d ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`; });
    return d;
  };

  const fmtV = (v) => varDef.unit === '°F' ? `${Math.round(v)}°` : `${v.toFixed(2)}"`;
  const labels = days.map((d, i) => {
    const dt = new Date(d.date + 'T12:00:00');
    const name = i === 0 ? 'Today' : dt.toLocaleDateString('en-US', { weekday: 'short' });
    return `<text x="${X(i).toFixed(0)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#8b98b0">${name}</text>`;
  }).join('');
  const ylabels = [lo, (lo + hi) / 2, hi].map((v) =>
    `<text x="6" y="${(Y(v) + 4).toFixed(0)}" font-size="11" fill="#8b98b0">${fmtV(v)}</text>`).join('');

  const order = [
    { id: 'wn', w: 1.5, dash: '5,4', op: 0.85 },
    { id: 'nws', w: 1.5, op: 0.7 }, { id: 'hrrr', w: 1.5, op: 0.7 },
    { id: 'nbm', w: 1.5, op: 0.7 }, { id: 'ecmwf', w: 1.5, op: 0.7 },
    { id: 'oldBlend', w: 2, dash: '8,4', op: 0.9 },
    { id: 'newBlend', w: 3, op: 1 },
  ];
  const lines = order.map(({ id, w, dash, op }) =>
    `<path d="${path(series[id])}" fill="none" stroke="${COLORS[id]}" stroke-width="${w}"`
    + `${dash ? ` stroke-dasharray="${dash}"` : ''} opacity="${op}" stroke-linecap="round"/>`).join('');

  // Value labels on new blend
  const dots = series.newBlend.map((p, i) => p.v == null ? '' :
    `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3.5" fill="${COLORS.newBlend}"/>`
    + `<text x="${X(i).toFixed(0)}" y="${(Y(p.v) - 10).toFixed(0)}" text-anchor="middle" font-size="10" fill="#fff" font-weight="600">${fmtV(p.v)}</text>`
  ).join('');

  const legend = [
    ['newBlend', 'New blend (WN 10%)'], ['oldBlend', 'Current blend'],
    ['nws', 'NWS'], ['hrrr', 'HRRR'], ['nbm', 'NBM'], ['ecmwf', 'ECMWF'], ['wn', 'WeatherNext'],
  ].map(([id, label]) =>
    `<span style="display:inline-flex;align-items:center;gap:6px;margin:0 10px 6px 0;font-size:12px;color:#c9d4e8">`
    + `<i style="width:22px;height:3px;border-radius:2px;background:${COLORS[id]};display:inline-block"></i>${label}</span>`).join('');

  container.innerHTML = `<div style="padding:4px 0 10px">${legend}</div>`
    + `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${ylabels}${labels}${lines}${dots}</svg>`;
}

let forecastCache = null, wnCache = null;

async function render() {
  const chartEl = document.getElementById('wn-compare-chart');
  if (!chartEl || !forecastCache) return;
  const varDef = VARIABLES[curVar];
  const days = (forecastCache.days || []).slice(0, 7).map((d) => ({
    ...d, dateKey: d.date,
  }));
  const wnVals = wnDaily(wnCache?.hourly, varDef.wnKey, varDef.wnAgg, days);
  // Update title
  const title = document.getElementById('wn-compare-title');
  if (title) title.textContent = `${varDef.label} — 7-day comparison`;
  renderChart(chartEl, days, wnVals, varDef);

  // Stale warning
  const oldWarn = document.getElementById('wn-stale-warn');
  if (oldWarn) oldWarn.remove();
  if (wnCache?.ageDays != null && wnCache.ageDays > 2) {
    const warn = document.createElement('p');
    warn.id = 'wn-stale-warn';
    warn.style.cssText = 'font-size:11px;color:#ffb47d;margin:8px 0 0';
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
  section.className = 'glass wn-blend-compare';
  section.style.cssText = 'margin:14px 0;padding:18px';
  section.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">
      <h2 id="wn-compare-title" style="margin:0;font-size:13px;letter-spacing:.08em">FORECAST COMPARISON</h2>
      <div id="wn-var-picker" style="display:flex;gap:6px">
        ${Object.entries(VARIABLES).map(([id, v]) =>
          `<button data-var="${id}" style="background:${id === curVar ? 'rgba(127,212,255,.2)' : 'rgba(255,255,255,.07)'};border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:999px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer">${v.label}</button>`).join('')}
      </div>
    </div>
    <p style="font-size:12px;color:#8b98b0;margin:0 0 8px">NWS 36% · HRRR 27% · NBM 18% · ECMWF 9% · WN 10%</p>
    <div id="wn-compare-chart"><p class="muted">Loading comparison…</p></div>`;
  hero.after(section);

  document.getElementById('wn-var-picker').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    curVar = b.dataset.var;
    document.querySelectorAll('#wn-var-picker button').forEach((x) => {
      x.style.background = x.dataset.var === curVar ? 'rgba(127,212,255,.2)' : 'rgba(255,255,255,.07)';
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
    wnCache = wn;
    render();
  } catch (e) {
    document.getElementById('wn-compare-chart').innerHTML =
      `<p class="muted">Couldn't load: ${e.message}</p>`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
