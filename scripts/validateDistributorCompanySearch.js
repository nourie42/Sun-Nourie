import assert from "node:assert/strict";
import { __test } from "../src/distributorCompanySearch.js";

const tiger = __test.knownCandidates("Tiger fuel");
assert.equal(tiger[0]?.legal_name, "Tiger Fuel Company", "Tiger Fuel should resolve to the distributor corporation.");

const buchanan = __test.knownCandidates("Buchanan Oil");
assert.equal(buchanan[0]?.legal_name, "Buchanan Oil Company", "Buchanan Oil should resolve as a corporate distributor.");

const stations = __test.dedupeAndRank([
  {
    legal_name: "Tiger Mart & Gas",
    headquarters: "3252 University Avenue, San Diego, California",
    description: "fuel / amenity gas station convenience store",
    source: "OpenStreetMap",
  },
  {
    legal_name: "Exxon Tiger Market",
    headquarters: "Nashville, Tennessee",
    description: "gas station and convenience store",
    source: "OpenStreetMap",
  },
], "Tiger fuel");
assert.equal(stations.length, 0, "Individual gas stations must be excluded.");

const corporate = __test.dedupeAndRank([
  {
    legal_name: "Example Petroleum Distributors, LLC",
    headquarters: "Richmond, Virginia",
    description: "Wholesale branded and unbranded motor-fuel distributor serving independent dealers",
    source: "Official company site",
  },
], "Example Petroleum");
assert.equal(corporate.length, 1, "A documented corporate wholesale distributor should remain searchable.");

console.log("Distributor corporate-only search validation passed.");
