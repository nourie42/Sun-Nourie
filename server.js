// server.js
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

/* ========== App setup ========== */
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ========== Config ========== */
const CONTACT = process.env.OVERPASS_CONTACT || "FuelEstimator/2.0 (contact: you@example.com)";
const UA = "FuelEstimator/2.0 (+contact: you@example.com)";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const STRICT_AI_DEVS = process.env.STRICT_AI_DEVS ? String(process.env.STRICT_AI_DEVS).toLowerCase() === "true" : true;

/* ========== Utils ========== */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const toMiles = (m) => m / 1609.344;
function haversine(lat1, lon1, lat2, lon2){
  const R=6371000, t=d=>d*Math.PI/180;
  const dLat=t(lat2-lat1), dLon=t(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(t(lat1))*Math.cos(t(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function distMiles(a,b,c,d){ return toMiles(haversine(a,b,c,d)); }
async function fetchWithTimeout(url, opts={}, timeoutMs=25000){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(t); }
}

/* ========== Geocoding ========== */
function tryParseLatLng(address){
  const m=String(address||"").trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(!m) return null;
  const lat=+m[1], lon=+m[2];
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) return null;
  return { lat, lon, label:`${lat}, ${lon}` };
}
async function geocodeCensus(q){
  const url=`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
  const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json" }},15000);
  if(!r.ok) throw new Error(`Census ${r.status}`);
  const d=await r.json(); const m=d?.result?.addressMatches?.[0];
  if(!m?.coordinates) throw new Error("Census: no match");
  return { lat:+m.coordinates.y, lon:+m.coordinates.x, label:m.matchedAddress||q };
}
async function geocodeNominatim(q){
  const url=`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json" }},15000);
  if(!r.ok) throw new Error(`Nominatim ${r.status}`);
  const a=await r.json(); if(!a?.length) throw new Error("Nominatim: no result");
  return { lat:+a[0].lat, lon:+a[0].lon, label:a[0].display_name };
}
async function geocode(address){
  const direct=tryParseLatLng(address);
  if(direct) return direct;
  const hasNumber=/\d/.test(address||"");
  if(hasNumber){ try{ return await geocodeCensus(address); } catch { return await geocodeNominatim(address); } }
  else{ try{ return await geocodeNominatim(address); } catch { return await geocodeCensus(address); } }
}

/* ========== AADT (DOT & custom) ========== */
const NCDOT_AADT_FS="https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0";
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
      const inKey=String(k).match(/20\d{2}/)?.[0]; if(inKey) year=+inKey;
      for(const yk of ["YEAR","AADT_YEAR","COUNT_YEAR","TRAFFICYEAR","YEAR_","YR","YR_"]){
        const yv=attrs[yk]; if(yv){ const mt=String(yv).match(/20\d{2}/)?.[0]; if(mt){ year=+mt; break; } }
      }
      return { val, year };
    }).filter(Boolean);
    if(!pairs.length) continue;
    pairs.sort((a,b)=>(b.year||0)-(a.year||0)||b.val-a.val);
    const x=f.geometry?.x??f.geometry?.longitude, y=f.geometry?.y??f.geometry?.latitude;
    if(x==null||y==null) continue;
    const distM=haversine(lat,lon,y,x);
    rows.push({ aadt:pairs[0].val, year:pairs[0].year||null, distM });
  }
  if(!rows.length) return null;
  rows.sort((A,B) => (B.year||0)-(A.year||0)||B.aadt-A.aadt||A.distM-B.distM);
  return rows[0];
}
async function queryCustomTraffic(lat, lon, address){
  const tpl=process.env.TRAFFIC_URL;
  if(!tpl) return null;
  const url=tpl.replace("{lat}",encodeURIComponent(lat)).replace("{lon}",encodeURIComponent(lon)).replace("{address}",encodeURIComponent(address||""));
  try{
    const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json" }},20000);
    const txt=await r.text(); if(!r.ok) throw new Error(`Custom traffic ${r.status}: ${txt.slice(0,200)}`);
    const j=JSON.parse(txt);
    let value=null, year=null;
    for(const k of Object.keys(j)){
      const lk=k.toLowerCase();
      if(value==null && /(aadt|volume|count)/.test(lk) && typeof j[k]==="number" && j[k]>0) value=j[k];
      if(year==null && /(year|date)/.test(lk)){ const mt=String(j[k]).match(/20\d{2}/)?.[0]; if(mt) year=+mt; }
    }
    if(value) return { aadt:value, year:year||null, distM:0, source:"custom" };
  }catch{}
  return null;
}

