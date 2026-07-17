import assert from "node:assert/strict";
import { clearFuelAtlasFastCache, registerFuelAtlasFastSearchRoute } from "../src/fuelAtlasFastSearch.js";

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

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function makeRoutes(options = {}) {
  const routes = new Map();
  registerFuelAtlasFastSearchRoute({ get(path, handler) { routes.set(path, handler); } }, options);
  return routes;
}

{
  clearFuelAtlasFastCache();
  const fetchImpl = async (url, init = {}) => {
    assert.match(String(url), /echo\.test/);
    assert.equal(init.method, "POST");
    const form = new URLSearchParams(init.body);
    assert.match(form.get("where") || "", /424710/);
    assert.match(form.get("where") || "", /457210/);
    assert.equal(form.get("geometryType"), "esriGeometryEnvelope");
    return jsonResponse({
      features: [
        { attributes: { registry_id: "110000000009", fac_name: "Delaware River Petroleum Terminal", fac_street: "100 Dock Road", fac_city: "Elizabeth", fac_state: "NJ", fac_zip: "07201", fac_lat: 40.67, fac_long: -74.18, fac_naics_codes: "424710" } },
        { attributes: { registry_id: "110000000010", fac_name: "Retail Gas Station", fac_street: "1 Main St", fac_city: "Elizabeth", fac_state: "NJ", fac_zip: "07201", fac_lat: 40.68, fac_long: -74.17, fac_naics_codes: "457110" } },
      ],
    });
  };
  const routes = makeRoutes({
    fetchImpl,
    echoEndpoint: "https://echo.test/query",
    sourceTimeoutMs: 100,
    hardDeadlineMs: 200,
    googleSearches: [],
  });
  const response = makeResponse();
  const started = Date.now();
  await routes.get("/api/fuel-atlas/search")({ query: { south: "40.62", west: "-74.22", north: "40.78", east: "-74.05", zoom: "11" } }, response);
  const elapsed = Date.now() - started;
  assert.equal(response.statusCode, 200);
  assert.ok(elapsed < 400, `fast search took ${elapsed}ms`);
  assert.deepEqual(response.payload.records.map((record) => record.name), ["Delaware River Petroleum Terminal"]);
  assert.equal(response.payload.records.some((record) => /gas station/i.test(record.name)), false);
}

{
  clearFuelAtlasFastCache();
  const fetchImpl = async () => new Response("busy", { status: 503 });
  const routes = makeRoutes({
    fetchImpl,
    echoEndpoint: "https://echo.test/query",
    sourceTimeoutMs: 60,
    hardDeadlineMs: 120,
    googleSearches: [],
  });
  const response = makeResponse();
  const started = Date.now();
  await routes.get("/api/fuel-atlas/search")({ query: { south: "39.8", west: "-75.3", north: "40.1", east: "-75.0", zoom: "11" } }, response);
  const elapsed = Date.now() - started;
  assert.equal(response.statusCode, 200, "upstream failure must not become a browser timeout or 502");
  assert.ok(elapsed < 400, `bounded failure took ${elapsed}ms`);
  assert.equal(response.payload.records.length, 0);
  assert.equal(response.payload.partial, true);
}

{
  clearFuelAtlasFastCache();
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("echo.test")) return jsonResponse({ features: [] });
    if (value.includes("maps.googleapis.com/maps/api/place/textsearch")) {
      return jsonResponse({
        status: "OK",
        results: [
          { name: "Shell Gas Station", place_id: "gas-1", types: ["gas_station", "store"], geometry: { location: { lat: 39.95, lng: -75.15 } }, formatted_address: "1 Retail Road" },
          { name: "Delaware Valley Fuel Oil Delivery", place_id: "fuel-1", types: ["store"], geometry: { location: { lat: 39.96, lng: -75.16 } }, formatted_address: "2 Industrial Road" },
        ],
      });
    }
    throw new Error(`unexpected URL ${value}`);
  };
  const routes = makeRoutes({
    fetchImpl,
    googleApiKey: "test-key",
    echoEndpoint: "https://echo.test/query",
    sourceTimeoutMs: 100,
    hardDeadlineMs: 200,
    googleSearches: [{ query: "fuel oil supplier", type: "heating_oil" }],
  });
  const response = makeResponse();
  await routes.get("/api/fuel-atlas/search")({ query: { south: "39.8", west: "-75.3", north: "40.1", east: "-75.0", zoom: "11" } }, response);
  assert.deepEqual(response.payload.records.map((record) => record.name), ["Delaware Valley Fuel Oil Delivery"]);
}

console.log("Fuel Atlas fast-search timeout, EPA ECHO, Google fallback, and gas-station exclusion tests passed.");
