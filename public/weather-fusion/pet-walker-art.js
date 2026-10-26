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
export const PET_WALKER_VERSION='walker-3-v39';
export const PET_WALKER_ART={
 "day-cold-carry-umbrella":{file:"pet-walker-day-cold-carry-umbrella.webp",width:1024,height:1024,asDisplayed:true},
 "day-cold-fog":{file:"pet-walker-day-cold-fog.webp",width:1024,height:1024,asDisplayed:true},
 "day-cold-normal":{file:"pet-walker-day-cold-normal.webp",width:1024,height:1024,asDisplayed:true},
 "day-cold-rain":{file:"pet-walker-day-cold-rain.webp",width:1024,height:1024,asDisplayed:true},
 "day-cold-watch":{file:"pet-walker-day-cold-watch.webp",width:1024,height:1024,asDisplayed:true},
 "day-cool-carry-umbrella":{file:"pet-walker-day-cool-carry-umbrella.webp",width:1024,height:1024,asDisplayed:true},
 "day-cool-fog":{file:"pet-walker-day-cool-fog.webp",width:1024,height:1024,asDisplayed:true},
 "day-cool-normal":{file:"pet-walker-day-cool-normal.webp",width:1024,height:1024,asDisplayed:true},
 "day-cool-rain":{file:"pet-walker-day-cool-rain.webp",width:1024,height:1024,asDisplayed:true},
 "day-cool-watch":{file:"pet-walker-day-cool-watch.webp",width:1024,height:1024,asDisplayed:true},
 "day-hot-normal":{file:"pet-walker-day-hot-normal.webp",width:1024,height:1024,asDisplayed:true},
 "day-mild-carry-umbrella":{file:"pet-walker-day-mild-carry-umbrella.webp",width:1024,height:1024,asDisplayed:true},
 "day-mild-fog":{file:"pet-walker-day-mild-fog.webp",width:1024,height:1024,asDisplayed:true},
 "day-mild-normal":{file:"pet-walker-day-mild-normal.webp",width:1024,height:1024,asDisplayed:true},
 "day-mild-watch":{file:"pet-walker-day-mild-watch.webp",width:1024,height:1024,asDisplayed:true},
 "day-warm-carry-umbrella":{file:"pet-walker-day-warm-carry-umbrella.webp",width:1024,height:1024,asDisplayed:true},
 "day-warm-fog":{file:"pet-walker-day-warm-fog.webp",width:1024,height:1024,asDisplayed:true},
 "day-warm-normal":{file:"pet-walker-day-warm-normal.webp",width:1024,height:1024,asDisplayed:true},
 "day-warm-rain":{file:"pet-walker-day-warm-rain.webp",width:1024,height:1024,asDisplayed:true},
 "day-warm-watch":{file:"pet-walker-day-warm-watch.webp",width:1024,height:1024,asDisplayed:true},
 "night-cold-carry-umbrella":{file:"pet-walker-night-cold-carry-umbrella.webp",width:1024,height:1024,asDisplayed:true},
 "night-cold-fog":{file:"pet-walker-night-cold-fog.webp",width:1024,height:1024,asDisplayed:true},
 "night-cold-night":{file:"pet-walker-night-cold-night.webp",width:1024,height:1024,asDisplayed:true},
 "night-cold-rain":{file:"pet-walker-night-cold-rain.webp",width:1024,height:1024,asDisplayed:true},
 "night-cool-carry-umbrella":{file:"pet-walker-night-cool-carry-umbrella.webp",width:1024,height:1024,asDisplayed:true},
 "night-cool-fog":{file:"pet-walker-night-cool-fog.webp",width:1024,height:1024,asDisplayed:true},
 "night-cool-night":{file:"pet-walker-night-cool-night.webp",width:1024,height:1024,asDisplayed:true},
 "night-cool-rain":{file:"pet-walker-night-cool-rain.webp",width:1024,height:1024,asDisplayed:true},
 "night-mild-carry-umbrella":{file:"pet-walker-night-mild-carry-umbrella.webp",width:1024,height:1024,asDisplayed:true},
 "night-mild-fog":{file:"pet-walker-night-mild-fog.webp",width:1024,height:1024,asDisplayed:true},
 "night-mild-night":{file:"pet-walker-night-mild-night.webp",width:538,height:538,asDisplayed:true},
 "night-mild-rain":{file:"pet-walker-night-mild-rain.webp",width:1024,height:1024,asDisplayed:true},
 "night-warm-carry-umbrella":{file:"pet-walker-night-warm-carry-umbrella.webp",width:1024,height:1024,asDisplayed:true},
 "night-warm-fog":{file:"pet-walker-night-warm-fog.webp",width:1024,height:1024,asDisplayed:true},
 "night-warm-night":{file:"pet-walker-night-warm-night.webp",width:1024,height:1024,asDisplayed:true},
 "night-warm-rain":{file:"pet-walker-night-warm-rain.webp",width:1024,height:1024,asDisplayed:true},
 "snow-dawn":{file:"pet-walker-snow-dawn.webp",width:1024,height:1024,asDisplayed:true},
 "snow-day":{file:"pet-walker-snow-day.webp",width:1024,height:1024,asDisplayed:true},
};
export const PET_WALKER_FILES=Object.values(PET_WALKER_ART).map(art=>art.file);