/* ========== Overpass (competitors, developments, roads) ========== */
const OVERPASS=[
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];
async function overpassQuery(data){
  let lastErr=new Error("no tries");
  for(const ep of OVERPASS){
    for(let i=0;i<3;i++){
      try{
        const r=await fetchWithTimeout(ep,{method:"POST",headers:{ "User-Agent":CONTACT, "Content-Type":"application/x-www-form-urlencoded", Accept:"application/json" },body:"data="+encodeURIComponent(data)},25000);
        const ct=r.headers.get("content-type")||""; const txt=await r.text();
        if(!r.ok || !ct.includes("application/json")) throw new Error(`Overpass ${r.status}: ${txt.slice(0,200)}`);
        return JSON.parse(txt);
      }catch(e){ lastErr=e; await sleep(900*(i+1)); }
    }
  }
  throw lastErr;
}
async function competitorsWithin1Mile(lat, lon){
  const r=1609;
  const q=`[out:json][timeout:25];(node(around:${r},${lat},${lon})["amenity"="fuel"];way(around:${r},${lat},${lon})["amenity"="fuel"];);out center tags;`
  let elements=[];
  try{ elements=(await overpassQuery(q)).elements||[]; }
  catch{
    const d=0.0145;
    const qb=`[out:json][timeout:25];(node["amenity"="fuel"](${lat-d},${lon-d},${lat+d},${lon+d});way["amenity"="fuel"](${lat-d},${lon-d},${lat+d},${lon+d}););out center tags;`;
    elements=(await overpassQuery(qb)).elements||[];
  }
  const heavy=/sheetz|wawa|quik.?trip|(^|\b)qt\b|racetrac|buc-?ee|costco|sam's|bj's|pilot|love's|circle k|speedway|murphy|exxon|shell|bp|chevron|marathon|7-?eleven/i;
  const list=[];
  for(const el of elements){
    const t=el.tags||{}; const name=t.brand||t.name||"";
    const latc=el.lat??el.center?.lat, lonc=el.lon??el.center?.lon;
    if(latc==null||lonc==null) continue;
    list.push({ name, lat:+latc, lon:+lonc, miles:+distMiles(lat,lon,latc,lonc).toFixed(3), heavy:heavy.test(name) });
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
  try{ elements=(await overpassQuery(q)).elements||[]; }
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
    elements=(await overpassQuery(qb)).elements||[];
  }
  const out=[];
  for(const el of elements){
    const t=el.tags||{}; const name=t.brand||t.name||"(unnamed)";
    const status=t.construction?"construction":t["proposed:amenity"]?"proposed":t.opening_date?`opening ${t.opening_date}`:t.description?t.description:"planned?";
    const latc=el.lat??el.center?.lat, lonc=el.lon??el.center?.lon;
    if(latc==null||lonc==null) continue;
    out.push({ name, status, miles:+distMiles(lat,lon,latc,lonc).toFixed(3) });
  }
  out.sort((a,b)=>a.miles-b.miles);
  const seen=new Set(), uniq=[];
  for(const d of out){ const k=`${d.name}|${Math.round(d.miles*100)}`; if(!seen.has(k)){ seen.add(k); uniq.push(d); } }
  return uniq.slice(0,20);
}
async function roadContext(lat, lon){
  const r=300;
  const q=`[out:json][timeout:25];
    (
      way(around:${r},${lat},${lon})["highway"];
      node(around:${r},${lat},${lon})["highway"="traffic_signals"];
      node(around:${r},${lat},${lon})["crossing"];
      node(around:${r},${lat},${lon})["junction"];
    ); out tags center qt;`;
  let items=[];
  try{ items=(await overpassQuery(q)).elements||[]; }
  catch{ return { summary:"no data", main:[], side:[], signals:0, intersections:0 }; }
  const ways=items.filter(e=>e.type==="way");
  const nodes=items.filter(e=>e.type==="node");
  const classify=w=>{
    const t=w.tags||{};
    return { name:t.name||t.ref||"(unnamed)", highway:t.highway||"", lanes:t.lanes?+t.lanes:null, oneway:t.oneway==="yes", maxspeed:t.maxspeed||null };
  };
  const main=ways.filter(w=>/^(motorway|trunk|primary|secondary|tertiary)$/.test(w.tags?.highway||"")).map(classify);
  const side=ways.filter(w=>/^(residential|service|unclassified)$/.test(w.tags?.highway||"")).map(classify);
  const signals=nodes.filter(n=>n.tags?.highway==="traffic_signals").length;
  const intersections=nodes.filter(n=>/(junction|crossing)/.test(n.tags?.highway||"") || n.tags?.junction).length;
  const rankOrder={motorway:6,trunk:5,primary:4,secondary:3,tertiary:2,residential:1,service:0};
  const dominant=main.slice().sort((a,b)=>(rankOrder[b.highway]||0)-(rankOrder[a.highway]||0) || (b.lanes||0)-(a.lanes||0))[0];
  const summary=dominant?`${dominant.highway}${dominant.lanes?` ${dominant.lanes} lanes`:""}${dominant.oneway?" oneway":""}${dominant.maxspeed?` @ ${dominant.maxspeed}`:""}`:"local roads";
  return { summary, main:main.slice(0,6), side:side.slice(0,6), signals, intersections };
}

