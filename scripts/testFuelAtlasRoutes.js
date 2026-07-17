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
await routes.get("/api/fuel-atlas/search")({
  query: { south: "24", west: "-125", north: "50", east: "-66", zoom: "4" },
}, tooLargeResponse);
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
        {
          attributes: {
            REGISTRY_ID: "PEARCE",
            FAC_NAME: "PEARCE OIL COMPANY - 30617",
            FAC_STREET: "924 E ATLANTIC ST",
            FAC_CITY: "SOUTH HILL",
            FAC_STATE: "VA",
            FAC_ZIP: "23970",
            FAC_LAT: 36.728,
            FAC_LONG: -78.128,
            FAC_NAICS_CODES: "424710",
          },
        },
        {
          attributes: {
            REGISTRY_ID: "TERMINAL",
            FAC_NAME: "KINDER MORGAN SELMA TERMINAL",
            FAC_STREET: "1 TERMINAL RD",
            FAC_CITY: "SELMA",
            FAC_STATE: "NC",
            FAC_ZIP: "27576",
            FAC_LAT: 35.54,
            FAC_LONG: -78.28,
            FAC_NAICS_CODES: "424710",
          },
        },
        {
          attributes: {
            REGISTRY_ID: "BULK",
            FAC_NAME: "ATLANTIC BULK PLANT",
            FAC_STREET: "2 BULK RD",
            FAC_CITY: "RALEIGH",
            FAC_STATE: "NC",
            FAC_ZIP: "27601",
            FAC_LAT: 35.77,
            FAC_LONG: -78.64,
            FAC_NAICS_CODES: "424710",
          },
        },
        {
          attributes: {
            REGISTRY_ID: "HEATING",
            FAC_NAME: "PIEDMONT HEATING OIL COMPANY",
            FAC_STREET: "3 OIL RD",
            FAC_CITY: "DURHAM",
            FAC_STATE: "NC",
            FAC_ZIP: "27701",
            FAC_LAT: 35.99,
            FAC_LONG: -78.90,
            FAC_NAICS_CODES: "457210",
          },
        },
        {
          attributes: {
            REGISTRY_ID: "PROPANE",
            FAC_NAME: "R M WILKINSON OIL AND PROPANE INC",
            FAC_STREET: "4 PROPANE RD",
            FAC_CITY: "CARSON",
            FAC_STATE: "VA",
            FAC_ZIP: "23830",
            FAC_LAT: 36.71,
            FAC_LONG: -77.39,
            FAC_NAICS_CODES: "457210",
          },
        },
        {
          attributes: {
            REGISTRY_ID: "BAD",
            FAC_NAME: "ADMIRAL PETROLEUM #5390-TREATMENT PLANT #1",
            FAC_STREET: "5 BAD RD",
            FAC_CITY: "RALEIGH",
            FAC_STATE: "NC",
            FAC_ZIP: "27601",
            FAC_LAT: 35.78,
            FAC_LONG: -78.63,
            FAC_NAICS_CODES: "424710",
          },
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`Unexpected URL ${url}`);
};

try {
  const response = makeResponse();
  await routes.get("/api/fuel-atlas/search")({
    query: {
      south: "35.2",
      west: "-79.5",
      north: "37.0",
      east: "-77.0",
      zoom: "8",
      v: "verified-distributor-categories-v3",
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.filterVersion, "verified-distributor-categories-v3");
  assert.equal(response.payload.elements.length, 5, "only the five qualified non-retail records should remain");

  const byName = new Map(response.payload.elements.map((element) => [element.tags.name, element.tags]));
  assert.equal(byName.get("PEARCE OIL COMPANY - 30617")["fuel_iq:facility_type"], "distributor");
  assert.equal(byName.get("KINDER MORGAN SELMA TERMINAL")["fuel_iq:facility_type"], "terminal");
  assert.equal(byName.get("ATLANTIC BULK PLANT")["fuel_iq:facility_type"], "bulk_plant");
  assert.equal(byName.get("PIEDMONT HEATING OIL COMPANY")["fuel_iq:facility_type"], "heating_oil");
  assert.equal(byName.get("R M WILKINSON OIL AND PROPANE INC")["fuel_iq:facility_type"], "propane");

  assert.equal(byName.get("PIEDMONT HEATING OIL COMPANY")["fuel_iq:categories"], "distributor,heating_oil");
  assert.equal(byName.get("R M WILKINSON OIL AND PROPANE INC")["fuel_iq:categories"], "distributor,propane");
  assert.equal(response.payload.categoryCounts.distributor, 3, "distributor filter should include Pearce plus the two dealer businesses");
  assert.equal(response.payload.categoryCounts.bulk_plant, 1);
  assert.equal(response.payload.categoryCounts.terminal, 1);
  assert.equal(response.payload.categoryCounts.heating_oil, 1);
  assert.equal(response.payload.categoryCounts.propane, 1);
  assert.ok(overpassCalls >= 1, "OpenStreetMap failover path should be exercised");
  assert.equal(echoCalls, 1, "EPA ECHO should complete in one page for the fixture");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Fuel Atlas category route tests passed.");
