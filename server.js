// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public")); // serve /public

function jerr(res, code, msg, detail) {
  console.error("[ERROR]", code, msg, detail || "");
  return res.status(code).json({ error: msg, detail });
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------- utilities ----------
const CONTACT = process.env.OVERPASS_CONTACT || "FuelEstimator/1.6 (contact: noreply@example.com)";
const UA = "FuelEstimator/1.6 (+contact:noreply@example.com)";

function toMiles(m) { return m / 1609.344; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = d => d*Math.PI/180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function distMiles(lat1, lon1, lat2, lon2) { return toMiles(haversine(lat1, lon1, lat2, lon2)); }

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(t); }
}

// ---------------- Geocoding ----------------
// Accept direct "lat,lon"
function tryParseLatLng(address) {
  const m = String(address).trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon, label: `${lat}, ${lon}` };
}

// crude city/state extractor for viewbox bias
function extractCityState(addr) {
  // "... <city>, <state code>" OR "... <city> <state code>"
  const m = String(addr).match(/,\s*([A-Za-z .'\-]+)\s*,?\s*([A-Z]{2}|[A-Za-z ]{3,})\s*$/);
  if (!m) return null;
  const city = m[1].trim();
  const state = m[2].trim();
  return { city, state };
}

async function nominatimCityBBox(city, state) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=us&q=${encodeURIComponent(city + ", " + state)}`;
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, "Accept":"application/json" } }, 10000);
  if (!r.ok) throw new Error(`City bbox ${r.status}`);
  const arr = JSON.parse(await r.text());
  const it = arr[0];
  if (!it?.boundingbox) return null;
  const [south, north, west, east] = [Number(it.boundingbox[0]), Number(it.boundingbox[1]), Number(it.boundingbox[2]), Number(it.boundingbox[3])];
  if ([south,north,west,east].some(v=>!Number.isFinite(v))) return null;
  return { west, south, east, north };
}

async function geocodeNominatim(q, bbox) {
  // if bbox is provided, bound the search
  const base = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const url = bbox
    ? `${base}&viewbox=${bbox.west},${bbox.north},${bbox.east},${bbox.south}&bounded=1`
    : base;
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, "Accept":"application/json" } }, 10000);
  if (!r.ok) throw new Error(`Nominatim ${r.status}: ${await r.text().then(t=>t.slice(0,300))}`);
  const arr = JSON.parse(await r.text());
  if (!arr?.length) throw new Error("Nominatim: no results");
  const { lat, lon, display_name } = arr[0];
  return { lat: Number(lat), lon: Number(lon), label: display_name };
}

async function geocodeCensus(q) {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, "Accept":"application/json" } }, 10000);
  if (!r.ok) throw new Error(`Census ${r.status}: ${await r.text().then(t=>t.slice(0,300))}`);
  const data = JSON.parse(await r.text());
  const m = data?.result?.addressMatches?.[0];
  if (!m?.coordinates) throw new Error("Census: no matches");
  return { lat: Number(m.coordinates.y), lon: Number(m.coordinates.x), label: m.matchedAddress || q };
}

async function geocode(address) {
  const direct = tryParseLatLng(address);
  if (direct) return direct;

  let bbox = null;
  const cs = extractCityState(address);
  if (cs) {
    try { bbox = await nominatimCityBBox(cs.city, cs.state); }
    catch { /* ignore */ }
  }

  try { return await geocodeNominatim(address, bbox); }
  catch (e1) {
    console.warn("[WARN] Nominatim (bounded) failed:", e1.message);
    await sleep(600);
    try { return await geocodeNominatim(address); }
    catch (e2) {
      console.warn("[WARN] Nominatim retry failed:", e2.message);
      try { return await geocodeCensus(address); }
      catch (e3) {
        console.warn("[WARN] Census geocoder failed:", e3.message);
        throw new Error("All geocoders failed for this address");
      }
    }
  }
}

// --------------- NCDOT AADT stations (ArcGIS) ---------------
const NCDOT_AADT_FS =
  "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0";

async function queryNCDOTNearestAADT(lat, lon, radiusMeters = 1609) {
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radiusMeters),
    units: "esriSRUnit_Meter",
    outSR: "4326",
    resultRecordCount: "200",
  });

  const r = await fetchWithTimeout(`${NCDOT_AADT_FS}/query?${params.toString()}`, {
    headers: { "User-Agent": UA, "Accept":"application/json" }
  }, 12000);
  if (!r.ok) throw new Error(`NCDOT ${r.status}: ${await r.text().then(t=>t.slice(0,300))}`);
  const data = JSON.parse(await r.text());
  const feats = data.features || [];
  if (!feats.length) return null;

  function extractAADT(attrs) {
    const candidates = [];
    for (const [k, v] of Object.entries(attrs || {})) {
      if (!String(k).toLowerCase().includes("aadt")) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) continue;
      let year = null;
      for (const yk of ["YEAR","AADT_YEAR","COUNT_YEAR","TRAFFICYEAR","YEAR_","YR","YR_"]) {
        if (attrs[yk] != null) {
          const yy = String(attrs[yk]).match(/20\\d{2}/)?.[0];
          if (yy) { year = Number(yy); break; }
        }
      }
      if (!year) { const m = k.match(/20\\d{2}/); if (m) year = Number(m[0]); }
      candidates.push({ value: n, year });
    }
    if (!candidates.length) return null;
    candidates.sort((a,b)=> (b.year||0)-(a.year||0) || b.value-a.value);
    return candidates[0];
  }

  const rows = [];
  for (const f of feats) {
    const a = extractAADT(f.attributes);
    if (!a) continue;
    const gx = f.geometry?.x ?? f.geometry?.longitude;
    const gy = f.geometry?.y ?? f.geometry?.latitude;
    if (gx == null || gy == null) continue;
    rows.push({ aadt: a.value, year: a.year || null, distM: haversine(lat, lon, gy, gx) });
  }
  if (!rows.length) return null;
  rows.sort((A,B)=> (B.year||0)-(A.year||0) || B.aadt-A.aadt || A.distM-B.distM);
  return rows[0];
}

// ---------------- Overpass (competition + developments) ----------------
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

async function queryOverpass(q, triesPerMirror = 2, delayMs = 900) {
  let lastErr = new Error("No attempt");
  for (const ep of OVERPASS_ENDPOINTS) {
    for (let i = 0; i < triesPerMirror; i++) {
      try {
        const r = await fetchWithTimeout(ep, {
          method: "POST",
          headers: { "User-Agent": CONTACT, "Content-Type":"application/x-www-form-urlencoded", "Accept":"application/json" },
          body: "data=" + encodeURIComponent(q)
        }, 20000);
        const ct = r.headers.get("content-type") || "";
        const text = await r.text();
        if (!r.ok || !ct.includes("application/json")) throw new Error(`Overpass ${r.status}: ${text.slice(0,300)}`);
        return JSON.parse(text);
      } catch (e) {
        lastErr = e; await sleep(delayMs);
      }
    }
  }
  throw lastErr;
}

async function competitorsWithin1Mile(lat, lon) {
  const r = 1609;
  const q = `
  [out:json][timeout:25];
  (
    node(around:${r},${lat},${lon})["amenity"="fuel"];
    way(around:${r},${lat},${lon})["amenity"="fuel"];
  );
  out center tags;`;
  const data = await queryOverpass(q, 2, 1000);
  const heavyRegex = /sheetz|wawa|quik.?trip|(^|\\b)qt\\b|racetrac|buc-?ee|costco|sam's|bj's|pilot|love's|circle k|speedway|murphy|exxon|shell|bp|chevron|marathon|7-?eleven/i;
  const out = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    const name = t.brand || t.name || "";
    const latc = el.lat ?? el.center?.lat;
    const lonc = el.lon ?? el.center?.lon;
    if (latc == null || lonc == null) continue;
    out.push({ name, lat: latc, lon: lonc, miles: +distMiles(lat, lon, latc, lonc).toFixed(3), heavy: heavyRegex.test(name) });
  }
  out.sort((a,b)=> a.miles - b.miles);
  return out;
}

async function developments1Mile(lat, lon) {
  const r = 1609;
  const q = `
  [out:json][timeout:25];
  (
    node(around:${r},${lat},${lon})["amenity"="fuel"]["construction"];
    way(around:${r},${lat},${lon})["amenity"="fuel"]["construction"];
    node(around:${r},${lat},${lon})["proposed:amenity"="fuel"];
    way(around:${r},${lat},${lon})["proposed:amenity"="fuel"];
    node(around:${r},${lat},${lon})["opening_date"];
    way(around:${r},${lat},${lon})["opening_date"];
    node(around:${r},${lat},${lon})["description"~"(?i)(coming soon|proposed|permit|construction|planned)"];
    way(around:${r},${lat},${lon})["description"~"(?i)(coming soon|proposed|permit|construction|planned)"];
  );
  out center tags;`;
  const data = await queryOverpass(q, 2, 1000);
  const out = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    const name = t.brand || t.name || "(unnamed)";
    const status =
      t.construction ? "construction" :
      t["proposed:amenity"] ? "proposed" :
      t.opening_date ? `opening ${t.opening_date}` :
      t.description ? t.description : "planned?";
    const latc = el.lat ?? el.center?.lat;
    const lonc = el.lon ?? el.center?.lon;
    if (latc == null || lonc == null) continue;
    out.push({ name, status, miles: +distMiles(lat, lon, latc, lonc).toFixed(3) });
  }
  out.sort((a,b)=> a.miles - b.miles);
  const seen = new Set(); const uniq = [];
  for (const d of out) { const key = `${d.name}|${Math.round(d.miles*100)}`; if (!seen.has(key)) { seen.add(key); uniq.push(d); } }
  return uniq.slice(0, 20);
}

// ---------------- GPT AADT sanity (unchanged) ----------------
function inferClass(address) {
  const s = String(address).toLowerCase();
  if (/(^|\\b)(i[- ]\\d+|interstate)\\b/.test(s)) return "freeway";
  if (/\\b(us[- ]?\\d+|us hwy|u\\.s\\.)\\b/.test(s)) return "primary arterial";
  if (/\\b(nc[- ]?\\d+|state rt|state hwy|sr[- ]?\\d+)\\b/.test(s)) return "primary arterial";
  if (/\\b(hwy|highway|blvd|pkwy|parkway|bypass)\\b/.test(s)) return "arterial";
  return "collector";
}
const AADT_BOUNDS = {
  freeway: "40,000–120,000",
  "primary arterial": "12,000–60,000",
  arterial: "8,000–35,000",
  collector: "3,000–12,000",
};

async function gptJSON(prompt) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 800,
      messages: [
        { role: "system", content: "You are a precise fuel volume analyst. Always return valid JSON (no markdown)." },
        { role: "user", content: prompt },
      ],
    }),
  }, 20000);
  const txt = await r.text();
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${txt}`);
  const data = JSON.parse(txt);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No GPT content");
  return JSON.parse(content);
}

// ---------------- Gallons model (floor + gentle comp) ----------------
function gallonsModel({ aadt, mpds, diesel = 0, compImpact = 0 }) {
  const floor = aadt * 0.02 * 8 * 30;
  const compMult = Math.max(0.85, 1 - compImpact); // cap reduction at 15%
  const truckShare = 0.10;
  const autos = aadt * (1 - truckShare);
  const trucks = aadt * truckShare;
  const gpd = autos * 0.020 * 10.2 * compMult + trucks * 0.012 * 16.0 * compMult;
  let monthly = gpd * (365 / 12);
  monthly = Math.max(monthly, floor);
  const cycles = 25;
  const cap = (mpds * cycles * 10.5 + diesel * cycles * 16) * (365 / 12);
  const base = Math.round(Math.min(monthly, cap));
  const low = Math.round(base * 0.86);
  const high = Math.round(base * 1.06);
  const year2 = Math.round(base * 1.027);
  const year3 = Math.round(year2 * 1.0125);
  return { base, low, high, year2, year3, cap: Math.round(cap), floor: Math.round(floor), compMult };
}

// ---------------- /estimate ----------------
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel, aadtOverride, siteLat, siteLon } = req.body || {};
    const MPDS = Number(mpds);
    const DIESEL = Number(diesel || 0);
    const AADT_OVERRIDE = aadtOverride !== undefined && aadtOverride !== "" ? Number(aadtOverride) : null;

    if (!address && !(Number.isFinite(siteLat) && Number.isFinite(siteLon)))
      return jerr(res, 400, "Address or site coordinates required");

    if (!Number.isFinite(MPDS) || MPDS <= 0) return jerr(res, 400, "Regular MPDs required (>0)");

    // Geocode OR use provided siteLat/siteLon
    let geo;
    if (Number.isFinite(siteLat) && Number.isFinite(siteLon)) {
      geo = { lat: Number(siteLat), lon: Number(siteLon), label: "user-set location" };
    } else {
      try { geo = await geocode(address); }
      catch (e) { return jerr(res, 400, "Geocoding failed", e.message); }
    }

    // Actual AADT
    const station = await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609).catch(() => null);
    const actualAADT = station ? {
      value: station.aadt,
      year: station.year,
      distance_mi: +toMiles(station.distM).toFixed(3),
      source: "NCDOT AADT Stations (best nearby)"
    } : null;

    // GPT AADT estimate (bounded)
    const roadClass = inferClass(address || "");
    let gptAADT = null;
    try {
      const est = await gptJSON(`
Estimate a plausible AADT for this location, staying within bounds unless clearly justified.
Address: ${address || "(coords provided)"}
Street class hint: ${roadClass}
Bounds: Freeway ${AADT_BOUNDS.freeway}; Primary arterial ${AADT_BOUNDS["primary arterial"]}; Arterial ${AADT_BOUNDS.arterial}; Collector ${AADT_BOUNDS.collector}
Return JSON: {"aadt_estimate": <number>, "low": <number>, "high": <number>, "class_used": "<string>"}
      `.trim());
      if (Number.isFinite(est.aadt_estimate)) {
        gptAADT = {
          value: Math.round(est.aadt_estimate),
          low: Number.isFinite(est.low) ? Math.round(est.low) : null,
          high: Number.isFinite(est.high) ? Math.round(est.high) : null,
          class_used: est.class_used || roadClass
        };
      }
    } catch (e) { console.warn("[WARN] GPT AADT estimate failed:", e.message); }

    // Competition & developments
    let competitors = [], devs = [];
    try { competitors = await competitorsWithin1Mile(geo.lat, geo.lon); } catch (e) { competitors = []; }
    try { devs = await developments1Mile(geo.lat, geo.lon); } catch (e) { devs = []; }

    // Impact
    const impact = (() => {
      let weighted = 0, nearPenalty = 0;
      for (const c of competitors) {
        const d = Math.max(c.miles, 0.05);
        const boost = c.heavy ? 1.6 : 1.0;
        weighted += (1 / d) * boost;
        if (c.miles <= 0.03) nearPenalty += 0.10 * boost;
      }
      const cut = 0.02 * weighted + nearPenalty;
      return Math.max(0, Math.min(0.6, cut));
    })();

    // Choose AADT: override > average(actual,gpt) > one of them
    let usedAADT = null;
    if (Number.isFinite(AADT_OVERRIDE) && AADT_OVERRIDE > 0) usedAADT = AADT_OVERRIDE;
    else if (actualAADT?.value && gptAADT?.value) usedAADT = Math.round((actualAADT.value + gptAADT.value) / 2);
    else usedAADT = actualAADT?.value ?? gptAADT?.value ?? null;

    if (!Number.isFinite(usedAADT))
      return jerr(res, 500, "AADT unavailable", "No override, no NCDOT station nearby, and GPT estimate failed");

    // Gallons calc
    const calc = gallonsModel({ aadt: usedAADT, mpds: MPDS, diesel: DIESEL, compImpact: impact });

    const notable = competitors.filter(c => c.heavy).slice(0,6).map(c => c.name);
    const nearest = competitors[0]?.miles ?? null;
    const rationale = `Base uses AADT ${usedAADT.toLocaleString()} with floor (AADT×2%×8×30=${calc.floor.toLocaleString()}), competition impact ${(impact*100).toFixed(0)}% (nearest ${nearest != null ? nearest.toFixed(3)+' mi' : 'n/a'}${notable.length ? '; notable '+notable.join(', ') : ''}), capped by MPD capacity.`;

    return res.json({
      base: calc.base,
      low: calc.low,
      high: calc.high,
      year2: calc.year2,
      year3: calc.year3,
      inputs: {
        aadt_used: usedAADT,
        mpds: MPDS,
        diesel: DIESEL,
        truck_share_assumed: 0.10,
        aadt_actual: actualAADT || { value: null, year: null, distance_mi: null, source: null },
        aadt_gpt: gptAADT || { value: null, low: null, high: null, class_used: roadClass },
        aadt_override: Number.isFinite(AADT_OVERRIDE) ? AADT_OVERRIDE : null
      },
      competition: {
        count: competitors.length,
        nearest_mi: nearest,
        notable_brands: notable,
        impact_score: +impact.toFixed(3)
      },
      developments: devs,
      assumptions: [
        "Floor enforced: AADT × 2% × 8 × 30",
        "Competition reduction capped at 15%",
        "Capacity cap: positions × 25 × gal/cycle × 365/12",
      ],
      rationale,
      map: { site: { lat: geo.lat, lon: geo.lon, label: geo.label }, competitors }
    });
  } catch (e) {
    return jerr(res, 500, "Estimate failed", String(e));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));

