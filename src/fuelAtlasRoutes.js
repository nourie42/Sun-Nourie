const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_LIMIT = 160;
const MIN_DETAIL_ZOOM = 7;
const MAX_LAT_SPAN = 9;
const MAX_LON_SPAN = 15;
const MAX_BBOX_AREA = 110;
const MAX_RESULTS = 2500;
const OVERPASS_TIMEOUT_MS = 12000;
const PROVIDER_STAGGER_MS = 350;
const FRS_TIMEOUT_MS = 9000;
const USER_AGENT = "FuelIQ-Fuel-Atlas/1.3 (+https://github.com/nourie42/Sun-Nourie)";

const DEFAULT_OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const FRS_ENDPOINT = "https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities";
const FRS_TERMS = ["heating oil", "fuel oil", "fuel distributor", "petroleum", "propane", "bulk plant", "terminal"];

const TARGET_INDUSTRIAL = /^(oil|petroleum|fuel|tank_farm|oil_storage|petroleum_storage|fuel_storage|bulk_plant|fuel_terminal|oil_terminal|terminal|depot)$/i;
const TARGET_STORAGE = /^(fuel|fuel_oil|heating_oil|oil|petroleum|diesel|gasoline|kerosene|propane|lpg)$/i;
const TARGET_TEXT = /\b(heating[ _-]?oil|fuel[ _-]?oil|fuel distributor|petroleum distributor|oil company|petroleum|propane|\blpg\b|bulk[ _-]?plant|bulk fuel|tank[ _-]?farm|storage terminal|fuel terminal|oil terminal|fuel depot|oil depot)\b/i;
const RETAIL_TEXT = /\b(gas station|service station|filling station|travel center|truck stop|convenience store|c-store|car wash|oil change|lube shop|quick lube)\b/i;

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

