import * as THREE from './vendor/three.module.js';
import { PHOTO_SCENES, selectPhotoScene, createLatestRequestGate } from './photo-scene.js?v=people-v1';
import { CHARACTERS, normalizeCharacter, selectCharacterPose, computeCharacterLayout } from './character-scene.js?v=people-v1';

// Empty photographic landscapes and selectable transparent outfit atlases.
// Weather, clothing and lighting all follow the selected native forecast hour.
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;
const assetURL = key => new URL(PHOTO_SCENES[key].file, import.meta.url).href;
const PHOTO_KEYS = ['park-empty', 'storm', 'clouds', 'snow-empty'].filter(key => PHOTO_SCENES[key]);

function emptySceneFor(spec) {
  const key = spec.precipitation === 'snow' && PHOTO_SCENES['snow-empty'] ? 'snow-empty' : spec.precipitation === 'rain' || !spec.showPerson ? 'storm' : 'park-empty';
  return { ...spec, sceneKey: spec.key, key, asset: PHOTO_SCENES[key], gradeNight: spec.night, skyKey: key === 'park-empty' ? spec.skyKey : null };
}
const MAX_GPU_TEXTURES = 8;

export async function createWeatherWorld(container, { onError, initialFrame = {}, initialOutfit = {}, initialCharacter = 'white' } = {}) {
  if (!container?.appendChild) throw new TypeError('A photographic weather container is required.');
  const gate = createLatestRequestGate(), characterGate = createLatestRequestGate(), images = new Map(), textures = new Map(), loads = new Map();
  let disposed = false, renderer = null, canvas = null, fallback = null;
  let selected = emptySceneFor(selectPhotoScene(initialFrame, initialOutfit)), active = null, previous = null;
  let character = normalizeCharacter(initialCharacter), actorImage = null;
  let width = 1, height = 1, playing = false, visible = true, raf = 0, last = 0, time = 0;
  let blendStart = 0, blendDuration = 280, lastChange = 0, blend = 1;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const uniforms = {
    uFrom: { value: null }, uTo: { value: null }, uSky: { value: null },
    uFromSun: { value: 0 }, uToSun: { value: 0 },
    uBlend: { value: 1 }, uTime: { value: 0 }, uMotion: { value: reducedMotion?.matches ? 0 : 1 },
    uFromScale: { value: new THREE.Vector2(1, 1) }, uFromOffset: { value: new THREE.Vector2() },
    uToScale: { value: new THREE.Vector2(1, 1) }, uToOffset: { value: new THREE.Vector2() },
    uFromNight: { value: 0 }, uToNight: { value: 0 }, uFromShade: { value: 0 }, uToShade: { value: 0 },
    uFromSkyShift: { value: 0 }, uToSkyShift: { value: 0 },
    uSkyMix: { value: 0 }, uRain: { value: 0 }, uSnow: { value: 0 },
    uWind: { value: .2 }, uFog: { value: 0 }, uAspect: { value: 1 }
  };

  const actorLayer = document.createElement('div'), actor = document.createElement('img');
  const actorShadow = document.createElement('div'), fallbackWeather = document.createElement('div');
  const actorStyle = document.createElement('style'), actorLoads = new Map();
  actorLayer.className = 'weather-world-character';
  Object.assign(actorLayer.style, { position: 'absolute', overflow: 'hidden', pointerEvents: 'none', zIndex: '2', visibility: 'hidden', transformOrigin: '50% 100%' });
  Object.assign(actor.style, { position: 'absolute', maxWidth: 'none', maxHeight: 'none', objectFit: 'fill' });
  actor.alt = ''; actor.setAttribute('aria-hidden', 'true'); actor.decoding = 'async'; actorLayer.append(actor);
  Object.assign(actorShadow.style, { position: 'absolute', pointerEvents: 'none', zIndex: '1', borderRadius: '50%', background: 'radial-gradient(ellipse,rgba(16,26,29,.32),transparent 70%)', visibility: 'hidden' });
  fallbackWeather.className = 'weather-world-fallback-weather';
  Object.assign(fallbackWeather.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '3', display: 'none' });
  actorStyle.textContent = `.weather-world-fallback-weather[data-weather="rain"]{background-image:repeating-linear-gradient(108deg,transparent 0 28px,rgba(210,230,244,.13) 29px,transparent 30px 62px);background-size:100% 170%;animation:weather-world-rain .9s linear infinite}.weather-world-fallback-weather[data-weather="snow"]{background-image:radial-gradient(circle,rgba(247,252,255,.8) 1px,transparent 2px),radial-gradient(circle,rgba(247,252,255,.5) 1px,transparent 2px);background-size:37px 57px,71px 43px;animation:weather-world-snow 6s linear infinite}@keyframes weather-world-rain{to{background-position:-24px 110px}}@keyframes weather-world-snow{to{background-position:17px 57px,-13px 43px}}@media(prefers-reduced-motion:reduce){.weather-world-fallback-weather{animation:none!important}}`;
  container.append(actorStyle, actorShadow, actorLayer, fallbackWeather);

  function renderActor() {
    const pose = selectCharacterPose(selected), shown = Boolean(pose && actorImage && !disposed);
    actorLayer.style.visibility = actorShadow.style.visibility = shown ? 'visible' : 'hidden';
    container.dataset.character = character; container.dataset.characterPose = pose || 'shelter';
    fallbackWeather.dataset.weather = selected.precipitation || '';
    fallbackWeather.style.display = fallback && selected.precipitation ? 'block' : 'none';
    fallbackWeather.style.animationPlayState = playing && !reducedMotion?.matches ? 'running' : 'paused';
    if (!shown) return;
    const layout = computeCharacterLayout({ viewportWidth: width, viewportHeight: height, sourceWidth: actorImage.naturalWidth, sourceHeight: actorImage.naturalHeight, character, pose });
    Object.assign(actorLayer.style, { left: `${layout.left}px`, top: `${layout.top}px`, width: `${layout.width}px`, height: `${layout.height}px`, filter: selected.night ? 'brightness(.40) saturate(.70) hue-rotate(8deg)' : selected.overcast || selected.precipitation ? 'brightness(.80) saturate(.84)' : 'none' });
    Object.assign(actor.style, { left: `${layout.imageLeft}px`, top: `${layout.imageTop}px`, width: `${layout.imageWidth}px`, height: `${layout.imageHeight}px` });
    Object.assign(actorShadow.style, { left: `${layout.feetX - Math.max(10, width * .044)}px`, top: `${layout.feetY - 4}px`, width: `${Math.max(20, width * .088)}px`, height: '8px', opacity: selected.night ? '.5' : '1' });
  }

  async function setCharacter(value) {
    if (disposed) return;
    const next = normalizeCharacter(value);
    if (next === character && actorImage) return;
    const token = characterGate.next();
    character = next; actorImage = null; container.dataset.characterReady = 'false'; renderActor();
    try {
      if (!actorLoads.has(next)) {
        const pending = new Promise((resolve, reject) => {
          const image = new Image(); image.decoding = 'async'; image.fetchPriority = 'high';
          image.onload = async () => { try { await image.decode?.(); } catch { /* Loaded pixels remain usable. */ } resolve(image); };
          image.onerror = () => reject(new Error('The selected weather character could not be loaded.'));
          image.src = new URL(CHARACTERS.find(person => person.id === next).file, import.meta.url).href;
        });
        actorLoads.set(next, pending);
        pending.catch(() => { if (actorLoads.get(next) === pending) actorLoads.delete(next); });
      }
      const image = await actorLoads.get(next);
      if (!characterGate.isCurrent(token) || disposed) return;
      actorImage = image; actor.src = image.src; container.dataset.characterReady = 'true'; renderActor();
    } catch (error) {
      if (characterGate.isCurrent(token) && !disposed) onError?.(error);
    }
  }

  function imageFor(key, priority = 'low') {
    if (images.has(key)) return images.get(key);
    const promise = new Promise((resolve, reject) => {
      const img = new Image(); img.decoding = 'async'; img.fetchPriority = priority;
      img.onload = async () => { try { await img.decode?.(); } catch { /* onload already confirms usable pixels */ } resolve(img); };
      img.onerror = () => reject(new Error(`The ${key.replaceAll('-', ' ')} weather photograph could not be loaded.`));
      img.src = assetURL(key);
    });
    images.set(key, promise);
    promise.catch(() => { if (images.get(key) === promise) images.delete(key); });
    return promise;
  }
  function protectedKeys() { return new Set([active?.spec.key, previous?.spec.key, selected.key, selected.skyKey].filter(Boolean)); }
  function trimTextures() {
    const keep = protectedKeys();
    for (const [key, texture] of textures) {
      if (textures.size <= MAX_GPU_TEXTURES) break;
      if (!keep.has(key)) { textures.delete(key); texture.dispose(); }
    }
  }
  async function textureFor(key, priority = 'low') {
    if (textures.has(key)) { const tex = textures.get(key); textures.delete(key); textures.set(key, tex); return tex; }
    if (loads.has(key)) return loads.get(key);
    const promise = imageFor(key, priority).then(img => {
      if (disposed) return null;
      const texture = new THREE.Texture(img); texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false; texture.needsUpdate = true;
      textures.set(key, texture); loads.delete(key); trimTextures(); return texture;
    }, error => { loads.delete(key); throw error; });
    loads.set(key, promise); return promise;
  }
  function layoutFor(spec, img) {
    const sourceWidth = img?.naturalWidth || spec.asset.sourceWidth, sourceHeight = img?.naturalHeight || spec.asset.sourceHeight;
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const imageWidth = sourceWidth * scale, imageHeight = sourceHeight * scale;
    const left = (width - imageWidth) / 2, top = height - imageHeight;
    return { imageWidth, imageHeight, left, top, uvScale: [width / imageWidth, height / imageHeight], uvOffset: [-left / imageWidth, -top / imageHeight] };
  }
  function applyLayout(slot, state) {
    if (!state) return;
    state.layout = layoutFor(state.spec, state.image);
    uniforms[`u${slot}Scale`].value.set(...state.layout.uvScale);
    uniforms[`u${slot}Offset`].value.set(...state.layout.uvOffset);
    uniforms[`u${slot}Night`].value = state.spec.gradeNight ? 1 : 0;
    uniforms[`u${slot}Shade`].value = state.spec.overcast ? 1 : 0;
    uniforms[`u${slot}SkyShift`].value = state.spec.asset.skyShiftX || 0;
    uniforms[`u${slot}Sun`].value = state.spec.showSun ? 1 : 0;
  }

  // Unsupported GPUs use the same empty landscape and character layer.
  function makeFallback() {
    if (fallback) return;
    canvas?.remove();
    const backdrop = document.createElement('div'), photo = document.createElement('img'), layer = document.createElement('div');
    Object.assign(layer.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#4d7193' });
    Object.assign(backdrop.style, { position: 'absolute', inset: '-12px', backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(9px)', transform: 'scale(1.04)' });
    Object.assign(photo.style, { position: 'absolute', maxWidth: 'none', objectFit: 'fill', transition: reducedMotion?.matches ? 'none' : 'opacity .22s ease', maskImage: 'linear-gradient(to right,transparent,black 2%,black 98%,transparent)' });
    photo.alt = ''; photo.setAttribute('aria-hidden', 'true'); layer.append(backdrop, photo); container.append(layer);
    fallback = { layer, backdrop, photo }; container.dataset.renderMode = 'photographic-preview'; renderActor();
  }
  function renderFallback() {
    if (!active || !fallback) return;
    const layout = layoutFor(active.spec, active.image);
    fallback.photo.src = active.image.src;
    Object.assign(fallback.photo.style, { left: `${layout.left}px`, top: `${layout.top}px`, width: `${layout.imageWidth}px`, height: `${layout.imageHeight}px`, filter: active.spec.gradeNight ? 'brightness(.21) saturate(.40) hue-rotate(8deg)' : active.spec.overcast ? 'brightness(.78) saturate(.76)' : 'none' });
    fallback.backdrop.style.backgroundImage = `url("${active.image.src}")`;
    fallback.backdrop.style.filter = `blur(9px) ${active.spec.gradeNight ? 'brightness(.21) saturate(.40)' : active.spec.overcast ? 'brightness(.78)' : ''}`;
  }

  const initialSpec = selected;
  const initialImage = await imageFor(initialSpec.key, 'high');
  if (!container.isConnected && !container.parentNode) { /* detached embeds may mount immediately afterward */ }
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
    canvas = renderer.domElement; canvas.className = 'weather-world-canvas'; canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    container.append(canvas); container.dataset.renderMode = 'photographic-cinemagraph';
  } catch { makeFallback(); }

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2); camera.position.z = 1;
  const scene = new THREE.Scene();
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({ uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: 'varying vec2 vUV; void main(){vUV=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `precision highp float;
      varying vec2 vUV; uniform sampler2D uFrom,uTo,uSky; uniform float uFromSun,uToSun;
      uniform vec2 uFromScale,uFromOffset,uToScale,uToOffset;
      uniform float uBlend,uTime,uMotion,uFromNight,uToNight,uFromShade,uToShade,uFromSkyShift,uToSkyShift,uSkyMix,uRain,uSnow,uWind,uFog,uAspect;
      float ellipse(vec2 uv,vec2 center,vec2 radius){vec2 d=(uv-center)/radius;return 1.-smoothstep(.62,1.,dot(d,d));}
      vec4 photo(sampler2D image,vec2 p){vec2 m=vec2(1.-abs(mod(p.x,2.)-1.),1.-abs(mod(p.y,2.)-1.));vec4 c=texture2D(image,vec2(m.x,1.-m.y));float outside=step(p.x,0.)+step(1.,p.x)+step(p.y,0.)+step(1.,p.y);if(outside>.5){vec2 q=vec2(m.x,1.-m.y);c=(c*2.+texture2D(image,clamp(q+vec2(.012,.004),.001,.999))+texture2D(image,clamp(q-vec2(.012,.004),.001,.999))+texture2D(image,clamp(q+vec2(.003,-.012),.001,.999))+texture2D(image,clamp(q+vec2(-.003,.012),.001,.999)))/6.;}return c;}
      vec3 sampleScene(sampler2D image,vec2 scale,vec2 offset,float night,float shade,float skyShift,float sun){vec2 uv=vec2(vUV.x,1.-vUV.y)*scale+offset;vec2 p=uv;float sky=1.-smoothstep(.56,.65,uv.y);p.x+=sin(uTime*.095+uv.y*3.)*.0055*sky*uMotion;p.y+=sin(uTime*.07+uv.x*5.)*.001*sky*uMotion;vec3 c=photo(image,p).rgb;if(abs(skyShift)>.001)c=mix(c,photo(image,p+vec2(skyShift,0.)).rgb,1.-smoothstep(.32,.395,uv.y));if(uSkyMix>.001){vec3 cloudy=photo(uSky,p).rgb;c=mix(c,cloudy,sky*uSkyMix);}if(shade>.5)c=mix(c,c*vec3(.66,.73,.80),.72);if(night>.5){float luminance=dot(c,vec3(.2126,.7152,.0722));c=mix(c,vec3(luminance),.58)*vec3(.035,.055,.10)+vec3(.001,.002,.004);}if(sun>.5){vec2 d=(uv-vec2(.58,.14))*vec2(1.5,1.);float r=length(d);float corona=exp(-r*r/.00042)*.065+exp(-r*r/.000025)*.17;float core=1.-smoothstep(.0043,.007,r);c+=vec3(1.,.83,.56)*corona;c=mix(c,vec3(1.25,1.18,1.02),core*.95);}return c;}
      float hash(float p){return fract(sin(p*127.1)*43758.5453);}
      void main(){vec3 a=sampleScene(uFrom,uFromScale,uFromOffset,uFromNight,uFromShade,uFromSkyShift,uFromSun);vec3 b=sampleScene(uTo,uToScale,uToOffset,uToNight,uToShade,uToSkyShift,uToSun);vec3 c=mix(a,b,smoothstep(0.,1.,uBlend));float t=uTime;float rain=0.;for(int i=0;i<3;i++){float fi=float(i),density=80.+fi*37.;vec2 p=vec2(vUV.x*uAspect*density+vUV.y*(6.+uWind*8.),vUV.y*(31.+fi*13.)+t*(16.+fi*7.));float id=floor(p.x),phase=fract(p.y+hash(id+fi*53.));float streak=(1.-smoothstep(.025,.075,abs(fract(p.x)-.5)))*(1.-smoothstep(.03,.30,phase))*step(.18+fi*.12,hash(id*1.7));rain+=streak*(.15+fi*.06);}c=mix(c,vec3(.68,.78,.87),clamp(rain*uRain,0.,.3));float snow=0.;for(int i=0;i<3;i++){float fi=float(i);vec2 p=vec2(vUV.x*uAspect*(18.+fi*9.)+sin(t*.37+vUV.y*5.+fi)*.28,vUV.y*(19.+fi*7.)+t*(.62+fi*.25));vec2 id=floor(p);vec2 q=fract(p)-.5;q.x+=sin(t*.8+id.y+fi)*.15;float dotSize=.025+fi*.008;snow+=(1.-smoothstep(dotSize,dotSize+.025,length(q)))*step(.44,hash(id.x+id.y*19.+fi*23.))*(.55+fi*.12);}c=mix(c,vec3(.91,.96,1.),clamp(snow*uSnow,0.,.9));float mist=uFog*(.12+.12*(1.-vUV.y));c=mix(c,vec3(.52,.60,.65),mist);gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
      }`
  });
  scene.add(new THREE.Mesh(geometry, material));

  function requestRender() {
    if (disposed || !visible || document.hidden || raf) return;
    last = 0; raf = requestAnimationFrame(draw);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }
  function draw(now) {
    raf = 0; if (disposed || !visible || document.hidden) return;
    const delta = last ? Math.min(.08, (now - last) / 1000) : 1 / 30; last = now;
    const motion = playing && !reducedMotion?.matches;
    if (motion) time += delta;
    blend = reducedMotion?.matches ? 1 : clamp((now - blendStart) / blendDuration, 0, 1);
    uniforms.uBlend.value = blend; uniforms.uTime.value = time; uniforms.uMotion.value = reducedMotion?.matches ? 0 : 1;
    // A paused or reduced-motion scene has no next animation frame to finish
    // easing. Apply its selected-hour atmosphere completely on this render.
    const approach = motion ? 1 - Math.exp(-delta * 7) : 1;
    uniforms.uRain.value = lerp(uniforms.uRain.value, selected.precipitation === 'rain' ? .85 : 0, approach);
    uniforms.uSnow.value = lerp(uniforms.uSnow.value, selected.precipitation === 'snow' ? 1 : 0, approach);
    uniforms.uWind.value = lerp(uniforms.uWind.value, selected.wind, approach);
    uniforms.uFog.value = lerp(uniforms.uFog.value, selected.fog ? 1 : 0, approach);
    if (renderer && active) {
      try { renderer.render(scene, camera); }
      catch { renderer.dispose(); renderer = null; makeFallback(); renderFallback(); }
    }
    if (renderer && (motion || blend < 1)) raf = requestAnimationFrame(draw);
    else if (previous && previous !== active) { previous = active; trimTextures(); }
  }
  function resize() {
    if (disposed) return;
    const rect = container.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    uniforms.uAspect.value = width / height;
    if (renderer) { renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.6)); renderer.setSize(width, height, false); }
    applyLayout('From', previous || active); applyLayout('To', active); renderFallback(); renderActor(); requestRender();
  }
  async function install(spec, token, first = false) {
    try {
      const image = await imageFor(spec.key, first ? 'high' : 'auto');
      let [texture, skyTexture] = renderer ? await Promise.all([textureFor(spec.key, first ? 'high' : 'auto'), spec.skyKey ? textureFor(spec.skyKey) : Promise.resolve(null)]) : [null, null];
      if (!gate.isCurrent(token) || disposed) return;
      const same = active?.spec.key === spec.key;
      if (!same) {
        previous = active || { spec, image, texture };
        active = { spec, image, texture }; blendStart = performance.now();
        blendDuration = first || reducedMotion?.matches ? 1 : performance.now() - lastChange < 190 ? 85 : 280;
        lastChange = performance.now(); blend = first ? 1 : 0;
      } else { active = { ...active, spec, image, texture }; if (blend >= 1) previous = active; }
      uniforms.uFrom.value = previous.texture || texture; uniforms.uTo.value = texture;
      uniforms.uSky.value = skyTexture || texture; uniforms.uSkyMix.value = skyTexture ? 1 : 0;
      applyLayout('From', previous); applyLayout('To', active);
      container.dataset.photoScene = spec.sceneKey; container.dataset.backgroundScene = spec.key; container.dataset.photoReady = 'true';
      if (canvas) canvas.style.visibility = 'visible'; if (fallback) fallback.layer.style.visibility = 'visible';
      renderFallback(); renderActor(); requestRender(); trimTextures();
    } catch (error) {
      if (!gate.isCurrent(token) || disposed) return;
      container.dataset.photoReady = 'false'; if (canvas) canvas.style.visibility = 'hidden'; if (fallback) fallback.layer.style.visibility = 'hidden';
      onError?.(error);
    }
  }
  function setFrame(frame = {}, outfit = {}) {
    if (disposed) return;
    selected = emptySceneFor(selectPhotoScene(frame, outfit));
    renderActor();
    const token = gate.next(); void install(selected, token);
  }
  function setPlaying(value) { playing = Boolean(value); if (!playing) stop(); renderActor(); requestRender(); }
  function onVisibility() { if (document.hidden) stop(); else requestRender(); }
  function onMotion() { stop(); renderActor(); requestRender(); }
  function onContextLost(event) { event.preventDefault(); stop(); renderer?.dispose(); renderer = null; makeFallback(); renderFallback(); }
  if (renderer) {
    renderer.debug.onShaderError = () => { stop(); renderer?.dispose(); renderer = null; makeFallback(); renderFallback(); };
    canvas.addEventListener('webglcontextlost', onContextLost);
  }
  const observer = globalThis.ResizeObserver ? new ResizeObserver(resize) : null; observer?.observe(container);
  if (!observer) globalThis.addEventListener('resize', resize);
  const intersection = globalThis.IntersectionObserver ? new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting !== false; if (visible) requestRender(); else stop(); }, { rootMargin: '100px' }) : null;
  intersection?.observe(container); document.addEventListener('visibilitychange', onVisibility); reducedMotion?.addEventListener?.('change', onMotion);
  function dispose() {
    if (disposed) return; disposed = true; gate.dispose(); characterGate.dispose(); stop(); observer?.disconnect(); intersection?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility); reducedMotion?.removeEventListener?.('change', onMotion); globalThis.removeEventListener('resize', resize);
    canvas?.removeEventListener('webglcontextlost', onContextLost); textures.forEach(texture => texture.dispose()); textures.clear();
    geometry.dispose(); material.dispose(); renderer?.dispose(); canvas?.remove(); fallback?.layer.remove(); actorLayer.remove(); actorShadow.remove(); fallbackWeather.remove(); actorStyle.remove(); images.clear(); loads.clear(); actorLoads.clear();
  }
  resize();
  const token = gate.next(); await Promise.all([install(initialSpec, token, true), setCharacter(character)]);
  // Decode likely future scenes without allocating all of them on the GPU.
  for (const key of PHOTO_KEYS) if (key !== initialSpec.key) void imageFor(key).catch(() => {});
  return { setFrame, setCharacter, setPlaying, resize, dispose };
}
