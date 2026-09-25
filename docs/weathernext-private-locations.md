# Private WeatherNext location lookups

The main link is labelled **Password required**. Visitors can view preset and cached forecasts without unlocking. An uncached city/ZIP or device location shows the shared-password form instead of an empty forecast. Unlocking alone does not query BigQuery: the explicit form submission loads the selected forecast through the protected POST endpoint.

## Render configuration (private Environment settings)

Set these on the web service, never in browser JavaScript or a committed file:

- `WEATHERNEXT_SHARED_PASSWORD`: a shared password of at least 12 characters (maximum 256).
- `WEATHERNEXT_GCP_CREDENTIALS`: a dedicated Google service-account JSON key with BigQuery job creation on its billing project and read access to the linked WeatherNext dataset. Existing GitHub Actions Workload Identity credentials do not automatically authenticate Render. Do not copy an ephemeral GitHub token into Render.
- `WEATHERNEXT_BQ_TABLE`: the linked surface table, currently `homeassist-470415.weathernext_3.weathernext_3_0_0_0p1deg`.
- `WEATHERNEXT_MAX_BYTES_PER_QUERY`: an explicitly chosen positive integer byte ceiling. There is deliberately no enabled default. Measure dry-run estimates and agree a limit before enabling. Each lookup runs up to two query jobs (initialization discovery, then point data); initialization discovery is reused for 30 minutes.
- `WEATHERNEXT_PUBLIC_ORIGIN`: defaults to `https://sun-nourie-live.onrender.com`. Set the exact origin if using a different host. Unlock/query POSTs from other origins are rejected.

Before activation, configure a **project-level daily BigQuery query quota**. The application checks dry-run estimates and sends `maximumBytesBilled` with every job. It also permits only three uncached lookups per hour per server process. That in-memory limiter is NOT a durable monthly spending cap: it resets on restart and scales per instance. Google Cloud budgets send alerts; they are not a hard spending stop. The separate existing GitHub collector also consumes the project's allowance.

## Data and cache behavior

- Supports the contiguous United States, using NWS to resolve the selected coordinates' name and time zone.
- Queries the WeatherNext surface grid polygon containing the actual coordinates, including the main run and any newer interim run. This live path uses surface statistics, not the optional station-trained table.
- Keeps WeatherNext temperatures, ensemble spreads, wind, humidity inputs, pressure, radiation and precipitation amounts; NWS supplies separately attributed rain probabilities and the existing supplemental feeds supply UV/AQI.
- Cache lifetime: six hours per exact coordinate pair, up to 32 locations per process. Concurrent requests for the same coordinates share one query. Coordinates are not silently replaced with a preset town.
- GET requests never create BigQuery jobs. POST `/api/weather-fusion/compare/location` requires a valid server session, matching Origin and custom request header.
- Sessions are random, HTTP-only, Secure on production, SameSite=Strict cookies lasting 24 hours. Sessions and local caches reset on restart; rotating the password and restarting revokes sessions. Login attempts are rate limited. Use one web instance unless a shared session/cache store is added.

## Required activation checks

Automated tests use synthetic BigQuery responses and test-only passwords, not paid jobs. A local browser test does not prove Cloud access. After privately configuring secrets and quotas, verify on production:

1. An anonymous uncached request shows Password required and starts no query.
2. An incorrect password is rejected.
3. Unlock, select a city not in the presets, and explicitly load it; confirm its coordinates, time zone and forecast timestamps.
4. Repeat the same lookup and confirm no additional query job; test a second browser without the password can view that cached result.
5. Check actual billed bytes in Google Cloud jobs and confirm quota enforcement.
6. Test device location on a phone. No release should be described as fully working for arbitrary locations before these checks succeed.
