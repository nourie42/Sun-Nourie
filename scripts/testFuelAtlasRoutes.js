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
registerFuelAtlasRoutes({ get(route, handler) { routes.set(route, handler); } });
assert.ok(routes.has("/api/fuel-atlas/search"));
assert.ok(routes.has("/api/fuel-atlas/geocode"));

const tooLargeResponse = makeResponse();
await routes.get("/api/fuel-atlas/search")({ query: { south: "24", west: "-125", north: "50", east: "-66", zoom: "4" } }, tooLargeResponse);
assert.equal(tooLargeResponse.statusCode, 422);
assert.equal(tooLargeResponse.payload.code, "AREA_TOO_LARGE");

const originalFetch = globalThis.fetch;
let overpassCalls = 0;
let echoCalls = 0;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("overpass")) {
    overpassCalls += 1;
    return new Response("busy", { status: 503 });
  }
  if (url.includes("echogeo.epa.gov")) {
    echoCalls += 1;
    return new Response(JSON.stringify({
      exceededTransferLimit: false,
      features: [
        { attributes: { REGISTRY_ID: "1101", FAC_NAME: "Carolina Petroleum Distributors", FAC_STREET: "100 Distribution Way", FAC_CITY: "Raleigh", FAC_STATE: "NC", FAC_ZIP: "27601", FAC_LAT: 35.78, FAC_LONG: -78.64, FAC_NAICS_CODES: "424720", DFR_URL: "https://echo.epa.gov/1101" } },
        { attributes: { REGISTRY_ID: "1102", FAC_NAME: "PETRO MART #9", FAC_STREET: "133 Hillsboro Street", FAC_CITY: "Pittsboro", FAC_STATE: "NC", FAC_ZIP: "27312", FAC_LAT: 35.72, FAC_LONG: -79.18, FAC_NAICS_CODES: "424720,457110" } },
        { attributes: { REGISTRY_ID: "1103", FAC_NAME: "ADMIRAL PETROLEUM #5390-TREATMENT PLANT #1", FAC_CITY: "Raleigh", FAC_STATE: "NC", FAC_LAT: 35.80, FAC_LONG: -78.60, FAC_NAICS_CODES: "424720" } },
        { attributes: { REGISTRY_ID: "1104", FAC_NAME: "Triangle Petroleum Bulk Terminal", FAC_STREET: "200 Terminal Road", FAC_CITY: "Cary", FAC_STATE: "NC", FAC_ZIP: "27513", FAC_LAT: 35.79, FAC_LONG: -78.78, FAC_NAICS_CODES: "424710" } },
        { attributes: { REGISTRY_ID: "1105", FAC_NAME: "Random Warehouse", FAC_CITY: "Durham", FAC_STATE: "NC", FAC_LAT: 35.99, FAC_LONG: -78.90, FAC_NAICS_CODES: "493110" } },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`Unexpected URL ${url}`);
};

try {
  const response = makeResponse();
  await routes.get("/api/fuel-atlas/search")({ query: { south: "35.2", west: "-79.5", north: "36.2", east: "-78.0", zoom: "9" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.filterVersion, "verified-distributors-v2");
  assert.deepEqual(response.payload.elements.map((item) => item.tags.name).sort(), ["Carolina Petroleum Distributors", "Triangle Petroleum Bulk Terminal"]);
  assert.ok(response.payload.sources.includes("EPA ECHO / FRS NAICS"));
  assert.equal(response.payload.partial, true, "ECHO results should survive an Overpass outage");
  assert.ok(overpassCalls >= 1);
  assert.equal(echoCalls, 1);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Fuel Atlas distributors-only route tests passed.");
