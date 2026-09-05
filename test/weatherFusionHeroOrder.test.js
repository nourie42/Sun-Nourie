import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('forecast condition and overnight label sit directly below the hero temperature before the real-feel tile',()=>{
  const html=fs.readFileSync(new URL('../public/weather-fusion/index.html',import.meta.url),'utf8');
  const temperature=html.indexOf('id="temperature"');
  const condition=html.indexOf('id="condition"');
  const range=html.indexOf('id="high-low"');
  const observation=html.indexOf('id="observation-label"');
  const comfort=html.indexOf('id="skin-exposure"');
  assert.ok(temperature>=0&&condition>temperature&&range>condition&&observation>range&&comfort>observation);
});
