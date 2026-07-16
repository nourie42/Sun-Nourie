import express from "express";
import { KNOWN_COMPANIES } from "./distributorDirectoryData.js";

const SEARCH_CACHE = new Map();
const IN_FLIGHT = new Map();
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_LIMIT = 300;
const LOOKUP_TIMEOUT_MS = Number(process.env.DISTRIBUTOR_COMPANY_LOOKUP_TIMEOUT_MS || 26000);

const ALLOWED_ENTITY_TYPES = new Set([
  "corporate_distributor", "fuel_distributor", "petroleum_marketer", "fuel_jobber", "jobber",
  "wholesale_fuel_supplier", "bulk_fuel_supplier", "commercial_fuel_supplier",
  "heating_fuel_distributor", "propane_distributor", "fuel_cooperative", "integrated_fuel_marketer",
]);
const REJECTED_ENTITY_TYPES = new Set([
  "gas_station", "service_station", "convenience_store", "retail_location", "store_location",
  "travel_center", "truck_stop", "fuel_brand", "directory", "map_listing", "terminal_only", "refiner_only",
]);
const CORPORATE_SIGNAL = /\b(distribut(?:or|ion|es|ing)|wholesale|petroleum marketer|fuel marketer|jobber|bulk fuel|commercial fuel|fleet fuel|mobile fuel|delivered fuel|heating oil|propane|lubricant|cardlock|energy logistics|fuel supply)\b/i;
const LOCATION_SIGNAL = /\b(gas station|service station|convenience store|c-?store|retail location|store location|travel center|truck stop|fuel stop|amenity\s*\/\s*fuel|amenity=fuel)\b/i;
const LOCATION_NAME = /\b(store|station|market|mart|travel center|truck stop)\s*#?\s*\d+\b/i;

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function normalize(value) {
  return clean(value, 500).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function validUrl(value) {
  const url = clean(value, 2000);
  if (!/^https?:\/\//i.test(url)) return "";
  try { return new URL(url).toString(); }
  catch { return ""; }
}

function stringList(value, maxItems = 20) {
  const values = Array.isArray(value) ? value : (value == null || value === "" ? [] : [value]);
  return [...new Set(values.map((item) => clean(item, 300)).filter(Boolean))].slice(0, maxItems);
}

function candidate(value, source = "Live corporate web verification") {
  if (!value || typeof value !== "object") return null;
  const name = clean(value.legal_name || value.name || value.company_name || value.display_name, 300);
  if (!name) return null;

  const aliases = stringList(value.aliases || value.dbas || value.other_names);
  const distributorTypes = stringList(value.distributor_types || value.business_types || value.fuel_types);
  const website = validUrl(value.website || value.official_website);
  const sourceUrl = validUrl(value.source_url || value.evidence_url || value.public_url || website);
  const entityType = normalize(value.entity_type || value.classification || (value.directory_match ? "corporate_distributor" : "")).replaceAll(" ", "_");

  return {
    name,
    legal_name: clean(value.legal_name || name, 300),
    aliases,
    headquarters: clean(value.headquarters || value.corporate_headquarters || value.hq || value.location, 500),
    website,
    description: clean(value.description || value.match_reason || value.category || value.business_summary, 700),
    distributor_types: distributorTypes,
    parent_company: clean(value.parent_company || value.parent || value.owner, 300),
    corporate_evidence: clean(value.corporate_evidence || value.evidence || value.verification || "", 1200),
    entity_type: entityType || "unknown",
    confidence: clean(value.confidence || "Possible corporate match", 100),
    source: clean(value.source || source, 120),
    source_url: sourceUrl,
    directory_match: Boolean(value.directory_match),
  };
}

function isCorporateDistributor(value) {
  const item = candidate(value, value?.source);
  if (!item) return false;
  if (item.directory_match) return true;
  if (REJECTED_ENTITY_TYPES.has(item.entity_type)) return false;

  const text = [item.legal_name, item.description, item.corporate_evidence, item.distributor_types.join(" ")].join(" ");
  const hasCorporateSignal = CORPORATE_SIGNAL.test(text);
  const allowedType = ALLOWED_ENTITY_TYPES.has(item.entity_type);
  if (!allowedType && !hasCorporateSignal) return false;
  if (LOCATION_NAME.test(item.legal_name) && !allowedType) return false;
  if (LOCATION_SIGNAL.test(text) && !hasCorporateSignal) return false;
  return true;
}

function namesFor(item) {
  return [item.legal_name, item.name, ...(item.aliases || [])].map(normalize).filter(Boolean);
}

function scoreCandidate(value, query, location = "") {
  const item = candidate(value, value?.source);
  if (!item) return -1000;
  const q = normalize(query);
  const l = normalize(location);
  const h = normalize(item.headquarters);
  const names = namesFor(item);
  let score = 0;

  for (const name of names) {
    if (name === q) score = Math.max(score, 150);
    else if (name.startsWith(q) || q.startsWith(name)) score = Math.max(score, 95);
    else if (name.includes(q) || q.includes(name)) score = Math.max(score, 70);
  }

  const words = q.split(" ").filter((word) => word.length > 1);
  const matchedWords = words.filter((word) => names.some((name) => name.includes(word))).length;
  score += matchedWords * 13;
  if (matchedWords === words.length && words.length > 1) score += 15;
  if (item.directory_match) score += 24;
  if (ALLOWED_ENTITY_TYPES.has(item.entity_type)) score += 24;
  if (CORPORATE_SIGNAL.test(`${item.description} ${item.corporate_evidence} ${item.distributor_types.join(" ")}`)) score += 18;
  if (item.website) score += 10;
  if (item.headquarters) score += 7;
  if (/official|trade association|state record|corporate directory/i.test(`${item.source} ${item.confidence}`)) score += 8;
  if (l && h.includes(l)) score += 20;
  return score;
}

function companyKey(item) {
  let host = "";
  try { host = item.website ? new URL(item.website).hostname.replace(/^www\./, "") : ""; }
  catch {}
  return host || normalize(item.legal_name || item.name);
}

function dedupeAndRank(items, query, location = "", limit = 12) {
  const byKey = new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    const item = candidate(raw, raw?.source || "Corporate distributor search");
    if (!item || !isCorporateDistributor(item)) continue;
    const key = companyKey(item);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || scoreCandidate(item, query, location) > scoreCandidate(existing, query, location)) byKey.set(key, item);
  }
  return [...byKey.values()]
    .filter((item) => scoreCandidate(item, query, location) > 0)
    .sort((a, b) => scoreCandidate(b, query, location) - scoreCandidate(a, query, location))
    .slice(0, limit);
}

