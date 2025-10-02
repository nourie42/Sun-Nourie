/**
 * Sun‑Nourie Fuel IQ — Pulse QC Build
 * FULL server.js (Express backend)
 *
 * Restores address-first flow (no lat/lng required),
 * keeps PDF export styling/contents, ProspectScore, and all‑state AADT loading.
 *
 * Endpoints:
 *   GET  /api/health
 *   GET  /api/geocode?q=<address>               (address -> lat/lng; Google if key present, else Nominatim)
 *   GET  /api/aadt/nearby?lat=&lng=
 *   GET  /api/aadt/states
 *   GET  /api/competitors?lat=&lng=&radius=     (defaults to 1.5 mi)
 *   POST /api/analyze                           ({lat,lng} OR {address}, options)
 *   POST /api/export/pdf                        (analysis payload -> PDF)
 *   POST /api/export/excel                      (analysis payload -> .xlsx)
 *   (static) /                                  serves public/index.html + assets
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const YAML = require('yaml');
const turf = require('@turf/turf');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { parse: csvParse } = require('csv-parse/sync');

// Node 18+ has global fetch; if not, fallback to node-fetch
let fetchFn = global.fetch;
if (typeof fetchFn !== 'function') {
  try { fetchFn = require('node-fetch'); } catch {}
}

/* ------------------------- 01) Config loader -------------------------- */

const CONFIG_PATH = path.join(__dirname, 'config.yaml');
let CONFIG = {
  meta: { app_name: 'Sun‑Nourie Fuel IQ', environment: 'production', log_level: 'info' },
  data_sources: {
    roads_geojson: path.join(__dirname, 'data/state_roads.geojson'),
    aadt_geojson: path.join(__dirname, 'data/aadt.geojson'),
    aadt_states_dir: path.join(__dirname, 'data/aadt_states'), // folder of per-state GeoJSON
    competitors_csv: path.join(__dirname, 'data/competitors.csv'),
    optional_layers: [
      { name: 'ramps_service_roads', path: path.join(__dirname, 'data/ramps_service_roads.geojson'), enabled: true }
    ]
  },
  logic: {
    qc: {
      max_snap_distance_m: 30,
      max_bearing_diff_deg: 25,
      route_normalization: {
        strip_terms: ['BUS','BUSINESS','ALT','ALTERNATE','BY-PASS','BYPASS','SPUR'],
        strip_punctuation: true, collapse_whitespace: true, case: 'upper'
      },
      duplicate_detection: { min_segment_length_m: 45, cluster_tolerance_m: 20 },
      mask: { exclude_ramps: true, exclude_service_roads: true, exclude_private_drives: true },
      required_fields: ['AADT', 'ROUTE']
    },
    gallons: { monthly_formula: 'AADT * 0.02 * 8 * 30', round_to_nearest: 10, min_aadt_for_calc: 100, fail_behavior: 'halt_and_flag' },
    competitors: {
      radius_miles: 1.5,
      brands_to_exclude: [],
      independent_tag_values: ['Independent', 'Unbranded', 'Unknown'],
      chain_tag_values: ['Sunoco','BP','Shell','Exxon','Marathon','Circle K','7-Eleven','Wawa','RaceTrac','Sheetz','QuikTrip','Speedway']
    },
    score: {
      aadt_max: 60,
      comp_pressure_max: 20,
      qc_max: 12,
      mix_max: 8
    }
  },
  api: { timeouts_ms: { analyze: 120000 }, pagination: { competitors_max: 3000 }, rate_limits: { analyze_per_minute: 60 } },
  snapshots: { save_json: true, save_png: false, out_dir: path.join(__dirname, 'snapshots') },
  geocoding: {
    provider: process.env.GOOGLE_GEOCODE_API_KEY ? 'google' : 'nominatim',
    google_api_key: process.env.GOOGLE_GEOCODE_API_KEY || null
  }
};
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const y = YAML.parse(raw);
    CONFIG = { ...CONFIG, ...y };
  }
} catch (e) {
  console.warn('[config] Using defaults (config.yaml not loaded):', e.message);
}

