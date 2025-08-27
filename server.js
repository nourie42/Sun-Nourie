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

// ------------------ Geocode (OSM Nominatim) ------------------
async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "FuelEstimator/1.0 (contact: noreply@example.com)",
      "Accept": "application/json"
    }
  });
  if (!r.ok) throw new Error(`Nominatim ${r.status}: ${await r.text()}`);
  const arr = JSON.parse(await r.text());
  if (!arr?.length) throw new Error("No geocode result");
  const { lat, lon, display_name } = arr[0];
  return { lat: Number(lat), lon: Number(lon), label: display_name };
}

// ------------------ NCDOT AADT (ArcGIS) ------------------
// We’ll query the public FeatureServer and pick the closest station with an AADT value.
const NCDOT_AADT_FS = "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0";

async function queryNCDOTNearestAADT(lat, lon, radiusMeters = 1609) {
  // Proximity query around the point; return geometry + all attributes
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    geometry: `${lon},${lat}`,          // x,y (lon,lat)
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radiusMeters),
    units: "esriSRUnit_Meter",
    outSR: "4326",
    resultRecordCount: "200"
  });

  const r = await fetch(`${NCDOT_AADT_FS}/query?${params.toString()}`, {
    headers: {
      "User-Agent": "FuelEstimator/1.0 (contact: noreply@example.com)",
      "Accept": "application/json"
    }
  });
  if (!r.ok) throw new Error(`NCDOT ${r.status}: ${await r.text()}`);

  const data = JSON.parse(await r.text());
  const feats = data.features || [];
  if (!feats.length) return null;

  // Helper: pull any AADT-like fields + year
  function extractAADT(attrs) {
    if (!attrs) return null;
    const pairs = [];
    for (const [k, v] of Object.entries(attrs)) {
      const kl = k.toLowerCase();
      if (!kl.includes("aadt")) continue;
      const num = Number(v);
      if (!Number.isFinite(num) || num <= 0) continue;

      let year = null;
      // try siblings like YEAR, AADT_YEAR, COUNT_YEAR, etc.
      for (const yk of ["YEAR", "AADT_YEAR", "COUNT_YEAR", "TRAFFICYEAR", "YEAR_", "YR", "YR_"]) {
        if (attrs[yk] != null) {
          const yy = String(attrs[yk]).match(/20\d{2}/)?.[0];
          if (yy) { year = Number(yy); break; }
        }
      }
      // also scan key name for year
      if (!year) {
        const m = k.match(/20\d{2}/);
        if (m) year = Number(m[0]);
      }
      pairs.push({ value: num, year });
    }
    if (!pairs.length) return null;
    // Prefer latest year; if year is null, sort by value as tiebreak
    pairs.sort((a,b) => (b.year||0) - (a.year||0) || b.value - a.value);
    return pairs[0];
  }

  // pick nearest feature that actually has an AADT field
  let best = null;
  for (const f of feats) {
    const aadt = extractAADT(f.attributes);
    if (!aadt) continue;
    const g = f.geometry || {};
    const x = g.x ?? g.longitude, y = g.y ?? g.latitude;
    if (x == null || y == null) continue;
    const dMeters = haversine(lat, lon, y, x);
    const row = {
      aadt: aadt.value,
      year: aadt.year || null,
      distM: dMeters,
      lat: y,
      lon: x
    };
    if (!best || row.distM < best.distM) best = row;
  }
  return best;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = d => d*Math.PI/180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
const toMiles = m => m / 1609.344;

// ------------------ Bounded fallback when no DOT count ------------------
function inferStreetClassFromAddress(address) {
  const s = String(address).toLowerCase();
  if (/(^|\b)(i[- ]\d+|interstate)\b/.test(s)) return "freeway";
  if (/\b(us[- ]?\d+|us hwy|u\.s\.)\b/.test(s)) return "primary arterial";
  if (/\b(nc[- ]?\d+|state rt|state hwy|sr[- ]?\d+)\b/.test(s)) return "primary arterial";
  if (/\b(hwy|highway|blvd|pkwy|parkway|bypass)\b/.test(s)) return "arterial";
  return "collector";
}
const AADT_RANGES = {
  "freeway": [40000,120000],
  "primary arterial": [12000,60000],
  "arterial": [8000,35000],
  "collector": [3000,12000]
};
function pickMidpoint([lo,hi]) { return Math.round((lo+hi)/2); }

