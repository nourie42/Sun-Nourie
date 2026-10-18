import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, CHARACTER_POSES, CHARACTER_SCENE_ATLASES, normalizeCharacter, selectCharacterPose, getCharacterScene, getCharacterPortrait, computeIntegratedSceneLayout } from '../public/weather-fusion/player/character-scene.js';
import { selectPhotoScene, createLatestRequestGate } from '../public/weather-fusion/player/photo-scene.js';

const native = { nativePolicy: true, weatherCode: 0, temperature: 70, feelsLike: 70, isDay: true, windSpeed: 5, windGust: 8, cloudCover: 35 };
const sceneFor = (id, frame = native, outfit = { garment: 'mild' }) => getCharacterScene(id, selectPhotoScene(frame, outfit), frame);
const assertRect = rect => {
  assert.ok(rect.every(Number.isFinite));
  assert.ok(rect[0] >= 0 && rect[1] >= 0 && rect[2] > 0 && rect[3] > 0);
  assert.ok(rect[0] + rect[2] <= 1 && rect[1] + rect[3] <= 1);
};

test('stored choices keep their names and all resolve to paired sky-transparent environmental artwork', () => {
  assert.deepEqual(CHARACTERS.map(person => [person.id, person.name]), [['white', 'Emma'], ['black', 'Maya'], ['asian', 'Mei'], ['pride', 'Alex']]);
  for (const person of CHARACTERS) {
    assert.equal(normalizeCharacter(person.id), person.id);
    const scene = sceneFor(person.id);
    assert.equal(scene.file, scene.dayFile); assert.notEqual(scene.dayFile, scene.nightFile);
    assert.match(scene.dayFile, /-day-foreground\.webp$/); assert.match(scene.nightFile, /-night-foreground\.webp$/);
    assert.equal(scene.skyAlpha, true); assert.equal(scene.integrated, true);
    assert.equal(scene.imageRegistration, 'paired-foreground'); assert.equal(scene.gradeNight, false);
    assert.equal(scene.framing, 'environment'); assert.equal(scene.closePortrait, false);
    assert.equal('asset' in scene, false, 'no nested opaque old photograph can become a fallback');
  }
  assert.equal(normalizeCharacter('unknown'), 'white');
});

test('the gallery uses the explicit headshot cell and keeps its crop inside the grid', () => {
  for (const person of CHARACTERS) {
    const portrait = getCharacterPortrait(person.id), atlas = CHARACTER_SCENE_ATLASES[person.id];
    assert.equal(portrait.file, atlas.dayFile);
    assert.ok(portrait.rect[0] > 2 / 3 && portrait.rect[2] < 1);
    assert.ok(portrait.rect[1] > atlas.dayRowEdges[2] / atlas.sourceHeight);
    assert.ok(portrait.rect[3] < atlas.dayRowEdges[3] / atlas.sourceHeight);
    assert.ok(portrait.face.every(value => value > 0 && value < 1));
    assert.ok(portrait.cellAspect > 1.7 && portrait.cellAspect < 2.2);
    assert.notDeepEqual(portrait.rect, sceneFor(person.id).rect, 'a gallery headshot must never replace the environmental mild scene');
  }
});

test('native rain, strong wind, snow and storms select the right clothing or an empty park', () => {
  const rain = { ...native, weatherCode: 61, isDay: false, precipitation: .1 };
  for (const person of CHARACTERS) {
    const umbrella = sceneFor(person.id, rain, { rain: true, umbrella: true, garment: 'cool' });
    assert.equal(umbrella.pose, 'rain'); assert.equal(umbrella.index, 4);
    const windy = sceneFor(person.id, { ...rain, windGust: 40 }, { rain: true, umbrella: true, garment: 'cool' });
    assert.equal(windy.pose, 'rain-hood'); assert.equal(windy.index, 5);
    const snow = sceneFor(person.id, { ...native, weatherCode: 73, temperature: 29, feelsLike: 20 }, { snow: true, garment: 'cold' });
    assert.equal(snow.pose, 'snow'); assert.equal(snow.index, 6);
    const shelter = sceneFor(person.id, rain, { storm: true, rain: true });
    assert.equal(selectCharacterPose(shelter), null); assert.equal(shelter.showPerson, false); assert.equal(shelter.index, 7);
    assert.equal(shelter.personBounds, null); assert.equal(shelter.bodyBounds, null);
    assert.equal(shelter.dayFile, umbrella.dayFile); assert.notDeepEqual(shelter.rect, umbrella.rect);
  }
});

