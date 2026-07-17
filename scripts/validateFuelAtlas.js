import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFuelAtlasQuery,
  classifyFuelFacility,
  echoFeatureToElement,
  isTargetFuelFacility,
  parseFuelAtlasBounds,
} from "../src/fuelAtlasRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const html = fs.readFileSync(path.join(root, "public", "fuel-atlas.html"), "utf8");
const client = fs.readFileSync(path.join(root, "public", "fuel-atlas.js"), "utf8");

const valid = parseFuelAtlasBounds({ south: "35.2", west: "-79.5", north: "36.2", east: "-78.0", zoom: "9" });
assert.equal(valid.ok, true, "metro map bounds should be accepted");
const tooLarge = parseFuelAtlasBounds({ south: "24", west: "-125", north: "50", east: "-66", zoom: "4" });
assert.equal(tooLarge.ok, false, "national browser-sized requests should be rejected");
assert.equal(tooLarge.code, "AREA_TOO_LARGE");

const query = buildFuelAtlasQuery(valid);
assert.match(query, /heating_oil/);
assert.match(query, /bulk_plant/);
assert.doesNotMatch(query, /\["amenity"="fuel"\]/, "retail fuel stations must never be queried");
assert.doesNotMatch(query, /\["shop"~"\^\(fuel\|gas/, "generic fuel and gas shops must never be queried");

const bounds = parseFuelAtlasBounds({ south: "36.5", west: "-78.5", north: "37.0", east: "-77.8", zoom: "10" });
const makeEcho = (name, codes, lat = 36.73, lon = -78.13) => echoFeatureToElement({
  attributes: {
    REGISTRY_ID: `${name}-${codes}`,
    FAC_NAME: name,
    FAC_STREET: "100 Test Rd",
    FAC_CITY: "South Hill",
    FAC_STATE: "VA",
    FAC_ZIP: "239700000",
    FAC_LAT: lat,
    FAC_LONG: lon,
    FAC_NAICS_CODES: codes,
  },
}, bounds);

const pearce = makeEcho("PEARCE OIL COMPANY - 30617", "424710");
assert.ok(pearce, "Pearce Oil should qualify");
assert.equal(pearce.tags["fuel_iq:facility_type"], "distributor", "NAICS 424710 alone must not force an oil company into Bulk plants");
assert.match(pearce.tags["fuel_iq:categories"], /\bdistributor\b/);
assert.doesNotMatch(pearce.tags["fuel_iq:categories"], /\bbulk_plant\b/);
assert.equal(pearce.tags["addr:postcode"], "23970-0000");

const terminal = makeEcho("KINDER MORGAN SELMA TERMINAL", "424710");
assert.equal(terminal.tags["fuel_iq:facility_type"], "terminal", "explicit terminal wording must classify as a terminal");

const bulk = makeEcho("ATLANTIC BULK PLANT", "424710");
assert.equal(bulk.tags["fuel_iq:facility_type"], "bulk_plant", "explicit bulk-plant wording must classify as a bulk plant");

const heating = makeEcho("PIEDMONT HEATING OIL COMPANY", "457210");
assert.equal(heating.tags["fuel_iq:facility_type"], "heating_oil");
assert.equal(heating.tags["fuel_iq:categories"], "distributor,heating_oil");

const propane = makeEcho("R M WILKINSON OIL AND PROPANE INC", "457210");
assert.equal(propane.tags["fuel_iq:facility_type"], "propane");
assert.equal(propane.tags["fuel_iq:categories"], "distributor,propane");

assert.equal(makeEcho("ADMIRAL PETROLEUM #5390-TREATMENT PLANT #1", "424710"), null);
assert.equal(makeEcho("CLEAN HARBORS ENVIRONMENTAL SERVICES INC", "424710,562910"), null);
assert.equal(isTargetFuelFacility({ tags: { amenity: "fuel", name: "Retail Gas Station" } }), false);
assert.equal(isTargetFuelFacility({ tags: { industrial: "bulk_plant", name: "Atlantic Bulk Plant" } }), true);

assert.equal(classifyFuelFacility({ name: "Pearce Oil Company", "fuel_iq:naics_codes": "424710" }).type, "distributor");
assert.equal(classifyFuelFacility({ name: "Pearce Oil Company Bulk Plant", "fuel_iq:naics_codes": "424710" }).type, "bulk_plant");
assert.equal(classifyFuelFacility({ name: "Pearce Oil Company Terminal", "fuel_iq:naics_codes": "424710" }).type, "terminal");

for (const id of ["placeForm", "placeSearch", "reload", "locate", "map", "results", "details", "loadingOverlay", "loadingTitle"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `fuel-atlas.html should include #${id}`);
}
assert.match(html, /class="radar"/);
assert.match(html, /Business role and physical facility type are classified separately/);
assert.match(html, /verified-distributor-categories-v3/);
assert.match(client, /verified-distributor-categories-v3/);
assert.match(client, /record\.categories\.includes\(activeType\)/);
assert.match(client, /NAICS alone does not make a location a bulk plant or terminal/);
assert.doesNotMatch(client, /overpass-api\.de\/api\/interpreter/, "browser code must not call Overpass directly");

console.log("Fuel Atlas category-classification validation passed.");
