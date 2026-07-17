import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const baseUrl = String(process.env.FUEL_ATLAS_LIVE_URL || "https://sun-nourie-live.onrender.com").replace(/\/$/, "");
const deploymentDeadlineMs = Number(process.env.FUEL_ATLAS_DEPLOYMENT_WAIT_MS || 18 * 60 * 1000);
const pollMs = Number(process.env.FUEL_ATLAS_DEPLOYMENT_POLL_MS || 20 * 1000);
const REQUIRED_FILTER_VERSION = "verified-distributor-categories-v3";
const QUALIFYING_NAICS = new Set(["424710", "424720", "454310", "457210"]);
const RETAIL_NAICS = new Set(["447110", "447190", "457110", "457120"]);
const VALID_TYPES = new Set(["distributor", "heating_oil", "bulk_plant", "terminal", "propane"]);
const TERMINAL_TEXT = /\bterminal\b|\bdepot\b|\btank\s*farm\b/i;
const BULK_TEXT = /\bbulk\s+(?:plant|station|fuel\s+plant|oil\s+plant|petroleum\s+plant)\b/i;
const ROLE = /\b(distribut(?:or|ors|ion|ions|ing)?|wholesal(?:e|er|ers|ing)?|supplier|bulk\s+(?:plant|station)|terminal|depot|tank\s*farm|heating[ _-]?oil|fuel[ _-]?oil|propane|\blpg\b|oil\s+(?:co\.?|company)|fuel\s+(?:co\.?|company)|petroleum\s+(?:co\.?|company))\b/i;
const FORBIDDEN = /\b(gas\s+station|service\s+station|filling\s+station|fuel\s+center|travel\s+center|truck\s+stop|travel\s+plaza|truck\s+plaza|convenience|c-?store|food\s+mart|petro\s+mart|mini\s+mart|quick\s+mart|\bmart\b|retail|car\s+wash|oil\s+change|lube\s+shop|quick\s+lube|treatment\s+plant|wastewater|sewage|water\s+treatment|remediation|cleanup|spill\s+site|landfill|power\s+plant|generating\s+station|school|hospital)\b/i;
const BANNED_EXACT = ["PETRO MART #9", "ADMIRAL PETROLEUM #5390-TREATMENT PLANT #1"];