test('all seven wardrobe scenes keep identity and exact paired source crops through day and night', () => {
  for (const person of CHARACTERS) {
    const seen = new Set();
    for (const pose of CHARACTER_POSES) {
      const raining = pose.startsWith('rain'), snow = pose === 'snow';
      const outfit = { garment: snow || raining ? 'cold' : pose, snow, rain: raining, umbrella: pose === 'rain' };
      const day = sceneFor(person.id, native, outfit), night = sceneFor(person.id, { ...native, isDay: false }, outfit);
      assert.equal(day.character, person.id); assert.equal(night.character, person.id);
      assert.equal(day.pose, pose); assert.equal(night.pose, pose);
      assert.deepEqual(day.rect, night.rect); assert.equal(day.key, night.key);
      assert.deepEqual(day.rect, day.dayRect); assert.deepEqual(day.nightRect, night.nightRect);
      assertRect(day.dayRect); assertRect(day.nightRect);
      assert.equal(day.dayFile, night.dayFile); assert.equal(day.nightFile, night.nightFile);
      assert.equal(day.gradeNight, false); assert.equal(night.gradeNight, false, 'night is separately lit artwork rather than a day-image dimming filter');
      assertRect(day.rect); seen.add(day.rect.join(','));
    }
    assert.equal(seen.size, 7, 'every actual wardrobe/precipitation state has its own source cell');
  }
});

test('cloud changes and air temperature cannot override authoritative native light-jacket clothing', () => {
  for (const person of CHARACTERS) {
    const clear = sceneFor(person.id, { ...native, temperature: 53, feelsLike: 46, cloudCover: 0 }, { garment: 'cool' });
    const cloudy = sceneFor(person.id, { ...native, temperature: 30, feelsLike: 20, cloudCover: 100 }, { garment: 'cool' });
    assert.equal(clear.pose, 'cool'); assert.equal(cloudy.pose, 'cool');
    assert.equal(clear.index, 2); assert.equal(cloudy.index, 2); assert.deepEqual(clear.rect, cloudy.rect);
    assert.equal(clear.key, cloudy.key); assert.equal(clear.dayFile, cloudy.dayFile);
    assert.equal(clear.cloudCover, 0); assert.equal(cloudy.cloudCover, 1);
  }
  assert.equal(sceneFor('asian', { ...native, cloudCover: null, weatherCode: 0 }).cloudCover, 0);
  assert.ok(sceneFor('asian', { ...native, cloudCover: null, weatherCode: 3 }).cloudCover > .8);
});

test('environmental layout preserves source proportions, moderate figure size, ground and room for sky', () => {
  for (const person of CHARACTERS) for (const pose of CHARACTER_POSES) {
    const rain = pose.startsWith('rain'), snow = pose === 'snow';
    const scene = sceneFor(person.id, native, { garment: rain || snow ? 'cold' : pose, rain, snow, umbrella: pose === 'rain' });
    for (const [viewportWidth, viewportHeight] of [[280, 460], [390, 464], [600, 480], [1067, 854]]) {
      const layout = computeIntegratedSceneLayout({ viewportWidth, viewportHeight, scene });
      const atlas = CHARACTER_SCENE_ATLASES[person.id], row = Math.floor(scene.index / 3);
      const expectedHeight = atlas.dayRowEdges[row + 1] - atlas.dayRowEdges[row] - atlas.dayTopInsets[row] - atlas.inset;
      assert.equal(layout.cellWidth, 508); assert.equal(layout.cellHeight, expectedHeight);
      assert.equal(layout.imageHeight, viewportHeight * .75); assert.equal(layout.top, viewportHeight * .25);
      assert.ok(Math.abs(layout.imageWidth / layout.imageHeight - 508 / expectedHeight) < .000001, 'person and park must never be stretched');
      assert.ok(layout.imageWidth >= viewportWidth, 'the actual park fills every supported stage width without invented edge pixels');
      assert.ok(Math.abs(layout.top + layout.imageHeight - viewportHeight) < .000001, 'foreground ground stays anchored to the stage bottom');
      const body = scene.bodyBounds, top = layout.top + body[1] * layout.imageHeight, feet = layout.top + body[3] * layout.imageHeight;
      assert.ok(top >= viewportHeight * .28, 'medium-distance framing leaves substantial real sky above the head');
      assert.ok(feet <= viewportHeight && feet >= viewportHeight * .97);
      assert.ok((feet - top) / viewportHeight < .71, 'the figure must not return to a giant cover crop');
      const center = layout.left + scene.personX * layout.imageWidth;
      assert.ok(center >= viewportWidth * .49 && center <= viewportWidth * .51);
    }
  }
});

test('late scene completion cannot overwrite a newer person or forecast hour', () => {
  const gate = createLatestRequestGate();
  const oldHour = gate.next(), oldPerson = gate.next(), latest = gate.next();
  assert.equal(gate.isCurrent(oldHour), false); assert.equal(gate.isCurrent(oldPerson), false);
  assert.equal(gate.isCurrent(latest), true); gate.dispose(); assert.equal(gate.isCurrent(latest), false);
});