// DOT references appendix for PDF
const STATE_DOT_SOURCES = {
  NC: { roads: 'https://gis.ncdot.gov/roadway/centerline', aadt: 'https://connect.ncdot.gov/resources/traffic' },
  FL: { roads: 'https://gis.fdot.gov/arcgis/rest/services/FDOT/Transportation/MapServer', aadt: 'https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/aadt/latest_aadt.csv' },
  PA: { roads: 'https://www.pasda.psu.edu/uci/DataSummary.aspx?dataset=1690', aadt: 'https://data.penndot.gov/AADT' },
};

/* -------------------------- 02) App + State --------------------------- */

const APP = express();
APP.set('trust proxy', 1);
APP.use(helmet({ crossOriginResourcePolicy: false }));
APP.use(cors());
APP.use(compression());
APP.use(morgan('tiny'));
APP.use(bodyParser.json({ limit: '10mb' }));
APP.use(bodyParser.urlencoded({ extended: true }));

let ROADS = null;        // FeatureCollection
let AADT = null;         // FeatureCollection (merged)
let RAMPS = null;        // optional FeatureCollection
let COMPETITORS = [];    // Array of CSV records with lat/lng

/* ------------------------- 03) Utilities ------------------------------ */

const round = (n, inc=1) => Math.round(n / inc) * inc;
const toRad = (deg) => deg * Math.PI / 180;
const toDeg = (rad) => rad * 180 / Math.PI;
const clamp01 = (x) => (x < 0 ? 0 : (x > 1 ? 1 : x));

