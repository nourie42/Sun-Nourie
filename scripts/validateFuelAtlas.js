import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFuelAtlasQuery, isTargetFuelFacility, parseFuelAtlasBounds } from "../src/fuelAtlasRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const html = fs.readFileSync(path.join(root, "public", "fuel-atlas.html"), "utf8");
const client = fs.readFileSync(path.join(root, "public", "fuel-atlas.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

const valid = parseFuelAtlasBounds({ south: "39", west: "-80", north: "42", east: "-74", zoom: "8" });
assert.equal(valid.ok, true, "regional map bounds should be accepted");

const tooLarge = parseFuelAtlasBounds({ south: "24", west: "-125", north: "50", east: "-66", zoom: "4" });
assert.equal(tooLarge.ok, false, "national browser-sized requests should be rejected");
assert.equal(tooLarge.code, "AREA_TOO_LARGE");

const query = buildFuelAtlasQuery(valid);
assert.ok(query.includes('["shop"="heating_oil"]'), "the query should include heating-oil businesses");
assert.match(query, /storage_tank/);
assert.match(query, /out body center qt 2500/);
assert.ok(!query.includes('["amenity"="fuel"]'), "the query must not request retail gas stations");
assert.ok(!query.includes('["shop"~"^(fuel'), "the query must not request generic fuel or gas shops");

assert.equal(isTargetFuelFacility({ tags: { amenity: "fuel", name: "Example Gas Station" } }), false);
assert.equal(isTargetFuelFacility({ tags: { shop: "fuel", name: "Example Fuel Stop" } }), false);
assert.equal(isTargetFuelFacility({ tags: { shop: "heating_oil", name: "Example Heating Oil" } }), true);
assert.equal(isTargetFuelFacility({ tags: { industrial: "bulk_plant", name: "Example Bulk Plant" } }), true);
assert.equal(isTargetFuelFacility({ tags: { industrial: "tank_farm", operator: "Example Petroleum" } }), true);

for (const id of ["placeForm", "placeSearch", "reload", "locate", "map", "results", "details", "loadingOverlay", "loadingTitle", "loadingDetail"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `fuel-atlas.html should include #${id}`);
}
assert.match(html, /class=["']radar["']/);
assert.match(html, /Searching distributor locations/);
assert.match(html, /Retail gas stations are excluded/);
assert.match(html, /src=["']\/fuel-atlas\.js["']/);
assert.match(client, /\/api\/fuel-atlas\/search/);
assert.match(client, /\/api\/fuel-atlas\/geocode/);
assert.match(client, /setLoadingOverlay/);
assert.match(client, /isRetailGasStation/);
assert.doesNotMatch(client, /overpass-api\.de\/api\/interpreter/, "browser code must not call one Overpass host directly");
assert.match(server, /registerFuelAtlasRoutes/);
assert.match(server, /app\.get\("\/fuel-atlas\.html"/);

console.log("Fuel Atlas validation passed.");
