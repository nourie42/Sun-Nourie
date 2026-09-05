# Weather Nourie: friendly forecast and chart interface

The public brand is Weather Nourie. The `/weather-fusion/` URL stays compatible with existing bookmarks. No homepage, business tool, server launcher or package setting is changed.

The seven-day list places daytime highs on the left and overnight lows on the right. The bar starts at a common weekly temperature baseline and ends at the high. At 3 PM **in the selected location's timezone**, the first row becomes Tonight: the primary value is explicitly the overnight low, with a cool-colored bar and no invented daytime high. Night condition and rain chance are used for that row. Other rows remain high-first.

The local outlook prompts AI to paraphrase the latest local NWS Area Forecast Discussion in everyday language, checked against the local forecast and available numerical models. Technical model names/weights stay in source metadata and the bottom section. The current local date and time are supplied, source attribution is validated, and jargon triggers a retry. The fallback remains official NWS forecast wording, visibly identified as such; the application does not pretend a template is an AI paraphrase. Official alerts remain separate and unaltered.

All eight metric buttons open an accessible dialog with a forecast plot, time/value readout, keyboard/touch slider, and 24/48-hour controls (sunset covers seven days). The big temperature is clickable too. Hourly metrics use NWS grids/periods or explicitly validated model samples. Gaps stay gaps, zero remains zero, and the graph never repeats a station observation as a future prediction. Pressure uses ECMWF mean-sea-level pressure in inches Hg; it is distinct from the station pressure on the current card. Visibility uses published NWS grid values or HRRR VIS. Outside direct-model coverage these two fields can be unavailable; the dialog explains instead of fabricating a line. Sunset times are calculated astronomical times, not predicted sunshine.

`weather-math.js` is a shared, testable source for the headline “How’s it really gonna feel?” calculation. It now uses **one Steadman apparent-temperature model in cold, mild and hot weather** rather than switching between NWS heat-index and wind-chill formulas. Air temperature, wind speed and water-vapor pressure remain in the same equation at every temperature. Dew point is preferred for vapor pressure, so drier air naturally lowers the estimate while muggy air raises it. Missing wind is never assumed calm.

The shade equation is `AT = Ta + 0.33e - 0.70v - 4.00` in °C. The direct-sun scenario uses Steadman's radiation-inclusive form, `AT = Ta + 0.348e - 0.70v + 0.70Q/(v+10) - 4.25`. Because the site does not have a person-level radiometer, `Q` is an explicitly estimated net absorbed-radiation input based on solar elevation and sky condition and is bounded to the published Steadman range. Wet bulb is separately calculated using Stull's approximation when its published range is satisfied; it is diagnostic context and is not added to apparent temperature because that would double-count moisture.

Urban microclimate is not represented by a fixed “city bonus.” The nearby observation can capture some broad local air-temperature influence, but pavement, building shade, reflected radiation and street-canyon wind require block-level radiation/surface/wind information. Weather Nourie leaves those effects as an explicit limitation rather than inventing a correction. No claim of literal skin temperature, WBGT or UTCI is made.

Sources:
- https://weather-gov.github.io/api/gridpoints
- https://media.bom.gov.au/social/blog/1153/apparent-/
- https://doi.org/10.1071/ES94001
- https://journals.ametsoc.org/view/journals/apme/50/11/jamc-d-11-0143.1.xml
- https://utci.org/

Tests: `node --test test/weatherFusion*.test.js`, `npm run check`, and `node scripts/weatherNourieBrowserSmoke.js` (explicit fixture weather). The production workflow separately checks live data, model maps, actual AI, and metric dialogs; fixture screenshots are not proof of a successful deployment.
