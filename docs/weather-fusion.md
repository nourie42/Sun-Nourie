# Weather Fusion — additive installation

Weather Fusion is a separate Apple Weather-inspired section mounted inside the existing Sun-Nourie application at `/weather-fusion/`.

## How it is activated

No replacement launcher and no hosting start-command change are required.
The existing command remains:

```sh
npm start
```

`server.js` keeps all existing behavior and adds only two Weather Fusion hooks: one import and one route registration. Existing homepage, navigation, research tools, Fuel Atlas, Distributor Intelligence, Site Analyzer, legacy proxying, health checks, uploads, exports, redirects, cookies, and package scripts remain unchanged.

No Weather Fusion navigation button is injected into the existing homepage. Open the add-on directly at `/weather-fusion/`.

The older `server-with-weather.js` and gateway files are retained only as unused development artifacts and are not required for production. Production uses the normal existing server.

## Environment configuration

- `OPENAI_API_KEY`: server-side AI key. Without it, Weather Fusion falls back to official NWS prose and clearly says AI is not configured.
- `OPEN_METEO_API_KEY`: customer API access for HRRR, ECMWF IFS and NBM. For an actually eligible noncommercial installation, the alternative is `WEATHER_FUSION_NONCOMMERCIAL=true`.
- `WEATHER_FUSION_USER_AGENT`: application identification with an operator contact.
- `WEATHER_FUSION_AI_MODEL`: structured-output Responses API model; default `gpt-5-mini`.
- `WEATHER_FUSION_AI_DAILY_LIMIT`: per-process request cap; default 96. Set to 0 to disable billable AI calls.

## Features

- Apple Weather-inspired responsive interface
- Fahrenheit, mph and inches
- Knightdale/Raleigh and Greenville, North Carolina presets
- U.S. city/ZIP search and optional browser location
- NWS point forecasts and local Area Forecast Discussion
- HRRR, ECMWF IFS and National Blend of Models guidance
- Seven-day and hourly outlooks
- Professional AI synthesis of supplied weather facts
- Official NWS alerts kept separate from AI interpretation
- Selectable radar, precipitation, temperature, wind and cloud maps
- Source-health and model-disagreement displays

## Forecast boundaries

NWS remains the numeric anchor. HRRR, ECMWF IFS and NBM are explicitly selected model sources rather than an undocumented provider “best match.” The HRRR 60% / ECMWF 40% rainfall comparison is labeled as uncalibrated guidance rather than a proven accuracy claim.

Precipitation probability is kept separate from rainfall amount. Practical rain windows use local 7 AM–7 AM periods, including daylight-saving 23/25-hour days. Missing model hours remain unavailable rather than being converted to zero.

AI receives public weather facts and the local NWS discussion. It cannot rewrite official alerts or numeric forecast cards. Input signatures prevent displaying an AI briefing generated for a different forecast snapshot.

## API

- GET `/api/weather-fusion/forecast?location=knightdale`
- GET `/api/weather-fusion/forecast?location=greenville`
- GET `/api/weather-fusion/briefing?location=knightdale&signature=<forecast signature>`
- GET `/api/weather-fusion/search?q=<city or ZIP>`
- GET `/api/weather-fusion/radar`

## Validation

```sh
node --check server.js
node --check src/weatherFusion.js
node --check public/weather-fusion/app.js
node --test test/weatherFusion.test.js
npm run check
```

The Weather Fusion forecast-engine tests passed locally before commit. The final production integration changes `server.js` by only two additive lines: importing `registerWeatherFusionRoutes` and calling it before the existing application routes fall through to the legacy proxy.

After each production deployment, verify `/health`, the existing research/export flows, `/weather-fusion/`, both preset locations, local NWS discussion retrieval, AI output when configured, radar tiles, and map tabs.
