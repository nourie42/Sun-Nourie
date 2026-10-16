import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync, deflateSync } from "node:zlib";
import { decodeHouseholdPLSnapshot, serializeHouseholdPLSnapshot } from "../src/householdPLData.js";

const snapshot = { actualMonth: "2026-10", rows: [{ type: "line", row: 1, vals: [100, 200] }], tx: [] };
const encoded = (data) => gzipSync(JSON.stringify(data)).toString("base64");

test("server decodes the configured gzip to the unchanged snapshot", () => {
  assert.deepEqual(decodeHouseholdPLSnapshot(encoded(snapshot)), snapshot);
  const wrapped = encoded(snapshot).match(/.{1,40}/g).join("\n");
  assert.deepEqual(decodeHouseholdPLSnapshot(wrapped), snapshot);
});

test("legacy zlib or base64 JSON snapshots decode without changing their data", () => {
  assert.deepEqual(decodeHouseholdPLSnapshot(deflateSync(JSON.stringify(snapshot)).toString("base64")), snapshot);
  assert.deepEqual(decodeHouseholdPLSnapshot(Buffer.from(JSON.stringify(snapshot)).toString("base64")), snapshot);
});

test("gzip checksum failures are rejected rather than bypassed", () => {
  const bytes = Buffer.from(encoded(snapshot), "base64");
  bytes[bytes.length - 8] ^= 1;
  assert.throws(() => decodeHouseholdPLSnapshot(bytes.toString("base64")), (error) =>
    error.code === "HOUSEHOLD_PL_BAD_GZIP" && /incorrect data check/.test(error.detail));
});

test("bad base64, truncated gzip and bad JSON fail with data-safe diagnostics", () => {
  const gzip = Buffer.from(encoded(snapshot), "base64");
  const cases = [
    ["", "HOUSEHOLD_PL_DATA_MISSING"],
    ["invalid!", "HOUSEHOLD_PL_BAD_BASE64"],
    [gzip.subarray(0, gzip.length - 4).toString("base64"), "HOUSEHOLD_PL_BAD_GZIP"],
    [gzipSync("private merchant data is not JSON").toString("base64"), "HOUSEHOLD_PL_BAD_JSON"],
    [encoded({ rows: "invalid", tx: [] }), "HOUSEHOLD_PL_BAD_SCHEMA"],
    [encoded({ rows: [{ type: "line", vals: [] }], tx: [] }), "HOUSEHOLD_PL_BAD_SCHEMA"],
  ];
  for (const [value, code] of cases) {
    assert.throws(() => decodeHouseholdPLSnapshot(value), (error) =>
      error.code === code && !error.message.includes("private merchant"));
  }
});

test("embedded snapshot cannot close its script element and preserves literal replacement tokens", () => {
  const data = { ...snapshot, note: "</script><script>alert(1)</script>&>$&$`$'\u2028\u2029" };
  const serialized = serializeHouseholdPLSnapshot(data);
  assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/);
  assert.deepEqual(JSON.parse(serialized), data);
  const html = "<script>const Z=__HOUSEHOLD_PL_DATA__;</script>".replace("__HOUSEHOLD_PL_DATA__", () => serialized);
  assert.equal(html.match(/<\/script>/g).length, 1);
  assert.equal(html, "<script>const Z=" + serialized + ";</script>");
});
