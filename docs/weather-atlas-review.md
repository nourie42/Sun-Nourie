# Phone prerelease review

This draft contains the separate Atlas view plus a phone-only copy of the main Weather Nourie page. Nothing has been deployed. The public main page and original forecast/UI modules remain unchanged by default.

## Prerelease presentation

- `/weather-fusion/prerelease.html` is an isolated copy retaining the main forecast, seven maps, hourly/daily cards, alerts and comparisons. It uses the existing secondary-page password flow.
- A single-column canvas stays at most 480 px wide at every screen size. Navigation, search, refresh, meter and winter controls are touch-sized; the illustrations stack vertically.
- The Feel Meter retains the original layout and dew-point values, adds Humid/Dry modes and dry-air humor, supports hourly selection, and preserves unknown values.
- Winter illustrations use heavy coats for the coldest available remaining local-day feels-like forecast. Positive future snowfall guidance adds snow-play scenes, with a visible forecast qualification. Current numeric readings do not change. Paw guidance is qualitative; it never claims a computed paw temperature.
- The Snow tab is always available. A matching glass detail tile appears only with a current winter signal. Missing or stale guidance is explicitly unavailable, never a no-snow result.

## Separate winter guidance

The main weather blend is unchanged. Only the prerelease app requests `prereleaseWinter=1`, enabling four additional explicitly named model adapters: HRRR CONUS, NAM CONUS nest, ECMWF IFS025 and GFS013. The API returns each source's valid coverage and seven aligned 24-hour comparison windows. Incomplete windows have no numeric total. Provider hourly values may be interpolated from coarser native timesteps.

Requested weights are retained exactly: within 24 hours, WPC 60%, HRRR 25%, NAM 15%; beyond 24 hours, WPC 60%, ECMWF 20%, WeatherNext 10%, GFS 10%. No missing weight is redistributed, no model occupies another model's slot, and no deterministic amount becomes a probability. The available WPC threshold product and WeatherNext total-precipitation feed do not provide compatible inputs for the requested numeric winter blend. Weighted snowfall and snow/freezing-rain/sleet chances therefore remain unavailable. Individual real model amounts and official maps remain useful and visible independently.

The model metadata endpoint identifies the separately checked latest feed run, not the run of every returned point value. The UI labels this distinction. Sources are rejected when too old, geographically incompatible, invalid, incomplete or within a new-update propagation window.

## Real maps, lazy-loaded

- NWS NDFD 6-hour snowfall amount, in inches, with an explicit future valid-time selector. Each map is one 6-hour period, not an entire storm total. The historical service default is ignored. The service does not provide an issuance time, so the UI does not invent one.
- WPC 72-hour expected precipitation, liquid equivalent, including melted snow/ice. It is not snowfall depth.
- WPC day-one probability categories for at least 4 inches of snow. Categories are ranges, not precise chances of any snow.

Current metadata is checked before rendering; load failures are unavailable, not clear weather. Maps only load when clicked.

## Staging routing, publication still held

The verified separate prerelease site is `https://sun-nourie-prerelease.onrender.com/weather-fusion/`. After review and deployment approval, the staging service alone can set `WEATHER_FUSION_PRESENTATION=prerelease` to serve this copy at its normal weather root. No Render workspace, environment setting, main merge, prerelease merge or deployment is performed by this draft. No security or access-policy file is changed. Main's default route continues to serve the original page.

The PR is based on main `7a43fbee911b2b086f5ff92b78c92308a8d550e9`. Concurrent upstream changes require review before any eventual merge. They have not been overwritten or adopted into this isolated design.

## Verification

- Syntax checks and 69 focused data/UI/access tests pass locally.
- Dedicated browser workflow checks the exact draft head using synthetic forecast fixtures, controlled map images, widths 320/360/390/430 and a wide viewport retaining the phone canvas, full interactions, missing/stale data and location changes. Screenshots explicitly say TEST DATA. Check the exact workflow's terminal result; a checked-in test script is not a browser pass.
- Live read-only provider checks on October 14, 2026 confirmed all four model feeds at Boston; positive snowfall at Mount Washington; unsupported HRRR/NAM coverage in London; and actual NOAA map service metadata/images. These are separate from fixture UI QA and are not proof of a deployed integration.
- Full-suite baseline at the original main commit had 13 failures. The initial prerelease aggregate matched those 13 failures; `npm run check` retained the original fog-versus-umbrella contract failure. Later focused additions all pass. Do not describe overall legacy CI as green.

To review locally: `npm ci`, `npm run dev`, then open `/weather-fusion/prerelease.html` using the existing password flow. The new page is not linked from or substituted for the live main page.
