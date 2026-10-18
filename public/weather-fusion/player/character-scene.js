/** Select complete photographic scenes: person, clothing and landscape together. */
import { computePhotoLayout } from './photo-scene.js';

export const CHARACTERS = Object.freeze([
  { id: 'white', name: 'Emma' },
  { id: 'black', name: 'Maya' },
  { id: 'asian', name: 'Mei' },
  { id: 'pride', name: 'Alex' }
].map(character => Object.freeze(character)));
export const CHARACTER_POSES = Object.freeze(['hot', 'mild', 'cool', 'cold', 'rain', 'rain-hood']);
export const CHARACTER_SCENE_ATLASES = Object.freeze({
  black: Object.freeze({ file: '../player-maya-scenes.webp', columns: 3, rows: 2 }),
  asian: Object.freeze({ file: '../player-mei-scenes.webp', columns: 3, rows: 2 }),
  pride: Object.freeze({ file: '../player-alex-scenes.webp', columns: 3, rows: 2 })
});
const winterFile = '../player-winter-scenes.webp';
const sceneCell = index => [((index % 3) * 512 + 2) / 1536, (Math.floor(index / 3) * 512 + 2) / 1024, 508 / 1536, 508 / 1024];


export function normalizeCharacter(id) {
  return CHARACTERS.some(character => character.id === id) ? id : 'white';
}

/** Portraits reuse the matching complete photograph rather than extra artwork.
 * rect is [left, top, right, bottom]; face is relative to that selected cell.
 */
export function getCharacterPortrait(id) {
  const character = normalizeCharacter(id);
  return character === 'white'
    ? { file: './assets/photo-mild.webp', rect: [0, 0, 1, 1], face: [.505, .45], cellAspect: 1.5 }
    : { file: CHARACTER_SCENE_ATLASES[character].file, rect: [514 / 1536, 2 / 1024, 1022 / 1536, 510 / 1024], face: [.5, character === 'asian' ? .30 : .27], cellAspect: 1 };
}

/** Reuse the native outfit policy without estimating weather a second time. */
export function selectCharacterPose(scene = {}) {
  if (scene.showPerson === false) return null;
  if (scene.precipitation === 'rain') return scene.umbrella ? 'rain' : 'rain-hood';
  if (scene.precipitation === 'snow') return 'cold';
  return ['hot', 'mild', 'cool', 'cold'].includes(scene.garment) ? scene.garment : 'cool';
}

/** Rectangles are [left, top, width, height] in whole-image coordinates. */
export function getCharacterScene(characterId, scene = {}, frame = {}) {
  const character = normalizeCharacter(characterId), pose = selectCharacterPose(scene);
  const knownCloudCover = frame.cloudCover !== null && frame.cloudCover !== undefined && frame.cloudCover !== '' && Number.isFinite(Number(frame.cloudCover));
  const code = frame.weatherCode === null || frame.weatherCode === undefined ? -1 : Number(frame.weatherCode);
  const cloudCover = knownCloudCover ? Math.max(0,Math.min(1,Number(frame.cloudCover) / 100)) : scene.precipitation || [3,45,48,95,96,97,99].includes(code) ? .95 : code === 2 ? .65 : code === 1 ? .20 : 0;
  const common = { ...scene, character, pose, cloudCover, key: `${character}:${scene.key || pose}:${scene.night ? 'night' : 'day'}` };
  if (!pose || character === 'white') {
    return { ...common, file: scene.asset.file, rect: [0, 0, 1, 1], personBounds: scene.asset.personBounds,
      personX: scene.asset.personX, integrated: true, gradeNight: scene.gradeNight === true };
  }
  const snowy = scene.precipitation === 'snow', atlas = CHARACTER_SCENE_ATLASES[character];
  const index = snowy ? ['black', 'asian', 'pride'].indexOf(character) : Math.max(0, CHARACTER_POSES.indexOf(pose));
  const clearCoat = !snowy && ['cool','cold'].includes(pose) && cloudCover < .45;
  const clearIndex = ['black','asian','pride'].indexOf(character) + (pose === 'cold' ? 3 : 0);
  const rect = snowy ? [(index * 724 + 2) / 2172, 2 / 724, 720 / 2172, 720 / 724] : sceneCell(clearCoat ? clearIndex : index);
  const headY = snowy ? .15 : clearCoat ? pose === 'cold' ? .15 : .20 : character === 'black' ? ['cold', 'rain', 'rain-hood'].includes(pose) ? .18 : .21 : character === 'pride' ? .20 : .24;
  const bodyBounds = snowy ? [.29, headY, .68, .96] : [.34, headY, .66, .95];
  const personBounds = scene.umbrella ? [.22, character === 'black' ? .025 : character === 'pride' ? .055 : .13, .80, .95] : bodyBounds;
  const flagBounds = character === 'pride' ? clearCoat ? pose === 'cold' ? [.31,.26,.46,.40] : [.29,.27,.43,.42] : snowy ? [.29,.22,.46,.41] : scene.precipitation === 'rain' ? [.29,.31,.44,.49] : [.29,.28,.45,.44] : null;
  return { ...common, key: `${common.key}:${clearCoat ? 'clear-coat' : 'original'}`, file: snowy ? winterFile : clearCoat ? '../player-clear-cool-cold-scenes.webp' : atlas.file, rect, personBounds, bodyBounds, flagBounds, personX: .5,
    integrated: true, gradeNight: scene.night === true };
}

/** Keep full people and umbrellas at their original photographic proportions. */
export function computeIntegratedSceneLayout({ viewportWidth, viewportHeight, sourceWidth, sourceHeight, scene } = {}) {
  const rect = scene.rect || [0, 0, 1, 1];
  const cellWidth = sourceWidth * rect[2], cellHeight = sourceHeight * rect[3];
  return { ...computePhotoLayout({ viewportWidth, viewportHeight, sourceWidth: cellWidth, sourceHeight: cellHeight,
    personX: scene.personX, subjectBounds: scene.personBounds }), cellWidth, cellHeight };
}
