import * as THREE from './vendor/three.module.js';
import { selectPhotoScene, createLatestRequestGate } from './photo-scene.js?v=named-scenes-v3';
import { normalizeCharacter, getCharacterScene, computeIntegratedSceneLayout } from './character-scene.js?v=named-scenes-v3';

// Every selected person is photographed together with their clothing, ground,
// contact shadow and landscape. Optical motion never replaces that photograph.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (a, b, fraction) => a + (b - a) * fraction;
const cloudFile = './assets/sky-storm.webp';
const fileURL = file => new URL(file, import.meta.url).href;
const MAX_GPU_TEXTURES = 8;

export async function createWeatherWorld(container, { onError, initialFrame = {}, initialOutfit = {}, initialCharacter = 'white' } = {}) {
  if (!container?.appendChild) throw new TypeError('A photographic weather container is required.');
  const gate = createLatestRequestGate(), images = new Map(), textures = new Map(), loads = new Map();
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let frame = initialFrame, outfit = initialOutfit, character = normalizeCharacter(initialCharacter);
  let selected = getCharacterScene(character, selectPhotoScene(frame, outfit), frame);
  let active = null, previous = null, disposed = false, renderer = null, canvas = null, fallback = null;
  let width = 1, height = 1, raf = 0, last = 0, time = 0, blend = 1, visible = true, playing = false;
  const uniforms = {
    uFrom: { value: null }, uTo: { value: null }, uClouds: { value: null },
    uFromRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uToRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uFromScale: { value: new THREE.Vector2(1, 1) }, uToScale: { value: new THREE.Vector2(1, 1) },
    uFromOffset: { value: new THREE.Vector2() }, uToOffset: { value: new THREE.Vector2() },
    uFromSubject: { value: new THREE.Vector4(.4, .35, .6, .95) }, uToSubject: { value: new THREE.Vector4(.4, .35, .6, .95) },
    uFromBody: { value: new THREE.Vector4(.4, .35, .6, .95) }, uToBody: { value: new THREE.Vector4(.4, .35, .6, .95) },
    uFromFlag: { value: new THREE.Vector4(2,2,2,2) }, uToFlag: { value: new THREE.Vector4(2,2,2,2) },
    uFromUmbrella: { value: 0 }, uToUmbrella: { value: 0 },
    uFromNight: { value: 0 }, uToNight: { value: 0 }, uFromGrade: { value: 0 }, uToGrade: { value: 0 },
    uFromCloud: { value: 0 }, uToCloud: { value: 0 }, uFromShade: { value: 0 }, uToShade: { value: 0 },
    uTime: { value: 0 }, uMotion: { value: reducedMotion?.matches ? 0 : 1 }, uBlend: { value: 1 },
    uRain: { value: 0 }, uSnow: { value: 0 }, uFog: { value: 0 }, uWind: { value: .2 }, uAspect: { value: 1 }
  };

  function imageFor(file, priority = 'auto') {
    if (images.has(file)) return images.get(file);
    const pending = new Promise((resolve, reject) => {
      const image = new Image(); image.decoding = 'async'; image.fetchPriority = priority;
      image.onload = async () => { try { await image.decode?.(); } catch { /* onload confirms pixels are usable. */ } resolve(image); };
      image.onerror = () => reject(new Error('The selected photographic weather scene could not be loaded.'));
      image.src = fileURL(file);
    });
    images.set(file, pending);
    pending.catch(() => { if (images.get(file) === pending) images.delete(file); });
    return pending;
  }
  function trimTextures() {
    const protectedFiles = new Set([active?.spec.file, previous?.spec.file, selected.file, cloudFile]);
    for (const [file, texture] of textures) {
      if (textures.size <= MAX_GPU_TEXTURES) break;
      if (!protectedFiles.has(file)) { textures.delete(file); texture.dispose(); }
    }
  }
  async function textureFor(file, priority) {
    if (textures.has(file)) return textures.get(file);
    if (loads.has(file)) return loads.get(file);
    const pending = imageFor(file, priority).then(image => {
      if (disposed) return null;
      const texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
      textures.set(file, texture); loads.delete(file); trimTextures(); return texture;
    }, error => { loads.delete(file); throw error; });
    loads.set(file, pending); return pending;
  }
  function layoutFor(state) {
    return computeIntegratedSceneLayout({ viewportWidth: width, viewportHeight: height,
      sourceWidth: state.image.naturalWidth, sourceHeight: state.image.naturalHeight, scene: state.spec });
  }
  function applyLayout(slot, state) {
    if (!state) return;
    state.layout = layoutFor(state);
    uniforms[`u${slot}Rect`].value.set(...state.spec.rect);
    uniforms[`u${slot}Scale`].value.set(...state.layout.uvScale);
    uniforms[`u${slot}Offset`].value.set(...state.layout.uvOffset);
    uniforms[`u${slot}Subject`].value.set(...(state.spec.showPerson === false ? [2, 2, 2, 2] : state.spec.personBounds));
    uniforms[`u${slot}Body`].value.set(...(state.spec.showPerson === false ? [2, 2, 2, 2] : state.spec.bodyBounds || state.spec.personBounds));
    uniforms[`u${slot}Flag`].value.set(...(state.spec.flagBounds || [2,2,2,2]));
    uniforms[`u${slot}Umbrella`].value = state.spec.umbrella ? 1 : 0;
    uniforms[`u${slot}Night`].value = state.spec.night ? 1 : 0;
    uniforms[`u${slot}Grade`].value = state.spec.gradeNight ? 1 : 0;
    uniforms[`u${slot}Cloud`].value = state.spec.cloudCover;
    uniforms[`u${slot}Shade`].value = state.spec.overcast && !state.spec.precipitation ? 1 : 0;
  }

  const fallbackStyle = document.createElement('style');
  fallbackStyle.textContent = `.weather-photograph-clouds{background-image:url("${fileURL(cloudFile)}");background-size:170% 100%;animation:photographic-cloud-drift 44s linear infinite;mask-image:linear-gradient(black,transparent);mix-blend-mode:screen}.weather-photograph-precip[data-weather="rain"]{background-image:repeating-linear-gradient(108deg,transparent 0 28px,rgba(210,230,244,.13) 29px,transparent 30px 62px);background-size:100% 170%;animation:photographic-rain .9s linear infinite}.weather-photograph-precip[data-weather="snow"]{background-image:radial-gradient(circle,rgba(247,252,255,.8) 1px,transparent 2px),radial-gradient(circle,rgba(247,252,255,.5) 1px,transparent 2px);background-size:37px 57px,71px 43px;animation:photographic-snow 6s linear infinite}@keyframes photographic-cloud-drift{to{background-position:170% 0}}@keyframes photographic-rain{to{background-position:-24px 110px}}@keyframes photographic-snow{to{background-position:17px 57px,-13px 43px}}@media(prefers-reduced-motion:reduce){.weather-photograph-clouds,.weather-photograph-precip{animation:none!important}}`;
  container.append(fallbackStyle);
  function makeFallback() {
    if (fallback) return;
    canvas?.remove();
    const layer = document.createElement('div'), from = document.createElement('div'), to = document.createElement('div');
    const clouds = document.createElement('div'), cornerClouds = document.createElement('div'), precip = document.createElement('div');
    Object.assign(layer.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#243d4c' });
    for (const slot of [from, to]) { Object.assign(slot.style, { position: 'absolute', inset: '0', overflow: 'hidden' }); layer.append(slot); }
    clouds.className = cornerClouds.className = 'weather-photograph-clouds'; precip.className = 'weather-photograph-precip';
    Object.assign(clouds.style, { position: 'absolute', inset: '0 0 auto', height: '30%', pointerEvents: 'none' });
    Object.assign(cornerClouds.style, { position: 'absolute', pointerEvents: 'none', backgroundSize: '300% 300%' });
    Object.assign(precip.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    layer.append(clouds, cornerClouds, precip); container.append(layer); fallback = { layer, from, to, clouds, cornerClouds, precip };
    container.dataset.renderMode = 'photographic-preview'; renderFallback();
  }
  function paintFallback(slot, state) {
    if (!state) return;
    const layout = layoutFor(state), rect = state.spec.rect;
    const photo = document.createElement('canvas'), backdrop = document.createElement('canvas');
    for (const target of state.spec.closePortrait ? [photo] : [photo, backdrop]) {
      target.width = Math.max(1, Math.round(layout.cellWidth)); target.height = Math.max(1, Math.round(layout.cellHeight));
      target.getContext('2d')?.drawImage(state.image, rect[0] * state.image.naturalWidth, rect[1] * state.image.naturalHeight,
        rect[2] * state.image.naturalWidth, rect[3] * state.image.naturalHeight, 0, 0, target.width, target.height);
    }
    Object.assign(backdrop.style, { position: 'absolute', inset: '-12px', width: 'calc(100% + 24px)', height: 'calc(100% + 24px)', objectFit: 'cover', filter: 'blur(12px)', opacity: '.75' });
    Object.assign(photo.style, { position: 'absolute', left: `${layout.left}px`, top: `${layout.top}px`, width: `${layout.imageWidth}px`, height: `${layout.imageHeight}px`, maskImage: 'linear-gradient(to right,transparent,black 2%,black 98%,transparent)' });
    slot.style.filter = state.spec.gradeNight ? 'brightness(.23) saturate(.42) hue-rotate(8deg)' : state.spec.overcast && !state.spec.precipitation ? 'brightness(.81) saturate(.8)' : 'none';
    if (state.spec.closePortrait) { photo.style.maskImage = 'none'; slot.replaceChildren(photo); }
    else slot.replaceChildren(backdrop, photo);
  }
  function renderFallback() {
    if (!fallback || !active) return;
    paintFallback(fallback.from, previous || active); paintFallback(fallback.to, active);
    fallback.to.style.opacity = String(blend);
    const layout = layoutFor(active), headTop = active.spec.showPerson === false ? height * .32 : layout.top + (active.spec.personBounds[1] - .02) * layout.imageHeight;
    fallback.clouds.style.height = `${Math.max(0, Math.min(height * .32, headTop))}px`;
    fallback.clouds.style.maskImage = 'linear-gradient(to right,transparent 18%,black 32%),linear-gradient(to bottom,black,transparent)';
    fallback.clouds.style.maskComposite = 'intersect';
    fallback.clouds.style.opacity = String(active.spec.cloudCover * (active.spec.night ? .06 : .20));
    const actor = active.spec.bodyBounds || active.spec.personBounds;
    const cornerVisible = active.spec.closePortrait === true && !active.spec.umbrella;
    Object.assign(fallback.cornerClouds.style, { display: cornerVisible ? 'block' : 'none', left: `${layout.left + layout.imageWidth * .86}px`, top: `${layout.top}px`, width: `${layout.imageWidth * .14}px`, height: `${layout.imageHeight * .28}px`, opacity: fallback.clouds.style.opacity,
      maskImage: 'linear-gradient(to right,transparent,black 29%,black 78%,transparent),linear-gradient(to bottom,black 82%,transparent)', maskComposite: 'intersect' });
    fallback.precip.dataset.weather = active.spec.precipitation || '';
    fallback.clouds.style.animationPlayState = fallback.cornerClouds.style.animationPlayState = fallback.precip.style.animationPlayState = reducedMotion?.matches ? 'paused' : 'running';
  }
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
    canvas = renderer.domElement; canvas.className = 'weather-world-canvas'; canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    container.append(canvas); container.dataset.renderMode = 'photographic-cinemagraph';
  } catch { makeFallback(); }
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2); camera.position.z = 1;
  const scene = new THREE.Scene(), geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({ uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: 'varying vec2 vUV;void main(){vUV=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `precision highp float;
    varying vec2 vUV;uniform sampler2D uFrom,uTo,uClouds;uniform vec4 uFromRect,uToRect,uFromSubject,uToSubject,uFromBody,uToBody,uFromFlag,uToFlag;
    uniform vec2 uFromScale,uToScale,uFromOffset,uToOffset;
    uniform float uFromUmbrella,uToUmbrella,uFromNight,uToNight,uFromGrade,uToGrade,uFromCloud,uToCloud,uFromShade,uToShade,uTime,uMotion,uBlend,uRain,uSnow,uFog,uWind,uAspect;
    float ellipse(vec2 uv,vec2 center,vec2 radius){vec2 d=(uv-center)/max(radius,vec2(.001));return 1.-smoothstep(.62,1.,dot(d,d));}
    vec3 cellPixel(sampler2D image,vec2 p,vec4 rect){vec2 q=p;float outside=max(step(p.x,0.),step(1.,p.x));if(p.x<0.)q.x=.20*(1.-abs(mod(p.x/.20,2.)-1.));if(p.x>1.)q.x=1.-.20*(1.-abs(mod((p.x-1.)/.20,2.)-1.));q=clamp(q,.002,.998);vec2 sampleUV=vec2(rect.x+q.x*rect.z,1.-rect.y-q.y*rect.w);vec3 c=texture2D(image,sampleUV).rgb;if(outside>.5){vec2 d=vec2(.009*rect.z,.009*rect.w);c=(c*2.+texture2D(image,clamp(sampleUV+d,vec2(rect.x+.002*rect.z,1.-rect.y-.998*rect.w),vec2(rect.x+.998*rect.z,1.-rect.y-.002*rect.w))).rgb+texture2D(image,clamp(sampleUV-d,vec2(rect.x+.002*rect.z,1.-rect.y-.998*rect.w),vec2(rect.x+.998*rect.z,1.-rect.y-.002*rect.w))).rgb)/4.;}return c;}
    vec3 photograph(sampler2D image,vec2 scale,vec2 offset,vec4 rect,vec4 body,vec4 actor,vec4 flag,float umbrella,float night,float grade,float cloud,float shade){vec2 uv=vec2(vUV.x,1.-vUV.y)*scale+offset;vec2 p=uv;float center=(actor.x+actor.z)*.5;float bodyHeight=actor.w-actor.y;float torso=ellipse(uv,vec2(center,actor.y+bodyHeight*.40),vec2((actor.z-actor.x)*.37,bodyHeight*.23));float hair=ellipse(uv,vec2(center+.012,actor.y+bodyHeight*.10),vec2((actor.z-actor.x)*.22,bodyHeight*.13));float breath=sin(uTime*1.42);p.x+=(uv.x-center)*breath*.009*torso*uMotion;p.y+=breath*.0007*torso*uMotion;p.x+=sin(uTime*1.8)*.0011*hair*uMotion*(.3+uWind);float closer=step(.5,actor.z-actor.x);vec3 c=cellPixel(image,p,rect);float protect=1.-smoothstep(.0,.025,max(max(body.x-uv.x,uv.x-body.z),max(body.y-uv.y,uv.y-body.w)));float flagGuard=1.-smoothstep(0.,.008,max(max(flag.x-uv.x,uv.x-flag.z),max(flag.y-uv.y,uv.y-flag.w)));protect=max(protect,flagGuard);float skyEnd=min(.47,min(body.y,flag.y)-.02);float sky=(1.-smoothstep(max(0.,skyEnd-.06),max(.001,skyEnd),uv.y))*smoothstep(.18,.30,uv.x);float corner=smoothstep(.86,.90,uv.x)*(1.-smoothstep(.97,1.,uv.x))*(1.-smoothstep(.23,.28,uv.y));sky=max(sky,corner*closer*(1.-step(.5,umbrella)));vec2 cloudUV=vec2(uv.x*.72+uTime*.016*(.35+uWind),.10+uv.y*.7+sin(uTime*.021)*.010);cloudUV=vec2(1.-abs(mod(cloudUV.x,2.)-1.),1.-abs(mod(cloudUV.y,2.)-1.));vec3 cloudPhoto=texture2D(uClouds,vec2(cloudUV.x,1.-cloudUV.y)).rgb;float light=pow(max(.001,dot(cloudPhoto,vec3(.2126,.7152,.0722))),.4545);float cloudAlpha=smoothstep(.14,.60,light)*cloud*.38*sky*(1.-protect);vec3 cloudColour=mix(vec3(.42,.50,.60),vec3(.95,.97,1.),smoothstep(.18,.72,light));if(night>.5&&grade<.5)cloudColour*=vec3(.035,.055,.095);c=mix(c,cloudColour,cloudAlpha);if(shade>.5)c*=vec3(.72,.77,.83);if(grade>.5){float luminance=dot(c,vec3(.2126,.7152,.0722));c=mix(c,vec3(luminance),.58)*vec3(.035,.055,.10)+vec3(.001,.002,.004);}return c;}
    float hash(float p){return fract(sin(p*127.1)*43758.5453);}
    void main(){vec3 a=photograph(uFrom,uFromScale,uFromOffset,uFromRect,uFromSubject,uFromBody,uFromFlag,uFromUmbrella,uFromNight,uFromGrade,uFromCloud,uFromShade);vec3 b=photograph(uTo,uToScale,uToOffset,uToRect,uToSubject,uToBody,uToFlag,uToUmbrella,uToNight,uToGrade,uToCloud,uToShade);vec3 c=mix(a,b,smoothstep(0.,1.,uBlend));float rain=0.;for(int i=0;i<3;i++){float fi=float(i);vec2 p=vec2(vUV.x*uAspect*(80.+fi*37.)+vUV.y*(6.+uWind*8.),vUV.y*(31.+fi*13.)+uTime*(16.+fi*7.));float id=floor(p.x),phase=fract(p.y+hash(id+fi*53.));rain+=(1.-smoothstep(.025,.075,abs(fract(p.x)-.5)))*(1.-smoothstep(.03,.30,phase))*step(.18+fi*.12,hash(id*1.7))*(.15+fi*.06);}c=mix(c,vec3(.68,.78,.87),clamp(rain*uRain,0.,.3));float snow=0.;for(int i=0;i<3;i++){float fi=float(i);vec2 p=vec2(vUV.x*uAspect*(18.+fi*9.)+sin(uTime*.37+vUV.y*5.+fi)*.28,vUV.y*(19.+fi*7.)+uTime*(.62+fi*.25));vec2 id=floor(p),q=fract(p)-.5;q.x+=sin(uTime*.8+id.y+fi)*.15;snow+=(1.-smoothstep(.025+fi*.008,.05+fi*.008,length(q)))*step(.44,hash(id.x+id.y*19.+fi*23.))*(.55+fi*.12);}c=mix(c,vec3(.91,.96,1.),clamp(snow*uSnow,0.,.9));c=mix(c,vec3(.52,.60,.65),uFog*(.12+.12*(1.-vUV.y)));gl_FragColor=vec4(c,1.);#include <colorspace_fragment>
    }`
  });
  // Shader chunks must begin on their own line for the GLSL preprocessor.
  material.fragmentShader = material.fragmentShader.replace(';#include', ';\n#include');
  scene.add(new THREE.Mesh(geometry, material));

  function requestRender() {
    if (disposed || !visible || document.hidden || raf) return;
    raf = requestAnimationFrame(draw);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }
  function draw(now) {
    raf = 0; if (disposed || !visible || document.hidden) return;
    const ambientMotion = !reducedMotion?.matches;
    if (ambientMotion && last && now - last < 30) { requestRender(); return; }
    const delta = last ? Math.min(.08, (now - last) / 1000) : 1 / 30; last = now;
    if (ambientMotion) time += delta;
    // Progress through visible frames; a slow texture upload must not skip the
    // entire person/outfit transition before its first painted frame.
    blend = reducedMotion?.matches ? 1 : clamp(blend + delta / .4, 0, 1);
    uniforms.uBlend.value = blend; uniforms.uTime.value = time; uniforms.uMotion.value = ambientMotion ? 1 : 0;
    const spec = active?.spec || selected, approach = ambientMotion ? 1 - Math.exp(-delta * 9) : 1;
    uniforms.uRain.value = mix(uniforms.uRain.value, spec.precipitation === 'rain' ? .85 : 0, approach);
    uniforms.uSnow.value = mix(uniforms.uSnow.value, spec.precipitation === 'snow' ? 1 : 0, approach);
    uniforms.uFog.value = mix(uniforms.uFog.value, spec.fog ? 1 : 0, approach);
    uniforms.uWind.value = mix(uniforms.uWind.value, spec.wind, approach);
    if (renderer && active) { try { renderer.render(scene, camera); } catch { renderer.dispose(); renderer = null; makeFallback(); } }
    if (fallback) fallback.to.style.opacity = String(blend);
    container.dataset.sceneBlend = blend.toFixed(3); container.dataset.ambientMotion = ambientMotion ? 'true' : 'false';
    if (blend >= 1 && previous !== active) { previous = active; uniforms.uFrom.value = active.texture; applyLayout('From', active); trimTextures(); }
    if (renderer && ambientMotion || blend < 1) requestRender();
  }
  function resize() {
    if (disposed) return;
    const rect = container.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    uniforms.uAspect.value = width / height;
    if (renderer) { renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.6)); renderer.setSize(width, height, false); }
    applyLayout('From', previous || active); applyLayout('To', active); renderFallback(); requestRender();
  }
  async function install(spec, token, first = false) {
    try {
      const image = await imageFor(spec.file, first ? 'high' : 'auto');
      const [texture, clouds] = renderer ? await Promise.all([textureFor(spec.file, first ? 'high' : 'auto'), textureFor(cloudFile)]) : [null, null];
      if (!gate.isCurrent(token) || disposed) return;
      const changed = active?.spec.key !== spec.key;
      if (changed) { previous = active || { spec, image, texture }; active = { spec, image, texture }; blend = first || reducedMotion?.matches ? 1 : 0; }
      else { active = { ...active, spec, image, texture }; if (blend >= 1) previous = active; }
      if (first || reducedMotion?.matches) previous = active;
      uniforms.uFrom.value = previous.texture || texture; uniforms.uTo.value = texture; uniforms.uClouds.value = clouds || texture;
      applyLayout('From', previous); applyLayout('To', active);
      container.dataset.photoReady = 'true'; container.dataset.characterReady = 'true'; container.dataset.character = spec.character;
      container.dataset.characterPose = spec.pose || 'shelter'; container.dataset.photoScene = spec.key; container.dataset.sceneSource = spec.file;
      container.dataset.integratedPhotograph = 'true'; container.dataset.skyCoverage = String(spec.cloudCover); container.dataset.skyLighting = spec.night ? 'night' : 'day'; container.dataset.characterPending = '';
      renderFallback(); requestRender(); trimTextures();
    } catch (error) { if (gate.isCurrent(token) && !disposed) { container.dataset.characterPending = 'error'; onError?.(error); } }
  }
  function requestScene() {
    selected = getCharacterScene(character, selectPhotoScene(frame, outfit), frame);
    container.dataset.characterPending = character;
    const token = gate.next(); return install(selected, token);
  }
  function setFrame(value = {}, clothing = {}) { if (disposed) return; frame = value; outfit = clothing; void requestScene(); }
  function setCharacter(value) { if (disposed) return; const next = normalizeCharacter(value); if (next === character && active) return; character = next; void requestScene(); }
  function setPlaying(value) { playing = Boolean(value); container.dataset.forecastPlaying = String(playing); requestRender(); }
  function onVisibility() { if (document.hidden) stop(); else requestRender(); }
  function onMotion() { stop(); renderFallback(); requestRender(); }
  function contextLost(event) { event?.preventDefault?.(); stop(); renderer?.dispose(); renderer = null; makeFallback(); requestRender(); }
  if (renderer) { renderer.debug.onShaderError = contextLost; canvas.addEventListener('webglcontextlost', contextLost); }
  const observer = globalThis.ResizeObserver ? new ResizeObserver(resize) : null; observer?.observe(container);
  if (!observer) globalThis.addEventListener('resize', resize);
  const intersection = globalThis.IntersectionObserver ? new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting !== false; if (visible) requestRender(); else stop(); }, { rootMargin: '100px' }) : null;
  intersection?.observe(container); document.addEventListener('visibilitychange', onVisibility); reducedMotion?.addEventListener?.('change', onMotion);
  function dispose() {
    if (disposed) return; disposed = true; gate.dispose(); stop(); observer?.disconnect(); intersection?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility); reducedMotion?.removeEventListener?.('change', onMotion); globalThis.removeEventListener('resize', resize);
    canvas?.removeEventListener('webglcontextlost', contextLost); textures.forEach(texture => texture.dispose()); textures.clear();
    geometry.dispose(); material.dispose(); renderer?.dispose(); canvas?.remove(); fallback?.layer.remove(); fallbackStyle.remove(); images.clear(); loads.clear();
  }
  resize(); const token = gate.next(); await install(selected, token, true);
  return { setFrame, setCharacter, setPlaying, resize, dispose };
}
