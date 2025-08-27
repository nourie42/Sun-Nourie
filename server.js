// server.js (CommonJS) — ChatGPT-powered estimator backend
'use strict';

const express = require('express');
const app = express();
app.use(express.json());

// Use node-fetch explicitly (stable on Render)
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Small robust fetch (timeout + retry + UA)
async function robustFetch(url, { method='GET', headers={}, body, timeoutMs=9000, retries=1 } = {}) {
  const baseHeaders = { 'Accept':'application/json', 'User-Agent':'SunNourie/1.0 (Render)', ...headers };
  for (let i=0;i<=retries;i++){
    const controller = new AbortController(); const to = setTimeout(()=>controller.abort(), timeoutMs);
    try { const r = await fetch(url,{ method, headers:baseHeaders, body, signal:controller.signal }); clearTimeout(to); return r; }
    catch(e){ clearTimeout(to); if (i===retries) throw e; await new Promise(r=>setTimeout(r,600)); }
  }
}

// ---------- CORS ----------
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type, Authorization');
  if (req.method==='OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Health ----------
app.get('/', (_req,res)=>res.send('OK'));

// ---------- Helper: Google Geocode / Places / TextSearch ----------
async function geocodeAddress(address){
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const r = await robustFetch(url); const j = await r.json();
  if (j.status !== 'OK' || !j.results?.length) throw new Error('Geocode failed');
  const { lat, lng } = j.results[0].geometry.location;
  return { lat, lng, formatted_address: j.results[0].formatted_address };
}
async function getPlaces(lat,lng,radiusM=1609){
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusM}&type=gas_station&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const r = await robustFetch(url); const j = await r.json(); return Array.isArray(j.results)?j.results:[];
}
async function getDevelopments(lat,lng,radiusM=5000){
  const Q = [
    'planned gas station','proposed gas station','gas station permit',
    'gas station construction','coming soon gas station'
  ];
  const WANT=/(planned|permit|site plan|coming soon|construction|proposed)/i, AVOID=/(closed|permanently)/i;
  const merged=[]; const seen=new Set();
  for (const q of Q){
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&location=${lat},${lng}&radius=${radiusM}&language=en&region=us&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await robustFetch(url); const j = await r.json();
    for (const it of (j.results||[])){
      if (!it.place_id || seen.has(it.place_id)) continue; seen.add(it.place_id);
      const name = (it.name || it.formatted_address || '');
      if (WANT.test(name) && !AVOID.test(name)) merged.push(it);
    }
  }
  return merged;
}

// ---------- Helper: AADT from NCDOT ArcGIS (stations + lines; nearest) ----------
const ARCGIS_STATIONS = 'https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0/query';
const ARCGIS_LINES    = 'https://services.ncdot.gov/arcgis/rest/services/Traffic_Safety/TrafficVolumeMap/MapServer/0/query';
function toRad(x){ return x*Math.PI/180; }
function havMi(aLat,aLng,bLat,bLng){ const R=3958.761, dA=toRad(bLat-aLat), dO=toRad(bLng-aLng);
  const A=Math.sin(dA/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dO/2)**2; return 2*R*Math.asin(Math.sqrt(A)); }
async function arcgisQuery(url, lat,lng, outFields='*', searchM=10000){
  const body = new URLSearchParams({
    f:'json', where:'1=1', outFields, geometry:`${lng},${lat}`, geometryType:'esriGeometryPoint', inSR:'4326',
    spatialRel:'esriSpatialRelIntersects', distance:String(searchM), units:'esriSRUnit_Meter', returnGeometry:'true', resultRecordCount:'250'
  });
  const r = await robustFetch(url,{ method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body });
  const text = await r.text(); if (!r.ok) throw new Error(`ArcGIS ${r.status}: ${text.slice(0,160)}`); return JSON.parse(text);
}
function pickAADT(attrs){ return Number(attrs?.AADT ?? attrs?.AADT_2022 ?? attrs?.AADT_2021 ?? attrs?.AADT_2020 ?? attrs?.AADT2WAY ?? attrs?.VOLUME ?? attrs?.AADT_VALUE); }
function pickYEAR(attrs){ return attrs?.YEAR_ ?? attrs?.AADT_YEAR ?? attrs?.YEAR ?? null; }
async function getNearestAADT(lat,lng){
  try{
    const ptsJ = await arcgisQuery(ARCGIS_STATIONS, lat,lng, 'AADT,YEAR_,OBJECTID');
    const lnsJ = await arcgisQuery(ARCGIS_LINES,    lat,lng, '*');

    const cands=[];
    for (const f of (ptsJ.features||[])){
      const g=f.geometry; if (typeof g?.y!=='number'||typeof g?.x!=='number') continue;
      const distMi=havMi(lat,lng,g.y,g.x); const a=Number(f.attributes?.AADT), y=f.attributes?.YEAR_;
      if (Number.isFinite(a)&&a>0) cands.push({ aadt:a, year:y, layer:'NCDOT AADT Stations', distMi });
    }
    for (const f of (lnsJ.features||[])){
      const g=f.geometry; let samples=[];
      if (Array.isArray(g?.paths?.[0])) samples=g.paths[0].slice(0,3);
      else if (typeof g?.y==='number'&&typeof g?.x==='number') samples=[[g.x,g.y]];
      let minMi=Infinity; for (const p of samples){ const x=+p[0], y=+p[1]; if (Number.isFinite(x)&&Number.isFinite(y)) minMi=Math.min(minMi, havMi(lat,lng,y,x)); }
      const a=pickAADT(f.attributes), y=pickYEAR(f.attributes);
      if (Number.isFinite(a)&&a>0&&minMi<Infinity) cands.push({ aadt:a, year:y, layer:'NCDOT Traffic Volume Map', distMi:minMi });
    }
    if (!cands.length) return null;
    cands.sort((a,b)=> a.distMi-b.distMi || (b.year??0)-(a.year??0) || (b.aadt??0)-(a.aadt??0));
    const best=cands[0];
    return { aadt:best.aadt, year:best.year??null, distance_m:Math.round(best.distMi*1609.344), layer:best.layer, candidates:cands.length };
  }catch{ return null; }
}

