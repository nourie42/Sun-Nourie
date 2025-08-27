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

// ---------- utils ----------
const CONTACT = process.env.OVERPASS_CONTACT || "FuelEstimator/2.0 (contact: you@example.com)";
const UA = "FuelEstimator/2.0 (+contact: you@example.com)";
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const toMiles = (m)=> m / 1609.344;
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, t=(d)=>d*Math.PI/180;
  const dLat=t(lat2-lat1), dLon=t(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(t(lat1))*Math.cos(t(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function distMiles(lat1,lon1,lat2,lon2){ return toMiles(haversine(lat1,lon1,lat2,lon2)); }
async function fetchWithTimeout(url, opts={}, timeoutMs=20000){
  const controller=new AbortController();
  const t=setTimeout(()=>controller.abort(), timeoutMs);
  try { return await fetch(url,{...opts,signal:controller.signal}); }
  finally { clearTimeout(t); }
}
const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));

// ---------------- Geocoding (addr | lat,lon | fallback) ----------------
function tryParseLatLng(address){
  const m=String(address||"").trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(!m) return null;
  const lat=Number(m[1]), lon=Number(m[2]);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) return null;
  return { lat, lon, label:`${lat}, ${lon}` };
}
async function geocodeNominatim(q){
  const url=`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json" }},12000);
  if(!r.ok) throw new Error(`Nominatim ${r.status}`);
  const a=JSON.parse(await r.text());
  if(!a?.length) throw new Error("Nominatim: no result");
  return { lat:Number(a[0].lat), lon:Number(a[0].lon), label:a[0].display_name };
}
async function geocodeCensus(q){
  const url=`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
  const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json" }},12000);
  if(!r.ok) throw new Error(`Census ${r.status}`);
  const d=JSON.parse(await r.text());
  const m=d?.result?.addressMatches?.[0];
  if(!m?.coordinates) throw new Error("Census: no match");
  return { lat:Number(m.coordinates.y), lon:Number(m.coordinates.x), label:m.matchedAddress||q };
}
async function geocode(address){
  const direct=tryParseLatLng(address);
  if(direct) return direct;
  try { return await geocodeNominatim(address); }
  catch(e1){ try { return await geocodeCensus(address); } catch(e2){ throw e2; } }
}

// ---------------- NCDOT AADT ----------------
const NCDOT_AADT_FS = "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0";
async function queryNCDOTNearestAADT(lat, lon, radiusMeters=1609){
  const params=new URLSearchParams({
    f:"json", where:"1=1", outFields:"*", returnGeometry:"true",
    geometry:`${lon},${lat}`, geometryType:"esriGeometryPoint", inSR:"4326",
    spatialRel:"esriSpatialRelIntersects", distance:String(radiusMeters), units:"esriSRUnit_Meter",
    outSR:"4326", resultRecordCount:"200"
  });
  const r=await fetchWithTimeout(`${NCDOT_AADT_FS}/query?${params.toString()}`,{headers:{ "User-Agent":UA, Accept:"application/json" }},15000);
  if(!r.ok) throw new Error(`NCDOT ${r.status}`);
  const data=JSON.parse(await r.text());
  const feats=data.features||[];
  function extractAADT(attrs){
    const arr=[];
    for(const [k,v] of Object.entries(attrs||{})){
      if(!String(k).toLowerCase().includes("aadt")) continue;
      const n=Number(v); if(!Number.isFinite(n)||n<=0) continue;
      let year=null; const m=k.match(/20\d{2}/); if(m) year=Number(m[0]);
      for(const yk of ["YEAR","AADT_YEAR","COUNT_YEAR","TRAFFICYEAR","YEAR_","YR","YR_"]){
        const yy=attrs[yk]; if(yy){ const mt=String(yy).match(/20\d{2}/)?.[0]; if(mt){ year=Number(mt); break; } }
      }
      arr.push({value:n,year});
    }
    if(!arr.length) return null;
    arr.sort((a,b)=>(b.year||0)-(a.year||0)||b.value-a.value);
    return arr[0];
  }
  const rows=[];
  for(const f of feats){
    const a=extractAADT(f.attributes); if(!a) continue;
    const x=f.geometry?.x??f.geometry?.longitude; const y=f.geometry?.y??f.geometry?.latitude;
    if(x==null||y==null) continue;
    rows.push({ aadt:a.value, year:a.year||null, distM:haversine(lat,lon,y,x) });
  }
  if(!rows.length) return null;
  rows.sort((A,B)=>(B.year||0)-(A.year||0)||B.aadt-A.aadt||A.distM-B.distM);
  return rows[0];
}

