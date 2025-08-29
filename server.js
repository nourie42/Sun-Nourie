// Fuel IQ API v2025-08-29t — fast address, 5+ competitor rule, auto low-rating, cleaner breakdown, stronger dev search
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// always serve fresh UI
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false, lastModified: false, cacheControl: true, maxAge: 0,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store")
  })
);
app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ───────────────── config ───────────────── */
const UA = "FuelEstimator/3.5 (+your-app)";
const CONTACT = process.env.OVERPASS_CONTACT || UA;

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY  || "";

const BING_NEWS_KEY   = process.env.BING_NEWS_KEY   || "";
const BING_NEWS_ENDPOINT = process.env.BING_NEWS_ENDPOINT || "https://api.bing.microsoft.com/v7.0/news/search";
const BING_WEB_ENDPOINT  = process.env.BING_WEB_ENDPOINT  || "https://api.bing.microsoft.com/v7.0/search";

const NEWS_URLS = (process.env.NEWS_URLS || "").split(",").map(s=>s.trim()).filter(Boolean);
const PERMIT_URLS = (process.env.PERMIT_URLS || "").split(",").map(s=>s.trim()).filter(Boolean);
const PERMIT_HTML_URLS = (process.env.PERMIT_HTML_URLS || "").split(",").map(s=>s.trim()).filter(Boolean);

const TRAFFIC_URL = process.env.TRAFFIC_URL || "";

