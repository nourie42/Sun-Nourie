import assert from "node:assert/strict";
import fs from "node:fs";
import { __test } from "../src/distributorCompanySearch.js";

assert(
  __test.KNOWN_COMPANIES.length >= 120,
  "The corporate distributor index must remain broad; do not replace it with one-off company entries.",
);

const tiger = __test.knownCandidates("Tiger fuel");
assert.equal(tiger[0]?.legal_name, "Tiger Fuel Company", "Tiger Fuel must resolve to the corporate distributor.");

const buchanan = __test.knownCandidates("Buchanan Oil");
assert.equal(buchanan[0]?.legal_name, "Buchanan Oil Company", "Buchanan Oil must resolve as a corporate distributor.");

assert.equal(
  __test.isCorporateDistributor({
    legal_name: "Tiger Mart & Gas",
    headquarters: "3252 University Avenue, San Diego, California",
    description: "fuel / amenity",
    entity_type: "gas_station",
    source: "OpenStreetMap",
  }),
  false,
  "Individual gas stations must be rejected.",
);

assert.equal(
  __test.isCorporateDistributor({
    legal_name: "Example Petroleum Marketing, Inc.",
    headquarters: "Richmond, Virginia",
    description: "Wholesale motor-fuel distributor serving commercial accounts",
    entity_type: "petroleum_marketer",
    source: "Official company site",
  }),
  true,
  "Corporate distributors must be accepted.",
);

const ranked = __test.dedupeAndRank([
  {
    legal_name: "Example Petroleum Marketing, Inc.",
    headquarters: "Richmond, Virginia",
    website: "https://example.test/",
    description: "Wholesale motor-fuel distributor",
    entity_type: "petroleum_marketer",
    source: "Official company site",
  },
  {
    legal_name: "Example Petroleum",
    headquarters: "Richmond, Virginia",
    website: "https://www.example.test/about",
    description: "Commercial fuel supplier",
    entity_type: "commercial_fuel_supplier",
    source: "Trade association",
  },
], "Example Petroleum");

assert.equal(ranked.length, 1, "Corporate aliases sharing an official website must deduplicate.");

const routeSource = fs.readFileSync(new URL("../src/distributorCompanySearch.js", import.meta.url), "utf8");
assert(!/nominatimCandidates|googleCandidates|nominatim\.openstreetmap\.org|maps\.googleapis\.com/i.test(routeSource), "Map and place-search providers must not power corporate distributor search.");
assert(!/fastMatch|scoreCandidate\(known\[0\].*>=/i.test(routeSource), "An exact directory match must not bypass the exhaustive live corporate search.");
assert(/mode === "directory"/.test(routeSource), "The endpoint must support a fast directory phase before exhaustive live verification.");

const clientSource = fs.readFileSync(new URL("../public/distributor-company-search.js", import.meta.url), "utf8");
assert(!/manualCandidate|exact-name option/i.test(clientSource), "The UI must not add an arbitrary unverified company as a selectable result.");
assert(/mode=/.test(clientSource), "The UI must run directory and exhaustive search phases.");
assert(/Corporate distributor/i.test(clientSource), "The UI must label results as corporate distributors.");

console.log(`Distributor corporate-search validation passed with ${__test.KNOWN_COMPANIES.length} indexed companies.`);
