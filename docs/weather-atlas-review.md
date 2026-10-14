# Weather Atlas

A separate, map-first view at `/weather-fusion/atlas.html`, based on the existing main Weather Nourie forecast. The existing secondary-page password policy still applies. No existing page, forecast computation, account setting, or deployment configuration is changed.

## What is included

- Responsive dark editorial layout, with current conditions beside the map on desktop
- Seven existing map layers: observed NOAA radar, forecast HRRR reflectivity, ECMWF rain, NBM rain, temperature, wind, and clouds
- Existing map playback, timestamp verification, basemap selector, fullscreen, and source links
- Interactive 24/48-hour temperature, rain-score, and wind charts with a keyboard-accessible scrubber and tabular alternative
- Existing hourly, daily, air-quality, official-warning, comfort, and detailed forecast cards
- Actual applied daily high-temperature source weights and daily confidence evidence
- Loading, missing-source, location-change, offline, and aged-snapshot states

## Data contract

`atlas.js` listens to the main `weather-nourie:forecast` event. It makes no forecast request, recomputes no blend, and changes no canonical forecast value. Its charts read `hours`, preserving canonical missing values and breaking paths at gaps. The source weights come from `days[n].highBlend.sources`, not nominal weights. Confidence comes from `days[n].confidence` and is labeled as a relative index rather than a probability.

Map layers use the main app's existing verified source catalog. Forecast reflectivity is distinct from observed radar. A missing map or blank tile is never described as clear weather. A source-check timestamp is not a claim that every observation or model initialization has that timestamp.

## Review

Run `npm ci` and `npm run dev`, then visit `/weather-fusion/atlas.html` on the printed local server. Use the site's existing password flow if required. Search for a U.S. city or ZIP code, or explicitly allow device location. The new page is not linked from or substituted for the current main page.

Production publication requires approval and has not been performed by this change. Merely opening this pull request does not verify a live deployment.

## Checks

- `node --check public/weather-fusion/atlas.js`
- `node --test test/weatherFusionAtlas.test.js test/weatherFusionHalo.test.js test/weatherSiteAccess.test.js`
- The dedicated Weather Atlas browser workflow runs deterministic UI checks and uploads screenshots, logs, and a JSON report. Screenshots are explicitly labeled TEST DATA, not live weather. Read the workflow result for the exact commit; the presence of the script alone does not establish a pass.
- Full-suite baseline comparison against `7a43fbee911b2b086f5ff92b78c92308a8d550e9` found 13 pre-existing failures and no added failures. `npm run check` also fails on the unchanged fog-versus-umbrella assertion in `scripts/verifyWeatherQaContract.js:45`.

These deterministic UI checks do not establish live provider availability. A public main forecast response for Knightdale was independently read on October 14, 2026 and included the expected canonical fields and ready source statuses; that check is not a deployed Atlas integration test. The radar catalog reported ready with frames through 09:06 UTC; all six model map catalogs also reported ready (HRRR: 19 frames, NBM: 39, ECMWF rain/temperature/wind/clouds: 37 each). Map-catalog readiness does not prove every image tile rendered successfully.
