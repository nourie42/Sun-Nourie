import {googlePoints, selectGoogleForecast, HOUR} from './weatherComparisonData.js';
import {weatherNextFreshness} from './weatherNextFreshness.js';

/** Published, full-precision NVIDIA/WeatherNext point guidance. No new queries. */
export const WEATHERNEXT_BLEND_FEED = 'https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext-full.json';
const CACHE_MS = 5 * 60000;
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_POINT_DISTANCE_KM = 15;
const SURFACE_IDS = ['surface', 'interimSurface', 'previousSurface'];
const STATION_FOR = {surface:'station', interimSurface:'interimStation', previousSurface:'previousStation'};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const bounded = (value, min, max) => finite(value) && value >= min && value <= max ? value : null;
const iso = value => new Date(value).toISOString();

function distanceKm(a, b) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.latitude-a.latitude), dLon = rad(b.longitude-a.longitude);
  const x = Math.sin(dLat/2)**2 + Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1-x)));
}

/** A duplicate or non-hour timestamp never becomes authoritative guidance. */
function validRows(point, source, now) {
  const run = Date.parse(source.runAt), seen = new Set(), duplicates = new Set();
  const rows = (Array.isArray(point.hourly) ? point.hourly : []).filter(row => {
    const time = Date.parse(row?.time);
    if (!finite(time) || time % HOUR !== 0 || time <= run || time < now-72*HOUR || time > now+360*HOUR) return false;
    if (seen.has(time)) duplicates.add(time);
    seen.add(time);
    return true;
  });
  return rows.filter(row => !duplicates.has(Date.parse(row.time))).sort((a,b) => Date.parse(a.time)-Date.parse(b.time)).slice(0, 433);
}

function matchingPoint(source, point) {
  const candidate = source?.points?.find(p => p?.id === point.id);
  if (!candidate || !finite(candidate.latitude) || !finite(candidate.longitude) || distanceKm(candidate, point) > .1) return null;
  // Validate the model's actual selected grid too; a matching city id is not enough.
  if (!finite(candidate.gridLatitude) || !finite(candidate.gridLongitude) || distanceKm(point, {latitude:candidate.gridLatitude, longitude:candidate.gridLongitude}) > MAX_POINT_DISTANCE_KM) return null;
  return candidate;
}