/* ───────────────── utils ───────────────── */
const sleep = (ms) => new Promise(r=>setTimeout(r,ms));
const toMiles = (m) => m / 1609.344;
function haversine(lat1, lon1, lat2, lon2) {
  const R=6371000, t=(d)=>d*Math.PI/180;
  const dLat=t(lat2-lat1), dLon=t(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(t(lat1))*Math.cos(t(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function distMiles(a,b,c,d){ return toMiles(haversine(a,b,c,d)); }
async function fetchWithTimeout(url, opts={}, timeoutMs=45000){
  const ctl = new AbortController(); const id=setTimeout(()=>ctl.abort(), timeoutMs);
  try{ return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally{ clearTimeout(id); }
}

/* ───────────────── geocoding ───────────────── */
function tryParseLatLng(address){
  const m = String(address||"").trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(!m) return null; const lat=+m[1], lon=+m[2];
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) return null;
  return { lat, lon, label: `${lat}, ${lon}` };
}
async function geocodeCensus(q){
  const url=`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
  const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json"}},15000);
  if(!r.ok) throw new Error(`Census ${r.status}`);
  const d=await r.json(); const m=d?.result?.addressMatches?.[0];
  if(!m?.coordinates) throw new Error("Census: no match");
  return { lat:+m.coordinates.y, lon:+m.coordinates.x, label:m.matchedAddress||q };
}
async function geocodeNominatim(q){
  const url=`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json"}},15000);
  if(!r.ok) throw new Error(`Nominatim ${r.status}`);
  const a=await r.json(); if(!a?.length) throw new Error("Nominatim: no result");
  return { lat:+a[0].lat, lon:+a[0].lon, label:a[0].display_name };
}
async function reverseAdmin(lat, lon){
  try{
    const url=`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&addressdetails=1&lat=${lat}&lon=${lon}`;
    const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json"}},15000);
    const j=await r.json(); const a=j?.address||{};
    return { city: a.city||a.town||a.village||a.hamlet||"", county:a.county||"", state:a.state||a.region||"" };
  }catch{ return { city:"", county:"", state:"" }; }
}
async function geocode(address){
  const direct=tryParseLatLng(address); if(direct) return direct;
  const hasNum=/\d/.test(address||"");
  if(hasNum){ try{ return await geocodeCensus(address); } catch { return await geocodeNominatim(address); } }
  else      { try{ return await geocodeNominatim(address); } catch { return await geocodeCensus(address); } }
}

/* ───────────────── AADT ───────────────── */
const NCDOT_AADT_FS="https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0";
async function queryNCDOTNearestAADT(lat,lon,rM=1609){
  const p=new URLSearchParams({
    f:"json", where:"1=1", outFields:"*", returnGeometry:"true",
    geometry:`${lon},${lat}`, geometryType:"esriGeometryPoint", inSR:"4326",
    spatialRel:"esriSpatialRelIntersects", distance:String(rM), units:"esriSRUnit_Meter",
    outSR:"4326", resultRecordCount:"200"
  });
  const r=await fetchWithTimeout(`${NCDOT_AADT_FS}/query?${p}`,{headers:{ "User-Agent":UA, Accept:"application/json"}},30000);
  if(!r.ok) return null;
  const data=await r.json(); const feats=data.features||[];
  const rows=[];
  for(const f of feats){
    const A=f.attributes||{};
    const pairs=Object.keys(A).filter(k=>k.toLowerCase().includes("aadt")).map(k=>{
      const val=+A[k]; if(!(val>0)) return null;
      let year=null; const mt=String(k).match(/20\d{2}/)?.[0]; if(mt) year=+mt;
      for(const yk of ["YEAR","AADT_YEAR","COUNT_YEAR","TRAFFICYEAR","YEAR_","YR","YR_"]){
        const yv=A[yk]; if(yv){ const mty=String(yv).match(/20\d{2}/)?.[0]; if(mty){ year=+mty; break; } }
      }
      return { val, year };
    }).filter(Boolean);
    if(!pairs.length) continue; pairs.sort((a,b)=>(b.year||0)-(a.year||0)||b.val-a.val);
    const x=f.geometry?.x, y=f.geometry?.y; if(x==null||y==null) continue;
    rows.push({ aadt:pairs[0].val, year:pairs[0].year||null, distM:haversine(lat,lon,y,x) });
  }
  if(!rows.length) return null;
  rows.sort((A,B)=>(B.year||0)-(A.year||0)||B.aadt-A.aadt||A.distM-B.distM);
  return rows[0];
}
async function queryCustomTraffic(lat,lon,address){
  if(!TRAFFIC_URL) return null;
  const url=TRAFFIC_URL.replace("{lat}",encodeURIComponent(lat)).replace("{lon}",encodeURIComponent(lon)).replace("{address}",encodeURIComponent(address||""));
  try{
    const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json"}},20000);
    const j=await r.json(); const aadt=+j.aadt||+j.volume||+j.count; const year=j.year?+String(j.year).match(/20\d{2}/)?.[0]:null;
    if(aadt>0) return { aadt, year, distM:0, source:"custom" };
  }catch{}
  return null;
}

/* ───────────────── competition ───────────────── */
const OVERPASS=[
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];
async function overpassQuery(data){
  let last=new Error("no tries");
  for(const ep of OVERPASS){
    for(let i=0;i<3;i++){
      try{
        const r=await fetchWithTimeout(ep,{method:"POST",headers:{ "User-Agent":CONTACT,"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},body:"data="+encodeURIComponent(data)},35000);
        const ct=r.headers.get("content-type")||""; const txt=await r.text();
        if(!r.ok || !ct.includes("application/json")) throw new Error(`Overpass ${r.status}: ${txt.slice(0,200)}`);
        return JSON.parse(txt);
      }catch(e){ last=e; await sleep(900*(i+1)); }
    }
  }
  throw last;
}
const HEAVY_BRANDS=/(sheetz|wawa|race\s?trac|racetrac|buc-?ee'?s|royal\s?farms|quik.?trip|\bqt\b)/i;
const IS_SUNOCO=/\bsunoco\b/i;

async function googleNearbyGasStations(lat,lon,rM=2414){
  if(!GOOGLE_API_KEY) return [];
  const base=`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=${rM}&type=gas_station&key=${GOOGLE_API_KEY}`;
  const out=[]; let url=base; let tries=0;
  while(url && tries<3){
    tries++;
    const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"application/json"}},20000);
    const txt=await r.text(); if(!r.ok) break; let j; try{ j=JSON.parse(txt);}catch{break;}
    const items=j.results||[];
    for(const it of items){
      const name=it.name||"Fuel", latc=it.geometry?.location?.lat, lonc=it.geometry?.location?.lng;
      if(!Number.isFinite(latc)||!Number.isFinite(lonc)) continue;
      out.push({ name, lat:+latc, lon:+lonc, miles:+distMiles(lat,lon,latc,lonc).toFixed(3), heavy:HEAVY_BRANDS.test(name), sunoco: IS_SUNOCO.test(name) });
    }
    if(j.next_page_token){ await sleep(1700); url=`${base}&pagetoken=${j.next_page_token}`; } else url=null;
  }
  return out;
}
async function competitorsWithinRadiusMiles(lat,lon,rMi=1.5){
  const rM=Math.round(rMi*1609.344);
  const q=`[out:json][timeout:25];
    ( node(around:${rM},${lat},${lon})["amenity"="fuel"];
      way(around:${rM},${lat},${lon})["amenity"="fuel"]; );
    out center tags;`;
  const [op,g]=await Promise.all([
    overpassQuery(q).then(j=>j.elements||[]).catch(()=>[]),
    googleNearbyGasStations(lat,lon,rM).catch(()=>[])
  ]);

  const opList=op.map(el=>{
    const t=el.tags||{}; const name=t.brand||t.name||"Fuel";
    const latc=el.lat ?? el.center?.lat, lonc=el.lon ?? el.center?.lon;
    if(latc==null||lonc==null) return null;
    return { name, lat:+latc, lon:+lonc, miles:+distMiles(lat,lon,latc,lonc).toFixed(3), heavy:HEAVY_BRANDS.test(name), sunoco: IS_SUNOCO.test(name) };
  }).filter(Boolean);

  const merged=[...opList,...g];
  const seen=new Set(), out=[];
  for(const s of merged){
    const k=`${Math.round(s.lat*1e5)}|${Math.round(s.lon*1e5)}`;
    if(seen.has(k)) continue; seen.add(k); out.push(s);
  }
  out.sort((a,b)=>a.miles-b.miles);
  return out.filter(s=>s.miles<=rMi);
}

/* ───────────────── developments ───────────────── */
async function overpassDevelopments(lat,lon){
  const rM=Math.round(5*1609.344);
  const q=`[out:json][timeout:25];
    ( node(around:${rM},${lat},${lon})["amenity"="fuel"]["proposed"];
      way(around:${rM},${lat},${lon})["amenity"="fuel"]["proposed"];
      node(around:${rM},${lat},${lon})["amenity"="fuel"]["construction"];
      way(around:${rM},${lat},${lon})["amenity"="fuel"]["construction"]; );
    out center tags;`;
  try{
    const j=await overpassQuery(q); const els=j.elements||[];
    return els.map(e=>{
      const t=e.tags||{}; const n=t.name||t.brand||"Fuel (proposed/construction)";
      const latc=e.lat ?? e.center?.lat, lonc=e.lon ?? e.center?.lon;
      const miles=(Number.isFinite(latc)&&Number.isFinite(lonc))?+distMiles(lat,lon,latc,lonc).toFixed(3):null;
      return { name:n, status:t.proposed?"proposed":"construction", approx_miles:miles, link:null, source:"overpass" };
    });
  }catch{ return []; }
}
function fillTemplate(tpl,ctx){
  return tpl.replace("{address}",encodeURIComponent(ctx.address||""))
            .replace("{lat}",encodeURIComponent(ctx.lat))
            .replace("{lon}",encodeURIComponent(ctx.lon))
            .replace("{city}",encodeURIComponent(ctx.city||""))
            .replace("{county}",encodeURIComponent(ctx.county||""))
            .replace("{state}",encodeURIComponent(ctx.state||""));
}
async function queryExternalJSON(tpl,ctx){
  try{
    const r=await fetchWithTimeout(fillTemplate(tpl,ctx),{headers:{ "User-Agent":UA, Accept:"application/json"}},30000);
    const j=await r.json(); const arr=Array.isArray(j)?j:(Array.isArray(j.items)?j.items:[]);
    return arr.map(it=>({ name:String(it.name||it.title||it.project||"Fuel development").slice(0,160), status:String(it.status||it.stage||it.note||"planned").slice(0,100), approx_miles:null, link:it.url||it.link||null, source:it.source||"custom" }));
  }catch{ return []; }
}
async function scrapePermitHTML(url){
  try{
    const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA, Accept:"text/html"}},30000);
    const html=await r.text();
    const lines=html.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const hits=lines.filter(L=>/(gas|fuel|convenience|c-store|station|EP\s?Mart)/i.test(L)).slice(0,60);
    return hits.map(h=>({ name:h.slice(0,160), status:"permit/agenda", approx_miles:null, link:url, source:url }));
  }catch{ return []; }
}
async function bingNewsCityCounty(city,county,state){
  if(!BING_NEWS_KEY) return { news:[], web:[], message:"BING_NEWS_KEY missing" };
  const termSets=[
    [`${city} ${state} gas station`, `${city} ${state} EP Mart`, `${city} ${state} convenience store`],
    [`${city} ${state} planning board gas station`, `${city} ${state} site plan gas station`, `${city} ${state} zoning gas station`],
    [`${county} ${state} planning commission gas station`, `${county} ${state} permit gas station`]
  ];
  const headers={ "Ocp-Apim-Subscription-Key":BING_NEWS_KEY, "User-Agent":UA, Accept:"application/json" };
  const newsOut=[], webOut=[];
  for(const terms of termSets){
    for(const q of terms){
      try{
        const nu=`${BING_NEWS_ENDPOINT}?q=${encodeURIComponent(q)}&count=20&freshness=Year`;
        const nr=await fetchWithTimeout(nu,{headers},30000); const nj=await nr.json(); const nv=Array.isArray(nj.value)?nj.value:[];
        nv.forEach(it=>newsOut.push({ name:(it.name||"").slice(0,160), status:"news", approx_miles:null, link:it.url||null, source:"bing-news" }));
      }catch{}
      try{
        const wu=`${BING_WEB_ENDPOINT}?q=${encodeURIComponent(q)}&count=20`;
        const wr=await fetchWithTimeout(wu,{headers},30000); const wj=await wr.json(); const wv=wj.webPages?.value||[];
        wv.forEach(it=>webOut.push({ name:(it.name||"").slice(0,160), status:"permit/search", approx_miles:null, link:it.url||null, source:"bing-web" }));
      }catch{}
    }
  }
  const ded=(arr)=>{ const seen=new Set(), out=[]; for(const i of arr){ const k=`${(i.name||"").toLowerCase()}|${i.link||""}|${i.status||""}`; if(seen.has(k)) continue; seen.add(k); out.push(i);} return out; };
  return { news: ded(newsOut).slice(0,80), web: ded(webOut).slice(0,80), message: "ok" };
}
async function exhaustiveDevelopments(addrLabel, lat, lon){
  const admin=await reverseAdmin(lat,lon);
  const ctx={ address:addrLabel, lat, lon, city:admin.city, county:admin.county, state:admin.state };

  const [jsonNews, jsonPermits] = await Promise.all([
    Promise.all(NEWS_URLS.map(t=>queryExternalJSON(t,ctx).catch(()=>[]))).then(a=>a.flat()),
    Promise.all(PERMIT_URLS.map(t=>queryExternalJSON(t,ctx).catch(()=>[]))).then(a=>a.flat())
  ]);
  const [permHtml, bing, osm] = await Promise.all([
    Promise.all(PERMIT_HTML_URLS.map(u=>scrapePermitHTML(u).catch(()=>[]))).then(a=>a.flat()),
    bingNewsCityCounty(ctx.city, ctx.county, ctx.state).catch(()=>({news:[],web:[],message:"error"})),
    overpassDevelopments(lat,lon).catch(()=>[])
  ]);

  const news=[...jsonNews, ...(bing.news||[])];
  const permits=[...jsonPermits, ...permHtml, ...(bing.web||[])];
  const ded=(arr)=>{ const seen=new Set(), out=[]; for(const i of arr){ const k=`${(i.name||"").toLowerCase()}|${i.link||""}|${i.status||""}`; if(seen.has(k)) continue; seen.add(k); out.push(i);} return out; };

  return {
    news: ded(news).slice(0,80),
    permits: ded(permits).slice(0,80),
    osm: ded(osm).slice(0,40),
    note: bing.message
  };
}

/* ───────────────── Google proxy ───────────────── */
app.get("/google/status", async (_req,res)=>{
  try{
    if(!GOOGLE_API_KEY) return res.json({ ok:false, status:"MISSING_KEY" });
    const au=`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Test&components=country:us&key=${GOOGLE_API_KEY}`;
    const r=await fetchWithTimeout(au,{headers:{ "User-Agent":UA }},10000);
    res.json({ ok:r.ok, status:r.ok?"WORKING":`HTTP_${r.status}` });
  }catch{ res.json({ ok:false, status:"EXCEPTION" }); }
});
app.get("/google/autocomplete", async (req,res)=>{
  const q=String(req.query.input||"").trim(); if(!q) return res.json({ ok:false, status:"BAD_REQUEST", items:[] });
  if(!GOOGLE_API_KEY) return res.json({ ok:false, status:"MISSING_KEY", items:[] });
  try{
    const au=`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&components=country:us&key=${GOOGLE_API_KEY}`;
    const ar=await fetchWithTimeout(au,{headers:{ "User-Agent":UA }},15000);
    const aj=await ar.json();
    if(aj.status!=="OK" && aj.status!=="ZERO_RESULTS") return res.json({ ok:false, status:aj.status, items:[] });
    const items=[];
    for(const p of (aj.predictions||[]).slice(0,6)){
      const pid=p.place_id; if(!pid) continue;
      const du=`https://maps.googleapis.com/maps/api/place/details/json?place_id=${pid}&fields=formatted_address,geometry,name,place_id,types&key=${GOOGLE_API_KEY}`;
      const dr=await fetchWithTimeout(du,{headers:{ "User-Agent":UA }},15000);
      const dj=await dr.json(); if(dj.status!=="OK") continue;
      const loc=dj.result?.geometry?.location;
      if(loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)){
        items.push({ type:"Google", display:dj.result.formatted_address || dj.result.name || p.description, lat:+loc.lat, lon:+loc.lng, place_id:dj.result.place_id || pid, score:1.3 });
      }
    }
    return res.json({ ok:true, status:"OK", items });
  }catch(e){ return res.json({ ok:false, status:"ERROR", items:[], error:String(e) }); }
});
app.get("/google/searchplace", async (req,res)=>{
  try{
    if(!GOOGLE_API_KEY) return res.json({ ok:false, status:"MISSING_KEY" });
    const q=String(req.query.q||"").trim(); if(!q) return res.json({ ok:false, status:"BAD_REQUEST" });
    const url=`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&type=gas_station&key=${GOOGLE_API_KEY}`;
    const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA }},15000);
    const j=await r.json(); const it=(j.results||[])[0];
    if(!it?.place_id) return res.json({ ok:false, status:j.status||"ZERO_RESULTS" });
    res.json({ ok:true, status:"OK", place_id:it.place_id, location:it.geometry?.location||null });
  }catch(e){ res.json({ ok:false, status:"EXCEPTION", error:String(e) }); }
});
app.get("/google/findplace", async (req,res)=>{
  try{
    if(!GOOGLE_API_KEY) return res.json({ ok:false, status:"MISSING_KEY" });
    const input=String(req.query.input||"").trim(); if(!input) return res.json({ ok:false, status:"BAD_REQUEST" });
    const url=`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(input)}&inputtype=textquery&fields=place_id,name,formatted_address,geometry&key=${GOOGLE_API_KEY}`;
    const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA }},15000);
    const j=await r.json(); const cand=(j.candidates||[])[0];
    if(!cand?.place_id) return res.json({ ok:false, status:j.status||"ZERO_RESULTS" });
    res.json({ ok:true, status:"OK", place_id:cand.place_id, name:cand.name, address:cand.formatted_address, location:cand.geometry?.location||null });
  }catch(e){ res.json({ ok:false, status:"EXCEPTION", error:String(e) }); }
});
app.get("/google/rating", async (req,res)=>{
  try{
    if(!GOOGLE_API_KEY) return res.json({ ok:false, status:"MISSING_KEY" });
    const place_id=String(req.query.place_id||"").trim(); if(!place_id) return res.json({ ok:false, status:"BAD_REQUEST" });
    const fields=["name","formatted_address","rating","user_ratings_total"].join(",");
    const url=`https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place_id)}&fields=${encodeURIComponent(fields)}&key=${GOOGLE_API_KEY}`;
    const r=await fetchWithTimeout(url,{headers:{ "User-Agent":UA }},15000);
    const j=await r.json(); if(j.status!=="OK") return res.json({ ok:false, status:j.status||"ERROR", error:j.error_message||null });
    const g=j.result||{};
    res.json({ ok:true, status:"OK", rating:g.rating||null, total:g.user_ratings_total||0, name:g.name||null, address:g.formatted_address||null });
  }catch(e){ res.json({ ok:false, status:"EXCEPTION", error:String(e) }); }
});

