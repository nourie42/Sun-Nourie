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
      "User-Agent": "FuelEstimator/1.4 (contact: noreply@example.com)",
      "Accept": "application/json",
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

// Pull up to 200 stations in ~1 mile, select “best nearby” (favor newer year → larger AADT → closer)
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
      "User-Agent": "FuelEstimator/1.4 (contact: noreply@example.com)",
      "Accept": "application/json",
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
      if (!year) {
        const m = k.match(/20\d{2}/);
        if (m) year = Number(m[0]);
      }
      candidates.push({ value: n, year });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => (b.year || 0) - (a.year || 0) || b.value - a.value);
    return candidates[0];
  }

  const rows = [];
  for (const f of feats) {
    const a = extractAADT(f.attributes);
    if (!a) continue;
    const gx = f.geometry?.x ?? f.geometry?.longitude;
    const gy = f.geometry?.y ?? f.geometry?.latitude;
    if (gx == null || gy == null) continue;
    const dM = haversine(lat, lon, gy, gx);
    rows.push({ aadt: a.value, year: a.year || null, distM: dM, x: gx, y: gy });
  }
  if (!rows.length) return null;

  rows.sort((A, B) => (B.year || 0) - (A.year || 0) || B.aadt - A.aadt || A.distM - B.distM);
  return rows[0];
}

// ---------------- Competition via Overpass (for map + impact) ----------------
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];
const CONTACT = process.env.OVERPASS_CONTACT || "FuelEstimator/1.4 (contact: noreply@example.com)";

