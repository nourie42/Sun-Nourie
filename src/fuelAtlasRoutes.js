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
const ECHO_TIMEOUT_MS = 12000;
const USER_AGENT = "FuelIQ-Fuel-Atlas/2.0 (+https://github.com/nourie42/Sun-Nourie)";
const FILTER_VERSION = "verified-distributors-v2";

const DEFAULT_OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const ECHO_QUERY_ENDPOINT = "https://echogeo.epa.gov/arcgis/rest/services/ECHO/Facilities/MapServer/0/query";

const DISTRIBUTOR_NAICS = new Set(["424710", "424720", "454310", "457210"]);
const RETAIL_NAICS = new Set(["447110", "447190", "457110", "457120"]);
const EXPLICIT_ROLE_TEXT = /\b(distribut(?:or|ors|ion|ions|ing)?|wholesal(?:e|er|ing)?|bulk(?:\s+(?:plant|station|fuel))?|terminal|depot|tank\s*farm|storage\s+terminal|heating[ _-]?oil|fuel[ _-]?oil|home\s+heating|propane|\blpg\b|card\s*lock)\b/i;
const RETAIL_OR_UNRELATED_TEXT = /\b(gas\s+station|service\s+station|filling\s+station|fuel\s+center|travel\s+center|truck\s+stop|travel\s+plaza|truck\s+plaza|convenience|c-?store|food\s+mart|petro\s+mart|mini\s+mart|quick\s+mart|\bmart\b|retail|car\s+wash|oil\s+change|lube\s+shop|quick\s+lube|treatment\s+plant|wastewater|sewage|water\s+treatment|remediation|cleanup|spill\s+site|landfill|power\s+plant|generating\s+station|school|hospital)\b/i;
const HIGH_CONFIDENCE_INDUSTRIAL = /^(bulk_plant|fuel_terminal|oil_terminal|tank_farm|oil_storage|petroleum_storage|fuel_storage|depot)$/i;
const GENERIC_INDUSTRIAL = /^(oil|petroleum|fuel|storage|terminal)$/i;
const STORAGE_PRODUCTS = /^(fuel|fuel_oil|heating_oil|oil|petroleum|diesel|gasoline|kerosene|propane|lpg)$/i;

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
      message: "Zoom in to a state or metro area before searching the verified distributor layer.",
      minimumZoom: MIN_DETAIL_ZOOM,
      latSpan,
      lonSpan,
      area,
    };
  }
  return { ok: true, south, west, north, east, zoom: requestedZoom, latSpan, lonSpan, area };
}

export function parseNaicsCodes(value) {
  return [...new Set((String(value || "").match(/\b\d{6}\b/g) || []))];
}

function hasCode(codes, accepted) {
  return codes.some((code) => accepted.has(code));
}

function tagText(tags = {}) {
  return [
    tags.name, tags.operator, tags["operator:name"], tags.owner, tags["owner:name"], tags.brand,
    tags.description, tags.product, tags.products, tags.content, tags.substance, tags.storage,
    tags.shop, tags.industrial, tags.office, tags.landuse, tags.building, tags["fuel_iq:qualification"],
  ].filter(Boolean).join(" ");
}

function isClearlyRetailOrUnrelated(tags = {}) {
  const amenity = clean(tags.amenity, 80).toLowerCase();
  const shop = clean(tags.shop, 80).toLowerCase();
  const text = tagText(tags);
  if (amenity === "fuel") return true;
  if (["fuel", "gas", "convenience", "supermarket"].includes(shop)) return true;
  return RETAIL_OR_UNRELATED_TEXT.test(text);
}

export function isTargetFuelFacility(element = {}) {
  const tags = element.tags || {};
  if (isClearlyRetailOrUnrelated(tags)) return false;

  const codes = parseNaicsCodes(tags["fuel_iq:naics_codes"] || tags.naics || tags["naics:code"]);
  if (codes.length) {
    if (!hasCode(codes, DISTRIBUTOR_NAICS)) return false;
    if (hasCode(codes, RETAIL_NAICS) && !EXPLICIT_ROLE_TEXT.test(tagText(tags))) return false;
    return true;
  }

  const nameOrOperator = Boolean(tags.name || tags.operator || tags["operator:name"] || tags.owner || tags["owner:name"]);
  const text = tagText(tags);
  const shop = clean(tags.shop, 80).toLowerCase();
  const industrial = clean(tags.industrial, 100);
  if (shop === "heating_oil" && nameOrOperator) return true;
  if (HIGH_CONFIDENCE_INDUSTRIAL.test(industrial) && nameOrOperator) return true;
  if (GENERIC_INDUSTRIAL.test(industrial) && nameOrOperator && EXPLICIT_ROLE_TEXT.test(text)) return true;
  if (clean(tags.landuse, 100).toLowerCase() === "industrial" && nameOrOperator && EXPLICIT_ROLE_TEXT.test(text)) return true;
  if (/^(industrial|warehouse)$/i.test(clean(tags.building, 100)) && nameOrOperator && EXPLICIT_ROLE_TEXT.test(text)) return true;

  const storedMaterial = clean(tags.content || tags.substance || tags.storage, 120);
  if (clean(tags.man_made, 100).toLowerCase() === "storage_tank"
      && STORAGE_PRODUCTS.test(storedMaterial)
      && nameOrOperator
      && EXPLICIT_ROLE_TEXT.test(text)) return true;

  const office = /^(company|logistics)$/i.test(clean(tags.office, 100));
  return office && nameOrOperator && EXPLICIT_ROLE_TEXT.test(text);
}