/* ========== Heuristic AADT (from road type) ========== */
function parseMaxspeed(ms){ const m=String(ms||"").match(/(\d+)\s*(mph)?/i); return m?+m[1]:null; }
function heuristicAADT(roads){
  const dom=roads?.main?.[0]?.highway || roads?.side?.[0]?.highway || "";
  const lanes=roads?.main?.[0]?.lanes || roads?.side?.[0]?.lanes || 2;
  const speed=parseMaxspeed(roads?.main?.[0]?.maxspeed || roads?.side?.[0]?.maxspeed);
  let basePerDir=0;
  switch(dom){
    case "motorway": basePerDir=30000; break;
    case "trunk": basePerDir=22000; break;
    case "primary": basePerDir=14000; break;
    case "secondary": basePerDir=9000; break;
    case "tertiary": basePerDir=6000; break;
    case "residential": case "service": case "unclassified": basePerDir=1500; break;
    default: basePerDir=4000;
  }
  const lanesTotal=Math.max(1, lanes);
  const dirFactor=Math.max(1, lanesTotal/2);
  let est=basePerDir*dirFactor;
  if(speed){ if(speed>=55) est*=1.15; else if(speed<=30) est*=0.8; }
  if((roads?.signals||0)>=5) est*=0.9;
  est=Math.max(800,Math.min(120000,est));
  return Math.round(est);
}

