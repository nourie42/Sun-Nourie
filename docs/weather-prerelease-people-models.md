# Prerelease people and forecast choices

The prerelease adds a compact model chooser and a photographic forecast player.

## Pick your weather

The screen has starting presets, available model choices, percentage shares and
plain-language changes across seven local calendar dates. It shows up to three
largest changes first; “See all seven days” expands dated text. There are no
custom forecast graphs, hour scrubbers, metric selectors or source tables.

Temperature and rainfall use source values for the same location and timestamp
in the existing forecast response. Missing selected inputs are excluded per
field and hour; complete-day highs and rainfall totals require complete hourly
coverage, including 23- and 25-hour daylight-saving dates. A short-range model's
last overnight hours cannot become a false daily high. Today ends at local
midnight; remaining rainfall uses the same remaining interval as its comparison.

Rain probability uses genuine NWS probabilities, with no conversion of
rainfall amounts into a probability. The preview never changes the published
Weather Nourie forecast. The Nourie preset displays the actual published
forecast unchanged. Its controls start from current source weights; editing
models or shares switches to a separately calculated personal preview.

## Choose your person

Emma, Maya, Mei and Alex appear by name only. Selection persists in the browser
and preserves the forecast hour. Alex retains her pride flag in the artwork.

The player uses complete photographic scenes in which each person, clothing,
ground, reflections and contact shadows were generated together. It does not
paste transparent people onto an empty landscape. Emma uses the original
complete photographs; Maya, Mei and Alex use integrated scene atlases, including
separate winter scenes and complete clear-sky cool/cold alternatives. Clear and
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
review checks mobile/desktop layout, complete feet/umbrellas, natural contact
shadows, names-only accessible controls, paused ambient motion, scene blending,
reduced motion and GPU fallback.

Changes are published on the prerelease branch and its Render service.
