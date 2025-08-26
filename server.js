// server.js
import express from "express";

const app = express();
app.use(express.json());

// ---------- CORS ----------
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------- Health ----------
app.get("/", (_req, res) => res.send("OK"));

// ---------- Google Geocoding ----------
app.get("/geocode", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: "Missing address" });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    res.status(r.ok ? 200 : r.status).json(await r.json());
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---------- Google Places Nearby (competitors) ----------
app.get("/places", async (req, res) => {
  const { lat, lng, radius = 1609 } = req.query; // ~1 mile by default
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=gas_station&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    res.status(r.ok ? 200 : r.status).json(await r.json());
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---------- Google Places Text Search (planned/proposed developments) ----------
app.get("/developments", async (req, res) => {
  const { lat, lng, radius = 5000 } = req.query; // meters
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

  const QUERIES = [
    "planned gas station",
    "gas station permit",
    "proposed gas station",
    "gas station construction",
    "coming soon gas station"
  ];
  const WANT = /(planned|permit|site plan|coming soon|construction|proposed)/i;
  const AVOID = /(permanently closed|closed)/i;

  async function textSearch(q) {
    const url =
      `https://maps.googleapis.com/maps/api/place/textsearch/json` +
      `?query=${encodeURIComponent(q)}&location=${lat},${lng}` +
      `&radius=${radius}&language=en&region=us&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.results) ? j.results : [];
  }

  try {
    // Run queries serially (keeps it simple wrt quota); merge by place_id
    const seen = new Set();
    const merged = [];
    for (const q of QUERIES) {
      const out = await textSearch(q);
      for (const it of out) {
        if (!it.place_id) continue;
        if (seen.has(it.place_id)) continue;
        seen.add(it.place_id);
        const name = (it.name || it.formatted_address || "");
        if (WANT.test(name) && !AVOID.test(name)) merged.push(it);
      }
    }
    res.json({ results: merged });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- AADT (NCDOT ArcGIS) with progressive radius and 2-layer fallback ----------
/*
  1) Try Stations (points) layer
  2) If none, try Traffic Volume Map (line segments) layer
  Radii escalate: 150m → 500m → 1000m
*/
app.get("/aadt", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

  // Stations (points)
  const STATIONS =
    "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0/query";

  // Traffic Volume Map (line features) — layer 0
  const LINES =
    "https://services.ncdot.gov/arcgis/rest/services/Traffic_Safety/TrafficVolumeMap/MapServer/0/query";

  // Try these radii in order
  const RADII = [150, 500, 1000];

  async function queryArcGIS(url, outFields, distM) {
    const params = new URLSearchParams({
      f: "json",
      where: "1=1",
      outFields,
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(distM),
      units: "esriSRUnit_Meter",
      returnGeometry: "false",
      orderByFields: "YEAR_ DESC, AADT DESC",
      resultRecordCount: "3"
    });
    const r = await fetch(`${url}?${params}`);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.features) ? j.features : [];
  }

  try {
    for (const d of RADII) {
      // 1) Stations: field AADT, YEAR_
      const featsPts = await queryArcGIS(STATIONS, "AADT,YEAR_", d);
      const hitPt = featsPts
        .map(f => ({ aadt: Number(f.attributes?.AADT), year: f.attributes?.YEAR_ }))
        .find(x => isFinite(x.aadt) && x.aadt > 0);
      if (hitPt) return res.json({ aadt: hitPt.aadt, year: hitPt.year, distance_m: d, source: "NCDOT AADT Stations" });

      // 2) Lines: fields vary; try AADT first; fall back to common alternates if present
      const featsLn = await queryArcGIS(LINES, "*", d);
      for (const f of featsLn) {
        const a = f.attributes || {};
        const candidate = Number(
          a.AADT ?? a.AADT_2022 ?? a.AADT_2021 ?? a.AADT_2020 ?? a.VOLUME ?? a.AADT_VALUE
        );
        const year = a.YEAR_ ?? a.AADT_YEAR ?? a.YEAR ?? null;
        if (isFinite(candidate) && candidate > 0) {
          return res.json({ aadt: candidate, year, distance_m: d, source: "NCDOT Traffic Volume Map" });
        }
      }
      // else escalate radius
    }
    return res.json({ error: "No AADT found nearby", tried_meters: RADII });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
