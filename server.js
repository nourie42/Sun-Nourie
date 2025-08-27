// server.js (CommonJS) — Backend for Gallons Estimator
'use strict';

const express = require('express');
const app = express();
app.use(express.json());

// Use node-fetch explicitly (reliable on Render)
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Small robust fetch (timeout + retry + UA)
async function robustFetch(url, { method='GET', headers={}, body, timeoutMs=9000, retries=1 } = {}) {
  const baseHeaders = { 'Accept':'application/json', 'User-Agent':'SunNourie/1.0 (Render)', ...headers };
  for (let i=0;i<=retries;i++){
    const controller = new AbortController(); const to = setTimeout(()=>controller.abort(), timeoutMs);
    try{ const r = await fetch(url,{ method, headers:baseHeaders, body, signal:controller.signal }); clearTimeout(to); return r; }
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

// ---------- Geocode (Google) ----------
app.get('/geocode', async (req,res)=>{
  try{
    const address = String(req.query.address||'');
    if (!address) return res.status(400).json({ error:'Missing address' });
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await robustFetch(url); const j = await r.json().catch(async()=>({ raw: await r.text() }));
    res.status(r.ok?200:r.status).json(j);
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

// ---------- Competition (Google Places Nearby: gas_station) ----------
app.get('/places', async (req,res)=>{
  try{
    const { lat, lng, radius=1609 } = req.query; // ~1 mile
    if (!lat || !lng) return res.status(400).json({ error:'Missing lat/lng' });
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=gas_station&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await robustFetch(url); const j = await r.json().catch(async()=>({ raw:await r.text() }));
    res.status(r.ok?200:r.status).json(j);
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

// ---------- Planned/Proposed Developments (Google Places Text Search) ----------
app.get('/developments', async (req,res)=>{
  try{
    const { lat, lng, radius=5000 } = req.query; // meters
    if (!lat || !lng) return res.status(400).json({ error:'Missing lat/lng' });
    const QUERIES = [
      'planned gas station','proposed gas station','gas station permit',
      'gas station construction','coming soon gas station'
    ];
    const WANT = /(planned|permit|site plan|coming soon|construction|proposed)/i;
    const AVOID = /(permanently closed|closed)/i;

    async function textSearch(q){
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&location=${lat},${lng}&radius=${radius}&language=en&region=us&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const r = await robustFetch(url); if (!r.ok) return [];
      const j = await r.json().catch(async()=>({ results:[], raw:await r.text() }));
      return Array.isArray(j.results) ? j.results : [];
    }

    const seen = new Set(); const merged=[];
    for (const q of QUERIES){
      const out = await textSearch(q);
      for (const it of out){
        if (!it.place_id || seen.has(it.place_id)) continue; seen.add(it.place_id);
        const name = (it.name || it.formatted_address || '');
        if (WANT.test(name) && !AVOID.test(name)) merged.push(it);
      }
    }
    res.json({ results: merged });
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

// ---------- AADT (NCDOT: stations + lines; POST; nearest by haversine) ----------
app.get('/aadt', async (req,res)=>{
  try{
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error:'Missing lat/lng' });

    const STATIONS = 'https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0/query';
    const LINES    = 'https://services.ncdot.gov/arcgis/rest/services/Traffic_Safety/TrafficVolumeMap/MapServer/0/query';
    const SEARCH_M=10000; // 10 km
    const toRad=x=>x*Math.PI/180;
    const havMi=(aLat,aLng,bLat,bLng)=>{const R=3958.761,dA=toRad(bLat-aLat),dO=toRad(bLng-aLng);
      const A=Math.sin(dA/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dO/2)**2;return 2*R*Math.asin(Math.sqrt(A));};

    async function queryArcGIS(url,outFields){
      const body = new URLSearchParams({
        f:'json', where:'1=1', outFields, geometry:`${lng},${lat}`,
        geometryType:'esriGeometryPoint', inSR:'4326', spatialRel:'esriSpatialRelIntersects',
        distance:String(SEARCH_M), units:'esriSRUnit_Meter', returnGeometry:'true', resultRecordCount:'250'
      });
      const r = await robustFetch(url,{ method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body, timeoutMs:10000 });
      const text = await r.text(); if (!r.ok) throw new Error(`ArcGIS HTTP ${r.status}: ${text.slice(0,180)}`);
      try{ return JSON.parse(text); }catch(e){ throw new Error(`ArcGIS parse error: ${text.slice(0,180)}`); }
    }

    const ptsJ = await queryArcGIS(STATIONS,'AADT,YEAR_,OBJECTID');
    const lnsJ = await queryArcGIS(LINES,'*');

    const pts = Array.isArray(ptsJ.features)?ptsJ.features:[];
    const lns = Array.isArray(lnsJ.features)?lnsJ.features:[];

    const pickAADT = a => Number(a?.AADT ?? a?.AADT_2022 ?? a?.AADT_2021 ?? a?.AADT_2020 ?? a?.AADT2WAY ?? a?.VOLUME ?? a?.AADT_VALUE);
    const pickYEAR = a => a?.YEAR_ ?? a?.AADT_YEAR ?? a?.YEAR ?? null;

    const cands = [];

    for (const f of pts){
      const g=f.geometry; if (typeof g?.y!=='number'||typeof g?.x!=='number') continue;
      const distMi = havMi(lat,lng,g.y,g.x);
      const aadt = Number(f.attributes?.AADT); const year = f.attributes?.YEAR_;
      if (Number.isFinite(aadt) && aadt>0) cands.push({ aadt, year, distMi, layer:'NCDOT AADT Stations' });
    }

    for (const f of lns){
      const g=f.geometry; let samples=[];
      if (Array.isArray(g?.paths?.[0])) samples=g.paths[0].slice(0,3);
      else if (typeof g?.y==='number' && typeof g?.x==='number') samples=[[g.x,g.y]];
      let minMi=Infinity;
      for (const p of samples){ const x=Number(p[0]), y=Number(p[1]); if (!Number.isFinite(x)||!Number.isFinite(y)) continue;
        const d=havMi(lat,lng,y,x); if (d<minMi) minMi=d; }
      const aadt = pickAADT(f.attributes); const year = pickYEAR(f.attributes);
      if (Number.isFinite(aadt)&&aadt>0&&minMi<Infinity) cands.push({ aadt, year, distMi:minMi, layer:'NCDOT Traffic Volume Map' });
    }

    if (!cands.length) return res.json({ error:'No AADT found nearby', search_m:SEARCH_M });

    cands.sort((a,b)=>{ if(a.distMi!==b.distMi) return a.distMi-b.distMi;
      if((b.year??0)!==(a.year??0)) return (b.year??0)-(a.year??0);
      return (b.aadt??0)-(a.aadt??0); });

    const best=cands[0];
    res.json({ aadt:best.aadt, year:best.year??null, distance_m:Math.round(best.distMi*1609.344), layer:best.layer, candidates_considered:cands.length });
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`✅ Backend running on ${PORT}`));
