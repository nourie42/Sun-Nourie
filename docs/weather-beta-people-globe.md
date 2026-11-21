# Beta people, centered weather and expandable globe

Beta remains at `/weather-fusion/v3/`, publicly accessible through the main app’s Try Beta link. The prominent Main app return button is preserved. The main app’s interface and weather engine are unchanged by this update. Existing sky, moon, sunset, model-comparison, ranking and ice-frame changes from main were integrated before final validation.

The location is now plain centered text within the hero and still opens search. The date, temperature, current condition, feels-like and high/low are centered. Branding reuses the actual main-page header artwork and favicon. Header, menu and chart controls use glass styling. Fahrenheit/Celsius remains accessible in the tools menu.

Shade, Day/Sun/Rain/Night and For Pets now appear as three prominent illustrated cards. They reuse the main app’s condition-specific artwork and clothing helpers, including genuine night scenes. The outdoor night reading uses the existing outdoor feels-like value, rather than a missing sunlight value. Pet cards still expand to show both surfaces and peaks for the selected local calendar day; the existing thermal solver and weather formulas are unchanged. The latest main-branch future-preview heading behavior is retained.

The globe preview expands into a keyboard- and touch-operable native dialog. It supports drag rotation, pinch/buttons/wheel zoom, geographic recenter, independent satellite/radar/wind toggles, observed radar playback and browser Back. One WebGL renderer moves between preview and expanded views. The location marker uses the exact selected forecast coordinates. The preserved detailed local radar remains accessible, and now sends `latitude`/`longitude` rather than the previously incorrect `lat`/`lon` names.

Data and limitations:

- NASA Earth day/night images are geographic base imagery, not live weather. They and the existing MIT Three.js dependency were reused from the separate Next Gen checkout without merging that application. Three.js’s license is included in the vendored file.
- Clouds use the timestamped global infrared satellite composite from UW–Madison SSEC RealEarth. The source is projected correctly from Mercator onto the globe. Bright IR areas can include cold ground; this is disclosed beside the controls. No stock cloud fallback is displayed.
- Radar uses only real advertised, recent NOAA MRMS reflectivity frames, projected over the continental-US coverage area. This layer does not claim worldwide radar coverage.
- Surface winds use actual GFS hourly speed/direction via Open-Meteo, sampled on a 20 × 10 global grid. Meteorological direction converts to east/north vectors, with periodic longitude interpolation. Missing cells and polar areas outside the sampled field do not get invented winds. Stronger winds create denser/faster moving lines, within an animation budget. Motion is accelerated for visualization and is not a storm track or a forecast trajectory.
- Weather layers have visible timestamps and honest unavailable states. Wind is cached once per UTC hour, cloud metadata for 10 minutes and radar metadata for 2 minutes. Image caches retain one cloud texture and the advertised radar frames. Concurrent requests deduplicate, failed sources cool down and provider retry windows are respected.
- Globe assets and feeds load after weather is available and the preview approaches the viewport, or upon explicit expansion. Animation pauses offscreen/when hidden. Reduced-motion and Save Data start without automatic motion, and Save Data defers automatic globe loading. Rendering caps pixel ratio and wind particles. WebGL failure leaves detailed local radar accessible.

Executed validation on 2026-11-21 after integrating main `96dba938b317513ba89812a8b9cf547fe1cc9476`:

- `npm run check`: passed, including `WEATHER_QA_CONTRACT_OK`.
- 87 Node checks passed across globe geography/data/caching, public/private access, selected-day pavement, observed sky, current facts, source repair and outlook suites.
- `scripts/weatherV3PeopleGlobeSmoke.py`: 15 checks passed. Captured real forecast, satellite, radar and GFS responses; frozen clock; mobile Chromium with WebGL and touch. Checks centered hero/no overflow at 320–1280px, main branding, glass controls, all three cartoon scenes, night previews, pet details, geographic marker, real-field wind particles, expansion, movement, layer/zoom/drag/recenter controls, reduced-motion behavior, browser Back, correct radar query names, unavailable feeds and no JavaScript page errors.
- `scripts/weatherV3BetaSmoke.py`: 22 checks passed for captured Knightdale and Greenville forecasts, including Saturday/Sunday/Monday surface peaks, Celsius via the menu, equal 16px spacing, warning stacks and the main Try Beta link.
- A direct request to the real globe sources returned all 200 valid wind cells, advertised MRMS frames and timestamped satellite imagery; the satellite/radar PNG responses were validated and rendered in the browser proof.

These browser checks emulate mobile Chromium; they were not run on a physical Samsung device. Captured weather fixtures and screenshots are validation artifacts outside the served application.
