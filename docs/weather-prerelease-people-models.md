# Prerelease people and forecast choices

This release changes only the prerelease forecast comparison and weather player.

## Pick your weather

Choose a model and one measurement to compare its next seven local calendar dates
with the published Weather Nourie forecast. The existing two-line graph and plain
text differences remain. The measurement selector covers high and low temperature,
feels-like estimates, rain chance, rainfall, wind, gusts, dew point, humidity,
cloud cover, UV, AQI, snow, visibility and pressure.

Each selected model contributes only its own matching source data. Missing fields
or incomplete calendar coverage leave gaps and an explanation. Short-range models
are never extended beyond their forecast horizon. Today ends at local midnight,
and DST dates use their actual 23 or 25 hours. Deterministic rainfall is never
converted into a rain probability. Source-only snow models appear when their
actual snowfall data is present.

Humidity is derived from the same model’s matching temperature and dew point.
Thermal estimates use the existing comfort calculation only when that model has
all required inputs. UV and AQI remain separate products; unsupported model
comparisons are explicitly unavailable. Selecting a model does not change the
published forecast.

## Play your weather

The player starts closed. Its module, renderer and artwork load only after the
user clicks the tab. Closing pauses playback and disposes the renderer. Reopening
keeps the chosen person and hour and receives location and forecast updates.
Emma, Maya, Mei and Alex appear by name only. Alex retains her pride flag. Maya
has a new original appearance distinct from the supplied reference.

A procedural sky changes with the selected forecast hour and location, using the
same astronomy calculation as the Atmos scene. Cloud density follows forecast
cloud cover; cloud motion follows wind. Sun and moon positions use actual altitude
and azimuth, with lunar phase and horizon visibility. Missing coordinates do not
fall back to a different city. Rain, snow and fog render in front of and behind
the foreground.

The photographic foreground contains the person, clothing, trees, lake, path and
contact shadows together. Only the sky is transparent, so the person is not pasted
onto an unrelated landscape. Separate authored day and night foregrounds provide
actual warm path-lamp illumination at night. There is no global daytime-photo
dimming filter or RGB sky-keying. Neutral diffuse day artwork avoids baked solar
direction. The foreground is photographic, not a fully relightable 3D model.

The person uses medium-distance framing with visible surroundings. Proportions
are preserved and the full foreground occupies the bottom 75% of the stage.
Explicit atlas rectangles exclude grid seams. Paired day and night artwork is
preloaded before playback; wardrobe changes use cached crops and short crossfades
so clothing remains aligned with the selected-hour text. Storms use an empty
scene with shelter instructions.

Reduced motion disables ambient animation; offscreen and hidden scenes stop
drawing. A single visible 2D canvas composites the sky, transparent foreground,
and precipitation without requiring WebGL.

## Artwork and validation

Artwork is generated with the image-generation tool. Original PNGs remain outside
the public bundle. Delivery photographic WebP files use quality95 encoding with pixel-exact alpha;
the cloud atlas uses lossless RGBA encoding. Paired phone/desktop comparisons
confirmed no visible facial-quality difference from lossless delivery. Images are checked for clear sky openings, coherent contact shadows,
day/night lighting, wardrobe and medium-distance composition.

Automated checks cover calendar boundaries, missing source data, model arithmetic,
selected-hour astronomy, location changes, cloud cover, native weather alignment,
asset selection, lazy loading and preserved tab state. Browser review covers all
measurements, four people, day and night, clouds and precipitation, mobile and
desktop framing, animation, reduced motion and public asset access.

Publish only the prerelease branch and its Render service.
