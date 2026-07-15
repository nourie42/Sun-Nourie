import express from "express";

const RADIUS_MI = 1.5;
const SELF_EXCLUDE_MI = 0.04;
const CACHE_TTL_MS = 10 * 60 * 1000;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const HEAVY = /(sheetz|wawa|racetrac|race\s?trac|buc-?ee'?s|royal\s?farms|quik.?trip|\bqt\b|costco|sam'?s\s+club|bj'?s|murphy)/i;
const SUNOCO = /\bsunoco\b/i;
const cache = new Map();

const clean = (value, max = 3000) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const milesFromMeters = (meters) => meters / 1609.344;

function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

async function timedFetch(url, init = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function addressFromTags(tags = {}) {
  const line1 = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const line2 = [tags["addr:city"] || tags["addr:town"], tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(", ");
  return [line1, line2].filter(Boolean).join(", ") || tags["addr:full"] || "";
}

function normalizeCompetitor(raw, centerLat, centerLon) {
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const miles = milesFromMeters(distanceMeters(centerLat, centerLon, lat, lon));
  if (miles <= SELF_EXCLUDE_MI || miles > RADIUS_MI) return null;
  const name = clean(raw.name || raw.brand || "Fuel station", 300);
  const brand = clean(raw.brand || raw.name || "Independent", 200);
  return {
    name,
    brand,
    address: clean(raw.address, 600),
    lat,
    lon,
    miles: Number(miles.toFixed(3)),
    place_id: clean(raw.place_id, 300),
    source: clean(raw.source || "Public map / places source", 300),
    heavy: HEAVY.test(`${name} ${brand}`),
    sunoco: SUNOCO.test(`${name} ${brand}`),
  };
}

function mergeCompetitors(groups, lat, lon) {
  const output = [];
  for (const raw of groups.flat()) {
    const item = normalizeCompetitor(raw, lat, lon);
    if (!item) continue;
    const duplicate = output.find((prior) => {
      if (item.place_id && prior.place_id && item.place_id === prior.place_id) return true;
      const close = milesFromMeters(distanceMeters(item.lat, item.lon, prior.lat, prior.lon)) < 0.025;
      const a = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const b = prior.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      return close && (!a || !b || a.includes(b) || b.includes(a));
    });
    if (duplicate) {
      if (!duplicate.address && item.address) duplicate.address = item.address;
      if (!duplicate.place_id && item.place_id) duplicate.place_id = item.place_id;
      if (!duplicate.source.includes(item.source)) duplicate.source = `${duplicate.source}; ${item.source}`;
      duplicate.heavy ||= item.heavy;
      duplicate.sunoco ||= item.sunoco;
    } else {
      output.push(item);
    }
  }
  return output.sort((a, b) => a.miles - b.miles);
}

async function legacySearch(legacyPort, lat, lon) {
  const response = await timedFetch(
    `http://127.0.0.1:${legacyPort}/api/competitors?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radiusMi=${RADIUS_MI}`,
    { headers: { Accept: "application/json" } },
    35000,
  );
  if (!response.ok) throw new Error(`legacy lookup HTTP ${response.status}`);
  const data = await response.json();
  return (data.features || []).map((feature) => {
    const p = feature.properties || {};
    const c = feature.geometry?.coordinates || [];
    return { name: p.name, brand: p.brand, address: p.address, lat: c[1], lon: c[0], place_id: p.place_id, source: "Fuel IQ OSM/Google lookup" };
  });
}

async function overpassSearch(lat, lon) {
  const meters = Math.round(RADIUS_MI * 1609.344);
  const query = `[out:json][timeout:30];(nwr(around:${meters},${lat},${lon})["amenity"="fuel"];);out center tags;`;
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await timedFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "FuelIQ/4.1 competitor verification" },
        body: `data=${encodeURIComponent(query)}`,
      }, 32000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return (data.elements || []).map((item) => {
        const tags = item.tags || {};
        return {
          name: tags.name || tags.brand || tags.operator,
          brand: tags.brand || tags.operator || tags.name,
          address: addressFromTags(tags),
          lat: item.lat ?? item.center?.lat,
          lon: item.lon ?? item.center?.lon,
          source: "OpenStreetMap / Overpass",
        };
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Overpass lookup failed");
}

async function googleSearch(apiKey, lat, lon) {
  if (!apiKey) return [];
  const meters = Math.round(RADIUS_MI * 1609.344);
  const urls = [
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lon}&radius=${meters}&type=gas_station&key=${apiKey}`,
    `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent("gas station convenience store fuel")}&location=${lat},${lon}&radius=${meters}&key=${apiKey}`,
  ];
  const settled = await Promise.allSettled(urls.map(async (url) => {
    const response = await timedFetch(url, { headers: { Accept: "application/json" } }, 25000);
    if (!response.ok) throw new Error(`Google HTTP ${response.status}`);
    const data = await response.json();
    if (!["OK", "ZERO_RESULTS"].includes(data.status)) throw new Error(`Google ${data.status}`);
    return (data.results || []).filter((item) => item.business_status !== "CLOSED_PERMANENTLY").map((item) => ({
      name: item.name,
      brand: item.name,
      address: item.vicinity || item.formatted_address,
      lat: item.geometry?.location?.lat,
      lon: item.geometry?.location?.lng,
      place_id: item.place_id,
      source: "Google Places",
    }));
  }));
  const values = [];
  for (const result of settled) if (result.status === "fulfilled") values.push(...result.value);
  if (!values.length && settled.every((result) => result.status === "rejected")) throw settled[0].reason;
  return values;
}

async function searchCompetitors({ legacyPort, googleApiKey, lat, lon }) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const settled = await Promise.allSettled([
    legacySearch(legacyPort, lat, lon),
    overpassSearch(lat, lon),
    googleSearch(googleApiKey, lat, lon),
  ]);
  const groups = [];
  const sources = [];
  const warnings = [];
  const labels = ["Fuel IQ OSM/Google", "OpenStreetMap / Overpass", "Google Places"];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      groups.push(result.value);
      sources.push(labels[index]);
    } else {
      warnings.push(`${labels[index]}: ${clean(result.reason?.message || result.reason, 300)}`);
    }
  });
  const value = { items: mergeCompetitors(groups, lat, lon), sources, warnings, radius_mi: RADIUS_MI };
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function callLegacyEstimate(legacyPort, body) {
  const response = await timedFetch(`http://127.0.0.1:${legacyPort}/estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body || {}),
  }, 120000);
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { ok: false, status: text || `HTTP ${response.status}` }; }
  return { response, payload };
}

