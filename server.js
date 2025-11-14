// server.js — Fuel IQ API (fix pack 2025-10-03)
// Changes in this build:
//  - Autocomplete endpoint supports optional location bias (lat/lon/radius) to improve suggestions.
//  - Strict AADT selection: use DOT station(s) on the ENTERED ROAD ONLY. If none found, use hard fallback.
//    (We no longer pick “nearest DOT station on a different road”.)
//  - Client can pass enteredRoad; server extracts a road from the entered address if not provided.
//  - Everything else preserved: competitors layer, PDF report, math, STOP chip only for true fallback.

import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import PDFDocument from "pdfkit";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const NORMALIZED_FILE = path.join(DATA_DIR, "normalized-addresses.json");

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    cacheControl: true,
    maxAge: 0,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
  })
);
app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/health", (_req, res) => res.json({ ok: true }));

const UA = "FuelEstimator/3.4 (+your-app)";
const CONTACT = process.env.OVERPASS_CONTACT || UA;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const NOMINATIM_CACHE = new Map();
const NOMINATIM_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const NOMINATIM_CACHE_LIMIT = 200;

const GOOGLE_DETAIL_CACHE = new Map();
const GOOGLE_DETAIL_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const GOOGLE_DETAIL_CACHE_LIMIT = 200;

let _cachedFetch = null;
async function getFetch() {
  if (typeof fetch === "function") return fetch;
  if (_cachedFetch) return _cachedFetch;
  const mod = await import("node-fetch");
  _cachedFetch = mod.default;
  return _cachedFetch;
}
async function fetchWithTimeout(url, opts = {}, timeoutMs = 25000) {
  const f = await getFetch();
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), timeoutMs);
  try { return await f(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(id); }
}

function getCached(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expires > Date.now()) return hit.value;
  map.delete(key);
  return null;
}

function setCached(map, key, value, ttlMs, limit = 0) {
  if (!key) return;
  if (map.has(key)) map.delete(key);
  if (limit && map.size >= limit) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, { value, expires: Date.now() + Math.max(ttlMs, 0) });
}

/* -------------------- CSV (developments) -------------------- */
let csvDevData = [];
function parseCsvString(csv) {
  const rows = []; let row = [], value = "", inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"' && csv[i + 1] === '"') { value += '"'; i++; }
    else if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { row.push(value); value = ""; }
    else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      row.push(value); value = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else { value += c; }
  }
  if (value !== "" || row.length > 0) { row.push(value); rows.push(row); }
  return rows;
}
function transformCsvData(rows) {
  if (!rows?.length) return [];
  const headers = rows[0], data = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i], obj = {};
    headers.forEach((h, idx) => (obj[h] = r[idx]));
    const town = obj["City/County"] || obj["City/County.1"] || obj["City/County.2"] || "";
    const state = obj["State"] || obj["State.1"] || "";
    const name = obj["Brand"] || obj["Brand.1"] || obj["Name"] || "";
    const status = obj["Status"] || obj["Phase"] || "";
    const details = obj["Details"] || obj["Details.1"] || obj["Notes"] || "";
    const date = obj["Date"] || obj["Date.1"] || "";
    if (!town && !state) continue;
    data.push({ name, town, state, status, details, date });
  }
  return data;
}
async function loadCsvDevData() {
  try {
    const csvPath = path.join(__dirname, "public", "developments_data.csv");
    const file = await fs.readFile(csvPath, "utf8");
    const rows = parseCsvString(file);
    csvDevData = transformCsvData(rows);
    console.log(`Loaded ${csvDevData.length} development rows from CSV`);
  } catch {
    console.warn("No developments_data.csv loaded (optional).");
    csvDevData = [];
  }
}
function norm(s) { return String(s || "").trim().toLowerCase(); }
function matchCsvDevelopments(city, county, state) {
  if (!csvDevData.length) return [];
  const st = norm(state), cty = norm(city), cnty = norm(county);
  return csvDevData.filter((r) => {
    const rState = norm(r.state), rTown = norm(r.town);
    if (!rState || !rTown) return false;
    if (rState !== st) return false;
    return (cty && (rTown === cty || rTown.includes(cty))) ||
           (cnty && (rTown === cnty || rTown.includes(cnty)));
  });
}
loadCsvDevData().catch(() => {});

async function appendNormalizedAddress(entry) {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    let existing = [];
    try {
      const raw = await fs.readFile(NORMALIZED_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch {}
    existing.unshift(entry);
    if (existing.length > 500) existing = existing.slice(0, 500);
    await fs.writeFile(NORMALIZED_FILE, JSON.stringify(existing, null, 2));
  } catch (err) {
    console.error("Failed to store normalized address", err);
    throw err;
  }
}

/* ------------------------------ Utils ------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toMiles = (m) => m / 1609.344;
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, t = (d) => (d * Math.PI) / 180;
  const dLat = t(lat2 - lat1), dLon = t(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function distMiles(a, b, c, d) { return toMiles(haversine(a, b, c, d)); }

/* -------------------------- Geocoding helpers -------------------------- */
function tryParseLatLng(address) {
  const m = String(address || "").trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: `${lat}, ${lon}` };
}
async function geocodeCensus(q) {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 15000);
  if (!r.ok) throw new Error(`Census ${r.status}`);
  const d = await r.json();
  const m = d?.result?.addressMatches?.[0];
  if (!m?.coordinates) throw new Error("Census: no match");
  return { lat: +m.coordinates.y, lon: +m.coordinates.x, label: m.matchedAddress || q };
}
async function geocodeNominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 15000);
  const a = await r.json();
  if (!a?.length) throw new Error("Nominatim: no result");
  return { lat: +a[0].lat, lon: +a[0].lon, label: a[0].display_name };
}

function formatNominatimDisplay(row) {
  if (!row) return "";
  const addr = row.address || {};
  const street = (() => {
    const road = addr.road || addr.residential || addr.pedestrian || addr.path || addr.cycleway || addr.footway;
    const house = addr.house_number || addr.house_name || "";
    const parts = [];
    if (house) parts.push(String(house));
    if (road) parts.push(String(road));
    return parts.join(" ").trim();
  })();
  const locality = addr.city || addr.town || addr.village || addr.hamlet || addr.county || "";
  const regionParts = [locality, addr.state || addr.state_district || "", addr.postcode || ""].filter(Boolean);
  const tail = regionParts.join(", ");
  if (street && tail) return `${street}, ${tail}`;
  if (street) return street;
  if (tail) return tail;
  return row.display_name || "";
}

