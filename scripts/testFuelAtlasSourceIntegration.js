import assert from "node:assert/strict";
import { buildEchoQueryUrl, echoFeatureToElement, parseFuelAtlasBounds } from "../src/fuelAtlasRoutes.js";

const regions = [
  { name: "North Carolina Triangle", south: "35.20", west: "-79.50", north: "36.20", east: "-78.00", zoom: "9" },
  { name: "Newark / Elizabeth", south: "40.55", west: "-74.35", north: "40.85", east: "-73.95", zoom: "10" },
];
const BANNED = new Set([
  "PETRO MART #9",
  "ADMIRAL PETROLEUM #5390-TREATMENT PLANT #1",
]);

async function fetchJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "FuelIQ-Fuel-Atlas-CI/2.0" },
      signal: controller.signal,
    });
    assert.equal(response.ok, true, `EPA ECHO returned HTTP ${response.status}`);
    const data = await response.json();
    assert.equal(Boolean(data?.error), false, `EPA ECHO query error: ${data?.error?.message || "unknown"}`);
    assert.ok(Array.isArray(data?.features), "EPA ECHO response did not contain a feature array");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const allFiltered = [];
for (const region of regions) {
  const bounds = parseFuelAtlasBounds(region);
  assert.equal(bounds.ok, true, `${region.name} bounds should be valid`);
  const data = await fetchJson(buildEchoQueryUrl(bounds));
  const filtered = data.features.map((feature) => echoFeatureToElement(feature, bounds)).filter(Boolean);
  allFiltered.push(...filtered);
  console.log(`[EPA ECHO] ${region.name}: ${data.features.length} raw facilities, ${filtered.length} verified distributor/fuel-dealer facilities`);
  for (const item of filtered.slice(0, 8)) {
    console.log(`  - ${item.tags.name} [${item.tags["fuel_iq:naics_codes"]}]`);
  }
}

assert.ok(allFiltered.length > 0, "EPA ECHO returned no verified distributor, fuel-dealer, bulk-plant or terminal facilities across the integration regions");
for (const item of allFiltered) {
  const name = String(item.tags?.name || "").toUpperCase();
  assert.equal(BANNED.has(name), false, `${name} must not pass the distributors-only filter`);
  assert.match(String(item.tags?.["fuel_iq:naics_codes"] || ""), /424710|424720|454310|457210/, `${name} lacks a qualifying NAICS code`);
}

console.log(`Fuel Atlas live source integration passed with ${allFiltered.length} verified facilities and no banned false positives.`);
