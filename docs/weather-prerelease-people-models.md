# Prerelease people and forecast choices

The prerelease adds a compact model chooser and a photographic forecast player.

## Pick your weather

The screen has a row of available models. Clicking one plots its daily high
temperatures beside the published Weather Nourie line for seven local calendar
dates, with up to three supported differences explained below. Weather Nourie
is the initial selection and restores the published forecast. There are no
percentage controls, presets, hourly scrubbers, ranges or source tables.

Temperature and rainfall use source values for the same location and timestamp
in the existing forecast response. Missing selected inputs are excluded per
field and hour; complete-day highs and rainfall totals require complete hourly
coverage, including 23- and 25-hour daylight-saving dates. A short-range model's
last overnight hours cannot become a false daily high. Today ends at local
midnight; remaining rainfall uses the same remaining interval as its comparison.

The selected model uses only its own actual source values. Missing full-day
coverage leaves a graph gap instead of extending a short model's last hours.
Rainfall differences use genuine amounts, with no conversion into a probability.
Selecting a model never changes the published Weather Nourie forecast.

## Play your weather

The player is a tab and starts closed, even with a player hash in the URL. Its
module, scene photographs and renderer load only after the user clicks it.
Closing pauses playback and disposes the renderer. Reopening keeps the chosen
person and hour and applies any location or forecast updates received while
closed.

## Choose your person

Emma, Maya, Mei and Alex appear by name only. Selection persists in the browser
and preserves the forecast hour. Alex retains her pride flag in the artwork.

The player uses complete photographic scenes in which each person, clothing,
ground, reflections and contact shadows were generated together. It does not
paste transparent people onto an empty landscape. Maya follows the supplied
reference and Emma has vivid blue eyes. Both are portrayed as younger adults
with closer, intentionally knees-up source portraits in nine complete scenes covering
warm, cool, cold, rain, clear and snowy weather. Mei and Alex retain their
existing artwork. New portraits fill the player with a natural top-aligned
cover crop, keeping faces visible while wider screens crop the lower body.
Every displayed pixel comes from the photograph, without extended image edges.
Clear and
cloudier weather select different complete photographs; runtime sky replacement
does not key around hair, flags or trees. Clothing follows the existing native selected-hour
policy. Night grading covers the whole scene; thunderstorms show shelter
instructions with nobody outdoors.

Scene and identity changes crossfade. Photographic clouds drift independently
of forecast playback, with people, umbrellas, foreground trees and ground
protected. Small local optical motion adds breathing and hair movement. Reduced
motion remains static, offscreen/hidden scenes stop drawing, and non-WebGL
browsers show the same complete photographs with CSS weather effects.

Artwork was generated with the image-generation tool on October 18, 2026.
WebP delivery files use lossless encoding; decoded RGB pixels were compared
against the generated PNGs and are identical. Original PNGs remain outside the
public runtime bundle. Exact atlas crops exclude generated grid seams.

## Validation and publication

Tests cover native weather alignment, full-scene asset selection, calendar
boundaries, missing hours, daylight-saving dates and model arithmetic. Browser
review checks mobile/desktop layout, deliberate portrait crops/umbrellas, natural contact
shadows, names-only accessible controls, paused ambient motion, scene blending,
reduced motion and GPU fallback.

Changes are published on the prerelease branch and its Render service.
