# Current comfort, pavement, daily UV and Dan's take

Release marker: `compact-comfort-hourly-uv-v2`. Existing Node/Express and Render hosting are retained.

## Current exposure and illustrations

The nearby Greenville KPGV observation was returning a valid air temperature and dew point but a null wind speed. That made the current UTCI undefined even though the hourly forecast had valid wind. `current-inputs.js` now fills only missing wind or unusable moisture using the canonical forecast hour at the snapshot's assembly time. It preserves valid station readings, including zero wind, and never overwrites raw observations. The same helper runs in the API and browser; captions and scientific details disclose each companion estimate and source. Fallback expires after 90 minutes and cannot reach ahead to a future hour. Invalid dew point can use valid observed relative humidity.

The SVG people now have an explicit resting hand and a static waving hand. Removing the small transformed hand animation prevents mobile compositing from hiding it. All five clothing states retain both hands.

## Pavement model and limitations

`pavement.js` integrates a two-layer, transient surface energy balance at 60-second steps, using up to 48 hours of archived **model** weather (not past station measurements), with at least 24 hourly samples required:

`Cs dTs/dt = (1-albedo) SW + emissivity (LWsky - sigma Ts^4) + h (Tair-Ts) - G (Ts-Tb)`

`Cb dTb/dt = G (Ts-Tb) - Gdeep (Tb-Tdeep)`

Temperatures in radiation terms are kelvin; heat flux is W/m². Concrete/asphalt use albedo 0.30/0.10, conductivity 2.0/1.5 W/(m K), emissivity 0.95, volumetric capacity 2.2 MJ/(m³ K), and 0.03/0.15 m layers. Deep temperature is the history's mean air temperature. Current station air/moisture/wind, plus disclosed companion estimates when needed, adjust the final weather sample. Unknown material, shelter and initial ground temperature remain important uncertainties.

Cloud-adjusted Open-Meteo model instantaneous shortwave radiation is preferred and is **not** discounted for clouds a second time. If absent, a Haurwitz clear-sky approximation and empirical total-cloud transmission are used. A current observed cloud fraction can adjust the final shortwave sample relative to the model fraction. Downward longwave uses the Clark-Allen sky-emissivity relation with a cloud correction (total cover approximates opaque cover). Wind uses a standard empirical forced-convection relation with a 0.7 shelter adjustment. Rain probability is never treated as measured wetness.

Displayed ranges vary albedo, conductivity, capacity, wind, radiation and initial temperature; they are rounded outward with an additional margin. They are engineering scenario envelopes, **not validated statistical confidence intervals**. These are dry, exposed surface estimates, not measured pavement or a paw-safety guarantee. Recent modeled rain and freezing trigger explicit warnings. Stale snapshots or missing history produce an honest unavailable state. Shade, material color, wetness, shelter, snow and local conditions can materially change the result. The UI advises checking the actual surface and choosing grass or a cooler route when it feels hot.

Sources:

