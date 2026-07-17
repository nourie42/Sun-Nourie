import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const baseUrl = String(process.env.FUEL_ATLAS_LIVE_URL || "https://sun-nourie-live.onrender.com").replace(/\/$/, "");
const deploymentDeadlineMs = Number(process.env.FUEL_ATLAS_DEPLOYMENT_WAIT_MS || 18 * 60 * 1000);
const pollMs = Number(process.env.FUEL_ATLAS_DEPLOYMENT_POLL_MS || 20 * 1000);
const REQUIRED_FILTER_VERSION = "verified-distributor-categories-v3";
const EXPECTED_COMPANY = "Cary Oil Co., Inc.";
const LOCATION_COOKIE = "fiq_atlas_location";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, { timeoutMs = 45000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        Accept: "application/json,text/html;q=0.9",
        "Cache-Control": "no-cache",
        ...headers,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${response.url}: ${text.slice(0, 220)}`);
  }
}

function getSetCookieValues(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

function getLocationCookie(response) {
  const pieces = getSetCookieValues(response)
    .flatMap((value) => String(value).split(new RegExp(`,(?=\\s*${LOCATION_COOKIE}=)`, "i")))
    .map((value) => value.trim().split(";")[0])
    .filter((value) => value.startsWith(`${LOCATION_COOKIE}=`) && value !== `${LOCATION_COOKIE}=`);
  return pieces.at(-1) || "";
}

function searchUrlFromCenter(lat, lon) {
  const params = new URLSearchParams({
    south: (lat - 0.45).toFixed(5),
    west: (lon - 0.65).toFixed(5),
    north: (lat + 0.45).toFixed(5),
    east: (lon + 0.65).toFixed(5),
    zoom: "10",
    v: REQUIRED_FILTER_VERSION,
    smoke: String(Date.now()),
  });
  return `${baseUrl}/api/fuel-atlas/search?${params.toString()}`;
}

async function deployedVersionReady() {
  const response = await fetchWithTimeout(`${baseUrl}/health?smoke=${Date.now()}`, { timeoutMs: 25000 });
  const payload = await readJson(response);
  if (!response.ok) return { ready: false, detail: `health HTTP ${response.status}` };
  if (payload?.fuelAtlasCityCompanySearch !== true) {
    return { ready: false, detail: "city-to-company health flag not deployed" };
  }
  return { ready: true, detail: "city-to-company health flag deployed" };
}

async function waitForDeployment() {
  const deadline = Date.now() + deploymentDeadlineMs;
  let lastDetail = "not checked";
  while (Date.now() < deadline) {
    try {
      const status = await deployedVersionReady();
      lastDetail = status.detail;
      console.log(`[deploy:cary] ${status.ready ? "ready" : "waiting"}: ${status.detail}`);
      if (status.ready) return;
    } catch (error) {
      lastDetail = error?.name === "AbortError" ? "deployment check timed out" : String(error?.message || error);
      console.log(`[deploy:cary] waiting: ${lastDetail}`);
    }
    await sleep(pollMs);
  }
  throw new Error(`Render did not deploy the city-to-company Fuel Atlas before the deadline. Last status: ${lastDetail}`);
}

async function runCarySearch() {
  const geocodeUrl = `${baseUrl}/api/fuel-atlas/geocode?q=${encodeURIComponent("Cary, NC")}&smoke=${Date.now()}`;
  const geocodeResponse = await fetchWithTimeout(geocodeUrl, { timeoutMs: 35000 });
  const cookie = getLocationCookie(geocodeResponse);
  const geocode = await readJson(geocodeResponse);

  assert.equal(geocodeResponse.ok, true, geocode?.message || `Cary geocode failed with HTTP ${geocodeResponse.status}`);
  assert.equal(geocode?.ok, true, geocode?.message || "Cary geocode did not return ok=true");
  assert.ok(Number.isFinite(Number(geocode?.result?.lat)), "Cary geocode did not return a latitude");
  assert.ok(Number.isFinite(Number(geocode?.result?.lon)), "Cary geocode did not return a longitude");
  assert.match(String(geocode?.result?.label || ""), /Cary/i, "Cary geocode label did not identify Cary");
  assert.ok(Number(geocode?.locationCompanyCount || 0) >= 1, "Cary geocode did not register any corporate distributors for the city search");
  assert.ok(cookie, "Cary geocode did not return the per-browser city-company context cookie");

  const lat = Number(geocode.result.lat);
  const lon = Number(geocode.result.lon);
  const searchResponse = await fetchWithTimeout(searchUrlFromCenter(lat, lon), {
    timeoutMs: 50000,
    headers: { Cookie: cookie },
  });
  const payload = await readJson(searchResponse);

  assert.equal(searchResponse.ok, true, payload?.message || `Cary area search failed with HTTP ${searchResponse.status}`);
  assert.equal(payload?.ok, true, payload?.message || "Cary area search did not return ok=true");
  assert.equal(payload?.filterVersion, REQUIRED_FILTER_VERSION, "Cary area search returned the wrong filter version");
  assert.ok(Number(payload?.locationCompanyCount || 0) >= 1, "Cary area search did not inject any city-matched corporate distributors");
  assert.match(String(payload?.locationSearchLabel || ""), /Cary/i, "Cary area response did not preserve the searched locality");

  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const caryOil = elements.find((element) => String(element?.tags?.name || "").toLowerCase() === EXPECTED_COMPANY.toLowerCase());
  assert.ok(caryOil, `${EXPECTED_COMPANY} was not returned by the live Cary, NC city search`);
  assert.equal(caryOil.type, "corporate", `${EXPECTED_COMPANY} must be labeled as a corporate match, not an exact facility`);
  assert.equal(caryOil.tags?.["fuel_iq:company_search_result"], "true");
  assert.equal(caryOil.tags?.["fuel_iq:location_search_match"], "true");
  assert.match(String(caryOil.tags?.["fuel_iq:headquarters"] || ""), /Cary/i);
  assert.match(String(caryOil.tags?.["fuel_iq:headquarters"] || ""), /North Carolina/i);

  return {
    query: "Cary, NC",
    geocodeLabel: geocode.result.label,
    geocodeProvider: geocode.result.provider || "",
    locationCompanyCount: Number(payload.locationCompanyCount || 0),
    totalMapResults: elements.length,
    company: {
      name: caryOil.tags.name,
      headquarters: caryOil.tags["fuel_iq:headquarters"],
      classificationBasis: caryOil.tags["fuel_iq:classification_basis"],
      locationPrecision: caryOil.tags["fuel_iq:location_precision"],
      type: caryOil.type,
    },
    sources: payload.sources || [],
  };
}

await waitForDeployment();

let result = null;
let lastError = null;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    result = await runCarySearch();
    break;
  } catch (error) {
    lastError = error;
    console.log(`[cary] attempt ${attempt} failed: ${error?.message || error}`);
    if (attempt < 3) await sleep(15000);
  }
}
if (!result) throw lastError || new Error("Cary live search failed without an error message");

const status = {
  ok: true,
  verifiedAt: new Date().toISOString(),
  verifiedCommit: process.env.GITHUB_SHA || null,
  liveUrl: baseUrl,
  result,
};

const statusPath = path.resolve("docs", "fuel-atlas-cary-live-status.json");
fs.mkdirSync(path.dirname(statusPath), { recursive: true });
fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);

console.log(`Fuel Atlas live Cary regression passed: ${result.company.name} returned for ${result.query}.`);
console.log(`Wrote ${statusPath}`);
