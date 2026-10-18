import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, CHARACTER_POSES, CHARACTER_ATLASES, normalizeCharacter, selectCharacterPose, computeCharacterLayout } from '../public/weather-fusion/player/character-scene.js';
import { selectPhotoScene } from '../public/weather-fusion/player/photo-scene.js';

test('all four selectable people have independent atlases and a safe default', () => {
  assert.deepEqual(CHARACTERS.map(person => person.id), ['white', 'black', 'asian', 'pride']);
  assert.equal(new Set(CHARACTERS.map(person => person.file)).size, 4);
  for (const person of CHARACTERS) assert.equal(normalizeCharacter(person.id), person.id);
  assert.equal(normalizeCharacter('unknown-person'), 'white');
});

test('the selected native rain, wind and storm policy controls every character outfit', () => {
  const wetNight = { nativePolicy: true, weatherCode: 61, temperature: 56, feelsLike: 49, isDay: false, windSpeed: 10, windGust: 15 };
  assert.equal(selectCharacterPose(selectPhotoScene(wetNight, { rain: true, umbrella: true, garment: 'cool' })), 'rain');
  assert.equal(selectCharacterPose(selectPhotoScene({ ...wetNight, windGust: 40 }, { rain: true, umbrella: true, garment: 'cool' })), 'rain-hood');
  assert.equal(selectCharacterPose(selectPhotoScene(wetNight, { storm: true, rain: true, umbrella: true })), null);
  assert.equal(selectCharacterPose(selectPhotoScene(wetNight, { possibleRain: true, rain: false, garment: 'cool' })), 'cool');
  assert.equal(selectCharacterPose(selectPhotoScene({ ...wetNight, weatherCode: 73 }, { snow: true, garment: 'cold' })), 'cold');
});

test('day and night use the same appropriate clothing without changing person identity', () => {
  for (const garment of ['hot', 'mild', 'cool', 'cold']) {
    const frame = { nativePolicy: true, weatherCode: 0, temperature: 70, feelsLike: 70 };
    assert.equal(selectCharacterPose(selectPhotoScene({ ...frame, isDay: true }, { garment })), garment);
    assert.equal(selectCharacterPose(selectPhotoScene({ ...frame, isDay: false }, { garment })), garment);
  }
});

test('every full-body outfit fits narrow and wide scenes at natural image proportions', () => {
  for (const character of CHARACTERS) for (const pose of CHARACTER_POSES) {
    for (const [viewportWidth, viewportHeight] of [[280, 560], [390, 580], [1280, 520]]) {
      const layout = computeCharacterLayout({ viewportWidth, viewportHeight, character: character.id, pose, sourceWidth: 1536, sourceHeight: 1024 });
      assert.ok(layout.left >= 0 && layout.left + layout.width <= viewportWidth, `${character.id}/${pose} must fit horizontally`);
      assert.ok(layout.top >= 0 && layout.top + layout.height <= viewportHeight, `${character.id}/${pose} must retain head and feet`);
      assert.ok(Math.abs(layout.imageWidth / layout.imageHeight - 1.5) < .00001, 'the atlas must not stretch');
      assert.ok(layout.feetY >= viewportHeight * .8 && layout.feetY <= viewportHeight * .91, 'feet must rest on the same ground');
    }
  }
});

test('outfit clipping keeps only the selected silhouette, including umbrellas across nominal grid boundaries', () => {
  for (const character of CHARACTERS) CHARACTER_POSES.forEach((pose, index) => {
    const layout = computeCharacterLayout({ viewportWidth: 390, viewportHeight: 580, character: character.id, pose, sourceWidth: 1536, sourceHeight: 1024 });
    const sourceLeft = -layout.imageLeft / layout.scale, sourceTop = -layout.imageTop / layout.scale;
    const sourceRight = sourceLeft + layout.width / layout.scale, sourceBottom = sourceTop + layout.height / layout.scale;
    const bounds = CHARACTER_ATLASES[character.id].bounds[index];
    assert.ok(Math.abs(sourceLeft - bounds[0] * 1536) < .00001);
    assert.ok(Math.abs(sourceTop - bounds[1] * 1024) < .00001);
    assert.ok(Math.abs(sourceRight - bounds[2] * 1536) < .00001);
    assert.ok(Math.abs(sourceBottom - bounds[3] * 1024) < .00001);
    CHARACTER_ATLASES[character.id].bounds.forEach((other, otherIndex) => {
      if (otherIndex === index) return;
      assert.ok(bounds[2] <= other[0] || bounds[0] >= other[2] || bounds[3] <= other[1] || bounds[1] >= other[3], `${character.id}/${pose} must not include another outfit`);
    });
  });
});