function calculate(result, requestBody, count, heavyCount) {
  const input = result.inputs || {};
  const aadt = Number(input.aadt_used);
  const mpds = Number(input.mpds ?? requestBody.mpds);
  const diesel = Number(input.diesel ?? requestBody.diesel ?? 0);
  if (![aadt, mpds, diesel].every(Number.isFinite) || aadt <= 0 || mpds <= 0) return null;
  const prior = result.calc_breakdown?.baselineComponents || {};
  const trafficPullPct = Number(requestBody.trafficPullPct ?? prior.trafficPullPct ?? input.baseline_settings?.traffic_pull_pct ?? 2);
  const gallonsPerFill = Number(requestBody.gallonsPerFill ?? prior.gallonsPerFill ?? input.baseline_settings?.gallons_per_fill ?? 8);
  const baseline = aadt * (trafficPullPct / 100) * gallonsPerFill * 30;
  let baseMult = 1;
  if (count === 1) baseMult = 0.75;
  else if (count >= 2 && count <= 4) baseMult = 0.6;
  else if (count >= 5) baseMult = 0.5;
  const heavyPenalty = heavyCount === 1 ? 0.2 : heavyCount >= 2 ? 0.35 : 0;
  const compMult = Math.max(0.2, baseMult - heavyPenalty);
  const afterComp = baseline * compMult;
  const capEquip = mpds * 25 * 10.5 * 24 * (365 / 12) + diesel * 25 * 16 * 24 * (365 / 12);
  const capSoftTotal = mpds * 22000;
  const capHardTotal = mpds * 28000;
  let capped = Math.min(afterComp, capEquip, capHardTotal);
  if (afterComp > capSoftTotal) capped = Math.round(capped * 0.9);
  const pricePosition = String(requestBody.advanced?.price_position || input.price_position || "inline");
  const priceMult = pricePosition === "below" ? 1.1 : pricePosition === "above" ? 0.9 : 1;
  let extrasMult = 1;
  for (const extra of requestBody.advanced?.extra || []) {
    const pct = Number(extra?.pct);
    if (Number.isFinite(pct)) extrasMult *= 1 + pct / 100;
  }
  if (result.flags?.auto_low_rating) extrasMult *= 0.7;
  if (requestBody.advanced?.flags?.rural === true && count === 0) extrasMult *= 1.3;
  const preClamp = Math.round(capped * priceMult * extrasMult);
  const base = Math.min(preClamp, Math.round(baseline));
  return {
    base,
    low: Math.round(base * 0.86),
    high: Math.round(base * 1.06),
    year2: Math.round(base * 1.027),
    year3: Math.round(base * 1.027 * 1.0125),
    breakdown: {
      aadt,
      baseline: Math.round(baseline),
      baselineComponents: { trafficShare: trafficPullPct / 100, trafficPullPct, gallonsPerFill, days: 30 },
      compRule: { compCount: count, heavyCount, baseMult, heavyPenalty, compMult, afterComp: Math.round(afterComp) },
      caps: { capEquip: Math.round(capEquip), capSoftTotal, capHardTotal },
      priceMult,
      extrasMult,
      preClamp,
      finalClampedToBaseline: base,
    },
  };
}

