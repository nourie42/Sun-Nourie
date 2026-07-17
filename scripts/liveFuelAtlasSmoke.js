import assert from "node:assert/strict";
import fs from "node:fs";
import { clearFuelAtlasFastCache, registerFuelAtlasFastSearchRoute } from "../src/fuelAtlasFastSearch.js";

function makeResponse() {
  return { statusCode: 200, payload: null, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, json(value) { this.payload = value; return this; } };
}

clearFuelAtlasFastCache();
const routes = new Map();
registerFuelAtlasFastSearchRoute({ get(path, handler) { routes.set(path, handler); } }, {
  googleApiKey: process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "",
  sourceTimeoutMs: 6500,
  hardDeadlineMs: 7500,
});

const response = makeResponse();
const started = Date.now();
await routes.get("/api/fuel-atlas/search")({ query: { south: "40.62", west: "-74.22", north: "40.78", east: "-74.05", zoom: "11" } }, response);
const elapsed = Date.now() - started;

assert.equal(response.statusCode, 200, `live search returned HTTP ${response.statusCode}`);
assert.equal(response.payload?.ok, true, "live search did not return ok=true");
assert.ok(elapsed < 9000, `live search exceeded the bounded response time: ${elapsed}ms`);
assert.ok(Array.isArray(response.payload?.records), "live search did not return a records array");
assert.ok(response.payload.records.length > 0, `live search returned no specialized fuel facilities; sources=${JSON.stringify(response.payload?.sourceSummary)}`);
assert.equal(response.payload.records.some((item) => /gas station|service station|convenience|food mart/i.test(item.name)), false, "live result contained an ordinary retail gas station");
assert.equal(response.payload.sourceSummary.some((source) => source.name === "EPA ECHO" && source.status === "ok"), true, "EPA ECHO did not complete successfully");

const result = {
  checkedAt: new Date().toISOString(),
  elapsedMs: elapsed,
  responseUnderNineSeconds: elapsed < 9000,
  count: response.payload.records.length,
  ordinaryGasStations: response.payload.records.filter((item) => /gas station|service station|convenience|food mart/i.test(item.name)).length,
  firstFive: response.payload.records.slice(0, 5).map((item) => item.name),
  sources: response.payload.sourceSummary,
};
fs.writeFileSync("fuel-atlas-smoke-result.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
