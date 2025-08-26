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
  const { lat, lng, radius = 1609 } = req.query; // ~1 mile default
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
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&location=${lat},${lng}&radius=${radius}&language=en&region=us&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.results) ? j.results : [];
  }

  try {
    const seen = new Set(), merged = [];
    for (const q of QUERIES) {
      const out = await textSearch(q);
      for (const it of out) {
        if (!it.place_id || seen.has(it.place_id)) continue;
        seen.add(it.place_id);
        const name = (it.name || it.formatted_address || "");
        if (WANT.test(name) && !AVOID.test(name)) merged.push(it);
      }
    }
    res.json({ results: merged });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ---------- AADT (NCDOT) NEAREST: points + lines; compute true nearest ----------
app.get("/aadt", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

  // NCDOT AADT stations (points)
  const STATIONS = "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0/query";
  // NCDOT Traffic Volume Map (polylines)
  const LINES    = "https://services.ncdot.gov/arcgis/rest/services/Traffic_Safety/TrafficVolumeMap/MapServer/0/query";

  // Single generous search window; we compute the true nearest ourselves
  const SEARCH_M = 10000; // 10 km
  const OUT_PTS  = "AADT,YEAR_,OBJECTID";
  const OUT_LNS  = "*";   // field names vary

  function toRad(x){ return x*Math.PI/180; }
  function havMiles(aLat,aLng,bLat,bLng){
    const R=3958.761, dA=toRad(bLat-aLat), dO=toRad(bLng-aLng);
    const A=Math.sin(dA/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dO/2)**2;
    return 2*R*Math.asin(Math.sqrt(A));
  }

  async function query(url, outFields, withGeom=true){
    const params = new URLSearchParams({
      f:"json", where:"1=1", outFields,
      geometry:`${lng},${lat}`, geometryType:"esriGeometryPoint", inSR:"4326",
      spatialRel:"esriSpatialRelIntersects",
      distance:String(SEARCH_M), units:"esriSRUnit_Meter",
      returnGeometry: withGeom ? "true" : "false", resultRecordCount:"250"
    });
    const r = await fetch(`${url}?${params}`); if(!r.ok) return [];
    const j = await r.json(); return Array.isArray(j.features) ? j.features : [];
  }

  function readAADT(attrs){
    if(!attrs) return null;
    const aadt = Number(attrs.AADT ?? attrs.AADT_2022 ?? attrs.AADT_2021 ?? attrs.AADT_2020 ?? attrs.AADT2WAY ?? attrs.VOLUME ?? attrs.AADT_VALUE);
    const year = attrs.YEAR_ ?? attrs.AADT_YEAR ?? attrs.YEAR ?? null;
    if (!Number.isFinite(aadt) || aadt<=0) return null;
    return { aadt, year };
  }

  try {
    const pts = await query(STATIONS, OUT_PTS, true);
    const lns = await query(LINES,    OUT_LNS, true);

    const cands = [];

    // Points
    for (const f of pts) {
      const g = f.geometry;
      if (typeof g?.y !== "number" || typeof g?.x !== "number") continue; // (y=lat, x=lng)
      const distMi = havMiles(Number(lat), Number(lng), g.y, g.x);
      const aadt = Number(f.attributes?.AADT);
      const year = f.attributes?.YEAR_;
      if (Number.isFinite(aadt) && aadt>0) cands.push({ aadt, year, distMi, layer:"NCDOT AADT Stations", oid:f.attributes?.OBJECTID });
    }

    // Lines (use first 3 vertices as proxies for nearest point on segment)
    for (const f of lns) {
      const g = f.geometry;
      let samples = [];
      if (Array.isArray(g?.paths?.[0])) samples = g.paths[0].slice(0,3); // [ [x,y], [x,y], ...]
      else if (typeof g?.y === "number" && typeof g?.x === "number") samples = [[g.x,g.y]];
      let minMi = Infinity;
      for (const p of samples) {
        const x = Number(p[0]), y = Number(p[1]); // (x=lng, y=lat)
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const d = havMiles(Number(lat), Number(lng), y, x);
        if (d < minMi) minMi = d;
      }
      const pick = readAADT(f.attributes);
      if (pick && minMi<Infinity) {
        cands.push({ aadt: pick.aadt, year: pick.year, distMi: minMi, layer:"NCDOT Traffic Volume Map", oid:f.attributes?.OBJECTID });
      }
    }

    if (!cands.length) return res.json({ error:"No AADT found nearby", search_m: SEARCH_M });

    cands.sort((a,b)=>{
      if (a.distMi !== b.distMi) return a.distMi - b.distMi;
      if ((b.year??0) !== (a.year??0)) return (b.year??0) - (a.year??0);
      return (b.aadt??0) - (a.aadt??0);
    });

    const best = cands[0];
    return res.json({
      aadt: best.aadt,
      year: best.year ?? null,
      distance_m: Math.round(best.distMi * 1609.344),
      layer: best.layer,
      objectid: best.oid ?? null,
      candidates_considered: cands.length
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
