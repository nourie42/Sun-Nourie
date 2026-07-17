const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000;
const SEARCH_CACHE_STALE_MS = 24 * 60 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_LIMIT = 180;
const MIN_DETAIL_ZOOM = 8;
const MAX_LAT_SPAN = 5;
const MAX_LON_SPAN = 8;
const MAX_BBOX_AREA = 28;
const MAX_RESULTS = 2000;
const MAX_OVERPASS_RESULTS = 1200;
const DEFAULT_SOURCE_TIMEOUT_MS = 8500;
const DEFAULT_HARD_DEADLINE_MS = 10500;
const USER_AGENT = "FuelIQ-Fuel-Atlas/2.0 (+https://github.com/nourie42/Sun-Nourie)";

const DEFAULT_OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const EPA_FRS_ENDPOINT = "https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities";

const FRS_SEARCHES = [
  { term: "heating oil", type: "heating_oil" },
  { term: "fuel", type: "distributor" },
  { term: "petroleum", type: "distributor" },
  { term: "propane", type: "propane" },
  { term: "terminal", type: "terminal" },
  { term: "bulk", type: "bulk_plant" },
];

const GOOGLE_SEARCHES = [
  { query: "fuel oil supplier", type: "heating_oil" },
  { query: "heating oil supplier", type: "heating_oil" },
  { query: "petroleum distributor", type: "distributor" },
  { query: "commercial fuel distributor", type: "distributor" },
  { query: "bulk fuel supplier", type: "bulk_plant" },
  { query: "propane supplier", type: "propane" },
  { query: "petroleum terminal", type: "terminal" },
];

const STRONG_FUEL_RE = /\b(heating[ _-]?oil|home heating|fuel[ _-]?oil|petroleum|propane|\blpg\b|bulk(?:\s+(?:fuel|oil|petroleum|plant|storage))?|terminal|tank[ _-]?farm|fuel depot|oil depot|cardlock|commercial fuel|fleet fuel|fuel distributor|petroleum distributor|fuel delivery|oil company|fuel company|petroleum products?|diesel distributor|fuel storage|oil storage|lubricants?)\b/i;
const BASIC_FUEL_RE = /\b(fuel|fuels|oil|petroleum|propane|lpg)\b/i;
const RETAIL_GAS_RE = /\b(gas station|service station|filling station|convenience(?: store)?|food mart|quick mart|travel center|travel plaza|truck stop|speedway|sheetz|wawa|racetrac|race trac|circle k|7-eleven|7-11|quiktrip|murphy usa|pilot|flying j|love'?s|costco|sam'?s club|bj'?s|kroger|walmart)\b/i;
const NON_FUEL_RE = /\b(oil change|quick lube|jiffy lube|automotive|auto repair|car wash|restaurant|airport|solar|electric utility|natural gas utility)\b/i;
const SPECIALIZED_OVERRIDE_RE = /\b(terminal|bulk|depot|tank[ _-]?farm|cardlock|heating[ _-]?oil|fuel[ _-]?oil|propane|petroleum distributor|fuel distributor)\b/i;

const searchCache = new Map();
const geocodeCache = new Map();

function clean(value, max = 500) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function cacheRead(cache, key, { allowStale = false } = {}) {
  const hit = cache.get(key);
  if (!hit) return null;
  const now = Date.now();
  if (hit.freshUntil > now) return { value: hit.value, stale: false };
  if (allowStale && hit.staleUntil > now) return { value: hit.value, stale: true };
  cache.delete(key);
  return null;
}

function cacheWrite(cache, key, value, freshMs, staleMs = freshMs) {
  if (cache.has(key)) cache.delete(key);
  while (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  const now = Date.now();
  cache.set(key, { value, freshUntil: now + freshMs, staleUntil: now + staleMs });
}

export function clearFuelAtlasCaches() {
  searchCache.clear();
  geocodeCache.clear();
}

function abortError(message = "Request timed out") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

async function timedFetch(fetchImpl, url, init = {}, timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort();
    else upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
  }
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && error?.name !== "AbortError") throw abortError();
    throw error;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener?.("abort", abortFromUpstream);
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
      message: "Zoom in to a state region or metro area before searching the detailed public-source layer.",
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

  return `[out:json][timeout:10];
(
  nwr["industrial"~"^(oil|petroleum|fuel|tank_farm|refinery|terminal)$",i](${box});
  nwr["storage"~"^(oil|fuel|petroleum|propane|lpg)$",i](${box});
  nwr["shop"~"^(fuel|heating_oil|gas)$",i](${box});
  nwr["office"~"^(company|logistics|energy_supplier)$",i]["name"~"(fuel|oil|petroleum|propane|terminal|bulk|cardlock)",i](${box});
  nwr["landuse"="industrial"]["name"~"(fuel|heating oil|fuel oil|oil company|petroleum|propane|terminal|bulk|tank farm)",i](${box});
  nwr["man_made"="storage_tank"]["name"~"(fuel|oil|petroleum|propane|terminal|bulk|tank farm)",i](${box});
  nwr["amenity"="fuel"]["access"~"^(private|customers|permit)$",i](${box});
);
out tags center qt ${MAX_OVERPASS_RESULTS};`;
}