/* ───────────────── roads (heuristic) ───────────────── */
function parseMaxspeed(ms){ const m=String(ms||"").match(/(\d+)\s*(mph)?/i); return m?+m[1]:null; }
function roadWeight(hw){ const order={ motorway:6, trunk:5, primary:4, secondary:3, tertiary:2, unclassified:1, residential:1 }; return order[(hw||"").replace("_link","")] || 0; }
async function roadContext(lat, lon){
  const rM=Math.round(1609*1.2);
  const qWays=`[out:json][timeout:25];
    ( way(around:${rM},${lat},${lon})["highway"~"motorway|trunk|primary|secondary|tertiary|primary_link|secondary_link|tertiary_link"]; );
    out center tags;`;
  const qSig=`[out:json][timeout:25]; node(around:${rM},${lat},${lon})["highway"="traffic_signals"]; out;`;
  let ways=[], signals=0;
  try{ const wj=await overpassQuery(qWays); ways=wj.elements||[]; }catch{}
  try{ const sj=await overpassQuery(qSig); signals=(sj.elements||[]).length; }catch{}
  const rows=ways.map(w=>{
    const t=w.tags||{};
    const name=t.ref||t.name||"";
    const hw=(t.highway||"").replace("_link","");
    const lanes=+t.lanes||+t["lanes:forward"]||+t["lanes:backward"]||null;
    const speed=parseMaxspeed(t.maxspeed);
    const latc=w.center?.lat, lonc=w.center?.lon;
    const d=(Number.isFinite(latc)&&Number.isFinite(lonc))?haversine(lat,lon,latc,lonc):null;
    return { name, highway:hw, lanes, maxspeed:speed, distM:d, weight:roadWeight(hw) };
  }).filter(r=>r.weight>0);
  rows.sort((a,b)=> (b.weight-a.weight) || ((b.lanes||0)-(a.lanes||0)) || ((b.maxspeed||0)-(a.maxspeed||0)) || ((a.distM||1e12)-(b.distM||1e12)));
  const main=rows.slice(0,3), side=rows.slice(3,8);
  const nice=(r)=>[r.name||r.highway, r.maxspeed?`${r.maxspeed} mph`:null, r.lanes?`${r.lanes} lanes`:null].filter(Boolean).join(" • ");
  const mainLabel=main.map(nice).filter(Boolean).slice(0,3).join(" | ");
  const sideLabel=side.map(nice).filter(Boolean).slice(0,3).join(" | ");
  const intersections=Math.max(0, Math.round(rows.length/3));
  return { summary:[mainLabel,sideLabel].filter(Boolean).join(" — "), main, side, signals, intersections };
}

