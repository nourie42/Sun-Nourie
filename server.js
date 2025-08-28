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
const CONTACT = process.env.OVERPASS_CONTACT || "SunocoAnalyzer/2.4 (contact: you@example.com)";
const UA = "SunocoAnalyzer/2.4 (+contact: you@example.com)";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || ""; // <— set this to enable Google checks & autocomplete
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const toMiles = (m)=> m / 1609.344;
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, t=(d)=>d*Math.PI/180;
  const dLat=t(lat2-lat1), dLon=t(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(t(lat1))*Math.cos(t(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function distMiles(lat1, lon1, lat2, lon2){ return toMiles(haversine(lat1, lon1, lat2, lon2)); }
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
  rows.sort((A,B)=>(B.year||0)-(A.year||0)||B.aadt-A.aadt||A.distM-B.DistM);
  return rows[0];
}

/* ---------- Overpass (competitors, developments, road context) ---------- */
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
async function competitorsWithin1Mile(lat, lon){
  const r=1609;
  const q=`[out:json][timeout:25];(
    node(around:${r},${lat},${lon})["amenity"="fuel"];
    way(around:${r},${lat},${lon})["amenity"="fuel"];
  );out center tags;`;
  let elements=[];
  try{
    const d=await overpassQuery(q);
    elements=d.elements||[];
  }catch{
    const d=0.0145;
    const qb=`[out:json][timeout:25];(
      node["amenity"="fuel"](${lat-d},${lon-d},${lat+d},${lon+d});
      way["amenity"="fuel"](${lat-d},${lon-d},${lat+d},${lon+d});
    );out center tags;`;
    const b=await overpassQuery(qb); elements=b.elements||[];
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
async function roadContext(lat, lon){
  const r = 300; // meters
  const q = `[out:json][timeout:25];
    (
      way(around:${r},${lat},${lon})["highway"];
      node(around:${r},${lat},${lon})["highway"="traffic_signals"];
      node(around:${r},${lat},${lon})["crossing"];
      node(around:${r},${lat},${lon})["junction"];
    ); out tags center qt;`;
  let items = [];
  try { const d = await overpassQuery(q); items = d.elements || []; } catch { return { summary:"no data", main:[], side:[], signals:0, intersections:0 }; }
  const ways = items.filter(e=>e.type==="way");
  const nodes = items.filter(e=>e.type==="node");
  const classify = w => {
    const t=w.tags||{}; return {
      name: t.name||t.ref||"(unnamed)",
      highway: t.highway||"",
      lanes: t.lanes ? +t.lanes : null,
      oneway: t.oneway==="yes",
      maxspeed: t.maxspeed||null
    };
  };
  const main = ways.filter(w=>/^(motorway|trunk|primary|secondary|tertiary)$/.test(w.tags?.highway||"")).map(classify);
  const side = ways.filter(w=>/^(residential|service|unclassified)$/.test(w.tags?.highway||"")).map(classify);
  const signals = nodes.filter(n=>n.tags?.highway==="traffic_signals").length;
  const intersections = nodes.filter(n=>/(junction|crossing)/.test(n.tags?.highway||"") || n.tags?.junction).length;
  const rankOrder = { motorway:6, trunk:5, primary:4, secondary:3, tertiary:2, residential:1, service:0 };
  let dominant = main.slice().sort((a,b)=>(rankOrder[b.highway]||0)-(rankOrder[a.highway]||0) || (b.lanes||0)-(a.lanes||0))[0];
  const summary = dominant ? `${dominant.highway}${dominant.lanes?` ${dominant.lanes} lanes`:''}${dominant.oneway?' oneway':''}${dominant.maxspeed?` @ ${dominant.maxspeed}`:''}` : "local roads";
  return { summary, main: main.slice(0,6), side: side.slice(0,6), signals, intersections };
}

/* ---------- GPT helpers ---------- */
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
      max_tokens:1200,
      messages:[
        {role:"system", content:"You are a precise fuel and traffic analyst. Always return strict JSON (no markdown). Use numeric reasoning and ranges."},
        {role:"user", content:prompt}
      ]
    })
  },30000);
  const txt=await r.text();
  if(!r.ok) throw new Error(`OpenAI ${r.status}: ${txt}`);
  const data=JSON.parse(txt); const content=data.choices?.[0]?.message?.content;
  if(!content) throw new Error("No GPT content");
  return JSON.parse(content);
}

