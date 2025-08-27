// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public")); // serve /public

// ---------- helpers ----------
function jerr(res, code, msg, detail) {
  console.error("[ERROR]", code, msg, detail || "");
  return res.status(code).json({ error: msg, detail });
}

function ua() {
  return {
    "User-Agent": "SunNourie-Gallons-Estimator/1.0 (+contact: app@sun-estimator.example)",
    "Accept": "application/json"
  };
}

async function safeJSON(r) {
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`JSON parse failed: ${text.slice(0,400)}`); }
  return data;
}

// ---------- geocode (OSM Nominatim; no key required) ----------
async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const r = await fetch(url, { headers: ua() });
  if (!r.ok) throw new Error(`Nominatim ${r.status}: ${await r.text()}`);
  const arr = await safeJSON(r);
  if (!arr?.length) throw new Error("No geocode result");
  const { lat, lon, display_name } = arr[0];
  return { lat: Number(lat), lng: Number(lon), label: display_name };
}

// ---------- Overpass helpers ----------
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

async function overpass(query) {
  let lastErr;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(ep, {
        method: "POST",
        headers: {
          ...ua(),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "data=" + encodeURIComponent(query)
      });
      if (!r.ok) throw new Error(`Overpass ${r.status}: ${await r.text()}`);
      return await safeJSON(r);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---------- AADT estimate from nearest highway ----------
const HIGHWAY_AADT_TABLE =

