import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEchoQueryUrl,
  buildFuelAtlasQuery,
  echoFeatureToElement,
  isTargetFuelFacility,
  parseFuelAtlasBounds,
} from "../src/fuelAtlasRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const html = fs.readFileSync(path.join(root, "public", "fuel-atlas.html"), "utf8");
const client = fs.readFileSync(path.join(root, "public", "fuel-atlas.js"), "utf8");

const valid = parseFuelAtlasBounds({ south: "35.2", west: "-79.5", north: "36.2", east: "-78.0", zoom: "9" });
assert.equal(valid.ok, true, "Triangle metro bounds should be accepted");
const tooLarge = parseFuelAtlasBounds({ south: "24", west: "-125", north: "50", east: "-66", zoom: "4" });
assert.equal(tooLarge.ok, false, "national requests should be rejected");
assert.equal(tooLarge.code, "AREA_TOO_LARGE");

const overpassQuery = buildFuelAtlasQuery(valid);
assert.match(overpassQuery, /distribut\|wholesal/);
assert.match(overpassQuery, /bulk_plant/);
assert.doesNotMatch(overpassQuery, /\["amenity"="fuel"\]/, "retail fuel stations must never be queried");
assert.doesNotMatch(overpassQuery, /industrial"~"\^\(oil\|petroleum\|fuel\)/, "generic petroleum industrial sites must not be queried without an explicit role");

const echoUrl = buildEchoQueryUrl(valid).toString();
for (const code of ["424710", "424720", "454310", "457210"]) assert.match(echoUrl, new RegExp(code));
assert.match(echoUrl, /FAC_NAICS_CODES/);
assert.match(echoUrl, /geometryType=esriGeometryEnvelope/);

const actualDistributor = echoFeatureToElement({
  attributes: {
    REGISTRY_ID: "110000000101",
    FAC_NAME: "Carolina Petroleum Distributors",
    FAC_STREET: "100 Distribution Way",
    FAC_CITY: "Raleigh",
    FAC_STATE: "NC",
    FAC_ZIP: "27601",
    FAC_LAT: 35.78,
    FAC_LONG: -78.64,
    FAC_NAICS_CODES: "424720",
    DFR_URL: "https://echo.epa.gov/example",
  },
}, valid);
assert.ok(actualDistributor, "NAICS 424720 distributor should be included");
assert.equal(isTargetFuelFacility(actualDistributor), true);
assert.match(actualDistributor.tags["fuel_iq:qualification"], /424720/);

const actualTerminal = echoFeatureToElement({
  attributes: {
    REGISTRY_ID: "110000000102",
    FAC_NAME: "Triangle Petroleum Bulk Terminal",
    FAC_LAT: 35.81,
    FAC_LONG: -78.61,
    FAC_NAICS_CODES: "424710",
  },
}, valid);
assert.ok(actualTerminal, "NAICS 424710 bulk terminal should be included");
assert.equal(actualTerminal.tags["fuel_iq:facility_type"], "terminal");

for (const bad of [
  { FAC_NAME: "PETRO MART #9", FAC_NAICS_CODES: "424720,457110" },
  { FAC_NAME: "ADMIRAL PETROLEUM #5390-TREATMENT PLANT #1", FAC_NAICS_CODES: "424720" },
  { FAC_NAME: "QUICK STOP GAS STATION", FAC_NAICS_CODES: "457120" },
]) {
  const element = echoFeatureToElement({ attributes: { ...bad, REGISTRY_ID: Math.random().toString(), FAC_LAT: 35.79, FAC_LONG: -78.63 } }, valid);
  assert.equal(element, null, `${bad.FAC_NAME} must be excluded`);
}

assert.equal(isTargetFuelFacility({ tags: { amenity: "fuel", name: "Retail Gas Station" } }), false);
assert.equal(isTargetFuelFacility({ tags: { industrial: "petroleum", name: "Generic Petroleum Site" } }), false);
assert.equal(isTargetFuelFacility({ tags: { industrial: "bulk_plant", name: "Atlantic Bulk Plant" } }), true);
assert.equal(isTargetFuelFacility({ tags: { office: "company", name: "Piedmont Fuel Distributors" } }), true);

for (const id of ["placeForm", "placeSearch", "reload", "locate", "map", "results", "details", "loadingOverlay", "loadingTitle"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `fuel-atlas.html should include #${id}`);
}
assert.match(html, /class="radar"/);
assert.match(html, /Searching verified distributor locations/);
assert.match(html, /verified-distributors-v2/);
assert.match(client, /REQUIRED_FILTER_VERSION = "verified-distributors-v2"/);
assert.match(client, /isQualifiedFacility/);
assert.match(client, /424710/);
assert.doesNotMatch(client, /overpass-api\.de\/api\/interpreter/, "browser code must not call Overpass directly");

console.log("Fuel Atlas distributors-only validation passed.");
