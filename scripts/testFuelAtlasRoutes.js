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
let calls = 0;
const submittedQueries = [];
globalThis.fetch = async (_url, init = {}) => {
  calls += 1;
  const encoded = String(init.body || "").replace(/^data=/, "");
  submittedQueries.push(decodeURIComponent(encoded));
  if (calls === 1) return new Response("busy", { status: 503 });
  return new Response(JSON.stringify({
    elements: [
      { type: "node", id: 1, lat: 40.1, lon: -76.2, tags: { name: "Retail Gas Station", amenity: "fuel" } },
      { type: "way", id: 2, center: { lat: 40.2, lon: -76.3 }, tags: { name: "Test Bulk Plant", industrial: "bulk_plant", operator: "Test Petroleum" } },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const response = makeResponse();
  await routes.get("/api/fuel-atlas/search")({ query: { south: "39", west: "-80", north: "42", east: "-74", zoom: "8" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.elements.length, 1, "retail gas stations should be removed from returned results");
  assert.equal(response.payload.elements[0].tags.name, "Test Bulk Plant");
  assert.ok(calls >= 2, "the route should fall through when the first public-map provider fails");
  assert.ok(submittedQueries.every((query) => !query.includes('["amenity"="fuel"]')), "provider queries must never request retail gas stations");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Fuel Atlas route tests passed.");
