import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement??=class {};
globalThis.customElements??={get:()=>true,define(){}};
globalThis.CustomEvent??=class extends Event{constructor(type,options={}){super(type,options);this.detail=options.detail;}};
const {WeatherSkyPlayer}=await import('../public/weather-fusion/player/sky-player.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function until(check){
  const end=Date.now()+5000;
  while(!check()){
    assert.ok(Date.now()<end,'playback did not advance after the scene settled');
    await delay(5);
  }
}
function harness(){
  const pending=[deferred()],calls=[];
  const p=Object.assign(new EventTarget(),{_forecast:[{},{},{}],_index:0,_playing:true,_timer:null,_speed:32,_playbackEpoch:0,_worldPromise:null,_sceneTask:pending[0].promise});
  const control={classList:{remove(){}},setAttribute(){},textContent:''};
  p.$=()=>control;
  for(const name of ['_awaitScene','_startTimer','pause'])p[name]=WeatherSkyPlayer.prototype[name];
  p.setFrame=index=>{calls.push(index);p._index=index;const scene=deferred();pending.push(scene);p._sceneTask=scene.promise;return scene.promise;};
  return {p,pending,calls,cleanup(){p.pause();for(const scene of pending)scene.resolve(true);}};
}

test('fast playback waits for decoding and the whole outfit transition before the next hour',async()=>{
  const h=harness();
  try{
    h.p._startTimer();await delay(90);
    assert.deepEqual(h.calls,[],'no hour can outrun the initial image decode');
    h.pending[0].resolve(true);await until(()=>h.calls.length===1);
    await delay(145);
    assert.deepEqual(h.calls,[1],'an unfinished outfit transition must hold even at 32×');
    h.pending[1].resolve(true);await until(()=>h.calls.length===2);
    assert.deepEqual(h.calls,[1,2]);
  }finally{h.cleanup();}
});

test('pausing while a scene is pending cancels the queued advance',async()=>{
  const h=harness();
  try{
    h.p._startTimer();h.p.pause();h.pending[0].resolve(true);await delay(95);
    assert.deepEqual(h.calls,[]);
  }finally{h.cleanup();}
});

test('restarting playback while decoding does not leave a second timer running',async()=>{
  const h=harness();
  try{
    h.p._startTimer();h.p._speed=16;h.p._startTimer();h.pending[0].resolve(true);
    await until(()=>h.calls.length>0);await delay(90);
    assert.deepEqual(h.calls,[1],'the obsolete speed loop must never advance');
  }finally{h.cleanup();}
});

test('a forecast refresh during the hour dwell finishes rendering before playback advances',async()=>{
  const h=harness();
  try{
    h.pending[0].resolve(true);h.p._startTimer();await delay(20);
    const refreshed=deferred();h.pending.push(refreshed);h.p._sceneTask=refreshed.promise;
    await delay(90);assert.deepEqual(h.calls,[]);
    refreshed.resolve(true);await until(()=>h.calls.length===1);
    assert.deepEqual(h.calls,[1]);
  }finally{h.cleanup();}
});