function buildOsmNormalized(row) {
  if (!row) return null;
  const addr = row.address || {};
  const lat = Number(row.lat), lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const number = addr.house_number || addr.house_name || "";
  const road = addr.road || addr.residential || addr.pedestrian || addr.path || addr.cycleway || addr.footway || "";
  const line1Raw = [number, road].filter(Boolean).join(" ").trim();
  const city = addr.city || addr.town || addr.village || addr.hamlet || "";
  const county = addr.county || "";
  const state = addr.state || addr.state_district || "";
  const postcode = addr.postcode || "";
  const countryCode = addr.country_code ? String(addr.country_code).toUpperCase() : "";
  const country = countryCode || addr.country || "";
  const formatted = row.display_name || [line1Raw, city, state, postcode].filter(Boolean).join(", ");
  const line1 = line1Raw || (formatted.split(",")[0] || "").trim();
  return {
    formatted,
    line1,
    city,
    county,
    state,
    postcode,
    country,
    lat,
    lon,
    source: "OSM",
    place_id: row.place_id || null,
    raw: addr,
  };
}
function findComponent(comps, ...types) {
  if (!Array.isArray(comps)) return "";
  for (const type of types) {
    const comp = comps.find((c) => Array.isArray(c.types) && c.types.includes(type));
    if (comp) return comp.long_name || comp.short_name || "";
  }
  return "";
}
function buildNormalizedFromGoogle(result) {
  if (!result) return null;
  const comps = Array.isArray(result.address_components) ? result.address_components : [];
  const loc = result.geometry?.location;
  const lat = Number(loc?.lat);
  const lon = Number(loc?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const streetNumber = findComponent(comps, "street_number");
  const route = findComponent(comps, "route");
  const line1 = [streetNumber, route].filter(Boolean).join(" ").trim();
  const city = findComponent(
    comps,
    "locality",
    "postal_town",
    "sublocality",
    "administrative_area_level_3",
    "administrative_area_level_2"
  );
  const county = findComponent(comps, "administrative_area_level_2");
  const stateComp = (() => {
    const comp = Array.isArray(comps)
      ? comps.find((c) => Array.isArray(c.types) && c.types.includes("administrative_area_level_1"))
      : null;
    if (!comp) return "";
    return comp.short_name || comp.long_name || "";
  })();
  const postcode = findComponent(comps, "postal_code");
  const countryComp = Array.isArray(comps)
    ? comps.find((c) => Array.isArray(c.types) && c.types.includes("country"))
    : null;
  const country = countryComp?.short_name || countryComp?.long_name || "";
  const formatted = result.formatted_address || [line1, city, stateComp, postcode].filter(Boolean).join(", ");
  return {
    formatted,
    line1: line1 || (formatted.split(",")[0] || "").trim(),
    city,
    county,
    state: stateComp,
    postcode,
    country,
    lat,
    lon,
    source: "Google",
    place_id: result.place_id || null,
    raw: { components: comps },
  };
}
async function reverseAdmin(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&addressdetails=1&lat=${lat}&lon=${lon}`;
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 15000);
    const j = await r.json();
    const a = j?.address || {};
    return {
      city: a.city || a.town || a.village || a.hamlet || "",
      county: a.county || "",
      state: a.state || a.region || "",
    };
  } catch {
    return { city: "", county: "", state: "" };
  }
}

/* --------------------------- State detection --------------------------- */
const STATE_CODE = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO",
  "connecticut":"CT","delaware":"DE","district of columbia":"DC","washington, dc":"DC","dc":"DC",
  "florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA",
  "kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA",
  "michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE",
  "nevada":"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY",
  "north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA",
  "rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX",
  "utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY"
};
function toStateCode(name) {
  const s = (name || "").trim().toLowerCase();
  return STATE_CODE[s] || (s.length === 2 ? s.toUpperCase() : null);
}

/* --------------------- Official DOT AADT providers --------------------- */
const AADT_PROVIDERS = {
  NC: { kind: "arcgis", url: "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0", geoType: "point" },
  VA: { kind: "arcgis", url: "https://services.arcgis.com/p5v98VHDX9Atv3l7/arcgis/rest/services/VDOTTrafficVolume/FeatureServer/0", geoType: "line" },
  DC: { kind: "arcgis", url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Transportation_TrafficVolume_WebMercator/MapServer/4", geoType: "line" },
  FL: { kind: "arcgis", url: "https://gis-fdot.opendata.arcgis.com/datasets/annual-average-daily-traffic-tda/explore", geoType: "line" },
};

/* -------------------------- ArcGIS helpers -------------------------- */
async function arcgisQueryNearby(url, lat, lon, radiusMeters = 1609, outFields = "*") {
  const p = new URLSearchParams({
    f: "json", where: "1=1", outFields,
    returnGeometry: "true",
    geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint",
    inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    distance: String(Math.round(radiusMeters)), units: "esriSRUnit_Meter",
    outSR: "4326", resultRecordCount: "500",
  });
  const r = await fetchWithTimeout(`${url}/query?${p}`, { headers: { "User-Agent": UA, Accept: "application/json" } }, 22000);
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j.features) ? j.features : [];
}
async function arcgisQueryWhere(url, where, outFields = "*", returnGeometry = true) {
  const p = new URLSearchParams({
    f: "json", where, outFields, returnGeometry: returnGeometry ? "true" : "false",
    outSR: "4326", resultRecordCount: "500",
  });
  const r = await fetchWithTimeout(`${url}/query?${p}`, { headers: { "User-Agent": UA, Accept: "application/json" } }, 22000);
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j.features) ? j.features : [];
}

/* ------------------------- AADT parsing ------------------------- */
function extractLatestAADT(attrs) {
  if (!attrs) return null;
  const pairs = [];
  for (const k of Object.keys(attrs)) {
    const up = k.toUpperCase();
    if (up === "AADT" || up === "ADT") {
      const v = +attrs[k]; if (v > 0) pairs.push({ year: null, val: v });
      continue;
    }
    if (up.includes("AADT") || up.includes("ADT")) {
      const m = String(k).match(/20\d{2}/);
      const yr = m ? +m[0] : null;
      const v = +attrs[k];
      if (v > 0) pairs.push({ year: yr, val: v });
    }
  }
  if (!pairs.length) return null;
  pairs.sort((a, b) => (b.year || 0) - (a.year || 0) || b.val - a.val);
  return { year: pairs[0].year, aadt: pairs[0].val };
}
function extractRouteLocation(attrs) {
  const routeKeys = ["ROUTE","ROUTE_COMMON_NAME","RTE_NAME","ROAD","STREET","STREETNAME","FULLNAME","NAME","ROUTEID"];
  const locKeys = ["LOCATION","START_LABEL","END_LABEL","FROM_ST","TO_ST","FROMNODE","TONODE","DESCRIPTION"];
  let route=null, loc=null;
  for (const k of Object.keys(attrs||{})) {
    const up = k.toUpperCase();
    if (!route && routeKeys.some((p)=>up.includes(p))) route = attrs[k];
    if (!loc && locKeys.some((p)=>up.includes(p))) loc = attrs[k];
  }
  return { route: route || null, location: loc || null };
}
function normalizeRoadText(s) {
  const up = String(s || "").toUpperCase();
  return up
    .replace(/\./g, "")
    .replace(/\b(ROAD)\b/g, "RD")
    .replace(/\b(STREET)\b/g, "ST")
    .replace(/\b(AVENUE)\b/g, "AVE")
    .replace(/\b(HIGHWAY)\b/g, "HWY")
    .replace(/\s+/g, " ")
    .trim();
}
function tokensForRoadName(s) {
  return normalizeRoadText(s).split(/\s+/).filter(Boolean).filter(t => !["RD","ST","AVE","HWY","N","S","E","W"].includes(t));
}
function looksNumberedHighway(s) {
  const t = String(s || "").toUpperCase();
  return /\b(I[-\s]*\d+|US[-\s]*\d+|SR[-\s]*\d+|STATE\s*ROUTE\s*\d+|NC[-\s]*\d+|VA[-\s]*\d+|FL[-\s]*\d+)\b/.test(t);
}
function buildRouteWhere(tokens, fields = ["ROUTE","ROUTE_COMMON_NAME","NAME","STREETNAME","FULLNAME","ROAD","RTE_NAME"]) {
  if (!tokens?.length) return null;
  const ors = [];
  for (const f of fields) {
    for (const t of tokens) ors.push(`UPPER(${f}) LIKE '%${t.toUpperCase().replace(/'/g, "''")}%'`);
  }
  return ors.length ? `(${ors.join(" OR ")})` : null;
}
function featureCenterAndDistance(feat, lat, lon) {
  const g = feat.geometry || {};
  if (typeof g.y === "number" && typeof g.x === "number") {
    const dist = haversine(lat, lon, g.y, g.x);
    return { lat: g.y, lon: g.x, distM: dist };
  }
  if (Array.isArray(g.paths)) {
    let best = { lat: null, lon: null, distM: Infinity };
    for (const path of g.paths) {
      for (const [x,y] of path) {
        const d = haversine(lat, lon, y, x);
        if (d < best.distM) best = { lat: y, lon: x, distM: d };
      }
    }
    return best;
  }
  return { lat: null, lon: null, distM: Infinity };
}
function featuresToStations(stateCode, feats, siteLat, siteLon) {
  const out = [];
  for (const f of feats) {
    const A = f.attributes || {};
    const latest = extractLatestAADT(A);
    if (!latest) continue;
    const pos = featureCenterAndDistance(f, siteLat, siteLon);
    if (!(Number.isFinite(pos.lat) && Number.isFinite(pos.lon))) continue;
    const rl = extractRouteLocation(A);
    out.push({
      lat: pos.lat, lon: pos.lon, distM: pos.distM,
      aadt: latest.aadt, year: latest.year,
      route: rl.route, location: rl.location,
      station_id: A.LocationID || A.Location_ID || A.OBJECTID || A.OBJECTID_1 || null,
      rte_cls: A.RTE_CLS || A.RTE_TYPE_CD || null,
      state: stateCode,
    });
  }
  out.sort((a, b) => a.distM - b.distM);
  return out;
}
function pickStationForStreet(stations, streetText) {
  if (!stations.length) return null;
  if (!streetText) return stations[0];
  const tokens = tokensForRoadName(streetText);
  const hasToken = (txt) => {
    const N = normalizeRoadText(txt || "");
    return tokens.some((t) => N.includes(t));
  };
  const withMatch = stations.filter(s => hasToken(s.route) || hasToken(s.location));
  if (withMatch.length) return withMatch[0]; // stations already sorted by distance
  if (!looksNumberedHighway(streetText)) {
    const nonNum = stations.filter(s => !(String(s.route||"").match(/\b(I|US|SR|NC|VA|FL)[-\s]?\d+/)));
    if (nonNum.length) return nonNum[0];
  }
  return stations[0];
}