/* ───────────────── gallons calc ───────────────── */
function gallonsWithRules({ aadt, mpds, diesel, compCount, heavyCount, pricePosition, userExtrasMult=1 }){
  const baseline = aadt * 0.02 * 8 * 30;

  // competition rule (now includes 5+ => 50%)
  let baseMult=1.0;
  if (compCount === 1) baseMult = 0.75;
  else if (compCount >= 2 && compCount <= 4) baseMult = 0.60;
  else if (compCount >= 5) baseMult = 0.50;

  // heavy brand penalty
  let heavyPenalty=0;
  if (heavyCount === 1) heavyPenalty = 0.20;
  else if (heavyCount >= 2) heavyPenalty = 0.35;

  // allow stronger suppression; clamp at 10%
  const compMult = Math.max(0.10, +(baseMult - heavyPenalty).toFixed(2));
  const afterComp = baseline * compMult;

  // equipment caps
  const capEquip = (mpds * 25 * 10.5 * 24) * (365/12) + ((diesel||0) * 25 * 16 * 24) * (365/12);
  const SOFT=22000, HARD=28000; // per MPD
  const capSoftTotal=mpds*SOFT, capHardTotal=mpds*HARD;
  let capped = Math.min(afterComp, capEquip, capHardTotal);
  if (afterComp > capSoftTotal) capped = Math.round(capped * 0.90);

  // pricing position
  let priceMult = 1.0;
  if (pricePosition === "below") priceMult = 1.10;
  else if (pricePosition === "above") priceMult = 0.90;

  const preClamp = Math.round(capped * priceMult * userExtrasMult);
  const base = Math.min(preClamp, Math.round(baseline)); // never exceed baseline ceiling

  const low = Math.round(base * 0.86);
  const high= Math.round(base * 1.06);

  return {
    base, low, high,
    year2: Math.round(base * 1.027),
    year3: Math.round(base * 1.027 * 1.0125),
    breakdown: {
      aadt, baseline: Math.round(baseline),
      compRule: { compCount, baseMult, heavyPenalty, compMult, afterComp: Math.round(afterComp) },
      caps: { capEquip: Math.round(capEquip), capSoftTotal, capHardTotal },
      priceMult, extrasMult: userExtrasMult,
      preClamp, finalClampedToBaseline: base
    }
  };
}

