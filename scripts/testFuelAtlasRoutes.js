import assert from "node:assert/strict";
import { registerFuelAtlasRoutes } from "../src/fuelAtlasRoutes.js";

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    json(value) { this.payload = value; return this; },
  };
}

const routes = new Map();
registerFuelAtlasRoutes({ get(path, handler) { routes.set(path, handler); } });
assert.ok(routes.has("/api/fuel-atlas/search"));
assert.ok(routes.has("/api/fuel-atlas/geocode"));

const tooLargeResponse = makeResponse();
await routes.get("/api/fuel-atlas/search")({ query: { south: "24", west: "-125", north: "50", east: "-66", zoom: "4" } }, tooLargeResponse);
assert.equal(tooLargeResponse.statusCode, 422);
assert.equal(tooLargeResponse.payload.code, "AREA_TOO_LARGE");

const originalFetch = globalThis.fetch;
let overpassCalls = 0;
let frsCalls = 0;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("overpass")) {
    overpassCalls += 1;
    return new Response("busy", { status: 503 });
  }
  if (url.includes("frs_rest_services.get_facilities")) {
    frsCalls += 1;
    return new Response(JSON.stringify({
      Results: {
        FRSFacility: [
          {
            RegistryId: "110000000001",
            FacilityName: "Philadelphia Petroleum Terminal",
            LocationAddress: "100 Terminal Ave",
            CityName: "Philadelphia",
            StateAbbr: "PA",
            ZipCode: "19148",
            Latitude83: "39.91",
            Longitude83: "-75.14",
          },
          {
            RegistryId: "110000000002",
            FacilityName: "Quick Stop Gas Station",
            LocationAddress: "200 Retail Rd",
            CityName: "Philadelphia",
            StateAbbr: "PA",
            ZipCode: "19147",
            Latitude83: "39.92",
            Longitude83: "-75.16",
          },
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`Unexpected URL ${url}`);
};

try {
  const response = makeResponse();
  await routes.get("/api/fuel-atlas/search")({ query: { south: "39.7", west: "-75.5", north: "40.2", east: "-74.9", zoom: "10" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.elements.length, 1, "retail gas station should be removed while terminal remains");
  assert.equal(response.payload.elements[0].tags.name, "Philadelphia Petroleum Terminal");
  assert.ok(response.payload.sources.includes("EPA Facility Registry Service"));
  assert.equal(response.payload.partial, true, "EPA results should still be returned when Overpass is unavailable");
  assert.ok(overpassCalls >= 1);
  assert.equal(frsCalls, 7);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Fuel Atlas route tests passed.");