- [METRo road-temperature energy balance](https://journals.ametsoc.org/abstract/journals/apme/40/11/1520-0450_2001_040_2026_manmfr_2.0.co_2.xml) (physical approach; this implementation is not METRo).
- [EnergyPlus sky radiation and cloud correction](https://energyplus.readthedocs.io/en/v25.1.0/auxiliary-programs/auxiliary-programs.html).
- [FHWA pavement thermal properties and convection](https://www.fhwa.dot.gov/publications/research/infrastructure/pavements/pccp/04127/appb.cfm).
- [pvlib Haurwitz clear-sky implementation](https://pvlib-python.readthedocs.io/en/stable/_modules/pvlib/clearsky.html).
- [EPA cool-pavement physical context](https://www.epa.gov/sites/default/files/2014-06/documents/coolpavescompendium.pdf).
- [NWS pet heat guidance](https://www.weather.gov/wrn/summer-article-keep-your-pets-cool).

## Daily maximum UV

The separate Open-Meteo `daily=uv_index_max` forecast is mapped by local calendar date in the selected location's IANA timezone. Raw values remain in the API; displayed whole-number values and EPA categories agree. Zero is valid and missing UV stays unavailable. The current-weather and Today sections show **Peak UV today**; all seven daily rows show their own maximum. Tonight continues to show today's full-day maximum, not instantaneous nighttime UV. The UV/radiation feed does not replace the site's direct NOAA temperature model feeds.

Sources: [Open-Meteo forecast fields](https://open-meteo.com/en/docs), [EPA UV calculation and categories](https://www.epa.gov/sunsafety/calculating-uv-index-0).

## Always-visible Dan's take

Dan's take is now changes-only: at most two concise, dated possible changes (55 words / 380 characters total), with no general overview or attribution beneath it. It is hidden when no eligible current discussion evidence remains. The AI is asked for one or two short sentences and its successful empty result is authoritative, clearing any prior retained approval. During an AI outage, a short complete dated uncertainty excerpt may be shown; text is never cut mid-sentence. Routine weather in WHAT HAS CHANGED is not sufficient. Source quotes remain in Scientific Stuff. Freshness, event expiry, exact-source and location checks still apply.

## Verification

- `node --test test/weatherFusion*.test.js`: 307 passing weather tests at release preparation.
- `npm run check`: existing cross-site checks pass.
- `WEATHER_BROWSER_PATH=... WEATHER_BASE_URL=http://127.0.0.1:3123 node scripts/verifyComfortPawsUvBrowser.js`: deterministic browser checks at 320, 390 and 1440 pixels, optional-feed/AI failure, missing current wind/moisture, repeated refresh, Tonight, failed location change, high-right ordering, all UV placements, poodle loading, both hands in all clothing states, and no horizontal overflow.
- Live verification is performed separately against Render with real provider responses, not fixtures.

Release verification on September 10, 2026 also passed the six-width responsive suite (320–1365 px), 27 outdoor scenarios, 21 dated-summary scenarios, and two failed/pending/reload lifecycle scenarios. Live Render checks matched the exact changed assets and backend release marker. Greenville and Knightdale displayed all seven UV maxima, numeric pavement estimates, complete fixed graphics and matching current sun values across the hero, Now, metric and figure. Separate live thermal and discussion checks covered Knightdale, White Lake, Jacksonville, Denver and Seattle; Dan's overview remained visible with no approved changes and with a dated source-excerpt fallback. Repeated live refreshes crossed both forecast and discussion cache lifetimes without hiding the card. The responsive workflow now runs the new deterministic and live UV/pavement checks.

The generated poodle illustration is `public/weather-fusion/poodle-walk.png` (1536 × 1024 PNG). It is a fixed asset, not generated anew on refresh.

Generation prompt:

```text
Use case: illustration-story
Asset type: standalone transparent PNG illustration for a dark blue weather app, readable at 250 pixels wide.
Primary request: One friendly person walking one tiny light brown / apricot toy poodle on a leash along a small simple grey sidewalk strip.
Scene/backdrop: Genuinely transparent background with alpha channel; only the person, dog, connecting leash and small grey sidewalk strip are visible. Do not paint a checkerboard pattern.
Subject: Full-body friendly person in mint and sky-blue casual clothes, with exactly two clearly complete arms and two visible hands, two complete legs and shoes. One hand visibly holds the leash; the other arm hangs naturally with its hand clear of the torso. The tiny toy poodle beside the person has soft curly apricot/light-brown fur, floppy ears, four clearly distinct legs and paws, a small tail, and a friendly face. Dog is substantially smaller than the person and unmistakably a toy poodle. Show both complete subjects, head to toe.
Style/medium: Polished friendly rounded flat illustration, clean simple silhouettes, restrained soft highlights, suitable for a refined dark-blue weather application. Soft inviting color palette with strong silhouette readability.
Composition/framing: Landscape 3:2 composition, entire illustration centered with generous transparent padding around every edge. Person and dog arranged side by side in a natural walking pose, leash clearly connecting the hand to the dog's collar. No cropping of person, dog, leash, or sidewalk.
Constraints: Exactly one person, one dog. No missing or extra limbs, no hidden hands. No text, numbers, temperature, UI, border, logos, watermark, clouds or sun. One final image only.
```

## Requested compact layout follow-up

The poodle and sidewalk reading are the third figure inside the same comfort card, immediately to the right of the sun figure at every tested width. Asphalt remains a secondary reading; model ranges and paw-care advice are in expandable details within that card. The heading ends in a question mark. Daily UV and forecast confidence share one horizontal row. Each hourly button uses its own timestamp-matched `hourly=uv_index` value; it never substitutes the daily maximum. Zero and missing data remain distinct, including at night and across daylight-saving changes.
