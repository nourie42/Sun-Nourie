import express from "express";

const SEARCH_CACHE = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 300;
const LOOKUP_TIMEOUT_MS = 14000;

function registryCompany(legal_name, aliases, headquarters, website, description) {
  return {
    legal_name,
    aliases,
    headquarters,
    website,
    description,
    confidence: "High",
    source: "Fuel IQ corporate distributor registry",
    verified_distributor: true,
  };
}

const KNOWN_COMPANIES = [
  registryCompany("J.H. Seale & Son, Inc.", ["jh seale", "j h seale", "j.h. seale", "jh seale and son"], "Sumter, South Carolina", "https://jhseale.com/", "Wholesale fuel distributor and petroleum transporter"),
  registryCompany("Mansfield Energy Corp.", ["mansfield", "mansfield energy", "mansfield oil", "mansfield wholesale"], "Gainesville, Georgia", "https://www.mansfield.energy/", "Wholesale fuel supplier, distributor, logistics, and energy services company"),
  registryCompany("TACenergy, LLC", ["tacenergy", "tac energy"], "Dallas, Texas", "https://www.tacenergy.com/", "Independent wholesale fuels distributor and petroleum marketer"),
  registryCompany("Tiger Fuel Company", ["tiger fuel", "tiger fuel company", "tiger fuels"], "Charlottesville, Virginia", "https://tigerfuel.com/", "Wholesale branded and unbranded motor-fuel distributor serving independent retailers"),
  registryCompany("Buchanan Oil Company", ["buchanan oil", "buchanan oil company", "buchanan petroleum"], "", "", "Corporate fuel distributor and petroleum marketer; exact legal entity and headquarters are verified during research"),
  registryCompany("Cary Oil Co., Inc.", ["cary oil", "cary oil company"], "Cary, North Carolina", "https://www.caryoil.com/", "Fuel supplier and petroleum distributor serving convenience-store retailers"),
  registryCompany("Petroleum Marketing Group, Inc.", ["petroleum marketing group", "pmg", "pmg fuel"], "Woodbridge, Virginia", "https://petromg.com/", "Wholesale motor-fuel distributor and petroleum marketer"),
  registryCompany("ARKO Petroleum Corp.", ["arko petroleum", "arko fuel"], "Richmond, Virginia", "https://www.arkopetroleum.com/", "Wholesale fuel distributor supplying third-party dealers and gas stations"),
  registryCompany("Sun Coast Resources, LLC", ["sun coast resources", "suncoast resources", "sun coast fuel"], "Houston, Texas", "https://suncoastresources.com/", "Petroleum distributor providing fuel, lubricants, emergency fueling, and logistics"),
  registryCompany("Offen Petroleum", ["offen", "offen petroleum", "offen petro"], "Denver, Colorado", "https://offenpetro.com/", "Wholesale fuel, lubricant, and DEF distributor"),
  registryCompany("Pilot Thomas Logistics", ["pilot thomas", "pilot thomas logistics"], "Grapevine, Texas", "https://www.pilotthomas.com/", "Commercial and industrial fuel and lubricant distributor"),
  registryCompany("World Kinect Corporation", ["world kinect", "world fuel", "world fuel services"], "Miami, Florida", "https://www.world-kinect.com/world-fuel", "Global land-fuel distributor, supplier, and logistics company"),
  registryCompany("SC Fuels", ["sc fuels", "southern counties oil"], "Orange, California", "https://www.scfuels.com/", "Fuel and petroleum distribution company providing unbranded fuel, fleet fueling, lubricants, and DEF"),
  registryCompany("Colonial Fuel & Lubricant Services, Inc.", ["colonial fuel", "colonial fuel and lubricant", "colonial oil industries"], "Savannah, Georgia", "https://colonialgroupinc.com/fuel-lubricants/", "Fuel and lubricant distributor serving commercial and wholesale customers"),
  registryCompany("Clipper Petroleum, Inc.", ["clipper petroleum", "clipper fuel"], "Flowery Branch, Georgia", "https://www.clipperpetroleum.com/", "Wholesale fuel distributor and petroleum marketer"),
  registryCompany("Valor Oil", ["valor oil", "valor oil company"], "Owensboro, Kentucky", "https://valoroil.com/", "Full-line petroleum distributor supplying stations and commercial customers"),
  registryCompany("Lard Oil Company", ["lard oil", "lard oil company"], "Denham Springs, Louisiana", "https://www.lardoil.com/", "Commercial, industrial, and marine fuel and lubricant distributor"),
  registryCompany("Lott Oil Company", ["lott oil", "lott oil company"], "Natchitoches, Louisiana", "https://lottoil.com/", "Regional fuel and lubricant distributor"),
  registryCompany("Waring Oil Company", ["waring oil", "waring oil company"], "Vicksburg, Mississippi", "https://waringoil.com/", "Wholesale fuel, lubricant, and DEF distributor"),
  registryCompany("McPherson Oil Company", ["mcpherson oil", "mcpherson oil company"], "Trussville, Alabama", "https://www.mcphersonoil.com/", "Southeast commercial fuel, lubricant, and petroleum distributor"),
  registryCompany("Southeast Petro Distributors, Inc.", ["southeast petro", "southeast petro distributors"], "Cocoa, Florida", "https://www.southeastpetro.com/", "Wholesale fuel distributor and branded-program supplier"),
  registryCompany("PURE Oil Jobbers Cooperative, Inc.", ["pure oil jobbers", "pure oil cooperative", "be sure with pure"], "Rock Hill, South Carolina", "https://besurewithpure.com/", "Wholesale motor-fuel supply cooperative"),
  registryCompany("Calloway Oil Company", ["calloway oil", "calloway oil company"], "Georgia", "https://callowayoil.com/", "Wholesale branded and unbranded fuel distributor"),
  registryCompany("JAT Energy", ["jat energy", "jat oil"], "Chattanooga, Tennessee", "https://jatoil.com/", "Bulk diesel and gasoline distributor"),
  registryCompany("Hendry Oil Company", ["hendry oil", "hendry oil company"], "Nashville, Arkansas", "https://hendryoilar.com/", "Fuel and lubricant supplier and distributor"),
  registryCompany("Stephenson Oil Company", ["stephenson oil", "stephenson oil company"], "North Little Rock, Arkansas", "https://www.stephensonoilco.com/", "Petroleum distributor supplying fuel, lubricants, and DEF"),
  registryCompany("Red River Oil Company", ["red river oil", "red river oil company"], "Ashdown, Arkansas", "https://www.redriveroilco.com/", "Regional fuel, oil, lubricant, and chemical distributor"),
  registryCompany("Sayle Oil Company", ["sayle oil", "sayle oil company"], "Mississippi", "https://www.sayleoil.com/", "Bulk fuel and lubricant distributor"),
  registryCompany("Best Wade Petroleum", ["best wade", "best wade petroleum", "wade inc petroleum"], "Memphis, Tennessee", "https://bestwade.com/", "Commercial fuel and lubricant distributor"),
  registryCompany("Shipley Energy", ["shipley energy", "shipley wholesale fuels"], "York, Pennsylvania", "https://shipleyenergy.com/", "Wholesale fuel distributor serving the Mid-Atlantic"),
  registryCompany("Atlas Oil Company", ["atlas oil", "atlas oil company"], "Taylor, Michigan", "https://www.atlasoil.com/", "National fuel supplier and distributor"),
  registryCompany("Arnold Oil Company Fuels, LLC", ["arnold oil", "arnold oil company", "arnold oil fuels"], "Austin, Texas", "https://www.arnoldoil.com/", "Petroleum, fuel, and lubricant distributor"),
  registryCompany("Arguindegui Oil Co. II, Ltd.", ["arguindegui oil", "arguindegui", "argpetro"], "San Antonio, Texas", "https://argpetro.com/", "Bulk gasoline, diesel, biofuel, and lubricant distributor"),
  registryCompany("Davidson Oil Company", ["davidson oil", "davidson oil company"], "Amarillo, Texas", "https://www.davidsonoil.com/", "Petroleum distributor"),
  registryCompany("Gaubert Oil Company, Inc.", ["gaubert oil", "gaubert oil company"], "Louisiana", "https://www.gaubertoil.com/", "Regional fuel and petroleum-products distributor"),
  registryCompany("The Kent Companies", ["kent oil", "kent companies", "the kent companies"], "Midland, Texas", "https://kentcompanies.com/", "Petroleum distributor, fuel marketer, and dealer supplier"),
  registryCompany("Reeder Distributors, Inc.", ["reeder distributors", "reeder fuel"], "Fort Worth, Texas", "https://reederdistributors.com/", "Petroleum and fuel distributor"),
  registryCompany("Sunoco LP", ["sunoco lp", "sunoco logistics fuel distribution"], "Dallas, Texas", "https://www.sunocolp.com/", "Wholesale motor-fuel distributor"),
  registryCompany("Texas Enterprises, Inc.", ["texas enterprises", "texas enterprises fuel"], "Austin, Texas", "https://texasenterprises.com/", "Fuel and lubricant distributor"),
  registryCompany("Bumgarner Oil Co., Inc.", ["bumgarner oil", "bumgarner oil company"], "Hickory, North Carolina", "https://bumgarneroil.com/", "Petroleum and motor-fuel distributor"),
  registryCompany("New Dixie Oil Corporation", ["new dixie oil", "new dixie"], "Roanoke Rapids, North Carolina", "https://newdixieoil.com/", "Oil, fuel, and LP-gas distributor"),
  registryCompany("Rex Oil Co.", ["rex oil", "rex oil company"], "Thomasville, North Carolina", "", "Wholesale gasoline and diesel distributor"),
  registryCompany("Henderson Oil Company", ["henderson oil", "henderson oil company"], "Hendersonville, North Carolina", "https://www.hendersonoil.com/", "Branded and unbranded petroleum distributor"),
  registryCompany("Keenan Energy Company", ["keenan energy", "keenan energy company"], "The Carolinas", "https://keenanenergy.com/", "Fuel distributor and gasoline-retailer supplier"),
  registryCompany("Dearybury Oil & Gas, Inc.", ["dearybury", "dearybury oil", "dearybury oil and gas"], "Spartanburg, South Carolina", "https://dearybury.com/", "Wholesale petroleum and renewable-fuels distributor"),
  registryCompany("Indigo Energy", ["indigo energy", "indigo petroleum"], "South Carolina", "https://indigoenergy.com/", "Wholesale petroleum provider and distributor"),
  registryCompany("Sommers Oil Company", ["sommers oil", "somco", "somco inc"], "Georgia", "https://sommersoil.com/", "Wholesale petroleum marketer and distributor"),
  registryCompany("Walthall Oil Company", ["walthall oil", "walthall oil company"], "Macon, Georgia", "https://walthalloil.com/", "Commercial and wholesale fuel distributor"),
  registryCompany("Carroll Independent Fuel Company", ["carroll fuel", "carroll independent fuel"], "Baltimore, Maryland", "https://carrollfuel.com/", "Motor-fuel distributor and wholesale petroleum marketer"),
  registryCompany("The Wills Group, Inc.", ["wills group", "the wills group"], "La Plata, Maryland", "https://www.willsgroup.com/", "Fuel distributor, dealer supplier, and petroleum marketer"),
  registryCompany("Tropic Oil Company", ["tropic oil", "tropic oil company"], "Miami, Florida", "https://tropicoil.com/", "Wholesale fuel and lubricant distributor"),
  registryCompany("John W. Stone Oil Distributor, LLC", ["john w stone oil", "stone oil distributor", "jw stone"], "Gretna, Louisiana", "https://www.jwstone.com/", "Fuel distributor, importer, and petroleum transporter"),
  registryCompany("Retif Oil & Fuel, LLC", ["retif oil", "retif oil and fuel"], "Harvey, Louisiana", "https://retifoil.com/", "Fuel and petroleum-products distributor"),
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

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output || []).flatMap((item) => item?.type === "message" ? (item.content || []) : [])
    .map((part) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n").trim();
}

