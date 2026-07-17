const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_LIMIT = 160;
const MIN_DETAIL_ZOOM = 7;
const MAX_LAT_SPAN = 9;
const MAX_LON_SPAN = 15;
const MAX_BBOX_AREA = 110;
const MAX_RESULTS = 4000;
const ECHO_PAGE_SIZE = 1000;
const ECHO_MAX_PAGES = 5;
const ECHO_TIMEOUT_MS = 10000;
const OVERPASS_TIMEOUT_MS = 8000;
const PROVIDER_STAGGER_MS = 300;
const OVERPASS_MAX_AREA = 18;
export const FUEL_ATLAS_BUILD_ID = "2026-07-17-naics-bbox-v4";
const USER_AGENT = `FuelIQ-Fuel-Atlas/${FUEL_ATLAS_BUILD_ID} (+https://github.com/nourie42/Sun-Nourie)`;

const DEFAULT_OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const ECHO_ENDPOINT = "https://echogeo.epa.gov/arcgis/rest/services/ECHO/Facilities/MapServer/0/query";

const TARGET_NAICS_CODES = Object.freeze([
  "424710",
  "424720",
  "454310",
  "454311",
  "454312",
  "454319",
  "457210",
  "486110",
  "486910",
]);
const TARGET_SIC_CODES = Object.freeze(["5171", "5172", "5983", "5984"]);
const RETAIL_NAICS_CODES = Object.freeze(["447110", "447190", "457110", "457120"]);
const RETAIL_SIC_CODES = Object.freeze(["5541"]);

const TARGET_NAICS_SET = new Set(TARGET_NAICS_CODES);
const TARGET_SIC_SET = new Set(TARGET_SIC_CODES);
const RETAIL_NAICS_SET = new Set(RETAIL_NAICS_CODES);
const RETAIL_SIC_SET = new Set(RETAIL_SIC_CODES);

const TARGET_INDUSTRIAL = /^(oil|petroleum|fuel|tank_farm|oil_storage|petroleum_storage|fuel_storage|bulk_plant|fuel_terminal|oil_terminal|terminal|depot)$/i;
const TARGET_STORAGE = /^(fuel|fuel_oil|heating_oil|oil|petroleum|diesel|gasoline|kerosene|propane|lpg)$/i;
const STRONG_FACILITY_TEXT = /\b(heating[ _-]?oil|fuel[ _-]?oil|propane|\blpg\b|bulk[ _-]?(plant|station|terminal)|tank[ _-]?farm|storage[ _-]?terminal|petroleum[ _-]?terminal|fuel[ _-]?terminal|oil[ _-]?terminal|fuel[ _-]?depot|oil[ _-]?depot|petroleum[ _-]?products|fuel[ _-]?(distribut|wholesal)|petroleum[ _-]?(distribut|wholesal)|oil[ _-]?(company|co\.?|distribut|wholesal)|pipeline[ _-]?terminal)\b/i;
const TERMINAL_TEXT = /\b(terminal|tank[ _-]?farm|storage[ _-]?terminal|fuel[ _-]?depot|oil[ _-]?depot|pipeline|bulk[ _-]?terminal)\b/i;
const BULK_TEXT = /\b(bulk[ _-]?(plant|station|fuel)|petroleum[ _-]?bulk)\b/i;
const PROPANE_TEXT = /\b(propane|\blpg\b|liquefied petroleum)\b/i;
const HEATING_OIL_TEXT = /\b(heating[ _-]?oil|fuel[ _-]?oil|home heating|kerosene)\b/i;
const ALWAYS_REJECT_TEXT = /\b(gas station|service station|filling station|fuel center|fuel centre|travel center|travel centre|truck stop|convenience store|food mart|mini mart|quick stop|petro mart|gas mart|c-store|car wash|oil change|quick lube|lube shop|treatment plant|wastewater|sewage|landfill)\b/i;
const RETAIL_BRAND_ONLY = /^(shell|bp|exxon|mobil|exxonmobil|sunoco|marathon|citgo|valero|chevron|gulf|speedway|circle k|wawa|sheetz|7[- ]?eleven|murphy|murphy usa|costco|sam'?s club|pilot|flying j|love'?s)(?:\s*#?\s*\d+)?$/i;

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

async function timedFetch(url, init = {}, timeoutMs = 10000) {
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
      message: "Zoom in to a state or multi-state region before searching the verified distributor layer.",
      minimumZoom: MIN_DETAIL_ZOOM,
      latSpan,
      lonSpan,
      area,
    };
  }
  return { ok: true, south, west, north, east, zoom: requestedZoom, latSpan, lonSpan, area };
}

