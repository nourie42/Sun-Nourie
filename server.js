// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public")); // serve /public

// ----------------------------- helpers -----------------------------
function jerr(res, code, msg, detail) {
  console.error("[ERROR]", code, msg, detail || "");
  return res.status(code).json({ error: msg, detail });
}

const CONTACT = process.env.OVERPASS_CONTACT || "FuelEstimator/1.0 (contact: none)";

function headersJSON() {
  return {
    "User-Agent": CONTACT,
    Accept: "application/json",
  };
}

async function safeJSONResponse(r) {
  const ct = r.headers.get("content-type") || "";
  const text = await r.text();
  if (!ct.includes("application/json")) {
    // Return a recognizable error with the first part of the body to aid debugging
    throw new Error(`Non-JSON response (${ct}): ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON parse failed: ${text.slice(0, 300)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function toMiles(m) { return m / 1609.344; }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function distMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ----------------------------- Geocode (Nominatim) -----------------------------
async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    address
  )}`;
  const r = await fetch(url, { headers: headersJSON() });
  if (!r.ok) throw new Error(`Nominatim ${r.status}: ${await r.text()}`);
  const arr = await safeJSONResponse(r);
  if (!arr?.length) throw new Error("No geocode result");
  const { lat, lon, display_name } = arr[0];
  return { lat: Number(lat), lon: Number(lon), label: display_name };
}

// ----------------------------- ArcGIS AADT search -----------------------------
const ARC_SEARCH = "https://www.arcgis.com/sharing/rest/search";
async function arcSearch(q, bbox, num = 40) {
  const params = new URLSearchParams({ f: "json", q, bbox, num: String(num) });
  const r = await fetch(`${ARC_SEARCH}?${params.toString()}`, { headers: headersJSON() });
  if (!r.ok) throw new Error(`ArcGIS search ${r.status}: ${await r.text()}`);
  return safeJSONResponse(r);
}
async function arcItem(id) {
  const r = await fetch(`https://www.arcgis.com/sharing/rest/content/items/${id}?f=json`, { headers: headersJSON() });
  if (!r.ok) throw new Error(`ArcGIS item ${r.status}`);
  return safeJSONResponse(r);
}
async function arcServiceInfo(url) {
  const r = await fetch(`${url}?f=json`, { headers: headersJSON() });
  if (!r.ok) throw new Error(`ArcGIS service ${r.status}`);
  return safeJSONResponse(r);
}
async function arcQuery(url, layerId, lat, lon, meters = 2500) {
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(meters),
    units: "esriSRUnit_Meter",
    outSR: "4326",
    resultRecordCount: "100",
  });
  const r = await fetch(`${url}/${layerId}/query?${params.toString()}`, { headers: headersJSON() });
  if (!r.ok) throw new Error(`ArcGIS query ${r.status}: ${await r.text()}`);
  return safeJSONResponse(r);
}
function lonLat(geom) {
  if (!geom) return { lon: null, lat: null };
  if (geom.x != null && geom.y != null) return { lon: geom.x, lat: geom.y };
  if (geom.longitude != null && geom.latitude != null) return { lon: geom.longitude, lat: geom.latitude };
  return { lon: null, lat: null };
}
function nearestPointDistanceMeters(lat, lon, geom) {
  if (!geom) return Infinity;
  if (geom.x != null && geom.y != null) return distMeters(lat, lon, geom.y, geom.x);
  if (geom.latitude && geom.longitude) return distMeters(lat, lon, geom.latitude, geom.longitude);
  if (geom.paths) {
    let best = Infinity;
    for (const path of geom.paths) for (const [x, y] of path) best = Math.min(best, distMeters(lat, lon, y, x));
    return best;
  }
  if (geom.rings) {
    let best = Infinity;
    for (const ring of geom.rings) for (const [x, y] of ring) best = Math.min(best, distMeters(lat, lon, y, x));
    return best;
  }
  return Infinity;
}
function extractAADT(attrs) {
  if (!attrs) return null;
  const out = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    const kl = k.toLowerCase();
    if (kl.includes("aadt")) {
      const num = Number(v);
      if (Number.isFinite(num) && num > 0) {
        let year = null;
        const m = k.match(/20\d{2}/);
        if (m) year = Number(m[0]);
        for (const kk of ["year", "aadt_year", "count_year", "trafficyea", "yr", "yr_"]) {
          if (!year && attrs[kk] != null) {
            const yy = String(attrs[kk]).match(/20\d{2}/)?.[0];
            if (yy) year = Number(yy);
          }
        }
        out.push({ value: num, year });
      }
    }
  }
  if (!out.length) return null;
  out.sort((a, b) => b.value - a.value);
  return out[0];
}
async function findAADTFromArcGIS(lat, lon) {
  const span = 0.35;
  const bbox = `${lon - span},${lat - span},${lon + span},${lat + span}`;
  const queries = [
    `aadt AND type:("Feature Service" OR "Map Service")`,
    `"traffic count" AND type:("Feature Service" OR "Map Service")`,
  ];
  for (const q of queries) {
    const s = await arcSearch(q, bbox, 50);
    if (!s?.results?.length) continue;
    for (const item of s.results) {
      let url = item.url;
      if (!url) {
        const meta = await arcItem(item.id);
        url = meta.url;
      }
      if (!url) continue;
      let info;
      try {
        info = await arcServiceInfo(url);
      } catch {
        continue;
      }
      const layers = (info.layers || []).map((l) => ({ id: l.id, name: l.name }));
      for (const L of layers) {
        let features = [];
        try {
          const resp = await arcQuery(url, L.id, lat, lon, 3000);
          features = resp.features || [];
        } catch {
          continue;
        }
        if (!features.length) continue;
        let best = null;
        for (const f of features) {
          const a = extractAADT(f.attributes);
          if (!a) continue;
          const dM = nearestPointDistanceMeters(lat, lon, f.geometry);
          const p = lonLat(f.geometry);
          const row = {
            aadt: a.value, year: a.year || null, distM: dM,
            lat: p.lat, lon: p.lon, layer: L.name, title: item.title, serviceUrl: url,
          };
          if (!best || dM < best.distM) best = row;
        }
        if (best) return best;
      }
    }
  }
  return null;
}

