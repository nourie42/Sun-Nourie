// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public")); // serve /public

// ---------- helpers ----------
function jerr(res, code, msg, detail) {
  console.error("[ERROR]", code, msg, detail || "");
  return res.status(code).json({ error: msg, detail });
}

function ua() {
  return {
    "User-Agent": "SunNourie-Gallons-Estimator/1.0 (+contact: app@sun-estimator.example)",
    "Accept": "application/json"
  };
}

async function safeJSON(r) {
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`JSON parse failed: ${text.slice(0,400)}`); }
  return data;
}

// ---------- geocode (OSM Nominatim; no key required) ----------
async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const r = await fetch(url, { headers: ua() });
  if (!r.ok) throw new Error(`Nominatim ${r.status}: ${await r.text()}`);
  const arr = await safeJSON(r);
  if (!arr?.length) throw new Error("No geocode result");
  const { lat, lon, display_name } = arr[0];
  return { lat: Number(lat), lng: Number(lon), label: display_name };
}

// ---------- Overpass helpers ----------
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

async function overpass(query) {
  let lastErr;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(ep, {
        method: "POST",
        headers: {
          ...ua(),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "data=" + encodeURIComponent(query)
      });
      if (!r.ok) throw new Error(`Overpass ${r.status}: ${await r.text()}`);
      return await safeJSON(r);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---------- AADT estimate from nearest highway ----------
const HIGHWAY_AADT_TABLE = {
  motorway: 60000,
  trunk: 40000,
  primary: 25000,
  secondary: 15000,
  tertiary: 10000,
  unclassified: 6000,
  residential: 3000,
  service: 1000
};

function mphFromMaxspeed(tag) {
  if (!tag) return null;
  const s = String(tag).toLowerCase();
  const num = parseFloat(s.replace(/[^\d.]/g, ""));
  if (!isFinite(num)) return null;
  return s.includes("km") ? Math.round(num * 0.621371) : Math.round(num);
}

function highwayRank(t) {
  const order = ["motorway","trunk","primary","secondary","tertiary","unclassified","residential","service"];
  const i = order.indexOf(t || "");
  return i === -1 ? 999 : i;
}

async function estimateAADTFromOSM(lat, lng) {
  const q = `
  [out:json][timeout:20];
  (
    way(around:120,${lat},${lng})[highway];
    way(around:220,${lat},${lng})[highway];
  );
  out tags center 20;
  `;
  const data = await overpass(q);
  if (!data?.elements?.length) {
    throw new Error("No nearby highway ways");
  }
  // pick best highway class
  data.elements.sort((a,b)=> highwayRank(a.tags?.highway) - highwayRank(b.tags?.highway));
  const best = data.elements[0];
  const type = best?.tags?.highway || "unclassified";
  let aadt = HIGHWAY_AADT_TABLE[type] ?? 8000;

  const ms = mphFromMaxspeed(best?.tags?.maxspeed || best?.tags?.["maxspeed:advisory"]);
  if (ms && ms >= 55) aadt = Math.round(aadt * 1.2);
  if (ms && ms <= 30) aadt = Math.round(aadt * 0.8);

  return {
    aadt,
    highway: type,
    maxspeed_mph: ms ?? null
  };
}

// ---------- Competitors within 1 mile (1609 m) ----------
const HEAVY_BRANDS = [
  "sheetz","wawa","quiktrip","qt","racetrac","buc-ee","costco","sam's","bj's",
  "pilot","love's","circle k","speedway","murphy","murphy usa","walmart","harris teeter"
];

function metersToMiles(m){ return m / 1609.344; }

async function findCompetitors(lat, lng) {
  const radiusM = 1609;
  const q = `
  [out:json][timeout:20];
  (
    node(around:${radiusM},${lat},${lng})["amenity"="fuel"];
    way(around:${radiusM},${lat},${lng})["amenity"="fuel"];
    rel(around:${radiusM},${lat},${lng})["amenity"="fuel"];
  );
  out center tags;
  `;
  const data = await overpass(q);
  const out = [];
  for (const e of data.elements || []) {
    const tags = e.tags || {};
    const name = (tags.brand || tags.name || "").trim();
    const latc = e.lat ?? e.center?.lat;
    const lngc = e.lon ?? e.center?.lon;
    if (latc == null || lngc == null) continue;
    // Rough distance (Haversine simplified for small radii)
    const dy = (latc - lat) * (Math.PI/180) * 6371000;
    const dx = (lngc - lng) * (Math.PI/180) * 6371000 * Math.cos((lat * Math.PI)/180);
    const distM = Math.sqrt(dx*dx + dy*dy);
    const low = name.toLowerCase();
    const heavy = HEAVY_BRANDS.some(b => low.includes(b));
    out.push({ name, lat: latc, lng: lngc, meters: Math.round(distM), miles: +(metersToMiles(distM)).toFixed(2), heavy });
  }
  // sort by distance
  out.sort((a,b)=> a.meters - b.meters);
  return out;
}

// ---------- Gallons model ----------
function computeGallons({ aadt, mpds, dieselPositions, competitors }) {
  // Baseline rule
  const baseline = aadt * 0.08 * 2 * 30; // AADT × 8% × 2 directions × 30 days

  // Competition adjustment
  const withinHalf = competitors.filter(c => c.meters <= 805);
  const withinMile = competitors; // already 1 mile

  const heavyHalf = withinHalf.filter(c => c.heavy).length;
  const heavyMile = withinMile.filter(c => c.heavy).length - heavyHalf;

  const regHalf = withinHalf.length - heavyHalf;
  const regMile = withinMile.length - withinHalf.length - heavyMile;

  // penalties
  let factor = 1.0
    - heavyHalf * 0.12
    - heavyMile * 0.07
    - regHalf   * 0.06
    - regMile   * 0.03;

  // clamp
  if (factor < 0.50) factor = 0.50;
  if (factor > 1.15) factor = 1.15;

  // Diesel boost (optional)
  const dieselBoost = (dieselPositions || 0) * 12000;

  // MPD throughput cap (rough)
  const capPerMPD = 45000; // gal/month per regular MPD
  const capacityCap = Math.max(1, mpds || 0) * capPerMPD;

  let gallons = Math.round(baseline * factor + dieselBoost);
  if (gallons > capacityCap) gallons = capacityCap;
  if (gallons < 0) gallons = 0;

  return {
    gallons,
    baseline: Math.round(baseline),
    factor,
    dieselBoost,
    capacityCap,
    compBreakdown: { heavyHalf, heavyMile, regHalf, regMile }
  };
}

// ---------- Routes ----------

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// AADT (exposed for your "Test AADT" button)
app.get("/aadt", async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return jerr(res, 400, "Missing lat/lng");
    const est = await estimateAADTFromOSM(Number(lat), Number(lng));
    return res.json({ ...est, method: "osm-highway-heuristic" });
  } catch (e) {
    return jerr(res, 500, "AADT fetch failed", String(e));
  }
});

