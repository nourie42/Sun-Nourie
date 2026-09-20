# Deal Desk

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
analysis; they are sent to Anthropic only for that request. No server persistence
is implemented. JSON export/import preserves the draft across sessions.

Historical report download links retain their authenticated original workspace
destination. Do not commit user workbooks or private reports to this public repo.

Run focused model/API tests from the repo root: `node --test test/dealDesk.test.js`.
The optional `node scripts/smokeDealDesk.mjs` browser check needs Playwright,
Chromium, and JSZip available to Node. Set `DEAL_DESK_BASE_URL` to check a live
deployment without sending a paid AI request. Otherwise it starts a local server
with a mocked provider and tests successful/failed AI review too.