// ---------------- Overpass helpers ----------------
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
function bboxFromCenter(lat, lon, meters){
  const d=meters/111320;
  return { s:lat-d, n:lat+d, w:lon-d/Math.cos(lat*Math.PI/180), e:lon+d/Math.cos(lat*Math.PI/180) };
}
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
    const b=bboxFromCenter(lat,lon,r);
    const qb=`[out:json][timeout:25];(node["amenity"="fuel"](${b.s},${b.w},${b.n},${b.e});way["amenity"="fuel"](${b.s},${b.w},${b.n},${b.e}););out center tags;`;
    const d=await overpassQuery(qb);
    elements=d.elements||[];
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
  catch(_){
    const b=bboxFromCenter(lat,lon,r);
    const qb=`[out:json][timeout:25];(
      node["amenity"="fuel"]["construction"](${b.s},${b.w},${b.n},${b.e});
      way["amenity"="fuel"]["construction"](${b.s},${b.w},${b.n},${b.e});
      node["proposed:amenity"="fuel"](${b.s},${b.w},${b.n},${b.e});
      way["proposed:amenity"="fuel"](${b.s},${b.w},${b.n},${b.e});
      node["opening_date"](${b.s},${b.w},${b.n},${b.e});
      way["opening_date"](${b.s},${b.w},${b.n},${b.e});
      node["description"~"(?i)(coming soon|proposed|permit|construction|planned)"](${b.s},${b.w},${b.n},${b.e});
      way["description"~"(?i)(coming soon|proposed|permit|construction|planned)"](${b.s},${b.w},${b.n},${b.e});
    );out center tags;`;
    const d=await overpassQuery(qb); elements=d.elements||[];
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

// ---------------- Leaflet map info + GPT (summary) ----------------
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
      max_tokens:900,
      messages:[
        {role:"system", content:"You are a precise fuel volume analyst. Always return valid JSON (no markdown)."},
        {role:"user", content:prompt}
      ]
    })
  },20000);
  const txt=await r.text();
  if(!r.ok) throw new Error(`OpenAI ${r.status}: ${txt}`);
  const data=JSON.parse(txt); const content=data.choices?.[0]?.message?.content;
  if(!content) throw new Error("No GPT content");
  return JSON.parse(content);
}

function gallonsModel({ aadt, mpds, diesel=0, compImpact=0 }) {
  const floor = aadt * 0.02 * 8 * 30;           // required floor
  const compMult = Math.max(0.85, 1 - compImpact); // limit reduction to 15%
  const truckShare = 0.10;
  const autos=aadt*(1-truckShare), trucks=aadt*truckShare;
  const gpd = autos*0.02*10.2*compMult + trucks*0.012*16*compMult;
  let monthly = Math.max(gpd*(365/12), floor);
  const cap = (mpds*25*10.5 + diesel*25*16)*(365/12);
  const base=Math.round(Math.min(monthly, cap));
  return {
    base, low:Math.round(base*0.86), high:Math.round(base*1.06),
    year2:Math.round(base*1.027), year3:Math.round(base*1.027*1.0125),
    cap:Math.round(cap), floor:Math.round(floor), compMult
  };
}

