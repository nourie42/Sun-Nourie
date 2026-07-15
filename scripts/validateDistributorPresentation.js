import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  fixWordDocument,
  sanitizePayload,
  transformDistributorPage,
} from "../src/distributorPresentationFix.js";

const sourcePage = await fs.readFile(new URL("../public/distributors.html", import.meta.url), "utf8");
const page = transformDistributorPage(sourcePage);
assert.equal(/Chat\s*GPT/i.test(page), false, "Distributor page still exposes a provider name");
assert.equal(/OpenAI/i.test(page), false, "Distributor page still exposes a provider company name");

const payload = sanitizePayload({
  message: "ChatGPT is researching with OpenAI",
  model: "gpt-5.5",
  report: { _meta: { model: "gpt-5.5" } },
});
assert.equal(payload.message, "Fuel IQ is researching with Fuel IQ");
assert.equal(payload.model, "");
assert.equal(payload.report._meta.model, "");

const sampleWord = `<!doctype html><html><head></head><body><article class="report-document"><div class="meta">Prepared &nbsp; <b>ChatGPT model:</b> gpt-5.5</div><section id="report-appendix-sources"><div class="table-scroll"><table><thead><tr><th>ID</th><th>Source</th><th>Type</th><th>URL</th><th>Why it matters</th><th>Confidence</th></tr></thead><tbody><tr><td>S1</td><td>Example</td><td>Official</td><td><a href="https://example.com">https://example.com/a/very/long/path</a></td><td>Reference</td><td>High</td></tr></tbody></table></div></section></article></body></html>`;
const word = fixWordDocument(sampleWord);
assert.match(word, /fuel-iq-distributor-word-layout-fix/);
assert.match(word, /<colgroup>/);
assert.match(word, />Open source<\/a>/);
assert.equal(/Chat\s*GPT/i.test(word), false);
assert.equal(/gpt-5\.5/i.test(word), false);

console.log("Distributor presentation validation passed.");
