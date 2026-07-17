import assert from "node:assert/strict";
import {
  __test,
  findDistributorCompaniesByLocation,
  looksLikeLocationSearch,
  registerFuelAtlasLocationCompanyBridge,
} from "../src/fuelAtlasLocationCompanyBridge.js";

const caryMatches = findDistributorCompaniesByLocation(
  "Cary, Wake County, North Carolina, United States",
  "Cary, NC",
);
assert.equal(caryMatches[0]?.legal_name, "Cary Oil Co., Inc.", "Cary city search must return Cary Oil from the corporate distributor index.");
assert.equal(
  caryMatches.every((company) => /Cary, North Carolina/i.test(company.headquarters)),
  true,
  "City lookup must not return companies headquartered outside the searched city.",
);
assert.equal(looksLikeLocationSearch("Cary, NC", "Cary, Wake County, North Carolina, United States"), true);
assert.equal(looksLikeLocationSearch("Cary Oil Co., Inc.", "Cary, Wake County, North Carolina, United States"), false);
assert.equal(looksLikeLocationSearch("Oil City, PA", "Oil City, Pennsylvania, United States"), true);

let middleware = null;
const app = {
  use(path, handler) {
    assert.equal(path, "/api/fuel-atlas");
    middleware = handler;
  },
};
registerFuelAtlasLocationCompanyBridge(app);
assert.ok(middleware, "Fuel Atlas city-company middleware should be registered.");

function makeResponse() {
  return {
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
    json(value) { this.payload = value; return this; },
  };
}

function runBridge(path, query, payload, cookie = "") {
  const req = {
    method: "GET",
    path,
    query,
    headers: cookie ? { cookie } : {},
  };
  const res = makeResponse();
  middleware(req, res, () => res.json(payload));
  return res;
}

__test.clearContexts();
const geocode = runBridge("/geocode", { q: "Cary, NC" }, {
  ok: true,
  cached: false,
  result: {
    lat: 35.79154,
    lon: -78.78112,
    label: "Cary, Wake County, North Carolina, United States",
    provider: "Test geocoder",
  },
});
assert.equal(geocode.payload.locationCompanyCount, 1, "Cary geocode should prepare one indexed corporate company.");
const setCookies = Array.isArray(geocode.headers["set-cookie"])
  ? geocode.headers["set-cookie"]
  : [geocode.headers["set-cookie"]];
const contextCookie = setCookies.find((value) => String(value).startsWith(`${__test.LOCATION_COOKIE}=`) && !String(value).includes("Max-Age=0"));
assert.ok(contextCookie, "Cary geocode should set a short-lived location context cookie.");
const cookieHeader = String(contextCookie).split(";")[0];

const basePayload = {
  ok: true,
  cached: false,
  filterVersion: "verified-distributor-categories-v3",
  source: "EPA ECHO / FRS NAICS",
  sources: ["EPA ECHO / FRS NAICS"],
  categoryCounts: { distributor: 1, heating_oil: 0, bulk_plant: 0, terminal: 0, propane: 0 },
  elements: [{
    type: "echo",
    id: "physical-1",
    lat: 35.80,
    lon: -78.77,
    source_name: "EPA ECHO / FRS NAICS",
    tags: {
      name: "Example Physical Fuel Distributor",
      industrial: "petroleum_distribution",
      "fuel_iq:facility_type": "distributor",
      "fuel_iq:categories": "distributor",
      "fuel_iq:classification_basis": "Test physical facility",
      "fuel_iq:qualification": "NAICS 424720",
      "fuel_iq:naics_codes": "424720",
    },
  }],
};

const search = runBridge("/search", {
  south: "35.49",
  west: "-79.18",
  north: "36.09",
  east: "-78.38",
  zoom: "10",
}, basePayload, cookieHeader);
const caryOil = search.payload.elements.find((element) => element?.tags?.name === "Cary Oil Co., Inc.");
assert.ok(caryOil, "The subsequent map-area response must include Cary Oil as a corporate distributor match.");
assert.equal(caryOil.type, "corporate");
assert.equal(caryOil.tags["fuel_iq:company_search_result"], "true");
assert.equal(caryOil.tags["fuel_iq:location_search_match"], "true");
assert.match(caryOil.tags["fuel_iq:headquarters"], /Cary, North Carolina/i);
assert.equal(search.payload.elements.some((element) => element.id === "physical-1"), true, "Physical facility results must remain present.");
assert.equal(search.payload.locationCompanyCount, 1);
assert.equal(search.payload.categoryCounts.distributor, 2);

const searchWithoutContext = runBridge("/search", {
  south: "35.49",
  west: "-79.18",
  north: "36.09",
  east: "-78.38",
  zoom: "10",
}, basePayload);
assert.equal(
  searchWithoutContext.payload.elements.some((element) => element?.tags?.name === "Cary Oil Co., Inc."),
  false,
  "Context-specific corporate companies must not leak into the shared cached area response.",
);

__test.clearContexts();
const companyGeocode = runBridge("/geocode", { q: "Cary Oil Co., Inc., Cary, North Carolina" }, {
  ok: true,
  result: {
    lat: 35.79154,
    lon: -78.78112,
    label: "Cary, Wake County, North Carolina, United States",
  },
});
assert.equal(companyGeocode.payload.locationCompanyCount, undefined, "A company-name geocode must not trigger a second city-wide company injection.");

console.log("Fuel Atlas Cary city-to-company bridge validation passed.");
