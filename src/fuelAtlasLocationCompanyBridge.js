import { randomUUID } from "node:crypto";
import { KNOWN_COMPANIES } from "./distributorDirectoryData.js";

const CONTEXT_TTL_MS = 5 * 60 * 1000;
const CONTEXT_LIMIT = 300;
const LOCATION_COOKIE = "fiq_atlas_location";
const contexts = new Map();

const STATE_PAIRS = [
  ["al", "alabama"], ["ak", "alaska"], ["az", "arizona"], ["ar", "arkansas"],
  ["ca", "california"], ["co", "colorado"], ["ct", "connecticut"], ["de", "delaware"],
  ["fl", "florida"], ["ga", "georgia"], ["hi", "hawaii"], ["id", "idaho"],
  ["il", "illinois"], ["in", "indiana"], ["ia", "iowa"], ["ks", "kansas"],
  ["ky", "kentucky"], ["la", "louisiana"], ["me", "maine"], ["md", "maryland"],
  ["ma", "massachusetts"], ["mi", "michigan"], ["mn", "minnesota"], ["ms", "mississippi"],
  ["mo", "missouri"], ["mt", "montana"], ["ne", "nebraska"], ["nv", "nevada"],
  ["nh", "new hampshire"], ["nj", "new jersey"], ["nm", "new mexico"], ["ny", "new york"],
  ["nc", "north carolina"], ["nd", "north dakota"], ["oh", "ohio"], ["ok", "oklahoma"],
  ["or", "oregon"], ["pa", "pennsylvania"], ["ri", "rhode island"], ["sc", "south carolina"],
  ["sd", "south dakota"], ["tn", "tennessee"], ["tx", "texas"], ["ut", "utah"],
  ["vt", "vermont"], ["va", "virginia"], ["wa", "washington"], ["wv", "west virginia"],
  ["wi", "wisconsin"], ["wy", "wyoming"], ["dc", "district of columbia"],
];
const STATE_BY_ALIAS = new Map(STATE_PAIRS.flatMap(([abbreviation, name]) => [[abbreviation, name], [name, name]]));
const COUNTRY_PART = /^(?:united states(?: of america)?|usa|us)$/i;
const CORPORATE_SUFFIX = /\b(?:incorporated|inc|llc|ltd|limited|corp|corporation|company|co|lp|l\s*p|pllc)\b/i;
const CORPORATE_TERM = /\b(?:fuel|fuels|oil|petroleum|propane|energy|energies|resources|distribut(?:or|ion|ing)?|marketer|marketing|jobber|wholesale|supplier|supply|logistics|cooperative)\b/i;
const STREET_TERM = /\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|highway|hwy|route|drive|dr|lane|ln|court|ct|parkway|pkwy|trail|trl|way|circle|cir|terrace|ter|place|pl)\b/i;

