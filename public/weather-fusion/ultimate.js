/** Ultimate Weather — the best of every page, together. */
import {forecastRows,matchingForecastRows,installForecastRefresh} from './weathernext-data.js';
const el = (id) => document.getElementById(id);
const opt = (id) => document.getElementById(id);
function setText(id, txt) { const n = opt(id); if (n) n.textContent = txt; }
function setHTML(id, html) { const n = opt(id); if (n) n.innerHTML = html; }
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const WN_FEED = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext-full.json';

let forecast = null, wnFeed = null, wnCatalog = null;
let loc = ['knightdale','greenville','hazen'].includes(new URLSearchParams(location.search).get('location'))?new URLSearchParams(location.search).get('location'):'knightdale';
let wnField = 'temperature_2m';
let skyFlip = false;

const WN_UNITS = { temperature_2m: '°F', dewpoint_temperature_2m: '°F', wind_speed_10m: 'mph', total_precipitation_1hr: 'in', total_cloud_cover: '%' };
const WN_LABELS = { temperature_2m: 'Air temp', dewpoint_temperature_2m: 'Dew point', wind_speed_10m: 'Wind', total_precipitation_1hr: 'Precip', total_cloud_cover: 'Clouds' };
const WN_VARS = ['temperature_2m', 'dewpoint_temperature_2m', 'wind_speed_10m', 'total_precipitation_1hr', 'total_cloud_cover'];

function setSky(img) {
  const url = `/weather-fusion/${img}`;
  const show = skyFlip ? opt('sky-a') : opt('sky-b');
  const hide = skyFlip ? opt('sky-b') : opt('sky-a');
  if (!show || !hide) return;
  if (show.dataset.img === img) return;
  const pre = new Image();
  pre.onload = () => {
    show.style.backgroundImage = `url("${url}")`;
    show.dataset.img = img;
    show.classList.add('on');
    hide.classList.remove('on');
    skyFlip = !skyFlip;
  };
  pre.src = url;
}

function pickSky() {
  const h = new Date().getHours();
  if (h < 6 || h >= 20) return 'today-sky-night-v2.webp';
  const cond = (forecast?.current?.condition || '').toLowerCase();
  if (/thunder|storm|tornado/.test(cond)) return 'today-sky-storm.webp';
  if (/rain|shower|drizzle/.test(cond)) return 'today-sky-rain.webp';
  if (/cloud|overcast|fog/.test(cond)) return 'today-sky-clouds.webp';
  return 'today-sky-clear.webp';
}

let latestRequest=0;
async function load() {
  const request=++latestRequest;
  try {
    const [fRes, wnRes, catRes] = await Promise.all([
      fetch(`/api/weather-fusion/forecast?location=${loc}`).then((r) => r.json()),
      fetch(WN_FEED, { cache:'no-store', signal: AbortSignal.timeout(30000) }).then((r) => r.json()).catch(() => null),
      fetch('/weather-fusion/weathernext-catalog.json').then((r) => r.json()).catch(() => null),
    ]);
    if(request!==latestRequest)return;
    forecast = fRes;
    wnFeed = wnRes;
    wnCatalog = catRes;
    el('updated').textContent = `Updated ${new Date(forecast.assembledAt).toLocaleTimeString()}`;
    renderAll();
  } catch (e) {
    if(request!==latestRequest)return;
    const err = opt('error');
    err.hidden = false;
    err.textContent = `Couldn't load: ${e.message}`;
  }
}

function renderAll() {
  setSky(pickSky());
  renderHero();
  renderOverview();
  renderModels();
  renderAILab();
  renderDetails();
  const alerts = forecast.alerts || [];
  if (alerts.length) {
    const strip = el('alert-strip');
    strip.hidden = false;
    strip.textContent = `⚠ ${alerts[0].event} — ${alerts[0].headline || ''}`.slice(0, 160);
  }
}

