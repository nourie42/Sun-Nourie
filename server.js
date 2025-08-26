// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// === REQUIRED ENV VARS ===
// GOOGLE_MAPS_KEY=<your key>
// AADT_LAYER_URL=<ArcGIS FeatureServer layer URL with AADT counts>
//
// Example AADT layer URLs (pick ONE & set it in env):
// - MassDOT (example): https://services.arcgis.com/.../FeatureServer/0
// - NCDOT, SCDOT, GADOT, NHDOT, etc. usually expose ArcGIS FeatureServer layers.
//   You can swap states freely without changing code.

const GMAPS_KEY = process.env.GOOGLE_MAPS_KEY;
const AADT_LAYER_URL = process.env.AADT_LAYER_URL; // must point to the LAYER (…/FeatureServer/0 or similar)

if (!GMAPS_KEY) console.warn("WARN: GOOGLE_MAPS_KEY not set.");
if (!AADT_LAYER_URL) console.warn("WARN: AADT_LAYER_URL not set.");

// --- util: Google geocode ---
async function geocodeAddress(address) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", GMAPS_KEY);

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Geocode HTTP ${r.status}`);
  const j = await r.json();
  if (j.status !== "OK" || !j.results?.length) throw new Error(`Geocode failed: ${j.status}`);
  const { lat, lng } = j.results[0].geometry.location;
  return { lat, lng };
}

// --- util: query nearest AADT segment from an ArcGIS FeatureServer layer ---
async function queryNearestAADT(lat, lon) {
  // ArcGIS "query" with a buffer around the point, returns features with attributes (incl. AADT)
  // We’ll sort by distance client-side and pick the nearest with a valid AADT field.
  const url = new URL(`${AADT_LAYER_URL}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("geometry", JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("distance", "150");         // meters search radius (tweak as needed)
  url.searchParams.set("units", "esriSRUnit_Meter");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outFields", "*");

  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`AADT query HTTP ${r.status}`);
  const j = await r.json();
  const feats = j.features || [];
  if (!feats.length) throw new Error("No AADT segments found near point.");

  // sort by distance to point
  feats.sort((a, b) => {
    const da = distanceMeters(lat, lon, a.geometry?.paths?.[0]?.[0]?.[1] ?? lat, a.geometry?.paths?.[0]?.[0]?.[0] ?? lon);
    const db = distanceMeters(lat, lon, b.geometry?.paths?.[0]?.[0]?.[1] ?? lat, b.geometry?.paths?.[0]?.[0]?.[0] ?? lon);
    return da - db;
  });

  // Try common AADT field names
