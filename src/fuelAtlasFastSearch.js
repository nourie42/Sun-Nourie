import { parseFuelAtlasBounds } from "./fuelAtlasRoutes.js";

const ECHO_ENDPOINT = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/ArcGIS/rest/services/ECHO_All_Media_Facilities/FeatureServer/0/query";
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_STALE_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 180;
const DEFAULT_SOURCE_TIMEOUT_MS = 6000;
const DEFAULT_HARD_DEADLINE_MS = 7000;
const MAX_RESULTS = 2000;
const USER_AGENT = "FuelIQ-Fuel-Atlas/2.1 (+https://github.com/nourie42/Sun-Nourie)";

const INDUSTRY_CODES = [
  "424710", // Petroleum bulk stations and terminals
  "424720", // Petroleum product merchant wholesalers outside bulk terminals
  "454310", "454311", "454312", "454319", // prior fuel-dealer codes
  "457210", // 2022 fuel dealers, including heating-oil and propane delivery
];
const NAME_TERMS = [
  "HEATING OIL", "FUEL OIL", "PETROLEUM", "PROPANE", "TERMINAL", "BULK", "CARDLOCK", "FUEL DISTRIBUT",
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

const SPECIALTY_RE = /\b(heating[ _-]?oil|fuel[ _-]?oil|petroleum|propane|\blpg\b|terminal|bulk(?:\s+(?:fuel|oil|petroleum|plant|storage))?|tank[ _-]?farm|fuel depot|oil depot|cardlock|commercial fuel|fleet fuel|fuel distributor|petroleum distributor|fuel delivery|oil company|fuel company|petroleum products?|diesel distributor|fuel storage|oil storage|lubricants?)\b/i;
const RETAIL_RE = /\b(gas station|service station|filling station|convenience(?: store)?|food mart|quick mart|travel center|travel plaza|truck stop|speedway|sheetz|wawa|racetrac|race trac|circle k|7-eleven|7-11|quiktrip|murphy usa|pilot|flying j|love'?s|costco|sam'?s club|bj'?s|kroger|walmart)\b/i;
const NON_FUEL_RE = /\b(oil change|quick lube|jiffy lube|automotive|auto repair|car wash|restaurant|airport|solar|electric utility|natural gas utility)\b/i;

const cache = new Map();
let discoveredGoogleKey = "";
let googleKeyCheckedAt = 0;

function clean(value, max = 600) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function timedFetch(fetchImpl, url, init = {}, timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const upstream = init.signal;
  const onAbort = () => controller.abort();
  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener("abort", onAbort, { once: true });
  }
  return fetchImpl(url, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    upstream?.removeEventListener?.("abort", onAbort);
  });
}

function cacheRead(key, allowStale = false) {
  const hit = cache.get(key);
  if (!hit) return null;
  const now = Date.now();
  if (hit.freshUntil > now) return { value: hit.value, stale: false };
  if (allowStale && hit.staleUntil > now) return { value: hit.value, stale: true };
  cache.delete(key);
  return null;
}

