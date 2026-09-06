# Weather Fusion — numerical model integration

Weather Fusion remains an add-on at `/weather-fusion/`, served by the existing
`npm start` / `node server.js`. No replacement site, launcher, navigation, package
files or unrelated business tools are required or changed by this repair.

## Numerical sources actually used

The two saved locations, Knightdale/Raleigh and Greenville, NC, use official NWS
point/hourly forecasts, precipitation grids, alerts and their local Area Forecast
Discussion, plus decoded NOAA HRRR, NOAA National Blend (NBM), and ECMWF IFS values.
HRRR supplies temperature, precipitation, dewpoint, gust and simulated reflectivity.
NBM supplies temperature and native precipitation intervals. ECMWF supplies
precipitation, temperature, dewpoint, wind and clouds. ECMWF is the **0.25-degree
Open Data grid**, not the higher-resolution licensed grid.

Python/ecCodes runs separately in GitHub Actions. It retrieves selected GRIB2
messages from official provider cloud copies, checks HTTP ranges, model identity,
units, initialization, forecast hour and coverage, and publishes small snapshots
and regional images on the `weather-fusion-data` branch. The production Node server
reads these snapshots; it does not decode large files or start another server.
No Open-Meteo model key or usage-mode flag is needed. Open-Meteo geocoding remains
an independent city-search service.

The ECMWF mirror wrapper verifies and pins an official mirror for each run so
inventory offsets and binary messages come from the same copy. Missing newest
cycles fall back to an older complete run with its **original initialization time**.
An ECMWF file hosted on Google Cloud is still ECMWF, not Google's weather model.

## Forecast calculations

Temperature starting weights (renormalized over complete available inputs):

| Period | NWS | HRRR | ECMWF | NBM |
|---|---:|---:|---:|---:|
| Today | 60% | 20% | 10% | 10% |
| Tomorrow | 60% | 10% | 20% | 10% |
| Days 3–7 | 60% | — | 25% | 15% |

Model temperatures are aligned to remaining NWS daytime and overnight periods.
Official NWS values remain separately visible in daily details.

Near-term precipitation uses HRRR 60% / ECMWF 40%. Beyond that range the starting
weights are ECMWF 60%, NBM 25%, NWS 15%. NBM/NWS provide labeled fallbacks when
both near-term primary models lack complete coverage. The actual weights used are
exposed, including renormalization. These are **uncalibrated starting weights**,
not a demonstrated ranking of accuracy or a statistical confidence interval.

The precipitation metric shows the **next 24 hours starting at the next whole
hour**, with start/end timestamps. Today's daily card shows remaining forecast
precipitation through 7 AM; future days use 7 AM–7 AM local windows, including
23/25-hour daylight-saving transitions. Full-window estimates are retained in the
API. All amounts are liquid equivalent, not measured rainfall. Missing intervals
remain null, never zero. Coarse accumulation intervals are prorated at boundaries;
interpolated hourly amounts do not establish hourly storm arrival times.

NWS rain probability remains a separate percentage. Official NWS warnings are
never modified by the blend or AI. Feels-like temperature uses observed temperature,
humidity and wind with NWS heat-index/wind-chill calculations where applicable.
It is labeled as a calculation, not an observed measurement. Sunrise/sunset are
calculated astronomically without requiring a model account.

## AI and Google

The existing server-side `OPENAI_API_KEY` is reused. AI receives the calculated
blend, source-specific values, actual model run times, HRRR simulated reflectivity,
and latest local NWS discussion. It explains agreement, uncertainty and timing;
it cannot change numeric cards or issue/cancel warnings. Structured output requires
source attribution for every contributing model. A forecast signature prevents
showing prose from an older/different input snapshot. On failure or missing AI
configuration, explicitly labeled official NWS prose remains visible.

Optional settings: `WEATHER_FUSION_AI_MODEL` (default `gpt-5-mini`),
`WEATHER_FUSION_AI_DAILY_LIMIT` (default 96 per process, not a durable account-wide
spending limit; zero disables AI), and `WEATHER_FUSION_USER_AGENT` for operator contact.

