/**
 * Sun‑Nourie Fuel IQ — Pulse QC Build
 * FULL server.js (Express backend)
 *
 * This build adds:
 *  • Same PDF export style (rich PDF with header, QC, math, competitors table)
 *  • ProspectScore (0–100) with breakdown based on AADT, QC, competitor pressure, and mix
 *  • All‑state AADT loader: merges every GeoJSON file in ./data/aadt_states into a single FeatureCollection
 *  • Keeps ALL prior features/endpoints; nothing removed without permission
 */

/**********************
 * 01) Imports & Setup *
 **********************/
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
const { parse: csvParse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

/**************************************
 * 02) Configuration Loader (config)  *
 **************************************/
const CONFIG_PATH = path.join(__dirname, 'config.yaml');
let CONFIG = {
  meta: { app_name: 'Sun‑Nourie Fuel IQ', environment: 'production', log_level: 'info' },
  data_sources: {
    roads_geojson: path.join(__dirname, 'data/state_roads.geojson'),
    aadt_geojson: path.join(__dirname, 'data/aadt.geojson'),
    aadt_states_dir: path.join(__dirname, 'data/aadt_states'), // NEW: merge all states
    competitors_csv: path.join(__dirname, 'data/competitors.csv'),
    optional_layers: [
      { name: 'ramps_service_roads', path: path.join(__dirname,'data/ramps_service_roads.geojson'), enabled: true }
    ]
  },
  logic: {
    qc: {
      max_snap_distance_m: 30,
      max_bearing_diff_deg: 25,
      route_normalization: { strip_terms: ['BUS','BUSINESS','ALT','ALTERNATE','BY-PASS','BYPASS','SPUR'], strip_punctuation: true, collapse_whitespace: true, case: 'upper' },
      duplicate_detection: { min_segment_length_m: 45, cluster_tolerance_m: 20 },
      mask: { exclude_ramps: true, exclude_service_roads: true, exclude_private_drives: true },
      required_fields: ['AADT','ROUTE']
    },
    gallons: { monthly_formula: 'AADT * 0.02 * 8 * 30', round_to_nearest: 10, min_aadt_for_calc: 100, fail_behavior: 'halt_and_flag' },
    competitors: { radius_miles: 1.5, brands_to_exclude: [], independent_tag_values: ['Independent','Unbranded','Unknown'], chain_tag_values: ['Sunoco','BP','Shell','Exxon','Marathon','Circle K','7-Eleven','Wawa','RaceTrac','Sheetz','QuikTrip','Speedway'] },
    score: {
      // ProspectScore weights (0–100 total)
      aadt_max: 60,            // more weight to traffic
      comp_pressure_max: 20,   // fewer competitors = higher score
      qc_max: 12,              // QC pass boosts; flags penalize
      mix_max: 8               // independent/chain mix preference
    },
    badges: {
      texts: {
        missing_baseline_road: 'VERIFY: Missing baseline road',
        bearing_mismatch: 'VERIFY: Bearing mismatch',
        route_mismatch: 'VERIFY: Route mismatch',
        suspect_duplicate: 'VERIFY: Suspect duplicate',
        masked_ramp: 'INFO: Ramp/service road masked',
        ok: 'QC Passed'
      }
    }
  },
  api: { timeouts_ms: { analyze: 120000 }, pagination: { competitors_max: 3000 }, rate_limits: { analyze_per_minute: 60 } },
  snapshots: { save_json: true, save_png: false, out_dir: path.join(__dirname, 'snapshots') },
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

// Per-state DOT references (so FL can be corrected here)
const STATE_DOT_SOURCES = {
  NC: { roads: 'https://gis.ncdot.gov/roadway/centerline', aadt: 'https://connect.ncdot.gov/resources/traffic' },
  FL: { roads: 'https://gis.fdot.gov/arcgis/rest/services/FDOT/Transportation/MapServer', aadt: 'https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/roadway/aadt/latest_aadt.csv' },
  PA: { roads: 'https://www.pasda.psu.edu/uci/DataSummary.aspx?dataset=1690', aadt: 'https://data.penndot.gov/AADT' },
};

/*****************************
 * 03) Constants & App State *
 *****************************/
const APP = express();
APP.set('trust proxy', 1);
APP.use(helmet({ crossOriginResourcePolicy: false }));
APP.use(cors());
APP.use(compression());
APP.use(morgan('tiny'));
APP.use(bodyParser.json({ limit: '10mb' }));
APP.use(bodyParser.urlencoded({ extended: true }));

// In-memory caches
let ROADS = null;               // GeoJSON FeatureCollection (LineString/MultiLineString)
let AADT = null;                // GeoJSON FeatureCollection (Point/LineString) merged (primary + all states)
let RAMPS = null;               // GeoJSON FeatureCollection for ramps/service roads (optional)
let COMPETITORS = [];           // Array of {name, brand, lat, lng, ...}

let LAST_LOAD_MTIME = null;
const DEV_WATCH = (CONFIG?.meta?.environment || 'production') !== 'production';

/***********************
 * 04) Utility helpers *
 ***********************/
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (n, inc=1) => Math.round(n / inc) * inc;
const toRad = (deg) => deg * Math.PI / 180;
const toDeg = (rad) => rad * 180 / Math.PI;

function haversineMi(a, b) {
  const R = 3958.7613;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function degBearingFromLine(coords) {
  if (!coords || coords.length < 2) return null;
  const a = coords[0];
  const b = coords[coords.length - 1];
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
  (rn.strip_terms || []).forEach(function(t){ s = s.replace(new RegExp('\\b' + t + '\\b', 'gi'), ''); });
  if (rn.collapse_whitespace) s = s.replace(/\s+/g, ' ');
  return s.trim();
}

function nearestFeatureToPoint(fc, pt) {
  if (!fc || !Array.isArray(fc.features)) return { feature: null, distance_m: Infinity };
  let nearest = null; let bestD = Infinity;
  const ref = turf.point([pt.lng, pt.lat]);
  for (const f of fc.features) {
    try {
      const c = turf.center(f);
      const d = turf.distance(ref, c, { units: 'meters' });
      if (d < bestD) { bestD = d; nearest = f; }
    } catch {}
  }
  return { feature: nearest, distance_m: bestD };
}

/*************************
 * 05) Data Loaders     *
 *************************/
function loadGeoJSONSafe(p) {
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function loadCSVAsObjects(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const recs = csvParse(raw, { columns: true, skip_empty_lines: true });
    return recs.map(r => ({ ...r, lat: parseFloat(r.lat), lng: parseFloat(r.lng) })).filter(r => !Number.isNaN(r.lat) && !Number.isNaN(r.lng));
  } catch {
    return [];
  }
}
function loadAllStateAADT(dirPath) {
  const features = [];
  try {
    if (!fs.existsSync(dirPath)) return null;
    const files = fs.readdirSync(dirPath).filter(f => f.toLowerCase().endsWith('.geojson'));
    files.forEach(function(file){
      try {
        const fc = JSON.parse(fs.readFileSync(path.join(dirPath, file), 'utf8'));
        if (fc && Array.isArray(fc.features)) features.push.apply(features, fc.features);
      } catch {}
    });
  } catch {}
  if (!features.length) return null;
  return { type: 'FeatureCollection', features: features };
}

function mergeFeatureCollections(fcs) {
  const out = { type: 'FeatureCollection', features: [] };
  fcs.forEach(function(fc){ if (fc && Array.isArray(fc.features)) out.features = out.features.concat(fc.features); });
  return out;
}

function loadAllData() {
  ROADS = loadGeoJSONSafe(CONFIG.data_sources.roads_geojson);
  const baseAADT = loadGeoJSONSafe(CONFIG.data_sources.aadt_geojson);
  const multiAADT = loadAllStateAADT(CONFIG.data_sources.aadt_states_dir);
  AADT = mergeFeatureCollections([ baseAADT, multiAADT ].filter(Boolean));
  const rampsConf = (CONFIG.data_sources.optional_layers || []).find(function(x){ return x.name === 'ramps_service_roads' && x.enabled; });
  RAMPS = rampsConf ? loadGeoJSONSafe(rampsConf.path) : null;
  COMPETITORS = loadCSVAsObjects(CONFIG.data_sources.competitors_csv);
  LAST_LOAD_MTIME = Date.now();
  logInfo('[load]', 'roads=' + (!!ROADS), 'aadt=' + (!!AADT) + ' features=' + (AADT ? AADT.features.length : 0), 'ramps=' + (!!RAMPS), 'competitors=' + COMPETITORS.length);
}
loadAllData();

if (DEV_WATCH) {
  const toWatch = [CONFIG.data_sources.roads_geojson, CONFIG.data_sources.aadt_geojson, CONFIG.data_sources.competitors_csv];
  toWatch.forEach(function(pth){ try { fs.watch(pth, { persistent: false }, function(){ setTimeout(loadAllData, 250); }); } catch {} });
  try { fs.watch(CONFIG.data_sources.aadt_states_dir, { persistent: false }, function(){ setTimeout(loadAllData, 250); }); } catch {}
}

/********************************
 * 06) QC Guardrails & Checks  *
 ********************************/
function qcChecks(center, feature) {
  const flags = [];
  if (!feature) return { status: 'error', flags: ['NO_AADT'] };

  // 1) Snap distance
  const featCenter = turf.center(feature);
  const snapM = turf.distance(turf.point([center.lng, center.lat]), featCenter, { units: 'meters' });
  if (snapM > CONFIG.logic.qc.max_snap_distance_m) flags.push('MISSING_BASELINE_ROAD');

  // 2) Bearing delta (if we have either geometry or a BEARING property)
  let fBearing = null;
  if (feature.geometry && feature.geometry.type === 'LineString') {
    fBearing = degBearingFromLine(feature.geometry.coordinates);
  }
  const bearingProp = feature.properties ? feature.properties.BEARING : null;
  const useBearing = (typeof bearingProp === 'number') ? bearingProp : fBearing;
  if (typeof useBearing === 'number' && typeof center.bearing === 'number') {
    const diff = Math.abs(useBearing - center.bearing);
    if (diff > CONFIG.logic.qc.max_bearing_diff_deg) flags.push('BEARING_MISMATCH');
  }

  // 3) Route normalization mismatch
  const fr = normalizeRouteName(feature.properties ? feature.properties.ROUTE : null);
  if (fr && center.routeNorm && fr !== center.routeNorm) flags.push('ROUTE_MISMATCH');

  // 4) Mask ramps / service
  if (CONFIG.logic.qc.mask.exclude_ramps || CONFIG.logic.qc.mask.exclude_service_roads) {
    const typeStr = (feature.properties ? (feature.properties.ROADTYPE || feature.properties.CLASS || '') : '');
    const isRamp = /ramp|service/i.test(typeStr);
    if (isRamp) flags.push('MASKED_RAMP');
  }

  // 5) Required fields check
  (CONFIG.logic.qc.required_fields || []).forEach(function(reqField){
    if (!feature.properties || !(reqField in feature.properties)) flags.push('MISSING_' + reqField);
  });

  const status = flags.length ? 'verify' : 'ok';
  return { status: status, flags: flags };
}

/********************************
 * 07) AADT Join & Estimation   *
 ********************************/
function estimateAADTAt(center) {
  if (!AADT) return { feature: null, aadt: null, distance_m: Infinity };
  const n = nearestFeatureToPoint(AADT, center);
  const aadt = n.feature && n.feature.properties ? n.feature.properties.AADT : null;
  return { feature: n.feature, aadt: aadt, distance_m: n.distance_m };
}

/********************************
 * 08) Competitors Engine       *
 ********************************/
function competitorsWithin(center, radiusMi) {
  const out = [];
  for (let i=0;i<COMPETITORS.length;i++) {
    const c = COMPETITORS[i];
    const d = haversineMi(center, { lat: c.lat, lng: c.lng });
    if (d <= radiusMi + 1e-9) out.push({ ...c, distance_mi: d });
  }
  out.sort(function(a, b){ return a.distance_mi - b.distance_mi; });
  return out;
}

function independentChainCounts(list) {
  const indepTags = new Set((CONFIG.logic.competitors.independent_tag_values || []).map(String));
  const chainTags = new Set((CONFIG.logic.competitors.chain_tag_values || []).map(String));
  let ind = 0, chn = 0;
  for (let i=0;i<list.length;i++) {
    const r = list[i];
    const b = String(r.brand || '');
    if (indepTags.has(b)) ind++;
    if (chainTags.has(b)) chn++;
  }
  return { ind: ind, chn: chn };
}

/*******************************
 * 09) Prospect Score + Math   *
 *******************************/
function computeMonthlyGallons(aadt) {
  if (aadt == null || !Number.isFinite(aadt)) return null;
  return round(aadt * 0.02 * 8 * 30, CONFIG.logic.gallons.round_to_nearest);
}

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

function computeProspectScore(aadt, qc, competitors, mix) {
  // aadt component (normalize around 0..50k where 35k+ saturates)
  const aadtCap = 50000; // cap
  const aadtFrac = clamp01((Number(aadt) || 0) / aadtCap);
  const aadtPts = aadtFrac * (CONFIG.logic.score.aadt_max);

  // competitor pressure: fewer is better. assume radius = 1.5mi
  const compCount = (competitors || []).length;
  const compFrac = 1 - clamp01(compCount / 20); // 0 comps => 1.0; 20+ => 0
  const compPts = compFrac * (CONFIG.logic.score.comp_pressure_max);

  // QC: pass => max; flags penalize per flag
  const maxQc = CONFIG.logic.score.qc_max;
  let qcPts = (qc && qc.status === 'ok') ? maxQc : (maxQc - Math.min((qc && qc.flags ? qc.flags.length : 0) * 2, maxQc));
  if (qcPts < 0) qcPts = 0;

  // Mix: prefer more independents vs chains by a small margin
  const ind = mix ? mix.ind : 0;
  const chn = mix ? mix.chn : 0;
  const mixFrac = (ind + chn) > 0 ? clamp01((ind - chn + (ind + chn)) / (2 * (ind + chn))) : 0.5; // center at 0.5 if none
  const mixPts = mixFrac * (CONFIG.logic.score.mix_max);

  const total = Math.round(aadtPts + compPts + qcPts + mixPts);
  return {
    total: total,
    breakdown: {
      aadt_points: Math.round(aadtPts),
      comp_pressure_points: Math.round(compPts),
      qc_points: Math.round(qcPts),
      mix_points: Math.round(mixPts)
    }
  };
}

function buildSummary(payload) {
  const parts = [];
  if (payload.qc && payload.qc.status === 'ok') parts.push('QC Passed.');
  if (payload.qc && payload.qc.flags && payload.qc.flags.length) parts.push('QC Flags: ' + payload.qc.flags.join(', ') + '.');
  if (Number.isFinite(payload.aadt)) parts.push('AADT ' + payload.aadt + '.');
  if (Number.isFinite(payload.monthly_gallons)) parts.push('Est. ' + payload.monthly_gallons.toLocaleString() + ' gal/month.');
  parts.push((payload.competitors ? payload.competitors.length : 0) + ' competitors in ' + payload.radius_mi + ' mi.');
  if (payload.route) parts.push('Route ' + payload.route + '.');
  if (payload.direction) parts.push('Direction ' + payload.direction + '.');
  if (payload.prospect_score) parts.push('ProspectScore ' + payload.prospect_score.total + '/100.');
  return parts.join(' ').replace(/\bCSV\b/gi, '');
}

/*******************************
 * 10) Exporters (Excel & PDF) *
 *******************************/
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
  // Rich PDF similar to prior builds (header, key values, summary, competitor table, score breakdown)
  const doc = new PDFDocument({ size: 'LETTER', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  // Header
  doc.fontSize(18).text('Sun‑Nourie Fuel IQ — Prospect Report', { align: 'left' }).moveDown(0.3);
  doc.fontSize(11).fillColor('#666').text(new Date().toLocaleString(), { align: 'left' }).fillColor('#000');
  doc.moveDown(0.5);

  // Key facts box
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
  kv.forEach(function(pair){ doc.fontSize(11).text(pair[0] + ': ' + pair[1]); });
  doc.moveDown(0.5);

  // Score breakdown
  if (analysis.prospect_score && analysis.prospect_score.breakdown) {
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
  (analysis.competitors || []).forEach(function(c, i){
    const row = [
      i + 1,
      c.name || 'Unknown',
      c.brand || '—',
      (c.distance_mi != null ? c.distance_mi.toFixed(2) : ''),
      (c.lat != null ? c.lat.toFixed(6) : ''),
      (c.lng != null ? c.lng.toFixed(6) : '')
    ];
    doc.text(row.join(' | '));
  });

  // DOT sources appendix
  doc.addPage().fontSize(14).text('Appendix — DOT Sources', { underline: true });
  Object.keys(STATE_DOT_SOURCES).forEach(function(k){
    const s = STATE_DOT_SOURCES[k];
    doc.fontSize(11).text(k + ': roads=' + s.roads + '  |  aadt=' + s.aadt);
  });

  doc.end();
}

/*******************************
 * 11) API Routes              *
 *******************************/
APP.get('/api/health', function(req, res){
  res.json({ ok: true, env: CONFIG.meta.environment, loaded: { roads: !!ROADS, aadt: !!AADT, aadt_features: AADT ? AADT.features.length : 0, ramps: !!RAMPS, competitors: COMPETITORS.length } });
});

APP.get('/api/dot-sources', function(req, res){ res.json(STATE_DOT_SOURCES); });

APP.get('/api/aadt/states', function(req, res){
  try {
    const files = fs.existsSync(CONFIG.data_sources.aadt_states_dir) ? fs.readdirSync(CONFIG.data_sources.aadt_states_dir).filter(function(f){ return f.toLowerCase().endsWith('.geojson'); }) : [];
    res.json({ dir: CONFIG.data_sources.aadt_states_dir, files: files });
  } catch (e) {
    res.json({ dir: CONFIG.data_sources.aadt_states_dir, files: [] });
  }
});

APP.get('/api/competitors', function(req, res){
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radius = parseFloat(req.query.radius || CONFIG.logic.competitors.radius_miles);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat/lng required' });
  const center = { lat: lat, lng: lng };
  const list = competitorsWithin(center, radius);
  res.json({ count: list.length, radius_mi: radius, items: list });
});

APP.get('/api/aadt/nearby', function(req, res){
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat/lng required' });
  const center = { lat: lat, lng: lng };
  const info = estimateAADTAt(center);
  if (!info.feature) return res.json({ aadt: null, route: null, distance_m: info.distance_m });
  res.json({ aadt: info.aadt, route: info.feature.properties ? (info.feature.properties.ROUTE || null) : null, distance_m: info.distance_m });
});

APP.post(['/api/analyze', '/analyze'], async function(req, res){
  try {
    const lat = parseFloat((req.body || {}).lat);
    const lng = parseFloat((req.body || {}).lng);
    const options = (req.body || {}).options || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat/lng required' });

    // Build center context (bearing/routeNorm can be filled later if inferred from road centerline; keeping hooks here)
    const center = { lat: lat, lng: lng, bearing: null, routeNorm: null };

    // AADT lookup
    const est = estimateAADTAt(center);
    const feature = est.feature;
    const aadtVal = est.aadt;

    // QC
    const qc = qcChecks(center, feature);

    // Competitors within radius
    const radius_mi = Number.isFinite(options.radius_mi) ? Number(options.radius_mi) : CONFIG.logic.competitors.radius_miles;
    const competitors = competitorsWithin(center, radius_mi);

    // Mix
    const mix = independentChainCounts(competitors);

    // Monthly gallons (only if QC OK and above min)
    let monthly_gallons = null;
    if (qc.status === 'ok' && Number.isFinite(aadtVal) && aadtVal >= CONFIG.logic.gallons.min_aadt_for_calc) {
      monthly_gallons = computeMonthlyGallons(aadtVal);
    }

    // Prospect score
    const prospect_score = computeProspectScore(aadtVal, qc, competitors, mix);

    const out = {
      center: center,
      aadt: Number.isFinite(aadtVal) ? Math.round(aadtVal) : null,
      route: feature && feature.properties ? (feature.properties.ROUTE || null) : null,
      bearing: feature && feature.properties ? (feature.properties.BEARING != null ? feature.properties.BEARING : null) : null,
      direction: feature && feature.properties ? (feature.properties.DIR || null) : null,
      qc: qc,
      monthly_gallons: monthly_gallons,
      competitors: competitors,
      radius_mi: radius_mi,
      prospect_score: prospect_score
    };

    // Summary (suppress CSV)
    out.summary = buildSummary(out);

    // Snapshot JSON
    if (CONFIG.snapshots && CONFIG.snapshots.save_json) {
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

APP.post('/api/export/excel', async function(req, res){
  try {
    const p = req.body || {};
    const buf = await buildExcelBuffer({
      lat: p.center ? p.center.lat : undefined,
      lng: p.center ? p.center.lng : undefined,
      aadt: p.aadt,
      monthly_gallons: p.monthly_gallons,
      qc_status: p.qc ? p.qc.status : undefined,
      qc_flags: p.qc ? (p.qc.flags || []).join(', ') : undefined,
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

APP.post('/api/export/pdf', function(req, res){
  try {
    const analysis = req.body || {};
    buildPDFStream(res, analysis);
  } catch (e) {
    logError('pdf error', e);
    res.status(500).json({ error: 'pdf failed' });
  }
});

/*******************************
 * 12) Static & Boot           *
 *******************************/
APP.use(express.static(path.join(__dirname, 'public')));

function logInfo(){ if ((CONFIG.meta.log_level || 'info') !== 'error') console.log.apply(console, ['[info]'].concat(Array.from(arguments))); }
function logWarn(){ console.warn.apply(console, ['[warn]'].concat(Array.from(arguments))); }
function logError(){ console.error.apply(console, ['[error]'].concat(Array.from(arguments))); }

const PORT = process.env.PORT || 5000;
APP.listen(PORT, function(){ console.log('Fuel IQ Pulse server running on http://localhost:' + PORT); });
