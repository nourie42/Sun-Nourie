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
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- Google Places Nearby (competitors) ----------
app.get("/places", async (req, res) => {
  const { lat, lng, radius = 1609 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=gas_station&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    res.status(r.ok ? 200 : r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- Google Places Text Search (planned developments) ----------
app.get("/developments", async (req, res) => {
  const { lat, lng, radius = 5000 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });
  try {
    const query = "planned gas station OR gas station permit OR proposed gas station OR coming soon gas station OR gas station construction";
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${lat},${lng}&radius=${radius}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    res.status(r.ok ? 200 : r.status).json(await r.json());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- AADT (NCDOT ArcGIS FeatureServer) ----------
app.get("/aadt", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

  const serviceUrl = "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0/query";
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    outFields: "AADT,YEAR_",
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: "150",
    units: "esriSRUnit_Meter",
    returnGeometry: "false",
    orderByFields: "YEAR_ DESC, AADT DESC",
    resultRecordCount: "1"
  });

  try {
    const r = await fetch(`${serviceUrl}?${params}`);
    const j = await r.json();
    const feats = Array.isArray(j.features) ? j.features : [];
    if (feats.length) {
      const attrs = feats[0].attributes || {};
      const val = Number(attrs.AADT);
      const yr  = attrs.YEAR_;
      if (isFinite(val) && val > 0) {
        return res.json({ aadt: val, year: yr, source: "NCDOT AADT Stations" });
      }
    }
    return res.json({ error: "No AADT found nearby" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));