/* ───────────────── GPT summary ───────────────── */
async function gptJSONCore(model, prompt){
  const r=await fetchWithTimeout("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{ Authorization:`Bearer ${OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify({
      model, response_format:{type:"json_object"}, temperature:0.2, max_tokens:1200,
      messages:[
        {role:"system", content:"You are a precise fuel/traffic analyst. Always reply with STRICT JSON (no markdown)."},
        {role:"user", content: prompt}
      ]
    })
  },50000);
  const txt=await r.text(); if(!r.ok) throw new Error(`OpenAI ${r.status}: ${txt}`);
  const data=JSON.parse(txt); const content=data.choices?.[0]?.message?.content;
  if(!content) throw new Error("No GPT content"); return JSON.parse(content);
}
async function gptJSONWithRetry(prompt){
  const models=["gpt-4o-mini","gpt-4o"]; let last=null;
  for(const m of models){ for(let i=0;i<2;i++){ try{ return await gptJSONCore(m,prompt); }catch(e){ last=e; await sleep(500);} } }
  throw last||new Error("GPT failed");
}
async function gptSummary(ctx){
  const sys='Return {"summary":"<text>"} ~8–12 sentences. Include method & AADT, baseline ceiling, competition rule & heavy penalties, pricing, user adjustments, caps, LOW/BASE/HIGH, road context, and notable developments.';
  const prompt = `
Inputs:
- Address: ${ctx.address}
- USED AADT: ${ctx.aadt} (${ctx.method})
- Roads: ${ctx.roads.summary}; signals ${ctx.roads.signals}; intersections ${ctx.roads.intersections}
- Competition: count ${ctx.compCount}, heavy ${ctx.heavyCount}, notable ${ctx.notable}
- Pricing: ${ctx.pricePosition}
- User adjustments: ${ctx.userAdj || "none"}
- Baseline ceiling: AADT×2%×8×30
- Developments (news): ${ctx.devNews || "none"}
- Developments (permits): ${ctx.devPermits || "none"}
- Result gallons (LOW/BASE/HIGH): ${ctx.low}/${ctx.base}/${ctx.high}
`.trim();
  try{
    const j=await gptJSONWithRetry(`${sys}\n${prompt}`); const s=(j&&j.summary)?String(j.summary).trim():"";
    if(s) return s;
  }catch{}
  return `AADT ${ctx.aadt} (${ctx.method}); competition ${ctx.compCount} (heavy=${ctx.heavyCount}); pricing ${ctx.pricePosition}; adjustments ${ctx.userAdj||"none"}; result ${ctx.low}–${ctx.high} (base ${ctx.base}).`;
}

