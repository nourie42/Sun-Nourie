# Weather Nourie Atmos

`/weather-fusion/atmos.html` draws the next 48 hours over the same sky
photographs as the main page, explains the science behind the numbers in plain
language, and lets visitors make their own forecast by choosing how much each
forecast counts. Like the other alternate views it is behind the weather
password.

Atmos adds only its own files. The main page, the weather server, its routes,
its API and its QA contract are unchanged. The existing static server publishes
`public/`, and the weather gate already protects every `/weather-fusion/` page,
so no route was added. Atmos reads the same `/api/weather-fusion/forecast`
response and the same shared browser modules as the main page, so its numbers
match the main page.

## Look and layout

Atmos uses the main page's own stylesheets (`style.css`, `forecast-layout.css`,
`weather-polish.css`, `page-unify.css`, `header-sky.css`) and the same header
band, location bar, eight-pill section bar and uniform glass tiles. Its own
rules (`atmos.css`) add only the Atmos components, in a dark palette, so the page
is neither the bright white of the earlier design nor a second dark theme. The
Play button is a plain glass control, not a colored one.

The body background and header band follow the sky shown: night, rain, sunset or
day, as the main page does with its condition.

## The page

- **Sky and clock.** A window over the sky for the selected hour, with the
  current reading above it. Play runs the next 48 hours as a time-lapse (about
  3.2 hours per second); dragging the timeline, tapping a chart or the arrow keys
  pick one hour that every section follows. A compact clock follows you down the
  page.
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

The sky is the main page's sky photographs, lit and weathered by the forecast
(`atmos-sky.js`). The photographs are `today-sky-clear`, `-clouds`, `-rain`,
`-storm` and `-night-v2`, the same files behind the main page's Today card. They
replace the earlier computed cumulus sprites and painted landscape, so the trees
along the bottom edge are the photographed trees, green in every season.

- **Which photograph shows.** Sky cover blends the clear and cloudy photographs.
  Rain takes over the rain photograph once the displayed condition is rainy, and
  thunder or storm wording takes over the storm photograph. After dark the night
  photograph fades in as the sun goes below the horizon.
- **Navy veil.** A translucent navy layer over the photographs keeps the sky in
  the page's dark glass tone, deepening with night, cloud, rain and storm.
- **Sun and moon** are not painted over the photographs, which already carry the
  light, so there is no second sun and no moon crossing the sky. The line beside
  the picture gives the sun's height and direction, or the moon's phase, lit
  fraction and position, from the same solar and lunar formulas. Sun altitude uses
  the same formula as `weather-math.js` `solarElevation`.
- **Rain, snow, fog and thunder** are drawn only from the displayed condition.
  Lightning appears only for thunder or storm wording, never for a plain rain
  forecast. Chance or "nearby" wording draws lighter, scattered rain. Fog lies on
  the ground and thins toward the top of the sky.
- **Haze** thickens with dew point. **Wind** sets the direction and a slow drift
  of the picture, and the rain and snow lean with it.
- **Low sun** warms the lower sky and the trees.

With `prefers-reduced-motion`, the sky renders still frames, with no drift,
falling rain or lightning.

## What to wear

Under the sky sit the main page's illustrated people: one in the shade, one
outdoors and one walking a dog. Each is one panel of the same comfort artwork the
main page uses. The clothes come from the hour's feels-like temperature and the
sky, chosen the same way the main page chooses them (`exposure-scene.js`, through
`dressedPeople` in `atmos-model.js`). They follow the selected hour, so the
clothes change as the time-lapse plays.

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
| Sun and UV | `metricForecasts.solar`, `days[].uvMax` | published sunrise and sunset, `daily-uv.js` |
| Air quality | `airQuality` | `air-quality.js` `aqiBand` |

Comfort colors center on 72°, the perfect-hour ideal; the warm side follows the
UTCI heat-stress limits (78.8°, 89.6°, 100.4°F). The colors are tokens on `:root`
in `atmos.css` (comfort `--c3` to `--w3`, sources `--src-*`, air quality
`--aqi-*`), tuned for the dark glass and for separation under protan, deutan and
tritan color vision.

Official alerts are shown unaltered, refreshed every 30 seconds, and the page
shows the "check the official NWS warnings" notice whenever live warnings cannot
be verified.

## Files

- `atmos.html` — the page markup, built on the main page's header, location bar,
  jump bar and glass tiles.
- `atmos.css` — the Atmos components (sky window, Play control, timeline strip,
  heat grid, charts, lab, day rows, street blocks, place dialog).
- `atmos.js` — the page: loading, the clock, the sections and the lab.
- `atmos-model.js` — pure builders for the timeline, the scene, the blend, the
  comfort grid, the lab and the illustrated people.
- `atmos-sky.js` — the sky renderer (photographs, veil, haze, weather) and the
  solar and lunar astronomy behind the words beside the sky.
- Shared with the main page: `style.css`, `forecast-layout.css`,
  `weather-polish.css`, `page-unify.css`, `header-sky.css`, `header-sky.js`, and
  the `today-sky-*.webp` photographs.

Atmos no longer uses its own font. The earlier Archivo face and its license file
were removed with the light design, since the page now uses the main page's
system type stack.

## Tests

```sh
node --test test/weatherAtmos.test.js
```

The tests check that Atmos needs no server change and stays behind the password,
the import closure, that Atmos links the main page's stylesheets and sky
photographs, that the clock, daily list and blend use the main page's values, the
sky's weather-wording rules, the rain-score breakdown, comfort classes,
perfect-hour windows, daily spreads, the sun and moon calculations, and the
forecast lab: that Normal reproduces Weather Nourie exactly, that the
re-weighting matches the server's arithmetic, that Off and 4× re-weight only
published values, and that the rain score keeps its rules.
