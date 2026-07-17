import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const baseUrl = String(process.env.FUEL_ATLAS_LIVE_URL || "https://sun-nourie-live.onrender.com").replace(/\/$/, "");
const deploymentDeadlineMs = Number(process.env.FUEL_ATLAS_DEPLOYMENT_WAIT_MS || 18 * 60 * 1000);
const pollMs = Number(process.env.FUEL_ATLAS_DEPLOYMENT_POLL_MS || 20 * 1000);
const RETAIL = /\b(gas station|service station|filling station|travel center|truck stop|convenience store|c-store|car wash|oil change|lube shop|quick lube)\b/i;

const metros = [
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
    south: String(metro.south),
    west: String(metro.west),
    north: String(metro.north),
    east: String(metro.east),
    zoom: String(metro.zoom),
    smoke: String(Date.now()),
  });
  return `${baseUrl}/api/fuel-atlas/search?${params.toString()}`;
}

async function readJson(response) {
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.slice(0, 180)}`); }
  return payload;
}

async function deployedVersionReady() {
  const pageResponse = await fetchWithTimeout(`${baseUrl}/fuel-atlas.html?smoke=${Date.now()}`, 25000);
  if (!pageResponse.ok) return { ready: false, detail: `page HTTP ${pageResponse.status}` };
  const html = await pageResponse.text();
  const radarReady = html.includes('id="loadingOverlay"')
    && html.includes('class="radar"')
    && html.includes("Searching distributor locations");
  if (!radarReady) return { ready: false, detail: "radar build not deployed" };

  const response = await fetchWithTimeout(searchUrl(metros[0]), 40000);
  if (!response.ok) return { ready: false, detail: `search HTTP ${response.status}` };
  const payload = await readJson(response);
  if (!Array.isArray(payload.sources)) return { ready: false, detail: "multi-source API not deployed" };
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
  throw new Error(`Render did not deploy the multi-source Fuel Atlas before the deadline. Last status: ${lastDetail}`);
}

function retailCount(elements) {
  return elements.filter((element) => {
    const tags = element?.tags || {};
    const text = [tags.name, tags.operator, tags.brand, tags.description, tags.shop, tags.amenity].filter(Boolean).join(" ");
    return String(tags.amenity || "").toLowerCase() === "fuel"
      || ["fuel", "gas", "convenience", "supermarket"].includes(String(tags.shop || "").toLowerCase())
      || RETAIL.test(text);
  }).length;
}

await waitForDeployment();

const results = [];
for (const metro of metros) {
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(searchUrl(metro), 40000);
    const payload = await readJson(response);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || `HTTP ${response.status}`);
    const elements = Array.isArray(payload.elements) ? payload.elements : [];
    const retail = retailCount(elements);
    const elapsedMs = Date.now() - startedAt;
    results.push({ metro: metro.name, ok: true, count: elements.length, retail, elapsedMs, sources: payload.sources || [], partial: payload.partial === true });
    console.log(`[search] ${metro.name}: ${elements.length} facilities, ${retail} retail, ${elapsedMs}ms, sources=${(payload.sources || []).join(" + ") || "unknown"}${payload.partial ? " (partial)" : ""}`);
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    results.push({ metro: metro.name, ok: false, count: 0, retail: 0, elapsedMs, error: error?.name === "AbortError" ? "request timed out" : String(error?.message || error) });
    console.log(`[search] ${metro.name}: FAILED after ${elapsedMs}ms — ${results.at(-1).error}`);
  }
}

const successful = results.filter((result) => result.ok);
const totalFacilities = successful.reduce((sum, result) => sum + result.count, 0);
const totalRetail = successful.reduce((sum, result) => sum + result.retail, 0);
const multiSourceResponses = successful.filter((result) => result.sources.length > 0).length;

assert.ok(successful.length >= 3, `Only ${successful.length} of ${metros.length} live metro searches succeeded`);
assert.ok(totalFacilities > 0, "Live Fuel Atlas returned zero facilities across all successful metro searches");
assert.equal(totalRetail, 0, "Live Fuel Atlas returned one or more retail gas-station records");
assert.ok(multiSourceResponses >= 3, "Live Fuel Atlas did not expose source metadata for enough searches");

const status = {
  ok: true,
  verifiedAt: new Date().toISOString(),
  verifiedCommit: process.env.GITHUB_SHA || null,
  liveUrl: baseUrl,
  successfulSearches: successful.length,
  attemptedSearches: metros.length,
  totalFacilities,
  retailGasStations: totalRetail,
  results,
};
const statusPath = path.resolve("docs", "fuel-atlas-live-status.json");
fs.mkdirSync(path.dirname(statusPath), { recursive: true });
fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);

console.log(`Fuel Atlas live smoke passed: ${successful.length}/${metros.length} searches succeeded with ${totalFacilities} facilities and zero retail gas stations.`);
console.log(`Wrote ${statusPath}`);