function knownCandidates(query, location = "") {
  const q = normalize(query);
  if (q.length < 2) return [];
  const matches = KNOWN_COMPANIES.filter((company) =>
    namesFor(company).some((name) => name === q || name.startsWith(q) || name.includes(q) || q.includes(name))
  );
  return dedupeAndRank(matches, query, location);
}

function getCached(key) {
  const hit = SEARCH_CACHE.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    SEARCH_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key, value) {
  while (SEARCH_CACHE.size >= CACHE_LIMIT) SEARCH_CACHE.delete(SEARCH_CACHE.keys().next().value);
  const ttl = value?.candidates?.length ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
  SEARCH_CACHE.set(key, { value, expiresAt: Date.now() + ttl });
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output || [])
    .flatMap((item) => item?.type === "message" ? (item.content || []) : [])
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseJsonObject(text) {
  const value = clean(text, 300000).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const objectStart = value.indexOf("{");
  const objectEnd = value.lastIndexOf("}");
  const arrayStart = value.indexOf("[");
  const arrayEnd = value.lastIndexOf("]");
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(value.slice(objectStart, objectEnd + 1));
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(value.slice(arrayStart, arrayEnd + 1));
  throw new Error("Corporate distributor search did not return JSON.");
}

function modelAttempts() {
  const configured = clean(process.env.OPENAI_DISTRIBUTOR_SEARCH_MODELS || process.env.OPENAI_DISTRIBUTOR_SEARCH_MODEL, 300);
  const values = configured
    ? configured.split(",").map((value) => clean(value, 100)).filter(Boolean)
    : ["gpt-4.1-mini", "gpt-5.6"];
  return [...new Set(values)];
}

