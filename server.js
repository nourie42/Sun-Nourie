// server.js
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/* ---------- static + root + health ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static("public"));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ---------- shared utils ---------- */
const CONTACT = process.env.OVERPASS_CONTACT || "SunocoAnalyzer/2.2 (contact: you@example.com)";
const UA = "SunocoAnalyzer/2.2 (+contact: you@example.com)";
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const toMiles = (m)=> m / 1609.344;
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, t=(d)=>d*Math.PI/180;
  const dLat=t(lat2-lat1), dLon=t(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(t(lat1))*Math.cos(t(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
async function fetchWithTimeout(url, opts={}, timeoutMs=20000){
  const controller=new AbortController();
  const t=setTimeout(()=>controller.abort(), timeoutMs);
  try { return await fetch(url,{...opts,signal:controller.signal}); }
  finally { clearTimeout(t); }
}

/* ---------- geocoding (client may pass siteLat/siteLon to skip) ---------- */
function tryParseLatLng(address){
  const m=String(address||"").trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(!m) return null;
  const lat=Number(m[1]), lon=Number(m[2]);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) return null;
  return { lat, lon, label:`${lat}, ${lon}` };
}
async function geocodeCensus(q){
  const url=`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
  const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json" }},15000);
  if(!r.ok) throw new Error(`Census ${r.status}`);
  const d=await r.json();
  const m=d?.result?.addressMatches?.[0];
  if(!m?.coordinates) throw new Error("Census: no match");
  return { lat:+m.coordinates.y, lon:+m.coordinates.x, label:m.matchedAddress||q };
}
async function geocodeNominatim(q){
  const url=`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json" }},15000);
  if(!r.ok) throw new Error(`Nominatim ${r.status}`);
  const a=await r.json();
  if(!a?.length) throw new Error("Nominatim: no result");
  return { lat:+a[0].lat, lon:+a[0].lon, label:a[0].display_name };
}
async function geocode(address){
  const direct=tryParseLatLng(address);
  if(direct) return direct;
  const hasNumber = /\d/.test(address||"");
  if (hasNumber) { try { return await geocodeCensus(address); } catch { return await geocodeNominatim(address); } }
  else { try { return await geocodeNominatim(address); } catch { return await geocodeCensus(address); } }
}

/* ---------- NCDOT AADT (nearest station) ---------- */
const NCDOT_AADT_FS = "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0";
async function queryNCDOTNearestAADT(lat, lon, radiusMeters=1609){
  const params=new URLSearchParams({
    f:"json", where:"1=1", outFields:"*", returnGeometry:"true",
    geometry:`${lon},${lat}`, geometryType:"esriGeometryPoint", inSR:"4326",
    spatialRel:"esriSpatialRelIntersects", distance:String(radiusMeters), units:"esriSRUnit_Meter",
    outSR:"4326", resultRecordCount:"200"
  });
  const r=await fetchWithTimeout(`${NCDOT_AADT_FS}/query?${params.toString()}`,{headers:{ "User-Agent":UA, Accept:"application/json" }},20000);
  if(!r.ok) return null;
  const data=await r.json();
  const feats=data.features||[];
  const rows=[];
  for(const f of feats){
    const attrs=f.attributes||{};
    const pairs=Object.keys(attrs).filter(k=>k.toLowerCase().includes("aadt")).map(k=>{
      const val=+attrs[k]; if(!(val>0)) return null;
      let year=null;
      const inKey=String(k).match(/20\d{2}/)?.[0];
      if(inKey) year=+inKey;
      for(const yk of ["YEAR","AADT_YEAR","COUNT_YEAR","TRAFFICYEAR","YEAR_","YR","YR_"]){
        const yv=attrs[yk]; if(yv){ const mt=String(yv).match(/20\d{2}/)?.[0]; if(mt){ year=+mt; break; } }
      }
      return { val, year };
    }).filter(Boolean);
    if(!pairs.length) continue;
    pairs.sort((a,b)=>(b.year||0)-(a.year||0)||b.val-a.val);
    const x=f.geometry?.x??f.geometry?.longitude, y=f.geometry?.y??f.geometry?.latitude;
    if(x==null||y==null) continue;
    const distM = haversine(lat,lon,y,x);
    rows.push({ aadt:pairs[0].val, year:pairs[0].year||null, distM });
  }
  if(!rows.length) return null;
  rows.sort((A,B)=>(B.year||0)-(A.year||0)||B.aadt-A.aadt||A.distM-B.distM);
  return rows[0];
}

/* ---------- Overpass (competitors & developments) ---------- */
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter"
];
async function overpassQuery(data){
  let lastErr=new Error("no tries");
  for(const ep of OVERPASS){
    for(let i=0;i<3;i++){
      try{
        const r=await fetchWithTimeout(ep,{
          method:"POST",
          headers:{ "User-Agent":CONTACT, "Content-Type":"application/x-www-form-urlencoded", Accept:"application/json" },
          body:"data="+encodeURIComponent(data)
        },25000);
        const ct=r.headers.get("content-type")||"";
        const text=await r.text();
        if(!r.ok || !ct.includes("application/json")) throw new Error(`Overpass ${r.status}: ${text.slice(0,200)}`);
        return JSON.parse(text);
      }catch(e){ lastErr=e; await sleep(900*(i+1)); }
    }
  }
  throw lastErr;
}
function distMiles(lat1, lon1, lat2, lon2){ return toMiles(haversine(lat1, lon1, lat2, lon2)); }

async function competitorsWithin1Mile(lat, lon){
  const r=1609;
  const q1=`[out:json][timeout:25];node(around:${r},${lat},${lon})["amenity"="fuel"];out center tags;`;
  const q2=`[out:json][timeout:25];way(around:${r},${lat},${lon})["amenity"="fuel"];out center tags;`;
  let elements=[];
  try{
    const n=await overpassQuery(q1);
    const w=await overpassQuery(q2);
    elements=[...(n.elements||[]), ...(w.elements||[])];
  }catch(_){
    const d=0.0145;
    const qb=`[out:json][timeout:25];(node["amenity"="fuel"](${lat-d},${lon-d},${lat+d},${lon+d});way["amenity"="fuel"](${lat-d},${lon-d},${lat+d},${lon+d}););out center tags;`;
    const b=await overpassQuery(qb);
    elements=b.elements||[];
  }
  const heavy=/sheetz|wawa|quik.?trip|(^|\b)qt\b|racetrac|buc-?ee|costco|sam's|bj's|pilot|love's|circle k|speedway|murphy|exxon|shell|bp|chevron|marathon|7-?eleven/i;
  const list=[];
  for(const el of elements){
    const t=el.tags||{}; const name=t.brand||t.name||"";
    const latc=el.lat??el.center?.lat; const lonc=el.lon??el.center?.lon;
    if(latc==null||lonc==null) continue;
    list.push({ name, lat:latc, lon:lonc, miles:+distMiles(lat,lon,latc,lonc).toFixed(3), heavy:heavy.test(name) });
  }
  list.sort((a,b)=>a.miles-b.miles);
  return list;
}
async function developments1Mile(lat, lon){
  const r=1609;
  const q=`[out:json][timeout:25];(
    node(around:${r},${lat},${lon})["amenity"="fuel"]["construction"];
    way(around:${r},${lat},${lon})["amenity"="fuel"]["construction"];
    node(around:${r},${lat},${lon})["proposed:amenity"="fuel"];
    way(around:${r},${lat},${lon})["proposed:amenity"="fuel"];
    node(around:${r},${lat},${lon})["opening_date"];
    way(around:${r},${lat},${lon})["opening_date"];
    node(around:${r},${lat},${lon})["description"~"(?i)(coming soon|proposed|permit|construction|planned)"];
    way(around:${r},${lat},${lon})["description"~"(?i)(coming soon|proposed|permit|construction|planned)"];
  );out center tags;`;
  let elements=[];
  try{ const d=await overpassQuery(q); elements=d.elements||[]; }
  catch{
    const d=0.0145;
    const qb=`[out:json][timeout:25];(
      node["amenity"="fuel"]["construction"](${lat-d},${lon-d},${lat+d},${lon+d});
      way["amenity"="fuel"]["construction"](${lat-d},${lon-d},${lat+d},${lon+d});
      node["proposed:amenity"="fuel"](${lat-d},${lon-d},${lat+d},${lon+d});
      way["proposed:amenity"="fuel"](${lat-d},${lon-d},${lat+d},${lon+d});
      node["opening_date"](${lat-d},${lon-d},${lat+d},${lon+d});
      way["opening_date"](${lat-d},${lon-d},${lat+d},${lon+d});
      node["description"~"(?i)(coming soon|proposed|permit|construction|planned)"](${lat-d},${lon-d},${lat+d},${lon+d});
      way["description"~"(?i)(coming soon|proposed|permit|construction|planned)"](${lat-d},${lon-d},${lat+d},${lon+d});
    );out center tags;`;
    const b=await overpassQuery(qb); elements=b.elements||[];
  }
  const out=[];
  for(const el of elements){
    const t=el.tags||{}; const name=t.brand||t.name||"(unnamed)";
    const status = t.construction ? "construction" :
                   t["proposed:amenity"] ? "proposed" :
                   t.opening_date ? `opening ${t.opening_date}` :
                   t.description ? t.description : "planned?";
    const latc=el.lat??el.center?.lat; const lonc=el.lon??el.center?.lon;
    if(latc==null||lonc==null) continue;
    out.push({ name, status, miles:+distMiles(lat,lon,latc,lonc).toFixed(3) });
  }
  out.sort((a,b)=>a.miles-b.miles);
  const seen=new Set(), uniq=[];
  for(const d of out){ const k=`${d.name}|${Math.round(d.miles*100)}`; if(!seen.has(k)){ seen.add(k); uniq.push(d); } }
  return uniq.slice(0,20);
}

/* ---------- GPT helpers (desk research & summary) ---------- */
async function gptJSON(prompt){
  const OPENAI_API_KEY=process.env.OPENAI_API_KEY;
  if(!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const r=await fetchWithTimeout("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{ Authorization:`Bearer ${OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body:JSON.stringify({
      model:"gpt-4o-mini",
      response_format:{type:"json_object"},
      temperature:0.2,
      max_tokens:1000,
      messages:[
        {role:"system", content:"You are a precise fuel volume analyst. Always return valid JSON (no markdown)."},
        {role:"user", content:prompt}
      ]
    })
  },25000);
  const txt=await r.text();
  if(!r.ok) throw new Error(`OpenAI ${r.status}: ${txt}`);
  const data=JSON.parse(txt); const content=data.choices?.[0]?.message?.content;
  if(!content) throw new Error("No GPT content");
  return JSON.parse(content);
}

