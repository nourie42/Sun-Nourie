/** WN Blend — adds 10% WeatherNext to Daniel's blend + comparison graph.
 *  New weights: NWS 36%, HRRR 27%, NBM 18%, ECMWF 9%, WN 10%
 *  (renormalized from 40/30/20/10 to make room for WN 10%)
 */
const WN_FEED = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext-full.json';
const NEW_WEIGHTS = { nws: 0.36, hrrr: 0.27, nbm: 0.18, ecmwf: 0.09, wn: 0.10 };
const OLD_WEIGHTS = { nws: 0.40, hrrr: 0.30, nbm: 0.20, ecmwf: 0.10 };

const COLORS = {
  newBlend: '#ffffff',
  oldBlend: '#8b98b0',
  nws: '#7fd4ff',
  hrrr: '#ffb47d',
  nbm: '#7de8a8',
  ecmwf: '#b48cff',
  wn: '#ffd479',
};

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function getLoc() {
  const m = location.search.match(/[?&]location=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : 'knightdale';
}

const K2F = (k) => (k - 273.15) * 9 / 5 + 32;

async function loadWNFeed(loc) {
  try {
    const feed = await fetchJSON(WN_FEED);
    const src = feed.sources?.surface;
    const pts = src?.points || feed.points || [];
    const pt = pts.find((p) =>
      p.id === loc || (p.name || '').toLowerCase().includes('knightdale')
    ) || pts[0];
    const hourly = pt?.hourly || pt?.hours;
    if (!hourly?.length) return null;
    // Normalize to [{time, tempF}]
    const hours = hourly.map((h) => {
      const v = h.values?.temperature_2m ?? h.temperature_2m ?? h.temperature;
      const kelvin = typeof v === 'object' ? v.mean : v;
      return { time: h.time, tempF: kelvin != null ? K2F(kelvin) : null };
    }).filter((h) => h.tempF != null);
    const runAt = src?.runAt || feed.runAt || feed.generatedAt;
    const ageDays = runAt ? (Date.now() - new Date(runAt).getTime()) / 86400000 : null;
    return { hours, runAt, ageDays };
  } catch { return null; }
}

function wnTempAt(wnHours, time) {
  if (!wnHours) return null;
  const t = new Date(time).getTime();
  let best = null, bestDiff = Infinity;
  for (const h of wnHours) {
    const ht = new Date(h.time).getTime();
    const d = Math.abs(ht - t);
    if (d < bestDiff) { bestDiff = d; best = h; }
  }
  if (!best || bestDiff > 3 * 3600000) return null;
  return best.tempF;
}

function blendTemp(sources, weights) {
  let sum = 0, wsum = 0;
  for (const [id, w] of Object.entries(weights)) {
    const v = sources[id];
    if (typeof v === 'number' && Number.isFinite(v)) { sum += v * w; wsum += w; }
  }
  return wsum > 0 ? sum / wsum : null;
}

function renderChart(container, hours, wnHours) {
  const H = 260, W = 900, PL = 44, PR = 14, PT = 24, PB = 28;
  const series = {
    newBlend: [], oldBlend: [],
    nws: [], hrrr: [], nbm: [], ecmwf: [], wn: [],
  };

  for (const h of hours) {
    const src = {};
    for (const s of (h.temperatureBlend?.sources || [])) src[s.id] = s.value;
    src.wn = wnTempAt(wnHours, h.time);
    const nb = blendTemp(src, NEW_WEIGHTS);
    const ob = blendTemp(src, OLD_WEIGHTS);
    const t = new Date(h.time);
    series.newBlend.push({ t, v: nb });
    series.oldBlend.push({ t, v: ob });
    for (const id of ['nws', 'hrrr', 'nbm', 'ecmwf', 'wn']) {
      series[id].push({ t, v: src[id] ?? null });
    }
  }

  const allV = Object.values(series).flatMap((s) => s.map((p) => p.v)).filter((v) => v != null);
  if (!allV.length) {
    container.innerHTML = '<p class="muted">Not enough data for comparison.</p>';
    return;
  }
  let lo = Math.min(...allV), hi = Math.max(...allV);
  const pad = Math.max(2, (hi - lo) * 0.15);
  lo -= pad; hi += pad;

  const n = hours.length;
  const X = (i) => PL + (i / Math.max(1, n - 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);

  const path = (pts) => {
    let d = '';
    pts.forEach((p, i) => {
      if (p.v == null) return;
      d += `${d ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`;
    });
    return d;
  };

  // X labels every 6 hours
  const labels = [];
  for (let i = 0; i < n; i += 6) {
    const t = series.newBlend[i]?.t;
    if (t) labels.push(`<text x="${X(i).toFixed(0)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#8b98b0">${t.toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' ', '')}</text>`);
  }
  // Y labels
  const ylabels = [lo + pad, (lo + hi) / 2, hi - pad].map((v) =>
    `<text x="8" y="${(Y(v) + 4).toFixed(0)}" font-size="11" fill="#8b98b0">${Math.round(v)}°</text>`
  ).join('');

  const lines = [
    { id: 'wn', w: 1.5, dash: '5,4', opacity: 0.85 },
    { id: 'nws', w: 1.5, opacity: 0.7 },
    { id: 'hrrr', w: 1.5, opacity: 0.7 },
    { id: 'nbm', w: 1.5, opacity: 0.7 },
    { id: 'ecmwf', w: 1.5, opacity: 0.7 },
    { id: 'oldBlend', w: 2, dash: '8,4', opacity: 0.9 },
    { id: 'newBlend', w: 3, opacity: 1 },
  ].map(({ id, w, dash, opacity }) =>
    `<path d="${path(series[id])}" fill="none" stroke="${COLORS[id]}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} opacity="${opacity}" stroke-linecap="round"/>`
  ).join('');

  const legend = [
    ['newBlend', 'New blend (WN 10%)'],
    ['oldBlend', 'Current blend'],
    ['nws', 'NWS 36%'],
    ['hrrr', 'HRRR 27%'],
    ['nbm', 'NBM 18%'],
    ['ecmwf', 'ECMWF 9%'],
    ['wn', 'WeatherNext 10%'],
  ].map(([id, label]) =>
    `<span style="display:inline-flex;align-items:center;gap:6px;margin:0 10px 6px 0;font-size:12px;color:#c9d4e8">`
    + `<i style="width:22px;height:3px;border-radius:2px;background:${COLORS[id]};display:inline-block"></i>${label}</span>`
  ).join('');

  container.innerHTML = `
    <div style="padding:4px 0 12px">${legend}</div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Forecast comparison">
      ${ylabels}${labels}${lines}
    </svg>`;
}

async function init() {
  // Only on experimental page
  if (!document.querySelector('.hero')) return;

  const loc = getLoc();
  const hero = document.querySelector('.hero');
  if (!hero) return;

  // Create container after hero
  const section = document.createElement('section');
  section.className = 'glass wn-blend-compare';
  section.style.cssText = 'margin:14px 0;padding:18px';
  section.innerHTML = `
    <div class="section-top" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <h2 style="margin:0;font-size:13px;letter-spacing:.08em">FORECAST COMPARISON</h2>
      <span style="font-size:11px;color:#8b98b0">New blend adds 10% WeatherNext</span>
    </div>
    <p style="font-size:12px;color:#8b98b0;margin:0 0 8px">NWS 36% · HRRR 27% · NBM 18% · ECMWF 9% · WN 10%</p>
    <div id="wn-compare-chart"><p class="muted">Loading comparison…</p></div>`;
  hero.after(section);

  try {
    const [forecast, wn] = await Promise.all([
      fetchJSON(`/api/weather-fusion/forecast?location=${encodeURIComponent(loc)}`),
      loadWNFeed(loc),
    ]);
    const hours = (forecast.hours || []).slice(0, 48);
    const chartEl = document.getElementById('wn-compare-chart');
    if (wn?.hours) {
      renderChart(chartEl, hours, wn.hours);
      if (wn.ageDays != null && wn.ageDays > 2) {
        const warn = document.createElement('p');
        warn.style.cssText = 'font-size:11px;color:#ffb47d;margin:8px 0 0';
        warn.textContent = `⚠ WeatherNext data is ${Math.round(wn.ageDays)} days old — WN line may not align with current forecast.`;
        chartEl.appendChild(warn);
      }
    } else {
      chartEl.innerHTML = '<p class="muted">WeatherNext feed unavailable — showing model blend only.</p>';
      renderChart(chartEl, hours, null);
    }
  } catch (e) {
    document.getElementById('wn-compare-chart').innerHTML =
      `<p class="muted">Couldn't load comparison: ${e.message}</p>`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
