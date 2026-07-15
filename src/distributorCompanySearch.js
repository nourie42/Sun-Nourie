import express from "express";

const SEARCH_CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_LIMIT = 150;
const LOOKUP_TIMEOUT_MS = 5500;

const KNOWN_COMPANIES = [
  {
    legal_name: "J.H. Seale & Son, Inc.",
    aliases: ["jh seale", "j h seale", "j.h. seale", "jh seale and son", "j h seale and son"],
    headquarters: "Sumter, South Carolina",
    website: "https://jhseale.com/",
    description: "Petroleum transportation and wholesale fuel marketer",
    confidence: "High",
    source: "Fuel IQ verified example",
  },
  {
    legal_name: "Mansfield Energy Corp.",
    aliases: ["mansfield", "mansfield energy", "mansfield oil", "mansfield energy corp"],
    headquarters: "Gainesville, Georgia",
    website: "https://www.mansfield.energy/",
    description: "Fuel supply, logistics, and energy services company",
    confidence: "High",
    source: "Fuel IQ verified example",
  },
  {
    legal_name: "TACenergy, LLC",
    aliases: ["tacenergy", "tac energy", "tacenergy llc"],
    headquarters: "Dallas, Texas",
    website: "https://www.tacenergy.com/",
    description: "Wholesale fuels and petroleum marketing company",
    confidence: "High",
    source: "Fuel IQ verified example",
  },
];

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function normalize(value) {
  return clean(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function validUrl(value) {
  const url = clean(value, 2000);
  if (!/^https?:\/\//i.test(url)) return "";
  try { return new URL(url).toString(); }
  catch { return ""; }
}

function candidate(value, source) {
  if (!value || typeof value !== "object") return null;
  const name = clean(value.legal_name || value.name || value.display_name, 300);
  if (!name) return null;
  return {
    name,
    legal_name: clean(value.legal_name || name, 300),
    headquarters: clean(value.headquarters || value.formatted_address || value.address || value.location, 500),
    website: validUrl(value.website || value.official_website),
    description: clean(value.description || value.match_reason || value.category, 700),
    confidence: clean(value.confidence || "Possible match", 80),
    source: clean(value.source || source, 80),
  };
}

function scoreCandidate(item, query, location = "") {
  const q = normalize(query);
  const n = normalize(item.name || item.legal_name);
  const l = normalize(location);
  const h = normalize(item.headquarters);
  let score = 0;
  if (n === q) score += 100;
  if (n.includes(q) || q.includes(n)) score += 55;
  const words = q.split(" ").filter((word) => word.length > 1);
  score += words.filter((word) => n.includes(word)).length * 12;
  if (/fuel|oil|petroleum|energy|distribut|wholesale|transport|marketer/i.test(`${item.name} ${item.description}`)) score += 18;
  if (l && h.includes(l)) score += 20;
  if (item.website) score += 8;
  if (item.headquarters) score += 5;
  if (/gas station|convenience store/i.test(item.description) && !n.includes(q)) score -= 20;
  return score;
}

function dedupeAndRank(items, query, location = "") {
  const byKey = new Map();
  for (const raw of items) {
    const item = candidate(raw, raw?.source || "Public search");
    if (!item) continue;
    const key = `${normalize(item.legal_name || item.name)}|${normalize(item.headquarters).split(" ").slice(-4).join(" ")}`;
    const existing = byKey.get(key);
    if (!existing || scoreCandidate(item, query, location) > scoreCandidate(existing, query, location)) byKey.set(key, item);
  }
  return [...byKey.values()]
    .sort((a, b) => scoreCandidate(b, query, location) - scoreCandidate(a, query, location))
    .slice(0, 7);
}

function knownCandidates(query, location = "") {
  const q = normalize(query);
  const items = KNOWN_COMPANIES.filter((company) => {
    const names = [company.legal_name, ...(company.aliases || [])].map(normalize);
    return names.some((name) => name === q || name.includes(q) || q.includes(name));
  });
  return dedupeAndRank(items, query, location);
}

function getCached(key) {
  const hit = SEARCH_CACHE.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) { SEARCH_CACHE.delete(key); return null; }
  return hit.value;
}

function setCached(key, value) {
  if (SEARCH_CACHE.size >= CACHE_LIMIT) SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value);
  SEARCH_CACHE.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function googleCandidates(query, location, apiKey, fetchWithTimeout) {
  if (!apiKey) return [];
  try {
    const search = [query, location, "fuel distributor petroleum marketer"].filter(Boolean).join(" ");
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(search)}&region=us&key=${encodeURIComponent(apiKey)}`;
    const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, LOOKUP_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.results || []).slice(0, 7).map((place) => ({
      name: place.name,
      legal_name: place.name,
      headquarters: place.formatted_address,
      description: Array.isArray(place.types) ? place.types.join(", ").replaceAll("_", " ") : "Google business result",
      confidence: place.business_status === "OPERATIONAL" ? "Operational business listing" : "Google business match",
      source: "Google Places",
    }));
  } catch {
    return [];
  }
}

async function nominatimCandidates(query, location, fetchWithTimeout) {
  try {
    const search = [query, location].filter(Boolean).join(" ");
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=us&limit=7&q=${encodeURIComponent(search)}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": process.env.OVERPASS_CONTACT || "FuelIQDistributorLookup/1.1",
      },
    }, LOOKUP_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    return (data || []).map((place) => ({
      name: clean(place.name || String(place.display_name || "").split(",")[0], 300),
      headquarters: clean(place.display_name, 500),
      description: clean([place.type, place.category].filter(Boolean).join(" / ").replaceAll("_", " "), 400),
      confidence: "OpenStreetMap business/location match",
      source: "OpenStreetMap",
    }));
  } catch {
    return [];
  }
}

export function registerDistributorCompanySearchRoutes(app, options = {}) {
  const router = express.Router();
  const googleApiKey = options.googleApiKey || process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
  const fetchWithTimeout = options.fetchWithTimeout || (async (url, init = {}, timeoutMs = LOOKUP_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  });

  router.get("/search", async (req, res) => {
    const query = clean(req.query?.q, 300);
    const location = clean(req.query?.location, 300);
    if (query.length < 2) return res.json({ ok: true, candidates: [] });

    const key = `${normalize(query)}|${normalize(location)}`;
    const cached = getCached(key);
    if (cached) return res.json({ ok: true, candidates: cached, cached: true });

    const known = knownCandidates(query, location);
    if (known.length && scoreCandidate(known[0], query, location) >= 80) {
      setCached(key, known);
      return res.json({ ok: true, candidates: known, fastMatch: true });
    }

    try {
      const settled = await Promise.allSettled([
        googleCandidates(query, location, googleApiKey, fetchWithTimeout),
        nominatimCandidates(query, location, fetchWithTimeout),
      ]);
      const external = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      const candidates = dedupeAndRank([...known, ...external], query, location);
      setCached(key, candidates);
      res.json({ ok: true, candidates, lookupTimeoutMs: LOOKUP_TIMEOUT_MS });
    } catch (error) {
      console.error("Distributor company lookup failed:", error);
      res.json({ ok: true, candidates: known, partial: true });
    }
  });

  app.use("/api/distributors", router);
}