function applyCompetition(result, requestBody, lookup) {
  const items = lookup.items;
  const count = items.length;
  const heavyCount = items.filter((item) => item.heavy).length;
  const calc = calculate(result, requestBody, count, heavyCount);
  if (calc) {
    Object.assign(result, { base: calc.base, low: calc.low, high: calc.high, year2: calc.year2, year3: calc.year3, calc_breakdown: calc.breakdown });
    result.estimate = { ...(result.estimate || {}), base: calc.base, low: calc.low, high: calc.high, range: `${calc.low}–${calc.high}`, year2: calc.year2, year3: calc.year3 };
  }
  result.competition = {
    ...(result.competition || {}),
    count,
    count_1_5mi: count,
    heavy_count: heavyCount,
    adjusted_count: count,
    adjusted_heavy_count: heavyCount,
    detected_count: count,
    detected_heavy_count: heavyCount,
    nearest_mi: items[0]?.miles ?? null,
    notable_brands: items.slice(0, 8).map((item) => item.name),
    radius_mi: RADIUS_MI,
  };
  result.flags = { ...(result.flags || {}), rural_eligible: count === 0, rural_bonus_applied: count === 0 && requestBody.advanced?.flags?.rural === true };
  result.map = { ...(result.map || {}), competitors: items, all_competitors: items, competitor_radius_mi: RADIUS_MI };
  result.competition_lookup = lookup;
  result.competitionText = count
    ? `Competition: ${count} active fuel station${count === 1 ? "" : "s"} verified within ${RADIUS_MI} mi${heavyCount ? ` (${heavyCount} high-impact competitor${heavyCount === 1 ? "" : "s"})` : ""}.`
    : `Competition: No active fuel station was verified within ${RADIUS_MI} mi. This is a source-search result, not proof that none exists.`;
  const baseSummary = clean(result.summary_base || result.summary, 20000)
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/competit|big box|within 3 mi|within 1 mi/i.test(sentence))
    .join(" ");
  result.summary_base = `${baseSummary}${baseSummary ? " " : ""}${result.competitionText}`.trim();
  result.summary = result.summary_base;
  return result;
}

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function filename(address) {
  return `${clean(address, 140).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fuel-iq-site"}-fuel-iq-estimate.doc`;
}