function clean(value, max = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function normalize(value) {
  return clean(value, 500)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalState(value) {
  const normalized = normalize(value).replace(/^state of\s+/, "");
  return STATE_BY_ALIAS.get(normalized) || "";
}

function normalizedCity(value) {
  return normalize(value)
    .replace(/^city of\s+/, "")
    .replace(/\s+county$/, "")
    .trim();
}

function locationParts(value) {
  const raw = clean(value, 700);
  if (!raw) return { city: "", state: "" };

  const commaParts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  let state = "";
  for (const part of commaParts) {
    state ||= canonicalState(part);
  }

  let city = "";
  for (const part of commaParts) {
    const normalized = normalize(part);
    if (!normalized || canonicalState(part) || COUNTRY_PART.test(part) || /\bcounty\b/i.test(part)) continue;
    city = normalizedCity(part);
    if (city) break;
  }

  if (commaParts.length === 1) {
    const only = normalize(commaParts[0]);
    state ||= canonicalState(only);
    if (!state) {
      const aliases = [...STATE_BY_ALIAS.keys()].sort((a, b) => b.length - a.length);
      const matchedAlias = aliases.find((alias) => only.endsWith(` ${alias}`));
      if (matchedAlias) {
        state = STATE_BY_ALIAS.get(matchedAlias) || "";
        city = normalizedCity(only.slice(0, -(matchedAlias.length + 1)));
      } else {
        city ||= normalizedCity(only);
      }
    } else {
      city = "";
    }
  }

  return { city, state };
}

function mergeLocationParts(primary, fallback) {
  const first = locationParts(primary);
  const second = locationParts(fallback);
  return {
    city: first.city || second.city,
    state: first.state || second.state,
  };
}

function headquartersDisplayParts(value) {
  const parts = clean(value, 500).split(",").map((part) => part.trim()).filter(Boolean);
  const statePart = parts.find((part) => canonicalState(part));
  const cityPart = parts.find((part) => !canonicalState(part) && !COUNTRY_PART.test(part) && !/\bcounty\b/i.test(part));
  return {
    city: cityPart || "",
    state: statePart ? STATE_BY_ALIAS.get(normalize(statePart)) || statePart : "",
  };
}

export function findDistributorCompaniesByLocation(location, fallbackLocation = "", limit = 100) {
  const target = mergeLocationParts(location, fallbackLocation);
  if (!target.city && !target.state) return [];

  return KNOWN_COMPANIES.filter((company) => {
    const headquarters = locationParts(company.headquarters);
    if (!headquarters.city && !headquarters.state) return false;
    if (target.city && target.state) return headquarters.city === target.city && headquarters.state === target.state;
    if (target.city) return headquarters.city === target.city;
    return headquarters.state === target.state;
  })
    .slice()
    .sort((a, b) => String(a.legal_name || a.name).localeCompare(String(b.legal_name || b.name)))
    .slice(0, Math.max(1, Number(limit) || 100));
}

export function looksLikeLocationSearch(query, resultLabel = "") {
  const value = clean(query, 500);
  if (!value || (!locationParts(resultLabel).city && !locationParts(resultLabel).state)) return false;
  const normalized = normalize(value);

  if (/^\d{5}(?:-\d{4})?$/.test(normalized)) return true;
  if (/^\d+\s+/.test(normalized) && STREET_TERM.test(normalized)) return true;
  if (canonicalState(value)) return true;

  const commaParts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const companyPortion = commaParts.slice(0, -1).join(" ");
    if (CORPORATE_SUFFIX.test(companyPortion)) return false;
    return true;
  }

  if (CORPORATE_SUFFIX.test(value) || CORPORATE_TERM.test(value)) return false;
  return true;
}

function pruneContexts() {
  const now = Date.now();
  for (const [key, value] of contexts) {
    if (!value || value.expiresAt <= now) contexts.delete(key);
  }
  while (contexts.size > CONTEXT_LIMIT) contexts.delete(contexts.keys().next().value);
}

function appendSetCookie(res, value) {
  const existing = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : undefined;
  const values = existing == null ? [] : (Array.isArray(existing) ? existing : [existing]);
  res.setHeader("Set-Cookie", [...values, value]);
}

function clearLocationCookie(res) {
  appendSetCookie(res, `${LOCATION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
}

function registerLocationContext(req, res, payload) {
  const result = payload?.result;
  const query = clean(req.query?.q, 500);
  const label = clean(result?.label, 700);
  clearLocationCookie(res);
  if (payload?.ok !== true || !result || !looksLikeLocationSearch(query, label)) {
    return { payload, count: 0 };
  }

  const companies = findDistributorCompaniesByLocation(label, query);
  if (!companies.length) return { payload, count: 0 };

  pruneContexts();
  const token = randomUUID();
  contexts.set(token, {
    expiresAt: Date.now() + CONTEXT_TTL_MS,
    query,
    label: label || query,
    lat: Number(result.lat),
    lon: Number(result.lon),
    companies,
  });
  appendSetCookie(res, `${LOCATION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.ceil(CONTEXT_TTL_MS / 1000)}; SameSite=Lax; HttpOnly`);
  return {
    payload: { ...payload, locationCompanyCount: companies.length },
    count: companies.length,
  };
}

function cookieValue(req, name) {
  const header = clean(req.headers?.cookie, 10000);
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); }
    catch { return item.slice(separator + 1).trim(); }
  }
  return "";
}

function centerInsideBounds(context, query = {}) {
  const south = Number(query.south);
  const west = Number(query.west);
  const north = Number(query.north);
  const east = Number(query.east);
  if (![south, west, north, east, context.lat, context.lon].every(Number.isFinite)) return false;
  const padLat = Math.max(0.02, (north - south) * 0.08);
  const padLon = Math.max(0.02, (east - west) * 0.08);
  return context.lat >= south - padLat && context.lat <= north + padLat
    && context.lon >= west - padLon && context.lon <= east + padLon;
}

function slug(value) {
  return normalize(value).replace(/\s+/g, "-").slice(0, 90) || randomUUID();
}

function spreadCoordinates(context, index, count) {
  if (count <= 1) return { lat: context.lat, lon: context.lon };
  const ring = Math.floor(index / 12);
  const slot = index % 12;
  const slots = Math.min(12, count - ring * 12);
  const angle = (Math.PI * 2 * slot) / Math.max(1, slots);
  const radius = 0.007 + ring * 0.004;
  const latitude = context.lat + Math.sin(angle) * radius;
  const longitudeScale = Math.max(0.3, Math.cos(context.lat * Math.PI / 180));
  return { lat: latitude, lon: context.lon + Math.cos(angle) * radius / longitudeScale };
}

function companyElement(company, context, index) {
  const name = clean(company.legal_name || company.name, 300);
  const headquarters = clean(company.headquarters, 500) || context.label;
  const location = headquartersDisplayParts(headquarters);
  const aliases = Array.isArray(company.aliases) ? company.aliases.filter(Boolean).join(", ") : clean(company.aliases, 500);
  const coordinates = spreadCoordinates(context, index, context.companies.length);
  const sourceName = clean(company.source, 160) || "Fuel IQ corporate distributor index";
  const website = clean(company.website, 1000);
  const sourceUrl = clean(company.source_url, 1000) || website || "/distributors.html";

  return {
    type: "corporate",
    id: `location-${slug(name)}-${index}`,
    lat: coordinates.lat,
    lon: coordinates.lon,
    source_name: sourceName,
    source_url: sourceUrl,
    tags: {
      name,
      office: "company",
      website,
      description: clean(company.description, 700) || "Corporate fuel distributor or petroleum marketer matched through the Fuel IQ corporate directory.",
      "addr:city": location.city,
      "addr:state": location.state,
      "fuel_iq:facility_type": "distributor",
      "fuel_iq:categories": "distributor",
      "fuel_iq:classification_basis": "Corporate distributor headquarters matched to the searched city using the Fuel IQ corporate index",
      "fuel_iq:qualification": "Corporate distributor matched by public headquarters or operating-area location",
      "fuel_iq:source": sourceName,
      "fuel_iq:company_search_result": "true",
      "fuel_iq:location_search_match": "true",
      "fuel_iq:headquarters": headquarters,
      "fuel_iq:aliases": aliases,
      "fuel_iq:parent_company": clean(company.parent_company, 300),
      "fuel_iq:location_precision": context.companies.length > 1
        ? `Corporate headquarters matched to ${context.label}; markers are spread slightly around the searched city center so each company remains selectable`
        : `Corporate headquarters matched to ${context.label}; verify an exact street address before site-level diligence`,
    },
  };
}

function augmentSearchPayload(req, payload) {
  if (payload?.ok !== true || !Array.isArray(payload?.elements)) return payload;
  pruneContexts();
  const token = cookieValue(req, LOCATION_COOKIE);
  const context = token ? contexts.get(token) : null;
  if (!context || !centerInsideBounds(context, req.query)) return payload;

  const existingCorporateNames = new Set(
    payload.elements
      .filter((element) => element?.type === "corporate")
      .map((element) => normalize(element?.tags?.name)),
  );
  const companies = context.companies
    .map((company, index) => companyElement(company, context, index))
    .filter((element) => !existingCorporateNames.has(normalize(element.tags.name)));
  if (!companies.length) return payload;

  const sources = [...new Set([...(Array.isArray(payload.sources) ? payload.sources : []), "Fuel IQ corporate distributor index"] )];
  const categoryCounts = { ...(payload.categoryCounts || {}) };
  categoryCounts.distributor = Number(categoryCounts.distributor || 0) + companies.length;
  return {
    ...payload,
    source: sources.join(" + "),
    sources,
    categoryCounts,
    elements: [...companies, ...payload.elements],
    locationCompanyCount: companies.length,
    locationSearchLabel: context.label,
  };
}

export function registerFuelAtlasLocationCompanyBridge(app) {
  app.use("/api/fuel-atlas", (req, res, next) => {
    if (req.method !== "GET") return next();
    const path = String(req.path || "");
    if (path !== "/geocode" && path !== "/search") return next();

    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      try {
        if (path === "/geocode") return originalJson(registerLocationContext(req, res, payload).payload);
        return originalJson(augmentSearchPayload(req, payload));
      } catch (error) {
        console.error("Fuel Atlas city-company bridge failed:", error);
        return originalJson(payload);
      }
    };
    return next();
  });
}

export const __test = {
  LOCATION_COOKIE,
  augmentSearchPayload,
  clearContexts() { contexts.clear(); },
  findDistributorCompaniesByLocation,
  locationParts,
  looksLikeLocationSearch,
  registerLocationContext,
};