function corporateSearchPrompt(query, location, directoryMatches) {
  const directoryContext = directoryMatches.length
    ? directoryMatches.map((item) => [item.legal_name, item.headquarters, item.website].filter(Boolean).join(" | ")).map((line) => `- ${line}`).join("\n")
    : "- No exact name-index match. Search aliases, DBAs, former names, and parent companies.";

  return `Perform an exhaustive live-web search for CORPORATE fuel distributors or petroleum marketers matching the user's text.

USER QUERY: ${query}
LOCATION HINT: ${location || "None"}
FUEL IQ CORPORATE NAME-INDEX MATCHES:
${directoryContext}

Search multiple query variants: the exact phrase plus fuel distributor; petroleum marketer; jobber; wholesale fuel; bulk fuel; commercial fuel; fleet fueling; likely legal names; DBAs; former names; parent companies; and acquisition records.

STRICT ENTITY RULES:
- Return corporate organizations only.
- A qualifying organization must distribute, wholesale, market, deliver, or resell physical motor fuel, diesel, gasoline, heating oil, propane, aviation fuel, marine fuel, or related petroleum products.
- A retailer qualifies only when a corporate-level source proves a wholesale, distribution, delivered-fuel, fleet-fueling, or petroleum-marketing operation.
- Return the legal/corporate company, not an individual station, convenience store, dealer site, branch, terminal address, truck stop, fuel stop, or map listing.
- Never return OpenStreetMap, Google Maps, Yelp, MapQuest, or another location record as the company identity.
- Do not return a fuel brand by itself unless it is also the corporate distributor.
- Do not return a refiner, terminal, carrier, equipment vendor, or software company unless a source proves it also distributes fuel.
- Prefer official company websites and corroborate with trade associations, corporate filings, acquisition releases, government records, or reputable industry publications.
- If evidence is insufficient, omit the candidate. Do not guess.

Return exactly one JSON object and nothing else:
{"candidates":[{"legal_name":"","aliases":[],"headquarters":"City, State","website":"https://official-site.example/","description":"","entity_type":"fuel_distributor | petroleum_marketer | fuel_jobber | wholesale_fuel_supplier | bulk_fuel_supplier | commercial_fuel_supplier | heating_fuel_distributor | propane_distributor | fuel_cooperative | integrated_fuel_marketer","distributor_types":[],"parent_company":"","corporate_evidence":"","confidence":"High | Medium","source":"Official company site | Trade association | Government/corporate record | Industry publication","source_url":"https://specific-evidence-page.example/"}]}

Return at most 12 candidates, ranked by exact-name and alias relevance. An empty array is better than a gas-station or store-location result.`;
}