/* ---------- gallons model with YOUR competition rules ---------- */
function gallonsWithRules({ aadt, mpds, diesel, compCount, heavyCount }) {
  // Floor
  const floor = aadt * 0.02 * 8 * 30;

  // Base by competitor count
  let baseMult = 1.0;
  if (compCount >= 3) baseMult = 0.60;
  else if (compCount === 2) baseMult = 0.75; // 2 → 75%
  else baseMult = 1.00;                      // 0–1 → 100%

  // Heavy penalty
  let extraPenalty = 0.0;
  if (heavyCount === 1) extraPenalty = 0.20;
  else if (heavyCount >= 2) extraPenalty = 0.35;

  const compMult = Math.max(0.20, baseMult - extraPenalty); // never below 20%

  // Blend
  const truckShare = 0.10;
  const autos = aadt * (1 - truckShare);
  const trucks = aadt * truckShare;
  const gpd = (autos * 0.020 * 10.2 + trucks * 0.012 * 16.0) * compMult;
  const monthly = Math.max(gpd * (365/12), floor);

  // Capacity cap
  const cap = (mpds * 25 * 10.5 + (diesel||0) * 25 * 16) * (365/12);
  const base = Math.round(Math.min(monthly, cap));
  return {
    base,
    low: Math.round(base * 0.86),
    high: Math.round(base * 1.06),
    year2: Math.round(base * 1.027),
    year3: Math.round(base * 1.027 * 1.0125),
    cap: Math.round(cap),
    floor: Math.round(floor),
    compMult
  };
}

