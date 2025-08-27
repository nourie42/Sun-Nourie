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

function headersJSON() {
  return {
    "User-Agent":
      "GallonsEstimator/1.2 (+contact: noreply@example.com; for OSM/ArcGIS courtesy)",
    Accept: "application/json",
  };
}

async function safeJSON(r) {
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`JSON parse failed: ${text.slice(0, 400)}`);
  }
  return data;
}

function toMiles(m) {
  return m / 1609.344;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function distMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestPointDistanceMeters(lat, lon, geom) {
  if (!geom) return Infinity;
  if (geom.x != null && geom.y != null) {
    return distMeters(lonLat(geom).lat, lonLat(geom).lon, lat, lon); // keep consistent
  }
  if (geom.latitude && geom.longitude) {
    return distMeters(geom.latitude, geom.longitude, lat, lon);
  }
  // polylines
  if (geom.paths && Array.isArray(geom.paths)) {
    let best = Infinity;
    for (const path of geom.paths) {
      for (const [x, y] of path) {
        const d = distMeters(lat, lon, y, x);
        if (d < best) best = d;
      }
    }
    return best;
  }
  // polygons
  if (geom.rings && Array.isArray(geom.rings)) {
    let best = Infinity;
    for (const ring of geom.rings) {
      for (const [x, y] of ring) {
        const d = distMeters(lat, lon, y, x);
        if (d < best) best = d;
      }
    }
    return best;
  }
  return Infinity;
}

function lonLat(obj) {
  // ArcGIS often uses geometry {x: lon, y: lat}
  if (obj.x != null && obj.y != null) return { lon: obj.x, lat: obj.y };
  if (obj.longitude != null && obj.latitude != null)
    return { lon: obj.longitude, lat: obj.latitude };
  return { lon: null, lat: null };
}

// ----------------------------- Geocode (Nominatim) -----------------------------
async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    address
  )}`;
  const r = await fetch(url, { headers: headersJSON() });
  if (!r.ok) throw new Error(`Nominatim ${r.status}: ${await r.text()}`);
  const arr = await safeJSON(r);
  if (!arr?.length) throw new Error("No geocode result");
  const { lat, lon, display_name } = arr[0];
  return { lat: Number(lat), lon: Number(lon), label: display_name };
}

// ----------------------------- ArcGIS AADT search -----------------------------
const ARC_SEARCH = "https://www.arcgis.com/sharing/rest/search";
async function arcSearch(q, bbox, num = 40) {
  const params = new URLSearchParams({
    f: "json",
    q,
    bbox, // west,south,east,north
    num: String(num),
  });
  const r = await fetch(`${ARC_SEARCH}?${params.toString()}`, {
    headers: headersJSON(),
  });
  if (!r.ok) throw new Error(`ArcGIS search ${r.status}: ${await r.text()}`);
  return safeJSON(r);
}

async function arcItem(id) {
  const r = await fetch(
    `https://www.arcgis.com/sharing/rest/content/items/${id}?f=json`,
    { headers: headersJSON() }
  );
  if (!r.ok) throw new Error(`ArcGIS item ${r.status}`);
  return safeJSON(r);
}

async function arcServiceInfo(url) {
  const r = await fetch(`${url}?f=json`, { headers: headersJSON() });
  if (!r.ok) throw new Error(`ArcGIS service ${r.status}`);
  return safeJSON(r);
}

async function arcQuery(url, layerId, lat, lon, meters = 2500) {
  // point proximity query
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    geometry: `${lon},${lat}`, // x,y (lon,lat)
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(meters),
    units: "esriSRUnit_Meter",
    outSR: "4326",
    resultRecordCount: "100",
  });
  const r = await fetch(`${url}/${layerId}/query?${params.toString()}`, {
    headers: headersJSON(),
  });
  if (!r.ok) throw new Error(`ArcGIS query ${r.status}: ${await r.text()}`);
  return safeJSON(r);
}

function extractAADT(attributes) {
  if (!attributes) return null;
  const pairs = [];
  const keys = Object.keys(attributes);
  for (const k of keys) {
    const v = attributes[k];
    if (v == null) continue;
    const kl = String(k).toLowerCase();
    if (kl.includes("aadt")) {
      const num = Number(v);
      if (Number.isFinite(num) && num > 0) {
        // Try to detect a year from the key or a companion field
        let year = null;
        const m = k.match(/20\d{2}/);
        if (m) year = Number(m[0]);
        const candidates = [
          "year",
          "yr",
          "yr_",
          "aadt_year",
          "count_year",
          "trafficyea",
          "countyr",
          "yr_aadt",
        ];
        for (const c of candidates) {
          if (attributes[c] != null && !year) {
            const yy = Number(String(attributes[c]).match(/20\d{2}/)?.[0]);
            if (yy) year = yy;
          }
        }
        pairs.push({ value: num, year });
      }
    }
  }
  if (!pairs.length) return null;
  // pick the pair with the highest value (often latest) to avoid non-typical fields
  pairs.sort((a, b) => b.value - a.value);
  return pairs[0];
}