**Google WeatherNext is not included.** Approved operational dataset access has not
been configured. The page says so; Gemini prose and Google's ECMWF mirror are not
substituted for genuine WeatherNext predictions.

## Working maps

Observed radar uses NOAA's advertised WMS frames. HRRR, ECMWF rain, NBM rain,
temperature, wind and clouds use actual decoded model images in Leaflet, with
forecast-time sliders, playback, units, run time and attribution. There are no
embedded Weather.us/Windy webpages or cosmetic overrides hiding failed model feeds.
The user's Weather.us links remain optional external comparison links.

The HRRR reflectivity map uses a separately verified, timestamp-pinned Iowa State
NOAA HRRR tile source across the contiguous United States. The decoded ECMWF/NBM
and temperature/wind/cloud raster products remain North Carolina regional. Display
images use nearest-cell Web Mercator resampling; forecast points use native grid cells.
ECMWF rain is cumulative from initialization; NBM rain uses the displayed native
interval. Neither is automatically the same window as the next-24-hour point card.
A map/point run mismatch is identified. Missing or stale frames show an honest error.

Dark, topographic and aerial backgrounds use USGS The National Map services rather
than a background provider's API-key-required tiles. Aerial imagery is not live
cloud imagery. ECMWF Open Data attribution is CC BY 4.0. Provider services remain
external dependencies and can have outages.

## Coverage and refresh

Direct native point collection currently covers **the two saved locations**.
Other searched U.S. locations retain NWS forecasts and clearly identify NWS-only
model coverage; a saved city's model values are never relabeled as another point.
The model-data workflow is scheduled hourly at minute 17. GitHub scheduling and
provider publication can be delayed. It uses fully published extended runs and
retains actual initialization times. HRRR/NBM runs older than 12 hours and ECMWF
runs older than 30 hours, expired data and invalid data are excluded.

Only public weather facts and selected coordinates are sent to providers/AI.
Sun-Nourie business records are not included. No credentials are committed or
returned to browsers. Model data are public in this already-public repository.
Larger deployments should use durable object storage and shared caching/rate limits.

## Validation

```sh
node --test test/weatherFusion*.test.js
npm run check
# Playwright and a browser are required for HTTP/browser integration tests:
WEATHER_BASE_URL=http://127.0.0.1:3123 node scripts/weatherFusionBrowserSmoke.js
# Production mode also verifies actual AI responses:
WEATHER_BASE_URL=https://sun-nourie-live.onrender.com WEATHER_LIVE_CHECK=true node scripts/weatherFusionBrowserSmoke.js
```

The browser check requires all three model inputs for both saved locations,
non-null feels-like/precipitation, matching local NWS offices, numerical model
contributions, actual image loads, map tabs, timeline/playback, daily dialogs,
location changes, and responsive desktop/mobile rendering. Live mode additionally
requires AI responses citing NWS, AFD, HRRR, ECMWF and NBM. Reports/screenshots are
workflow artifacts. Passing fixture tests alone does not establish live service health.

## API routes

`/api/weather-fusion/forecast?location=knightdale` (or `greenville`),
`/api/weather-fusion/briefing?location=knightdale&signature=...`,
`/api/weather-fusion/models`, `/api/weather-fusion/radar`,
`/api/weather-fusion/search?q=...`.

## Primary documentation

- https://www.weather.gov/documentation/services-web-API
- https://www.nco.ncep.noaa.gov/pmb/products/hrrr/
- https://www.nco.ncep.noaa.gov/pmb/products/blend/
- https://www.ecmwf.int/en/forecasts/datasets/open-data
- https://www.wpc.ncep.noaa.gov/html/heatindex_equationbody.html
- https://www.weather.gov/safety/cold-wind-chill-chart
- https://basemap.nationalmap.gov/arcgis/rest/services
- https://developers.google.com/weathernext/guides/access-forecast
- https://developers.openai.com/api/docs/guides/reasoning