export function buildFuelAtlasQuery(bounds) {
  const box = [bounds.south, bounds.west, bounds.north, bounds.east].map((value) => Number(value).toFixed(5)).join(",");
  const roleTerms = "distribut|wholesal|bulk[ _-]?(plant|station|fuel)|terminal|depot|tank[ _-]?farm|heating[ _-]?oil|fuel[ _-]?oil|home[ _-]?heating|propane|lpg|card[ _-]?lock";
  const industrialTerms = "bulk_plant|fuel_terminal|oil_terminal|tank_farm|oil_storage|petroleum_storage|fuel_storage|depot";
  return `[out:json][timeout:12];(
  nwr["shop"="heating_oil"]["name"](${box});
  nwr["industrial"~"^(${industrialTerms})$",i](${box});
  nwr["industrial"~"^(oil|petroleum|fuel|storage|terminal)$",i]["name"~"(${roleTerms})",i](${box});
  nwr["landuse"="industrial"]["name"~"(${roleTerms})",i](${box});
  nwr["building"~"^(industrial|warehouse)$",i]["name"~"(${roleTerms})",i](${box});
  nwr["office"~"^(company|logistics)$",i]["name"~"(${roleTerms})",i](${box});
  nwr["office"~"^(company|logistics)$",i]["operator"~"(${roleTerms})",i](${box});
  nwr["office"~"^(company|logistics)$",i]["description"~"(${roleTerms})",i](${box});
  nwr["man_made"="storage_tank"]["name"~"(${roleTerms})",i](${box});
  nwr["man_made"="storage_tank"]["operator"~"(${roleTerms})",i](${box});
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
  return { elements: data.elements.filter(isTargetFuelFacility), source: "OpenStreetMap / Overpass", endpoint };
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

export function buildEchoQueryUrl(bounds, resultOffset = 0) {
  const url = new URL(ECHO_QUERY_ENDPOINT);
  const where = [...DISTRIBUTOR_NAICS]
    .map((code) => `FAC_NAICS_CODES LIKE '%${code}%'`)
    .join(" OR ");
  url.searchParams.set("where", `(${where})`);
  url.searchParams.set("geometry", `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
  url.searchParams.set("geometryType", "esriGeometryEnvelope");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "REGISTRY_ID,FAC_NAME,FAC_STREET,FAC_CITY,FAC_STATE,FAC_ZIP,FAC_LAT,FAC_LONG,FAC_NAICS_CODES,DFR_URL");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("resultOffset", String(resultOffset));
  url.searchParams.set("resultRecordCount", "1000");
  url.searchParams.set("orderByFields", "FAC_NAME");
  url.searchParams.set("f", "json");
  return url;
}

function pointInsideBounds(lat, lon, bounds) {
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
}

function echoFacilityType(name, codes) {
  if (/propane|\blpg\b/i.test(name)) return "propane";
  if (/heating[ _-]?oil|fuel[ _-]?oil|home\s+heating/i.test(name) || codes.includes("454310") || codes.includes("457210")) return "heating_oil";
  if (codes.includes("424710")) return /terminal|depot|tank\s*farm/i.test(name) ? "terminal" : "bulk_plant";
  return "distributor";
}

