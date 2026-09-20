/** ZIP geocode + NWS proxy for the /whats-up tracker. Secrets stay server-side. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTrackerView, normalizeZip, trackerError } from './whatsUpTracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public', 'whats-up');
const HOUR = 3600000;
const ALLOWED = new Set([
  'geocoding.geo.census.gov',
  'tigerweb.geo.census.gov',
  'api.zippopotam.us',
  'api.weather.gov',
]);

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clean(value, size = 200) {
  return typeof value === 'string' ? value.slice(0, size) : '';
}

export function createWhatsUpService({
  fetchImpl = globalThis.fetch,
  getForecast = null,
  now = Date.now,
  env = process.env,
  fusionTimeoutMs = 12000,
} = {}) {
  const userAgent = env.WEATHER_FUSION_USER_AGENT || 'Sun-Nourie-WhatsUp/1.0 (https://github.com/nourie42/Sun-Nourie)';
  const cache = new Map();

  async function request(url, { timeout = 12000, accept = 'application/json' } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || !ALLOWED.has(parsed.hostname)) {
      throw trackerError('Unexpected source URL.', 502, 'source');
    }
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent, Accept: accept },
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw trackerError(`Source returned HTTP ${response.status}.`, response.status === 404 ? 404 : 502, 'source');
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 2500000) throw trackerError('Source payload exceeded the safety limit.', 502, 'source');
    return JSON.parse(raw);
  }

  async function cached(key, ttl, load) {
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.value;
    const value = await load();
    cache.set(key, { value, expires: now() + ttl });
    if (cache.size > 250) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
    return value;
  }

  async function geocodeZip(zip) {
    return cached(`zip:${zip}`, 24 * HOUR, async () => {
      const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${new URLSearchParams({
        address: zip,
        benchmark: 'Public_AR_Current',
        format: 'json',
      })}`;
      try {
        const data = await request(censusUrl, { timeout: 10000 });
        const match = data?.result?.addressMatches?.[0];
        const x = Number(match?.coordinates?.x);
        const y = Number(match?.coordinates?.y);
        if (match && finite(x) && finite(y)) {
          const city = clean(match.addressComponents?.city || match.matchedAddress);
          const state = clean(match.addressComponents?.state);
          return {
            latitude: Number(y.toFixed(4)),
            longitude: Number(x.toFixed(4)),
            name: [city, state, zip].filter(Boolean).join(', '),
            source: 'U.S. Census geocoder',
          };
        }
      } catch (error) {
        if (error.status === 400) throw error;
      }

      try {
        const tigerUrl = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/8/query?${new URLSearchParams({
          where: `ZCTA5='${zip}'`,
          outFields: 'ZCTA5,NAME',
          returnGeometry: 'true',
          outSR: '4326',
          f: 'json',
        })}`;
        const tiger = await request(tigerUrl, { timeout: 10000 });
        const feature = tiger?.features?.[0];
        const extent = tiger?.features?.[0] ? feature?.attributes : null;
        const rings = feature?.geometry?.rings?.[0];
        if (Array.isArray(rings) && rings.length) {
          const xs = rings.map((p) => p[0]).filter(finite);
          const ys = rings.map((p) => p[1]).filter(finite);
          if (xs.length && ys.length) {
            const longitude = (Math.min(...xs) + Math.max(...xs)) / 2;
            const latitude = (Math.min(...ys) + Math.max(...ys)) / 2;
            return {
              latitude: Number(latitude.toFixed(4)),
              longitude: Number(longitude.toFixed(4)),
              name: `${clean(extent?.NAME) || 'ZIP'} ${zip}`.trim(),
              source: 'U.S. Census TIGERweb ZCTA',
            };
          }
        }
      } catch {
        /* try public ZIP fallback next */
      }

      try {
        const zippo = await request(`https://api.zippopotam.us/us/${zip}`, { timeout: 8000 });
        const place = zippo?.places?.[0];
        const latitude = Number(place?.latitude);
        const longitude = Number(place?.longitude);
        if (finite(latitude) && finite(longitude)) {
          return {
            latitude: Number(latitude.toFixed(4)),
            longitude: Number(longitude.toFixed(4)),
            name: [clean(place['place name']), clean(place['state abbreviation']), zip].filter(Boolean).join(', '),
            source: 'Zippopotam.us (Census geocoder unavailable)',
          };
        }
      } catch {
        /* handled below */
      }

      throw trackerError('That ZIP was not found, or the location service is unavailable.', 404, 'geocode');
    });
  }

  async function nwsJson(url, label) {
    try {
      return await cached(url, 2 * 60 * 1000, () => request(url, { timeout: 12000 }));
    } catch (error) {
      throw trackerError(`${label} is unavailable. ${clean(error.message, 80)}`, error.status === 404 ? 404 : 503, 'nws');
    }
  }

  async function loadFusion(place) {
    if (typeof getForecast !== 'function') return null;
    try {
      return await Promise.race([
        getForecast({ latitude: place.latitude, longitude: place.longitude }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('fusion-timeout')), fusionTimeoutMs);
        }),
      ]);
    } catch {
      return null;
    }
  }

  async function getTracker(query = {}) {
    const zip = normalizeZip(query.zip);
    if (!zip) throw trackerError('Use a 5-digit U.S. ZIP code.', 400, 'zip');
    const geo = await geocodeZip(zip);
    if (geo.latitude < 24 || geo.latitude > 50 || geo.longitude < -125 || geo.longitude > -66) {
      throw trackerError('This tracker currently covers the contiguous United States.', 400, 'zip');
    }
    const point = await nwsJson(`https://api.weather.gov/points/${geo.latitude},${geo.longitude}`, 'NWS location lookup');
    const properties = point?.properties;
    if (!properties?.forecastHourly || !properties?.forecast) {
      throw trackerError('NWS does not have a forecast point for this ZIP.', 404, 'nws');
    }
    const place = {
      ...geo,
      timeZone: properties.timeZone || 'America/New_York',
      office: properties.cwa || null,
      name: geo.name || [properties.relativeLocation?.properties?.city, properties.relativeLocation?.properties?.state, zip].filter(Boolean).join(', '),
    };
    const [hourly, forecast, fusion] = await Promise.all([
      nwsJson(properties.forecastHourly, 'NWS hourly forecast'),
      nwsJson(properties.forecast, 'NWS period forecast'),
      loadFusion(place),
    ]);
    const hourlyPeriods = hourly?.properties?.periods;
    const periodForecasts = forecast?.properties?.periods;
    if (!Array.isArray(hourlyPeriods) || !hourlyPeriods.length) {
      throw trackerError('The National Weather Service hourly forecast is unavailable. Retry shortly.', 503, 'nws');
    }
    return buildTrackerView({
      zip,
      place,
      hourlyPeriods,
      periodForecasts: Array.isArray(periodForecasts) ? periodForecasts : [],
      fusion,
      now: now(),
    });
  }

  return { getTracker, geocodeZip };
}

export function registerWhatsUpRoutes(app, options = {}) {
  const service = createWhatsUpService(options);
  const sendPage = (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  };
  app.get(['/whats-up', '/whats-up/'], sendPage);
  app.get('/whatsup', (_req, res) => res.redirect(302, '/whats-up'));
  app.get('/whats-up/tracker.js', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/javascript');
    res.sendFile(path.join(PUBLIC_DIR, 'tracker.js'));
  });
  app.get('/whats-up/tracker.css', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/css');
    res.sendFile(path.join(PUBLIC_DIR, 'tracker.css'));
  });
  app.get('/api/whats-up/tracker', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      return res.json(await service.getTracker(req.query || {}));
    } catch (error) {
      const status = error.status || 503;
      return res.status(status).json({
        error: error.message || 'Weather data is temporarily unavailable. Please retry.',
        code: error.code || 'source',
      });
    }
  });
  return service;
}
