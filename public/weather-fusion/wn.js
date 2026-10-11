/** WeatherNext AI explorer — everything Google WeatherNext forecasts, in the cinematic layout. */
import { convert, format, value, rowsFor, localDate, timeLabel, direction } from './weathernext-data.js';

const FEED_URL = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext-full.json';
const SKY_IMG = { clear: 'today-sky-clear.webp', clouds: 'today-sky-clouds.webp', rain: 'today-sky-rain.webp', night: 'today-sky-night-v2.webp' };

const el = (id) => document.getElementById(id);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/* Field metadata: unit, kind for conversion, category */
const CATS = [
  ['Temperature', ['temperature_2m', 'dewpoint_temperature_2m', 'station_head_temperature_2m', 'station_head_dewpoint_temperature_2m']],
  ['Wind', ['wind_speed_10m', 'u_component_of_wind_10m', 'v_component_of_wind_10m', 'wind_speed_100m', 'u_component_of_wind_100m', 'v_component_of_wind_100m']],
  ['Precipitation', ['total_precipitation_1hr', 'imerg_tp_1hr', 'experimental_tp_1hr']],
  ['Clouds', ['total_cloud_cover', 'high_cloud_cover', 'medium_cloud_cover', 'low_cloud_cover']],
  ['Solar', ['surface_solar_radiation_downwards_1hr', 'total_sky_direct_solar_radiation_at_surface_1hr']],
  ['Pressure', ['mean_sea_level_pressure', 'sea_surface_temperature']],
];
const UNITS = {
  temperature_2m: '°F', dewpoint_temperature_2m: '°F', station_head_temperature_2m: '°F', station_head_dewpoint_temperature_2m: '°F',
  wind_speed_10m: 'mph', u_component_of_wind_10m: 'mph', v_component_of_wind_10m: 'mph',
  wind_speed_100m: 'mph', u_component_of_wind_100m: 'mph', v_component_of_wind_100m: 'mph',
  total_precipitation_1hr: 'in', imerg_tp_1hr: 'in', experimental_tp_1hr: 'in',
  total_cloud_cover: '%', high_cloud_cover: '%', medium_cloud_cover: '%', low_cloud_cover: '%',
  surface_solar_radiation_downwards_1hr: 'W/m²', total_sky_direct_solar_radiation_at_surface_1hr: 'W/m²',
  mean_sea_level_pressure: 'hPa', sea_surface_temperature: '°F',
};
const SHORT = {
  temperature_2m: 'Air temp', dewpoint_temperature_2m: 'Dew point',
  station_head_temperature_2m: 'Station temp', station_head_dewpoint_temperature_2m: 'Station dew point',
  wind_speed_10m: 'Wind 10m', u_component_of_wind_10m: 'Eastward 10m', v_component_of_wind_10m: 'Northward 10m',
  wind_speed_100m: 'Wind 100m', u_component_of_wind_100m: 'Eastward 100m', v_component_of_wind_100m: 'Northward 100m',
  total_precipitation_1hr: 'Precip', imerg_tp_1hr: 'IMERG precip', experimental_tp_1hr: 'Sat-radar precip',
  total_cloud_cover: 'Cloud total', high_cloud_cover: 'Cloud high', medium_cloud_cover: 'Cloud mid', low_cloud_cover: 'Cloud low',
  surface_solar_radiation_downwards_1hr: 'Solar total', total_sky_direct_solar_radiation_at_surface_1hr: 'Solar direct',
  mean_sea_level_pressure: 'Pressure', sea_surface_temperature: 'Sea temp',
};

let feed = null, catalog = null;
let state = { point: 'knightdale', field: 'temperature_2m', cat: 'Temperature', range: 168 };
let skyFlip = false;

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

