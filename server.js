// server.js — Fuel IQ API (fix pack 2025-10-01)
// Fixes:
//  - Fallback chip shows ONLY when hard fallback AADT is used (no DOT station found)
//  - Map payload returns ALL competitors (3.0 mi) for display
//  - Competition object includes counts for 1.5 mi and 3.0 mi + heavy count
//  - GPT prompt no longer mentions "CSV"; uses "nearby developments"
//  - Breakdown carries compCount & heavyCount so UI can always display them
//  - "Nearest DOT station" wording (no "fallback" term for DOT case)

import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

/* --------------------------- App & static UI --------------------------- */
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

/* ------------------------------ Config ------------------------------ */
const UA = "FuelEstimator/3.4 (+your-app)";
const CONTACT = process.env.OVERPASS_CONTACT || UA;

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

/* --------------------- fetch() helper (Node 16/18) --------------------- */
let _cachedFetch = null;
async function getFetch() {
  if (typeof fetch === "function") return fetch;
  if (_cachedFetch) return _cachedFetch;
  const mod = await import("node-fetch"); // npm i node-fetch@3 if on Node 16
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

/* -------------------- CSV (Developments STOP banner) -------------------- */
// (Data still read from CSV file, but "CSV" is never surfaced to the end user.)
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
async function reverseStreet(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`;
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 12000);
    const j = await r.json();
    const a = j?.address || {};
    return (a.road || a.pedestrian || a.footway || a.cycleway || a.path || "").trim();
  } catch { return ""; }
}
async function geocode(address) {
  const direct = tryParseLatLng(address);
  if (direct) return direct;
  const hasNum = /\d/.test(address || "");
  if (hasNum) { try { return await geocodeCensus(address); } catch { return await geocodeNominatim(address); } }
  else { try { return await geocodeNominatim(address); } catch { return await geocodeCensus(address); } }
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
  NC: { kind: "arcgis", url: "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0", geoType: "point" }, // NCDOT stations
  VA: { kind: "arcgis", url: "https://services.arcgis.com/p5v98VHDX9Atv3l7/arcgis/rest/services/VDOTTrafficVolume/FeatureServer/0", geoType: "line" },          // VDOT Traffic Volume
  DC: { kind: "arcgis", url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Transportation_TrafficVolume_WebMercator/MapServer/4", geoType: "line" }, // DDOT 2023 volume
  FL: { kind: "arcgis", url: "https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/FeatureServer/0", geoType: "line" },                                    // FDOT AADT TDA
};

/* -------------------------- ArcGIS query helpers -------------------------- */
async function arcgisQueryNearby(url, lat, lon, radiusMeters = 1609, outFields = "*") {
  const p = new URLSearchParams({
    f: "json",
    where: "1=1",
    outFields,
    returnGeometry: "true",
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(Math.round(radiusMeters)),
    units: "esriSRUnit_Meter",
    outSR: "4326",
    resultRecordCount: "500",
  });
  const r = await fetchWithTimeout(`${url}/query?${p}`, { headers: { "User-Agent": UA, Accept: "application/json" } }, 22000);
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j.features) ? j.features : [];
}
async function arcgisQueryWhere(url, where, outFields = "*", returnGeometry = true) {
  const p = new URLSearchParams({
    f: "json",
    where,
    outFields,
    returnGeometry: returnGeometry ? "true" : "false",
    outSR: "4326",
    resultRecordCount: "500",
  });
  const r = await fetchWithTimeout(`${url}/query?${p}`, { headers: { "User-Agent": UA, Accept: "application/json" } }, 22000);
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j.features) ? j.features : [];
}

/* ------------------------- AADT parsing utilities ------------------------- */
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
  const routeKeys = ["ROUTE", "ROUTE_COMMON_NAME", "RTE_NAME", "ROAD", "STREET", "STREETNAME", "FULLNAME", "NAME", "ROUTEID"];
  const locKeys = ["LOCATION", "START_LABEL", "END_LABEL", "FROM_ST", "TO_ST", "FROMNODE", "TONODE", "DESCRIPTION"];
  let route=null, loc=null;
  for (const k of Object.keys(attrs||{})) {
    const up = k.toUpperCase();
    if (!route && routeKeys.some((p) => up.includes(p))) route = attrs[k];
    if (!loc && locKeys.some((p) => up.includes(p))) loc = attrs[k];
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
  return /\b(I[-\s]*\d+|US[-\s]*\d+|NC[-\s]*\d+|VA[-\s]*\d+|FL[-\s]*\d+|SR[-\s]*\d+|STATE\s*ROUTE\s*\d+)\b/.test(t);
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
  if (Array.isArray(g.rings)) {
    let best = { lat: null, lon: null, distM: Infinity };
    for (const ring of g.rings) {
      for (const [x,y] of ring) {
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
    const record = {
      lat: pos.lat, lon: pos.lon, distM: pos.distM,
      aadt: latest.aadt, year: latest.year,
      route: rl.route, location: rl.location,
      station_id: A.LocationID || A.Location_ID || A.OBJECTID || A.OBJECTID_1 || null,
      rte_cls: A.RTE_CLS || A.RTE_TYPE_CD || null,
      state: stateCode,
    };
    out.push(record);
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
  if (withMatch.length) return withMatch[0];
  if (!looksNumberedHighway(streetText)) {
    const nonNum = stations.filter(s => !(String(s.route||"").match(/\b(I|US|SR|NC|VA|FL)[-\s]?\d+/)));
    if (nonNum.length) return nonNum[0];
  }
  return stations[0];
}

/* ---------------------- Provider query wrappers ---------------------- */
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
  return st.filter(s => s.distM <= 1.5 * 1609.344);
}

/* --------------------- Competition (OSM + Google) --------------------- */
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
          {
            method: "POST",
            headers: {
              "User-Agent": CONTACT,
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: "data=" + encodeURIComponent(data),
          },
          25000
        );
        const ct = r.headers.get("content-type") || "";
        const txt = await r.text();
        if (!r.ok || !ct.includes("application/json"))
          throw new Error(`Overpass ${r.status}: ${txt.slice(0, 200)}`);
        return JSON.parse(txt);
      } catch (e) {
        last = e;
        await sleep(900 * (i + 1));
      }
    }
  }
  throw last;
}
const HEAVY_BRANDS = /(sheetz|wawa|race\s?trac|racetrac|buc-?ee'?s|royal\s?farms|quik.?trip|\bqt\b)/i;
const IS_SUNOCO = /\bsunoco\b/i;
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
      out.push({
        name,
        lat: +latc, lon: +lonc,
        miles: +distMiles(lat, lon, latc, lonc).toFixed(3),
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
    return {
      name, lat: +latc, lon: +lonc,
      miles: +distMiles(lat, lon, latc, lonc).toFixed(3),
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
  return out.filter((s) => s.miles <= rMi);
}

/* ----------------------- Road context (heuristic only) ----------------------- */
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
  const nice = (r) => [r.name || r.highway, r.maxspeed ? `${r.maxspeed} mph` : null, r.lanes ? `${r.lanes} lanes` : null].filter(Boolean).join(" • ");
  const mainLabel = main.map(nice).filter(Boolean).slice(0, 3).join(" | ");
  const sideLabel = side.map(nice).filter(Boolean).slice(0, 3).join(" | ");
  const intersections = Math.max(0, Math.round(rows.length / 3));
  return { summary: [mainLabel, sideLabel].filter(Boolean).join(" — "), main, side, signals, intersections };
}

/* ------------------------- Gallons computation ------------------------- */
function gallonsWithRules({ aadt, mpds, diesel, compCount, heavyCount, pricePosition, userExtrasMult = 1 }) {
  // Baseline ceiling (unchanged): AADT × 2% × 8 × 30
  const baseline = aadt * 0.02 * 8 * 30;

  let baseMult = 1.0;
  if (compCount === 1) baseMult = 0.75;
  else if (compCount >= 2 && compCount <= 4) baseMult = 0.6;
  else if (compCount >= 5) baseMult = 0.5;

  let heavyPenalty = 0;
  if (heavyCount === 1) heavyPenalty = 0.2;
  else if (heavyCount >= 2) heavyPenalty = 0.35;

  const compMult = Math.max(0.2, baseMult - heavyPenalty);
  const afterComp = baseline * compMult;

  // Equipment/soft/hard caps (unchanged)
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

  return {
    base, low, high,
    year2: Math.round(base * 1.027),
    year3: Math.round(base * 1.027 * 1.0125),
    breakdown: {
      aadt, baseline: Math.round(baseline),
      compRule: { compCount, heavyCount, baseMult, heavyPenalty, compMult, afterComp: Math.round(afterComp) },
      caps: { capEquip: Math.round(capEquip), capSoftTotal, capHardTotal },
      priceMult, extrasMult: userExtrasMult, preClamp, finalClampedToBaseline: base,
    },
  };
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
app.get("/google/autocomplete", async (req, res) => {
  const q = String(req.query.input || "").trim();
  if (!q) return res.json({ ok: false, status: "BAD_REQUEST", items: [] });
  if (!GOOGLE_API_KEY) return res.json({ ok: false, status: "MISSING_KEY", items: [] });
  try {
    const au = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&components=country:us&key=${GOOGLE_API_KEY}`;
    const ar = await fetchWithTimeout(au, { headers: { "User-Agent": UA } }, 15000);
    const aj = await ar.json();
    if (aj.status !== "OK" && aj.status !== "ZERO_RESULTS")
      return res.json({ ok: false, status: aj.status, items: [] });
    const items = [];
    for (const p of (aj.predictions || []).slice(0, 6)) {
      const pid = p.place_id; if (!pid) continue;
      const du = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${pid}&fields=formatted_address,geometry,name,place_id,types&key=${GOOGLE_API_KEY}`;
      const dr = await fetchWithTimeout(du, { headers: { "User-Agent": UA } }, 15000);
      const dj = await dr.json(); if (dj.status !== "OK") continue;
      const loc = dj.result?.geometry?.location;
      if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
        items.push({
          type: "Google",
          display: dj.result.formatted_address || dj.result.name || p.description,
          lat: +loc.lat, lon: +loc.lng, place_id: dj.result.place_id || pid, score: 1.3,
        });
      }
    }
    return res.json({ ok: true, status: "OK", items });
  } catch (e) { return res.json({ ok: false, status: "ERROR", items: [], error: String(e) }); }
});
app.get("/google/findplace", async (req, res) => {
  try {
    if (!GOOGLE_API_KEY) return res.json({ ok: false, status: "MISSING_KEY" });
    const input = String(req.query.input || "").trim();
    if (!input) return res.json({ ok: false, status: "BAD_REQUEST" });
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(input)}&inputtype=textquery&fields=place_id,name,formatted_address,geometry&key=${GOOGLE_API_KEY}`;
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

/* --------------------- AADT sources list (1 mile) --------------------- */
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

/* ----------------------------- Estimate core ----------------------------- */
app.post("/estimate", async (req, res) => {
  try {
    const {
      address, mpds, diesel, siteLat, siteLon, aadtOverride, advanced,
      client_rating, auto_low_rating,
    } = req.body || {};

    const MPDS = +mpds, DIESEL = +(diesel || 0);
    if (!(Number.isFinite(MPDS) && MPDS > 0)) {
      return res.status(400).json({ ok: false, status: "Regular MPDs required (>0)" });
    }
    if (!address && !(Number.isFinite(siteLat) && Number.isFinite(siteLon))) {
      return res.status(400).json({ ok: false, status: "Address or coordinates required" });
    }

    const pricePosition = String(advanced?.price_position || "inline");

    // Geocode/admin + entered street
    let geo;
    if (Number.isFinite(siteLat) && Number.isFinite(siteLon)) {
      geo = { lat: +siteLat, lon: +siteLon, label: address || `${siteLat}, ${siteLon}` };
    } else {
      geo = await geocode(address);
    }
    const [admin, enteredStreet] = await Promise.all([
      reverseAdmin(geo.lat, geo.lon),
      reverseStreet(geo.lat, geo.lon)
    ]);
    const stateCode = toStateCode(admin.state) || "NC";

    // Competition
    const compAll3 = await competitorsWithinRadiusMiles(geo.lat, geo.lon, 3.0).catch(() => []);
    const competitors15 = compAll3.filter((c) => c.miles <= 1.5);
    const compCount = competitors15.length;
    const heavyCount = competitors15.filter((c) => c.heavy).length;
    const sunocoNearby = compAll3.some((c) => c.sunoco && c.miles <= 1.0);
    const ruralEligible = compAll3.length === 0;

    // Developments (from CSV file, label hidden)
    const devCsv = matchCsvDevelopments(admin.city, admin.county, admin.state);

    // Road context
    const roads = await roadContext(geo.lat, geo.lon).catch(() => ({ summary: "", main: [], side: [], signals: 0, intersections: 0 }));

    // ------------------ DOT AADT selection (entered road first) ------------------
    let usedAADT = null, method = "dot_station_on_entered_road";
    let aadtUsedMarker = null;
    let mapStations = [];

    const overrideVal = Number(aadtOverride);
    if (Number.isFinite(overrideVal) && overrideVal > 0) {
      usedAADT = Math.round(overrideVal); method = "override";
    } else {
      let onStreet = await providerStationsOnStreet(stateCode, geo.lat, geo.lon, enteredStreet).catch(() => []);
      if (!onStreet.length && roads?.main?.[0]?.name) {
        onStreet = await providerStationsOnStreet(stateCode, geo.lat, geo.lon, roads.main[0].name).catch(() => []);
      }
      mapStations = await providerNearbyAADT(stateCode, geo.lat, geo.lon, 1.0).catch(() => []);
      let pick = null;
      if (onStreet.length) pick = pickStationForStreet(onStreet, enteredStreet || roads?.main?.[0]?.name || "");
      if (!pick) { method = "dot_station_nearest"; pick = mapStations[0] || null; } // <- rename (no "fallback" in label)
      if (pick) {
        usedAADT = pick.aadt;
        aadtUsedMarker = {
          lat: pick.lat, lon: pick.lon, aadt: pick.aadt, year: pick.year,
          route: pick.route, location: pick.location,
          station_id: pick.station_id, source_url: AADT_PROVIDERS[stateCode]?.url || null,
          state: stateCode,
          fallback: false,
          method
        };
      }
    }
    if (!(Number.isFinite(usedAADT) && usedAADT > 0)) { usedAADT = 8000; method = "fallback_no_dot_found"; }

    // --------------------------- Gallons (DOT direct) ---------------------------
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
      aadt: usedAADT, mpds: MPDS, diesel: DIESEL, compCount, heavyCount, pricePosition, userExtrasMult,
    });

    // ------------------------------ GPT summary ------------------------------
    async function gptJSONCore(model, prompt) {
      if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
      const r = await fetchWithTimeout(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            response_format: { type: "json_object" },
            temperature: 0.2,
            max_tokens: 1200,
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
      const models = ["gpt-4o-mini", "gpt-4o"];
      let last = null;
      for (const m of models) {
        for (let i = 0; i < 2; i++) {
          try { return await gptJSONCore(m, prompt); }
          catch (e) { last = e; await sleep(400); }
        }
      }
      throw last || new Error("GPT failed");
    }
    async function gptSummary(ctx) {
      const sys = 'Return {"summary":"<text>"} ~8–12 sentences. Include AADT method (DOT), baseline ceiling math, competition rule & heavy penalties, pricing, user adjustments, caps, LOW/BASE/HIGH, road context, and notable nearby developments.';
      const prompt = `
Address: ${ctx.address}
AADT used (DOT): ${ctx.aadt} (${ctx.method})
Roads (context): ${ctx.roads.summary}
Competition: ${ctx.compCount} (heavy ${ctx.heavyCount}) — notable: ${ctx.notable}
Pricing: ${ctx.pricePosition}; User adjustments: ${ctx.userAdj || "none"}
Nearby developments flagged: ${ctx.dev || "none"}
Result gallons LOW/BASE/HIGH: ${ctx.low}/${ctx.base}/${ctx.high}
`.trim();
      try {
        const j = await gptJSONWithRetry(`${sys}\n${prompt}`);
        const s = (j && j.summary) ? String(j.summary).trim() : "";
        if (s) return s;
      } catch {}
      // Fallback summary
      return `AADT ${ctx.aadt} (${ctx.method}); competition ${ctx.compCount} (heavy=${ctx.heavyCount}); pricing ${ctx.pricePosition}; adjustments ${ctx.userAdj || "none"}; result ${ctx.low}–${ctx.high} with base ${ctx.base}.`;
    }

    const adjBits = [];
    if (pricePosition === "below") adjBits.push("+10% below-market pricing");
    if (pricePosition === "above") adjBits.push("−10% above-market pricing");
    if (ruralApplied) adjBits.push("+30% rural bonus (0 comps within 3 mi)");
    if (autoLow) adjBits.push("−30% low reviews (<4.0)");
    extras.forEach((e) => adjBits.push(`${e.pct > 0 ? "+" : ""}${e.pct}% ${e.note || "adj."}`));
    const summary = await gptSummary({
      address: address || geo.label,
      aadt: usedAADT, method,
      roads, compCount, heavyCount,
      notable: competitors15.filter((c) => c.heavy).slice(0, 6).map((c) => c.name).join(", ") || "none",
      pricePosition, userAdj: adjBits.join("; "),
      base: calc.base, low: calc.low, high: calc.high,
      dev: devCsv.slice(0, 4).map((x) => `${x.name} ${x.status ? `(${x.status})` : ""}`).join("; "),
    });

    // UI text
    let aadtText = "";
    if (method === "override") aadtText = `AADT (override): ${usedAADT.toLocaleString()} vehicles/day`;
    else if (method === "dot_station_on_entered_road") aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (DOT • entered road)`;
    else if (method === "dot_station_nearest") aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (DOT • nearest station)`;
    else if (method === "fallback_no_dot_found") aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (fallback)`;
    else aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (${method})`;

    const nearestComp = compAll3.length ? compAll3[0].miles : null;
    let competitionText = "";
    if (compCount === 0) {
      if (ruralEligible) competitionText = "Competition: None within 3 mi.";
      else competitionText = `Competition: None within 1.5 mi${nearestComp != null ? ` (nearest ~${(+nearestComp).toFixed(1)} mi)` : ""}.`;
    } else {
      competitionText = `Competition: ${compCount} station${compCount !== 1 ? "s" : ""} within 1.5 mi`;
      if (heavyCount > 0) competitionText += ` (${heavyCount} heavy)`;
      competitionText += ".";
    }

    // Response
    res.json({
      ok: true,
      estimate: {
        low: calc.low,
        range: `${Math.round(calc.low)}–${Math.round(calc.high)}`,
        year2: calc.year2,
        year3: calc.year3,
      },
      aadtText,
      competitionText,
      csv: devCsv,

      // legacy / additional fields
      base: calc.base,
      low: calc.low,
      high: calc.high,
      year2: calc.year2,
      year3: calc.year3,
      inputs: {
        mpds: MPDS, diesel: DIESEL,
        aadt_used: usedAADT,
        price_position: pricePosition,
        aadt_components: { method },
      },
      flags: {
        rural_bonus_applied: ruralApplied,
        rural_eligible: ruralEligible,
        sunoco_within_1mi: sunocoNearby,
        auto_low_rating: autoLow,
      },
      competition: {
        count: compCount,           // within 1.5 mi (rule)
        count_3mi: compAll3.length, // for context
        heavy_count: heavyCount,
        nearest_mi: competitors15[0]?.miles ?? null,
        notable_brands: competitors15.filter((c) => c.heavy).slice(0, 6).map((c) => c.name),
      },

      roads,
      summary,                // GPT summary without the word "CSV"
      calc_breakdown: calc.breakdown,

      // Map payloads
      map: {
        site: { lat: geo.lat, lon: geo.lon, label: geo.label },
        competitors: competitors15,           // still included (<=1.5 mi)
        all_competitors: compAll3,            // NEW: show everything on the map (<=3.0 mi)
        competitor_radius_mi: 3.0,
        aadt: mapStations,                    // dots for main map
        aadt_used: aadtUsedMarker || {
          lat: geo.lat, lon: geo.lon, aadt: usedAADT,
          method, fallback: method === "fallback_no_dot_found"
        }
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, status: "Estimate failed", detail: String(e) });
  }
});

/* ------------------------------- Start ------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server listening on :${PORT}`));
