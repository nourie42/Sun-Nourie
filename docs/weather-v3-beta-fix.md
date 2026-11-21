# V3 card spacing, selected-day pet peaks and Beta entry

The main weather app now has a compact **Try Beta** link below its header, pointing to `/weather-fusion/v3/`. Existing navigation remains intact.

V3 uses a shared 12px gap for its main stack and nested weather-card groups. Empty alert containers do not reserve a gap, and individual card margins no longer add inconsistent spacing.

Pet pavement peaks use the selected forecast hour’s local calendar day. Monday previews display **Mon peak** and use Monday’s available forecast hours, including its afternoon beyond the 48-hour preview slider when the longer forecast provides it. A note states the date and number of available forecast hours. The concrete/asphalt equations and existing per-hour temperatures are unchanged; the same continuous thermal integration can extend through the selected day. The default solver horizon remains 48 hours for existing callers.

Executed validation:

- `node --test test/weatherV3PavementDay.test.js`: 7 passed. Covers unchanged thermal-history prefixes, complete Monday peaks, local midnight, both daylight-saving transitions, missing values and input immutability.
- `python scripts/weatherV3BetaSmoke.py --fixture-dir /path/to/captured/forecasts --artifacts /tmp/v3-beta-proof`: 22 passed with captured Knightdale/Greenville canonical forecasts and a frozen clock. Covers Today/Sunday/Monday values, Celsius, populated warning-card spacing and 12px gaps at 360/393/412/768/1280px, the main Beta link and no JavaScript page errors. Supplementary weather APIs are unavailable in this controlled test.
- `npm run check`: passed, including `WEATHER_QA_CONTRACT_OK`.

The browser script takes `--base` for its serving origin and expects `knightdale-live.json` and `greenville-live.json` in its fixture directory. No captured weather fixtures are shipped to the application. Mobile checks run in Chromium, not on physical Samsung hardware.