async function timedFetch(url, init = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { signal: _ignoredSignal, ...requestInit } = init;
  try {
    return await fetch(url, { ...requestInit, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      message: "Zoom in to a state or metro area before searching the detailed distributor layer.",
      minimumZoom: MIN_DETAIL_ZOOM,
      latSpan,
      lonSpan,
      area,
    };
  }
  return { ok: true, south, west, north, east, zoom: requestedZoom, latSpan, lonSpan, area };
}

function tagText(tags = {}) {
  return [
    tags.name, tags.operator, tags["operator:name"], tags.owner, tags["owner:name"], tags.brand,
    tags.description, tags.product, tags.products, tags.content, tags.substance, tags.storage,
    tags.shop, tags.industrial, tags.office, tags.landuse, tags.building, tags["fuel_iq:matched_term"],
  ].filter(Boolean).join(" ");
}

export function isTargetFuelFacility(element = {}) {
  const tags = element.tags || {};
  const amenity = clean(tags.amenity, 80).toLowerCase();
  const shop = clean(tags.shop, 80).toLowerCase();
  const text = tagText(tags);
  if (amenity === "fuel") return false;
  if (["fuel", "gas", "convenience", "supermarket"].includes(shop)) return false;
  if (RETAIL_TEXT.test(text)) return false;
  if (shop === "heating_oil") return true;
  if (TARGET_INDUSTRIAL.test(clean(tags.industrial, 100))) return true;
  if (clean(tags.landuse, 100).toLowerCase() === "industrial" && TARGET_TEXT.test(text)) return true;
  if (/^(industrial|warehouse)$/i.test(clean(tags.building, 100)) && TARGET_TEXT.test(text)) return true;
  const storedMaterial = clean(tags.content || tags.substance || tags.storage, 120);
  const identifiedFacility = Boolean(tags.name || tags.operator || tags["operator:name"] || tags.owner || tags["owner:name"]);
  if (clean(tags.man_made, 100).toLowerCase() === "storage_tank" && TARGET_STORAGE.test(storedMaterial) && identifiedFacility) return true;
  if (TARGET_STORAGE.test(clean(tags.storage, 120)) && identifiedFacility) return true;
  const office = /^(company|logistics)$/i.test(clean(tags.office, 100));
  return office && TARGET_TEXT.test(text);
}

export function buildFuelAtlasQuery(bounds) {
  const box = [bounds.south, bounds.west, bounds.north, bounds.east].map((value) => Number(value).toFixed(5)).join(",");
  const businessTerms = "heating[ _-]?oil|fuel[ _-]?oil|fuel distributor|petroleum distributor|oil company|petroleum|propane|lpg|bulk[ _-]?plant|bulk fuel|tank[ _-]?farm|storage terminal|fuel terminal|oil terminal|fuel depot|oil depot";
  const storageTerms = "fuel|fuel_oil|heating_oil|oil|petroleum|diesel|gasoline|kerosene|propane|lpg";
  return `[out:json][timeout:12];(
  nwr["shop"="heating_oil"](${box});
  nwr["industrial"~"^(oil|petroleum|fuel|tank_farm|oil_storage|petroleum_storage|fuel_storage|bulk_plant|fuel_terminal|oil_terminal|terminal|depot)$",i](${box});
  nwr["landuse"="industrial"]["name"~"(${businessTerms})",i](${box});
  nwr["building"~"^(industrial|warehouse)$"]["name"~"(${businessTerms})",i](${box});
  nwr["office"~"^(company|logistics)$"]["name"~"(${businessTerms})",i](${box});
  nwr["office"~"^(company|logistics)$"]["operator"~"(${businessTerms})",i](${box});
  nwr["office"~"^(company|logistics)$"]["description"~"(heating[ _-]?oil|fuel[ _-]?oil|petroleum|propane|bulk[ _-]?plant|terminal|distribut|wholesal)",i](${box});
  nwr["man_made"="storage_tank"]["content"~"^(${storageTerms})$",i]["operator"](${box});
  nwr["man_made"="storage_tank"]["substance"~"^(${storageTerms})$",i]["operator"](${box});
  nwr["man_made"="storage_tank"]["content"~"^(${storageTerms})$",i]["name"](${box});
  nwr["man_made"="storage_tank"]["substance"~"^(${storageTerms})$",i]["name"](${box});
);out body center qt ${MAX_RESULTS};`;
}

function overpassEndpoints() {
  const configured = clean(process.env.FUEL_ATLAS_OVERPASS_URL, 1000);
  return [...new Set([configured, ...DEFAULT_OVERPASS_ENDPOINTS].filter(Boolean))];
}

async function fetchOverpassEndpoint(endpoint, query, signal) {
  const response = await timedFetch(endpoint, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": USER_AGENT },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  }, OVERPASS_TIMEOUT_MS);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("The map source returned a non-JSON response."); }
  if (!Array.isArray(data.elements)) throw new Error("The map source returned an invalid result.");
  return { elements: data.elements, source: "OpenStreetMap / Overpass", endpoint };
}

async function fetchOverpass(query) {
  const failures = [];
  const sharedController = new AbortController();
  const attempts = overpassEndpoints().map((endpoint, index) => (async () => {
    if (index) await delay(index * PROVIDER_STAGGER_MS);
    if (sharedController.signal.aborted) throw Object.assign(new Error("Request cancelled"), { name: "AbortError" });
    try {
      return await fetchOverpassEndpoint(endpoint, query, sharedController.signal);
    } catch (error) {
      if (!(sharedController.signal.aborted && error?.name === "AbortError")) failures.push(`${endpoint}: ${clean(error?.message || error, 240)}`);
      throw error;
    }
  })());
  try {
    const result = await Promise.any(attempts);
    sharedController.abort();
    return result;
  } catch {
    sharedController.abort();
    const error = new Error("All OpenStreetMap providers failed for this request.");
    error.failures = failures;
    throw error;
  }
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(a));
}

function frsSearchGeometry(bounds) {
  const latitude = (bounds.south + bounds.north) / 2;
  const longitude = (bounds.west + bounds.east) / 2;
  const farthest = Math.max(
    distanceMiles(latitude, longitude, bounds.south, bounds.west),
    distanceMiles(latitude, longitude, bounds.south, bounds.east),
    distanceMiles(latitude, longitude, bounds.north, bounds.west),
    distanceMiles(latitude, longitude, bounds.north, bounds.east),
  );
  return { latitude, longitude, radius: Math.min(25, Math.max(3, Math.ceil(farthest))) };
}

function arrayify(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function pointInsideBounds(lat, lon, bounds) {
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
}

function frsIndustrialValue(term) {
  if (/bulk/i.test(term)) return "bulk_plant";
  if (/terminal/i.test(term)) return "terminal";
  if (/propane/i.test(term)) return "fuel";
  return "petroleum";
}

export function frsFacilityToElement(facility = {}, matchedTerm = "petroleum", bounds = null) {
  const lat = Number(facility.Latitude83);
  const lon = Number(facility.Longitude83);
  const name = clean(facility.FacilityName, 300);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return null;
  if (bounds && !pointInsideBounds(lat, lon, bounds)) return null;
  if (RETAIL_TEXT.test(name)) return null;
  const registryId = clean(facility.RegistryId, 80) || `${lat}-${lon}-${name}`;
  const sourceUrl = `${FRS_ENDPOINT}?registry_id=${encodeURIComponent(registryId)}&output=JSON`;
  return {
    type: "frs",
    id: registryId,
    lat,
    lon,
    source_name: "EPA Facility Registry Service",
    source_url: sourceUrl,
    tags: {
      name,
      industrial: frsIndustrialValue(matchedTerm),
      description: `EPA FRS facility matched by ${matchedTerm}`,
      "fuel_iq:matched_term": matchedTerm,
      "addr:full": clean(facility.LocationAddress, 400),
      "addr:city": clean(facility.CityName, 160),
      "addr:state": clean(facility.StateAbbr, 20),
      "addr:postcode": clean(facility.ZipCode, 30),
      "fuel_iq:registry_id": registryId,
    },
  };
}

async function fetchFrsTerm(term, bounds) {
  const geometry = frsSearchGeometry(bounds);
  const url = new URL(FRS_ENDPOINT);
  url.searchParams.set("facility_name", term);
  url.searchParams.set("latitude83", geometry.latitude.toFixed(6));
  url.searchParams.set("longitude83", geometry.longitude.toFixed(6));
  url.searchParams.set("search_radius", String(geometry.radius));
  url.searchParams.set("output", "JSON");
  const response = await timedFetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } }, FRS_TIMEOUT_MS);
  if (!response.ok) throw new Error(`EPA FRS HTTP ${response.status}`);
  const data = await response.json();
  return arrayify(data?.Results?.FRSFacility).map((facility) => frsFacilityToElement(facility, term, bounds)).filter(Boolean);
}