function renderWord(result, body) {
  const address = result?.map?.site?.label || body.address || "Fuel IQ Site";
  const number = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—";
  const competitors = (result?.map?.competitors || []).filter((item) => Number(item.miles) <= RADIUS_MI);
  const rows = competitors.length ? competitors.map((item) => `<tr><td>${esc(Number(item.miles).toFixed(3))} mi</td><td>${esc(item.name)}</td><td>${esc(item.address || "—")}</td><td>${esc(item.source)}</td></tr>`).join("") : '<tr><td colspan="4">No competitor was verified by the available 1.5-mile sources; field verification is required.</td></tr>';
  const selected = body.selectedAadt || null;
  const b = result.calc_breakdown || {};
  const c = b.baselineComponents || {};
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Fuel IQ Site Estimate</title><style>body{font-family:Arial;color:#172033;font-size:10.5pt;line-height:1.45;margin:32px}h1{font-size:20pt;color:#0b1f33}h2{font-size:14pt;color:#123d61;border-bottom:1px solid #cbd5e1;padding-bottom:4px;margin-top:22px}table{width:100%;border-collapse:collapse;margin:8px 0 14px}th,td{border:1px solid #cbd5e1;padding:6px;vertical-align:top;text-align:left}th{background:#e2e8f0}.big{font-size:24pt;font-weight:bold}.note{background:#f1f5f9;border:1px solid #cbd5e1;padding:10px}</style></head><body>
<h1>Sunoco, LP Fuel IQ — Site Estimate</h1><p><b>${esc(address)}</b></p><p>Prepared ${esc(new Date().toISOString())}</p>${body.siteNotes ? `<div class="note"><b>User notes:</b> ${esc(body.siteNotes)}</div>` : ""}
<h2>Estimate Summary</h2><p class="big">${number(result.base)} gallons/month</p><table><tr><th>Low</th><td>${number(result.low)}</td><th>High</th><td>${number(result.high)}</td></tr><tr><th>Year 2</th><td>${number(result.year2)}</td><th>Year 3</th><td>${number(result.year3)}</td></tr></table>
<h2>AADT Selection and Math</h2><p>${esc(result.aadtText || "—")}</p>${selected ? `<p><b>Selected reading:</b> ${number(selected.aadt)} (${esc(selected.year || "year not stated")}) — ${esc(selected.route || "route not stated")} — approximately ${esc(selected.miles ?? "—")} mi away.</p>` : ""}<p>${number(result.inputs?.aadt_used)} × ${esc(c.trafficPullPct ?? 2)}% × ${esc(c.gallonsPerFill ?? 8)} gal/fill × 30 days = ${number(b.baseline)}</p>
<h2>Competition Within 1.5 Miles</h2><p>${esc(result.competitionText)}</p><table><thead><tr><th>Distance</th><th>Competitor</th><th>Address</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Road and Site Context</h2><p>${esc(result.roads?.summary || "Not returned.")}</p><h2>Fuel IQ Summary</h2><p>${esc(result.summary_base || result.summary || "—")}</p><h2>Verification Note</h2><p>Verify traffic counts, operating status, access, property records, environmental records, and competitor conditions before underwriting.</p></body></html>`;
}

export function registerSiteEnhancementRoutes(app, options = {}) {
  const legacyPort = Number(options.legacyPort);
  const googleApiKey = options.googleApiKey || process.env.GOOGLE_API_KEY || "";
  const json = express.json({ limit: "4mb" });

  app.post("/estimate", json, async (req, res) => {
    try {
      const legacy = await callLegacyEstimate(legacyPort, req.body || {});
      if (!legacy.response.ok || legacy.payload?.ok !== true) return res.status(legacy.response.status || 400).json(legacy.payload);
      const site = legacy.payload?.map?.site;
      if (!Number.isFinite(Number(site?.lat)) || !Number.isFinite(Number(site?.lon))) return res.json(legacy.payload);
      const lookup = await searchCompetitors({ legacyPort, googleApiKey, lat: Number(site.lat), lon: Number(site.lon) });
      res.json(applyCompetition(legacy.payload, req.body || {}, lookup));
    } catch (error) {
      res.status(400).json({ ok: false, status: "Estimate failed", detail: clean(error?.message || error, 1200) });
    }
  });

  app.get("/api/competitors", async (req, res) => {
    try {
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: "lat/lon required" });
      const lookup = await searchCompetitors({ legacyPort, googleApiKey, lat, lon });
      const features = lookup.items.map((item, index) => ({ type: "Feature", geometry: { type: "Point", coordinates: [item.lon, item.lat] }, properties: { id: index, ...item } }));
      res.setHeader("Cache-Control", "no-store");
      res.type("application/geo+json").send(JSON.stringify({ type: "FeatureCollection", radius_mi: RADIUS_MI, sources: lookup.sources, warnings: lookup.warnings, features }));
    } catch (error) {
      res.status(500).json({ error: "competitors failed", detail: clean(error?.message || error, 1000) });
    }
  });

  app.post("/report/word", json, async (req, res) => {
    try {
      let result = req.body?.result;
      if (!result?.ok) {
        const legacy = await callLegacyEstimate(legacyPort, req.body || {});
        if (!legacy.response.ok || legacy.payload?.ok !== true) throw new Error(legacy.payload?.status || "Estimate failed");
        result = legacy.payload;
        const site = result?.map?.site;
        if (Number.isFinite(Number(site?.lat)) && Number.isFinite(Number(site?.lon))) {
          const lookup = await searchCompetitors({ legacyPort, googleApiKey, lat: Number(site.lat), lon: Number(site.lon) });
          applyCompetition(result, req.body || {}, lookup);
        }
      }
      const address = result?.map?.site?.label || req.body?.address || "Fuel IQ Site";
      res.setHeader("Content-Type", "application/msword; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename(address)}"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(renderWord(result, req.body || {}));
    } catch (error) {
      res.status(400).json({ ok: false, status: "WORD_FAILED", detail: clean(error?.message || error, 1200) });
    }
  });
}