async function findAADTFromArcGIS(lat, lon) {
  const span = 0.35; // degrees for bbox
  const bbox = `${lon - span},${lat - span},${lon + span},${lat + span}`;
  // Try AADT first, then traffic count
  const queries = [
    `aadt AND type:("Feature Service" OR "Map Service")`,
    `"traffic count" AND type:("Feature Service" OR "Map Service")`,
  ];
  const tried = [];
  for (const q of queries) {
    const s = await arcSearch(q, bbox, 50);
    if (!s?.results?.length) continue;
    for (const item of s.results) {
      tried.push(item.title);
      // Resolve URL for the service
      let url = item.url;
      if (!url) {
        const meta = await arcItem(item.id);
        url = meta.url;
      }
      if (!url) continue;
      try {
        const info = await arcServiceInfo(url);
        const layers = (info.layers || []).map((l) => ({
          id: l.id,
          name: l.name,
        }));
        for (const L of layers) {
          let features = [];
          try {
            const resp = await arcQuery(url, L.id, lat, lon, 3000);
            features = resp.features || [];
          } catch (_) {
            continue;
          }
          if (!features.length) continue;
          // Find nearest record with an AADT-like attribute
          let best = null;
          for (const f of features) {
            const geom = f.geometry || {};
            const dM = nearestPointDistanceMeters(lat, lon, geom);
            const a = extractAADT(f.attributes);
            if (!a) continue;
            if (!best || dM < best.distM) {
              const point = lonLat(geom);
              best = {
                aadt: a.value,
                year: a.year || null,
                distM: dM,
                lat: point.lat,
                lon: point.lon,
                layer: L.name,
                title: item.title,
                serviceUrl: url,
              };
            }
          }
          if (best) return best;
        }
      } catch (_) {
        // Next item
        continue;
      }
    }
  }
  return null;
}

