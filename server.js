// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

function jerr(res, code, msg, detail) {
  console.error("[ERROR]", code, msg, detail || "");
  return res.status(code).json({ error: msg, detail });
}
app.get("/health", (_req, res) => res.json({ ok: true }));

const UA = "SunocoAnalyzer/2.1 (+contact: you@example.com)";
const toMiles = (m)=> m / 1609.344;

/* --- geocoders --- */
function tryParseLatLng(address){
  const m=String(address||"").trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(!m) return null;
  const lat=Number(m[1]), lon=Number(m[2]);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) return null;
  return { lat, lon, label:`${lat}, ${lon}` };
}
async function geocodeNominatim(q){
  const url=`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const r=await fetch(url,{headers:{ "User-Agent":UA, Accept:"application/json" }});
  if(!r.ok) throw new Error(`Nominatim ${r.status}`);
  const a=await r.json();
  if(!a?.length) throw new Error("Nominatim: no result");
  return { lat:+a[0].lat, lon:+a[0].lon, label:a[0].display_name };
}
async function geocodeCensus(q){
  const url=`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
  const r=await fetch(url,{headers:{ "User-Agent":UA, Accept:"application/json" }});
  if(!r.ok) throw new Error(`Census ${r.status}`);
  const d=await r.json();
  const m=d?.result?.addressMatches?.[0];
  if(!m?.coordinates) throw new Error("Census: no match");
  return { lat:+m.coordinates.y, lon:+m.coordinates.x, label:m.matchedAddress||q };
}
async function geocode(address){
  const direct=tryParseLatLng(address);
  if(direct) return direct;
  const hasNumber = /\d/.test(address||"");
  if (hasNumber) {
    // Prefer Census for exact street-number matches
    try { return await geocodeCensus(address); }
    catch { return await geocodeNominatim(address); }
  } else {
    // Prefer Nominatim for general place/business names
    try { return await geocodeNominatim(address); }
    catch { return await geocodeCensus(address); }
  }
}

/* --- AADT (NCDOT) minimal for this tweak --- */
const NCDOT_AADT_FS = "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0";
async function queryNCDOTNearestAADT(lat, lon, radiusMeters=1609){
  const p=new URLSearchParams({
    f:"json", where:"1=1", outFields:"*", returnGeometry:"true",
    geometry:`${lon},${lat}`, geometryType:"esriGeometryPoint", inSR:"4326",
    spatialRel:"esriSpatialRelIntersects", distance:String(radiusMeters), units:"esriSRUnit_Meter",
    outSR:"4326", resultRecordCount:"200"
  });
  const r=await fetch(`${NCDOT_AADT_FS}/query?${p.toString()}`,{headers:{ "User-Agent":UA, Accept:"application/json" }});
  if(!r.ok) return null;
  const data=await r.json();
  const feats=data.features||[];
  const rows=[];
  for(const f of feats){
    const attrs=f.attributes||{};
    const cand = Object.keys(attrs).filter(k=>k.toLowerCase().includes("aadt"))
      .map(k=>({ val:+attrs[k], year:+(String(k).match(/20\d{2}/)?.[0]||attrs.AADT_YEAR||attrs.COUNT_YEAR||0) }))
      .filter(x=>Number.isFinite(x.val)&&x.val>0);
    if(!cand.length) continue;
    cand.sort((a,b)=>(b.year||0)-(a.year||0)||b.val-a.val);
    const x=f.geometry?.x??f.geometry?.longitude, y=f.geometry?.y??f.geometry?.latitude;
    if(x==null||y==null) continue;
    const distM = ((lat1,lon1,lat2,lon2)=>{const R=6371000, t=d=>d*Math.PI/180, dLat=t(lat2-lat1), dLon=t(lon2-lon1); const A=Math.sin(dLat/2)**2+Math.cos(t(lat1))*Math.cos(t(lat2))*Math.sin(dLon/2)**2; return 2*R*Math.asin(Math.sqrt(A));})(lat,lon,y,x);
    rows.push({ aadt:cand[0].val, year:cand[0].year||null, distM });
  }
  if(!rows.length) return null;
  rows.sort((A,B)=>(B.year||0)-(A.year||0)||B.aadt-A.aadt||A.distM-B.distM);
  return rows[0];
}

/* --- Competition & Developments (unchanged logic – keep your prior version here) --- */
// (omitted for brevity — keep whatever you already have for /estimate)

/* --- Example minimal /estimate using the improved geocoder --- */
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel, siteLat, siteLon } = req.body || {};
    const MPDS = Number(mpds), DIESEL = Number(diesel||0);
    if(!Number.isFinite(MPDS) || MPDS<=0) return jerr(res,400,"Regular MPDs required (>0)");
    if(!address && !(Number.isFinite(siteLat)&&Number.isFinite(siteLon))) return jerr(res,400,"Address or coordinates required");

    // Use precise coords if provided by the autocomplete; otherwise geocode (Census-first if number present)
    const geo = (Number.isFinite(siteLat)&&Number.isFinite(siteLon))
      ? { lat:Number(siteLat), lon:Number(siteLon), label: address || `${siteLat}, ${siteLon}` }
      : await geocode(address);

    // DOT AADT
    const sta = await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609);
    const usedAADT = sta?.aadt ?? 10000;

    // Simple demo response (keep your richer logic from earlier if needed)
    const floor = usedAADT * 0.02 * 8 * 30;
    const cap = (MPDS*25*10.5 + (DIESEL||0)*25*16) * (365/12);
    const base = Math.round(Math.min(floor, cap));

    return res.json({
      base, low:Math.round(base*0.86), high:Math.round(base*1.06),
      year2:Math.round(base*1.027), year3:Math.round(base*1.027*1.0125),
      inputs:{ aadt_used: usedAADT, mpds: MPDS, diesel: DIESEL },
      competition:{ count: 0, nearest_mi: null, notable_brands: [], impact_score: 0 },
      developments: [],
      summary: "Address resolved with Census-first geocoding for house-number accuracy; gallons use floor rule and capacity cap (demo).",
      map:{ site:{ lat: geo.lat, lon: geo.lon, label: geo.label }, competitors: [] }
    });
  } catch (e) {
    return jerr(res, 500, "Estimate failed", String(e));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server listening on :${PORT}`));
