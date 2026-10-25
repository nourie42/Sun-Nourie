# Deal Lens on the existing website

The tracker runs at `/deal-lens/` in the existing Express service. Experimental
weather links to that same-site path, and the tracker links back. Deal Lens opens
without a password, as requested. Responses remain uncached and marked noindex.
The access requirements of the other sites are unchanged.

Intake uses local Excel/OCR reading and a generated prompt with pasted readable
AI results. This route never calls an AI provider. `/deal-lens/api/status` reports
`paidEnabled: false`; `/deal-lens/api/analyze` is disabled.

The reference model and its formula data are encrypted with AES-256-GCM in
`data/deal-lens/`. Only the runtime `DEAL_LENS_MODEL_KEY` in Render can unlock
them. Do not commit a plaintext model, its decrypted data, or the key. Original
model values are served to the public Deal Lens page at runtime. The browser export
preserves all 22 tabs and non-input formulas and updates yellow/orange inputs.

`test/dealLensHosting.test.js` tests the route with synthetic encrypted assets.
Model and intake regressions run when `DEAL_LENS_MODEL_KEY` is present; they skip
when the private fixture cannot be unlocked. No provider requests are required.

Saved deals remain in browser storage. Existing records from another origin can
be moved with the existing Export Deal Lens backup / Import Deal Lens backup
actions. No account data or uploaded seller files are committed to the repository.

## Reliability audit

The copy actions try the Clipboard API and a selected-text copy fallback. If the
browser blocks both, the prompt or brief stays selected with manual-copy guidance.
Intake remains usable when the workbook asset fails to load; calculations and
workbook downloads show an unavailable state until the page is reloaded.

Manual source corrections feed the workbook calculation. Manually entered deals
count as saved work when starting a new import. Deal identity, next actions,
evidence, source corrections, and table review remain accessible in the UI.
Workbook exports capture the selected deal before asynchronous work begins.

Formula recalculation follows a precomputed dependency graph and caches the most
recent numeric results. Source labels and confirmation status resolve separately.
The branch workflow runs the Deal Lens regressions and the shared access tests.

## Workbook parity on `deal-lens-parity`

The model and Chip brief show COOP!B34 (without capitalized lease, cash-flow row
32) and COOP!B38 (with capitalized lease, row 37) separately. Each 13% price is
solved by recalculating its own workbook cash flows, including price-dependent
taxes. The primary cash-flow table uses B34. It displays C29 as the year-1
operator add-back and Q29 as the year-15 exit value.

The workbook's editable S18 controls both recurring operator retained earnings
and the year-1 add-back through C18 and C29. No additional payment is added on
top of the workbook's cash flows. The separate native `model.js` defaults its
editable year-1 portfolio contribution to sites × $50,000, preserves explicit
zero overrides, and reports the B34 basis. It is not the live page's engine.

Run `node --test test/dealLensParity.test.js` without a key. These synthetic
regressions cover timing, scaling, overrides, basis reconciliation and price
solves. The existing private workbook/export tests require the runtime key.
`node scripts/dealLensParityReport.mjs` verifies the encrypted model when that
key is provided securely in the process environment. It reports `no-key` when
unavailable, fails on mismatches, and does not print model text or the key.

A fresh download can be checked without the key:
`node scripts/inspectDealLensWorkbook.mjs /private/path/download.xlsx`.
This checks the year-1 formula and identifies the file by SHA-256. Cached values
are not recalculation evidence, and an older local download does not establish
the currently deployed version. Never commit the downloaded workbook.

The supplied RomeoTest acceptance targets at ten sites and $9.5M are B34
12.9075% / $9,443,627 at 13%, and B38 12.385% / $9,089,579 at 13%.
Those remain unverified until the exact current RomeoTest workbook and its full
input set are available. The parity report's round synthetic operating inputs
are a separate test case and must not be represented as that baseline.

The separate `deal-desk/` app in this checkout is a ten-year pretax screen. It
was not changed as part of the clarified `/deal-lens/` scope. The encrypted
assets are unchanged pending verification of the deployed workbook.