async function fetchFrs(bounds) {
  const settled = await Promise.allSettled(FRS_TERMS.map((term) => fetchFrsTerm(term, bounds)));
  const elements = [];
  const failures = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") elements.push(...result.value);
    else failures.push(`${FRS_TERMS[index]}: ${clean(result.reason?.message || result.reason, 200)}`);
  });
  if (settled.every((result) => result.status === "rejected")) {
    const error = new Error("EPA Facility Registry Service did not respond.");
    error.failures = failures;
    throw error;
  }
  return { elements, source: "EPA Facility Registry Service", failures, coverageRadiusMi: frsSearchGeometry(bounds).radius };
}

function elementCenter(element) {
  const center = element.center || element;
  return { lat: Number(center.lat), lon: Number(center.lon) };
}

function elementName(element) {
  return clean(element.tags?.name || element.tags?.operator || element.tags?.owner, 300).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function elementScore(element) {
  const tags = element.tags || {};
  return [tags.name, tags.owner, tags.operator, tags.phone, tags.email, tags.website, tags["addr:full"], tags["addr:city"], tags["addr:state"]].filter(Boolean).length;
}

function dedupeElements(elements) {
  const byId = new Map();
  for (const element of elements) {
    const key = `${element.type || "feature"}:${element.id || JSON.stringify(elementCenter(element))}`;
    if (!byId.has(key) || elementScore(element) > elementScore(byId.get(key))) byId.set(key, element);
  }
  const byFacility = new Map();
  for (const element of byId.values()) {
    const { lat, lon } = elementCenter(element);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = elementName(element) || "unnamed";
    const key = `${name}|${Math.round(lat * 500)}|${Math.round(lon * 500)}`;
    const prior = byFacility.get(key);
    if (!prior || elementScore(element) > elementScore(prior)) byFacility.set(key, element);
  }
  return [...byFacility.values()];
}

export async function searchFuelAtlasSources(bounds) {
  const query = buildFuelAtlasQuery(bounds);
  const settled = await Promise.allSettled([fetchOverpass(query), fetchFrs(bounds)]);
  const elements = [];
  const sources = [];
  const warnings = [];
  let truncated = false;
  let frsCoverageRadiusMi = null;
  settled.forEach((result, index) => {
    const sourceName = index === 0 ? "OpenStreetMap / Overpass" : "EPA Facility Registry Service";
    if (result.status === "fulfilled") {
      elements.push(...result.value.elements);
      sources.push(result.value.source || sourceName);
      if (index === 0) truncated = result.value.elements.length >= MAX_RESULTS;
      if (index === 1) {
        frsCoverageRadiusMi = result.value.coverageRadiusMi;
        warnings.push(...result.value.failures);
      }
    } else {
      warnings.push(`${sourceName}: ${clean(result.reason?.message || result.reason, 240)}`);
    }
  });
  if (!sources.length) {
    const error = new Error("All distributor-location sources failed for this request.");
    error.failures = warnings;
    throw error;
  }
  return {
    elements: dedupeElements(elements.filter(isTargetFuelFacility)),
    sources: [...new Set(sources)],
    warnings,
    truncated,
    frsCoverageRadiusMi,
  };
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
    bounds: Array.isArray(result.bounds) && result.bounds.length === 4 ? result.bounds.map(Number).filter(Number.isFinite) : null,
    provider: clean(result.provider || "Public geocoder", 100),
  };
}