/* ---------------------- Providers wrappers ---------------------- */
async function providerNearbyAADT(stateCode, lat, lon, radiusMi = 1.0) {
  const prov = AADT_PROVIDERS[stateCode];
  if (!prov) return [];
  const feats = await arcgisQueryNearby(prov.url, lat, lon, radiusMi * 1609.344).catch(() => []);
  return featuresToStations(stateCode, feats, lat, lon);
}
async function providerStationsOnStreet(stateCode, lat, lon, streetText) {
  const prov = AADT_PROVIDERS[stateCode];
  if (!prov || !streetText) return [];
  const tokens = tokensForRoadName(streetText);
  const where = buildRouteWhere(tokens);
  if (!where) return [];
  const feats = await arcgisQueryWhere(prov.url, where, "*", true).catch(() => []);
  const st = featuresToStations(stateCode, feats, lat, lon);
  // limit to ~1.5 mi; we only want stations near the site AND on that road
  return st.filter(s => s.distM <= 1.5 * 1609.344);
}

/* --------------------- Competition (OSM+Google) --------------------- */
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
async function overpassQuery(data) {
  let last = new Error("no tries");
  for (const ep of OVERPASS) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetchWithTimeout(
          ep,
          { method: "POST", headers: { "User-Agent": CONTACT, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: "data=" + encodeURIComponent(data) },
          25000
        );
        const ct = r.headers.get("content-type") || "";
        const txt = await r.text();
        if (!r.ok || !ct.includes("application/json"))
          throw new Error(`Overpass ${r.status}: ${txt.slice(0, 200)}`);
        return JSON.parse(txt);
      } catch (e) { last = e; await sleep(900 * (i + 1)); }
    }
  }
  throw last;
}
const HEAVY_BRANDS = /(sheetz|wawa|race\s?trac|racetrac|buc-?ee'?s|royal\s?farms|quik.?trip|\bqt\b)/i;
const IS_SUNOCO  = /\bsunoco\b/i;
async function googleNearbyGasStations(lat, lon, rM = 2414) {
  if (!GOOGLE_API_KEY) return [];
  const base = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=${rM}&type=gas_station&key=${GOOGLE_API_KEY}`;
  const out = []; let url = base; let tries = 0;
  while (url && tries < 3) {
    tries++;
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 20000);
    const txt = await r.text(); if (!r.ok) break;
    let j; try { j = JSON.parse(txt); } catch { break; }
    const items = j.results || [];
    for (const it of items) {
      const name = it.name || "Fuel";
      const latc = it.geometry?.location?.lat, lonc = it.geometry?.location?.lng;
      if (!Number.isFinite(latc) || !Number.isFinite(lonc)) continue;
      const milesExact = distMiles(lat, lon, latc, lonc);
      if (milesExact <= 0.02) continue; // skip the searched site (same address)
      out.push({
        name,
        lat: +latc, lon: +lonc,
        miles: +milesExact.toFixed(3),
        heavy: HEAVY_BRANDS.test(name),
        sunoco: IS_SUNOCO.test(name),
      });
    }
    if (j.next_page_token) { await sleep(1700); url = `${base}&pagetoken=${j.next_page_token}`; }
    else url = null;
  }
  return out;
}
async function competitorsWithinRadiusMiles(lat, lon, rMi = 1.5) {
  const rM = Math.round(rMi * 1609.344);
  const q = `[out:json][timeout:25];
    ( node(around:${rM},${lat},${lon})["amenity"="fuel"];
      way(around:${rM},${lat},${lon})["amenity"="fuel"]; );
    out center tags;`;
  const [op, g] = await Promise.all([
    overpassQuery(q).then((j) => j.elements || []).catch(() => []),
    googleNearbyGasStations(lat, lon, rM).catch(() => []),
  ]);
  const opList = op.map((el) => {
    const t = el.tags || {};
    const name = t.brand || t.name || "Fuel";
    const latc = el.lat ?? el.center?.lat, lonc = el.lon ?? el.center?.lon;
    if (latc == null || lonc == null) return null;
    const milesExact = distMiles(lat, lon, latc, lonc);
    if (milesExact <= 0.02) return null;
    return {
      name, lat: +latc, lon: +lonc,
      miles: +milesExact.toFixed(3),
      heavy: HEAVY_BRANDS.test(name),
      sunoco: IS_SUNOCO.test(name),
    };
  }).filter(Boolean);
  const merged = [...opList, ...g];
  const seen = new Set(), out = [];
  for (const s of merged) {
    const k = `${Math.round(s.lat * 1e5)}|${Math.round(s.lon * 1e5)}`;
    if (seen.has(k)) continue; seen.add(k); out.push(s);
  }
  out.sort((a, b) => a.miles - b.miles);
  return out.filter((s) => s.miles <= rMi && s.miles > 0.02);
}

/* ----------------------- Road context ----------------------- */
function parseMaxspeed(ms) { const m = String(ms || "").match(/(\d+)\s*(mph)?/i); return m ? +m[1] : null; }
function roadWeight(hw) {
  const order = { motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2, unclassified: 1, residential: 1 };
  return order[(hw || "").replace("_link", "")] || 0;
}
async function roadContext(lat, lon) {
  const rM = Math.round(1609 * 1.2);
  const qWays = `[out:json][timeout:25];
    ( way(around:${rM},${lat},${lon})["highway"~"motorway|trunk|primary|secondary|tertiary|primary_link|secondary_link|tertiary_link"]; );
    out center tags;`;
  const qSig = `[out:json][timeout:25]; node(around:${rM},${lat},${lon})["highway"="traffic_signals"]; out;`;
  let ways = [], signals = 0;
  try { const wj = await overpassQuery(qWays); ways = wj.elements || []; } catch {}
  try { const sj = await overpassQuery(qSig); signals = (sj.elements || []).length; } catch {}
  const rows = ways.map((w) => {
    const t = w.tags || {};
    const name = t.ref || t.name || "";
    const hw = (t.highway || "").replace("_link", "");
    const lanes = +t.lanes || +t["lanes:forward"] || +t["lanes:backward"] || null;
    const speed = parseMaxspeed(t.maxspeed);
    const latc = w.center?.lat, lonc = w.center?.lon;
    const d = Number.isFinite(latc) && Number.isFinite(lonc) ? haversine(lat, lon, latc, lonc) : null;
    return { name, highway: hw, lanes, maxspeed: speed, distM: d, weight: roadWeight(hw) };
  }).filter((r) => r.weight > 0);
  rows.sort((a, b) =>
    b.weight - a.weight ||
    (b.lanes || 0) - (a.lanes || 0) ||
    (b.maxspeed || 0) - (a.maxspeed || 0) ||
    (a.distM || 1e12) - (b.distM || 1e12)
  );
  const main = rows.slice(0, 3), side = rows.slice(3, 8);
  const nice = (r) => [r.name || r.highway, r.maxspeed ? `${r.maxspeed} mph` : null, r.lanes ? `${r.lanes} lanes` : null].filter(Boolean).join(" - ");
  const mainLabel = main.map(nice).filter(Boolean).slice(0, 3).join(" | ");
  const sideLabel = side.map(nice).filter(Boolean).slice(0, 3).join(" | ");
  const intersections = Math.max(0, Math.round(rows.length / 3));
  return { summary: [mainLabel, sideLabel].filter(Boolean).join(" — "), main, side, signals, intersections };
}

/* ------------------------- Gallons computation ------------------------- */
function gallonsWithRules({ aadt, mpds, diesel, compCount, heavyCount, pricePosition, userExtrasMult = 1, trafficPullPct, gallonsPerFill }) {
  const trafficPctUsed = Number.isFinite(trafficPullPct) && trafficPullPct > 0 ? Number(trafficPullPct) : 2;
  const gallonsUsed = Number.isFinite(gallonsPerFill) && gallonsPerFill > 0 ? Number(gallonsPerFill) : 8;
  const baselineComponents = {
    trafficShare: trafficPctUsed / 100,
    trafficPullPct: trafficPctUsed,
    gallonsPerFill: gallonsUsed,
    usedCustomTraffic: Number.isFinite(trafficPullPct) && trafficPullPct > 0,
    usedCustomGallons: Number.isFinite(gallonsPerFill) && gallonsPerFill > 0,
    days: 30,
  };
  const baseline = aadt * baselineComponents.trafficShare * baselineComponents.gallonsPerFill * baselineComponents.days;

  let baseMult = 1.0;
  if (compCount === 1) baseMult = 0.75;
  else if (compCount >= 2 && compCount <= 4) baseMult = 0.6;
  else if (compCount >= 5) baseMult = 0.5;

  let heavyPenalty = 0;
  if (heavyCount === 1) heavyPenalty = 0.2;
  else if (heavyCount >= 2) heavyPenalty = 0.35;

  const compMult = Math.max(0.2, baseMult - heavyPenalty);
  const afterComp = baseline * compMult;

  const capEquip = mpds * 25 * 10.5 * 24 * (365 / 12) + ((diesel || 0) * 25 * 16 * 24) * (365 / 12);
  const SOFT = 22000, HARD = 28000;
  const capSoftTotal = mpds * SOFT, capHardTotal = mpds * HARD;

  let capped = Math.min(afterComp, capEquip, capHardTotal);
  if (afterComp > capSoftTotal) capped = Math.round(capped * 0.9);

  let priceMult = 1.0;
  if (pricePosition === "below") priceMult = 1.1;
  else if (pricePosition === "above") priceMult = 0.9;

  const preClamp = Math.round(capped * priceMult * userExtrasMult);
  const base = Math.min(preClamp, Math.round(baseline));

  const low = Math.round(base * 0.86);
  const high = Math.round(base * 1.06);

  const breakdown = {
    aadt,
    baseline: Math.round(baseline),
    baselineComponents,
    compRule: { compCount, heavyCount, baseMult, heavyPenalty, compMult, afterComp: Math.round(afterComp) },
    caps: { capEquip: Math.round(capEquip), capSoftTotal, capHardTotal },
    priceMult,
    extrasMult: userExtrasMult,
    preClamp,
    finalClampedToBaseline: base,
  };

  return {
    base,
    low,
    high,
    year2: Math.round(base * 1.027),
    year3: Math.round(base * 1.027 * 1.0125),
    breakdown,
  };
}
function formatNumberCompact(n) {
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(Number(n) * 100) / 100;
  return Math.abs(rounded - Math.round(rounded)) < 1e-9
    ? String(Math.round(rounded))
    : rounded.toFixed(2).replace(/\.?0+$/, '');
}
function formatMultiplierWithNote(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return '—';
  const num = Number(value);
  const fixed = num.toFixed(digits);
  return Math.abs(num - 1) < 1e-9 ? `${fixed} (No adjustment)` : fixed;
}
function pickFirstFinite(...values) {
  for (const v of values) {
    const num = Number(v);
    if (Number.isFinite(num)) return num;
  }
  return null;
}
function formatFinalEstimateLine(result) {
  if (!result || typeof result !== 'object') return null;
  const est = result.estimate || {};
  const low = pickFirstFinite(est.low, result.low, est.base, result.base);
  const high = pickFirstFinite(est.high, result.high, est.base, result.base);
  const year2 = pickFirstFinite(est.year2, result.year2);
  const year3 = pickFirstFinite(est.year3, result.year3);
  const fmt = (n) => (Number.isFinite(n) ? Number(n).toLocaleString() : '—');
  const range = typeof est.range === 'string' && est.range.trim()
    ? est.range.trim()
    : (Number.isFinite(low) && Number.isFinite(high)
        ? `${Number(low).toLocaleString()}–${Number(high).toLocaleString()}`
        : '—');
  return `Final (LOW): ${fmt(low)} • Range: ${range} • Y2: ${fmt(year2)} • Y3: ${fmt(year3)}`;
}
function formatBaselineSummaryLine(aadt, baselineComponents, baselineValue) {
  if (!Number.isFinite(aadt) || !Number.isFinite(baselineValue)) return null;
  const comp = baselineComponents || {};
  let pct = Number.isFinite(comp.trafficPullPct) ? Number(comp.trafficPullPct)
          : Number.isFinite(comp.traffic_pull_pct) ? Number(comp.traffic_pull_pct)
          : Number.isFinite(comp.trafficShare) ? Number(comp.trafficShare) * 100
          : null;
  let gallons = Number.isFinite(comp.gallonsPerFill) ? Number(comp.gallonsPerFill)
             : Number.isFinite(comp.gallons_per_fill) ? Number(comp.gallons_per_fill)
             : null;
  let days = Number.isFinite(comp.days) ? Number(comp.days)
          : Number.isFinite(comp.days_per_month) ? Number(comp.days_per_month)
          : 30;
  if (!Number.isFinite(pct)) pct = 2;
  if (!Number.isFinite(gallons)) gallons = 8;
  if (!Number.isFinite(days)) days = 30;
  const parts = [
    `AADT ${Number(aadt).toLocaleString()}`,
    `${formatNumberCompact(pct)}% traffic pull`,
    `${formatNumberCompact(gallons)} gal/fill`,
    `${formatNumberCompact(days)} days`,
  ];
  return `AADT math: ${parts.join(' × ')} = ${Number(baselineValue).toLocaleString()}`;
}

function cleanSummaryText(raw) {
  if (raw == null) return "";
  let text = String(raw);
  const stripPair = (open, close) => {
    const openRe = new RegExp(`^\\s*${open}`, "i");
    const closeRe = new RegExp(`${close}\\s*$`, "i");
    text = text.replace(openRe, "");
    text = text.replace(closeRe, "");
  };
  stripPair("<text[^>]*>", "</text>");
  stripPair("<summary[^>]*>", "</summary>");
  stripPair("<p[^>]*>", "</p>");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n");
  text = text.replace(/<\/?p[^>]*>/gi, "");
  text = text.replace(/<\/?text[^>]*>/gi, "");
  text = text.replace(/<\/?summary[^>]*>/gi, "");
  text = text.replace(/<\/?div[^>]*>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\s{2,}/g, " ");
  return text.trim();
}

/* ------------------------ Google proxy/status ------------------------ */
app.get("/google/status", async (_req, res) => {
  try {
    if (!GOOGLE_API_KEY) return res.json({ ok: false, status: "MISSING_KEY" });
    const au = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Test&components=country:us&key=${GOOGLE_API_KEY}`;
    const r = await fetchWithTimeout(au, { headers: { "User-Agent": UA } }, 10000);
    res.json({ ok: r.ok, status: r.ok ? "WORKING" : `HTTP_${r.status}` });
  } catch {
    res.json({ ok: false, status: "EXCEPTION" });
  }
});