function combinedTagText(tags = {}) {
  return [
    tags.name,
    tags.operator,
    tags["operator:name"],
    tags.owner,
    tags["owner:name"],
    tags.brand,
    tags.description,
    tags.product,
    tags.content,
    tags.storage,
    tags.shop,
    tags.industrial,
    tags.office,
    tags.landuse,
  ].filter(Boolean).join(" ");
}

function hasMeaningfulIdentity(tags = {}) {
  return Boolean(tags.name || tags.operator || tags["operator:name"] || tags.owner || tags["owner:name"] || tags.brand);
}

export function isRelevantOsmElement(element) {
  const tags = element?.tags || {};
  if (!hasMeaningfulIdentity(tags)) return false;

  const text = combinedTagText(tags);
  const strong = STRONG_FUEL_RE.test(text);
  const basic = BASIC_FUEL_RE.test(text);
  const specializedOverride = SPECIALIZED_OVERRIDE_RE.test(text);
  if (NON_FUEL_RE.test(text) && !specializedOverride) return false;
  if (RETAIL_GAS_RE.test(text) && !specializedOverride) return false;

  const access = clean(tags.access).toLowerCase();
  const privateFuel = tags.amenity === "fuel" && ["private", "customers", "permit"].includes(access);
  const publicFuel = tags.amenity === "fuel" && !privateFuel;
  if (publicFuel && !specializedOverride) return false;
  if (privateFuel) return true;

  if (/^(oil|petroleum|fuel|tank_farm|refinery|terminal)$/i.test(clean(tags.industrial))) return true;
  if (/^(oil|fuel|petroleum|propane|lpg)$/i.test(clean(tags.storage))) return true;
  if (/^(heating_oil|fuel|gas)$/i.test(clean(tags.shop))) return strong || basic;
  if (tags.man_made === "storage_tank") return strong;
  if (tags.landuse === "industrial") return strong;
  if (tags.office) return strong || basic;
  return strong;
}

function classifyText(text, hint = "") {
  const value = `${text || ""} ${hint || ""}`.toLowerCase();
  if (/heating[ _-]?oil|home heating|fuel[ _-]?oil/.test(value)) return "heating_oil";
  if (/propane|\blpg\b/.test(value)) return "propane";
  if (/terminal|tank[ _-]?farm|storage terminal|fuel depot|oil depot/.test(value)) return "terminal";
  if (/bulk(?:\s+(?:fuel|oil|petroleum|plant|storage))?|cardlock|commercial fuel|fleet fuel/.test(value)) return "bulk_plant";
  return "distributor";
}

