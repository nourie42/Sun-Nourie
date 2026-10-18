import * as THREE from './vendor/three.module.js';
import { PHOTO_SCENES, PHOTO_HOT_ATLAS, selectPhotoScene, computePhotoLayout, createLatestRequestGate } from './photo-scene.js';

// Integrated photographic cinemagraph: the person and landscape come from the
// same photograph. Only local optical motion is added; feet and camera stay put.
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;
const assetURL = key => new URL(PHOTO_SCENES[key].file, import.meta.url).href;
const PHOTO_KEYS = Object.keys(PHOTO_SCENES);
const MAX_GPU_TEXTURES = 8;

export async function createWeatherWorld(container, { onError, initialFrame = {}, initialOutfit = {} } = {}) {
  if (!container?.appendChild) throw new TypeError('A photographic weather container is required.');
  const gate = createLatestRequestGate(), images = new Map(), textures = new Map(), loads = new Map();
  let disposed = false, renderer = null, canvas = null, fallback = null;
  let selected = selectPhotoScene(initialFrame, initialOutfit), active = null, previous = null;
  let width = 1, height = 1, playing = false, visible = true, raf = 0, last = 0, time = 0;
  let blendStart = 0, blendDuration = 280, lastChange = 0, blend = 1;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const uniforms = {
    uFrom: { value: null }, uTo: { value: null }, uSky: { value: null }, uActorAtlas: { value: null },
    uFromSun: { value: 0 }, uToSun: { value: 0 }, uFromAtlas: { value: 0 }, uToAtlas: { value: 0 }, uPose: { value: 0 },
    uPoseBounds: { value: PHOTO_HOT_ATLAS.bounds.map(b => new THREE.Vector4(...b)) }, uFootX: { value: [...PHOTO_HOT_ATLAS.footX] },
    uBlend: { value: 1 }, uTime: { value: 0 }, uMotion: { value: reducedMotion?.matches ? 0 : 1 },
    uFromScale: { value: new THREE.Vector2(1, 1) }, uFromOffset: { value: new THREE.Vector2() },
    uToScale: { value: new THREE.Vector2(1, 1) }, uToOffset: { value: new THREE.Vector2() },
    uFromNight: { value: 0 }, uToNight: { value: 0 }, uFromShade: { value: 0 }, uToShade: { value: 0 },
    uFromStyle: { value: 0 }, uToStyle: { value: 0 }, uFromSkyShift: { value: 0 }, uToSkyShift: { value: 0 },
    uSkyMix: { value: 0 }, uSkyNight: { value: 0 }, uRain: { value: 0 }, uSnow: { value: 0 },
    uWind: { value: .2 }, uFog: { value: 0 }, uAspect: { value: 1 }, uPerson: { value: 1 }
  };

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
  function protectedKeys() { const keys = new Set([active?.spec.key, previous?.spec.key, selected.key, selected.skyKey].filter(Boolean)); if (active?.atlas || previous?.atlas || selected.key === 'hot') { keys.add('park-empty'); keys.add('hot-poses-alpha'); } return keys; }
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
    return computePhotoLayout({ viewportWidth: width, viewportHeight: height,
      sourceWidth: img?.naturalWidth || spec.asset.sourceWidth, sourceHeight: img?.naturalHeight || spec.asset.sourceHeight,
      personX: spec.asset.personX, subjectBounds: spec.asset.personBounds });
  }
  function applyLayout(slot, state) {
    if (!state) return;
    state.layout = layoutFor(state.spec, state.image);
    uniforms[`u${slot}Scale`].value.set(...state.layout.uvScale);
    uniforms[`u${slot}Offset`].value.set(...state.layout.uvOffset);
    uniforms[`u${slot}Night`].value = state.spec.gradeNight ? 1 : 0;
    uniforms[`u${slot}Shade`].value = state.spec.overcast ? 1 : 0;
    uniforms[`u${slot}Style`].value = state.spec.key === 'rain' ? 1 : state.spec.asset.garment === 'hot' ? 2 : 0;
    uniforms[`u${slot}SkyShift`].value = state.spec.asset.skyShiftX || 0;
    uniforms[`u${slot}Atlas`].value = state.atlas ? 1 : 0;
    uniforms[`u${slot}Sun`].value = state.spec.showSun ? 1 : 0;
  }

  // A complete photograph is the fallback too; unsupported GPUs never get a
  // cartoon, a blank sky, or a person pasted onto a different background.
  function makeFallback() {
    if (fallback) return;
    canvas?.remove();
    const backdrop = document.createElement('div'), photo = document.createElement('img'), layer = document.createElement('div');
    Object.assign(layer.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#4d7193' });
    Object.assign(backdrop.style, { position: 'absolute', inset: '-12px', backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(9px)', transform: 'scale(1.04)' });
    Object.assign(photo.style, { position: 'absolute', maxWidth: 'none', objectFit: 'fill', transition: reducedMotion?.matches ? 'none' : 'opacity .22s ease', maskImage: 'linear-gradient(to right,transparent,black 2%,black 98%,transparent)' });
    photo.alt = ''; photo.setAttribute('aria-hidden', 'true'); layer.append(backdrop, photo); container.append(layer);
    fallback = { layer, backdrop, photo }; container.dataset.renderMode = 'photographic-preview';
  }
  function renderFallback() {
    if (!active || !fallback) return;
    const layout = layoutFor(active.spec, active.image);
    fallback.photo.src = active.image.src;
    Object.assign(fallback.photo.style, { left: `${layout.left}px`, top: `${layout.top}px`, width: `${layout.imageWidth}px`, height: `${layout.imageHeight}px`, filter: active.spec.gradeNight ? 'brightness(.43) saturate(.72) hue-rotate(8deg)' : active.spec.overcast ? 'brightness(.78) saturate(.76)' : 'none' });
    fallback.backdrop.style.backgroundImage = `url("${active.image.src}")`;
    fallback.backdrop.style.filter = `blur(9px) ${active.spec.gradeNight ? 'brightness(.43)' : active.spec.overcast ? 'brightness(.78)' : ''}`;
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
      varying vec2 vUV; uniform sampler2D uFrom,uTo,uSky,uActorAtlas; uniform float uFromAtlas,uToAtlas,uPose,uFromSun,uToSun; uniform vec4 uPoseBounds[6]; uniform float uFootX[6];
      uniform vec2 uFromScale,uFromOffset,uToScale,uToOffset;
      uniform float uBlend,uTime,uMotion,uFromNight,uToNight,uFromShade,uToShade,uFromStyle,uToStyle,uFromSkyShift,uToSkyShift,uSkyMix,uSkyNight,uRain,uSnow,uWind,uFog,uAspect,uPerson;
      float ellipse(vec2 uv,vec2 center,vec2 radius){vec2 d=(uv-center)/radius;return 1.-smoothstep(.62,1.,dot(d,d));}
      float personMask(vec2 p){float head=ellipse(p,vec2(.508,.444),vec2(.041,.055));float torso=ellipse(p,vec2(.508,.575),vec2(.069,.118));return max(head,torso);}
      vec4 photo(sampler2D image,vec2 p){vec2 m=vec2(1.-abs(mod(p.x,2.)-1.),1.-abs(mod(p.y,2.)-1.));vec4 c=texture2D(image,vec2(m.x,1.-m.y));float outside=step(p.x,0.)+step(1.,p.x)+step(p.y,0.)+step(1.,p.y);if(outside>.5){vec2 q=vec2(m.x,1.-m.y);c=(c*2.+texture2D(image,clamp(q+vec2(.012,.004),.001,.999))+texture2D(image,clamp(q-vec2(.012,.004),.001,.999))+texture2D(image,clamp(q+vec2(.003,-.012),.001,.999))+texture2D(image,clamp(q+vec2(-.003,.012),.001,.999)))/6.;}return c;}
      vec2 localMotion(vec2 uv,float style,float atlas){float t=uTime*uMotion;vec2 p=uv;float torso=ellipse(uv,vec2(.505,.575),vec2(.067,.107))*(1.-atlas);float breath=sin(t*1.36);p.x+=(uv.x-.505)*breath*.012*torso;p.y+=breath*.00065*torso;float hair=ellipse(uv,vec2(.536,.466),vec2(.018,.044))*(1.-atlas);p.x+=sin(t*2.1)*.0010*hair*(.4+uWind);p.y+=sin(t*1.7)*.0004*hair;float protect=personMask(uv);float sky=(1.-smoothstep(.56,.65,uv.y))*(1.-protect)*smoothstep(.16,.27,uv.x);p.x+=sin(t*.095+uv.y*3.)*.0055*sky;p.y+=sin(t*.07+uv.x*5.)*.0010*sky;if(style>.5&&style<1.5){float canopy=ellipse(uv,vec2(.475,.365),vec2(.12,.08))*(1.-personMask(uv));vec2 relative=uv-vec2(.47,.50);float sway=sin(t*.83)*.005*(.3+uWind);p+=vec2(-relative.y,relative.x)*sway*canopy;}float cloth=torso*(.5+.5*sin(uv.y*95.+t*1.1));p.x+=sin(t*1.3+uv.y*33.)*.00032*cloth*uWind;return mix(uv,p,uMotion);}
      float cleanAlpha(vec4 p,vec2 q){vec2 edge=vec2(4./1881.,4./836.);float outside=min(min(texture2D(uActorAtlas,q+vec2(edge.x,0.)).a,texture2D(uActorAtlas,q-vec2(edge.x,0.)).a),min(texture2D(uActorAtlas,q+vec2(0.,edge.y)).a,texture2D(uActorAtlas,q-vec2(0.,edge.y)).a));float boundary=1.-step(.15,outside);float red=step(.94,p.r)*(1.-step(.012,p.g))*(1.-step(.012,p.b));float yellow=step(.94,p.r)*step(.94,p.g)*(1.-step(.015,p.b));return p.a*(1.-max(red,yellow)*boundary);}
      vec4 actorPixel(vec2 uv){int pose=int(uPose+.5);vec4 b=uPoseBounds[pose];float h=b.w-b.y;float scale=.51/h;vec2 pixel=vec2((uv.x-.486)/(scale*(1024./1536.))+uFootX[pose],(uv.y-.906)/scale+b.w);if(pixel.x<0.||pixel.x>627.||pixel.y<0.||pixel.y>418.)return vec4(0.);float row=floor(float(pose)/3.);float col=mod(float(pose),3.);vec2 q=vec2((col*627.+pixel.x)/1881.,1.-(row*418.+pixel.y)/836.);vec4 a=texture2D(uActorAtlas,q);vec2 px=vec2(1./1881.,1./836.);float alpha=min(cleanAlpha(a,q),min(min(cleanAlpha(texture2D(uActorAtlas,q+vec2(px.x,0.)),q+vec2(px.x,0.)),cleanAlpha(texture2D(uActorAtlas,q-vec2(px.x,0.)),q-vec2(px.x,0.))),min(cleanAlpha(texture2D(uActorAtlas,q+vec2(0.,px.y)),q+vec2(0.,px.y)),cleanAlpha(texture2D(uActorAtlas,q-vec2(0.,px.y)),q-vec2(0.,px.y)))));float edge=1.-smoothstep(.72,.98,alpha);float spill=max(0.,a.r-max(a.g,a.b)-.045);a.r-=spill*edge*.95;a.a=smoothstep(.30,.95,alpha);return a;}
      vec3 sampleScene(sampler2D image,vec2 scale,vec2 offset,float night,float shade,float style,float skyShift,float atlas,float sun){vec2 uv=vec2(vUV.x,1.-vUV.y)*scale+offset;vec2 p=localMotion(uv,style,atlas);vec3 c=photo(image,p).rgb;float mask=personMask(uv);if(abs(skyShift)>.001){float sky=1.-smoothstep(.32,.395,uv.y);c=mix(c,photo(image,p+vec2(skyShift,0.)).rgb,sky);}if(uSkyMix>.001){float sky=(1.-smoothstep(.57,.655,uv.y))*(1.-mask)*smoothstep(.17,.26,uv.x);vec3 cloudy=photo(uSky,p).rgb;if(uSkyNight>.5)cloudy=cloudy*vec3(.20,.29,.46)+vec3(.003,.005,.011);c=mix(c,cloudy,sky*uSkyMix);}if(atlas>.5){float contact=ellipse(uv,vec2(.486,.908),vec2(.044,.006));c*=1.-contact*.18;vec4 actor=actorPixel(uv);c=mix(c,actor.rgb,actor.a);}if(shade>.5)c=mix(c,c*vec3(.66,.73,.80),.72);if(night>.5){vec3 dark=c*vec3(.22,.30,.48)+vec3(.003,.006,.012);c=mix(dark,c*vec3(.41,.46,.59),mask*.6);}if(sun>.5){vec2 d=(uv-vec2(.58,.14))*vec2(1.5,1.);float r=length(d);float corona=exp(-r*r/.00042)*.065+exp(-r*r/.000025)*.17;float core=1.-smoothstep(.0043,.007,r);c+=vec3(1.,.83,.56)*corona;c=mix(c,vec3(1.25,1.18,1.02),core*.95);}return c;}
      float hash(float p){return fract(sin(p*127.1)*43758.5453);}
      void main(){vec3 a=sampleScene(uFrom,uFromScale,uFromOffset,uFromNight,uFromShade,uFromStyle,uFromSkyShift,uFromAtlas,uFromSun);vec3 b=sampleScene(uTo,uToScale,uToOffset,uToNight,uToShade,uToStyle,uToSkyShift,uToAtlas,uToSun);vec3 c=mix(a,b,smoothstep(0.,1.,uBlend));float t=uTime;float rain=0.;for(int i=0;i<3;i++){float fi=float(i),density=80.+fi*37.;vec2 p=vec2(vUV.x*uAspect*density+vUV.y*(6.+uWind*8.),vUV.y*(31.+fi*13.)+t*(16.+fi*7.));float id=floor(p.x),phase=fract(p.y+hash(id+fi*53.));float streak=(1.-smoothstep(.025,.075,abs(fract(p.x)-.5)))*(1.-smoothstep(.03,.30,phase))*step(.18+fi*.12,hash(id*1.7));rain+=streak*(.15+fi*.06);}c=mix(c,vec3(.68,.78,.87),clamp(rain*uRain,0.,.3));float snow=0.;for(int i=0;i<3;i++){float fi=float(i);vec2 p=vec2(vUV.x*uAspect*(18.+fi*9.)+sin(t*.37+vUV.y*5.+fi)*.28,vUV.y*(19.+fi*7.)+t*(.62+fi*.25));vec2 id=floor(p);vec2 q=fract(p)-.5;q.x+=sin(t*.8+id.y+fi)*.15;float dotSize=.025+fi*.008;snow+=(1.-smoothstep(dotSize,dotSize+.025,length(q)))*step(.44,hash(id.x+id.y*19.+fi*23.))*(.55+fi*.12);}c=mix(c,vec3(.91,.96,1.),clamp(snow*uSnow,0.,.9));float mist=uFog*(.12+.12*(1.-vUV.y));c=mix(c,vec3(.52,.60,.65),mist);gl_FragColor=vec4(c,1.);
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
    const poseStep = Math.floor(time * PHOTO_HOT_ATLAS.framesPerSecond) % 10; uniforms.uPose.value = poseStep < 6 ? poseStep : 10 - poseStep;
    uniforms.uBlend.value = blend; uniforms.uTime.value = time; uniforms.uMotion.value = reducedMotion?.matches ? 0 : 1;
    const approach = 1 - Math.exp(-delta * 7);
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
    applyLayout('From', previous || active); applyLayout('To', active); renderFallback(); requestRender();
  }
  async function install(spec, token, first = false) {
    try {
      const image = await imageFor(spec.key, first ? 'high' : 'auto');
      let [texture, skyTexture] = renderer ? await Promise.all([textureFor(spec.key, first ? 'high' : 'auto'), spec.skyKey ? textureFor(spec.skyKey) : Promise.resolve(null)]) : [null, null];
      let atlas = false;
      if (renderer && spec.key === 'hot') {
        try { const [park, actor] = await Promise.all([textureFor('park-empty'), textureFor('hot-poses-alpha')]); if (park && actor) { texture = park; uniforms.uActorAtlas.value = actor; atlas = true; } } catch { /* The coherent hot photograph remains the complete fallback. */ }
      }
      if (!gate.isCurrent(token) || disposed) return;
      const same = active?.spec.key === spec.key;
      if (!same) {
        previous = active || { spec, image, texture, atlas };
        active = { spec, image, texture, atlas }; blendStart = performance.now();
        blendDuration = first || reducedMotion?.matches ? 1 : performance.now() - lastChange < 190 ? 85 : 280;
        lastChange = performance.now(); blend = first ? 1 : 0;
      } else { active = { ...active, spec, image, texture, atlas }; if (blend >= 1) previous = active; }
      uniforms.uFrom.value = previous.texture || texture; uniforms.uTo.value = texture;
      uniforms.uSky.value = skyTexture || texture; uniforms.uSkyMix.value = skyTexture ? 1 : 0; uniforms.uSkyNight.value = spec.night ? 1 : 0;
      applyLayout('From', previous); applyLayout('To', active);
      container.dataset.photoScene = spec.key; container.dataset.photoReady = 'true';
      if (canvas) canvas.style.visibility = 'visible'; if (fallback) fallback.layer.style.visibility = 'visible';
      renderFallback(); requestRender(); trimTextures();
    } catch (error) {
      if (!gate.isCurrent(token) || disposed) return;
      container.dataset.photoReady = 'false'; if (canvas) canvas.style.visibility = 'hidden'; if (fallback) fallback.layer.style.visibility = 'hidden';
      onError?.(error);
    }
  }
  function setFrame(frame = {}, outfit = {}) {
    if (disposed) return;
    selected = selectPhotoScene(frame, outfit);
    const token = gate.next(); void install(selected, token);
  }
  function setPlaying(value) { playing = Boolean(value); if (!playing) stop(); requestRender(); }
  function onVisibility() { if (document.hidden) stop(); else requestRender(); }
  function onMotion() { stop(); requestRender(); }
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
    if (disposed) return; disposed = true; gate.dispose(); stop(); observer?.disconnect(); intersection?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility); reducedMotion?.removeEventListener?.('change', onMotion); globalThis.removeEventListener('resize', resize);
    canvas?.removeEventListener('webglcontextlost', onContextLost); textures.forEach(texture => texture.dispose()); textures.clear();
    geometry.dispose(); material.dispose(); renderer?.dispose(); canvas?.remove(); fallback?.layer.remove(); images.clear(); loads.clear();
  }
  resize();
  const token = gate.next(); await install(initialSpec, token, true);
  // Decode likely future scenes without allocating all of them on the GPU.
  for (const key of PHOTO_KEYS) if (key !== initialSpec.key) void imageFor(key).catch(() => {});
  return { setFrame, setPlaying, resize, dispose };
}
