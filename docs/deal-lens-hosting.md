# Deal Lens workbook hosting

Deal Lens is public and does not require a password or model encryption key.
The server reads an ordinary mounted workbook package from
`/etc/secrets/deal-lens-model.bundle` (Render's persistent file configuration).
`DEAL_LENS_MODEL_FILE` can point to the same package for local verification.

The package is base64-encoded gzip JSON with `version: 1`, `manifest` (the
formula/value JavaScript manifest), and `workbookBase64` (the unchanged XLSX).
Compression and encoding are transport formats; the package is not encrypted.
The company workbook remains outside this public Git repository.

The deployed source is `Copy of RomeoTest Simple Model.xlsx`. With the workbook's
existing assumptions, 10 sites and a $9.5 million purchase price give B34 IRR
12.9075393% and B38 IRR 12.3851188%. The prices solving 13% are $9,443,626.66
and $9,089,578.75 respectively. C29 adds back $500,000 in year 1.

Run `node scripts/dealLensParityReport.mjs /tmp/deal-lens-parity.json` on Render
to verify the mounted workbook. The report contains only the requested baseline
and synthetic test cases, not the workbook's source data. CI runs the public
regression fixtures; full workbook tests run where this file is mounted.