function haversineMi(a, b) {
  const R = 3958.7613;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function degBearingFromLine(coords) {
  if (!coords || coords.length < 2) return null;
  const a = coords[0], b = coords[coords.length-1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const br = toDeg(Math.atan2(dy, dx));
  return (br + 360) % 360;
}
function normalizeRouteName(name) {
  if (!name) return null;
  let s = String(name);
  const rn = CONFIG.logic.qc.route_normalization;
  if (rn.case === 'upper') s = s.toUpperCase();
  if (rn.case === 'lower') s = s.toLowerCase();
  if (rn.strip_punctuation) s = s.replace(/[^A-Z0-9 ]/gi, ' ');
  (rn.strip_terms || []).forEach(t => { s = s.replace(new RegExp('\\b' + t + '\\b','gi'), ''); });
  if (rn.collapse_whitespace) s = s.replace(/\s+/g, ' ');
  return s.trim();
}
function nearestFeatureToPoint(fc, pt) {
  if (!fc || !Array.isArray(fc.features)) return { feature: null, distance_m: Infinity };
  let nearest = null; let bestM = Infinity;
  const ref = turf.point([pt.lng, pt.lat]);
  for (const f of fc.features) {
    try {
      const c = turf.center(f);
      const d = turf.distance(ref, c, { units: 'meters' });
      if (d < bestM) { bestM = d; nearest = f; }
    } catch {}
  }
  return { feature: nearest, distance_m: bestM };
}

/* ------------------------- 04) Data Loaders --------------------------- */

function loadGeoJSONSafe(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function loadCSVAsObjects(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const recs = csvParse(raw, { columns: true, skip_empty_lines: true });
    return recs.map(r => ({ ...r, lat: parseFloat(r.lat), lng: parseFloat(r.lng) }))
               .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  } catch { return []; }
}
function loadAllStateAADT(dirPath) {
  const features = [];
  try {
    if (!fs.existsSync(dirPath)) return null;
    const files = fs.readdirSync(dirPath).filter(f => f.toLowerCase().endsWith('.geojson'));
    for (const file of files) {
      try {
        const fc = JSON.parse(fs.readFileSync(path.join(dirPath, file), 'utf8'));
        if (fc && Array.isArray(fc.features)) features.push(...fc.features);
      } catch {}
    }
  } catch {}
  return features.length ? { type:'FeatureCollection', features } : null;
}
function mergeFCs(fcs) {
  return { type:'FeatureCollection', features: fcs.filter(Boolean).flatMap(fc => Array.isArray(fc.features) ? fc.features : []) };
}
function loadAllData() {
  ROADS = loadGeoJSONSafe(CONFIG.data_sources.roads_geojson);
  const baseAADT = loadGeoJSONSafe(CONFIG.data_sources.aadt_geojson);
  const multiAADT = loadAllStateAADT(CONFIG.data_sources.aadt_states_dir);
  AADT = mergeFCs([baseAADT, multiAADT]);
  const rampsConf = (CONFIG.data_sources.optional_layers || []).find(x => x.name === 'ramps_service_roads' && x.enabled);
  RAMPS = rampsConf ? loadGeoJSONSafe(rampsConf.path) : null;
  COMPETITORS = loadCSVAsObjects(CONFIG.data_sources.competitors_csv);
  logInfo('[load]', {
    roads: !!ROADS,
    aadt: !!AADT,
    aadt_features: AADT ? AADT.features.length : 0,
    ramps: !!RAMPS,
    competitors: COMPETITORS.length
  });
}
loadAllData();

/* ------------------------- 05) QC Guardrails -------------------------- */

function qcChecks(center, feature) {
  const flags = [];
  if (!feature) return { status: 'error', flags: ['NO_AADT'] };

  // 1) Snap distance
  const featCenter = turf.center(feature);
  const snapM = turf.distance(turf.point([center.lng, center.lat]), featCenter, { units: 'meters' });
  if (snapM > CONFIG.logic.qc.max_snap_distance_m) flags.push('MISSING_BASELINE_ROAD');

  // 2) Bearing delta (if we have either geometry or a BEARING property)
  let fBearing = null;
  if (feature.geometry && feature.geometry.type === 'LineString') fBearing = degBearingFromLine(feature.geometry.coordinates);
  const propBearing = feature.properties ? feature.properties.BEARING : null;
  const useBearing = (typeof propBearing === 'number') ? propBearing : fBearing;
  if (typeof useBearing === 'number' && typeof center.bearing === 'number') {
    const diff = Math.abs(useBearing - center.bearing);
    if (diff > CONFIG.logic.qc.max_bearing_diff_deg) flags.push('BEARING_MISMATCH');
  }

  // 3) Route normalization mismatch
  const fr = normalizeRouteName(feature.properties ? feature.properties.ROUTE : null);
  if (fr && center.routeNorm && fr !== center.routeNorm) flags.push('ROUTE_MISMATCH');

  // 4) Mask ramps/service
  if (CONFIG.logic.qc.mask.exclude_ramps || CONFIG.logic.qc.mask.exclude_service_roads) {
    const typeStr = (feature.properties ? (feature.properties.ROADTYPE || feature.properties.CLASS || '') : '');
    if (/ramp|service/i.test(typeStr)) flags.push('MASKED_RAMP');
  }

  // 5) Required fields
  (CONFIG.logic.qc.required_fields || []).forEach(req => {
    if (!feature.properties || !(req in feature.properties)) flags.push('MISSING_' + req);
  });

  const status = flags.length ? 'verify' : 'ok';
  return { status, flags };
}

/* ------------------------- 06) AADT Estimation ------------------------ */

function estimateAADTAt(center) {
  if (!AADT) return { feature: null, aadt: null, distance_m: Infinity };
  const n = nearestFeatureToPoint(AADT, center);
  const aadt = n.feature && n.feature.properties ? n.feature.properties.AADT : null;
  return { feature: n.feature, aadt, distance_m: n.distance_m };
}

/* ------------------------- 07) Competitors ---------------------------- */

function competitorsWithin(center, radiusMi) {
  const out = [];
  for (const c of COMPETITORS) {
    const d = haversineMi(center, { lat: c.lat, lng: c.lng });
    if (d <= radiusMi + 1e-9) out.push({ ...c, distance_mi: d });
  }
  out.sort((a,b) => a.distance_mi - b.distance_mi);
  return out;
}
function independentChainCounts(list) {
  const indepTags = new Set((CONFIG.logic.competitors.independent_tag_values || []).map(String));
  const chainTags = new Set((CONFIG.logic.competitors.chain_tag_values || []).map(String));
  let ind = 0, chn = 0;
  for (const r of list) {
    const b = String(r.brand || '');
    if (indepTags.has(b)) ind++;
    if (chainTags.has(b)) chn++;
  }
  return { ind, chn };
}

/* ------------------------- 08) Prospect Score ------------------------- */

function computeMonthlyGallons(aadt) {
  if (aadt == null || !Number.isFinite(aadt)) return null;
  const val = aadt * 0.02 * 8 * 30;
  const inc = CONFIG.logic.gallons.round_to_nearest || 10;
  return round(val, inc);
}
function computeProspectScore(aadt, qc, competitors, mix) {
  // AADT points (cap ~50k)
  const aadtCap = 50000;
  const aadtFrac = clamp01((Number(aadt) || 0) / aadtCap);
  const aadtPts  = aadtFrac * CONFIG.logic.score.aadt_max;

  // Competitor pressure (fewer better; 0 -> full points; 20+ -> 0)
  const compCount = (competitors || []).length;
  const compFrac = 1 - clamp01(compCount / 20);
  const compPts  = compFrac * CONFIG.logic.score.comp_pressure_max;

  // QC points (pass => max; flags penalize)
  const maxQc = CONFIG.logic.score.qc_max;
  let qcPts = (qc && qc.status === 'ok') ? maxQc : (maxQc - Math.min((qc?.flags?.length || 0) * 2, maxQc));
  if (qcPts < 0) qcPts = 0;

  // Mix points (slight pref toward more independents)
  const ind = mix?.ind || 0, chn = mix?.chn || 0;
  const mixFrac = (ind + chn) > 0 ? clamp01((ind - chn + (ind + chn)) / (2 * (ind + chn))) : 0.5;
  const mixPts  = mixFrac * CONFIG.logic.score.mix_max;

  const total = Math.round(aadtPts + compPts + qcPts + mixPts);
  return {
    total,
    breakdown: {
      aadt_points: Math.round(aadtPts),
      comp_pressure_points: Math.round(compPts),
      qc_points: Math.round(qcPts),
      mix_points: Math.round(mixPts)
    }
  };
}
function buildSummary(p) {
  const parts = [];
  if (p.qc?.status === 'ok') parts.push('QC Passed.');
  if (p.qc?.flags?.length) parts.push('QC Flags: ' + p.qc.flags.join(', ') + '.');
  if (Number.isFinite(p.aadt)) parts.push('AADT ' + p.aadt + '.');
  if (Number.isFinite(p.monthly_gallons)) parts.push('Est. ' + p.monthly_gallons.toLocaleString() + ' gal/month.');
  parts.push((p.competitors ? p.competitors.length : 0) + ' competitors in ' + p.radius_mi + ' mi.');
  if (p.route) parts.push('Route ' + p.route + '.');
  if (p.direction) parts.push('Direction ' + p.direction + '.');
  if (p.prospect_score) parts.push('ProspectScore ' + p.prospect_score.total + '/100.');
  return parts.join(' ').replace(/\bCSV\b/gi, '');
}

/* ------------------------- 09) Geocoding ------------------------------ */

async function geocodeAddress(address) {
  if (!address || !fetchFn) throw new Error('No address or fetch not available');
  if (CONFIG.geocoding.provider === 'google' && CONFIG.geocoding.google_api_key) {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json?address='
      + encodeURIComponent(address) + '&key=' + CONFIG.geocoding.google_api_key;
    const resp = await fetchFn(url);
    const data = await resp.json();
    if (data.status !== 'OK' || !data.results?.length) throw new Error('Geocode failed');
    const loc = data.results[0].geometry.location; // {lat,lng}
    return { lat: loc.lat, lng: loc.lng, source: 'google' };
  }
  // Fallback: Nominatim
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&q=' + encodeURIComponent(address);
  const resp = await fetchFn(url, { headers: { 'User-Agent': 'FuelIQ/1.0 (contact: admin@fueliq.local)' } });
  const arr = await resp.json();
  if (!Array.isArray(arr) || !arr.length) throw new Error('Geocode failed');
  return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon), source: 'nominatim' };
}

