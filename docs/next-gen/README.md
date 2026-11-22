# Weather Nourie — Next Gen

A separate, implemented Android-oriented weather interface on `feature/weather-nourie-next-gen`. Nothing in this branch has been merged to production.

## Open the app

- [Open the deployed Next Gen preview](https://weather-nourie-next-gen.onrender.com/experimental/next-gen/).
- [Preview Experimental page with its Next Gen entry](https://weather-nourie-next-gen.onrender.com/weather-fusion/experimental-weather.html).
- Next Gen route: `/experimental/next-gen/`.
- Entry point: the existing `/weather-fusion/experimental-weather.html` page **on the preview deployment** contains “Weather Nourie Next Gen”.
- The production and existing Prerelease/Aurora services are not changed. Publishing an entry link on the production hostname requires a later, explicitly approved production change.

## Architecture and accuracy

The new router assembles a separate document around the original application controller and keeps its required DOM IDs, detail dialogs, map controller and renderers. All new presentation files live in `public/experimental/next-gen/`. The original production HTML, controller, weather engine, model weights and scientific modules remain byte-for-byte unchanged. `server.js` only imports and registers the isolated router in this feature branch.

The preview starts `node scripts/serve-weather-next-gen.js`. It streams same-origin weather API requests to `https://sun-nourie-live.onrender.com`; it does not run a second weather engine, spawn the legacy server, copy API keys, or calculate replacement forecasts. Protected, separately hosted original apps retain their existing live access policies.

The adapter reuses `currentSample`, `forecastSample`, `buildTimeline`, `dailyForecastReadings`, `pavementEstimate`, `comfortArtworkContext`, `selectWeatherPortrait` and the existing confidence helpers. Daily hero ranges use the same local-calendar-day readings as the week chart and original day details. An overnight low from a different period is not silently substituted for the calendar-day low.

## Screens

- **Today:** weather-selected realistic person on the left of a continuous outdoor scene, branding over the sky and readings on the right; current or selected-hour temperature and feels-like; daily range; overlapping, expandable Weather Take; compact rain/precipitation/AQI/Feel Meter row; orange/cyan interactive 24-hour and seven-day plots; compact How It Feels, Dew Point and Wind panels; complete exposure modes and conditions below.
- **Hourly:** 24/48-hour temperature, feels-like, rain, wind, humidity and dew-point plots, exact hourly readings and a compact hour list.
- **7-Day:** high/low curves and their actual range, weather icons, rain likelihood, existing confidence labels and original daily detail dialogs.
- **Map:** existing radar, map selection, basemaps, playback and six model-layer controls.
- **Compare:** actual matching-hour model traces, source visibility toggles, field-specific coverage, source gaps and an optional min–max source range. The complete original daily/variable comparison is retained in More.
- **More:** original weather tools, all original applications, motion preference and separate app installation.

Graphs use the project’s native SVG approach. Monotone Hermite curves pass through every published point, preserve peaks and break at missing readings or time gaps. Rain chance and hourly rain amount have separately labeled axes. Touch, sliders, keyboard controls, exact-value readouts and full-screen expansion share the same data. The optional source band is the min/max of at least two available independent model values at the same timestamp; it excludes the Nourie blend and is explicitly not a confidence interval. No forecast is extrapolated to fill a missing horizon.

## Visual composition

The mobile layout follows the supplied visual reference: an outdoor scene behind the header, person on the left, large readings on the right, overlapping Weather Take, one short four-metric row, and translucent meteorological graph panels. Orange/coral temperature and high curves pair with cyan feels-like/low curves. Published samples remain exact; only rendering and axis spacing change. The full seven-day chart and compact-condition headings fit above the bottom navigation at the tested 393 × 852 viewport. The large readout, slider and legend remain in detailed graph views; compact home graphs reveal exact-value tooltips on touch/focus. Day captions and plotted daily values align in the same seven columns.

The compact How It Feels panel scrolls to the complete Shade/Sun/Night/Pets controls. The existing dew-point Feel Meter remains a dew-point assessment; the reference image’s example 82/100 is not invented as a new forecast value.

## Dynamic scene and clothing

The interface reuses the existing 90 realistic weather portraits and matching backgrounds, plus the existing `atmos-sky` renderer and `skyScene` mapping. It does not generate people on load. Conditions, same-hour clouds, wind/gusts, canonical feels-like, precipitation, location and solar time select the scene. Numeric overcast suppresses sunny photography without changing a forecast reading. The renderer uses the existing astronomy for the sun and moon. Hidden tabs stop animation; reduced-motion, Save-Data and low battery select reduced animation.

Shade, Sun, Night and Pets remain accessible. Irrelevant or missing exposure values remain unavailable. Pet surfaces use the original pavement model and winter guidance. The Feel Meter shows the existing dew-point assessment, not a fabricated 0–100 comfort score.

## Complete feature-preservation checklist

“Retained” means the existing calculation, renderer or original app route is still used. Browser smoke checks exercise the in-app tools; protected external apps are verified as preserved navigation, not as authenticated end-to-end business workflows. See [the complete machine-readable component/API/route inventory](feature-inventory.json).

| Retained feature | Next Gen entry point |
| --- | --- |
| ✓ Current conditions and accepted station/model provenance | Today hero; update/provenance footer; Science & sources |
| ✓ City, ZIP and device-location selection | Location sheet; original search results and device-location actions |
| ✓ Saved location and URL location | Separate ng-place preference; location/latitude/longitude query; location sheet |
| ✓ Refresh, source recovery and current-reading expiry | Existing controller; refresh action; pull-to-refresh; visible source status |
| ✓ Hourly weather, temperature and feels like | Today 24-hour chart; Hourly 24/48-hour graph and exact hour rows |
| ✓ Seven-day forecast and daily details | High/low graph; seven visible day selectors; compact rows; original day detail dialog |
| ✓ Nourie Weather Take, AI commentary and expanded explanation | Expandable Nourie Take; updates observed from the existing rendered commentary |
| ✓ Official alerts and local bulletin detail | Today alert notice; More → Alerts & outlooks; original official notice dialog |
| ✓ SPC, WPC and winter risk outlooks | More → Alerts & outlooks; unchanged risk detail dialog |
| ✓ Precipitation probability and amounts | Quick row; Rain graph with labeled percent/inch axes; original daily details |
| ✓ Original rain-score explanation and model points | More → Full hourly forecast; All model comparisons; Science & sources |
| ✓ Observed radar and playback | Map tab; original radar, frame slider and playback |
| ✓ HRRR, ECMWF, NBM and other existing raster maps | Map layer controls; original exact model data and provenance |
| ✓ Map location selection, basemaps and full screen | Map tab; unchanged map selection, aerial/topographic basemaps and expansion |
| ✓ Snow, sleet, freezing rain and ice outlooks | More → Snow & ice; original timing, amount, probability, model and winter-map views |
| ✓ Wind, gusts and direction | Wind graph; directional markers; hourly rows; original metric detail |
| ✓ Dew point and humidity | Dew-point/temperature graph; Humidity graph; Feel Meter and detailed view |
| ✓ Visibility | A closer look → Visibility; original graph |
| ✓ Pressure and observed trend | A closer look → Pressure; unchanged detailed graph/trend |
| ✓ Sunrise, sunset and day/night transitions | Hero/sky; graph markers and night shading; Sunset detail |
| ✓ UV, current AQI, pollutant and AQI forecasts | Quick row and condition panels; More → Air quality and original graphs |
| ✓ Shade, Sun and Night feels-like science | How It Feels exposure tabs; scientific detail; missing values stay unavailable |
| ✓ Warmest remaining direct-sun feels like | How It Feels footer; missing sky/thermal readings distinguished from no sun |
| ✓ Pet pavement, asphalt, concrete, winter and paw guidance | How It Feels → Pets; original scientific and surface detail |
| ✓ Realistic people, clothing and weather scenes | Integrated hero portrait; selected-hour exposure scene; unchanged asset selection bands |
| ✓ Live dynamic sky and moving precipitation | Full-page sky with the existing matching backgrounds; stops when hidden or reduced motion/battery saver applies |
| ✓ Feel Meter including dry-air and humid-air views | Quick row; More → Feel Meter; no fabricated 0–100 score |
| ✓ Car Wash | More → Car Wash; original decision rules, horizons and details |
| ✓ Best Times / perfect-hour windows | More → Best Times; original heat map, thresholds and hour selection |
| ✓ Model comparison for all supported variables | Compare tab with per-hour source toggles and coverage; All model comparisons for daily rain, snow, UV and AQI |
| ✓ NWS, NBM, ECMWF, HRRR, WeatherNext, WeatherNext 3, GEFS and other available models | Compare dynamically discovers available sources by field and hour; no invented values/horizons |
| ✓ Forecast confidence, temperature confidence and sky/rain agreement | Seven-day confidence labels; original per-day confidence evidence |
| ✓ NWS discussion and complete source health | More → Science & sources |
| ✓ Original Experimental navigation and linked apps | More → Original apps & experiments; feature-branch Experimental page gains the Next Gen link |
| ✓ AI Chat, benchmark rankings, Deal Lens, Deal Intelligence, Nourie Enterprises | Original-app links remain available; protected apps stay on the existing live service |
| ✓ Glance, Blend, Today, Halo, WeatherNext AI, Ultimate and Fusion V3 | More → Original apps & experiments |
| ✓ Existing main app PWA installation | Unchanged; Next Gen uses a distinct manifest id, start_url, scope, service worker and cache prefix |
| ✓ Android navigation and touch interaction | Five persistent tabs; touch/drag/slider/keyboard graph selection; full-screen dialog; Back history; swipe and pull-to-refresh |
| ✓ Offline and source-error states | Retained in-page snapshot has visible update age; fresh navigation offline shows an honest connection screen; APIs never cached |
| ✓ Atmos living sky, forecast lab, side-by-side comparison, What’s Up and the WeatherNext data explorer | More → Original apps & experiments; original live application and access policy |

## Executed validation

- `npm ci --ignore-scripts --no-audit --no-fund`: succeeded.
- `npm run check`: passed, including the existing weather QA contract.
- `node --test test/weatherNextGen.test.js`: **14 passed, 0 failed**. Includes both-city numeric parity and forecast immutability, missing sources, monotone-curve extrema, source-range math, night/overcast/snow portraits, unavailable exposures, retained controller IDs/routes and PWA separation.
- `python scripts/weatherNextGenBrowserSmoke.py`: **59 passed**, with captured real Knightdale and Greenville forecasts and a frozen clock in headless Chromium. See [executed browser proof](browser-proof.json).
- The walkthrough checks the reference composition and first-screen forecast density, compact touch tooltips and rain axes, the compact comfort entry, and touch drag, keyboard graph selection, rain axes, variable/horizon switches, daily details, Back/Forward reconstruction, full-screen charts, model toggles/range, Car Wash, Best Times, Feel Meter, AQI, alerts, science, original exposure/hourly panels, legacy daily comparison, winter outlook, map mounting/layers, all exposure modes, search, GPS selection, refresh, real forecast day/night selection, original pages, PWA scope and offline navigation.
- No horizontal overflow at 360, 393, 412, 768 and 1280 CSS pixels.
- No JavaScript page errors in that walkthrough. Closed optional tools stop redrawing; source-age and solar-state changes cannot leave a stale current person or temperature on screen.
- A real local preview-proxy request returned HTTP 200 with the live engine’s 48 hours, 10 forecast days, existing signature and AI-enabled status. This is distinct from fixture testing.

The browser checks use controlled no-radar guidance and a test basemap tile to validate missing-map handling without claiming that an observed NOAA radar image was verified. The [separate live preview verification](live-preview-verification.json) records real API checks for Knightdale and Greenville, real model charts, the actual map and verified radar timestamp, with no broken visible images or JavaScript page errors. Initial preview memory use was about 91 MiB; this is an initial sample, not a long-duration load test. No tests claim to have run on physical Samsung hardware.

## Reproduce locally

```sh
npm ci
NODE_USE_ENV_PROXY=1 PORT=3100 node scripts/serve-weather-next-gen.js
```

On a machine without an HTTP proxy, `PORT=3100 node scripts/serve-weather-next-gen.js` is sufficient. Open `http://localhost:3100/experimental/next-gen/`.

Capture the public API responses as `knightdale-live.json` and `greenville-live.json` in a chosen fixture directory. They are test-only inputs and are never served by the deployed app. With Python Playwright and Chromium available:

```sh
node --test test/weatherNextGen.test.js
python scripts/weatherNextGenBrowserSmoke.py --base http://127.0.0.1:3100 --fixture-dir /path/to/captures --artifacts /tmp/next-gen-proof
python scripts/weatherNextGenLiveSmoke.py --base https://weather-nourie-next-gen.onrender.com --artifacts /tmp/next-gen-live-proof
```

## Preview deployment

- Repository: `nourie42/Sun-Nourie`.
- Branch: `feature/weather-nourie-next-gen`.
- Build: `npm ci --ignore-scripts --no-audit --no-fund`.
- Start: `node scripts/serve-weather-next-gen.js`.
- Health: `/health`.
- Separate Render web service in the existing Ohio workspace/region; smallest free compute plan. No production service settings are changed.

## Remaining limits

- At the initial live verification, the optional upstream NAM winter feed was unavailable for both saved locations. The existing source-status view reports this; other available forecasts remain displayed.

- This is a web/PWA implementation; physical Samsung gestures and the OS installation/splash flow still need a real-device acceptance pass.
- API availability, optional weather feeds and third-party map availability remain those of the existing services; missing data is displayed honestly.
- Offline fresh navigation shows a connection screen. Forecasts and warnings are deliberately never stored by the new service worker.
- Original protected business/benchmark applications keep their existing sign-in requirements.
- The preview’s free Render service can spin down when idle. Production is not moved to that service.
- The new Experimental entry link is published on the feature-branch preview only; no production merge or automatic merge is enabled.
