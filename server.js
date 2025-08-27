// server.js (CommonJS)
'use strict';

const express = require('express');
const app = express();

app.use(express.json());

// ---------- CORS ----------
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // restrict later if you want
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --------- tiny robust fetch helper (timeout + retry + headers) ----------
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
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 600));
    }
  }
}

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
    const r = await robustFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params, timeoutMs: 8000 });
