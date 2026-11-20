// Global multi-hour atmospheric grid service for the photorealistic 3D Earth Globe.
// Combines real global Open-Meteo hourly fields (cloud cover, precipitation,
// 10m wind u/v vectors, surface temperature) over a 14x30 lat/lon grid for 48 hours.

const GRID_LATS = [74, 64, 54, 45, 37, 29, 19, 8, -4, -16, -28, -40, -52, -66];
const GRID_LONS = Array.from({ length: 30 }, (_, i) => -180 + i * 12); // -180 .. +168
const FORECAST_HOURS = 48;
const CACHE_TTL_MS = 30 * 60 * 1000;
const STALE_FALLBACK_MS = 6 * 3600 * 1000;

function toGridCoords() {
  const coords = [];
  for (const lat of GRID_LATS) {
    for (const lon of GRID_LONS) {
      coords.push({ lat, lon });
    }
  }
  return coords;
}

function windToUvKnots(speedKn, dirFromDeg) {
  if (!Number.isFinite(speedKn) || !Number.isFinite(dirFromDeg)) return [0, 0];
  const rad = (dirFromDeg * Math.PI) / 180;
  // Meteorological wind direction is FROM north clockwise; convert to vector blowing TOWARD (east u, north v).
  const u = -speedKn * Math.sin(rad);
  const v = -speedKn * Math.cos(rad);
  return [Math.round(u * 10) / 10, Math.round(v * 10) / 10];
}

function num(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function buildGlobalGridPayload(pointsData, fetchedAtIso, nowMs = Date.parse(fetchedAtIso) || Date.now()) {
  const nLat = GRID_LATS.length;
  const nLon = GRID_LONS.length;
  const nPts = nLat * nLon;
  const sample = pointsData.find((p) => Array.isArray(p?.hourly?.time) && p.hourly.time.length > 0);
  if (!sample) throw new Error('Global weather feed returned no hourly grid.');

  const allTimes = sample.hourly.time.map((t) => (t.endsWith('Z') ? t : `${t}:00Z`));
  const currentHourMs = Math.floor(nowMs / 3600000) * 3600000;
  let startIdx = allTimes.findIndex((t) => Date.parse(t) >= currentHourMs);
  if (startIdx < 0 || startIdx > allTimes.length - 12) startIdx = 0;

  const hourCount = Math.min(FORECAST_HOURS, allTimes.length - startIdx);
  const hours = allTimes.slice(startIdx, startIdx + hourCount);
  const frames = [];

  for (let offset = 0; offset < hourCount; offset++) {
    const h = startIdx + offset;
    const cloud = new Array(nPts);
    const precip = new Array(nPts);
    const u = new Array(nPts);
    const v = new Array(nPts);
    const temp = new Array(nPts);

    for (let i = 0; i < nPts; i++) {
      const hr = pointsData[i]?.hourly;
      const c = num(hr?.cloud_cover?.[h], 0);
      const p = num(hr?.precipitation?.[h], 0);
      const spd = num(hr?.wind_speed_10m?.[h], 0);
      const dir = num(hr?.wind_direction_10m?.[h], 0);
      const tmp = num(hr?.temperature_2m?.[h], 55);
      const [uw, vw] = windToUvKnots(spd, dir);
      cloud[i] = Math.max(0, Math.min(100, Math.round(c)));
      precip[i] = Math.round(Math.max(0, p) * 100) / 100;
      u[i] = uw;
      v[i] = vw;
      temp[i] = Math.round(tmp);
    }
    frames.push({ time: hours[offset], cloud, precip, u, v, temp });
  }

  return {
    version: 3,
    fetchedAt: fetchedAtIso,
    lats: GRID_LATS,
    lons: GRID_LONS,
    nLat,
    nLon,
    hours,
    frames,
  };
}

export function createGlobalGlobeService({ fetchImpl = fetch, now = Date.now } = {}) {
  let cached = null;
  let cachedAt = 0;
  let pending = null;

  async function fetchBatch(coords) {
    const latsParam = coords.map((c) => c.lat).join(',');
    const lonsParam = coords.map((c) => c.lon).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latsParam}&longitude=${lonsParam}&hourly=cloud_cover,precipitation,wind_speed_10m,wind_direction_10m,temperature_2m&forecast_days=3&timezone=UTC&wind_speed_unit=kn&temperature_unit=fahrenheit`;
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'WeatherNourie/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Global Open-Meteo grid HTTP ${res.status}`);
    const body = await res.json();
    return Array.isArray(body) ? body : [body];
  }

  async function refresh() {
    const coords = toGridCoords();
    const chunkSize = 140;
    const chunks = [];
    for (let i = 0; i < coords.length; i += chunkSize) {
      chunks.push(coords.slice(i, i + chunkSize));
    }
    const results = await Promise.all(chunks.map(fetchBatch));
    const flat = results.flat();
    const tsNow = now();
    const payload = buildGlobalGridPayload(flat, new Date(tsNow).toISOString(), tsNow);
    cached = payload;
    cachedAt = now();
    return payload;
  }

  async function getGlobalWeather() {
    const ts = now();
    if (cached && ts - cachedAt < CACHE_TTL_MS) {
      return cached;
    }
    if (pending) return pending;
    pending = refresh()
      .catch((err) => {
        if (cached && now() - cachedAt < STALE_FALLBACK_MS) {
          return { ...cached, stale: true, staleReason: err?.message || 'refresh failed' };
        }
        throw err;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  return { getGlobalWeather };
}
