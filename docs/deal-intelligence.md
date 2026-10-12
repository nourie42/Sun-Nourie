# Deal Intelligence on Sun Nourie

The private M&A section lives at `/deal-intelligence/`, linked from the main home navigation and Weather Nourie’s page tools. It shares the existing weather-site password and session. Its API lives under `/api/deal-intelligence/` and requires that same verified session.

The section includes acquisition research, ownership/contact records, auditable underwriting, site records, pipeline stages, investment briefs, saved public signals and workspace analysis. Included sample records are fictional and labeled. Live research uses the existing server-side `OPENAI_API_KEY`; no new key is sent to or collected by the browser. `OPENAI_MODEL` and `OPENAI_RESEARCH_MODEL` can select the existing project’s models.

Browser records are primary when persistent server storage has not been established. Temporary server copies provide context to the analyst and research tools. Reloading after a service restart restores saved browser records before further research. JSON export provides a portable workspace backup. CSV and XLSX import preserve unknown fields and distinguish cached workbook values from recalculated financial models.

`DEAL_INTELLIGENCE_DATA_DIR` or `DATA_DIR` selects a server storage directory. The section reports storage as durable only when a persistent directory is configured and `DEAL_INTELLIGENCE_STORAGE_DURABLE=true` explicitly confirms its lifetime. No disk or billing configuration is changed by this feature.

Source lives under `src/deal-intelligence/`. Rebuild the committed page with:

```sh
node scripts/buildDealIntelligence.mjs
```

The generated `public/deal-intelligence/index.html` contains all required frontend assets. The route adapter is `src/dealIntelligenceRoutes.js`; the existing access middleware gates its page and API before requests can reach legacy handlers.

AI research starts a private background job through `POST /api/deal-intelligence/ai/jobs`. The browser polls its status through short requests and displays elapsed time while the rest of the workspace remains usable. Background requests have a three-minute upstream budget. Jobs live in the current server process and expire after fifteen minutes; a service restart requires starting the research again, while saved workspace records remain in the browser. The direct AI endpoint remains available with its original 45-second budget.

Relevant checks:

```sh
node test/deal-intelligence-routes.test.mjs
node test/deal-intelligence-ui.test.mjs
```

The Deal Intelligence live verification workflow signs in with the existing `WEATHER_SITE_PASSWORD` repository secret, waits for the background-job deployment, opens the page in Chromium, and exercises an actual sourced research request. It does not import results or change workspace records, and it logs only status and timing.

Watchtower performs checks on demand. No unattended monitoring schedule is activated by this change.
