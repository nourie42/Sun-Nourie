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

/* ========== Shared Utils ========== */
const CONTACT = process.env.OVERPASS_CONTACT || "SunocoAnalyzer/2.1 (contact: you@example.com)";
const UA = "SunocoAnalyzer/2.1 (+contact: you@example.com)";
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
async function fetchWithTimeout(url, opts={}, timeoutMs=20000){
  const controller=new AbortController();
  const t=setTimeout(()=>controller.abort(), timeoutMs);
  try { return await fetch(url,{...opts,signal:controller.signal}); }
  finally { clearTimeout(t); }
}
const toMiles = (m)=> m / 1609.344;
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, t=(d)=>d*Math.PI/180;
  const dLat=t(lat2-lat1), dLon=t(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(t(lat1))*Math.cos(t(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function distMiles(lat1, lon1, lat2, lon2){ return toMiles(haversine(lat1,lon1,lat2,lon2)); }

/* ========== Nominatim ========== */
async function nominatimSearch(q, limit=8){
  const u = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&namedetails=1&limit=${limit}&countrycodes=us&q=${encodeURIComponent(q)}`;
  const r = await fetchWithTimeout(u, { headers:{ "User-Agent":UA, Accept:"application/json" } }, 12000);
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const arr = await r.json();
  // Normalize
  return arr.map(row=>{
    const a=row.address||{};
    const display = [
      row.namedetails?.name || a.house_number,
      a.road || a.pedestrian || a.residential || a.footway,
      a.city || a.town || a.village || a.hamlet || a.county,
      a.state, a.postcode
    ].filter(Boolean).join(", ") || row.display_name;
    // business hint
    const kind = (row.class==="amenity" || row.category==="amenity" || row.type==="fuel") ? "Business" : "Address";
    return { source:"nominatim", kind, display, lat:+row.lat, lon:+row.lon };
  });
}

/* ========== Overpass (robust) ========== */
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

/* Overpass: fuzzy brand/name match for amenity=fuel within radius of a center */
function buildFuelRegex(q){
  // Escape regex, but allow spaces to be ".*" to catch "Sheetz #1234"
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, ".*");
  return `(?i)${safe}`;
}
async function overpassFuelByNameNear(q, lat, lon, radiusM=30000){ // 30 km
  const regex = buildFuelRegex(q);
  const query = `
    [out:json][timeout:25];
    (
      node(around:${radiusM},${lat},${lon})["amenity"="fuel"]["name"~"${regex}"];
      way(around:${radiusM},${lat},${lon})["amenity"="fuel"]["name"~"${regex}"];
      node(around:${radiusM},${lat},${lon})["amenity"="fuel"]["brand"~"${regex}"];
      way(around:${radiusM},${lat},${lon})["amenity"="fuel"]["brand"~"${regex}"];
    );
    out center tags 25;`;
  const d = await overpassQuery(query);
  const list = [];
  for(const el of d.elements || []){
    const t = el.tags || {};
    const n = t.name || t.brand || "";
    const y = el.lat ?? el.center?.lat, x = el.lon ?? el.center?.lon;
    if (y==null || x==null) continue;
    const miles = +distMiles(lat,lon,y,x).toFixed(3);
    list.push({ source:"overpass", kind:"Business", display:n, lat:y, lon:x, miles });
  }
  // dedupe on name+coords
  const seen = new Set(); const out = [];
  for(const it of list){
    const k=`${(it.display||"").toLowerCase()}|${it.lat.toFixed(5)}|${it.lon.toFixed(5)}`;
    if(!seen.has(k)){ seen.add(k); out.push(it); }
  }
  return out.slice(0,20);
}

/* ========== /search (NEW) — hybrid autocomplete ========== */
app.get("/search", async (req, res) => {
  try{
    const q = (req.query.q || "").toString().trim();
    const lat = req.query.lat ? +req.query.lat : null;
    const lon = req.query.lon ? +req.query.lon : null;
    if (!q || q.length < 3) return res.json({ items: [] });

    // 1) Try Nominatim
    let results = [];
    try { results = await nominatimSearch(q, 8); } catch(e){ results = []; }

    // 2) If we have a center (from client map or first nominatim hit), also do Overpass fuel-by-name
    let center = (lat!=null && lon!=null) ? {lat,lon} : null;
    if (!center && results.length) center = { lat: results[0].lat, lon: results[0].lon };

    let op = [];
    if (center) {
      try { op = await overpassFuelByNameNear(q, center.lat, center.lon, 30000); } catch(e){ op = []; }
    }

    // Merge & dedupe by display+coords
    const merged = [...op, ...results];
    const seen = new Set(); const items = [];
    for(const it of merged){
      const k=`${(it.display||"").toLowerCase()}|${it.lat.toFixed(5)}|${it.lon.toFixed(5)}|${it.kind}`;
      if(!seen.has(k)){
        seen.add(k);
        items.push(it);
      }
    }
    return res.json({ items });
  }catch(e){
    return jerr(res, 500, "Search failed", String(e));
  }
});

/* ===== Everything below is your existing estimator with competition rules ===== */

/* AADT (NCDOT) */
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
  const data=await r.json();
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

/* Overpass: competition + developments */
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

/* GPT helper for developments “second opinion” & summary */
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
  const data=await JSON.parse(txt); const content=data.choices?.[0]?.message?.content;
  if(!content) throw new Error("No GPT content");
  return JSON.parse(content);
}

/* Gallons with YOUR competition rule */
function gallonsWithRules({ aadt, mpds, diesel, compCount, heavyCount }) {
  const floor = aadt * 0.02 * 8 * 30;
  // base by count
  let baseMult = 1.0;
  if (compCount >= 3) baseMult = 0.60;
  else if (compCount === 2) baseMult = 0.75;
  else baseMult = 1.00; // 0 or 1 → no change
  // heavy penalty
  let extraPenalty = 0.0;
  if (heavyCount === 1) extraPenalty = 0.20;
  else if (heavyCount >= 2) extraPenalty = 0.35;
  const compMult = Math.max(0.20, baseMult - extraPenalty);
  // simple blend
  const truckShare = 0.10;
  const autos = aadt * (1 - truckShare);
  const trucks = aadt * truckShare;
  const gpd = (autos * 0.020 * 10.2 + trucks * 0.012 * 16.0) * compMult;
  const monthly = Math.max(gpd * (365/12), floor);
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

/* ========== /estimate (unchanged behavior, but kept tidy) ========== */
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel, siteLat, siteLon } = req.body || {};
    const MPDS = Number(mpds), DIESEL = Number(diesel || 0);
    if (!Number.isFinite(MPDS) || MPDS <= 0) return jerr(res, 400, "Regular MPDs required (>0)");
    if (!address && !(Number.isFinite(siteLat) && Number.isFinite(siteLon))) return jerr(res, 400, "Address or coordinates required");

    // Resolve location
    let lat, lon, label;
    if (Number.isFinite(siteLat) && Number.isFinite(siteLon)) {
      lat = +siteLat; lon = +siteLon; label = address || `${lat}, ${lon}`;
    } else {
      const g = await geocodeNominatim(address).catch(async _=>await geocodeCensus(address));
      lat = g.lat; lon = g.lon; label = g.label;
    }

    // AADT (prefer DOT nearest)
    const sta = await queryNCDOTNearestAADT(lat, lon, 1609).catch(()=>null);
    const aadtActual = sta ? { value: sta.aadt, year: sta.year, distance_mi: +toMiles(sta.distM).toFixed(3) } : null;
    const usedAADT = aadtActual?.value ?? 10000;

    // Competition & heavy count
    let competitors = [];
    try { competitors = await competitorsWithin1Mile(lat, lon); } catch {}
    const compCount = competitors.length;
    const heavyCount = competitors.filter(c=>c.heavy).length;

    // Developments multi-source
    let devs = [];
    try { devs = await developments1Mile(lat, lon); } catch {}
    let devsAI = { items: [], confidence: 0.0 };
    try {
      const djson = await gptJSON(`List planned/proposed/permit/coming-soon/construction gas stations within ~1 mile of "${address || (lat+', '+lon)}". Return JSON only: {"items":[{"name":"<string>","status":"<string>","approx_miles":<number>}], "confidence": <0.0-1.0>}`);
      if (Array.isArray(djson.items)) devsAI = { items: djson.items.slice(0,20), confidence: +(djson.confidence ?? 0) };
    } catch {}

    // Gallons with your rule
    const calc = gallonsWithRules({ aadt: usedAADT, mpds: MPDS, diesel: DIESEL, compCount, heavyCount });

    // Human summary via GPT
    let summary = "";
    try {
      const compBrands = competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name).join(", ") || "none";
      const devTextOSM = devs.slice(0,6).map(x=>`${x.name} (${x.status}, ~${x.miles} mi)`).join("; ") || "none";
      const devTextAI  = devsAI.items.slice(0,6).map(x=>`${x.name} (${x.status||"planned"}, ~${x.approx_miles ?? "?"} mi)`).join("; ") || "none";
      const sys = `Write a detailed, numeric summary (6–10 sentences). Cover: AADT source, competition rule results (counts & heavy penalty), developments (OSM + GPT) and their impact, floor rule, capacity cap. No markdown. JSON only: {"summary":"<text>"}.`;
      const prompt = `
Address: ${address || label}
AADT used: ${usedAADT}${aadtActual ? ` (NCDOT ~${aadtActual.distance_mi} mi, year ${aadtActual.year||"n/a"})` : ""}
Competition: count=${compCount}, heavy=${heavyCount} (brands: ${compBrands})
Developments (OSM): ${devTextOSM}
Developments (GPT): ${devTextAI} (confidence ${(devsAI.confidence*100|0)}%)
Floor gallons: ${calc.floor}; Capacity cap: ${calc.cap}
Final gallons: base ${calc.base}, low ${calc.low}, high ${calc.high}, Y2 ${calc.year2}, Y3 ${calc.year3}
      `.trim();
      const s = await gptJSON(`${sys}\n${prompt}`);
      summary = s.summary || "";
    } catch {}

    const nearest = competitors[0]?.miles ?? null;
    const rationale = `Competition rule applied → count=${compCount}, heavy=${heavyCount}, multiplier ${(calc.compMult*100|0)}%. Floor=${calc.floor.toLocaleString()} gal/mo. Cap=${calc.cap.toLocaleString()} gal/mo.`;

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
      map: { site:{lat, lon, label}, competitors }
    });
  } catch (e) {
    return jerr(res, 500, "Estimate failed", String(e));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server listening on :${PORT}`));
