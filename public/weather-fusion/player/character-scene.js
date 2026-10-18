/** Select complete photographic scenes: person, clothing and landscape together. */
import { computePhotoLayout } from './photo-scene.js?v=named-scenes-v3';

export const CHARACTERS = Object.freeze([
  { id: 'white', name: 'Emma' },
  { id: 'black', name: 'Maya' },
  { id: 'asian', name: 'Mei' },
  { id: 'pride', name: 'Alex' }
].map(character => Object.freeze(character)));
export const CHARACTER_POSES = Object.freeze(['hot', 'mild', 'cool', 'cold', 'rain', 'rain-hood']);
export const CHARACTER_SCENE_ATLASES = Object.freeze({
  white: Object.freeze({ file: '../player-emma-blue-eyes-scenes.webp', columns: 3, rows: 3, cellSize: 418, namedPoses: true }),
  black: Object.freeze({ file: '../player-maya-reference-scenes.webp', columns: 3, rows: 3, cellSize: 418, namedPoses: true }),
  asian: Object.freeze({ file: '../player-mei-scenes.webp', columns: 3, rows: 2 }),
  pride: Object.freeze({ file: '../player-alex-scenes.webp', columns: 3, rows: 2 })
});
const winterFile = '../player-winter-scenes.webp';
const sceneCell = (index, rows = 2, cellSize = 512) => [((index % 3) * cellSize + 2) / (cellSize * 3), (Math.floor(index / 3) * cellSize + 2) / (cellSize * rows), (cellSize - 4) / (cellSize * 3), (cellSize - 4) / (cellSize * rows)];


export function normalizeCharacter(id) {
  return CHARACTERS.some(character => character.id === id) ? id : 'white';
}

/** Portraits reuse the matching complete photograph rather than extra artwork.
 * rect is [left, top, right, bottom]; face is relative to that selected cell.
 */
export function getCharacterPortrait(id) {
  const character = normalizeCharacter(id), atlas = CHARACTER_SCENE_ATLASES[character], rect = sceneCell(1, atlas.rows, atlas.cellSize);
  return { file: atlas.file, rect: [rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]],
    face: character === 'white' ? [.5,.23] : character === 'black' ? [.54,.22] : [.5,character === 'asian' ? .30 : .27], cellAspect: 1 };
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
  if (!pose) {
    return { ...common, file: scene.asset.file, rect: [0, 0, 1, 1], personBounds: scene.asset.personBounds,
      personX: scene.asset.personX, integrated: true, gradeNight: scene.gradeNight === true };
  }
  const snowy = scene.precipitation === 'snow', atlas = CHARACTER_SCENE_ATLASES[character];
  if (atlas.namedPoses) {
    const clear = cloudCover < .45;
    const index = snowy ? 8 : pose === 'rain' ? 4 : pose === 'rain-hood' ? 5
      : pose === 'cool' ? clear ? 6 : 2 : pose === 'cold' ? clear ? 7 : 3 : pose === 'hot' ? 0 : 1;
    const headY = character === 'black' ? [.075,.075,.075,.025,.12,.075,.075,.035,.065][index] : [.10,.10,.10,.08,.11,.075,.09,.06,.06][index];
    const bodyBounds = [.20, headY, .82, .99];
    const personBounds = scene.umbrella ? [.03, 0, .97, .99] : bodyBounds;
    return { ...common, key: `${common.key}:named-${index}`, file: atlas.file, rect: sceneCell(index, atlas.rows, atlas.cellSize),
      personBounds, bodyBounds, flagBounds: null, personX: .5, closePortrait: true, integrated: true, gradeNight: scene.night === true };
  }
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

/** Preserve each scene’s intended framing and complete umbrellas without stretching. */
export function computeIntegratedSceneLayout({ viewportWidth, viewportHeight, sourceWidth, sourceHeight, scene } = {}) {
  const rect = scene.rect || [0, 0, 1, 1];
  const cellWidth = sourceWidth * rect[2], cellHeight = sourceHeight * rect[3];
  if (scene.closePortrait) {
    const width = Math.max(1, Number(viewportWidth) || 1), height = Math.max(1, Number(viewportHeight) || 1);
    const scale = Math.max(width / cellWidth, height / cellHeight), imageWidth = cellWidth * scale, imageHeight = cellHeight * scale;
    const left = (width - imageWidth) / 2, bounds = scene.personBounds;
    return { scale, imageWidth, imageHeight, left, top: 0, cellWidth, cellHeight,
      uvScale: [width / imageWidth, height / imageHeight], uvOffset: [-left / imageWidth, 0],
      subject: { left: left + bounds[0] * imageWidth, top: bounds[1] * imageHeight, right: left + bounds[2] * imageWidth, bottom: bounds[3] * imageHeight } };
  }
  return { ...computePhotoLayout({ viewportWidth, viewportHeight, sourceWidth: cellWidth, sourceHeight: cellHeight,
    personX: scene.personX, subjectBounds: scene.personBounds }), cellWidth, cellHeight };
}