// ------------------ OpenAI Chat (JSON output) ------------------
async function callGPT(jsonSpec) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        { role: "system", content: "You are a precise fuel volume analyst. Always return valid JSON, no markdown." },
        { role: "user", content: jsonSpec }
      ]
    })
  });

  const txt = await r.text();
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${txt}`);
  let data;
  try { data = JSON.parse(txt); } catch { throw new Error("OpenAI JSON parse error"); }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No GPT content");
  try { return JSON.parse(content); } catch { throw new Error("GPT returned invalid JSON"); }
}

// ------------------ /estimate ------------------
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel } = req.body || {};
    if (!address) return jerr(res, 400, "Address required");
    const MPDS = Number(mpds);
    const DIESEL = Number(diesel || 0);
    if (!Number.isFinite(MPDS) || MPDS <= 0) return jerr(res, 400, "Regular MPDs required (>0)");

    // 1) Geocode the EXACT address the user typed
    const geo = await geocode(address);

    // 2) Try NCDOT AADT Stations (nearest within 1 mile)
    const dot = await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609).catch(() => null);

    // 3) If none, build bounded fallback from street class
    let aadtUsed, aadtSource, aadtYear = null, aadtDist = null, streetClass = inferStreetClassFromAddress(address);
    if (dot) {
      aadtUsed = dot.aadt;
      aadtYear = dot.year;
      aadtDist = +toMiles(dot.distM).toFixed(3);
      aadtSource = "NCDOT AADT Stations (nearest station)";
    } else {
      const range = AADT_RANGES[streetClass] || [6000,18000];
      aadtUsed = pickMidpoint(range);      // a conservative center of the allowed band
      aadtSource = `Fallback bounded by street class (${streetClass})`;
    }

    // 4) Ask GPT to complete the flow using the AADT we determined
    const spec = `
You are a fuel volume analyst. Use the fixed AADT below (do not invent a larger number unless you have a better DOT source):

FIXED_AADT: ${aadtUsed}
FIXED_AADT_SOURCE: ${aadtSource}
FIXED_AADT_YEAR: ${aadtYear ?? "null"}
FIXED_AADT_DISTANCE_MI: ${aadtDist ?? "null"}

Inputs:
- Address: ${address}
- Regular MPDs: ${MPDS}
- Diesel positions: ${DIESEL}

Flow (must follow):
1) Use the FIXED_AADT above as the site traffic input. If you have a superior DOT source with a nearby segment, you may adjust slightly but you MUST state the source/year/distance.
2) Competition within 1 mile: distance-decay 1/d, heavy penalty at ≤0.03 mi, optional brand boost (Sheetz/Wawa/QT/RaceTrac/Costco/etc.).
3) Developments: planned/proposed/permit/coming-soon/construction only.
4) Compute gallons:
   - Split autos vs trucks (defaults allowed).
   - Stop rates baseline: autos ~2.0%, trucks ~1.2%.
   - Gallons/stop: autos ~10.2, trucks ~16.
   - Monthly conversion GPM = GPD × 365/12.
   - Capacity cap: positions × 25 cycles/day × gal/cycle (auto 10.5, diesel 16) × 365/12.
   - Cap at capacity.
5) Output JSON ONLY with keys:
{
  "base": <number>,
  "low": <number>,
  "high": <number>,
  "year2": <number>,
  "year3": <number>,
  "inputs": {
    "aadt": { "value": <number>, "source": "<string>", "year": <number|null>, "distance_mi": <number|null> },
    "mpds": <number>, "diesel": <number>, "truck_share_assumed": <number 0-1>
  },
  "competition": { "count": <number>, "nearest_mi": <number|null>, "notable_brands": [<string>], "impact_score": <0-1> },
  "developments": [ { "name":"<string>", "status":"<string>", "miles": <number> } ],
  "assumptions": [<string>],
  "rationale": "<one concise numeric paragraph>"
}
    `.trim();

    const result = await callGPT(spec);

    // replace inputs.aadt with our fixed values to ensure alignment
    result.inputs = result.inputs || {};
    result.inputs.aadt = {
      value: aadtUsed,
      source: aadtSource,
      year: aadtYear,
      distance_mi: aadtDist
    };
    result.inputs.mpds = MPDS;
    result.inputs.diesel = DIESEL;

    return res.json(result);
  } catch (e) {
    return jerr(res, 500, "Estimate failed", String(e));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));