// ----------------------------- Overpass (robust) -----------------------------
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

// Execute an Overpass query with retries & mirror failover
async function queryOverpass(q, { triesPerMirror = 2, delayMs = 900 } = {}) {
  let lastErr = new Error("No Overpass attempts made");
  for (const ep of OVERPASS_ENDPOINTS) {
    for (let i = 0; i < triesPerMirror; i++) {
      try {
        const r = await fetch(ep, {
          method: "POST",
          headers: {
            ...headersJSON(),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "data=" + encodeURIComponent(q),
        });
        if (!r.ok) {
          const body = await r.text();
          throw new Error(`Overpass ${r.status}: ${body.slice(0, 300)}`);
        }
        return await safeJSONResponse(r);
      } catch (e) {
        lastErr = e;
        await sleep(delayMs);
      }
    }
  }
  throw lastErr;
}

// **Lightweight** competitors query
async function competitorsWithin1Mile(lat, lon) {
  const r = 1609;
  const q = `
  [out:json][timeout:25];
  (
    node(around:${r},${lat},${lon})["amenity"="fuel"];
    way(around:${r},${lat},${lon})["amenity"="fuel"];
  );
  out center tags;`;
  const data = await queryOverpass(q, { triesPerMirror: 2, delayMs: 1000 });
  const list = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const name = tags.brand || tags.name || "";
    const latc = el.lat ?? el.center?.lat;
    const lonc = el.lon ?? el.center?.lon;
    if (latc == null || lonc == null) continue;
    const dM = distMeters(lat, lon, latc, lonc);
    list.push({
      name,
      lat: latc,
      lon: lonc,
      meters: Math.round(dM),
      miles: +toMiles(dM).toFixed(3),
      heavy: /sheetz|wawa|quiktrip|(^|\b)qt\b|racetrac|buc-?ee|costco|sam's|bj's|pilot|love's|circle k|speedway|murphy/i.test(
        name
      ),
    });
  }
  list.sort((a, b) => a.meters - b.meters);
  return list;
}

// **Lightweight** developments query
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
  const data = await queryOverpass(q, { triesPerMirror: 2, delayMs: 1000 });
  const out = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const name = tags.brand || tags.name || "(unnamed)";
    const status =
      tags.construction ? "construction" :
      tags["proposed:amenity"] ? "proposed" :
      tags.opening_date ? `opening ${tags.opening_date}` :
      tags.description ? tags.description :
      "planned?";
    const latc = el.lat ?? el.center?.lat;
    const lonc = el.lon ?? el.center?.lon;
    if (latc == null || lonc == null) continue;
    const dM = distMeters(lat, lon, latc, lonc);
    out.push({ name, status, miles: +toMiles(dM).toFixed(3) });
  }
  // dedupe & limit
  out.sort((a, b) => a.miles - b.miles);
  const seen = new Set();
  const uniq = [];
  for (const d of out) {
    const key = `${d.name}|${Math.round(d.miles * 100)}`;
    if (!seen.has(key)) { seen.add(key); uniq.push(d); }
  }
  return uniq.slice(0, 12);
}

