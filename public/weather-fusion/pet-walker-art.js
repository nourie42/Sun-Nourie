/** Replacement art for the woman and her poodle (the "For Pets" panel).
 *
 * The original artwork is baked into 3-panel scene sheets, so her clothes change
 * with the weather only because every sheet has its own picture of her. A slot below
 * replaces just her panel for one weather/outfit combination; any slot without an
 * entry keeps showing the original art. Slot names come from walkerSlot() in
 * exposure-scene.js (run `python3 scripts/pet_walker_art.py list`).
 *
 * Add art with:  python3 scripts/pet_walker_art.py install <slot> <image>
 * Entry fields:  file (in this folder), width/height (pixels, always square), and optionally
 *   asDisplayed: true  the picture already shows its final lighting, so the page's
 *                      night brightening is not applied a second time
 */
export const PET_WALKER_VERSION='walker-3-v2';
export const PET_WALKER_ART={
 "night-mild-night":{file:"pet-walker-night-mild-night.webp",width:538,height:538,asDisplayed:true},
};
export const PET_WALKER_FILES=Object.values(PET_WALKER_ART).map(art=>art.file);