async function queryOverpass(q, triesPerMirror = 2, delayMs = 900) {
  let lastErr = new Error("No attempt");
  for (const ep of OVERPASS_ENDPOINTS) {
    for (let i = 0; i < triesPerMirror; i++) {
      try {
        const r = await fetch(ep, {
          method: "POST",
          headers: { "User-Agent": CONTACT, "Content-Type": "application/x-www-form-urlencoded", "Accept":"application/json" },
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
  const r = 1609; // 1 mi
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
  out.sort((a,b) => a.miles - b.miles);
  return out;
}

function competitionImpact(competitors) {
  // 1/d decay + hard penalty ≤ 0.03 mi; heavy brands boosted
  let weighted = 0, nearPenalty = 0;
  for (const c of competitors) {
    const d = Math.max(c.miles, 0.05);
    const boost = c.heavy ? 1.6 : 1.0;
    weighted += (1 / d) * boost;
    if (c.miles <= 0.03) nearPenalty += 0.20 * boost;
  }
  const baseCut = 0.035 * weighted;
  const m = Math.max(0.5, Math.min(1.1, 1 - baseCut - nearPenalty));
  const impactScore = Math.max(0, Math.min(0.6, baseCut + nearPenalty));
  const nearest = competitors[0]?.miles ?? null;
  const notable = competitors.filter(c => c.heavy).slice(0,6).map(c => c.name).filter(Boolean);
  return { multiplier: m, impactScore: +impactScore.toFixed(3), nearest, notable };
}

// ---------------- Street class hint (for GPT AADT estimate) ----------------
function inferClass(address) {
  const s = String(address).toLowerCase();
  if (/(^|\b)(i[- ]\d+|interstate)\b/.test(s)) return "freeway";
  if (/\b(us[- ]?\d+|us hwy|u\.s\.)\b/.test(s)) return "primary arterial";
  if (/\b(nc[- ]?\d+|state rt|state hwy|sr[- ]?\d+)\b/.test(s)) return "primary arterial";
  if (/\b(hwy|highway|blvd|pkwy|parkway|bypass)\b/.test(s)) return "arterial";
  return "collector";
}
const AADT_RANGES = {
  freeway: "40,000–120,000",
  "primary arterial": "12,000–60,000",
  arterial: "8,000–35,000",
  collector: "3,000–12,000",
};

// ---------------- OpenAI helper ----------------
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
      max_tokens: 900,
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

// ---------------- /estimate ----------------
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel, aadtOverride } = req.body || {};
    const MPDS = Number(mpds);
    const DIESEL = Number(diesel || 0);
    const AADT_OVERRIDE = aadtOverride !== undefined && aadtOverride !== "" ? Number(aadtOverride) : null;

    if (!address) return jerr(res, 400, "Address required");
    if (!Number.isFinite(MPDS) || MPDS <= 0) return jerr(res, 400, "Regular MPDs required (>0)");

    // 1) Geocode exact address
    const geo = await geocode(address);

    // 2) Actual AADT from NCDOT
    const station = await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609).catch(() => null);
    const actualAADT = station ? {
      value: station.aadt,
      year: station.year,
      distance_mi: +toMiles(station.distM).toFixed(3),
      source: "NCDOT AADT Stations (best nearby)"
    } : null;

    // 3) GPT AADT estimate (bounded)
    const roadClass = inferClass(address);
    let gptAADT = null;
    try {
      const est = await gptJSON(`
Estimate AADT within plausible bounds unless you justify going outside.
Address: ${address}
Street class hint: ${roadClass}
Bounds:
- Freeway: ${AADT_RANGES.freeway}
- Primary arterial: ${AADT_RANGES["primary arterial"]}
- Arterial: ${AADT_RANGES.arterial}
- Collector/local: ${AADT_RANGES.collector}
Return JSON:
{"aadt_estimate": <number>, "low": <number>, "high": <number>, "class_used": "<string>"}
      `.trim());
      if (Number.isFinite(est.aadt_estimate)) {
        gptAADT = {
          value: Math.round(est.aadt_estimate),
          low: Number.isFinite(est.low) ? Math.round(est.low) : null,
          high: Number.isFinite(est.high) ? Math.round(est.high) : null,
          class_used: est.class_used || roadClass
        };
      }
    } catch (e) {
      console.warn("[WARN] GPT AADT estimate failed:", e.message);
    }

    // 4) Competition (for map + impact)
    let competitors = [];
    try { competitors = await competitorsWithin1Mile(geo.lat, geo.lon); } catch (e) { competitors = []; }
    const { multiplier: compMult, impactScore, nearest, notable } = competitionImpact(competitors);

    // 5) Choose AADT:
    // - if override present → use it
    // - else if both actual & gpt exist → use their average (rounded)
    // - else fallback to whichever exists
    let usedAADT = null;
    if (Number.isFinite(AADT_OVERRIDE) && AADT_OVERRIDE > 0) usedAADT = AADT_OVERRIDE;
    else if (actualAADT?.value && gptAADT?.value) usedAADT = Math.round((actualAADT.value + gptAADT.value) / 2);
    else usedAADT = actualAADT?.value ?? gptAADT?.value ?? null;

    if (!Number.isFinite(usedAADT)) {
      return jerr(res, 500, "AADT unavailable", "No override, no NCDOT station nearby, and GPT estimate failed");
    }

    // 6) Ask GPT for the full gallons report (we pass comp impact + AADT comparison)
    const devNote = "Report developments briefly if clearly known; otherwise state 'none found'—do not invent specifics.";
    const report = await gptJSON(`
You estimate monthly gallons using the AADT provided and the competition impact score supplied.
Address: ${address}
AADT sources:
- Actual (DOT): ${actualAADT ? `${actualAADT.value} (year ${actualAADT.year ?? "n/a"}, ~${actualAADT.distance_mi ?? "n/a"} mi)` : "unavailable"}
- GPT estimate: ${gptAADT ? `${gptAADT.value} (bounds ${gptAADT.low ?? "?"}–${gptAADT.high ?? "?"})` : "unavailable"}
- Averaged AADT (if both exist): ${actualAADT?.value && gptAADT?.value ? Math.round((actualAADT.value + gptAADT.value)/2) : "n/a"}
- User override: ${Number.isFinite(AADT_OVERRIDE) ? AADT_OVERRIDE : "none"}
- AADT to use for gallons: ${usedAADT}

Competition impact (already computed from 1/d decay with hard ≤0.03 mi penalty):
- impact_score: ${impactScore}
- nearest_mi: ${nearest ?? "null"}
- notable_brands: [${notable.map(n => `"${n}"`).join(", ")}]
Use this impact qualitatively and quantitatively; do not recompute.

Compute gallons:
- Split autos vs trucks (defaults ok).
- Stop rates baseline: autos ~2.0%, trucks ~1.2%.
- Gallons/stop: autos ~10.2, trucks ~16.
- Monthly conversion GPM = GPD × 365/12.
- Capacity cap: positions × 25 cycles/day × gal/cycle (auto 10.5, diesel 16) × 365/12.
- Cap at capacity.

Return JSON ONLY:
{
  "base": <number>,
  "low": <number>,
  "high": <number>,
  "year2": <number>,
  "year3": <number>,
  "inputs": {
    "aadt_used": <number>,
    "mpds": ${MPDS},
    "diesel": ${DIESEL},
    "truck_share_assumed": <number 0-1>,
    "aadt_actual": {"value": ${actualAADT?.value ?? "null"}, "year": ${actualAADT?.year ?? "null"}, "distance_mi": ${actualAADT?.distance_mi ?? "null"}, "source":"${actualAADT?.source ?? ""}"},
    "aadt_gpt": {"value": ${gptAADT?.value ?? "null"}, "low": ${gptAADT?.low ?? "null"}, "high": ${gptAADT?.high ?? "null"}, "class_used":"${gptAADT?.class_used ?? ""}"},
    "aadt_override": ${Number.isFinite(AADT_OVERRIDE) ? AADT_OVERRIDE : "null"}
  },
  "competition": {"count": ${competitors.length}, "nearest_mi": ${nearest ?? "null"}, "notable_brands": [${notable.map(n => `"${n}"`).join(", ")}], "impact_score": ${impactScore}},
  "developments": [],
  "assumptions": [ "Defaults used where unknown", "Competition multiplier applied via impact score" ],
  "rationale": "<concise numeric paragraph mentioning the AADT comparison and competition impact>"
}
${devNote}
    `.trim());

    // augment with map data so the client can render pins
    report.map = {
      site: { lat: geo.lat, lon: geo.lon, label: geo.label },
      competitors: competitors
    };

    // ensure inputs reflect final used AADT
    report.inputs = report.inputs || {};
    report.inputs.aadt_used = usedAADT;

    return res.json(report);
  } catch (e) {
    return jerr(res, 500, "Estimate failed", String(e));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));