// ----------------------------- Heuristics & model -----------------------------
const AADT_HEURISTIC_BY_HIGHWAY = {
  motorway: 60000, trunk: 40000, primary: 25000, secondary: 15000,
  tertiary: 10000, unclassified: 6000, residential: 3000, service: 1000,
};

async function highwayFromOSM(lat, lon) {
  const q = `
  [out:json][timeout:20];
  way(around:200,${lat},${lon})[highway];
  out tags center 20;`;
  try {
    const d = await queryOverpass(q, { triesPerMirror: 1, delayMs: 800 });
    const els = (d.elements || []).filter((e) => e.tags?.highway);
    if (!els.length) return null;
    const order = ["motorway","trunk","primary","secondary","tertiary","unclassified","residential","service"];
    els.sort((a,b)=> order.indexOf(a.tags.highway) - order.indexOf(b.tags.highway));
    return els[0].tags.highway;
  } catch {
    return null;
  }
}

function defaultTruckShareByHighway(hw) {
  if (!hw) return 0.08;
  if (hw === "motorway" || hw === "trunk") return 0.11;
  if (hw === "primary") return 0.09;
  if (hw === "secondary") return 0.07;
  return 0.06;
}

function competitionMultiplier(competitors) {
  let weighted = 0;
  let nearPenalty = 0;
  for (const c of competitors) {
    const d = Math.max(c.miles, 0.05);
    const heavyBoost = c.heavy ? 1.6 : 1.0;
    weighted += (1 / d) * heavyBoost;
    if (c.miles <= 0.03) nearPenalty += 0.20 * heavyBoost;
  }
  const baseCut = 0.035 * weighted;
  const m = clamp(1 - baseCut - nearPenalty, 0.50, 1.10);
  const impactScore = clamp(baseCut + nearPenalty, 0, 0.6);
  return { m, impactScore: +impactScore.toFixed(3) };
}

function gallonsModel({ aadt, truckShare, mpds, diesel = 0, compMult = 1.0, availability = 1.0 }) {
  const autoStop = 0.020, truckStop = 0.012;
  const autoGal = 10.2, truckGal = 16.0;
  const autos = aadt * (1 - truckShare);
  const trucks = aadt * truckShare;
  const gpdAuto = autos * autoStop * availability * compMult * autoGal;
  const gpdTruck = trucks * truckStop * availability * compMult * truckGal;
  const gpm = (gpdAuto + gpdTruck) * (365 / 12);

  const cycles = 25;
  const cap = (mpds * cycles * 10.5 + diesel * cycles * 16.0) * (365 / 12);

  const base = Math.round(Math.min(gpm, cap));
  const low = Math.round(base * 0.86);
  const high = Math.round(base * 1.06);
  const y2 = Math.round(base * 1.027);
  const y3 = Math.round(y2 * 1.0125);
  return { base, low, high, y2, y3, cap: Math.round(cap) };
}

// ----------------------------- routes -----------------------------
app.get("/health", (_req, res) => res.json({ ok: true }));

// AADT test endpoint
app.get("/aadt", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return jerr(res, 400, "Missing lat/lon");
    const exact = await findAADTFromArcGIS(lat, lon);
    if (exact) {
      return res.json({
        aadt: exact.aadt,
        source: `${exact.title} • ${exact.layer}`,
        distance_mi: +toMiles(exact.distM).toFixed(3),
        year: exact.year || null,
      });
    }
    const hw = await highwayFromOSM(lat, lon);
    const aadt = AADT_HEURISTIC_BY_HIGHWAY[hw || "unclassified"] || 8000;
    return res.json({ aadt, source: `OSM highway class (${hw || "unknown"}) heuristic`, distance_mi: null, year: null });
  } catch (e) {
    return jerr(res, 500, "AADT fetch failed", String(e));
  }
});

