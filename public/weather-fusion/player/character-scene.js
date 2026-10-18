/** Character selection and transparent outfit-atlas placement. */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

export const CHARACTERS = Object.freeze([
  { id: 'white', name: 'Emma', group: 'White' },
  { id: 'black', name: 'Maya', group: 'Black' },
  { id: 'asian', name: 'Mei', group: 'Asian' },
  { id: 'pride', name: 'Alex', group: 'All', description: 'Trans pride' }
].map(character => Object.freeze({ ...character, file: `../person-${character.id}.png` })));

export const CHARACTER_POSES = Object.freeze(['hot', 'mild', 'cool', 'cold', 'rain', 'rain-hood']);

// Alpha bounds use whole-atlas coordinates because an umbrella may cross the
// nominal row boundary. Cropping the actual silhouette keeps it intact.
const alphaBounds = {
  white: [[288,8,431,471],[696,9,841,472],[1109,9,1267,475],[264,509,449,1011],[617,482,911,1008],[1102,525,1268,1010]],
  black: [[230,14,405,486],[667,14,835,485],[1114,14,1288,486],[221,511,411,1007],[623,498,887,1007],[1116,522,1300,1007]],
  asian: [[240,8,378,492],[697,7,835,492],[1147,8,1304,492],[229,511,402,1011],[627,503,929,1012],[1146,526,1308,1011]],
  pride: [[221,6,423,497],[647,8,860,497],[1083,9,1305,501],[221,521,443,1014],[629,507,947,1009],[1089,528,1315,1012]]
};
const defaultBounds = [[16,10,496,505],[528,10,1008,505],[1040,10,1520,505],[16,522,496,1015],[528,522,1008,1015],[1040,522,1520,1015]];
export const CHARACTER_ATLASES = Object.freeze(Object.fromEntries(CHARACTERS.map(character => [character.id, Object.freeze({
  columns: 3, rows: 2, width: 1536, height: 1024,
  bounds: Object.freeze((alphaBounds[character.id] || defaultBounds).map(bounds => Object.freeze(bounds.map((value, index) => value / (index % 2 ? 1024 : 1536))))),
  footX: Object.freeze((alphaBounds[character.id] || defaultBounds).map(bounds => (bounds[0] + bounds[2]) / 2 / 1536))
})])));

export function normalizeCharacter(id) {
  return CHARACTERS.some(character => character.id === id) ? id : 'white';
}

/** Reuse the native outfit decision; no independent weather interpretation. */
export function selectCharacterPose(scene = {}) {
  if (scene.showPerson === false) return null;
  if (scene.precipitation === 'rain') return scene.umbrella ? 'rain' : 'rain-hood';
  if (scene.precipitation === 'snow') return 'cold';
  return CHARACTER_POSES.includes(scene.garment) && !scene.garment.startsWith('rain') ? scene.garment : 'cool';
}

/** Clip precisely to one outfit without stretching or exposing adjacent cells. */
export function computeCharacterLayout({ viewportWidth = 1, viewportHeight = 1, sourceWidth = 1536, sourceHeight = 1024, character = 'white', pose = 'mild' } = {}) {
  const width = positive(viewportWidth, 1), height = positive(viewportHeight, 1);
  const atlasWidth = positive(sourceWidth, 1536), atlasHeight = positive(sourceHeight, 1024);
  const atlas = CHARACTER_ATLASES[normalizeCharacter(character)];
  const index = Math.max(0, CHARACTER_POSES.indexOf(pose));
  const bounds = atlas.bounds[index];
  const boundWidth = (bounds[2] - bounds[0]) * atlasWidth, boundHeight = (bounds[3] - bounds[1]) * atlasHeight;
  const margin = Math.min(12, width * .04);
  const scale = Math.min(height * .52 / boundHeight, (width - margin * 2) / boundWidth);
  const actorWidth = boundWidth * scale, actorHeight = boundHeight * scale;
  const footOffset = (atlas.footX[index] - bounds[0]) * atlasWidth * scale;
  const left = clamp(width * .5 - footOffset, margin, Math.max(margin, width - margin - actorWidth));
  const top = Math.max(0, height * .905 - actorHeight);
  return {
    left, top, width: actorWidth, height: actorHeight, scale,
    imageWidth: atlasWidth * scale, imageHeight: atlasHeight * scale,
    imageLeft: -bounds[0] * atlasWidth * scale,
    imageTop: -bounds[1] * atlasHeight * scale,
    feetX: left + footOffset, feetY: top + actorHeight
  };
}
