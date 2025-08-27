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

// ---------------- Geocode (Nominatim) ----------------
async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "FuelEstimator/1.5 (contact: noreply@example.com)",
      Accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`Nominatim ${r.status}: ${await r.text()}`);
  const arr = JSON.parse(await r.text());
  if (!arr?.length) throw new Error("No geocode result");
  const { lat, lon, display_name } = arr[0];
  return { lat: Number(lat), lon: Number(lon), label: display_name };
}

// --------------- NCDOT AADT stations (ArcGIS) ---------------
const NCDOT_AADT_FS =
  "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0";

const toMiles = (m) => m / 1609.344;
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// best nearby (favor newer year → higher AADT → closer)
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

  const r = await fetch(`${NCDOT_AADT_FS}/query?${params.toString()}`, {
    headers: {
      "User-Agent": "FuelEstimator/1.5 (contact: noreply@example.com)",
      Accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`NCDOT ${r.status}: ${await r.text()}`);
  const data = JSON.parse(await r.text());
  const feats = data.features || [];
  if (!feats.length) return null;

  function extractAADT(attrs) {
    if (!attrs) return null;
    const candidates = [];
    for (const [k, v] of Object.entries(attrs)) {
      if (!String(k).toLowerCase().includes("aadt")) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) continue;
      let year = null;
      for (const yk of ["YEAR","AADT_YEAR","COUNT_YEAR","TRAFFICYEAR","YEAR_","YR","YR_"]) {
        if (attrs[yk] != null) {
          const yy = String(attrs[yk]).match(/20\d{2}/)?.[0];
          if (yy) { year = Number(yy); break; }
        }
      }
      if (!year) { const m = k.match(/20\d{2}/); if (m) year = Number(m[0]); }
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
const CONTACT = process.env.OVERPASS_CONTACT || "FuelEstimator/1.5 (contact: noreply@example.com)";

async function queryOverpass(q, triesPerMirror = 2, delayMs = 900) {
  let lastErr = new Error("No attempt");
  for (const ep of OVERPASS_ENDPOINTS) {
    for (let i = 0; i < triesPerMirror; i++) {
      try {
        const r = await fetch(ep, {
          method: "POST",
          headers: { "User-Agent": CONTACT, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: "data=" + encodeURIComponent(q),
        });
        const ct = r.headers.get("content-type") || "";
        const text = await r.text();
        if (!r.ok || !ct.includes("application/json")) throw new Error(`Overpass ${r.status}: ${text.slice(0,300)}`);
        return JSON.parse(text);
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

function distMiles(lat1, lon1, lat2, lon2) { return toMiles(haversine(lat1, lon1, lat2, lon2)); }

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
  const heavyRegex = /sheetz|wawa|quik.?trip|(^|\b)qt\b|racetrac|buc-?ee|costco|sam's|bj's|pilot|love's|circle k|speedway|murphy|exxon|shell|bp|chevron|marathon|7-?eleven/i;
  const out = [];
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const name = tags.brand || tags.name || "";
    const latc = el.lat ?? el.center?.lat;
    const lonc = el.lon ?? el.center?.lon;
    if (latc == null || lonc == null) continue;
    out.push({
      name,
      lat: latc,
      lon: lonc,
      miles: +distMiles(lat, lon, latc, lonc).toFixed(3),
      heavy: heavyRegex.test(name || ""),
    });
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
  // quick dedupe
  const seen = new Set(); const uniq = [];
  for (const d of out) { const key = `${d.name}|${Math.round(d.miles*100)}`; if (!seen.has(key)) { seen.add(key); uniq.push(d); } }
  return uniq.slice(0, 20);
}

// ---------------- GPT helpers (for AADT estimate & write-up) ----------------
function inferClass(address) {
  const s = String(address).toLowerCase();
  if (/(^|\b)(i[- ]\d+|interstate)\b/.test(s)) return "freeway";
  if (/\b(us[- ]?\d+|us hwy|u\.s\.)\b/.test(s)) return "primary arterial";
  if (/\b(nc[- ]?\d+|state rt|state hwy|sr[- ]?\d+)\b/.test(s)) return "primary arterial";
  if (/\b(hwy|highway|blvd|pkwy|parkway|bypass)\b/.test(s)) return "arterial";
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
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
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
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${txt}`);
  const data = JSON.parse(txt);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No GPT content");
  return JSON.parse(content);
}

// ---------------- Gallons model (with floor & gentler competition) ----------------
function gallonsModel({ aadt, mpds, diesel = 0, compImpact = 0 }) {
  // Floor per user rule
  const floor = aadt * 0.02 * 8 * 30; // AADT × 2% × 8 × 30

  // Competition multiplier: at most 15% reduction
  const compMult = Math.max(0.85, 1 - compImpact); // compImpact ~ 0-0.6

  // Simple autos/trucks blend
  const truckShare = 0.10;
  const autos = aadt * (1 - truckShare);
  const trucks = aadt * truckShare;
  const gpd = autos * 0.020 * 10.2 * compMult + trucks * 0.012 * 16.0 * compMult;
  let monthly = gpd * (365 / 12);

  // Apply floor
  monthly = Math.max(monthly, floor);

  // Capacity cap
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
    const { address, mpds, diesel, aadtOverride } = req.body || {};
    const MPDS = Number(mpds);
    const DIESEL = Number(diesel || 0);
    const AADT_OVERRIDE = aadtOverride !== undefined && aadtOverride !== "" ? Number(aadtOverride) : null;

    if (!address) return jerr(res, 400, "Address required");
    if (!Number.isFinite(MPDS) || MPDS <= 0) return jerr(res, 400, "Regular MPDs required (>0)");

    // Geocode
    const geo = await geocode(address);

    // Actual AADT
    const station = await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609).catch(() => null);
    const actualAADT = station ? {
      value: station.aadt,
      year: station.year,
      distance_mi: +toMiles(station.distM).toFixed(3),
      source: "NCDOT AADT Stations (best nearby)"
    } : null;

    // GPT AADT estimate (bounded)
    const roadClass = inferClass(address);
    let gptAADT = null;
    try {
      const est = await gptJSON(`
Estimate a plausible AADT for this address, staying within bounds unless clearly justified.
Address: ${address}
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

    // Impact score from competitors (1/d decay, hard ≤0.03mi penalty, heavy brand boost)
    // We'll feed just the impact to the gallons model
    const impact = (() => {
      let weighted = 0, nearPenalty = 0;
      for (const c of competitors) {
        const d = Math.max(c.miles, 0.05);
        const boost = c.heavy ? 1.6 : 1.0;
        weighted += (1 / d) * boost;
        if (c.miles <= 0.03) nearPenalty += 0.10 * boost; // lighter than before
      }
      const cut = 0.02 * weighted + nearPenalty; // gentler
      return Math.max(0, Math.min(0.6, cut));
    })();

    // Choose AADT: override > average(actual,gpt) > one of them
    let usedAADT = null;
    if (Number.isFinite(AADT_OVERRIDE) && AADT_OVERRIDE > 0) usedAADT = AADT_OVERRIDE;
    else if (actualAADT?.value && gptAADT?.value) usedAADT = Math.round((actualAADT.value + gptAADT.value) / 2);
    else usedAADT = actualAADT?.value ?? gptAADT?.value ?? null;

    if (!Number.isFinite(usedAADT))
      return jerr(res, 500, "AADT unavailable", "No override, no NCDOT station nearby, and GPT estimate failed");

    // Gallons (server-calculated with floor + gentle competition)
    const calc = gallonsModel({ aadt: usedAADT, mpds: MPDS, diesel: DIESEL, compImpact: impact });

    // Concise rationale
    const notable = competitors.filter(c => c.heavy).slice(0,6).map(c => c.name);
    const nearest = competitors[0]?.miles ?? null;
    const rationale = `Base uses AADT ${usedAADT.toLocaleString()} with floor (AADT×2%×8×30=${calc.floor.toLocaleString()}), competition impact ${(impact*100).toFixed(0)}% (nearest ${nearest != null ? nearest.toFixed(3)+' mi' : 'n/a'}${notable.length ? '; notable '+notable.join(', ') : ''}), capped by MPD capacity.`;

    // Assemble response
    const resp = {
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
    };

    return res.json(resp);
  } catch (e) {
    return jerr(res, 500, "Estimate failed", String(e));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));
