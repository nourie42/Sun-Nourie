import express from "express";

const SEARCH_CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_LIMIT = 150;

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function normalize(value) {
  return clean(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function responseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  const chunks = [];
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const part of item.content || []) {
      if (typeof part?.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseJson(text) {
  let value = clean(text, 100000).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return { candidates: [] };
  try { return JSON.parse(value.slice(start, end + 1)); }
  catch { return { candidates: [] }; }
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
    place_id: clean(value.place_id, 300),
    source: clean(value.source || source, 80),
  };
}

function scoreCandidate(item, query) {
  const q = normalize(query);
  const n = normalize(item.name);
  let score = 0;
  if (n === q) score += 100;
  if (n.includes(q) || q.includes(n)) score += 55;
  const words = q.split(" ").filter((word) => word.length > 1);
  score += words.filter((word) => n.includes(word)).length * 12;
  if (/fuel|oil|petroleum|energy|distribut|wholesale|transport|marketer/i.test(`${item.name} ${item.description}`)) score += 18;
  if (item.website) score += 8;
  if (item.headquarters) score += 5;
  if (/gas station|convenience store/i.test(item.description) && !n.includes(q)) score -= 20;
  return score;
}

function dedupeAndRank(items, query) {
  const byKey = new Map();
  for (const raw of items) {
    const item = candidate(raw, raw?.source || "Public search");
    if (!item) continue;
    const key = `${normalize(item.legal_name || item.name)}|${normalize(item.headquarters).split(" ").slice(-4).join(" ")}`;
    const existing = byKey.get(key);
    if (!existing || scoreCandidate(item, query) > scoreCandidate(existing, query)) byKey.set(key, item);
  }
  return [...byKey.values()]
    .sort((a, b) => scoreCandidate(b, query) - scoreCandidate(a, query))
    .slice(0, 7);
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

async function googleCandidates(query, apiKey, fetchWithTimeout) {
  if (!apiKey) return [];
  const searches = [query, `${query} fuel distributor petroleum marketer`];
  const results = [];
  for (const search of searches) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(search)}&region=us&key=${encodeURIComponent(apiKey)}`;
      const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 14000);
      if (!response.ok) continue;
      const data = await response.json();
      for (const place of data.results || []) {
        results.push({
          name: place.name,
          legal_name: place.name,
          headquarters: place.formatted_address,
          description: Array.isArray(place.types) ? place.types.join(", ").replaceAll("_", " ") : "Google business result",
          confidence: place.business_status === "OPERATIONAL" ? "Operational business listing" : "Google business match",
          place_id: place.place_id,
          source: "Google Places",
        });
      }
    } catch {}
  }

  const top = dedupeAndRank(results, query).slice(0, 5);
  await Promise.all(top.map(async (item) => {
    if (!item.place_id) return;
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(item.place_id)}&fields=name,formatted_address,website,url,business_status,types&key=${encodeURIComponent(apiKey)}`;
      const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 12000);
      if (!response.ok) return;
      const details = (await response.json())?.result || {};
      item.name = clean(details.name || item.name, 300);
      item.legal_name = item.name;
      item.headquarters = clean(details.formatted_address || item.headquarters, 500);
      item.website = validUrl(details.website);
      item.description = Array.isArray(details.types) ? details.types.join(", ").replaceAll("_", " ") : item.description;
    } catch {}
  }));
  return top;
}

async function nominatimCandidates(query, fetchWithTimeout) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=us&limit=7&q=${encodeURIComponent(query)}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": process.env.OVERPASS_CONTACT || "FuelIQDistributorLookup/1.0",
      },
    }, 14000);
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

async function openAiCandidates(query, apiKey, fetchWithTimeout) {
  if (!apiKey) return [];
  const models = [...new Set([
    process.env.OPENAI_DISTRIBUTOR_RESOLVER_MODEL,
    process.env.OPENAI_DISTRIBUTOR_MODEL,
    "gpt-5.6",
    "gpt-4.1-mini",
    "gpt-4.1",
  ].filter(Boolean))];
  let lastError = null;
  for (const model of models) {
    try {
      const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          tools: [{ type: "web_search", search_context_size: "low" }],
          tool_choice: "required",
          instructions: "Resolve company identities for a petroleum-industry search interface. Use web search. Return strict JSON only and never invent a company.",
          input: `Find up to 6 real United States fuel distributors, petroleum marketers, jobbers, petroleum transport companies, or wholesale fuel companies matching this search: ${query}\n\nDo not return ordinary individual gas stations unless the location is clearly a headquarters or office for the distributor. Prefer the legal company name and official website. Return only: {"candidates":[{"legal_name":"","headquarters":"","website":"","description":"why this is a match","confidence":"High|Medium|Low"}]}`,
          max_output_tokens: 2500,
        }),
      }, 50000);
      const text = await response.text();
      if (!response.ok) { lastError = new Error(`OpenAI ${response.status}: ${text.slice(0, 600)}`); continue; }
      const parsed = parseJson(responseText(JSON.parse(text)));
      return (Array.isArray(parsed.candidates) ? parsed.candidates : []).map((item) => ({ ...item, source: "ChatGPT web search" }));
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) console.warn("Distributor identity lookup fallback failed:", lastError.message || lastError);
  return [];
}

export function registerDistributorCompanySearchRoutes(app, options = {}) {
  const router = express.Router();
  const apiKey = options.openAiApiKey || process.env.OPENAI_API_KEY || "";
  const googleApiKey = options.googleApiKey || process.env.GOOGLE_API_KEY || "";
  const fetchWithTimeout = options.fetchWithTimeout || (async (url, init = {}, timeoutMs = 20000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  });

  router.get("/search", async (req, res) => {
    const query = clean(req.query?.q, 300);
    if (query.length < 2) return res.json({ ok: true, candidates: [] });
    const key = normalize(query);
    const cached = getCached(key);
    if (cached) return res.json({ ok: true, candidates: cached, cached: true });

    try {
      const [google, osm] = await Promise.all([
        googleCandidates(query, googleApiKey, fetchWithTimeout),
        nominatimCandidates(query, fetchWithTimeout),
      ]);
      let candidates = dedupeAndRank([...google, ...osm], query);
      const bestScore = candidates.length ? scoreCandidate(candidates[0], query) : 0;
      if (apiKey && (candidates.length < 3 || bestScore < 65)) {
        const ai = await openAiCandidates(query, apiKey, fetchWithTimeout);
        candidates = dedupeAndRank([...ai, ...candidates], query);
      }
      setCached(key, candidates);
      res.json({ ok: true, candidates });
    } catch (error) {
      console.error("Distributor company lookup failed:", error);
      res.status(502).json({ ok: false, message: "Company lookup failed. You can still select the exact name you entered." });
    }
  });

  app.use("/api/distributors", router);
}
