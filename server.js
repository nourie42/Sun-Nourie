// server.js
import express from "express";

const app = express();
app.use(express.json());

// ---------- CORS ----------
const ALLOWED_ORIGINS = new Set([
  "https://sun-nourie-v2.onrender.com",  // your static site
  "https://sun-nourie-live.onrender.com" // optional self-calls
]);
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  } else {
    res.header("Access-Control-Allow-Origin", "*");
  }
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------- Health ----------
app.get("/", (_req, res) => res.send("OK"));

// ---------- Chat (OpenAI Responses API) ----------
app.post("/chat", async (req, res) => {
  try {
    const { messages = [], system = "You are helpful." } = req.body;
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [{ role: "system", content: system }, ...messages],
        stream: false
      })
    });
    const body = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: body.error?.message || "OpenAI error" });

    const text = body.output_text ||
      (Array.isArray(body.output) ? body.output.map(o => (o.content||[]).map(p=>p.text||"").join("")).join("") : "") ||
      body.choices?.[0]?.message?.content || "[No text from model]";

    res.json({ output_text: text });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

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

// ---------- Google Places Text Search (developments) ----------
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

// ---------- AADT (ArcGIS traffic counts) ----------
app.get("/aadt", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

  const layers = [
    {
      name: "NCDOT",
      url: "https://services.ncdot.gov/arcgis/rest/services/Traffic_Safety/TrafficVolumeMap/MapServer/0/query",
      field: "AADT"
    },
    {
      name: "SCDOT",
      url: "https://scdotgis.online/arcgis/rest/services/Traffic/Traffic_Counts/MapServer/0/query",
      field: "AADT"
    },
    {
      name: "GDOT",
      url: "https://gdotapp.gdot.ga.gov/arcgis/rest/services/Traffic/TrafficCounts/MapServer/0/query",
      field: "AADT"
    }
  ];
  const SEARCH_M = 150;

  async function queryLayer(layer) {
    const params = new URLSearchParams({
      f: "json", where: "1=1", outFields: "*",
      geometry: `${lng},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
      spatialRel: "esriSpatialRelIntersects", distance: SEARCH_M, units: "esriSRUnit_Meter", returnGeometry: "false"
    });
    const r = await fetch(`${layer.url}?${params.toString()}`);
    if (!r.ok) return null;
    const j = await r.json();
    const feats = Array.isArray(j.features) ? j.features : [];
    let best = null;
    for (const f of feats) {
      const val = Number(f.attributes?.[layer.field]);
      if (isFinite(val)) {
        if (!best || val > best.aadt) best = { aadt: val, source: layer.name, distance_m: SEARCH_M };
      }
    }
    return best;
  }

  try {
    for (const layer of layers) {
      const ans = await queryLayer(layer);
      if (ans && ans.aadt) return res.json(ans);
    }
    return res.json({ aadt: null });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