/* Autocomplete with optional location bias */
app.get("/google/autocomplete", async (req, res) => {
  const input = String(req.query.input || "").trim();
  if (!input) return res.json({ ok: false, status: "BAD_REQUEST", items: [] });
  if (!GOOGLE_API_KEY) return res.json({ ok: false, status: "MISSING_KEY", items: [] });
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  const radius = Math.max(1000, Math.min(200000, Number(req.query.radius) || 50000)); // 1–200 km
  try {
    const loc = (Number.isFinite(lat) && Number.isFinite(lon)) ? `&location=${lat},${lon}&radius=${radius}` : "";
    const au = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:us${loc}&key=${GOOGLE_API_KEY}`;
    const ar = await fetchWithTimeout(au, { headers: { "User-Agent": UA } }, 15000);
    const aj = await ar.json();
    if (aj.status !== "OK" && aj.status !== "ZERO_RESULTS")
      return res.json({ ok: false, status: aj.status, items: [] });

    const predictions = (aj.predictions || []).filter((p) => p.place_id).slice(0, 8);
    if (!predictions.length) return res.json({ ok: true, status: "ZERO_RESULTS", items: [] });

    const items = predictions.map((p) => ({
      type: "Google",
      display: p.description || p.structured_formatting?.main_text || "",
      place_id: p.place_id,
      structured_formatting: p.structured_formatting || null,
      terms: p.terms || null,
      score: 1.3,
    }));

    return res.json({ ok: true, status: "OK", items });
  } catch (e) { return res.json({ ok: false, status: "ERROR", items: [], error: String(e) }); }
});

app.get("/google/place_details", async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) return res.json({ ok: false, status: "MISSING_KEY" });
    const place_id = String(req.query.place_id || "").trim();
    if (!place_id) return res.json({ ok: false, status: "BAD_REQUEST" });

    const cached = getCached(GOOGLE_DETAIL_CACHE, place_id);
    if (cached) return res.json({ ok: true, status: "CACHED", item: cached });

    const fields = "formatted_address,geometry,name,place_id,address_component";
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place_id)}&fields=${encodeURIComponent(fields)}&key=${GOOGLE_API_KEY}`;
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 15000);
    const j = await r.json();
    if (j.status !== "OK") return res.json({ ok: false, status: j.status || "ERROR", error: j.error_message || null });

    const result = j.result || {};
    const loc = result.geometry?.location;
    if (!loc || !Number.isFinite(+loc.lat) || !Number.isFinite(+loc.lng)) {
      return res.json({ ok: false, status: "NO_LOCATION" });
    }

    const display = result.formatted_address || result.name || "";
    if (!display) return res.json({ ok: false, status: "NO_DISPLAY" });

    const normalized = buildNormalizedFromGoogle(result);
    const item = {
      type: "Google",
      display,
      lat: +loc.lat,
      lon: +loc.lng,
      place_id: result.place_id || place_id,
      normalized: normalized || null,
      storageKey: result.place_id ? `GOOGLE:${result.place_id}` : null,
      score: 1.3,
    };

    setCached(GOOGLE_DETAIL_CACHE, place_id, item, GOOGLE_DETAIL_TTL_MS, GOOGLE_DETAIL_CACHE_LIMIT);
    return res.json({ ok: true, status: "OK", item });
  } catch (e) {
    return res.json({ ok: false, status: "ERROR", error: String(e) });
  }
});

