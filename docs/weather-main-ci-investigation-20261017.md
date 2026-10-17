# Main weather validation investigation — October 17, 2026

This repair targets `main`, independently of phone prerelease PR #219. It is based on `cc058560a42902e967a2a9a8f859f5dae2e3dbd0`. It must remain unmerged until the remaining browser verification is reviewed. No deployment was requested or performed.

## Reproduction and history

| Snapshot | Weather Fusion tests | Passed | Failed | Finding |
| --- | ---: | ---: | ---: | --- |
| `e563197f` — immediate parent of the reported commit | 742 | 719 | 23 | Exactly the same 23 failing test names as `203c2b0` |
| `203c2b0965513764fc8335b08bee85e9a824d9e0` | 742 | 719 | 23 | Reproduces the GitHub job exactly |
| `b2e7e537` — before the October 16 calendar-date change | 720 | 701 | 19 | Older failures exist; its failure set differs because the contracts and tests also changed |
| `c30b6270` — main when this investigation began | 746 | 720 | 26 | Three additional stale tests after the below-5% display cutoff |
| Repair based on `cc058560` | 746 | 746 | 0 | All Weather Fusion tests pass locally |

The three extra rain-display tests were independently corrected on `main` by `cc058560` during this investigation. Those edits were reused, not duplicated in this repair. The latest inspected commit `203c2b0` did not introduce any of the reported 23 failures.

Historical focused runs provide additional attribution:

- Before `68ea50b8` (October 16 calendar-date change), the three refresh/sun/clothing files ran 19 tests: 17 passed and two failed, the existing sun and clothing assertions. Adding `rainAwareCondition`, `dailySkyCover` and rain-timing calls to `showDay` without updating its isolated test context introduced the four dialog failures.
- `60e393ec` on October 14 deliberately replaced the `context.sunExposure` override with the selected modeled outdoor feels-like value in `sunShadeHTML`. The older test still expected 77°F from air-plus-solar uplift instead of the renderer's 67°F outdoor feels-like.
- At `d7173734`, before the October 14 complete-art rewrite, the sun/clothing files ran 12 tests: 11 passed and the cold-clothing wording assertion already failed. It is not an October 17 regression.