/* ---------- /estimate ---------- */
app.post("/estimate", async (req, res) => {
  console.log("[/estimate] body =", req.body);
  try {
    const { address, mpds, diesel, siteLat, siteLon } = req.body || {};
    const MPDS = Number(mpds), DIESEL = Number(diesel||0);
    if(!Number.isFinite(MPDS) || MPDS<=0) return res.status(400).json({ error:"Regular MPDs required (>0)" });
    if(!address && !(Number.isFinite(siteLat)&&Number.isFinite(siteLon))) return res.status(400).json({ error:"Address or coordinates required" });

    // location: prefer exact coords from client selection, else geocode
    let geo;
    if (Number.isFinite(siteLat) && Number.isFinite(siteLon)) {
      geo = { lat:Number(siteLat), lon:Number(siteLon), label: address || `${siteLat}, ${siteLon}` };
    } else {
      geo = await geocode(address);
    }

    // AADT (NCDOT nearest)
    const sta = await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609).catch(()=>null);
    const aadtActual = sta ? { value: sta.aadt, year: sta.year, distance_mi: +toMiles(sta.distM).toFixed(3) } : null;
    const usedAADT = aadtActual?.value ?? 10000;

    // Competition & heavy count
    let competitors = [];
    try { competitors = await competitorsWithin1Mile(geo.lat, geo.lon); } catch {}
    const compCount = competitors.length;
    const heavyCount = competitors.filter(c=>c.heavy).length;

    // Developments (OSM + GPT desk research)
    let devs = [];
    try { devs = await developments1Mile(geo.lat, geo.lon); } catch {}
    let devsAI = { items: [], confidence: 0.0 };
    try {
      const djson = await gptJSON(`List planned/proposed/permit/coming-soon/construction gas stations within ~1 mile of "${address || (geo.lat+', '+geo.lon)}". Return JSON only: {"items":[{"name":"<string>","status":"<string>","approx_miles":<number>}], "confidence": <0.0-1.0>}`);
      if (Array.isArray(djson.items)) devsAI = { items: djson.items.slice(0,20), confidence: +(djson.confidence ?? 0) };
    } catch {}

    // Gallons
    const calc = gallonsWithRules({ aadt: usedAADT, mpds: MPDS, diesel: DIESEL, compCount, heavyCount });

    // GPT detailed summary
    let summary = "";
    try {
      const devTextOSM = devs.slice(0,6).map(x=>`${x.name} (${x.status}, ~${x.miles} mi)`).join("; ") || "none";
      const devTextAI  = devsAI.items.slice(0,6).map(x=>`${x.name} (${x.status||"planned"}, ~${x.approx_miles ?? "?"} mi)`).join("; ") || "none";
      const brands = competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name).join(", ") || "none";
      const sys = `Write a detailed 6–10 sentence explanation of the estimate. Be numeric. Cover: AADT source, the competition rule (0/1 no change; 2→75%; 3+→60%; heavy −20%/−35%), any developments (OSM + GPT), the floor (AADT×2%×8×30), and capacity cap. JSON: {"summary":"<text>"}.`;
      const prompt = `
Inputs:
- Address: ${address || geo.label}
- AADT used: ${usedAADT}${aadtActual ? ` (NCDOT ~${aadtActual.distance_mi} mi, year ${aadtActual.year||"n/a"})` : ""}
- Competition count: ${compCount}; Heavy-count: ${heavyCount}
- Heavy brands near: ${brands}
- Developments OSM: ${devTextOSM}
- Developments GPT: ${devTextAI} (confidence ${(devsAI.confidence*100|0)}%)
- Floor gallons: ${calc.floor}
- Capacity cap: ${calc.cap}
- Result: base ${calc.base}, low ${calc.low}, high ${calc.high}, Y2 ${calc.year2}, Y3 ${calc.year3}
      `;
      const s = await gptJSON(`${sys}\n${prompt}`);
      summary = s.summary || "";
    } catch {}

    const nearest = competitors[0]?.miles ?? null;
    const rationale = `Applied competition rule: comps=${compCount}, heavy=${heavyCount} ⇒ multiplier ${(calc.compMult*100|0)}%. Floor=${calc.floor.toLocaleString()} gal/mo. Capacity cap=${calc.cap.toLocaleString()} gal/mo.`;

    return res.json({
      base: calc.base, low: calc.low, high: calc.high, year2: calc.year2, year3: calc.year3,
      inputs: {
        aadt_used: usedAADT, mpds: MPDS, diesel: DIESEL, truck_share_assumed: 0.10,
        aadt_actual: aadtActual || { value:null, year:null, distance_mi:null }
      },
      competition: { count: compCount, nearest_mi: nearest, notable_brands: competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name), impact_score: +(1-calc.compMult).toFixed(3) },
      developments: devs,
      developments_ai: devsAI,
      rationale,
      summary,
      map: { site:{lat:geo.lat, lon:geo.lon, label: geo.label}, competitors }
    });
  } catch (e) {
    return res.status(500).json({ error:"Estimate failed", detail:String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server listening on :${PORT}`));