/* ───────────────── estimate ───────────────── */
app.post("/estimate", async (req,res)=>{
  try{
    const { address, mpds, diesel, siteLat, siteLon, aadtOverride, advanced, client_rating, auto_low_rating } = req.body||{};
    const MPDS=+mpds, DIESEL=+(diesel||0);
    if(!(Number.isFinite(MPDS) && MPDS>0)) return res.status(400).json({ error:"Regular MPDs required (>0)" });
    if(!address && !(Number.isFinite(siteLat)&&Number.isFinite(siteLon))) return res.status(400).json({ error:"Address or coordinates required" });

    const pricePosition=String(advanced?.price_position||"inline");

    // Geocode/admin
    let geo;
    if(Number.isFinite(siteLat)&&Number.isFinite(siteLon)) geo={ lat:+siteLat, lon:+siteLon, label: address||`${siteLat}, ${siteLon}` };
    else geo=await geocode(address);
    const admin=await reverseAdmin(geo.lat, geo.lon);

    // Competition
    const compAll3=await competitorsWithinRadiusMiles(geo.lat, geo.lon, 3.0).catch(()=>[]);
    const competitors=compAll3.filter(c=>c.miles<=1.5);
    const compCount=competitors.length, heavyCount=competitors.filter(c=>c.heavy).length;
    const sunocoNearby=compAll3.some(c=>c.sunoco && c.miles<=1.0);
    const ruralEligible = compAll3.length===0;

    // Developments (wait for everything before returning)
    const dev=await exhaustiveDevelopments(address||geo.label, geo.lat, geo.lon);
    const devNews=dev.news, devPermits=dev.permits, devOSM=dev.osm;

    // Roads & AADT
    const roads=await roadContext(geo.lat, geo.lon).catch(()=>({summary:"",main:[],side:[],signals:0,intersections:0}));
    let usedAADT=10000, method="fallback_default";
    const overrideVal=Number(aadtOverride);
    if(Number.isFinite(overrideVal)&&overrideVal>0){ usedAADT=Math.round(overrideVal); method="override"; }
    else{
      let sta=await queryCustomTraffic(geo.lat, geo.lon, address).catch(()=>null);
      if(!sta) sta=await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609).catch(()=>null);
      let dotAADT=sta?sta.aadt:null;
      const heur=heuristicAADT(roads);
      const comps=[]; if(Number.isFinite(dotAADT)) comps.push({v:dotAADT,w:1.0,l:"DOT"}); if(Number.isFinite(heur)) comps.push({v:heur,w:0.7,l:"HEUR"});
      if(comps.length){ const sumW=comps.reduce((s,c)=>s+c.w,0); usedAADT=Math.round(comps.reduce((s,c)=>s+c.v*c.w,0)/Math.max(0.0001,sumW)); method="blend_"+comps.map(c=>c.l).join("+").toLowerCase(); }
    }

    // Extras & flags
    let userExtrasMult=1.0; const extras=(advanced?.extra||[]).map(e=>({ pct:+e?.pct, note:String(e?.note||"").slice(0,180) })).filter(e=>Number.isFinite(e.pct));
    if(extras.length) userExtrasMult *= extras.reduce((m,e)=>m*(1+e.pct/100),1.0);
    const ruralRequested = !!(advanced && advanced.flags && advanced.flags.rural===true);
    const ruralApplied   = ruralRequested && ruralEligible;
    if(ruralApplied) userExtrasMult *= 1.30;

    // Auto low-rating penalty if client provided < 4.0
    const autoLow = (auto_low_rating === true) || (Number.isFinite(client_rating) && client_rating < 4.0);
    if (autoLow) userExtrasMult *= 0.70;

    // Gallons
    const calc=gallonsWithRules({ aadt:usedAADT, mpds:MPDS, diesel:DIESEL, compCount, heavyCount, pricePosition, userExtrasMult });

    // Summary
    const adjBits=[];
    if(pricePosition==="below") adjBits.push("+10% below-market pricing");
    if(pricePosition==="above") adjBits.push("−10% above-market pricing");
    if(ruralApplied) adjBits.push("+30% rural bonus (0 comps within 3 mi)");
    if(autoLow) adjBits.push("−30% low reviews (<4.0)");
    extras.forEach(e=>adjBits.push(`${e.pct>0?"+":""}${e.pct}% ${e.note||"adj."}`));
    const userAdjText = adjBits.join("; ");

    const notable=competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name).join(", ") || "none";
    const summary=await gptSummary({
      address: address||geo.label, aadt:usedAADT, method, roads,
      compCount, heavyCount, notable, pricePosition, userAdj:userAdjText,
      base:calc.base, low:calc.low, high:calc.high,
      devNews: devNews.slice(0,4).map(x=>x.name).join("; "),
      devPermits: devPermits.slice(0,4).map(x=>x.name).join("; ")
    });

    res.json({
      base:calc.base, low:calc.low, high:calc.high, year2:calc.year2, year3:calc.year3,
      inputs:{ mpds:MPDS, diesel:DIESEL, aadt_used:usedAADT, price_position:pricePosition, aadt_components:{ method } },
      flags:{ rural_bonus_applied:ruralApplied, rural_eligible:ruralEligible, sunoco_within_1mi: sunocoNearby, auto_low_rating:autoLow },
      competition:{ count:compCount, nearest_mi: competitors[0]?.miles ?? null, notable_brands: competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name) },
      developments: devOSM, developments_external:{ news: devNews, permits: devPermits, note: dev.note },
      roads, summary, calc_breakdown: calc.breakdown,
      map:{ site:{ lat:geo.lat, lon:geo.lon, label:geo.label }, competitors }
    });
  }catch(e){
    res.status(500).json({ error:"Estimate failed", detail:String(e) });
  }
});

function heuristicAADT(roads){
  const dom=roads?.main?.[0]?.highway || roads?.side?.[0]?.highway || "";
  const lanes=roads?.main?.[0]?.lanes || roads?.side?.[0]?.lanes || 2;
  const speed=roads?.main?.[0]?.maxspeed || roads?.side?.[0]?.maxspeed || null;
  let base=0; switch(dom){ case"motorway":base=30000;break; case"trunk":base=22000;break; case"primary":base=14000;break; case"secondary":base=9000;break; case"tertiary":base=6000;break; default:base=4000; }
  let est=base*Math.max(1, lanes/2);
  if(speed){ if(speed>=55) est*=1.15; else if(speed<=30) est*=0.8; }
  if((roads?.signals||0)>=5) est*=0.9;
  return Math.round(Math.max(800, Math.min(120000, est)));
}

const PORT=process.env.PORT||3000;
app.listen(PORT,"0.0.0.0",()=>console.log(`Server listening on :${PORT}`));