function parseCodes(value) {
  return [...new Set((String(value || "").match(/\b\d{4,6}\b/g) || []))];
}

function codeEvidence(tags = {}) {
  const naics = parseCodes(tags["fuel_iq:naics_codes"] || tags.naics || tags["naics:code"]);
  const sic = parseCodes(tags["fuel_iq:sic_codes"] || tags.sic || tags["sic:code"]);
  return { naics, sic };
}

function facilityText(tags = {}) {
  return [
    tags.name,
    tags.operator,
    tags["operator:name"],
    tags.owner,
    tags["owner:name"],
    tags.brand,
    tags.description,
    tags.product,
    tags.products,
    tags.content,
    tags.substance,
    tags.storage,
    tags.shop,
    tags.industrial,
    tags.office,
    tags.landuse,
    tags.building,
    tags["fuel_iq:evidence"],
  ].filter(Boolean).join(" ");
}

function isRetailOrUnrelated(tags = {}) {
  const amenity = clean(tags.amenity, 80).toLowerCase();
  const shop = clean(tags.shop, 80).toLowerCase();
  const name = clean(tags.name || tags.operator || tags.brand, 300);
  const text = facilityText(tags);
  const { naics, sic } = codeEvidence(tags);
  if (amenity === "fuel") return true;
  if (["fuel", "gas", "convenience", "supermarket"].includes(shop)) return true;
  if (naics.some((code) => RETAIL_NAICS_SET.has(code)) || sic.some((code) => RETAIL_SIC_SET.has(code))) return true;
  if (ALWAYS_REJECT_TEXT.test(text)) return true;
  return RETAIL_BRAND_ONLY.test(name);
}

export function isTargetFuelFacility(element = {}) {
  const tags = element.tags || {};
  if (isRetailOrUnrelated(tags)) return false;
  const { naics, sic } = codeEvidence(tags);
  if (naics.some((code) => TARGET_NAICS_SET.has(code)) || sic.some((code) => TARGET_SIC_SET.has(code))) return true;

  const text = facilityText(tags);
  const identified = Boolean(tags.name || tags.operator || tags["operator:name"] || tags.owner || tags["owner:name"]);
  if (!identified) return false;
  if (clean(tags.shop, 80).toLowerCase() === "heating_oil") return true;
  if (TARGET_INDUSTRIAL.test(clean(tags.industrial, 100)) && STRONG_FACILITY_TEXT.test(text)) return true;
  if (clean(tags.landuse, 80).toLowerCase() === "industrial" && STRONG_FACILITY_TEXT.test(text)) return true;
  if (/^(industrial|warehouse)$/i.test(clean(tags.building, 80)) && STRONG_FACILITY_TEXT.test(text)) return true;
  const material = clean(tags.content || tags.substance || tags.storage, 120);
  if (clean(tags.man_made, 80).toLowerCase() === "storage_tank" && TARGET_STORAGE.test(material) && STRONG_FACILITY_TEXT.test(text)) return true;
  return /^(company|logistics)$/i.test(clean(tags.office, 80)) && STRONG_FACILITY_TEXT.test(text);
}

function facilityTypeFromEvidence(name, naics, sic) {
  const text = clean(name, 400);
  if (PROPANE_TEXT.test(text) || naics.some((code) => ["454312", "457210"].includes(code)) || sic.includes("5984")) return "propane";
  if (HEATING_OIL_TEXT.test(text) || naics.some((code) => ["454310", "454311", "454319"].includes(code)) || sic.includes("5983")) return "heating_oil";
  if (TERMINAL_TEXT.test(text) || naics.some((code) => ["424710", "486110", "486910"].includes(code)) || sic.includes("5171")) return "terminal";
  if (BULK_TEXT.test(text)) return "bulk_plant";
  return "distributor";
}

