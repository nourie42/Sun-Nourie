// server.js — Fuel IQ API v2025-08-29d
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

/* ───────────────────────────── App / Static ───────────────────────────── */
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// no-cache for static so UI updates show immediately
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    cacheControl: true,
    maxAge: 0,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
  })
);
app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ───────────────────────────── Config / ENV ───────────────────────────── */
const UA = "FuelEstimator/3.1 (+contact: you@example.com)";
const CONTACT = process.env.OVERPASS_CONTACT || UA;

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const BING_NEWS_KEY = process.env.BING_NEWS_KEY || ""; // Azure Bing key
const BING_NEWS_ENDPOINT =
  process.env.BING_NEWS_ENDPOINT || "https://api.bing.microsoft.com/v7.0/news/search";
const BING_WEB_ENDPOINT =
  process.env.BING_WEB_ENDPOINT || "https://api.bing.microsoft.com/v7.0/search";

// Optional custom sources (can be blank)
const NEWS_URLS = (process.env.NEWS_URLS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const PERMIT_URLS = (process.env.PERMIT_URLS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const PERMIT_HTML_URLS = (process.env.PERMIT_HTML_URLS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const TRAFFIC_URL = process.env.TRAFFIC_URL || "";

/* ───────────────────────────── Utilities ──────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toMiles = (m) => m / 1609.344;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const t = (d) => (d * Math.PI) / 180;
  const dLat = t(lat2 - lat1), dLon = t(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(t(lat1))*Math.cos(t(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function distMiles(a,b,c,d){ return toMiles(haversine(a,b,c,d)); }
async function fetchWithTimeout(url, opts = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  finally { clearTimeout(t); }
}

/* ───────────────────────────── Geocoding ──────────────────────────────── */
function tryParseLatLng(address) {
  const m = String(address || "").trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: `${lat}, ${lon}` };
}
async function geocodeCensus(q) {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 15000);
  if (!r.ok) throw new Error(`Census ${r.status}`);
  const d = await r.json(); const m = d?.result?.addressMatches?.[0];
  if (!m?.coordinates) throw new Error("Census: no match");
  return { lat: +m.coordinates.y, lon: +m.coordinates.x, label: m.matchedAddress || q };
}
async function geocodeNominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 15000);
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const a = await r.json(); if (!a?.length) throw new Error("Nominatim: no result");
  return { lat: +a[0].lat, lon: +a[0].lon, label: a[0].display_name };
}
async function geocode(address) {
  const direct = tryParseLatLng(address);
  if (direct) return direct;
  const hasNumber = /\d/.test(address || "");
  if (hasNumber) { try { return await geocodeCensus(address); } catch { return await geocodeNominatim(address); } }
  else { try { return await geocodeNominatim(address); } catch { return await geocodeCensus(address); } }
}
function extractCityState(label) {
  const parts = String(label || "").split(",").map(s => s.trim());
  const state = parts.length >= 2 ? parts[parts.length-2].match(/[A-Z]{2}/)?.[0] || "" : "";
  const city  = parts.length >= 3 ? parts[parts.length-3] : (parts[parts.length-2] || "");
  return { city, state };
}

/* ───────────────────────────── AADT (DOT/custom) ──────────────────────── */
const NCDOT_AADT_FS =
  "https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0";

