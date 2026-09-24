# Standalone WeatherNext Forecast

The public route is `/weathernext/`. Experimental Weather has one plain text link;
its embedded WeatherNext card and disabled map control have been removed. Main
Weather Fusion's model blending and calculations are unchanged.

## Feed and scope

`models/weathernext-full.json` on `weather-fusion-data` is separate from the legacy
seven-day feed. The collector selects every documented available BigQuery surface
field and all six ensemble statistics after inspecting the actual table schema.
The two published locations are Knightdale/Raleigh and Greenville, NC. This is not
an arbitrary-location global API. Main, interim and retained previous runs are
kept separate; optional source failure never erases the verified primary feed.

Data specification: https://developers.google.com/weathernext/guides/bigquery
Variable specification: https://developers.google.com/weathernext/guides/models
Raw upper-air/member products: https://developers.google.com/weathernext/guides/gcs

The browser converts Kelvin to Fahrenheit, metres per second to mph, hourly
precipitation metres to inches, fractions to percent, Pa to hPa, and hourly solar
J/m² to average W/m². Signed wind components remain signed. Missing values stay
missing. Precipitation covers the hour ending at the valid time; daily totals
sum hourly means, never quantiles. Partial local days and daylight-saving day
lengths are explicitly handled. CSV is display units; source JSON preserves SI.

Raw member trajectories, native six-hour products, upper-air grids and global
maps are separate Google products, linked and identified rather than fabricated.
No gusts, calibrated rain probabilities, live observations or UV indices are
invented from the surface dataset. Official warnings remain external.

## Verification

`node --test test/weather*.test.js`
`node scripts/weatherNextSiteSmoke.js`
`node scripts/weatherTodayTileSmoke.js`

The browser test covers 320/360/390/430/768/1440 px, all 21 fields, all six
statistics, actual CSV download, separate horizons, location selection, stale
refresh/first-load failures, plain navigation, and the experimental-only link.
Synthetic fixtures live only under scripts/tests and are never a production feed.

## Query safety

Field requests are geographically filtered, pinned to one initialization and batched.
BigQuery's pre-execution estimate for clustered tables is pessimistic; the collector
logs both estimated and actual billed bytes. The configured estimate ceiling limits
each submitted query. A post-query safety stop blocks further requests if a point
batch bills more than 250 MB or one collection exceeds 5 GB. This post-query check
cannot undo charges from the query that triggered it. The workflow persists the
cost-stop marker even on failure; later collections refuse to query until it is
reviewed. Unchanged main runs are reused rather than queried repeatedly.
