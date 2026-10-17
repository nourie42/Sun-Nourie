# Weather Nourie Atmos

`/weather-fusion/atmos.html` (short link `/weather-fusion/atmos`) draws the next
48 hours as a living sky and explains the science behind every number. It sits
beside Glance, Blend, Today, Halo, WN AI and Ultimate, and like them it is behind
the weather password. The main page, its API and its QA contract are unchanged;
Atmos reads the same `/api/weather-fusion/forecast` response and the same shared
browser modules, so its numbers match the main page.

## What drives the sky

The hero is a canvas sky computed from the forecast, not a photograph
(`atmos-sky.js`):

- **Sun and moon** come from solar and lunar position at the selected point and
  time. Sun altitude uses the same formula as `weather-math.js` `solarElevation`;
  the moon phase and illuminated fraction are calculated, and the label says
  where the moon is.
- **Cloud amount** follows numeric sky cover when the hour has it, otherwise the
  NWS sky terms (sunny 0/8, mostly sunny 1–2/8, partly 3–5/8, mostly cloudy
  6–7/8, cloudy 8/8). Cumulus share a flat base; an overcast deck fills in as
  cover passes 55%.
- **Rain, snow, fog and thunder** are drawn only from the displayed condition
  (`conditionForRainChance` already promotes a dominant rain score to rain).
  Lightning appears only for thunder/storm wording, never for a plain rain
  forecast. Chance or "nearby" wording draws lighter, scattered rain.
- **Haze** thickens with dew point; **wind** sets the drift direction and speed.
- A Piedmont pine treeline closes the view (open prairie west of 96.5°W). Its
  shadow colour is the page background.

Respecting `prefers-reduced-motion`, the sky renders still frames, with no drift,
twinkle or lightning.

## The 48-hour clock

The clock is exactly `hourlyDisplaySamples(forecast, now)`: the station-based Now
card followed by every validated forecast hour the main page's hourly strip
shows. Dragging, tapping, the arrow keys or Play (a time-lapse at about 3.2 hours
per second) move one shared selected hour that every section reads. A compact
clock follows you down the page. Rain chances under 5% are never printed.

## Instruments

| Section | Source in the forecast response | Shared helper |
|---|---|---|
| Forecasts blended into one number | `metricForecasts.series.temperature[].sources` | canonical metric series |
| How it's really gonna feel | hourly sample feels/shade (UTCI with wind-chill floor) | `weather-display.js`, `thermal-risk.js` |
| Feel Meter | dew point, wet bulb | `dewpoint-meter.js`, `weather-math.js` |
| How the rain chance adds up | `hours[].rainLikelihood.sources`, `precipitation.sourceValues` | server rain score |
| Best hours to be outside | metric series + `rainTimeline` | `whats-up-classify.js` `classifyHour` |
| Next ten days | `days[]` | `seven-day.js` `dailyForecastReadings` |
| Pavement for paws | `exposureWeather` history | `pavement.js` `pavementEstimate` |
| Sun and UV | `metricForecasts.solar`, `days[].uvMax` | published sunrise/sunset |
| Air quality | `airQuality` | `air-quality.js` `aqiBand` |

Daily spreads compare each source's own high and low over the same local
calendar hours as the blended high and low; a source counts only when it covers
every one of those hours. Comfort colours centre on 72°, the perfect-hour ideal;
the warm side follows the UTCI heat-stress limits (78.8°, 89.6°, 100.4°F).

Official alerts are shown unaltered, refreshed every 30 seconds, and the page
shows the "check the official NWS warnings" notice whenever live warnings cannot
be verified. The AI line appears only for a server-validated briefing whose
signature matches the displayed forecast.

## Files

`atmos.html`, `atmos.css`, `atmos.js` (page), `atmos-model.js` (pure builders),
`atmos-sky.js` (renderer and astronomy), and the self-hosted Archivo variable
font `archivo-latin-wdth-normal.woff2` (SIL Open Font License 1.1, see
`docs/archivo-font-OFL.txt`).

## Tests

```sh
node --test test/weatherAtmos.test.js
```

The tests check routing and the password gate, the import closure, that the
clock, daily list and blend use the main page's values, the sky's
weather-wording rules, the rain-score breakdown, comfort classes, perfect-hour
windows, daily spreads, and the sun/moon calculations.