export function buildFuelAtlasQuery(bounds) {
  const box = [bounds.south, bounds.west, bounds.north, bounds.east].map((value) => Number(value).toFixed(5)).join(",");
  const terms = "heating[ _-]?oil|fuel[ _-]?oil|propane|lpg|bulk[ _-]?(plant|station|terminal)|tank[ _-]?farm|storage[ _-]?terminal|petroleum[ _-]?terminal|fuel[ _-]?terminal|oil[ _-]?terminal|fuel[ _-]?depot|oil[ _-]?depot|fuel[ _-]?distribut|petroleum[ _-]?distribut|fuel[ _-]?wholesal|petroleum[ _-]?wholesal|oil[ _-]?company|pipeline[ _-]?terminal";
  const materials = "fuel|fuel_oil|heating_oil|oil|petroleum|diesel|gasoline|kerosene|propane|lpg";
  return `[out:json][timeout:8];(
  nwr["shop"="heating_oil"](${box});
  nwr["industrial"~"^(bulk_plant|fuel_terminal|oil_terminal|tank_farm|oil_storage|petroleum_storage|fuel_storage|depot)$",i](${box});
  nwr["industrial"~"^(oil|petroleum|fuel|terminal)$",i]["name"~"(${terms})",i](${box});
  nwr["landuse"="industrial"]["name"~"(${terms})",i](${box});
  nwr["building"~"^(industrial|warehouse)$"]["name"~"(${terms})",i](${box});
  nwr["office"~"^(company|logistics)$"]["name"~"(${terms})",i](${box});
  nwr["office"~"^(company|logistics)$"]["operator"~"(${terms})",i](${box});
  nwr["man_made"="storage_tank"]["content"~"^(${materials})$",i]["operator"~"(${terms})",i](${box});
  nwr["man_made"="storage_tank"]["substance"~"^(${materials})$",i]["operator"~"(${terms})",i](${box});
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
  if (!response.ok) throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("The OpenStreetMap source returned a non-JSON response."); }
  if (!Array.isArray(data.elements)) throw new Error("The OpenStreetMap source returned an invalid result.");
  return { elements: data.elements.filter(isTargetFuelFacility), source: "OpenStreetMap explicit distributor/facility tags", endpoint };
}

async function fetchOverpass(bounds) {
  if (bounds.area > OVERPASS_MAX_AREA) {
    return { elements: [], source: null, skipped: true, reason: "visible area exceeds supplemental OpenStreetMap limit" };
  }
  const query = buildFuelAtlasQuery(bounds);
  const failures = [];
  const sharedController = new AbortController();
  const attempts = overpassEndpoints().map((endpoint, index) => (async () => {
    if (index) await delay(index * PROVIDER_STAGGER_MS);
    if (sharedController.signal.aborted) throw Object.assign(new Error("Request cancelled"), { name: "AbortError" });
    try {
      return await fetchOverpassEndpoint(endpoint, query, sharedController.signal);
    } catch (error) {
      if (!(sharedController.signal.aborted && error?.name === "AbortError")) failures.push(`${endpoint}: ${clean(error?.message || error, 180)}`);
      throw error;
    }
  })());
  try {
    const result = await Promise.any(attempts);
    sharedController.abort();
    return result;
  } catch {
    sharedController.abort();
    const error = new Error("OpenStreetMap distributor tags were unavailable.");
    error.failures = failures;
    throw error;
  }
}

function pointInsideBounds(lat, lon, bounds) {
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
}

function echoWhereClause() {
  const naicsParts = TARGET_NAICS_CODES.map((code) => `FAC_NAICS_CODES LIKE '%${code}%'`);
  const sicParts = TARGET_SIC_CODES.map((code) => `FAC_SIC_CODES LIKE '%${code}%'`);
  return `(${[...naicsParts, ...sicParts].join(" OR ")})`;
}

export function buildEchoQueryUrl(bounds, offset = 0) {
  const url = new URL(ECHO_ENDPOINT);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", echoWhereClause());
  url.searchParams.set("geometry", `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
  url.searchParams.set("geometryType", "esriGeometryEnvelope");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "REGISTRY_ID,FAC_NAME,FAC_STREET,FAC_CITY,FAC_STATE,FAC_ZIP,FAC_COUNTY,FAC_LAT,FAC_LONG,FAC_ACTIVE_FLAG,FAC_NAICS_CODES,FAC_SIC_CODES,DFR_URL");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(ECHO_PAGE_SIZE));
  url.searchParams.set("orderByFields", "REGISTRY_ID");
  return url;
}

