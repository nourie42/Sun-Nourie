const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_LIMIT = 160;
const MIN_DETAIL_ZOOM = 7;
const MAX_LAT_SPAN = 9;
const MAX_LON_SPAN = 15;
const MAX_BBOX_AREA = 110;
const MAX_RESULTS = 2500;
const USER_AGENT = "FuelIQ-Fuel-Atlas/1.1 (+https://github.com/nourie42/Sun-Nourie)";

const DEFAULT_OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

const searchCache = new Map();
const geocodeCache = new Map();

function clean(value, max = 500) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function cacheGet(cache, key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt > Date.now()) return hit.value;
  cache.delete(key);
  return null;
}

function cacheSet(cache, key, value, ttlMs) {
  if (cache.has(key)) cache.delete(key);
  while (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function timedFetch(url, init = {}, timeoutMs = 35000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function numberParam(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseFuelAtlasBounds(query = {}) {
  const south = numberParam(query.south);
  const west = numberParam(query.west);
  const north = numberParam(query.north);
  const east = numberParam(query.east);
  const zoom = numberParam(query.zoom);

  if ([south, west, north, east].some((value) => value == null)) {
    return { ok: false, status: 400, code: "INVALID_BOUNDS", message: "south, west, north, and east are required." };
  }
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) {
    return { ok: false, status: 400, code: "INVALID_BOUNDS", message: "The requested map bounds are invalid." };
  }

  const latSpan = north - south;
  const lonSpan = east - west;
  const area = latSpan * lonSpan;
  const requestedZoom = zoom == null ? 0 : zoom;
  if (requestedZoom < MIN_DETAIL_ZOOM || latSpan > MAX_LAT_SPAN || lonSpan > MAX_LON_SPAN || area > MAX_BBOX_AREA) {
    return {
      ok: false,
      status: 422,
      code: "AREA_TOO_LARGE",
      message: "Zoom in to a state or metro area before searching the detailed public-source layer.",
      minimumZoom: MIN_DETAIL_ZOOM,
      latSpan,
      lonSpan,
      area,
    };
  }

  return { ok: true, south, west, north, east, zoom: requestedZoom, latSpan, lonSpan, area };
}

export function buildFuelAtlasQuery(bounds) {
  const box = [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((value) => Number(value).toFixed(5))
    .join(",");

  return `[out:json][timeout:32];
(
  nwr["industrial"~"^(oil|petroleum|fuel|tank_farm|storage)$",i](${box});
  nwr["landuse"="industrial"]["name"~"(fuel|heating oil|fuel oil|oil company|petroleum|propane|terminal|bulk|energy)",i](${box});
  nwr["man_made"="storage_tank"]["content"~"(fuel|oil|petroleum|diesel|gasoline|propane|lpg)",i](${box});
  nwr["storage"~"^(oil|fuel|gas|petroleum|propane)$",i](${box});
  nwr["shop"~"^(fuel|heating_oil|gas)$",i](${box});
  nwr["office"]["name"~"(fuel|heating oil|fuel oil|oil company|petroleum|propane|energy)",i](${box});
  nwr["amenity"="fuel"]["access"~"^(private|customers|permit)$",i](${box});
  nwr["amenity"="fuel"]["hgv"="yes"]["name"~"(fleet|commercial|cardlock|bulk|terminal|fuel|oil|petroleum|propane)",i](${box});
);
out body center qt ${MAX_RESULTS};`;
}

function overpassEndpoints() {
  const configured = clean(process.env.FUEL_ATLAS_OVERPASS_URL, 1000);
  return [...new Set([configured, ...DEFAULT_OVERPASS_ENDPOINTS].filter(Boolean))];
}

async function fetchOverpass(query) {
  const failures = [];
  for (const endpoint of overpassEndpoints()) {
    try {
      const response = await timedFetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
      }, 38000);

      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("The map source returned a non-JSON response.");
      }
      if (!Array.isArray(data.elements)) throw new Error("The map source returned an invalid result.");
      return { elements: data.elements, endpoint };
    } catch (error) {
      failures.push(`${endpoint}: ${clean(error?.message || error, 240)}`);
    }
  }

  const error = new Error("All public map providers failed for this request.");
  error.failures = failures;
  throw error;
}

function normalizeGeocodeResult(result) {
  if (!result) return null;
  const lat = Number(result.lat);
  const lon = Number(result.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    label: clean(result.label || result.display_name || `${lat}, ${lon}`, 700),
    bounds: Array.isArray(result.bounds) && result.bounds.length === 4
      ? result.bounds.map(Number).filter(Number.isFinite)
      : null,
    provider: clean(result.provider || "Public geocoder", 100),
  };
}

async function geocodeGoogle(query, apiKey) {
  if (!apiKey) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("key", apiKey);
  const response = await timedFetch(url, { headers: { Accept: "application/json" } }, 20000);
  if (!response.ok) throw new Error(`Google geocoder HTTP ${response.status}`);
  const data = await response.json();
  if (!["OK", "ZERO_RESULTS"].includes(data.status)) throw new Error(`Google geocoder ${data.status}`);
  const item = data.results?.[0];
  if (!item) return null;
  const location = item.geometry?.location;
  const viewport = item.geometry?.viewport;
  return normalizeGeocodeResult({
    lat: location?.lat,
    lon: location?.lng,
    label: item.formatted_address,
    bounds: viewport
      ? [viewport.southwest?.lat, viewport.northeast?.lat, viewport.southwest?.lng, viewport.northeast?.lng]
      : null,
    provider: "Google Geocoding",
  });
}

async function geocodeCensus(query) {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", query);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const response = await timedFetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } }, 18000);
  if (!response.ok) throw new Error(`Census geocoder HTTP ${response.status}`);
  const data = await response.json();
  const match = data?.result?.addressMatches?.[0];
  if (!match?.coordinates) return null;
  return normalizeGeocodeResult({
    lat: match.coordinates.y,
    lon: match.coordinates.x,
    label: match.matchedAddress || query,
    provider: "U.S. Census Geocoder",
  });
}

async function geocodeNominatim(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("q", query);
  const response = await timedFetch(url, {
    headers: { Accept: "application/json", "Accept-Language": "en-US,en;q=0.8", "User-Agent": USER_AGENT },
  }, 18000);
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const data = await response.json();
  const item = data?.[0];
  if (!item) return null;
  const bbox = Array.isArray(item.boundingbox) ? item.boundingbox.map(Number) : null;
  return normalizeGeocodeResult({
    lat: item.lat,
    lon: item.lon,
    label: item.display_name,
    bounds: bbox?.length === 4 ? [bbox[0], bbox[1], bbox[2], bbox[3]] : null,
    provider: "OpenStreetMap Nominatim",
  });
}

async function geocodePlace(query, googleApiKey) {
  const attempts = [
    () => geocodeGoogle(query, googleApiKey),
    () => geocodeCensus(query),
    () => geocodeNominatim(query),
  ];
  const failures = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result) return result;
    } catch (error) {
      failures.push(clean(error?.message || error, 240));
    }
  }
  const error = new Error("No matching U.S. location was found.");
  error.failures = failures;
  throw error;
}

