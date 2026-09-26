# Private P&L: deployment setup pending

This branch contains a locally tested application candidate, not a live deployment.
Existing pages and public navigation are unchanged. No credentials or readable
financial records belong in this repository. The RSA key in this directory is public.

Before merging/deploying:
- Confirm the intended Render workspace and exact existing Sun-Nourie service.
- Verify a persistent disk exists; obtain approval before adding paid resources.
- Configure HOUSEHOLD_PASSWORD, HOUSEHOLD_PRIVATE_KEY_B64 and HOUSEHOLD_DATA_DIR.
- Add the matching encrypted starter `seed.enc.json` from the private deployment
  package. Do not upload its private environment file to GitHub.
- Run `node scripts/enable-household-pl.mjs` in the reviewed branch, run the supplied
  tests, and verify only the two intended server integration lines changed.
- Deploy and test real authentication, cell drilldown, edits, persistent storage,
  mobile layout and the existing public pages before claiming live completion.

Route: `/household-pl`. The source connector is not exposed on this route. Scheduled
imports use the public-key encryption scripts and the ciphertext-only
`household-data/private-pl/weekly.enc.json` feed. Budget/manual edits stay server-side
and are never overwritten by the feed. The application fails closed until all
private settings and persistent storage are ready.