const regions = [
  { name: "South Hill Virginia", south: 36.55, west: -78.35, north: 36.90, east: -77.90, zoom: 10 },
  { name: "North Carolina Triangle", south: 35.20, west: -79.50, north: 36.20, east: -78.00, zoom: 9 },
  { name: "Virginia and Carolinas", south: 33.50, west: -84.50, north: 39.50, east: -75.00, zoom: 7 },
  { name: "Philadelphia", south: 39.70, west: -75.50, north: 40.20, east: -74.90, zoom: 10 },
  { name: "Houston", south: 29.55, west: -95.65, north: 30.05, east: -95.05, zoom: 10 },
  { name: "Newark / Elizabeth", south: 40.55, west: -74.35, north: 40.85, east: -73.95, zoom: 10 },
  { name: "Chicago", south: 41.65, west: -88.05, north: 42.10, east: -87.45, zoom: 10 },
  { name: "Los Angeles / Long Beach", south: 33.65, west: -118.45, north: 34.15, east: -117.85, zoom: 10 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { Accept: "application/json,text/html;q=0.9", "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function searchUrl(region) {
  const params = new URLSearchParams({
    south: String(region.south),
    west: String(region.west),
    north: String(region.north),
    east: String(region.east),
    zoom: String(region.zoom),
    v: REQUIRED_FILTER_VERSION,
    smoke: String(Date.now()),
  });
  return `${baseUrl}/api/fuel-atlas/search?${params.toString()}`;
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.slice(0, 180)}`); }
}

function parseCodes(value) {
  return [...new Set((String(value || "").match(/\b\d{6}\b/g) || []))];
}

function parseCategories(value, primary) {
  const supplied = String(value || "").split(",").map((item) => item.trim()).filter((item) => VALID_TYPES.has(item));
  if (supplied.length) return [...new Set(supplied)];
  return primary === "heating_oil" || primary === "propane" ? ["distributor", primary] : [primary];
}

function inspectElement(element) {
  const tags = element?.tags || {};
  const name = String(tags.name || "Unnamed");
  const upperName = name.toUpperCase();
  const text = [
    name, tags.operator, tags.owner, tags.description, tags.industrial, tags.shop,
    tags.office, tags["fuel_iq:qualification"], tags["fuel_iq:classification_basis"],
  ].filter(Boolean).join(" ");
  const codes = parseCodes(tags["fuel_iq:naics_codes"] || tags.naics || tags["naics:code"]);
  const primary = String(tags["fuel_iq:facility_type"] || "");
  const categories = parseCategories(tags["fuel_iq:categories"], primary);
  const forbidden = String(tags.amenity || "").toLowerCase() === "fuel"
    || ["fuel", "gas", "convenience", "supermarket"].includes(String(tags.shop || "").toLowerCase())
    || FORBIDDEN.test(text)
    || BANNED_EXACT.includes(upperName);
  const qualified = !forbidden
    && VALID_TYPES.has(primary)
    && categories.every((category) => VALID_TYPES.has(category))
    && (codes.some((code) => QUALIFYING_NAICS.has(code)) || ROLE.test(text));
  const retailCode = codes.some((code) => RETAIL_NAICS.has(code));
  const categoryError = primary === "terminal" && !TERMINAL_TEXT.test(text)
    ? "terminal without explicit terminal/depot/tank-farm wording"
    : primary === "bulk_plant" && !BULK_TEXT.test(text)
      ? "bulk plant without explicit bulk-plant/station wording"
      : primary === "distributor" && (TERMINAL_TEXT.test(name) || BULK_TEXT.test(name))
        ? "explicit terminal/bulk name mislabeled distributor"
        : (primary === "heating_oil" || primary === "propane") && !categories.includes("distributor")
          ? "dealer specialty missing distributor category"
          : retailCode && !TERMINAL_TEXT.test(text) && !BULK_TEXT.test(text)
            ? "retail NAICS without a physical bulk/terminal role"
            : "";
  return {
    name,
    codes,
    primary,
    categories,
    classificationBasis: String(tags["fuel_iq:classification_basis"] || ""),
    qualification: String(tags["fuel_iq:qualification"] || ""),
    forbidden,
    qualified,
    categoryError,
  };
}

async function deployedVersionReady() {
  const pageResponse = await fetchWithTimeout(`${baseUrl}/fuel-atlas.html?smoke=${Date.now()}`, 25000);
  if (!pageResponse.ok) return { ready: false, detail: `page HTTP ${pageResponse.status}` };
  const html = await pageResponse.text();
  const correctUi = html.includes('id="loadingOverlay"')
    && html.includes('class="radar"')
    && html.includes("Business role and physical facility type are classified separately")
    && html.includes(REQUIRED_FILTER_VERSION);
  if (!correctUi) return { ready: false, detail: "corrected category UI not deployed" };

  const response = await fetchWithTimeout(searchUrl(regions[0]), 45000);
  if (!response.ok) return { ready: false, detail: `search HTTP ${response.status}` };
  const payload = await readJson(response);
  if (payload?.filterVersion !== REQUIRED_FILTER_VERSION) {
    return { ready: false, detail: `filter=${payload?.filterVersion || "missing"}` };
  }
  if (!payload?.categoryCounts || !Array.isArray(payload.elements)) {
    return { ready: false, detail: "category-aware API not deployed" };
  }
  return { ready: true, detail: `records=${payload.elements.length}; categories=${JSON.stringify(payload.categoryCounts)}` };
}

async function waitForDeployment() {
  const deadline = Date.now() + deploymentDeadlineMs;
  let lastDetail = "not checked";
  while (Date.now() < deadline) {
    try {
      const status = await deployedVersionReady();
      lastDetail = status.detail;
      console.log(`[deploy] ${status.ready ? "ready" : "waiting"}: ${status.detail}`);
      if (status.ready) return;
    } catch (error) {
      lastDetail = error?.name === "AbortError" ? "deployment check timed out" : String(error?.message || error);
      console.log(`[deploy] waiting: ${lastDetail}`);
    }
    await sleep(pollMs);
  }
  throw new Error(`Render did not deploy the corrected-category Fuel Atlas before the deadline. Last status: ${lastDetail}`);
}

await waitForDeployment();

const results = [];
for (const region of regions) {
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(searchUrl(region), 45000);
    const payload = await readJson(response);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || `HTTP ${response.status}`);
    if (payload.filterVersion !== REQUIRED_FILTER_VERSION) throw new Error(`wrong filter version ${payload.filterVersion || "missing"}`);

    const elements = Array.isArray(payload.elements) ? payload.elements : [];
    const inspected = elements.map(inspectElement);
    const forbidden = inspected.filter((item) => item.forbidden);
    const unqualified = inspected.filter((item) => !item.qualified);
    const categoryErrors = inspected.filter((item) => item.categoryError);
    const categoryCounts = { distributor: 0, heating_oil: 0, bulk_plant: 0, terminal: 0, propane: 0 };
    for (const item of inspected) for (const category of item.categories) categoryCounts[category] += 1;

    const elapsedMs = Date.now() - startedAt;
    const samples = inspected.slice(0, 15);
    results.push({
      region: region.name,
      ok: true,
      count: elements.length,
      forbidden: forbidden.length,
      unqualified: unqualified.length,
      categoryErrors: categoryErrors.length,
      categoryCounts,
      elapsedMs,
      sources: payload.sources || [],
      partial: payload.partial === true,
      samples,
    });
    console.log(`[search] ${region.name}: ${elements.length} verified, categories=${JSON.stringify(categoryCounts)}, ${forbidden.length} forbidden, ${unqualified.length} unqualified, ${categoryErrors.length} category errors, ${elapsedMs}ms`);
    for (const sample of samples.slice(0, 6)) {
      console.log(`  - ${sample.name} [${sample.primary}; ${sample.categories.join(",")}; ${sample.classificationBasis}]`);
    }
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    results.push({
      region: region.name,
      ok: false,
      count: 0,
      forbidden: 0,
      unqualified: 0,
      categoryErrors: 0,
      categoryCounts: {},
      elapsedMs,
      error: error?.name === "AbortError" ? "request timed out" : String(error?.message || error),
    });
    console.log(`[search] ${region.name}: FAILED after ${elapsedMs}ms — ${results.at(-1).error}`);
  }
}

const successful = results.filter((result) => result.ok);
const totalFacilities = successful.reduce((sum, result) => sum + result.count, 0);
const totalForbidden = successful.reduce((sum, result) => sum + result.forbidden, 0);
const totalUnqualified = successful.reduce((sum, result) => sum + result.unqualified, 0);
const totalCategoryErrors = successful.reduce((sum, result) => sum + result.categoryErrors, 0);
const totals = { distributor: 0, heating_oil: 0, bulk_plant: 0, terminal: 0, propane: 0 };
for (const result of successful) {
  for (const [category, count] of Object.entries(result.categoryCounts)) totals[category] += count;
}

const southHill = results.find((result) => result.region === "South Hill Virginia");
const triangle = results.find((result) => result.region === "North Carolina Triangle");
const broad = results.find((result) => result.region === "Virginia and Carolinas");
const allSamples = successful.flatMap((result) => result.samples);
const pearce = allSamples.find((item) => /PEARCE OIL COMPANY/i.test(item.name));
const bannedNamesPresent = BANNED_EXACT.filter((name) => allSamples.some((item) => item.name.toUpperCase() === name));

assert.ok(successful.length >= 6, `Only ${successful.length} of ${regions.length} live regional searches succeeded`);
assert.ok(totalFacilities > 0, "Live Fuel Atlas returned zero verified locations");
assert.equal(totalForbidden, 0, "Live Fuel Atlas returned a gas station, mart, treatment plant or other forbidden facility");
assert.equal(totalUnqualified, 0, "Live Fuel Atlas returned a location without fuel-distribution evidence");
assert.equal(totalCategoryErrors, 0, "Live Fuel Atlas returned one or more incorrectly assigned facility categories");
assert.ok(southHill?.ok, "South Hill live search did not succeed");
assert.ok(pearce, "Pearce Oil Company was not returned by the live South Hill search");
assert.equal(pearce.primary, "distributor", "Pearce Oil Company is still not classified as a distributor");
assert.equal(pearce.categories.includes("bulk_plant"), false, "Pearce Oil Company is still included in the Bulk plants filter");
assert.ok(triangle?.categoryCounts?.distributor > 0, "North Carolina Triangle returned no distributors/dealers");
assert.ok(broad?.categoryCounts?.distributor >= 3, "Virginia and Carolinas returned too few distributor/dealer records");
assert.ok(totals.distributor > 0, "No distributor/dealer category records were returned");
assert.ok(totals.terminal > 0, "No explicit terminal/depot records were retained");
assert.ok(totals.heating_oil + totals.propane > 0, "No heating-oil or propane dealer records were returned");
assert.equal(bannedNamesPresent.length, 0, "A banned false-positive name remains in the live results");

const status = {
  ok: true,
  classificationRule: "NAICS qualifies inclusion; explicit facility wording determines terminal or bulk-plant labels. Oil companies, wholesalers, suppliers and fuel dealers default to Distributor when no physical terminal/bulk wording is present. Heating-oil and propane dealers are also included in Distributor.",
  filterVersion: REQUIRED_FILTER_VERSION,
  verifiedAt: new Date().toISOString(),
  verifiedCommit: process.env.GITHUB_SHA || null,
  liveUrl: baseUrl,
  successfulSearches: successful.length,
  attemptedSearches: regions.length,
  totalFacilities,
  categoryTotals: totals,
  forbiddenFacilities: totalForbidden,
  unqualifiedFacilities: totalUnqualified,
  categoryErrors: totalCategoryErrors,
  pearceOilClassification: pearce,
  bannedNamesPresent,
  results,
};

const statusPath = path.resolve("docs", "fuel-atlas-live-status.json");
fs.mkdirSync(path.dirname(statusPath), { recursive: true });
fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);

console.log(`Fuel Atlas live category smoke passed: ${successful.length}/${regions.length} searches, ${totalFacilities} facilities, totals=${JSON.stringify(totals)}, zero category errors.`);
console.log(`Wrote ${statusPath}`);