function cacheWrite(key, value) {
  if (cache.has(key)) cache.delete(key);
  while (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  const now = Date.now();
  cache.set(key, { value, freshUntil: now + CACHE_TTL_MS, staleUntil: now + CACHE_STALE_MS });
}

export function clearFuelAtlasFastCache() {
  cache.clear();
  discoveredGoogleKey = "";
  googleKeyCheckedAt = 0;
}

function classify(name, naics = "", hint = "") {
  const text = `${name} ${hint}`.toLowerCase();
  if (/heating[ _-]?oil|fuel[ _-]?oil/.test(text)) return "heating_oil";
  if (/propane|\blpg\b/.test(text)) return "propane";
  if (/terminal|tank[ _-]?farm|fuel depot|oil depot/.test(text)) return "terminal";
  if (/bulk|cardlock|commercial fuel|fleet fuel/.test(text) || /424710/.test(naics)) return "bulk_plant";
  if (/457210|45431[0129]?/.test(naics)) return "heating_oil";
  return "distributor";
}

function industryCodeMatch(naics) {
  return INDUSTRY_CODES.some((code) => String(naics || "").includes(code));
}

function isSpecializedName(name, { naics = "", hint = "", allowHint = false } = {}) {
  const value = clean(name, 400);
  if (!value) return false;
  const codeMatch = industryCodeMatch(naics);
  const specialty = SPECIALTY_RE.test(value) || (allowHint && SPECIALTY_RE.test(hint));
  if (NON_FUEL_RE.test(value) && !SPECIALTY_RE.test(value)) return false;
  if (RETAIL_RE.test(value) && !SPECIALTY_RE.test(value) && !codeMatch) return false;
  return codeMatch || specialty;
}

function echoWhereClause() {
  const codeClauses = INDUSTRY_CODES.map((code) => `fac_naics_codes LIKE '%${code}%'`);
  const nameClauses = NAME_TERMS.map((term) => `UPPER(fac_name) LIKE '%${term}%'`);
  return `(${[...codeClauses, ...nameClauses].join(" OR ")})`;
}

function normalizeEchoFeature(feature) {
  const a = feature?.attributes || feature?.properties || {};
  const name = clean(a.fac_name, 300);
  const naics = clean(a.fac_naics_codes, 4000);
  if (!isSpecializedName(name, { naics })) return null;
  const lat = Number(a.fac_lat ?? feature?.geometry?.y ?? feature?.geometry?.coordinates?.[1]);
  const lon = Number(a.fac_long ?? feature?.geometry?.x ?? feature?.geometry?.coordinates?.[0]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const registryId = clean(a.registry_id, 100);
  const sourceUrl = registryId
    ? `https://echo.epa.gov/detailed-facility-report?fid=${encodeURIComponent(registryId)}`
    : ECHO_ENDPOINT;
  return {
    id: `echo-${registryId || `${lat}-${lon}-${name}`}`,
    name,
    owner: "",
    operator: "",
    phone: "",
    email: "",
    website: "",
    street: clean(a.fac_street, 700),
    city: clean(a.fac_city, 180),
    state: clean(a.fac_state, 40),
    zip: clean(a.fac_zip, 30),
    lat,
    lon,
    type: classify(name, naics),
    source: "EPA ECHO / Facility Registry Service",
    sourceUrl,
    sourceId: registryId,
    sources: [{ name: "EPA ECHO / Facility Registry Service", url: sourceUrl }],
  };
}

async function searchEcho(bounds, { fetchImpl, endpoint, timeoutMs }) {
  const form = new URLSearchParams({
    where: echoWhereClause(),
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "registry_id,fac_name,fac_street,fac_city,fac_state,fac_zip,fac_lat,fac_long,fac_naics_codes,fac_sic_codes",
    returnGeometry: "false",
    resultRecordCount: "2000",
    cacheHint: "true",
    f: "json",
  });
  const response = await timedFetch(fetchImpl, endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": USER_AGENT,
    },
    body: form.toString(),
  }, timeoutMs);
  if (!response.ok) throw new Error(`EPA ECHO HTTP ${response.status}`);
  const data = await response.json();
  if (data?.error) throw new Error(`EPA ECHO ${clean(data.error.message || "query failed", 220)}`);
  if (!Array.isArray(data?.features)) throw new Error("EPA ECHO returned an invalid response.");
  return data.features.map(normalizeEchoFeature).filter(Boolean);
}

async function resolveGoogleKey({ directKey, legacyPort, fetchImpl }) {
  if (directKey) return directKey;
  if (discoveredGoogleKey) return discoveredGoogleKey;
  const now = Date.now();
  if (!legacyPort || now - googleKeyCheckedAt < 60_000) return "";
  googleKeyCheckedAt = now;
  try {
    const response = await timedFetch(fetchImpl, `http://127.0.0.1:${legacyPort}/api/config`, { headers: { Accept: "application/json" } }, 1500);
    if (!response.ok) return "";
    const data = await response.json();
    discoveredGoogleKey = clean(data?.googleMapsApiKey, 500);
    return discoveredGoogleKey;
  } catch {
    return "";
  }
}

