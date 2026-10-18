import test from 'node:test';
import assert from 'node:assert/strict';

// These checks exercise the player’s pure exports without constructing a DOM.
globalThis.HTMLElement??=class {};
globalThis.customElements??={get(){return true;},define(){}};
const {playbackFrameDelay,outfitTransitions}=await import('../public/weather-fusion/player/sky-player.js');

test('playback keeps its selected speed when no photograph has just settled',()=>{
  assert.equal(playbackFrameDelay(32,null,1000),62.5);
  assert.equal(playbackFrameDelay(4,null,1000),500);
  assert.equal(playbackFrameDelay(1,null,1000),2000);
  for(const missing of [undefined,null,NaN,Infinity]){
    assert.equal(playbackFrameDelay(32,missing,1000),62.5);
  }
});

test('fast playback gives a newly settled outfit time to remain visible',()=>{
  assert.equal(playbackFrameDelay(32,0,0),700,'zero is a valid monotonic timestamp');
  assert.equal(playbackFrameDelay(32,1000,1000),700);
  assert.equal(playbackFrameDelay(32,1000,1300),400);
  assert.equal(playbackFrameDelay(32,1000,1700),62.5);
  assert.equal(playbackFrameDelay(32,1000,2000),62.5);
});

test('the outfit visibility allowance never speeds up slower playback',()=>{
  assert.equal(playbackFrameDelay(4,1000,1300),500);
  assert.equal(playbackFrameDelay(1,1000,1000),2000);
  assert.equal(playbackFrameDelay(1,1000,1300),2000);
});

const frames=values=>values.map((feelsLike,index)=>({
  time:new Date(Date.parse('2026-10-18T16:00:00Z')+index*3600000).toISOString(),
  temperature:95,feelsLike,weatherCode:0,isDay:true
}));

test('outfit markers follow real wardrobe changes rather than legacy image filenames',()=>{
  assert.deepEqual(outfitTransitions(frames([74,75,80,87.9,88])),[],
    'warm and hot guidance share the existing top-and-shorts wardrobe');
  const changes=outfitTransitions(frames([64.9,65,73.9,74,87.9,88]));
  assert.deepEqual(changes.map(change=>change.index),[1,3]);
  assert.deepEqual(changes.map(change=>change.outfit.garment),['mild','warm']);
  assert.deepEqual(outfitTransitions(frames([41.9,42])).map(change=>change.index),[1]);
});
