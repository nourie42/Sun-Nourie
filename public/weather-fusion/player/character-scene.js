/** Paired photographic park foregrounds. The selected hour supplies the sky. */
export const CHARACTERS = Object.freeze([
  { id: 'white', name: 'Emma' },
  { id: 'black', name: 'Maya' },
  { id: 'asian', name: 'Mei' },
  { id: 'pride', name: 'Alex' }
].map(character => Object.freeze(character)));

export const CHARACTER_POSES = Object.freeze(['hot', 'mild', 'cool', 'cold', 'rain', 'rain-hood', 'snow']);
const slots = Object.freeze({ hot: 0, mild: 1, cool: 2, cold: 3, rain: 4, 'rain-hood': 5, snow: 6, shelter: 7, portrait: 8 });
const identities = { white: 'emma', black: 'maya', asian: 'mei', pride: 'alex' };
const rowEdges = Object.freeze({
  white: Object.freeze([0, 256, 514, 771, 1024]),
  black: Object.freeze([0, 298, 591, 840, 1024]),
  asian: Object.freeze([0, 256, 512, 768, 1024]),
  pride: Object.freeze([0, 279, 564, 813, 1024])
});
export const CHARACTER_SCENE_ATLASES = Object.freeze(Object.fromEntries(Object.entries(identities).map(([id, name]) => {
  const dayFile = `../player-${name}-day-foreground.webp`, nightFile = `../player-${name}-night-foreground.webp`;
  // Maya's edited second row has a four-pixel feathered gutter above the
  // umbrella. Starting at the first actual canopy pixel avoids a sky border.
  const rowTopInsets = Object.freeze(id === 'black' ? [2, 4, 2, 2] : [2, 2, 2, 2]);
  const nightTopInsets = id === 'white' ? Object.freeze([2, 2, 3, 2]) : rowTopInsets;
  return [id, Object.freeze({ file: dayFile, dayFile, nightFile, columns: 3, rows: 4,
    sourceWidth: 1536, sourceHeight: 1024, nightSourceWidth: 1536, nightSourceHeight: 1024,
    dayRowEdges: rowEdges[id], nightRowEdges: rowEdges[id], dayTopInsets: rowTopInsets, nightTopInsets, inset: 2 })];
})));
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

/** Source rectangles are [left, top, width, height], including the seam inset. */
function sceneCell(index, atlas, night = false) {
  const sourceWidth = night ? atlas.nightSourceWidth : atlas.sourceWidth, sourceHeight = night ? atlas.nightSourceHeight : atlas.sourceHeight;
  const rows = night ? atlas.nightRowEdges : atlas.dayRowEdges, row = Math.floor(index / atlas.columns);
  const cellWidth = sourceWidth / atlas.columns, cellHeight = rows[row + 1] - rows[row], inset = atlas.inset;
  const topInset = (night ? atlas.nightTopInsets : atlas.dayTopInsets)[row];
  return [((index % atlas.columns) * cellWidth + inset) / sourceWidth,
    (rows[row] + topInset) / sourceHeight,
    (cellWidth - inset * 2) / sourceWidth, (cellHeight - topInset - inset) / sourceHeight];
}

export function normalizeCharacter(id) {
  return CHARACTERS.some(character => character.id === id) ? id : 'white';
}

/** The gallery has its own headshot, separate from the environmental framing.
 * Its rect uses [left, top, right, bottom] for the existing gallery consumer.
 */
export function getCharacterPortrait(id) {
  const character = normalizeCharacter(id), atlas = CHARACTER_SCENE_ATLASES[character], rect = sceneCell(slots.portrait, atlas);
  return { file: atlas.dayFile, rect: [rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]], face: [.5, .40],
    cellAspect: atlas.sourceWidth * rect[2] / (atlas.sourceHeight * rect[3]) };
}

/** Clothing is authoritative upstream; neither air temperature nor cloud cover
 * may silently replace the outfit the selected native hour already chose.
 */