function pickSky(rows) {
  const h = new Date().getHours();
  if (h < 6 || h >= 20) return SKY_IMG.night;
  const cloud = value(rows[0], { id: 'total_cloud_cover', kind: 'fraction' }, 'mean') ?? 0;
  const rain = value(rows[0], { id: 'total_precipitation_1hr', kind: 'rain' }, 'mean') ?? 0;
  if (rain > 0.02) return SKY_IMG.rain;
  if (cloud > 55) return SKY_IMG.clouds;
  return SKY_IMG.clear;
}

async function load() {
  try {
    const [catRes, feedRes] = await Promise.all([
      fetch('/weather-fusion/weathernext-catalog.json').then((r) => r.json()),
      fetch(FEED_URL, { signal: AbortSignal.timeout(30000) }).then((r) => r.json()),
    ]);
    catalog = catRes;
    if (feedRes?.schema !== 'weather-nourie-weathernext-site-v1' || !feedRes?.sources?.surface) {
      throw new Error('WeatherNext feed not published yet.');
    }
    feed = feedRes;
    init();
  } catch (e) {
    const err = el('error');
    err.hidden = false;
    err.textContent = `Couldn't load WeatherNext data: ${e.message}`;
  }
}

function points() {
  return feed.sources.surface.points || [];
}

function currentRows() {
  const rows = rowsFor(feed, 'surface', state.point);
  // Show all available hours; the feed may be from a past model run
  return rows;
}

function feedAge() {
  const runAt = Date.parse(feed?.sources?.surface?.runAt);
  if (!Number.isFinite(runAt)) return null;
  const days = (Date.now() - runAt) / 86400000;
  return days;
}

function fieldDef() {
  return catalog.fields.find((f) => f.id === state.field);
}

function fmt(v) {
  const f = fieldDef();
  if (!finite(v)) return '—';
  const u = UNITS[state.field];
  if (u === 'in') return v > 0 && v < 0.005 ? '<0.01' : v.toFixed(2);
  if (u === 'hPa') return v.toFixed(1);
  if (u === 'W/m²') return Math.round(v).toString();
  if (u === '%') return Math.round(v).toString();
  return String(Math.round(v));
}

function init() {
  // Locations
  const sel = el('loc-select');
  sel.innerHTML = points().map((p) => `<option value="${p.id}">${p.label || p.id}</option>`).join('');
  if (!points().some((p) => p.id === state.point)) state.point = points()[0]?.id;
  sel.value = state.point;
  sel.addEventListener('change', () => { state.point = sel.value; render(); });

  // Run info
  const runAt = feed.sources.surface.runAt;
  el('run-info').textContent = runAt ? `Model run ${timeLabel(runAt)}` : '';

  // Categories
  renderCats();
  // Range tabs
  el('range-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.range = +b.dataset.range;
    [...el('range-tabs').children].forEach((x) => x.classList.toggle('on', x === b));
    render();
  });

  el('about-text').textContent =
    'WeatherNext is Google\'s AI weather model. This page shows its full surface forecast: 21 variables, 360 hourly steps (15 days), each with 6 ensemble statistics (mean and P10–P90 percentiles). The shaded band on the chart is the model\'s own uncertainty — wider band, less certain. Station-head fields are tuned against surface observations.';

  render();
}

function renderCats() {
  const tabs = el('cat-tabs');
  tabs.innerHTML = CATS.map(([name]) => `<button role="tab" class="${name === state.cat ? 'on' : ''}" data-cat="${name}">${name}</button>`).join('');
  tabs.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.cat = b.dataset.cat;
    const first = CATS.find(([n]) => n === state.cat)[1][0];
    state.field = first;
    renderCats();
    renderVars();
    render();
  };
  renderVars();
}

function renderVars() {
  const ids = CATS.find(([n]) => n === state.cat)[1];
  el('var-count').textContent = `· ${ids.length} of 21`;
  el('var-grid').innerHTML = ids.map((id) => {
    const f = catalog.fields.find((x) => x.id === id);
    return `<button class="var-btn ${id === state.field ? 'on' : ''}" data-var="${id}">${SHORT[id] || f?.label || id}<small>${UNITS[id] || ''}</small></button>`;
  }).join('');
  el('var-grid').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.field = b.dataset.var;
    renderVars();
    render();
  };
}

