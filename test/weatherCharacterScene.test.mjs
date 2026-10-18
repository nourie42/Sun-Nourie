import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, CHARACTER_POSES, CHARACTER_SCENE_ATLASES, normalizeCharacter, selectCharacterPose, getCharacterScene, getCharacterPortrait, computeIntegratedSceneLayout } from '../public/weather-fusion/player/character-scene.js';
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
    {
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
  assert.match(snowy[0].file, /emma-blue-eyes-scenes/);
  assert.match(snowy[1].file, /maya-reference-scenes/);
  assert.ok(snowy.slice(2).every(scene => /winter-scenes/.test(scene.file)));
  assert.equal(new Set(snowy.map(scene => [scene.file,...scene.rect].join(','))).size, 4);
  for (const [index,scene] of snowy.entries()) {
    const layout = computeIntegratedSceneLayout({ viewportWidth: 390, viewportHeight: 580, sourceWidth: index<2?1254:2172, sourceHeight: index<2?1254:724, scene });
    assert.equal(layout.cellWidth, index<2?414:720); assert.equal(layout.cellHeight, index<2?414:720);
    assert.ok(scene.rect[1] > 0 && scene.rect[1] + scene.rect[3] < 1);
  }
  assert.equal(sceneFor('asian').cloudCover, .35);
  assert.equal(sceneFor('asian', { ...native, cloudCover: null, weatherCode: 0 }).cloudCover, 0);
  assert.ok(sceneFor('asian', { ...native, cloudCover: null, weatherCode: 3 }).cloudCover > .8);
});

test('all outfit photographs preserve intended framing and umbrellas on mobile and desktop', () => {
  for (const character of ['white', 'black', 'asian', 'pride']) for (const pose of CHARACTER_POSES) {
    const rain = pose.startsWith('rain');
    const scene = sceneFor(character, { ...native, weatherCode: rain ? 61 : 0 }, { rain, umbrella: pose === 'rain', garment: rain ? 'cool' : pose });
    for (const [viewportWidth, viewportHeight] of [[280, 560], [390, 580], [1280, 520]]) {
      const layout = computeIntegratedSceneLayout({ viewportWidth, viewportHeight, sourceWidth: (CHARACTER_SCENE_ATLASES[character].cellSize||512)*3, sourceHeight: CHARACTER_SCENE_ATLASES[character].rows*(CHARACTER_SCENE_ATLASES[character].cellSize||512), scene });
      const expectedCell=(CHARACTER_SCENE_ATLASES[character].cellSize||512)-4;
      assert.equal(layout.cellWidth, expectedCell); assert.equal(layout.cellHeight, expectedCell);
      assert.ok(Math.abs(layout.imageWidth / layout.imageHeight - 1) < .00001, 'complete square scene must keep its photographic proportions');
      if (scene.closePortrait) {
        assert.equal(layout.top,0);
        assert.ok(layout.imageWidth>=viewportWidth && layout.imageHeight>=viewportHeight,'cover must fill the viewport with actual photograph pixels');
        assert.ok(layout.uvScale.every(value=>value>0&&value<=1));
        assert.ok(layout.uvOffset.every(value=>value>=0));
        assert.ok(layout.uvOffset[0]+layout.uvScale[0]<=1.000001);
        assert.ok(layout.uvOffset[1]+layout.uvScale[1]<=1.000001);
        const face=getCharacterPortrait(character).face,faceX=layout.left+face[0]*layout.imageWidth,faceY=face[1]*layout.imageHeight;
        assert.ok(faceX>0&&faceX<viewportWidth&&faceY>0&&faceY<viewportHeight,'intentional portrait cropping must keep the face visible');
        assert.ok(layout.subject.top>=0&&layout.subject.top<viewportHeight,'head and cap must remain in frame');
      } else {
        assert.ok(layout.subject.left >= -0.001 && layout.subject.right <= viewportWidth + .001, `${character}/${pose} must retain the intended portrait crop and umbrella`);
        assert.ok(layout.subject.top >= -0.001 && layout.subject.bottom <= viewportHeight + .001);
      }
    }
    assert.ok(scene.rect[0] >= 0 && scene.rect[0] + scene.rect[2] <= 1);
    assert.ok(scene.rect[1] >= 0 && scene.rect[1] + scene.rect[3] <= 1);
  }
});

test('night changes full-scene grading while retaining the selected identity', () => {
  for (const id of ['white', 'black', 'asian', 'pride']) {
    const day = sceneFor(id), night = sceneFor(id, { ...native, isDay: false });
    assert.equal(day.gradeNight, false); assert.equal(night.gradeNight, true);
    assert.equal(day.file, night.file); assert.equal(night.character, id);
  }

});

test('late scene completion cannot overwrite a newer person or forecast hour', () => {
  const gate = createLatestRequestGate();
  const oldHour = gate.next(), oldPerson = gate.next(), latest = gate.next();
  assert.equal(gate.isCurrent(oldHour), false); assert.equal(gate.isCurrent(oldPerson), false);
  assert.equal(gate.isCurrent(latest), true); gate.dispose(); assert.equal(gate.isCurrent(latest), false);
});


test('clear and cloudy cool/cold hours use distinct coherent photographs for every identity', () => {
  for (const id of ['white','black','asian','pride']) for (const garment of ['cool','cold']) {
    const clear=sceneFor(id,{...native,cloudCover:20},{garment});
    const cloudy=sceneFor(id,{...native,cloudCover:95},{garment});
    if (['white','black'].includes(id)) {
      assert.equal(clear.file,cloudy.file);assert.notDeepEqual(clear.rect,cloudy.rect);
    } else {
      assert.match(clear.file,/player-clear-cool-cold-scenes\.webp/);
      assert.doesNotMatch(cloudy.file,/clear-cool-cold/);
    }
    assert.notEqual(clear.key,cloudy.key,'a sky-source change must crossfade too');
    assert.equal(clear.integrated,true);assert.equal(cloudy.integrated,true);
  }
});

test('Emma and Maya retain the new identity through all nine weather photographs by day and night', () => {
  const cases=[
    [{cloudCover:0},{garment:'hot'}],
    [{cloudCover:20},{garment:'mild'}],
    [{cloudCover:95},{garment:'cool'}],
    [{cloudCover:95},{garment:'cold'}],
    [{weatherCode:61,cloudCover:100},{rain:true,umbrella:true,garment:'cool'}],
    [{weatherCode:61,cloudCover:100,windGust:40},{rain:true,umbrella:true,garment:'cool'}],
    [{cloudCover:0},{garment:'cool'}],
    [{cloudCover:0},{garment:'cold'}],
    [{weatherCode:73,cloudCover:100},{snow:true,garment:'cold'}]
  ];
  for(const id of ['white','black'])for(const isDay of [true,false]){
    const scenes=cases.map(([values,clothing])=>sceneFor(id,{...native,...values,isDay},clothing));
    assert.ok(scenes.every(scene=>scene.file===CHARACTER_SCENE_ATLASES[id].file));
    assert.equal(new Set(scenes.map(scene=>scene.rect.join(','))).size,9);
    assert.ok(scenes.every(scene=>scene.gradeNight===!isDay));
    assert.ok(scenes.every(scene=>scene.closePortrait===true));
    assert.deepEqual(getCharacterPortrait(id).face,id==='white'?[.5,.23]:[.54,.22]);
  }
});