function searchGeometry(bounds) {
  const lat = (bounds.south + bounds.north) / 2;
  const lon = (bounds.west + bounds.east) / 2;
  const milesLat = (bounds.north - bounds.south) * 69;
  const milesLon = (bounds.east - bounds.west) * 69 * Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const radiusMiles = Math.max(3, Math.min(31, Math.ceil(Math.hypot(milesLat / 2, milesLon / 2))));
  return { lat, lon, radiusMeters: Math.min(50_000, Math.ceil(radiusMiles * 1609.344)) };
}

function normalizeGooglePlace(item, search) {
  const name = clean(item?.name, 300);
  const types = Array.isArray(item?.types) ? item.types : [];
  if (types.includes("gas_station") || !isSpecializedName(name, { hint: search.query, allowHint: true })) return null;
  const lat = Number(item?.geometry?.location?.lat);
  const lon = Number(item?.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
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
    type: search.type || classify(name, "", search.query),
    source: "Google Places",
    sourceUrl,
    sourceId: placeId,
    sources: [{ name: "Google Places", url: sourceUrl }],
  };
}

async function searchGoogle(bounds, { fetchImpl, apiKey, timeoutMs, searches }) {
  if (!apiKey) return { records: [], skipped: true };
  const geometry = searchGeometry(bounds);
  const requests = searches.map(async (search) => {
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", search.query);
    url.searchParams.set("location", `${geometry.lat},${geometry.lon}`);
    url.searchParams.set("radius", String(geometry.radiusMeters));
    url.searchParams.set("key", apiKey);
    const response = await timedFetch(fetchImpl, url, { headers: { Accept: "application/json" } }, timeoutMs);
    if (!response.ok) throw new Error(`Google Places HTTP ${response.status}`);
    const data = await response.json();
    if (!["OK", "ZERO_RESULTS"].includes(data?.status)) throw new Error(`Google Places ${clean(data?.status || "UNKNOWN", 80)}`);
    return (data.results || []).filter((item) => item.business_status !== "CLOSED_PERMANENTLY")
      .map((item) => normalizeGooglePlace(item, search)).filter(Boolean);
  });
  const settled = await Promise.allSettled(requests);
  const records = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!records.length && settled.every((result) => result.status === "rejected")) throw new Error("Google Places did not respond.");
  return { records, skipped: false };
}

