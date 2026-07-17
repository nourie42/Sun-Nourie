import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const baseUrl = String(process.env.FUEL_ATLAS_LIVE_URL || "https://sun-nourie-live.onrender.com").replace(/\/$/, "");
const deploymentDeadlineMs = Number(process.env.FUEL_ATLAS_DEPLOYMENT_WAIT_MS || 18 * 60 * 1000);
const pollMs = Number(process.env.FUEL_ATLAS_DEPLOYMENT_POLL_MS || 20 * 1000);
const REQUIRED_FILTER_VERSION = "verified-distributors-v2";
const QUALIFYING_NAICS = new Set(["424710", "424720", "454310", "457210"]);
const RETAIL_NAICS = new Set(["447110", "447190", "457110", "457120"]);
const ROLE = /\b(distribut(?:or|ors|ion|ions|ing)?|wholesal(?:e|er|ing)?|bulk(?:\s+(?:plant|station|fuel))?|terminal|depot|tank\s*farm|storage\s+terminal|heating[ _-]?oil|fuel[ _-]?oil|home\s+heating|propane|\blpg\b|card\s*lock)\b/i;
const FORBIDDEN = /\b(gas\s+station|service\s+station|filling\s+station|fuel\s+center|travel\s+center|truck\s+stop|travel\s+plaza|truck\s+plaza|convenience|c-?store|food\s+mart|petro\s+mart|mini\s+mart|quick\s+mart|\bmart\b|retail|car\s+wash|oil\s+change|lube\s+shop|quick\s+lube|treatment\s+plant|wastewater|sewage|water\s+treatment|remediation|cleanup|spill\s+site|landfill|power\s+plant|generating\s+station|school|hospital)\b/i;
const BANNED_EXACT = ["PETRO MART #9", "ADMIRAL PETROLEUM #5390-TREATMENT PLANT #1"];

