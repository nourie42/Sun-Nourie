# Weather Nourie QA contract

Before publishing weather changes, verify these rules against code, tests, and the live pages:

- Rain chance math is not rainfall amount math. On the selected location's current local date, NWS probability contributes `NWS percent × 0.40`; HRRR has 30 points, ECMWF 10, and NBM 20. On later local dates, NWS contributes `NWS percent × 0.15`, ECMWF has 60 points, NBM 25, and HRRR contributes nothing. Every hour checks its own source support; repeated interpolated hours from one model do not count as independent corroboration.
- Where fresh matching NVIDIA WeatherNext input exists, reserve its established 10% share and scale the preceding model shares by 0.9: current day 36/27/9/18/10; later rain 13.5/54/22.5/10 without HRRR. Verify actual wn contributions in daily/hourly amounts, temperature, wind and dew point. Unavailable NVIDIA fields and locations retain the existing available-model policy. The Weather Nourie comparison line must remain the same canonical forecast as the cards, regardless of model visibility.
- Model QPF of exactly `0` gets `0` points. Model QPF above `0` through `0.010 in` gets exactly one-third of that model’s points. Model QPF above `0.010 in` gets full points only if NWS is at least `20%` or another included model is also above `0.010 in`. Otherwise it gets one-third. Excluded HRRR cannot corroborate later-day rain; unavailable models cannot corroborate rain.
- Thunder/lightning appears only when the displayed forecast condition actually says thunder/storm/TSTM. A plain 100% rain forecast stays rain, not thunder.
- Today’s background artwork follows the dominant displayed weather. Mostly rainy days use rain artwork; clear/sunny artwork is only for mostly clear/partly clear weather.
- The outdoor/pet scenes follow the selected hour’s actual weather. High-probability rain should not show fog-only people; fog scenes are for fog when rain is not dominant.
- The Feel Meter must show a current dew point if either the current observation or the current forecast-hour dew point is available. Missing station dew point must not make the whole panel look broken.
- Explicit rain or thunderstorm wording at the selected hour must keep rainy artwork even when the displayed probability is below 50%. Chance wording uses cloudy umbrella artwork. Snow elsewhere in the forecast cannot change a liquid-storm hour's scene.
- Car-wash reasons must explain that later rain can prevent three days of low rain risk. Same-day reasons say “today at”; future reasons name the weekday and say “within the next three days.” Decisions and thresholds stay unchanged.
- Car-wash headings must fit inside their own day cards. The short visible Today label retains the full forecast period in accessible text.
- The daily detail graph must show the same exact-hour published rain chance as the hourly cards. Rain uses its own 0–100% scale and the shared time scrubber; unavailable probabilities remain gaps.
- All eight top tabs have equal dimensions and fonts, 30-pixel heights, compact transparent glass, and labels that fit at phone widths. The two-row mobile group is at most 320 pixels wide.
- The Feel Meter must redraw when opened from its hidden state and after resizing. Chart text remains 12 pixels, circles remain round, and time labels cannot overlap. Check all four horizons and exact source values using the slider; missing hours remain gaps.
- Pet and thermal warning badges must fit entirely above their illustrations, including the Hot pavement possible message.
- Every low or very-low confidence daily period shows a plain-language notice in both its forecast row and its opened details; the row says “Click for details.”
- Public weather code must not contain literal OpenAI API keys. Server code may reference `process.env.OPENAI_API_KEY`; browser weather code may not embed a secret.

Run:

```sh
node --test
node scripts/verifyWeatherQaContract.js
```

The reusable interaction browser check saves source data, screenshots and a
JSON report at 320, 412, 768 and 1280 pixels:

```sh
python -m pip install playwright
python -m playwright install chromium
CHROMIUM_PATH="$(python -c 'from playwright.sync_api import sync_playwright; p=sync_playwright().start(); print(p.chromium.executable_path); p.stop()')" \
WEATHER_TEST_BASE=https://sun-nourie-prerelease.onrender.com \
python scripts/weatherInteractionQc.py
```

When checking a local frontend against a deployed backend, set
`WEATHER_SOURCE_BASE` as well. Those runs are explicitly recorded as replayed
backend guidance. Direct deployment verification leaves that setting empty.
The storm and hot-pavement regressions require those actual forecast conditions;
the report identifies an absent case instead of claiming it was verified.