async function geocodeGoogle(query, apiKey) {
  if (!apiKey) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("key", apiKey);
  const response = await timedFetch(url, { headers: { Accept: "application/json" } }, 15000);
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
    bounds: viewport ? [viewport.southwest?.lat, viewport.northeast?.lat, viewport.southwest?.lng, viewport.northeast?.lng] : null,
    provider: "Google Geocoding",
  });
}

async function geocodeCensus(query) {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", query);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const response = await timedFetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } }, 12000);
  if (!response.ok) throw new Error(`Census geocoder HTTP ${response.status}`);
  const data = await response.json();
  const match = data?.result?.addressMatches?.[0];
  if (!match?.coordinates) return null;
  return normalizeGeocodeResult({ lat: match.coordinates.y, lon: match.coordinates.x, label: match.matchedAddress || query, provider: "U.S. Census Geocoder" });
}

async function geocodeNominatim(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("q", query);
  const response = await timedFetch(url, { headers: { Accept: "application/json", "Accept-Language": "en-US,en;q=0.8", "User-Agent": USER_AGENT } }, 12000);
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const data = await response.json();
  const item = data?.[0];
  if (!item) return null;
  const bbox = Array.isArray(item.boundingbox) ? item.boundingbox.map(Number) : null;
  return normalizeGeocodeResult({ lat: item.lat, lon: item.lon, label: item.display_name, bounds: bbox?.length === 4 ? [bbox[0], bbox[1], bbox[2], bbox[3]] : null, provider: "OpenStreetMap Nominatim" });
}

async function geocodePlace(query, googleApiKey) {
  const attempts = [() => geocodeGoogle(query, googleApiKey), () => geocodeCensus(query), () => geocodeNominatim(query)];
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
    const key = [bounds.south, bounds.west, bounds.north, bounds.east].map((value) => Number(value).toFixed(3)).join(",");
    const cached = cacheGet(searchCache, key);
    if (cached) {
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=600");
      return res.json({ ...cached, cached: true });
    }
    try {
      const result = await searchFuelAtlasSources(bounds);
      const payload = {
        ok: true,
        cached: false,
        source: result.sources.join(" + "),
        sources: result.sources,
        warnings: result.warnings,
        partial: result.warnings.length > 0,
        fetchedAt: new Date().toISOString(),
        truncated: result.truncated,
        frsCoverageRadiusMi: result.frsCoverageRadiusMi,
        elements: result.elements,
      };
      cacheSet(searchCache, key, payload, SEARCH_CACHE_TTL_MS);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=600");
      return res.json(payload);
    } catch (error) {
      console.error("Fuel Atlas multi-source search failed:", error.failures || error);
      return res.status(502).json({
        ok: false,
        code: "PUBLIC_MAP_UNAVAILABLE",
        message: "Distributor-location sources are temporarily unavailable. Please retry this metro area.",
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
