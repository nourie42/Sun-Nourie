import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFuelAtlasQuery, parseFuelAtlasBounds } from "../src/fuelAtlasRoutes.js";

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
assert.match(query, /heating_oil/);
assert.match(query, /storage_tank/);
assert.match(query, /out body center qt 2500/);

for (const id of ["placeForm", "placeSearch", "reload", "locate", "map", "results", "details"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `fuel-atlas.html should include #${id}`);
}
assert.match(html, /src=["']\/fuel-atlas\.js["']/);
assert.match(client, /\/api\/fuel-atlas\/search/);
assert.match(client, /\/api\/fuel-atlas\/geocode/);
assert.doesNotMatch(client, /overpass-api\.de\/api\/interpreter/, "browser code must not call one Overpass host directly");
assert.match(server, /registerFuelAtlasRoutes/);
assert.match(server, /app\.get\("\/fuel-atlas\.html"/);

console.log("Fuel Atlas validation passed.");