async function openAiCandidates(query, location, directoryMatches, apiKey, fetchWithTimeout) {
  if (!apiKey) return { candidates: [], model: "", error: "OPENAI_API_KEY is not configured." };

  const errors = [];
  for (const model of modelAttempts()) {
    const body = {
      model,
      store: false,
      tools: [{ type: "web_search", search_context_size: "medium" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      instructions: "You are a corporate-entity researcher for the U.S. downstream petroleum industry. Search the live web thoroughly, enforce the corporate-only rules, and return one valid JSON object with no markdown.",
      input: corporateSearchPrompt(query, location, directoryMatches),
      max_output_tokens: Number(process.env.OPENAI_DISTRIBUTOR_SEARCH_MAX_OUTPUT_TOKENS || 4000),
    };
    if (/^gpt-5/i.test(model)) body.reasoning = { effort: "low" };

    try {
      const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, LOOKUP_TIMEOUT_MS);
      const text = await response.text();
      if (!response.ok) {
        let detail = text;
        try { detail = JSON.parse(text)?.error?.message || text; }
        catch {}
        throw new Error(`OpenAI ${response.status} (${model}): ${clean(detail, 900)}`);
      }

      const data = JSON.parse(text);
      const parsed = parseJsonObject(outputText(data));
      const rawCandidates = Array.isArray(parsed) ? parsed : parsed?.candidates;
      const candidates = (Array.isArray(rawCandidates) ? rawCandidates : [])
        .map((item) => candidate({ ...item, source: item?.source || "Live corporate web verification" }, "Live corporate web verification"))
        .filter(Boolean);
      return { candidates, model, error: "" };
    } catch (error) {
      const message = clean(error?.message || error, 1200);
      errors.push(message);
      if (error?.name === "AbortError" || /aborted|timeout/i.test(message)) break;
    }
  }
  return { candidates: [], model: "", error: errors.at(-1) || "Live corporate distributor search failed." };
}

function createDefaultFetchWithTimeout() {
  return async function fetchWithTimeout(url, init = {}, timeoutMs = LOOKUP_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  };
}

async function exhaustiveSearch({ query, location, apiKey, fetchWithTimeout }) {
  const directoryMatches = knownCandidates(query, location);
  const live = await openAiCandidates(query, location, directoryMatches, apiKey, fetchWithTimeout);
  const candidates = dedupeAndRank([...directoryMatches, ...live.candidates], query, location);
  return {
    candidates,
    corporateOnly: true,
    excludedLocationResults: true,
    exhaustiveSearchCompleted: !live.error,
    liveSearchModel: live.model,
    partial: Boolean(live.error),
    message: live.error
      ? "Live corporate verification was unavailable; showing corporate name-index matches only."
      : "Corporate distributor search completed.",
  };
}

export function registerDistributorCompanySearchRoutes(app, options = {}) {
  const router = express.Router();
  const apiKey = options.openAiApiKey || process.env.OPENAI_API_KEY || "";
  const fetchWithTimeout = options.fetchWithTimeout || createDefaultFetchWithTimeout();

  router.get("/search", async (req, res) => {
    const query = clean(req.query?.q, 300);
    const location = clean(req.query?.location, 300);
    const mode = clean(req.query?.mode, 30).toLowerCase() === "directory" ? "directory" : "exhaustive";
    res.setHeader("Cache-Control", "no-store");

    if (query.length < 2) return res.json({ ok: true, candidates: [], corporateOnly: true, excludedLocationResults: true, searchMode: mode });

    if (mode === "directory") {
      return res.json({
        ok: true,
        candidates: knownCandidates(query, location),
        corporateOnly: true,
        excludedLocationResults: true,
        searchMode: "directory",
        liveSearchPending: Boolean(apiKey),
        registryCount: KNOWN_COMPANIES.length,
      });
    }

    const key = `${normalize(query)}|${normalize(location)}`;
    const cached = getCached(key);
    if (cached) return res.json({ ok: true, ...cached, cached: true, searchMode: "exhaustive", registryCount: KNOWN_COMPANIES.length });

    try {
      let searchPromise = IN_FLIGHT.get(key);
      if (!searchPromise) {
        searchPromise = exhaustiveSearch({ query, location, apiKey, fetchWithTimeout }).finally(() => IN_FLIGHT.delete(key));
        IN_FLIGHT.set(key, searchPromise);
      }
      const result = await searchPromise;
      setCached(key, result);
      return res.json({ ok: true, ...result, searchMode: "exhaustive", registryCount: KNOWN_COMPANIES.length });
    } catch (error) {
      console.error("Corporate distributor lookup failed:", error);
      const candidates = knownCandidates(query, location);
      return res.json({
        ok: true,
        candidates,
        corporateOnly: true,
        excludedLocationResults: true,
        exhaustiveSearchCompleted: false,
        partial: true,
        searchMode: "exhaustive",
        registryCount: KNOWN_COMPANIES.length,
        message: candidates.length
          ? "Live corporate verification failed; showing corporate name-index matches."
          : "No corporate distributor match could be verified.",
      });
    }
  });

  app.use("/api/distributors", router);
}

export const __test = {
  KNOWN_COMPANIES,
  candidate,
  dedupeAndRank,
  isCorporateDistributor,
  knownCandidates,
  normalize,
  scoreCandidate,
};
