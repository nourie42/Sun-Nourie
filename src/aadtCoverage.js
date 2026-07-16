import express from "express";

const CACHE_TTL_MS = 30 * 60 * 1000;
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;
const RESULT_CACHE = new Map();
const LAYER_CACHE = new Map();
const MAX_DYNAMIC_RADIUS_MI = 8;
const MAX_RESULTS = 60;
const USER_AGENT = "FuelIQ/5.0 expanded official AADT coverage";

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const STATE_CODES = new Map(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));

const CURATED_SERVICES = {
  NC: ["https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0"],
  VA: ["https://services.arcgis.com/p5v98VHDX9Atv3l7/arcgis/rest/services/VDOTTrafficVolume/FeatureServer/0"],
  DC: ["https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Transportation_TrafficVolume_WebMercator/MapServer/4"],
};

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(a));
}

async function fetchJson(url, init = {}, timeoutMs = 14000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...(init.headers || {}) },
    });
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    const data = await response.json();
    if (data?.error) throw new Error(clean(data.error.message || JSON.stringify(data.error), 500));
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function pruneCache(map, max = 250) {
  const now = Date.now();
  for (const [key, value] of map) if (!value || value.expiresAt <= now) map.delete(key);
  while (map.size > max) map.delete(map.keys().next().value);
}

function stateCodeFromAddress(address = {}) {
  const iso = clean(address["ISO3166-2-lvl4"] || address["ISO3166-2-lvl3"], 20).toUpperCase();
  const isoMatch = iso.match(/US-([A-Z]{2})/);
  if (isoMatch && STATE_NAMES[isoMatch[1]]) return isoMatch[1];
  const raw = clean(address.state || address.region, 100);
  if (/^[A-Za-z]{2}$/.test(raw) && STATE_NAMES[raw.toUpperCase()]) return raw.toUpperCase();
  return STATE_CODES.get(raw.toLowerCase()) || "";
}

async function reverseState(lat, lon) {
  const params = new URLSearchParams({ format: "jsonv2", addressdetails: "1", zoom: "6", lat: String(lat), lon: String(lon) });
  const data = await fetchJson(`https://nominatim.openstreetmap.org/reverse?${params}`, {}, 12000);
  return stateCodeFromAddress(data?.address || {});
}

async function legacyNearby(legacyPort, lat, lon, radiusMi) {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), radiusMi: String(radiusMi) });
  const data = await fetchJson(`http://127.0.0.1:${legacyPort}/aadt/nearby?${params}`, {}, 26000);
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    state: clean(data?.state, 2).toUpperCase(),
    items: items.map((item) => ({ ...item, discovery_method: "configured official DOT layer", source_title: item.source_title || `${clean(data?.state, 2).toUpperCase()} official AADT layer` })),
  };
}

function catalogScore(item, stateCode, stateName) {
  const text = `${item?.title || ""} ${item?.snippet || ""} ${(item?.tags || []).join(" ")} ${item?.owner || ""}`.toLowerCase();
  let score = 0;
  if (/\baadt\b|annual average daily traffic|annual average daily volume/.test(text)) score += 55;
  if (/traffic volume|traffic count|traffic flow/.test(text)) score += 30;
  if (/department of transportation|\bdot\b|transportation department|highway division/.test(text)) score += 28;
  if (text.includes(stateName.toLowerCase())) score += 18;
  if (new RegExp(`\b${stateCode.toLowerCase()}\b`).test(text)) score += 6;
  if (/official|statewide|state highway/.test(text)) score += 8;
  if (/sample|tutorial|test|demo|deprecated|archive/.test(text)) score -= 28;
  return score;
}