app.get("/osm/autocomplete", async (req, res) => {
  try {
    const q = String(req.query.q || req.query.input || "").trim();
    if (q.length < 2) return res.json({ ok: false, status: "BAD_REQUEST", items: [] });

    const cacheKey = q.toLowerCase();
    const cached = getCached(NOMINATIM_CACHE, cacheKey);
    if (cached) return res.json({ ok: true, status: "CACHED", items: cached });

    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&countrycodes=us&q=${encodeURIComponent(q)}`;
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 15000);
    if (!r.ok) return res.json({ ok: false, status: `HTTP_${r.status}`, items: [] });
    const arr = await r.json();
    if (!Array.isArray(arr) || !arr.length) return res.json({ ok: true, status: "ZERO_RESULTS", items: [] });

    const items = arr
      .map((row) => {
        const lat = Number(row.lat), lon = Number(row.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const normalized = buildOsmNormalized(row);
        const display = formatNominatimDisplay(row) || row.display_name || "";
        if (!display) return null;
        const storageKey = row.place_id
          ? `OSM:${row.place_id}`
          : normalized && Number.isFinite(normalized.lat) && Number.isFinite(normalized.lon)
          ? `OSM:${normalized.lat.toFixed(6)},${normalized.lon.toFixed(6)}`
          : null;
        return {
          type: "OSM",
          display,
          lat,
          lon,
          normalized: normalized || null,
          place_id: row.place_id || null,
          storageKey,
          score: 0.7,
        };
      })
      .filter(Boolean)
      .slice(0, 8);

    setCached(NOMINATIM_CACHE, cacheKey, items, NOMINATIM_CACHE_TTL_MS, NOMINATIM_CACHE_LIMIT);
    return res.json({ ok: true, status: "OK", items });
  } catch (e) {
    return res.json({ ok: false, status: "ERROR", items: [], error: String(e) });
  }
});

app.get("/google/findplace", async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) return res.json({ ok: false, status: "MISSING_KEY" });
    const input = String(req.query.input || "").trim();
    if (!input) return res.json({ ok: false, status: "BAD_REQUEST" });
    const bias = (() => {
      const la = Number(req.query.lat), lo = Number(req.query.lon), rad = Number(req.query.radius) || 50000;
      if (Number.isFinite(la) && Number.isFinite(lo)) return `&locationbias=circle:${Math.round(rad)}@${la},${lo}`;
      return "";
    })();
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(input)}&inputtype=textquery&fields=place_id,name,formatted_address,geometry&key=${GOOGLE_API_KEY}${bias}`;
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 15000);
    const j = await r.json();
    const cand = (j.candidates || [])[0];
    if (!cand?.place_id) return res.json({ ok: false, status: j.status || "ZERO_RESULTS" });
    res.json({ ok: true, status: "OK", place_id: cand.place_id, name: cand.name, address: cand.formatted_address, location: cand.geometry?.location || null });
  } catch (e) { res.json({ ok: false, status: "EXCEPTION", error: String(e) }); }
});

