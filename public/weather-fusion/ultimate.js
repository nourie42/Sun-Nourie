/** Ultimate Weather — the best of every page, together. */
const el = (id) => document.getElementById(id);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const WN_FEED = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext-full.json';

let forecast = null, wnFeed = null, wnCatalog = null;
let loc = 'knightdale';
let wnField = 'temperature_2m';
let skyFlip = false;

const WN_UNITS = { temperature_2m: '°F', dewpoint_temperature_2m: '°F', wind_speed_10m: 'mph', total_precipitation_1hr: 'in', total_cloud_cover: '%' };
const WN_LABELS = { temperature_2m: 'Air temp', dewpoint_temperature_2m: 'Dew point', wind_speed_10m: 'Wind', total_precipitation_1hr: 'Precip', total_cloud_cover: 'Clouds' };
const WN_VARS = ['temperature_2m', 'dewpoint_temperature_2m', 'wind_speed_10m', 'total_precipitation_1hr', 'total_cloud_cover'];

function setSky(img) {
  const url = `/weather-fusion/${img}`;
  const show = skyFlip ? el('sky-a') : el('sky-b');
  const hide = skyFlip ? el('sky-b') : el('sky-a');
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

async function load() {
  try {
    const [fRes, wnRes, catRes] = await Promise.all([
      fetch(`/api/weather-fusion/forecast?location=${loc}`).then((r) => r.json()),
      fetch(WN_FEED, { signal: AbortSignal.timeout(30000) }).then((r) => r.json()).catch(() => null),
      fetch('/weather-fusion/weathernext-catalog.json').then((r) => r.json()).catch(() => null),
    ]);
    forecast = fRes;
    wnFeed = wnRes;
    wnCatalog = catRes;
    el('updated').textContent = `Updated ${new Date(forecast.assembledAt).toLocaleTimeString()}`;
    renderAll();
  } catch (e) {
    const err = el('error');
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
  el('now-feels').textContent = `Feels ${Math.round(c.feelsLike || c.apparent || c.temperature)}°`;
  const d0 = forecast.days?.[0];
  if (d0) el('now-hilo').textContent = `H ${Math.round(d0.high)}° / L ${Math.round(d0.low)}°`;

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
  el('insight-row').innerHTML = insights.map((i) => `<span class="insight-chip">${i}</span>`).join('');
}

function renderOverview() {
  // Hourly strip — rich
  const hrs = (forecast.hours || []).slice(0, 24);
  const nowH = new Date().getHours();
  el('hourly-strip').innerHTML = hrs.map((h) => {
    const t = new Date(h.time);
    const isNow = t.getHours() === nowH && Math.abs(Date.now() - t.getTime()) < 3600000;
    const label = isNow ? 'Now' : t.toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' ', '');
    const wd = h.windDirection ? `<div class="wd">${windArrow(h.windDirection)} ${Math.round(h.wind || 0)}</div>` : '';
    return `<div class="hour${isNow ? ' now' : ''}"><div class="t">${label}</div><div class="ic">${iconFor(h.condition)}</div><div class="tp">${Math.round(h.temperature)}°</div><div class="pp">${h.pop >= 15 ? Math.round(h.pop) + '%' : ''}</div>${wd}</div>`;
  }).join('');

  // Precipitation chart
  const maxPop = Math.max(...hrs.map((h) => h.pop || 0), 1);
  el('precip-chart').innerHTML = hrs.map((h) => {
    const pct = Math.round(h.pop || 0);
    const ht = Math.max(4, (pct / 100) * 100);
    const t = new Date(h.time).toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' ', '');
    return `<div class="precip-bar" style="height:${ht}%" title="${t}: ${pct}%"><span>${pct}%</span></div>`;
  }).join('');

  // 7-day — rich cards
  const days = (forecast.days || []).slice(0, 7);
  const gHi = Math.max(...days.map((d) => d.high));
  const gLo = Math.min(...days.map((d) => d.low));
  el('day-cards').innerHTML = days.map((d, i) => {
    const dt = new Date(d.date + 'T12:00:00');
    const name = i === 0 ? 'Today' : dt.toLocaleDateString('en-US', { weekday: 'short' });
    const l = ((d.low - gLo) / Math.max(1, gHi - gLo)) * 100;
    const w = Math.max(8, ((d.high - d.low) / Math.max(1, gHi - gLo)) * 100);
    return `<div class="day-card"><div class="d">${name}</div><div class="ic">${iconFor(d.condition)}</div>
      <div class="temps"><span class="hi">${Math.round(d.high)}°</span><span class="lo">${Math.round(d.low)}°</span></div>
      <div class="bar"><i style="left:${l.toFixed(1)}%;width:${w.toFixed(1)}%"></i></div>
      <div class="pp">${d.pop >= 15 ? '💧 ' + Math.round(d.pop) + '%' : '&nbsp;'}</div>
      <div class="wind">${d.wind ? windArrow(d.windDirection || 0) + ' ' + Math.round(d.wind) + ' mph' : ''}</div></div>`;
  }).join('');

  // Metrics — vibrant with icons
  const c = forecast.current;
  const mhrs = forecast.hours || [];
  const t6 = mhrs[6]?.temperature, t0 = mhrs[0]?.temperature;
  const tTrend = finite(t6) && finite(t0) ? (t6 > t0 + 1 ? ['↗ Rising', 'up'] : t6 < t0 - 1 ? ['↘ Falling', 'down'] : ['→ Steady', 'flat']) : ['', ''];
  const metrics = [
    ['💨 Wind', `${Math.round(c.wind || 0)}<small> mph</small>`, c.gust ? `Gusts ${Math.round(c.gust)}` : (c.windDirection ? windArrow(c.windDirection) : ''), ''],
    ['💧 Humidity', `${Math.round(c.humidity || 0)}<small>%</small>`, `Dew ${Math.round(c.dewpoint || 0)}°`, ''],
    ['🌡 Feels like', `${Math.round(c.feelsLike || c.apparent || c.temperature)}<small>°</small>`, `Air ${Math.round(c.temperature)}°`, ''],
    ['📊 Pressure', `${c.pressure ? c.pressure.toFixed(2) : '—'}<small> in</small>`, c.pressureTrend?.direction || '', ''],
    ['👁 Visibility', `${c.visibility ? Math.round(c.visibility) : '—'}<small> mi</small>`, '', ''],
    ['☀ UV index', `${forecast.uv?.index ?? '—'}`, forecast.uv?.label || '', ''],
    ['🌅 Sunrise', forecast.solar?.sunrise ? new Date(forecast.solar.sunrise).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—', '', ''],
    ['🌇 Sunset', forecast.solar?.sunset ? new Date(forecast.solar.sunset).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—', '', ''],
  ];
  el('metric-grid').innerHTML = metrics.map(([k, v, s, t]) =>
    `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}${tTrend[0] && k.includes('Feels') ? `<div class="trend ${tTrend[1]}">${tTrend[0]}</div>` : ''}</div>`
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
  const hrs = (forecast.hours || []).slice(0, 48);
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
    const wh = (pts?.hourly || []).slice(0, 48);
    if (wh.length) {
      const conv = (v) => (v - 273.15) * 1.8 + 32;
      const top = wh.map((r, i) => `${X(i).toFixed(1)},${Y(conv(r.values?.temperature_2m?.p90 ?? 0)).toFixed(1)}`).join(' ');
      const bot = wh.map((r, i) => `${X(i).toFixed(1)},${Y(conv(r.values?.temperature_2m?.p10 ?? 0)).toFixed(1)}`).reverse().join(' ');
      wnBand = `<polygon points="${top} ${bot}" fill="rgba(180,140,255,.16)"/>`;
    }
  }

  el('blend-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Model blend chart">
    ${wnBand}
    <path d="${line}" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
  el('model-legend').innerHTML = legend;

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
    el('wn-chart').innerHTML = '<p class="fine">WeatherNext feed unavailable.</p>';
    return;
  }
  const pts = wnFeed.sources.surface.points.find((p) => p.id === loc);
  const rows = (pts?.hourly || []).slice(0, 168);
  if (!rows.length) return;

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

  el('wn-chart-title').textContent = `${WN_LABELS[wnField]} · 7-day AI forecast`;
  el('wn-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="WeatherNext ${wnField}">
    <defs><linearGradient id="uw-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#b48cff" stop-opacity=".3"/><stop offset="100%" stop-color="#b48cff" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${band}" fill="rgba(180,140,255,.18)"/>
    <polygon points="${data.map((d, i) => `${X(i).toFixed(1)},${Y(d.mean).toFixed(1)}`).join(' ')} ${X(data.length - 1).toFixed(1)},${(H - PB).toFixed(1)} ${X(0).toFixed(1)},${(H - PB).toFixed(1)}" fill="url(#uw-fill)"/>
    <path d="${line}" fill="none" stroke="#b48cff" stroke-width="2.5" stroke-linejoin="round"/>
  </svg>`;

  const age = (Date.now() - Date.parse(wnFeed.sources.surface.runAt)) / 86400000;
  el('wn-age').textContent = age > 1 ? `⚠ Model run ${Math.round(age)} days ago — data may be stale.` : 'Fresh model run.';
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

load();
