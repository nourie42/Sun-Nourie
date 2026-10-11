/* Blend — how the Weather Nourie forecast is made.
 * Combines the house model blend (NWS/HRRR/ECMWF/NBM) from
 * /api/weather-fusion/forecast with Google WeatherNext AI
 * (published feed, comparison only).
 * Pure builders are exported for testing; DOM wiring runs in browser. */

const WN_FEED_URL = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext3.json';

const MODELS = [
  { id: 'nws', label: 'NWS', color: '#7fd4ff', desc: 'Official National Weather Service forecast' },
  { id: 'hrrr', label: 'HRRR', color: '#ffd479', desc: '3 km high-resolution rapid refresh' },
  { id: 'ecmwf', label: 'ECMWF', color: '#9dffb0', desc: 'European medium-range model' },
  { id: 'nbm', label: 'NBM', color: '#ff9d9d', desc: 'NWS National Blend of Models' },
];
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const round = (n) => (finite(n) ? Math.round(n) : null);

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
    if (Number.isFinite(t)) map.set(Math.floor(t / 3600000) * 3600000, r);
  }
  return map;
}

/* ---- view model (pure) ---- */
export function buildBlendModel(forecast, wnFeed, locationId, nowMs = Date.now()) {
  const loc = forecast?.location || {};
  const timeZone = loc.timeZone || 'America/New_York';
  const cur = forecast?.current || {};
  const hours = (forecast?.hours || [])
    .map((h) => ({ ...h, time: Date.parse(h.time) }))
    .filter((h) => Number.isFinite(h.time) && h.time + 3600000 > nowMs)
    .slice(0, 24);
  const weights = forecast?.blendPolicy?.sameDay || { nws: 0.4, hrrr: 0.3, ecmwf: 0.1, nbm: 0.2 };
  const contrib = Object.fromEntries((forecast?.modelContributions || []).map((m) => [m.id, m]));

  const point = wnPoint(wnFeed, locationId);
  const wnMap = wnHourMap(point);
  const wnAt = (t) => wnMap.get(Math.floor(t / 3600000) * 3600000) || null;

  const series = hours.map((h) => {
    const src = Object.fromEntries((h.temperatureBlend?.sources || []).map((s) => [s.id, s.value]));
    const gsrc = Object.fromEntries((h.gustBlend?.sources || []).map((s) => [s.id, s.value]));
    const wn = wnAt(h.time);
    const popSrc = h.rainLikelihood?.sourceValues || {};
    return {
      time: h.time,
      blend: finite(h.temperatureBlend?.value) ? h.temperatureBlend.value : h.temperature,
      models: Object.fromEntries(MODELS.map((m) => [m.id, src[m.id] ?? null])),
      wnMean: wn && finite(wn.temperatureF) ? wn.temperatureF : null,
      wnP10: wn && finite(wn.temperatureP10F) ? wn.temperatureP10F : null,
      wnP90: wn && finite(wn.temperatureP90F) ? wn.temperatureP90F : null,
      pop: finite(h.rainLikelihood?.value) ? Math.round(h.rainLikelihood.value) : (finite(h.pop) ? Math.round(h.pop) : null),
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
    id: 'weathernext', label: 'WeatherNext', color: '#b48cff',
    desc: 'Google AI weather model — ensemble mean with uncertainty band',
    weight: null, runAt: wnFeed?.runAt || null, resolution: wnFeed?.gridResolutionDegrees ? `${wnFeed.gridResolutionDegrees}° grid` : null,
    nowTemp: h0 ? round(h0.wnMean) : null, ai: true,
  });

  // WeatherNext 7-day highs/lows from its hourly
  const aiDays = [];
  if (point) {
    const byDay = new Map();
    for (const r of point.hourly || []) {
      const t = Date.parse(r.time);
      if (!Number.isFinite(t) || !finite(r.temperatureF)) continue;
      const key = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
      if (!byDay.has(key)) byDay.set(key, { temps: [], p10: [], p90: [], sample: t });
      const g = byDay.get(key);
      g.temps.push(r.temperatureF);
      if (finite(r.temperatureP10F)) g.p10.push(r.temperatureP10F);
      if (finite(r.temperatureP90F)) g.p90.push(r.temperatureP90F);
    }
    const sorted = [...byDay.entries()].sort((a, b) => a[1].sample - b[1].sample).slice(0, 7);
    sorted.forEach(([key, g], i) => {
      const label = i === 0 ? 'Today' : new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(g.sample + 12 * 3600000));
      aiDays.push({
        label,
        high: round(Math.max(...g.temps)),
        low: round(Math.min(...g.temps)),
        band: g.p10.length && g.p90.length ? `${round(Math.min(...g.p10))}°–${round(Math.max(...g.p90))}°` : null,
      });
    });
  }

  return {
    place: loc.name || 'Knightdale / Raleigh',
    updatedAt: nowMs,
    sky: skyImage(hours, nowMs),
    hero: {
      temp: round(cur.temperature),
      condition: cur.condition || 'Conditions unavailable',
      high: round(forecast?.days?.[0]?.high),
      low: round(forecast?.days?.[0]?.low),
    },
    series,
    modelCards,
    weights,
    rainHours: series.slice(0, 12).map((s) => ({ time: s.time, pop: s.pop })),
    aiDays,
    wnAvailable: !!point,
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
  { id: 'rain', label: 'Rain chance', unit: '%', sub: 'Each model\u2019s own rain probability for the hour, against the blended chance (white).' },
  { id: 'dewpoint', label: 'Dew point', unit: '°', sub: 'Blended dew point against Google WeatherNext AI\u2019s call — watch the gap for mugginess.' },
  { id: 'wind', label: 'Wind gusts', unit: ' mph', sub: 'Each model\u2019s gust call against the blend. Dashed violet is WeatherNext AI\u2019s sustained wind.' },
];

function chartSeries(model, varId) {
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

export function buildChart(model, varId = 'temp') {
  const pts = (model.series || []).filter((s) => Number.isFinite(s.time));
  const cfg = CHART_VARS.find((c) => c.id === varId) || CHART_VARS[0];
  const s = chartSeries(model, varId);
  const hasBlend = s.blend.some(finite);
  if (!hasBlend || pts.length < 4) return '';
  const W = 640, H = 250, PL = 12, PR = 12, PT = 30, PB = 42;
  const all = [...s.blend];
  for (const m of s.models) all.push(...m.vals);
  if (s.band) { all.push(...s.band.lo, ...s.band.hi); }
  if (s.extra) for (const e of s.extra) all.push(...e.vals);
  const nums = all.filter(finite);
  if (!nums.length) return '';
  let lo = Math.min(...nums), hi = Math.max(...nums);
  if (varId === 'rain') { lo = 0; hi = Math.max(hi, 20); }
  else if (hi - lo < 6) { const mid = (hi + lo) / 2; lo = mid - 3; hi = mid + 3; }
  const X = (i) => PL + (i * (W - PL - PR)) / (pts.length - 1);
  const Y = (t) => PT + (1 - (t - lo) / (hi - lo)) * (H - PT - PB);
  const line = (vals) => {
    const xy = [];
    vals.forEach((v, i) => { if (finite(v)) xy.push([X(i), Y(v)]); });
    return xy.length >= 2 ? smoothPath(xy) : '';
  };
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${cfg.label} model comparison over 24 hours">`;
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
  const b0 = s.blend.find(finite);
  svg += `<line class="arc-now" x1="${X(0).toFixed(1)}" y1="${PT - 6}" x2="${X(0).toFixed(1)}" y2="${H - PB}"/>`
    + `<circle class="arc-now-dot" cx="${X(0).toFixed(1)}" cy="${Y(b0).toFixed(1)}" r="5"/>`;
  for (let i = 0; i < pts.length; i += 4) {
    svg += `<text x="${X(i).toFixed(1)}" y="${(H - 24).toFixed(1)}" text-anchor="middle">${hourLabel(pts[i].time, model.timeZone)}</text>`;
    const bv = s.blend[i];
    if (finite(bv)) svg += `<text class="arc-temp" x="${X(i).toFixed(1)}" y="${(Y(bv) - 10).toFixed(1)}" text-anchor="middle">${Math.round(bv)}${cfg.unit === ' mph' ? '' : cfg.unit}</text>`;
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
function chartLegends(model, varId) {
  const w = model.weights;
  const wp = (id) => `${Math.round((w[id] || 0) * 100)}%`;
  switch (varId) {
    case 'rain':
      return [{ color: '#fff', label: 'Blended chance' },
        ...MODELS.map((m) => ({ color: m.color, label: `${m.label} ${wp(m.id)}` }))];
    case 'dewpoint':
      return [{ color: '#fff', label: 'Blended dew point' }, { color: '#b48cff', label: 'WeatherNext AI', dashed: true }];
    case 'wind':
      return [{ color: '#fff', label: 'Blended gust' },
        ...MODELS.map((m) => ({ color: m.color, label: `${m.label} ${wp(m.id)}` })),
        { color: '#b48cff', label: 'WeatherNext AI wind', dashed: true }];
    default:
      return [{ color: '#fff', label: 'House blend' },
        ...MODELS.map((m) => ({ color: m.color, label: `${m.label} ${wp(m.id)}` })),
        { band: true, label: 'WeatherNext AI uncertainty' }];
  }
}

function renderChartTabs(model, activeId) {
  const tabs = el('chart-tabs');
  tabs.innerHTML = '';
  for (const v of CHART_VARS) {
    const b = document.createElement('button');
    b.className = 'tab';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', v.id === activeId ? 'true' : 'false');
    b.textContent = v.label;
    b.addEventListener('click', () => renderChartTabs(model, v.id));
    tabs.appendChild(b);
  }
  const cfg = CHART_VARS.find((c) => c.id === activeId) || CHART_VARS[0];
  el('chart-sub').textContent = cfg.sub;
  el('blend-arc').innerHTML = buildChart(model, activeId);
  const legend = el('blend-legend');
  legend.innerHTML = '';
  for (const item of chartLegends(model, activeId)) {
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
  el('blend-line').textContent = `House blend · NWS ${Math.round(w.nws * 100)} · HRRR ${Math.round(w.hrrr * 100)} · NBM ${Math.round(w.nbm * 100)} · ECMWF ${Math.round(w.ecmwf * 100)}`;
  el('now-hilo').textContent = model.hero.high != null ? `H ${model.hero.high}°  ·  L ${model.hero.low ?? '--'}°` : '';
  renderChartTabs(model, 'temp');

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
    mw.textContent = m.ai ? 'Comparison only — not in the blend' : `Weight ${Math.round((m.weight || 0) * 100)}%`;
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
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  el('updated').textContent = 'Updated ' + new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(model.updatedAt));
}

async function load(locationId) {
  const err = el('error');
  err.hidden = true;
  el('now-cond').textContent = 'Loading…';
  try {
    const [fRes, wnRes] = await Promise.all([
      fetch(`/api/weather-fusion/forecast?location=${encodeURIComponent(locationId)}`, { credentials: 'same-origin' }),
      fetch(WN_FEED_URL, { signal: AbortSignal.timeout(25000) }).catch(() => null),
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
    render(buildBlendModel(forecast, wnFeed, locationId));
  } catch (e) {
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
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