/* ---------- Custom Traffic API (optional) ---------- */
async function queryCustomTraffic(lat, lon, address){
  const tpl = process.env.TRAFFIC_URL; // e.g. "https://example.com/aadt?lat={lat}&lon={lon}&q={address}"
  if(!tpl) return null;
  const url = tpl
    .replace("{lat}", encodeURIComponent(lat))
    .replace("{lon}", encodeURIComponent(lon))
    .replace("{address}", encodeURIComponent(address || ""));
  try{
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept:"application/json" } }, 20000);
    const txt = await r.text();
    if(!r.ok) throw new Error(`Custom traffic ${r.status}: ${txt.slice(0,200)}`);
    const j = JSON.parse(txt);
    // Try common field names
    let value = null, year = null;
    for(const k of Object.keys(j)){
      const lk = k.toLowerCase();
      if(value==null && /(aadt|volume|count)/.test(lk) && typeof j[k] === "number" && j[k] > 0) value = j[k];
      if(year==null && /(year|date)/.test(lk)) {
        const mt = String(j[k]).match(/20\d{2}/)?.[0];
        if(mt) year = +mt;
      }
    }
    if(value) return { aadt: value, year: year||null, distM: 0, source: "custom" };
  }catch(_){ /* ignore and fallback */ }
  return null;
}

/* ---------- Google API utilities + endpoints ---------- */
async function googleFindPlace(input){
  if(!GOOGLE_API_KEY) return { status:"MISSING_KEY", error_message:"GOOGLE_API_KEY not set" };
  const url=`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(input)}&inputtype=textquery&fields=formatted_address,geometry,name,place_id&key=${GOOGLE_API_KEY}`;
  const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json" }},15000);
  const txt=await r.text();
  if(!r.ok) return { status:`HTTP_${r.status}`, error_message:txt.slice(0,200) };
  try { return JSON.parse(txt); } catch { return { status:"PARSE_ERROR", error_message:txt.slice(0,200) }; }
}
app.get("/google/status", async (_req, res)=>{
  try{
    const probe = await googleFindPlace("1600 Amphitheatre Parkway, Mountain View, CA");
    if(probe.status==="OK") return res.json({ ok:true, status:probe.status, candidates: probe.candidates?.length||0 });
    return res.json({ ok:false, status:probe.status||"UNKNOWN", error:probe.error_message||"No details" });
  }catch(e){
    res.json({ ok:false, status:"EXCEPTION", error:String(e) });
  }
});
app.get("/google/places", async (req, res)=>{
  try{
    const q=String(req.query.input||"").trim();
    if(!q) return res.status(400).json({ error:"missing input" });
    const data=await googleFindPlace(q);
    if(data.status!=="OK") return res.json({ ok:false, status:data.status, error:data.error_message||"No details", items:[] });
    const items=(data.candidates||[]).map(c=>{
      const loc=c.geometry?.location;
      return (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng))
        ? { type:"Google", display:c.formatted_address || c.name, lat:+loc.lat, lon:+loc.lng, place_id:c.place_id||null, score:1.2 }
        : null;
    }).filter(Boolean);
    res.json({ ok:true, items });
  }catch(e){
    res.json({ ok:false, status:"EXCEPTION", error:String(e), items:[] });
  }
});

/* ---------- gallons model with competition rules ---------- */
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
    base, low: Math.round(base * 0.86), high: Math.round(base * 1.06),
    year2: Math.round(base * 1.027), year3: Math.round(base * 1.027 * 1.0125),
    cap: Math.round(cap), floor: Math.round(floor), compMult
  };
}