async function queryNCDOTNearestAADT(lat, lon, radiusMeters = 1609) {
  const params = new URLSearchParams({
    f: "json", where: "1=1", outFields: "*", returnGeometry: "true",
    geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", distance: String(radiusMeters), units: "esriSRUnit_Meter",
    outSR: "4326", resultRecordCount: "200"
  });
  const r = await fetchWithTimeout(`${NCDOT_AADT_FS}/query?${params.toString()}`,
    { headers: { "User-Agent": UA, Accept: "application/json" } }, 20000);
  if (!r.ok) return null;
  const data = await r.json();
  const feats = data.features || [];
  const rows = [];
  for (const f of feats) {
    const attrs = f.attributes || {};
    const pairs = Object.keys(attrs).filter(k => k.toLowerCase().includes("aadt")).map(k => {
      const val = +attrs[k]; if (!(val > 0)) return null;
      let year = null;
      const inKey = String(k).match(/20\d{2}/)?.[0]; if (inKey) year = +inKey;
      for (const yk of ["YEAR","AADT_YEAR","COUNT_YEAR","TRAFFICYEAR","YEAR_","YR","YR_"]) {
        const yv = attrs[yk]; if (yv) { const mt = String(yv).match(/20\d{2}/)?.[0]; if (mt) { year = +mt; break; } }
      }
      return { val, year };
    }).filter(Boolean);
    if (!pairs.length) continue;
    pairs.sort((a,b)=>(b.year||0)-(a.year||0) || b.val-a.val);
    const x = f.geometry?.x, y = f.geometry?.y;
    if (x==null || y==null) continue;
    rows.push({ aadt:pairs[0].val, year:pairs[0].year||null, distM:haversine(lat,lon,y,x) });
  }
  if (!rows.length) return null;
  rows.sort((A,B)=>(B.year||0)-(A.year||0) || B.aadt-A.aadt || A.distM-B.distM);
  return rows[0];
}
async function queryCustomTraffic(lat, lon, address) {
  if (!TRAFFIC_URL) return null;
  const url = TRAFFIC_URL
    .replace("{lat}", encodeURIComponent(lat))
    .replace("{lon}", encodeURIComponent(lon))
    .replace("{address}", encodeURIComponent(address || ""));
  try {
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 20000);
    const j = await r.json();
    const aadt = +j.aadt || +j.volume || +j.count;
    const year = j.year ? +String(j.year).match(/20\d{2}/)?.[0] : null;
    if (aadt > 0) return { aadt, year, distM: 0, source: "custom" };
  } catch {}
  return null;
}

