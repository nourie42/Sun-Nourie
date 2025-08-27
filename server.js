// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public")); // serves /public

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
      "User-Agent": "FuelEstimator/1.3 (contact: noreply@example.com)",
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
  const R = 6371000,
    toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1),
    dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
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
      "User-Agent": "FuelEstimator/1.3 (contact: noreply@example.com)",
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
      // sibling year-ish fields
      for (const yk of [
        "YEAR",
        "AADT_YEAR",
        "COUNT_YEAR",
        "TRAFFICYEAR",
        "YEAR_",
        "YR",
        "YR_",
      ]) {
        if (attrs[yk] != null) {
          const yy = String(attrs[yk]).match(/20\d{2}/)?.[0];
          if (yy) {
            year = Number(yy);
            break;
          }
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

  rows.sort(
    (A, B) =>
      (B.year || 0) - (A.year || 0) || B.aadt - A.aadt || A.distM - B.distM
  );
  return rows[0];
}

// ---------------- Helper: street class bounds (for GPT estimate sanity) ----------------
function inferClass(address) {
  const s = String(address).toLowerCase();
  if (/(^|\b)(i[- ]\d+|interstate)\b/.test(s)) return "freeway";
  if (/\b(us[- ]?\d+|us hwy|u\.s\.)\b/.test(s)) return "primary arterial";
  if (/\b(nc[- ]?\d+|state rt|state hwy|sr[- ]?\d+)\b/.test(s))
    return "primary arterial";
  if (/\b(hwy|highway|blvd|pkwy|parkway|bypass)\b/.test(s)) return "arterial";
  return "collector";
}
const AADT_RANGES = {
  freeway: "40,000–120,000",
  "primary arterial": "12,000–60,000",
  arterial: "8,000–35,000",
  collector: "3,000–12,000",
};

// ---------------- OpenAI helpers ----------------
async function gptJSON(prompt) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content:
            "You are a precise fuel volume analyst. Always return valid JSON (no markdown).",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${txt}`);
  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    throw new Error("OpenAI JSON parse error");
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No GPT content");
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("GPT returned invalid JSON");
  }
}

// ---------------- /estimate ----------------
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel, aadtOverride } = req.body || {};
    const MPDS = Number(mpds);
    const DIESEL = Number(diesel || 0);
    const AADT_OVERRIDE =
      aadtOverride != null && aadtOverride !== ""
        ? Number(aadtOverride)
        : null;

    if (!address) return jerr(res, 400, "Address required");
    if (!Number.isFinite(MPDS) || MPDS <= 0)
      return jerr(res, 400, "Regular MPDs required (>0)");

    // 1) Geocode the exact address
    const geo = await geocode(address);

    // 2) Actual AADT from NCDOT (best nearby)
    const station = await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609).catch(
      () => null
    );
    const actualAADT = station
      ? {
          value: station.aadt,
          year: station.year,
          distance_mi: +toMiles(station.distM).toFixed(3),
          source: "NCDOT AADT Stations (best nearby)",
        }
      : null;

    // 3) GPT estimated AADT (independent; bounded by class)
    const roadClass = inferClass(address);
    const aadtEstPrompt = `
Estimate a plausible AADT for this location strictly within class bounds unless you explicitly justify going outside.

Address: ${address}
Street class hint: ${roadClass}
Use bounds by class:
- Freeway: ${AADT_RANGES.freeway}
- Primary arterial: ${AADT_RANGES["primary arterial"]}
- Arterial: ${AADT_RANGES.arterial}
- Collector/local: ${AADT_RANGES.collector}

Return JSON only:
{"aadt_estimate": <number>, "low": <number>, "high": <number>, "class_used": "<string>", "rationale": "<short>"}
`.trim();

    let gptAADT = null;
    try {
      const est = await gptJSON(aadtEstPrompt);
      if (Number.isFinite(est.aadt_estimate)) {
        gptAADT = {
          value: Math.round(est.aadt_estimate),
          low: Number.isFinite(est.low) ? Math.round(est.low) : null,
          high: Number.isFinite(est.high) ? Math.round(est.high) : null,
          class_used: est.class_used || roadClass,
          rationale: est.rationale || "",
        };
      }
    } catch (e) {
      console.warn("[WARN] GPT AADT estimate failed:", e.message);
    }

    // 4) Choose the AADT to use for gallons
    const usedAadt =
      (Number.isFinite(AADT_OVERRIDE) && AADT_OVERRIDE > 0 && AADT_OVERRIDE) ||
      (actualAADT?.value ?? null) ||
      (gptAADT?.value ?? null);

    if (!Number.isFinite(usedAadt)) {
      return jerr(
        res,
        500,
        "AADT unavailable",
        "No override, no NCDOT station nearby, and GPT estimate failed"
      );
    }

    // 5) Ask GPT for the full gallons report, comparing values
    const reportPrompt = `
You will estimate monthly gallons and compare AADT sources.

Inputs:
- Address: ${address}
- Regular MPDs: ${MPDS}
- Diesel positions: ${DIESEL}

AADT sources:
- Actual (DOT): ${
      actualAADT
        ? `${actualAADT.value} (year ${actualAADT.year ?? "n/a"}, ~${
            actualAADT.distance_mi ?? "n/a"
          } mi)`
        : "unavailable"
    }
- GPT estimate: ${
      gptAADT ? `${gptAADT.value} (bounds ${gptAADT.low ?? "?"}–${gptAADT.high ?? "?"})` : "unavailable"
    }
- User override (if any): ${Number.isFinite(AADT_OVERRIDE) ? AADT_OVERRIDE : "none"}
- AADT to use for gallons: ${usedAadt}

Compute gallons:
- Split autos vs trucks (defaults ok).
- Stop rates baseline: autos ~2.0%, trucks ~1.2%.
- Gallons/stop: autos ~10.2, trucks ~16.
- Convert monthly: GPM = GPD × 365/12.
- Capacity cap: positions × 25 cycles/day × gal/cycle (auto 10.5, diesel 16) × 365/12.
- Cap at capacity.
- Competition/developments: reason briefly (you may infer impact).

Output JSON only:
{
  "base": <number>,
  "low": <number>,
  "high": <number>,
  "year2": <number>,
  "year3": <number>,
  "inputs": {
    "aadt_used": <number>,
    "aadt_actual": {"value": <number|null>, "year": <number|null>, "distance_mi": <number|null>, "source":"<string|null>"},
    "aadt_gpt": {"value": <number|null>, "low": <number|null>, "high": <number|null>, "class_used":"<string|null>"},
    "aadt_override": <number|null>,
    "mpds": <number>, "diesel": <number>, "truck_share_assumed": <number 0-1>
  },
  "competition": {"count": <number>, "nearest_mi": <number|null>, "notable_brands": [<string>], "impact_score": <0-1>},
  "developments": [{"name":"<string>","status":"<string>","miles": <number>}],
  "assumptions": [<string>],
  "rationale": "<concise numeric paragraph mentioning the AADT comparison>"
}
`.trim();

    const result = await gptJSON(reportPrompt);

    // Guarantee the comparison block reflects exactly what we used/found
    result.inputs = result.inputs || {};
    result.inputs.aadt_used = usedAadt;
    result.inputs.aadt_override = Number.isFinite(AADT_OVERRIDE)
      ? AADT_OVERRIDE
      : null;
    result.inputs.aadt_actual = actualAADT || {
      value: null,
      year: null,
      distance_mi: null,
      source: null,
    };
    result.inputs.aadt_gpt = gptAADT || {
      value: null,
      low: null,
      high: null,
      class_used: inferClass(address),
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
