# Weather Fusion — additive installation

Weather Fusion is a separate Apple Weather-inspired section at `/weather-fusion/`.
The existing homepage, navigation, research tools, server files, package files and
configuration files are not edited by this addition. Nothing is injected into the
existing pages. The included `nav.js` is dormant: no existing page loads it.

## Activate without editing the existing website

Keep the existing build command and dependencies. In the hosting service's start
command setting, select:

```sh
node server-with-weather.js
```

This is an optional new launcher. It starts the original, unmodified `server.js`
on an internal port, adds only `/weather-fusion` and `/api/weather-fusion` paths,
and streams other requests to the original site. Existing HTML, uploads, cookies,
redirects, authorization headers and responses are not rewritten. Existing HTTP
upgrades are tunneled. The existing `/health` remains the original site's health
check. No new navigation button is installed; open `/weather-fusion/` directly.

**A Git commit alone does not change a hosting provider's start command.** The
original `npm start` still runs the original site without the Weather Fusion API.
Do not describe the add-on as live until the new launcher is selected and deployed.
To roll back activation, restore the original `npm start` command and redeploy;
no original source files need to be restored.

`PORT` remains the public port. Optional `WEATHER_FUSION_SITE_PORT` and `LEGACY_PORT`
control distinct internal ports. Defaults with public port 3000 are 3001 and 3002.
An explicitly configured legacy port is reserved before selecting a site port.
The launcher rejects collisions and invalid port values. Keep internal ports
private in the hosting/firewall configuration.

## Environment configuration

- `OPENAI_API_KEY`: server-side AI key. Without it, the page displays official NWS
  prose and explicitly says AI is not configured. No secret is committed.
- `OPEN_METEO_API_KEY`: customer API access for HRRR, ECMWF IFS and NBM. For an
  actually eligible noncommercial installation, the alternative is
  `WEATHER_FUSION_NONCOMMERCIAL=true`. Do not use that setting to bypass licensing.
  Without either setting, model feeds show Setup required and NWS remains usable.
- `WEATHER_FUSION_USER_AGENT`: application identification with a real operator contact.
- `WEATHER_FUSION_AI_MODEL`: structured-output Responses API model; default gpt-5-mini.
- `WEATHER_FUSION_AI_DAILY_LIMIT`: per-process request cap, default 96; zero disables
  billable AI calls. It resets on restart and is not a durable account-wide budget.

Use provider-side usage controls and shared rate limits/caching for a multi-replica
public deployment. The feature is not a new authentication system; preserve or add
hosting-level access restrictions as appropriate. Public maps/geocoding require
external connectivity and terms appropriate for the deployment.

## Features and forecast boundaries

Fahrenheit, mph and inches; Knightdale/Raleigh and Greenville **North Carolina**;
U.S. city/ZIP search; optional device location; observed conditions; hourly and
seven-day outlooks; expandable source comparisons; local NWS Area Forecast
Discussion; official alerts; professional AI explanations; source health; and
selectable radar, precipitation, temperature, wind and cloud maps.

NWS point forecasts anchor the numeric forecast and determine the correct office.
HRRR, ECMWF IFS and NBM are explicitly selected rather than provider Best Match.
This initial release is not a statistically calibrated local superensemble and
makes no claim to be the most accurate forecast. The HRRR 60% / ECMWF 40% rain
comparison is labeled uncalibrated. Model disagreement is not an accuracy probability.

Precipitation probability stays separate from liquid-equivalent precipitation
amount. Rain windows are local 7 AM–7 AM, including 23/25-hour daylight-saving
days. Incomplete model windows are unavailable, not zero. NWS interval totals
are prorated at boundaries with that assumption disclosed. Full-window amounts
are forecast guidance, not measured accumulation. Temperature comparison periods
and NWS overnight lows are identified separately.

AI receives public weather facts and local discussion, not the site's research
records. It cannot change numeric cards or official alerts. Structured output,
source checks and a full-input signature prevent displaying a briefing for a
different snapshot. Numeric AI prose is rejected; failures use explicitly labeled
NWS prose. These safeguards do not prove every qualitative AI sentence correct.

NOAA radar timestamps come from advertised WMS frames. Stale/missing radar is
labeled and blank tiles are not represented as clear weather. Windy model maps
are separate displays, not the point blend or necessarily the same model cycle.
Satellite basemap imagery is not live cloud imagery. Coverage is the contiguous
United States. No lightning feed, push-warning service or calibrated nowcast is claimed.

## API

- GET `/api/weather-fusion/forecast?location=knightdale`
- GET `/api/weather-fusion/forecast?location=greenville`
- GET `/api/weather-fusion/briefing?location=knightdale&signature=<forecast signature>`
- GET `/api/weather-fusion/search?q=<city or ZIP>`
- GET `/api/weather-fusion/radar`

Validated latitude/longitude may replace a preset. Cached fetches are bounded,
HTTPS hosts allowlisted, timeouts/size limits applied, and credentials withheld
from browser responses. Refresh is on-demand and while the page is open.

## Validation

```sh
node --check server-with-weather.js
node --check src/weatherFusionGateway.js
node --check src/weatherFusion.js
node --check public/weather-fusion/app.js
node --test test/weatherFusion.test.js test/weatherFusionGateway.test.js
npm run check
```

The first release passed 21 forecast unit tests plus 9 real-HTTP gateway tests
locally. Gateway tests verify namespace isolation, unchanged home HTML, binary
POST bodies, original request headers, multiple cookies, redirects, streaming,
upgrades and upstream failure handling. These use a fixture upstream, not the
entire production site. The additive GitHub workflow also runs existing repository
checks. A configured workflow is not evidence of a successful CI run: inspect its result.

Earlier desktop/mobile screenshots use fixture weather, not live forecast data.
Live weather-provider calls, production AI credentials and real map tiles remain
separate deployment checks. After activation verify `/health`, existing research
and export flows, both weather presets, local discussion issuance, AI output,
real radar tiles and map tabs. A successful commit does not establish deployment.

## Reference documentation

- https://www.weather.gov/documentation/services-web-API
- https://weather-gov.github.io/api/general-faqs
- https://open-meteo.com/en/docs/gfs-api
- https://open-meteo.com/en/docs/ecmwf-api
- https://open-meteo.com/en/docs/model-updates
- https://open-meteo.com/en/pricing
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://leafletjs.com/download.html
- https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows
- https://radar.weather.gov/
- https://embed.windy.com/config/map
