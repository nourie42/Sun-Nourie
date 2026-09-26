# Weather Nourie QA contract

Before publishing weather changes, verify these rules against code, tests, and the live pages:

- Rain chance math is not rainfall amount math. On the selected location's current local date, NWS probability contributes `NWS percent × 0.40`; HRRR has 30 points, ECMWF 10, and NBM 20. On later local dates, NWS contributes `NWS percent × 0.15`, ECMWF has 60 points, NBM 25, and HRRR contributes nothing. Every hour uses these same rules, including isolated rain hours.
- Model QPF of exactly `0` gets `0` points. Model QPF above `0` through `0.010 in` gets exactly one-third of that model’s points. Model QPF above `0.010 in` gets full points.
- Thunder/lightning appears only when the displayed forecast condition actually says thunder/storm/TSTM. A plain 100% rain forecast stays rain, not thunder.
- Today’s background artwork follows the dominant displayed weather. Mostly rainy days use rain artwork; clear/sunny artwork is only for mostly clear/partly clear weather.
- The outdoor/pet scenes follow the selected hour’s actual weather. High-probability rain should not show fog-only people; fog scenes are for fog when rain is not dominant.
- The Gross Meter must show a current dew point if either the current observation or the current forecast-hour dew point is available. Missing station dew point must not make the whole panel look broken.
- Every low or very-low confidence daily period shows a plain-language notice in both its forecast row and its opened details; the row says “Click for details.”
- Public weather code must not contain literal OpenAI API keys. Server code may reference `process.env.OPENAI_API_KEY`; browser weather code may not embed a secret.

Run:

```sh
node --test
node scripts/verifyWeatherQaContract.js
```