/* ---------- Advanced options multiplier ---------- */
function advancedMultiplier(adv){
  if(!adv) return { mult:1.0, breakdown:{} };
  const clamp15=(x)=>Math.max(1, Math.min(5, +x|0));
  let mult = 1.0;
  const bd = {};
  if(adv.rural_level){
    const lvl=clamp15(adv.rural_level);
    const m = {1:1.10, 2:1.05, 3:1.00, 4:0.93, 5:0.85}[lvl];
    mult *= m; bd.rural = m;
  }
  if(adv.competition_level){
    const lvl=clamp15(adv.competition_level);
    const m = {1:1.10, 2:1.05, 3:1.00, 4:0.93, 5:0.85}[lvl];
    mult *= m; bd.competition = m;
  }
  if(adv.operations_level){
    const lvl=clamp15(adv.operations_level);
    const m = {1:0.90, 2:0.95, 3:1.00, 4:1.05, 5:1.10}[lvl];
    mult *= m; bd.operations = m;
  }
  let extra=1.0;
  const extras = Array.isArray(adv.extra)||[];
  const cleanExtras = [];
  for(const e of extras){
    const pct = Number(e?.pct);
    if(!Number.isFinite(pct)) continue;
    const note = String(e?.note||"").slice(0,180);
    extra *= (1 + pct/100);
    cleanExtras.push({ pct, note });
  }
  mult *= extra;
  if(cleanExtras.length) bd.extras = cleanExtras;
  return { mult, breakdown: bd };
}

/* ---------- GPT AADT estimate ("try very hard") ---------- */
async function gptEstimateAADT(ctx){
  try{
    const prompt = `
Estimate AADT for the described site very carefully. Use U.S. norms by highway class, lanes, speed, signals density, and nearby network context. 
Return JSON: {"aadt": <number>, "confidence": <0..1>, "explanation": "<1-3 sentences>"} (no markdown).

Context:
- Address: ${ctx.address}
- Coords: ${ctx.lat}, ${ctx.lon}
- Road layout: ${ctx.roads.summary}; signals ${ctx.roads.signals}, intersections ${ctx.roads.intersections}
- Main roads: ${ctx.roads.main.map(r=>`${r.name||"?"} (${r.highway}${r.lanes?` ${r.lanes} lanes`:''})`).join('; ')}
- Side roads: ${ctx.roads.side.map(r=>`${r.name||"?"} (${r.highway})`).join('; ')}
- Competitors in 1 mi: ${ctx.compCount} (heavy: ${ctx.heavyCount})
- MPDs: ${ctx.mpds}${ctx.diesel? " + diesel "+ctx.diesel:""}
    `.trim();
    const j = await gptJSON(prompt);
    const aadt = Math.max(0, Math.round(+j.aadt||0));
    const confidence = Math.max(0, Math.min(1, +j.confidence||0));
    return { value: aadt>0 ? aadt : null, confidence, note: String(j.explanation||"").slice(0,300) };
  }catch{
    return { value: null, confidence: 0, note:"" };
  }
}