/* ------------------------- 10) Exporters ------------------------------ */

async function buildExcelBuffer(payload) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('FuelIQ');
  ws.columns = [
    { header: 'Lat', key: 'lat', width: 10 },
    { header: 'Lng', key: 'lng', width: 10 },
    { header: 'AADT', key: 'aadt', width: 10 },
    { header: 'Monthly Gallons', key: 'monthly_gallons', width: 18 },
    { header: 'QC Status', key: 'qc_status', width: 12 },
    { header: 'QC Flags', key: 'qc_flags', width: 40 },
    { header: 'Route', key: 'route', width: 18 },
    { header: 'Direction', key: 'direction', width: 12 },
    { header: 'Competitors', key: 'competitors', width: 12 },
    { header: 'ProspectScore', key: 'prospect_score', width: 14 }
  ];
  ws.addRow(payload);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
function buildPDFStream(res, analysis) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  // Header
  doc.fontSize(18).text('Sun‑Nourie Fuel IQ — Prospect Report', { align: 'left' }).moveDown(0.3);
  doc.fontSize(11).fillColor('#666').text(new Date().toLocaleString(), { align: 'left' }).fillColor('#000');
  doc.moveDown(0.5);

  // Key facts
  const kv = [
    ['Lat', String(analysis.center.lat)],
    ['Lng', String(analysis.center.lng)],
    ['AADT', String(analysis.aadt ?? '—')],
    ['Monthly Gallons', Number.isFinite(analysis.monthly_gallons) ? analysis.monthly_gallons.toLocaleString() : '—'],
    ['QC Status', analysis.qc ? (analysis.qc.status || '—') : '—'],
    ['QC Flags', analysis.qc ? ((analysis.qc.flags || []).join(', ') || '—') : '—'],
    ['Route', analysis.route || '—'],
    ['Direction', analysis.direction || '—'],
    ['Competitors', String((analysis.competitors || []).length)],
    ['Radius (mi)', String(analysis.radius_mi)],
    ['ProspectScore', analysis.prospect_score ? (analysis.prospect_score.total + '/100') : '—']
  ];
  kv.forEach(p => doc.fontSize(11).text(p[0] + ': ' + p[1]));
  doc.moveDown(0.5);

  // Score breakdown
  if (analysis.prospect_score?.breakdown) {
    doc.fontSize(12).text('ProspectScore Breakdown', { underline: true });
    const b = analysis.prospect_score.breakdown;
    doc.moveDown(0.25);
    doc.fontSize(11).text('• AADT points: ' + b.aadt_points);
    doc.fontSize(11).text('• Competitor pressure points: ' + b.comp_pressure_points);
    doc.fontSize(11).text('• QC points: ' + b.qc_points);
    doc.fontSize(11).text('• Mix points: ' + b.mix_points);
    doc.moveDown(0.5);
  }

  // Summary
  doc.fontSize(12).text('Summary', { underline: true });
  doc.moveDown(0.25).fontSize(11).text(analysis.summary || '');
  doc.moveDown(0.5);

  // Competitors table
  doc.addPage().fontSize(14).text('Competitors (within radius)', { underline: true });
  doc.moveDown(0.5);
  const cols = ['#', 'Name', 'Brand', 'Dist (mi)', 'Lat', 'Lng'];
  doc.fontSize(11).text(cols.join(' | '));
  doc.moveDown(0.25);
  (analysis.competitors || []).forEach((c, i) => {
    const row = [
      i + 1,
      c.name || 'Unknown',
      c.brand || '—',
      (c.distance_mi != null ? c.distance_mi.toFixed(2) : ''),
      (c.lat != null ? Number(c.lat).toFixed(6) : ''),
      (c.lng != null ? Number(c.lng).toFixed(6) : '')
    ];
    doc.text(row.join(' | '));
  });

  // DOT appendix
  doc.addPage().fontSize(14).text('Appendix — DOT Sources', { underline: true });
  Object.keys(STATE_DOT_SOURCES).forEach(k => {
    const s = STATE_DOT_SOURCES[k];
    doc.fontSize(11).text(k + ': roads=' + s.roads + '  |  aadt=' + s.aadt);
  });

  doc.end();
}