export function selectCharacterPose(scene = {}) {
  if (scene.showPerson === false) return null;
  if (scene.precipitation === 'rain') return scene.umbrella ? 'rain' : 'rain-hood';
  if (scene.precipitation === 'snow') return 'snow';
  return ['hot', 'mild', 'cool', 'cold'].includes(scene.garment) ? scene.garment : 'cool';
}

function cloudCoverage(frame, scene) {
  const measured = frame.cloudCover;
  if (measured !== null && measured !== undefined && measured !== '' && Number.isFinite(Number(measured))) return clamp(Number(measured) / 100, 0, 1);
  const code = frame.weatherCode === null || frame.weatherCode === undefined ? -1 : Number(frame.weatherCode);
  return scene.precipitation || [3, 45, 48, 95, 96, 97, 99].includes(code) ? .95 : code === 2 ? .65 : code === 1 ? .20 : 0;
}

/** Matching wardrobe cells exist in independently lit day and night artwork.
 * Each lighting plate has its own safe crop. Sky conditions and solar lighting
 * never select a different garment.
 */
export function getCharacterScene(characterId, scene = {}, frame = {}) {
  const character = normalizeCharacter(characterId), atlas = CHARACTER_SCENE_ATLASES[character];
  const pose = selectCharacterPose(scene), index = slots[pose || 'shelter'];
  const { asset, ...weather } = scene;
  const bodyBounds = character === 'asian' ? [.38, .09, .62, .98] : [.38, .05, .62, .98];
  const personBounds = scene.umbrella ? [.30, 0, .70, .98] : bodyBounds;
  const dayRect = sceneCell(index, atlas), nightRect = sceneCell(index, atlas, true);
  return { ...weather, character, pose, index, key: `${character}:${pose || 'shelter'}`,
    file: atlas.dayFile, dayFile: atlas.dayFile, nightFile: atlas.nightFile, rect: dayRect, dayRect, nightRect,
    sourceWidth: atlas.sourceWidth, sourceHeight: atlas.sourceHeight,
    nightSourceWidth: atlas.nightSourceWidth, nightSourceHeight: atlas.nightSourceHeight,
    grid: { columns: atlas.columns, rows: atlas.rows, dayRowEdges: atlas.dayRowEdges, nightRowEdges: atlas.nightRowEdges },
    personBounds: pose ? personBounds : null, bodyBounds: pose ? bodyBounds : null, flagBounds: null, personX: .5,
    showPerson: pose !== null, integrated: true, skyAlpha: true, imageRegistration: 'paired-foreground',
    framing: 'environment', foregroundHeightRatio: .75, closePortrait: false,
    sourceSkyHorizon: .30, skyHorizon: .475, cloudCover: cloudCoverage(frame, scene), gradeNight: false };
}

/** Natural proportions, a medium-distance person and room for an actual sky.
 * The UI limits the scene to at most 5:4; portrait viewports crop park sides.
 * No mirrored fill, stretched edge pixels or cover zoom is introduced here.
 */
export function computeIntegratedSceneLayout({ viewportWidth, viewportHeight, sourceWidth, sourceHeight, scene = {} } = {}) {
  const width = positive(viewportWidth, 1), height = positive(viewportHeight, 1), rect = scene.rect || [0, 0, 1, 1];
  const cellWidth = positive(sourceWidth, scene.sourceWidth || 1536) * rect[2];
  const cellHeight = positive(sourceHeight, scene.sourceHeight || 1024) * rect[3];
  const imageHeight = height * clamp(positive(scene.foregroundHeightRatio, .75), .1, 1);
  const scale = imageHeight / cellHeight, imageWidth = cellWidth * scale, left = (width - imageWidth) / 2, top = height - imageHeight;
  const bounds = scene.personBounds;
  return { scale, imageWidth, imageHeight, left, top, cellWidth, cellHeight,
    uvScale: [width / imageWidth, height / imageHeight], uvOffset: [-left / imageWidth, -top / imageHeight],
    subject: bounds ? { left: left + bounds[0] * imageWidth, top: top + bounds[1] * imageHeight,
      right: left + bounds[2] * imageWidth, bottom: top + bounds[3] * imageHeight } : null };
}
