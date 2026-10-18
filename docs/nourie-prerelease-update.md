# Nourie prerelease update — October 18, 2026

Target: `https://sun-nourie-prerelease.onrender.com/weather-fusion/`

This change starts from the actual `prerelease` branch and brings its weather-specific code into parity with main commit `47c97ff78879e22b02f1987f906f5eedd3470f10`. Unrelated business application code is not updated.

## Changes

- Preserve the main site's background, glass tiles, forecast data, original Dew Point Feel Meter, and original three-day Car Wash Forecast.
- Add a reusable photographic player with a refined adult character, weather-specific clothing, day/night scenes, clouds and precipitation, and speeds from 1× through 32×.
- Keep the Shade, Sun and For Pets cards still during playback. Pausing or manually selecting an hour updates them through the main application's existing selector. Manual seeking pauses playback at the selected hour.
- Clear old frames immediately when changing location; prevent delayed results from restoring an old city.
- Use the existing canonical forecast for every player value. No additional forecast provider or user-defined blend is introduced.
- Keep Compare as selectable individual model graphs over seven calendar dates. Preserve the published Weather Nourie line, honest missing-data gaps, model coverage, and keyboard/touch day inspection. No weights editor is included.
- Reject wet-weather narrative that contradicts completely covered dry hourly evidence. Preserve uncertainty when data is missing and use snow/precipitation wording for the corresponding conditions.
- Make Feel Meter and Car Wash respond before weather has finished loading. Add Space-key activation to Feel Meter.
- Register the complete native and player asset routes, and preserve the separate comparison application's startup adapter.

## Verification

- 68 focused integration, controls, comparison, narrative and routing checks passed.
- 12 native player checks cover native data mapping, clothing, rain/snow distinctions, pause/seek behavior, refreshes, and location races.
- Full suite: 1,133 tests; 1,108 passed and 25 failed. Every remaining failure also reproduces on clean main. The three newly introduced comparison adapter failures were repaired; the pre-existing asset-route failure was also repaired. No new failures remain relative to that baseline.
- `node scripts/verifyWeatherQaContract.js` passed.
- All 24 player/comparison dependency routes resolve to actual files.
- The actual photographic shader compiled, linked and rendered without GL errors. Phone and desktop renders and all six hot-weather poses were inspected for full-body framing, registration and clean alpha edges.
- Browser inspection confirmed the original site's actual Feel Meter, Car Wash, Compare and styling. The updated build has not had live browser layout verification because local preview infrastructure was unavailable.

## Publication

This report records validation of the prepared source. Publication targets the `prerelease` branch; the branch head and Render deployment status establish which version is live.

The reusable player and its integration contract are under `public/weather-fusion/player/`; native page binding is in `public/weather-fusion/native-player.js`.