function parseJsonObject(text) {
  const value = clean(text, 100000).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try { return JSON.parse(value.slice(start, end + 1)); }
  catch { return {}; }
}

function candidate(value, source) {
  if (!value || typeof value !== "object") return null;
  const name = clean(value.legal_name || value.name || value.display_name, 300);
  if (!name) return null;
  const aliases = Array.isArray(value.aliases) ? value.aliases.map((alias) => clean(alias, 200)).filter(Boolean).slice(0, 15) : [];
  return {
    name,
    legal_name: clean(value.legal_name || name, 300),
    aliases,
    headquarters: clean(value.headquarters || value.formatted_address || value.address || value.location, 500),
    website: validUrl(value.website || value.official_website),
    description: clean(value.description || value.match_reason || value.category || value.role, 700),
    confidence: clean(value.confidence || "Possible corporate match", 80),
    source: clean(value.source || source, 100),
    source_url: validUrl(value.source_url || value.public_url),
    verified_distributor: value.verified_distributor === true,
  };
}

const DISTRIBUTOR_SIGNAL = /wholesale|distribut(?:or|ion|ing)|petroleum marketer|fuel marketer|jobber|bulk fuel|dealer supply|branded.{0,20}unbranded|motor fuel supplier|fuel supplier|commercial fuel/i;
const LOCATION_ONLY_SIGNAL = /gas station|service station|filling station|petrol station|convenience store|truck stop|fuel\s*\/\s*amenity|amenity\s*\/\s*fuel|retail location|store location/i;

