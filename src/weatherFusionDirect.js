/** Direct, decoded NOAA/ECMWF model snapshots. No provider key and no webpage scraping. */
import {shadeFeelsLike} from '../public/weather-fusion/weather-math.js';
export const DATA_ROOT = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/';
export const DIRECT_SCHEMA = 'weather-fusion-direct-v2';
const H = 3600000;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const round = (n, d = 2) => finite(n) ? Number(n.toFixed(d)) : null;
const iso = (t) => new Date(t).toISOString();
const LABELS = { hrrr: 'NOAA HRRR · 3 km', ecmwf: 'ECMWF IFS · 0.25° Open Data', nbm: 'NOAA National Blend · 2.5 km' };
const SOURCE = { hrrr: 'https://www.nco.ncep.noaa.gov/pmb/products/hrrr/', nbm: 'https://www.nco.ncep.noaa.gov/pmb/products/blend/', ecmwf: 'https://www.ecmwf.int/en/forecasts/datasets/open-data' };
export function modelStatus(model, runAt, validUntil, now = Date.now()) {
  const run = Date.parse(runAt), end = Date.parse(validUntil);
  if (!LABELS[model] || !finite(run) || !finite(end) || run > now + 15 * 60000 || end <= now) return 'unavailable';
  return now - run > (model === 'ecmwf' ? 30 : 12) * H ? 'stale' : 'ready';
}
export function validateSnapshot(data, id, location, now) {
  if (data?.schema !== DIRECT_SCHEMA || data.model !== id || data.complete !== true || !Array.isArray(data.points)) throw new Error('Model snapshot schema/identity is invalid.');
  const status = modelStatus(id, data.runAt, data.validUntil, now);
  if (status !== 'ready') return { value: null, status, message: 'The model run is too old or has expired; it is excluded from the forecast.' };
  // Never relabel one saved city's data as an arbitrary map point.
  const point = data.points.find((p) => Math.abs(p.latitude-location.latitude) < 0.0002 && Math.abs(p.longitude-location.longitude) < 0.0002);
  if (!point) return { value: null, status: 'not-covered', message: 'Direct model collection currently covers the two saved locations. This location uses NWS only.' };
  const h = point.hourly, u = point.hourly_units, run = Date.parse(data.runAt)/1000;
  if (!Array.isArray(h?.time) || h.time.length < 12 || h.time.length > 500 || u?.temperature_2m !== '°F' || u.precipitation !== 'inch' || u.wind_speed_10m !== 'mp/h') throw new Error('Invalid model units or time axis.');
  if (h.time.some((t,i) => !finite(t) || t < run || (i > 0 && t-h.time[i-1] !== 3600))) throw new Error('The model time axis is not a continuous hourly axis.');
  for (const [field, values] of Object.entries(h)) {
    if (!Array.isArray(values) || values.length !== h.time.length || values.some((v) => v !== null && !finite(v))) throw new Error(`Invalid model series: ${field}`);
  }
  if (!h.temperature_2m?.some((v,i) => finite(v) && h.time[i]*1000 > now)) throw new Error('No future native model temperatures.');
  const intervals = point.precipitationIntervals;
  if (!Array.isArray(intervals) || intervals.some((r,i) => !finite(r.start) || !finite(r.end) || !finite(r.value) || r.end <= r.start || r.value < 0 || r.value > 100 || r.start < run || (i>0 && r.start < intervals[i-1].end))) throw new Error('Invalid model precipitation intervals.');
  return { status, value: { ...point, direct: true, runAt: data.runAt, validUntil: data.validUntil, resolution: data.resolution, sourceUrl: SOURCE[id], interpolation: data.interpolation, timezone: 'America/New_York' }, message: `${data.resolution}; native grid extraction; initialized ${data.runAt}.` };
}
export function createDirectModels({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  async function resource(file) {
    if (!/^(manifest\.json|models\/(hrrr|ecmwf|nbm)\.json)$/.test(file)) throw new Error('Invalid weather data resource.');
    const hit = cache.get(file);
    if (hit?.until > now()) return hit.data;
    if (pending.has(file)) return pending.get(file);
    const task = (async () => {
      const response = await fetchImpl(DATA_ROOT + file, { headers: { Accept: 'application/json', 'User-Agent': 'Sun-Nourie-WeatherFusion/2.1' }, redirect: 'error', signal: AbortSignal.timeout(18000) });
      if (!response.ok) throw new Error(`Direct data request returned HTTP ${response.status}.`);
      if (Number(response.headers.get('content-length')) > 2500000) throw new Error('Model snapshot exceeds size limit.');
      const text = await response.text();
      if (Buffer.byteLength(text) > 2500000) throw new Error('Model snapshot exceeds size limit.');
      const data = JSON.parse(text);
      cache.set(file, { until: now()+2*60000, data });
      return data;
    })().finally(() => pending.delete(file));
    pending.set(file, task);
    return task;
  }
  async function load(id, location) {
    const meta = { id, label: LABELS[id], url: SOURCE[id], issuedAt: null, fetchedAt: iso(now()), transport: 'Native GRIB2 → verified snapshot', contributes: false };
    try {
      const data = await resource(`models/${id}.json`);
      const result = validateSnapshot(data, id, location, now());
      return { value: result.value, meta: { ...meta, status: result.status, issuedAt: data.runAt, validUntil: data.validUntil, resolution: data.resolution, message: result.message, contributes: result.status === 'ready', snapshotUrl: DATA_ROOT+`models/${id}.json` } };
    } catch (error) { return { value: null, meta: { ...meta, status: 'unavailable', message: String(error.message).slice(0,180) } }; }
  }
  async function maps() {
    const manifest = await resource('manifest.json');
    if (manifest.schema !== DIRECT_SCHEMA || !Array.isArray(manifest.models)) throw new Error('Invalid model map manifest.');
    const layers = {};
    for (const model of manifest.models) {
      const status = modelStatus(model.model, model.runAt, model.validUntil, now());
      for (const [name, rawFrames] of Object.entries(model.maps || {})) {
        if (!['hrrr','ecmwf','nbm','temperature','wind','clouds'].includes(name) || !Array.isArray(rawFrames)) continue;
        const frames = status === 'ready' ? rawFrames.filter((f) => /^maps\/(hrrr|nbm|ecmwf)-\d{10}-(reflectivity|precipitation|temperature|wind|clouds)-\d{3}\.png$/.test(f.file) && f.file.startsWith(`maps/${model.model}-`) && finite(Date.parse(f.time)) && Date.parse(f.time) >= now()-3*H && Date.parse(f.time) <= Date.parse(model.validUntil) && JSON.stringify(f.bounds) === '[[32.5,-85],[38,-74]]').map((f) => ({ ...f, url: DATA_ROOT+f.file })) : [];
        layers[name] = { model: model.model, label: model.label, resolution: model.resolution, runAt: model.runAt, status: frames.length ? status : 'unavailable', frames: frames.sort((a,b) => Date.parse(a.time)-Date.parse(b.time)), sourceUrl: SOURCE[model.model] };
      }
    }
    return { schema: DIRECT_SCHEMA, generatedAt: manifest.generatedAt, layers, coverage: 'North Carolina and surrounding region', note: 'Model forecast images are generated from decoded GRIB2 values. They are not observed radar or an embedded webpage.' };
  }
  return { load, maps };
}
/** Integrate a complete native QPF interval window; gaps and overlaps never become zero. */
export function intervalTotal(intervals, start, end) {
  if (!(finite(start) && finite(end) && end > start)) return null;
  let cursor = start/1000, total = 0;
  const finish = end/1000;
  for (const r of intervals || []) {
    if (!(finite(r.start) && finite(r.end) && finite(r.value)) || r.end <= r.start || r.value < 0) return null;
    if (r.end <= cursor) continue;
    if (r.start > cursor + 0.001) return null;
    const b = Math.min(r.end, finish);
    total += r.value * (b-cursor)/(r.end-r.start);
    cursor = b;
    if (cursor >= finish-0.001) return round(total, 4);
  }
  return null;
}
export function weighted(values, policy) {
  const sources = Object.entries(policy).filter(([id,w]) => finite(values[id]) && w > 0).map(([id,weight]) => ({ id, weight, value: values[id] }));
  const sum = sources.reduce((n,s) => n+s.weight,0);
  return { value: sum ? round(sources.reduce((n,s) => n+s.value*s.weight,0)/sum,4) : null,
    sources: sources.map((s) => ({ ...s, weight: round(s.weight/sum,6) })), calibrated: false };
}
/** Backward-compatible API helper using the same all-weather Steadman equation as the UI. */
export function feelsLike(t, rh, wind, dewpoint = null) {
  const result=shadeFeelsLike(t,rh,wind,dewpoint);
  return {value:finite(result.value)?round(result.value,0):null,method:result.method};
}
function extrema(payload, start, end, mode) {
  const h = payload?.hourly;
  if (!Array.isArray(h?.time) || !(end > start)) return null;
  const values = [];
  for (let t = Math.ceil(start/H)*H; t < end; t += H) {
    const i = h.time.indexOf(t/1000), value = h.temperature_2m?.[i];
    if (!finite(value)) return null;
    values.push(value);
  }
  return values.length ? (mode === 'high' ? Math.max(...values) : Math.min(...values)) : null;
}
function sample(payload, time, field) {
  const h = payload?.hourly, i = h?.time?.indexOf(time/1000);
  return i >= 0 && finite(h[field]?.[i]) ? h[field][i] : null;
}
function tempPolicy(index) { return index === 0 ? { nws:.6,hrrr:.2,ecmwf:.1,nbm:.1 } : index === 1 ? { nws:.6,hrrr:.1,ecmwf:.2,nbm:.1 } : { nws:.6,ecmwf:.25,nbm:.15 }; }
function rainPolicy(leadHours) { return leadHours <= 24 ? { hrrr:.6,ecmwf:.4 } : { ecmwf:.6,nbm:.25,nws:.15 }; }
/** Astronomical sunrise/sunset, independent of model availability. */
export function solarTimes(date, latitude, longitude) {
  if (!finite(latitude) || !finite(longitude)) return { sunrise:null,sunset:null };
  const rad = Math.PI/180, lw=-longitude*rad, phi=latitude*rad;
  const d = Date.parse(`${date}T12:00:00Z`)/86400000-10957.5;
  const n=Math.round(d-.0009-lw/(2*Math.PI));
  const ds=.0009+lw/(2*Math.PI)+n, m=rad*(357.5291+.98560028*ds);
  const l=m+rad*(1.9148*Math.sin(m)+.0200*Math.sin(2*m)+.0003*Math.sin(3*m))+rad*102.9372+Math.PI;
  const dec=Math.asin(Math.sin(l)*Math.sin(rad*23.4397));
  const w=Math.acos((Math.sin(rad*-.833)-Math.sin(phi)*Math.sin(dec))/(Math.cos(phi)*Math.cos(dec)));
  const noon=2451545+ds+.0053*Math.sin(m)-.0069*Math.sin(2*l);
  const rise=noon-w/(2*Math.PI),set=noon+w/(2*Math.PI);
  return finite(rise)&&finite(set)?{sunrise:iso((rise-2440587.5)*86400000),sunset:iso((set-2440587.5)*86400000),source:'Calculated astronomical times'}:{sunrise:null,sunset:null};
}
export function enhanceForecast(out, { models, grid, periods = [], now, gridQpf, localTime, nextDate, dateKey }) {
  const sourceModels = Object.fromEntries(Object.entries(models).filter(([,m]) => m?.direct));
  const active = Object.keys(sourceModels);
  function qpf(start,end,index) {
    const values = { nws: gridQpf(grid,start,end) };
    for (const id of active) values[id] = intervalTotal(sourceModels[id].precipitationIntervals,start,end);
    return weighted(values,rainPolicy((start-now)/H));
  }
  const today=out.days[0]?.date;
  for (const day of out.days) {
    const start = localTime(day.date,7), end=localTime(nextDate(day.date),7);
    const isToday = day.date===today, qpfStart=isToday?Math.max(now,start):start;
    day.qpfWindow={start:iso(qpfStart),end:iso(end),isFullWindow:qpfStart===start};
    day.qpfBlend=qpf(qpfStart,end,day.index);
  }
  for (const hour of out.hours) {
    const time=Date.parse(hour.time);
    const hrrr=sourceModels.hrrr;
    if (hrrr) {
      hour.reflectivity=sample(hrrr,time,'reflectivity');
      hour.nearbyReflectivity=sample(hrrr,time,'nearby_reflectivity');
    }
  }
  const apparent=feelsLike(out.current.temperature,out.current.humidity,out.current.wind,out.current.dewpoint);
  out.current.apparent=apparent.value;
  out.current.apparentSource=`${apparent.method}; ${out.current.type==='observation'?'using nearby station observations':'using forecast guidance'}.`;
  out.solar=solarTimes(out.days[0].date,out.location.latitude,out.location.longitude);
  out.modelContributions=active.map(id=>({id,runAt:sourceModels[id].runAt,resolution:sourceModels[id].resolution}));
  return out;
}
