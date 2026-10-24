# Deal Lens on the existing website

The tracker runs at `/deal-lens/` in the existing Express service. Experimental
weather links to that same-site path, and the tracker links back. It uses the
existing weather sign-in and private, uncached responses for every asset.

Intake uses local Excel/OCR reading and a generated prompt with pasted readable
AI results. This route never calls an AI provider. `/deal-lens/api/status` reports
`paidEnabled: false`; `/deal-lens/api/analyze` is disabled.

The reference model and its formula data are encrypted with AES-256-GCM in
`data/deal-lens/`. Only the runtime `DEAL_LENS_MODEL_KEY` in Render can unlock
them. Do not commit a plaintext model, its decrypted data, or the key. Original
model values are served only after weather authentication. The browser export
preserves all 22 tabs and non-input formulas and updates yellow/orange inputs.

`test/dealLensHosting.test.js` tests the route with synthetic encrypted assets.
Model and intake regressions run when `DEAL_LENS_MODEL_KEY` is present; they skip
when the private fixture cannot be unlocked. No provider requests are required.

Saved deals remain in browser storage. Existing records from another origin can
be moved with the existing Export Deal Lens backup / Import Deal Lens backup
actions. No account data or uploaded seller files are committed to the repository.