export function registerFuelAtlasRoutes(app, { googleApiKey = "" } = {}) {
  app.get("/api/fuel-atlas/search", async (req, res) => {
    const bounds = parseFuelAtlasBounds(req.query);
    if (!bounds.ok) return res.status(bounds.status).json(bounds);

    const key = [bounds.south, bounds.west, bounds.north, bounds.east]
      .map((value) => Number(value).toFixed(3))
      .join(",");
    const cached = cacheGet(searchCache, key);
    if (cached) {
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=600");
      return res.json({ ...cached, cached: true });
    }

    try {
      const query = buildFuelAtlasQuery(bounds);
      const result = await fetchOverpass(query);
      const payload = {
        ok: true,
        cached: false,
        source: "OpenStreetMap contributors via Overpass",
        fetchedAt: new Date().toISOString(),
        truncated: result.elements.length >= MAX_RESULTS,
        elements: result.elements,
      };
      cacheSet(searchCache, key, payload, SEARCH_CACHE_TTL_MS);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=600");
      return res.json(payload);
    } catch (error) {
      console.error("Fuel Atlas Overpass search failed:", error.failures || error);
      return res.status(502).json({
        ok: false,
        code: "PUBLIC_MAP_UNAVAILABLE",
        message: "The public fuel-location source is temporarily unavailable. Please retry or search a smaller nearby area.",
      });
    }
  });

  app.get("/api/fuel-atlas/geocode", async (req, res) => {
    const query = clean(req.query.q, 160);
    if (query.length < 2) return res.status(400).json({ ok: false, code: "QUERY_REQUIRED", message: "Enter a city, state, ZIP code, or address." });

    const key = query.toLowerCase();
    const cached = cacheGet(geocodeCache, key);
    if (cached) return res.json({ ok: true, cached: true, result: cached });

    try {
      const result = await geocodePlace(query, googleApiKey);
      cacheSet(geocodeCache, key, result, GEOCODE_CACHE_TTL_MS);
      return res.json({ ok: true, cached: false, result });
    } catch (error) {
      console.warn("Fuel Atlas geocode failed:", error.failures || error);
      return res.status(404).json({ ok: false, code: "LOCATION_NOT_FOUND", message: "No matching U.S. location was found." });
    }
  });
}
