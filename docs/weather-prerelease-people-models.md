# Prerelease people and forecast controls

The prerelease weather page adds two controls to its existing forecast player.

## Choose your person

The player offers Emma (White), Maya (a light-skinned Black woman), Mei (Asian),
and Alex (a transgender woman with a trans pride flag). All are fictional adult
characters. The requested White / Black / All / Asian filter controls the visible
choices; All includes every character. Selection persists locally in the browser
and changes the player without changing its selected forecast hour.

Each character has six generated photographic outfits: hot, mild, cool, cold,
rain with umbrella, and windy rain with a hood. The existing native hourly
clothing and precipitation decisions choose the outfit. Empty photographic
landscapes prevent the old character from showing behind a selected person.
Night lighting applies to both the landscape and character. Storm scenes show
shelter guidance with nobody outside. Snow uses a matching empty winter park.

Transparent PNG wardrobe atlases and the winter landscape were generated with
the image-generation tool on October 18, 2026. Pixel bounds in
`player/character-scene.js` isolate each silhouette without cropping umbrellas
or pride flags. There is no claim that science ranks these characters' beauty.

## Pick your weather

The top control opens a personal forecast panel. Available models can be
selected and assigned integer percentage shares totaling 100%. Temperature and
rainfall use only source values for the same location and hourly timestamp in
the existing forecast response. Missing chosen inputs are excluded per metric
and hour, with effective shares shown in the input table. Gaps remain gaps;
incomplete rainfall coverage does not produce a complete-period total.

Rain probability uses genuine NWS probabilities only. Deterministic rainfall
amounts are never converted into probabilities. A model-only selection therefore
has no rain probability when those selected models supply none, while its
temperature and rainfall comparison still works. Low probabilities follow the
page's existing under-five-percent presentation preference. Raw inputs remain
visible in the evidence table.

The panel reads the same validated forecast snapshot as the other sections,
clears on a location change, and never changes the published Weather Nourie
forecast. The initial Nourie shares are a starting preset, not a claim to
duplicate every adaptive rule in the official blend.

## Validation

Node tests cover timestamp alignment, missing inputs, genuine zeroes, partial
hours, midnight boundaries, probability provenance, share normalization, outfit
selection, full-body placement, asynchronous playback and public asset access.
Browser QA checks 320, 412 and 1280 pixel layouts, actual model arithmetic,
keyboard controls, character persistence, rapid switches and both WebGL and
fallback weather scenes. Paused and reduced-motion rain/snow-to-clear transitions
are checked against a clean scene so old weather cannot remain on screen.

These changes are published only on the `prerelease` branch and its Render
service; the live weather service follows `main`.
