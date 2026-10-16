/*
 * Nourie Home: a phone-first dashboard for Home Assistant.
 *
 * Load it as a dashboard resource and add `type: custom:nourie-home-card` to a
 * panel view, or register it as a full-screen sidebar panel with panel_custom
 * (name: nourie-home-panel). It finds people, air sensors, Emporia circuits,
 * Flume, robot vacuums and thermostats on its own; home-assistant/README.md
 * lists the options that pin specific entities.
 */

export const VERSION = '2.0.0';

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Figtree:wght@400;500;600;700&display=swap';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const STORE = 'nourie-home:';

// CARTO's free tiles need a key since August 2026, so the default map uses Esri's keyless dark canvas.
export function tileLayers(map = {}) {
  if (map.tile_url) return [{ url: map.tile_url, options: { attribution: map.attribution || OSM_CREDIT, maxZoom: 19 } }];
  if (map.carto_key) {
    return [{
      url: `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(map.carto_key)}`,
      options: { attribution: `${OSM_CREDIT} &copy; <a href="https://carto.com/attributions">CARTO</a>`, maxZoom: 19 },
    }];
  }
  const esri = { attribution: `Tiles &copy; Esri &mdash; Esri, HERE, Garmin, ${OSM_CREDIT}`, maxNativeZoom: 16, maxZoom: 19 };
  return [
    { url: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, options: esri },
    { url: `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, options: { maxNativeZoom: 16, maxZoom: 19, className: 'nh-labels' } },
  ];
}

// ------------------------------------------------------------------ helpers

const OFFLINE = new Set(['unavailable', 'unknown']);
const TONES = {
  cyan: '#4de3ff', amber: '#ffb547', water: '#4aa8ff', violet: '#b197ff', mint: '#44e6b0',
  good: '#43e08e', lime: '#a6e35a', fair: '#ffd65c', poor: '#ff9447', bad: '#ff5470', dim: '#93abc4',
};
const LEVEL_TONES = ['good', 'lime', 'fair', 'poor', 'bad'];
const LEVEL_LABELS = ['Excellent', 'Good', 'Fair', 'Poor', 'Unhealthy'];
const PERSON_COLORS = ['#b197ff', '#4de3ff', '#ff7ab6', '#a6e35a', '#ffb547', '#5ad1c8', '#ff8f6b'];

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function toNum(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const live = (st) => !!st && !OFFLINE.has(st.state);
const domainOf = (id) => String(id).split('.')[0];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const titleCase = (s) => String(s || '').replace(/(^|[\s_/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

const humanize = (s) => {
  const text = String(s || '').replace(/_/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
};

export function cleanName(name) {
  return String(name || '').replace(/^\d(?=[A-Z])/, '').replace(/\s+/g, ' ').trim();
}

export function fmt(value, digits = 0) {
  const n = toNum(value);
  if (n === null) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function since(when, now = Date.now()) {
  const t = typeof when === 'number' ? when : Date.parse(when);
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} hr`;
  return `${Math.round(hr / 24)} days`;
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

export function fmtDistance(km, metric) {
  if (km === null || km === undefined) return '';
  const d = metric ? km : km * 0.621371;
  if (d < 0.1) return 'nearby';
  return `${d < 10 ? d.toFixed(1) : Math.round(d).toLocaleString()} ${metric ? 'km' : 'mi'}`;
}

export function powerParts(watts) {
  if (watts === null || watts === undefined) return { v: '—', u: '' };
  if (Math.abs(watts) < 1000) return { v: String(Math.round(watts)), u: 'W' };
  const kw = watts / 1000;
  return { v: kw.toFixed(Math.abs(kw) >= 10 ? 1 : 2), u: 'kW' };
}

function toWatts(st) {
  const v = toNum(st?.state);
  if (v === null) return null;
  const unit = String(st.attributes.unit_of_measurement || 'W').toLowerCase();
  return unit === 'kw' ? v * 1000 : unit === 'mw' ? v * 1e6 : v;
}

function toKwh(st) {
  const v = toNum(st?.state);
  if (v === null) return null;
  const unit = String(st.attributes.unit_of_measurement || 'kWh').toLowerCase();
  return unit === 'wh' ? v / 1000 : unit === 'mwh' ? v * 1000 : v;
}

function tempUnit(unit) {
  const s = String(unit || '');
  return /f/i.test(s) ? '°F' : /c/i.test(s) ? '°C' : '';
}

function readStore(key) {
  try {
    const raw = globalThis.localStorage?.getItem(STORE + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    globalThis.localStorage?.setItem(STORE + key, JSON.stringify(value));
  } catch {
    // Storage can be blocked (private mode); the dashboard works without it.
  }
}

// Time-weighted average of a step series ([[ms, value], ...]) in n equal buckets.
export function resample(points, start, end, n) {
  const out = new Array(n).fill(null);
  if (!points?.length || end <= start || n < 1) return out;
  const width = (end - start) / n;
  let j = 0;
  for (let b = 0; b < n; b += 1) {
    const b0 = start + b * width;
    const b1 = b0 + width;
    while (j + 1 < points.length && points[j + 1][0] <= b0) j += 1;
    let acc = 0;
    let covered = 0;
    for (let k = j; k < points.length && points[k][0] < b1; k += 1) {
      const s = Math.max(b0, points[k][0]);
      const e = Math.min(b1, k + 1 < points.length ? points[k + 1][0] : end);
      if (e > s) {
        acc += points[k][1] * (e - s);
        covered += e - s;
      }
    }
    if (covered > 0) out[b] = acc / covered;
  }
  return out;
}

export function bucketMax(points, start, end, n) {
  const out = new Array(n).fill(null);
  if (!points?.length || end <= start) return out;
  const width = (end - start) / n;
  for (const [t, v] of points) {
    if (t < start || t >= end) continue;
    const b = Math.min(n - 1, Math.floor((t - start) / width));
    out[b] = out[b] === null ? v : Math.max(out[b], v);
  }
  return out;
}

export function parseHistory(rows) {
  const out = [];
  for (const row of rows || []) {
    const v = toNum(row.s ?? row.state);
    const t = row.lu !== undefined ? row.lu * 1000 : Date.parse(row.last_updated || row.last_changed);
    if (v !== null && Number.isFinite(t)) out.push([t, v]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function sumSeries(list) {
  if (!list.length) return [];
  return list[0].map((_, i) => {
    const vals = list.map((s) => s[i]).filter((v) => v !== null);
    return vals.length ? sum(vals) : null;
  });
}

// ---------------------------------------------------------- billing math

const DAY = 86400000;

function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
}

export function dayString(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(ms, days) {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// A billing cycle runs from its start day up to its next bill day. Once today passes
// the bill day it rolls forward by the same number of days, so the numbers keep up
// on their own until the next time the bill dates are edited.
export function cycleWindow(cycle = {}, now = Date.now()) {
  let start = parseDay(cycle.start);
  let end = parseDay(cycle.end);
  if (start === null) {
    // No dates set yet: the calendar month.
    const d = new Date(now);
    start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  } else if (end === null || end <= start) {
    const d = new Date(start);
    end = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()).getTime();
  }
  const length = Math.max(1, Math.round((end - start) / DAY));
  let rolled = 0;
  while (now >= end && rolled < 120) {
    start = end;
    end = addDays(end, length);
    rolled += 1;
  }
  const elapsedDays = Math.max(0, (now - start) / DAY);
  return {
    start,
    end,
    days: length,
    elapsedDays,
    // Calendar day of the cycle, so a daylight-saving change does not skip or repeat a day.
    day: clamp(Math.round((startOfDay(now) - start) / DAY) + 1, 1, length),
    fraction: clamp((now - start) / (end - start), 0, 1),
    rolled,
    startDay: dayString(start),
    endDay: dayString(end),
  };
}

// Sequential heat for the cost table: one amber hue, stronger as the share of the column's max grows.
export function heatStyle(value, max) {
  const t = max > 0 && value > 0 ? clamp(value / max, 0, 1) : 0;
  const alpha = 0.07 + 0.78 * t ** 0.85;
  return { bg: `rgba(255, 181, 71, ${alpha.toFixed(3)})`, ink: alpha > 0.5 ? '#241405' : '#e9f5ff' };
}

// ---------------------------------------------------------- chart scale

export function niceCeil(value) {
  if (!(value > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (value <= step * mag) return step * mag;
  return 10 * mag;
}

export function compactNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: a < 10 ? 1 : 0 });
}

// ------------------------------------------------------------- air quality

export const AIR_METRICS = {
  pm03: { label: 'PM0.3', unit: '/0.1L', steps: [500, 1000, 2500, 5000], digits: 0 },
  co2: { label: 'CO₂', unit: 'ppm', steps: [600, 1000, 1500, 2000], digits: 0 },
  pm25: { label: 'PM2.5', unit: 'µg/m³', steps: [5, 12, 35.4, 55.4], digits: 1 },
  pm10: { label: 'PM10', unit: 'µg/m³', steps: [20, 54, 154, 254], digits: 0 },
  pm1: { label: 'PM1', unit: 'µg/m³', steps: [5, 12, 35, 55], digits: 1 },
  voc: { label: 'VOC', unit: 'ppb', steps: [250, 500, 1000, 2000], digits: 0 },
  vocug: { label: 'VOC', unit: 'µg/m³', steps: [300, 1000, 2300, 4600], digits: 0 },
  co: { label: 'CO', unit: 'ppm', steps: [2, 9, 35, 70], digits: 1 },
  no2: { label: 'NO₂', unit: 'µg/m³', steps: [25, 50, 100, 200], digits: 0 },
  o3: { label: 'Ozone', unit: 'µg/m³', steps: [50, 100, 160, 240], digits: 0 },
  aqi: { label: 'AQI', unit: '', steps: [25, 50, 100, 150], digits: 0 },
  // Amazon's indoor score runs the other way (100 is best), so it is rated on 100 minus the score.
  iaq: { label: 'Air score', unit: 'of 100', steps: [10, 25, 45, 65], digits: 0, invert: true },
};
const PRIMARY_ORDER = ['pm03', 'pm25', 'iaq', 'aqi', 'pm10', 'pm1', 'voc', 'vocug', 'co', 'no2', 'o3', 'co2'];
// PM0.3 particle counts (Plantower and similar) rarely carry a device class, so they are found by name.
export const PM03_RE = /pm\s*0[.,_]?3(?!\d)|\b0[.,]3\s*(?:µ|u)?m\b|\bpm03\b/i;
const DC_METRIC = {
  carbon_dioxide: 'co2', pm25: 'pm25', pm10: 'pm10', pm1: 'pm1', volatile_organic_compounds: 'vocug',
  volatile_organic_compounds_parts: 'voc', carbon_monoxide: 'co', nitrogen_dioxide: 'no2', ozone: 'o3', aqi: 'aqi',
};
const NAME_METRIC = [
  [/\bco2\b|\bc02\b|carbon dioxide/i, 'co2'],
  [/pm\s?2[._]?5/i, 'pm25'],
  [/pm\s?10/i, 'pm10'],
  [/\bt?voc\b/i, 'voc'],
  [/\baqi\b|air quality index/i, 'aqi'],
];

export function airMetricOf(st) {
  const a = st?.attributes || {};
  if (PM03_RE.test(a.friendly_name || st?.entity_id || '') && (!a.device_class || a.device_class === 'pm1')) return 'pm03';
  if (DC_METRIC[a.device_class]) return DC_METRIC[a.device_class];
  if (a.device_class) return null;
  const unit = String(a.unit_of_measurement || '');
  if (unit && !/ppm|ppb|g\/m|^$/i.test(unit)) return null;
  const name = a.friendly_name || st.entity_id;
  for (const [re, metric] of NAME_METRIC) if (re.test(name)) return metric;
  return null;
}

// Converts a PM0.3 count to particles per 0.1 L (the Plantower /dL convention).
export function pm03PerDl(value, unit) {
  const n = toNum(value);
  if (n === null) return null;
  const u = String(unit || '').toLowerCase().replace(/\s+/g, '');
  if (/cm(3|³)/.test(u)) return n * 100;
  if (/m(3|³)/.test(u)) return n / 10000;
  if (/(dl|0\.1l|100ml)/.test(u)) return n;
  if (/(^|\/|#|pcs|particles?)l$|perl$/.test(u)) return n / 10;
  return n;
}

export function airLevel(metric, value) {
  const def = AIR_METRICS[metric];
  const raw = toNum(value);
  if (!def || raw === null) return null;
  const n = def.invert ? 100 - raw : raw;
  const i = def.steps.findIndex((s) => n <= s);
  return i === -1 ? 4 : i;
}

// 100 at zero, then 90 / 75 / 55 / 35 at each threshold, reaching 0 at twice the last one.
export function airScore(metric, value) {
  const def = AIR_METRICS[metric];
  const raw = toNum(value);
  if (!def || raw === null) return null;
  const n = def.invert ? 100 - raw : raw;
  const xs = [0, ...def.steps, def.steps[3] * 2];
  const ys = [100, 90, 75, 55, 35, 0];
  if (n <= 0) return 100;
  for (let i = 1; i < xs.length; i += 1) {
    if (n <= xs[i]) return Math.round(ys[i - 1] + ((ys[i] - ys[i - 1]) * (n - xs[i - 1])) / (xs[i] - xs[i - 1]));
  }
  return 0;
}

export function scoreLevel(score) {
  if (score === null || score === undefined) return null;
  return score >= 90 ? 0 : score >= 75 ? 1 : score >= 55 ? 2 : score >= 35 ? 3 : 4;
}

// ------------------------------------------------------------ model build

function makeCtx(hass, config) {
  const states = hass.states || {};
  const entities = hass.entities || {};
  const devices = hass.devices || {};
  const areas = hass.areas || {};
  const exclude = new Set(config.exclude || []);
  const entry = (id) => entities[id];
  const device = (id) => devices[entry(id)?.device_id];
  const areaId = (id) => entry(id)?.area_id || device(id)?.area_id || null;
  const unitSystem = hass.config?.unit_system || {};
  const ctx = {
    hass, config, states, entities, devices, areas, entry, device, areaId,
    areaName: (id) => areas[areaId(id)]?.name || '',
    platform: (id) => entry(id)?.platform || '',
    name: (id) => states[id]?.attributes?.friendly_name || entry(id)?.name || String(id).split('.')[1]?.replace(/_/g, ' ') || id,
    deviceName: (id) => { const d = device(id); return d ? d.name_by_user || d.name || '' : ''; },
    hidden: (id) => exclude.has(id) || !!entry(id)?.hidden,
    units: { temp: unitSystem.temperature || '°F', metric: (unitSystem.length || 'mi') === 'km' },
  };
  ctx.list = Object.values(states).filter((st) => !ctx.hidden(st.entity_id));
  const byDomain = {};
  for (const st of ctx.list) (byDomain[domainOf(st.entity_id)] ||= []).push(st);
  ctx.byDomain = (d) => byDomain[d] || [];
  return ctx;
}

export function buildModel(hass, config = {}, ext = {}, now = Date.now()) {
  const ctx = makeCtx(hass, config);
  const prefs = ext.prefs || {};
  const home = homeLocation(ctx);
  const model = {
    now, config, units: ctx.units, user: hass.user || {}, states: ctx.states, home,
    people: buildPeople(ctx, home),
    zones: buildZones(ctx),
    air: buildAir(ctx),
    energy: buildEnergy(ctx),
    water: buildWater(ctx),
    robots: decorateRobots(ctx, buildRobots(ctx), prefs, ext),
    climate: buildClimate(ctx),
    weather: buildWeather(ctx, ext.forecast),
    favorites: buildFavorites(ctx, ext.learned),
    cameras: buildCameras(ctx),
    lists: buildLists(ctx),
    lightsOn: ctx.list.filter((st) => st.state === 'on' && (domainOf(st.entity_id) === 'light' || (domainOf(st.entity_id) === 'switch' && /light|lamp/i.test(ctx.name(st.entity_id))))).length,
    history: ext.history || {},
    prefs,
    isAdmin: !!hass.user?.is_admin,
    notifyTargets: Object.keys(hass.services?.notify || {}).filter((s) => s.startsWith('mobile_app_')).sort(),
  };
  model.score = buildAirScore(ctx, prefs);
  model.spike = buildSpike(ctx, prefs, model.score, ext);
  model.controls = buildControls(ctx, prefs);
  model.health = buildHealth(ctx, prefs);
  model.dust = discoverDust(ctx, prefs);
  model.billing = buildBilling(ctx, prefs, ext.billing, now);
  model.candidates = () => entityCandidates(ctx);
  model.alerts = buildAlerts(ctx, model, now);
  model.offline = buildOffline(ctx, now);
  return model;
}

function homeLocation(ctx) {
  const zone = ctx.states['zone.home'];
  const lat = toNum(zone?.attributes?.latitude ?? ctx.hass.config?.latitude);
  const lon = toNum(zone?.attributes?.longitude ?? ctx.hass.config?.longitude);
  return lat === null || lon === null ? null : { lat, lon, radius: toNum(zone?.attributes?.radius) || 100 };
}

function buildZones(ctx) {
  return ctx.byDomain('zone')
    .map((st) => ({
      id: st.entity_id,
      name: ctx.name(st.entity_id),
      lat: toNum(st.attributes.latitude),
      lon: toNum(st.attributes.longitude),
      radius: toNum(st.attributes.radius) || 100,
      passive: !!st.attributes.passive,
      home: st.entity_id === 'zone.home',
    }))
    .filter((z) => z.lat !== null && z.lon !== null);
}

// People come from person entities, enriched by their Life360 tracker when there is one.
function buildPeople(ctx, home) {
  const configured = Array.isArray(ctx.config.people) ? ctx.config.people.filter((id) => ctx.states[id]) : null;
  // Life360 members come first: each one is its own tracker with place, driving state, speed and photo.
  const life360 = ctx.byDomain('device_tracker').filter((st) => ctx.platform(st.entity_id) === 'life360' || /^device_tracker\.life360_/.test(st.entity_id));
  let list = configured ? configured.map((id) => ctx.states[id]) : life360.length && ctx.config.people_source !== 'person' ? life360 : ctx.byDomain('person');
  if (!list.length) {
    list = ctx.byDomain('device_tracker').filter((st) => toNum(st.attributes.latitude) !== null
      && (ctx.platform(st.entity_id) === 'life360' || st.attributes.source_type === 'gps'));
  }
  const people = list.map((st, i) => personFrom(ctx, st, i, home));
  return configured ? people : people.sort((a, b) => a.name.localeCompare(b.name));
}

function pickTracker(ctx, st) {
  if (st.entity_id.startsWith('device_tracker.')) return st.entity_id;
  const trackers = st.attributes.device_trackers || [];
  return trackers.find((id) => ctx.platform(id) === 'life360' || /life360/i.test(id)) || st.attributes.source || trackers[0] || null;
}

function personFrom(ctx, st, index, home) {
  const a = st.attributes || {};
  const trackerId = pickTracker(ctx, st);
  const tracker = trackerId ? ctx.states[trackerId] : null;
  const t = tracker?.attributes || {};
  const lat = toNum(a.latitude ?? t.latitude);
  const lon = toNum(a.longitude ?? t.longitude);
  const isHome = st.state === 'home';
  const speed = toNum(t.speed);
  let battery = toNum(t.battery_level ?? t.battery ?? a.battery_level);
  if (battery === null && tracker) {
    const deviceId = ctx.entry(trackerId)?.device_id;
    const sensor = deviceId && ctx.byDomain('sensor').find((s) => s.attributes.device_class === 'battery' && ctx.entry(s.entity_id)?.device_id === deviceId);
    if (sensor) battery = toNum(sensor.state);
  }
  const name = cleanName(a.friendly_name || ctx.name(st.entity_id));
  const distKm = home && lat !== null && lon !== null ? distanceKm(home.lat, home.lon, lat, lon) : null;
  return {
    id: st.entity_id,
    tracker: trackerId,
    name,
    first: name.split(' ')[0],
    picture: a.entity_picture || t.entity_picture || '',
    color: PERSON_COLORS[index % PERSON_COLORS.length],
    state: st.state,
    isHome,
    zone: !isHome && !['not_home', 'unknown', 'unavailable'].includes(st.state) ? st.state : '',
    lat,
    lon,
    accuracy: toNum(a.gps_accuracy ?? t.gps_accuracy),
    place: t.place || '',
    address: t.address || '',
    since: t.at_loc_since || st.last_changed,
    seen: t.last_seen || tracker?.last_updated || st.last_updated,
    battery,
    charging: !!(t.battery_charging ?? t.charging),
    driving: !!t.driving || (!isHome && speed !== null && speed > 6),
    speed: speed !== null && speed >= 0 ? speed : null,
    distKm,
    bearing: distKm !== null && distKm > 0.05 ? bearingDeg(home.lat, home.lon, lat, lon) : null,
  };
}

export function personStatus(p, units, short = false) {
  if (p.driving) return p.speed && !short ? `Driving · ${Math.round(p.speed)} ${units.metric ? 'km/h' : 'mph'}` : 'Driving';
  if (p.isHome) return 'Home';
  if (p.zone) return p.zone;
  if (p.place) return p.place;
  if (p.address) return String(p.address).split(',')[0];
  if (p.state === 'not_home') return 'Away';
  return 'Location unknown';
}

const PURIFIER_RE = /purif|winix|ionizer|hepa|air ?clean|levoit|coway|blueair|airmega/i;
const PURIFIER_PLATFORMS = new Set(['winix', 'vesync', 'levoit', 'coway', 'blueair', 'dyson_local', 'philips_airpurifier_coap', 'xiaomi_miio']);

function buildAir(ctx) {
  const explicit = Array.isArray(ctx.config.air_quality) ? ctx.config.air_quality : null;
  const outdoor = (st) => OUTDOOR_AQI_PLATFORMS.has(ctx.platform(st.entity_id)) || /\b(outdoor|outside)\b/i.test(ctx.name(st.entity_id));
  const sensors = explicit
    ? explicit.map((id) => ctx.states[id]).filter(Boolean)
    : ctx.byDomain('sensor').filter((st) => airMetricOf(st) && !outdoor(st));
  const groups = new Map();
  for (const st of sensors) {
    const key = groupKey(ctx, st.entity_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(st);
  }
  const rooms = [];
  for (const [key, list] of groups) {
    const room = buildRoom(ctx, key, list);
    if (room) rooms.push(room);
  }
  rooms.sort((a, b) => a.name.localeCompare(b.name));
  const scored = rooms.filter((r) => r.score !== null);
  const score = scored.length ? Math.round(sum(scored.map((r) => r.score)) / scored.length) : null;
  const worst = rooms.reduce((w, r) => (!w || r.level > w.level || (r.level === w.level && r.score < w.score) ? r : w), null);
  const purifiers = buildPurifiers(ctx);
  return {
    rooms, score, level: scoreLevel(score), worst, purifiers,
    good: rooms.filter((r) => r.level <= 1).length,
    tips: airTips(rooms, purifiers),
  };
}

function groupKey(ctx, id) {
  const e = ctx.entry(id);
  if (e?.device_id) return `d:${e.device_id}`;
  if (e?.area_id) return `a:${e.area_id}`;
  return `n:${String(ctx.name(id)).split(/\s+/)[0].toLowerCase()}`;
}

function buildRoom(ctx, key, list) {
  const rank = (st) => (/\b(raw|internal|chip|mhz-?19)\b/i.test(ctx.name(st.entity_id)) ? 1 : 0);
  const metrics = {};
  for (const st of list.filter(live).sort((a, b) => rank(a) - rank(b))) {
    const base = airMetricOf(st);
    const metric = base === 'aqi' && isAmazonMonitor(ctx, st.entity_id) ? 'iaq' : base;
    const raw = toNum(st.state);
    const value = metric === 'pm03' ? pm03PerDl(raw, st.attributes.unit_of_measurement) : raw;
    if (!metric || metrics[metric] || value === null || (metric === 'co2' && !ctx.config.show_co2)) continue;
    metrics[metric] = { metric, id: st.entity_id, value, level: airLevel(metric, value), score: airScore(metric, value) };
  }
  const keys = Object.keys(metrics);
  if (!keys.length) return null;
  // A device's own "air quality index" often uses its own scale, so it only rates a room on its own.
  const counted = keys.filter((k) => k !== 'aqi' || keys.length === 1);
  const worstKey = counted.reduce((w, k) => (!w || metrics[k].score < metrics[w].score ? k : w), null);
  const first = list[0].entity_id;
  const neighbours = ctx.byDomain('sensor').filter((st) => live(st) && groupKey(ctx, st.entity_id) === key);
  const temps = neighbours.filter((st) => st.attributes.device_class === 'temperature');
  const tempPenalty = (st) => (/\b(internal|chip|mhz-?19|cpu)\b/i.test(ctx.name(st.entity_id)) ? 2 : 0)
    + (tempUnit(st.attributes.unit_of_measurement) === ctx.units.temp ? 0 : 1);
  const temp = temps.sort((a, b) => tempPenalty(a) - tempPenalty(b))[0];
  const hum = neighbours.find((st) => st.attributes.device_class === 'humidity');
  const area = ctx.areaName(first);
  const name = cleanName(ctx.deviceName(first) || area || ctx.name(first).split(' ')[0]);
  return {
    key,
    name,
    sub: area && area.toLowerCase() !== name.toLowerCase() ? area : '',
    areaId: ctx.areaId(first),
    metrics,
    primary: metrics[worstKey].level > metrics[PRIMARY_ORDER.find((k) => metrics[k])].level ? metrics[worstKey] : metrics[PRIMARY_ORDER.find((k) => metrics[k])],
    worst: metrics[worstKey],
    level: Math.max(...counted.map((k) => metrics[k].level)),
    score: Math.min(...counted.map((k) => metrics[k].score)),
    temp: temp ? { id: temp.entity_id, value: toNum(temp.state) } : null,
    hum: hum ? { id: hum.entity_id, value: toNum(hum.state) } : null,
  };
}

function speedSteps(step) {
  if (!step || step >= 100 || step < 10) return [25, 50, 75, 100];
  const n = Math.round(100 / step);
  return Array.from({ length: n }, (_, i) => Math.round(((i + 1) * 100) / n));
}

function buildPurifiers(ctx) {
  const ids = Array.isArray(ctx.config.purifiers)
    ? ctx.config.purifiers
    : ctx.list.filter((st) => {
      const d = domainOf(st.entity_id);
      if (!['fan', 'switch'].includes(d) || ctx.entry(st.entity_id)?.entity_category) return false;
      return PURIFIER_RE.test(ctx.name(st.entity_id)) || (d === 'fan' && PURIFIER_PLATFORMS.has(ctx.platform(st.entity_id)));
    }).map((st) => st.entity_id);
  return ids.map((id) => ctx.states[id]).filter(Boolean).map((st) => {
    const a = st.attributes;
    const isFan = domainOf(st.entity_id) === 'fan';
    const features = toNum(a.supported_features) ?? 0;
    return {
      id: st.entity_id,
      name: cleanName(ctx.name(st.entity_id)),
      area: ctx.areaName(st.entity_id),
      areaId: ctx.areaId(st.entity_id),
      on: st.state === 'on',
      live: live(st),
      pct: toNum(a.percentage),
      speeds: isFan && (features & 1) ? speedSteps(toNum(a.percentage_step)) : [],
      presets: isFan && (features & 8) && Array.isArray(a.preset_modes) ? a.preset_modes : [],
      preset: a.preset_mode || '',
    };
  });
}

function airTips(rooms, purifiers) {
  const tips = [];
  for (const r of rooms) {
    const w = r.worst;
    if (w && w.level >= 2) {
      const def = AIR_METRICS[w.metric];
      const value = `${fmt(w.value, def.digits)} ${def.unit}`.trim();
      const tone = LEVEL_TONES[w.level];
      if (w.metric === 'co2') {
        tips.push({ level: w.level, tone, icon: 'air', text: `Open a window in ${r.name}. CO₂ is ${value}.` });
      } else if (['pm03', 'pm25', 'pm10', 'pm1'].includes(w.metric)) {
        const p = purifiers.find((x) => x.live && !x.on && x.areaId && x.areaId === r.areaId);
        tips.push({
          level: w.level, tone, icon: 'purifier',
          text: `Particles are up in ${r.name} (${def.label} ${value}).${p ? '' : ' Run a purifier.'}`,
          action: p ? { entity: p.id, label: `Turn on ${p.name}` } : null,
        });
      } else if (w.metric === 'co') {
        tips.push({ level: 4, tone: 'bad', icon: 'alert', text: `Carbon monoxide reads ${value} in ${r.name}. Get fresh air and check gas appliances.` });
      } else {
        tips.push({ level: w.level, tone, icon: 'air', text: `${def.label} is ${value} in ${r.name}. Air the room out.` });
      }
    }
    if (r.hum?.value > 60) tips.push({ level: 1, tone: 'water', icon: 'drop', text: `Humidity is ${fmt(r.hum.value)}% in ${r.name}. A dehumidifier would help.` });
    else if (r.hum && r.hum.value !== null && r.hum.value < 30) tips.push({ level: 1, tone: 'fair', icon: 'drop', text: `The air is dry in ${r.name} (${fmt(r.hum.value)}% humidity).` });
  }
  return tips.sort((a, b) => b.level - a.level).slice(0, 4);
}

const MAINS_RE = /^(mains?|total|whole( home| house)?|house|home|panel|grid|vue|emporia( vue)?)$|\bmains\b/i;

function buildEnergy(ctx) {
  const cfg = ctx.config.energy || {};
  const isEmporia = (st) => ctx.platform(st.entity_id) === 'emporia_vue' || /power minute average|power 1 ?min|energy today|energy this month/i.test(ctx.name(st.entity_id));
  const circuits = new Map();
  const circuit = (st) => {
    const raw = ctx.name(st.entity_id).replace(/\s*(power minute average|power 1 ?min|power|energy today|energy this month|energy month|energy)\s*$/i, '').trim();
    const key = raw.toLowerCase() || st.entity_id;
    if (!circuits.has(key)) circuits.set(key, { key, name: titleCase(cleanName(raw)) || 'Circuit', watts: null, today: null, month: null });
    return circuits.get(key);
  };
  for (const st of ctx.byDomain('sensor')) {
    if (!isEmporia(st) && st.entity_id !== cfg.power) continue;
    const dc = st.attributes.device_class;
    const name = ctx.name(st.entity_id);
    if (dc === 'power') Object.assign(circuit(st), { powerId: st.entity_id, watts: live(st) ? toWatts(st) : null });
    else if (dc === 'energy' && /today/i.test(name)) Object.assign(circuit(st), { todayId: st.entity_id, today: live(st) ? toKwh(st) : null });
    else if (dc === 'energy' && /month/i.test(name)) Object.assign(circuit(st), { monthId: st.entity_id, month: live(st) ? toKwh(st) : null });
  }
  const all = [...circuits.values()];
  const mains = cfg.power ? all.find((c) => c.powerId === cfg.power) || null : all.find((c) => MAINS_RE.test(c.key)) || null;
  const list = all.filter((c) => c !== mains && (c.powerId || c.todayId)).sort((a, b) => (b.watts ?? -1) - (a.watts ?? -1));
  const pick = (id) => (id && live(ctx.states[id]) ? toKwh(ctx.states[id]) : null);
  const total = (field) => (list.some((c) => c[field] !== null) ? sum(list.map((c) => c[field] || 0)) : null);
  const plugs = ctx.byDomain('switch')
    .filter((st) => !ctx.entry(st.entity_id)?.entity_category && (ctx.platform(st.entity_id) === 'emporia_vue' || /emporia|^emp\b/i.test(ctx.name(st.entity_id))))
    .map((st) => st.entity_id);
  const costs = ctx.byDomain('sensor')
    .filter((st) => live(st) && st.attributes.device_class === 'monetary' && /energy|electric|power/i.test(ctx.name(st.entity_id)))
    .map((st) => ({ id: st.entity_id, name: cleanName(ctx.name(st.entity_id)), value: toNum(st.state), unit: st.attributes.unit_of_measurement || '$', month: /month/i.test(ctx.name(st.entity_id)) }));
  const monthCosts = costs.filter((c) => c.month && c.value !== null);
  return {
    has: !!(mains || list.length || plugs.length),
    mains,
    totalW: mains ? mains.watts : total('watts'),
    estimated: !mains,
    today: pick(cfg.today) ?? mains?.today ?? total('today'),
    month: pick(cfg.month) ?? mains?.month ?? total('month'),
    circuits: list,
    plugs,
    costs: monthCosts.length ? monthCosts : costs,
    monthCost: monthCosts.length ? sum(monthCosts.map((c) => c.value)) : null,
    currency: monthCosts[0]?.unit || '$',
    chartIds: mains?.powerId ? [mains.powerId] : list.filter((c) => c.powerId).slice(0, 16).map((c) => c.powerId),
  };
}

function buildWater(ctx) {
  const cfg = ctx.config.water || {};
  const flume = ctx.list.filter((st) => ctx.platform(st.entity_id) === 'flume' || /flume/i.test(st.entity_id));
  const find = (domain, key, translation, re) => {
    if (cfg[key]) return ctx.states[cfg[key]] || null;
    return flume.find((st) => st.entity_id.startsWith(`${domain}.`) && (ctx.entry(st.entity_id)?.translation_key === translation || re.test(ctx.name(st.entity_id)))) || null;
  };
  const flow = find('sensor', 'flow', 'current_interval', /\bcurrent$/i);
  const today = find('sensor', 'today', 'today', /current day$|\btoday$/i);
  const week = find('sensor', 'week', 'week_to_date', /current week$/i);
  const month = find('sensor', 'month', 'month_to_date', /current month$/i);
  const leak = find('binary_sensor', 'leak', 'leak', /leak/i);
  const high = find('binary_sensor', 'high_flow', 'flow', /high flow/i);
  const battery = find('binary_sensor', 'battery', 'low_battery', /battery/i);
  const bridge = find('binary_sensor', 'bridge', 'connected', /bridge|connect/i);
  const val = (st) => (live(st) ? toNum(st.state) : null);
  const volume = String((today || month)?.attributes.unit_of_measurement || 'gal');
  const metricVolume = /^l|lit/i.test(volume) || /m³|m3/.test(volume);
  return {
    has: !!(flow || today || month),
    flowId: flow?.entity_id || null,
    flow: val(flow),
    today: val(today),
    week: val(week),
    month: val(month),
    todayId: today?.entity_id,
    leak: leak?.state === 'on',
    leakId: leak?.entity_id || null,
    high: high?.state === 'on',
    lowBattery: battery?.state === 'on',
    offline: bridge ? bridge.state === 'off' : !!flow && !live(flow),
    volumeUnit: metricVolume ? 'L' : 'gal',
    flowUnit: metricVolume ? 'L/min' : 'gal/min',
  };
}

const VAC = { PAUSE: 4, RETURN_HOME: 16, FAN_SPEED: 32, LOCATE: 512, START: 8192 };
const ROBOT_STATUS = {
  cleaning: ['Cleaning', 'cyan'],
  docked: ['Docked', 'good'],
  returning: ['Heading home', 'amber'],
  paused: ['Paused', 'amber'],
  idle: ['Idle', 'dim'],
  error: ['Needs help', 'bad'],
  unavailable: ['Offline', 'dim'],
  unknown: ['Unknown', 'dim'],
};

function splitRobotName(name) {
  const litter = name.match(/^(.*?)\s+(litter[ -]?box|litter-robot.*)$/i);
  if (litter) return { title: litter[1], sub: 'Litter box' };
  const serial = name.match(/^(\w+)\s+([A-Z0-9]{3})-([A-Z]{2})-([A-Z0-9]{6,})$/i);
  if (serial) return { title: `${serial[1]} ${serial[2].toUpperCase()}`, sub: `${serial[2]}-${serial[3]}-${serial[4]}`.toUpperCase() };
  return { title: name, sub: '' };
}

function statValue(st) {
  const n = toNum(st.state);
  const u = st.attributes.unit_of_measurement || '';
  const unit = !u ? '' : u === '%' || u.startsWith('°') ? u : ` ${u}`;
  return n === null ? titleCase(String(st.state).replace(/_/g, ' ')) : `${fmt(n, n % 1 ? 1 : 0)}${unit}`;
}

function buildRobots(ctx) {
  const list = Array.isArray(ctx.config.robots) ? ctx.config.robots.map((id) => ctx.states[id]).filter(Boolean) : ctx.byDomain('vacuum');
  return list.map((st) => {
    const a = st.attributes;
    const full = cleanName(ctx.name(st.entity_id));
    const litter = /litter/i.test(`${full} ${st.entity_id}`) || ctx.platform(st.entity_id) === 'litterrobot';
    const { title, sub } = splitRobotName(full);
    const deviceId = ctx.entry(st.entity_id)?.device_id;
    const siblings = deviceId
      ? Object.values(ctx.entities).filter((e) => e.device_id === deviceId && e.entity_id !== st.entity_id && !e.hidden && ctx.states[e.entity_id]).map((e) => ctx.states[e.entity_id])
      : [];
    const batterySensor = siblings.find((s) => domainOf(s.entity_id) === 'sensor' && s.attributes.device_class === 'battery');
    const features = toNum(a.supported_features);
    const can = (bit) => features === null || (features & bit) === bit;
    const [statusText, tone] = ROBOT_STATUS[st.state] || [titleCase(st.state), 'dim'];
    const model = ctx.device(st.entity_id)?.model || '';
    const prefix = ctx.deviceName(st.entity_id) || full;
    const label = (s) => cleanName(ctx.name(s.entity_id).replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')) || ctx.name(s.entity_id);
    return {
      id: st.entity_id,
      name: title,
      sub: [sub || model, ctx.areaName(st.entity_id)].filter(Boolean).join(' · '),
      litter,
      state: st.state,
      statusText: litter && ['docked', 'idle'].includes(st.state) ? 'Ready' : litter && st.state === 'cleaning' ? 'Cycling' : statusText,
      tone,
      battery: toNum(a.battery_level) ?? toNum(batterySensor?.state),
      fanSpeed: a.fan_speed || '',
      fanSpeeds: Array.isArray(a.fan_speed_list) && can(VAC.FAN_SPEED) ? a.fan_speed_list : [],
      can: { start: can(VAC.START), pause: can(VAC.PAUSE), dock: can(VAC.RETURN_HOME), locate: can(VAC.LOCATE) },
      error: humanize(a.error || a.error_message || (st.state === 'error' ? a.status || '' : '')),
      stats: siblings
        .filter((s) => domainOf(s.entity_id) === 'sensor' && s !== batterySensor && live(s))
        .slice(0, 4)
        .map((s) => ({ id: s.entity_id, label: label(s), value: statValue(s) })),
      controls: siblings
        .filter((s) => ['switch', 'button'].includes(domainOf(s.entity_id)) && live(s))
        .slice(0, 4)
        .map((s) => ({ id: s.entity_id, label: label(s), on: s.state === 'on', press: domainOf(s.entity_id) === 'button' })),
    };
  });
}

function buildClimate(ctx) {
  const list = Array.isArray(ctx.config.climate) ? ctx.config.climate.map((id) => ctx.states[id]).filter(Boolean) : ctx.byDomain('climate');
  return list.filter(live).map((st) => {
    const a = st.attributes;
    return {
      id: st.entity_id,
      name: cleanName(ctx.name(st.entity_id)),
      mode: st.state,
      action: a.hvac_action || '',
      current: toNum(a.current_temperature),
      target: toNum(a.temperature),
      low: toNum(a.target_temp_low),
      high: toNum(a.target_temp_high),
      modes: Array.isArray(a.hvac_modes) ? a.hvac_modes : [],
      step: toNum(a.target_temp_step) || (ctx.units.temp === '°C' ? 0.5 : 1),
      min: toNum(a.min_temp),
      max: toNum(a.max_temp),
      humidity: toNum(a.current_humidity),
    };
  });
}

const STATION_PLATFORMS = new Set(['ambient_station', 'ambient_network', 'ecowitt', 'weatherflow', 'weatherflow_cloud', 'netatmo', 'wunderground', 'davis_vantage', 'tempest']);

function buildWeather(ctx, forecast) {
  const cfg = ctx.config.outdoor || {};
  const weatherId = ctx.config.weather || ctx.byDomain('weather').find(live)?.entity_id || null;
  const w = weatherId ? ctx.states[weatherId] : null;
  const station = ctx.byDomain('sensor').filter((st) => live(st) && STATION_PLATFORMS.has(ctx.platform(st.entity_id)));
  const find = (re, not) => station.find((st) => re.test(ctx.name(st.entity_id)) && !(not && not.test(ctx.name(st.entity_id))))?.entity_id;
  const value = (id) => (id && live(ctx.states[id]) ? toNum(ctx.states[id].state) : null);
  const tempId = cfg.temperature || find(/\btemperature$/i, /inside|indoor|\bin\b/i);
  const feelsId = cfg.feels_like || find(/feels like$/i);
  const humId = cfg.humidity || find(/\bhumidity$/i, /inside|indoor|\bin\b/i);
  const dewId = find(/dew ?point$/i, /inside|indoor/i);
  const a = w?.attributes || {};
  const temp = value(tempId) ?? toNum(a.temperature);
  return {
    id: weatherId,
    tempId,
    has: temp !== null,
    condition: live(w) ? w.state : '',
    features: toNum(a.supported_features) ?? 0,
    temp,
    feels: value(feelsId) ?? toNum(a.apparent_temperature),
    humidity: value(humId) ?? toNum(a.humidity),
    dew: value(dewId) ?? toNum(a.dew_point),
    wind: toNum(a.wind_speed),
    windUnit: a.wind_speed_unit || '',
    forecast: forecast?.items?.slice(0, forecast.type === 'hourly' ? 10 : 6) || [],
    forecastType: forecast?.type || '',
  };
}

const FAV_DOMAINS = ['light', 'switch', 'fan', 'input_boolean', 'scene', 'script', 'cover', 'lock', 'media_player', 'climate', 'humidifier'];
const NOT_A_FAVORITE = /siren|alarm|child lock|panel sound|oscillation|display light|presence sensor|follow me|find robot|winter mode|do not disturb|virtual|test plug|\bptc\b/i;

function buildFavorites(ctx, learned) {
  if (Array.isArray(ctx.config.favorites)) return { source: 'config', ids: ctx.config.favorites.filter((id) => ctx.states[id]) };
  const usable = (st) => st && !ctx.hidden(st.entity_id) && !ctx.entry(st.entity_id)?.entity_category && !NOT_A_FAVORITE.test(ctx.name(st.entity_id));
  const learnedIds = (learned?.ids || []).filter((id) => usable(ctx.states[id]));
  const order = { fan: 0, light: 1, switch: 2, humidifier: 3, input_boolean: 4 };
  const auto = ctx.list
    .filter((st) => order[domainOf(st.entity_id)] !== undefined && live(st) && usable(st))
    .sort((a, b) => order[domainOf(a.entity_id)] - order[domainOf(b.entity_id)] || Date.parse(b.last_changed) - Date.parse(a.last_changed))
    .map((st) => st.entity_id);
  const rows = (ids) => (ids.length > 3 ? ids.slice(0, Math.min(12, ids.length - (ids.length % 3))) : ids);
  if (learnedIds.length >= 3) return { source: 'learned', ids: rows([...learnedIds, ...auto.filter((id) => !learnedIds.includes(id))]) };
  return { source: 'auto', ids: rows(auto) };
}

function buildCameras(ctx) {
  const list = Array.isArray(ctx.config.cameras) ? ctx.config.cameras.map((id) => ctx.states[id]).filter(Boolean) : ctx.byDomain('camera');
  return list.filter(live).slice(0, 6).map((st) => ({ id: st.entity_id, name: cleanName(ctx.name(st.entity_id)), picture: st.attributes.entity_picture || '' }));
}

function buildLists(ctx) {
  const list = Array.isArray(ctx.config.lists) ? ctx.config.lists.map((id) => ctx.states[id]).filter(Boolean) : ctx.byDomain('todo');
  const shopping = /shop|grocer|target|costco|walmart|to-?do|errand|list/i;
  return list
    .filter(live)
    .map((st) => ({ id: st.entity_id, name: cleanName(ctx.name(st.entity_id)), count: toNum(st.state) || 0 }))
    .filter((l) => l.count > 0)
    .sort((a, b) => Number(shopping.test(b.name)) - Number(shopping.test(a.name)) || b.count - a.count)
    .slice(0, 6);
}

function buildAlerts(ctx, model, now) {
  const alerts = [];
  const add = (level, icon, title, detail, target = {}) => alerts.push({ level, icon, title, detail, ...target });
  for (const st of ctx.list) {
    const id = st.entity_id;
    const d = domainOf(id);
    const dc = st.attributes.device_class;
    const name = cleanName(ctx.name(id));
    const ago = since(st.last_changed, now);
    const open = ago === 'just now' ? 'Just opened' : `Open for ${ago}`;
    if (d === 'binary_sensor' && st.state === 'on') {
      if (dc === 'moisture') add(0, 'drop', `Water detected: ${name}`, 'Check for a leak', { entity: id });
      else if (['smoke', 'carbon_monoxide', 'gas', 'safety'].includes(dc)) add(0, 'alert', name, titleCase(String(dc).replace(/_/g, ' ')), { entity: id });
      else if (['door', 'garage_door', 'opening'].includes(dc)) add(1, dc === 'garage_door' || /garage/i.test(name) ? 'garage' : 'door', `${name} is open`, open, { entity: id });
      else if (dc === 'window') add(2, 'window', `${name} is open`, open, { entity: id });
      else if (dc === 'problem' && !ctx.entry(id)?.entity_category) add(1, 'alert', name, 'Reports a problem', { entity: id });
    } else if (d === 'cover' && ['garage', 'gate', 'door'].includes(dc) && st.state === 'open') {
      add(1, 'garage', `${name} is open`, open, { entity: id });
    } else if (d === 'lock' && st.state === 'unlocked') {
      add(2, 'lock', `${name} is unlocked`, open, { entity: id });
    } else if (d === 'sensor' && dc === 'battery' && live(st)) {
      const level = toNum(st.state);
      if (level !== null && level <= 15) add(2, 'battery', `${name.replace(/\s*battery( level)?$/i, '')} battery low`, `${fmt(level)}% left`, { entity: id });
    }
  }
  if (model.spike?.active) {
    add(1, 'air', `${model.spike.pmLabel} PM0.3 is spiking`, `${fmt(model.spike.value)} per 0.1 L while ${model.spike.climateName} is ${String(model.spike.action).replace(/_/g, ' ')}`, { tab: 'air' });
  }
  if (model.water.leak) add(0, 'drop', 'Flume detected a leak', 'Water has been running without a break', { tab: 'energy' });
  else if (model.water.high) add(1, 'drop', 'High water flow', `${fmt(model.water.flow, 1)} ${model.water.flowUnit} right now`, { tab: 'energy' });
  for (const r of model.air.rooms) {
    if (r.level >= 3 && r.worst) {
      const def = AIR_METRICS[r.worst.metric];
      add(r.level >= 4 ? 1 : 2, 'air', `${r.name}: ${def.label} ${fmt(r.worst.value, def.digits)} ${def.unit}`.trim(), `${LEVEL_LABELS[r.level]} air`, { tab: 'air' });
    }
  }
  for (const r of model.robots) if (r.state === 'error') add(1, r.litter ? 'cat' : 'robot', `${r.name} needs help`, r.error || 'Stopped with an error', { tab: 'robots' });
  for (const p of model.people) if (p.battery !== null && p.battery <= 15 && !p.charging) add(2, 'battery', `${p.first}'s phone is at ${fmt(p.battery)}%`, 'Location updates may stop', { tab: 'map' });
  return alerts.sort((a, b) => a.level - b.level);
}

const WATCHED_DOMAINS = new Set(['light', 'switch', 'fan', 'climate', 'vacuum', 'media_player', 'camera', 'cover', 'lock', 'sensor', 'binary_sensor']);

function buildOffline(ctx, now) {
  return ctx.list
    .filter((st) => st.state === 'unavailable' && WATCHED_DOMAINS.has(domainOf(st.entity_id)) && !ctx.entry(st.entity_id)?.entity_category)
    .map((st) => ({ id: st.entity_id, name: cleanName(ctx.name(st.entity_id)), area: ctx.areaName(st.entity_id), since: since(st.last_changed, now) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------- score inputs

// Piecewise-linear lookup through [value, score] steps.
export function interpolate(steps, value) {
  const n = toNum(value);
  if (n === null) return null;
  if (n <= steps[0][0]) return steps[0][1];
  for (let i = 1; i < steps.length; i += 1) {
    const [x1, y1] = steps[i];
    const [x0, y0] = steps[i - 1];
    if (n <= x1) return Math.round(y0 + ((y1 - y0) * (n - x0)) / (x1 - x0 || 1));
  }
  return steps[steps.length - 1][1];
}

// US EPA AQI bands: 50 is the top of "Good", 100 of "Moderate", 150 of "Unhealthy for sensitive groups".
export const AQI_STEPS = [[0, 100], [50, 80], [100, 60], [150, 40], [200, 20], [300, 0]];
// PM0.3 counts per 0.1 L: a filtered room sits in the low hundreds, outdoor air around 1,000 to 3,000,
// cooking or smoke pushes past 10,000.
export const PM03_STEPS = [[0, 100], [100, 100], [500, 90], [1000, 75], [2500, 55], [5000, 35], [10000, 15], [20000, 0]];
const WINIX_SCORES = { good: 100, fair: 65, poor: 35, very_poor: 10 };
const OUTDOOR_AQI_PLATFORMS = new Set(['airnow', 'waqi', 'purpleair', 'google_air_quality', 'openweathermap', 'pirateweather', 'accuweather', 'airvisual', 'iqair', 'nws', 'ambee', 'luftdaten', 'sensor_community', 'openaq', 'world_air_quality_index']);

export function roomLabel(ctx, id) {
  const area = ctx.areaName(id);
  const device = cleanName(ctx.deviceName(id));
  const generic = /\b(bedroom|air|monitor|quality|sensor|node|purifier)\b/i;
  let label = device && !(area && generic.test(device)) ? device : area || device || cleanName(ctx.name(id)).replace(PM03_RE, '').trim();
  const room = label.match(/^([A-Za-z]{4,})room$/i);
  if (room) label = room[1];
  return label;
}

function isWinix(ctx, id) {
  return ctx.platform(id) === 'winix' || /winix/i.test(`${ctx.name(id)} ${ctx.deviceName(id)}`);
}

function isAmazonMonitor(ctx, id) {
  return ctx.platform(id) === 'alexa_media' || /air quality monitor/i.test(`${ctx.deviceName(id)} ${ctx.name(id)}`);
}

export function discoverPm03(ctx) {
  const byDevice = new Map();
  for (const st of ctx.byDomain('sensor')) {
    const name = ctx.name(st.entity_id);
    if (!PM03_RE.test(name) || isWinix(ctx, st.entity_id)) continue;
    const key = ctx.entry(st.entity_id)?.device_id || st.entity_id;
    const prev = byDevice.get(key);
    const rank = (s) => (/\braw\b/i.test(ctx.name(s.entity_id)) ? 2 : 0) + (live(s) ? 0 : 1);
    if (!prev || rank(st) < rank(prev)) byDevice.set(key, st);
  }
  return [...byDevice.values()]
    .map((st) => ({ id: st.entity_id, label: roomLabel(ctx, st.entity_id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function discoverOutdoorAqi(ctx) {
  const candidates = ctx.byDomain('sensor').filter((st) => st.attributes.device_class === 'aqi' && !isWinix(ctx, st.entity_id) && !isAmazonMonitor(ctx, st.entity_id));
  const outdoor = candidates.find((st) => OUTDOOR_AQI_PLATFORMS.has(ctx.platform(st.entity_id)) || /outdoor|outside|\bus aqi\b|airnow|purpleair/i.test(ctx.name(st.entity_id)));
  return outdoor?.entity_id || null;
}

function discoverWinixQuality(ctx) {
  return ctx.byDomain('sensor')
    .filter((st) => isWinix(ctx, st.entity_id) && (st.attributes.air_quality !== undefined || /air ?q ?value|air quality/i.test(ctx.name(st.entity_id))))
    .map((st) => st.entity_id);
}

function discoverAmazon(ctx) {
  return ctx.byDomain('sensor').find((st) => st.attributes.device_class === 'aqi' && isAmazonMonitor(ctx, st.entity_id))?.entity_id || null;
}

function winixCategory(st) {
  const raw = String(st?.attributes?.air_quality ?? st?.state ?? '').toLowerCase().replace(/\s+/g, '_');
  return WINIX_SCORES[raw] !== undefined ? raw : null;
}

// The air score averages the inputs that are reporting. Each input becomes 0–100, higher is better.
export function buildAirScore(ctx, prefs = {}) {
  const p = prefs.air || {};
  const pm03 = Array.isArray(p.pm03) && p.pm03.length ? p.pm03.filter((x) => ctx.states[x.id]) : discoverPm03(ctx);
  const outdoorId = p.outdoor === '' ? null : p.outdoor || discoverOutdoorAqi(ctx);
  const winixIds = Array.isArray(p.winix) ? p.winix.filter((id) => ctx.states[id]) : discoverWinixQuality(ctx);
  const amazonId = p.amazon === '' ? null : p.amazon || discoverAmazon(ctx);
  const parts = [];
  if (outdoorId && ctx.states[outdoorId]) {
    const st = ctx.states[outdoorId];
    const value = live(st) ? toNum(st.state) : null;
    parts.push({ key: 'outdoor', label: 'Outside AQI', entity: outdoorId, value, raw: value === null ? 'Offline' : `${fmt(value)} AQI`, score: interpolate(AQI_STEPS, value), math: 'US AQI: 0 → 100, 50 → 80, 100 → 60, 150 → 40, 200 → 20, 300 → 0' });
  }
  for (const item of pm03) {
    const st = ctx.states[item.id];
    const value = live(st) ? pm03PerDl(st.state, st.attributes.unit_of_measurement) : null;
    parts.push({ key: `pm03:${item.id}`, label: `${item.label} PM0.3`, entity: item.id, value, raw: value === null ? 'Offline' : `${fmt(value)} per 0.1 L`, score: interpolate(PM03_STEPS, value), math: 'Particles per 0.1 L: 100 → 100, 500 → 90, 1,000 → 75, 2,500 → 55, 5,000 → 35, 10,000 → 15, 20,000 → 0', pm03: true, room: item.label });
  }
  if (winixIds.length) {
    const cats = winixIds.map((id) => ({ id, cat: winixCategory(ctx.states[id]) })).filter((x) => x.cat);
    const score = cats.length ? Math.round(sum(cats.map((x) => WINIX_SCORES[x.cat])) / cats.length) : null;
    parts.push({ key: 'winix', label: winixIds.length > 1 ? `Winix (${winixIds.length})` : 'Winix', entity: winixIds[0], value: score, raw: cats.length ? [...new Set(cats.map((x) => titleCase(x.cat.replace('_', ' '))))].join(' · ') : 'Offline', score, math: 'Winix air quality: Good → 100, Fair → 65, Poor → 35, Very poor → 10, averaged across purifiers' });
  }
  if (amazonId && ctx.states[amazonId]) {
    const st = ctx.states[amazonId];
    const value = live(st) ? clamp(toNum(st.state) ?? NaN, 0, 100) : null;
    parts.push({ key: 'amazon', label: 'Amazon monitor', entity: amazonId, value: Number.isFinite(value) ? value : null, raw: Number.isFinite(value) && value !== null ? `${fmt(value)} of 100` : 'Offline', score: Number.isFinite(value) ? Math.round(value) : null, math: "Amazon's own indoor air score, already 0–100 with higher better" });
  }
  const scored = parts.filter((x) => x.score !== null);
  const score = scored.length ? Math.round(sum(scored.map((x) => x.score)) / scored.length) : null;
  const worst = scored.reduce((w, x) => (!w || x.score < w.score ? x : w), null);
  return { parts, score, level: scoreLevel(score), worst, pm03, used: scored.length };
}

export const SPIKE_AUTOMATION_ID = 'nourie_home_pm03_spike';
const HVAC_RUNNING = new Set(['heating', 'cooling', 'fan', 'drying', 'preheating', 'defrosting']);

export function climateRunning(st) {
  if (!live(st)) return false;
  const action = st.attributes.hvac_action;
  if (action) return HVAC_RUNNING.has(action);
  return st.state !== 'off';
}

function buildSpike(ctx, prefs, score, ext) {
  const sp = prefs.spike || {};
  const pm = sp.pm03 && ctx.states[sp.pm03] ? sp.pm03 : (score.pm03.find((x) => /master|primary/i.test(x.label)) || score.pm03[0])?.id || null;
  const climateId = sp.climate && ctx.states[sp.climate] ? sp.climate
    : (ctx.byDomain('climate').find((st) => live(st) && /upstairs/i.test(`${ctx.name(st.entity_id)} ${ctx.areaName(st.entity_id)}`)) || null)?.entity_id || null;
  const pmSt = pm ? ctx.states[pm] : null;
  const value = live(pmSt) ? pm03PerDl(pmSt.state, pmSt.attributes.unit_of_measurement) : null;
  const threshold = toNum(sp.threshold) ?? ext.spikeSuggest?.[pm] ?? 1500;
  const climate = climateId ? ctx.states[climateId] : null;
  const running = climateRunning(climate);
  const automation = ctx.byDomain('automation').find((st) => st.attributes.id === SPIKE_AUTOMATION_ID) || null;
  return {
    pm,
    pmLabel: pm ? roomLabel(ctx, pm) : '',
    climateId,
    climateName: climateId ? cleanName(ctx.name(climateId)) : '',
    running,
    action: climate?.attributes?.hvac_action || climate?.state || '',
    value,
    threshold,
    custom: toNum(sp.threshold) !== null,
    active: running && value !== null && value > threshold,
    automation: automation ? { id: automation.entity_id, on: automation.state === 'on' } : null,
    notify: sp.notify || '',
  };
}

// ------------------------------------------------------------ controls

const PRESS_DOMAINS = ['script', 'scene', 'button', 'input_button'];
const TOGGLE_DOMAINS = ['switch', 'input_boolean', 'fan', 'light'];

function findControl(ctx, re, domains) {
  return ctx.list
    .filter((st) => domains.includes(domainOf(st.entity_id)) && re.test(ctx.name(st.entity_id)))
    .sort((a, b) => Number(live(b)) - Number(live(a)))[0]?.entity_id || null;
}

// The three pairs asked for by default: Quiet on/off, Winix turbo on/off and the master fan.
export function defaultControls(ctx) {
  const pairs = [];
  const quietOn = findControl(ctx, /\bquiet\b.*\bon\b/i, PRESS_DOMAINS);
  const quietOff = findControl(ctx, /\bquiet\b.*\boff\b/i, PRESS_DOMAINS);
  const quietToggle = findControl(ctx, /^quiet( mode)?$/i, ['input_boolean', 'switch']);
  if (quietOn || quietOff || quietToggle) {
    pairs.push({ key: 'quiet', label: 'Quiet', icon: 'quiet', on: quietOn ? { entity: quietOn } : quietToggle ? { entity: quietToggle } : null, off: quietOff ? { entity: quietOff } : quietToggle ? { entity: quietToggle } : null });
  }
  const turboOn = findControl(ctx, /winix.*turbo.*\bon\b|turbo.*winix.*\bon\b|^winix turbo$/i, PRESS_DOMAINS);
  const turboOff = findControl(ctx, /winix.*turbo.*\boff\b|turbo.*winix.*\boff\b/i, PRESS_DOMAINS);
  const winixFans = ctx.byDomain('fan').filter((st) => isWinix(ctx, st.entity_id)).map((st) => st.entity_id);
  if (turboOn || turboOff || winixFans.length) {
    pairs.push({
      key: 'turbo',
      label: 'Winix Turbo',
      icon: 'purifier',
      on: turboOn ? { entity: turboOn } : winixFans.length ? { service: 'fan.set_percentage', data: { entity_id: winixFans, percentage: winixTurboPercent(ctx, winixFans) } } : null,
      off: turboOff ? { entity: turboOff } : winixFans.length ? { service: 'fan.set_preset_mode', data: { entity_id: winixFans, preset_mode: 'Auto' } } : null,
    });
  }
  const masterFan = findControl(ctx, /^master fan$/i, ['fan']) || findControl(ctx, /\bmaster\b.*\bfan\b/i, ['fan']);
  if (masterFan) pairs.push({ key: 'master_fan', label: 'Master Fan', icon: 'fan', on: { entity: masterFan }, off: { entity: masterFan } });
  return pairs;
}

// Winix purifiers name their speeds low, medium, high, turbo (and on some models a fifth,
// "super", above turbo), so turbo is the fourth step rather than always 100%.
export function winixTurboPercent(ctx, fans) {
  const step = toNum(ctx.states[[].concat(fans)[0]]?.attributes?.percentage_step);
  return step && step > 0 ? Math.min(100, Math.round(step * 4)) : 100;
}

function targetLabel(ctx, t) {
  if (!t) return '';
  if (t.entity) return cleanName(ctx.name(t.entity));
  const ids = [].concat(t.data?.entity_id || []);
  return `${t.service} · ${ids.length} ${ids.length === 1 ? 'device' : 'devices'}`;
}

// Works out which side of a pair is in effect so the active button can light up.
function controlState(ctx, pair) {
  const on = pair.on;
  const off = pair.off;
  const st = (t) => (t?.entity ? ctx.states[t.entity] : null);
  if (on?.entity && on.entity === off?.entity && TOGGLE_DOMAINS.includes(domainOf(on.entity))) {
    const s = st(on);
    return { active: live(s) ? (s.state === 'on' ? 'on' : 'off') : null, note: live(s) ? (s.state === 'on' ? `On${toNum(s.attributes.percentage) ? ` · ${fmt(s.attributes.percentage)}%` : ''}` : 'Off') : 'Offline' };
  }
  if (on?.service === 'fan.set_percentage') {
    const fans = [].concat(on.data?.entity_id || []).map((id) => ctx.states[id]).filter(live);
    if (!fans.length) return { active: null, note: 'Offline' };
    const target = toNum(on.data?.percentage) ?? 100;
    const turbo = fans.filter((f) => f.state === 'on' && toNum(f.attributes.percentage) >= target - 1).length;
    return { active: turbo === fans.length ? 'on' : turbo ? null : 'off', note: turbo ? `${turbo} of ${fans.length} on turbo` : 'Not on turbo' };
  }
  const when = (t) => {
    const s = st(t);
    if (!s) return 0;
    const d = domainOf(s.entity_id);
    const at = d === 'script' || d === 'automation' ? s.attributes.last_triggered : d === 'scene' || d === 'button' || d === 'input_button' ? s.state : s.last_changed;
    return Date.parse(at) || 0;
  };
  const tOn = when(on);
  const tOff = when(off);
  const running = [st(on), st(off)].some((s) => domainOf(s?.entity_id || '') === 'script' && s.state === 'on');
  if (!tOn && !tOff) return { active: null, note: running ? 'Running' : '' };
  return { active: tOn >= tOff ? 'on' : 'off', note: running ? 'Running' : `Last ${tOn >= tOff ? 'on' : 'off'} ${since(Math.max(tOn, tOff))}${/\d/.test(since(Math.max(tOn, tOff))) ? ' ago' : ''}` };
}

export function buildControls(ctx, prefs = {}) {
  const pairs = Array.isArray(prefs.controls) ? prefs.controls : defaultControls(ctx);
  return pairs
    .filter((p) => p && (p.on || p.off))
    .map((p, i) => ({ ...p, index: i, icon: p.icon || 'power', onLabel: targetLabel(ctx, p.on), offLabel: targetLabel(ctx, p.off), ...controlState(ctx, p) }));
}

// -------------------------------------------------------------- health

const OURA_LEVELS = { exceptional: 95, strong: 80, solid: 65, adequate: 50, limited: 30 };

function findSensor(ctx, re, not) {
  return ctx.byDomain('sensor').find((st) => re.test(ctx.name(st.entity_id)) && !(not && not.test(ctx.name(st.entity_id))))?.entity_id || null;
}

function healthMetric(ctx, id, kind) {
  const st = id ? ctx.states[id] : null;
  if (!st) return null;
  const a = st.attributes || {};
  const num = toNum(st.state);
  const word = !live(st) ? null : num === null ? String(st.state).toLowerCase() : null;
  const value = num ?? (word && OURA_LEVELS[word] !== undefined ? OURA_LEVELS[word] : null);
  const own = a.level || a.status || a.rating || a.label || a.category;
  let label;
  let tone;
  if (kind === 'sick') {
    label = value === null ? '—' : value >= 60 ? 'High' : value >= 30 ? 'Moderate' : 'Low';
    tone = value === null ? 'dim' : value >= 60 ? 'bad' : value >= 30 ? 'fair' : 'good';
  } else if (kind === 'heart') {
    label = value === null ? '—' : value >= 75 ? 'Good' : value >= 50 ? 'Fair' : 'Low';
    tone = value === null ? 'dim' : value >= 75 ? 'good' : value >= 50 ? 'fair' : 'poor';
  } else {
    label = word ? titleCase(word) : value === null ? '—' : value >= 85 ? 'Optimal' : value >= 70 ? 'Good' : value >= 60 ? 'Fair' : 'Pay attention';
    tone = value === null ? 'dim' : value >= 85 ? 'good' : value >= 70 ? 'lime' : value >= 60 ? 'fair' : 'poor';
  }
  return { id, value, shown: word ? titleCase(word) : num === null ? '—' : fmt(num), label: typeof own === 'string' && own ? titleCase(own) : label, tone, updated: st.last_changed };
}

function durationText(st) {
  const n = toNum(st?.state);
  if (n === null) return '';
  const unit = String(st.attributes.unit_of_measurement || 'h').toLowerCase();
  const minutes = unit.startsWith('s') ? n / 60 : unit.startsWith('min') || unit === 'm' ? n : n * 60;
  return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, '0')}m`;
}

export function buildHealth(ctx, prefs = {}) {
  const p = prefs.oura || {};
  const pick = (key, re, not) => (p[key] === '' ? null : p[key] && ctx.states[p[key]] ? p[key] : findSensor(ctx, re, not));
  const ids = {
    readiness: pick('readiness', /readiness( score)?$/i, /contributor|temperature/i),
    sleep: pick('sleep', /sleep score$|^(oura\s*(ring)?\s*)?sleep$/i, /contributor/i),
    resilience: pick('resilience', /resilience/i, /contributor/i),
    sick: pick('sick', /sick score/i),
    heart: pick('heart', /heart score/i),
    duration: pick('duration', /total sleep( duration| time)?$|sleep duration$/i),
    battery: p.battery === '' ? null : p.battery && ctx.states[p.battery] ? p.battery : ctx.byDomain('sensor').find((st) => st.attributes.device_class === 'battery' && /oura|ring/i.test(`${ctx.name(st.entity_id)} ${ctx.deviceName(st.entity_id)}`))?.entity_id || null,
  };
  const metrics = {
    readiness: healthMetric(ctx, ids.readiness, 'oura'),
    sleep: healthMetric(ctx, ids.sleep, 'oura'),
    resilience: healthMetric(ctx, ids.resilience, 'oura'),
    sick: healthMetric(ctx, ids.sick, 'sick'),
    heart: healthMetric(ctx, ids.heart, 'heart'),
  };
  const battery = ids.battery && live(ctx.states[ids.battery]) ? toNum(ctx.states[ids.battery].state) : null;
  const updated = Object.values(metrics).filter(Boolean).map((x) => Date.parse(x.updated) || 0).reduce((a, b) => Math.max(a, b), 0);
  return {
    has: Object.values(metrics).some(Boolean),
    ids,
    metrics,
    battery,
    batteryId: ids.battery,
    sleepTime: ids.duration ? durationText(ctx.states[ids.duration]) : '',
    updated: updated || null,
  };
}

// -------------------------------------------------------------- robots v2

export function isClassicRobot(ctx, robot, prefs = {}) {
  if (Array.isArray(prefs.robots?.classic)) return prefs.robots.classic.includes(robot.id);
  const device = ctx.device(robot.id);
  return robot.litter || /dyson/i.test(`${robot.id} ${ctx.name(robot.id)} ${device?.manufacturer || ''} ${device?.model || ''} ${ctx.platform(robot.id)}`);
}

function robotMapImage(ctx, id) {
  const deviceId = ctx.entry(id)?.device_id;
  if (!deviceId) return null;
  const st = ctx.list.find((s) => ['image', 'camera'].includes(domainOf(s.entity_id)) && ctx.entry(s.entity_id)?.device_id === deviceId && live(s) && s.attributes.entity_picture);
  return st ? { id: st.entity_id, src: st.attributes.entity_picture } : null;
}

function floorOf(hass, areaId) {
  const floorId = hass.areas?.[areaId]?.floor_id;
  const floor = floorId ? hass.floors?.[floorId] : null;
  return floor ? { id: floor.floor_id || floorId, name: floor.name, level: toNum(floor.level) ?? 0 } : { id: '', name: '', level: 99 };
}

function decorateRobots(ctx, robots, prefs, ext) {
  return robots.map((r) => {
    const classic = isClassicRobot(ctx, r, prefs);
    const features = toNum(ctx.states[r.id]?.attributes?.supported_features);
    const canArea = features === null || (features & 16384) === 16384;
    const areaInfo = ext.vacAreas?.[r.id];
    const areas = (areaInfo?.areaIds || [])
      .filter((id) => ctx.hass.areas?.[id])
      .map((id) => ({ id, name: ctx.hass.areas[id].name, floor: floorOf(ctx.hass, id), icon: ctx.hass.areas[id].icon || '' }))
      .sort((a, b) => a.floor.level - b.floor.level || a.floor.name.localeCompare(b.floor.name) || a.name.localeCompare(b.name));
    return { ...r, classic, canArea, areas, areaStatus: areaInfo?.status || (canArea ? 'loading' : 'unsupported'), map: robotMapImage(ctx, r.id) };
  });
}

function discoverDust(ctx, prefs = {}) {
  if (Array.isArray(prefs.dust)) return prefs.dust.filter((id) => ctx.states[id]);
  return ctx.byDomain('sensor')
    .filter((st) => /\b(dust|dirt)\b/i.test(ctx.name(st.entity_id)) && !/pm\s?\d|particulate|filter/i.test(ctx.name(st.entity_id)) && toNum(st.state) !== null)
    .map((st) => st.entity_id);
}

// ------------------------------------------------------------- settings

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Returns a copy of prefs with the dotted path set, or removed when value is undefined.
export function setPath(prefs, path, value) {
  const keys = path.split('.');
  const out = JSON.parse(JSON.stringify(prefs || {}));
  let node = out;
  for (const k of keys.slice(0, -1)) node = isPlain(node[k]) ? node[k] : (node[k] = {});
  const last = keys[keys.length - 1];
  if (value === undefined) delete node[last];
  else node[last] = value;
  return out;
}

export function mergePrefs(base, over) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(over || {})) out[k] = isPlain(v) && isPlain(out[k]) ? mergePrefs(out[k], v) : v;
  return out;
}

// -------------------------------------------------------------- billing

export function sumChange(rows, from, to) {
  let total = 0;
  let seen = false;
  let last = null;
  for (const row of rows || []) {
    if (row.start >= from && row.start < to && Number.isFinite(row.change)) {
      total += row.change;
      seen = true;
      last = Math.max(last ?? 0, row.end ?? row.start + 3600000);
    }
  }
  return seen ? { total, last } : null;
}

function billingFor(kind, conf, raw, now) {
  const win = cycleWindow(conf, now);
  const src = raw?.ids?.[kind] || null;
  // A grid source can have several tariffs (peak and off-peak); each has its own meter, cost and price.
  const tariffs = src ? src.tariffs || [{ usage: src.usage, cost: src.cost, price: src.price }] : [];
  const sum = (id) => sumChange(raw?.rows?.[id], win.start, now + 1);
  const userRate = toNum(conf.rate);
  const fixed = toNum(conf.fixed) ?? 0;
  let usageTotal = null;
  let spent = 0;
  let through = null;
  let costKnown = tariffs.length > 0;
  for (const t of tariffs) {
    const usage = sum(t.usage);
    const cost = t.cost ? sum(t.cost) : null;
    if (usage) usageTotal = (usageTotal ?? 0) + usage.total;
    const price = userRate ?? t.price ?? null;
    const part = price !== null ? (usage ? usage.total * price : 0) : cost ? cost.total : null;
    if (part === null) costKnown = false;
    else spent += part;
    const last = (price !== null ? usage?.last : cost?.last ?? usage?.last) ?? null;
    if (last !== null) through = Math.max(through ?? 0, last);
  }
  const rate = userRate ?? (tariffs.length === 1 ? tariffs[0].price ?? null : null);
  const hasData = through !== null;
  if (!costKnown || !hasData) spent = null;
  // When the source lags (utility statistics often arrive days late), project from the span it covers.
  const lagging = hasData && through < now - 3 * 3600000;
  const coveredMs = lagging ? through - win.start : now - win.start;
  const covered = clamp(coveredMs / (win.end - win.start), 0, 1);
  // Wait for six hours of data so the first morning of a cycle does not swing the estimate wildly.
  const estimate = spent === null || covered <= 0 || coveredMs < 6 * 3600000 ? null : spent / covered + fixed;
  const cost = tariffs.every((t) => t.cost) ? tariffs.reduce((acc, t) => { const c = sum(t.cost); return c ? (acc ?? 0) + c.total : acc; }, null) : null;
  return {
    kind,
    win,
    rate,
    fixed,
    usage: usageTotal,
    spent,
    estimate,
    through: lagging ? through : null,
    source: src,
    loading: !raw,
    // Nothing turns usage into dollars: no price entered and no cost tracking in Home Assistant.
    needsRate: !!raw && rate === null && !costKnown && !tariffs.some((t) => t.cost || t.price !== null && t.price !== undefined),
    error: raw?.error || null,
    effRate: rate ?? (cost !== null && usageTotal > 0 ? cost / usageTotal : null),
  };
}

export function buildBilling(ctx, prefs = {}, raw = null, now = Date.now()) {
  const b = prefs.billing || {};
  const electric = billingFor('electric', b.electric || {}, raw, now);
  const water = billingFor('water', b.water || {}, raw, now);
  const dayStart = startOfDay(now);
  const rows = (raw?.circuits || []).map((c) => {
    const r = raw.rows?.[c.stat];
    const kwh = {
      today: sumChange(r, dayStart, now + 1)?.total ?? null,
      week: sumChange(r, addDays(dayStart, -6), now + 1)?.total ?? null,
      cycle: sumChange(r, electric.win.start, now + 1)?.total ?? null,
    };
    const money = (v) => (v === null || electric.effRate === null ? null : v * electric.effRate);
    return { name: c.name, stat: c.stat, kwh, cost: { today: money(kwh.today), week: money(kwh.week), cycle: money(kwh.cycle) } };
  }).filter((r) => r.kwh.cycle !== null || r.kwh.week !== null)
    .sort((a, b) => (b.kwh.cycle ?? b.kwh.week ?? 0) - (a.kwh.cycle ?? a.kwh.week ?? 0));
  return { electric, water, heat: rows, money: electric.effRate !== null, currency: prefs.billing?.currency || '$' };
}

// ---------------------------------------------------------------- icons

const BLADE = '<path d="M12 12c-.4-3.3.5-7.6 3.4-7.6 2.2 0 3 2.1 2.1 3.8C16.4 10.1 14.3 11.4 12 12z"/>';
const ICONS = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9"/>',
  air: '<path d="M3 8.5h10.5a3 3 0 1 0-3-3"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M3 16.5h6"/>',
  pin: '<path d="M12 21s-6.5-5.8-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.4"/>',
  bolt: '<path d="M13.2 2.8 5 13.5h6l-1.2 7.7 8.2-10.7h-6z"/>',
  drop: '<path d="M12 3.2S6 9.6 6 14a6 6 0 0 0 12 0c0-4.4-6-10.8-6-10.8z"/>',
  robot: '<circle cx="12" cy="12.5" r="8"/><path d="M8.3 7.4a6.5 6.5 0 0 1 7.4 0"/><circle cx="12" cy="12.5" r="2.4"/>',
  thermo: '<path d="M14 14.6V5.5a2 2 0 0 0-4 0v9.1a3.9 3.9 0 1 0 4 0z"/><path d="M12 9v6.5"/>',
  fan: `<circle cx="12" cy="12" r="1.5"/>${BLADE}<g transform="rotate(120 12 12)">${BLADE}</g><g transform="rotate(240 12 12)">${BLADE}</g>`,
  power: '<path d="M12 3.5v8"/><path d="M6.6 6.8a7.5 7.5 0 1 0 10.8 0"/>',
  bulb: '<path d="M9.5 18h5"/><path d="M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  door: '<path d="M6 20.5v-16a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16"/><path d="M4 20.5h16"/><path d="M14.5 12.5h.01"/>',
  garage: '<path d="M3.5 20.5v-11L12 4l8.5 5.5v11"/><path d="M7 20.5v-8h10v8"/><path d="M7 15.5h10M7 18h10"/>',
  window: '<rect x="4.5" y="3.5" width="15" height="17" rx="1.5"/><path d="M12 3.5v17M4.5 12h15"/>',
  alert: '<path d="M10.4 4.2 2.9 17.3a1.8 1.8 0 0 0 1.6 2.7h15a1.8 1.8 0 0 0 1.6-2.7L13.6 4.2a1.8 1.8 0 0 0-3.2 0z"/><path d="M12 9.5v4"/><path d="M12 16.8h.01"/>',
  battery: '<rect x="2.5" y="7.5" width="17" height="9" rx="2.2"/><path d="M21.5 11v2"/><path d="M5.5 10.5v3"/>',
  car: '<path d="M5 16.5v-4l1.8-4.4A1.8 1.8 0 0 1 8.5 7h7a1.8 1.8 0 0 1 1.7 1.1l1.8 4.4v4"/><path d="M4 16.5h16"/><path d="M5 12.5h14"/><path d="M7 16.5v2.5M17 16.5v2.5"/>',
  play: '<path d="M7.5 5v14l11-7z"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  locate: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  chev: '<path d="m9.5 6 6 6-6 6"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  minus: '<path d="M5.5 12h13"/>',
  camera: '<path d="M4 8.5a2 2 0 0 1 2-2h1.8l1.4-2h5.6l1.4 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.8" r="3.2"/>',
  spark: '<path d="M12 3.5 13.7 9 19 10.8l-5.3 1.7L12 18l-1.7-5.5L5 10.8 10.3 9z"/><path d="M18.5 16.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z"/>',
  flame: '<path d="M12 3.5c.8 3.4 4.8 5 4.8 9.6a4.8 4.8 0 0 1-9.6 0c0-2.2 1.2-3.3 1.9-4.7.7 1.3 1.4 1.9 2.4 2-.4-2.3-.2-4.6.5-6.9z"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>',
  cat: '<path d="M5 20.5V12l-1-7.5L8.6 8h6.8L20 4.5 19 12v8.5z"/><path d="M9.5 13.5h.01M14.5 13.5h.01"/><path d="M10.8 16.5h2.4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  bell: '<path d="M6.5 9a5.5 5.5 0 1 1 11 0c0 6 2.5 7.5 2.5 7.5H4S6.5 15 6.5 9"/><path d="M10.2 20a2 2 0 0 0 3.6 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z"/>',
  cloud: '<path d="M7.2 18.5h9.6a4 4 0 0 0 .5-8 5.8 5.8 0 0 0-11 1.6 3.3 3.3 0 0 0 .9 6.4z"/>',
  partly: '<circle cx="8.5" cy="8" r="3"/><path d="M8.5 2.6v1.2M3.1 8h1.2M4.7 4.2l.8.8M12.3 4.2l-.8.8"/><path d="M9 19.5h8.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.4 1.3A2.9 2.9 0 0 0 9 19.5z"/>',
  rain: '<path d="M7.2 15.5h9.6a4 4 0 0 0 .5-8 5.8 5.8 0 0 0-11 1.6 3.3 3.3 0 0 0 .9 6.4z"/><path d="M8.5 18.5l-1 2M12.5 18.5l-1 2M16.5 18.5l-1 2"/>',
  storm: '<path d="M7.2 15h9.6a4 4 0 0 0 .5-8 5.8 5.8 0 0 0-11 1.6 3.3 3.3 0 0 0 .9 6.4z"/><path d="M12.5 15.5 10.5 19h3l-1.5 3"/>',
  fog: '<path d="M4 9.5h16M6 13.5h12M4 17.5h16"/>',
  plug: '<path d="M9 3v4.5M15 3v4.5"/><path d="M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5V21"/>',
  list: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.8 16a5 5 0 0 1 6.4 0"/><path d="M12 19.5h.01"/>',
  fit: '<path d="M4 9V4.5h4.5M20 9V4.5h-4.5M4 15v4.5h4.5M20 15v4.5h-4.5"/><circle cx="12" cy="12" r="2.5"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l5.5-5.5"/>',
  map: '<path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8z"/><path d="M9 4.5v12.7M15 6.8v12.7"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8.5 20.5h7"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  purifier: '<rect x="6" y="3" width="12" height="18" rx="3"/><path d="M9.5 7h5M9.5 10.5h5M9.5 14h5"/><path d="M10.5 18h3"/>',
  speaker: '<rect x="6" y="3" width="12" height="18" rx="2"/><circle cx="12" cy="14" r="3"/><path d="M12 7h.01"/>',
  check: '<path d="m5 12.5 4.3 4.3L19 7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4z"/>',
  quiet: '<path d="M4.5 14.5v-2.5a7.5 7.5 0 0 1 15 0v2.5"/><path d="M4.5 14.5a2 2 0 0 1 2-2h1v6h-1a2 2 0 0 1-2-2z"/><path d="M19.5 14.5a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2z"/><path d="M16.5 18.5c0 1.4-1.6 2-4.5 2"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.3 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M7.5 12.5h2.5l1.2-2.2 1.8 4.2 1.2-2h2.3"/>',
  leaf: '<path d="M5.5 18.5C5.5 10 11 5 19.5 4.5c-.5 8.5-5.5 14-14 14z"/><path d="M5.5 18.5 13 11"/>',
  chart: '<path d="M4 20.5h16"/><path d="M6.5 17v-5M10.5 17V8M14.5 17v-7M18.5 17V5"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.2 3 7.8 7 9 4-1.2 7-4.8 7-9V6z"/>',
};

const ic = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.power}</svg>`;

const WX = {
  'clear-night': ['moon', 'Clear'], cloudy: ['cloud', 'Cloudy'], exceptional: ['alert', 'Severe'], fog: ['fog', 'Fog'],
  hail: ['rain', 'Hail'], lightning: ['storm', 'Lightning'], 'lightning-rainy': ['storm', 'Storms'], partlycloudy: ['partly', 'Partly cloudy'],
  pouring: ['rain', 'Pouring'], rainy: ['rain', 'Rain'], snowy: ['snow', 'Snow'], 'snowy-rainy': ['rain', 'Sleet'],
  sunny: ['sun', 'Sunny'], windy: ['air', 'Windy'], 'windy-variant': ['air', 'Windy'],
};

const ICON_TONE = {
  bulb: 'amber', fan: 'cyan', purifier: 'mint', snow: 'water', flame: 'poor', drop: 'water', tv: 'violet',
  plug: 'cyan', power: 'cyan', spark: 'violet', robot: 'mint', lock: 'good', garage: 'amber', speaker: 'violet', thermo: 'amber',
};

export function entityIcon(st) {
  const d = domainOf(st.entity_id);
  const name = String(st.attributes?.friendly_name || st.entity_id);
  if (PURIFIER_RE.test(name)) return 'purifier';
  if (/\btv\b|television/i.test(name) || st.attributes?.device_class === 'tv') return 'tv';
  if (/dehumid|humidifier/i.test(name) || d === 'humidifier') return 'drop';
  if (/\bac\b|air condition/i.test(name)) return 'snow';
  if (/heater|blanket/i.test(name)) return 'flame';
  if (/light|lamp|bulb|recessed|island|\bled\b/i.test(name) || d === 'light') return 'bulb';
  if (/fan/i.test(name) || d === 'fan') return 'fan';
  if (/desk|plug|outlet/i.test(name) || st.attributes?.device_class === 'outlet') return 'plug';
  return { scene: 'spark', script: 'spark', lock: 'lock', cover: 'garage', media_player: 'speaker', climate: 'thermo', vacuum: 'robot' }[d] || 'power';
}

function isOn(st) {
  const d = domainOf(st.entity_id);
  if (d === 'cover') return st.state === 'open';
  if (d === 'lock') return st.state === 'unlocked';
  if (d === 'media_player') return ['playing', 'on'].includes(st.state);
  if (d === 'climate') return live(st) && st.state !== 'off';
  return st.state === 'on';
}

function tileState(st) {
  if (!live(st)) return 'Offline';
  const d = domainOf(st.entity_id);
  const a = st.attributes;
  if (d === 'scene') return 'Tap to run';
  if (d === 'script') return st.state === 'on' ? 'Running' : 'Tap to run';
  if (d === 'fan' && st.state === 'on' && toNum(a.percentage)) return `On · ${Math.round(a.percentage)}%`;
  if (d === 'light' && st.state === 'on' && toNum(a.brightness) !== null) return `On · ${Math.round(a.brightness / 2.55)}%`;
  if (d === 'climate') return `${titleCase(st.state.replace(/_/g, '/'))} · ${fmt(a.current_temperature)}°`;
  if (st.state === 'on') return 'On';
  if (st.state === 'off') return 'Off';
  return titleCase(st.state.replace(/_/g, ' '));
}

// ------------------------------------------------------------- rendering

function areaChart(values, { tone = 'cyan', id, lo = 0, hi } = {}) {
  const real = values.filter((v) => v !== null);
  if (real.length < 2) return null;
  const w = 300;
  const h = 100;
  const top = hi ?? Math.max(...real);
  const bottom = Math.min(lo ?? Math.min(...real), Math.min(...real));
  const span = top - bottom || 1;
  const pts = [];
  values.forEach((v, i) => {
    if (v !== null) pts.push([(i / (values.length - 1)) * w, 4 + (h - 8) * (1 - (v - bottom) / span)]);
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const area = `${line}L${pts[pts.length - 1][0].toFixed(1)} ${h}L${pts[0][0].toFixed(1)} ${h}Z`;
  const color = TONES[tone];
  const [lx, ly] = pts[pts.length - 1];
  return {
    svg: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".42"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`,
    dot: `<i class="cdot" style="left:${((lx / w) * 100).toFixed(2)}%;top:${((ly / h) * 100).toFixed(2)}%"></i>`,
    max: top,
  };
}

function timeOf(m, when) {
  const t = typeof when === 'number' ? when : Date.parse(when);
  return Number.isFinite(t) ? m.fmtTime(new Date(t)) : '';
}

function timeAxis(m, start, end) {
  const hours = Math.round((end - start) / 3600000);
  return `<div class="chart-x"><span>${hours}h ago</span><span>${Math.round(hours / 2)}h ago</span><span>Now</span></div>`;
}

function ringSvg(value, tone, size = 112, stroke = 9) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = clamp(value ?? 0, 0, 100) / 100;
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(124,214,255,.12)" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${TONES[tone]}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}" style="filter:drop-shadow(0 0 6px ${TONES[tone]})"/></svg>`;
}

function avatar(p, cls = '') {
  const initials = p.name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="ava ${cls}">${p.picture ? `<img src="${esc(p.picture)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(initials)}${p.driving ? `<i class="ava-b">${ic('car')}</i>` : ''}</span>`;
}

function batteryChip(p) {
  if (p.battery === null) return '';
  const low = p.battery <= 20 && !p.charging;
  return `<span class="batt ${low ? 'low' : ''}">${ic(p.charging ? 'bolt' : 'battery')}${fmt(p.battery)}%</span>`;
}

function emptyState(icon, title, text) {
  return `<div class="empty panel">${ic(icon)}<b>${esc(title)}</b><span>${esc(text)}</span></div>`;
}

function secHead(icon, title, tone, right = '') {
  return `<div class="sec-h"><h2 class="eyebrow t-${tone}">${ic(icon)}${esc(title)}</h2>${right}</div>`;
}

function menuButton(ui) {
  return ui.menu ? `<button class="icon-btn" data-act="menu" aria-label="Open the Home Assistant menu">${ic('menu')}</button>` : '';
}

function viewHead(ui, kicker, title, extra = '') {
  return `<header class="vh">${menuButton(ui)}<div class="vh-t"><div class="kicker">${esc(kicker)}</div><h1>${title}</h1></div>${extra}</header>`;
}

function linkTo(tab, label) {
  return `<button class="sec-link" data-act="tab" data-tab="${tab}">${esc(label)}${ic('chev')}</button>`;
}

// Home ---------------------------------------------------------------------

function viewHome(m, ui) {
  const now = new Date(m.now);
  const hour = now.getHours();
  const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Good night';
  const first = String(m.config.name || m.user?.name || '').split(' ')[0];
  const clock = m.clock(now);
  const urgent = m.alerts.filter((a) => a.level <= 1);
  const statusTone = m.alerts.some((a) => a.level === 0) ? 'bad' : urgent.length ? 'poor' : 'good';
  const status = urgent.length ? `<b>${urgent.length}</b> ${urgent.length === 1 ? 'thing needs' : 'things need'} attention` : 'All quiet at home';
  return `
    ${m.config.preview ? `<div class="preview t-violet">${ic('spark')}<span>${m.config.preview === true ? '<b>Preview.</b> Sample data.' : m.config.preview}</span></div>` : ''}
    <header class="hello">
      <div class="hello-row">
        ${menuButton(ui)}
        <div class="hello-text">
          <div class="kicker">${esc(m.fmtDate(now))}</div>
          <h1>${esc(greet)}${first ? `, ${esc(first)}` : ''}</h1>
        </div>
        <div class="clock" aria-label="Time"><b>${esc(clock.main)}</b>${clock.period ? `<small>${esc(clock.period)}</small>` : ''}</div>
      </div>
      <button class="status t-${statusTone}" data-act="sheet" data-sheet="alerts"><i class="dot"></i><span>${status}</span>${m.alerts.length ? ic('chev') : ''}</button>
      ${weatherStrip(m)}
    </header>
    ${heroFlow(m)}
    ${alertsBlock(m)}
    <div class="cols">
      ${airStrip(m)}
      ${peopleBlock(m)}
      ${robotsMini(m)}
      ${favoritesBlock(m, ui)}
      ${climateBlock(m, ui)}
      ${listsBlock(m)}
      ${camerasBlock(m)}
    </div>
    <footer class="foot">Nourie Home ${VERSION} · updated ${esc(m.fmtTime(now))}</footer>`;
}

function weatherStrip(m) {
  const w = m.weather;
  if (!w.has) return '';
  const [icon, label] = WX[w.condition] || ['thermo', 'Outside'];
  const hours = w.forecast.length
    ? `<div class="hours">${w.forecast.map((f) => {
      const [fi] = WX[f.condition] || ['cloud'];
      const t = new Date(f.datetime);
      if (Number.isNaN(t.getTime())) return '';
      const when = w.forecastType === 'hourly' ? m.hourLabel(t) : m.dayLabel(t);
      const pop = toNum(f.precipitation_probability);
      return `<div class="hour"><span>${esc(when)}</span>${ic(fi)}<b>${fmt(f.temperature)}°</b>${pop ? `<i>${fmt(pop)}%</i>` : '<i>&nbsp;</i>'}</div>`;
    }).join('')}</div>`
    : '';
  const meta = [
    w.feels !== null ? `<span>Feels <b>${fmt(w.feels)}°</b></span>` : '',
    w.humidity !== null ? `<span>${ic('drop')}<b>${fmt(w.humidity)}%</b></span>` : '',
    w.dew !== null ? `<span>Dew <b>${fmt(w.dew)}°</b></span>` : w.wind !== null ? `<span>${ic('air')}<b>${fmt(w.wind)}</b> ${esc(w.windUnit)}</span>` : '',
  ].filter(Boolean).join('');
  return `<button class="wx" data-act="more" data-entity="${esc(w.id || w.tempId || '')}">
      <span class="wx-ic">${ic(icon)}</span>
      <span class="wx-t"><b>${fmt(w.temp)}°</b><small>${esc(w.condition ? label : 'Outside')}</small></span>
      <span class="wx-m">${meta}</span>
    </button>${hours}`;
}

function heroFlow(m) {
  const e = m.energy;
  const w = m.water;
  const a = m.air;
  const home = m.people.filter((p) => p.isHome).length;
  const watts = e.totalW ?? 0;
  const pw = powerParts(e.totalW);
  const flowing = (w.flow ?? 0) > 0.05;
  const dur = (base, rate) => `${clamp(base - rate, 0.45, base).toFixed(2)}s`;
  const airTone = a.level === null ? 'dim' : LEVEL_TONES[a.level];
  const lines = [];
  const nodes = [];
  if (e.has) {
    lines.push(`<path class="ln-base" style="stroke:${TONES.amber}" d="M92 70 C 114 80, 122 100, 128 124"/><path class="ln ${watts < 5 ? 'idle' : ''}" style="stroke:${TONES.amber};--dur:${dur(2.6, watts / 2500)}" d="M92 70 C 114 80, 122 100, 128 124"/>`);
    nodes.push(`<button class="node t-amber" style="left:17.2%;top:19.9%" data-act="tab" data-tab="energy" aria-label="Electric use ${esc(pw.v)} ${esc(pw.u)}">${ic('bolt')}<span class="node-v">${esc(pw.v)}<small>${esc(pw.u)}</small></span><span class="node-l">Electric</span></button>`);
  }
  if (w.has) {
    lines.push(`<path class="ln-base" style="stroke:${TONES.water}" d="M268 70 C 246 80, 238 100, 232 124"/><path class="ln ${flowing ? '' : 'idle'}" style="stroke:${TONES.water};--dur:${dur(2.4, (w.flow ?? 0) / 2)}" d="M268 70 C 246 80, 238 100, 232 124"/>`);
    nodes.push(`<button class="node t-water" style="left:82.8%;top:19.9%" data-act="tab" data-tab="energy" aria-label="Water flow ${fmt(w.flow, 1)} ${esc(w.flowUnit)}">${ic('drop')}<span class="node-v">${fmt(w.flow, 1)}<small>${w.flowUnit === 'L/min' ? 'L/m' : 'gpm'}</small></span><span class="node-l">${flowing ? 'Flowing' : 'Water'}</span></button>`);
  }
  if (a.rooms.length) {
    lines.push(`<path class="ln-base" style="stroke:${TONES[airTone]}" d="M92 206 C 110 202, 120 196, 131 188"/><path class="ln" style="stroke:${TONES[airTone]};--dur:3.4s" d="M92 206 C 110 202, 120 196, 131 188"/>`);
    nodes.push(`<button class="node t-${airTone}" style="left:17.2%;top:80.1%" data-act="tab" data-tab="air" aria-label="Air score ${fmt(a.score)}">${ic('air')}<span class="node-v">${fmt(a.score)}</span><span class="node-l">${a.level === null ? 'Air' : `${LEVEL_LABELS[a.level]} air`}</span></button>`);
  }
  if (m.people.length) {
    lines.push(`<path class="ln-base" style="stroke:${TONES.violet}" d="M268 206 C 250 202, 240 196, 229 188"/><path class="ln ${m.people.some((p) => p.driving) ? '' : 'slow'}" style="stroke:${TONES.violet};--dur:${m.people.some((p) => p.driving) ? '1.2s' : '3.8s'}" d="M268 206 C 250 202, 240 196, 229 188"/>`);
    nodes.push(`<button class="node t-violet" style="left:82.8%;top:80.1%" data-act="tab" data-tab="map" aria-label="${home} of ${m.people.length} people home">${ic('pin')}<span class="node-v">${home}<small>/${m.people.length}</small></span><span class="node-l">Home</span></button>`);
  }
  const lit = m.lightsOn;
  return `<section class="flow" aria-label="Home at a glance">
      <svg class="flow-svg" viewBox="0 0 360 272" aria-hidden="true">
        <defs>
          <radialGradient id="nh-floor"><stop offset="0" stop-color="#4de3ff" stop-opacity=".32"/><stop offset="1" stop-color="#4de3ff" stop-opacity="0"/></radialGradient>
          <filter id="nh-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <ellipse cx="180" cy="200" rx="124" ry="18" fill="url(#nh-floor)"/>
        <path d="M66 200 H294" stroke="rgba(124,214,255,.18)" stroke-width="1"/>
        ${lines.join('')}
        <g class="house" filter="url(#nh-glow)">
          <path d="M116 136 L180 82 L244 136"/>
          <path d="M131 124 V198 H229 V124"/>
          <path d="M206 104 V88 H218 V114"/>
          <rect class="win ${lit > 0 ? 'lit' : ''}" x="146" y="142" width="21" height="17" rx="2.5"/>
          <rect class="win ${lit > 1 ? 'lit' : ''}" x="193" y="142" width="21" height="17" rx="2.5"/>
          <path d="M169 198 V168 H191 V198"/>
        </g>
      </svg>
      ${nodes.join('')}
    </section>`;
}

function alertRow(a, i) {
  const tone = ['bad', 'poor', 'fair', 'dim'][a.level] || 'dim';
  return `<button class="alert t-${tone}" data-act="alert" data-i="${i}"><span class="al-ic">${ic(a.icon)}</span><span class="al-t"><b>${esc(a.title)}</b><small>${esc(a.detail)}</small></span>${ic('chev')}</button>`;
}

function alertsBlock(m) {
  if (!m.alerts.length) return '';
  const shown = m.alerts.slice(0, 3);
  return `<section class="alerts" aria-label="Alerts">${shown.map((a, i) => alertRow(a, i)).join('')}${m.alerts.length > 3 ? `<button class="more" data-act="sheet" data-sheet="alerts">See all ${m.alerts.length} alerts</button>` : ''}</section>`;
}

function airStrip(m) {
  const a = m.air;
  if (!a.rooms.length) return '';
  return `<section class="block">
      ${secHead('air', 'Air right now', a.level === null ? 'cyan' : LEVEL_TONES[a.level], linkTo('air', 'Rooms'))}
      <div class="hscroll">${a.rooms.map((r) => {
        const def = AIR_METRICS[r.primary.metric];
        return `<button class="aq t-${LEVEL_TONES[r.level]}" data-act="tab" data-tab="air"><span class="aq-n"><i class="dot"></i>${esc(r.name)}</span><span class="aq-v"><b>${fmt(r.primary.value, def.digits)}</b><small>${esc(def.unit || def.label)}</small></span><span class="aq-l">${esc(def.label)} · ${LEVEL_LABELS[r.level]}</span></button>`;
      }).join('')}</div>
    </section>`;
}

function peopleBlock(m) {
  if (!m.people.length) return '';
  return `<section class="block">
      ${secHead('pin', 'Family', 'violet', linkTo('map', 'Map'))}
      <div class="hscroll people">${m.people.map((p) => `<button class="person ${p.isHome ? 'home' : 'away'}" data-act="person" data-id="${esc(p.id)}" data-entity="${esc(p.id)}" style="--pc:${p.color}">${avatar(p)}<span class="p-n">${esc(p.first)}</span><span class="p-s">${esc(personStatus(p, m.units, true))}</span></button>`).join('')}</div>
    </section>`;
}

function robotsMini(m) {
  if (!m.robots.length) return '';
  return `<section class="block">
      ${secHead('robot', 'Robots', 'mint', linkTo('robots', 'All'))}
      <div class="hscroll">${m.robots.map((r) => `<button class="rmini t-${r.tone} ${r.state}" data-act="tab" data-tab="robots" data-entity="${esc(r.id)}"><span class="rmini-ic">${ic(r.litter ? 'cat' : 'robot')}</span><span class="rmini-t"><b>${esc(r.name)}</b><small>${esc(r.statusText)}${r.battery !== null && !r.litter ? ` · ${fmt(r.battery)}%` : ''}</small></span></button>`).join('')}</div>
    </section>`;
}

function tile(m, id, ui) {
  const st = m.states[id];
  if (!st) return '';
  const icon = entityIcon(st);
  const on = isOn(st);
  const busy = ui.pending[id] ? 'busy' : '';
  return `<button class="tile t-${ICON_TONE[icon] || 'cyan'} ${on ? 'on' : ''} ${live(st) ? '' : 'gone'} ${icon === 'fan' ? 'spin' : ''} ${busy}" data-act="toggle" data-entity="${esc(id)}" aria-pressed="${on}"><span class="tile-ic">${ic(icon)}</span><span class="tile-n">${esc(cleanName(st.attributes.friendly_name || id))}</span><span class="tile-s">${esc(tileState(st))}</span></button>`;
}

function switchRow(m, id, ui) {
  const st = m.states[id];
  if (!st) return '';
  const on = st.state === 'on';
  return `<button class="row ${ui.pending[id] ? 'busy' : ''}" data-act="toggle" data-entity="${esc(id)}" aria-pressed="${on}"><span class="row-l">${ic(entityIcon(st))}${esc(cleanName(st.attributes.friendly_name || id))}</span><span class="switch ${on ? 'on' : ''} ${live(st) ? '' : 'gone'}"><i></i></span></button>`;
}

function favoritesBlock(m, ui) {
  const f = m.favorites;
  if (!f.ids.length) return '';
  const title = f.source === 'learned' ? 'Most used' : f.source === 'config' ? 'Favorites' : 'Quick controls';
  const note = f.source === 'learned' ? '<small class="sec-note">From the last 5 days</small>' : '';
  return `<section class="block">${secHead('spark', title, 'cyan', note)}<div class="tiles">${f.ids.map((id) => tile(m, id, ui)).join('')}</div></section>`;
}

function stepper(c, which, value, label, ui) {
  const shown = ui.clim[c.id]?.[which] ?? value;
  return `<div class="stepper"><button data-act="temp" data-entity="${esc(c.id)}" data-which="${which}" data-delta="-1" aria-label="Lower ${esc(label)}">${ic('minus')}</button><span class="tgt"><b>${fmt(shown, c.step < 1 ? 1 : 0)}°</b><small>${esc(label)}</small></span><button data-act="temp" data-entity="${esc(c.id)}" data-which="${which}" data-delta="1" aria-label="Raise ${esc(label)}">${ic('plus')}</button></div>`;
}

const HVAC_LABEL = { off: 'Off', heat: 'Heat', cool: 'Cool', heat_cool: 'Auto', auto: 'Auto', dry: 'Dry', fan_only: 'Fan' };
const HVAC_TONE = { heat: 'poor', cool: 'water', heat_cool: 'mint', auto: 'mint', dry: 'amber', fan_only: 'cyan', off: 'dim' };

function climateCard(c, ui) {
  const action = c.action || c.mode;
  const actionLabel = { heating: 'Heating', cooling: 'Cooling', idle: 'Idle', off: 'Off', fan: 'Fan', drying: 'Drying', preheating: 'Preheating' }[action] || HVAC_LABEL[action] || titleCase(action);
  const actionTone = { heating: 'poor', cooling: 'water', idle: 'dim', off: 'dim', fan: 'cyan', drying: 'amber' }[action] || HVAC_TONE[action] || 'dim';
  const range = (c.mode === 'heat_cool' || c.target === null) && c.low !== null && c.high !== null;
  const steppers = c.mode === 'off'
    ? '<span class="clim-off">Off</span>'
    : range
      ? `<div class="dual">${stepper(c, 'low', c.low, 'Heat to', ui)}${stepper(c, 'high', c.high, 'Cool to', ui)}</div>`
      : c.target !== null ? stepper(c, 'target', c.target, 'Set to', ui) : '';
  const modes = c.modes.filter((x) => HVAC_LABEL[x]).slice(0, 5);
  return `<article class="clim panel ${range ? 'wide' : ''}" data-key="${esc(c.id)}">
      <div class="clim-top"><button class="clim-name" data-act="more" data-entity="${esc(c.id)}">${esc(c.name)}</button><span class="pill t-${actionTone}">${ic(actionTone === 'poor' ? 'flame' : actionTone === 'water' ? 'snow' : 'thermo')}${esc(actionLabel)}</span></div>
      <div class="clim-mid ${range ? 'stack' : ''}"><div class="clim-now"><b>${fmt(c.current, c.current !== null && c.current % 1 ? 1 : 0)}°</b><small>Inside${c.humidity !== null ? ` · ${fmt(c.humidity)}%` : ''}</small></div>${steppers}</div>
      ${modes.length > 1 ? `<div class="modes">${modes.map((x) => `<button class="mode t-${HVAC_TONE[x] || 'cyan'} ${x === c.mode ? 'on' : ''}" data-act="hvac" data-entity="${esc(c.id)}" data-mode="${esc(x)}">${HVAC_LABEL[x]}</button>`).join('')}</div>` : ''}
    </article>`;
}

function climateBlock(m, ui) {
  if (!m.climate.length) return '';
  return `<section class="block">${secHead('thermo', 'Climate', 'amber')}<div class="hscroll ${m.climate.length === 1 ? 'single' : ''}">${m.climate.map((c) => climateCard(c, ui)).join('')}</div></section>`;
}

function listsBlock(m) {
  if (!m.lists.length) return '';
  return `<section class="block">${secHead('list', 'Lists', 'violet')}<div class="chips">${m.lists.map((l) => `<button class="chip" data-act="nav" data-path="/todo?entity_id=${esc(l.id)}" data-entity="${esc(l.id)}">${ic('list')}${esc(l.name)} <b>${l.count}</b></button>`).join('')}</div></section>`;
}

function camerasBlock(m) {
  if (!m.cameras.length) return '';
  const tick = Math.floor(m.now / 20000);
  return `<section class="block">${secHead('camera', 'Cameras', 'cyan')}<div class="cams">${m.cameras.map((c) => `<button class="cam" data-act="more" data-entity="${esc(c.id)}">${c.picture ? `<img src="${esc(c.picture)}${c.picture.includes('?') ? '&' : '?'}_nh=${tick}" alt="" loading="lazy">` : ''}<span>${esc(c.name)}</span></button>`).join('')}</div></section>`;
}

// Air ----------------------------------------------------------------------

function scaleStyle(metric, value) {
  const def = AIR_METRICS[metric];
  const s = def.steps;
  if (def.invert) value = 100 - value;
  const max = s[3] * 1.3;
  const p = (x) => `${((x / max) * 100).toFixed(1)}%`;
  return { style: `--s1:${p(s[0])};--s2:${p(s[1])};--s3:${p(s[2])};--s4:${p(s[3])}`, pos: `${clamp((value / max) * 100, 1.5, 98.5).toFixed(1)}%` };
}

function roomCard(m, r) {
  const def = AIR_METRICS[r.primary.metric];
  const tone = LEVEL_TONES[r.level];
  const hist = m.history.air;
  let spark = '';
  if (hist?.series?.[r.primary.id]) {
    const chart = areaChart(resample(hist.series[r.primary.id], hist.start, hist.end, 72), { tone, id: `nh-a-${r.key.replace(/[^a-z0-9]/gi, '')}`, lo: Math.min(def.steps[0] * 0.5, r.primary.value) });
    if (chart) spark = `${chart.svg}${chart.dot}`;
  }
  const scale = scaleStyle(r.primary.metric, r.primary.value);
  const rated = (x) => x.metric !== 'aqi' || Object.keys(r.metrics).length === 1;
  const others = Object.values(r.metrics).filter((x) => x !== r.primary).map((x) => {
    const d = AIR_METRICS[x.metric];
    return rated(x)
      ? `<span class="chip t-${LEVEL_TONES[x.level]}"><i class="dot"></i>${esc(d.label)} <b>${fmt(x.value, d.digits)}</b></span>`
      : `<span class="chip">${esc(d.label)} <b>${fmt(x.value, d.digits)}</b></span>`;
  });
  if (r.temp) others.push(`<span class="chip">${ic('thermo')}<b>${fmt(r.temp.value, 1)}°</b></span>`);
  if (r.hum) others.push(`<span class="chip">${ic('drop')}<b>${fmt(r.hum.value)}%</b></span>`);
  return `<article class="room panel t-${tone}" data-key="${esc(r.key)}">
      <header class="room-h"><div><h3>${esc(r.name)}</h3>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div><span class="pill t-${tone}">${LEVEL_LABELS[r.level]}</span></header>
      <button class="room-main" data-act="more" data-entity="${esc(r.primary.id)}" aria-label="${esc(r.name)} ${esc(def.label)} history">
        <span class="room-big"><b>${fmt(r.primary.value, def.digits)}</b><span>${esc(def.unit)} ${esc(def.label)}</span></span>
        <span class="room-spark">${spark}</span>
      </button>
      <div class="scale" style="${scale.style}" aria-hidden="true"><i style="left:${scale.pos}"></i></div>
      ${others.length ? `<div class="chips">${others.join('')}</div>` : ''}
    </article>`;
}

function purifierCard(p) {
  return `<article class="pur panel ${p.on ? 'on' : ''} ${p.live ? '' : 'gone'}" data-key="${esc(p.id)}">
      <button class="pur-btn" data-act="toggle" data-entity="${esc(p.id)}" aria-pressed="${p.on}" aria-label="${p.on ? 'Turn off' : 'Turn on'} ${esc(p.name)}">${ic(PURIFIER_RE.test(p.name) ? 'purifier' : 'fan')}</button>
      <button class="pur-info" data-act="more" data-entity="${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc([p.area, !p.live ? 'Offline' : p.on ? (p.preset || (p.pct !== null ? `${fmt(p.pct)}%` : 'On')) : 'Off'].filter(Boolean).join(' · '))}</small></button>
      ${p.speeds.length && p.live ? `<div class="seg t-mint">${p.speeds.map((s) => `<button class="${p.on && p.pct !== null && Math.abs(p.pct - s) < 3 ? 'on' : ''}" data-act="fanpct" data-entity="${esc(p.id)}" data-pct="${s}">${s}%</button>`).join('')}</div>` : ''}
      ${p.presets.length && p.live ? `<div class="chips">${p.presets.map((x) => `<button class="mode t-mint ${p.on && x === p.preset ? 'on' : ''}" data-act="preset" data-entity="${esc(p.id)}" data-preset="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
    </article>`;
}

function viewAir(m, ui) {
  const a = m.air;
  const head = viewHead(ui, 'Indoor air', 'Air quality');
  if (!a.rooms.length) return `${head}${emptyState('air', 'No air sensors yet', 'Add CO₂ or PM2.5 sensors to Home Assistant, or list them under air_quality in the dashboard settings.')}`;
  const tone = a.level === null ? 'dim' : LEVEL_TONES[a.level];
  const worst = a.worst && a.worst.level >= 2 && a.worst.worst ? (() => {
    const def = AIR_METRICS[a.worst.worst.metric];
    return `${a.worst.name} reads ${fmt(a.worst.worst.value, def.digits)} ${def.unit} ${def.label}.`;
  })() : 'Every room is in a healthy range.';
  return `${head}
    <section class="air-hero panel t-${tone}">
      <div class="ring">${ringSvg(a.score, tone)}<div class="ring-v"><b>${fmt(a.score)}</b><small>AIR SCORE</small></div></div>
      <div class="air-sum"><span class="pill t-${tone}">${a.level === null ? 'No data' : `${LEVEL_LABELS[a.level]} overall`}</span><h2>Good air in ${a.good} of ${a.rooms.length} ${a.rooms.length === 1 ? 'room' : 'rooms'}</h2><p>${esc(worst)}</p></div>
    </section>
    ${a.tips.length ? `<section class="tips">${a.tips.map((t) => `<div class="tip t-${t.tone}">${ic(t.icon)}<span>${esc(t.text)}</span>${t.action ? `<button class="tip-act" data-act="toggle" data-entity="${esc(t.action.entity)}">${esc(t.action.label)}</button>` : ''}</div>`).join('')}</section>` : ''}
    <section class="block">${secHead('home', 'Rooms', 'cyan', '<small class="sec-note">Last 24 hours</small>')}<div class="rooms">${a.rooms.map((r) => roomCard(m, r)).join('')}</div></section>
    ${a.purifiers.length ? `<section class="block">${secHead('purifier', 'Purifiers', 'mint')}<div class="purs">${a.purifiers.map(purifierCard).join('')}</div></section>` : ''}
    <section class="legend panel"><b>How rooms are rated</b><span>CO₂: under 1,000 ppm is good, over 1,500 ppm feels stuffy. PM2.5: under 12 µg/m³ is good, over 35 µg/m³ is unhealthy for sensitive people. The score is the worst reading in each room, averaged across rooms.</span></section>`;
}

// Map ----------------------------------------------------------------------

function radarHtml(m, ui) {
  const metric = m.units.metric;
  const unit = metric ? 'km' : 'mi';
  const toUnit = (km) => (metric ? km : km * 0.621371);
  const R0 = 24;
  const R1 = 92;
  const MAX = 300;
  const rOf = (d) => R0 + (Math.log10(1 + d) / Math.log10(1 + MAX)) * (R1 - R0);
  const rings = [1, 10, 100].map((d) => ({ d, r: rOf(d) }));
  const athome = m.people.filter((p) => p.isHome || (p.distKm !== null && toUnit(p.distKm) < 0.1));
  const away = m.people.filter((p) => !athome.includes(p) && p.bearing !== null);
  const marks = [];
  athome.forEach((p, i) => {
    const ang = (i / athome.length) * 2 * Math.PI - Math.PI / 2;
    marks.push({ p, x: Math.cos(ang) * 24, y: Math.sin(ang) * 24, fixed: true });
  });
  for (const p of away) {
    const r = Math.min(R1, rOf(toUnit(p.distKm)));
    const b = (p.bearing * Math.PI) / 180;
    marks.push({ p, x: Math.sin(b) * r, y: -Math.cos(b) * r, d: true });
  }
  spreadMarks([{ x: 0, y: 0, fixed: true }, ...marks]);
  const svg = `<svg class="radar-svg" viewBox="-100 -100 200 200" aria-hidden="true">
      <circle class="rr" r="${R1}"/>${rings.map((g) => `<circle class="rr dash" r="${g.r.toFixed(1)}"/><text class="rl" x="2" y="${(-g.r + 7).toFixed(1)}">${g.d} ${unit}</text>`).join('')}
      <path class="rx" d="M0 -${R1} V${R1} M-${R1} 0 H${R1}"/>
      <text class="rl n" x="0" y="-${R1 + 3}" text-anchor="middle">N</text>
    </svg>`;
  const pins = marks.map(({ p, x, y, d }) => `<button class="rm ${ui.focus === p.id ? 'on' : ''} ${d ? '' : 'home'}" style="left:${(50 + x / 2).toFixed(2)}%;top:${(50 + y / 2).toFixed(2)}%;--pc:${p.color}" data-act="focus" data-id="${esc(p.id)}" aria-label="${esc(p.name)}${d ? `, ${esc(fmtDistance(p.distKm, metric))} away` : ', home'}">${avatar(p, 'sm')}${d ? `<span class="rm-l">${esc(p.first)} · ${esc(fmtDistance(p.distKm, metric))}</span>` : ''}</button>`).join('');
  return `<div class="radar-box"><div class="sweep"></div>${svg}<span class="rm-home">${ic('home')}</span>${pins}</div>`;
}

// Pushes radar markers apart until avatar-plus-label blocks stop overlapping (units are a 200-wide box).
export function spreadMarks(marks, w = 54, h = 36) {
  for (let round = 0; round < 40; round += 1) {
    let moved = false;
    for (let i = 0; i < marks.length; i += 1) {
      for (let j = i + 1; j < marks.length; j += 1) {
        const a = marks[i];
        const b = marks[j];
        if (a.fixed && b.fixed) continue;
        const dx = (b.x - a.x) / w;
        const dy = (b.y - a.y) / h;
        const dist = Math.hypot(dx, dy);
        if (dist >= 1) continue;
        const ux = dist ? dx / dist : 1;
        const uy = dist ? dy / dist : 0;
        const push = (1 - dist) * (a.fixed || b.fixed ? 1 : 0.5) + 0.01;
        if (!a.fixed) { a.x -= ux * push * w; a.y -= uy * push * h; }
        if (!b.fixed) { b.x += ux * push * w; b.y += uy * push * h; }
        moved = true;
      }
    }
    for (const mk of marks) {
      mk.x = clamp(mk.x, -88, 88);
      mk.y = clamp(mk.y, -90, 86);
    }
    if (!moved) break;
  }
  return marks;
}

function personCard(m, p, ui) {
  const status = personStatus(p, m.units);
  const at = timeOf(m, p.since);
  const meta = [
    at && p.isHome ? `Home since ${at}` : at && (p.zone || p.place) ? `Since ${at}` : '',
    !p.isHome && p.distKm !== null ? `${fmtDistance(p.distKm, m.units.metric)} away` : '',
    p.seen && m.now - Date.parse(p.seen) > 15 * 60000 ? `Updated ${since(p.seen, m.now)} ago` : '',
  ].filter(Boolean).join(' · ');
  return `<button class="pcard ${ui.focus === p.id ? 'on' : ''}" data-act="focus" data-id="${esc(p.id)}" data-entity="${esc(p.id)}" data-key="${esc(p.id)}" style="--pc:${p.color}">
      ${avatar(p, 'md')}
      <span class="pc-body"><b>${esc(p.name)}</b><span class="pc-st">${ic(p.driving ? 'car' : p.isHome ? 'home' : 'pin')}${esc(status)}</span><span class="pc-meta">${esc(meta)}</span>${p.address && !p.isHome ? `<span class="pc-meta">${esc(p.address)}</span>` : ''}</span>
      ${batteryChip(p)}
    </button>`;
}

function viewMapUi(m, ui, tiles) {
  const mode = tiles ? ui.mapMode : 'radar';
  const home = m.people.filter((p) => p.isHome).length;
  return `${mode === 'radar' ? `<div class="radar">${radarHtml(m, ui)}</div>` : ''}
    <div class="map-top">
      ${ui.menu ? `<button class="icon-btn glass" data-act="menu" aria-label="Open the Home Assistant menu">${ic('menu')}</button>` : ''}
      <div class="map-title glass"><span class="kicker">Family</span><b>${m.people.length ? `${home} of ${m.people.length} home` : 'No one yet'}</b></div>
      ${tiles ? `<div class="seg glass t-cyan"><button class="${mode === 'map' ? 'on' : ''}" data-act="mapmode" data-mode="map">${ic('map')}Map</button><button class="${mode === 'radar' ? 'on' : ''}" data-act="mapmode" data-mode="radar">${ic('radar')}Radar</button></div>` : ''}
      ${tiles && mode === 'map' ? `<button class="icon-btn glass" data-act="fit" aria-label="Show everyone">${ic('fit')}</button>` : ''}
    </div>
    ${ui.mapError && mode === 'map' ? `<div class="map-msg glass">${ic('alert')}<span>The map could not load. Check the internet connection, or use Radar.</span></div>` : ''}
    <div class="map-sheet">${m.people.length ? `<div class="pcards">${m.people.map((p) => personCard(m, p, ui)).join('')}</div>` : `<div class="map-msg glass">${ic('pin')}<span>Add the Life360 integration (or a person with a phone tracker) and everyone shows up here.</span></div>`}</div>`;
}

// Energy -------------------------------------------------------------------

function viewEnergy(m, ui) {
  const e = m.energy;
  const w = m.water;
  const jump = e.has && w.has ? `<div class="seg t-cyan"><button data-act="jump" data-to="electric">${ic('bolt')}Electric</button><button data-act="jump" data-to="water">${ic('drop')}Water</button></div>` : '';
  const parts = [viewHead(ui, 'Usage', 'Energy &amp; water', jump)];
  if (e.has) parts.push(electricBlock(m, ui));
  if (w.has) parts.push(waterBlock(m));
  if (!e.has && !w.has) parts.push(emptyState('bolt', 'No meters yet', 'Connect Emporia Vue and Flume in Home Assistant and your electric and water use shows up here.'));
  return parts.join('');
}

function electricBlock(m, ui) {
  const e = m.energy;
  const pw = powerParts(e.totalW);
  const hist = m.history.power;
  let chart = '<div class="chart loading"></div>';
  if (hist && hist.series) {
    const series = e.chartIds.map((id) => resample(hist.series[id] || [], hist.start, hist.end, 96));
    const total = sumSeries(series).map((v) => (v === null ? null : v / 1000));
    const c = areaChart(total, { tone: 'amber', id: 'nh-power', lo: 0 });
    chart = c ? `<div class="chart"><span class="chart-y">${fmt(c.max, c.max < 10 ? 1 : 0)} kW</span>${c.svg}${c.dot}${timeAxis(m, hist.start, hist.end)}</div>` : '<div class="chart empty-chart">No history yet</div>';
  }
  const max = Math.max(1, ...e.circuits.map((c) => c.watts || 0));
  const folded = e.circuits.length > 10 && !ui.allCircuits;
  const circuits = folded ? e.circuits.slice(0, 8) : e.circuits;
  return `<section class="panel hero2 t-amber" id="nh-electric">
      <div class="hero2-top"><h2 class="eyebrow t-amber">${ic('bolt')}Electric</h2><span class="live"><i></i>Live</span></div>
      <div class="big"><b>${esc(pw.v)}</b><span>${esc(pw.u)}</span></div>
      <div class="sub">${[
        e.today !== null ? `Today <b>${fmt(e.today, e.today < 100 ? 1 : 0)} kWh</b>` : '',
        e.month !== null ? `This month <b>${fmt(e.month, 0)} kWh</b>` : '',
        e.monthCost !== null ? `<b>${esc(e.currency)}${fmt(e.monthCost, 2)}</b> so far` : '',
      ].filter(Boolean).join(' · ')}</div>
      ${chart}
      ${e.estimated && e.circuits.length ? '<small class="note">Total adds up the circuits Emporia monitors.</small>' : ''}
    </section>
    ${e.circuits.length ? `<section class="block">${secHead('plug', 'Circuits', 'amber', '<small class="sec-note">Using now · today</small>')}<div class="panel bars t-amber">${circuits.map((c) => `<button class="bar-row" data-act="more" data-entity="${esc(c.powerId || c.todayId)}"><span class="bar-n">${esc(c.name)}</span><span class="bar-v">${c.watts === null ? '—' : esc(powerParts(c.watts).v)}<small>${c.watts === null ? '' : esc(powerParts(c.watts).u)}${c.today !== null ? ` · ${fmt(c.today, 1)} kWh` : ''}</small></span><span class="bar-t"><i style="width:${(((c.watts || 0) / max) * 100).toFixed(1)}%"></i></span></button>`).join('')}${e.circuits.length > 10 ? `<button class="more" data-act="circuits">${folded ? `Show all ${e.circuits.length}` : 'Show fewer'}</button>` : ''}</div></section>` : ''}
    ${e.plugs.length ? `<section class="block">${secHead('power', 'Smart plugs', 'amber')}<div class="panel rows">${e.plugs.map((id) => switchRow(m, id, ui)).join('')}</div></section>` : ''}
    ${e.costs.length ? `<section class="block">${secHead('bolt', 'Cost this month', 'amber')}<div class="panel rows">${e.costs.map((c) => `<button class="row" data-act="more" data-entity="${esc(c.id)}"><span>${esc(c.name.replace(/\s*(energy )?cost( this month)?$/i, '') || c.name)}</span><b>${esc(c.unit === '$' || c.unit === 'USD' ? '$' : '')}${fmt(c.value, 2)}${c.unit !== '$' && c.unit !== 'USD' ? ` ${esc(c.unit)}` : ''}</b></button>`).join('')}</div></section>` : ''}`;
}

function waterBlock(m) {
  const w = m.water;
  const flowing = (w.flow ?? 0) > 0.05;
  const hist = m.history.water;
  let chart = '<div class="chart loading"></div>';
  if (hist && hist.series && w.flowId) {
    const perHour = resample(hist.series[w.flowId] || [], hist.start, hist.end, 24).map((v) => (v === null ? null : v * 60));
    const max = Math.max(1, ...perHour.filter((v) => v !== null));
    chart = `<div class="chart bars24"><span class="chart-y">${fmt(max)} ${esc(w.volumeUnit)}/hr</span><div class="b24">${perHour.map((v) => `<i style="height:${v === null ? 0 : Math.max(2, (v / max) * 100).toFixed(1)}%"></i>`).join('')}</div>${timeAxis(m, hist.start, hist.end)}</div>`;
  }
  const status = w.leak ? ['bad', 'Leak detected'] : w.high ? ['poor', 'High flow'] : w.offline ? ['dim', 'Bridge offline'] : ['good', 'No leaks'];
  return `<section class="panel hero2 t-water" id="nh-water">
      <div class="hero2-top"><h2 class="eyebrow t-water">${ic('drop')}Water</h2><span class="pill t-${status[0]}">${esc(status[1])}</span></div>
      <div class="big"><b>${fmt(w.flow, 1)}</b><span>${esc(w.flowUnit)}</span>${flowing ? '<span class="ripples" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}</div>
      <div class="sub">${flowing ? 'Water is running right now' : 'No water running'}${w.lowBattery ? ' · <b>Flume battery is low</b>' : ''}</div>
      <div class="stat3">
        <button class="stat" data-act="more" data-entity="${esc(w.todayId || '')}"><small>Today</small><b>${fmt(w.today, w.today !== null && w.today < 10 ? 1 : 0)}</b><span>${esc(w.volumeUnit)}</span></button>
        <div class="stat"><small>This week</small><b>${fmt(w.week, 0)}</b><span>${esc(w.volumeUnit)}</span></div>
        <div class="stat"><small>This month</small><b>${fmt(w.month, 0)}</b><span>${esc(w.volumeUnit)}</span></div>
      </div>
      ${chart}
    </section>`;
}

// Robots -------------------------------------------------------------------

function robotCard(r, extra = '') {
  const circ = 2 * Math.PI * 35;
  const b = r.battery;
  const id = esc(r.id);
  const act = (svc, label, icon, primary = false) => `<button class="act ${primary ? 'primary' : ''}" data-act="vac" data-svc="${svc}" data-entity="${id}">${ic(icon)}${esc(label)}</button>`;
  const acts = [];
  if (r.litter) {
    acts.push(act('start', 'Clean now', 'spark', true));
    acts.push(`<button class="act" data-act="more" data-entity="${id}">${ic('cat')}Details</button>`);
  } else {
    if (r.state === 'cleaning') { if (r.can.pause) acts.push(act('pause', 'Pause', 'pause', true)); } else if (r.can.start) acts.push(act('start', r.state === 'paused' ? 'Resume' : 'Clean', 'play', true));
    if (r.can.dock) acts.push(act('return_to_base', 'Dock', 'home'));
    if (r.can.locate) acts.push(act('locate', 'Find', 'locate'));
  }
  return `<article class="panel robot ${esc(r.state)} t-${r.tone}" data-key="${id}">
      <div class="rb-top">
        <button class="rb-disc" data-act="more" data-entity="${id}" aria-label="${esc(r.name)} details">
          <svg viewBox="0 0 78 78" aria-hidden="true"><circle cx="39" cy="39" r="35" fill="none" stroke="rgba(124,214,255,.12)" stroke-width="5"/>${b !== null ? `<circle cx="39" cy="39" r="35" fill="none" stroke="${TONES[b <= 20 ? 'bad' : r.tone === 'dim' ? 'cyan' : r.tone]}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${((circ * b) / 100).toFixed(1)} ${circ.toFixed(1)}"/>` : ''}</svg>
          <span class="rb-core">${ic(r.litter ? 'cat' : 'robot')}</span>
        </button>
        <div class="rb-info">
          <h3>${esc(r.name)}</h3>
          ${r.sub ? `<small>${esc(r.sub)}</small>` : ''}
          <div class="rb-row"><span class="pill t-${r.tone}">${esc(r.statusText)}</span>${b !== null ? `<span class="rb-batt">${ic(r.state === 'docked' && b < 100 ? 'bolt' : 'battery')}${fmt(b)}%</span>` : ''}</div>
        </div>
      </div>
      ${r.error ? `<div class="rb-err">${ic('alert')}<span>${esc(r.error)}</span></div>` : ''}
      ${acts.length ? `<div class="acts">${acts.join('')}</div>` : ''}
      ${r.fanSpeeds.length ? `<div class="rb-speed"><small>Suction</small><div class="seg t-mint">${r.fanSpeeds.map((s) => `<button class="${s === r.fanSpeed ? 'on' : ''}" data-act="vacspeed" data-entity="${id}" data-speed="${esc(s)}">${esc(titleCase(s))}</button>`).join('')}</div></div>` : ''}
      ${r.stats.length || r.controls.length ? `<div class="chips">${r.stats.map((s) => `<button class="chip" data-act="more" data-entity="${esc(s.id)}">${esc(s.label)} <b>${esc(s.value)}</b></button>`).join('')}${r.controls.map((c) => `<button class="chip ${c.on ? 'on' : ''}" data-act="${c.press ? 'press' : 'toggle'}" data-entity="${esc(c.id)}">${ic(/find|locate/i.test(c.label) ? 'locate' : c.press ? 'spark' : 'power')}${esc(c.label)}</button>`).join('')}</div>` : ''}
      ${extra}
    </article>`;
}

function viewRobots(m, ui) {
  const head = (extra = '') => viewHead(ui, 'Robots', 'Cleaning crew', extra);
  if (!m.robots.length) return `${head()}${emptyState('robot', 'No robots yet', 'Robot vacuums and litter boxes in Home Assistant show up here with start, dock and find buttons.')}`;
  const cleaners = m.robots.filter((r) => !r.litter && r.state !== 'unavailable');
  const extra = cleaners.length > 1 ? `<div class="vh-acts"><button class="chip" data-act="vacall" data-svc="start">${ic('play')}Start all</button><button class="chip" data-act="vacall" data-svc="return_to_base">${ic('home')}Dock all</button></div>` : '';
  const order = { error: 0, cleaning: 1, returning: 2, paused: 3, idle: 4, docked: 5, unavailable: 7 };
  const sorted = [...m.robots].sort((a, b) => (order[a.state] ?? 6) - (order[b.state] ?? 6));
  return `${head(extra)}<div class="robots">${sorted.map(robotCard).join('')}</div>`;
}

// Dashboard v2 -------------------------------------------------------------

// Series hues checked for colour-blind separation on the dark panel surface (fixed order, never cycled).
const SERIES_COLORS = ['#159cbb', '#c4801c', '#9d6ff5', '#3f9e5c'];
const CONTROL_TONES = { quiet: 'violet', turbo: 'mint', master_fan: 'cyan' };

function lineChart(ui, id, series, { start, end, unit = '', height = 160 } = {}) {
  const vals = series.flatMap((s) => s.values).filter((v) => v !== null && Number.isFinite(v));
  if (vals.length < 2) return '<div class="chart empty-chart">No history yet</div>';
  const top = niceCeil(Math.max(...vals) * 1.04);
  const W = 300;
  const H = 100;
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v) => H - (clamp(v, 0, top) / top) * H;
  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      pen = true;
    });
    return d ? `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : '';
  }).join('');
  const dots = series.map((s) => {
    let i = s.values.length - 1;
    while (i >= 0 && (s.values[i] === null || !Number.isFinite(s.values[i]))) i -= 1;
    return i < 0 ? '' : `<i class="lc-dot" style="left:${((x(i) / W) * 100).toFixed(2)}%;top:${((y(s.values[i]) / H) * 100).toFixed(2)}%;background:${s.color}"></i>`;
  }).join('');
  const grid = [0, 0.5, 1].map((f) => `<line x1="0" x2="${W}" y1="${(H * f).toFixed(1)}" y2="${(H * f).toFixed(1)}"/>`).join('');
  ui.charts[id] = { series: series.map((s) => ({ label: s.label, color: s.color, values: s.values })), start, end, n, unit };
  const hours = Math.round((end - start) / 3600000);
  const span = hours >= 48 ? `${Math.round(hours / 24)} days ago` : `${hours}h ago`;
  const mid = hours >= 48 ? `${Math.round(hours / 48)} days ago` : `${Math.round(hours / 2)}h ago`;
  return `<div class="lchart" style="--h:${height}px">
      <div class="lc-ticks" aria-hidden="true"><span style="top:0%">${compactNum(top)}</span><span style="top:50%">${compactNum(top / 2)}</span><span style="top:100%">0</span></div>
      <div class="lc-plot" data-chart="${id}" role="img" aria-label="${esc(series.map((s) => s.label).join(', '))} over the last ${esc(span.replace(' ago', ''))}">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><g class="lc-grid">${grid}</g>${paths}</svg>
        ${dots}
        <div class="lc-hover" data-live></div>
      </div>
      <div class="lc-x" aria-hidden="true"><span>${span}</span><span>${mid}</span><span>Now</span></div>
    </div>`;
}

function columnChart(ui, id, values, { start, end, label = '', height = 120, digits = 0 } = {}) {
  const real = values.filter((v) => v !== null);
  if (!real.length) return '<div class="chart empty-chart">No readings in this period</div>';
  const top = niceCeil(Math.max(...real) * 1.04);
  ui.charts[id] = { series: [{ label, color: TONES.mint, values }], start, end, n: values.length, unit: '', bars: true, digits };
  return `<div class="cchart" style="--h:${height}px">
      <div class="lc-ticks" aria-hidden="true"><span style="top:0%">${compactNum(top)}</span><span style="top:50%">${compactNum(top / 2)}</span><span style="top:100%">0</span></div>
      <div class="lc-plot" data-chart="${id}" role="img" aria-label="${esc(label)}">
        <div class="cc-bars">${values.map((v) => `<i style="height:${v === null ? 0 : Math.max(2, (v / top) * 100).toFixed(1)}%"></i>`).join('')}</div>
        <div class="lc-hover" data-live></div>
      </div>
      <div class="lc-x" aria-hidden="true"><span>${esc(new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span><span>Today</span></div>
    </div>`;
}

function scoreTone(score) {
  return score === null || score === undefined ? 'dim' : LEVEL_TONES[scoreLevel(score)];
}

function scoreHeadline(score) {
  if (score === null) return 'Waiting for readings';
  if (score >= 75) return 'The air is good';
  if (score >= 55) return 'The air is fair';
  return 'The air needs attention';
}

function airScoreCard(m, ui, { compact = false } = {}) {
  const s = m.score;
  if (!s.parts.length) return `<section class="panel score">${emptyState('air', 'Pick your air inputs', 'Choose the outside AQI, PM0.3 sensors, Winix and Amazon monitor in Customize.')}<button class="more" data-act="sheet" data-sheet="customize">Open Customize</button></section>`;
  const tone = scoreTone(s.score);
  const parts = s.parts.map((p) => `<button class="part t-${scoreTone(p.score)}" data-act="more" data-entity="${esc(p.entity)}"><span class="part-l">${esc(p.label)}</span><span class="part-v">${esc(p.raw)}</span><span class="part-bar"><i style="width:${p.score ?? 0}%"></i></span><b class="part-s">${p.score === null ? '—' : p.score}</b></button>`).join('');
  const math = ui.scoreMath
    ? `<div class="math"><p><b>Air score = the average of the inputs that are reporting.</b></p><p>${esc(s.parts.filter((p) => p.score !== null).map((p) => p.score).join(' + '))} = ${sum(s.parts.filter((p) => p.score !== null).map((p) => p.score))}, divided by ${s.used} = <b>${fmt(s.score)}</b></p>${[...new Map(s.parts.map((p) => [p.math, p])).values()].map((p) => `<p>${esc(p.math)}</p>`).join('')}</div>`
    : '';
  return `<section class="panel score t-${tone}" data-key="score-${compact ? 'home' : 'air'}">
      <div class="score-top">
        <button class="ring sm" data-act="tab" data-tab="air" aria-label="Air score ${fmt(s.score)}">${ringSvg(s.score, tone, 96, 8)}<span class="ring-v"><b>${fmt(s.score)}</b><small>AIR</small></span></button>
        <div class="score-sum">
          <span class="pill t-${tone}">${s.level === null ? 'No readings' : LEVEL_LABELS[s.level]}</span>
          <h2>${esc(scoreHeadline(s.score))}</h2>
          <p>${s.used} of ${s.parts.length} inputs reporting${s.worst && s.worst.score < 75 ? ` · lowest is ${esc(s.worst.label)}` : ''}</p>
        </div>
      </div>
      <div class="parts">${parts}</div>
      <button class="more" data-act="scoremath">${ui.scoreMath ? 'Hide the math' : 'Show the math'}</button>
      ${math}
    </section>`;
}

function pm03Series(m, range) {
  const h = range === '7d' ? m.history.pm03week : m.history.pm03;
  return m.score.pm03.map((x, i) => {
    const st = m.states[x.id];
    const unit = st?.attributes?.unit_of_measurement;
    const values = h?.series ? resample(h.series[x.id] || [], h.start, h.end, range === '7d' ? 168 : 96).map((v) => (v === null ? null : pm03PerDl(v, unit))) : [];
    return { id: x.id, label: x.label, color: SERIES_COLORS[i % SERIES_COLORS.length], values, now: live(st) ? pm03PerDl(st.state, unit) : null };
  });
}

function pm03Block(m, ui, { id, range = '24h', toggle = false, height = 150 }) {
  if (!m.score.pm03.length) return '';
  const h = range === '7d' ? m.history.pm03week : m.history.pm03;
  const series = pm03Series(m, range);
  const chart = h?.series ? lineChart(ui, id, series, { start: h.start, end: h.end, unit: 'per 0.1 L', height }) : `<div class="chart loading" style="height:${height}px"></div>`;
  const legend = series.map((s) => `<button class="lg" data-act="more" data-entity="${esc(s.id)}"><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${fmt(s.now)}</b></button>`).join('');
  const seg = toggle ? `<div class="seg t-cyan"><button class="${range === '24h' ? 'on' : ''}" data-act="pmrange" data-range="24h">24 hours</button><button class="${range === '7d' ? 'on' : ''}" data-act="pmrange" data-range="7d">7 days</button></div>` : '<small class="sec-note">Last 24 hours · per 0.1 L</small>';
  return `<section class="block">
      ${secHead('air', 'PM0.3', 'cyan', seg)}
      <div class="panel pmchart">${chart}<div class="legend">${legend}</div><small class="note">Touch the chart to read any moment.</small></div>
    </section>`;
}

function controlsBlock(m) {
  if (!m.controls.length) {
    return `<section class="block">${secHead('power', 'Controls', 'cyan')}<div class="panel">${emptyState('power', 'No controls found', 'Pick what Quiet, Winix Turbo and the master fan should run in Customize.')}<button class="more" data-act="sheet" data-sheet="customize">Open Customize</button></div></section>`;
  }
  const rows = m.controls.map((c) => `<div class="ctl t-${CONTROL_TONES[c.key] || 'cyan'}" data-key="ctl-${c.index}">
      <div class="ctl-h">${ic(c.icon)}<b>${esc(c.label)}</b>${c.note ? `<small>${esc(c.note)}</small>` : ''}</div>
      <div class="ctl-b">
        <button class="ctl-btn ${c.active === 'on' ? 'on' : ''}" data-act="ctl" data-i="${c.index}" data-side="on" ${c.on ? '' : 'disabled'} aria-label="${esc(c.label)} on">${ic(c.icon)}<span>On</span></button>
        <button class="ctl-btn off ${c.active === 'off' ? 'on' : ''}" data-act="ctl" data-i="${c.index}" data-side="off" ${c.off ? '' : 'disabled'} aria-label="${esc(c.label)} off">${ic('power')}<span>Off</span></button>
      </div>
    </div>`).join('');
  return `<section class="block">${secHead('power', 'Controls', 'cyan')}<div class="ctls">${rows}</div></section>`;
}

function robotActions(r) {
  const id = esc(r.id);
  const b = (act, svc, label, icon, primary) => `<button class="rs-btn ${primary ? 'primary' : ''}" data-act="${act}" ${svc ? `data-svc="${svc}"` : ''} data-entity="${id}" data-vac="${id}">${ic(icon)}<span>${esc(label)}</span></button>`;
  if (r.litter) return b('vac', 'start', 'Clean', 'spark', true);
  const main = r.state === 'cleaning' ? b('vac', 'pause', 'Pause', 'pause', true)
    : r.classic || !r.canArea ? b('vac', 'start', r.state === 'paused' ? 'Resume' : 'Clean', 'play', true)
      : b('sheet-rooms', '', 'Rooms', 'map', true);
  return `${main}${b('vac', 'return_to_base', 'Dock', 'home', false)}`;
}

function robotShortcuts(m) {
  if (!m.robots.length) return '';
  return `<section class="block">${secHead('robot', 'Robots', 'mint', linkTo('robots', 'All'))}<div class="panel rs-list">${m.robots.map((r) => `<div class="rs t-${r.tone} ${esc(r.state)}" data-key="rs-${esc(r.id)}">
      <button class="rs-main" data-act="tab" data-tab="robots" data-entity="${esc(r.id)}"><span class="rmini-ic">${ic(r.litter ? 'cat' : 'robot')}</span><span class="rmini-t"><b>${esc(r.name)}</b><small>${esc(r.statusText)}${r.battery !== null && !r.litter ? ` · ${fmt(r.battery)}%` : ''}</small></span></button>
      <div class="rs-acts">${robotActions(r)}</div>
    </div>`).join('')}</div></section>`;
}

function money(v, currency = '$') {
  if (v === null || v === undefined) return '—';
  return `${currency}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function cycleText(win) {
  const f = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${f(win.start)} – ${f(win.end)}`;
}

function billTile(m, b, title, icon, tone) {
  const cur = m.billing.currency;
  const day = b.win.day;
  const missing = b.spent === null && !b.loading;
  const hint = b.loading ? '' : b.error ? ' · could not load' : b.needsRate ? ' · add a price' : '';
  return `<button class="bill t-${tone}" data-act="tab" data-tab="energy">
      <span class="bill-h">${ic(icon)}<b>${esc(title)}</b></span>
      <span class="bill-k">So far</span>
      <span class="bill-v">${b.loading ? '…' : missing ? (b.usage !== null ? `${fmt(b.usage, 1)} ${b.kind === 'water' ? m.water.volumeUnit : 'kWh'}` : '—') : esc(money(b.spent, cur))}</span>
      <span class="bill-k">Estimated bill</span>
      <span class="bill-e">${b.loading ? '…' : esc(money(b.estimate, cur))}</span>
      <span class="bill-f">Day ${day} of ${b.win.days}${hint}</span>
    </button>`;
}

function billingMini(m) {
  return `<section class="block">${secHead('bolt', 'Energy & water', 'amber', linkTo('energy', 'Details'))}<div class="bills">${billTile(m, m.billing.electric, 'Energy', 'bolt', 'amber')}${billTile(m, m.billing.water, 'Water', 'drop', 'water')}</div></section>`;
}

const HEALTH_ORDER = [
  ['readiness', 'Readiness', 'leaf'],
  ['sleep', 'Sleep', 'moon'],
  ['resilience', 'Resilience', 'shield'],
  ['sick', 'Sick Score', 'alert'],
  ['heart', 'Heart Score', 'heart'],
];

function healthStrip(m) {
  const h = m.health;
  if (!h.has) return '';
  return `<section class="block">${secHead('heart', 'Health', 'violet', linkTo('health', 'Oura'))}<div class="hscroll">${HEALTH_ORDER.filter(([k]) => h.metrics[k]).map(([k, label]) => {
    const x = h.metrics[k];
    return `<button class="hmini t-${x.tone}" data-act="tab" data-tab="health" data-entity="${esc(x.id)}"><span class="ring xs">${ringSvg(x.value, x.tone, 54, 5)}<span class="ring-v"><b>${esc(x.shown)}</b></span></span><span class="hmini-t"><b>${esc(label)}</b><small>${esc(x.label)}</small></span></button>`;
  }).join('')}</div></section>`;
}

function viewHomeV2(m, ui) {
  const now = new Date(m.now);
  const hour = now.getHours();
  const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Good night';
  const first = String(m.config.name || m.user?.name || '').split(' ')[0];
  const clock = m.clock(now);
  const urgent = m.alerts.filter((a) => a.level <= 1);
  const statusTone = m.alerts.some((a) => a.level === 0) ? 'bad' : urgent.length ? 'poor' : 'good';
  const status = urgent.length ? `<b>${urgent.length}</b> ${urgent.length === 1 ? 'thing needs' : 'things need'} attention` : 'All quiet at home';
  return `
    ${m.config.preview ? `<div class="preview t-violet">${ic('spark')}<span>${m.config.preview === true ? '<b>Preview.</b> Sample data.' : m.config.preview}</span></div>` : ''}
    <header class="hello">
      <div class="hello-row">
        ${menuButton(ui)}
        <div class="hello-text">
          <div class="kicker">${esc(m.fmtDate(now))}</div>
          <h1>${esc(greet)}${first ? `, ${esc(first)}` : ''}</h1>
        </div>
        <div class="clock" aria-label="Time"><b>${esc(clock.main)}</b>${clock.period ? `<small>${esc(clock.period)}</small>` : ''}</div>
      </div>
      <div class="status-row">
        <button class="status t-${statusTone}" data-act="sheet" data-sheet="alerts"><i class="dot"></i><span>${status}</span>${m.alerts.length ? ic('chev') : ''}</button>
        <button class="icon-btn sm" data-act="sheet" data-sheet="customize" aria-label="Customize the dashboard">${ic('gear')}</button>
      </div>
      ${weatherStrip(m)}
    </header>
    ${alertsBlock(m)}
    ${airScoreCard(m, ui, { compact: true })}
    ${pm03Block(m, ui, { id: 'pm03-home', range: '24h' })}
    ${controlsBlock(m)}
    ${robotShortcuts(m)}
    ${billingMini(m)}
    ${healthStrip(m)}
    <div class="cols">
      ${climateBlock(m, ui)}
      ${favoritesBlock(m, ui)}
    </div>
    <footer class="foot">Nourie Home ${VERSION} · updated ${esc(m.fmtTime(now))}</footer>`;
}

function spikeCard(m, ui) {
  const s = m.spike;
  if (!s.pm) return '';
  const auto = s.automation;
  const state = s.active ? ['bad', 'Spiking now'] : s.running ? ['good', 'Watching'] : ['dim', 'Climate is off'];
  const targets = m.notifyTargets;
  return `<section class="block">${secHead('bell', 'PM0.3 spike alert', 'poor')}<div class="panel spike t-${state[0]}">
      <div class="spike-top"><span class="pill t-${state[0]}">${esc(state[1])}</span><span class="spike-now">${esc(s.pmLabel)} <b>${fmt(s.value)}</b> per 0.1 L</span></div>
      <p class="note">Alerts when ${esc(s.pmLabel)} PM0.3 goes over the threshold while ${esc(s.climateName || 'the upstairs climate')} is running${s.climateName ? ` (now ${esc(String(s.action).replace(/_/g, ' '))})` : ''}.</p>
      <label class="field"><span>Threshold, particles per 0.1 L${s.custom ? '' : ' (suggested from the last day)'}</span><input id="nh-spike-threshold" type="number" inputmode="numeric" min="50" step="50" value="${esc(Math.round(s.threshold))}" data-pref="spike.threshold"></label>
      <div class="field-row">
        <label class="field"><span>Phone to notify</span><select id="nh-spike-notify" data-pref="spike.notify"><option value="">Choose a phone</option>${targets.map((t) => `<option value="${esc(t)}" ${t === s.notify ? 'selected' : ''}>${esc(titleCase(t.replace(/^mobile_app_/, '').replace(/_/g, ' ')))}</option>`).join('')}</select></label>
      </div>
      ${auto
        ? `<div class="spike-auto"><span>${ic('check')}Phone alert is ${auto.on ? 'on' : 'off'}</span><button class="chip" data-act="spike-save">Update</button><button class="chip" data-act="spike-delete">Remove</button></div>`
        : `<button class="act primary wide" data-act="spike-save" ${s.notify && m.isAdmin ? '' : 'disabled'}>${ic('bell')}Turn on phone alerts</button>${m.isAdmin ? '' : '<small class="note">Phone alerts are saved as a Home Assistant automation, which needs an admin account.</small>'}`}
      <small class="note">The dashboard also shows this alert at the top of Home whenever it happens.</small>
    </div></section>`;
}

function viewAirV2(m, ui) {
  const a = m.air;
  return `${viewHead(ui, 'Indoor air', 'Air quality', `<button class="icon-btn sm" data-act="sheet" data-sheet="customize" aria-label="Customize">${ic('gear')}</button>`)}
    ${airScoreCard(m, ui)}
    ${pm03Block(m, ui, { id: 'pm03-air', range: ui.pmRange, toggle: true, height: 190 })}
    ${spikeCard(m, ui)}
    ${a.purifiers.length ? `<section class="block">${secHead('purifier', 'Purifiers', 'mint')}<div class="purs">${a.purifiers.map(purifierCard).join('')}</div></section>` : ''}
    ${a.rooms.length ? `<section class="block">${secHead('home', 'Rooms', 'cyan', '<small class="sec-note">Last 24 hours</small>')}<div class="rooms">${a.rooms.map((r) => roomCard(m, r)).join('')}</div></section>` : ''}`;
}

function roomsPicker(m, ui, r) {
  if (!r.canArea) return `<div class="rmap-empty">${ic('map')}<span>${esc(r.name)} does not support cleaning by room in Home Assistant.</span></div>`;
  if (r.areaStatus === 'loading') return '<div class="rmap-empty">Loading rooms…</div>';
  if (r.areaStatus === 'error') return `<div class="rmap-empty">${ic('alert')}<span>The room list could not load. Home Assistant only shares it with admin accounts.</span><button class="chip" data-act="more" data-entity="${esc(r.id)}">Open ${esc(r.name)}</button></div>`;
  if (!r.areas.length) return `<div class="rmap-empty">${ic('map')}<span>${esc(r.name)}'s rooms are not matched to your Home Assistant areas yet. Open the robot, tap <b>Cleaning → By area</b>, then the gear to match them.</span><button class="chip" data-act="more" data-entity="${esc(r.id)}">Open ${esc(r.name)}</button></div>`;
  const sel = ui.roomSel[r.id] || [];
  const floors = [];
  for (const area of r.areas) {
    let f = floors.find((x) => x.id === area.floor.id);
    if (!f) floors.push((f = { id: area.floor.id, name: area.floor.name, areas: [] }));
    f.areas.push(area);
  }
  const last = (m.prefs.lastRooms || {})[r.id] || [];
  const lastNames = last.map((id) => m.robots.find((x) => x.id === r.id)?.areas.find((a) => a.id === id)?.name).filter(Boolean);
  return `<div class="rmap" data-key="rmap-${esc(r.id)}">
      ${r.map ? `<img class="rmap-img" src="${esc(r.map.src)}${r.map.src.includes('?') ? '&' : '?'}_nh=${Math.floor(m.now / 30000)}" alt="${esc(r.name)} map">` : ''}
      ${floors.map((f) => `<div class="floor">${f.name ? `<small>${esc(f.name)}</small>` : ''}<div class="rtiles">${f.areas.map((a) => {
        const order = sel.indexOf(a.id);
        return `<button class="rtile ${order >= 0 ? 'on' : ''}" data-act="room" data-vac="${esc(r.id)}" data-area="${esc(a.id)}" aria-pressed="${order >= 0}">${order >= 0 ? `<i class="rt-o">${order + 1}</i>` : ''}<span>${esc(a.name)}</span></button>`;
      }).join('')}</div></div>`).join('')}
      <div class="rmap-acts">
        <button class="act primary" data-act="cleanrooms" data-vac="${esc(r.id)}" ${sel.length ? '' : 'disabled'}>${ic('play')}${sel.length ? `Clean ${sel.length} ${sel.length === 1 ? 'room' : 'rooms'}` : 'Pick rooms'}</button>
        <button class="act" data-act="roomsall" data-vac="${esc(r.id)}">${ic('check')}All</button>
        <button class="act" data-act="roomsclear" data-vac="${esc(r.id)}" ${sel.length ? '' : 'disabled'}>${ic('x')}Clear</button>
      </div>
      ${lastNames.length && !sel.length ? `<button class="chip repeat" data-act="roomsrepeat" data-vac="${esc(r.id)}">${ic('spark')}Again: ${esc(lastNames.join(', '))}</button>` : ''}
      <small class="note">Rooms are cleaned in the order you tap them.</small>
    </div>`;
}

function dustBlock(m, ui) {
  if (!m.robots.some((r) => r.classic && !r.litter)) return '';
  const h = m.history.dust;
  if (!m.dust.length) {
    return `<section class="block">${secHead('chart', 'Dust scores', 'mint')}<div class="panel">${emptyState('chart', 'No dust sensor found', 'Pick the Dyson dust score sensor in Customize and its last 30 days will show here.')}<button class="more" data-act="sheet" data-sheet="customize">Open Customize</button></div></section>`;
  }
  const charts = m.dust.map((id) => {
    const st = m.states[id];
    const values = h?.series?.[id] ? bucketMax(h.series[id], h.start, h.end, 30) : null;
    return `<div class="dust" data-key="dust-${esc(id)}"><div class="dust-h"><button class="lg" data-act="more" data-entity="${esc(id)}"><span>${esc(cleanName(st?.attributes?.friendly_name || id))}</span><b>${live(st) ? esc(statValue(st)) : 'Offline'}</b></button></div>${values ? columnChart(ui, `dust-${id}`, values, { start: h.start, end: h.end, label: 'Highest dust score each day' }) : '<div class="chart loading" style="height:120px"></div>'}</div>`;
  }).join('');
  return `<section class="block">${secHead('chart', 'Dust scores', 'mint', '<small class="sec-note">Highest each day · 30 days</small>')}<div class="panel dusts">${charts}</div></section>`;
}

function viewRobotsV2(m, ui) {
  const head = (extra = '') => viewHead(ui, 'Robots', 'Cleaning crew', extra);
  if (!m.robots.length) return `${head()}${emptyState('robot', 'No robots yet', 'Robot vacuums and litter boxes in Home Assistant show up here with start, dock and find buttons.')}`;
  const cleaners = m.robots.filter((r) => !r.litter && r.state !== 'unavailable');
  const extra = cleaners.length > 1 ? `<div class="vh-acts"><button class="chip" data-act="vacall" data-svc="start">${ic('play')}Start all</button><button class="chip" data-act="vacall" data-svc="return_to_base">${ic('home')}Dock all</button></div>` : '';
  const classic = m.robots.filter((r) => r.classic && !r.litter);
  const mapped = m.robots.filter((r) => !r.classic && !r.litter);
  const litter = m.robots.filter((r) => r.litter);
  return `${head(extra)}
    ${classic.length ? `<div class="robots">${classic.map((r) => robotCard(r)).join('')}</div>` : ''}
    ${dustBlock(m, ui)}
    ${mapped.length ? `<section class="block">${secHead('map', 'Clean by room', 'cyan')}<div class="robots">${mapped.map((r) => robotCard(r, roomsPicker(m, ui, r))).join('')}</div></section>` : ''}
    ${litter.length ? `<div class="robots">${litter.map((r) => robotCard(r)).join('')}</div>` : ''}`;
}

function billCard(m, b, title, icon, tone, unit) {
  const cur = m.billing.currency;
  const missing = b.spent === null && !b.loading;
  const day = b.win.day;
  return `<section class="panel billcard t-${tone}" id="nh-${b.kind}" data-key="bill-${b.kind}">
      <div class="hero2-top"><h2 class="eyebrow t-${tone}">${ic(icon)}${esc(title)}</h2><button class="chip" data-act="sheet" data-sheet="bill-${b.kind}">${ic('gear')}Billing cycle</button></div>
      <div class="bc-cycle">${esc(cycleText(b.win))} · day ${day} of ${b.win.days}</div>
      <div class="bc-bar" aria-hidden="true"><i style="width:${(b.win.fraction * 100).toFixed(1)}%"></i></div>
      <div class="bc-nums">
        <div><small>Spent so far</small><b>${b.loading ? '…' : esc(missing ? '—' : money(b.spent, cur))}</b></div>
        <div><small>Estimated bill</small><b class="est">${b.loading ? '…' : esc(money(b.estimate, cur))}</b></div>
      </div>
      <small class="note">${b.usage !== null ? `${fmt(b.usage, b.usage < 100 ? 1 : 0)} ${unit} so far` : 'No usage recorded yet'}${b.rate !== null ? ` · ${cur}${Number(b.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} per ${unit}` : ''}${b.fixed ? ` · ${money(b.fixed, cur)} fixed charge included in the estimate` : ''}${b.through ? ` · data through ${new Date(b.through).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</small>
      ${b.error ? `<small class="note warn">Home Assistant's usage history could not load: ${esc(b.error)}</small>` : b.needsRate ? `<small class="note warn">Add your price per ${unit} under Billing cycle to see dollars.</small>` : ''}
      ${!b.source && !b.error ? `<small class="note warn">No ${b.kind === 'water' ? 'water meter' : 'grid meter'} found in Home Assistant's Energy settings. Pick one under Billing cycle.</small>` : ''}
    </section>`;
}

function heatTable(m) {
  const rows = m.billing.heat;
  if (!rows.length) return '';
  const useMoney = m.billing.money;
  const val = (r, k) => (useMoney ? r.cost[k] : r.kwh[k]);
  const max = { today: Math.max(0, ...rows.map((r) => val(r, 'today') || 0)), week: Math.max(0, ...rows.map((r) => val(r, 'week') || 0)), cycle: Math.max(0, ...rows.map((r) => val(r, 'cycle') || 0)) };
  const cell = (r, k) => {
    const v = val(r, k);
    const h = heatStyle(v || 0, max[k]);
    return `<td style="background:${h.bg};color:${h.ink}">${v === null ? '—' : useMoney ? esc(money(v, m.billing.currency)) : `${fmt(v, 1)}`}</td>`;
  };
  return `<section class="block">${secHead('bolt', 'Room costs · heatmap', 'amber', '<small class="sec-note">Highest first</small>')}<div class="panel heat"><div class="heat-scroll"><table>
      <thead><tr><th scope="col">Circuit</th><th scope="col">Today</th><th scope="col">7 days</th><th scope="col">Cycle</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr><th scope="row"><span class="hn">${String(i + 1).padStart(2, '0')}</span>${esc(r.name)}</th>${cell(r, 'today')}${cell(r, 'week')}${cell(r, 'cycle')}</tr>`).join('')}</tbody>
    </table></div><small class="note">${useMoney ? 'Dollars use your electric rate.' : 'Kilowatt-hours; add a rate to see dollars.'} Circuits can overlap, so they are not added to the home total.</small></div></section>`;
}

function viewEnergyV2(m, ui) {
  const unitW = m.water.volumeUnit;
  return `${viewHead(ui, 'Billing cycle', 'Energy &amp; water')}
    ${billCard(m, m.billing.electric, 'Electric', 'bolt', 'amber', 'kWh')}
    ${billCard(m, m.billing.water, 'Water', 'drop', 'water', unitW)}
    ${heatTable(m)}`;
}

function healthCard(m, key, label, icon, sub) {
  const x = m.health.metrics[key];
  if (!x) return '';
  return `<button class="panel hcard t-${x.tone}" data-act="more" data-entity="${esc(x.id)}">
      <span class="hcard-h">${ic(icon)}<b>${esc(label)}</b>${ic('chev')}</span>
      <span class="ring">${ringSvg(x.value, x.tone, 112, 9)}<span class="ring-v"><b>${esc(x.shown)}</b><small>${esc(x.label)}</small></span></span>
      <span class="hcard-s">${esc(sub)}</span>
    </button>`;
}

function viewHealth(m, ui) {
  const h = m.health;
  if (!h.has) return `${viewHead(ui, 'Oura', 'My health')}${emptyState('heart', 'No Oura scores found', 'Pick your readiness, sleep and resilience sensors in Customize.')}<button class="more" data-act="sheet" data-sheet="customize">Open Customize</button>`;
  const heart = h.metrics.heart;
  return `${viewHead(ui, 'Oura', 'My health')}
    <section class="panel hhead">
      <div><b>Oura · Readiness · Sleep · Recovery</b><small>${h.updated ? `Updated ${esc(new Date(h.updated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}` : ''}</small></div>
      ${h.battery !== null ? `<button class="chip" data-act="more" data-entity="${esc(h.batteryId)}">${ic('battery')}Ring <b>${fmt(h.battery)}%</b></button>` : ''}
    </section>
    <div class="hgrid">
      ${healthCard(m, 'readiness', 'Readiness', 'leaf', 'Oura readiness score')}
      ${healthCard(m, 'sleep', 'Sleep', 'moon', h.sleepTime ? `${h.sleepTime} total sleep` : 'Oura sleep score')}
      ${healthCard(m, 'resilience', 'Resilience', 'shield', 'Oura stress resilience')}
      ${healthCard(m, 'sick', 'Sick Score', 'alert', 'Early-warning index')}
    </div>
    ${heart ? `<button class="panel hwide t-${heart.tone}" data-act="more" data-entity="${esc(heart.id)}"><span class="ring">${ringSvg(heart.value, heart.tone, 112, 9)}<span class="ring-v"><b>${esc(heart.shown)}</b><small>${esc(heart.label)}</small></span></span><span class="hwide-t"><b>${ic('heart')}Heart Score</b><small>Tap for the readings behind it.</small></span></button>` : ''}`;
}

// Customize and billing sheets ------------------------------------------------

function entityCandidates(ctx) {
  const opt = (st) => ({ id: st.entity_id, name: cleanName(ctx.name(st.entity_id)), state: live(st) ? `${st.state}${st.attributes.unit_of_measurement ? ` ${st.attributes.unit_of_measurement}` : ''}` : 'offline' });
  const byName = (a, b) => a.name.localeCompare(b.name);
  const sensors = ctx.byDomain('sensor');
  return {
    aqi: sensors.filter((st) => st.attributes.device_class === 'aqi' || /\baqi\b|air quality/i.test(ctx.name(st.entity_id))).map(opt).sort(byName),
    pm03: sensors.filter((st) => PM03_RE.test(ctx.name(st.entity_id)) || /particle|\bpm\s?\d/i.test(ctx.name(st.entity_id))).map(opt).sort(byName),
    winix: sensors.filter((st) => isWinix(ctx, st.entity_id) || st.attributes.air_quality !== undefined).map(opt).sort(byName),
    numeric: sensors.filter((st) => toNum(st.state) !== null || !live(st)).map(opt).sort(byName),
    text: sensors.map(opt).sort(byName),
    controls: ctx.list.filter((st) => [...PRESS_DOMAINS, ...TOGGLE_DOMAINS, 'automation'].includes(domainOf(st.entity_id))).map(opt).sort(byName),
    climate: ctx.byDomain('climate').map(opt).sort(byName),
    vacuums: ctx.byDomain('vacuum').map(opt).sort(byName),
    winixFans: ctx.byDomain('fan').filter((st) => isWinix(ctx, st.entity_id)).map((st) => st.entity_id),
  };
}

function options(list, selected, { auto = null, none = 'Don’t use' } = {}) {
  const head = [
    auto !== null ? `<option value="__auto__" ${selected === undefined ? 'selected' : ''}>Automatic${auto ? ` (${esc(auto)})` : ''}</option>` : '',
    none ? `<option value="__none__" ${selected === '' ? 'selected' : ''}>${esc(none)}</option>` : '',
  ].join('');
  return head + list.map((o) => `<option value="${esc(o.id)}" ${o.id === selected ? 'selected' : ''}>${esc(o.name)} · ${esc(o.state)}</option>`).join('');
}

function targetValue(t) {
  if (!t) return '';
  if (t.entity) return t.entity;
  if (t.service === 'fan.set_percentage') return '__winix_turbo__';
  if (t.service === 'fan.set_preset_mode') return '__winix_auto__';
  return '';
}

function customizeSheet(m) {
  const c = m.candidates();
  const p = m.prefs;
  const air = p.air || {};
  const name = (id) => cleanName(m.states[id]?.attributes?.friendly_name || id || '');
  const pmChecked = new Set((Array.isArray(air.pm03) ? air.pm03 : m.score.pm03).map((x) => x.id));
  const pmLabels = Object.fromEntries((Array.isArray(air.pm03) ? air.pm03 : m.score.pm03).map((x) => [x.id, x.label]));
  const winixChecked = new Set(Array.isArray(air.winix) ? air.winix : discoverWinixFromParts(m));
  const controls = Array.isArray(p.controls) ? p.controls : m.controls.map(({ key, label, icon, on, off }) => ({ key, label, icon, on, off }));
  const ctlOptions = (t) => `<option value="">Nothing</option>${c.winixFans.length ? `<option value="__winix_turbo__" ${targetValue(t) === '__winix_turbo__' ? 'selected' : ''}>Winix purifiers → Turbo</option><option value="__winix_auto__" ${targetValue(t) === '__winix_auto__' ? 'selected' : ''}>Winix purifiers → Auto</option>` : ''}${c.controls.map((o) => `<option value="${esc(o.id)}" ${o.id === targetValue(t) ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}`;
  const classic = new Set(m.robots.filter((r) => r.classic).map((r) => r.id));
  const dust = new Set(m.dust);
  const oura = p.oura || {};
  const health = m.health.ids;
  const ouraSel = (key, label) => `<label class="field"><span>${esc(label)}</span><select data-pref="oura.${key}">${options(c.numeric.concat(key === 'resilience' ? c.text.filter((o) => /resilience/i.test(o.name)) : []), oura[key], { auto: health[key] ? name(health[key]) : '' })}</select></label>`;
  return `
    <p class="note">${m.isAdmin ? 'Changes save in Home Assistant and apply to everyone who opens this dashboard.' : 'Changes save to your Home Assistant account.'}</p>
    <h3>Air score inputs</h3>
    <label class="field"><span>Outside AQI</span><select data-pref="air.outdoor">${options(c.aqi, air.outdoor, { auto: m.score.parts.find((x) => x.key === 'outdoor') ? name(m.score.parts.find((x) => x.key === 'outdoor').entity) : 'none found' })}</select></label>
    <label class="field"><span>Amazon air monitor</span><select data-pref="air.amazon">${options(c.aqi, air.amazon, { auto: m.score.parts.find((x) => x.key === 'amazon') ? name(m.score.parts.find((x) => x.key === 'amazon').entity) : 'none found' })}</select></label>
    <div class="field"><span>PM0.3 sensors</span><div class="checks">${c.pm03.map((o) => `<div class="check-row"><label class="check"><input type="checkbox" data-pref="air.pm03" value="${esc(o.id)}" ${pmChecked.has(o.id) ? 'checked' : ''}><span>${esc(o.name)} <small>${esc(o.state)}</small></span></label>${pmChecked.has(o.id) ? `<input class="mini" type="text" aria-label="Label for ${esc(o.name)}" data-pref="air.pm03label" data-id="${esc(o.id)}" value="${esc(pmLabels[o.id] || '')}">` : ''}</div>`).join('') || '<small class="note">No PM0.3 sensors found.</small>'}</div></div>
    <div class="field"><span>Winix air quality</span><div class="checks">${c.winix.map((o) => `<label class="check"><input type="checkbox" data-pref="air.winix" value="${esc(o.id)}" ${winixChecked.has(o.id) ? 'checked' : ''}><span>${esc(o.name)} <small>${esc(o.state)}</small></span></label>`).join('') || '<small class="note">No Winix sensors found.</small>'}</div></div>
    <button class="chip" data-act="pref-reset" data-key="air">Use automatic air inputs</button>

    <h3>Control buttons</h3>
    ${controls.map((x, i) => `<div class="ctl-edit" data-key="ce-${i}">
        <label class="field"><span>Name</span><input type="text" data-pref="controls.label" data-i="${i}" value="${esc(x.label || '')}"></label>
        <div class="field-row">
          <label class="field"><span>On runs</span><select data-pref="controls.on" data-i="${i}">${ctlOptions(x.on)}</select></label>
          <label class="field"><span>Off runs</span><select data-pref="controls.off" data-i="${i}">${ctlOptions(x.off)}</select></label>
        </div>
        <button class="chip" data-act="ctl-remove" data-i="${i}">${ic('x')}Remove</button>
      </div>`).join('')}
    <div class="chips"><button class="chip" data-act="ctl-add">${ic('plus')}Add a button pair</button><button class="chip" data-act="pref-reset" data-key="controls">Use automatic buttons</button></div>

    <h3>Robots</h3>
    <div class="checks">${c.vacuums.map((o) => `<label class="check"><input type="checkbox" data-pref="robots.classic" value="${esc(o.id)}" ${classic.has(o.id) ? 'checked' : ''}><span>${esc(o.name)} <small>keep the standard card, no room map</small></span></label>`).join('')}</div>
    <div class="field"><span>Dust score sensors</span><div class="checks">${c.numeric.filter((o) => dust.has(o.id) || /dust|dirt|dyson/i.test(o.name)).map((o) => `<label class="check"><input type="checkbox" data-pref="dust" value="${esc(o.id)}" ${dust.has(o.id) ? 'checked' : ''}><span>${esc(o.name)} <small>${esc(o.state)}</small></span></label>`).join('') || '<small class="note">No Dyson or dust sensors found.</small>'}</div></div>

    <h3>Oura</h3>
    ${ouraSel('readiness', 'Readiness')}${ouraSel('sleep', 'Sleep score')}${ouraSel('resilience', 'Resilience')}${ouraSel('sick', 'Sick Score')}${ouraSel('heart', 'Heart Score')}${ouraSel('duration', 'Total sleep time')}${ouraSel('battery', 'Ring battery')}

    <h3>Family map</h3>
    <label class="field"><span>People come from</span><select data-pref="people_source"><option value="life360" ${p.people_source !== 'person' ? 'selected' : ''}>Life360 members</option><option value="person" ${p.people_source === 'person' ? 'selected' : ''}>Home Assistant people</option></select></label>`;
}

function discoverWinixFromParts(m) {
  return Object.keys(m.states).filter((id) => id.startsWith('sensor.') && m.states[id].attributes.air_quality !== undefined && /winix/i.test(`${id} ${m.states[id].attributes.friendly_name || ''}`));
}

function billSheet(m, kind) {
  const b = m.billing[kind];
  const conf = (m.prefs.billing || {})[kind] || {};
  const unit = kind === 'water' ? m.water.volumeUnit : 'kWh';
  const c = m.candidates();
  const src = b.source;
  const err = conf.start && conf.end && conf.end <= conf.start ? '<small class="note warn">The next bill date has to be after the start date.</small>' : '';
  return `
    <p class="note">Change the dates whenever a new bill arrives. The dashboard rolls to the next cycle on its own after the bill date.</p>
    <div class="field-row">
      <label class="field"><span>Cycle started</span><input type="date" data-pref="billing.${kind}.start" value="${esc(conf.start || b.win.startDay)}"></label>
      <label class="field"><span>Next bill date</span><input type="date" data-pref="billing.${kind}.end" value="${esc(conf.end || b.win.endDay)}"></label>
    </div>
    ${err}
    <div class="field-row">
      <label class="field"><span>Price per ${esc(unit)}</span><input type="number" inputmode="decimal" step="0.0001" min="0" placeholder="${src?.price ? esc(src.price) : 'e.g. 0.14'}" data-pref="billing.${kind}.rate" value="${esc(conf.rate ?? '')}"></label>
      <label class="field"><span>Fixed monthly charge</span><input type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" data-pref="billing.${kind}.fixed" value="${esc(conf.fixed ?? '')}"></label>
    </div>
    <label class="field"><span>Meter</span><select data-pref="billing.${kind}.stat">${`<option value="__auto__" ${conf.stat ? '' : 'selected'}>From Energy settings${src?.usage ? ` (${esc(src.label || src.usage)})` : ' (none found)'}</option>`}${c.numeric.filter((o) => (kind === 'water' ? /water|flume|gal|lit/i : /energy|kwh|grid|emporia|duke/i).test(`${o.id} ${o.name} ${o.state}`)).map((o) => `<option value="${esc(o.id)}" ${o.id === conf.stat ? 'selected' : ''}>${esc(o.name)} · ${esc(o.state)}</option>`).join('')}</select></label>
    <p class="note">${src?.cost && !conf.rate ? 'Using Home Assistant’s cost tracking for dollars. Enter a price to override it.' : conf.rate ? 'Dollars use your price.' : 'Enter a price to turn usage into dollars.'}</p>
    <div class="bc-nums sheet-nums"><div><small>Spent so far</small><b>${esc(money(b.spent, m.billing.currency))}</b></div><div><small>Estimated bill</small><b class="est">${esc(money(b.estimate, m.billing.currency))}</b></div></div>`;
}

function roomsSheet(m, ui, id) {
  const r = m.robots.find((x) => x.id === id);
  return r ? roomsPicker(m, ui, r) : '<div class="empty"><b>Robot not found</b></div>';
}

// Sheets -------------------------------------------------------------------

function sheetHtml(m, ui) {
  if (!ui.sheet) return '';
  let title = '';
  let body = '';
  if (ui.sheet === 'alerts') {
    title = 'Alerts';
    const rows = m.alerts.map((a, i) => alertRow(a, i)).join('');
    const offline = m.offline.length ? `<button class="alert t-dim" data-act="sheet" data-sheet="offline"><span class="al-ic">${ic('wifi')}</span><span class="al-t"><b>${m.offline.length} ${m.offline.length === 1 ? 'device is' : 'devices are'} offline</b><small>See which ones</small></span>${ic('chev')}</button>` : '';
    body = rows || offline ? `${rows}${offline}` : `<div class="empty">${ic('check')}<b>All clear</b><span>Doors are closed and nothing needs you.</span></div>`;
  } else if (ui.sheet === 'customize') {
    title = 'Customize';
    body = customizeSheet(m);
  } else if (ui.sheet === 'bill-electric' || ui.sheet === 'bill-water') {
    const kind = ui.sheet.slice(5);
    title = kind === 'water' ? 'Water billing cycle' : 'Electric billing cycle';
    body = billSheet(m, kind);
  } else if (String(ui.sheet).startsWith('rooms:')) {
    const id = ui.sheet.slice(6);
    title = `${m.robots.find((r) => r.id === id)?.name || 'Robot'} · rooms`;
    body = roomsSheet(m, ui, id);
  } else if (ui.sheet === 'offline') {
    title = `Offline (${m.offline.length})`;
    body = m.offline.map((o) => `<button class="row" data-act="more" data-entity="${esc(o.id)}"><span>${esc(o.name)}</span><small>${esc([o.area, o.since && `for ${o.since}`].filter(Boolean).join(' · '))}</small></button>`).join('') || '<div class="empty"><b>Everything is online</b></div>';
  }
  return `<div class="sheet-back" data-act="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grab"></div>
      <div class="sheet-h"><h2>${esc(title)}</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${ic('x')}</button></div>
      <div class="sheet-b">${body}</div>
    </div>`;
}

// ------------------------------------------------------------ DOM morph

// Updates the live DOM to match freshly rendered markup while keeping nodes that did not
// change, so animations keep running, images do not reload and scroll positions hold.
function morph(parent, next) {
  let cur = parent.firstChild;
  let nxt = next.firstChild;
  while (nxt) {
    const after = nxt.nextSibling;
    if (!cur) {
      parent.appendChild(nxt);
    } else if (sameNode(cur, nxt)) {
      if (cur.nodeType === 1 && !cur.hasAttribute('data-live')) {
        syncAttributes(cur, nxt);
        morph(cur, nxt);
      } else if (cur.nodeValue !== nxt.nodeValue) {
        cur.nodeValue = nxt.nodeValue;
      }
      cur = cur.nextSibling;
    } else {
      const old = cur;
      cur = cur.nextSibling;
      parent.replaceChild(nxt, old);
    }
    nxt = after;
  }
  while (cur) {
    const after = cur.nextSibling;
    parent.removeChild(cur);
    cur = after;
  }
}

function sameNode(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  return a.nodeName === b.nodeName && a.getAttribute('data-key') === b.getAttribute('data-key');
}

function syncAttributes(a, b) {
  for (const { name } of Array.from(a.attributes)) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of Array.from(b.attributes)) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
}

function patch(el, html) {
  if (el.__nh === html) return;
  el.__nh = html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  morph(el, tpl.content);
}

// ---------------------------------------------------------------- loaders

function loadFonts() {
  if (!globalThis.document || document.getElementById('nourie-home-fonts')) return;
  const link = document.createElement('link');
  link.id = 'nourie-home-fonts';
  link.rel = 'stylesheet';
  link.href = FONTS_CSS;
  document.head.appendChild(link);
}

let leafletPromise = null;
function loadLeaflet() {
  if (globalThis.L?.map) return Promise.resolve(globalThis.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = LEAFLET_JS;
      script.async = true;
      script.onload = () => (globalThis.L?.map ? resolve(globalThis.L) : reject(new Error('Leaflet did not start')));
      script.onerror = () => {
        leafletPromise = null;
        reject(new Error('Leaflet could not load'));
      };
      document.head.appendChild(script);
    });
  }
  return leafletPromise;
}

// ----------------------------------------------------------------- styles

const STYLES = `
:host {
  /* Phone-first HUD: one column of glass panels over a deep-navy grid, a floating tab bar, two columns from 900px. */
  --nh-bg: #050d18;
  --nh-ink: #e9f5ff;
  --nh-dim: #93abc4;
  --nh-faint: #637d97;
  --nh-line: rgba(124, 214, 255, 0.14);
  --nh-line-2: rgba(124, 214, 255, 0.26);
  --nh-glass: rgba(14, 33, 54, 0.66);
  --nh-glass-2: rgba(9, 23, 39, 0.82);
  --nh-cyan: #4de3ff;
  --nh-amber: #ffb547;
  --nh-water: #4aa8ff;
  --nh-violet: #b197ff;
  --nh-mint: #44e6b0;
  --nh-good: #43e08e;
  --nh-lime: #a6e35a;
  --nh-fair: #ffd65c;
  --nh-poor: #ff9447;
  --nh-bad: #ff5470;
  --nh-display: "Chakra Petch", "Rajdhani", "Segoe UI", system-ui, sans-serif;
  --nh-body: "Figtree", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  --nh-top: var(--nh-safe-top, env(safe-area-inset-top, 0px));
  --nh-bottom: var(--nh-safe-bottom, env(safe-area-inset-bottom, 0px));
  --nh-nav-h: calc(78px + var(--nh-bottom));
  --tone: var(--nh-cyan);
  --tone-rgb: 77, 227, 255;
  display: block;
  height: 100%;
  color: var(--nh-ink);
  color-scheme: dark;
}
.t-cyan { --tone: #4de3ff; --tone-rgb: 77, 227, 255; }
.t-amber { --tone: #ffb547; --tone-rgb: 255, 181, 71; }
.t-water { --tone: #4aa8ff; --tone-rgb: 74, 168, 255; }
.t-violet { --tone: #b197ff; --tone-rgb: 177, 151, 255; }
.t-mint { --tone: #44e6b0; --tone-rgb: 68, 230, 176; }
.t-good { --tone: #43e08e; --tone-rgb: 67, 224, 142; }
.t-lime { --tone: #a6e35a; --tone-rgb: 166, 227, 90; }
.t-fair { --tone: #ffd65c; --tone-rgb: 255, 214, 92; }
.t-poor { --tone: #ff9447; --tone-rgb: 255, 148, 71; }
.t-bad { --tone: #ff5470; --tone-rgb: 255, 84, 112; }
.t-dim { --tone: #93abc4; --tone-rgb: 147, 171, 196; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: inherit; -webkit-tap-highlight-color: transparent; touch-action: manipulation; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
button:focus-visible { outline: 2px solid var(--nh-cyan); outline-offset: 2px; }
h1, h2, h3, p { margin: 0; }
img { max-width: 100%; }
.ic { width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }

.app { position: relative; height: var(--nh-app-height, 100vh); overflow: hidden; isolation: isolate; background: var(--nh-bg); font: 400 14px/1.4 var(--nh-body); -webkit-font-smoothing: antialiased; }
.app::before { content: ""; position: absolute; inset: 0; z-index: -2; pointer-events: none;
  background:
    radial-gradient(75% 40% at 0% 0%, rgba(77, 227, 255, .15), transparent 70%),
    radial-gradient(55% 35% at 100% 16%, rgba(177, 151, 255, .10), transparent 70%),
    radial-gradient(70% 45% at 50% 108%, rgba(255, 181, 71, .08), transparent 70%),
    linear-gradient(180deg, #081628 0%, #050d18 52%, #040a13 100%); }
.app::after { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-image: linear-gradient(rgba(124, 214, 255, .05) 1px, transparent 1px), linear-gradient(90deg, rgba(124, 214, 255, .05) 1px, transparent 1px);
  background-size: 32px 32px;
  -webkit-mask-image: linear-gradient(180deg, #000, transparent 420px); mask-image: linear-gradient(180deg, #000, transparent 420px); }
.scroller { position: absolute; inset: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: rgba(124,214,255,.2) transparent; }
.tab-map .scroller { overflow: hidden; }
.wrap { max-width: 1180px; margin: 0 auto; display: grid; gap: 20px; padding-block: calc(14px + var(--nh-top)) calc(var(--nh-nav-h) + 26px); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.wrap > *, .cols > * { min-width: 0; }
.cols { display: grid; gap: 22px; }
@media (min-width: 900px) { .cols { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; } }
@supports (height: 100dvh) { .app { height: var(--nh-app-height, 100dvh); } }
.card-mode { height: auto; min-height: calc(100vh - var(--header-height, 56px)); overflow: visible; }
.card-mode .scroller { position: relative; inset: auto; overflow: visible; }
.card-mode .wrap { padding-top: 16px; padding-bottom: 24px; }
.card-mode .nav { position: sticky; }
.card-mode .mapview { position: relative; height: calc(100vh - var(--header-height, 56px) - var(--nh-nav-h)); }
.card-mode .map-sheet { bottom: 12px; }
.card-mode .sheet-back, .card-mode .sheet, .card-mode .toast { position: fixed; }

/* Tab bar */
.nav { position: absolute; left: 0; right: 0; bottom: 0; z-index: 30; pointer-events: none; padding-block: 10px calc(10px + var(--nh-bottom)); padding-left: max(12px, env(safe-area-inset-left, 0px)); padding-right: max(12px, env(safe-area-inset-right, 0px)); }
.nav-in { pointer-events: auto; max-width: 480px; margin: 0 auto; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 2px; padding: 5px; border-radius: 24px; background: rgba(8, 20, 35, .95); border: 1px solid var(--nh-line-2); box-shadow: 0 18px 40px -10px rgba(0, 0, 0, .75), inset 0 1px 0 rgba(255, 255, 255, .05); -webkit-backdrop-filter: blur(18px) saturate(140%); backdrop-filter: blur(18px) saturate(140%); }
.nav-b { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; min-height: 52px; border-radius: 18px; color: var(--nh-faint); font: 600 10.5px/1 var(--nh-body); letter-spacing: .03em; transition: color .2s, background .2s; }
.nav-b .ic { font-size: 22px; transition: filter .2s; }
.nav-b.on { color: var(--nh-ink); background: linear-gradient(180deg, rgba(77, 227, 255, .18), rgba(77, 227, 255, .04)); box-shadow: inset 0 0 0 1px rgba(77, 227, 255, .28); }
.nav-b.on .ic { color: var(--nh-cyan); filter: drop-shadow(0 0 6px rgba(77, 227, 255, .75)); }
.nav-dot { position: absolute; top: 5px; left: calc(50% + 6px); min-width: 17px; height: 17px; padding: 0 5px; border-radius: 9px; background: var(--nh-bad); color: #fff; font: 700 10px/17px var(--nh-body); text-align: center; box-shadow: 0 0 0 2px #081423; }
.nav-dot[hidden] { display: none; }

/* Shared pieces */
.kicker { font: 600 11px/1.2 var(--nh-display); letter-spacing: .16em; text-transform: uppercase; color: var(--nh-dim); }
.panel { position: relative; border-radius: 20px; padding: 14px; background: linear-gradient(180deg, rgba(20, 44, 70, .56), rgba(9, 23, 39, .74)); border: 1px solid var(--nh-line); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05), 0 14px 30px -18px rgba(0, 0, 0, .8); }
.glass { background: rgba(8, 20, 35, .84); border: 1px solid var(--nh-line-2); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
.icon-btn { width: 42px; height: 42px; display: grid; place-items: center; flex: none; border-radius: 14px; font-size: 20px; color: var(--nh-ink); background: var(--nh-glass); border: 1px solid var(--nh-line); }
.pill { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border-radius: 999px; white-space: nowrap; font: 600 11.5px/1 var(--nh-body); color: var(--tone); background: rgba(var(--tone-rgb), .13); border: 1px solid rgba(var(--tone-rgb), .32); }
.pill .ic { font-size: 13px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--tone); box-shadow: 0 0 10px rgba(var(--tone-rgb), .85); }
.block { display: grid; gap: 10px; min-width: 0; }
.sec-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 2px; min-height: 32px; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; font: 600 12.5px/1 var(--nh-display); letter-spacing: .16em; text-transform: uppercase; color: var(--nh-ink); }
.eyebrow .ic { font-size: 17px; color: var(--tone); filter: drop-shadow(0 0 6px rgba(var(--tone-rgb), .7)); }
.sec-link { display: inline-flex; align-items: center; gap: 2px; min-height: 36px; padding: 0 2px 0 8px; font-size: 13px; font-weight: 600; color: var(--nh-cyan); }
.sec-link .ic { font-size: 16px; }
.sec-note { font-size: 12px; color: var(--nh-faint); }
.hscroll { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; margin-left: calc(-1 * max(16px, env(safe-area-inset-left, 0px))); margin-right: calc(-1 * max(16px, env(safe-area-inset-right, 0px))); padding: 2px max(16px, env(safe-area-inset-right, 0px)) 6px max(16px, env(safe-area-inset-left, 0px)); scroll-padding-left: max(16px, env(safe-area-inset-left, 0px)); }
.hscroll::-webkit-scrollbar { display: none; }
.hscroll { align-items: flex-start; }
.hscroll > * { flex: none; scroll-snap-align: start; }
.hscroll.single > * { width: 100%; }
@media (min-width: 900px) { .hscroll { margin-left: 0; margin-right: 0; padding-left: 0; padding-right: 0; flex-wrap: wrap; } }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: 999px; white-space: nowrap; font-size: 12.5px; color: var(--nh-dim); background: rgba(255, 255, 255, .035); border: 1px solid var(--nh-line); }
.chip b { color: var(--nh-ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.chip .ic { font-size: 14px; }
.chip .dot { width: 7px; height: 7px; }
.chip.on { color: var(--nh-ink); border-color: rgba(77, 227, 255, .45); background: rgba(77, 227, 255, .12); }
.more { justify-self: center; min-height: 40px; padding: 0 16px; font-size: 13px; font-weight: 600; color: var(--nh-cyan); }
.empty { display: grid; justify-items: center; gap: 6px; text-align: center; padding: 28px 18px; color: var(--nh-dim); }
.empty .ic { font-size: 30px; color: var(--nh-faint); margin-bottom: 4px; }
.empty b { color: var(--nh-ink); font-size: 15px; }
.preview { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 14px; font-size: 12.5px; color: var(--nh-dim); background: rgba(177, 151, 255, .08); border: 1px dashed rgba(177, 151, 255, .45); }
.preview .ic { font-size: 16px; color: var(--nh-violet); margin-top: 1px; }
.preview b { color: var(--nh-violet); }
.foot { text-align: center; font-size: 11.5px; color: var(--nh-faint); }
.vh { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.vh > .icon-btn { align-self: center; }
.vh-t { flex: 1 1 200px; min-width: 0; }
.vh h1 { font: 600 26px/1.1 var(--nh-display); letter-spacing: .01em; margin-top: 6px; }
.vh-acts { display: flex; gap: 6px; }
.seg { display: inline-flex; gap: 4px; padding: 4px; border-radius: 14px; background: rgba(4, 12, 22, .55); border: 1px solid var(--nh-line); }
.seg button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 44px; min-height: 34px; padding: 0 10px; border-radius: 10px; font-size: 12.5px; font-weight: 600; color: var(--nh-dim); white-space: nowrap; }
.seg button .ic { font-size: 15px; }
.seg button.on { color: #06101c; background: var(--tone); box-shadow: 0 0 14px rgba(var(--tone-rgb), .45); }
.mode { min-height: 32px; padding: 0 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600; color: var(--nh-dim); border: 1px solid var(--nh-line); }
.mode.on { color: var(--tone); border-color: rgba(var(--tone-rgb), .5); background: rgba(var(--tone-rgb), .13); }

/* Home header */
.hello { display: grid; gap: 12px; }
.hello-row { display: flex; align-items: flex-start; gap: 12px; }
.hello-text { flex: 1; min-width: 0; }
.hello h1 { font: 600 26px/1.15 var(--nh-display); letter-spacing: .01em; margin-top: 6px; text-wrap: balance; }
.clock { text-align: right; font-family: var(--nh-display); line-height: 1; padding-top: 2px; }
.clock b { font-size: 30px; font-weight: 600; font-variant-numeric: tabular-nums; text-shadow: 0 0 18px rgba(77, 227, 255, .4); }
.clock small { display: block; margin-top: 6px; font-size: 11px; letter-spacing: .16em; color: var(--nh-dim); }
.status { display: inline-flex; align-items: center; gap: 9px; justify-self: start; min-height: 32px; font-size: 13.5px; color: var(--nh-dim); }
.status b { color: var(--nh-ink); }
.status .ic { font-size: 15px; color: var(--nh-faint); margin-left: -4px; }
.wx { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 14px; border-radius: 18px; background: var(--nh-glass); border: 1px solid var(--nh-line); }
.wx-ic { font-size: 32px; color: var(--nh-cyan); display: grid; filter: drop-shadow(0 0 8px rgba(77, 227, 255, .5)); }
.wx-t { display: grid; gap: 3px; }
.wx-t b { font: 600 26px/1 var(--nh-display); font-variant-numeric: tabular-nums; }
.wx-t small { font-size: 11.5px; color: var(--nh-dim); }
.wx-m { margin-left: auto; display: grid; gap: 3px; justify-items: end; font-size: 12.5px; color: var(--nh-dim); }
.wx-m span { display: inline-flex; align-items: center; gap: 4px; }
.wx-m b { color: var(--nh-ink); font-weight: 600; }
.hours { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin-left: calc(-1 * max(16px, env(safe-area-inset-left, 0px))); margin-right: calc(-1 * max(16px, env(safe-area-inset-right, 0px))); padding: 0 max(16px, env(safe-area-inset-right, 0px)) 2px max(16px, env(safe-area-inset-left, 0px)); }
.hours::-webkit-scrollbar { display: none; }
.hour { flex: none; width: 56px; display: grid; justify-items: center; gap: 4px; padding: 9px 0 7px; border-radius: 14px; background: rgba(14, 33, 54, .45); border: 1px solid var(--nh-line); font-size: 11.5px; color: var(--nh-dim); }
.hour .ic { font-size: 19px; color: var(--nh-ink); }
.hour b { font: 600 14px var(--nh-display); color: var(--nh-ink); }
.hour i { font-style: normal; font-size: 10.5px; color: var(--nh-water); }

/* Hero flow */
.flow { position: relative; width: 100%; max-width: 500px; justify-self: center; aspect-ratio: 360 / 272; container-type: inline-size; }
.flow-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.ln-base { fill: none; stroke-width: 1.3; opacity: .22; }
.ln { fill: none; stroke-width: 2.6; stroke-linecap: round; stroke-dasharray: 1.5 9.5; animation: nh-flow var(--dur, 1.6s) linear infinite; filter: url(#nh-glow); }
.ln.idle { animation: none; opacity: .3; }
@keyframes nh-flow { to { stroke-dashoffset: -22; } }
.house path, .house rect { fill: none; stroke: #8fe9ff; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.house .win { fill: rgba(255, 196, 92, .08); stroke: rgba(255, 196, 92, .55); }
.house .win.lit { fill: rgba(255, 196, 92, .6); stroke: #ffc45c; }
.node { position: absolute; width: 28%; aspect-ratio: 1; transform: translate(-50%, -50%); border-radius: 50%; display: grid; place-content: center; justify-items: center; text-align: center; color: var(--nh-ink);
  background: radial-gradient(circle at 50% 32%, rgba(var(--tone-rgb), .22), rgba(7, 18, 32, .94) 68%);
  box-shadow: 0 0 0 1.5px rgba(var(--tone-rgb), .8), 0 0 28px -4px rgba(var(--tone-rgb), .8), inset 0 0 22px rgba(var(--tone-rgb), .2); transition: transform .15s; }
.node:active { transform: translate(-50%, -50%) scale(.96); }
.node > .ic { font-size: 17px; color: var(--tone); filter: drop-shadow(0 0 6px rgba(var(--tone-rgb), .9)); margin-bottom: 3px; }
.node-v { font: 600 19px/1 var(--nh-display); font-size: clamp(15px, 5.6cqw, 23px); font-variant-numeric: tabular-nums; white-space: nowrap; }
.node-v small { font-size: .6em; margin-left: 2px; color: var(--nh-dim); font-weight: 500; }
.node-l { margin-top: 4px; font: 600 9px/1.2 var(--nh-display); font-size: clamp(8.5px, 2.5cqw, 10.5px); letter-spacing: .14em; text-transform: uppercase; color: var(--tone); }

/* Alerts */
.alerts { display: grid; gap: 8px; }
.alert { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; border-radius: 16px; background: linear-gradient(90deg, rgba(var(--tone-rgb), .15), rgba(var(--tone-rgb), .03) 65%), var(--nh-glass-2); border: 1px solid rgba(var(--tone-rgb), .32); }
.al-ic { width: 38px; height: 38px; display: grid; place-items: center; flex: none; border-radius: 12px; font-size: 19px; color: var(--tone); background: rgba(var(--tone-rgb), .14); }
.al-t { flex: 1; min-width: 0; display: grid; gap: 2px; }
.al-t b { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-t small { font-size: 12.5px; color: var(--nh-dim); }
.alert > .ic:last-child { font-size: 17px; color: var(--nh-faint); }

/* Home strips */
.aq { width: 132px; display: grid; gap: 6px; padding: 12px; border-radius: 18px; background: linear-gradient(180deg, rgba(var(--tone-rgb), .12), rgba(9, 23, 39, .75) 70%); border: 1px solid rgba(var(--tone-rgb), .28); }
.aq-n { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.aq-v b { font: 600 26px/1 var(--nh-display); font-variant-numeric: tabular-nums; }
.aq-v small { margin-left: 4px; font-size: 11px; color: var(--nh-dim); }
.aq-l { font-size: 11px; color: var(--tone); font-weight: 600; white-space: nowrap; }
.people { gap: 6px; }
.person { width: 78px; display: grid; justify-items: center; gap: 6px; padding: 4px 0; text-align: center; }
.ava { position: relative; display: grid; place-items: center; flex: none; width: 58px; height: 58px; border-radius: 50%; font: 600 19px/1 var(--nh-display); color: #06101c; background: var(--pc); box-shadow: 0 0 0 2px #06101c, 0 0 0 4px var(--pc), 0 0 22px -2px var(--pc); }
.ava img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.ava.sm { width: 38px; height: 38px; font-size: 14px; box-shadow: 0 0 0 2px #06101c, 0 0 0 3.5px var(--pc), 0 0 16px -2px var(--pc); }
.ava.md { width: 48px; height: 48px; font-size: 17px; }
.away .ava { box-shadow: 0 0 0 2px #06101c, 0 0 0 3.5px rgba(255, 255, 255, .22); }
.ava-b { position: absolute; right: -5px; bottom: -5px; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; font-size: 13px; font-style: normal; color: var(--nh-amber); background: #0b1c2f; border: 1px solid var(--nh-line-2); }
.ava.sm .ava-b { width: 18px; height: 18px; font-size: 11px; right: -6px; bottom: -6px; }
.p-n { max-width: 100%; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.p-s { max-width: 100%; margin-top: -4px; font-size: 11.5px; color: var(--nh-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rmini { display: flex; align-items: center; gap: 10px; padding: 10px 14px 10px 10px; border-radius: 18px; background: var(--nh-glass); border: 1px solid var(--nh-line); }
.rmini-ic { width: 40px; height: 40px; display: grid; place-items: center; flex: none; border-radius: 50%; font-size: 21px; color: var(--tone); background: rgba(var(--tone-rgb), .12); box-shadow: inset 0 0 0 1px rgba(var(--tone-rgb), .35); }
.rmini.cleaning .rmini-ic .ic { animation: nh-spin 2.4s linear infinite; }
.rmini-t { display: grid; gap: 2px; }
.rmini-t b { font-size: 13.5px; font-weight: 600; white-space: nowrap; }
.rmini-t small { font-size: 12px; font-weight: 600; color: var(--tone); white-space: nowrap; }

/* Tiles */
.tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (min-width: 560px) and (max-width: 899px) { .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.tile { position: relative; display: grid; align-content: space-between; gap: 10px; min-height: 108px; padding: 12px; border-radius: 18px; background: linear-gradient(180deg, rgba(20, 44, 70, .5), rgba(9, 23, 39, .72)); border: 1px solid var(--nh-line); transition: transform .12s, box-shadow .2s, border-color .2s, opacity .2s; }
.tile:active { transform: scale(.96); }
.tile-ic { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 13px; font-size: 20px; color: var(--nh-dim); background: rgba(255, 255, 255, .05); transition: background .2s, color .2s; }
.tile-n { font-size: 13px; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tile-s { margin-top: -6px; font-size: 11.5px; color: var(--nh-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile.on { border-color: rgba(var(--tone-rgb), .5); background: linear-gradient(180deg, rgba(var(--tone-rgb), .2), rgba(9, 23, 39, .78) 82%); box-shadow: 0 0 26px -12px rgba(var(--tone-rgb), 1); }
.tile.on .tile-ic { color: #06101c; background: var(--tone); box-shadow: 0 0 16px rgba(var(--tone-rgb), .7); }
.tile.on .tile-s { color: var(--tone); }
.tile.spin.on .tile-ic .ic { animation: nh-spin 1.8s linear infinite; }
.tile.gone { opacity: .45; }
.tile.busy { opacity: .6; }
@keyframes nh-spin { to { transform: rotate(360deg); } }

/* Climate */
.clim { width: min(320px, 84vw); display: grid; gap: 12px; align-content: start; }
.clim.wide { width: min(340px, 88vw); }
.clim-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.clim-name { min-width: 0; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.clim-mid { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.clim-mid.stack { align-items: stretch; flex-direction: column; }
.clim-now b { font: 600 40px/1 var(--nh-display); font-variant-numeric: tabular-nums; }
.clim-now small { display: block; margin-top: 4px; font-size: 12px; color: var(--nh-dim); }
.clim-off { font: 600 14px var(--nh-display); letter-spacing: .14em; text-transform: uppercase; color: var(--nh-faint); }
.dual { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.stepper { display: flex; align-items: center; justify-content: space-between; gap: 2px; padding: 4px; border-radius: 16px; background: rgba(4, 12, 22, .55); border: 1px solid var(--nh-line); }
.stepper button { width: 42px; height: 42px; display: grid; place-items: center; flex: none; border-radius: 12px; font-size: 18px; color: var(--nh-cyan); background: rgba(77, 227, 255, .08); }
.stepper button:active { background: rgba(77, 227, 255, .24); }
.dual .stepper button { width: 36px; height: 40px; }
.tgt { min-width: 50px; text-align: center; }
.tgt b { font: 600 20px/1 var(--nh-display); font-variant-numeric: tabular-nums; }
.tgt small { display: block; margin-top: 3px; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--nh-dim); white-space: nowrap; }
.modes { display: flex; flex-wrap: wrap; gap: 6px; }

/* Lists & cameras */
.cams { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.cam { position: relative; aspect-ratio: 16 / 10; overflow: hidden; border-radius: 16px; background: #0a1a2c; border: 1px solid var(--nh-line); }
.cam img { width: 100%; height: 100%; object-fit: cover; }
.cam span { position: absolute; left: 8px; bottom: 8px; padding: 3px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 600; background: rgba(5, 13, 24, .8); }

/* Air */
.air-hero { display: flex; align-items: center; gap: 16px; }
.ring { position: relative; width: 112px; height: 112px; flex: none; }
.ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.ring-v { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; }
.ring-v b { font: 600 38px/1 var(--nh-display); font-variant-numeric: tabular-nums; }
.ring-v small { margin-top: 5px; font: 600 9px var(--nh-display); letter-spacing: .14em; color: var(--nh-dim); }
.air-sum { display: grid; gap: 7px; justify-items: start; min-width: 0; }
.air-sum h2 { font: 600 19px/1.2 var(--nh-display); text-wrap: balance; }
.air-sum p { font-size: 13.5px; color: var(--nh-dim); }
.tips { display: grid; gap: 8px; }
.tip { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 10px; padding: 12px; border-radius: 16px; font-size: 13.5px; background: rgba(var(--tone-rgb), .07); border: 1px solid rgba(var(--tone-rgb), .24); }
.tip > .ic { margin-top: 1px; font-size: 18px; color: var(--tone); }
.tip > span { flex: 1; min-width: 180px; }
.tip-act { min-height: 34px; padding: 0 12px; border-radius: 10px; font-size: 12.5px; font-weight: 600; color: #06101c; background: var(--tone); }
.rooms { display: grid; gap: 12px; }
@media (min-width: 640px) { .rooms { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.room { display: grid; gap: 10px; }
.room-h { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.room-h h3 { font-size: 15.5px; font-weight: 600; }
.room-h small { font-size: 12px; color: var(--nh-faint); }
.room-main { display: flex; align-items: flex-end; gap: 14px; width: 100%; }
.room-big { display: grid; gap: 4px; flex: none; }
.room-big b { font: 600 38px/.95 var(--nh-display); font-variant-numeric: tabular-nums; }
.room-big span { font-size: 11.5px; color: var(--nh-dim); }
.room-spark { position: relative; flex: 1; min-width: 0; height: 46px; }
.room-spark svg, .chart svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.cdot { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: var(--tone); box-shadow: 0 0 0 3px rgba(var(--tone-rgb), .25), 0 0 10px var(--tone); }
.scale { position: relative; height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--nh-good) 0 var(--s1), var(--nh-lime) var(--s1) var(--s2), var(--nh-fair) var(--s2) var(--s3), var(--nh-poor) var(--s3) var(--s4), var(--nh-bad) var(--s4) 100%); opacity: .85; }
.scale i { position: absolute; top: 50%; width: 14px; height: 14px; border-radius: 50%; transform: translate(-50%, -50%); background: #06101c; border: 3px solid var(--tone); box-shadow: 0 0 10px rgba(var(--tone-rgb), .9); }
.purs { display: grid; gap: 10px; }
@media (min-width: 640px) { .purs { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.pur { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px 12px; }
.pur-btn { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 15px; font-size: 22px; color: var(--nh-dim); background: rgba(255, 255, 255, .05); border: 1px solid var(--nh-line); }
.pur.on .pur-btn { color: #06101c; background: var(--nh-mint); border-color: transparent; box-shadow: 0 0 18px rgba(68, 230, 176, .6); }
.pur-info { display: grid; gap: 2px; min-width: 0; }
.pur-info b { font-size: 14.5px; font-weight: 600; }
.pur-info small { font-size: 12.5px; color: var(--nh-dim); }
.pur .seg, .pur .chips { grid-column: 1 / -1; }
.pur .seg { display: flex; }
.pur .seg button { flex: 1; }
.pur.gone { opacity: .5; }
.legend { display: grid; gap: 4px; font-size: 12.5px; color: var(--nh-dim); }
.legend b { color: var(--nh-ink); font-size: 13px; }

/* Map */
.mapview { position: absolute; inset: 0; }
.map-canvas { position: absolute; inset: 0; z-index: 0; background: #07121f; }
.map-canvas[hidden] { display: none; }
.map-ui { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.map-ui > * { pointer-events: auto; }
.map-ui > .map-top, .map-ui > .map-sheet { pointer-events: none; }
.map-top > *, .map-sheet > * { pointer-events: auto; }
.map-top { position: absolute; z-index: 5; top: calc(12px + var(--nh-top)); left: max(12px, env(safe-area-inset-left, 0px)); right: max(12px, env(safe-area-inset-right, 0px)); display: flex; align-items: center; gap: 8px; }
.map-title { display: grid; gap: 3px; margin-right: auto; padding: 8px 14px; border-radius: 16px; }
.map-title b { font: 600 15px/1.1 var(--nh-display); }
.map-top .seg { background: rgba(8, 20, 35, .84); }
.map-msg { position: absolute; z-index: 6; top: calc(74px + var(--nh-top)); left: 16px; right: 16px; display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: 16px; font-size: 13px; color: var(--nh-dim); }
.map-sheet .map-msg { position: static; margin: 0 16px; }
.map-msg .ic { font-size: 18px; color: var(--nh-amber); flex: none; }
.map-sheet { position: absolute; z-index: 5; left: 0; right: 0; bottom: calc(var(--nh-nav-h) + 2px); }
.pcards { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; padding: 6px max(16px, env(safe-area-inset-right, 0px)) 6px max(16px, env(safe-area-inset-left, 0px)); scroll-padding: 0 16px; }
.pcards::-webkit-scrollbar { display: none; }
.pcard { flex: none; width: min(310px, 82vw); scroll-snap-align: center; display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 12px; border-radius: 20px; background: rgba(8, 20, 35, .9); border: 1px solid var(--nh-line-2); box-shadow: 0 14px 30px -12px rgba(0, 0, 0, .85); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
.pcard.on { border-color: var(--pc); box-shadow: 0 0 0 1px var(--pc), 0 14px 30px -12px rgba(0, 0, 0, .85); }
.pc-body { flex: 1; min-width: 0; display: grid; gap: 2px; }
.pc-body b { font-size: 15px; font-weight: 600; }
.pc-st { display: flex; align-items: center; gap: 6px; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc-st .ic { color: var(--pc); font-size: 14px; }
.pc-meta { font-size: 11.5px; color: var(--nh-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.batt { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; font-size: 12px; font-weight: 600; color: var(--nh-dim); white-space: nowrap; }
.batt .ic { font-size: 15px; }
.batt.low { color: var(--nh-bad); }
.radar { position: absolute; inset: 0; overflow: hidden; display: grid; place-items: center; padding: calc(78px + var(--nh-top)) 18px calc(var(--nh-nav-h) + 128px); }
.radar-box { position: relative; width: min(90vw, 430px); height: min(90vw, 430px); }
@supports (width: 1cqh) {
  .radar { container-type: size; }
  .radar-box { width: min(100cqw, 100cqh, 520px); height: min(100cqw, 100cqh, 520px); }
}
.radar-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.rr { fill: none; stroke: rgba(124, 214, 255, .2); stroke-width: .6; }
.rr.dash { stroke-dasharray: 1.5 3; stroke: rgba(124, 214, 255, .16); }
.rx { stroke: rgba(124, 214, 255, .07); stroke-width: .5; }
.rl { fill: #637d97; font: 600 5px var(--nh-display); letter-spacing: .08em; }
.rl.n { fill: #93abc4; }
.sweep { position: absolute; inset: 4%; border-radius: 50%; background: conic-gradient(from 0deg, rgba(77, 227, 255, .2), rgba(77, 227, 255, 0) 24%, transparent); animation: nh-spin 8s linear infinite; }
.rm-home { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; transform: translate(-50%, -50%); display: grid; place-items: center; border-radius: 50%; font-size: 21px; color: var(--nh-cyan); background: radial-gradient(circle, rgba(77, 227, 255, .25), rgba(5, 13, 24, .92) 70%); box-shadow: 0 0 0 1.5px rgba(77, 227, 255, .6), 0 0 26px rgba(77, 227, 255, .45); }
.rm { position: absolute; z-index: 2; transform: translate(-50%, -50%); display: grid; justify-items: center; gap: 5px; }
.rm.home .ava.sm { width: 34px; height: 34px; font-size: 12.5px; }
.rm-l { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap; background: rgba(5, 13, 24, .88); border: 1px solid var(--nh-line); }
.rm.on .rm-l { border-color: var(--pc); color: var(--pc); }
.nh-marker { background: none; border: 0; }
.mk { position: relative; width: 46px; height: 46px; }
.mk .ava { width: 46px; height: 46px; font-size: 16px; }
.mk-zone { padding: 2px 8px; border-radius: 999px; font: 600 10.5px var(--nh-body); white-space: nowrap; color: var(--nh-dim); background: rgba(5, 13, 24, .8); border: 1px solid var(--nh-line); transform: translate(-50%, -50%); display: inline-block; }
.mk-home { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; font-size: 17px; color: var(--nh-cyan); background: rgba(5, 13, 24, .9); box-shadow: 0 0 0 1.5px rgba(77, 227, 255, .7), 0 0 18px rgba(77, 227, 255, .5); }

/* Energy & water */
.hero2 { display: grid; gap: 12px; scroll-margin-top: calc(16px + var(--nh-top)); }
.hero2-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.big { position: relative; display: flex; align-items: baseline; gap: 8px; }
.big b { font: 600 54px/.9 var(--nh-display); font-variant-numeric: tabular-nums; text-shadow: 0 0 26px rgba(var(--tone-rgb), .45); }
.big span { font: 600 16px var(--nh-display); color: var(--tone); }
.sub { font-size: 13.5px; color: var(--nh-dim); }
.sub b { color: var(--nh-ink); font-weight: 600; }
.note { font-size: 12px; color: var(--nh-faint); }
.live { display: inline-flex; align-items: center; gap: 6px; font: 600 11px var(--nh-display); letter-spacing: .14em; text-transform: uppercase; color: var(--tone); }
.live i { width: 7px; height: 7px; border-radius: 50%; background: var(--tone); box-shadow: 0 0 10px var(--tone); animation: nh-pulse 1.8s ease-in-out infinite; }
@keyframes nh-pulse { 50% { opacity: .35; transform: scale(.75); } }
.chart { position: relative; height: 130px; }
.chart > svg { top: 16px; height: calc(100% - 36px); }
.chart .cdot { margin-top: 0; }
.chart.loading { border-radius: 12px; background: linear-gradient(90deg, rgba(255, 255, 255, .03), rgba(255, 255, 255, .07), rgba(255, 255, 255, .03)); background-size: 200% 100%; animation: nh-shimmer 1.4s linear infinite; }
.empty-chart { display: grid; place-items: center; font-size: 12.5px; color: var(--nh-faint); }
@keyframes nh-shimmer { to { background-position: -200% 0; } }
.chart-y { position: absolute; left: 0; top: 0; font-size: 10.5px; color: var(--nh-faint); }
.chart-x { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; font-size: 10.5px; color: var(--nh-faint); font-variant-numeric: tabular-nums; }
.bars24 .b24 { position: absolute; left: 0; right: 0; top: 18px; bottom: 20px; display: flex; align-items: flex-end; gap: 3px; }
.b24 i { flex: 1; min-height: 0; border-radius: 3px 3px 1px 1px; background: linear-gradient(180deg, var(--tone), rgba(var(--tone-rgb), .35)); box-shadow: 0 0 8px rgba(var(--tone-rgb), .35); }
.ripples { position: relative; align-self: center; width: 12px; height: 12px; margin-left: 10px; border-radius: 50%; background: var(--tone); box-shadow: 0 0 10px var(--tone); }
.ripples i { position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid var(--tone); animation: nh-ripple 2.4s ease-out infinite; }
.ripples i:nth-child(2) { animation-delay: .8s; }
.ripples i:nth-child(3) { animation-delay: 1.6s; }
@keyframes nh-ripple { from { transform: scale(.3); opacity: .9; } to { transform: scale(3.4); opacity: 0; } }
.bars { display: grid; gap: 14px; }
.bar-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 7px 10px; width: 100%; }
.bar-n { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar-v { font: 600 14px var(--nh-display); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.bar-v small { margin-left: 4px; font: 500 11.5px var(--nh-body); color: var(--nh-faint); }
.bar-t { grid-column: 1 / -1; height: 6px; overflow: hidden; border-radius: 3px; background: rgba(255, 255, 255, .05); }
.bar-t i { display: block; height: 100%; min-width: 3px; border-radius: 3px; background: linear-gradient(90deg, rgba(var(--tone-rgb), .45), var(--tone)); box-shadow: 0 0 10px rgba(var(--tone-rgb), .55); transition: width .6s ease; }
.rows { display: grid; gap: 0; padding-block: 4px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 46px; padding: 6px 2px; border-bottom: 1px solid var(--nh-line); font-size: 13.5px; }
.row:last-child { border-bottom: 0; }
.row-l { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
.row-l .ic { font-size: 18px; color: var(--nh-amber); }
.row.busy { opacity: .6; }
.switch { position: relative; width: 46px; height: 28px; flex: none; border-radius: 14px; background: rgba(255, 255, 255, .08); border: 1px solid var(--nh-line-2); transition: background .2s; }
.switch i { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--nh-dim); transition: transform .2s, background .2s; }
.switch.on { background: rgba(255, 181, 71, .35); border-color: rgba(255, 181, 71, .6); }
.switch.on i { transform: translateX(18px); background: var(--nh-amber); box-shadow: 0 0 10px rgba(255, 181, 71, .8); }
.switch.gone { opacity: .4; }
.row b { font: 600 15px var(--nh-display); font-variant-numeric: tabular-nums; }
.row small { color: var(--nh-faint); font-size: 12px; text-align: right; }
.stat3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.stat { display: grid; gap: 4px; padding: 10px 11px; border-radius: 14px; background: rgba(4, 12, 22, .45); border: 1px solid var(--nh-line); }
.stat small { font-size: 11px; color: var(--nh-dim); }
.stat b { font: 600 21px/1 var(--nh-display); font-variant-numeric: tabular-nums; }
.stat span { font-size: 11px; color: var(--nh-faint); }

/* Robots */
.robots { display: grid; gap: 12px; }
@media (min-width: 720px) { .robots { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; } }
.robot { display: grid; gap: 14px; }
.rb-top { display: flex; align-items: center; gap: 14px; }
.rb-disc { position: relative; width: 80px; height: 80px; flex: none; }
.rb-disc svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.rb-core { position: absolute; inset: 12px; display: grid; place-items: center; border-radius: 50%; font-size: 27px; color: var(--tone); background: radial-gradient(circle at 50% 32%, rgba(var(--tone-rgb), .24), rgba(6, 16, 28, .96) 70%); box-shadow: inset 0 0 0 1px rgba(var(--tone-rgb), .4); }
.robot.cleaning .rb-core .ic { animation: nh-spin 2.4s linear infinite; }
.robot.unavailable { opacity: .6; }
.rb-info { flex: 1; min-width: 0; display: grid; gap: 4px; justify-items: start; }
.rb-info h3 { font: 600 19px/1.15 var(--nh-display); }
.rb-info small { font-size: 12.5px; color: var(--nh-dim); }
.rb-row { display: flex; align-items: center; gap: 10px; margin-top: 2px; }
.rb-batt { display: inline-flex; align-items: center; gap: 4px; font: 600 13px var(--nh-display); color: var(--nh-dim); }
.rb-err { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 14px; font-size: 13px; color: #ffc2cc; background: rgba(255, 84, 112, .1); border: 1px solid rgba(255, 84, 112, .32); }
.rb-err .ic { font-size: 16px; color: var(--nh-bad); margin-top: 1px; }
.acts { display: grid; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); gap: 8px; }
.act { display: grid; justify-items: center; gap: 5px; min-height: 60px; padding: 10px 4px; border-radius: 14px; font-size: 12px; font-weight: 600; text-align: center; background: rgba(255, 255, 255, .04); border: 1px solid var(--nh-line); }
.act .ic { font-size: 20px; color: var(--nh-cyan); }
.act:active { transform: scale(.97); }
.act.primary { background: linear-gradient(180deg, rgba(68, 230, 176, .28), rgba(68, 230, 176, .08)); border-color: rgba(68, 230, 176, .5); }
.act.primary .ic { color: var(--nh-mint); }
.rb-speed { display: grid; gap: 6px; }
.rb-speed small { font: 600 10.5px var(--nh-display); letter-spacing: .14em; text-transform: uppercase; color: var(--nh-dim); }
.rb-speed .seg { display: flex; overflow-x: auto; scrollbar-width: none; }
.rb-speed .seg button { flex: 1; }

/* Sheets and toast */
.sheet-back { position: absolute; inset: 0; z-index: 40; background: rgba(2, 6, 12, .6); animation: nh-fade .2s ease; }
.sheet { position: absolute; z-index: 41; left: 0; right: 0; bottom: 0; max-width: 640px; max-height: 82%; margin: 0 auto; display: flex; flex-direction: column; border-radius: 26px 26px 0 0; background: #0a1a2c; border: 1px solid var(--nh-line-2); border-bottom: 0; box-shadow: 0 -20px 50px rgba(0, 0, 0, .6); padding-bottom: var(--nh-bottom); animation: nh-up .3s cubic-bezier(.2, .8, .2, 1); }
.sheet-grab { width: 40px; height: 4px; margin: 10px auto 0; border-radius: 2px; background: rgba(255, 255, 255, .2); }
.sheet-h { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px 6px 20px; }
.sheet-h h2 { font: 600 18px var(--nh-display); }
.sheet-b { display: grid; gap: 8px; padding: 6px 16px 20px; overflow-y: auto; overscroll-behavior: contain; }
.sheet-b .row { padding-inline: 4px; }
.sheet-b .row span { text-align: left; }
@keyframes nh-up { from { transform: translateY(40px); opacity: 0; } }
@keyframes nh-fade { from { opacity: 0; } }
.toast { position: absolute; z-index: 50; left: 50%; bottom: calc(var(--nh-nav-h) + 12px); max-width: calc(100% - 32px); padding: 10px 16px; border-radius: 999px; font-size: 13px; background: #10263d; border: 1px solid var(--nh-line-2); box-shadow: 0 10px 30px rgba(0, 0, 0, .5); opacity: 0; transform: translate(-50%, 10px); pointer-events: none; transition: opacity .25s, transform .25s; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.toast.bad { border-color: rgba(255, 84, 112, .5); color: #ffc2cc; }

/* v2: score, PM0.3 chart, controls, robots, billing, health, settings */
.nav-b { font-size: 10px; gap: 4px; min-height: 50px; }
.nav-b .ic { font-size: 20px; }
.status-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.icon-btn.sm { width: 36px; height: 36px; border-radius: 12px; font-size: 17px; }
.score { display: grid; gap: 12px; }
.score-top { display: flex; align-items: center; gap: 14px; }
.ring.sm { width: 96px; height: 96px; }
.ring.sm .ring-v b { font-size: 32px; }
.ring.xs { width: 54px; height: 54px; }
.ring.xs .ring-v b { font: 600 15px/1 var(--nh-display); }
.score-sum { display: grid; gap: 6px; justify-items: start; min-width: 0; }
.score-sum h2 { font: 600 19px/1.2 var(--nh-display); text-wrap: balance; }
.score-sum p { font-size: 12.5px; color: var(--nh-dim); }
.parts { display: grid; gap: 2px; }
.part { display: grid; grid-template-columns: minmax(0, 1fr) auto 64px 28px; align-items: center; gap: 10px; min-height: 38px; padding: 4px 2px; border-bottom: 1px solid var(--nh-line); }
.part:last-child { border-bottom: 0; }
.part-l { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.part-v { font-size: 12px; color: var(--nh-dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
.part-bar { height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .06); overflow: hidden; }
.part-bar i { display: block; height: 100%; border-radius: 3px; background: var(--tone); }
.part-s { font: 600 14px var(--nh-display); text-align: right; font-variant-numeric: tabular-nums; }
.math { display: grid; gap: 6px; padding: 10px 12px; border-radius: 14px; font-size: 12.5px; color: var(--nh-dim); background: rgba(4, 12, 22, .5); border: 1px solid var(--nh-line); }
.math b { color: var(--nh-ink); }
.pmchart { display: grid; gap: 10px; }
.lchart, .cchart { position: relative; height: var(--h, 160px); padding: 6px 0 20px 36px; }
.lc-ticks { position: absolute; left: 0; top: 6px; bottom: 20px; width: 32px; }
.lc-ticks span { position: absolute; right: 4px; transform: translateY(-50%); font-size: 10.5px; color: var(--nh-faint); font-variant-numeric: tabular-nums; }
.lc-plot { position: relative; height: 100%; touch-action: pan-y; cursor: crosshair; }
.lc-plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.lc-grid line { stroke: rgba(124, 214, 255, .09); stroke-width: 1; vector-effect: non-scaling-stroke; }
.lc-dot { position: absolute; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; border-radius: 50%; box-shadow: 0 0 0 2px #0b1a2b; pointer-events: none; }
.lc-x { position: absolute; left: 36px; right: 0; bottom: 0; display: flex; justify-content: space-between; font-size: 10.5px; color: var(--nh-faint); }
.lc-hover { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .15s; }
.lc-hover.show { opacity: 1; }
.lc-cross { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(233, 245, 255, .45); }
.lc-tip { position: absolute; top: 0; transform: translateX(10px); min-width: 120px; padding: 8px 10px; border-radius: 12px; background: #0e2236; border: 1px solid var(--nh-line-2); box-shadow: 0 10px 24px rgba(0, 0, 0, .5); display: grid; gap: 3px; z-index: 2; }
.lc-tip.left { transform: translateX(calc(-100% - 10px)); }
.lc-tip small { font-size: 11px; color: var(--nh-dim); }
.tip-row { display: flex; align-items: center; gap: 7px; font-size: 12.5px; white-space: nowrap; }
.tip-row i { width: 12px; height: 2px; border-radius: 1px; flex: none; }
.tip-row b { font-variant-numeric: tabular-nums; }
.tip-row span { color: var(--nh-dim); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.lg { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; font-size: 13px; color: var(--nh-dim); }
.lg i { width: 14px; height: 2px; border-radius: 1px; flex: none; }
.lg b { color: var(--nh-ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.cc-bars { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 2px; }
.cc-bars i { flex: 1; max-width: 24px; min-height: 0; border-radius: 4px 4px 0 0; background: var(--nh-mint); opacity: .85; }
.ctls { display: grid; gap: 10px; }
@media (min-width: 640px) { .ctls { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.ctl { display: grid; gap: 10px; padding: 12px; border-radius: 18px; background: linear-gradient(180deg, rgba(20, 44, 70, .5), rgba(9, 23, 39, .74)); border: 1px solid var(--nh-line); }
.ctl-h { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ctl-h .ic { font-size: 18px; color: var(--tone); }
.ctl-h b { font-size: 14.5px; font-weight: 600; }
.ctl-h small { margin-left: auto; font-size: 11.5px; color: var(--nh-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ctl-b { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ctl-btn { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 52px; border-radius: 14px; font-size: 14px; font-weight: 600; background: rgba(255, 255, 255, .04); border: 1px solid var(--nh-line); transition: transform .12s, background .2s; }
.ctl-btn .ic { font-size: 19px; color: var(--tone); }
.ctl-btn.off .ic { color: var(--nh-dim); }
.ctl-btn:active { transform: scale(.97); }
.ctl-btn.on { color: #06101c; background: var(--tone); border-color: transparent; box-shadow: 0 0 18px rgba(var(--tone-rgb), .5); }
.ctl-btn.on .ic { color: #06101c; }
.ctl-btn.off.on { color: var(--nh-ink); background: rgba(255, 255, 255, .12); box-shadow: none; }
.ctl-btn.off.on .ic { color: var(--nh-ink); }
.ctl-btn[disabled] { opacity: .35; }
.rs-list { display: grid; gap: 0; padding-block: 4px; }
.rs { display: flex; align-items: center; gap: 10px; min-height: 60px; border-bottom: 1px solid var(--nh-line); }
.rs:last-child { border-bottom: 0; }
.rs-main { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.rs-main .rmini-t { min-width: 0; }
.rs-main .rmini-t b { overflow: hidden; text-overflow: ellipsis; }
.rs.cleaning .rmini-ic .ic { animation: nh-spin 2.4s linear infinite; }
.rs-acts { display: flex; gap: 6px; flex: none; }
.rs-btn { display: inline-flex; align-items: center; gap: 5px; min-height: 40px; padding: 0 11px; border-radius: 12px; font-size: 12.5px; font-weight: 600; background: rgba(255, 255, 255, .05); border: 1px solid var(--nh-line); }
.rs-btn .ic { font-size: 16px; color: var(--nh-cyan); }
.rs-btn.primary { background: rgba(68, 230, 176, .16); border-color: rgba(68, 230, 176, .45); }
.rs-btn.primary .ic { color: var(--nh-mint); }
.bills { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.bill { display: grid; gap: 2px; align-content: start; padding: 12px; border-radius: 18px; background: linear-gradient(180deg, rgba(var(--tone-rgb), .12), rgba(9, 23, 39, .76) 70%); border: 1px solid rgba(var(--tone-rgb), .28); }
.bill-h { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 13px; }
.bill-h .ic { color: var(--tone); font-size: 16px; }
.bill-k { font-size: 11px; color: var(--nh-dim); }
.bill-v { font: 600 24px/1.1 var(--nh-display); }
.bill-e { font: 600 17px/1.2 var(--nh-display); color: var(--tone); margin-bottom: 4px; }
.bill-f { font-size: 11px; color: var(--nh-faint); }
.hmini { display: flex; align-items: center; gap: 10px; padding: 8px 14px 8px 8px; border-radius: 18px; background: var(--nh-glass); border: 1px solid var(--nh-line); }
.hmini-t { display: grid; gap: 2px; }
.hmini-t b { font-size: 13px; white-space: nowrap; }
.hmini-t small { font-size: 11.5px; color: var(--tone); font-weight: 600; white-space: nowrap; }
.spike { display: grid; gap: 10px; }
.spike-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.spike-now { font-size: 13px; color: var(--nh-dim); }
.spike-now b { color: var(--nh-ink); font: 600 16px var(--nh-display); }
.spike-auto { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.spike-auto > span { display: inline-flex; align-items: center; gap: 6px; margin-right: auto; color: var(--nh-good); }
.act.wide { grid-auto-flow: column; justify-content: center; align-items: center; min-height: 48px; font-size: 14px; }
.act[disabled] { opacity: .4; }
.note { font-size: 12px; color: var(--nh-faint); }
.note.warn { color: var(--nh-fair); }
.field { display: grid; grid-template-columns: minmax(0, 1fr); gap: 5px; min-width: 0; }
.field > span { font-size: 12px; color: var(--nh-dim); }
.field-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.field input, .field select, input.mini { width: 100%; min-height: 44px; padding: 0 12px; border-radius: 12px; font: 500 14px var(--nh-body); color: var(--nh-ink); background: #0c1f33; border: 1px solid var(--nh-line-2); }
.field input:focus-visible, .field select:focus-visible, input.mini:focus-visible { outline: 2px solid var(--nh-cyan); outline-offset: 1px; }
input.mini { min-height: 36px; width: 120px; flex: none; font-size: 13px; }
.checks { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
.check-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.check { display: flex; align-items: center; gap: 10px; min-height: 40px; flex: 1; min-width: 0; font-size: 13.5px; }
.check input { width: 20px; height: 20px; accent-color: var(--nh-cyan); flex: none; }
.check span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.check small { color: var(--nh-faint); }
.sheet-b h3 { margin: 14px 0 0; font: 600 13px var(--nh-display); letter-spacing: .14em; text-transform: uppercase; color: var(--nh-cyan); }
.ctl-edit { display: grid; gap: 8px; padding: 10px; border-radius: 14px; border: 1px solid var(--nh-line); justify-items: start; }
.ctl-edit .field, .ctl-edit .field-row { width: 100%; }
.rmap { display: grid; gap: 12px; padding-top: 4px; border-top: 1px solid var(--nh-line); }
.rmap-img { width: 100%; border-radius: 14px; border: 1px solid var(--nh-line); background: #07121f; }
.floor { display: grid; gap: 6px; }
.floor > small { font: 600 10.5px var(--nh-display); letter-spacing: .14em; text-transform: uppercase; color: var(--nh-dim); }
.rtiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.rtile { position: relative; display: grid; place-items: center; min-height: 64px; padding: 10px 8px; border-radius: 14px; text-align: center; font-size: 13px; font-weight: 600; color: var(--nh-dim);
  background: repeating-linear-gradient(135deg, rgba(124, 214, 255, .04) 0 6px, transparent 6px 12px), rgba(4, 12, 22, .5); border: 1px dashed rgba(124, 214, 255, .3); transition: transform .12s, background .2s; }
.rtile:active { transform: scale(.97); }
.rtile.on { color: #06101c; background: var(--nh-cyan); border: 1px solid transparent; box-shadow: 0 0 18px rgba(77, 227, 255, .45); }
.rt-o { position: absolute; top: 6px; left: 8px; min-width: 18px; height: 18px; border-radius: 9px; font: 700 11px/18px var(--nh-body); font-style: normal; color: var(--nh-cyan); background: #06101c; }
.rmap-acts { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 8px; }
.rmap-empty { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; padding: 12px; border-radius: 14px; font-size: 13px; color: var(--nh-dim); background: rgba(4, 12, 22, .45); border: 1px solid var(--nh-line); }
.rmap-empty > .ic { font-size: 18px; color: var(--nh-cyan); flex: none; }
.rmap-empty > span { flex: 1; min-width: 180px; }
.chip.repeat { justify-self: start; color: var(--nh-ink); }
.dusts { display: grid; gap: 16px; }
.dust { display: grid; gap: 4px; }
.billcard { display: grid; gap: 10px; scroll-margin-top: 16px; }
.bc-cycle { font-size: 13px; color: var(--nh-dim); }
.bc-bar { height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .06); overflow: hidden; }
.bc-bar i { display: block; height: 100%; background: var(--tone); border-radius: 3px; }
.bc-nums { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.bc-nums small { display: block; font-size: 12px; color: var(--nh-dim); }
.bc-nums b { font: 600 34px/1.05 var(--nh-display); }
.bc-nums b.est { color: var(--tone); }
.sheet-nums b { font-size: 26px; }
.heat { display: grid; gap: 8px; }
.heat-scroll { overflow-x: auto; margin: 0 -4px; }
.heat table { width: 100%; border-collapse: separate; border-spacing: 4px; font-size: 13px; }
.heat th { text-align: left; font-weight: 600; white-space: nowrap; padding: 6px 4px; }
.heat thead th { font-size: 11.5px; font-weight: 500; color: var(--nh-dim); }
.heat thead th:not(:first-child) { text-align: center; }
.heat tbody th { max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
.hn { display: inline-block; width: 22px; font-size: 11px; color: var(--nh-faint); font-variant-numeric: tabular-nums; }
.heat td { min-width: 66px; padding: 9px 6px; border-radius: 8px; text-align: center; font-weight: 600; font-variant-numeric: tabular-nums; }
.hhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.hhead > div { display: grid; gap: 2px; min-width: 0; }
.hhead b { font-size: 14px; }
.hhead small { font-size: 12px; color: var(--nh-dim); }
.hgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.hcard { display: grid; justify-items: center; gap: 10px; text-align: center; }
.hcard-h { display: flex; align-items: center; gap: 6px; justify-self: stretch; font-size: 14px; }
.hcard-h .ic:first-child { color: var(--tone); }
.hcard-h .ic:last-child { margin-left: auto; color: var(--nh-faint); }
.hcard .ring { width: 104px; height: 104px; }
.hcard .ring-v b { font-size: 32px; }
.hcard .ring-v small { font: 500 11.5px var(--nh-body); letter-spacing: 0; color: var(--nh-ink); }
.hcard-s { font-size: 12px; color: var(--nh-dim); }
.hwide { display: flex; align-items: center; gap: 16px; text-align: left; width: 100%; }
.hwide-t { display: grid; gap: 6px; }
.hwide-t b { display: inline-flex; align-items: center; gap: 8px; font: 600 18px var(--nh-display); }
.hwide-t b .ic { color: var(--tone); }
.hwide-t small { font-size: 12.5px; color: var(--nh-dim); }
.hwide .ring-v small { font: 500 12px var(--nh-body); letter-spacing: 0; color: var(--tone); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

// Leaflet's own stylesheet, trimmed to what this map uses. It has to live inside the shadow root.
const LEAFLET_CSS = `
.leaflet-pane, .leaflet-tile, .leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-tile-container, .leaflet-pane > svg, .leaflet-pane > canvas, .leaflet-zoom-box, .leaflet-image-layer, .leaflet-layer { position: absolute; left: 0; top: 0; }
.leaflet-container { overflow: hidden; background: #07121f; outline-offset: 1px; font: 12px/1.5 var(--nh-body); -webkit-tap-highlight-color: transparent; }
.leaflet-tile, .leaflet-marker-icon, .leaflet-marker-shadow { -webkit-user-select: none; user-select: none; -webkit-user-drag: none; }
.leaflet-tile::selection { background: transparent; }
.leaflet-marker-icon, .leaflet-marker-shadow { display: block; }
.leaflet-container .leaflet-overlay-pane svg { max-width: none !important; max-height: none !important; }
.leaflet-container .leaflet-marker-pane img, .leaflet-container .leaflet-tile-pane img, .leaflet-container img.leaflet-image-layer, .leaflet-container .leaflet-tile { max-width: none !important; max-height: none !important; width: auto; padding: 0; }
.leaflet-container.leaflet-touch-zoom { touch-action: pan-x pan-y; }
.leaflet-container.leaflet-touch-drag { touch-action: none; touch-action: pinch-zoom; }
.leaflet-container.leaflet-touch-drag.leaflet-touch-zoom { touch-action: none; }
.leaflet-tile { filter: inherit; visibility: hidden; }
.leaflet-tile-loaded { visibility: inherit; }
.leaflet-zoom-box { width: 0; height: 0; box-sizing: border-box; z-index: 800; }
.leaflet-pane { z-index: 400; }
.leaflet-tile-pane { z-index: 200; filter: sepia(.45) hue-rotate(172deg) saturate(2.2) brightness(.82) contrast(1.12); }
.leaflet-tile-pane .nh-labels { filter: brightness(1.6); }
.leaflet-overlay-pane { z-index: 400; }
.leaflet-shadow-pane { z-index: 500; }
.leaflet-marker-pane { z-index: 600; }
.leaflet-tooltip-pane { z-index: 650; }
.leaflet-popup-pane { z-index: 700; }
.leaflet-map-pane canvas { z-index: 100; }
.leaflet-map-pane svg { z-index: 200; }
.leaflet-control { position: relative; z-index: 800; pointer-events: auto; float: left; clear: both; }
.leaflet-top, .leaflet-bottom { position: absolute; z-index: 1000; pointer-events: none; }
.leaflet-top { top: 0; }
.leaflet-right { right: 0; }
.leaflet-bottom { bottom: calc(var(--nh-nav-h) + 112px); }
.card-mode .leaflet-bottom { bottom: 120px; }
.leaflet-left { left: 0; }
.leaflet-right .leaflet-control { float: right; }
.leaflet-bottom .leaflet-control { margin-bottom: 6px; }
.leaflet-left .leaflet-control { margin-left: 10px; }
.leaflet-right .leaflet-control { margin-right: 10px; }
.leaflet-zoom-animated { transform-origin: 0 0; }
svg.leaflet-zoom-animated { will-change: transform; }
.leaflet-zoom-anim .leaflet-zoom-animated { transition: transform .25s cubic-bezier(0, 0, .25, 1); }
.leaflet-zoom-anim .leaflet-tile, .leaflet-pan-anim .leaflet-tile { transition: none; }
.leaflet-zoom-anim .leaflet-zoom-hide { visibility: hidden; }
.leaflet-interactive { cursor: pointer; }
.leaflet-grab { cursor: grab; }
.leaflet-dragging .leaflet-grab, .leaflet-dragging .leaflet-grab .leaflet-interactive { cursor: grabbing; }
.leaflet-marker-icon, .leaflet-marker-shadow, .leaflet-image-layer, .leaflet-pane > svg path, .leaflet-tile-container { pointer-events: none; }
.leaflet-marker-icon.leaflet-interactive, .leaflet-image-layer.leaflet-interactive, .leaflet-pane > svg path.leaflet-interactive { pointer-events: auto; }
.leaflet-control-attribution { margin: 0; padding: 1px 7px; border-radius: 8px; font-size: 9.5px; line-height: 1.4; color: var(--nh-faint); background: rgba(5, 13, 24, .72); }
.leaflet-control-attribution a { color: var(--nh-dim); text-decoration: none; }
.leaflet-attribution-flag { display: none !important; }
`;

// ---------------------------------------------------------------- element

const Base = globalThis.HTMLElement || class {};
const TABS = [
  ['home', 'Home', 'home'],
  ['air', 'Air', 'air'],
  ['robots', 'Robots', 'robot'],
  ['energy', 'Energy', 'bolt'],
  ['map', 'Family', 'pin'],
  ['health', 'Health', 'heart'],
];
const VIEWS = { home: viewHomeV2, air: viewAirV2, energy: viewEnergyV2, robots: viewRobotsV2, health: viewHealth };

class NourieHome extends Base {
  constructor() {
    super();
    this._mode = 'panel';
    this._config = {};
    this._ext = { history: {}, forecast: null, learned: null, prefs: readStore('prefs') || {}, vacAreas: {}, spikeSuggest: {}, billing: null };
    const tab = readStore('tab');
    this._ui = {
      tab: TABS.some(([t]) => t === tab) ? tab : 'home',
      mapMode: readStore('map-mode') === 'radar' ? 'radar' : 'map',
      sheet: null,
      focus: null,
      pending: {},
      clim: {},
      allCircuits: false,
      menu: false,
      mapError: false,
      charts: {},
      roomSel: {},
      scoreMath: false,
      pmRange: readStore('pm-range') === '7d' ? '7d' : '24h',
    };
    this._loading = new Set();
    this._climTimers = {};
    this._markers = new Map();
    this._timer = null;
    this._last = 0;
  }

  set hass(hass) {
    const prev = this._hass;
    this._hass = hass;
    if (prev) {
      for (const id of Object.keys(this._ui.pending)) if (prev.states[id] !== hass.states[id]) delete this._ui.pending[id];
    }
    this._schedule();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    this._mount();
    this._clock = setInterval(() => this._schedule(true), 30000);
    this._schedule(true);
  }

  disconnectedCallback() {
    clearInterval(this._clock);
    clearTimeout(this._timer);
    this._timer = null;
    this._dropForecast();
  }

  _mount() {
    if (this._root) return;
    loadFonts();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLES}${LEAFLET_CSS}</style>
      <div class="app ${this._mode}-mode">
        <div class="scroller"><main class="wrap"></main><div class="mapview" hidden><div class="map-canvas"></div><div class="map-ui"></div></div></div>
        <nav class="nav" aria-label="Sections"><div class="nav-in">${TABS.map(([id, label, icon]) => `<button class="nav-b" data-act="tab" data-tab="${id}">${ic(icon)}<span>${label}</span>${id === 'home' ? '<i class="nav-dot" hidden></i>' : ''}</button>`).join('')}</div></nav>
        <div class="sheet-host"></div>
        <div class="toast" role="status" aria-live="polite"></div>
      </div>`;
    this._root = root;
    this._app = root.querySelector('.app');
    this._scroller = root.querySelector('.scroller');
    this._main = root.querySelector('.wrap');
    this._mapview = root.querySelector('.mapview');
    this._mapCanvas = root.querySelector('.map-canvas');
    this._mapUi = root.querySelector('.map-ui');
    this._sheetHost = root.querySelector('.sheet-host');
    this._toastEl = root.querySelector('.toast');
    this._navButtons = [...root.querySelectorAll('.nav-b')];
    this._navDot = root.querySelector('.nav-dot');
    root.addEventListener('click', (e) => this._onClick(e));
    root.addEventListener('change', (e) => this._onChange(e));
    root.addEventListener('pointerdown', (e) => this._onChartPointer(e), true);
    root.addEventListener('pointermove', (e) => this._onChartPointer(e));
    root.addEventListener('pointerleave', (e) => this._hideChartTip(e), true);
    root.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    root.addEventListener('pointermove', (e) => this._onPointerMove(e));
    root.addEventListener('pointerup', () => this._cancelPress(false));
    root.addEventListener('pointercancel', () => this._cancelPress(true));
    root.addEventListener('contextmenu', (e) => {
      if (e.target.closest?.('[data-entity]')) e.preventDefault();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._ui.sheet) this._setSheet(null);
    });
  }

  _schedule(now = false) {
    if (this._timer && !now) return;
    clearTimeout(this._timer);
    const wait = now ? 0 : Math.max(0, 600 - (Date.now() - this._last));
    this._timer = setTimeout(() => {
      this._timer = null;
      this._last = Date.now();
      this._render();
    }, wait);
  }

  _formatters() {
    const locale = this._hass?.locale || {};
    const key = `${locale.language}|${locale.time_format}`;
    if (this._fmtKey !== key) {
      const lang = locale.language || undefined;
      const hour12 = locale.time_format === '12' ? true : locale.time_format === '24' ? false : undefined;
      const time = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit', hour12 });
      const hourOnly = new Intl.DateTimeFormat(lang, { hour: 'numeric', hour12 });
      const date = new Intl.DateTimeFormat(lang, { weekday: 'long', month: 'short', day: 'numeric' });
      const day = new Intl.DateTimeFormat(lang, { weekday: 'short' });
      this._fmt = {
        fmtTime: (d) => time.format(d),
        fmtDate: (d) => date.format(d),
        hourLabel: (d) => hourOnly.format(d).replace(/\s/g, '').toLowerCase(),
        dayLabel: (d) => day.format(d),
        clock: (d) => {
          const parts = time.formatToParts(d);
          return {
            main: parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim(),
            period: parts.find((p) => p.type === 'dayPeriod')?.value || '',
          };
        },
      };
      this._fmtKey = key;
    }
    return this._fmt;
  }

  _render() {
    if (!this._hass || !this._root) return;
    const ui = this._ui;
    ui.menu = this._mode === 'panel' && !!this._narrow && !this._config.preview;
    ui.charts = {};
    if (!this._prefsLoaded) this._loadPrefs();
    const prefs = this._ext.prefs || {};
    const config = prefs.people_source ? { ...this._config, people_source: prefs.people_source } : this._config;
    const m = Object.assign(buildModel(this._hass, config, this._ext), this._formatters());
    this._model = m;
    const tiles = this._config.map?.tiles !== false;
    const onMap = ui.tab === 'map';
    this._app.classList.toggle('tab-map', onMap);
    for (const b of this._navButtons) {
      b.classList.toggle('on', b.dataset.tab === ui.tab);
      if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    const urgent = m.alerts.filter((a) => a.level <= 1).length;
    this._navDot.hidden = !urgent;
    this._navDot.textContent = urgent ? String(urgent) : '';
    this._main.hidden = onMap;
    this._mapview.hidden = !onMap;
    if (onMap) {
      patch(this._mapUi, viewMapUi(m, ui, tiles));
      this._mapCanvas.hidden = !tiles || ui.mapMode !== 'map';
      if (tiles && ui.mapMode === 'map') this._syncMap(m);
    } else {
      patch(this._main, VIEWS[ui.tab](m, ui));
    }
    patch(this._sheetHost, sheetHtml(m, ui));
    this._fetchFor(m);
  }

  // Data that is fetched on demand rather than pushed with every state change.
  _fetchFor(m) {
    if (!this._learnStarted && !Array.isArray(this._config.favorites)) {
      this._learnStarted = true;
      this._learnFavorites();
    }
    if (m.weather.id && this._forecastFor !== m.weather.id) this._subscribeForecast(m.weather.id, m.weather.features);
    const tab = this._ui.tab;
    const pmIds = m.score.pm03.map((x) => x.id);
    if (tab === 'home' || tab === 'air') this._history('pm03', pmIds, 24);
    if (tab === 'air') {
      this._history('air', m.air.rooms.map((r) => r.primary.id));
      if (this._ui.pmRange === '7d') this._statsMean('pm03week', pmIds, 7 * 24);
    }
    if (tab === 'robots') this._history('dust', m.dust, 30 * 24);
    if (tab === 'home' || tab === 'energy' || String(this._ui.sheet).startsWith('bill-')) this._billingData(m);
    const mapped = m.robots.filter((r) => !r.classic && !r.litter && r.canArea);
    if (tab === 'home' || tab === 'robots' || String(this._ui.sheet).startsWith('rooms:')) this._vacuumAreas(mapped);
    const pm = m.spike.pm;
    const h = this._ext.history.pm03;
    if (pm && h?.series?.[pm] && this._ext.spikeSuggest[pm] === undefined) {
      const vals = h.series[pm].map(([, v]) => pm03PerDl(v, m.states[pm]?.attributes?.unit_of_measurement)).filter((v) => v !== null).sort((a, b) => a - b);
      if (vals.length > 10) {
        const median = vals[Math.floor(vals.length / 2)];
        this._ext.spikeSuggest[pm] = Math.max(1000, Math.round((median * 2.5) / 100) * 100);
        this._schedule();
      }
    }
  }

  // Hourly means from long-term statistics; lighter than raw history for a week of readings.
  async _statsMean(key, ids, hours) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length || !this._hass?.callWS) return;
    const sig = list.join(',');
    const cached = this._ext.history[key];
    if ((cached && cached.sig === sig && Date.now() - cached.t < 15 * 60000) || this._loading.has(key)) return;
    this._loading.add(key);
    const end = Date.now();
    const start = end - hours * 3600000;
    try {
      const res = await this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), statistic_ids: list, period: 'hour', types: ['mean'] });
      const series = {};
      for (const id of list) series[id] = (res?.[id] || []).map((r) => [r.start, toNum(r.mean)]).filter((r) => r[1] !== null);
      this._ext.history[key] = { sig, t: Date.now(), start, end, series };
    } catch {
      this._ext.history[key] = { sig, t: Date.now(), start, end, series: null };
    } finally {
      this._loading.delete(key);
      this._schedule(true);
    }
  }

  _resolveSource(kind, ep, info, m) {
    const conf = ((this._ext.prefs.billing || {})[kind]) || {};
    if (conf.stat) return { usage: conf.stat, cost: null, price: null, label: cleanName(m.states[conf.stat]?.attributes?.friendly_name || conf.stat) };
    const costSensors = info?.cost_sensors || {};
    const tariffs = [];
    let name = '';
    for (const src of ep?.energy_sources || []) {
      if (src.type !== (kind === 'water' ? 'water' : 'grid')) continue;
      for (const flow of Array.isArray(src.flow_from) ? src.flow_from : [src]) {
        const usage = flow?.stat_energy_from;
        if (!usage || tariffs.some((t) => t.usage === usage)) continue;
        tariffs.push({ usage, cost: flow.stat_cost || costSensors[usage] || null, price: toNum(flow.number_energy_price) });
        name ||= src.name || '';
      }
    }
    if (tariffs.length) {
      const [first] = tariffs;
      const label = cleanName(m.states[first.usage]?.attributes?.friendly_name || name || first.usage);
      return { ...first, tariffs, label: tariffs.length > 1 ? `${label} + ${tariffs.length - 1} more` : label };
    }
    const fallback = kind === 'water' ? m.water.todayId : m.energy.mains?.todayId;
    return fallback ? { usage: fallback, cost: null, price: null, label: cleanName(m.states[fallback]?.attributes?.friendly_name || fallback) } : null;
  }

  // Hourly usage and cost since the start of the earliest billing window, plus every circuit.
  async _billingData(m) {
    if (this._billingBusy || !this._hass?.callWS) return;
    const now = Date.now();
    const b = this._ext.prefs.billing || {};
    const from = Math.min(cycleWindow(b.electric || {}, now).start, cycleWindow(b.water || {}, now).start, addDays(startOfDay(now), -6));
    const sig = JSON.stringify([b.electric?.stat || '', b.water?.stat || '', from]);
    const cached = this._ext.billing;
    if (cached && cached.sig === sig && now - cached.t < 15 * 60000) return;
    this._billingBusy = true;
    try {
      if (!this._energyPrefs) {
        this._energyPrefs = await this._hass.callWS({ type: 'energy/get_prefs' }).catch(() => ({ energy_sources: [], device_consumption: [] }));
        this._energyInfo = await this._hass.callWS({ type: 'energy/info' }).catch(() => ({ cost_sensors: {} }));
      }
      const ids = { electric: this._resolveSource('electric', this._energyPrefs, this._energyInfo, m), water: this._resolveSource('water', this._energyPrefs, this._energyInfo, m) };
      let circuits = (this._energyPrefs?.device_consumption || []).filter((d) => d.stat_consumption).map((d) => ({ stat: d.stat_consumption, name: cleanName(d.name || m.states[d.stat_consumption]?.attributes?.friendly_name || d.stat_consumption).replace(/\s*energy( today| this month)?$/i, '') }));
      if (!circuits.length) circuits = m.energy.circuits.filter((c) => c.todayId).map((c) => ({ stat: c.todayId, name: c.name }));
      const tariffIds = (src) => (src ? src.tariffs || [src] : []).flatMap((t) => [t.usage, t.cost]);
      const statIds = [...new Set([...tariffIds(ids.electric), ...tariffIds(ids.water), ...circuits.map((c) => c.stat)].filter(Boolean))];
      let rows = {};
      if (statIds.length) {
        const res = await this._hass.callWS({
          type: 'recorder/statistics_during_period',
          start_time: new Date(from).toISOString(),
          end_time: new Date(now).toISOString(),
          statistic_ids: statIds,
          period: 'hour',
          types: ['change'],
          units: { energy: 'kWh', volume: m.water.volumeUnit === 'L' ? 'L' : 'gal' },
        });
        rows = Object.fromEntries(statIds.map((id) => [id, (res?.[id] || []).map((r) => ({ start: r.start, end: r.end, change: toNum(r.change) }))]));
      }
      this._ext.billing = { sig, t: now, from, rows, ids: { electric: ids.electric ? { ...ids.electric } : null, water: ids.water ? { ...ids.water } : null }, circuits };
    } catch (err) {
      this._ext.billing = { sig, t: now, from, rows: {}, ids: {}, circuits: [], error: String(err?.message || err) };
    } finally {
      this._billingBusy = false;
      this._schedule(true);
    }
  }

  // Which Home Assistant areas each robot has been matched to (Cleaning → By area in the robot's dialog).
  async _vacuumAreas(robots) {
    if (!this._hass?.callWS) return;
    for (const r of robots) {
      const have = this._ext.vacAreas[r.id];
      if (have && (have.status === 'busy' || Date.now() - have.t < 10 * 60000)) continue;
      this._ext.vacAreas[r.id] = { ...(have || {}), status: have?.status === 'ok' ? 'ok' : 'busy', t: Date.now() };
      this._hass.callWS({ type: 'config/entity_registry/get', entity_id: r.id })
        .then((entry) => {
          const mapping = entry?.options?.vacuum?.area_mapping || {};
          this._ext.vacAreas[r.id] = { status: 'ok', t: Date.now(), areaIds: Object.keys(mapping).filter((id) => (mapping[id] || []).length) };
        })
        .catch(() => {
          this._ext.vacAreas[r.id] = { status: 'error', t: Date.now(), areaIds: [] };
        })
        .finally(() => this._schedule(true));
    }
  }

  // ------------------------------------------------------------ prefs

  async _loadPrefs() {
    this._prefsLoaded = true;
    const hass = this._hass;
    if (!hass?.callWS || this._config.preview) return;
    try {
      const system = await hass.callWS({ type: 'frontend/get_system_data', key: 'nourie_home' }).then((r) => r?.value || {}).catch(() => ({}));
      const user = hass.user?.is_admin ? {} : await hass.callWS({ type: 'frontend/get_user_data', key: 'nourie_home' }).then((r) => r?.value || {}).catch(() => ({}));
      // A non-admin's own changes sit on top of the shared settings, path by path, so later
      // changes an admin makes still reach them.
      this._userPrefs = user;
      this._ext.prefs = mergePrefs(system, user);
      writeStore('prefs', this._ext.prefs);
      this._ext.billing = null;
    } catch {
      // Keep the cached copy.
    }
    this._schedule(true);
  }

  _savePrefs() {
    writeStore('prefs', this._ext.prefs);
    clearTimeout(this._prefsTimer);
    this._prefsTimer = setTimeout(async () => {
      const hass = this._hass;
      if (!hass?.callWS || this._config.preview) return;
      const type = hass.user?.is_admin ? 'frontend/set_system_data' : 'frontend/set_user_data';
      try {
        await hass.callWS({ type, key: 'nourie_home', value: hass.user?.is_admin ? this._ext.prefs : this._userPrefs || {} });
      } catch (err) {
        this._toast(`Could not save: ${err?.message || err}`, true);
      }
    }, 500);
  }

  _setPref(path, value) {
    this._ext.prefs = setPath(this._ext.prefs, path, value);
    if (!this._hass?.user?.is_admin) this._userPrefs = setPath(this._userPrefs, path, value);
    if (path.startsWith('billing')) this._ext.billing = this._ext.billing ? { ...this._ext.billing, t: 0 } : null;
    this._savePrefs();
    this._schedule(true);
  }

  _onChange(e) {
    const el = e.target;
    const path = el?.dataset?.pref;
    if (!path) return;
    const m = this._model;
    const sheet = this._sheetHost;
    const checkedValues = () => [...sheet.querySelectorAll(`input[type="checkbox"][data-pref="${path}"]`)].filter((x) => x.checked).map((x) => x.value);
    if (path === 'air.pm03') {
      const labels = Object.fromEntries((Array.isArray(this._ext.prefs.air?.pm03) ? this._ext.prefs.air.pm03 : m.score.pm03).map((x) => [x.id, x.label]));
      const ctx = this._ctxFor();
      return this._setPref('air.pm03', checkedValues().map((id) => ({ id, label: labels[id] || roomLabel(ctx, id) })));
    }
    if (path === 'air.pm03label') {
      const list = (Array.isArray(this._ext.prefs.air?.pm03) ? this._ext.prefs.air.pm03 : m.score.pm03).map((x) => (x.id === el.dataset.id ? { ...x, label: el.value.trim() || x.label } : x));
      return this._setPref('air.pm03', list);
    }
    if (path === 'air.winix' || path === 'robots.classic' || path === 'dust') return this._setPref(path, checkedValues());
    if (path.startsWith('controls.')) {
      const field = path.split('.')[1];
      const list = (Array.isArray(this._ext.prefs.controls) ? this._ext.prefs.controls : m.controls.map(({ key, label, icon, on, off }) => ({ key, label, icon, on, off }))).map((x) => ({ ...x }));
      const i = Number(el.dataset.i);
      if (!list[i]) return null;
      if (field === 'label') list[i].label = el.value.trim();
      else list[i][field] = this._targetFromValue(el.value);
      return this._setPref('controls', list);
    }
    if (el.tagName === 'SELECT') {
      const v = el.value;
      return this._setPref(path, v === '__auto__' ? undefined : v === '__none__' ? '' : v);
    }
    if (el.type === 'number') {
      const v = el.value.trim();
      return this._setPref(path, v === '' ? undefined : Number(v));
    }
    if (el.type === 'date') return this._setPref(path, el.value || undefined);
    return this._setPref(path, el.value);
  }

  _ctxFor() {
    return makeCtx(this._hass, this._config);
  }

  _targetFromValue(v) {
    if (!v) return null;
    const fans = this._model?.candidates().winixFans || [];
    if (v === '__winix_turbo__') return { service: 'fan.set_percentage', data: { entity_id: fans, percentage: winixTurboPercent(this._ctxFor(), fans) } };
    if (v === '__winix_auto__') return { service: 'fan.set_preset_mode', data: { entity_id: fans, preset_mode: 'Auto' } };
    return { entity: v };
  }

  // ------------------------------------------------------- chart readout

  _onChartPointer(e) {
    const plot = e.target.closest?.('[data-chart]');
    if (!plot) return;
    const chart = this._ui.charts[plot.dataset.chart];
    const hover = plot.querySelector('.lc-hover');
    if (!chart || !hover) return;
    const rect = plot.getBoundingClientRect();
    const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const i = Math.round(frac * (chart.n - 1));
    const bucket = (chart.end - chart.start) / chart.n;
    const t = chart.start + (i + 0.5) * bucket;
    const when = chart.bars
      ? new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      : new Date(t).toLocaleString(undefined, chart.end - chart.start > 2 * 86400000 ? { weekday: 'short', hour: 'numeric' } : { hour: 'numeric', minute: '2-digit' });
    const x = chart.n <= 1 ? 0 : (i / (chart.n - 1)) * 100;
    const rows = chart.series.map((s) => `<div class="tip-row"><i style="background:${s.color}"></i><b>${s.values[i] === null || s.values[i] === undefined ? '—' : esc(fmt(s.values[i], chart.digits || 0))}</b><span>${esc(s.label)}</span></div>`).join('');
    hover.innerHTML = `<span class="lc-cross" style="left:${x.toFixed(2)}%"></span><div class="lc-tip ${x > 60 ? 'left' : ''}" style="left:${x.toFixed(2)}%"><small>${esc(when)}</small>${rows}</div>`;
    hover.classList.add('show');
    clearTimeout(this._tipTimer);
    if (e.pointerType !== 'mouse') this._tipTimer = setTimeout(() => hover.classList.remove('show'), 2600);
  }

  _hideChartTip(e) {
    const plot = e.target?.closest?.('[data-chart]');
    if (plot && e.pointerType === 'mouse') plot.querySelector('.lc-hover')?.classList.remove('show');
  }


  async _history(key, ids, hours = 24) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length || !this._hass?.callWS) return;
    const sig = list.join(',');
    const cached = this._ext.history[key];
    if (cached && cached.sig === sig && Date.now() - cached.t < 5 * 60000) return;
    if (this._loading.has(key)) return;
    this._loading.add(key);
    const end = Date.now();
    const start = end - hours * 3600000;
    try {
      const res = await this._hass.callWS({
        type: 'history/history_during_period',
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        entity_ids: list,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const series = {};
      for (const id of list) series[id] = parseHistory(res?.[id]);
      this._ext.history[key] = { sig, t: Date.now(), start, end, series };
    } catch {
      this._ext.history[key] = { sig, t: Date.now(), start, end, series: null };
    } finally {
      this._loading.delete(key);
      this._schedule(true);
    }
  }

  // "Most used" ranks the switches, lights and fans people actually tapped in the last five days.
  async _learnFavorites() {
    const cached = readStore('learned');
    if (cached && Date.now() - cached.t < 6 * 3600000) {
      this._ext.learned = cached;
      this._schedule(true);
      return;
    }
    if (!this._hass?.callWS) return;
    const ids = Object.keys(this._hass.states).filter((id) => FAV_DOMAINS.includes(domainOf(id)));
    if (!ids.length) return;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 5 * 86400000);
      const rows = await this._hass.callWS({ type: 'logbook/get_events', start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: ids });
      const counts = {};
      for (const row of rows || []) if (row.entity_id && row.context_user_id) counts[row.entity_id] = (counts[row.entity_id] || 0) + 1;
      this._ext.learned = { t: Date.now(), ids: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([id]) => id) };
      writeStore('learned', this._ext.learned);
    } catch {
      this._ext.learned = { t: Date.now(), ids: [] };
    }
    this._schedule(true);
  }

  async _subscribeForecast(id, features) {
    this._dropForecast();
    this._forecastFor = id;
    const type = features & 2 ? 'hourly' : features & 1 ? 'daily' : null;
    const conn = this._hass?.connection;
    if (!type || !conn?.subscribeMessage) return;
    try {
      const unsub = await conn.subscribeMessage((msg) => {
        this._ext.forecast = { type, items: msg?.forecast || [] };
        this._schedule();
      }, { type: 'weather/subscribe_forecast', forecast_type: type, entity_id: id });
      if (this._forecastFor === id) this._unsubForecast = unsub;
      else unsub?.();
    } catch {
      // Forecasts are optional; current conditions still show.
    }
  }

  _dropForecast() {
    try {
      this._unsubForecast?.();
    } catch {
      // The connection may already be closed.
    }
    this._unsubForecast = null;
    this._forecastFor = null;
  }

  // ------------------------------------------------------------- map

  async _syncMap(m) {
    if (!this._map) {
      if (this._mapLoading) return;
      this._mapLoading = true;
      try {
        const L = await loadLeaflet();
        this._L = L;
        this._map = L.map(this._mapCanvas, { zoomControl: false, attributionControl: false, worldCopyJump: true, zoomSnap: 0.5 });
        this._map.attributionControl = L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(this._map);
        for (const layer of tileLayers(this._config.map)) L.tileLayer(layer.url, layer.options).addTo(this._map);
        this._zoneLayer = L.layerGroup().addTo(this._map);
        this._peopleLayer = L.layerGroup().addTo(this._map);
        this._ui.mapError = false;
        this._mapNeedsFit = true;
      } catch {
        this._ui.mapError = true;
        this._mapLoading = false;
        this._schedule(true);
        return;
      }
      this._mapLoading = false;
    }
    const L = this._L;
    const map = this._map;
    requestAnimationFrame(() => map.invalidateSize());
    const zoneSig = JSON.stringify(m.zones.map((z) => [z.id, z.lat, z.lon, z.radius]));
    if (zoneSig !== this._zoneSig) {
      this._zoneSig = zoneSig;
      this._zoneLayer.clearLayers();
      for (const z of m.zones) {
        L.circle([z.lat, z.lon], { radius: z.radius, color: z.home ? TONES.cyan : TONES.violet, weight: 1.2, opacity: 0.7, dashArray: z.home ? null : '4 6', fillOpacity: z.home ? 0.1 : 0.05, interactive: false }).addTo(this._zoneLayer);
        const html = z.home ? `<span class="mk-home">${ic('home')}</span>` : `<span class="mk-zone">${esc(z.name)}</span>`;
        L.marker([z.lat, z.lon], { icon: L.divIcon({ className: 'nh-marker', html, iconSize: z.home ? [34, 34] : [0, 0], iconAnchor: z.home ? [17, 17] : [0, 0] }), interactive: false, keyboard: false, zIndexOffset: -500 }).addTo(this._zoneLayer);
      }
    }
    const seen = new Set();
    for (const p of m.people) {
      if (p.lat === null || p.lon === null) continue;
      seen.add(p.id);
      const html = `<div class="mk" style="--pc:${p.color}">${avatar(p)}</div>`;
      let mk = this._markers.get(p.id);
      if (!mk) {
        const marker = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'nh-marker', html, iconSize: [46, 46], iconAnchor: [23, 23] }), keyboard: false, riseOnHover: true }).addTo(this._peopleLayer);
        marker.on('click', () => this._focusPerson(p.id));
        const circle = L.circle([p.lat, p.lon], { radius: p.accuracy || 0, color: p.color, weight: 1, opacity: 0.5, fillOpacity: 0.08, interactive: false }).addTo(this._peopleLayer);
        mk = { marker, circle, html };
        this._markers.set(p.id, mk);
      } else {
        mk.marker.setLatLng([p.lat, p.lon]);
        mk.circle.setLatLng([p.lat, p.lon]).setRadius(p.accuracy || 0);
        if (mk.html !== html) {
          mk.marker.setIcon(L.divIcon({ className: 'nh-marker', html, iconSize: [46, 46], iconAnchor: [23, 23] }));
          mk.html = html;
        }
      }
    }
    for (const [id, mk] of this._markers) {
      if (seen.has(id)) continue;
      this._peopleLayer.removeLayer(mk.marker);
      this._peopleLayer.removeLayer(mk.circle);
      this._markers.delete(id);
    }
    if (this._mapNeedsFit) {
      this._mapNeedsFit = false;
      requestAnimationFrame(() => {
        map.invalidateSize();
        if (this._ui.focus) this._focusPerson(this._ui.focus, false);
        else this._fitMap();
      });
    }
  }

  _fitMap() {
    const m = this._model;
    if (!this._map || !m) return;
    const pts = m.people.filter((p) => p.lat !== null && p.lon !== null).map((p) => [p.lat, p.lon]);
    if (m.home) pts.push([m.home.lat, m.home.lon]);
    if (!pts.length) {
      this._map.setView([20, 0], 2);
      return;
    }
    if (pts.length === 1) this._map.setView(pts[0], 14);
    else this._map.fitBounds(pts, { paddingTopLeft: [40, 110], paddingBottomRight: [40, 230], maxZoom: 15 });
  }

  _focusPerson(id, animate = true) {
    this._ui.focus = id;
    const p = this._model?.people.find((x) => x.id === id);
    if (this._map && p?.lat !== null && p?.lat !== undefined && this._ui.mapMode === 'map') {
      const point = this._map.project([p.lat, p.lon], 15).add([0, 70]);
      this._map.flyTo(this._map.unproject(point, 15), 15, { animate, duration: 0.8 });
    }
    this._schedule(true);
    setTimeout(() => {
      const card = this._mapUi?.querySelector(`.pcard[data-id="${CSS_ESCAPE(id)}"]`);
      card?.scrollIntoView({ behavior: animate ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
    }, 50);
  }

  // --------------------------------------------------------- interaction

  _onPointerDown(e) {
    if (this._press) clearTimeout(this._press.timer);
    this._press = null;
    const el = e.target.closest?.('[data-entity]');
    if (!el || !el.dataset.entity || e.button > 0) return;
    this._press = { el, x: e.clientX, y: e.clientY, fired: false };
    this._press.timer = setTimeout(() => {
      if (!this._press) return;
      this._press.fired = true;
      this._haptic('medium');
      this._moreInfo(el.dataset.entity);
    }, 520);
  }

  _onPointerMove(e) {
    if (this._press && Math.hypot(e.clientX - this._press.x, e.clientY - this._press.y) > 10) this._cancelPress(true);
  }

  _cancelPress(drop) {
    if (!this._press) return;
    clearTimeout(this._press.timer);
    if (drop && !this._press.fired) this._press = null;
  }

  _onClick(e) {
    if (this._press?.fired) {
      this._press = null;
      e.preventDefault();
      return;
    }
    this._press = null;
    const el = e.target.closest?.('[data-act]');
    if (!el) return;
    this._act(el.dataset.act, el.dataset);
  }

  _act(act, d) {
    switch (act) {
      case 'tab': return this._setTab(d.tab);
      case 'toggle': return this._toggle(d.entity);
      case 'more': return d.entity ? this._moreInfo(d.entity) : null;
      case 'temp': return this._bumpTemp(d.entity, d.which, Number(d.delta));
      case 'hvac': return this._call('climate', 'set_hvac_mode', { entity_id: d.entity, hvac_mode: d.mode });
      case 'fanpct': return this._call('fan', 'set_percentage', { entity_id: d.entity, percentage: Number(d.pct) });
      case 'preset': return this._call('fan', 'set_preset_mode', { entity_id: d.entity, preset_mode: d.preset });
      case 'vac': return this._call('vacuum', d.svc, { entity_id: d.entity });
      case 'vacspeed': return this._call('vacuum', 'set_fan_speed', { entity_id: d.entity, fan_speed: d.speed });
      case 'vacall': return this._vacuumAll(d.svc);
      case 'press': return this._call('button', 'press', { entity_id: d.entity });
      case 'person':
        this._ui.focus = d.id;
        this._mapNeedsFit = true;
        return this._setTab('map');
      case 'focus': return this._focusPerson(d.id);
      case 'mapmode':
        this._ui.mapMode = d.mode === 'radar' ? 'radar' : 'map';
        writeStore('map-mode', this._ui.mapMode);
        this._mapNeedsFit = true;
        return this._schedule(true);
      case 'fit':
        this._ui.focus = null;
        this._fitMap();
        return this._schedule(true);
      case 'sheet': return this._setSheet(d.sheet);
      case 'close-sheet': return this._setSheet(null);
      case 'alert': return this._openAlert(Number(d.i));
      case 'circuits':
        this._ui.allCircuits = !this._ui.allCircuits;
        return this._schedule(true);
      case 'jump': {
        const target = this._root.getElementById(`nh-${d.to}`);
        return target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      case 'ctl': return this._runControl(Number(d.i), d.side);
      case 'scoremath':
        this._ui.scoreMath = !this._ui.scoreMath;
        return this._schedule(true);
      case 'pmrange':
        this._ui.pmRange = d.range === '7d' ? '7d' : '24h';
        writeStore('pm-range', this._ui.pmRange);
        return this._schedule(true);
      case 'room': return this._toggleRoom(d.vac, d.area);
      case 'roomsall': {
        const r = this._model?.robots.find((x) => x.id === d.vac);
        this._ui.roomSel[d.vac] = r ? r.areas.map((a) => a.id) : [];
        return this._schedule(true);
      }
      case 'roomsclear':
        this._ui.roomSel[d.vac] = [];
        return this._schedule(true);
      case 'roomsrepeat':
        this._ui.roomSel[d.vac] = [...((this._ext.prefs.lastRooms || {})[d.vac] || [])];
        return this._cleanRooms(d.vac);
      case 'cleanrooms': return this._cleanRooms(d.vac);
      case 'sheet-rooms': return this._setSheet(`rooms:${d.vac}`);
      case 'spike-save': return this._saveSpikeAutomation();
      case 'spike-delete': return this._deleteSpikeAutomation();
      case 'ctl-add': {
        const list = Array.isArray(this._ext.prefs.controls) ? [...this._ext.prefs.controls] : (this._model?.controls || []).map(({ key, label, icon, on, off }) => ({ key, label, icon, on, off }));
        list.push({ key: `custom_${list.length + 1}`, label: 'New button', icon: 'power', on: null, off: null });
        return this._setPref('controls', list);
      }
      case 'ctl-remove': {
        const list = Array.isArray(this._ext.prefs.controls) ? [...this._ext.prefs.controls] : (this._model?.controls || []).map(({ key, label, icon, on, off }) => ({ key, label, icon, on, off }));
        list.splice(Number(d.i), 1);
        return this._setPref('controls', list);
      }
      case 'pref-reset': return this._setPref(d.key, undefined);
      case 'menu': return this.dispatchEvent(new CustomEvent('hass-toggle-menu', { bubbles: true, composed: true }));
      case 'nav': return this._navigate(d.path);
      default: return null;
    }
  }

  _setTab(tab) {
    if (!TABS.some(([t]) => t === tab)) return;
    if (tab !== this._ui.tab) {
      this._ui.tab = tab;
      writeStore('tab', tab);
      if (this._mode === 'panel') this._scroller.scrollTop = 0;
      else this.scrollIntoView?.({ block: 'start' });
      if (tab === 'map') this._mapNeedsFit = true;
      this._haptic('selection');
    }
    this._ui.sheet = null;
    this._schedule(true);
  }

  _setSheet(sheet) {
    this._ui.sheet = sheet || null;
    this._schedule(true);
  }

  _openAlert(i) {
    const a = this._model?.alerts[i];
    if (!a) return;
    this._ui.sheet = null;
    if (a.entity) this._moreInfo(a.entity);
    else if (a.tab) this._setTab(a.tab);
    this._schedule(true);
  }

  _toggle(id) {
    const st = this._hass?.states[id];
    if (!st) return null;
    const d = domainOf(id);
    if (['lock', 'cover', 'climate', 'vacuum', 'camera', 'sensor', 'binary_sensor', 'alarm_control_panel', 'todo'].includes(d)) return this._moreInfo(id);
    if (!live(st)) return this._moreInfo(id);
    this._ui.pending[id] = true;
    setTimeout(() => {
      if (this._ui.pending[id]) {
        delete this._ui.pending[id];
        this._schedule(true);
      }
    }, 4000);
    this._schedule(true);
    if (d === 'scene' || d === 'script') return this._call(d, 'turn_on', { entity_id: id });
    if (d === 'button' || d === 'input_button') return this._call(d, 'press', { entity_id: id });
    if (d === 'media_player') return this._call('media_player', 'media_play_pause', { entity_id: id });
    return this._call('homeassistant', 'toggle', { entity_id: id });
  }

  _bumpTemp(id, which, delta) {
    const c = this._model?.climate.find((x) => x.id === id);
    if (!c) return;
    const pend = (this._ui.clim[id] ||= {});
    const base = pend[which] ?? c[which] ?? c.current ?? (this._model.units.temp === '°C' ? 21 : 70);
    let next = Math.round((base + delta * c.step) / c.step) * c.step;
    if (c.min !== null) next = Math.max(c.min, next);
    if (c.max !== null) next = Math.min(c.max, next);
    pend[which] = next;
    this._haptic('selection');
    this._schedule(true);
    clearTimeout(this._climTimers[id]);
    this._climTimers[id] = setTimeout(async () => {
      const data = { entity_id: id };
      if (which === 'target') data.temperature = pend.target;
      else {
        data.target_temp_low = pend.low ?? c.low;
        data.target_temp_high = pend.high ?? c.high;
      }
      await this._call('climate', 'set_temperature', data, false);
      setTimeout(() => {
        delete this._ui.clim[id];
        this._schedule(true);
      }, 2500);
    }, 900);
  }

  _runControl(i, side) {
    const c = this._model?.controls.find((x) => x.index === i);
    const t = c?.[side];
    if (!t) return null;
    if (t.service) {
      const [dom, svc] = t.service.split('.');
      return this._call(dom, svc, t.data || {});
    }
    const id = t.entity;
    const dom = domainOf(id);
    if (dom === 'script' || dom === 'scene') return this._call(dom, 'turn_on', { entity_id: id });
    if (dom === 'button' || dom === 'input_button') return this._call(dom, 'press', { entity_id: id });
    if (dom === 'automation') return this._call('automation', 'trigger', { entity_id: id });
    return this._call('homeassistant', side === 'off' ? 'turn_off' : 'turn_on', { entity_id: id });
  }

  _toggleRoom(vac, area) {
    const sel = [...(this._ui.roomSel[vac] || [])];
    const at = sel.indexOf(area);
    if (at >= 0) sel.splice(at, 1);
    else sel.push(area);
    this._ui.roomSel[vac] = sel;
    this._haptic('selection');
    this._schedule(true);
  }

  async _cleanRooms(vac) {
    const sel = this._ui.roomSel[vac] || [];
    if (!sel.length) return;
    const r = this._model?.robots.find((x) => x.id === vac);
    const names = sel.map((id) => r?.areas.find((a) => a.id === id)?.name).filter(Boolean);
    await this._call('vacuum', 'clean_area', { entity_id: vac, cleaning_area_id: sel });
    this._toast(`${r?.name || 'Robot'} is cleaning ${names.join(', ')}`);
    this._setPref('lastRooms', { ...(this._ext.prefs.lastRooms || {}), [vac]: sel });
    this._ui.roomSel[vac] = [];
    if (String(this._ui.sheet).startsWith('rooms:')) this._ui.sheet = null;
    this._schedule(true);
  }

  async _saveSpikeAutomation() {
    const m = this._model;
    const s = m?.spike;
    if (!s?.pm) return;
    if (!m.isAdmin) return this._toast('Phone alerts need an admin account', true);
    if (!s.notify) return this._toast('Choose a phone first', true);
    if (!s.climateId) return this._toast('No upstairs climate found. Pick one in Customize.', true);
    const unit = m.states[s.pm]?.attributes?.unit_of_measurement;
    const factor = pm03PerDl(1, unit) || 1;
    const above = Math.round(s.threshold / factor);
    const cid = s.climateId;
    const path = globalThis.location?.pathname || '/';
    const config = {
      id: SPIKE_AUTOMATION_ID,
      alias: `Nourie Home: ${s.pmLabel} PM0.3 spike`,
      description: `Created by the Nourie Home dashboard. Notifies when ${s.pmLabel} PM0.3 stays over ${fmt(s.threshold)} per 0.1 L for 2 minutes while ${s.climateName} is running, then waits 30 minutes before alerting again.`,
      mode: 'single',
      max_exceeded: 'silent',
      triggers: [{ trigger: 'numeric_state', entity_id: s.pm, above, for: { minutes: 2 } }],
      conditions: [{ condition: 'template', value_template: `{% set a = state_attr('${cid}', 'hvac_action') %}{{ a in ['heating', 'cooling', 'fan', 'drying', 'preheating', 'defrosting'] or (a is none and not is_state('${cid}', 'off')) }}` }],
      actions: [
        { action: `notify.${s.notify}`, data: { title: `${s.pmLabel} PM0.3 spike`, message: `${s.pmLabel} PM0.3 is {{ states('${s.pm}') }} while ${s.climateName} is running.`, data: { tag: 'nourie-home-pm03', url: path, clickAction: path } } },
        { delay: { minutes: 30 } },
      ],
    };
    try {
      await this._hass.callApi('POST', `config/automation/config/${SPIKE_AUTOMATION_ID}`, config);
      this._toast(s.automation ? 'Phone alert updated' : 'Phone alert is on');
    } catch (err) {
      this._toast(`Could not save the alert: ${err?.message || err}`, true);
    }
  }

  async _deleteSpikeAutomation() {
    try {
      await this._hass.callApi('DELETE', `config/automation/config/${SPIKE_AUTOMATION_ID}`);
      this._toast('Phone alert removed');
    } catch (err) {
      this._toast(`Could not remove the alert: ${err?.message || err}`, true);
    }
  }

  _vacuumAll(service) {
    const robots = (this._model?.robots || []).filter((r) => !r.litter && r.state !== 'unavailable');
    const targets = robots.filter((r) => (service === 'start' ? !['cleaning'].includes(r.state) : !['docked'].includes(r.state)));
    if (!targets.length) return this._toast(service === 'start' ? 'Every robot is already cleaning' : 'Every robot is already docked');
    this._call('vacuum', service, { entity_id: targets.map((r) => r.id) });
    return this._toast(service === 'start' ? `Starting ${targets.length} ${targets.length === 1 ? 'robot' : 'robots'}` : `Sending ${targets.length} ${targets.length === 1 ? 'robot' : 'robots'} home`);
  }

  async _call(domain, service, data, buzz = true) {
    if (!this._hass?.callService) return;
    if (buzz) this._haptic('light');
    try {
      await this._hass.callService(domain, service, data);
    } catch (err) {
      this._haptic('failure');
      this._toast(`That didn't work: ${err?.message || err}`, true);
      if (data?.entity_id && typeof data.entity_id === 'string') delete this._ui.pending[data.entity_id];
      this._schedule(true);
    }
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    if (this._config.preview) {
      this._toast('In Home Assistant this opens the device details');
      return;
    }
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId }, bubbles: true, composed: true }));
  }

  _navigate(path) {
    if (!path) return;
    if (this._config.preview) {
      this._toast('In Home Assistant this opens the list');
      return;
    }
    history.pushState(null, '', path);
    window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
  }

  _haptic(kind) {
    window.dispatchEvent(new CustomEvent('haptic', { detail: kind }));
  }

  _toast(message, bad = false) {
    if (!this._toastEl) return;
    this._toastEl.textContent = message;
    this._toastEl.classList.toggle('bad', bad);
    this._toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._toastEl.classList.remove('show'), 2600);
  }
}

const CSS_ESCAPE = (s) => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

export class NourieHomePanel extends NourieHome {
  constructor() {
    super();
    this._mode = 'panel';
  }

  set panel(panel) {
    this._config = { ...(panel?.config || {}) };
    this._schedule(true);
  }

  set narrow(narrow) {
    this._narrow = !!narrow;
    this._schedule(true);
  }

  // Lets a standalone page (or a test) pass options without a panel object.
  setConfig(config) {
    this._config = { ...(config || {}) };
    this._schedule(true);
  }
}

export class NourieHomeCard extends NourieHome {
  constructor() {
    super();
    this._mode = 'card';
  }

  setConfig(config) {
    this._config = { ...(config || {}) };
    this._schedule(true);
  }

  getCardSize() {
    return 12;
  }

  static getStubConfig() {
    return {};
  }
}

if (globalThis.customElements) {
  if (!customElements.get('nourie-home-panel')) customElements.define('nourie-home-panel', NourieHomePanel);
  if (!customElements.get('nourie-home-card')) customElements.define('nourie-home-card', NourieHomeCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === 'nourie-home-card')) {
    window.customCards.push({ type: 'nourie-home-card', name: 'Nourie Home', description: 'Phone-first home dashboard: air quality, family map, energy, water and robots.', preview: false });
  }
  console.info(`%c NOURIE HOME %c ${VERSION} `, 'background:#4de3ff;color:#06101c;font-weight:700;border-radius:3px 0 0 3px', 'background:#0a1a2c;color:#4de3ff;border-radius:0 3px 3px 0');
}
