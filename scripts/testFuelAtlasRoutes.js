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
globalThis.fetch = async () => {
  calls += 1;
  if (calls === 1) return new Response("busy", { status: 503 });
  return new Response(JSON.stringify({
    elements: [{ type: "node", id: 1, lat: 40.1, lon: -76.2, tags: { name: "Test Fuel", shop: "fuel" } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const response = makeResponse();
  await routes.get("/api/fuel-atlas/search")({ query: { south: "39", west: "-80", north: "42", east: "-74", zoom: "8" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.elements.length, 1);
  assert.equal(calls, 2, "the route should fail over to a second public-map endpoint");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Fuel Atlas route tests passed.");