/* ========== GPT helpers ========== */
async function gptJSON(prompt){
  if(!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const r=await fetchWithTimeout("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{ Authorization:`Bearer ${OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body:JSON.stringify({
      model:"gpt-4o-mini",
      response_format:{type:"json_object"},
      temperature:0.2,
      max_tokens:1200,
      messages:[
        {role:"system", content:"You are a precise fuel/traffic analyst. Always reply with STRICT JSON (no markdown). Use numeric reasoning and ranges."},
        {role:"user", content:prompt}
      ]
    })
  },30000);
  const txt=await r.text(); if(!r.ok) throw new Error(`OpenAI ${r.status}: ${txt}`);
  const data=JSON.parse(txt); const content=data.choices?.[0]?.message?.content;
  if(!content) throw new Error("No GPT content");
  return JSON.parse(content);
}
async function gptEstimateAADT(ctx){
  try{
    const prompt = `
Estimate AADT carefully using road class, lanes, maxspeed, signals/intersections, and network context.
Return strict JSON: {"aadt": <number>, "confidence": <0..1>, "explanation": "<<=300 chars>"}.

Context:
- Address: ${ctx.address}
- Coords: ${ctx.lat}, ${ctx.lon}
- Dominant road: ${ctx.roads.summary}; signals ${ctx.roads.signals}, intersections ${ctx.roads.intersections}
- Main roads: ${ctx.roads.main.map(r=>`${r.name||"?"} (${r.highway}${r.lanes?` ${r.lanes} lanes`:''}${r.oneway?' oneway':''}${r.maxspeed?` @ ${r.maxspeed}`:''})`).join('; ')}
- Side roads: ${ctx.roads.side.map(r=>`${r.name||"?"} (${r.highway})`).join('; ')}
- Competitors in 1 mi: ${ctx.compCount} (heavy: ${ctx.heavyCount})
- MPDs: ${ctx.mpds}${ctx.diesel? " + diesel "+ctx.diesel:""}
`.trim();
    const j=await gptJSON(prompt);
    const aadt=Math.max(0,Math.round(+j.aadt||0));
    const confidence=Math.max(0,Math.min(1,+j.confidence||0));
    return { value: aadt>0?aadt:null, confidence, note: String(j.explanation||"").slice(0,300) };
  }catch{ return { value:null, confidence:0, note:"" }; }
}

/* ========== Google Places proxy ========== */
async function googleAutocomplete(input){
  if(!GOOGLE_API_KEY) return { ok:false, status:"MISSING_KEY", error:"GOOGLE_API_KEY not set", items:[] };
  const au=`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:us&key=${GOOGLE_API_KEY}`;
  const ar=await fetchWithTimeout(au,{headers:{ "User-Agent":UA, Accept:"application/json" }},15000);
  const atxt=await ar.text(); if(!ar.ok) return { ok:false, status:`HTTP_${ar.status}`, error:atxt.slice(0,200), items:[] };
  let aj; try{ aj=JSON.parse(atxt); }catch{ return { ok:false, status:"PARSE_ERROR", error:atxt.slice(0,200), items:[] }; }
  if(aj.status!=="OK" && aj.status!=="ZERO_RESULTS") return { ok:false, status:aj.status, error:aj.error_message||"No details", items:[] };

  const preds=aj.predictions||[]; const n=Math.min(preds.length,6); const items=[];
  for(let i=0;i<n;i++){
    const pid=preds[i].place_id; if(!pid) continue;
    const du=`https://maps.googleapis.com/maps/api/place/details/json?place_id=${pid}&fields=formatted_address,geometry,name,place_id,types&key=${GOOGLE_API_KEY}`;
    try{
      const dr=await fetchWithTimeout(du,{headers:{ "User-Agent":UA, Accept:"application/json" }},15000);
      const dt=await dr.text(); if(!dr.ok) continue;
      const dj=JSON.parse(dt); if(dj.status!=="OK") continue;
      const res=dj.result; const loc=res.geometry?.location;
      if(loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)){
        items.push({ type:"Google", display: res.formatted_address || res.name || preds[i].description, lat:+loc.lat, lon:+loc.lng, place_id:res.place_id||pid, score:1.3 });
      }
    }catch{}
  }
  return { ok:true, status:"OK", items };
}
app.get("/google/status", async (_req,res)=>{
  try{ const probe=await googleAutocomplete("1600 Amphitheatre Parkway, Mountain View, CA");
    if(probe.ok) return res.json({ ok:true, status:"WORKING", items:probe.items.length });
    return res.json({ ok:false, status:probe.status||"ERROR", error:probe.error||"Unknown" });
  }catch(e){ return res.json({ ok:false, status:"EXCEPTION", error:String(e) }); }
});
app.get("/google/autocomplete", async (req,res)=>{
  try{
    const q=String(req.query.input||"").trim();
    if(!q) return res.status(400).json({ ok:false, status:"BAD_REQUEST", error:"missing input", items:[] });
    const data=await googleAutocomplete(q); return res.json(data);
  }catch(e){ return res.json({ ok:false, status:"EXCEPTION", error:String(e), items:[] }); }
});