function isCorporateDistributor(value) {
  const item = candidate(value, value?.source || "Corporate search");
  if (!item) return false;
  if (item.verified_distributor) return true;
  const name = `${item.legal_name} ${item.name}`;
  const description = item.description;
  const combined = `${name} ${description} ${item.source}`;
  if (LOCATION_ONLY_SIGNAL.test(combined) && !DISTRIBUTOR_SIGNAL.test(description)) return false;
  if (/openstreetmap|nominatim|google places/i.test(item.source) && !DISTRIBUTOR_SIGNAL.test(description)) return false;
  if (!DISTRIBUTOR_SIGNAL.test(combined)) return false;
  return /oil|fuel|energy|petroleum|resources|marketing|distribut|supply|company|corp|inc|llc|lp|group/i.test(name);
}

function scoreCandidate(item, query, location = "") {
  const q = normalize(query);
  const names = [item.name, item.legal_name, ...(item.aliases || [])].map(normalize).filter(Boolean);
  const l = normalize(location);
  const h = normalize(item.headquarters);
  let score = 0;
  if (names.some((name) => name === q)) score += 110;
  if (names.some((name) => name.includes(q) || q.includes(name))) score += 60;
  const words = q.split(" ").filter((word) => word.length > 1);
  score += Math.max(0, ...names.map((name) => words.filter((word) => name.includes(word)).length * 14));
  if (DISTRIBUTOR_SIGNAL.test(`${item.name} ${item.description}`)) score += 28;
  if (item.verified_distributor) score += 25;
  if (l && h.includes(l)) score += 20;
  if (item.website) score += 8;
  if (item.headquarters) score += 5;
  if (LOCATION_ONLY_SIGNAL.test(`${item.name} ${item.description}`) && !DISTRIBUTOR_SIGNAL.test(item.description)) score -= 100;
  return score;
}

