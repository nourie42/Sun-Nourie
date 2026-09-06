# Weather Nourie — same-day forecast and map repair

This change is limited to the weather add-on and its collector/tests. No existing
Fuel IQ, distributor, site-research, authentication or main-site route is changed.

## Forecast provenance

Same-day temperature, dew point and wind start at NWS 40%, HRRR 40%, ECMWF 20%.
Rain amount is blended in individual time segments before totals are summed, so
an hourly HRRR run is not discarded merely because its horizon is shorter than
the full rain-total window. A missing source is excluded, weights renormalize,
and effective contributions are returned; it never secretly becomes zero. NBM
continues to be available for extended guidance and fallback, not as a fourth
input to the requested same-day policy. Deterministic rainfall inches are not
converted into probability; NWS rain probabilities and warnings remain official.
These are user-selected weights, not a verified accuracy ranking.

Only the future evening beginning on a forecast date supplies that day's overnight
low. A pre-dawn NWS period with the same date is not mistakenly selected as tonight.
At 5 AM local time the comfort card shifts to today. Before 5 AM it uses pre-dawn
wording. At 3 PM both the main display and comfort outlook shift to tonight.

## Near-term thermal continuity

Current apparent temperature uses the station's temperature, dew point and wind.
Forecast thermal inputs use consistent blends rather than independently selecting
humidity and wind from unrelated sources. Where a station is within 50 km, its
observation is at most 90 minutes old, and a forecast near its observation time is
available, a bounded residual aligns the thermal estimate for the first hours.
Temperature/dew-point residuals are capped at 6 F, wind at 8 mph, and they decay to
zero after three hours FROM THE OBSERVATION TIME, never from a page refresh. Dew
point is bounded by air temperature and RH recomputed. Raw numerical forecasts,
inputs and applied corrections are retained in the API. Current station temperature
is not overwritten, and the daily numeric blend is not retrospectively changed.

This is an uncalibrated short-lead adjustment, not proof of improved forecast skill.
Station-to-point differences may include real local effects. All future feels-like
values are estimates (~), not actual skin temperatures or a guarantee. Steadman's
same equation family remains in place; no NWS heat-index/wind-chill switch is added.

## Gross Meter

The timestamp axis is unique by epoch. UTC and local-offset representations of the
same hour are one point, eliminating the false sawtooth line. Missing hours break
the line. Future points are labeled forecast, never NOW. The current station dew
point stays centered above the chart. Views: 24h, 48h (default), 7d, 10d. Long views
scroll horizontally; SVG labels retain at least 12 CSS pixels and chart height is
300px. The vertical scale fits available dew points. Real forecast coverage is
reported; ten-day controls do not invent missing extended data.

## Model images and refresh

The player owns ALL overlays, with at most one visible image and one transparent
pending image. A later seek cancels the pending request; a successful load removes
all previous owned images before becoming visible. Switching products or locations
clears the player. Loading does not advance playback. Errors clear both old/new
images rather than retaining an old frame under a new timestamp. The collector
keeps the two latest run-image families so a cached catalog can finish loading.

The existing :12/:42 collection schedule and 60-second open-page refresh remain.
A changed model initialization changes the source signature and requests a new AI
briefing subject to existing API/usage limits. This is polling, not a guaranteed
zero-delay push trigger; GitHub schedule or upstream publication delays still apply.

## Primary references

- NOAA HRRR hourly update and 48-hour six-hourly extension: https://rapidrefresh.noaa.gov/hrrr/
- NWS probability definitions: https://www.weather.gov/ppg/forecast_terms
- BOM apparent-temperature framework: https://www.bom.gov.au/info/thermal_stress/
- Leaflet image-overlay lifecycle: https://leafletjs.com/reference.html#imageoverlay
- GitHub schedule limitations: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