Original evidence: [Weather Fusion run 39022766311](https://github.com/nourie42/Sun-Nourie/actions/runs/39022766311), job `117367702717`. Comparison and navigation failures were also inspected in [run 39022766361](https://github.com/nourie42/Sun-Nourie/actions/runs/39022766361) and [run 39022766351](https://github.com/nourie42/Sun-Nourie/actions/runs/39022766351).

## `rainAwareCondition`: definition, callers and exact repair

The exported definition is in `public/weather-fusion/rain-display.js`. Its callers import it normally:

- `app.js`: `showDay()` uses the displayed rain chance and matching-date sky cover for the dialog condition.
- `today-card.js`: `todayForecastHTML()` selects the Today card's displayed condition, preserving observed rain.
- `experience.js`: `renderDailyRows()` selects each daily row's displayed condition.

`test/weatherFusionRefresh.test.js` reads `app.js` as text, slices from `refreshOpenDay()` to `setBasemap()`, and executes that fragment with `runInNewContext`. Module imports are outside that slice. The VM context supplied `displayedRainChance` but omitted `rainAwareCondition`, `dailySkyCover`, `rainTiming` and `rainTimingHTML`; newer main also needs `hideLowRainChance`. Normal browser module scope is not evidence of a missing production definition.

The repair imports those five real helpers in the test and supplies them to the VM context. The existing four tests continue checking stale-number replacement, selected-date rollover, closed-dialog behavior, scroll position, graph selection and keyboard focus. No dummy implementation is added to production.

## All 23 original failures

Numbers below are from the original GitHub job. The table groups only failures with the same correction.

| Original tests | Cause | Exact correction |
| --- | --- | --- |
| 23: radar point versus nearby rain | The mocked NWS `/points/` payload omitted the time zone and forecast reference required by `validateOfficialPayload`; the station was discarded and classification fell back to reflectivity | Supply a real-shaped point payload in all three radar scenarios, retaining the original point/nearby, biological-echo and stale-classification assertions |
| 37, 41: independent/cached warnings | The alert fixtures similarly omitted forecast references, so county metadata was unavailable | Add `forecast`, `forecastHourly` and `forecastGridData` URLs to the point fixture; retain source-call isolation and cached-warning assertions |
| 45, 46: outdoor titles | Tests required unconditional Day/Night labels, superseded by weather-specific Storms titles | Assert Storms plus the correct daytime/nighttime artwork and daylight flag |
| 184: shared navigation | Expected Gross Meter/Air Quality text and an older five-column base style | Assert Feel Meter/AQI, existing anchors and the current seven-column base stylesheet; the navigation test separately checks the final eight-action stylesheet |
| 200: qualifications/branding | Expected the old bold brand markup and no NWS wind-chill adjustment | Check current brand spans and the existing documented cold-wind floor; preserve all qualification and no-interceptor checks |
| 241: dependency closure | A real route gap plus a source parser that ignored `COMFORT_SCENE_ASSETS` | Add 21 missing explicit weather asset routes and derive the test's allowed set from registered routes, retaining the explicit-list and file-existence checks |
| 297: experimental brand link | Expected `class="brand"` exactly | Permit the existing additional `brand-premium` class while retaining the exact experimental link target |
| 335: daily timing call | Expected the old four-argument `dailyDisplay` call | Require the existing fifth `forecast` argument |
| 368: Halo script | Expected an unversioned script URL | Accept a cache version on the exact Halo script path |
| 384: forecast grammar at dew point 40 | Required “will” or “should”; the current text says “ahead” | Accept that future-oriented wording while preserving the ban on current-tense joke text |
| 398: figure geometry | Expected old generated SVG face/wave elements replaced with complete images | Check accessible labels, complete-image rendering and visible clothing metadata; retain reduced-motion checks |
| 545: canonical rain coverage | Assumed all ten output dates had complete coverage despite the finite fixture horizon | Verify coverage against available hours; complete periods equal the canonical peak, incomplete periods remain null and expose the available peak and source evidence |
| 552: canonical rainfall totals | The test reduced an empty window to zero | Require null for an empty/missing amount window; preserve sums for available canonical hourly amounts |
| 567: rain-trend isolation | Expected a Today/Tonight phase reset removed by the calendar-date policy | Require location/date isolation and no evening reset; verify next-date history starts separately |
| 575: refresh trigger | Expected the old literal age expression | Require the existing shared `forecastRefreshDue(forecast)` policy; retain return, reconnect and restored-page checks |
| 576–579: four forecast dialogs | Imported dependencies were absent from the VM context | Supply the real rain-display and rain-timing helpers as described above |
| 629: sun temperature | Expected a retired `sunExposure` renderer override | Require modeled outdoor 67°F, reject air 68°F and solar-only 77°F, and verify the selected 75°F override updates clothing while shade remains 58°F |
| 699: cold clothing | Exact old “coat, scarf and warm hat” phrase no longer matches the expanded accessible description | Require coat/scarf/warm-hat semantics plus heavy-coat-and-trousers metadata; retain all five clothing temperature bands |

The only production-code change is four added lines in `src/weatherFusion.js`, explicitly serving:

```text
calendar-day.js, collapse.js, current-weather.js, gross-toggle.js,
rain-timing.js, week-toggle.js, wn-blend.js,
header-sky.css, header-sky.js, logo.svg, page-unify.css,
header-{cloudy,day,night,rain,snow}.{jpg,webp}
```

All 21 returned HTTP 200 with nonempty bodies through a local instance of the real route registration. Previously, the isolated weather launcher ends unmatched weather requests with 404; these omissions can therefore break its module or visual dependency closure. This finding does not establish which launcher is currently deployed publicly. Existing authentication, forecast algorithms, browser files, CSS and mobile behavior were not edited.

## Related workflows and separate failures

The comparison unit failure was `10 !== 7`: the shared forecast builder now returns ten dates. Its test now requires ten. The navigation failure was `8 !== 7`: it now checks the existing eight actions, Compare/Snow/Car Wash controls, separate NVIDIA link, and `page-unify.css` rather than the superseded base layout. Both are test corrections; neither feature was rewritten.

The live-verification job in run `39022766376` stopped at `scripts/weatherFusionBrowserSmoke.js:88`: its expected weights omit the established NVIDIA 10% share. Actual same-day weights were NWS .36, HRRR .27, ECMWF .09, NBM .18, NVIDIA .10; expected were .4/.3/.1/.2 without NVIDIA. The verifier also contains older seven-day/count/layout assumptions. A follow-up should make those expectations agree with `weatherNextPolicy` and the current shell, then run a fixture browser check before any live check. This patch does not claim that live verification is repaired or that current public feeds were revalidated.

Fuel IQ remains separate. [Run 39022766394](https://github.com/nourie42/Sun-Nourie/actions/runs/39022766394), job `117367702837`, failed household initialization with 17 failures among 18 tests, “Dashboard initialization reached test seam” errors and asynchronous `innerHTML` errors. No household/dashboard files were changed. A passing `npm run check` does not include or clear that separate startup failure.

## Verification and remaining gate

Local runtime: Node 24.19.0. GitHub's Weather Fusion job used Node 22.23.3, so branch CI remains the Node 22 confirmation.

```bash
npm ci --ignore-scripts --no-audit --no-fund
node --check src/weatherFusion.js
node --check public/weather-fusion/app.js
node --test --test-reporter=tap --test-concurrency=4 test/weatherFusion*.test.js
node --test --test-reporter=tap --test-concurrency=4 \
  test/weatherComparison*.test.js test/weatherNextSite.test.js \
  test/weatherDashboardChanges.test.js test/weatherCalendar*.test.js \
  test/weatherDailyRain*.test.js test/weatherForecastRefresh.test.js \
  test/weatherRain*.test.js
npm run check
git diff --check
```

Results: Weather Fusion 746/746 passed; related comparison, navigation, calendar, rain and refresh checks 102/102 passed; business-site checks passed; syntax and whitespace checks passed; all 21 added asset routes returned HTTP 200.

Chromium is not installed locally. Installing the available Playwright browser failed because the download returned a truncated/non-ZIP response. No browser or visual pass is claimed. Before merge, run a fixture browser check at 320, 390 and 1280 px through the actual weather route registration: verify no missing module requests or page errors, open and refresh the selected daily dialog, retain keyboard focus/scroll, select hourly comfort scenes, open Compare and the NVIDIA page, and check horizontal overflow. Older browser smoke scripts need their stale expectations reviewed before treating a failure as a product regression.

Keep this branch as a draft review; merge and public deployment are separate decisions. PR #219 and its branch were not modified.