export function echoFeatureToElement(feature = {}, bounds = null) {
  const attributes = feature.attributes || feature;
  const lat = Number(attributes.FAC_LAT ?? attributes.LATITUDE83 ?? attributes.Latitude83);
  const lon = Number(attributes.FAC_LONG ?? attributes.LONGITUDE83 ?? attributes.Longitude83);
  const name = clean(attributes.FAC_NAME ?? attributes.FacilityName, 300);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return null;
  if (bounds && !pointInsideBounds(lat, lon, bounds)) return null;
  const naics = parseCodes(attributes.FAC_NAICS_CODES ?? attributes.NAICS_CODES ?? attributes.NaicsCodes);
  const sic = parseCodes(attributes.FAC_SIC_CODES ?? attributes.SIC_CODES ?? attributes.SicCodes);
  const targetNaics = naics.filter((code) => TARGET_NAICS_SET.has(code));
  const targetSic = sic.filter((code) => TARGET_SIC_SET.has(code));
  const retailNaics = naics.filter((code) => RETAIL_NAICS_SET.has(code));
  const retailSic = sic.filter((code) => RETAIL_SIC_SET.has(code));
  if (!targetNaics.length && !targetSic.length) return null;
  if (retailNaics.length || retailSic.length || ALWAYS_REJECT_TEXT.test(name) || RETAIL_BRAND_ONLY.test(name)) return null;

  const registryId = clean(attributes.REGISTRY_ID ?? attributes.RegistryId, 80) || `${lat}-${lon}-${name}`;
  const evidenceParts = [];
  if (targetNaics.length) evidenceParts.push(`NAICS ${targetNaics.join(", ")}`);
  if (targetSic.length) evidenceParts.push(`SIC ${targetSic.join(", ")}`);
  const facilityType = facilityTypeFromEvidence(name, targetNaics, targetSic);
  const sourceUrl = clean(attributes.DFR_URL, 1000) || `https://echo.epa.gov/detailed-facility-report?fid=${encodeURIComponent(registryId)}`;
  return {
    type: "echo",
    id: registryId,
    lat,
    lon,
    source_name: "EPA ECHO Facility Registry industry-code layer",
    source_url: sourceUrl,
    tags: {
      name,
      industrial: facilityType === "terminal" ? "fuel_terminal" : facilityType === "bulk_plant" ? "bulk_plant" : "",
      "fuel_iq:verified": "yes",
      "fuel_iq:confidence": "industry_code",
      "fuel_iq:evidence": evidenceParts.join("; "),
      "fuel_iq:naics_codes": targetNaics.join(", "),
      "fuel_iq:sic_codes": targetSic.join(", "),
      "fuel_iq:facility_type": facilityType,
      "fuel_iq:registry_id": registryId,
      "fuel_iq:source": "EPA ECHO / FRS industry codes",
      "addr:full": clean(attributes.FAC_STREET, 400),
      "addr:city": clean(attributes.FAC_CITY, 160),
      "addr:state": clean(attributes.FAC_STATE, 20),
      "addr:postcode": clean(attributes.FAC_ZIP, 30),
      "addr:county": clean(attributes.FAC_COUNTY, 160),
    },
  };
}

function splitBounds(bounds) {
  const latMid = (bounds.south + bounds.north) / 2;
  const lonMid = (bounds.west + bounds.east) / 2;
  return [
    { ...bounds, south: bounds.south, west: bounds.west, north: latMid, east: lonMid },
    { ...bounds, south: bounds.south, west: lonMid, north: latMid, east: bounds.east },
    { ...bounds, south: latMid, west: bounds.west, north: bounds.north, east: lonMid },
    { ...bounds, south: latMid, west: lonMid, north: bounds.north, east: bounds.east },
  ].map((item) => ({ ...item, latSpan: item.north - item.south, lonSpan: item.east - item.west, area: (item.north - item.south) * (item.east - item.west) }));
}

