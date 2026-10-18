import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, CHARACTER_POSES, normalizeCharacter, selectCharacterPose, getCharacterScene, getCharacterPortrait, computeIntegratedSceneLayout } from '../public/weather-fusion/player/character-scene.js';
import { selectPhotoScene, createLatestRequestGate } from '../public/weather-fusion/player/photo-scene.js';

const native = { nativePolicy: true, weatherCode: 0, temperature: 70, feelsLike: 70, isDay: true, windSpeed: 5, windGust: 8, cloudCover: 35 };
const sceneFor = (id, frame = native, outfit = { garment: 'mild' }) => getCharacterScene(id, selectPhotoScene(frame, outfit), frame);

test('four named choices resolve only to integrated photographic sources', () => {
  assert.deepEqual(CHARACTERS.map(person => person.name), ['Emma', 'Maya', 'Mei', 'Alex']);
  for (const person of CHARACTERS) {
    assert.equal(normalizeCharacter(person.id), person.id);
    const scene = sceneFor(person.id);
    assert.equal(scene.integrated, true);
    assert.doesNotMatch(scene.file, /person-|alpha|empty/);
  }
  assert.equal(normalizeCharacter('unknown'), 'white');
});

test('choice portraits reuse each actual scene and crop inside grid seams', () => {
  for (const person of CHARACTERS) {
    const portrait = getCharacterPortrait(person.id), scene = sceneFor(person.id);
    assert.equal(portrait.file, scene.file);
    assert.doesNotMatch(portrait.file, /person-|alpha/);
    assert.ok(portrait.face[0] > 0 && portrait.face[0] < 1 && portrait.face[1] > 0 && portrait.face[1] < 1);
    if (person.id !== 'white') {
      assert.ok(portrait.rect[0] > 1 / 3 && portrait.rect[2] < 2 / 3);
      assert.ok(portrait.rect[1] > 0 && portrait.rect[3] < .5);
    }
  }
});

test('native rain, wind and storm decisions choose coherent clothing and shelter', () => {
  const rain = { ...native, weatherCode: 61, isDay: false, precipitation: .1 };
  for (const person of CHARACTERS) {
    const umbrella = sceneFor(person.id, rain, { rain: true, umbrella: true, garment: 'cool' });
    assert.equal(umbrella.pose, 'rain');
    const windy = sceneFor(person.id, { ...rain, windGust: 40 }, { rain: true, umbrella: true, garment: 'cool' });
    assert.equal(windy.pose, 'rain-hood');
    assert.notDeepEqual(umbrella.rect.concat(umbrella.file), windy.rect.concat(windy.file));
    const shelter = sceneFor(person.id, rain, { storm: true, rain: true });
    assert.equal(selectCharacterPose(shelter), null);
    assert.equal(shelter.showPerson, false);
    assert.match(shelter.file, /photo-storm/);
  }
});

test('each identity keeps its winter scene and cloud cover uses measured or supported qualitative guidance', () => {
  const snow = { ...native, weatherCode: 73, temperature: 29, feelsLike: 20 };
  const snowy = CHARACTERS.map(person => sceneFor(person.id, snow, { snow: true, garment: 'cold' }));
  assert.match(snowy[0].file, /photo-snow/);
  assert.ok(snowy.slice(1).every(scene => /winter-scenes/.test(scene.file)));
  assert.equal(new Set(snowy.slice(1).map(scene => scene.rect.join(','))).size, 3);
  for (const scene of snowy.slice(1)) {
    const layout = computeIntegratedSceneLayout({ viewportWidth: 390, viewportHeight: 580, sourceWidth: 2172, sourceHeight: 724, scene });
    assert.equal(layout.cellWidth, 720); assert.equal(layout.cellHeight, 720);
    assert.ok(scene.rect[1] > 0 && scene.rect[1] + scene.rect[3] < 1);
  }
  assert.equal(sceneFor('asian').cloudCover, .35);
  assert.equal(sceneFor('asian', { ...native, cloudCover: null, weatherCode: 0 }).cloudCover, 0);
  assert.ok(sceneFor('asian', { ...native, cloudCover: null, weatherCode: 3 }).cloudCover > .8);
});

test('all six complete-scene atlas cells remain separate and retain full people on mobile and desktop', () => {
  for (const character of ['black', 'asian', 'pride']) for (const pose of CHARACTER_POSES) {
    const rain = pose.startsWith('rain');
    const scene = sceneFor(character, { ...native, weatherCode: rain ? 61 : 0 }, { rain, umbrella: pose === 'rain', garment: rain ? 'cool' : pose });
    for (const [viewportWidth, viewportHeight] of [[280, 560], [390, 580], [1280, 520]]) {
      const layout = computeIntegratedSceneLayout({ viewportWidth, viewportHeight, sourceWidth: 1536, sourceHeight: 1024, scene });
      assert.equal(layout.cellWidth, 508); assert.equal(layout.cellHeight, 508);
      assert.ok(Math.abs(layout.imageWidth / layout.imageHeight - 1) < .00001, 'complete square scene must keep its photographic proportions');
      assert.ok(layout.subject.left >= -0.001 && layout.subject.right <= viewportWidth + .001, `${character}/${pose} must retain the entire person and umbrella`);
      assert.ok(layout.subject.top >= -0.001 && layout.subject.bottom <= viewportHeight + .001);
    }
    assert.ok(scene.rect[0] >= 0 && scene.rect[0] + scene.rect[2] <= 1);
    assert.ok(scene.rect[1] >= 0 && scene.rect[1] + scene.rect[3] <= 1);
  }
});

test('night changes full-scene grading while retaining the selected identity', () => {
  for (const id of ['black', 'asian', 'pride']) {
    const day = sceneFor(id), night = sceneFor(id, { ...native, isDay: false });
    assert.equal(day.gradeNight, false); assert.equal(night.gradeNight, true);
    assert.equal(day.file, night.file); assert.equal(night.character, id);
  }
  const originalNight = sceneFor('white', { ...native, isDay: false });
  assert.match(originalNight.file, /photo-night/);
  assert.equal(originalNight.gradeNight, false, 'original night photograph must not receive the daytime night conversion');
});

test('late scene completion cannot overwrite a newer person or forecast hour', () => {
  const gate = createLatestRequestGate();
  const oldHour = gate.next(), oldPerson = gate.next(), latest = gate.next();
  assert.equal(gate.isCurrent(oldHour), false); assert.equal(gate.isCurrent(oldPerson), false);
  assert.equal(gate.isCurrent(latest), true); gate.dispose(); assert.equal(gate.isCurrent(latest), false);
});


test('clear cool and cold hours select genuine clear photographic variants for each identity', () => {
  for (const id of ['black','asian','pride']) for (const garment of ['cool','cold']) {
    const clear=sceneFor(id,{...native,cloudCover:20},{garment});
    const cloudy=sceneFor(id,{...native,cloudCover:95},{garment});
    assert.match(clear.file,/player-clear-cool-cold-scenes\.webp/);
    assert.doesNotMatch(cloudy.file,/clear-cool-cold/);
    assert.notEqual(clear.key,cloudy.key,'a sky-source change must crossfade too');
    assert.equal(clear.integrated,true);assert.equal(cloudy.integrated,true);
  }
});
