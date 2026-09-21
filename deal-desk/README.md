# Deal Desk

The purchase recommendation is the first results panel. Reporting choices are
last full year, trailing twelve months, and reported YTD flows divided by reported
months times twelve. Counts and rates are never annualized. Changing the choice
marks the old results and requires source analysis again; Rerun economics validates
edits to the current period without calling an AI provider.

The Synergies tab lists included, excluded, and unquantified opportunities. Named
custom rows retain their proposed amount when excluded and identify the affected
channel, evidence, and whether Sunoco or converted retail dealers receive the
benefit. Dealer-only benefits do not increase Sunoco purchase capacity. These
rows persist in saved drafts and editable Excel formulas.

Run all Deal Desk regressions with Node 24 after installing both the root and
deal-desk dependencies: `node --test test/dealDesk*.test.js`. Document checks
exercise binary PPT/PPS/POT, PPTX presentation/template variants, Word, OpenDocument,
XLS/XLSX/XLSB/ODS/CSV, and custom-synergy exports. Encrypted, damaged, or unsupported
binary files fail visibly; image-only legacy PPT files still require PDF or slide
images. Failed files remain visible even when other files complete analysis.

The original React Deal Desk runs at `/deal-desk` inside the existing Express
service. No other navigation is changed. This is not a separate deployment.

The committed `public/deal-desk/` assets and `src/dealDeskModel.js` are generated
from this directory. To rebuild with Node 22.13+:

```
cd deal-desk
npm ci
npm run build
```

The Express API uses `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_MODEL`.
Access uses `DEAL_DESK_PASSWORD`, falling back to the existing
`AI_COUNCIL_ACCESS_CODE`. Without either, paid analysis is locked.
Inputs and source documents stay in browser memory until the user requests AI
analysis. Extraction and a separate verification pass use Anthropic. PDFs use
native document/vision content; images use native vision. DOCX includes text,
tables, headers, footnotes and supported embedded images. Legacy DOC/RTF is
converted server-side. Excel/CSV/ODS, PPTX, ODT, text and JSON are also accepted;
unsupported/encrypted/damaged files fail visibly instead of being silently skipped.
20 MB/file, 20 source items (including embedded images), 100 PDF pages/packet,
28 MB assembled packet and bounded text/cell limits apply. Large packets must be
split. Source workbook formula values are cached, not independently recalculated.

Company search uses Anthropic's native web-search tool. Only the company query
and optional public disambiguation enter the search request. Company research
requires actual tool use and traceable citations. It does not guess private
financials or internal Sunoco pricing. A second pass checks fields; deterministic
quote/number/unit/period checks further restrict automatic filling. User-entered
values are preserved when conflicting. Scan-derived values need user review.
These checks reduce mistakes, but are not an audit or a guarantee of accuracy.

POST /api/deal-desk/analyze and /research return a background job ID. Authenticated
GET /jobs/:id polls status. Results expire after 20 minutes or service restart.
Source binaries are released when analysis completes; no file persistence is
implemented. Save/open draft preserves inputs, evidence and site records locally.

The standard Excel export includes a company summary, editable formula model,
all site records/original columns, evidence, and unquantified opportunities.
Its verified formula caches agree with the JS screen and Excel recalculates edits.
Optional original-model mapping fills only user-selected constant cells, protects
formulas, clears unknown mapped sample values, leaves unmapped cells unchanged,
and invalidates cached formula values for recalculation in Excel. This is not
automatic validation of arbitrary legacy model logic. Never commit private seller
workbooks or reports into this public repository.

The empty public template is authored by scripts/createDealDeskTemplate.mjs using
the Codex @oai/artifact-tool runtime; model-template.json stores its XLSX bytes.
Runtime export uses OpenXML edits without replacing formulas or original styles.
The summary PDF is generated from the actual current company review and model.

Run focused model/API tests from the repo root: `node --test test/dealDesk.test.js`.
The optional `node scripts/smokeDealDesk.mjs` browser check needs Playwright,
Chromium, and JSZip available to Node. Set `DEAL_DESK_BASE_URL` to check a live
deployment without sending a paid AI request. Otherwise it starts a local server
with a mocked provider and tests mixed PDF/DOCX/CSV intake, 122 retained site rows,
formula exports, blank vs zero, original-formula protection, summary PDF,
company search, verified autofill and authentication failure on desktop/mobile.
scripts/verifyDealDeskWorkbook.mjs uses the artifact runtime for independent
formula recalculation across commission, rent, capital and missing-input scenarios.
Provider mocks do not validate production key/model/search entitlement or billing.