function adapt(feed, location, now) {
  if (feed?.schema !== 'weather-nourie-weathernext-site-v1' || feed.rawUnits?.temperature !== 'K' || feed.rawUnits?.wind !== 'm/s' || feed.rawUnits?.precipitation !== 'm per preceding hour' || feed.rawUnits?.cloud !== 'fraction' || feed.rawUnits?.pressure !== 'Pa') throw new Error('Published NVIDIA full-precision schema or units are invalid.');
  const point = googlePoints(feed).map(point => ({...point, distance:distanceKm(location, point)})).sort((a,b) => a.distance-b.distance).find(point => point.distance <= MAX_POINT_DISTANCE_KM);
  if (!point) throw new Error('NVIDIA has no published point within 15 km of this location.');
  const sources = {};
  for (const id of SURFACE_IDS) {
    const source = feed.sources?.[id], candidate = matchingPoint(source, point);
    if (!candidate || Date.parse(source.runAt) % HOUR !== 0 || weatherNextFreshness(source, now).status !== 'ready') continue;
    const hourly = validRows(candidate, source, now);
    if (!hourly.length) continue;
    sources[id] = {...source, points:[{...candidate, hourly}]};
    const stationId = STATION_FOR[id], station = feed.sources[stationId], stationPoint = matchingPoint(station, point);
    if (stationPoint && Date.parse(station.runAt) === Date.parse(source.runAt) && weatherNextFreshness(station, now).status === 'ready') sources[stationId] = {...station, points:[{...stationPoint, hourly:validRows(stationPoint, station, now)}]};
  }
  if (!Object.keys(sources).some(id => SURFACE_IDS.includes(id))) throw new Error('No fresh NVIDIA initialization covers this published point.');
  // The comparison adapter supplies SI conversion and newest-main/interim run
  // selection. Filter freshness first so a stale newer source cannot win.
  const selected = selectGoogleForecast({...feed, points:[point], sources}, point.id, now);
  const rows = selected.rows;
  const hourly = {time:rows.map(row => row.epoch/1000)};
  const fields = {
    temperature_2m:['temperature', -150, 160], dew_point_2m:['dewpoint', -160, 120],
    wind_speed_10m:['wind', 0, 300], wind_direction_10m:['windDirection', 0, 360],
    cloud_cover:['skyCover', 0, 100], pressure_msl:['pressure', 23, 33],
    precipitation:['precedingPrecipitation', 0, 30]
  };
  for (const [field, [input, min, max]] of Object.entries(fields)) hourly[field] = rows.map(row => bounded(row[input], min, max));
  for (const field of ['wind_gusts_10m','visibility','relative_humidity_2m']) hourly[field] = rows.map(() => null);
  const future = rows.filter((row, i) => row.epoch > now && finite(hourly.temperature_2m[i]));
  if (!future.length) throw new Error('No future NVIDIA temperatures cover this location.');
  const precipitationIntervals = rows.flatMap((row, i) => finite(hourly.precipitation[i]) ? [{start:(row.epoch-HOUR)/1000, end:row.epoch/1000, value:hourly.precipitation[i], runAt:row.provenance.runAt, sourceId:row.provenance.id}] : []);
  const runAt = selected.runs.map(run => run.runAt).sort((a,b) => Date.parse(a)-Date.parse(b)).at(-1);
  const latest = rows.find(row => row.provenance.runAt === runAt)?.provenance;
  return {
    latitude:location.latitude, longitude:location.longitude,
    publishedPoint:{id:point.id, name:point.name, latitude:point.latitude, longitude:point.longitude, distanceKm:point.distance},
    modelGrid:{latitude:latest?.gridLatitude, longitude:latest?.gridLongitude},
    model:'wn', verifiedModel:true, hourly,
    hourly_units:{time:'unixtime', temperature_2m:'°F', dew_point_2m:'°F', wind_speed_10m:'mp/h', wind_gusts_10m:'mp/h', wind_direction_10m:'°', cloud_cover:'%', relative_humidity_2m:'%', pressure_msl:'inHg', precipitation:'inch', visibility:'mi'},
    precipitationIntervals, runAt, validUntil:iso(Math.max(...future.map(row => row.epoch))),
    runs:selected.runs, hourlyProvenance:rows.map(row => row.provenance),
    resolution:'0.1° surface / 0.05° station-trained where verified',
    sourceUrl:WEATHERNEXT_BLEND_FEED, transport:'Existing published full-precision NVIDIA/WeatherNext point feed',
    runScope:'Newest fresh initialization at each exact hour; older fresh main-run hours extend an interim run.',
    timezone:point.timeZone
  };
}

export function createWeatherNextBlendSource({fetchImpl=globalThis.fetch, now=Date.now}={}) {
  let cache = null, pending = null;
  async function resource() {
    if (cache?.until > now()) return cache;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetchImpl(WEATHERNEXT_BLEND_FEED, {cache:'no-store', redirect:'error', headers:{Accept:'application/json', 'Cache-Control':'no-cache', 'User-Agent':'Sun-Nourie-WeatherFusion/3.0'}, signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error(`Published NVIDIA feed returned HTTP ${response.status}.`);
      if (Number(response.headers?.get?.('content-length')) > MAX_BYTES) throw new Error('Published NVIDIA feed exceeds the payload limit.');
      const body = await response.text();
      if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Published NVIDIA feed exceeds the payload limit.');
      cache = {feed:JSON.parse(body), fetchedAt:iso(now()), until:now()+CACHE_MS};
      return cache;
    })().finally(() => { pending = null; });
    return pending;
  }
  return async function load(location) {
    const meta = {id:'wn', label:'NVIDIA / WeatherNext', url:WEATHERNEXT_BLEND_FEED, status:'unavailable', fetchedAt:null, issuedAt:null, checkedAt:iso(now()), contributes:false};
    try {
      if (!finite(location?.latitude) || !finite(location?.longitude) || location.latitude < -90 || location.latitude > 90 || location.longitude < -180 || location.longitude > 180) throw new Error('Requested NVIDIA forecast coordinates are invalid.');
      const resourceValue = await resource(), value = adapt(resourceValue.feed, location, now());
      value.fetchedAt = resourceValue.fetchedAt;
      return {value, meta:{...meta, status:'ready', contributes:true, fetchedAt:resourceValue.fetchedAt, issuedAt:value.runAt, validUntil:value.validUntil, runAgeHours:(now()-Date.parse(value.runAt))/HOUR, runs:value.runs, publishedPoint:value.publishedPoint, modelGrid:value.modelGrid, transport:value.transport, message:'Fresh published NVIDIA guidance at the selected location; missing measurements remain unavailable.'}};
    } catch (error) {
      return {value:null, meta:{...meta, fetchedAt:cache?.fetchedAt||null, message:String(error.message).slice(0,180)}};
    }
  };
}
