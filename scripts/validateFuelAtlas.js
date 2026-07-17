import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFuelAtlasQuery, frsFacilityToElement, isTargetFuelFacility, parseFuelAtlasBounds } from "../src/fuelAtlasRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const html = fs.readFileSync(path.join(root, "public", "fuel-atlas.html"), "utf8");
const client = fs.readFileSync(path.join(root, "public", "fuel-atlas.js"), "utf8");

const valid = parseFuelAtlasBounds({ south: "39.7", west: "-75.5", north: "40.2", east: "-74.9", zoom: "10" });
assert.equal(valid.ok, true, "metro map bounds should be accepted");
const tooLarge = parseFuelAtlasBounds({ south: "24", west: "-125", north: "50", east: "-66", zoom: "4" });
assert.equal(tooLarge.ok, false, "national browser-sized requests should be rejected");
assert.equal(tooLarge.code, "AREA_TOO_LARGE");

const query = buildFuelAtlasQuery(valid);
assert.match(query, /heating_oil/);
assert.match(query, /storage_tank/);
assert.doesNotMatch(query, /\["amenity"="fuel"\]/, "retail fuel stations must never be queried");
assert.doesNotMatch(query, /\["shop"~"\^\(fuel\|gas/, "generic fuel and gas shops must never be queried");

assert.equal(isTargetFuelFacility({ tags: { amenity: "fuel", name: "Retail Gas Station" } }), false);
assert.equal(isTargetFuelFacility({ tags: { industrial: "bulk_plant", name: "Atlantic Bulk Plant" } }), true);
const frs = frsFacilityToElement({
  RegistryId: "110000000001",
  FacilityName: "Philadelphia Petroleum Terminal",
  LocationAddress: "100 Terminal Ave",
  CityName: "Philadelphia",
  StateAbbr: "PA",
  ZipCode: "19148",
  Latitude83: "39.91",
  Longitude83: "-75.14",
}, "terminal", valid);
assert.ok(frs);
assert.equal(isTargetFuelFacility(frs), true);
assert.match(frs.source_url, /registry_id=110000000001/);

for (const id of ["placeForm", "placeSearch", "reload", "locate", "map", "results", "details", "loadingOverlay", "loadingTitle"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `fuel-atlas.html should include #${id}`);
}
assert.match(html, /class="radar"/);
assert.match(html, /Searching distributor locations/);
assert.match(client, /Searching distributor locations/);
assert.match(client, /MIN_SEARCH_ZOOM = 7/);
assert.doesNotMatch(client, /overpass-api\.de\/api\/interpreter/, "browser code must not call Overpass directly");

console.log("Fuel Atlas validation passed.");
