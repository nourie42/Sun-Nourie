// server.js — Fuel IQ API (fix pack 2025-10-03)
// Changes in this build:
//  • Autocomplete endpoint supports optional location bias (lat/lon/radius) to improve suggestions.
//  • Strict AADT selection: use DOT station(s) on the ENTERED ROAD ONLY. If none found, use hard fallback.
//    (We no longer pick “nearest DOT station on a different road”.)
//  • Client can pass enteredRoad; server extracts a road from the entered address if not provided.
//  • Everything else preserved: competitors layer, PDF report, math, STOP chip only for true fallback.

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
  const nice = (r) => [r.name || r.highway, r.maxspeed ? `${r.maxspeed} mph` : null, r.lanes ? `${r.lanes} lanes` : null].filter(Boolean).join(" • ");
  const mainLabel = main.map(nice).filter(Boolean).slice(0, 3).join(" | ");
  const sideLabel = side.map(nice).filter(Boolean).slice(0, 3).join(" | ");
  const intersections = Math.max(0, Math.round(rows.length / 3));
  return { summary: [mainLabel, sideLabel].filter(Boolean).join(" — "), main, side, signals, intersections };
}

/* ------------------------- Gallons computation ------------------------- */
function gallonsWithRules({ aadt, mpds, diesel, compCount, heavyCount, pricePosition, userExtrasMult = 1 }) {
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

    const predictions = (aj.predictions || []).filter((p) => p.place_id).slice(0, 6);
    if (!predictions.length) return res.json({ ok: true, status: "ZERO_RESULTS", items: [] });

    const detailFields = "formatted_address,geometry,name,place_id";
    const detailFetches = predictions.map(async (p) => {
      try {
        const pid = p.place_id;
        const du = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${pid}&fields=${encodeURIComponent(detailFields)}&key=${GOOGLE_API_KEY}`;
        const dr = await fetchWithTimeout(du, { headers: { "User-Agent": UA } }, 15000);
        const dj = await dr.json();
        if (dj.status !== "OK") return null;
        const loc2 = dj.result?.geometry?.location;
        if (!loc2 || !Number.isFinite(loc2.lat) || !Number.isFinite(loc2.lng)) return null;

        const display = dj.result?.formatted_address || p.description || dj.result?.name || "";
        if (!display) return null;

        return {
          type: "Google",
          display,
          lat: +loc2.lat,
          lon: +loc2.lng,
          place_id: dj.result?.place_id || pid,
          score: 1.3,
        };
      } catch {
        return null;
      }
    });

    const detailResults = await Promise.allSettled(detailFetches);
    const items = detailResults
      .map((r) => (r.status === "fulfilled" ? r.value : null))
      .filter((it) => it && Number.isFinite(it.lat) && Number.isFinite(it.lon));

    if (!items.length) return res.json({ ok: true, status: "ZERO_RESULTS", items: [] });
    return res.json({ ok: true, status: "OK", items });
  } catch (e) { return res.json({ ok: false, status: "ERROR", items: [], error: String(e) }); }
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
          client_rating, auto_low_rating, enteredRoad } = reqBody || {};

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
  let mapStations = await providerNearbyAADT(stateCode, geo.lat, geo.lon, 1.0).catch(() => []);

  const overrideVal = Number(aadtOverride);
  if (Number.isFinite(overrideVal) && overrideVal > 0) {
    usedAADT = Math.round(overrideVal); method = "override";
  } else {
    let onStreet = await providerStationsOnStreet(stateCode, geo.lat, geo.lon, enteredRoadText).catch(() => []);
    let pick = onStreet.length ? pickStationForStreet(onStreet, enteredRoadText) : null;

    if (pick) {
      usedAADT = pick.aadt;
      aadtUsedMarker = {
        lat: pick.lat, lon: pick.lon, aadt: pick.aadt, year: pick.year,
        route: pick.route, location: pick.location,
        station_id: pick.station_id, source_url: AADT_PROVIDERS[stateCode]?.url || null,
        state: stateCode, fallback: false, method
      };
    }
  }
  if (!(Number.isFinite(usedAADT) && usedAADT > 0)) { usedAADT = 8000; method = "fallback_no_dot_found"; }

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
  });

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
    const sys = 'Return {"summary":"<text>"} ~8–12 sentences. Include AADT method (DOT), baseline ceiling math, competition rule & heavy penalties, pricing, user adjustments, caps, LOW/BASE/HIGH, road context, and notable nearby developments.';
    const prompt = `
Address: ${ctx.address}
AADT used (DOT): ${ctx.aadt} (${ctx.method})
Road (entered): ${ctx.enteredRoad}
Roads (context): ${ctx.roads.summary}
Competition: ${ctx.compCount} (heavy ${ctx.heavyCount})
Pricing: ${ctx.pricePosition}; User adjustments: ${ctx.userAdj || "none"}
Nearby developments: ${ctx.dev || "none"}
Result LOW/BASE/HIGH: ${ctx.low}/${ctx.base}/${ctx.high}
`.trim();
    try {
      const j = await gptJSONWithRetry(`${sys}\n${prompt}`);
      const s = (j && j.summary) ? String(j.summary).trim() : "";
      if (s) return s;
    } catch {}
    return `AADT ${ctx.aadt} (${ctx.method}); competition ${ctx.compCount} (heavy=${ctx.heavyCount}); pricing ${ctx.pricePosition}; adjustments ${ctx.userAdj || "none"}; result ${ctx.low}–${ctx.high} base ${ctx.base}.`;
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
    enteredRoad: enteredRoadText,
    roads, compCount, heavyCount,
    pricePosition, userAdj: adjBits.join("; "),
    base: calc.base, low: calc.low, high: calc.high,
    dev: devCsv.slice(0, 4).map((x) => `${x.name}${x.status ? ` (${x.status})` : ""}`).join("; "),
  });

  // UI lines
  let aadtText = "";
  if (method === "override") aadtText = `AADT (override): ${usedAADT.toLocaleString()} vehicles/day`;
  else if (method === "dot_station_on_entered_road") aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (DOT • entered road: ${enteredRoadText || "—"})`;
  else if (method === "fallback_no_dot_found") aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (fallback — no DOT station published for "${enteredRoadText}")`;
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

  return {
    ok: true,
    estimate: { low: calc.low, range: `${Math.round(calc.low)}–${Math.round(calc.high)}`, year2: calc.year2, year3: calc.year3 },
    aadtText, competitionText, csv: devCsv,
    base: calc.base, low: calc.low, high: calc.high, year2: calc.year2, year3: calc.year3,
    inputs: { mpds: MPDS, diesel: DIESEL, aadt_used: usedAADT, price_position: pricePosition, aadt_components: { method, enteredRoad: enteredRoadText } },
    flags: { rural_bonus_applied: ruralApplied, rural_eligible: ruralEligible, sunoco_within_1mi: sunocoNearby, auto_low_rating: autoLow },
    competition: {
      count: compCount, count_3mi: compAll3.length, heavy_count: heavyCount,
      nearest_mi: competitors15[0]?.miles ?? null,
      notable_brands: competitors15.filter((c) => c.heavy).slice(0, 6).map((c) => c.name),
    },
    roads, summary, calc_breakdown: calc.breakdown,
    map: {
      site: { lat: geo.lat, lon: geo.lon, label: geo.label },
      competitors: competitors15,
      all_competitors: compAll3,
      competitor_radius_mi: 3.0,
      aadt: mapStations,        // for map dots only
      aadt_used: aadtUsedMarker || { lat: geo.lat, lon: geo.lon, aadt: usedAADT, method, fallback: method === "fallback_no_dot_found" }
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
  if (heavies.length) params.push(`markers=size:small|color:0xF97373|label:H|${heavies.map(c => `${c.lat},${c.lon}`).join("|")}`);
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
function bulletLines(doc, items, x, y, w) {
  doc.font("Helvetica").fontSize(11).fillColor("#1c2736");
  const lineGap = 4;
  for (const s of items) {
    doc.circle(x + 3, y + 6, 2).fill("#4b5563").fillColor("#1c2736");
    doc.text(String(s), x + 12, y, { width: w, lineGap });
    y = doc.y + 6;
  }
  return y;
}
app.post("/report/pdf", async (req, res) => {
  try {
    const result = await performEstimate(req.body || {});
    if (!result?.ok) throw new Error("Estimate failed");

    const site = result?.map?.site || null; const comps = result?.map?.all_competitors || [];
    if (!site) throw new Error("No site location for report");
    const [siteImg, mapImg] = await Promise.all([
      buildStreetViewImage(site),
      buildStaticCompetitorMapImage(site, comps, result.map?.competitor_radius_mi || 3.0)
    ]);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=FuelIQ_Site_Report.pdf");
    const doc = new PDFDocument({ size: "A4", margin: 36 }); doc.pipe(res);

    const pageW = doc.page.width, margin = 36, contentW = pageW - margin * 2; let y = margin;
    doc.fillColor("#0b0d12").font("Helvetica-Bold").fontSize(18).text("Sunoco, LP Fuel IQ — Site Report", margin, y); y += 24;
    doc.font("Helvetica").fontSize(11).fillColor("#475569").text(`Address: ${result.map?.site?.label || req.body?.address || ""}`, margin, y, { width: contentW }); y += 16;

    if (mapImg) { y = drawSectionTitle(doc, "Competitors (map)", y, { margin, color: "#334155" }); doc.image(mapImg, margin, y, { width: contentW }); y += Math.min(300, (contentW * 0.62)) + 12; }
    if (siteImg){ y = drawSectionTitle(doc, "Street View (site)", y, { margin, color: "#334155" }); doc.image(siteImg, margin, y, { width: contentW }); y += Math.min(260, (contentW * 0.5)) + 8; }

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
    if (B.baseline && result.inputs?.aadt_used) bullets.push(`Baseline ceiling = AADT ${result.inputs.aadt_used.toLocaleString()} × 2% × 8 × 30 = ${B.baseline.toLocaleString()}`);
    if (B.compRule) {
      bullets.push(`Competition rule: base ${Number(B.compRule.baseMult).toFixed(2)} − heavy ${Number(B.compRule.heavyPenalty).toFixed(2)} = × ${Number(B.compRule.compMult).toFixed(2)} → ${Number(B.compRule.afterComp).toLocaleString()}`);
      bullets.push(`Competitors (1.5 mi): ${Number(B.compRule.compCount ?? result.competition?.count ?? 0)} total • heavy ${Number(B.compRule.heavyCount ?? result.competition?.heavy_count ?? 0)}`);
    }
    if (B.caps) {
      const softHit = B.compRule && B.compRule.afterComp > B.caps.capSoftTotal;
      bullets.push(`Capacity caps: equipment ${Number(B.caps.capEquip).toLocaleString()} • soft ${Number(B.caps.capSoftTotal).toLocaleString()} • hard ${Number(B.caps.capHardTotal).toLocaleString()}${softHit ? " (soft cap applied −10%)" : ""}`);
    }
    if (B.priceMult != null) bullets.push(`Pricing factor: × ${Number(B.priceMult).toFixed(2)}`);
    if (B.extrasMult != null) bullets.push(`Extras multiplier: × ${Number(B.extrasMult).toFixed(2)}`);
    if (B.preClamp != null && B.finalClampedToBaseline != null) bullets.push(`Clamp to baseline: min(${Number(B.preClamp).toLocaleString()}, baseline) → ${Number(B.finalClampedToBaseline).toLocaleString()}`);
    if (result.roads?.summary) bullets.push(`Road context: ${result.roads.summary}`);
    if (result.inputs?.aadt_components?.method) bullets.push(`AADT method: ${result.inputs.aadt_components.method === "dot_station_on_entered_road" ? `DOT • entered road (${result.inputs.aadt_components.enteredRoad || "—"})` : result.inputs.aadt_components.method}`);
    y = bulletLines(doc, bullets, margin, y, contentW); y += 6;

    y = drawSectionTitle(doc, "Summary", y, { margin, color: "#334155" });
    doc.font("Helvetica").fontSize(11).fillColor("#1c2736").text((result.summary || "").replace(/\s{2,}/g, " ").trim() || "—", margin, y, { width: contentW });

    if (Array.isArray(result.csv) && result.csv.length) {
      y = doc.y + 16; y = drawSectionTitle(doc, "Nearby developments (flagged)", y, { margin, color: "#334155" });
      const devLines = result.csv.slice(0, 6).map(x => {
        const nm = x.name || ""; const st = x.status ? ` • ${x.status}` : "";
        const dtl = x.details ? ` • ${x.details}` : ""; const dt = x.date ? ` • ${x.date}` : "";
        return `${nm}${st}${dtl}${dt}`;
      });
      y = bulletLines(doc, devLines, margin, y, contentW);
    }

    doc.end();
  } catch (e) { res.status(400).json({ ok: false, status: "PDF_FAILED", detail: String(e) }); }
});

/* ------------------------------- Start ------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server listening on :${PORT}`));