/* ---------- /estimate ---------- */
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel, siteLat, siteLon, advanced } = req.body || {};
    const MPDS = Number(mpds), DIESEL = Number(diesel||0);
    if(!Number.isFinite(MPDS) || MPDS<=0) return res.status(400).json({ error:"Regular MPDs required (>0)" });
    if(!address && !(Number.isFinite(siteLat)&&Number.isFinite(siteLon))) return res.status(400).json({ error:"Address or coordinates required" });

    // location
    let geo;
    if (Number.isFinite(siteLat) && Number.isFinite(siteLon)) {
      geo = { lat:Number(siteLat), lon:Number(siteLon), label: address || `${siteLat}, ${siteLon}` };
    } else {
      geo = await geocode(address);
    }

    // Road context + competition (needed for GPT AADT too)
    const roads = await roadContext(geo.lat, geo.lon).catch(()=>({summary:"",main:[],side:[],signals:0,intersections:0}));
    const competitors = await competitorsWithin1Mile(geo.lat, geo.lon).catch(()=>[]);
    const compCount = competitors.length;
    const heavyCount = competitors.filter(c=>c.heavy).length;

    // Developments (OSM)
    const devs = await developments1Mile(geo.lat, geo.lon).catch(()=>[]);

    // DOT/Custom AADT
    let sta = await queryCustomTraffic(geo.lat, geo.lon, address).catch(()=>null);
    if(!sta) sta = await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609).catch(()=>null);
    const dotAADT = sta ? { value: sta.aadt, year: sta.year, distance_mi: sta.source==='custom'?0:+toMiles(sta.distM).toFixed(3), source: sta.source||'ncdot' } : null;

    // GPT AADT (tries hard)
    let gptAADT = { value:null, confidence:0, note:"" };
    try{
      gptAADT = await gptEstimateAADT({
        address: address || geo.label, lat: geo.lat, lon: geo.lon,
        roads, compCount, heavyCount, mpds: MPDS, diesel: DIESEL
      });
    }catch{}

    // Required: AADT used = average of DOT and GPT (when both exist)
    const haveDot = Number.isFinite(dotAADT?.value);
    const haveGpt = Number.isFinite(gptAADT?.value);
    let usedAADT;
    if(haveDot && haveGpt) usedAADT = Math.round((dotAADT.value + gptAADT.value) / 2);
    else if(haveDot) usedAADT = dotAADT.value;
    else if(haveGpt) usedAADT = gptAADT.value;
    else usedAADT = 10000; // conservative fallback

    // Gallons (baseline, before advanced adjustments)
    const calcBase = gallonsWithRules({ aadt: usedAADT, mpds: MPDS, diesel: DIESEL, compCount, heavyCount });

    // Advanced options multiplier
    const adv = advanced && typeof advanced==="object" ? advanced : null;
    const advMul = advancedMultiplier(adv);
    const apply = (n)=> Math.round(n * advMul.mult);
    const calc = {
      base_unadjusted: calcBase.base,
      base: apply(calcBase.base),
      low: apply(calcBase.low),
      high: apply(calcBase.high),
      year2: apply(calcBase.year2),
      year3: apply(calcBase.year3),
      cap: calcBase.cap,           // cap is a capacity property; keep original for reference
      floor: calcBase.floor,
      compMult: calcBase.compMult,
      user_multiplier: +advMul.mult.toFixed(4),
      user_multiplier_breakdown: advMul.breakdown
    };

    // GPT developments (verified vs unverified against OSM)
    let devsAI = { items: [], confidence: 0.0, verified: [], unverified: [] };
    try {
      const djson = await gptJSON(
        `List planned/proposed/permit/coming-soon/construction gas stations within ~1 mile of "${address || (geo.lat+', '+geo.lon)}". Return JSON only: {"items":[{"name":"<string>","status":"<string>","approx_miles":<number>}], "confidence": <0.0-1.0>}`
      );
      if (Array.isArray(djson.items)) devsAI = { items: djson.items.slice(0,20), confidence: +(djson.confidence ?? 0), verified: [], unverified: [] };
    } catch {}
    try {
      const BRAND_HINT = /gas|fuel|station|convenience|market|mart|travel|truck|sheetz|wawa|racetrac|buc-?ee|costco|sam'?s|bj'?s|pilot|love'?s|circle\s?k|speedway|murphy|exxon|shell|bp|chevron|marathon|7-?eleven|quik.?trip|(^|\b)qt\b/i;
      const normStr=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      const similar=(a,b)=>{a=normStr(a); b=normStr(b); return (a&&b)&&(a===b||a.includes(b)||b.includes(a));};
      const verified=[], unverified=[];
      for(const it of (devsAI.items||[])){
        const name = it.name || "";
        const miles = Number(it.approx_miles);
        let ok = false;
        if(BRAND_HINT.test(name)) ok = true;
        for(const os of devs){ if(similar(os.name, name) && (Math.abs(os.miles - (miles||os.miles)) <= 1.0 || os.miles <= 2.0)){ ok=true; break; } }
        const item = { name, status: it.status||"planned", approx_miles: Number.isFinite(miles)? +miles : null };
        (ok?verified:unverified).push(item);
      }
      devsAI.verified = verified.slice(0,20);
      devsAI.unverified = unverified.slice(0,20);
    } catch {}

    const STRICT_AI = String(process.env.STRICT_AI_DEVS||'false').toLowerCase() === 'true';
    if (STRICT_AI && devsAI.confidence < 0.6) { devsAI.items = []; devsAI.unverified = []; }

    // Rationale and GPT summary (document all user changes)
    const nearest = competitors[0]?.miles ?? null;
    const rationale = `Competition rule: comps=${compCount}, heavy=${heavyCount} ⇒ multiplier ${(calcBase.compMult*100|0)}%. Floor=${calcBase.floor.toLocaleString()} gal/mo. Capacity cap=${calcBase.cap.toLocaleString()} gal/mo. User multiplier=${calc.user_multiplier}.`;

    let summary = "";
    try {
      const devTextOSM = devs.slice(0,6).map(x=>`${x.name} (${x.status}, ~${x.miles} mi)`).join("; ") || "none";
      const devTextAI  = (devsAI.verified||[]).slice(0,6).map(x=>`${x.name} (${x.status||"planned"}, ~${x.approx_miles ?? "?"} mi)`).join("; ") || "none";
      const brands = competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name).join(", ") || "none";
      const userAdjList = Object.entries(calc.user_multiplier_breakdown||{})
        .map(([k,v])=> k==="extras"
          ? `extras: ${v.map(e=>`${e.pct}% (${e.note||"no note"})`).join("; ")}`
          : `${k}: ×${v}`).join("; ") || "none";
      const sys = `Write a 8–12 sentence numeric explanation. Cover: 
- AADT components (DOT and GPT) and that the final AADT is their AVERAGE
- Competition rule (0/1=100%, 2=75%, 3+=60%; heavy −20%/−35%)
- Road layout (signals/intersections; main vs side roads)
- Developments (OSM + GPT-verified only)
- Floor gallons (AADT×2%×8×30), capacity cap
- Document ALL user-provided advanced options and extra percentages (with comments)
Return JSON: {"summary":"<text>"} (no markdown).`;
      const prompt = `
Inputs:
- Address: ${address || geo.label}
- AADT DOT: ${dotAADT?.value ?? "null"} (${dotAADT?.source||"n/a"} ${dotAADT?.year||"n/a"}, ~${dotAADT?.distance_mi ?? "?"} mi)
- AADT GPT: ${gptAADT?.value ?? "null"} (confidence ${(gptAADT.confidence*100|0)}%; note: ${gptAADT.note||"none"})
- AADT USED (AVG): ${usedAADT}
- Competition count: ${compCount}; Heavy-count: ${heavyCount}; Heavy brands near: ${brands}
- Road layout: ${roads.summary}; signals ${roads.signals}, intersections ${roads.intersections}
- Main roads: ${roads.main.map(r=>`${r.name||"?"} (${r.highway}${r.lanes?` ${r.lanes} lanes`:''})`).join('; ')}
- Side roads: ${roads.side.map(r=>`${r.name||"?"} (${r.highway})`).join('; ')}
- Developments OSM: ${devTextOSM}
- Developments GPT (verified): ${devTextAI}
- Floor gallons: ${calcBase.floor}
- Capacity cap: ${calcBase.cap}
- Baseline result (pre-user): base ${calcBase.base}, low ${calcBase.low}, high ${calcBase.high}
- User adjustments applied: ${userAdjList}
- Final result: base ${calc.base}, low ${calc.low}, high ${calc.high}, Y2 ${calc.year2}, Y3 ${calc.year3}
`;
      const s = await gptJSON(`${sys}\n${prompt}`);
      summary = s.summary || "";
    } catch {}

    return res.json({
      base: calc.base, low: calc.low, high: calc.high, year2: calc.year2, year3: calc.year3,
      inputs: {
        mpds: MPDS, diesel: DIESEL, truck_share_assumed: 0.10,
        aadt_used: usedAADT,
        aadt_components: {
          dot: dotAADT || null,
          gpt: gptAADT || null,
          method: (haveDot && haveGpt) ? "average_of_dot_and_gpt" : (haveDot ? "dot_only" : (haveGpt ? "gpt_only" : "fallback_default"))
        },
        user_multiplier: calc.user_multiplier,
        user_multiplier_breakdown: calc.user_multiplier_breakdown
      },
      competition: { count: compCount, nearest_mi: nearest, notable_brands: competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name), impact_score: +(1-calcBase.compMult).toFixed(3) },
      developments: devs,
      developments_ai: devsAI,
      roads,
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