function renderHero() {
  const c = forecast.current;
  el('now-temp').textContent = Math.round(c.temperature);
  el('now-cond').textContent = c.condition;
  setText('now-feels', `Feels ${Math.round(c.feelsLike || c.apparent || c.temperature)}°`);
  const d0 = forecast.days?.[0];
  if (d0) {
    const hi = finite(d0.high) ? Math.round(d0.high) + '°' : '—';
    el('hero-loc').textContent = forecast.location?.name || 'Knightdale';
  el('now-hilo').textContent = `H ${hi} / L ${Math.round(d0.low)}°`;
  }

  // Insights (best of Glance)
  const insights = [];
  const hrs = forecast.hours?.slice(0, 12) || [];
  const rainHr = hrs.find((h) => (h.pop ?? 0) >= 40);
  if (rainHr) {
    const t = new Date(rainHr.time).toLocaleTimeString('en-US', { hour: 'numeric' });
    insights.push(`🌧 Rain likely by ${t}`);
  } else {
    insights.push('☀ No rain expected next 12h');
  }
  const warm = hrs.reduce((a, b) => (b.temperature > a.temperature ? b : a), hrs[0] || {});
  if (warm?.time) {
    const t = new Date(warm.time).toLocaleTimeString('en-US', { hour: 'numeric' });
    insights.push(`🌡 Warmest at ${t} (${Math.round(warm.temperature)}°)`);
  }
  if (forecast.comfort?.outdoors) insights.push(`🫠 Feels ${Math.round(forecast.comfort.outdoors)}° outside`);
  setHTML('insight-row', insights.map((i) => `<span class="insight-chip">${i}</span>`).join(''));
}

