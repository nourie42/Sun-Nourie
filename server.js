// server.js — Fuel IQ (FULL) — 2025‑10‑03
// Features
// • Static UI (public/index.html)
// • Fast autocomplete (/autocomplete): Google + OSM + Census, proximity‑ranked
// • DOT AADT (NC, VA, DC, FL) with strict entered‑road match + hyphen/space variants
// • Soft backup: if on‑street match fails but a DOT station is ≤400 m, use it (not "fallback")
// • AADT nearby table (/aadt/nearby)
// • Competitors (exhaustive OSM + multi‑grid Google) with dedup + ETag GeoJSON (/api/competitors)
// • Estimate (/estimate) with full breakdown, clamp reasons, rural/low‑rating logic
// • PDF report (/report/pdf) with Street View, static competitor map, reasons section
//
// Env
//   GOOGLE_API_KEY   (required for Google-powered features and PDF maps/images)
//   OPENAI_API_KEY   (optional; if missing, GPT summary is skipped)
//   OVERPASS_CONTACT (optional; user agent/contact for Overpass)
//   PORT             (optional; default 3000)

import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import PDFDocument from "pdfkit";

/* --------------------------- App setup --------------------------- */
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
const UA = "FuelEstimator/3.7 (+your-app)";
const CONTACT = process.env.OVERPASS_CONTACT || UA;

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// default competitor radius for display/math context
const COMP_RADIUS_DEFAULT_MI = +process.env.COMP_RADIUS_DEFAULT_MI || 3.0;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------- CSV (Developments STOP banner) -------------------- */
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
const toMiles = (m) => m / 1609.344;
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, t = (d) => (d * Math.PI) / 180;
  const dLat = t(lat2 - lat1), dLon = t(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function distMiles(a, b, c, d) { return toMiles(haversine(a, b, c, d)); }
function round5(x) { return Math.round(x * 1e5); }

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
  NC: { kind: "arcgis", url: "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0", geoType: "point" }, // stations
  VA: { kind: "arcgis", url: "https://services.arcgis.com/p5v98VHDX9Atv3l7/arcgis/rest/services/VDOTTrafficVolume/FeatureServer/0", geoType: "line" },
  DC: { kind: "arcgis", url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Transportation_TrafficVolume_WebMercator/MapServer/4", geoType: "line" },
  FL: { kind: "arcgis", url: "https://gis-fdot.opendata.arcgis.com/datasets/annual-average-daily-traffic-tda/explore", geoType: "line" },
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
    .replace(/[-–—]/g, " ") // US-70 -> US 70
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
function routeSearchTerms(streetText) {
  const u = normalizeRoadText(streetText);
  const terms = new Set([u]);
  const re = /\b(I|US|NC|SC|VA|FL|SR|STATE\s*ROUTE)\s*-?\s*(\d+)\b/g;
  let m;
  while ((m = re.exec(u))) {
    let p = m[1].replace(/\s+/g, " ").replace("STATE ROUTE", "SR");
    const n = m[2];
    [ `${p} ${n}`, `${p}${n}`, `${p}-${n}`, `${p} HWY ${n}` ].forEach(t => terms.add(t));
  }
  return [...terms];
}
function buildRouteWhereFromTerms(terms, fields = [
  "ROUTE","ROUTE_COMMON_NAME","NAME","STREETNAME","FULLNAME","ROAD","RTE_NAME",
  "ROUTEID","ROUTE_ID","RTE_ID","RTE_NUM","ST_NAME","STREET","ROUTE_NO","RTE"
]) {
  if (!terms?.length) return null;
  const ors = [];
  for (const f of fields) {
    for (const t of terms) {
      ors.push(`UPPER(${f}) LIKE '%${t.toUpperCase().replace(/'/g, "''")}%'`);
    }
  }
  return ors.length ? `(${ors.join(" OR ")})` : null;
}
function looksNumberedHighway(s) {
  const t = String(s || "").toUpperCase();
  return /\b(I[-\s]*\d+|US[-\s]*\d+|NC[-\s]*\d+|VA[-\s]*\d+|FL[-\s]*\d+|SR[-\s]*\d+|STATE\s*ROUTE\s*\d+)\b/.test(t);
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
  const where = buildRouteWhereFromTerms(routeSearchTerms(streetText));
  if (!where) return [];
  const feats = await arcgisQueryWhere(prov.url, where, "*", true).catch(() => []);
  const st = featuresToStations(stateCode, feats, lat, lon);
  return st.filter(s => s.distM <= 1.5 * 1609.344);
}

/* --------------------- Competition (OSM + Google) --------------------- */
const HEAVY_BRANDS = /(sheetz|wawa|race\s?trac|racetrac|buc-?ee'?s|royal\s?farms|quik.?trip|\bqt\b|pilot\b|flying\s*j|love'?s|ta\b|maverik)/i;
const IS_SUNOCO = /\bsunoco\b/i;

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
          30000
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
function buildOsmAddress(t) {
  const hn = t["addr:housenumber"] || "", st = t["addr:street"] || "";
  const city = t["addr:city"] || t["addr:town"] || t["addr:village"] || "";
  const state = t["addr:state"] || "", zip = t["addr:postcode"] || "";
  const street = [hn, st].filter(Boolean).join(" ");
  const line2 = [city, state, zip].filter(Boolean).join(", ");
  return [street, line2].filter(Boolean).join(", ") || null;
}
async function osmFuelWithin(lat, lon, rM) {
  const q = `[out:json][timeout:35];
    ( node(around:${rM},${lat},${lon})["amenity"="fuel"];
      way(around:${rM},${lat},${lon})["amenity"="fuel"];
      relation(around:${rM},${lat},${lon})["amenity"="fuel"]; );
    out center tags;`;
  try {
    const j = await overpassQuery(q);
    const els = j?.elements || [];
    const out = [];
    for (const el of els) {
      const t = el.tags || {};
      const latc = el.lat ?? el.center?.lat, lonc = el.lon ?? el.center?.lon;
      if (latc == null || lonc == null) continue;
      const nm = t.brand || t.operator || t.name || "Fuel";
      const brand = normalizeBrandName(nm);
      out.push({
        source: "osm",
        osm_id: `${el.type}/${el.id}`,
        name: t.name || brand || "Fuel",
        brand,
        address: buildOsmAddress(t),
        lat: +latc, lon: +lonc,
        miles: +distMiles(lat, lon, latc, lonc).toFixed(3),
        heavy: HEAVY_BRANDS.test(nm),
        sunoco: IS_SUNOCO.test(nm),
      });
    }
    return out;
  } catch { return []; }
}
function normalizeBrandName(name) {
  const s = String(name || "").trim();
  if (!s) return "Unknown";
  let n = s.replace(/\u2019/g,"'").replace(/\s+/g," ").trim();
  n = n.replace(/\b(quik\s*trip)\b/i,"QuikTrip")
       .replace(/\b(race\s*trac)\b/i,"RaceTrac")
       .replace(/\b(loves|love's|love’s)\b/i,"Love's")
       .replace(/\b(7[-\s]?eleven)\b/i,"7-Eleven")
       .replace(/\b(flying\s*j)\b/i,"Flying J")
       .replace(/\b(ta|travel ?centers? of america)\b/i,"TA")
       .replace(/\b(buc[-\s]*ee'?s)\b/i,"Buc-ee's")
       .replace(/\b(royal\s*farms)\b/i,"Royal Farms");
  return n;
}
function degLat(m) { return (m / 111320); }
function degLon(m, lat) { return (m / (111320 * Math.cos(lat * Math.PI/180))); }
function hexGridPoints(lat, lon, radiusM, spacingM) {
  const pts = [];
  const dy = spacingM * Math.sqrt(3) / 2;
  for (let y = -radiusM; y <= radiusM; y += dy) {
    const row = Math.round(y / dy);
    const offsetX = (row % 2 !== 0) ? spacingM / 2 : 0;
    for (let x = -radiusM; x <= radiusM; x += spacingM) {
      const px = x + offsetX;
      if (Math.sqrt(px * px + y * y) <= radiusM) {
        pts.push({ lat: lat + degLat(y), lon: lon + degLon(px, lat) });
      }
    }
  }
  return pts;
}
async function googleNearbyFetch(url) {
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 22000);
  const t = await r.text();
  if (!r.ok) throw new Error(`Google ${r.status}: ${t.slice(0, 120)}`);
  let j; try { j = JSON.parse(t); } catch { throw new Error("Google parse"); }
  return j;
}
function asCompetitorFromGoogle(center, it) {
  const name = it.name || "Fuel";
  const brand = normalizeBrandName(name);
  const latc = it.geometry?.location?.lat, lonc = it.geometry?.location?.lng;
  if (!Number.isFinite(latc) || !Number.isFinite(lonc)) return null;
  const miles = +distMiles(center.lat, center.lon, latc, lonc).toFixed(3);
  return {
    source: "google",
    place_id: it.place_id || null,
    name: it.name || brand || "Fuel",
    brand,
    address: it.vicinity || it.formatted_address || null,
    lat: +latc, lon: +lonc, miles,
    heavy: HEAVY_BRANDS.test(name), sunoco: IS_SUNOCO.test(name),
  };
}
async function googleNearbySearchAll(lat, lon, radiusM) {
  if (!GOOGLE_API_KEY) return [];
  const spacing = Math.max(800, Math.round(radiusM / 3));
  let points = hexGridPoints(lat, lon, radiusM, spacing);
  if (points.length > 25) {
    points = points.sort((a,b)=> (haversine(lat,lon,a.lat,a.lon) - haversine(lat,lon,b.lat,b.lon))).slice(0, 25);
  }
  const queries = [
    (p,rad) => `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${p.lat},${p.lon}&radius=${rad}&type=gas_station&key=${GOOGLE_API_KEY}`,
    (p,rad) => `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${p.lat},${p.lon}&radius=${rad}&keyword=${encodeURIComponent("truck stop")}&key=${GOOGLE_API_KEY}`,
    (p,rad) => `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${p.lat},${p.lon}&radius=${rad}&keyword=${encodeURIComponent("travel center")}&key=${GOOGLE_API_KEY}`,
  ];
  const seenPlace = new Set();
  const out = [];
  for (const p of points) {
    for (const makeUrl of queries) {
      let url = makeUrl(p, Math.min(radiusM, 3500));
      let page = 0;
      while (url && page < 3) {
        page++;
        let j;
        try { j = await googleNearbyFetch(url); } catch { break; }
        for (const it of (j.results || [])) {
          if (it.place_id && seenPlace.has(it.place_id)) continue;
          const comp = asCompetitorFromGoogle({lat, lon}, it);
          if (!comp) continue;
          if (it.place_id) seenPlace.add(it.place_id);
          out.push(comp);
        }
        if (j.next_page_token) { await sleep(1800); url = `${makeUrl(p, Math.min(radiusM, 3500))}&pagetoken=${j.next_page_token}`; }
        else url = null;
      }
    }
  }
  return out;
}
function dedupCompetitors(list) {
  const byKey = new Map();
  for (const c of list) {
    const kPlace = c.place_id ? `g:${c.place_id}` : null;
    const kOsm = c.osm_id ? `o:${c.osm_id}` : null;
    const nameKey = (c.name || c.brand || "Fuel").toLowerCase().replace(/\s+/g," ").trim();
    const kGeoName = `n:${round5(c.lat)}|${round5(c.lon)}|${nameKey}`;
    const key = kPlace || kOsm || kGeoName;
    if (!byKey.has(key)) byKey.set(key, c);
    else {
      const prev = byKey.get(key);
      if (!prev.address && c.address) prev.address = c.address;
      if ((!prev.brand || prev.brand==="Unknown") && c.brand) prev.brand = c.brand;
      prev.heavy = prev.heavy || c.heavy;
      prev.sunoco = prev.sunoco || c.sunoco;
      if (c.miles != null && (prev.miles == null || c.miles < prev.miles)) prev.miles = c.miles;
    }
  }
  const merged = [...byKey.values()];
  merged.sort((a,b) => (a.miles ?? 1e9) - (b.miles ?? 1e9));
  return merged;
}
async function findCompetitorsExhaustive(lat, lon, rMi) {
  const rM = Math.round(rMi * 1609.344);
  const [osm, goog] = await Promise.all([
    osmFuelWithin(lat, lon, rM).catch(() => []),
    googleNearbySearchAll(lat, lon, rM).catch(() => []),
  ]);
  const merged = dedupCompetitors([...(osm||[]), ...(goog||[])]);
  return merged.filter(c => c.miles <= rMi + 0.05);
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
  // Baseline ceiling: AADT × 2% × 8 × 30
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

  let limited_by = { equipment: false, hard: false, soft: false };
  let capped = afterComp;
  if (capEquip < capped) { capped = capEquip; limited_by.equipment = true; }
  if (capHardTotal < capped) { capped = capHardTotal; limited_by.hard = true; }

  let afterCap = capped;
  if (afterComp > capSoftTotal) { afterCap = Math.round(capped * 0.9); limited_by.soft = true; }

  let priceMult = 1.0;
  if (pricePosition === "below") priceMult = 1.1;
  else if (pricePosition === "above") priceMult = 0.9;
  const afterPrice = Math.round(afterCap * priceMult);

  const preClamp = Math.round(afterPrice * userExtrasMult);
  const finalBase = Math.min(preClamp, Math.round(baseline));

  const low = Math.round(finalBase * 0.86);
  const high = Math.round(finalBase * 1.06);

  return {
    base: finalBase,
    low, high,
    year2: Math.round(finalBase * 1.027),
    year3: Math.round(finalBase * 1.027 * 1.0125),
    breakdown: {
      aadt, baseline: Math.round(baseline),
      afterComp: Math.round(afterComp),
      compRule: { compCount, heavyCount, baseMult, heavyPenalty, compMult, afterComp: Math.round(afterComp) },
      caps: { capEquip: Math.round(capEquip), capSoftTotal, capHardTotal, limited_by, afterCap },
      priceMult, extrasMult: userExtrasMult, afterPrice, preClamp,
      clamped_to_baseline: finalBase === Math.round(baseline),
      finalClampedToBaseline: finalBase,
    },
  };
}

/* ------------------------ Google status & autocomplete ------------------------ */
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

app.get("/autocomplete", async (req, res) => {
  const input = String(req.query.input || "").trim();
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  const radius = Math.max(1000, Math.min(200000, Number(req.query.radius) || 50000));
  if (!input) return res.json({ ok: false, status: "BAD_REQUEST", items: [] });

  function rank(items) {
    const Q = input.toLowerCase();
    const center = (Number.isFinite(lat) && Number.isFinite(lon)) ? { lat, lon } : { lat: 39.8283, lon: -98.5795 };
    function miles(a,b,c,d){ return distMiles(a,b,c,d); }
    return [...items].sort((a,b) => {
      const A = (a.display||"").toLowerCase(), B = (b.display||"").toLowerCase();
      const aw = a.type==="Google"?1.2 : a.type==="OSM"?0.9 : 0.7;
      const bw = b.type==="Google"?1.2 : b.type==="OSM"?0.9 : 0.7;
      const aStarts = A.startsWith(Q)?3:(A.includes(Q)?1:0);
      const bStarts = B.startsWith(Q)?3:(B.includes(Q)?1:0);
      const aIdx = A.indexOf(Q), bIdx = B.indexOf(Q);
      const aPen = aIdx>=0 ? aIdx/40 : 1.5;
      const bPen = bIdx>=0 ? bIdx/40 : 1.5;
      const aD = (Number.isFinite(a.lat)&&Number.isFinite(a.lon))?miles(center.lat, center.lon, a.lat, a.lon):50;
      const bD = (Number.isFinite(b.lat)&&Number.isFinite(b.lon))?miles(center.lat, center.lon, b.lat, b.lon):50;
      const aNear = Math.max(0,(30-aD))/10;
      const bNear = Math.max(0,(30-bD))/10;
      return (bw + bStarts - bPen + bNear) - (aw + aStarts - aPen + aNear);
    });
  }
  function dedup(items){
    const seen = new Set(); const out = [];
    for (const it of items) {
      const k = `${(it.display||"").toLowerCase()}|${it.lat?round5(it.lat):"?"}|${it.lon?round5(it.lon):"?"}`;
      if (seen.has(k)) continue; seen.add(k); out.push(it);
    }
    return out;
  }

  async function googlePart() {
    if (!GOOGLE_API_KEY) return [];
    try {
      const loc = (Number.isFinite(lat) && Number.isFinite(lon)) ? `&location=${lat},${lon}&radius=${radius}` : "";
      const au = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:us${loc}&key=${GOOGLE_API_KEY}`;
      const ar = await fetchWithTimeout(au, { headers: { "User-Agent": UA } }, 15000);
      const aj = await ar.json();
      if (aj.status !== "OK" && aj.status !== "ZERO_RESULTS") return [];
      const items = [];
      for (const p of (aj.predictions || []).slice(0, 8)) {
        const pid = p.place_id; if (!pid) continue;
        const du = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${pid}&fields=formatted_address,geometry,name,place_id,types&key=${GOOGLE_API_KEY}`;
        const dr = await fetchWithTimeout(du, { headers: { "User-Agent": UA } }, 15000);
        const dj = await dr.json(); if (dj.status !== "OK") continue;
        const loc2 = dj.result?.geometry?.location;
        if (loc2 && Number.isFinite(loc2.lat) && Number.isFinite(loc2.lng)) {
          items.push({
            type: "Google",
            display: dj.result.formatted_address || dj.result.name || p.description,
            lat: +loc2.lat, lon: +loc2.lng, place_id: dj.result.place_id || pid, score: 1.3,
          });
        }
      }
      return items;
    } catch { return []; }
  }
  async function osmPart() {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&countrycodes=us&q=${encodeURIComponent(input)}`;
      const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 15000);
      const a = await r.json();
      return (a||[]).map(row => ({ type:"OSM", display: row.display_name, lat:+row.lat, lon:+row.lon, score: 0.9 }));
    } catch { return []; }
  }
  async function censusPart() {
    try {
      const hasNum = /\d/.test(input);
      if (!hasNum) return [];
      const g = await geocodeCensus(input);
      return g ? [{ type:"Census", display: g.label, lat: g.lat, lon: g.lon, score: 0.8 }] : [];
    } catch { return []; }
  }

  try {
    const [g, o, c] = await Promise.all([googlePart(), osmPart(), censusPart()]);
    const merged = rank(dedup([...(g||[]), ...(o||[]), ...(c||[])]));
    res.json({ ok: true, items: merged.slice(0, 12) });
  } catch (e) {
    res.json({ ok: false, status: "ERROR", items: [], error: String(e) });
  }
});

/* --------------------- AADT nearby for table/map --------------------- */
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
function extractStreetFromAddress(addr) {
  let first = String(addr || "").split(",")[0] || "";
  first = first.replace(/\b(Suite|Ste|Apt|Unit)\b.*$/i, "");
  first = first.replace(/^\s*\d+[A-Za-z-]?\s*,?\s*/, "");
  first = first.replace(/\s+/g, " ").trim();
  return first;
}

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
    geo = await geocode(address);
  }
  const admin = await reverseAdmin(geo.lat, geo.lon);
  const stateCode = toStateCode(admin.state) || "NC";

  // Entered road text (strict mode)
  const enteredRoadText = String(enteredRoad || extractStreetFromAddress(address || geo.label)).trim();

  // Competition (exhaustive)
  const compAll = await findCompetitorsExhaustive(geo.lat, geo.lon, COMP_RADIUS_DEFAULT_MI).catch(() => []);
  const competitors15 = compAll.filter((c) => c.miles <= 1.5);
  const compCount = competitors15.length;
  const heavyCount = competitors15.filter((c) => c.heavy).length;
  const sunocoNearby = compAll.some((c) => c.sunoco && c.miles <= 1.0);
  const ruralEligible = compAll.length === 0;

  // Developments + roads
  const devCsv = matchCsvDevelopments(admin.city, admin.county, admin.state);
  const roads = await roadContext(geo.lat, geo.lon).catch(() => ({ summary: "", main: [], side: [], signals: 0, intersections: 0 }));

  // ------------------ DOT AADT selection (entered road first) ------------------
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
    } else {
      // Soft nearest backup if station is essentially at the site
      const near = (mapStations || []).find(s => s.distM <= 400);
      if (near) {
        method = "dot_station_nearest";
        usedAADT = near.aadt;
        aadtUsedMarker = {
          lat: near.lat, lon: near.lon, aadt: near.aadt, year: near.year,
          route: near.route, location: near.location,
          station_id: near.station_id, source_url: AADT_PROVIDERS[stateCode]?.url || null,
          state: stateCode, fallback: false, method
        };
      }
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

  // ------------------------------ GPT summary (optional) ------------------------------
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
          max_tokens: 1100,
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
    const sys = 'Return {"summary":"<text>"} ~8–12 sentences. Include AADT method (DOT), baseline math, competition rule & heavy penalties, pricing, user adjustments, capacity caps, LOW/BASE/HIGH, road context, nearby developments.';
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
    // Fallback short summary
    return `AADT ${ctx.aadt} (${ctx.method}); comps ${ctx.compCount} (heavy=${ctx.heavyCount}); pricing ${ctx.pricePosition}; adj ${ctx.userAdj || "none"}; result ${ctx.low}–${ctx.high} (base ${ctx.base}).`;
  }

  const adjBits = [];
  if (pricePosition === "below") adjBits.push("+10% below‑market pricing");
  if (pricePosition === "above") adjBits.push("−10% above‑market pricing");
  if (ruralApplied) adjBits.push("+30% rural bonus (0 comps within 3 mi)");
  if (autoLow) adjBits.push("−30% low reviews (<4.0)");
  extras.forEach((e) => adjBits.push(`${e.pct > 0 ? "+" : ""}${e.pct}% ${e.note || "adj."}`));
  let summary = "";
  try {
    summary = await gptSummary({
      address: address || geo.label,
      aadt: usedAADT, method,
      roads, compCount, heavyCount,
      notable: competitors15.filter((c) => c.heavy).slice(0, 6).map((c) => c.name).join(", ") || "none",
      pricePosition, userAdj: adjBits.join("; "),
      base: calc.base, low: calc.low, high: calc.high,
      dev: devCsv.slice(0, 4).map((x) => `${x.name} ${x.status ? `(${x.status})` : ""}`).join("; "),
    });
  } catch { /* summary stays empty if no OPENAI_API_KEY */ }

  // UI lines
  let aadtText = "";
  if (method === "override") aadtText = `AADT (override): ${usedAADT.toLocaleString()} vehicles/day`;
  else if (method === "dot_station_on_entered_road") aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (DOT • entered road)`;
  else if (method === "dot_station_nearest") aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (DOT • nearest station)`;
  else if (method === "fallback_no_dot_found") aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (fallback — verify/override)`;
  else aadtText = `AADT: ${usedAADT.toLocaleString()} vehicles/day (${method})`;

  let competitionText = "";
  if (compAll.length === 0) {
    competitionText = `Competition: None within ${COMP_RADIUS_DEFAULT_MI} mi.`;
  } else {
    const nearest = compAll[0]?.miles ?? null;
    competitionText = `Competition: ${compAll.length} within ${COMP_RADIUS_DEFAULT_MI} mi (nearest ${nearest != null ? "~" + nearest.toFixed(1) + " mi" : "—"})`;
  }

  return {
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

    // scalars
    base: calc.base,
    low: calc.low,
    high: calc.high,
    year2: calc.year2,
    year3: calc.year3,
    summary,

    inputs: {
      mpds: MPDS, diesel: DIESEL,
      aadt_used: usedAADT,
      price_position: pricePosition,
      aadt_components: { method, enteredRoad: enteredRoadText },
    },
    flags: {
      rural_bonus_applied: ruralApplied,
      rural_eligible: ruralEligible,
      sunoco_within_1mi: sunocoNearby,
      auto_low_rating: autoLow,
    },
    competition: {
      count: competitors15.length,
      count_3mi: compAll.length,
      heavy_count: heavyCount,
      nearest_mi: compAll[0]?.miles ?? null,
      notable_brands: compAll.filter((c) => c.heavy).slice(0, 8).map((c) => c.brand || c.name),
    },

    roads,
    calc_breakdown: calc.breakdown,

    // Map payloads
    map: {
      site: { lat: geo.lat, lon: geo.lon, label: geo.label },
      competitors: competitors15,
      all_competitors: compAll,
      competitor_radius_mi: COMP_RADIUS_DEFAULT_MI,
      aadt: mapStations,
      aadt_used: aadtUsedMarker || {
        lat: geo.lat, lon: geo.lon, aadt: usedAADT,
        method, fallback: method === "fallback_no_dot_found"
      }
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
    const rMi = Math.max(0.25, Math.min(12, +req.query.radiusMi || COMP_RADIUS_DEFAULT_MI));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: "lat/lon required" });

    const list = await findCompetitorsExhaustive(lat, lon, rMi).catch(() => []);
    const features = list.map((s, i) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: {
        id: i,
        name: s.name || s.brand || "Fuel",
        brand: s.brand || "Unknown",
        address: s.address || null,
        miles: s.miles,
        heavy: !!s.heavy,
        sunoco: !!s.sunoco,
        source: s.source || null
      }
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
async function buildStaticCompetitorMapImage(site, comps, radiusMi = COMP_RADIUS_DEFAULT_MI, opts = {}) {
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
      buildStaticCompetitorMapImage(site, comps, result.map?.competitor_radius_mi || COMP_RADIUS_DEFAULT_MI)
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
      const lims = [];
      if (B.caps.limited_by?.equipment) lims.push("equipment");
      if (B.caps.limited_by?.hard) lims.push("hard cap");
      bullets.push(`Capacity caps: equipment ${Number(B.caps.capEquip).toLocaleString()} • soft ${Number(B.caps.capSoftTotal).toLocaleString()} • hard ${Number(B.caps.capHardTotal).toLocaleString()}${lims.length?` (limited by ${lims.join(" & ")})`: ""}${B.caps.limited_by?.soft ? " • soft penalty −10%" : ""} → ${Number(B.caps.afterCap).toLocaleString()}`);
    }
    if (B.priceMult != null) bullets.push(`Pricing factor: × ${Number(B.priceMult).toFixed(2)} → ${Number(B.afterPrice).toLocaleString()}`);
    if (result.flags?.auto_low_rating) bullets.push(`Low reviews penalty: × 0.70 (applied)`);
    if (B.extrasMult != null) bullets.push(`Extras multiplier (incl. toggles): × ${Number(B.extrasMult).toFixed(2)} → pre‑clamp ${Number(B.preClamp).toLocaleString()}`);
    if (B.clamped_to_baseline) bullets.push(`Baseline ceiling ACTIVE: final = min(pre‑clamp, baseline) → ${Number(B.finalClampedToBaseline).toLocaleString()}`);
    else bullets.push(`Final (no baseline clamp): ${Number(B.finalClampedToBaseline).toLocaleString()}`);
    if (result.roads?.summary) bullets.push(`Road context: ${result.roads.summary}`);
    y = bulletLines(doc, bullets, margin, y, contentW); y += 6;

    if (result.summary) {
      y = drawSectionTitle(doc, "Narrative Summary", y, { margin, color: "#334155" });
      doc.font("Helvetica").fontSize(11).fillColor("#1c2736")
        .text(result.summary, margin, y, { width: contentW, lineGap: 4 });
    }

    doc.end();
  } catch (e) { res.status(400).json({ ok: false, status: "PDF_FAILED", detail: String(e) }); }
});

/* ------------------------------- Start ------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server listening on :${PORT}`));