function dedupeAndRank(items, query, location = "") {
  const byKey = new Map();
  for (const raw of items) {
    const item = candidate(raw, raw?.source || "Corporate search");
    if (!item || !isCorporateDistributor(item)) continue;
    const key = normalize(item.legal_name || item.name);
    const existing = byKey.get(key);
    if (!existing || scoreCandidate(item, query, location) > scoreCandidate(existing, query, location)) byKey.set(key, item);
  }
  return [...byKey.values()]
    .sort((a, b) => scoreCandidate(b, query, location) - scoreCandidate(a, query, location))
    .slice(0, 8);
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

async function openAiCorporateCandidates(query, location, apiKey, fetchWithTimeout) {
  if (!apiKey) return [];
  const model = clean(process.env.OPENAI_DISTRIBUTOR_LOOKUP_MODEL || "gpt-4.1-mini", 100);
  const prompt = `Find corporate-level United States motor-fuel distributor companies matching this name.

SEARCH NAME: ${query}
LOCATION HINT: ${location || "None"}

A qualifying company must distribute or wholesale gasoline, diesel, branded/unbranded motor fuels, or related petroleum products to dealers, gas stations, fleets, commercial accounts, or resellers.

STRICT EXCLUSIONS:
- Do not return individual gas stations, convenience stores, truck stops, store locations, fuel pumps, or street addresses.
- Do not return a retail brand by itself unless the corporate parent is documented as a wholesale fuel distributor or petroleum marketer.
- Do not return unrelated companies that merely contain words such as oil, fuel, energy, tiger, market, or mart.
- Prefer the legal corporate entity and its headquarters, not a branch or customer location.

Use official company websites, state fuel-license records, and petroleum-marketer trade associations when possible. Return at most 8 matches. If no qualifying corporate distributor is found, return an empty array.

Return exactly one JSON object in this shape:
{"candidates":[{"legal_name":"","aliases":[],"headquarters":"","website":"","description":"Explain the documented wholesale/distributor role","confidence":"High|Medium","source":"Official company site|State fuel-license record|Trade association|Reputable corporate source","source_url":""}]}`;

  try {
    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        tools: [{ type: "web_search", search_context_size: "low" }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        instructions: "You identify corporate petroleum distributors for an M&A search tool. Exclude individual retail locations and return one valid JSON object only, with no markdown.",
        input: prompt,
        max_output_tokens: 2200,
      }),
    }, LOOKUP_TIMEOUT_MS);
    const text = await response.text();
    if (!response.ok) return [];
    const data = JSON.parse(text);
    const parsed = parseJsonObject(outputText(data));
    return (Array.isArray(parsed?.candidates) ? parsed.candidates : []).map((item) => ({
      ...item,
      source: item?.source || "Live corporate web search",
    }));
  } catch {
    return [];
  }
}

