import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../public/distributor-research-client-v2.js", import.meta.url), "utf8");

assert(/MAX_AUTOMATIC_RESTARTS\s*=\s*2/.test(source), "Distributor research must limit automatic restart loops.");
assert(/response\.status\s*===\s*404\s*\|\|\s*data\?\.status\s*===\s*'expired'/.test(source), "Expired or missing jobs must trigger recovery.");
assert(/await restartExpiredJob\(\)/.test(source), "Missing jobs must restart automatically instead of immediately showing failure.");
assert(/request:\s*request/.test(source), "The full research request must be saved for restart recovery.");
assert(/automaticRestarts/.test(source), "Automatic restart count must persist with the active job.");
assert(!/This job expired or the server restarted\. Start the search again/.test(source), "The client must not surface the old terminal restart failure.");

console.log("Distributor research restart-recovery validation passed.");