/* ========== Gallons model with policy caps (FIXED) ========== */
function gallonsWithRules({ aadt, mpds, diesel, compCount, heavyCount }){
  // Floor based on your baseline
  const floor = aadt * 0.02 * 8 * 30; // AADT×2%×8gal×30days

  // Competition
  let baseMult=1.0; if(compCount>=3) baseMult=0.60; else if(compCount===2) baseMult=0.75;
  let extraPenalty=0.0; if(heavyCount===1) extraPenalty=0.20; else if(heavyCount>=2) extraPenalty=0.35;
  const compMult=Math.max(0.20, baseMult - extraPenalty);

  // Demand (daily→monthly) * competition
  const truckShare=0.10, autos=aadt*(1-truckShare), trucks=aadt*truckShare;
  const gpd = autos*0.020*10.2 + trucks*0.012*16.0;         // gallons per day
  const monthlyUncapped = Math.max(gpd*(365/12), floor) * compMult;

  // Equipment cap (per MPD throughput) — FIXED: include ×24 hours
  // approx 25 cars/hr × 10.5 gal × 24 hr × (365/12) ≈ 19,162 per MPD
  const capEquip = (mpds * 25 * 10.5 * 24) * (365/12) + ((diesel||0) * 25 * 16 * 24) * (365/12);

  // Policy caps: soft 22k/MPD (apply −10% queuing if demand exceeds), hard 28k/MPD
  const HARD = 28000, SOFT = 22000;
  const capHardTotal = mpds * HARD;
  const capSoftTotal = mpds * SOFT;

  let capped = Math.min(monthlyUncapped, capEquip, capHardTotal);
  if (monthlyUncapped > capSoftTotal) capped = Math.round(capped * 0.90); // −10% queue

  const base = Math.round(capped);
  return {
    base,
    low: Math.round(base * 0.86),
    high: Math.round(base * 1.06),
    year2: Math.round(base * 1.027),
    year3: Math.round(base * 1.027 * 1.0125),
    cap: Math.round(Math.min(capEquip, capHardTotal)),
    floor: Math.round(floor),
    compMult,
    caps: { soft_per_mpd: SOFT, hard_per_mpd: HARD }
  };
}