// Main estimator
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel } = req.body || {};
    const MPDS = Number(mpds);
    const DIESEL = Number(diesel || 0);
    if (!address) return jerr(res, 400, "Address required");
    if (!Number.isFinite(MPDS) || MPDS <= 0) return jerr(res, 400, "Regular MPDs required (>0)");

    const geo = await geocode(address);

    let aadtInfo = await findAADTFromArcGIS(geo.lat, geo.lon);
    let aadtUsed, aadtSource, aadtYear, aadtDist;
    if (aadtInfo) {
      aadtUsed = aadtInfo.aadt;
      aadtSource = `${aadtInfo.title} • ${aadtInfo.layer}`;
      aadtYear = aadtInfo.year || null;
      aadtDist = +toMiles(aadtInfo.distM).toFixed(3);
    } else {
      const hw = await highwayFromOSM(geo.lat, geo.lon);
      aadtUsed = AADT_HEURISTIC_BY_HIGHWAY[hw || "unclassified"] || 8000;
      aadtSource = `OSM highway class (${hw || "unknown"}) heuristic`;
      aadtYear = null;
      aadtDist = null;
    }

    let comps = [];
    let devs = [];
    try { comps = await competitorsWithin1Mile(geo.lat, geo.lon); }
    catch (e) { console.warn("[WARN] competitors failed:", e.message); comps = []; }
    try { devs = await developments1Mile(geo.lat, geo.lon); }
    catch (e) { console.warn("[WARN] developments failed:", e.message); devs = []; }

    const { m: compMult, impactScore } = competitionMultiplier(comps);
    const hwForTruck = await highwayFromOSM(geo.lat, geo.lon);
    const truckShare = defaultTruckShareByHighway(hwForTruck);

    const calc = gallonsModel({
      aadt: aadtUsed,
      truckShare,
      mpds: MPDS,
      diesel: DIESEL,
      compMult,
      availability: 1.0,
    });

    const notable = comps.filter(c => c.heavy).slice(0, 6).map(c => c.name).filter(Boolean);
    const nearest = comps[0]?.miles ?? null;

    const formatInt = (n) => n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });

    const report = [
      `**Base Estimate (gal/mo)** ${formatInt(calc.base)}, **Low–High** ${formatInt(calc.low)}–${formatInt(calc.high)}, **Year-2** ${formatInt(calc.y2)}, **Year-3** ${formatInt(calc.y3)}`,
      "",
      `**Inputs used**: AADT ${formatInt(aadtUsed)} (source: ${aadtSource}${aadtYear ? `, ${aadtYear}` : ""}${aadtDist != null ? `, ~${aadtDist} mi` : ""}), MPDs ${MPDS}${DIESEL ? ` + diesel ${DIESEL}` : ""}, truck share ${Math.round(truckShare * 100)}% (assumed)`,
      `**Competition summary**: ${comps.length} within 1 mi${nearest != null ? `; nearest ${nearest.toFixed(3)} mi` : ""}${notable.length ? `; notable: ${notable.join(", ")}` : ""}; impact ${(impactScore * 100).toFixed(0)}%`,
      `**Developments**: ${devs.length ? devs.map(d => `${d.name} • ${d.status} • ${d.miles} mi`).join(" · ") : "none found (OSM/planning tags)"}`,
      `**Assumptions**: auto stop 2.0%, truck stop 1.2%; gallons/stop auto 10.2, truck 16.0; availability 1.00; competition 1/d + ≤0.03 mi hard penalty; capacity cap = positions × 25 × gal/cycle × 365/12.`,
      `**One-paragraph rationale**: Used nearest reliable AADT (${formatInt(aadtUsed)}) from ${aadtSource}${aadtYear ? ` (${aadtYear})` : ""}; competition multiplier derived from 1/d decay with strong ≤0.03 mi penalty and brand weighting; result capped by MPD throughput.`
    ].join("\n");

    return res.json({
      base_monthly_gallons: calc.base,
      low_high: { low: calc.low, high: calc.high },
      year2: calc.y2,
      year3: calc.y3,
      inputs: {
        aadt: { value: aadtUsed, source: aadtSource, year: aadtYear, distance_mi: aadtDist },
        mpds: MPDS, diesel: DIESEL, truck_share_assumed: truckShare
      },
      competition: {
        count: comps.length,
        nearest_mi: nearest,
        notable_brands: notable,
        impact_score: impactScore
      },
      developments: devs,
      rationale: report,
      debug: {
        contact_header: CONTACT,
        geocode: geo,
        overpass_failed: (!comps.length && !devs.length) ? true : false
      }
    });
  } catch (e) {
    return jerr(res, 500, "Estimate failed", String(e));
  }
});

// global error handler
app.use((err, _req, res, _next) =>
  jerr(res, 500, "Unhandled error", String(err))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));