/* ------------------------- 11) API routes ----------------------------- */

APP.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    env: CONFIG.meta.environment,
    loaded: {
      roads: !!ROADS,
      aadt: !!AADT,
      aadt_features: AADT ? AADT.features.length : 0,
      ramps: !!RAMPS,
      competitors: COMPETITORS.length
    }
  });
});

// Address -> lat/lng
APP.get('/api/geocode', async (req, res) => {
  try {
    const q = (req.query.q || '').toString();
    if (!q) return res.status(400).json({ error: 'missing address' });
    const r = await geocodeAddress(q);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'geocode failed', detail: e.message });
  }
});

// Nearby AADT
APP.get('/api/aadt/nearby', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat/lng required' });
  const center = { lat, lng };
  const info = estimateAADTAt(center);
  if (!info.feature) return res.json({ aadt: null, route: null, distance_m: info.distance_m });
  res.json({ aadt: info.aadt, route: info.feature.properties?.ROUTE || null, distance_m: info.distance_m });
});

// List state AADT files actually found
APP.get('/api/aadt/states', (req, res) => {
  try {
    const dir = CONFIG.data_sources.aadt_states_dir;
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.geojson')) : [];
    res.json({ dir, files });
  } catch {
    res.json({ dir: CONFIG.data_sources.aadt_states_dir, files: [] });
  }
});