async function fetchEchoPage(bounds, offset) {
  const response = await timedFetch(buildEchoQueryUrl(bounds, offset), { headers: { Accept: "application/json", "User-Agent": USER_AGENT } }, ECHO_TIMEOUT_MS);
  if (!response.ok) throw new Error(`EPA ECHO HTTP ${response.status}`);
  const data = await response.json();
  if (data?.error) throw new Error(`EPA ECHO ${clean(data.error.message || "query failed", 180)}`);
  return data;
}

async function fetchEchoBounds(bounds) {
  const features = [];
  let exceeded = false;
  for (let page = 0; page < ECHO_MAX_PAGES; page += 1) {
    const data = await fetchEchoPage(bounds, page * ECHO_PAGE_SIZE);
    const pageFeatures = Array.isArray(data.features) ? data.features : [];
    features.push(...pageFeatures);
    exceeded = data.exceededTransferLimit === true;
    if (!exceeded || pageFeatures.length < ECHO_PAGE_SIZE) break;
  }
  return {
    elements: features.map((feature) => echoFeatureToElement(feature, bounds)).filter(Boolean),
    source: "EPA ECHO / FRS industry-code layer",
    truncated: exceeded && features.length >= ECHO_PAGE_SIZE * ECHO_MAX_PAGES,
    pages: Math.ceil(features.length / ECHO_PAGE_SIZE),
  };
}

async function fetchEcho(bounds) {
  try {
    const result = await fetchEchoBounds(bounds);
    if (!result.truncated) return result;
  } catch (error) {
    if (bounds.area <= 12) throw error;
  }

  const settled = await Promise.allSettled(splitBounds(bounds).map((tile) => fetchEchoBounds(tile)));
  const elements = [];
  const failures = [];
  let truncated = false;
  let pages = 0;
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      elements.push(...result.value.elements);
      truncated ||= result.value.truncated;
      pages += result.value.pages;
    } else {
      failures.push(`tile ${index + 1}: ${clean(result.reason?.message || result.reason, 180)}`);
    }
  });
  if (!elements.length && failures.length === settled.length) {
    const error = new Error("EPA ECHO full-bounds search failed.");
    error.failures = failures;
    throw error;
  }
  return { elements, source: "EPA ECHO / FRS industry-code layer", truncated, pages, failures };
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
  return [tags.name, tags.owner, tags.operator, tags.phone, tags.email, tags.website, tags["addr:full"], tags["addr:city"], tags["addr:state"], tags["fuel_iq:evidence"]].filter(Boolean).length;
}

function dedupeElements(elements) {
  const byId = new Map();
  for (const element of elements) {
    const sourceId = clean(element.tags?.["fuel_iq:registry_id"] || element.id, 140);
    const key = `${element.type || "feature"}:${sourceId || JSON.stringify(elementCenter(element))}`;
    if (!byId.has(key) || elementScore(element) > elementScore(byId.get(key))) byId.set(key, element);
  }
  const byFacility = new Map();
  for (const element of byId.values()) {
    const { lat, lon } = elementCenter(element);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = elementName(element) || "unnamed";
    const key = `${name}|${Math.round(lat * 1000)}|${Math.round(lon * 1000)}`;
    const prior = byFacility.get(key);
    if (!prior || elementScore(element) > elementScore(prior)) byFacility.set(key, element);
  }
  return [...byFacility.values()];
}

function gridCoverage(elements, bounds, rows = 4, columns = 4) {
  const occupied = new Set();
  const height = bounds.north - bounds.south;
  const width = bounds.east - bounds.west;
  for (const element of elements) {
    const { lat, lon } = elementCenter(element);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !pointInsideBounds(lat, lon, bounds)) continue;
    const row = Math.min(rows - 1, Math.max(0, Math.floor(((lat - bounds.south) / height) * rows)));
    const column = Math.min(columns - 1, Math.max(0, Math.floor(((lon - bounds.west) / width) * columns)));
    occupied.add(`${row}:${column}`);
  }
  return { rows, columns, occupiedCells: occupied.size, occupied: [...occupied].sort() };
}

