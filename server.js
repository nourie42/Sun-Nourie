// server.js (CommonJS) — Robust backend for Prospect Estimator
'use strict';

const express = require('express');
const app = express();

app.use(express.json());

// Use node-fetch explicitly (works with CommonJS via dynamic import)
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Tiny robust fetch helper (timeout + retry + headers)
async function robustFetch(url, { method = 'GET', headers = {}, body, timeoutMs = 8000, retries = 1 } = {}) {
  const baseHeaders = {
    'Accept': 'application/json',
    'User-Agent': 'SunNourie/1.0 (Render)',
    ...headers
  };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { method, headers: baseHeaders, body, signal: controller.signal });
      clearTimeout(timer);
      return r;
    } catch (err) {
      clearTimeout(timer);
      // Log server-side to Render logs for debugging
      console.error('[robustFetch] attempt', attempt, 'url', url, 'err', err?.message || String(err));
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 600)); // simple backoff
    }
  }
}

// ---------- CORS ----------
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // tighten later to your static-site domain if desired
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- Health ----------
app.get('/', (_req, res) => res.send('OK'));

// ---------- Diagnostics ----------
app.get('/diag/httpbin', async (_req, res) => {
  try {
    const r = await robustFetch('https://httpbin.org/get', { timeoutMs: 6000 });
    const text = await r.text();
    res.json({ ok: r.ok, status: r.status, body: text.slice(0, 500) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/diag/arcgis-stations', async (_req, res) => {
  try {
    const url = 'https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0/query';
    const params = new URLSearchParams({
      f: 'json', where: '1=1', outFields: 'AADT,YEAR_', returnGeometry: 'false', resultRecordCount: '1'
    });
    const r = await robustFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      timeoutMs: 8000
    });
    const text = await r.text();
    res.json({ ok: r.ok, status: r.status, snippet: text.slice(0, 400) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- Google Geocoding ----------
app.get('/geocode', async (req, res) => {
  try {
    const address = String(req.query.address || '');
    if (!address) return res.status(400).json({ error: 'Missing address' });
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await robustFetch(url, { timeoutMs: 8000 });
    const j = await r.json().catch(async () => ({ raw: await r.text() }));
    res.status(r.ok ? 200 : r.status).json(j);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- Google Places Nearby (competitors) ----------
app.get('/places', async (req, res) => {
  try {
    const lat = req.query.lat, lng = req.query.lng;
    const radius = Number(req.query.radius || 1609); // ~1 mile
    if (!lat || !lng) return res.status(400).json({ error: 'Missing lat/lng' });
    const url =
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
      `?location=${lat},${lng}&radius=${radius}&type=gas_station` +
      `&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const r = await robustFetch(url, { timeoutMs: 8000 });
    const j = await r.json().catch(async () => ({ raw: await r.text() }));
    res.status(r.ok ? 200 : r.status).json(j);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- Google Places Text Search (planned/proposed developments) ----------
app.get('/developments', async (req, res) => {
  try {
    const lat = req.query.lat, lng = req.query.lng;
    const radius = Number(req.query.radius || 5000);
    if (!lat || !lng) return res.status(400).json({ error: 'Missing lat/lng' });

    const QUERIES = [
      'planned gas station',
      'gas station permit',
      'proposed gas station',
      'gas station construction',
      'coming soon gas station'
    ];
    const WANT = /(planned|permit|site plan|coming soon|construction|proposed)/i;
    const AVOID = /(permanently closed|closed)/i;

    async function textSearch(q) {
      const url =
        `https://maps.googleapis.com/maps/api/place/textsearch/json` +
        `?query=${encodeURIComponent(q)}&location=${lat},${lng}` +
        `&radius=${radius}&language=en&region=us` +
        `&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const r = await robustFetch(url, { timeoutMs: 8000 });
      if (!r.ok) return [];
      const j = await r.json().catch(async () => ({ results: [], raw: await r.text() }));
      return Array.isArray(j.results) ? j.results : [];
    }

    const seen = new Set();
    const merged = [];
    for (const q of QUERIES) {
      const out = await textSearch(q);
      for (const it of out) {
        if (!it.place_id || seen.has(it.place_id)) continue;
        seen.add(it.place_id);
        const name = (it.name || it.formatted_address || '');
        if (WANT.test(name) && !AVOID.test(name)) merged.push(it);
      }
    }
    res.json({ results: merged });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------- AADT (NCDOT) NEAREST: stations + lines; POST + timeout/retry + verbose logging ----------
app.get('/aadt', async (req, res) => {
  try {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Missing lat/lng' });
    }

    // NCDOT endpoints
    const STATIONS = 'https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Stations/FeatureServer/0/query';
    const LINES    = 'https://services.ncdot.gov/arcgis/rest/services/Traffic_Safety/TrafficVolumeMap/MapServer/0/query';

    // Large window; compute true nearest
    const SEARCH_M = 10000; // 10 km
    const OUT_PTS  = 'AADT,YEAR_,OBJECTID';
    const OUT_LNS  = '*';

    const toRad = x => x * Math.PI / 180;
    const havMiles = (aLat, aLng, bLat, bLng) => {
      const R = 3958.761, dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
      const A = Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
      return 2 * R * Math.asin(Math.sqrt(A));
    };

    async function queryArcGIS(url, paramsObj) {
      const body = new URLSearchParams({
        f: 'json',
        where: '1=1',
        geometry: `${lng},${lat}`,
        geometryType: 'esriGeometryPoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        distance: String(SEARCH_M),
        units: 'esriSRUnit_Meter',
        returnGeometry: 'true',
        resultRecordCount: '250',
        ...paramsObj
      });
      try {
        const r = await robustFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          timeoutMs: 10000,
          retries: 1
        });
        const text = await r.text();
        if (!r.ok) {
          console.error('[AADT] ArcGIS HTTP', r.status, 'url', url, 'body:', text.slice(0,200));
          throw new Error(`ArcGIS HTTP ${r.status}`);
        }
        try { return JSON.parse(text); }
        catch (e) {
          console.error('[AADT] ArcGIS JSON parse error from', url, 'snippet:', text.slice(0,200));
          throw e;
        }
      } catch (err) {
        console.error('[AADT] ArcGIS fetch failed for', url, '::', err?.message || String(err));
        throw err;
      }
    }

    // Query both layers
    const ptsResp = await queryArcGIS(STATIONS, { outFields: OUT_PTS });
    const lnResp  = await queryArcGIS(LINES,    { outFields: OUT_LNS });

    const pts = Array.isArray(ptsResp?.features) ? ptsResp.features : [];
    const lns = Array.isArray(lnResp?.features)  ? lnResp.features  : [];

    const candidates = [];

    // Points (stations)
    for (const f of pts) {
      const g = f.geometry;
      if (typeof g?.y !== 'number' || typeof g?.x !== 'number') continue; // (y=lat, x=lng)
      const distMi = havMiles(lat, lng, g.y, g.x);
      const aadt = Number(f.attributes?.AADT);
      const year = f.attributes?.YEAR_;
      if (Number.isFinite(aadt) && aadt > 0) {
        candidates.push({ aadt, year, distMi, layer: 'NCDOT AADT Stations' });
      }
    }

    // Lines (traffic volume map)
    const pickAADT = a => Number(
      a?.AADT ?? a?.AADT_2022 ?? a?.AADT_2021 ?? a?.AADT_2020 ??
      a?.AADT2WAY ?? a?.VOLUME ?? a?.AADT_VALUE
    );
    const pickYEAR = a => a?.YEAR_ ?? a?.AADT_YEAR ?? a?.YEAR ?? null;

    for (const f of lns) {
      const g = f.geometry;
      let samples = [];
      if (Array.isArray(g?.paths?.[0])) samples = g.paths[0].slice(0, 3); // sample first few vertices
      else if (typeof g?.y === 'number' && typeof g?.x === 'number') samples = [[g.x, g.y]]; // centroid fallback

      let minMi = Infinity;
      for (const p of samples) {
        const x = Number(p[0]), y = Number(p[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const d = havMiles(lat, lng, y, x);
        if (d < minMi) minMi = d;
      }

      const aadt = pickAADT(f.attributes);
      const year = pickYEAR(f.attributes);
      if (Number.isFinite(aadt) && aadt > 0 && minMi < Infinity) {
        candidates.push({ aadt, year, distMi: minMi, layer: 'NCDOT Traffic Volume Map' });
      }
    }

    if (!candidates.length) {
      console.warn('[AADT] No candidates near', lat, lng, 'within', SEARCH_M, 'm');
      return res.json({ error: 'No AADT found nearby', search_m: SEARCH_M });
    }

    // Sort by nearest, then newest year, then higher AADT
    candidates.sort((a, b) => {
      if (a.distMi !== b.distMi) return a.distMi - b.distMi;
      if ((b.year ?? 0) !== (a.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0);
      return (b.aadt ?? 0) - (a.aadt ?? 0);
    });

    const best = candidates[0];
    res.json({
      aadt: best.aadt,
      year: best.year ?? null,
      distance_m: Math.round(best.distMi * 1609.344),
      layer: best.layer,
      candidates_considered: candidates.length
    });
  } catch (err) {
    console.error('[AADT] Fatal error:', err?.message || String(err));
    res.status(500).json({ error: String(err) });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
