import {createBulletinService} from './weatherFusionBulletins.js';
import {pressureTrendFromObservations} from './weatherFusionPressure.js';
import {eveningPeriod} from './weatherFusionPolicy.js';
import { addExperience, PLAIN_OUTLOOK_INSTRUCTIONS } from './weatherFusionExperience.js';
import { solarTimes } from './weatherFusionDirect.js';
/** Weather Fusion: isolated, dependency-free Express route registration.
 * Numeric forecasts stay deterministic. AI explains supplied facts; it cannot edit them.
 * Source contracts and deployment requirements: docs/weather-fusion.md.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDirectModels, enhanceForecast } from './weatherFusionDirect.js';

export const PRESETS = [
  { id: 'knightdale', name: 'Knightdale / Raleigh', latitude: 35.787, longitude: -78.4806 },
  { id: 'greenville', name: 'Greenville, NC', latitude: 35.6127, longitude: -77.3664 },
];
export const RADAR_URL = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows';
const HOUR = 3600000;
const MINUTE = 60000;
const VERSION = 'weather-fusion-v2-direct';
const PUBLIC_DIR = fileURLToPath(new URL('../public/weather-fusion/', import.meta.url));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const numeric = (v) => finite(v) ? v : null;
const max = (a) => a.filter(finite).length ? Math.max(...a.filter(finite)) : null;
const min = (a) => a.filter(finite).length ? Math.min(...a.filter(finite)) : null;
const rounded = (v, digits = 0) => finite(v) ? Number(v.toFixed(digits)) : null;
const clean = (v, size = 500) => typeof v === 'string' ? v.slice(0, size) : '';
const iso = (ms) => new Date(ms).toISOString();
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const errorWithStatus = (text, status = 503) => Object.assign(new Error(text), { status });

export function coordinates(query = {}) {
  const preset = PRESETS.find((p) => p.id === query.location);
  if (preset) return { ...preset };
  if (query.latitude == null && query.longitude == null) return { ...PRESETS[0] };
  const valid = (value) => typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value));
  if (!valid(query.latitude) || !valid(query.longitude)) throw errorWithStatus('Choose a valid U.S. location.', 400);
  const latitude = Number(query.latitude), longitude = Number(query.longitude);
  if (!finite(latitude) || !finite(longitude) || latitude < 24 || latitude > 50 || longitude < -125 || longitude > -66) {
    throw errorWithStatus('Weather Fusion currently supports the contiguous United States.', 400);
  }
  return { latitude: rounded(latitude, 4), longitude: rounded(longitude, 4), name: '', id: '' };
}

export function dateKey(ms, zone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function nextDate(date, count = 1) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + count * 24 * HOUR).toISOString().slice(0, 10);
}
/** Convert a wall-clock date/hour to UTC. Iteration preserves 23/25-hour DST days. */
export function localTime(date, hour, zone) {
  const target = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
  let guess = target;
  for (let i = 0; i < 4; i += 1) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const get = (type) => p.find((part) => part.type === type)?.value;
    const wall = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);
    const correction = target - wall;
    guess += correction;
    if (correction === 0) break;
  }
  return guess;
}
export function durationMs(value) {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(value));
  return m ? ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) * 1000 : null;
}
/** Integrate end-labelled hourly precip, never turn missing hours into zero. */
export function sumHourly(rows, start, end, key = 'precipitation') {
  if (!(end > start)) return null;
  const count = Math.round((end - start) / HOUR);
  if (Math.abs(count * HOUR - (end - start)) > 1000) return null;
  const samples = new Map(rows.filter((r) => r.time > start && r.time <= end && finite(r[key])).map((r) => [r.time, r[key]]));
  let sum = 0;
  for (let t = start + HOUR; t <= end; t += HOUR) {
    if (!samples.has(t)) return null;
    sum += Math.max(0, samples.get(t));
  }
  return rounded(sum, 3);
}
/** NWS grid QPF is an interval total. Boundary overlap is prorated, not duplicated. */
export function gridQpf(grid, start, end, precision = 3) {
  if (!(end > start)) return null;
  const field = grid?.quantitativePrecipitation;
  const unit = field?.uom;
  if (!field || !['wmoUnit:mm', 'wmoUnit:in'].includes(unit)) return null;
  const intervals = (field.values || []).flatMap((v) => {
    const [begin, duration] = String(v.validTime || '').split('/');
    const a = Date.parse(begin), length = durationMs(duration), b = a + length;
    return finite(v.value) && length > 0 && b > start && a < end ? [{ a, b, value: Math.max(0, v.value) }] : [];
  }).sort((a, b) => a.a - b.a);
  let cursor = start, total = 0;
  for (const interval of intervals) {
    if (interval.a > cursor + 1000) return null;
    const a = Math.max(cursor, interval.a), b = Math.min(end, interval.b);
    if (b > a) { total += interval.value * (b - a) / (interval.b - interval.a); cursor = b; }
    if (cursor >= end) break;
  }
  return cursor >= end ? rounded(total / (unit === 'wmoUnit:mm' ? 25.4 : 1), precision) : null;
}
export function guidanceBlend(hrrr, ecmwf) {
  const sources = [{ name: 'HRRR', value: hrrr, weight: 0.6 }, { name: 'ECMWF IFS', value: ecmwf, weight: 0.4 }].filter((s) => finite(s.value));
  const weight = sources.reduce((a, s) => a + s.weight, 0);
  return { value: weight ? rounded(sources.reduce((a, s) => a + s.value * s.weight, 0) / weight, 3) : null,
    sources: sources.map((s) => ({ name: s.name, weight: s.weight / weight })),
    calibrated: false };
}
function toF(quantity) {
  if (!finite(quantity?.value)) return null;
  if (quantity.unitCode === 'wmoUnit:degF') return quantity.value;
  if (quantity.unitCode === 'wmoUnit:degC') return quantity.value * 1.8 + 32;
  return null;
}
function toMph(quantity) {
  if (!finite(quantity?.value)) return null;
  const factor = { 'wmoUnit:km_h-1': 0.621371, 'wmoUnit:m_s-1': 2.236936, 'wmoUnit:kn': 1.150779, 'wmoUnit:mi_h-1': 1 }[quantity.unitCode];
  return finite(factor) ? quantity.value * factor : null;
}
const periodTemp = (period) => finite(period?.temperature) ? (period.temperatureUnit === 'C' ? period.temperature * 1.8 + 32 : period.temperatureUnit === 'F' ? period.temperature : null) : null;
const periodPop = (p) => { const v = numeric(p?.probabilityOfPrecipitation?.value); return v !== null && v >= 0 && v <= 100 ? v : null; };