function normalizedName(value) {
  return clean(value, 400).toLowerCase()
    .replace(/\b(incorporated|corporation|company|limited|llc|inc|corp|co|ltd)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function insideBounds(record, bounds) {
  const padLat = Math.max(0.02, bounds.latSpan * 0.05);
  const padLon = Math.max(0.02, bounds.lonSpan * 0.05);
  return record.lat >= bounds.south - padLat && record.lat <= bounds.north + padLat
    && record.lon >= bounds.west - padLon && record.lon <= bounds.east + padLon;
}

function mergeSources(a = [], b = []) {
  const seen = new Set();
  return [...a, ...b].filter((source) => {
    const key = `${clean(source?.name)}|${clean(source?.url)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeRecords(groups, bounds) {
  const output = [];
  for (const raw of groups.flat()) {
    if (!raw || !insideBounds(raw, bounds)) continue;
    const name = normalizedName(raw.name);
    if (!name) continue;
    const duplicate = output.find((item) => {
      if (normalizedName(item.name) !== name) return false;
      return Math.abs(item.lat - raw.lat) < 0.002 && Math.abs(item.lon - raw.lon) < 0.002;
    });
    if (duplicate) {
      for (const field of ["owner", "operator", "phone", "email", "website", "street", "city", "state", "zip"]) {
        if (!duplicate[field] && raw[field]) duplicate[field] = raw[field];
      }
      duplicate.sources = mergeSources(duplicate.sources, raw.sources);
      duplicate.source = duplicate.sources.map((source) => source.name).join("; ");
      continue;
    }
    output.push({ ...raw, sources: mergeSources([], raw.sources) });
    if (output.length >= MAX_RESULTS) break;
  }
  return output.sort((a, b) => a.name.localeCompare(b.name));
}

async function runSource(name, task) {
  const started = Date.now();
  try {
    const result = await task();
    const records = Array.isArray(result) ? result : result.records || [];
    return { name, status: result?.skipped ? "skipped" : "ok", count: records.length, elapsedMs: Date.now() - started, records };
  } catch (error) {
    return { name, status: error?.name === "AbortError" ? "timeout" : "error", count: 0, elapsedMs: Date.now() - started, records: [], error: clean(error?.message || error, 260) };
  }
}

export function registerFuelAtlasFastSearchRoute(app, {
  googleApiKey = "",
  legacyPort = 0,
  fetchImpl = globalThis.fetch,
  echoEndpoint = ECHO_ENDPOINT,
  sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
  hardDeadlineMs = DEFAULT_HARD_DEADLINE_MS,
  googleSearches = GOOGLE_SEARCHES,
} = {}) {
  app.get("/api/fuel-atlas/search", async (req, res) => {
    const started = Date.now();
    const bounds = parseFuelAtlasBounds(req.query);
    if (!bounds.ok) return res.status(bounds.status).json(bounds);
    const key = [bounds.south, bounds.west, bounds.north, bounds.east, bounds.zoom].map((value) => Number(value).toFixed(3)).join(",");
    const fresh = cacheRead(key);
    if (fresh) return res.json({ ...fresh.value, cached: true, stale: false, durationMs: Date.now() - started });
    const stale = cacheRead(key, true);

    const apiKey = await resolveGoogleKey({ directKey: googleApiKey, legacyPort, fetchImpl });
    const definitions = [
      { name: "EPA ECHO", task: () => searchEcho(bounds, { fetchImpl, endpoint: echoEndpoint, timeoutMs: Math.min(sourceTimeoutMs, 6000) }) },
      { name: "Google Places", task: () => searchGoogle(bounds, { fetchImpl, apiKey, timeoutMs: Math.min(sourceTimeoutMs, 5000), searches: googleSearches }) },
    ];
    const outcomes = [];
    const pending = new Set(definitions.map((item) => item.name));
    const tasks = definitions.map(async (definition) => {
      const outcome = await runSource(definition.name, definition.task);
      pending.delete(definition.name);
      outcomes.push(outcome);
      return outcome;
    });
    let timer;
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise((resolve) => { timer = setTimeout(resolve, Math.max(100, hardDeadlineMs)); }),
    ]);
    clearTimeout(timer);
    for (const name of pending) outcomes.push({ name, status: "timeout", count: 0, elapsedMs: hardDeadlineMs, records: [], error: "Source deadline reached." });

    const records = mergeRecords(outcomes.map((outcome) => outcome.records), bounds);
    const successful = outcomes.filter((outcome) => outcome.status === "ok");
    const warnings = outcomes.filter((outcome) => ["error", "timeout"].includes(outcome.status))
      .map((outcome) => `${outcome.name}: ${outcome.error || "unavailable"}`);

    if (!records.length && !successful.length && stale?.value?.records?.length) {
      return res.json({ ...stale.value, cached: true, stale: true, partial: true, warnings: [...(stale.value.warnings || []), ...warnings], durationMs: Date.now() - started });
    }

    const payload = {
      ok: true,
      cached: false,
      stale: false,
      partial: warnings.length > 0,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      truncated: records.length >= MAX_RESULTS,
      records,
      sourceSummary: outcomes.map(({ records: _records, ...outcome }) => outcome),
      warnings,
      message: records.length
        ? `${records.length} specialized fuel-location records found.`
        : successful.length
          ? "The completed public sources returned no specialized fuel locations for this exact map area."
          : "No public source completed before the bounded server deadline.",
    };
    if (records.length || successful.length) cacheWrite(key, payload);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=900");
    return res.json(payload);
  });
}
