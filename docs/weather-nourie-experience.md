# Weather Nourie: friendly forecast and chart interface

The public brand is Weather Nourie. The `/weather-fusion/` URL stays compatible with existing bookmarks. No homepage, business tool, server launcher or package setting is changed.

The seven-day list places daytime highs on the left and overnight lows on the right. The bar starts at a common weekly temperature baseline and ends at the high. At 3 PM **in the selected location's timezone**, the first row becomes Tonight: the primary value is explicitly the overnight low, with a cool-colored bar and no invented daytime high. Night condition and rain chance are used for that row. Other rows remain high-first.

The local outlook prompts AI to paraphrase the latest local NWS Area Forecast Discussion in everyday language, checked against the local forecast and available numerical models. Technical model names/weights stay in source metadata and the bottom section. The current local date and time are supplied, source attribution is validated, and jargon triggers a retry. The fallback remains official NWS forecast wording, visibly identified as such; the application does not pretend a template is an AI paraphrase. Official alerts remain separate and unaltered.

All eight metric buttons open an accessible dialog with a forecast plot, time/value readout, keyboard/touch slider, and 24/48-hour controls (sunset covers seven days). The big temperature is clickable too. Hourly metrics use NWS grids/periods or explicitly validated model samples. Gaps stay gaps, zero remains zero, and the graph never repeats a station observation as a future prediction. Pressure uses ECMWF mean-sea-level pressure in inches Hg; it is distinct from the station pressure on the current card. Visibility uses published NWS grid values or HRRR VIS. Outside direct-model coverage these two fields can be unavailable; the dialog explains instead of fabricating a line. Sunset times are calculated astronomical times, not predicted sunshine.

`weather-math.js` is a shared, testable source for current/forecast shade feels-like calculations. NWS heat index, wind chill and Steadman/BOM shade apparent temperature are used in the applicable regimes. Missing wind is never assumed calm. Wet bulb is separately calculated using Stull's approximation within its restricted range. The sun estimate remains a **heuristic scenario**, not measured solar radiation or a validated radiation/physiology model; it has a ~ marker. The friendly panel explains in plain language; calculation details and limitations are in Scientific Stuff at the bottom. No claim of literal skin temperature, WBGT or UTCI is made.

Sources:
- https://weather-gov.github.io/api/gridpoints
- https://www.weather.gov/safety/heat-index
- https://www.weather.gov/safety/cold-wind-chill-chart
- https://www.bom.gov.au/info/thermal_stress/
- https://journals.ametsoc.org/view/journals/apme/50/11/jamc-d-11-0143.1.xml

Tests: `node --test test/weatherFusion*.test.js`, `npm run check`, and `node scripts/weatherNourieBrowserSmoke.js` (explicit fixture weather). The production workflow separately checks live data, model maps, actual AI, and metric dialogs; fixture screenshots are not proof of a successful deployment.
