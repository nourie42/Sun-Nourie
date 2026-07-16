import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { transformSiteAnalyzerPage } from "../src/siteAnalyzerPresentation.js";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const server = read("server.js");
const layout = read("public/site-research-layout.js");
const addressSafety = read("public/site-address-safety.js");
const autocompleteRecovery = read("public/site-autocomplete-recovery.js");
const presentation = read("src/siteAnalyzerPresentation.js");
const aadt = read("src/aadtCoverage.js");
const reportEnhancements = read("src/siteResearchReportEnhancements.js");
const wordFix = read("src/siteWordLayoutFix.js");

const sample = `<!doctype html><html><head><title>Legacy</title></head><body><div class="wrap">
<header><h1>Legacy Fuel IQ</h1><span class="build">old</span><a href="developments.html">Developments Search</a><a href="PA_Signals_AADT_Radius_Map_Final_Generated.html">PA AADT Map</a><a href="Scraper.html">Prospector</a></header>
<nav class="aadt-tabs"><span class="muted">State AADT Quick Links:</span><a class="aadt-tab">NC</a></nav>
<div class="instructions">Old instructions</div>
<div class="card"><div class="row input-row"><div><input id="addr"></div><div><button id="go">Estimate</button><button id="refreshAfterChange">Re-check</button></div></div><div class="toolbar notes-toolbar"><label>User notes</label><textarea id="siteNotes"></textarea><div class="muted subtle">Notes</div></div></div>
<div class="card"><div id="mapTitle">Map</div><div id="map"><div id="overlay"></div></div><div id="svWrap"><iframe id="sv"></iframe></div></div>
<div class="card"><div id="aadtSourceLine">Source</div><div id="aadtMap"></div><div><table id="aadtTable"><tbody></tbody></table></div></div>
<div class="card"><div id="devs" class="muted">—</div></div>
<div class="card"><b>Google Rating</b><div id="ratingLine" class="muted">—</div></div>
</div><div class="footerbar"><button id="exportPDF">Export to PDF</button></div></body></html>`;

const transformed = transformSiteAnalyzerPage(sample);
assert(transformed.includes('data-fiq-rendered="server"'), "Site Analyzer must be transformed before browser paint.");
assert(transformed.includes('id="siteResearchProfessionalStyles"'), "Professional styling must be embedded server-side.");
assert(transformed.includes('id="siteWorkflowCard"'), "The primary workflow card must be server-rendered.");
assert(transformed.includes('id="fiqSiteAnalyzerTitle"'), "The black hero must contain a prominent Site Analyzer heading.");
assert(transformed.includes('Estimate volume, validate traffic, and run sourced diligence.'), "The hero headline must fill the black presentation area.");
assert(!transformed.includes('class="instructions"'), "The legacy client must not be able to replace the professional hero with small instructions.");
assert(!transformed.includes('class="toolbar notes-toolbar"'), "User comments must not remain visible.");
assert(transformed.includes('id="siteNotes" type="hidden"'), "A hidden notes compatibility field must preserve existing JS behavior.");
assert(transformed.includes('id="devs" hidden'), "Developments must be hidden from the basic analyzer.");
assert(transformed.includes('id="ratingLine" hidden'), "Google Rating must be hidden from the basic analyzer.");
assert(transformed.includes('id="mapAadtCard"'), "Site, competitor, and AADT maps must be combined.");
assert((transformed.match(/id="map"/g) || []).length === 1, "The combined view must retain exactly one site map element.");
assert((transformed.match(/id="aadtMap"/g) || []).length === 1, "The combined view must retain exactly one AADT map element.");
assert(transformed.includes('id="reportExportDock"'), "Word exports must be in the fixed bottom dock.");
assert(transformed.indexOf('id="scrollToResearchResults"') < transformed.indexOf('id="exportPDF"'), "Scroll-to-results must be left of Basic Word export.");
assert(transformed.indexOf('id="exportPDF"') < transformed.indexOf('id="siteResearchWordButton"'), "Basic Word export must be left of Exhaustive Word export.");
assert(transformed.includes('id="siteResearchLoadingOverlay"'), "Exhaustive research must have a radar loading overlay.");
assert(transformSiteAnalyzerPage(transformed) === transformed, "Server-side transformation must be idempotent.");

for (const snippet of [
  '.research-options-panel .site-research-grid .chip input',
  'width:18px!important',
  'display:flex!important',
  'font-size:14px!important',
]) assert(presentation.includes(snippet), `Exhaustive-selection styling is missing: ${snippet}`);

for (const snippet of [
  'import { transformSiteAnalyzerPage } from "./src/siteAnalyzerPresentation.js"',
  'registerExpandedAadtRoutes(app, { legacyPort })',
  'registerSiteResearchReportEnhancements(app)',
  'transformSiteAnalyzerPage(Buffer.concat(chunks).toString("utf8"))',
  'siteAnalyzerNoLegacyFlash: true',
  'siteAddressInputSafety: true',
  '"/site-address-safety.js"',
  '<script src="/site-address-safety.js" defer></script>',
]) assert(server.includes(snippet), `server.js is missing: ${snippet}`);

for (const snippet of [
  'input.disabled = false',
  'input.readOnly = false',
  'Autocomplete ready',
  'Quick Estimate',
  'fiq-dock-overlaps-address',
  'pointer-events: none !important',
  '@media (max-height: 820px)',
  'site-autocomplete-recovery.js',
]) assert(addressSafety.includes(snippet), `Address-field safety is missing: ${snippet}`);

for (const snippet of [
  'fiqAutocompleteRecovery',
  '/google/autocomplete?input=',
  '/osm/autocomplete?q=',
  'Autocomplete ready',
  'role="option"',
]) assert(autocompleteRecovery.includes(snippet), `Autocomplete recovery is missing: ${snippet}`);

const aadtMove = layout.indexOf("workflow.appendChild(aadtCard)");
const researchMove = layout.indexOf("workflow.appendChild(researchCard)");
assert(aadtMove >= 0 && researchMove > aadtMove, "Recommended AADT must be positioned above exhaustive selections.");
for (const snippet of [
  "showResearchLoading()",
  "scrollToResearchResults",
  "siteResearchResultsCard",
  "Export Basic Report to Word",
]) assert(layout.includes(snippet), `Client layout is missing: ${snippet}`);

for (const snippet of [
  'searchArcgisCatalog(stateCode)',
  'expanded official/public ArcGIS traffic-layer search',
  'MAX_DYNAMIC_RADIUS_MI = 8',
  'router.get("/aadt/nearby"',
]) assert(aadt.includes(snippet), `Expanded AADT coverage is missing: ${snippet}`);

for (const snippet of [
  'id="fuel-iq-expected-gallons"',
  'Expected Gallons',
  'REPORT_ESTIMATES',
]) assert(reportEnhancements.includes(snippet), `Exhaustive report enhancement is missing: ${snippet}`);

for (const snippet of [
  'BASIC_WORD_ROUTE',
  'EXHAUSTIVE_WORD_ROUTE',
  '@page Section1',
  'table-layout: fixed',
  'Open source',
]) assert(wordFix.includes(snippet), `Word margin fix is missing: ${snippet}`);

console.log("Site Analyzer autocomplete, address safety, and layout validation passed.");