async function searchArcgisCatalog(stateCode) {
  const stateName = STATE_NAMES[stateCode];
  if (!stateName) return [];
  const queries = [
    `type:"Feature Service" AND (AADT OR "Annual Average Daily Traffic" OR "Traffic Volume") AND ("${stateName}" OR ${stateCode})`,
    `type:"Map Service" AND (AADT OR "Traffic Count" OR "Traffic Volume") AND ("${stateName}" OR ${stateCode})`,
  ];
  const found = new Map();
  for (const query of queries) {
    const params = new URLSearchParams({ f: "json", num: "50", sortField: "modified", sortOrder: "desc", q: query });
    try {
      const data = await fetchJson(`https://www.arcgis.com/sharing/rest/search?${params}`, {}, 15000);
      for (const item of data?.results || []) {
        const url = clean(item?.url, 2000);
        if (!url || !/\/(FeatureServer|MapServer)(?:\/\d+)?\/?$/i.test(url)) continue;
        const score = catalogScore(item, stateCode, stateName);
        if (score < 40) continue;
        const prior = found.get(url);
        if (!prior || score > prior.score) found.set(url, { url, score, title: clean(item.title, 300), owner: clean(item.owner, 160) });
      }
    } catch {}
  }
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

function fieldText(field) {
  return `${field?.name || ""} ${field?.alias || ""}`.toUpperCase();
}

function isNumericField(field) {
  return /Integer|Double|Single|SmallInteger|OID/i.test(field?.type || "") || !field?.type;
}

function aadtFieldScore(field) {
  if (!isNumericField(field)) return -100;
  const text = fieldText(field);
  if (/TRUCK|PERCENT|PCT|FACTOR|RATE|GROWTH|OBJECTID|LENGTH|SHAPE/.test(text)) return -100;
  if (/\bAADT\b|ANNUAL AVERAGE DAILY TRAFFIC|ANNUAL_AVERAGE_DAILY_TRAFFIC/.test(text)) return 120;
  if (/AAWDT|WEEKDAY.*TRAFFIC/.test(text)) return 105;
  if (/\bADT\b|AVERAGE DAILY TRAFFIC|DAILY_TRAFFIC/.test(text)) return 95;
  if (/TRAFFIC.*VOLUME|VOLUME.*TRAFFIC|CURRENT.*VOLUME/.test(text)) return 75;
  if (/\bVOLUME\b|\bCOUNT\b/.test(text)) return 45;
  return -100;
}

function layerScore(meta = {}) {
  const fields = Array.isArray(meta.fields) ? meta.fields : [];
  const best = Math.max(-100, ...fields.map(aadtFieldScore));
  const text = `${meta.name || ""} ${meta.description || ""}`.toLowerCase();
  let score = best;
  if (/aadt|annual average daily traffic/.test(text)) score += 45;
  if (/traffic volume|traffic count/.test(text)) score += 25;
  if (!/esriGeometry(Point|Polyline)/i.test(meta.geometryType || "")) score -= 25;
  return score;
}

async function layerMetadata(url) {
  const data = await fetchJson(`${url.replace(/\/$/, "")}?f=json`, {}, 12000);
  return { ...data, url: url.replace(/\/$/, "") };
}

async function expandService(candidate) {
  const baseUrl = candidate.url.replace(/\/$/, "");
  if (/\/(FeatureServer|MapServer)\/\d+$/i.test(baseUrl)) {
    const meta = await layerMetadata(baseUrl);
    return [{ ...meta, catalogTitle: candidate.title, catalogOwner: candidate.owner }];
  }
  const service = await fetchJson(`${baseUrl}?f=json`, {}, 12000);
  const layers = Array.isArray(service?.layers) ? service.layers : [];
  const metas = await Promise.allSettled(layers.slice(0, 18).map((layer) => layerMetadata(`${baseUrl}/${layer.id}`)));
  return metas.filter((result) => result.status === "fulfilled").map((result) => ({ ...result.value, catalogTitle: candidate.title || clean(service?.serviceDescription || service?.name, 300), catalogOwner: candidate.owner }));
}

async function discoverLayers(stateCode) {
  pruneCache(LAYER_CACHE, 60);
  const cached = LAYER_CACHE.get(stateCode);
  if (cached && cached.expiresAt > Date.now()) return cached.layers;

  const curated = (CURATED_SERVICES[stateCode] || []).map((url) => ({ url, score: 200, title: `${STATE_NAMES[stateCode]} official traffic volume`, owner: "Configured official source" }));
  const discovered = await searchArcgisCatalog(stateCode);
  const candidates = [...curated, ...discovered].filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index).slice(0, 10);
  const settled = await Promise.allSettled(candidates.map(expandService));
  const layers = settled.flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .map((meta) => ({ ...meta, _score: layerScore(meta) }))
    .filter((meta) => meta._score >= 55)
    .sort((a, b) => b._score - a._score)
    .slice(0, 8);
  LAYER_CACHE.set(stateCode, { layers, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return layers;
}

function webMercatorToWgs84(x, y) {
  const lon = x / 20037508.34 * 180;
  let lat = y / 20037508.34 * 180;
  lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
  return { lat, lon };
}

function normalizeCoordinate(x, y) {
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
  const nx = Number(x), ny = Number(y);
  if (Math.abs(nx) <= 180 && Math.abs(ny) <= 90) return { lat: ny, lon: nx };
  if (Math.abs(nx) <= 21000000 && Math.abs(ny) <= 21000000) return webMercatorToWgs84(nx, ny);
  return null;
}

function geometryPoints(geometry = {}) {
  const points = [];
  const direct = normalizeCoordinate(geometry.x, geometry.y);
  if (direct) points.push(direct);
  for (const path of geometry.paths || []) for (const pair of path || []) {
    const point = normalizeCoordinate(pair?.[0], pair?.[1]);
    if (point) points.push(point);
  }
  for (const ring of geometry.rings || []) for (const pair of ring || []) {
    const point = normalizeCoordinate(pair?.[0], pair?.[1]);
    if (point) points.push(point);
  }
  return points;
}

function nearestGeometryPoint(geometry, siteLat, siteLon) {
  const points = geometryPoints(geometry);
  let best = null;
  for (const point of points) {
    const miles = distanceMiles(siteLat, siteLon, point.lat, point.lon);
    if (!best || miles < best.miles) best = { ...point, miles };
  }
  return best;
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function chooseAadt(attrs, fields) {
  const ranked = fields.map((field) => ({ field, score: aadtFieldScore(field) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  for (const { field } of ranked) {
    const value = numericValue(attrs?.[field.name]);
    if (value && value > 0 && value < 1000000) {
      const year = clean(field.name, 100).match(/20\d{2}/)?.[0] || clean(field.alias, 100).match(/20\d{2}/)?.[0] || "";
      return { aadt: Math.round(value), year };
    }
  }
  return null;
}

function chooseAttribute(attrs, patterns) {
  for (const [key, value] of Object.entries(attrs || {})) {
    const text = key.toUpperCase();
    if (patterns.some((pattern) => pattern.test(text)) && clean(value, 500)) return clean(value, 500);
  }
  return "";
}

function separateYear(attrs, fallback = "") {
  const yearValue = chooseAttribute(attrs, [/AADT.*YEAR/, /COUNT.*YEAR/, /^YEAR$/, /DATA.*YEAR/]);
  const match = clean(yearValue, 40).match(/20\d{2}/);
  return match?.[0] || fallback || null;
}

function featureToItem(feature, layer, stateCode, siteLat, siteLon) {
  const attrs = feature?.attributes || {};
  const aadt = chooseAadt(attrs, layer.fields || []);
  if (!aadt) return null;
  const point = nearestGeometryPoint(feature?.geometry || {}, siteLat, siteLon);
  if (!point || point.miles > MAX_DYNAMIC_RADIUS_MI + 0.2) return null;
  const route = chooseAttribute(attrs, [/ROUTE.*NAME/, /^ROUTE$/, /ROAD.*NAME/, /STREET.*NAME/, /^STREET$/, /^ROAD$/, /RTE.*NAME/, /HIGHWAY/, /^NAME$/]);
  const location = chooseAttribute(attrs, [/LOCATION/, /DESCRIPTION/, /FROM.*TO/, /BEGIN/, /END/, /STATION/, /COUNT.*ID/, /SITE.*ID/]);
  const stationId = chooseAttribute(attrs, [/STATION.*ID/, /COUNT.*ID/, /LOCATION.*ID/, /^OBJECTID$/]);
  return {
    lat: point.lat,
    lon: point.lon,
    miles: Number(point.miles.toFixed(3)),
    aadt: aadt.aadt,
    year: separateYear(attrs, aadt.year),
    route: route || layer.name || layer.catalogTitle || "Official traffic-volume segment",
    location: location || stationId || "Official roadway count segment",
    station_id: stationId || null,
    source_url: layer.url,
    source_title: layer.catalogTitle || layer.name || `${STATE_NAMES[stateCode]} public traffic-volume layer`,
    source_owner: layer.catalogOwner || null,
    state: stateCode,
    discovery_method: "expanded official/public ArcGIS traffic-layer search",
  };
}

async function queryLayer(layer, stateCode, lat, lon, radiusMi) {
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(Math.round(radiusMi * 1609.344)),
    units: "esriSRUnit_Meter",
    outSR: "4326",
    resultRecordCount: "300",
  });
  const data = await fetchJson(`${layer.url}/query?${params}`, {}, 17000);
  return (data?.features || []).map((feature) => featureToItem(feature, layer, stateCode, lat, lon)).filter(Boolean);
}

function dedupe(items) {
  const output = [];
  for (const item of items.filter(Boolean).sort((a, b) => Number(a.miles) - Number(b.miles))) {
    const duplicate = output.find((prior) => {
      const close = distanceMiles(Number(item.lat), Number(item.lon), Number(prior.lat), Number(prior.lon)) < 0.025;
      const sameRoute = clean(item.route, 200).toLowerCase() === clean(prior.route, 200).toLowerCase();
      const closeAadt = Math.abs(Number(item.aadt) - Number(prior.aadt)) <= Math.max(100, Number(item.aadt) * 0.03);
      return close && (sameRoute || closeAadt);
    });
    if (!duplicate) output.push(item);
    else if (!duplicate.source_url && item.source_url) Object.assign(duplicate, item);
  }
  return output.slice(0, MAX_RESULTS);
}

async function expandedNearby({ legacyPort, lat, lon, requestedRadiusMi }) {
  const warnings = [];
  let legacy = { state: "", items: [] };
  try {
    legacy = await legacyNearby(legacyPort, lat, lon, Math.max(5, requestedRadiusMi));
  } catch (error) {
    warnings.push(`Configured DOT lookup: ${clean(error?.message || error, 300)}`);
  }

  let stateCode = "";
  try { stateCode = await reverseState(lat, lon); }
  catch (error) { warnings.push(`State lookup: ${clean(error?.message || error, 300)}`); }
  stateCode ||= legacy.state;

  const legacyItems = (legacy.items || []).filter((item) => Number.isFinite(Number(item.aadt)) && Number.isFinite(Number(item.miles)));
  let dynamicItems = [];
  let layers = [];
  if (stateCode && legacyItems.length < 3) {
    try {
      layers = await discoverLayers(stateCode);
      const settled = await Promise.allSettled(layers.map((layer) => queryLayer(layer, stateCode, lat, lon, MAX_DYNAMIC_RADIUS_MI)));
      for (const result of settled) {
        if (result.status === "fulfilled") dynamicItems.push(...result.value);
        else warnings.push(`Expanded AADT layer: ${clean(result.reason?.message || result.reason, 220)}`);
      }
    } catch (error) {
      warnings.push(`Expanded AADT discovery: ${clean(error?.message || error, 300)}`);
    }
  }

  const items = dedupe([...legacyItems, ...dynamicItems]);
  const nearestThree = items.slice(0, 3);
  const effectiveRadius = nearestThree.length ? Math.max(requestedRadiusMi, ...nearestThree.map((item) => Number(item.miles) || 0)) : requestedRadiusMi;
  return {
    ok: true,
    count: items.length,
    items,
    state: stateCode || legacy.state || null,
    requested_radius_mi: requestedRadiusMi,
    search_radius_mi: Number(Math.min(MAX_DYNAMIC_RADIUS_MI, Math.max(requestedRadiusMi, effectiveRadius)).toFixed(2)),
    expanded_search: legacyItems.length < 3,
    sources_checked: [...new Set([
      ...legacyItems.map((item) => item.source_title || item.source_url).filter(Boolean),
      ...layers.map((layer) => layer.catalogTitle || layer.name || layer.url).filter(Boolean),
    ])],
    warnings: [...new Set(warnings)].slice(0, 12),
  };
}

export function registerExpandedAadtRoutes(app, options = {}) {
  const legacyPort = Number(options.legacyPort);
  const router = express.Router();

  router.get("/aadt/nearby", async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const requestedRadiusMi = clamp(Number(req.query.radiusMi) || 1.5, 0.1, 5);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ ok: false, status: "lat/lon required", items: [] });

    pruneCache(RESULT_CACHE, 250);
    const key = `${lat.toFixed(4)},${lon.toFixed(4)},${requestedRadiusMi.toFixed(1)}`;
    const cached = RESULT_CACHE.get(key);
    if (cached && cached.expiresAt > Date.now() && req.query.force !== "1") {
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.json({ ...cached.value, cached: true });
    }

    try {
      const value = await expandedNearby({ legacyPort, lat, lon, requestedRadiusMi });
      RESULT_CACHE.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.json(value);
    } catch (error) {
      return res.status(500).json({ ok: false, status: "Expanded AADT search failed", detail: clean(error?.message || error, 900), items: [] });
    }
  });

  app.use(router);
}
