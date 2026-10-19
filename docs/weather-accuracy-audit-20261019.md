# Weather accuracy audit — October 19, 2026

Reviewed source: `nourie42/Sun-Nourie`, commit `52475da5dca594574ab81e80320a317b6655c854`.
Discovered production address: https://sun-nourie-live.onrender.com/weather-fusion/.

## Confirmed problems and repairs

| Finding | Evidence | Repair |
| --- | --- | --- |
| Conflicting sun feels-like values | Perfect Weather added the outdoor/shade radiant difference to **air temperature**. Other cards used modeled outdoor thermal comfort. A 64°F air / 42°F dew point / 11 mph / clear-sky case produced about 72.9°F on the alternate scale and about 60°F on the canonical scale. | Recommendations and their detail rows now consume the same timestamp-matched outdoor value as the hourly forecast and selected-hour figure. |
| Current and daily numbers looked interchangeable | The daily/remainder card said only “Feels like.” The sunny-peak card excluded past hours while its label implied the whole day. | Daily summary identifies its forecast peak, local time and partial coverage. The sunny-peak label explicitly says “from now.” Partial-hour tables retain their original forecast hour rather than disguising it as a new observation at the current minute. |
| Missing readings could be substituted | A missing shade value could silently borrow the outdoor feels-like value. Current-source fallback could use the first future forecast hour. | Missing shade stays unavailable. Current-source selection requires a matching current hour; missing current temperature remains unavailable. |
| Source validation and aging were incomplete | A station without a verified distance bypassed validation; a rejected observation's apparent temperature could leak into guidance. An open tab could retain expired current readings. | Validate station distance, time and local agreement; keep rejected apparent values out of local guidance; expire current readings by source clock and rerender stale current displays. |
| Radar and thermal clocks could be confused | Radar refreshes independently of the weather snapshot. | Preserve fresh radar precipitation when thermal readings expire; expire radar by its own observation time. Forecast precipitation remains labeled as forecast. |
| Surface-temperature labels and freshness were misleading | The primary pet number did not name concrete. Reassembling recovered surface data could reset apparent freshness. | Label concrete and asphalt separately, identify estimated surface temperatures and retain original surface-feed fetch time. |
| AQI / UV could refer to the wrong hour | Some alternate pages borrowed current AQI while scrubbing future hours or selected an arbitrary earlier UV reading. Invalid AQI times could break daily aggregation. | Use current-source freshness and exact selected-hour AQI/UV; reject negative AQI and invalid timestamps; keep daily maxima distinct from current conditions. |
| Alternate weather pages used other thermal calculations | Today and Glance used private heat-index/wind-chill formulas; Atmos used different perfect-weather evidence. | Use canonical outdoor samples on Today and Glance; Atmos consumes the main page's recommendation windows and published criteria. |
| Native model / exposure payload validation was incomplete | Negative wind, wrong optional units and exposure payloads without current-hour coverage could be accepted. | Validate core ranges and optional units, retain missing values, preserve healthy core guidance when optional fields are invalid, and recheck exposure coverage across cache rollover. |
| Small vapor-pressure arithmetic error | The saturation-vapor-pressure helper used `ln(1 + Tk)` where the independent Hardy/ECMWF reference uses `ln(Tk)`. Across 320 supported cases the maximum UTCI difference was 0.1252°C, roughly 0.23°F. This did **not** explain the much larger duplicate-scale conflict. | Correct the logarithm and enforce the fitted 5 kPa vapor-pressure limit. |

The screenshot's 59°F air / 42°F dew point / 11 mph clear-sky case reproduces approximately **46°F shade and 54°F outdoor feels-like** under the existing radiation and cold-weather model. Reproducing those numbers demonstrates what the model computes; it does not establish measured outdoor comfort.

## Independent numerical reference

Compared the actual UTCI polynomial and vapor-pressure calculation against [ECMWF thermofeel](https://github.com/ecmwf/thermofeel/blob/main/thermofeel/thermofeel.py), source blob `b2ad393660a8ddc6bdb16c7d6d56255b68a217f6`.
The retained fixture records its source URL, blob SHA, source SHA-256 and retrieval date.

After correcting the logarithm, all **320** independently generated cases agree within **5.1 × 10⁻¹³°C**. The cases vary air temperature, radiant temperature, wind and humidity inside the supported domain. Tests also check unsupported vapor pressure and preserve real zero humidity.

This validates numerical implementation for those inputs. It does not validate estimated radiation, street-level wind, cloud attenuation, the custom cold-weather blend, forecast skill or individual comfort.

## Validation performed

- **61 focused regression tests pass**, including 320 independent UTCI vectors inside the reference test.
- Broader direct Node runs: **908 passed, 29 failed** across 937 reported test cases. Failures and blocked suites were compared against a separate unchanged source snapshot; **no new failing test names or newly failing files remain**.
- The unchanged snapshot itself reports 35 failed assertions. Remaining failures include outdated wording/layout assertions, omitted binary image fixtures, missing Express dependencies and sandbox-blocked loopback networking. Therefore the full repository suite is **not green**.
- Corrected relevant numerical test fixtures: NWS point mocks now contain required forecast references. Rainfall tests explicitly cover 24/24, 8/24 and 0/24 hours and preserve `null` for incomplete amounts or likelihoods.
- Changed JavaScript syntax checks and `git diff --check` pass. The new freshness module has an explicit static route with revalidation.

## Remaining verification and model limits

The live page/API could not be retrieved in this session: the public fetch tool could not access the address, and Firecrawl returned insufficient credits. Shell network access was blocked by the execution sandbox, and local browser launch failed. No current production payload, provider observation or responsive production browser result was obtained.

Render workspace selection remains pending. These changes are prepared for review; production deployment and post-deployment checks have not been completed. Verify the deployed API reports `accuracyVersion: weather-accuracy-20261019-v1`, compare current and forecast timestamps, and repeat the screenshot case against the same deployed payload.

The site still uses estimated mean radiant temperature and a custom cold-weather blend. The blend extends the wind-chill expression outside standard NWS wind-chill applicability and is explicitly identified as custom. Missing sky/solar inputs are disclosed as assumptions. Surface temperatures remain modeled estimates rather than measurements. Relative forecast confidence and custom blended rain likelihood are not independently calibrated forecast probabilities. Useful county/radar metadata can still be discarded if an upstream NWS point response is incomplete.

This audit covers weather data paths, visible weather metrics and the related alternate weather pages reviewed here. It does not certify every live forecast or unrelated business applications in the repository.