const metros = [
  { name: "North Carolina Triangle", south: 35.20, west: -79.50, north: 36.20, east: -78.00, zoom: 9 },
  { name: "Philadelphia", south: 39.70, west: -75.50, north: 40.20, east: -74.90, zoom: 10 },
  { name: "Houston", south: 29.55, west: -95.65, north: 30.05, east: -95.05, zoom: 10 },
  { name: "Newark / Elizabeth", south: 40.55, west: -74.35, north: 40.85, east: -73.95, zoom: 10 },
  { name: "Chicago", south: 41.65, west: -88.05, north: 42.10, east: -87.45, zoom: 10 },
  { name: "Los Angeles / Long Beach", south: 33.65, west: -118.45, north: 34.15, east: -117.85, zoom: 10 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, timeoutMs = 40000) {
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

function searchUrl(metro) {
  const params = new URLSearchParams({
    south: String(metro.south), west: String(metro.west), north: String(metro.north), east: String(metro.east),
    zoom: String(metro.zoom), v: REQUIRED_FILTER_VERSION, smoke: String(Date.now()),
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

function elementEvidence(element) {
  const tags = element?.tags || {};
  const codes = parseCodes(tags["fuel_iq:naics_codes"] || tags.naics || tags["naics:code"]);
  const text = [tags.name, tags.operator, tags.owner, tags.description, tags.industrial, tags.shop, tags.office, tags["fuel_iq:qualification"]].filter(Boolean).join(" ");
  const retailCode = codes.some((code) => RETAIL_NAICS.has(code));
  const qualifyingCode = codes.some((code) => QUALIFYING_NAICS.has(code));
  const explicitRole = ROLE.test(text);
  const forbidden = String(tags.amenity || "").toLowerCase() === "fuel"
    || ["fuel", "gas", "convenience", "supermarket"].includes(String(tags.shop || "").toLowerCase())
    || FORBIDDEN.test(text)
    || BANNED_EXACT.some((name) => String(tags.name || "").toUpperCase() === name);
  const qualified = !forbidden && ((qualifyingCode && (!retailCode || explicitRole)) || (!codes.length && explicitRole));
  return { name: String(tags.name || "Unnamed"), codes, qualification: String(tags["fuel_iq:qualification"] || "explicit public-map role"), forbidden, qualified };
}

async function deployedVersionReady() {
  const pageResponse = await fetchWithTimeout(`${baseUrl}/fuel-atlas.html?smoke=${Date.now()}`, 25000);
  if (!pageResponse.ok) return { ready: false, detail: `page HTTP ${pageResponse.status}` };
  const html = await pageResponse.text();
  const correctUi = html.includes('id="loadingOverlay"')
    && html.includes('class="radar"')
    && html.includes("Searching verified distributor locations")
    && html.includes("verified-distributors-v2");
  if (!correctUi) return { ready: false, detail: "distributors-only radar build not deployed" };

  const response = await fetchWithTimeout(searchUrl(metros[0]), 40000);
  if (!response.ok) return { ready: false, detail: `search HTTP ${response.status}` };
  const payload = await readJson(response);
  if (payload?.filterVersion !== REQUIRED_FILTER_VERSION) return { ready: false, detail: `filter=${payload?.filterVersion || "missing"}` };
  if (!Array.isArray(payload.sources)) return { ready: false, detail: "verified multi-source API not deployed" };
  return { ready: true, detail: `sources=${payload.sources.join(" + ")}; records=${payload.elements?.length || 0}` };
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
  throw new Error(`Render did not deploy the distributors-only Fuel Atlas before the deadline. Last status: ${lastDetail}`);
}

await waitForDeployment();

const results = [];
for (const metro of metros) {
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(searchUrl(metro), 40000);
    const payload = await readJson(response);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || `HTTP ${response.status}`);
    if (payload.filterVersion !== REQUIRED_FILTER_VERSION) throw new Error(`wrong filter version ${payload.filterVersion || "missing"}`);
    const elements = Array.isArray(payload.elements) ? payload.elements : [];
    const evidence = elements.map(elementEvidence);
    const forbidden = evidence.filter((item) => item.forbidden);
    const unqualified = evidence.filter((item) => !item.qualified);
    const elapsedMs = Date.now() - startedAt;
    const samples = evidence.slice(0, 12);
    results.push({
      metro: metro.name, ok: true, count: elements.length, forbidden: forbidden.length, unqualified: unqualified.length,
      elapsedMs, sources: payload.sources || [], partial: payload.partial === true, samples,
    });
    console.log(`[search] ${metro.name}: ${elements.length} verified, ${forbidden.length} forbidden, ${unqualified.length} unqualified, ${elapsedMs}ms, sources=${(payload.sources || []).join(" + ") || "unknown"}${payload.partial ? " (partial)" : ""}`);
    for (const sample of samples.slice(0, 5)) console.log(`  - ${sample.name} [${sample.codes.join(",") || sample.qualification}]`);
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    results.push({ metro: metro.name, ok: false, count: 0, forbidden: 0, unqualified: 0, elapsedMs, error: error?.name === "AbortError" ? "request timed out" : String(error?.message || error) });
    console.log(`[search] ${metro.name}: FAILED after ${elapsedMs}ms — ${results.at(-1).error}`);
  }
}

const successful = results.filter((result) => result.ok);
const totalFacilities = successful.reduce((sum, result) => sum + result.count, 0);
const totalForbidden = successful.reduce((sum, result) => sum + result.forbidden, 0);
const totalUnqualified = successful.reduce((sum, result) => sum + result.unqualified, 0);
const triangle = results.find((result) => result.metro === "North Carolina Triangle");
const allNames = successful.flatMap((result) => result.samples.map((sample) => sample.name.toUpperCase()));

assert.ok(successful.length >= 4, `Only ${successful.length} of ${metros.length} live metro searches succeeded`);
assert.ok(totalFacilities > 0, "Live Fuel Atlas returned zero verified distributor facilities");
assert.equal(totalForbidden, 0, "Live Fuel Atlas returned a gas station, mart, treatment plant or other forbidden facility");
assert.equal(totalUnqualified, 0, "Live Fuel Atlas returned a location without distributor/fuel-dealer evidence");
assert.ok(triangle?.ok, "North Carolina Triangle live search did not succeed");
assert.ok(!allNames.includes("PETRO MART #9"), "PETRO MART #9 is still present");
assert.ok(!allNames.includes("ADMIRAL PETROLEUM #5390-TREATMENT PLANT #1"), "Admiral treatment plant is still present");

const status = {
  ok: true,
  verificationRule: "Every result must have NAICS 424710/424720/454310/457210 or an explicit distributor, wholesale, bulk, terminal, heating-oil or propane facility role; retail and unrelated names are rejected.",
  filterVersion: REQUIRED_FILTER_VERSION,
  verifiedAt: new Date().toISOString(),
  verifiedCommit: process.env.GITHUB_SHA || null,
  liveUrl: baseUrl,
  successfulSearches: successful.length,
  attemptedSearches: metros.length,
  totalFacilities,
  forbiddenFacilities: totalForbidden,
  unqualifiedFacilities: totalUnqualified,
  bannedNamesPresent: BANNED_EXACT.filter((name) => allNames.includes(name)),
  results,
};
const statusPath = path.resolve("docs", "fuel-atlas-live-status.json");
fs.mkdirSync(path.dirname(statusPath), { recursive: true });
fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);

console.log(`Fuel Atlas live smoke passed: ${successful.length}/${metros.length} searches, ${totalFacilities} verified facilities, zero forbidden and zero unqualified records.`);
console.log(`Wrote ${statusPath}`);