export function echoFeatureToElement(feature = {}, bounds = null) {
  const attrs = feature.attributes || feature.properties || {};
  const geometry = feature.geometry || {};
  const lat = Number(attrs.FAC_LAT ?? geometry.y ?? geometry.coordinates?.[1]);
  const lon = Number(attrs.FAC_LONG ?? geometry.x ?? geometry.coordinates?.[0]);
  const name = clean(attrs.FAC_NAME, 300);
  const codes = parseNaicsCodes(attrs.FAC_NAICS_CODES);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return null;
  if (bounds && !pointInsideBounds(lat, lon, bounds)) return null;
  if (!hasCode(codes, DISTRIBUTOR_NAICS)) return null;
  if (RETAIL_OR_UNRELATED_TEXT.test(name)) return null;
  if (hasCode(codes, RETAIL_NAICS) && !EXPLICIT_ROLE_TEXT.test(name)) return null;

  const matchedCodes = codes.filter((code) => DISTRIBUTOR_NAICS.has(code));
  const facilityType = echoFacilityType(name, matchedCodes);
  const registryId = clean(attrs.REGISTRY_ID, 80) || `${lat}-${lon}-${name}`;
  const sourceUrl = clean(attrs.DFR_URL, 1000)
    || `https://echo.epa.gov/detailed-facility-report?fid=${encodeURIComponent(registryId)}`;
  const industrial = facilityType === "terminal" ? "fuel_terminal"
    : facilityType === "bulk_plant" ? "bulk_plant"
      : facilityType === "propane" ? "fuel"
        : facilityType === "heating_oil" ? "fuel"
          : "petroleum";

  return {
    type: "echo",
    id: registryId,
    lat,
    lon,
    source_name: "EPA ECHO / FRS NAICS",
    source_url: sourceUrl,
    tags: {
      name,
      industrial,
      description: `EPA ECHO facility verified by distributor/fuel-dealer NAICS ${matchedCodes.join(", ")}`,
      "fuel_iq:facility_type": facilityType,
      "fuel_iq:naics_codes": codes.join(","),
      "fuel_iq:qualification": `NAICS ${matchedCodes.join(", ")}`,
      "fuel_iq:source": "EPA ECHO / FRS",
      "addr:full": clean(attrs.FAC_STREET, 400),
      "addr:city": clean(attrs.FAC_CITY, 160),
      "addr:state": clean(attrs.FAC_STATE, 20),
      "addr:postcode": clean(attrs.FAC_ZIP, 30),
      "fuel_iq:registry_id": registryId,
    },
  };
}

async function fetchEchoPage(bounds, resultOffset = 0) {
  const response = await timedFetch(buildEchoQueryUrl(bounds, resultOffset), {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  }, ECHO_TIMEOUT_MS);
  if (!response.ok) throw new Error(`EPA ECHO HTTP ${response.status}`);
  const data = await response.json();
  if (data?.error) throw new Error(`EPA ECHO ${data.error.message || "query error"}`);
  const features = Array.isArray(data?.features) ? data.features : [];
  return {
    elements: features.map((feature) => echoFeatureToElement(feature, bounds)).filter(Boolean),
    exceededTransferLimit: data?.exceededTransferLimit === true,
  };
}

async function fetchEcho(bounds) {
  const first = await fetchEchoPage(bounds, 0);
  let elements = first.elements;
  let truncated = first.exceededTransferLimit;
  if (first.exceededTransferLimit) {
    try {
      const second = await fetchEchoPage(bounds, 1000);
      elements = elements.concat(second.elements);
      truncated = second.exceededTransferLimit;
    } catch (error) {
      return { elements, source: "EPA ECHO / FRS NAICS", failures: [clean(error?.message || error, 240)], truncated: true };
    }
  }
  return { elements, source: "EPA ECHO / FRS NAICS", failures: [], truncated };
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
  return [tags.name, tags.owner, tags.operator, tags.phone, tags.email, tags.website, tags["addr:full"], tags["addr:city"], tags["addr:state"], tags["fuel_iq:naics_codes"]].filter(Boolean).length;
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
  const settled = await Promise.allSettled([fetchOverpass(query), fetchEcho(bounds)]);
  const elements = [];
  const sources = [];
  const warnings = [];
  let truncated = false;
  settled.forEach((result, index) => {
    const sourceName = index === 0 ? "OpenStreetMap / Overpass" : "EPA ECHO / FRS NAICS";
    if (result.status === "fulfilled") {
      elements.push(...result.value.elements);
      sources.push(result.value.source || sourceName);
      truncated ||= result.value.truncated === true || (index === 0 && result.value.elements.length >= MAX_RESULTS);
      warnings.push(...(result.value.failures || []));
    } else {
      warnings.push(`${sourceName}: ${clean(result.reason?.message || result.reason, 240)}`);
    }
  });
  if (!sources.length) {
    const error = new Error("All verified distributor-location sources failed for this request.");
    error.failures = warnings;
    throw error;
  }
  return {
    elements: dedupeElements(elements.filter(isTargetFuelFacility)),
    sources: [...new Set(sources)],
    warnings,
    truncated,
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
    const key = [FILTER_VERSION, bounds.south, bounds.west, bounds.north, bounds.east].map((value) => typeof value === "number" ? value.toFixed(3) : value).join(",");
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
        filterVersion: FILTER_VERSION,
        source: result.sources.join(" + "),
        sources: result.sources,
        warnings: result.warnings,
        partial: result.warnings.length > 0,
        fetchedAt: new Date().toISOString(),
        truncated: result.truncated,
        elements: result.elements,
      };
      cacheSet(searchCache, key, payload, SEARCH_CACHE_TTL_MS);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=600");
      return res.json(payload);
    } catch (error) {
      console.error("Fuel Atlas verified-source search failed:", error.failures || error);
      return res.status(502).json({
        ok: false,
        code: "DISTRIBUTOR_SOURCES_UNAVAILABLE",
        message: "Verified distributor-location sources are temporarily unavailable. Please retry this metro area.",
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
