import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/siteResearchExhaustive.js", import.meta.url), "utf8");

assert(/"gpt-5\.4"/.test(source), "Site research must attempt the current GPT-5.4 API model.");
assert(/researchPayloadVariants/.test(source) && /background-required/.test(source) && /foreground-compatible/.test(source), "Research must retry across background and foreground compatibility modes.");
assert(/synthesisPayloadVariants/.test(source) && /foreground-json/.test(source), "Synthesis must have a foreground compatibility path.");
assert(/completeFallbackReport/.test(source) && /fallbackRawReport/.test(source), "Completed research evidence must still produce a report when structured synthesis fails.");
assert(/pollFailures\s*>=\s*4/.test(source), "Repeated response-retrieval failures must terminate or fall back instead of polling forever.");
assert(/passes:\s*job\.passes\.map/.test(source), "Polling responses must expose pass progress for the browser UI.");
assert(!/job\.status\s*=\s*"failed";\s*job\.message\s*=\s*"The final report synthesis failed/.test(source), "A synthesis-only failure must not discard completed exhaustive research.");

console.log("Site research compatibility and fallback validation passed.");