// ----------------------------- OSM (Overpass) -----------------------------
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function overpass(q) {
  let lastErr;
  for (const ep of OVERPASS) {
    try {
      const r = await fetch(ep, {
        method: "POST",
        headers: {
          ...headersJSON(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "data=" + encodeURIComponent(q),
      });
      if (!r.ok) throw new Error(`Overpass ${r.status}: ${await r.text()}`);
      return await safeJSON(r);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const HEAVY_BRANDS = [
  "sheetz",
  "wawa",
  "quiktrip",
  "qt",
  "racetrac",
  "buc-ee",
  "buc‑ee",
  "buc-ee's",
  "costco",
  "sam's",
  "bj's",
  "pilot",
  "love's",
  "circle k",
  "speedway",
  "murphy",
  "murphy usa",
  "kangaroo",
  "marathon",
  "sunoco",
  "exxon",
  "shell",
  "chevron",
  "bp",
  "7-eleven",
];

function brandBoost(name) {
  const n = (name || "").toLowerCase();
  return HEAVY_BRANDS.some((b) => n.includes(b)) ? 1.6 : 1.0;
}

async function competitorsWithin1Mile(lat, lon) {
  const rMile = 1609;
  const q = `
  [out:json][timeout:25];
  (
    node(around:${rMile},${lat},${lon})["amenity"="fuel"];
    way(around:${rMile},${lat},${lon})["amenity"="fuel"];
    rel(around:${rMile},${lat},${lon})["amenity"="fuel"];
  );
  out center tags;`;
  const data = await overpass(q);
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
      heavy: brandBoost(name) > 1.0,
    });
  }
  list.sort((a, b) => a.meters - b.meters);
  return list;
}

async function developments1Mile(lat, lon) {
  const rMile = 1609;
  const q = `
  [out:json][timeout:25];
  (
    node(around:${rMile},${lat},${lon})["amenity"="fuel"]["construction"];
    way(around:${rMile},${lat},${lon})["amenity"="fuel"]["construction"];
    node(around:${rMile},${lat},${lon})["proposed:amenity"="fuel"];
    way(around:${rMile},${lat},${lon})["proposed:amenity"="fuel"];
    node(around:${rMile},${lat},${lon})["opening_date"];
    way(around:${rMile},${lat},${lon})["opening_date"];
    node(around:${rMile},${lat},${lon})["description"~"(?i)(coming soon|proposed|permit|construction|planned)"];
    way(around:${rMile},${lat},${lon})["description"~"(?i)(coming soon|proposed|permit|construction|planned)"];
  );
  out center tags;`;
  const data = await overpass(q);
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
    out.push({
      name,
      status,
      miles: +toMiles(dM).toFixed(3),
    });
  }
  out.sort((a, b) => a.miles - b.miles);
  // Deduplicate roughly by name + miles bucket
  const uniq = [];
  const seen = new Set();
  for (const x of out) {
    const key = `${x.name}|${Math.round(x.miles * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(x);
  }
  return uniq.slice(0, 12);
}

// ----------------------------- model math -----------------------------
const AADT_HEURISTIC_BY_HIGHWAY = {
  motorway: 60000,
  trunk: 40000,
  primary: 25000,
  secondary: 15000,
  tertiary: 10000,
  unclassified: 6000,
  residential: 3000,
  service: 1000,
};

function highwayFromOSM(lat, lon) {
  return overpass(
    `
  [out:json][timeout:20];
  way(around:200,${lat},${lon})[highway];
  out tags center 20;`
  ).then((d) => {
    const els = (d.elements || []).filter((e) => e.tags?.highway);
    if (!els.length) return null;
    els.sort((a, b) => {
      const order = [
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "unclassified",
        "residential",
        "service",
      ];
      const ia = order.indexOf(a.tags.highway);
      const ib = order.indexOf(b.tags.highway);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return els[0].tags.highway;
  });
}

function defaultTruckShareByHighway(hw) {
  if (!hw) return 0.08;
  if (hw === "motorway" || hw === "trunk") return 0.11;
  if (hw === "primary") return 0.09;
  if (hw === "secondary") return 0.07;
  return 0.06;
}

function competitionMultiplier(competitors) {
  // 1/d decay + near-site penalty at ≤0.03 mi; heavy brands boosted
  let weighted = 0;
  let nearPenalty = 0;
  for (const c of competitors) {
    const d = Math.max(c.miles, 0.05); // avoid blow-up
    const boost = brandBoost(c.name);
    weighted += (1 / d) * boost;
    if (c.miles <= 0.03) nearPenalty += 0.20 * boost; // hard near-site penalty
  }
  // Convert to a multiplier (calibrated)
  const baseCut = 0.035 * weighted;
  const m = clamp(1 - baseCut - nearPenalty, 0.50, 1.10);
  const impactScore = clamp(baseCut + nearPenalty, 0, 0.6);
  return { m, impactScore: +impactScore.toFixed(3) };
}

function gallonsModel({
  aadt,
  truckShare,
  mpds,
  diesel = 0,
  compMult = 1.0,
  availability = 1.0,
}) {
  // Stop rates and gallons per stop
  const autoStop = 0.020; // 2.0%
  const truckStop = 0.012; // 1.2%
  const autoGal = 10.2;
  const truckGal = 16.0;

  const autos = aadt * (1 - truckShare);
  const trucks = aadt * truckShare;

  // Multipliers (competition baked into compMult)
  const mAuto = availability * compMult;
  const mTruck = availability * compMult;

  const gpdAuto = autos * autoStop * mAuto * autoGal;
  const gpdTruck = trucks * truckStop * mTruck * truckGal;
  const gpm = (gpdAuto + gpdTruck) * (365 / 12);

  // Capacity cap
  const cycles = 25; // /day
  const cap =
    (mpds * cycles * 10.5 + (diesel || 0) * cycles * 16.0) * (365 / 12);

  const base = Math.round(Math.min(gpm, cap));
  const low = Math.round(base * 0.86);
  const high = Math.round(base * 1.06);
  const y2 = Math.round(base * 1.027);
  const y3 = Math.round(y2 * 1.0125);

  return { base, low, high, y2, y3, cap: Math.round(cap) };
}

// ----------------------------- routes -----------------------------
app.get("/health", (_req, res) => res.json({ ok: true }));

// Raw AADT check (for your Test AADT button)
app.get("/aadt", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
      return jerr(res, 400, "Missing lat/lon");
    const exact = await findAADTFromArcGIS(lat, lon);
    if (exact)
      return res.json({
        aadt: exact.aadt,
        source: `${exact.title} • ${exact.layer}`,
        distance_mi: +toMiles(exact.distM).toFixed(3),
        year: exact.year || null,
      });
    // Fallback: infer from highway class
    const hw = await highwayFromOSM(lat, lon);
    const aadt = AADT_HEURISTIC_BY_HIGHWAY[hw || "unclassified"] || 8000;
    return res.json({
      aadt,
      source: `OSM highway class (${hw || "unknown"}) heuristic`,
      distance_mi: null,
      year: null,
    });
  } catch (e) {
    return jerr(res, 500, "AADT fetch failed", String(e));
  }
});

// Main estimator (chat-style flow expects address + MPDs)
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel } = req.body || {};
    if (!address) return jerr(res, 400, "Address required");
    const MPDS = Number(mpds);
    const DIESEL = Number(diesel || 0);
    if (!Number.isFinite(MPDS) || MPDS <= 0)
      return jerr(res, 400, "Regular MPDs required (>0)");

    // 1) Geocode
    const geo = await geocode(address);

    // 2) AADT (ArcGIS → fallback to OSM highway heuristic)
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

    // 3) Competition + Developments from OSM
    const comps = await competitorsWithin1Mile(geo.lat, geo.lon);
    const devs = await developments1Mile(geo.lat, geo.lon);

    // Competition multiplier
    const { m: compMult, impactScore } = competitionMultiplier(comps);
    // Truck share default from highway context
    const hwForTruck = await highwayFromOSM(geo.lat, geo.lon);
    const truckShare = defaultTruckShareByHighway(hwForTruck);

    // 4) Gallons model
    const calc = gallonsModel({
      aadt: aadtUsed,
      truckShare,
      mpds: MPDS,
      diesel: DIESEL,
      compMult,
      availability: 1.0,
    });

    // 5) Assemble report fields
    const notable = comps
      .filter((c) => c.heavy)
      .slice(0, 6)
      .map((c) => c.name)
      .filter(Boolean);

    const nearest = comps[0]?.miles ?? null;
    const compSummary = {
      count: comps.length,
      nearest_mi: nearest,
      notable_brands: notable,
      impact_score: impactScore,
    };

    const devSummary = devs.map((d) => `${d.name} • ${d.status} • ${d.miles} mi`);

    // 6) Build formatted report (exact structure requested)
    const formatInt = (n) =>
      n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });

    const lines = [];
    lines.push(
      `**Base Estimate (gal/mo)** ${formatInt(calc.base)}, **Low–High** ${formatInt(
        calc.low
      )}–${formatInt(calc.high)}, **Year-2** ${formatInt(
        calc.y2
      )}, **Year-3** ${formatInt(calc.y3)}`
    );
    lines.push("");
    lines.push(
      `**Inputs used:** AADT ${formatInt(aadtUsed)} (source: ${aadtSource}${
        aadtYear ? `, ${aadtYear}` : ""
      }${aadtDist != null ? `, ~${aadtDist} mi` : ""}); MPDs ${MPDS}${
        DIESEL ? ` + diesel ${DIESEL}` : ""
      }; truck share ${Math.round(truckShare * 100)}% (assumed)`
    );
    lines.push(
      `**Competition summary:** ${compSummary.count} stations within 1 mi${
        compSummary.nearest_mi != null ? `; nearest ${compSummary.nearest_mi.toFixed(3)} mi` : ""
      }${notable.length ? `; notable: ${notable.join(", ")}` : ""}; impact ${(
        compSummary.impact_score * 100
      ).toFixed(0)}%`
    );
    lines.push(
      `**Developments:** ${
        devSummary.length ? devSummary.join(" · ") : "none found (OSM/planning tags)"
      }`
    );
    lines.push(
      `**Assumptions:** access/visibility 1.00; price/facility/propensity 1.00 (defaults); auto stop 2.0%, truck stop 1.2%; gallons/stop auto 10.2, truck 16.0; capacity cap = positions × 25 cycles/day × gal/cycle × 365/12.`
    );
    lines.push(
      `**One‑paragraph rationale:** Using AADT ≈ ${formatInt(
        aadtUsed
      )} from ${aadtSource}${
        aadtYear ? ` (${aadtYear})` : ""
      } with truck share ${Math.round(
        truckShare * 100
      )}% and ${MPDS}${DIESEL ? `+${DIESEL} diesel` : ""} positions. Found ${
        comps.length
      } competitors within 1 mi${
        nearest != null ? ` (nearest ${nearest.toFixed(3)} mi)` : ""
      } and applied a competition multiplier derived from 1/d distance decay with a heavy penalty at ≤0.03 mi and brand boosts; final estimate capped by MPD throughput.`
    );

    return res.json({
      base_monthly_gallons: calc.base,
      low_high: { low: calc.low, high: calc.high },
      year2: calc.y2,
      year3: calc.y3,
      inputs: {
        aadt: {
          value: aadtUsed,
          source: aadtSource,
          year: aadtYear,
          distance_mi: aadtDist,
        },
        mpds: MPDS,
        diesel: DIESEL,
        truck_share_assumed: truckShare,
      },
      competition: compSummary,
      developments: devs,
      assumptions: {
        auto_stop_rate: 0.02,
        truck_stop_rate: 0.012,
        gallons_per_stop_auto: 10.2,
        gallons_per_stop_truck: 16.0,
        cycles_per_day: 25,
      },
      rationale: lines.join("\n"),
      debug: {
        geocode: geo,
        raw_competitors: comps.slice(0, 40),
      },
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