function series(rows) {
  const f = fieldDef();
  return rows.map((r) => ({
    t: Date.parse(r.time),
    mean: value(r, f, 'mean'),
    p10: value(r, f, 'p10'), p25: value(r, f, 'p25'),
    p50: value(r, f, 'p50'), p75: value(r, f, 'p75'), p90: value(r, f, 'p90'),
  }));
}

function render() {
  const rows = currentRows().slice(0, 360);
  if (!rows.length) return;
  setSky(pickSky(rows));

  const f = fieldDef();
  const s = series(rows);
  const unit = UNITS[state.field];
  const age = feedAge();

  // Hero
  el('hero-var-name').textContent = f?.label || SHORT[state.field];
  el('hero-var-unit').textContent = unit;
  el('hero-value').textContent = fmt(s[0]?.mean) + (unit === '°F' ? '°' : '');
  const p10 = s[0]?.p10, p90 = s[0]?.p90;
  el('hero-range').textContent = finite(p10) && finite(p90) ? `Likely range ${fmt(p10)}–${fmt(p90)} ${unit}` : '';
  const ageTxt = age !== null && age > 1 ? ` · ⚠ model run ${Math.round(age)}d ago` : '';
  el('hero-meta').textContent = `${rows.length} hourly steps · ensemble of 6${ageTxt}`;
  if (age !== null && age > 2) {
    el('hero-meta').style.color = '#ffcf8a';
  }

  // Chart
  renderChart(s);

  // Stats
  const means = s.map((x) => x.mean).filter(finite);
  const spreads = s.map((x) => (finite(x.p90) && finite(x.p10) ? x.p90 - x.p10 : null)).filter(finite);
  const tiles = [
    ['Now', fmt(s[0]?.mean) + (unit === '°F' ? '°' : ''), unit],
    ['15-day high', fmt(Math.max(...means)), unit],
    ['15-day low', fmt(Math.min(...means)), unit],
    ['Avg uncertainty', spreads.length ? '±' + fmt(spreads.reduce((a, b) => a + b, 0) / spreads.length / 2) : '—', unit + ' spread'],
  ];
  el('stat-tiles').innerHTML = tiles.map(([k, v, u]) => `<div class="stat-tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${u}</div></div>`).join('');

  // Daily
  renderDaily(rows);

  // Table
  renderTable(s.slice(0, 72));
}