export async function searchFuelAtlasSources(bounds) {
  const startedAt = Date.now();
  const [echoResult, osmResult] = await Promise.allSettled([fetchEcho(bounds), fetchOverpass(bounds)]);
  const elements = [];
  const sources = [];
  const warnings = [];
  let truncated = false;
  let echoPages = 0;

  if (echoResult.status === "fulfilled") {
    elements.push(...echoResult.value.elements);
    sources.push(echoResult.value.source);
    truncated ||= echoResult.value.truncated === true;
    echoPages = echoResult.value.pages || 0;
    warnings.push(...(echoResult.value.failures || []));
  } else {
    warnings.push(`EPA ECHO: ${clean(echoResult.reason?.message || echoResult.reason, 220)}`);
  }

  if (osmResult.status === "fulfilled") {
    elements.push(...osmResult.value.elements);
    if (osmResult.value.source) sources.push(osmResult.value.source);
    if (osmResult.value.skipped) warnings.push(`OpenStreetMap supplemental source skipped: ${osmResult.value.reason}.`);
  } else {
    warnings.push(`OpenStreetMap supplemental source: ${clean(osmResult.reason?.message || osmResult.reason, 220)}`);
  }

  if (!sources.length) {
    const error = new Error("All verified distributor-location sources failed for this request.");
    error.failures = warnings;
    throw error;
  }

  const verified = dedupeElements(elements.filter(isTargetFuelFacility));
  const coverage = gridCoverage(verified, bounds);
  return {
    elements: verified,
    sources: [...new Set(sources)],
    sourceSummary: [
      { name: "EPA ECHO / FRS industry-code layer", status: echoResult.status === "fulfilled" ? "ok" : "failed", count: echoResult.status === "fulfilled" ? echoResult.value.elements.length : 0, pages: echoPages },
      { name: "OpenStreetMap explicit distributor/facility tags", status: osmResult.status === "fulfilled" ? (osmResult.value.skipped ? "skipped" : "ok") : "failed", count: osmResult.status === "fulfilled" ? osmResult.value.elements.length : 0 },
    ],
    warnings,
    truncated,
    coverage,
    elapsedMs: Date.now() - startedAt,
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
    const key = [FUEL_ATLAS_BUILD_ID, bounds.south, bounds.west, bounds.north, bounds.east]
      .map((value) => typeof value === "number" ? value.toFixed(4) : value)
      .join("|");
    const cached = cacheGet(searchCache, key);
    if (cached) {
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
      return res.json({ ...cached, cached: true });
    }
    try {
      const result = await searchFuelAtlasSources(bounds);
      const payload = {
        ok: true,
        buildId: FUEL_ATLAS_BUILD_ID,
        filterVersion: FUEL_ATLAS_BUILD_ID,
        cached: false,
        source: result.sources.join(" + "),
        sources: result.sources,
        sourceSummary: result.sourceSummary,
        warnings: result.warnings,
        partial: result.sourceSummary.some((source) => ["failed", "skipped"].includes(source.status)),
        fetchedAt: new Date().toISOString(),
        elapsedMs: result.elapsedMs,
        truncated: result.truncated,
        coverage: {
          requestedBounds: { south: bounds.south, west: bounds.west, north: bounds.north, east: bounds.east },
          gridRows: result.coverage.rows,
          gridColumns: result.coverage.columns,
          occupiedGridCells: result.coverage.occupiedCells,
          occupiedCells: result.coverage.occupied,
          verifiedCount: result.elements.length,
        },
        elements: result.elements,
      };
      cacheSet(searchCache, key, payload, SEARCH_CACHE_TTL_MS);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
      return res.json(payload);
    } catch (error) {
      console.error("Fuel Atlas verified full-bounds search failed:", error.failures || error);
      return res.status(502).json({
        ok: false,
        buildId: FUEL_ATLAS_BUILD_ID,
        code: "VERIFIED_SOURCES_UNAVAILABLE",
        message: "Verified distributor sources are temporarily unavailable for this area. Please retry.",
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
