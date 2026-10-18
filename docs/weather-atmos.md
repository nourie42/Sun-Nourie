# Weather Nourie Atmos

`/weather-fusion/atmos.html` draws the next 48 hours as a living sky, explains
the science behind the numbers in plain language, and lets visitors make their
own forecast by choosing how much each forecast counts. Like the other alternate
views it is behind the weather password.

Atmos is self-contained. It adds only its own files; the main page, the weather
server, its routes, its API and its QA contract are unchanged. The existing
static server publishes `public/`, and the weather gate already protects every
`/weather-fusion/` page, so no route was added. Atmos reads the same
`/api/weather-fusion/forecast` response and the same shared browser modules as
the main page, so its numbers match the main page.

## The page

- **Sky and clock.** A canvas sky over a field of trees, with the current
  reading on a white card below it. Play runs the next 48 hours as a time-lapse
  (about 3.2 hours per second); dragging the timeline, tapping a chart or the
  arrow keys pick one hour that every section follows. A compact clock follows
  you down the page.
- **Best times to be outside.** Seven days by 24 hours, colored by feels-like,
  with perfect hours in gold.
- **Next 10 days.** Low-to-high bars with whiskers for how far the separate
  forecasts reach.
- **Make your own forecast.** The forecast lab, described below.
- **Several forecasts, one temperature.** Each source's hourly temperature and
  the blend.
- **Where the rain chance comes from.** Stacked rain-score points by source.
- **How it really feels.** Air, shade and outdoor feels-like, and the dew point.
- **Out on the street.** Pavement for paws, sun and UV, air quality.

Each section opens with a plain explanation; the exact rules sit in a
"the science" disclosure underneath.

## What drives the sky

The sky is computed from the forecast, not a photograph (`atmos-sky.js`):

- **Sun and moon** come from solar and lunar position at the selected point and
  time. Sun altitude uses the same formula as `weather-math.js` `solarElevation`;
  the moon phase and illuminated fraction are calculated.
- **Cloud amount** follows numeric sky cover when the hour has it, otherwise the
  NWS sky terms (sunny 0/8, mostly sunny 1–2/8, partly 3–5/8, mostly cloudy
  6–7/8, cloudy 8/8). Cumulus share a flat base; an overcast deck fills in as
  cover passes 55%.
- **Rain, snow, fog and thunder** are drawn only from the displayed condition.
  Lightning appears only for thunder or storm wording, never for a plain rain
  forecast. Chance or "nearby" wording draws lighter, scattered rain. Fog lies
  on the ground and thins toward the top of the sky.
- **Haze** thickens with dew point; **wind** sets the drift direction and speed.
- **The landscape** is hazy hills, a distant forest edge, and groves of
  broadleaf trees and pines on a grass field (open prairie west of 96.5°W). Leaf
  color follows the month: fresh green in spring, deep green in summer, fall
  color in October and November, bare branches in winter; pines stay green. The
  landscape is lit for the time of day, warmer at sunrise and sunset, grayer
  under heavy cloud, blue at night, and dusted white in snow.

With `prefers-reduced-motion`, the sky renders still frames, with no drift,
twinkle or lightning.

## Make your own forecast

The lab never invents a forecast value. Each hour it re-weights the source
values the server already published for that hour (`atmos-model.js`
`customForecast`):

- A slider multiplies a source's Weather Nourie share: Off, ¼×, ½×, ¾×, Normal,
  1½×, 2×, 3× or 4×. The shares are rescaled to 100% over the sources that cover
  that hour, as the server does when a source is missing.
- **Temperature** uses the temperature recipe every day. **Rain chance** keeps
  the server's point rules: the NWS chance fills its share in proportion, a model
  adds its whole share for corroborated rain of at least 0.01 inch and a third
  for a trace. After today the server's long-range rain recipe applies, and the
  sliders tilt it the same way. Past the end of the NWS hourly forecast its share
  adds no points, as on the main page. When the server fell back to the NWS chance
  because a model was missing, the models that are present split the score, so
  missing data never reads as dry. **Rain totals** re-weight each source's own
  hourly rainfall.
- Days use the main page's calendar windows: high and low are the warmest and
  coolest hours, the rain chance is the highest hour, and a day needs every hour
  covered. Hours no kept forecast reaches are left blank.
- With every slider at Normal the lab shows the canonical values themselves.
  The tests check that this equals the main page's daily readings and that the
  re-weighting reproduces the server's temperature blend, rain score and
  rainfall arithmetic.

The recipe affects only the lab. It is saved in the visitor's browser
(`atmos-recipe`).

## Data sources by section

| Section | Source in the forecast response | Shared helper |
|---|---|---|
| Sky and clock | hourly display samples, `hours[]` | `weather-display.js` `hourlyDisplaySamples` |
| Best times to be outside | metric series and `rainTimeline` | `whats-up-classify.js` `classifyHour` |
| Next 10 days | `days[]` | `seven-day.js` `dailyForecastReadings` |
| Make your own forecast | `metricForecasts.series.temperature[].sources`, `rainTimeline[].rainLikelihood`, `rainTimeline[].precipitationBlend`, `blendPolicy` | `calendar-day.js` windows |
| Several forecasts, one temperature | `metricForecasts.series.temperature[].sources` | canonical metric series |
| Where the rain chance comes from | `hours[].rainLikelihood.sources`, `precipitation.sourceValues` | server rain score |
| How it really feels | hourly feels and shade, dew point, wet bulb | `thermal-risk.js`, `dewpoint-meter.js` |
| Pavement for paws | `exposureWeather` history | `pavement.js` `pavementEstimate` |
| Sun and UV | `metricForecasts.solar`, `days[].uvMax` | published sunrise and sunset |
| Air quality | `airQuality` | `air-quality.js` `aqiBand` |

Comfort colors center on 72°, the perfect-hour ideal; the warm side follows the
UTCI heat-stress limits (78.8°, 89.6°, 100.4°F). Source colors were checked for
contrast on white and for separation under protan, deutan and tritan color
vision.

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

The tests check that Atmos needs no server change and stays behind the
password, the import closure, that the clock, daily list and blend use the main
page's values, the sky's weather-wording rules, the rain-score breakdown,
comfort classes, perfect-hour windows, daily spreads, the sun and moon
calculations, and the forecast lab: that Normal reproduces Weather Nourie
exactly, that the re-weighting matches the server's arithmetic, that Off and
4× re-weight only published values, and that the rain score keeps its rules.
