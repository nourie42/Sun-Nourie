import { gunzipSync, inflateSync } from "node:zlib";

function invalid(code) {
  const error = new Error("Household P&L snapshot could not be read.");
  error.code = code;
  return error;
}

export function decodeHouseholdPLSnapshot(encoded) {
  if (typeof encoded !== "string" || !encoded.trim()) {
    throw invalid("HOUSEHOLD_PL_DATA_MISSING");
  }
  const base64 = encoded.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw invalid("HOUSEHOLD_PL_BAD_BASE64");
  }
  let json;
  const bytes = Buffer.from(base64, "base64");
  try {
    const options = { maxOutputLength: 32 * 1024 * 1024 };
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      json = gunzipSync(bytes, options).toString("utf8");
    } else if ((bytes[0] & 15) === 8 && ((bytes[0] << 8) + bytes[1]) % 31 === 0) {
      json = inflateSync(bytes, options).toString("utf8");
    } else if (/^\s*\{/.test(bytes.toString("utf8", 0, 32)) && bytes.length <= options.maxOutputLength) {
      json = bytes.toString("utf8");
    } else {
      throw Object.assign(new Error("Unrecognized snapshot encoding"), { code: "UNKNOWN_HEADER" });
    }
  } catch (cause) {
    const error = invalid("HOUSEHOLD_PL_BAD_GZIP");
    error.detail = [cause.code || "GZIP_DECODE_FAILED", cause.message,
      "bytes=" + bytes.length, "magic=" + bytes.subarray(0, 4).toString("hex")].join(" ");
    throw error;
  }
  let snapshot;
  try {
    snapshot = JSON.parse(json);
  } catch {
    throw invalid("HOUSEHOLD_PL_BAD_JSON");
  }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      !Array.isArray(snapshot.rows) || !Array.isArray(snapshot.tx) ||
      snapshot.rows.some((row) => !row || typeof row !== "object" ||
        (row.type === "line" && (!Array.isArray(row.vals) || row.vals.length < 2)))) {
    throw invalid("HOUSEHOLD_PL_BAD_SCHEMA");
  }
  return snapshot;
}

export function serializeHouseholdPLSnapshot(snapshot) {
  const escapes = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" };
  return JSON.stringify(snapshot).replace(/[<>&\u2028\u2029]/g, (character) => escapes[character]);
}
