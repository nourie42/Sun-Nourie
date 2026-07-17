import assert from "node:assert/strict";
import {
  buildEchoQueryUrl,
  echoFeatureToElement,
  parseFuelAtlasBounds,
} from "../src/fuelAtlasRoutes.js";

const regions = [
  { name: "South Hill Virginia", south: "36.55", west: "-78.35", north: "36.90", east: "-77.90", zoom: "10" },
  { name: "North Carolina Triangle", south: "35.20", west: "-79.50", north: "36.20", east: "-78.00", zoom: "9" },
  { name: "Newark / Elizabeth", south: "40.55", west: "-74.35", north: "40.85", east: "-73.95", zoom: "10" },
];

const BANNED = new Set([
  "PETRO MART #9",
  "ADMIRAL PETROLEUM #5390-TREATMENT PLANT #1",
]);
const TERMINAL_TEXT = /\bterminal\b|\bdepot\b|\btank\s*farm\b/i;
const BULK_TEXT = /\bbulk\s+(?:plant|station|fuel\s+plant|oil\s+plant|petroleum\s+plant)\b/i;

async function fetchJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "FuelIQ-Fuel-Atlas-CI/3.0" },
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
const regionResults = new Map();

for (const region of regions) {
  const bounds = parseFuelAtlasBounds(region);
  assert.equal(bounds.ok, true, `${region.name} bounds should be valid`);
  const data = await fetchJson(buildEchoQueryUrl(bounds));
  const filtered = data.features.map((feature) => echoFeatureToElement(feature, bounds)).filter(Boolean);
  allFiltered.push(...filtered);
  regionResults.set(region.name, filtered);
  const counts = filtered.reduce((acc, item) => {
    const type = item.tags["fuel_iq:facility_type"];
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  console.log(`[EPA ECHO] ${region.name}: ${data.features.length} raw, ${filtered.length} verified, categories=${JSON.stringify(counts)}`);
  for (const item of filtered.slice(0, 12)) {
    console.log(`  - ${item.tags.name} [${item.tags["fuel_iq:facility_type"]}; ${item.tags["fuel_iq:classification_basis"]}]`);
  }
}

assert.ok(allFiltered.length > 0, "EPA ECHO returned no verified distributor, dealer, bulk-plant or terminal facilities");

for (const item of allFiltered) {
  const tags = item.tags || {};
  const name = String(tags.name || "").toUpperCase();
  const type = String(tags["fuel_iq:facility_type"] || "");
  assert.equal(BANNED.has(name), false, `${name} must not pass the verified filter`);
  assert.match(String(tags["fuel_iq:naics_codes"] || ""), /424710|424720|454310|457210/, `${name} lacks a qualifying NAICS code`);
  if (type === "terminal") {
    assert.match(`${tags.name} ${tags["fuel_iq:classification_basis"]}`, TERMINAL_TEXT, `${name} was labeled terminal without explicit terminal/depot/tank-farm evidence`);
  }
  if (type === "bulk_plant") {
    assert.match(`${tags.name} ${tags["fuel_iq:classification_basis"]}`, BULK_TEXT, `${name} was labeled bulk plant without explicit bulk-plant/station evidence`);
  }
}

const southHill = regionResults.get("South Hill Virginia") || [];
const pearce = southHill.find((item) => /PEARCE OIL COMPANY/i.test(item.tags?.name || ""));
assert.ok(pearce, "The live EPA source should return Pearce Oil Company in the South Hill area");
assert.equal(pearce.tags["fuel_iq:facility_type"], "distributor", "Pearce Oil Company must be classified as a distributor, not a bulk plant");
assert.equal(String(pearce.tags["fuel_iq:categories"]).includes("bulk_plant"), false);

const distributors = allFiltered.filter((item) => String(item.tags?.["fuel_iq:categories"] || "").split(",").includes("distributor"));
const terminals = allFiltered.filter((item) => item.tags?.["fuel_iq:facility_type"] === "terminal");
assert.ok(distributors.length > 0, "The live integration regions must return actual distributor/dealer records");
assert.ok(terminals.length > 0, "The live integration regions must retain explicitly named terminals");

console.log(`Fuel Atlas live source integration passed with ${allFiltered.length} verified facilities: ${distributors.length} distributors/dealers and ${terminals.length} explicit terminals.`);