// Competitors
APP.get('/api/competitors', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = parseFloat(req.query.radius || CONFIG.logic.competitors.radius_miles);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat/lng required' });
  const center = { lat, lng };
  const list = competitorsWithin(center, radius);
  res.json({ count: list.length, radius_mi: radius, items: list });
});

// Analyze (address OR lat/lng)
APP.post(['/api/analyze', '/analyze'], async (req, res) => {
  try {
    let { lat, lng, address, options } = req.body || {};
    if ((lat == null || lng == null) && address) {
      const g = await geocodeAddress(address);
      lat = g.lat; lng = g.lng;
    }
    if (!Number.isFinite(parseFloat(lat)) || !Number.isFinite(parseFloat(lng))) {
      return res.status(400).json({ error: 'lat/lng or address required' });
    }
    const center = { lat: parseFloat(lat), lng: parseFloat(lng), bearing: null, routeNorm: null };

    const est = estimateAADTAt(center);
    const feature = est.feature;
    const aadtVal = est.aadt;

    const qc = qcChecks(center, feature);

    const radius_mi = Number.isFinite(parseFloat(options?.radius_mi))
      ? parseFloat(options.radius_mi) : CONFIG.logic.competitors.radius_miles;

    const competitors = competitorsWithin(center, radius_mi);
    const mix = independentChainCounts(competitors);

    let monthly_gallons = null;
    const minAADT = CONFIG.logic.gallons.min_aadt_for_calc;
    if (qc.status === 'ok' && Number.isFinite(aadtVal) && aadtVal >= minAADT) {
      monthly_gallons = computeMonthlyGallons(aadtVal);
    }

    const prospect_score = computeProspectScore(aadtVal, qc, competitors, mix);

    const out = {
      center,
      aadt: Number.isFinite(aadtVal) ? Math.round(aadtVal) : null,
      route: feature?.properties?.ROUTE || null,
      bearing: feature?.properties?.BEARING ?? null,
      direction: feature?.properties?.DIR || null,
      qc,
      monthly_gallons,
      competitors,
      radius_mi,
      prospect_score
    };

    out.summary = buildSummary(out);

    // Snapshot JSON (optional)
    if (CONFIG.snapshots?.save_json) {
      try {
        if (!fs.existsSync(CONFIG.snapshots.out_dir)) fs.mkdirSync(CONFIG.snapshots.out_dir, { recursive: true });
        const baseName = 'snapshot_' + Date.now();
        fs.writeFileSync(path.join(CONFIG.snapshots.out_dir, baseName + '.json'), JSON.stringify(out, null, 2));
      } catch {}
    }

    res.json(out);
  } catch (e) {
    logError('analyze error', e);
    res.status(500).json({ error: 'internal error', detail: e.message });
  }
});

// Excel export
APP.post('/api/export/excel', async (req, res) => {
  try {
    const p = req.body || {};
    const buf = await buildExcelBuffer({
      lat: p.center?.lat,
      lng: p.center?.lng,
      aadt: p.aadt,
      monthly_gallons: p.monthly_gallons,
      qc_status: p.qc?.status,
      qc_flags: (p.qc?.flags || []).join(', '),
      route: p.route,
      direction: p.direction,
      competitors: Array.isArray(p.competitors) ? p.competitors.length : 0,
      prospect_score: p.prospect_score ? p.prospect_score.total : undefined
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="fueliq.xlsx"');
    res.end(buf);
  } catch (e) {
    logError('excel error', e);
    res.status(500).json({ error: 'excel failed' });
  }
});

// PDF export (same style as prior)
APP.post('/api/export/pdf', (req, res) => {
  try {
    const analysis = req.body || {};
    buildPDFStream(res, analysis);
  } catch (e) {
    logError('pdf error', e);
    res.status(500).json({ error: 'pdf failed' });
  }
});

/* ------------------------- 12) Static + Boot -------------------------- */

APP.use(express.static(path.join(__dirname, 'public')));

function logInfo(){ if ((CONFIG.meta.log_level || 'info') !== 'error') console.log('[info]', ...arguments); }
function logWarn(){ console.warn('[warn]', ...arguments); }
function logError(){ console.error('[error]', ...arguments); }

const PORT = process.env.PORT || 5000;
APP.listen(PORT, () => console.log('Fuel IQ server running at http://localhost:' + PORT));