/* ───────────────────────────── Competition (1.5 / 3 mi) ───────────────── */
const HEAVY_BRANDS = /(sheetz|wawa|race\s?trac|racetrac|buc-?ee'?s|royal\s?farms|quik.?trip|\bqt\b)/i;

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

async function overpassQuery(data) {
  let lastErr = new Error("no tries");
  for (const ep of OVERPASS) {
    for (let i=0;i<3;i++){
      try{
        const r = await fetchWithTimeout(ep, {
          method: "POST",
          headers: {
            "User-Agent": CONTACT,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
          },
          body: "data=" + encodeURIComponent(data)
        }, 25000);
        const ct = r.headers.get("content-type") || "";
        const txt = await r.text();
        if (!r.ok || !ct.includes("application/json")) throw new Error(`Overpass ${r.status}: ${txt.slice(0,160)}`);
        return JSON.parse(txt);
      }catch(e){ lastErr = e; await sleep(900*(i+1)); }
    }
  }
  throw lastErr;
}
async function googleNearbyGasStations(lat, lon, radiusMeters = 2414) {
  if (!GOOGLE_API_KEY) return [];
  const base = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=${radiusMeters}&type=gas_station&key=${GOOGLE_API_KEY}`;
  const out=[]; let url=base; let tries=0;
  while(url && tries<3){
    tries++;
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 20000);
    const txt = await r.text(); if (!r.ok) break;
    let j; try{ j = JSON.parse(txt); }catch{ break; }
    const results = j.results || [];
    for (const it of results) {
      const name = it.name || it.vicinity || "Fuel";
      const latc = it.geometry?.location?.lat, lonc = it.geometry?.location?.lng;
      if (!Number.isFinite(latc) || !Number.isFinite(lonc)) continue;
      out.push({ name, lat:+latc, lon:+lonc, miles:+distMiles(lat,lon,latc,lonc).toFixed(3), heavy: HEAVY_BRANDS.test(name) });
    }
    if (j.next_page_token) { await sleep(1700); url = `${base}&pagetoken=${j.next_page_token}`; } else url=null;
  }
  return out;
}
async function competitorsWithinRadiusMiles(lat, lon, rMiles = 1.5) {
  const radiusMeters = Math.round(rMiles * 1609.344);
  const q = `[out:json][timeout:25];
    ( node(around:${radiusMeters},${lat},${lon})["amenity"="fuel"];
      way(around:${radiusMeters},${lat},${lon})["amenity"="fuel"]; );
    out center tags;`;
  const [op, g] = await Promise.all([
    overpassQuery(q).then(j => j.elements||[]).catch(()=>[]),
    googleNearbyGasStations(lat, lon, radiusMeters).catch(()=>[])
  ]);
  const opList = op.map(el => {
    const t = el.tags || {}; const name = t.brand || t.name || "Fuel";
    const latc = el.lat ?? el.center?.lat, lonc = el.lon ?? el.center?.lon;
    if (latc == null || lonc == null) return null;
    return { name, lat:+latc, lon:+lonc, miles:+distMiles(lat,lon,latc,lonc).toFixed(3), heavy: HEAVY_BRANDS.test(name) };
  }).filter(Boolean);

  const merged = [...opList, ...g];
  const out=[]; const seen=new Set();
  for (const s of merged) {
    const k = `${Math.round(s.lat*1e5)}|${Math.round(s.lon*1e5)}`;
    if (seen.has(k)) continue; seen.add(k); out.push(s);
  }
  out.sort((a,b)=>a.miles-b.miles);
  return out.filter(s=>s.miles<=rMiles);
}

/* ───────────────────────────── Road context ───────────────────────────── */
async function roadContext(lat, lon) {
  const r=300;
  const q = `[out:json][timeout:25];
    ( way(around:${r},${lat},${lon})["highway"];
      node(around:${r},${lat},${lon})["highway"="traffic_signals"];
      node(around:${r},${lat},${lon})["crossing"];
      node(around:${r},${lat},${lon})["junction"]; );
    out tags center qt;`;
  try {
    const j = await overpassQuery(q);
    const ways = (j.elements||[]).filter(e=>e.type==="way");
    const nodes = (j.elements||[]).filter(e=>e.type==="node");
    const classify = w => {
      const t=w.tags||{};
      return { name:t.name||t.ref||"(unnamed)", highway:t.highway||"", lanes:t.lanes?+t.lanes:null, oneway:t.oneway==="yes", maxspeed:t.maxspeed||null };
    };
    const main = ways.filter(w => /^(motorway|trunk|primary|secondary|tertiary)$/i.test(w.tags?.highway||"")).map(classify);
    const side = ways.filter(w => /^(residential|service|unclassified)$/i.test(w.tags?.highway||"")).map(classify);
    const signals = nodes.filter(n => n.tags?.highway==="traffic_signals").length;
    const intersections = nodes.filter(n => /(junction|crossing)/.test(n.tags?.highway||"") || n.tags?.junction).length;
    const rank = { motorway:6, trunk:5, primary:4, secondary:3, tertiary:2, residential:1, service:0 };
    const dom = main.slice().sort((a,b)=>(rank[b.highway]||0)-(rank[a.highway]||0) || (b.lanes||0)-(a.lanes||0))[0];
    const summary = dom ? `${dom.highway}${dom.lanes?` ${dom.lanes} lanes`:``}${dom.oneway?" oneway":""}${dom.maxspeed?` @ ${dom.maxspeed}`:""}` : "local roads";
    return { summary, main: main.slice(0,6), side: side.slice(0,6), signals, intersections };
  } catch { return { summary:"no data", main:[], side:[], signals:0, intersections:0 }; }
}
function parseMaxspeed(ms){ const m=String(ms||"").match(/(\d+)\s*(mph)?/i); return m?+m[1]:null; }
function heuristicAADT(roads){
  const dom = roads?.main?.[0]?.highway || roads?.side?.[0]?.highway || "";
  const lanes = roads?.main?.[0]?.lanes || roads?.side?.[0]?.lanes || 2;
  const speed = parseMaxspeed(roads?.main?.[0]?.maxspeed || roads?.side?.[0]?.maxspeed);
  let base=0; switch(dom){
    case "motorway": base=30000; break;
    case "trunk": base=22000; break;
    case "primary": base=14000; break;
    case "secondary": base=9000; break;
    case "tertiary": base=6000; break;
    default: base=4000;
  }
  let est=base*Math.max(1, lanes/2);
  if (speed){ if (speed>=55) est*=1.15; else if (speed<=30) est*=0.8; }
  if ((roads?.signals||0)>=5) est*=0.9;
  return Math.round(Math.max(800, Math.min(120000, est)));
}

/* ───────────────────────────── GPT summary (always) ───────────────────── */
async function gptJSONCore(model, prompt) {
  const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      response_format:{ type:"json_object" },
      temperature:0.2,
      max_tokens:1400,
      messages:[
        { role:"system", content:"You are a precise fuel/traffic analyst. Always reply with STRICT JSON (no markdown)." },
        { role:"user", content:prompt }
      ]
    })
  }, 35000);
  const txt = await r.text(); if (!r.ok) throw new Error(`OpenAI ${r.status}: ${txt}`);
  const data = JSON.parse(txt);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No GPT content");
  return JSON.parse(content);
}
async function gptJSONWithRetry(prompt){
  const models = ["gpt-4o-mini","gpt-4o"];
  let last=null;
  for (const m of models){
    for (let i=0;i<2;i++){
      try { return await gptJSONCore(m, prompt); }
      catch(e){ last=e; await sleep(600); }
    }
  }
  throw last||new Error("GPT failed");
}
async function gptSummary(ctx){
  const sys = `Return {"summary":"<text>"} with 8–12 crisp sentences covering: AADT method/values, baseline ceiling (AADT×2%×8×30), road layout, competition rule (0=100%, 1=75%, 2–4=60% with heavy penalty 20–35%), pricing position (±10%), caps (22–28k/MPD/mo), and developments (news/permits/OSM).`;
  const prompt = `
Inputs:
- Address: ${ctx.address}
- USED AADT: ${ctx.aadt} (${ctx.method})
- Roads: ${ctx.roads.summary}; signals ${ctx.roads.signals}; intersections ${ctx.roads.intersections}
- Competition: count ${ctx.compCount}, heavy ${ctx.heavyCount}, notable ${ctx.notable}
- Pricing position: ${ctx.pricePosition}
- Baseline ceiling: active
- Developments (news): ${ctx.devNews}
- Developments (permits): ${ctx.devPermits}
- Final gallons: base ${ctx.base}, low ${ctx.low}, high ${ctx.high}
`.trim();
  try {
    const j = await gptJSONWithRetry(`${sys}\n${prompt}`);
    const s = (j && j.summary) ? String(j.summary).trim() : "";
    if (s) return s;
  } catch {}
  return `AADT used ${ctx.aadt} (${ctx.method}). Baseline ceiling active (AADT×2%×8×30). Roads: ${ctx.roads.summary}. Competition ${ctx.compCount} (heavy=${ctx.heavyCount}). Pricing ${ctx.pricePosition}. Result: ${ctx.base.toLocaleString()} gal/mo (range ${ctx.low.toLocaleString()}–${ctx.high.toLocaleString()}). Developments (news): ${ctx.devNews || "none"}. Developments (permits): ${ctx.devPermits || "none"}.`;
}

/* ───────────────────────────── Developments search ────────────────────── */
function fillTemplate(tpl, { address, lat, lon, city, state }) {
  return tpl
    .replace("{address}", encodeURIComponent(address || ""))
    .replace("{lat}", encodeURIComponent(lat))
    .replace("{lon}", encodeURIComponent(lon))
    .replace("{city}", encodeURIComponent(city || ""))
    .replace("{state}", encodeURIComponent(state || ""));
}
async function queryExternalJSON(tpl, ctx) {
  const url = fillTemplate(tpl, ctx);
  try {
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, 20000);
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : []);
    return arr.map(it => ({
      name: String(it.name || it.title || it.project || "Fuel development").slice(0,160),
      status: String(it.status || it.stage || it.note || "planned").slice(0,100),
      approx_miles: null,
      link: it.url || it.link || null,
      source: it.source || url
    }));
  } catch { return []; }
}
async function scrapePermitHTML(url) {
  try {
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "text/html" } }, 20000);
    const html = await r.text();
    const lines = html.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const hits = lines.filter(L => /(gas|fuel|convenience|c-store|station|EP\s?Mart)/i.test(L)).slice(0,40);
    return hits.map(h => ({ name: h.slice(0,160), status: "permit/agenda", approx_miles: null, link: url, source: url }));
  } catch { return []; }
}
async function bingNewsCity(addressLabel){
  if (!BING_NEWS_KEY) return [];
  const { city, state } = extractCityState(addressLabel);
  const terms = [
    `${city} ${state} gas station`,
    `${city} ${state} convenience store`,
    `${city} ${state} fueling station`,
    `${city} ${state} planning board gas station`,
    `${city} ${state} site plan gas station`,
    `${city} ${state} EP Mart`
  ];
  const out=[];
  for (const q of terms){
    try{
      const url = `${BING_NEWS_ENDPOINT}?q=${encodeURIComponent(q)}&count=20&freshness=Year`;
      const r = await fetchWithTimeout(url, { headers: { "Ocp-Apim-Subscription-Key": BING_NEWS_KEY, "User-Agent": UA, Accept: "application/json" } }, 20000);
      const j = await r.json();
      const arr = Array.isArray(j.value) ? j.value : [];
      for (const it of arr) out.push({ name:(it.name||"").slice(0,160), status:"news", approx_miles:null, link:it.url||null, source:"bing-news" });
    }catch{}
  }
  const seen=new Set(), ded=[]; for(const i of out){ const k=`${(i.name||"").toLowerCase()}|${i.link||""}`; if(seen.has(k)) continue; seen.add(k); ded.push(i); }
  return ded.slice(0,60);
}
async function bingWebPermits(addressLabel){
  if (!BING_NEWS_KEY) return [];
  const { city, state } = extractCityState(addressLabel);
  const q = [
    `${city} ${state} gas station permit`,
    `${city} ${state} planning board agenda gas station`,
    `${city} ${state} site plan review convenience store`,
    `${city} ${state} EP Mart permit`,
    `${city} ${state} fuel station rezoning`
  ].join(" OR ");
  try{
    const url = `${BING_WEB_ENDPOINT}?q=${encodeURIComponent(q)}&count=25`;
    const r = await fetchWithTimeout(url, { headers: { "Ocp-Apim-Subscription-Key": BING_NEWS_KEY } }, 20000);
    const j = await r.json();
    const arr = j.webPages?.value || [];
    return arr.map(it => ({ name:(it.name||"").slice(0,160), status:"permit/search", approx_miles:null, link:it.url||null, source:"bing-web" }));
  }catch{ return []; }
}
async function overpassDevelopments(lat, lon){
  const rM = Math.round(5 * 1609.344);
  const q = `[out:json][timeout:25];
    ( node(around:${rM},${lat},${lon})["amenity"="fuel"]["proposed"];
      way(around:${rM},${lat},${lon})["amenity"="fuel"]["proposed"];
      node(around:${rM},${lat},${lon})["amenity"="fuel"]["construction"];
      way(around:${rM},${lat},${lon})["amenity"="fuel"]["construction"]; );
    out center tags;`;
  try{
    const j = await overpassQuery(q);
    const els = j.elements||[];
    return els.map(e=>{
      const t=e.tags||{};
      const n=t.name||t.brand||"Fuel (proposed/construction)";
      const latc=e.lat ?? e.center?.lat; const lonc=e.lon ?? e.center?.lon;
      const miles = (Number.isFinite(latc)&&Number.isFinite(lonc)) ? +distMiles(lat,lon,latc,lonc).toFixed(3) : null;
      return { name:n, status:t.proposed?"proposed":"construction", approx_miles:miles, link:null, source:"overpass" };
    });
  }catch{ return []; }
}
async function exhaustiveDevelopments(addressLabel, lat, lon){
  const base = { address: addressLabel, lat, lon, ...extractCityState(addressLabel) };

  const [newsJson, permitsJson] = await Promise.all([
    Promise.all(NEWS_URLS.map(t => queryExternalJSON(t, base).catch(()=>[]))).then(a=>a.flat()),
    Promise.all(PERMIT_URLS.map(t => queryExternalJSON(t, base).catch(()=>[]))).then(a=>a.flat())
  ]);

  const [permHtml, newsBing, webPermits, osmDev] = await Promise.all([
    Promise.all(PERMIT_HTML_URLS.map(u => scrapePermitHTML(u).catch(()=>[]))).then(a=>a.flat()),
    bingNewsCity(addressLabel).catch(()=>[]),
    bingWebPermits(addressLabel).catch(()=>[]),
    overpassDevelopments(lat, lon).catch(()=>[])
  ]);

  const dedupe = arr => {
    const seen=new Set(), out=[];
    for (const it of arr){
      const k = `${(it.name||"").toLowerCase()}|${it.link||""}|${it.status||""}`;
      if (seen.has(k)) continue; seen.add(k); out.push(it);
    }
    return out;
  };
  return {
    news: dedupe([...newsJson, ...newsBing]).slice(0,80),
    permits: dedupe([...permitsJson, ...permHtml, ...webPermits]).slice(0,80),
    osm: dedupe(osmDev).slice(0,40)
  };
}

/* ───────────────────────────── Google endpoints ───────────────────────── */
async function googleAutocomplete(input){
  if (!GOOGLE_API_KEY) return { ok:false, status:"MISSING_KEY", error:"GOOGLE_API_KEY not set", items:[] };
  const au = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:us&key=${GOOGLE_API_KEY}`;
  const ar = await fetchWithTimeout(au, { headers:{ "User-Agent": UA, Accept:"application/json" } }, 15000);
  const at = await ar.text(); if (!ar.ok) return { ok:false, status:`HTTP_${ar.status}`, error:at.slice(0,200), items:[] };
  let aj; try{ aj = JSON.parse(at); }catch{ return { ok:false, status:"PARSE_ERROR", error:at.slice(0,200), items:[] }; }
  if (aj.status!=="OK" && aj.status!=="ZERO_RESULTS") return { ok:false, status:aj.status, error:aj.error_message||"No details", items:[] };

  const preds = aj.predictions||[]; const items=[];
  for (const p of preds.slice(0,6)){
    const pid = p.place_id; if (!pid) continue;
    const du = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${pid}&fields=formatted_address,geometry,name,place_id,types&key=${GOOGLE_API_KEY}`;
    try{
      const dr = await fetchWithTimeout(du, { headers:{ "User-Agent": UA, Accept:"application/json" } }, 15000);
      const dj = await dr.json(); if (dj.status!=="OK") continue;
      const loc = dj.result?.geometry?.location;
      if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
        items.push({ type:"Google", display:dj.result.formatted_address || dj.result.name || p.description, lat:+loc.lat, lon:+loc.lng, place_id: dj.result.place_id || pid, score:1.3 });
      }
    }catch{}
  }
  return { ok:true, status:"OK", items };
}
app.get("/google/status", async (_req, res) => {
  try {
    const probe = await googleAutocomplete("1600 Amphitheatre Parkway, Mountain View, CA");
    if (probe && probe.ok) return res.json({ ok:true, status:"WORKING" });
    return res.json({ ok:false, status: probe?.status || "ERROR", error: probe?.error || "Unknown" });
  } catch (e) { return res.json({ ok:false, status:"EXCEPTION", error:String(e) }); }
});
app.get("/google/autocomplete", async (req, res) => {
  const q = String(req.query.input||"").trim();
  if (!q) return res.json({ ok:false, status:"BAD_REQUEST", items:[] });
  const data = await googleAutocomplete(q); return res.json(data);
});
app.get("/google/findplace", async (req, res) => {
  try {
    const input = String(req.query.input||"").trim();
    if (!GOOGLE_API_KEY) return res.json({ ok:false, status:"MISSING_KEY" });
    if (!input) return res.json({ ok:false, status:"BAD_REQUEST" });
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(input)}&inputtype=textquery&fields=place_id,name,formatted_address,geometry&key=${GOOGLE_API_KEY}`;
    const r = await fetchWithTimeout(url, { headers:{ "User-Agent": UA, Accept:"application/json" } }, 15000);
    const j = await r.json(); const cand = (j.candidates||[])[0];
    if (!cand?.place_id) return res.json({ ok:false, status:j.status||"ZERO_RESULTS" });
    return res.json({ ok:true, status:"OK", place_id:cand.place_id, name:cand.name, address:cand.formatted_address, location:cand.geometry?.location||null });
  } catch(e){ return res.json({ ok:false, status:"EXCEPTION", error:String(e) }); }
});
app.get("/google/rating", async (req, res) => {
  try {
    const place_id = String(req.query.place_id||"").trim();
    if (!GOOGLE_API_KEY) return res.json({ ok:false, status:"MISSING_KEY" });
    if (!place_id) return res.json({ ok:false, status:"BAD_REQUEST" });
    const fields = ["name","formatted_address","rating","user_ratings_total","url"].join(",");
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place_id)}&fields=${encodeURIComponent(fields)}&key=${GOOGLE_API_KEY}`;
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept:"application/json" } }, 15000);
    const j = await r.json(); if (j.status!=="OK") return res.json({ ok:false, status:j.status||"ERROR", error:j.error_message||null });
    const resu = j.result || {};
    return res.json({ ok:true, status:"OK", name:resu.name||null, address:resu.formatted_address||null, rating:resu.rating||null, total:resu.user_ratings_total||0, url:resu.url||null });
  } catch(e){ return res.json({ ok:false, status:"EXCEPTION", error:String(e) }); }
});

/* ───────────────────────────── Gallons calc (rules) ───────────────────── */
function gallonsWithRules({ aadt, mpds, diesel, compCount, heavyCount, pricePosition, userExtrasMult = 1.0 }) {
  // Baseline ceiling — AADT × 2% × 8 × 30
  const baselineMonthly = aadt * 0.02 * 8 * 30;

  // Competition: 0=100%, 1=75%, 2–4=60%
  let baseMult = 1.0;
  if (compCount === 1) baseMult = 0.75;
  else if (compCount >= 2 && compCount <= 4) baseMult = 0.60;

  // Heavy brand penalty
  let extraPenalty = 0.0;
  if (heavyCount === 1) extraPenalty = 0.20;
  else if (heavyCount >= 2) extraPenalty = 0.35;

  const compMult = Math.max(0.20, baseMult - extraPenalty);

  // Apply comp to baseline ONLY
  let afterComp = baselineMonthly * compMult;

  // Equipment / hard caps
  const capEquip = (mpds * 25 * 10.5 * 24) * (365/12) + ((diesel||0) * 25 * 16 * 24) * (365/12);
  const SOFT = 22000, HARD = 28000;
  const capSoftTotal = mpds * SOFT, capHardTotal = mpds * HARD;
  let capped = Math.min(afterComp, capEquip, capHardTotal);
  if (afterComp > capSoftTotal) capped = Math.round(capped * 0.90);

  // Pricing position vs area
  let priceMult = 1.0;
  if (pricePosition === "below") priceMult = 1.10;
  else if (pricePosition === "above") priceMult = 0.90;

  // Apply extras; never exceed baseline ceiling
  const base = Math.min(Math.round(capped * priceMult * userExtrasMult), Math.round(baselineMonthly));

  return {
    base,
    low: Math.round(base * 0.86),
    high: Math.round(base * 1.06),
    year2: Math.round(base * 1.027),
    year3: Math.round(base * 1.027 * 1.0125),
    cap: Math.round(Math.min(capEquip, capHardTotal)),
    floor: Math.round(baselineMonthly),
    compMult
  };
}

/* ───────────────────────────── /estimate API ──────────────────────────── */
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel, siteLat, siteLon, aadtOverride, advanced } = req.body || {};
    const MPDS = +mpds, DIESEL = +(diesel || 0);
    if (!Number.isFinite(MPDS) || MPDS <= 0) return res.status(400).json({ error: "Regular MPDs required (>0)" });
    if (!address && !(Number.isFinite(siteLat) && Number.isFinite(siteLon))) return res.status(400).json({ error: "Address or coordinates required" });

    const pricePosition = String(advanced?.price_position || "inline");

    // Location
    let geo;
    if (Number.isFinite(siteLat) && Number.isFinite(siteLon)) geo = { lat:+siteLat, lon:+siteLon, label: address || `${siteLat}, ${siteLon}` };
    else geo = await geocode(address);

    // Competitors: pull 3 mi once; derive 1.5 mi subset
    const compAll3 = await competitorsWithinRadiusMiles(geo.lat, geo.lon, 3.0).catch(()=>[]);
    const competitors = compAll3.filter(c => c.miles <= 1.5);
    const compCount = competitors.length, heavyCount = competitors.filter(c=>c.heavy).length;
    const ruralEligible = compAll3.length === 0; // no competition within 3 miles

    // Roads
    const roads = await roadContext(geo.lat, geo.lon).catch(()=>({ summary:"", main:[], side:[], signals:0, intersections:0 }));

    // Developments — dynamic
    const { news: devNews, permits: devPermits, osm: devOSM } =
      await exhaustiveDevelopments(address || geo.label, geo.lat, geo.lon);

    // AADT
    let usedAADT = 10000, method = "fallback_default";
    const overrideVal = Number(aadtOverride);
    if (Number.isFinite(overrideVal) && overrideVal > 0) {
      usedAADT = Math.round(overrideVal); method = "override";
    } else {
      let sta = await queryCustomTraffic(geo.lat, geo.lon, address).catch(()=>null);
      if (!sta) sta = await queryNCDOTNearestAADT(geo.lat, geo.lon, 1609).catch(()=>null);
      let dotAADT = sta ? sta.aadt : null;
      const heur = heuristicAADT(roads);
      const comps=[]; if (Number.isFinite(dotAADT)) comps.push({v:dotAADT,w:1.0,label:"DOT"});
      if (Number.isFinite(heur)) comps.push({v:heur,w:0.7,label:"HEUR"});
      if (comps.length){ const sumW=comps.reduce((s,c)=>s+c.w,0); usedAADT=Math.round(comps.reduce((s,c)=>s+c.v*c.w,0)/Math.max(0.0001,sumW)); method="blend_"+comps.map(c=>c.label).join("+").toLowerCase(); }
    }

    // Extras & flags
    let userExtrasMult = 1.0;
    const extras = (advanced && Array.isArray(advanced.extra) ? advanced.extra : [])
      .map(e=>({ pct:+e?.pct, note:String(e?.note||"").slice(0,180) }))
      .filter(e => Number.isFinite(e.pct));
    if (extras.length) userExtrasMult *= extras.reduce((m,e)=>m*(1+e.pct/100),1.0);

    // Rural bonus flag: only apply if requested AND eligible (no comps within 3 mi)
    const ruralRequested = !!(advanced && advanced.flags && advanced.flags.rural === true);
    const ruralApplied = ruralRequested && ruralEligible;
    if (ruralApplied) userExtrasMult *= 1.30;

    // Gallons (baseline ceiling ALWAYS enforced)
    const calc = gallonsWithRules({
      aadt: usedAADT, mpds: MPDS, diesel: DIESEL,
      compCount, heavyCount, pricePosition, userExtrasMult
    });

    // Summary (ALWAYS non-empty)
    const notable = competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name).join(", ") || "none";
    const summary = await gptSummary({
      address: address || geo.label, aadt: usedAADT, method, roads,
      compCount, heavyCount, notable, pricePosition,
      base: calc.base, low: calc.low, high: calc.high,
      devNews: (devNews||[]).slice(0,4).map(x=>x.name).join("; "),
      devPermits: (devPermits||[]).slice(0,4).map(x=>x.name).join("; ")
    });

    return res.json({
      base: calc.base, low: calc.low, high: calc.high, year2: calc.year2, year3: calc.year3,
      inputs: {
        mpds: MPDS, diesel: DIESEL, aadt_used: usedAADT, price_position: pricePosition,
        aadt_components: { method }
      },
      flags: { rural_bonus_applied: ruralApplied, rural_eligible: ruralEligible },
      competition: { count: compCount, nearest_mi: competitors[0]?.miles ?? null, notable_brands: competitors.filter(c=>c.heavy).slice(0,6).map(c=>c.name) },
      developments: devOSM,
      developments_external: { news: devNews, permits: devPermits },
      roads,
      summary,
      map: { site: { lat: geo.lat, lon: geo.lon, label: geo.label }, competitors }
    });
  } catch (e) {
    return res.status(500).json({ error: "Estimate failed", detail: String(e) });
  }
});

/* ───────────────────────────── Start server ───────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server listening on :${PORT}`));
