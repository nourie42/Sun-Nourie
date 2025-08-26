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
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(address)}` +
      `&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    res.status(r.ok ? 200 : r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- Google Places Nearby (competitors) ----------
app.get("/places", async (req, res) => {
  const { lat, lng, radius = 1609 } = req.query; // default ~1 mile
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${lat},${lng}&radius=${radius}` +
      `&type=gas_station` +
      `&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    res.status(r.ok ? 200 : r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
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
      `&radius=${radius}&language=en&region=us` +
      `&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.results) ? j.results : [];
  }

  try {
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

// ---------- AADT (NCDOT) nearest: points + lines, compute true nearest ----------
app.get("/aadt", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

  const STATIONS =
    "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0/query";
  const LINES =
    "https://services.ncdot.gov/arcgis/rest/services/Traffic_Safety/TrafficVolumeMap/MapServer/0/query";

  const SEARCH_M = 10000; // big window; we compute true nearest

  function toRad(x) { return x * Math.PI / 180; }
  function haversineMiles(aLat, aLng, bLat, bLng) {
    const R = 3958.761;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const A = Math.sin(dLat/2)**2 +
              Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(A));
  }

  async function queryLayer(url, outFields, wantGeometry = true) {
    const params = new URLSearchParams({
      f: "json",
      where: "1=1",
      outFields,
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(SEARCH_M),
      units: "esriSRUnit_Meter",
      returnGeometry: wantGeometry ? "true" : "false",
      resultRecordCount: "200"
    });
    const r = await fetch(`${url}?${params.toString()}`);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.features) ? j.features : [];
  }

  function readAADTAttrs(attrs) {
    if (!attrs) return null;
    const aadt = Number(
      attrs.AADT ?? attrs.AADT_2022 ?? attrs.AADT_2021 ?? attrs.AADT_2020 ??
      attrs.AADT2WAY ?? attrs.VOLUME ?? attrs.AADT_VALUE
    );
    const year = attrs.YEAR_ ?? attrs.AADT_YEAR ?? attrs.YEAR ?? null;
    if (!Number.isFinite(aadt) || aadt <= 0) return null;
    return { aadt, year };
  }

  try {
    // Stations (points)
    const ptFeats = await queryLayer(STATIONS, "AADT,YEAR_,OBJECTID", true);

    // Lines (segments)
    const lnFeats = await queryLayer(LINES, "*", true);

    const candidates = [];

    // Points
    for (const f of ptFeats) {
      const g = f.geometry;
      if (!g || typeof g.y !== "number" || typeof g.x !== "number") continue;
      const distMi = haversineMiles(Number(lat), Number(lng), g.y, g.x);
      const aadt = Number(f.attributes?.AADT);
      const year = f.attributes?.YEAR_;
      if (Number.isFinite(aadt) && aadt > 0) {
        candidates.push({ aadt, year, distMi, layer: "NCDOT AADT Stations" });
      }
    }

    // Lines
    for (const f of lnFeats) {
      const g = f.geometry;
      let y, x;
      if (g?.paths?.[0]?.[0]) {
        const first = g.paths[0][0];
        x = Number(first[0]); y = Number(first[1]);
      } else if (typeof g?.y === "number" && typeof g?.x === "number") {
        x = Number(g.x); y = Number(g.y);
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const distMi = haversineMiles(Number(lat), Number(lng), y, x);
      const pair = readAADTAttrs(f.attributes);
      if (pair) {
        candidates.push({ aadt: pair.aadt, year: pair.year, distMi, layer: "NCDOT Traffic Volume Map" });
      }
    }

    if (!candidates.length) {
      return res.json({ error: "No AADT found nearby", search_m: SEARCH_M });
    }

    candidates.sort((a, b) => {
      if (a.distMi !== b.distMi) return a.distMi - b.distMi;
      if ((b.year ?? 0) !== (a.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0);
      return (b.aadt ?? 0) - (a.aadt ?? 0);
    });

    const best = candidates[0];
    return res.json({
      aadt: best.aadt,
      year: best.year ?? null,
      distance_m: Math.round(best.distMi * 1609.344),
      layer: best.layer
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