export function normalizeModel(payload, now = Date.now(), maxHours = 240) {
  const hourly = payload?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) return [];
  const units = payload.hourly_units || {};
  // Refuse inconsistent units; never silently label Celsius as Fahrenheit.
  if (units.temperature_2m !== '°F' || units.precipitation !== 'inch' || units.wind_speed_10m !== 'mp/h') return [];
  return hourly.time.flatMap((t, i) => {
    const time = typeof t === 'number' ? t * 1000 : NaN;
    if (!finite(time) || time > now + maxHours * HOUR) return [];
    const row = { time };
    for (const key of Object.keys(hourly)) if (key !== 'time') row[key] = numeric(hourly[key]?.[i]);
    return [row];
  });
}
export function parseRadarTimes(xml, now = Date.now()) {
  const matches = [...String(xml).matchAll(/<(?:\w+:)?(?:Dimension|Extent)\b[^>]*\bname=["']time["'][^>]*>([\s\S]*?)<\/(?:\w+:)?(?:Dimension|Extent)>/gi)];
  const times = [];
  for (const match of matches) for (const token of match[1].trim().split(',')) {
    if (token.includes('/')) {
      const [from, to, step] = token.trim().split('/');
      const start = Date.parse(from), end = Date.parse(to), delta = durationMs(step);
      if (!finite(start) || !finite(end) || !delta || delta < MINUTE) continue;
      for (let t = Math.max(start, end - 2 * HOUR); t <= end; t += delta) times.push(t);
    } else { const t = Date.parse(token.trim()); if (finite(t)) times.push(t); }
  }
  const sorted = [...new Set(times)].filter((t) => t <= now + MINUTE && t >= now - 3 * HOUR).sort((a, b) => a - b);
  // At most 13 real, advertised times. Do not manufacture historical frames.
  const every = Math.max(1, Math.ceil(sorted.length / 12));
  return [...new Set([...sorted.filter((_, i) => i % every === 0), ...sorted.slice(-1)])].map(iso);
}

/** Bounded in-process cache with concurrent request de-duplication and no stale fallback. */
export class Cache {
  constructor(limit = 350, now = Date.now) { this.values = new Map(); this.pending = new Map(); this.limit = limit; this.now = now; }
  async get(key, ttl, load) {
    const hit = this.values.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 50) throw errorWithStatus('Weather sources are busy. Please retry shortly.', 429);
    const work = Promise.resolve().then(load).then((value) => {
      this.values.delete(key);
      if (this.values.size >= this.limit) this.values.delete(this.values.keys().next().value);
      this.values.set(key, { value, expires: this.now() + ttl });
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
}

export function buildForecast({ location, point, forecast, hourly, grid, discussion, observation, alerts, models, feeds, now }) {
  const zone = point?.timeZone || models.ecmwf?.timezone || 'America/New_York';
  const today = dateKey(now, zone);
  const rows = Object.fromEntries(Object.entries(models).map(([key, value]) => [key, normalizeModel(value, now, key === 'hrrr' ? 48 : 240)]));
  const periods = (forecast?.periods || []).filter((p) => Date.parse(p.endTime) > now);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = nextDate(today, index), start = localTime(date, 7, zone), end = localTime(nextDate(date), 7, zone);
    const midnight = localTime(date, 0, zone), nextMidnight = localTime(nextDate(date), 0, zone);
    const dayPeriods = periods.filter((p) => dateKey(Date.parse(p.startTime), zone) === date);
    const day = dayPeriods.find((p) => p.isDaytime), night = eveningPeriod(periods,date,zone,now);
    const modelValues = Object.fromEntries(Object.entries(rows).map(([key, series]) => {
      const dayRows = series.filter((r) => r.time >= midnight && r.time < nextMidnight);
      const temperatures = dayRows.map((r) => r.temperature_2m).filter(finite);
      const expected = Math.round((nextMidnight - midnight) / HOUR);
      return [key, { high: temperatures.length === expected ? max(temperatures) : null, low: temperatures.length === expected ? min(temperatures) : null,
        qpf: sumHourly(series, start, end), gust: max(dayRows.map((r) => r.wind_gusts_10m)), coverageHours: temperatures.length }];
    }));
    const officialQpf = gridQpf(grid, start, end);
    const blend = guidanceBlend(modelValues.hrrr?.qpf, modelValues.ecmwf?.qpf);
    const fallback = modelValues.nbm?.qpf ?? (index === 0 ? blend.value : modelValues.ecmwf?.qpf) ?? null;
    const qpf = officialQpf ?? fallback;
    const qpfSource = officialQpf !== null ? 'NWS grid (boundary-prorated)' : modelValues.nbm?.qpf != null ? 'NBM guidance' : index === 0 && blend.sources.length ? blend.sources.map((s) => `${s.name} ${Math.round(s.weight * 100)}%`).join(' / ') : modelValues.ecmwf?.qpf != null ? 'ECMWF IFS guidance' : 'Unavailable';
    const guidanceHigh = modelValues.nbm?.high ?? modelValues.ecmwf?.high ?? null;
    const guidanceLow = modelValues.nbm?.low ?? modelValues.ecmwf?.low ?? null;
    const high = periodTemp(day), low = periodTemp(night);
    const highs = [high, ...Object.values(modelValues).map((v) => v.high)].filter(finite);
    const spread = highs.length >= 2 ? max(highs) - min(highs) : null;
    const agreement = spread == null ? 'Limited guidance' : spread <= 3 ? 'Close agreement' : spread <= 6 ? 'Some disagreement' : 'Wide disagreement';
    return { date, label: index === 0 ? 'Today' : new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(new Date(midnight + 12 * HOUR)),
      high: rounded(high ?? guidanceHigh), low: rounded(low ?? guidanceLow),
      temperatureSource: high !== null || low !== null ? 'NWS; missing values may use guidance' : 'Model guidance; NWS unavailable',
      lowLabel: low !== null ? 'Overnight low' : 'Calendar-day model low',
      condition: clean(day?.shortForecast || night?.shortForecast || 'Forecast unavailable', 150),
      detail: clean(day?.detailedForecast || night?.detailedForecast, 1500), nightDetail: clean(night?.detailedForecast, 1500),
      popDay: periodPop(day), popNight: periodPop(night), pop: max([periodPop(day), periodPop(night)]),
      popLabel: 'Highest NWS day/night period chance, not a combined daily probability',
      qpf, qpfSource, qpfWindow: { start: iso(start), end: iso(end) },
      remainingQpf: index === 0 ? gridQpf(grid, Math.max(start, Math.ceil(now / HOUR) * HOUR), end) : null,
      guidance: modelValues, illustrativeBlend: index === 0 ? blend : null, agreement, highSpread: rounded(spread, 1),
      wind: clean(day?.windSpeed || night?.windSpeed, 60), windDirection: clean(day?.windDirection || night?.windDirection, 20) };
  });
  const officialHours = (hourly?.periods || []).filter((p) => Date.parse(p.endTime) > now).slice(0, 48);
  const hours = officialHours.map((p) => {
    const time = Date.parse(p.startTime);
    // NWS hourly period starts at t; model accumulation for that hour ends at t + 1h.
    const find = (key, at = time) => rows[key]?.find((r) => r.time === at);
    const primary = find('hrrr') || find('ecmwf') || find('nbm');
    const rain = find('hrrr', time + HOUR)?.precipitation ?? find('ecmwf', time + HOUR)?.precipitation ?? null;
    return { time: p.startTime, temperature: rounded(periodTemp(p)), pop: periodPop(p), condition: clean(p.shortForecast, 100), isDay: !!p.isDaytime,
      wind: clean(p.windSpeed, 50), windDirection: clean(p.windDirection, 20), humidity: numeric(p.relativeHumidity?.value),
      dewpoint: rounded(toF(p.dewpoint)), precipitation: rain, precipitationSource: finite(find('hrrr', time + HOUR)?.precipitation) ? 'HRRR guidance' : 'ECMWF guidance',
      apparent: rounded(primary?.apparent_temperature), gust: rounded(primary?.wind_gusts_10m) };
  });
  const currentIndex = Math.floor(now / HOUR) * HOUR;
  const modelNow = rows.hrrr?.find((r) => r.time === currentIndex) || rows.ecmwf?.find((r) => r.time === currentIndex);
  const current = observation ? { ...observation, type: 'observation' } : {
    type: 'guidance', temperature: rounded(modelNow?.temperature_2m ?? hours[0]?.temperature),
    condition: hours[0]?.condition || 'Current observation unavailable', time: iso(currentIndex), station: null,
    humidity: rounded(modelNow?.relative_humidity_2m), dewpoint: rounded(modelNow?.dew_point_2m),
    wind: rounded(modelNow?.wind_speed_10m), gust: rounded(modelNow?.wind_gusts_10m),
    windDirection: numeric(modelNow?.wind_direction_10m), visibility: null, pressure: null };
  current.apparent = rounded(modelNow?.apparent_temperature);
  current.apparentSource = 'Model-derived feels like';
  const resolvedName = location.name || [point?.relativeLocation?.properties?.city, point?.relativeLocation?.properties?.state].filter(Boolean).join(', ') || 'Selected location';
  const solarIndex = (models.ecmwf?.daily?.time || []).findIndex((t) => dateKey(t * 1000, zone) === today);
  const output = { version: VERSION, assembledAt: iso(now), location: { ...location, name: resolvedName, timeZone: zone, office: point?.cwa || null },
    current, hours, days, discussion: discussion || null, alerts: alerts || [], feeds,
    solar: { sunrise: models.ecmwf?.daily?.sunrise?.[solarIndex] ? iso(models.ecmwf.daily.sunrise[solarIndex] * 1000) : null,
      sunset: models.ecmwf?.daily?.sunset?.[solarIndex] ? iso(models.ecmwf.daily.sunset[solarIndex] * 1000) : null },
    methodology: 'NWS temperatures, conditions and precipitation probabilities are primary. NWS grid precipitation is integrated over local 7 AM–7 AM windows. Model guidance is supplementary and not a verified skill-weighted forecast. Model high/low comparisons use calendar days; the NWS low is overnight. Precipitation includes liquid-equivalent snow/ice.' };
  enhanceForecast(output, { models, grid, periods: forecast?.periods || [], now, gridQpf, localTime, nextDate, dateKey });
  addExperience(output, {models, grid, periods:forecast?.periods || [], now, solarTimes, nextDate});
  // Hash all forecast facts and source issuance, not just rainfall. Retrieval time is not model run time.
  output.signature = hash({ experienceVersion: output.experienceVersion, metricForecasts:output.metricForecasts, version: VERSION, location: output.location, days, hours, discussion,
    precipitation: output.precipitation, modelContributions: output.modelContributions, alerts: output.alerts.map((a) => [a.id, a.sent, a.expires]), feeds: feeds.map((f) => [f.id, f.status, f.issuedAt]) });
  return output;
}

export function createWeatherService({ fetchImpl = globalThis.fetch, env = process.env, now = Date.now } = {}) {
  const cache = new Cache(350, now), forecastCache = new Cache(100, now), aiCache = new Cache(100, now);
  const failureCooldown = new Map();
  let aiBudget = { day: '', count: 0 };
  let apiMinute = { minute: 0, count: 0 };
  const userAgent = env.WEATHER_FUSION_USER_AGENT || 'Sun-Nourie-WeatherFusion/1.0 (https://github.com/nourie42/Sun-Nourie)';
  const direct = createDirectModels({ fetchImpl, now });
  async function request(url, { text = false, body = null, timeout = 12000 } = {}) {
    const u = new URL(url);
    const allowed = ['api.weather.gov', 'geocoding-api.open-meteo.com', 'opengeo.ncep.noaa.gov', 'api.openai.com'];
    if (u.protocol !== 'https:' || !allowed.includes(u.hostname) || u.port || u.username || u.password) throw errorWithStatus('Unexpected source URL.', 502);
    const minute = Math.floor(now() / MINUTE);
    if (apiMinute.minute !== minute) apiMinute = { minute, count: 0 };
    if (++apiMinute.count > 400) throw errorWithStatus('Weather source request budget reached.', 429);
    const headers = { 'User-Agent': userAgent, Accept: text ? 'application/xml,text/xml' : 'application/json' };
    if (body) { headers['Content-Type'] = 'application/json'; headers.Authorization = `Bearer ${env.OPENAI_API_KEY}`; }
    const response = await fetchImpl(url, { headers, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(timeout) });
    if (!response.ok) { const error = errorWithStatus(`Source returned HTTP ${response.status}.`, 502); if (u.hostname === 'api.openai.com') { error.aiDiagnostic = `AI_PROVIDER_HTTP_${response.status}`; try { const detail = await response.json(); const parameter = detail.error?.param; if (typeof parameter === 'string' && /^[a-zA-Z0-9_.-]{1,60}$/.test(parameter)) error.aiDiagnostic += '_' + parameter; } catch {} } throw error; }
    const size = Number(response.headers.get('content-length') || 0);
    if (size > 2500000) throw errorWithStatus('Source payload exceeded the safety limit.', 502);
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 2500000) throw errorWithStatus('Source payload exceeded the safety limit.', 502);
    return text ? raw : JSON.parse(raw);
  }
  const cached = (url, ttl, options) => cache.get(url, ttl, async () => ({ data: await request(url, options), fetchedAt: iso(now()) }));
  async function feed(id, label, url, ttl, transform = (d) => d, options) {
    try {
      const { data, fetchedAt } = await cached(url, ttl, options);
      const value = await transform(data);
      if (value == null) throw new Error('Source did not supply usable data.');
      const issuedAt = value.issuanceTime || value.updateTime || value.generatedAt || value.time || null;
      const age = issuedAt ? now() - Date.parse(issuedAt) : 0;
      return { value, meta: { id, label, status: age > 24 * HOUR ? 'stale' : 'ready', fetchedAt, issuedAt, url: url.replace(/([?&])apikey=[^&]*(&?)/, '$1').replace(/[?&]$/, '') } };
    } catch (e) { return { value: null, meta: { id, label, status: 'unavailable', fetchedAt: null, issuedAt: null, message: clean(e.message, 160), url: url.split('?')[0] } }; }
  }
  async function loadModel(id, location) { return direct.load(id, location); }
  async function getForecast(query) {
    const location = coordinates(query), key = `${location.latitude},${location.longitude}`;
    return forecastCache.get(key, MINUTE, async () => {
      const pointFeed = await feed('point', 'NWS location', `https://api.weather.gov/points/${key}`, 24 * HOUR, (d) => d.properties);
      const point = pointFeed.value;
      const unavailable = (id, label) => Promise.resolve({ value: null, meta: { id, label, status: 'unavailable', message: 'NWS location lookup unavailable.', issuedAt: null } });
      const get = (id, label, url, ttl, transform) => url ? feed(id, label, url, ttl, transform) : unavailable(id, label);
      const jobs = {
        forecast: get('nws', 'NWS forecast', point?.forecast, 10 * MINUTE, (d) => d.properties?.periods?.length ? d.properties : null),
        hourly: get('hourly', 'NWS hourly', point?.forecastHourly, 10 * MINUTE, (d) => d.properties?.periods?.length ? d.properties : null),
        grid: get('grid', 'NWS precipitation grid', point?.forecastGridData, 10 * MINUTE, (d) => d.properties),
        alerts: feed('alerts', 'Official NWS alerts', `https://api.weather.gov/alerts/active?point=${key}`, MINUTE, (d) => Array.isArray(d.features) ? d.features.filter((f) => f.properties?.status === 'Actual' && f.properties?.messageType !== 'Cancel' && Date.parse(f.properties?.expires) > now()).map((f) => ({ id: f.id, geometry: f.geometry, ...f.properties })) : null),
        discussion: point?.cwa ? feed('afd', `NWS ${point.cwa} discussion`, `https://api.weather.gov/products/types/AFD/locations/${point.cwa}`, 5 * MINUTE, async (d) => {
          const latest = (d['@graph'] || []).filter((p) => p.productCode === 'AFD' && Date.parse(p.issuanceTime) <= now() + MINUTE).sort((a, b) => Date.parse(b.issuanceTime) - Date.parse(a.issuanceTime))[0];
          if (!latest?.['@id']) return null;
          const { data } = await cached(latest['@id'], 5 * MINUTE);
          return data.productText ? { id: data.id || latest['@id'], office: point.cwa, issuanceTime: data.issuanceTime, text: clean(data.productText, 26000), url: latest['@id'] } : null;
        }) : unavailable('afd', 'NWS discussion'),
        observation: point?.observationStations ? feed('observation', 'Nearby station observation', point.observationStations, 5 * MINUTE, async (d) => {
          const distance = (s) => { const c=s.geometry?.coordinates; return c ? (c[1]-location.latitude)**2+((c[0]-location.longitude)*Math.cos(location.latitude*Math.PI/180))**2 : Infinity; };
          const stations = [...(d.features || [])].sort((a,b)=>distance(a)-distance(b)).slice(0, 6);
          const candidates = await Promise.all(stations.map(async (s) => {
            try {
              const id = s.properties?.stationIdentifier;
              if (!/^[A-Z0-9]{3,8}$/.test(id || '')) return null;
              const { data } = await cached(`https://api.weather.gov/stations/${id}/observations/latest`, 5 * MINUTE);
              const o = data.properties, time = Date.parse(o?.timestamp);
              if (!finite(toF(o?.temperature)) || now() - time > 2 * HOUR || time > now() + 5 * MINUTE) return null;
              return { temperature: rounded(toF(o.temperature)), condition: clean(o.textDescription, 120), time: o.timestamp,
                stationDistanceKm: rounded(Math.sqrt(distance(s))*111.2,1), station: id, stationName: clean(s.properties?.name, 140), humidity: rounded(o.relativeHumidity?.value), dewpoint: rounded(toF(o.dewpoint)),
                wind: rounded(toMph(o.windSpeed)), gust: rounded(toMph(o.windGust)), windDirection: numeric(o.windDirection?.value),
                visibility: o.visibility?.unitCode === 'wmoUnit:m' && finite(o.visibility.value) ? rounded(o.visibility.value / 1609.344, 1) : null,
                pressurePa: o.barometricPressure?.unitCode === 'wmoUnit:Pa' ? numeric(o.barometricPressure.value) : null,
                pressure: o.barometricPressure?.unitCode === 'wmoUnit:Pa' && finite(o.barometricPressure.value) ? rounded(o.barometricPressure.value / 3386.389, 2) : null };
            } catch { return null; }
          }));
          const chosen=candidates.find(Boolean)||null;
          if(chosen?.station&&finite(chosen.pressurePa)){
            try{
              const stamp=Date.parse(chosen.time);
              const params=new URLSearchParams({start:iso(stamp-3.5*HOUR),end:iso(stamp-2.5*HOUR),limit:'100'});
              const {data:history}=await cached(`https://api.weather.gov/stations/${chosen.station}/observations?${params}`,5*MINUTE);
              chosen.pressureTrend=pressureTrendFromObservations(history.features,chosen);
            }catch{chosen.pressureTrend={status:'unavailable',direction:'unknown'};}
          }
          return chosen;
        }) : unavailable('observation', 'Station observation'),
        hrrr: loadModel('hrrr', location),
        ecmwf: loadModel('ecmwf', location),
        nbm: loadModel('nbm', location),
      };
      const values = Object.fromEntries(await Promise.all(Object.entries(jobs).map(async ([id, promise]) => [id, await promise])));
      const data = Object.fromEntries(Object.entries(values).map(([id, f]) => [id, f.meta.status === 'ready' ? f.value : null]));
      const result = buildForecast({ ...data, point, location, models: { hrrr: data.hrrr, ecmwf: data.ecmwf, nbm: data.nbm }, feeds: [pointFeed.meta, ...Object.values(values).map((f) => f.meta)], now: now() });
      // Access never exposes the provider credential or a made-up model run timestamp.
      result.aiConfigured = !!env.OPENAI_API_KEY;
      result.modelAccessConfigured = true;
      result.directModelStatus = result.modelContributions.length === 3 ? 'ready' : 'partial';
      return result;
    });
  }
  function fallback(data, reason) {
    const evening = Number(new Intl.DateTimeFormat('en-US',{timeZone:data.location.timeZone,hour:'numeric',hourCycle:'h23'}).format(new Date(now()))) >= 15;
    return { mode: 'nws-summary', signature: data.signature, generatedAt: iso(now()), reason,
      headline: evening ? 'Your evening outlook' : data.days[0]?.condition || 'Forecast update', summary: (evening ? data.days[0]?.nightDetail : data.days[0]?.detail) || data.days[0]?.detail || 'The forecast is temporarily unavailable. Check the National Weather Service for the latest update.',
      nearTerm: data.days[0]?.nightDetail || '', extended: data.days[1]?.detail || '',
      uncertainty: 'Forecasts can change, especially the timing and location of showers.', sources: ['nws'] };
  }
  async function getBriefing(query) {
    const data = await getForecast(query);
    if (query.signature && query.signature !== data.signature) throw errorWithStatus('The source forecast changed. Refresh the forecast before requesting its briefing.', 409);
    if (!env.OPENAI_API_KEY) return fallback(data, 'AI is not configured; showing the official NWS text.');
    if (!data.discussion || data.feeds.find((f) => f.id === 'afd')?.status !== 'ready' || data.feeds.find((f) => f.id === 'nws')?.status !== 'ready') return fallback(data, 'A fresh NWS forecast and local discussion are required for AI synthesis.');
    const key = `${data.location.latitude},${data.location.longitude}`;
    const previousFailure = failureCooldown.get(key);
    if (previousFailure?.until > now()) return { ...fallback(data, 'AI is cooling down after an unavailable response; official guidance is shown.'), diagnostic: previousFailure.diagnostic, retryAfter: iso(previousFailure.until) };
    const briefing = await aiCache.get(data.signature, 30 * MINUTE, async () => {
      const day = new Date(now()).toISOString().slice(0, 10);
      if (aiBudget.day !== day) aiBudget = { day, count: 0 };
      const rawLimit = Number(env.WEATHER_FUSION_AI_DAILY_LIMIT || 96);
      const limit = finite(rawLimit) ? Math.max(0, Math.min(500, rawLimit)) : 96;
      if (aiBudget.count >= limit) return fallback(data, 'The configured AI daily request limit has been reached.');
      let lastFailure = null;
      const properties = Object.fromEntries(['headline', 'summary', 'nearTerm', 'extended', 'uncertainty'].map((k) => [k, { type: 'string' }]));
      properties.sources = { type: 'array', items: { type: 'string', enum: ['nws', 'afd', 'hrrr', 'ecmwf', 'nbm'] } };
      const facts = { currentLocalTime: new Intl.DateTimeFormat('en-US',{timeZone:data.location.timeZone,dateStyle:'full',timeStyle:'short'}).format(new Date(now())), discussionPriority: 'Translate the latest local NWS discussion into everyday language; technical provenance is only for metadata.', blendPolicy: data.methodology, modelContributions: data.modelContributions, convectiveGuidance: data.convectiveGuidance, next24HoursPrecipitation: data.precipitation, location: data.location, localDate: dateKey(now(), data.location.timeZone), days: data.days, hours: data.hours.slice(0, 30), discussion: data.discussion, feedStatus: data.feeds.map((f) => ({ id: f.id, status: f.status, issuedAt: f.issuedAt })) };
      for (let attempt = 0; attempt < 2 && aiBudget.count < limit; attempt += 1) {
      aiBudget.count += 1;
      try {
        const result = await request('https://api.openai.com/v1/responses', { timeout: 35000, body: {
          model: env.WEATHER_FUSION_AI_MODEL || 'gpt-5-mini', store: false, max_output_tokens: 4000, reasoning: { effort: 'low' },
          instructions: PLAIN_OUTLOOK_INSTRUCTIONS,
          input: JSON.stringify({ ...facts, requiredSources: ['nws','afd',...data.modelContributions.map(m=>m.id)], revisionInstruction: attempt ? 'The previous attempt failed automated validation. Return every required source ID exactly. Do not include any digit characters in prose; refer to today, tonight, tomorrow and the week ahead. Keep every prose field nonempty and concise. Do not issue weather warnings or promise safe conditions.' : 'Copy every required source ID into the sources array. Write concise professional prose with no digit characters.' }), text: { format: { type: 'json_schema', name: 'weather_briefing', strict: true, schema: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) } } },
        } });
        const text = (result.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
        const content = JSON.parse(text);
        const fields = ['headline', 'summary', 'nearTerm', 'extended', 'uncertainty'];
        if (result.status !== 'completed') throw Object.assign(new Error('AI response was incomplete.'), { aiDiagnostic: 'AI_RESPONSE_INCOMPLETE' });
        if (fields.some((k) => typeof content[k] !== 'string' || !content[k].trim() || content[k].length > 1600)) throw Object.assign(new Error('AI prose structure failed validation.'), { aiDiagnostic: 'AI_PROSE_STRUCTURE' });
        if (fields.some((k) => /\d/.test(content[k]))) throw Object.assign(new Error('AI numerical prose failed validation.'), { aiDiagnostic: 'AI_PROSE_CONTAINS_DIGITS' });
        if (fields.some(k=>/\b(deterministic|HRRR|ECMWF|NBM|CAPE|QPF|synoptic|advection|guidance|Weather Fusion)\b/i.test(content[k]))) throw Object.assign(new Error('Outlook needs plain language.'),{aiDiagnostic:'AI_PROSE_JARGON'});
        if (!Array.isArray(content.sources) || !['nws', 'afd', ...data.modelContributions.map(m=>m.id)].every((id) => content.sources.includes(id)) || content.sources.some((id) => !data.feeds.some((f) => f.id === id && f.status === 'ready'))) throw Object.assign(new Error('AI source attribution failed validation.'), { aiDiagnostic: 'AI_SOURCE_ATTRIBUTION' });
        if (/\b(all clear|no (?:active )?(?:warnings|severe weather)|guaranteed|perfectly safe)\b/i.test(fields.map((k) => content[k]).join(' '))) throw Object.assign(new Error('AI safety wording failed validation.'), { aiDiagnostic: 'AI_SAFETY_WORDING' });
        return { ...content, mode: 'ai', signature: data.signature, generatedAt: iso(now()), model: env.WEATHER_FUSION_AI_MODEL || 'gpt-5-mini' };
      } catch (error) {
        const diagnostic = typeof error.aiDiagnostic === 'string' && /^AI_[A-Z0-9_a-z.\-]{1,100}$/.test(error.aiDiagnostic) ? error.aiDiagnostic : error.name === 'TimeoutError' || error.name === 'AbortError' ? 'AI_PROVIDER_TIMEOUT' : error instanceof SyntaxError ? 'AI_RESPONSE_JSON' : 'AI_RESPONSE_UNAVAILABLE';
        console.warn('Weather Fusion AI synthesis failed:', diagnostic);
        lastFailure = diagnostic;
        if (diagnostic.startsWith('AI_PROVIDER_')) break;
      }
      }
      if (failureCooldown.size > 200) failureCooldown.clear();
      const until = now() + 5 * MINUTE;
      failureCooldown.set(key, { until, diagnostic: lastFailure || 'AI_REQUEST_LIMIT' });
      return { ...fallback(data, 'AI synthesis is temporarily unavailable; the verified source forecast remains visible.'), diagnostic: lastFailure || 'AI_REQUEST_LIMIT', retryAfter: iso(until) };
    });
    // A failed generation is not a successful 30-minute briefing cache entry.
    if (briefing.mode !== 'ai') aiCache.values.delete(data.signature);
    return briefing;
  }
  async function search(query) {
    const text = clean(query, 80).trim();
    if (text.length < 2) return { results: PRESETS };
    const url = `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: text, count: '8', language: 'en', format: 'json', countryCode: 'US' })}`;
    const { data } = await cached(url, HOUR);
    return { results: (data.results || []).filter((p) => p.country_code === 'US' && p.latitude >= 24 && p.latitude <= 50 && p.longitude >= -125 && p.longitude <= -66).map((p) => ({ id: String(p.id), name: [p.name, p.admin1].filter(Boolean).join(', '), latitude: p.latitude, longitude: p.longitude })) };
  }
  async function radar() {
    const result = await feed('radar', 'NOAA radar mosaic', `${RADAR_URL}?service=WMS&version=1.3.0&request=GetCapabilities`, 2 * MINUTE, (xml) => parseRadarTimes(xml, now()), { text: true });
    const frames = result.value || [];
    return { frames, url: RADAR_URL, layer: 'conus_bref_qcd', status: frames.length ? (now() - Date.parse(frames.at(-1)) > 20 * MINUTE ? 'stale' : 'ready') : 'unavailable',
      fetchedAt: result.meta.fetchedAt, message: frames.length ? 'Observed radar mosaic; not a future forecast.' : 'Radar timestamps could not be verified. Use the official radar link.', officialUrl: 'https://radar.weather.gov/' };
  }
  const getBulletins=createBulletinService({getForecast,request,env,now});
  return { getForecast, getBriefing, getBulletins, search, radar, modelMaps: direct.maps };
}

export function registerWeatherFusionRoutes(app, options = {}) {
  const service = createWeatherService(options);
  const counters = new Map();
  const route = (handler) => async (req, res) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown', minute = Math.floor(Date.now() / MINUTE);
    const previous = counters.get(key), current = previous?.minute === minute ? previous : { minute, count: 0 };
    current.count += 1; counters.set(key, current);
    if (counters.size > 2000) for (const [id, v] of counters) if (v.minute < minute) counters.delete(id);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (current.count > 45 || counters.size > 3000) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many weather requests. Please retry in a minute.' }); }
    try { return res.json(await handler(req.query || {})); }
    catch (e) { return res.status(e.status || 503).json({ error: e.status === 400 || e.status === 409 ? e.message : 'Weather data is temporarily unavailable. Please retry.' }); }
  };
  app.get(['/weather', '/weather-fusion', '/weather-fusion/'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
  for (const name of ['app.js', 'style.css', 'nav.js', 'experience.js', 'weather-math.js','hero-mode.js','dewpoint-meter.js','dewpoint-meter.css','comfort-effects.css','frame-player.js','comfort-outlook.js','forecast-layout.css','personal-details.js','personal-details.css','bulletin-facts.js','bulletins.js','current-temperature.js']) app.get(`/weather-fusion/${name}`, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(PUBLIC_DIR, name));
  });
  app.get('/api/weather-fusion/forecast', route(service.getForecast));
  app.get('/api/weather-fusion/briefing', route(service.getBriefing));
  app.get('/api/weather-fusion/bulletins', route(service.getBulletins));
  app.get('/api/weather-fusion/search', route((q) => service.search(q.q)));
  app.get('/api/weather-fusion/radar', route(service.radar));
  app.get('/api/weather-fusion/models', route(service.modelMaps));
  return service;
}