export function registerDistributorCompanySearchRoutes(app, options = {}) {
  const router = express.Router();
  const openAiApiKey = options.openAiApiKey || process.env.OPENAI_API_KEY || "";
  const fetchWithTimeout = options.fetchWithTimeout || (async (url, init = {}, timeoutMs = LOOKUP_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  });

  router.get("/search", async (req, res) => {
    const query = clean(req.query?.q, 300);
    const location = clean(req.query?.location, 300);
    if (query.length < 2) return res.json({ ok: true, candidates: [], corporateOnly: true });

    const key = `${normalize(query)}|${normalize(location)}`;
    const cached = getCached(key);
    if (cached) return res.json({ ok: true, candidates: cached, cached: true, corporateOnly: true, registryCount: KNOWN_COMPANIES.length });

    const known = knownCandidates(query, location);
    if (known.length && scoreCandidate(known[0], query, location) >= 90) {
      setCached(key, known);
      return res.json({ ok: true, candidates: known, fastMatch: true, corporateOnly: true, registryCount: KNOWN_COMPANIES.length });
    }

    try {
      const live = await openAiCorporateCandidates(query, location, openAiApiKey, fetchWithTimeout);
      const candidates = dedupeAndRank([...known, ...live], query, location);
      setCached(key, candidates);
      res.json({
        ok: true,
        candidates,
        corporateOnly: true,
        registryCount: KNOWN_COMPANIES.length,
        liveCorporateSearch: Boolean(openAiApiKey),
        lookupTimeoutMs: LOOKUP_TIMEOUT_MS,
      });
    } catch (error) {
      console.error("Distributor corporate company lookup failed:", error);
      res.json({ ok: true, candidates: known, partial: true, corporateOnly: true, registryCount: KNOWN_COMPANIES.length });
    }
  });

  app.use("/api/distributors", router);
}

export const __test = {
  KNOWN_COMPANIES,
  dedupeAndRank,
  isCorporateDistributor,
  knownCandidates,
  normalize,
  scoreCandidate,
};