function addressLine(tags = {}) {
  return [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || clean(tags["addr:full"], 700);
}

function osmSourceUrl(element, lat, lon) {
  if (["node", "way", "relation"].includes(element?.type) && element?.id) {
    return `https://www.openstreetmap.org/${element.type}/${element.id}`;
  }
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=17/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
}

export function normalizeOsmRecord(element) {
  if (!isRelevantOsmElement(element)) return null;
  const tags = element.tags || {};
  const center = element.center || element;
  const lat = Number(center.lat);
  const lon = Number(center.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const owner = clean(tags.owner || tags["owner:name"], 300);
  const operator = clean(tags.operator || tags["operator:name"], 300);
  const name = clean(tags.name || operator || tags.brand || owner || "Fuel distribution facility", 300);
  const text = combinedTagText(tags);
  const sourceUrl = osmSourceUrl(element, lat, lon);
  return {
    id: `osm-${element.type || "feature"}-${element.id || `${lat}-${lon}`}`,
    name,
    owner,
    operator,
    phone: clean(tags.phone || tags["contact:phone"] || tags["contact:mobile"], 120),
    email: clean(tags.email || tags["contact:email"], 200),
    website: clean(tags.website || tags["contact:website"] || tags.url, 600),
    street: addressLine(tags),
    city: clean(tags["addr:city"] || tags["addr:town"] || tags["addr:village"] || tags["addr:hamlet"], 180),
    state: clean(tags["addr:state"], 80),
    zip: clean(tags["addr:postcode"], 30),
    lat,
    lon,
    type: classifyText(text),
    source: "OpenStreetMap",
    sourceUrl,
    sourceId: clean(element.id, 80),
    sources: [{ name: "OpenStreetMap", url: sourceUrl }],
  };
}

function configuredOverpassEndpoints(overpassEndpoints) {
  const configured = clean(process.env.FUEL_ATLAS_OVERPASS_URL, 1000);
  return [...new Set([configured, ...(overpassEndpoints || DEFAULT_OVERPASS_ENDPOINTS)].filter(Boolean))];
}

async function fetchOverpassEndpoint(fetchImpl, endpoint, query, timeoutMs, controller) {
  const response = await timedFetch(fetchImpl, endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: controller.signal,
  }, timeoutMs);

  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 140)}` : ""}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The map source returned a non-JSON response.");
  }
  if (!Array.isArray(data.elements)) throw new Error("The map source returned an invalid result.");
  return { elements: data.elements, endpoint };
}

async function searchOverpass(bounds, { fetchImpl, overpassEndpoints, timeoutMs }) {
  const endpoints = configuredOverpassEndpoints(overpassEndpoints);
  const query = buildFuelAtlasQuery(bounds);
  const attempts = endpoints.map((endpoint) => {
    const controller = new AbortController();
    const promise = fetchOverpassEndpoint(fetchImpl, endpoint, query, timeoutMs, controller);
    return { endpoint, controller, promise };
  });

  try {
    const result = await Promise.any(attempts.map((attempt) => attempt.promise));
    attempts.forEach((attempt) => attempt.controller.abort());
    const records = result.elements.map(normalizeOsmRecord).filter(Boolean);
    return { records, provider: result.endpoint };
  } catch (error) {
    attempts.forEach((attempt) => attempt.controller.abort());
    const messages = error instanceof AggregateError
      ? error.errors.map((item) => clean(item?.message || item, 220))
      : [clean(error?.message || error, 220)];
    const failure = new Error("OpenStreetMap providers did not respond in time.");
    failure.details = messages;
    throw failure;
  }
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const dLat = degreesToRadians(lat2 - lat1);
  const dLon = degreesToRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(a));
}

function boundsSearchGeometry(bounds) {
  const lat = (bounds.south + bounds.north) / 2;
  const lon = (bounds.west + bounds.east) / 2;
  const cornerRadius = Math.max(
    distanceMiles(lat, lon, bounds.south, bounds.west),
    distanceMiles(lat, lon, bounds.north, bounds.east),
  );
  return { lat, lon, radiusMiles: Math.max(3, Math.min(25, Math.ceil(cornerRadius))) };
}

function strictExternalName(name, hint = "") {
  const text = `${clean(name, 400)} ${hint}`;
  if (!clean(name)) return false;
  const specialized = STRONG_FUEL_RE.test(text) || BASIC_FUEL_RE.test(text) || /propane|petroleum|terminal|bulk|heating oil|fuel oil/i.test(hint);
  if (!specialized) return false;
  if (NON_FUEL_RE.test(text) && !SPECIALIZED_OVERRIDE_RE.test(text)) return false;
  if (RETAIL_GAS_RE.test(text) && !SPECIALIZED_OVERRIDE_RE.test(text)) return false;
  return true;
}

function arrayify(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeEpaFacility(item, hintType, sourceUrl) {
  const lat = Number(item?.Latitude83);
  const lon = Number(item?.Longitude83);
  const name = clean(item?.FacilityName, 300);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !strictExternalName(name, hintType)) return null;
  const registryId = clean(item?.RegistryId, 100);
  return {
    id: `epa-${registryId || `${lat}-${lon}-${name}`}`,
    name,
    owner: "",
    operator: "",
    phone: "",
    email: "",
    website: "",
    street: clean(item?.LocationAddress || item?.SupplementalLocation, 700),
    city: clean(item?.CityName, 180),
    state: clean(item?.StateAbbr, 40),
    zip: clean(item?.ZipCode, 30),
    lat,
    lon,
    type: classifyText(name, hintType),
    source: "EPA Facility Registry Service",
    sourceUrl,
    sourceId: registryId,
    sources: [{ name: "EPA Facility Registry Service", url: sourceUrl }],
  };
}

async function fetchEpaSearch(fetchImpl, geometry, search, timeoutMs) {
  const url = new URL(EPA_FRS_ENDPOINT);
  url.searchParams.set("latitude83", geometry.lat.toFixed(6));
  url.searchParams.set("longitude83", geometry.lon.toFixed(6));
  url.searchParams.set("search_radius", String(geometry.radiusMiles));
  url.searchParams.set("facility_name", search.term);
  url.searchParams.set("output", "JSON");

  const response = await timedFetch(fetchImpl, url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  }, timeoutMs);
  if (!response.ok) throw new Error(`EPA FRS HTTP ${response.status}`);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("EPA FRS returned a non-JSON response.");
  }
  const facilities = arrayify(data?.Results?.FRSFacility);
  return facilities.map((item) => normalizeEpaFacility(item, search.type, url.toString())).filter(Boolean);
}

async function searchEpaFrs(bounds, { fetchImpl, timeoutMs, searches = FRS_SEARCHES }) {
  const geometry = boundsSearchGeometry(bounds);
  const settled = await Promise.allSettled(searches.map((search) => fetchEpaSearch(fetchImpl, geometry, search, timeoutMs)));
  const records = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!records.length && settled.every((result) => result.status === "rejected")) {
    const error = new Error("EPA Facility Registry Service did not respond in time.");
    error.details = settled.map((result) => clean(result.reason?.message || result.reason, 220));
    throw error;
  }
  return { records, provider: "EPA Facility Registry Service" };
}

function googleRadiusMeters(bounds) {
  const geometry = boundsSearchGeometry(bounds);
  return Math.max(5000, Math.min(50000, Math.ceil(geometry.radiusMiles * 1609.344)));
}

function normalizeGooglePlace(item, search) {
  const lat = Number(item?.geometry?.location?.lat);
  const lon = Number(item?.geometry?.location?.lng);
  const name = clean(item?.name, 300);
  const types = Array.isArray(item?.types) ? item.types : [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return null;
  if (types.includes("gas_station")) return null;
  if (!strictExternalName(name, search.query)) return null;
  const placeId = clean(item?.place_id, 200);
  const sourceUrl = placeId
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(placeId)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${item?.formatted_address || ""}`)}`;
  return {
    id: `google-${placeId || `${lat}-${lon}-${name}`}`,
    name,
    owner: "",
    operator: "",
    phone: "",
    email: "",
    website: "",
    street: clean(item?.formatted_address, 700),
    city: "",
    state: "",
    zip: "",
    lat,
    lon,
    type: search.type || classifyText(name, search.query),
    source: "Google Places",
    sourceUrl,
    sourceId: placeId,
    sources: [{ name: "Google Places", url: sourceUrl }],
  };
}

async function fetchGoogleSearch(fetchImpl, bounds, search, apiKey, timeoutMs) {
  const geometry = boundsSearchGeometry(bounds);
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", search.query);
  url.searchParams.set("location", `${geometry.lat},${geometry.lon}`);
  url.searchParams.set("radius", String(googleRadiusMeters(bounds)));
  url.searchParams.set("key", apiKey);
  const response = await timedFetch(fetchImpl, url, { headers: { Accept: "application/json" } }, timeoutMs);
  if (!response.ok) throw new Error(`Google Places HTTP ${response.status}`);
  const data = await response.json();
  if (!["OK", "ZERO_RESULTS"].includes(data?.status)) throw new Error(`Google Places ${clean(data?.status || "UNKNOWN", 80)}`);
  return (data.results || []).filter((item) => item.business_status !== "CLOSED_PERMANENTLY")
    .map((item) => normalizeGooglePlace(item, search)).filter(Boolean);
}

async function searchGooglePlaces(bounds, { fetchImpl, timeoutMs, apiKey, searches = GOOGLE_SEARCHES }) {
  if (!apiKey) return { records: [], provider: "Google Places", skipped: true };
  const settled = await Promise.allSettled(searches.map((search) => fetchGoogleSearch(fetchImpl, bounds, search, apiKey, timeoutMs)));
  const records = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!records.length && settled.every((result) => result.status === "rejected")) {
    const error = new Error("Google Places did not respond in time.");
    error.details = settled.map((result) => clean(result.reason?.message || result.reason, 220));
    throw error;
  }
  return { records, provider: "Google Places" };
}

function normalizedName(value) {
  return clean(value, 400).toLowerCase().replace(/\b(incorporated|corporation|company|limited|llc|inc|corp|co|ltd)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function recordInsideBounds(record, bounds) {
  const padLat = Math.max(0.02, bounds.latSpan * 0.04);
  const padLon = Math.max(0.02, bounds.lonSpan * 0.04);
  return record.lat >= bounds.south - padLat && record.lat <= bounds.north + padLat
    && record.lon >= bounds.west - padLon && record.lon <= bounds.east + padLon;
}

function mergeSources(existing = [], incoming = []) {
  const seen = new Set();
  return [...existing, ...incoming].filter((source) => {
    const key = `${clean(source?.name)}|${clean(source?.url)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeRecord(target, incoming) {
  for (const field of ["owner", "operator", "phone", "email", "website", "street", "city", "state", "zip", "sourceUrl", "sourceId"]) {
    if (!target[field] && incoming[field]) target[field] = incoming[field];
  }
  if (target.name.length < incoming.name.length && normalizedName(target.name) === normalizedName(incoming.name)) target.name = incoming.name;
  target.sources = mergeSources(target.sources, incoming.sources);
  target.source = target.sources.map((source) => source.name).filter(Boolean).join("; ") || target.source || incoming.source;
  return target;
}

export function mergeFuelAtlasRecords(groups, bounds) {
  const output = [];
  const exact = new Map();
  for (const record of groups.flat()) {
    if (!record || !Number.isFinite(record.lat) || !Number.isFinite(record.lon) || !record.name) continue;
    if (!recordInsideBounds(record, bounds)) continue;
    const name = normalizedName(record.name);
    if (!name) continue;
    const key = `${name}|${record.lat.toFixed(3)}|${record.lon.toFixed(3)}`;
    if (exact.has(key)) {
      mergeRecord(exact.get(key), record);
      continue;
    }
    const near = output.find((candidate) => {
      if (normalizedName(candidate.name) !== name) return false;
      return distanceMiles(candidate.lat, candidate.lon, record.lat, record.lon) <= 0.12;
    });
    if (near) {
      mergeRecord(near, record);
      exact.set(key, near);
      continue;
    }
    const copy = { ...record, sources: mergeSources([], record.sources || [{ name: record.source, url: record.sourceUrl }]) };
    output.push(copy);
    exact.set(key, copy);
    if (output.length >= MAX_RESULTS) break;
  }
  return output.sort((a, b) => a.name.localeCompare(b.name));
}

async function runSource(name, task) {
  const startedAt = Date.now();
  try {
    const result = await task();
    return {
      name,
      status: result?.skipped ? "skipped" : "ok",
      count: Array.isArray(result?.records) ? result.records.length : 0,
      elapsedMs: Date.now() - startedAt,
      records: result?.records || [],
      provider: clean(result?.provider || name, 300),
    };
  } catch (error) {
    return {
      name,
      status: error?.name === "AbortError" ? "timeout" : "error",
      count: 0,
      elapsedMs: Date.now() - startedAt,
      records: [],
      error: clean(error?.message || error, 300),
    };
  }
}

async function collectSearchSources(bounds, options) {
  const definitions = [
    { name: "OpenStreetMap", task: () => searchOverpass(bounds, options) },
  ];
  if (options.enableEpa !== false) definitions.push({ name: "EPA FRS", task: () => searchEpaFrs(bounds, options) });
  if (options.enableGoogle !== false) definitions.push({ name: "Google Places", task: () => searchGooglePlaces(bounds, { ...options, apiKey: options.googleApiKey, searches: options.googleSearches }) });

  const outcomes = [];
  const pending = new Set(definitions.map((item) => item.name));
  const promises = definitions.map(async (definition) => {
    const outcome = await runSource(definition.name, definition.task);
    pending.delete(definition.name);
    outcomes.push(outcome);
    return outcome;
  });

  let deadlineTimer;
  await Promise.race([
    Promise.allSettled(promises),
    new Promise((resolve) => { deadlineTimer = setTimeout(resolve, options.hardDeadlineMs); }),
  ]);
  clearTimeout(deadlineTimer);

  for (const name of pending) {
    outcomes.push({ name, status: "timeout", count: 0, elapsedMs: options.hardDeadlineMs, records: [], error: "Source deadline reached." });
  }
  return outcomes;
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

async function geocodeGoogle(query, apiKey, fetchImpl, timeoutMs) {
  if (!apiKey) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("key", apiKey);
  const response = await timedFetch(fetchImpl, url, { headers: { Accept: "application/json" } }, timeoutMs);
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

async function geocodeCensus(query, fetchImpl, timeoutMs) {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", query);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const response = await timedFetch(fetchImpl, url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } }, timeoutMs);
  if (!response.ok) throw new Error(`Census geocoder HTTP ${response.status}`);
  const data = await response.json();
  const match = data?.result?.addressMatches?.[0];
  if (!match?.coordinates) return null;
  return normalizeGeocodeResult({ lat: match.coordinates.y, lon: match.coordinates.x, label: match.matchedAddress || query, provider: "U.S. Census Geocoder" });
}

async function geocodeNominatim(query, fetchImpl, timeoutMs) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("q", query);
  const response = await timedFetch(fetchImpl, url, {
    headers: { Accept: "application/json", "Accept-Language": "en-US,en;q=0.8", "User-Agent": USER_AGENT },
  }, timeoutMs);
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

async function geocodePlace(query, options) {
  const attempts = [
    () => geocodeGoogle(query, options.googleApiKey, options.fetchImpl, options.sourceTimeoutMs),
    () => geocodeCensus(query, options.fetchImpl, options.sourceTimeoutMs),
    () => geocodeNominatim(query, options.fetchImpl, options.sourceTimeoutMs),
  ];
  const promises = attempts.map(async (attempt) => {
    const result = await attempt();
    if (!result) throw new Error("No result");
    return result;
  });
  try {
    return await Promise.any(promises);
  } catch (error) {
    const failure = new Error("No matching U.S. location was found.");
    failure.failures = error instanceof AggregateError ? error.errors.map((item) => clean(item?.message || item, 220)) : [];
    throw failure;
  }
}

export function registerFuelAtlasRoutes(app, {
  googleApiKey = "",
  fetchImpl = globalThis.fetch,
  overpassEndpoints = DEFAULT_OVERPASS_ENDPOINTS,
  sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
  hardDeadlineMs = DEFAULT_HARD_DEADLINE_MS,
  enableEpa = true,
  enableGoogle = true,
  epaSearches = FRS_SEARCHES,
  googleSearches = GOOGLE_SEARCHES,
} = {}) {
  const options = {
    googleApiKey,
    fetchImpl,
    overpassEndpoints,
    sourceTimeoutMs: Math.max(25, Number(sourceTimeoutMs) || DEFAULT_SOURCE_TIMEOUT_MS),
    hardDeadlineMs: Math.max(50, Number(hardDeadlineMs) || DEFAULT_HARD_DEADLINE_MS),
    enableEpa,
    enableGoogle,
    searches: epaSearches,
    googleSearches,
  };

  app.get("/api/fuel-atlas/search", async (req, res) => {
    const requestStartedAt = Date.now();
    const bounds = parseFuelAtlasBounds(req.query);
    if (!bounds.ok) return res.status(bounds.status).json(bounds);

    const key = [bounds.south, bounds.west, bounds.north, bounds.east, bounds.zoom]
      .map((value) => Number(value).toFixed(3)).join(",");
    const fresh = cacheRead(searchCache, key);
    if (fresh) {
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=900");
      return res.json({ ...fresh.value, cached: true, stale: false, durationMs: Date.now() - requestStartedAt });
    }
    const stale = cacheRead(searchCache, key, { allowStale: true });

    const sourceOutcomes = await collectSearchSources(bounds, {
      ...options,
      searches: epaSearches,
      googleSearches,
    });
    const records = mergeFuelAtlasRecords(sourceOutcomes.map((outcome) => outcome.records), bounds);
    const successful = sourceOutcomes.filter((outcome) => outcome.status === "ok");
    const warnings = sourceOutcomes
      .filter((outcome) => ["error", "timeout"].includes(outcome.status))
      .map((outcome) => `${outcome.name}: ${outcome.error || "source did not respond before the deadline"}`);

    if (!records.length && !successful.length && stale?.value?.records?.length) {
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=86400");
      return res.json({
        ...stale.value,
        cached: true,
        stale: true,
        partial: true,
        warnings: [...(stale.value.warnings || []), ...warnings],
        durationMs: Date.now() - requestStartedAt,
      });
    }

    const payload = {
      ok: true,
      cached: false,
      stale: false,
      partial: warnings.length > 0,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - requestStartedAt,
      truncated: records.length >= MAX_RESULTS,
      records,
      sourceSummary: sourceOutcomes.map(({ records: _records, ...outcome }) => outcome),
      warnings,
      message: records.length
        ? `${records.length} specialized fuel-location records found.`
        : successful.length
          ? "The available public sources returned no specialized fuel-location records for this map area."
          : "No public source completed before the server deadline.",
    };

    if (records.length || successful.length) cacheWrite(searchCache, key, payload, SEARCH_CACHE_TTL_MS, SEARCH_CACHE_STALE_MS);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=900");
    return res.json(payload);
  });

  app.get("/api/fuel-atlas/geocode", async (req, res) => {
    const query = clean(req.query.q, 160);
    if (query.length < 2) return res.status(400).json({ ok: false, code: "QUERY_REQUIRED", message: "Enter a city, state, ZIP code, or address." });

    const key = query.toLowerCase();
    const cached = cacheRead(geocodeCache, key);
    if (cached) return res.json({ ok: true, cached: true, result: cached.value });

    try {
      const result = await geocodePlace(query, options);
      cacheWrite(geocodeCache, key, result, GEOCODE_CACHE_TTL_MS);
      return res.json({ ok: true, cached: false, result });
    } catch (error) {
      console.warn("Fuel Atlas geocode failed:", error.failures || error);
      return res.status(404).json({ ok: false, code: "LOCATION_NOT_FOUND", message: "No matching U.S. location was found." });
    }
  });
}