/* ========== /estimate ========== */
app.post("/estimate", async (req,res)=>{
  try{
    const { address, mpds, diesel, siteLat, siteLon, aadtOverride, advanced } = req.body||{};
    const MPDS=+mpds, DIESEL=+(diesel||0);
    if(!Number.isFinite(MPDS)||MPDS<=0) return res.status(400).json({ error:"Regular MPDs required (>0)" });
    if(!address && !(Number.isFinite(siteLat)&&Number.isFinite(siteLon))) return res.status(400).json({ error:"Address or coordinates required" });

    // Location
    let geo;
    if(Number.isFinite(siteLat)&&Number.isFinite(siteLon)) geo={ lat:+siteLat, lon:+siteLon, label: address || `${siteLat}, ${siteLon}` };
    else geo=await geocode(address);

    // Context
    const roads=await roadContext(geo.lat, geo.lon).catch(()=>({summary:"", main:[], side:[], signals:0, intersections:0}));
    const competitors=await competitorsWithin1Mile(geo.lat, geo.lon).catch(()=>[]);
    const compCount=competitors.length, heavyCount=competitors.filter(c=>c.heavy).length;
    const devs=await developments1Mile(geo.lat, geo.lon).catch(()=>[]);

    // AADT components/method
    let dotAADT=null, gptAADT=null, heurAADT=null, usedAADT=10000, method="fallback_default";
    const overrideVal=Number(aadtOverride);
    if(Number.isFinite(overrideVal) && overrideVal>0){
      usedAADT=Math.round(overrideVal); method="override";
    }else{
      let sta=await queryCustomTraffic(geo.lat, geo.lon, address).catch(()=>null);
      if(!sta) sta=await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609).catch(()=>null);
      if(sta) dotAADT={ value: sta.aadt, year: sta.year, distance_mi: sta.source==="custom"?0:+toMiles(sta.distM).toFixed(3), source: sta.source||"ncdot" };

      heurAADT = heuristicAADT(roads);
      gptAADT = await gptEstimateAADT({ address: address||geo.label, lat: geo.lat, lon: geo.lon, roads, compCount, heavyCount, mpds: MPDS, diesel: DIESEL });

      const comps=[];
      if(Number.isFinite(dotAADT?.value)){
        let w=1.0;
        if(dotAADT.distance_mi!=null && dotAADT.distance_mi>0.5) w*=0.6;
        if(heurAADT && (dotAADT.value>heurAADT*2.5 || dotAADT.value<heurAADT*0.4)) w*=0.5;
        comps.push({ v:dotAADT.value, w, label:"DOT" });
      }
      if(Number.isFinite(gptAADT?.value)) comps.push({ v:gptAADT.value, w:0.9, label:"GPT" });
      if(Number.isFinite(heurAADT)) comps.push({ v:heurAADT, w:0.7, label:"HEUR" });

      if(comps.length){
        const sumW=comps.reduce((s,c)=>s+c.w,0);
        usedAADT=Math.round(comps.reduce((s,c)=>s+c.v*c.w,0)/Math.max(0.0001,sumW));
        method="blend_"+comps.map(c=>c.label).join("+").toLowerCase();
      }
    }

    // Gallons baseline with fixed capacity math
    const calcBase=gallonsWithRules({ aadt:usedAADT, mpds:MPDS, diesel:DIESEL, compCount, heavyCount });

    // User extras (%)
    let userMult=1.0; const breakdown={};
    const extras=(advanced && Array.isArray(advanced.extra)?advanced.extra:[])
      .map(e=>({ pct:Number(e?.pct), note:String(e?.note||"").slice(0,180) }))
      .filter(e=>Number.isFinite(e.pct));
    if(extras.length){ userMult*=extras.reduce((m,e)=>m*(1+e.pct/100),1.0); breakdown.extras=extras; }

    const apply=n=>Math.round(n*userMult);
    const calc={
      base:apply(calcBase.base),
      low:apply(calcBase.low),
      high:apply(calcBase.high),
      year2:apply(calcBase.year2),
      year3:apply(calcBase.year3),
      cap:calcBase.cap,
      floor:calcBase.floor,
      compMult:calcBase.compMult,
      caps:calcBase.caps,
      user_multiplier:+userMult.toFixed(4),
      user_multiplier_breakdown:breakdown
    };

    // Developments via GPT, verified to OSM (hide unverified by default)
    let devsAI={ items:[], confidence:0.0, verified:[], unverified:[] };
    try{
      const djson=await gptJSON(`List planned/proposed/permit/coming-soon/construction gas stations within ~1 mile of "${address || geo.label}". Return {"items":[{"name":"<string>","status":"<string>","approx_miles":<number>}], "confidence": <0.0-1.0>}`);
      if(Array.isArray(djson.items)) devsAI={ items:djson.items.slice(0,20), confidence:+(djson.confidence??0), verified:[], unverified:[] };
    }catch{}
    try{
      const BRAND=/gas|fuel|station|convenience|market|mart|travel|truck|sheetz|wawa|racetrac|buc-?ee|costco|sam'?s|bj'?s|pilot|love'?s|circle\s?k|speedway|murphy|exxon|shell|bp|chevron|marathon|7-?eleven|quik.?trip|(^|\b)qt\b/i;
      const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
      const similar=(a,b)=>{a=norm(a);b=norm(b);return a&&b&&(a===b||a.includes(b)||b.includes(a));};
      const verified=[], unverified=[];
      for(const it of (devsAI.items||[])){
        const name=it.name||""; const miles=Number(it.approx_miles);
        let ok=false; if(BRAND.test(name)) ok=true;
        for(const os of devs){ if(similar(os.name,name) && (Math.abs(os.miles-(miles||os.miles))<=1.0 || os.miles<=2.0)){ ok=true; break; } }
        const item={ name, status:it.status||"planned", approx_miles:Number.isFinite(miles)?+miles:null };
        (ok?verified:unverified).push(item);
      }
      devsAI.verified=verified.slice(0,20);
      devsAI.unverified=unverified.slice(0,20);
    }catch{}
    if(STRICT_AI_DEVS && devsAI.confidence<0.6){ devsAI.items=[]; devsAI.unverified=[]; }

    // Rationale + GPT summary
    const nearest=competitors[0]?.miles??null;
    const rationale=`Method=${method}; comps=${compCount} (heavy=${heavyCount}) ⇒ compMult ${(calcBase.compMult*100|0)}%. Floor=${calcBase.floor.toLocaleString()} gal/mo. Caps: soft ${calcBase.caps.soft_per_mpd}/MPD (−10% if exceeded), hard ${calcBase.caps.hard_per_mpd}/MPD. User multiplier=${calc.user_multiplier}.`;

    let summary="";
    try{
      const devOSM=devs.slice(0,6).map(x=>`${x.name} (${x.status}, ~${x.miles} mi)`).join("; ")||"none";
      const devAI=(devsAI.verified||[]).slice(0,6).map(x=>`${x.name} (${x.status||"planned"}, ~${x.approx_miles??"?"} mi)`).join("; ")||"none";
      const brands=competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name).join(", ")||"none";
      const userAdj=Object.entries(calc.user_multiplier_breakdown||{}).map(([k,v])=>k==="extras"?`extras: ${v.map(e=>`${e.pct}% (${e.note||"no note"})`).join("; ")}`:`${k}: ×${v}`).join("; ")||"none";
      const sys=`Write 8–12 numeric sentences. Cover: AADT components & method (override or blend of DOT+GPT+Heur), road layout influence, competition rule, caps policy (22k soft with −10%, 28k hard), developments (OSM + GPT-verified), and user adjustments. Return {"summary":"<text>"}.`;
      const prompt=`
Inputs:
- Address: ${address || geo.label}
- Method: ${method} ${method==="override"?`(AADT OVERRIDE ${usedAADT})`:""}
- DOT: ${dotAADT?.value??"null"} (${dotAADT?.source||"ncdot"} ${dotAADT?.year||"n/a"}, ~${dotAADT?.distance_mi??"?"} mi)
- GPT: ${gptAADT?.value??"null"} (conf ${((gptAADT?.confidence||0)*100|0)}%; note: ${gptAADT?.note||"none"})
- Heuristic: ${heurAADT??"null"} (from ${roads.summary})
- USED AADT: ${usedAADT}
- Competition: count ${compCount}, heavy ${heavyCount}, brands ${brands}
- Roads: ${roads.summary}; signals ${roads.signals}; intersections ${roads.intersections}
- Developments OSM: ${devOSM}
- Developments GPT (verified): ${devAI}
- Floor: ${calcBase.floor}; Caps: soft ${calcBase.caps.soft_per_mpd}/MPD, hard ${calcBase.caps.hard_per_mpd}/MPD
- Baseline: base ${calcBase.base}, low ${calcBase.low}, high ${calcBase.high}
- User adjustments: ${userAdj}
- Final: base ${calc.base}, low ${calc.low}, high ${calc.high}, Y2 ${calc.year2}, Y3 ${calc.year3}
`;
      const s=await gptJSON(`${sys}\n${prompt}`); summary=s.summary||"";
    }catch{}

    return res.json({
      base:calc.base, low:calc.low, high:calc.high, year2:calc.year2, year3:calc.year3,
      inputs:{
        mpds:MPDS, diesel:DIESEL, truck_share_assumed:0.10,
        aadt_used:usedAADT,
        aadt_components:{ dot:dotAADT||null, gpt:gptAADT||null, heur:heurAADT||null, method },
        user_multiplier:calc.user_multiplier,
        user_multiplier_breakdown:calc.user_multiplier_breakdown
      },
      competition:{ count:compCount, nearest_mi:nearest, notable_brands:competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name), impact_score:+(1-calcBase.compMult).toFixed(3) },
      developments:devs,
      developments_ai:devsAI,
      roads,
      rationale,
      summary,
      map:{ site:{lat:geo.lat, lon:geo.lon, label:geo.label}, competitors }
    });
  }catch(e){
    return res.status(500).json({ error:"Estimate failed", detail:String(e) });
  }
});

/* ========== Start ========== */
const PORT=process.env.PORT||3000;
app.listen(PORT,"0.0.0.0",()=>console.log(`Server listening on :${PORT}`));