// Main estimator
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel } = req.body || {};
    if (!address || mpds === undefined)
      return jerr(res, 400, "Missing address or mpds");

    // 1) Geocode
    let geo;
    try { geo = await geocode(address); }
    catch (e) {
      // Fallback: Knightdale center-ish to avoid total failure
      geo = { lat: 35.787, lng: -78.49, label: "Fallback geocode" };
    }

    // 2) AADT estimate from OSM road type
    let aadtInfo;
    try { aadtInfo = await estimateAADTFromOSM(geo.lat, geo.lng); }
    catch (e) { aadtInfo = { aadt: 18000, highway: "primary?", maxspeed_mph: null, fallback: true }; }

    // 3) Competitors within 1 mile
    let comps = [];
    try { comps = await findCompetitors(geo.lat, geo.lng); }
    catch (e) { comps = []; }

    // 4) Gallons math
    const calc = computeGallons({
      aadt: aadtInfo.aadt,
      mpds: Number(mpds),
      dieselPositions: Number(diesel || 0),
      competitors: comps
    });

    const rationale = `AADT≈${aadtInfo.aadt} on ${aadtInfo.highway} road; ${comps.length} competitors in 1 mi (${calc.compBreakdown.heavyHalf + calc.compBreakdown.heavyMile} heavy); factor=${(calc.factor*100|0)}%, MPD cap=${calc.capacityCap.toLocaleString()} gal/mo.`;

    return res.json({
      monthly_gallons: calc.gallons,
      rationale,
      debug: {
        geocode: geo,
        aadt: aadtInfo,
        competitors: comps.slice(0, 20), // trim
        math: calc
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