function renderChart(s) {
  const data = s.slice(0, state.range);
  const W = 900, H = 300, PL = 46, PR = 14, PT = 18, PB = 34;
  const all = data.flatMap((d) => [d.p10, d.p90, d.mean]).filter(finite);
  if (!all.length) { el('chart').innerHTML = '<p style="color:var(--ink-faint)">No data for this range.</p>'; return; }
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;

  const X = (i) => PL + (i / Math.max(1, data.length - 1)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const f = fieldDef();
  el('chart-title').textContent = `${SHORT[state.field] || f?.label} · ${state.range === 48 ? '48 hours' : state.range === 168 ? '7 days' : '15 days'}`;

  const line = (key) => data.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(d[key] ?? d.mean).toFixed(1)}`).join('');
  const areaUnder = data.map((d, i) => `${X(i).toFixed(1)},${Y(d.mean).toFixed(1)}`).join(' ') + ` ${X(data.length - 1).toFixed(1)},${(H - PB).toFixed(1)} ${X(0).toFixed(1)},${(H - PB).toFixed(1)}`;
  const band = (k1, k2) => {
    const top = data.map((d, i) => `${X(i).toFixed(1)},${Y(d[k1] ?? d.mean).toFixed(1)}`).join(' ');
    const bot = data.map((d, i) => `${X(i).toFixed(1)},${Y(d[k2] ?? d.mean).toFixed(1)}`).reverse().join(' ');
    return `${top} ${bot}`;
  };

  // X labels: every Nth day
  const step = state.range <= 48 ? 12 : state.range <= 168 ? 24 : 48;
  let labels = '';
  for (let i = 0; i < data.length; i += step) {
    const d = new Date(data[i].t);
    const txt = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
    labels += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#93a1bb">${txt}</text>`;
  }
  // Y labels
  for (let g = 0; g <= 4; g++) {
    const v = lo + ((hi - lo) * g) / 4;
    labels += `<text x="${PL - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="#93a1bb">${fmt(v)}</text>`;
    labels += `<line x1="${PL}" y1="${Y(v)}" x2="${W - PR}" y2="${Y(v)}" stroke="rgba(255,255,255,.07)"/>`;
  }

  el('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${f?.label} forecast chart">
    <defs>
      <linearGradient id="wn-mean-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7fd4ff" stop-opacity=".35"/>
        <stop offset="100%" stop-color="#7fd4ff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="wn-mean-line" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#7fd4ff"/>
        <stop offset="50%" stop-color="#b48cff"/>
        <stop offset="100%" stop-color="#7fd4ff"/>
      </linearGradient>
    </defs>
    <polygon points="${band('p90', 'p10')}" fill="rgba(127,212,255,.14)"/>
    <polygon points="${band('p75', 'p25')}" fill="rgba(127,212,255,.22)"/>
    <polygon points="${areaUnder}" fill="url(#wn-mean-fill)"/>
    <path d="${line('mean')}" fill="none" stroke="url(#wn-mean-line)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${labels}
  </svg>`;
}

function renderDaily(rows) {
  const zone = 'America/New_York';
  const groups = new Map();
  for (const r of rows) {
    const k = localDate(Date.parse(r.time), zone);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const f = fieldDef();
  const unit = UNITS[state.field];
  const allV = rows.map((r) => value(r, f, 'mean')).filter(finite);
  const gmn = Math.min(...allV), gmx = Math.max(...allV);
  const cards = [...groups].slice(0, 15).map(([date, hrs]) => {
    const vals = hrs.map((r) => value(r, f, 'mean')).filter(finite);
    if (!vals.length) return '';
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const d = new Date(date + 'T12:00:00');
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
    const l = gmx > gmn ? ((mn - gmn) / (gmx - gmn)) * 100 : 0;
    const w = gmx > gmn ? Math.max(6, ((mx - mn) / (gmx - gmn)) * 100) : 100;
    // Sparkline
    const sw = 100, sh = 28;
    const pts = hrs.map((r, i) => {
      const v = value(r, f, 'mean');
      const x = (i / Math.max(1, hrs.length - 1)) * sw;
      const y = gmx > gmn ? sh - ((v - gmn) / (gmx - gmn)) * sh : sh / 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const precip = state.field.includes('precipitation')
      ? hrs.reduce((a, r) => a + (value(r, f, 'mean') || 0), 0) : null;
    return `<div class="day-card"><div class="d">${label}</div><svg class="spark" viewBox="0 0 ${sw} ${sh}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="#7fd4ff" stroke-width="2" stroke-linecap="round"/></svg><div class="r">${fmt(mx)}<small> / ${fmt(mn)}°</small></div><div class="bar"><i style="left:${l}%;width:${w}%"></i></div><div class="p">${precip !== null ? fmt(precip) + ' ' + unit + ' total' : unit}</div></div>`;
  }).join('');
  el('day-cards').innerHTML = cards;
}

function renderTable(s) {
  el('hourly-sub').textContent = `· next ${s.length}h`;
  el('hourly-body').innerHTML = s.map((d) => {
    const t = new Date(d.t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', timeZone: 'America/New_York' });
    return `<tr><td>${t}</td><td>${fmt(d.mean)}</td><td>${fmt(d.p10)}</td><td>${fmt(d.p25)}</td><td>${fmt(d.p50)}</td><td>${fmt(d.p75)}</td><td>${fmt(d.p90)}</td></tr>`;
  }).join('');
}

load();