function renderOverview() {
  const hrs = (forecast.hours || []).slice(0, 12);
  // Hourly description
  const hr0 = hrs[0];
  if (hr0) {
    const maxPop = Math.max(...hrs.map((h) => h.pop || 0));
    el('hourly-desc').textContent = maxPop < 20
      ? `Clear conditions expected over the next 12 hours.`
      : `Rain likely — up to ${Math.round(maxPop)}% chance in the next 12 hours.`;
  }
  const nowH = new Date().getHours();
  el('hourly-strip').innerHTML = hrs.map((h) => {
    const t = new Date(h.time);
    const isNow = t.getHours() === nowH && Math.abs(Date.now() - t.getTime()) < 3600000;
    const label = isNow ? 'Now' : t.toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' ', '');
    const wd = h.windDirection ? `<div class="wd">${h.windDirection} ${Math.round(h.windMph || 0)}</div>` : '';
    return `<div class="hour${isNow ? ' now' : ''}"><div class="t">${label}</div><div class="ic">${iconFor(h.condition)}</div><div class="tp">${Math.round(h.temperature)}°</div><div class="pp">${h.pop >= 15 ? Math.round(h.pop) + '%' : ''}</div>${wd}</div>`;
  }).join('');


  // 7-day — Apple-style list
  const days = (forecast.days || []).slice(0, 7);
  const gHi = Math.max(...days.map((d) => d.high).filter(finite));
  const gLo = Math.min(...days.map((d) => d.low).filter(finite));
  if (days[0]) {
    el('daily-desc').textContent = days[0].detail || `High ${Math.round(days[1]?.high || 0)}°, low ${Math.round(days[0].low || 0)}°.`;
  }
  el('day-list').innerHTML = days.map((d, i) => {
    const dt = new Date(d.date + 'T12:00:00');
    const name = i === 0 ? 'Today' : dt.toLocaleDateString('en-US', { weekday: 'short' });
    const hi = finite(d.high) ? d.high : null;
    const hiTxt = hi != null ? Math.round(hi) : '—';
    const loTxt = finite(d.low) ? Math.round(d.low) : '—';
    const l = hi != null && finite(d.low) ? ((d.low - gLo) / Math.max(1, gHi - gLo)) * 100 : 0;
    const w = hi != null && finite(d.low) ? Math.max(10, ((hi - d.low) / Math.max(1, gHi - gLo)) * 100) : 0;
    const pop = (d.pop || 0) >= 20 ? `<div class="pp">💧 ${Math.round(d.pop)}%</div>` : '';
    return `<div><div class="day-row"><div class="d">${name}</div><div class="ic">${iconFor(d.condition)}</div>`
      + `<div class="lo">${loTxt}°</div><div class="bar"><i style="left:${l.toFixed(0)}%;width:${w.toFixed(0)}%"></i></div>`
      + `<div class="hi">${hiTxt}°</div></div>${pop}</div>`;
  }).join('');

  // Metrics — vibrant with icons (fall back to hour 0 for live values)
  const mhrs = forecast.hours || [];
  const h0 = mhrs[0] || {};
  const c = Object.assign({}, h0, forecast.current);
  // Prefer non-null current values, else hour 0
  for (const k of ['wind','windMph','windDirection','humidity','dewpoint','gust','pressure','visibility']) {
    if (c[k] == null && h0[k] != null) c[k] = h0[k];
  }
  const t6 = mhrs[6]?.temperature, t0 = mhrs[0]?.temperature;
  const tTrend = finite(t6) && finite(t0) ? (t6 > t0 + 1 ? ['↗ Rising', 'up'] : t6 < t0 - 1 ? ['↘ Falling', 'down'] : ['→ Steady', 'flat']) : ['', ''];
  const metrics = [
    ['💨 Wind', `${Math.round(c.wind || 0)}<small> mph</small>`, c.gust ? `Gusts ${Math.round(c.gust)}` : (c.windDirection ? windArrow(c.windDirection) : ''), ''],
    ['💧 Humidity', `${Math.round(c.humidity || 0)}<small>%</small>`, `Dew ${Math.round(c.dewpoint || 0)}°`, ''],
    ['🌡 Feels like', `${Math.round(c.feelsLike || c.apparent || c.temperature)}<small>°</small>`, `Air ${Math.round(c.temperature)}°`, ''],
    ['👁 Visibility', `${c.visibility ? Math.round(c.visibility) : '—'}<small> mi</small>`, '', ''],
    ['☀ UV index', `${forecast.uv?.today != null ? Math.round(forecast.uv.today) : '—'}`, forecast.uv?.today >= 6 ? 'High' : forecast.uv?.today >= 3 ? 'Moderate' : 'Low', ''],
    ['🌅 Sunrise', forecast.solar?.sunrise ? new Date(forecast.solar.sunrise).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—', '', ''],
    ['🌇 Sunset', forecast.solar?.sunset ? new Date(forecast.solar.sunset).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—', '', ''],
  ];
  el('metric-grid').innerHTML = metrics.map(([k, v, s]) =>
    `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`
  ).join('');
}

function windArrow(deg) {
  const dirs = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
function iconFor(cond) {
  const c = (cond || '').toLowerCase();
  if (/thunder|storm/.test(c)) return '⛈';
  if (/rain|shower|drizzle/.test(c)) return '🌧';
  if (/snow|sleet|flurr/.test(c)) return '🌨';
  if (/cloud|overcast/.test(c)) return '☁';
  if (/fog|mist|haze/.test(c)) return '🌫';
  if (/clear|sun/.test(c)) return new Date().getHours() >= 6 && new Date().getHours() < 20 ? '☀' : '🌙';
  return '⛅';
}

function renderModels() {
  // Blend weights
  const bp = forecast.blendPolicy?.temperature || { nws: 0.4, hrrr: 0.3, nbm: 0.2, ecmwf: 0.1 };
  el('blend-weights').innerHTML = Object.entries(bp).map(([k, v]) => `<span><b>${k.toUpperCase()}</b> ${Math.round(v * 100)}%</span>`).join('');

  // Chart: blended line + per-model + WN band (best of Blend)
  const hrs = forecastRows(forecast.hours).slice(0, 48);
  if (!hrs.length) return;
  const W = 900, H = 280, PL = 44, PR = 12, PT = 16, PB = 30;
  const allV = hrs.flatMap((h) => [h.temperature, h.temperatureBlend?.value]).filter(finite);
  let lo = Math.min(...allV), hi = Math.max(...allV);
  const pad = (hi - lo) * 0.15 || 2;
  lo -= pad; hi += pad;
  const X = (i) => PL + (i / Math.max(1, hrs.length - 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);

  const models = forecast.modelContributions || [];
  const colors = { nws: '#7fd4ff', hrrr: '#b48cff', nbm: '#6aa8ff', ecmwf: '#ffd479' };
  let paths = '';
  let legend = '';
  for (const m of models.slice(0, 4)) {
    // Per-model temps aren't in hours; use blend as proxy with slight offset for visual
    legend += `<span><i class="sw" style="background:${colors[m.id] || '#fff'};height:3px"></i>${m.id.toUpperCase()}</span>`;
  }
  const line = hrs.map((h, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(h.temperature).toFixed(1)}`).join('');
  // WN band if available
  let wnBand = '';
  if (wnFeed?.sources?.surface) {
    const pts = wnFeed.sources.surface.points.find((p) => p.id === loc);
    const wh = matchingForecastRows(pts?.hourly,hrs.map(h=>h.time));
    const segments=[];let segment=[];
    for(const [i,r] of wh.entries()){
      const low=r?.values?.temperature_2m?.p10,high=r?.values?.temperature_2m?.p90;
      if(finite(low)&&finite(high)&&(!segment.length||Date.parse(hrs[i].time)-Date.parse(hrs[segment.at(-1).i].time)===3600000))segment.push({i,low,high});
      else {if(segment.length)segments.push(segment);segment=finite(low)&&finite(high)?[{i,low,high}]:[];}
    }
    if(segment.length)segments.push(segment);
    wnBand=segments.filter(s=>s.length>1).map(wh=>{
      const conv = (v) => (v - 273.15) * 1.8 + 32;
      const top = wh.map(r => `${X(r.i).toFixed(1)},${Y(conv(r.high)).toFixed(1)}`).join(' ');
      const bot = wh.map(r => `${X(r.i).toFixed(1)},${Y(conv(r.low)).toFixed(1)}`).reverse().join(' ');
      return `<polygon points="${top} ${bot}" fill="rgba(180,140,255,.16)"/>`;
    }).join('');
  }

  el('blend-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Model blend chart">
    ${wnBand}
    <path d="${line}" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
  setHTML('model-legend', legend);

  // Model cards
  el('model-cards').innerHTML = models.slice(0, 4).map((m) => `
    <div class="model-card"><div class="n">${m.id.toUpperCase()}</div><div class="w">${Math.round((bp[m.id] || 0) * 100)}% weight</div>
    <div class="t">${m.temperature ? Math.round(m.temperature) + '°' : '—'}</div><div class="r">${m.runAt ? 'Run ' + new Date(m.runAt).toLocaleTimeString('en-US', { hour: 'numeric' }) : ''}</div></div>
  `).join('');
}

function renderAILab() {
  // Variable picker (simplified from WN page)
  el('wn-var-grid').innerHTML = WN_VARS.map((id) =>
    `<button class="var-btn ${id === wnField ? 'on' : ''}" data-var="${id}">${WN_LABELS[id]}<small>${WN_UNITS[id]}</small></button>`
  ).join('');
  el('wn-var-grid').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    wnField = b.dataset.var;
    renderAILab();
  };

  if (!wnFeed?.sources?.surface) {
    el('wn-chart2').innerHTML = '<p class="fine">WeatherNext feed unavailable.</p>';
    setText('wn-age','No published forecast is available.');
    return;
  }
  const pts = wnFeed.sources.surface.points.find((p) => p.id === loc);
  const rows = forecastRows(pts?.hourly).slice(0, 168);
  if (!rows.length) {
    el('wn-chart2').innerHTML = '<p class="fine">No current or upcoming WeatherNext forecast hours in this run.</p>';
    setText('wn-age','The published forecast has ended. A newer run is needed.');
    return;
  }

  const conv = { temperature_2m: (v) => (v - 273.15) * 1.8 + 32, dewpoint_temperature_2m: (v) => (v - 273.15) * 1.8 + 32, wind_speed_10m: (v) => v * 2.237, total_precipitation_1hr: (v) => v * 39.37, total_cloud_cover: (v) => v * 100 }[wnField];
  const data = rows.map((r) => ({
    t: Date.parse(r.time),
    mean: conv(r.values?.[wnField]?.mean),
    p10: conv(r.values?.[wnField]?.p10),
    p90: conv(r.values?.[wnField]?.p90),
  })).filter((d) => finite(d.mean));

  const W = 900, H = 260, PL = 44, PR = 12, PT = 16, PB = 30;
  const allV = data.flatMap((d) => [d.p10, d.p90]).filter(finite);
  let lo = Math.min(...allV), hi = Math.max(...allV);
  const pad = (hi - lo) * 0.15 || 1;
  lo -= pad; hi += pad;
  const X = (i) => PL + (i / Math.max(1, data.length - 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);

  const band = data.map((d, i) => `${X(i).toFixed(1)},${Y(d.p90).toFixed(1)}`).join(' ') + ' ' +
    data.map((d, i) => `${X(i).toFixed(1)},${Y(d.p10).toFixed(1)}`).reverse().join(' ');
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d.mean).toFixed(1)}`).join('');

  setText('wn-chart-title', `${WN_LABELS[wnField]} · next ${rows.length} available model hours`);
  el('wn-chart2').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="WeatherNext ${wnField}">
    <defs><linearGradient id="uw-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#b48cff" stop-opacity=".3"/><stop offset="100%" stop-color="#b48cff" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${band}" fill="rgba(180,140,255,.18)"/>
    <polygon points="${data.map((d, i) => `${X(i).toFixed(1)},${Y(d.mean).toFixed(1)}`).join(' ')} ${X(data.length - 1).toFixed(1)},${(H - PB).toFixed(1)} ${X(0).toFixed(1)},${(H - PB).toFixed(1)}" fill="url(#uw-fill)"/>
    <path d="${line}" fill="none" stroke="#b48cff" stroke-width="2.5" stroke-linejoin="round"/>
  </svg>`;

  const age = (Date.now() - Date.parse(wnFeed.sources.surface.runAt)) / 86400000;
  setText('wn-age', age > 1 ? `⚠ Model run ${Math.round(age)} days ago — data may be stale.` : 'Fresh model run.');
}

function renderDetails() {
  const c = forecast.current;
  const details = [
    ['Feels like', `${Math.round(c.feelsLike || c.apparent || c.temperature)}°`],
    ['Dew point', `${Math.round(c.dewpoint || 0)}°`],
    ['Humidity', `${Math.round(c.humidity || 0)}%`],
    ['Wind', `${Math.round(c.wind || 0)} mph ${c.windDirection || ''}`],
    ['Gusts', `${c.gust ? Math.round(c.gust) + ' mph' : '—'}`],
    ['Pressure', `${c.pressure ? c.pressure.toFixed(2) + ' in' : '—'}`],
    ['Visibility', `${c.visibility ? Math.round(c.visibility) + ' mi' : '—'}`],
    ['Cloud cover', `${c.cloudCover ? Math.round(c.cloudCover) + '%' : '—'}`],
    ['UV index', forecast.uv?.index ?? '—'],
    ['Sunrise', forecast.solar?.sunrise ? new Date(forecast.solar.sunrise).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'],
    ['Sunset', forecast.solar?.sunset ? new Date(forecast.solar.sunset).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'],
    ['Air quality', forecast.aqi?.index ?? '—'],
  ];
  el('detail-list').innerHTML = details.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  const comf = forecast.comfort;
  el('comfort-box').innerHTML = comf
    ? `It feels like <b>${Math.round(comf.outdoors)}°</b> outside${comf.shade ? ` and <b>${Math.round(comf.shade)}°</b> in the shade` : ''}. ${comf.note || ''}`
    : 'Comfort data unavailable.';

  const disc = forecast.discussion;
  el('discussion').textContent = disc?.text || 'No forecaster discussion available.';
}

// Tabs
document.querySelector('.tab-bar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('.tab-bar button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
});

el('loc-select').addEventListener('change', (e) => {
  loc = e.target.value;
  load();
});

el('loc-select').value=loc;
load();
if(typeof window!=='undefined')installForecastRefresh(load);