app.get("/google/rating", async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) return res.json({ ok: false, status: "MISSING_KEY" });
    const place_id = String(req.query.place_id || "").trim();
    if (!place_id) return res.json({ ok: false, status: "BAD_REQUEST" });
    const fields = ["name", "formatted_address", "rating", "user_ratings_total"].join(",");
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place_id)}&fields=${encodeURIComponent(fields)}&key=${GOOGLE_API_KEY}`;
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 15000);
    const j = await r.json();
    if (j.status !== "OK") return res.json({ ok: false, status: j.status || "ERROR", error: j.error_message || null });
    const g = j.result || {};
    res.json({ ok: true, status: "OK", rating: g.rating || null, total: g.user_ratings_total || 0, name: g.name || null, address: g.formatted_address || null });
  } catch (e) { res.json({ ok: false, status: "EXCEPTION", error: String(e) }); }
});
app.get("/google/rating_by_location", async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) return res.json({ ok: false, status: "MISSING_KEY" });
    const lat = +req.query.lat, lon = +req.query.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.json({ ok: false, status: "BAD_REQUEST" });
    const r = await fetchWithTimeout(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=300&type=gas_station&key=${GOOGLE_API_KEY}`, {}, 15000
    );
    const j = await r.json();
    const it = (j.results || [])[0];
    if (!it?.place_id) return res.json({ ok: false, status: "ZERO_RESULTS" });
    const d = await fetchWithTimeout(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${it.place_id}&fields=rating,user_ratings_total&key=${GOOGLE_API_KEY}`, {}, 15000
    );
    const dj = await d.json();
    if (dj.status !== "OK") return res.json({ ok: false, status: dj.status });
    res.json({ ok: true, status: "OK", rating: dj.result?.rating || null, total: dj.result?.user_ratings_total || 0 });
  } catch (e) { res.json({ ok: false, status: "EXCEPTION", error: String(e) }); }
});

app.post("/api/addresses", async (req, res) => {
  try {
    const { input, normalized, source, place_id } = req.body || {};
    if (!normalized || !Number.isFinite(+normalized.lat) || !Number.isFinite(+normalized.lon)) {
      return res.status(400).json({ ok: false, status: "INVALID_NORMALIZED" });
    }
    const entry = {
      id: crypto.randomUUID(),
      input: String(input || ""),
      source: String(source || normalized.source || ""),
      place_id: place_id || normalized.place_id || null,
      normalized: {
        formatted: String(normalized.formatted || ""),
        line1: String(normalized.line1 || ""),
        city: String(normalized.city || ""),
        county: String(normalized.county || ""),
        state: String(normalized.state || ""),
        postcode: String(normalized.postcode || ""),
        country: String(normalized.country || ""),
        lat: +normalized.lat,
        lon: +normalized.lon,
      },
      raw: normalized.raw || null,
      created_at: new Date().toISOString(),
    };
    await appendNormalizedAddress(entry);
    res.json({ ok: true });
  } catch (e) {
    console.error("Store normalized address failed", e);
    res.status(500).json({ ok: false, status: "STORE_FAILED" });
  }
});

/* --------------------- AADT nearby (for table/map) --------------------- */
app.get("/aadt/nearby", async (req, res) => {
  try {
    const lat = +req.query.lat, lon = +req.query.lon;
    const rMi = Math.max(0.1, Math.min(5, +req.query.radiusMi || 1.0));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ ok: false, status: "lat/lon required" });
    }
    const admin = await reverseAdmin(lat, lon);
    const st = toStateCode(admin.state) || "NC";
    const stations = await providerNearbyAADT(st, lat, lon, rMi);
    const items = stations.map(s => ({
      lat: s.lat, lon: s.lon, miles: +toMiles(s.distM).toFixed(3),
      aadt: s.aadt, year: s.year, route: s.route, location: s.location,
      rte_cls: s.rte_cls, station_id: s.station_id, source_url: AADT_PROVIDERS[st]?.url || null,
      state: st
    }));
    res.json({ ok: true, count: items.length, items, state: st });
  } catch (e) {
    res.status(500).json({ ok: false, status: "AADT nearby failed", detail: String(e) });
  }
});

/* ------------------ Helpers for strict road selection ------------------ */
function extractStreetFromAddress(addr) {
  const raw = String(addr || "").trim();
  if (!raw) return "";
  if (tryParseLatLng(raw)) return ""; // coordinates only → no street text

  // take first comma part, strip apt/suite, strip leading house number
  let first = raw.split(",")[0] || "";
  first = first.replace(/\b(Suite|Ste|Apt|Unit)\b.*$/i, "");
  first = first.replace(/^\s*\d+[A-Za-z-]?\s*,?\s*/, ""); // remove leading number
  first = first.replace(/^[^A-Za-z]+/, ""); // strip leftover punctuation like '.' from coordinates
  first = first.replace(/\s+/g, " ").trim();

  return /[A-Za-z]/.test(first) ? first : "";
}

/* ============================= Estimate core ============================= */
async function performEstimate(reqBody) {
  const { address, mpds, diesel, siteLat, siteLon, aadtOverride, advanced,
          client_rating, auto_low_rating, enteredRoad, trafficPullPct, gallonsPerFill,
          siteNotes: rawSiteNotes } = reqBody || {};

  const siteNotes = typeof rawSiteNotes === "string"
    ? rawSiteNotes.trim().slice(0, 1200)
    : "";

  const MPDS = +mpds, DIESEL = +(diesel || 0);
  if (!(Number.isFinite(MPDS) && MPDS > 0)) throw new Error("Regular MPDs required (>0)");
  if (!address && !(Number.isFinite(siteLat) && Number.isFinite(siteLon))) throw new Error("Address or coordinates required");

  const pricePosition = String(advanced?.price_position || "inline");

  // Geocode/admin
  let geo;
  if (Number.isFinite(siteLat) && Number.isFinite(siteLon)) {
    geo = { lat: +siteLat, lon: +siteLon, label: address || `${siteLat}, ${siteLon}` };
  } else {
    const direct = tryParseLatLng(address);
    geo = direct ? { lat: direct.lat, lon: direct.lon, label: direct.label } :
                   await geocodeCensus(address).catch(async()=>await geocodeNominatim(address));
  }
  const admin = await reverseAdmin(geo.lat, geo.lon);
  const stateCode = toStateCode(admin.state) || "NC";

  // Determine ENTERED ROAD (strict)
  const enteredRoadText = String(enteredRoad || extractStreetFromAddress(address || geo.label)).trim();

  // Competition (for math & map)
  const compAll3 = await competitorsWithinRadiusMiles(geo.lat, geo.lon, 3.0).catch(() => []);
  const competitors15 = compAll3.filter((c) => c.miles <= 1.5);
  const compCount = competitors15.length;
  const heavyCount = competitors15.filter((c) => c.heavy).length;
  const sunocoNearby = compAll3.some((c) => c.sunoco && c.miles <= 1.0);
  const ruralEligible = compAll3.length === 0;

  // Developments + roads
  const devCsv = matchCsvDevelopments(admin.city, admin.county, admin.state);
  const roads = await roadContext(geo.lat, geo.lon).catch(() => ({ summary: "", main: [], side: [], signals: 0, intersections: 0 }));

  // AADT strict: ONLY from stations on the ENTERED ROAD
  let usedAADT = null, method = "dot_station_on_entered_road";
  let aadtUsedMarker = null;
  let rawStationAADT = null;
  let mapStations = await providerNearbyAADT(stateCode, geo.lat, geo.lon, 1.0).catch(() => []);

  const overrideVal = Number(aadtOverride);
  if (Number.isFinite(overrideVal) && overrideVal > 0) {
    usedAADT = Math.round(overrideVal); method = "override";
  } else {
    let onStreet = await providerStationsOnStreet(stateCode, geo.lat, geo.lon, enteredRoadText).catch(() => []);
    let pick = onStreet.length ? pickStationForStreet(onStreet, enteredRoadText) : null;

    if (!pick && stateCode === "NC" && mapStations.length) {
      pick = pickStationForStreet(mapStations, enteredRoadText) || mapStations[0];
    }

    if (pick) {
      usedAADT = pick.aadt;
      rawStationAADT = pick.aadt;
      aadtUsedMarker = {
        lat: pick.lat, lon: pick.lon, aadt: pick.aadt, year: pick.year,
        route: pick.route, location: pick.location,
        station_id: pick.station_id, source_url: AADT_PROVIDERS[stateCode]?.url || null,
        state: stateCode, fallback: false, method
      };
    }
  }
  if (!(Number.isFinite(usedAADT) && usedAADT > 0)) {
    usedAADT = 8000;
    method = "fallback_no_dot_found";
    rawStationAADT = null;
  } else if (method === "dot_station_on_entered_road" && usedAADT < 2000) {
    rawStationAADT = usedAADT;
    usedAADT = 8000;
    method = "fallback_low_aadt";
    aadtUsedMarker = null;
  }

  // Gallons
  let userExtrasMult = 1.0;
  const extras = (advanced?.extra || [])
    .map((e) => ({ pct: +e?.pct, note: String(e?.note || "").slice(0, 180) }))
    .filter((e) => Number.isFinite(e.pct));
  if (extras.length) userExtrasMult *= extras.reduce((m, e) => m * (1 + e.pct / 100), 1.0);
  const ruralRequested = !!(advanced && advanced.flags && advanced.flags.rural === true);
  const ruralApplied = ruralRequested && ruralEligible;
  if (ruralApplied) userExtrasMult *= 1.30;
  const autoLow = auto_low_rating === true || (Number.isFinite(client_rating) && client_rating < 4.0);
  if (autoLow) userExtrasMult *= 0.70;

  const calc = gallonsWithRules({
    aadt: usedAADT, mpds: MPDS, diesel: DIESEL,
    compCount, heavyCount, pricePosition, userExtrasMult,
    trafficPullPct, gallonsPerFill,
  });

  const baselineComponents = calc.breakdown?.baselineComponents || {};
  const baselineSettings = {
    traffic_pull_pct: Number.isFinite(baselineComponents.trafficPullPct) ? Number(baselineComponents.trafficPullPct) : null,
    gallons_per_fill: Number.isFinite(baselineComponents.gallonsPerFill) ? Number(baselineComponents.gallonsPerFill) : null,
    traffic_share: Number.isFinite(baselineComponents.trafficShare)
      ? Number(baselineComponents.trafficShare)
      : (Number.isFinite(baselineComponents.trafficPullPct) ? Number(baselineComponents.trafficPullPct) / 100 : null),
    days: Number.isFinite(baselineComponents.days) ? Number(baselineComponents.days) : 30,
    used_custom_traffic: baselineComponents.usedCustomTraffic === true,
    used_custom_gallons: baselineComponents.usedCustomGallons === true,
  };

  // GPT summary
  async function gptJSONCore(model, prompt) {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
    const r = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, response_format: { type: "json_object" }, temperature: 0.2, max_tokens: 1200,
          messages: [
            { role: "system", content: "You are a precise fuel/traffic analyst. Always reply with STRICT JSON (no markdown)." },
            { role: "user", content: prompt },
          ],
        }),
      },
      35000
    );
    const txt = await r.text(); if (!r.ok) throw new Error(`OpenAI ${r.status}: ${txt}`);
    const data = JSON.parse(txt); const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("No GPT content");
    return JSON.parse(content);
  }
  async function gptJSONWithRetry(prompt) {
    const models = ["gpt-4o-mini", "gpt-4o"]; let last = null;
    for (const m of models) { for (let i = 0; i < 2; i++) { try { return await gptJSONCore(m, prompt); } catch (e) { last = e; await sleep(400); } } }
    throw last || new Error("GPT failed");
  }
  async function gptSummary(ctx) {
    const sys = 'Return {"summary":"<text>"} ~8–12 sentences. Include AADT method (DOT), baseline ceiling math, competition rule & big box penalties, pricing, user adjustments, caps, LOW/BASE/HIGH, road context, and notable nearby developments.';
    const prompt = `
Address: ${ctx.address}
AADT used (DOT): ${ctx.aadt} (${ctx.method})
Road (entered): ${ctx.enteredRoad}
Roads (context): ${ctx.roads.summary}
Competition: ${ctx.compCount} (Big box ${ctx.heavyCount})
Pricing: ${ctx.pricePosition}; User adjustments: ${ctx.userAdj || "none"}
Nearby developments: ${ctx.dev || "none"}
Result LOW/BASE/HIGH: ${ctx.low}/${ctx.base}/${ctx.high}
`.trim();
    try {
      const j = await gptJSONWithRetry(`${sys}\n${prompt}`);
      const s = (j && j.summary) ? String(j.summary).trim() : "";
      if (s) return s;
    } catch {}
    let fallback = `AADT ${ctx.aadt} (${ctx.method}); competition ${ctx.compCount} (Big box=${ctx.heavyCount}); pricing ${ctx.pricePosition}; adjustments ${ctx.userAdj || "none"}; result ${ctx.low}–${ctx.high} base ${ctx.base}.`;
    return fallback;
  }

  const adjBits = [];
  if (baselineComponents.usedCustomTraffic || baselineComponents.usedCustomGallons) {
    adjBits.push(`User baseline inputs: ${formatNumberCompact(baselineComponents.trafficPullPct)}% traffic pull × ${formatNumberCompact(baselineComponents.gallonsPerFill)} gal/fill`);
  }
  if (pricePosition === "below") adjBits.push("+10% below-market pricing");
  if (pricePosition === "above") adjBits.push("−10% above-market pricing");
  if (ruralApplied) adjBits.push("+30% rural bonus (0 comps within 3 mi)");
  if (autoLow) adjBits.push("−30% low reviews (<4.0)");
  extras.forEach((e) => adjBits.push(`${e.pct > 0 ? "+" : ""}${e.pct}% ${e.note || "adj."}`));
  const summaryBase = await gptSummary({
    address: address || geo.label,
    aadt: usedAADT, method,
    enteredRoad: enteredRoadText,
    roads, compCount, heavyCount,
    pricePosition, userAdj: adjBits.join("; "),
    base: calc.base, low: calc.low, high: calc.high,
    dev: devCsv.slice(0, 4).map((x) => `${x.name}${x.status ? ` (${x.status})` : ""}`).join("; "),
  });

  const summaryWithNotes = siteNotes
    ? `${summaryBase}${summaryBase ? "\n\n" : ""}User Entered Site Notes: ${siteNotes}`
    : summaryBase;

  // UI lines
  let aadtText = "";
  if (method === "override") aadtText = `AADT (override): ${usedAADT.toLocaleString()} vehicles/day`;
  else if (method === "dot_station_on_entered_road") aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (DOT - entered road: ${enteredRoadText || "—"})`;
  else if (method === "fallback_no_dot_found") aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (fallback — no DOT station published for "${enteredRoadText}")`;
  else if (method === "fallback_low_aadt") {
    const rawTxt = rawStationAADT ? rawStationAADT.toLocaleString() : "<2,000";
    aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (fallback — DOT reported ${rawTxt} < 2,000)`;
  }
  else aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (${method})`;

  const nearestComp = compAll3.length ? compAll3[0].miles : null;
  let competitionText = "";
  if (compCount === 0) {
    if (ruralEligible) competitionText = "Competition: None within 3 mi.";
    else competitionText = `Competition: None within 1.5 mi${nearestComp != null ? ` (nearest ~${(+nearestComp).toFixed(1)} mi)` : ""}.`;
  } else {
    competitionText = `Competition: ${compCount} station${compCount !== 1 ? "s" : ""} within 1.5 mi`;
    if (heavyCount > 0) {
      const bigBoxLabel = heavyCount === 1 ? "Big box competitor" : "Big box competitors";
      competitionText += ` (${heavyCount} ${bigBoxLabel})`;
    }
    competitionText += ".";
  }

  return {
    ok: true,
    estimate: { low: calc.low, range: `${Math.round(calc.low)}–${Math.round(calc.high)}`, year2: calc.year2, year3: calc.year3 },
    aadtText, competitionText, csv: devCsv,
    base: calc.base, low: calc.low, high: calc.high, year2: calc.year2, year3: calc.year3,
    inputs: {
      mpds: MPDS,
      diesel: DIESEL,
      aadt_used: usedAADT,
      price_position: pricePosition,
      aadt_components: { method, enteredRoad: enteredRoadText, raw_aadt: rawStationAADT },
      baseline_settings: baselineSettings,
    },
    flags: { rural_bonus_applied: ruralApplied, rural_eligible: ruralEligible, sunoco_within_1mi: sunocoNearby, auto_low_rating: autoLow },
    competition: {
      count: compCount, count_3mi: compAll3.length, heavy_count: heavyCount,
      nearest_mi: competitors15[0]?.miles ?? null,
      notable_brands: competitors15.filter((c) => c.heavy).slice(0, 6).map((c) => c.name),
    },
    roads,
    summary: summaryBase,
    summary_with_notes: summaryWithNotes,
    summary_base: summaryBase,
    siteNotes,
    calc_breakdown: calc.breakdown,
    map: {
      site: { lat: geo.lat, lon: geo.lon, label: geo.label },
      competitors: competitors15,
      all_competitors: compAll3,
      competitor_radius_mi: 3.0,
      aadt: mapStations,        // for map dots only
      aadt_used: aadtUsedMarker || { lat: geo.lat, lon: geo.lon, aadt: usedAADT, method, fallback: method === "fallback_no_dot_found" || method === "fallback_low_aadt" }
    },
  };
}

app.post("/estimate", async (req, res) => {
  try { const result = await performEstimate(req.body || {}); res.json(result); }
  catch (e) { res.status(400).json({ ok: false, status: "Estimate failed", detail: String(e) }); }
});

/* ------------------------- Competitors API ------------------------- */
app.get("/api/competitors", async (req, res) => {
  try {
    const lat = +req.query.lat, lon = +req.query.lon;
    const rMi = Math.max(0.25, Math.min(5, +req.query.radiusMi || 1.0));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: "lat/lon required" });
    const list = await competitorsWithinRadiusMiles(lat, lon, rMi).catch(() => []);
    const features = list.map((s, i) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: { id: i, name: s.name || "Fuel", brand: (s.name || "Fuel"), address: null, miles: s.miles, heavy: !!s.heavy, sunoco: !!s.sunoco }
    }));
    const body = { type: "FeatureCollection", features };
    const json = JSON.stringify(body);
    const etag = 'W/"' + crypto.createHash("sha1").update(json).digest("hex") + '"';
    const inm = req.headers["if-none-match"];
    if (inm && inm === etag) return res.status(304).end();
    res.set("ETag", etag);
    res.set("Cache-Control", "public, max-age=60");
    res.type("application/geo+json").send(json);
  } catch (e) { res.status(500).json({ error: "competitors failed", detail: String(e) }); }
});

/* -------------------------- PDF report API -------------------------- */
function zoomForRadius(lat, radiusMi, mapWidthPx = 1024) {
  const radiusMeters = radiusMi * 1609.344;
  const cosLat = Math.cos(lat * Math.PI / 180);
  const z = Math.log2((156543.03392 * cosLat * mapWidthPx) / (2 * radiusMeters));
  return Math.max(3, Math.min(20, Math.round(z)));
}
async function fetchBuffer(url, timeout = 20000) {
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, timeout);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}
async function buildStaticCompetitorMapImage(site, comps, radiusMi = 3.0, opts = {}) {
  if (!GOOGLE_API_KEY) return null;
  const width = opts.width || 1024, height = opts.height || 640, scale = 2;
  const z = zoomForRadius(site.lat, radiusMi, width);
  const maxComps = Math.min(90, (comps || []).length);
  const normals = [], heavies = [];
  for (let i = 0; i < maxComps; i++) { const c = comps[i]; if (c.heavy) heavies.push(c); else normals.push(c); }
  const params = [];
  params.push(`center=${site.lat},${site.lon}`); params.push(`zoom=${z}`);
  params.push(`size=${width}x${height}`); params.push(`scale=${scale}`); params.push(`maptype=roadmap`);
  params.push(`markers=size:mid|color:0xFFD700|label:S|${site.lat},${site.lon}`);
  if (heavies.length) params.push(`markers=size:small|color:0xF97373|label:B|${heavies.map(c => `${c.lat},${c.lon}`).join("|")}`);
  if (normals.length) params.push(`markers=size:tiny|color:0x34D399|label:C|${normals.map(c => `${c.lat},${c.lon}`).join("|")}`);
  params.push("style=feature:poi|visibility:off"); params.push("style=feature:road|element:labels.icon|visibility:off"); params.push("style=feature:transit|visibility:off");
  const url = `https://maps.googleapis.com/maps/api/staticmap?${params.join("&")}&key=${GOOGLE_API_KEY}`;
  try { return await fetchBuffer(url, 25000); } catch { return null; }
}
async function buildStreetViewImage(site, opts = {}) {
  if (!GOOGLE_API_KEY) return null;
  const width = opts.width || 1024, height = opts.height || 640, scale = 2;
  const url = `https://maps.googleapis.com/maps/api/streetview?size=${width}x${height}&scale=${scale}&location=${site.lat},${site.lon}&fov=90&pitch=0&key=${GOOGLE_API_KEY}`;
  try { return await fetchBuffer(url, 20000); } catch { return null; }
}
function drawSectionTitle(doc, text, y, opts = {}) {
  const { margin, color } = opts;
  const left = margin || 36;
  doc.fillColor(color || "#0b0d12");
  doc.font("Helvetica-Bold").fontSize(13).text(text, left, y);
  return y + 18;
}
function drawKeyValue(doc, key, value, x, y, w) {
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0b0d12").text(key, x, y);
  doc.font("Helvetica").fontSize(11).fillColor("#1c2736").text(value || "—", x, y + 14, { width: w, continued: false });
  return y + 34;
}
function bulletLines(doc, items, x, y, w, opts = {}) {
  const { bullet = "-" } = opts;
  doc.font("Helvetica").fontSize(11).fillColor("#1c2736");
  const lineGap = 4;
  for (const s of items) {
    const line = String(s || "").trim();
    if (!line) continue;
    const prefix = bullet ? `${bullet} ` : "";
    doc.text(`${prefix}${line}`, x, y, { width: w, lineGap });
    y = doc.y + 6;
  }
  return y;
}
app.post("/report/pdf", async (req, res) => {
  try {
    const result = await performEstimate(req.body || {});
    if (!result?.ok) throw new Error("Estimate failed");

    const site = result?.map?.site || null;
    if (!site) throw new Error("No site location for report");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=FuelIQ_Site_Report.pdf");
    const doc = new PDFDocument({ size: "A4", margin: 36 }); doc.pipe(res);

    const pageW = doc.page.width, margin = 36, contentW = pageW - margin * 2; let y = margin;
    doc.fillColor("#0b0d12").font("Helvetica-Bold").fontSize(18).text("Sunoco, LP Fuel IQ — Site Report", margin, y); y += 24;
    doc.font("Helvetica").fontSize(11).fillColor("#475569").text(`Address: ${result.map?.site?.label || req.body?.address || ""}`, margin, y, { width: contentW }); y += 16;

    const userNotesLine = (() => {
      if (typeof result.siteNotes === "string" && result.siteNotes.trim()) return result.siteNotes.trim();
      if (typeof req.body?.siteNotes === "string" && req.body.siteNotes.trim()) return req.body.siteNotes.trim();
      return "";
    })();
    if (userNotesLine) {
      doc.font("Helvetica").fontSize(11).fillColor("#1c2736").text(`User Entered Site Notes: ${userNotesLine}`, margin, y, { width: contentW });
      y = doc.y + 12;
    }

    y = drawSectionTitle(doc, "Estimate Summary", y, { margin, color: "#334155" });
    const colW = contentW / 2 - 8; let yL = y, yR = y;
    yL = drawKeyValue(doc, "LOW (adjusted base)", (result.estimate?.low ?? result.low)?.toLocaleString() || "—", margin, yL, colW);
    yL = drawKeyValue(doc, "Range", result.estimate?.range || (result.low && result.high ? `${result.low.toLocaleString()}–${result.high.toLocaleString()}` : "—"), margin, yL, colW);
    yR = drawKeyValue(doc, "Year 2", (result.estimate?.year2 ?? result.year2)?.toLocaleString() || "—", margin + colW + 16, yR, colW);
    yR = drawKeyValue(doc, "Year 3", (result.estimate?.year3 ?? result.year3)?.toLocaleString() || "—", margin + colW + 16, yR, colW);
    y = Math.max(yL, yR) + 4;

    y = drawSectionTitle(doc, "AADT & Competition", y, { margin, color: "#334155" });
    doc.font("Helvetica").fontSize(11).fillColor("#1c2736").text(result.aadtText || "—", margin, y, { width: contentW }); y += 16;
    doc.font("Helvetica").fontSize(11).fillColor("#1c2736").text(result.competitionText || "—", margin, y, { width: contentW }); y += 18;

    y = drawSectionTitle(doc, "Reasons for this estimate", y, { margin, color: "#334155" });
    const B = result.calc_breakdown || {}; const bullets = [];
    const finalEstimateLine = formatFinalEstimateLine(result);
    if (finalEstimateLine) bullets.push(finalEstimateLine);
    const baselineSource = { ...(B.baselineComponents || {}), ...(result.inputs?.baseline_settings || {}) };
    const baselineLine = formatBaselineSummaryLine(result.inputs?.aadt_used ?? null, baselineSource, B.baseline);
    if (baselineLine) bullets.push(baselineLine);
    if (B.compRule) {
      const baseMultText = formatMultiplierWithNote(B.compRule.baseMult);
      const compMultText = formatMultiplierWithNote(B.compRule.compMult);
      bullets.push(`Competition rule: base ${baseMultText} − Big box ${Number(B.compRule.heavyPenalty).toFixed(2)} = × ${compMultText} → ${Number(B.compRule.afterComp).toLocaleString()}`);
      bullets.push(`Competitors (1.5 mi): ${Number(B.compRule.compCount ?? result.competition?.count ?? 0)} total • Big box ${Number(B.compRule.heavyCount ?? result.competition?.heavy_count ?? 0)}`);
    }
    if (B.caps) {
      const softHit = B.compRule && B.compRule.afterComp > B.caps.capSoftTotal;
      bullets.push(`Capacity caps: equipment ${Number(B.caps.capEquip).toLocaleString()}; soft ${Number(B.caps.capSoftTotal).toLocaleString()}; hard ${Number(B.caps.capHardTotal).toLocaleString()}${softHit ? " (soft cap applied −10%)" : ""}`);
    }
    if (B.priceMult != null) bullets.push(`Pricing factor: × ${formatMultiplierWithNote(B.priceMult)}`);
    if (B.extrasMult != null) bullets.push(`Extras multiplier: × ${formatMultiplierWithNote(B.extrasMult)}`);
    if (B.preClamp != null && B.finalClampedToBaseline != null) bullets.push(`Clamp to baseline: min(${Number(B.preClamp).toLocaleString()}, baseline) → ${Number(B.finalClampedToBaseline).toLocaleString()}`);
    if (result.roads?.summary) bullets.push(`Road context: ${result.roads.summary}`);
    if (result.inputs?.aadt_components?.method) {
      const comp = result.inputs.aadt_components;
      let mText;
      if (comp.method === "dot_station_on_entered_road") {
        mText = `DOT - entered road (${comp.enteredRoad || "—"})`;
      } else if (comp.method === "fallback_low_aadt") {
        const raw = Number.isFinite(comp.raw_aadt) ? Number(comp.raw_aadt).toLocaleString() : "<2,000";
        mText = `Fallback — DOT reported ${raw} < 2,000`;
      } else if (comp.method === "fallback_no_dot_found") {
        mText = "Fallback — no DOT station";
      } else {
        mText = comp.method;
      }
      bullets.push(`AADT method: ${mText}`);
    }
    y = bulletLines(doc, bullets, margin, y, contentW); y += 6;

    y = drawSectionTitle(doc, "Summary", y, { margin, color: "#334155" });
    const summaryBlockRaw = (() => {
      const baseRaw = result.summary_base ?? result.summary ?? "";
      const base = typeof baseRaw === "string" ? baseRaw : String(baseRaw || "");
      if (base) return base;
      const notes = typeof result.siteNotes === "string" ? result.siteNotes.trim() : "";
      if (notes) return `User Entered Site Notes: ${notes}`;
      return base;
    })();
    const summaryBlock = cleanSummaryText(summaryBlockRaw);
    doc.font("Helvetica").fontSize(11).fillColor("#1c2736").text(summaryBlock || "—", margin, y, { width: contentW });

    if (Array.isArray(result.csv) && result.csv.length) {
      y = doc.y + 16; y = drawSectionTitle(doc, "Nearby developments (flagged)", y, { margin, color: "#334155" });
      const devLines = result.csv.slice(0, 6).map((x) => {
        const parts = [x.name, x.status, x.details, x.date].map((v) => (typeof v === "string" ? v.trim() : ""));
        return parts.filter(Boolean).join("; ");
      });
      y = bulletLines(doc, devLines, margin, y, contentW);
    }

    doc.end();
  } catch (e) { res.status(400).json({ ok: false, status: "PDF_FAILED", detail: String(e) }); }
});

/* ------------------------------- Start ------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server listening on :${PORT}`));
