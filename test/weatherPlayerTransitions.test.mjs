import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// These checks exercise the player's pure exports without constructing a DOM.
globalThis.HTMLElement??=class {};
globalThis.customElements??={get(){return true;},define(){}};
const {playbackAdvanceDelay,playbackTiming,PLAYBACK_SPEEDS}=await import('../public/weather-fusion/player/sky-player.js');
const {photoDissolveMs,PLAY_DISSOLVE_MS,STEP_DISSOLVE_MS,supersededPhotoAction,PHOTO_ASSET_VERSION,APPROVED_PLAYER_VERSION}=await import('../public/weather-fusion/player/approved-weather-world.js');

test('weather and outfit changes dissolve slowly during playback and stay quick for manual steps',()=>{
  let slower=Infinity;
  for(const speed of PLAYBACK_SPEEDS){
    const ms=photoDissolveMs({playing:true,speed});
    assert.ok(ms>=500,`${speed}× is long enough to read as a dissolve rather than a cut`);
    assert.ok(ms<=slower,`${speed}× never dissolves more slowly than a slower speed`);
    slower=ms;
  }
  assert.equal(photoDissolveMs({playing:true,speed:4}),900,'the default speed');
  assert.equal(photoDissolveMs({playing:true,speed:7}),PLAY_DISSOLVE_MS[4],'an unknown speed uses the default');
  assert.equal(photoDissolveMs({playing:false,speed:32}),STEP_DISSOLVE_MS,'a tap or drag while paused');
  assert.ok(STEP_DISSOLVE_MS<photoDissolveMs({playing:true,speed:32}));
});

test('a photograph caught part-way through its dissolve is held unless it has barely started',()=>{
  assert.equal(supersededPhotoAction(0),'drop');
  assert.equal(supersededPhotoAction(0.049),'drop','under 5% visible, removing it is not a visible jump');
  assert.equal(supersededPhotoAction(0.05),'hold');
  assert.equal(supersededPhotoAction(0.6),'hold');
  assert.equal(supersededPhotoAction(NaN),'drop');
});

test('the dissolve happens inside the forecast hour instead of adding a stall',()=>{
  // 1×: a 1.2 s dissolve finishes well inside the 2 s hour, so nothing stalls.
  assert.equal(playbackAdvanceDelay(1,{frameShownAt:0,settledAt:600,now:1200}),800);
  // 4×: after a 0.9 s dissolve the new outfit stays 0.7 s from its midpoint.
  assert.equal(playbackAdvanceDelay(4,{frameShownAt:0,settledAt:450,now:900}),250);
  // 32×: a changed outfit still gets its readable time.
  assert.equal(playbackAdvanceDelay(32,{frameShownAt:0,settledAt:280,now:560}),420);
  // Hours without a new photograph keep the exact forecast pace.
  assert.equal(playbackAdvanceDelay(4,{frameShownAt:1000,settledAt:0,now:1000}),500);
  assert.equal(playbackAdvanceDelay(16,{frameShownAt:1000,settledAt:null,now:1010}),playbackTiming(16).millisecondsPerHour-10);
  // Missing or invalid clocks fall back to the plain forecast pace.
  assert.equal(playbackAdvanceDelay(2,{}),1000);
  assert.equal(playbackAdvanceDelay(2,{frameShownAt:NaN,settledAt:Infinity,now:100}),1000);
});

test('the unchanged photographs keep their URLs while the page loads the new player code',()=>{
  assert.equal(PHOTO_ASSET_VERSION,'approved-her-consistent-v6','the artwork is unchanged since v6');
  assert.notEqual(APPROVED_PLAYER_VERSION,PHOTO_ASSET_VERSION);
  const read=name=>readFileSync(new URL(`../public/weather-fusion/${name}`,import.meta.url),'utf8');
  for(const [file,pattern] of [
    ['index.html',/\/weather-fusion\/app\.js\?v=([\w-]+)/],
    ['app.js',/native-player\.js\?v=([\w-]+)/],
    ['native-player.js',/sky-player\.js\?v=([\w-]+)/],
    ['player/sky-player.js',/approved-weather-world\.js\?v=([\w-]+)/],
    ['player/sky-player.js',/sky-player\.css\?v=([\w-]+)/]
  ]){
    assert.equal(read(file).match(pattern)?.[1],APPROVED_PLAYER_VERSION,`${file} loads the current player code`);
  }
});