// ---------------- /estimate (now accepts siteLat/siteLon) ----------------
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel, siteLat, siteLon } = req.body || {};
    const MPDS=Number(mpds), DIESEL=Number(diesel||0);
    if(!Number.isFinite(MPDS) || MPDS<=0) return jerr(res,400,"Regular MPDs required (>0)");
    if(!address && !(Number.isFinite(siteLat)&&Number.isFinite(siteLon))) return jerr(res,400,"Address or coordinates required");

    // geocode or use supplied coords from autocomplete
    let geo;
    if (Number.isFinite(siteLat) && Number.isFinite(siteLon)) {
      geo = { lat:Number(siteLat), lon:Number(siteLon), label: address || `${siteLat}, ${siteLon}` };
    } else {
      geo = await geocode(address);
    }

    // AADT (DOT best nearby or fallback midpoint by road class)
    const station = await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609).catch(()=>null);
    const actualAADT = station ? {
      value: station.aadt, year: station.year, distance_mi: +toMiles(station.distM).toFixed(3)
    } : null;

    // competition + developments
    let competitors=[], developments=[];
    try{ competitors=await competitorsWithin1Mile(geo.lat, geo.lon); }catch{}
    try{ developments=await developments1Mile(geo.lat, geo.lon); }catch{}
    const impact = (() => {
      let weighted=0, near=0;
      for(const c of competitors){
        const d=Math.max(c.miles,0.05), boost=c.heavy?1.6:1.0;
        weighted += (1/d)*boost;
        if(c.miles<=0.03) near += 0.10*boost;
      }
      return Math.min(0.6, Math.max(0, 0.02*weighted + near));
    })();

    // choose AADT (prefer DOT if present; otherwise conservative default 10,000)
    const usedAADT = actualAADT?.value ?? 10000;
    const calc = gallonsModel({ aadt: usedAADT, mpds: MPDS, diesel: DIESEL, compImpact: impact });

    // detailed GPT summary
    let summary = "";
    try {
      const devText = developments.slice(0,8).map(x=>`${x.name} (${x.status}, ~${x.miles} mi)`).join("; ") || "none found";
      const compText = competitors.slice(0,8).map(x=>`${x.name||"fuel"} ~${x.miles} mi${x.heavy?" (heavy)":""}`).join("; ") || "none";
      const sys = `Create a concise but detailed explanation (6-10 sentences) of why the monthly gallon estimates make sense. Be numeric. No markdown. Return JSON {"summary":"<paragraph>"} only.`;
      const prompt = `
Inputs:
- Address: ${address || geo.label}
- AADT used: ${usedAADT}${actualAADT ? ` (DOT ${actualAADT.value}, ~${actualAADT.distance_mi} mi)` : ""}
- Competition: ${competitors.length} in 1 mi; nearest ${competitors[0]?.miles ?? "n/a"} mi; notable ${competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name).join(", ")||"none"}
- Developments: ${devText}
- Floor rule: AADT × 2% × 8 × 30 = ${calc.floor}
- Competition impact (cap 15%): ${(impact*100).toFixed(0)}%
- Capacity cap: ${calc.cap} gal/mo
- Final base: ${calc.base} gal/mo; Low–High: ${calc.low}–${calc.high}; Y2: ${calc.year2}; Y3: ${calc.year3}
      `.trim();
      const s = await gptJSON(`${sys}\n${prompt}`);
      if (s.summary) summary = s.summary;
    } catch {}

    // response
    const nearest = competitors[0]?.miles ?? null;
    const notable = competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name);
    const rationale=`Base uses AADT ${usedAADT.toLocaleString()}; floor=${calc.floor.toLocaleString()}; competition impact ${(impact*100).toFixed(0)}% (nearest ${nearest!=null?nearest.toFixed(3)+' mi':'n/a'}${notable.length?'; notable '+notable.join(', '):''}); capacity cap applied.`;

    return res.json({
      base: calc.base, low: calc.low, high: calc.high, year2: calc.year2, year3: calc.year3,
      inputs: {
        aadt_used: usedAADT, mpds: MPDS, diesel: DIESEL, truck_share_assumed: 0.10,
        aadt_actual: actualAADT || { value:null, year:null, distance_mi:null },
      },
      competition: { count: competitors.length, nearest_mi: nearest, notable_brands: notable, impact_score: +impact.toFixed(3) },
      developments,
      rationale,
      summary,
      map: { site:{lat:geo.lat, lon:geo.lon, label: geo.label}, competitors }
    });
  } catch (e) {
    return jerr(res, 500, "Estimate failed", String(e));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server listening on :${PORT}`));