// ---------- /estimate — main endpoint called by the website ----------
app.post('/estimate', async (req,res)=>{
  try{
    const address = String(req.body.address||'').trim();
    const mpds   = Number(req.body.mpds||0);
    const diesel = Number(req.body.diesel||0);
    if (!address || !Number.isFinite(mpds)) return res.status(400).json({ error:'Provide address and mpds' });

    // 1) Base data pulls
    const geo = await geocodeAddress(address);
    const aadtInfo = await getNearestAADT(geo.lat, geo.lng);                 // may be null
    const comps = await getPlaces(geo.lat, geo.lng, 1609);                   // ~1 mile
    const devs  = await getDevelopments(geo.lat, geo.lng, 4828);             // ~3 miles

    // 2) Build compact facts for GPT
    function nearestMi(list){ if (!list?.length) return null;
      let m=Infinity; for (const r of list){ const ll=r.geometry?.location; if (!ll) continue; const d=havMi(geo.lat,geo.lng,ll.lat,ll.lng); if (d<m) m=d; } return Number.isFinite(m)?m:null; }
    const premium=/\b(wawa|sheetz|quik\s?trip|qt|racetrac|buc|costco|sam'?s|bj's)\b/i;
    const facts = {
      address_input: address,
      address_geocoded: geo.formatted_address,
      coords: { lat: geo.lat, lng: geo.lng },
      mpds_regular: mpds, diesel_positions: diesel,
      aadt: aadtInfo?.aadt ?? null, aadt_year: aadtInfo?.year ?? null, aadt_source: aadtInfo?.layer ?? null, aadt_distance_m: aadtInfo?.distance_m ?? null,
      comps_count_1mi: comps.length,
      comps_nearest_mi: nearestMi(comps),
      comps_premium_count: comps.filter(c=>premium.test(c.name||'')).length,
      dev_count_3mi: devs.length,
      dev_examples: devs.slice(0,5).map(d=>d.name)
    };

    // 3) Ask OpenAI to estimate gallons using your house rules
    const sys = `You are an expert fuel-site estimator. Given address, MPDs, traffic (AADT), nearby competition (1 mile), and planned developments, estimate monthly gallons.

Rules:
- Start with AADT (if null, infer from context and comps count).
- Use autos stop ~2.0%, trucks stop ~1.2%. Autos ~10.2 gal/stop, trucks ~16 gal/stop.
- Apply availability from frontage/turns if given; if absent, assume moderate access.
- Competition: 1/d distance-decay, with heavy penalty for competitors within 0.03 miles; small premium-brand uplift (Wawa, Sheetz, QT, RaceTrac, Buc-ee’s, Costco, Sam’s, BJ’s).
- Capacity sanity check: positions × 25 cycles/day × (10.5 auto, 16 diesel) × 365/12; cap if needed.
- Output Year-1, Low/High band (−14% / +6%), Year-2 (+2.7%), Year-3 (+1.25%).
- Be concise and numeric.`;

    const user = {
      instruction: "Estimate gallons for this prospect, then provide a short numeric rationale and list assumptions.",
      facts
    };

    const oaiBody = {
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: sys },
        { role: "user",   content: JSON.stringify(user) }
      ]
    };

    const r = await robustFetch("https://api.openai.com/v1/responses", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(oaiBody),
      timeoutMs: 20000
    });
    const data = await r.json().catch(async()=>({ raw: await r.text() }));

    // Prefer output_text if provided
    const text = data.output_text || (Array.isArray(data.output) ? data.output.map(o => (o.content||[]).map(p=>p.text||'').join('')).join('\n') : JSON.stringify(data));

    res.json({ ok: true, text, facts });
  }catch(e){
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`✅ ChatGPT Estimator backend running on ${PORT}`));
