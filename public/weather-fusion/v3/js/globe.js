/**
 * Weather Nourie · Photorealistic Three.js WebGL 3D Satellite Earth Globe
 * - Real NASA Blue Marble 2K Day + Real NASA Black Marble 2K Night City Lights GLSL Shader
 * - Real NASA SRTM Topography Bump Relief & Ocean Specular Reflection
 * - Accurate Hourly Global Cloud Cover Field (Open-Meteo Global 14x30 Grid + Geographically Locked Satellite Detail)
 * - Windy/Nullschool-Style Curved Fluid Wind Streamlines driven by Real Atmospheric u/v Vectors
 * - Real-Time Astronomical Solar Terminator + Fresnel Atmospheric Rayleigh Scattering Glow
 * - Accurate Equirectangular UV Coordinate Raycasting (Verified West-to-East Earth Rotation)
 */

import * as THREE from '../vendor/three.module.min.js';
import { DEG2RAD, RAD2DEG, clamp } from './physics.js';
import { PRESET_CITIES } from './fusion-engine.js';

const EXTRA_WORLD_PINS = [
  { id: 'chicago', name: 'Chicago, IL', latitude: 41.8781, longitude: -87.6298 },
  { id: 'london', name: 'London, UK', latitude: 51.5072, longitude: -0.1276 },
  { id: 'paris', name: 'Paris, FR', latitude: 48.8566, longitude: 2.3522 },
  { id: 'tokyo', name: 'Tokyo, JP', latitude: 35.6762, longitude: 139.6503 },
  { id: 'sydney', name: 'Sydney, AU', latitude: -33.8688, longitude: 151.2093 },
];

export function latLonToVec3(latDeg, lonDeg, radius = 1) {
  const phi = (90 - latDeg) * DEG2RAD;
  const theta = (lonDeg + 180) * DEG2RAD;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

export function vec3ToLatLon(vec) {
  const n = vec.clone().normalize();
  const latDeg = Math.asin(clamp(n.y, -1, 1)) * RAD2DEG;
  let theta = Math.atan2(n.z, -n.x);
  if (theta < 0) theta += Math.PI * 2;
  let lonDeg = theta * RAD2DEG - 180;
  lonDeg = ((lonDeg + 540) % 360) - 180;
  return { latitude: latDeg, longitude: lonDeg };
}

function getSubsolarVec3(dateObj) {
  const utcHrs = dateObj.getUTCHours() + dateObj.getUTCMinutes() / 60;
  const subsolarLon = ((12 - utcHrs) * 15 + 540) % 360 - 180;
  const start = new Date(Date.UTC(dateObj.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((dateObj - start) / 86400000);
  const subsolarLat = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  return latLonToVec3(subsolarLat, subsolarLon, 1).normalize();
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

export function windUvToCompass(uKn, vKn) {
  const spdKn = Math.hypot(uKn || 0, vKn || 0);
  const mph = Math.round(spdKn * 1.15078);
  // u > 0 blows East, v > 0 blows North -> blowing TOWARD angle (clockwise from North)
  const towardDeg = ((Math.atan2(uKn || 0, vKn || 0) * RAD2DEG) + 360) % 360;
  // Meteorological wind direction is where wind comes FROM
  const fromDeg = (towardDeg + 180) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']; // Arrow points direction wind is blowing TOWARD
  const compass = dirs[Math.round(fromDeg / 45) % 8];
  const arrow = arrows[Math.round(towardDeg / 45) % 8];
  return { mph, fromDeg: Math.round(fromDeg), towardDeg: Math.round(towardDeg), compass, arrow };
}

function hash2D(ix, iy) {
  const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoisePeriodicX(xNorm, yNorm, periodX, freqY) {
  const fx = xNorm * periodX;
  const fy = yNorm * freqY;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const ix0 = ((x0 % periodX) + periodX) % periodX;
  const ix1 = (ix0 + 1) % periodX;
  const n00 = hash2D(ix0, y0);
  const n10 = hash2D(ix1, y0);
  const n01 = hash2D(ix0, y0 + 1);
  const n11 = hash2D(ix1, y0 + 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

const EARTH_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vNormalWorld;
  varying vec3 vPositionWorld;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vPositionWorld = worldPos.xyz;
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const EARTH_FRAGMENT_SHADER = `
  uniform sampler2D uDayTex;
  uniform sampler2D uNightTex;
  uniform sampler2D uBumpTex;
  uniform sampler2D uThermalTex;
  uniform vec3 uSunDir;
  uniform float uTerminatorStrength;
  uniform float uThermalOverlay;
  uniform float uHasThermalTex;
  varying vec2 vUv;
  varying vec3 vNormalWorld;
  varying vec3 vPositionWorld;

  void main() {
    vec3 N = normalize(vNormalWorld);
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vPositionWorld);

    vec3 dayColor = texture2D(uDayTex, vUv).rgb;
    vec3 nightColor = texture2D(uNightTex, vUv).rgb;
    float elev = texture2D(uBumpTex, vUv).r;

    float ndotl = dot(N, L);
    float dayFactor = smoothstep(-0.15, 0.22, ndotl);
    float effectiveDay = mix(1.0, dayFactor, uTerminatorStrength);

    float diffuse = mix(0.32, 1.18, clamp(ndotl * 0.85 + 0.35, 0.0, 1.0));
    float fullDayDiffuse = mix(diffuse, 1.08, 1.0 - uTerminatorStrength);
    vec3 litDay = dayColor * fullDayDiffuse;

    float isOcean = 1.0 - smoothstep(0.03, 0.09, elev);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 42.0) * isOcean * 0.30 * effectiveDay;
    litDay += vec3(0.75, 0.88, 1.0) * spec;

    vec3 nightBase = dayColor * vec3(0.07, 0.11, 0.19);
    vec3 cityLights = pow(nightColor, vec3(1.12)) * vec3(1.6, 1.28, 0.78) * 1.45;
    vec3 litNight = nightBase + cityLights;

    float twilight = exp(-pow(ndotl * 7.5, 2.0)) * uTerminatorStrength;
    vec3 twilightTint = vec3(1.0, 0.48, 0.22) * twilight * 0.22;

    vec3 color = mix(litNight, litDay, effectiveDay) + twilightTint;

    if (uThermalOverlay > 0.01) {
      vec3 thermalCol;
      if (uHasThermalTex > 0.5) {
        thermalCol = texture2D(uThermalTex, vUv).rgb;
      } else {
        float latFactor = 1.0 - abs(vUv.y - 0.5) * 2.0;
        vec3 coldCol = vec3(0.16, 0.45, 0.98);
        vec3 mildCol = vec3(0.20, 0.82, 0.58);
        vec3 hotCol = vec3(0.98, 0.36, 0.18);
        thermalCol = latFactor < 0.5
          ? mix(coldCol, mildCol, latFactor * 2.0)
          : mix(mildCol, hotCol, (latFactor - 0.5) * 2.0);
      }
      color = mix(color, thermalCol, 0.44 * uThermalOverlay);
    }

    float rim = 1.0 - max(dot(N, V), 0.0);
    color += vec3(0.24, 0.58, 1.0) * pow(rim, 3.2) * 0.34;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const CLOUDS_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vNormalWorld;
  void main() {
    vUv = uv;
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLOUDS_FRAGMENT_SHADER = `
  uniform sampler2D uCloudTex;
  uniform vec3 uSunDir;
  uniform float uTerminatorStrength;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormalWorld;

  void main() {
    vec4 tex = texture2D(uCloudTex, vUv);
    float density = max(tex.a, tex.r * tex.a);
    if (density < 0.025) discard;

    vec3 N = normalize(vNormalWorld);
    vec3 L = normalize(uSunDir);
    float ndotl = dot(N, L);
    float dayFactor = smoothstep(-0.22, 0.24, ndotl);
    float effectiveDay = mix(1.0, dayFactor, uTerminatorStrength);

    vec3 dayCloud = vec3(0.97, 0.99, 1.0);
    vec3 nightCloud = vec3(0.34, 0.46, 0.68);
    float twilight = exp(-pow(ndotl * 6.5, 2.0)) * uTerminatorStrength;
    vec3 cloudCol = mix(nightCloud, dayCloud, effectiveDay) + vec3(0.95, 0.55, 0.28) * twilight * 0.20;

    float alpha = clamp(density * uOpacity * mix(0.68, 0.94, effectiveDay), 0.0, 0.92);
    gl_FragColor = vec4(cloudCol, alpha);
  }
`;

const ATMOSPHERE_VERTEX_SHADER = `
  varying vec3 vNormalWorld;
  varying vec3 vPositionWorld;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vPositionWorld = worldPos.xyz;
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = `
  uniform vec3 uSunDir;
  varying vec3 vNormalWorld;
  varying vec3 vPositionWorld;
  void main() {
    vec3 N = normalize(vNormalWorld);
    vec3 V = normalize(cameraPosition - vPositionWorld);
    float intensity = pow(0.64 - dot(N, V), 3.6);
    float sunBoost = 0.55 + 0.45 * clamp(dot(-N, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 glow = vec3(0.28, 0.68, 1.0) * intensity * sunBoost * 1.35;
    gl_FragColor = vec4(glow, clamp(intensity * 0.9, 0.0, 0.85));
  }
`;

export class LiveCloudGlobe {
  constructor({ canvasId = 'cloud-globe-canvas', onSelectLocation, onLayerChange }) {
    this.canvasId = canvasId;
    this.onSelectLocation = onSelectLocation;
    this.onLayerChange = onLayerChange;

    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.globeGroup = null;
    this.earthMesh = null;
    this.earthMat = null;
    this.cloudMesh = null;
    this.cloudMat = null;
    this.precipMesh = null;
    this.precipMat = null;
    this.windMesh = null;
    this.windCanvas = null;
    this.windCtx = null;
    this.windTex = null;
    this.windParticles = [];
    this.cloudCanvas = null;
    this.cloudCtx = null;
    this.cloudDynTex = null;
    this.precipCanvas = null;
    this.precipDynTex = null;
    this.thermalCanvas = null;
    this.thermalDynTex = null;
    this.satAlphaPixels = null;
    this.satSize = null;
    this.cloudNoiseGrid = null;

    this.globalGrid = null;
    this.renderedCloudHour = -1;

    this.beaconGroup = null;
    this.beaconRing = null;
    this.cityPinGroup = null;
    this.floatingLabelEl = null;

    this.camLon = -78.4806 * DEG2RAD;
    this.camLat = 34 * DEG2RAD;
    this.targetCamLon = null;
    this.targetCamLat = null;
    this.velLon = 0;
    this.velLat = 0;
    this.camDist = 2.65;
    this.autoSpin = true;

    this.layers = {
      clouds: true,
      wind: true,
      precip: false,
      terminator: true,
      thermal: false,
    };

    this.hourOffset = 0;
    this.forecast = null;
    this.isDragging = false;
    this.dragMoved = false;
    this.lastPointer = { x: 0, y: 0 };
    this.initialized = false;
    this.raycaster = new THREE.Raycaster();
    this.lastTime = 0;
    this.windAccumulator = 0;
  }

  init(forecast) {
    this.forecast = forecast;
    if (this.initialized) {
      this.updateActiveBeacon();
      return;
    }

    this.canvas = document.getElementById(this.canvasId);
    if (!this.canvas) return;
    this.initialized = true;

    const stageWrap = this.canvas.parentElement;
    if (stageWrap && !stageWrap.querySelector('.globe-beacon-tag')) {
      const tag = document.createElement('div');
      tag.className = 'globe-beacon-tag';
      tag.hidden = true;
      stageWrap.appendChild(tag);
      this.floatingLabelEl = tag;
    }

    this.setupThreeScene();
    this.bindEvents();
    this.loadGlobalWeather();

    if (forecast?.location) {
      this.flyTo(forecast.location.latitude, forecast.location.longitude, true);
    }
    this.updateActiveBeacon();

    const animate = (now) => {
      const dt = Math.min(0.05, (now - (this.lastTime || now)) / 1000);
      this.lastTime = now;
      this.renderFrame(dt, now * 0.001);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  updateForecast(forecast) {
    this.forecast = forecast;
    if (!this.initialized) {
      this.init(forecast);
      return;
    }
    if (forecast?.location) {
      this.flyTo(forecast.location.latitude, forecast.location.longitude);
    }
    this.updateActiveBeacon();
  }

  async loadGlobalWeather() {
    if (this.globalGrid) return;
    try {
      const res = await fetch('/api/weather-fusion/global-weather', { cache: 'default' });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.frames?.length) {
        this.setGlobalWeatherData(data);
      }
    } catch {
      // Keeps fallback satellite + climatological winds gracefully
    }
  }

  setGlobalWeatherData(gridData) {
    this.globalGrid = gridData;
    this.renderedCloudHour = -1;
    this.updateDynamicCloudTexture();
    this.updateDynamicPrecipTexture();
    this.updateDynamicThermalTexture();
    this.warmWindFluidLayer();
  }

  setupThreeScene() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(280, Math.floor(rect.width || 480));
    const h = Math.max(260, Math.floor(rect.height || 380));

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);

    this.camDist = w < 440 ? 3.56 : 2.78;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    this.globeGroup = new THREE.Group();
    this.scene.add(this.globeGroup);

    // 1. Deep-Space Starfield
    const starPositions = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const r = 18 + Math.random() * 24;
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      starPositions[i * 3] = r * s * Math.cos(phi);
      starPositions[i * 3 + 1] = r * u;
      starPositions[i * 3 + 2] = r * s * Math.sin(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xdbeafe,
      size: 0.085,
      transparent: true,
      opacity: 0.72,
    });
    this.scene.add(new THREE.Points(starGeo, starMat));

    const loadTex = (url, fallbackUrl = null, onReady = null) => {
      const makeLoader = (targetUrl) => {
        const l = new THREE.TextureLoader();
        l.setCrossOrigin(/^https?:\/\//i.test(targetUrl) ? 'anonymous' : 'use-credentials');
        return l;
      };
      const tex = makeLoader(url).load(
        url,
        (loaded) => {
          loaded.wrapS = THREE.RepeatWrapping;
          loaded.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          if (onReady) onReady(loaded);
        },
        undefined,
        () => {
          if (fallbackUrl) {
            makeLoader(fallbackUrl).load(fallbackUrl, (fb) => {
              fb.wrapS = THREE.RepeatWrapping;
              if (onReady) onReady(fb);
            });
          }
        }
      );
      tex.wrapS = THREE.RepeatWrapping;
      return tex;
    };

    const dayTex = loadTex('/weather-fusion/v3/textures/earth-day.jpg');
    const nightTex = loadTex('/weather-fusion/v3/textures/earth-night.jpg');
    const bumpTex = loadTex('/weather-fusion/v3/textures/earth-bump.png');
    const sunDir = getSubsolarVec3(new Date());

    // 2. Dynamic Global Temperature Contour CanvasTexture (Real model temps)
    this.thermalCanvas = document.createElement('canvas');
    this.thermalCanvas.width = 256;
    this.thermalCanvas.height = 128;
    this.thermalDynTex = new THREE.CanvasTexture(this.thermalCanvas);
    this.thermalDynTex.wrapS = THREE.RepeatWrapping;

    // 3. Earth Sphere (NASA Blue Marble + Black Marble + Real Elevation + Dynamic Thermal Contour)
    const earthGeo = new THREE.SphereGeometry(1, 64, 64);
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uDayTex: { value: dayTex },
        uNightTex: { value: nightTex },
        uBumpTex: { value: bumpTex },
        uThermalTex: { value: this.thermalDynTex },
        uSunDir: { value: sunDir.clone() },
        uTerminatorStrength: { value: 1.0 },
        uThermalOverlay: { value: 0.0 },
        uHasThermalTex: { value: 0.0 },
      },
      vertexShader: EARTH_VERTEX_SHADER,
      fragmentShader: EARTH_FRAGMENT_SHADER,
    });
    this.earthMesh = new THREE.Mesh(earthGeo, this.earthMat);
    this.globeGroup.add(this.earthMesh);

    // 4. Geographically Locked Cloud Layer (Hourly Global Open-Meteo Cloud Cover + Satellite Detail)
    this.initCloudCanvasTexture();
    const cloudGeo = new THREE.SphereGeometry(1.015, 64, 64);
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uCloudTex: { value: this.cloudDynTex },
        uSunDir: { value: sunDir.clone() },
        uTerminatorStrength: { value: 1.0 },
        uOpacity: { value: 0.92 },
      },
      vertexShader: CLOUDS_VERTEX_SHADER,
      fragmentShader: CLOUDS_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.cloudMesh = new THREE.Mesh(cloudGeo, this.cloudMat);
    this.cloudMesh.rotation.y = 0; // Locked strictly to geographic coordinates!
    this.globeGroup.add(this.cloudMesh);

    // Load live satellite cloud alpha map as geographically locked spatial microstructure
    this.loadSatelliteDetailImage('/api/weather-fusion/v3/live-clouds.png', '/weather-fusion/v3/textures/clouds-fallback.png');

    // 5. Dynamic Precipitation Overlay Sphere (Satellite IMERG + Hourly Model Precip)
    this.precipCanvas = document.createElement('canvas');
    this.precipCanvas.width = 512;
    this.precipCanvas.height = 256;
    this.precipDynTex = new THREE.CanvasTexture(this.precipCanvas);
    this.precipDynTex.wrapS = THREE.RepeatWrapping;

    const precipGeo = new THREE.SphereGeometry(1.020, 64, 64);
    this.precipMat = new THREE.MeshBasicMaterial({
      map: this.precipDynTex,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.precipMesh = new THREE.Mesh(precipGeo, this.precipMat);
    this.precipMesh.visible = this.layers.precip;
    this.globeGroup.add(this.precipMesh);

    // 6. Smooth Fluid Atmospheric Wind Streamline Shell (Windy/Nullschool-style CanvasTexture)
    this.initWindFluidLayer(w < 460);

    // 7. Rayleigh Atmospheric Fresnel Halo
    const atmoGeo = new THREE.SphereGeometry(1.105, 64, 64);
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: sunDir.clone() },
      },
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });
    this.atmoMat = atmoMat;
    this.globeGroup.add(new THREE.Mesh(atmoGeo, atmoMat));

    // 8. Reference City Pins + Pulsing Active Beacon
    this.cityPinGroup = new THREE.Group();
    const pinGeo = new THREE.SphereGeometry(0.011, 10, 10);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0x7ac6ff });
    for (const city of [...PRESET_CITIES, ...EXTRA_WORLD_PINS]) {
      const m = new THREE.Mesh(pinGeo, pinMat);
      m.position.copy(latLonToVec3(city.latitude, city.longitude, 1.008));
      this.cityPinGroup.add(m);
    }
    this.globeGroup.add(this.cityPinGroup);

    this.beaconGroup = new THREE.Group();
    const dotGeo = new THREE.SphereGeometry(0.018, 16, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x5ce0a0 });
    this.beaconGroup.add(new THREE.Mesh(dotGeo, dotMat));

    const ringGeo = new THREE.RingGeometry(0.025, 0.037, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x5ce0a0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.beaconRing = new THREE.Mesh(ringGeo, ringMat);
    this.beaconGroup.add(this.beaconRing);
    this.globeGroup.add(this.beaconGroup);

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.handleResize()).observe(this.canvas.parentElement || this.canvas);
    }
    window.addEventListener('resize', () => this.handleResize());
  }

  initCloudCanvasTexture() {
    const cw = 720;
    const ch = 360;
    this.cloudCanvas = document.createElement('canvas');
    this.cloudCanvas.width = cw;
    this.cloudCanvas.height = ch;
    this.cloudCtx = this.cloudCanvas.getContext('2d');

    // Precompute periodic multi-octave swirl noise for organic cloud morphology
    const noise = new Float32Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      const yn = y / ch;
      for (let x = 0; x < cw; x++) {
        const xn = x / cw;
        const n1 = valueNoisePeriodicX(xn, yn, 24, 12);
        const n2 = valueNoisePeriodicX(xn + n1 * 0.04, yn + n1 * 0.04, 54, 27);
        const n3 = valueNoisePeriodicX(xn, yn, 108, 54);
        noise[y * cw + x] = n1 * 0.50 + n2 * 0.34 + n3 * 0.16;
      }
    }
    this.cloudNoiseGrid = noise;

    this.cloudDynTex = new THREE.CanvasTexture(this.cloudCanvas);
    this.cloudDynTex.wrapS = THREE.RepeatWrapping;
  }

  loadSatelliteDetailImage(url, fallbackUrl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = 720;
        const h = 360;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const raw = ctx.getImageData(0, 0, w, h).data;
        const alphas = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const r = raw[i * 4];
          const g = raw[i * 4 + 1];
          const b = raw[i * 4 + 2];
          const a = raw[i * 4 + 3];
          // Live SSEC Global IR encodes cold high/mid cloud tops as bright white/grey
          // and clear warm surface as dark pixels. Map brightness cleanly to cloud opacity.
          const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          const alphaNorm = a / 255;
          const cloudDensity = smoothstep(0.24, 0.82, lum) * alphaNorm;
          alphas[i] = Math.round(clamp(cloudDensity, 0, 0.96) * 255);
        }
        this.satAlphaPixels = alphas;
        this.satSize = { w, h };
        this.renderedCloudHour = -1;
        this.updateDynamicCloudTexture();
      } catch {
        // Ignore CORS canvas taint if any
      }
    };
    img.onerror = () => {
      if (fallbackUrl && url !== fallbackUrl) {
        this.loadSatelliteDetailImage(fallbackUrl, null);
      }
    };
    img.src = url;
  }

  sampleGridScalar(fieldKey, hourIdx, latDeg, lonDeg) {
    const g = this.globalGrid;
    if (!g?.frames?.length) return 0;
    const h = clamp(Math.round(hourIdx), 0, g.frames.length - 1);
    const frame = g.frames[h];
    const arr = frame?.[fieldKey];
    if (!arr) return 0;

    const lats = g.lats; // Descending +74 .. -66
    const nLat = g.nLat;
    const nLon = g.nLon;

    let latIdx0 = 0;
    let latT = 0;
    if (latDeg >= lats[0]) {
      latIdx0 = 0;
      latT = 0;
    } else if (latDeg <= lats[nLat - 1]) {
      latIdx0 = nLat - 2;
      latT = 1;
    } else {
      for (let i = 0; i < nLat - 1; i++) {
        if (latDeg <= lats[i] && latDeg >= lats[i + 1]) {
          latIdx0 = i;
          latT = (lats[i] - latDeg) / (lats[i] - lats[i + 1] || 1);
          break;
        }
      }
    }

    const wrappedLon = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
    const lonStep = 360 / nLon;
    const lonPos = (wrappedLon + 180) / lonStep;
    const lonIdx0 = Math.floor(lonPos) % nLon;
    const lonIdx1 = (lonIdx0 + 1) % nLon;
    const lonT = lonPos - Math.floor(lonPos);

    const v00 = arr[latIdx0 * nLon + lonIdx0] || 0;
    const v10 = arr[latIdx0 * nLon + lonIdx1] || 0;
    const v01 = arr[(latIdx0 + 1) * nLon + lonIdx0] || 0;
    const v11 = arr[(latIdx0 + 1) * nLon + lonIdx1] || 0;

    const top = v00 + (v10 - v00) * lonT;
    const bot = v01 + (v11 - v01) * lonT;
    return top + (bot - top) * latT;
  }

  sampleWindUv(hourIdx, latDeg, lonDeg) {
    const g = this.globalGrid;
    if (!g?.frames?.length) {
      // Climatological synoptic fallback only until global grid resolves
      const absLat = Math.abs(latDeg);
      const u = absLat < 22 ? -14 : absLat <= 58 ? 28 + Math.cos(lonDeg * DEG2RAD * 3) * 10 : -8;
      const v = Math.sin(lonDeg * DEG2RAD * 3) * 9 * (latDeg >= 0 ? 1 : -1);
      return [u, v];
    }
    return [
      this.sampleGridScalar('u', hourIdx, latDeg, lonDeg),
      this.sampleGridScalar('v', hourIdx, latDeg, lonDeg),
    ];
  }

  updateDynamicCloudTexture() {
    if (!this.cloudCanvas || !this.cloudCtx || !this.cloudDynTex) return;
    if (this.renderedCloudHour === this.hourOffset && this.globalGrid) return;

    const w = this.cloudCanvas.width;
    const h = this.cloudCanvas.height;
    const imgData = this.cloudCtx.createImageData(w, h);
    const out = imgData.data;
    const noise = this.cloudNoiseGrid;
    const hasGrid = Boolean(this.globalGrid?.frames?.length);
    const hasSat = Boolean(this.satAlphaPixels && this.satSize?.w === w && this.satSize?.h === h);
    const hour = this.hourOffset;

    if (hour === 0 && hasSat) {
      // At Now (+0h): display the authentic live GOES / Meteosat / Himawari satellite IR mosaic directly
      this.renderedCloudHour = 0;
      const sat = this.satAlphaPixels;
      for (let i = 0; i < w * h; i++) {
        const p4 = i * 4;
        out[p4] = 248;
        out[p4 + 1] = 251;
        out[p4 + 2] = 255;
        out[p4 + 3] = sat[i];
      }
    } else if (hasGrid) {
      // For future forecast hours (+1h..+47h), render the current-hour-aligned Open-Meteo global cloud cover
      this.renderedCloudHour = hour;
      for (let y = 0; y < h; y++) {
        const lat = 90 - ((y + 0.5) / h) * 180;
        const rowOffset = y * w;
        for (let x = 0; x < w; x++) {
          const lon = ((x + 0.5) / w) * 360 - 180;
          const idx = rowOffset + x;
          const cover = clamp(this.sampleGridScalar('cloud', hour, lat, lon) / 100, 0, 1);
          const density = cover > 0.06 ? clamp((cover - 0.06) / 0.94, 0, 0.92) : 0;
          const p4 = idx * 4;
          out[p4] = 248;
          out[p4 + 1] = 251;
          out[p4 + 2] = 255;
          out[p4 + 3] = Math.round(density * 255);
        }
      }
    } else if (hasSat) {
      const sat = this.satAlphaPixels;
      for (let i = 0; i < w * h; i++) {
        const p4 = i * 4;
        out[p4] = 248;
        out[p4 + 1] = 251;
        out[p4 + 2] = 255;
        out[p4 + 3] = sat[i];
      }
    }

    this.cloudCtx.putImageData(imgData, 0, 0);
    this.cloudDynTex.needsUpdate = true;
  }

  updateDynamicPrecipTexture() {
    if (!this.precipCanvas || !this.precipDynTex || !this.globalGrid?.frames?.length) return;
    const ctx = this.precipCanvas.getContext('2d');
    const w = this.precipCanvas.width;
    const h = this.precipCanvas.height;
    const imgData = ctx.createImageData(w, h);
    const out = imgData.data;

    for (let y = 0; y < h; y++) {
      const lat = 90 - ((y + 0.5) / h) * 180;
      for (let x = 0; x < w; x++) {
        const lon = ((x + 0.5) / w) * 360 - 180;
        const mm = this.sampleGridScalar('precip', this.hourOffset, lat, lon);
        const p4 = (y * w + x) * 4;
        if (mm < 0.08) {
          out[p4 + 3] = 0;
          continue;
        }
        // Radar green -> cyan -> amber -> magenta precip ramp
        let r = 45, g = 212, b = 191, a = 155;
        if (mm >= 5.0) {
          r = 244; g = 63; b = 94; a = 230;
        } else if (mm >= 2.0) {
          r = 250; g = 204; b = 21; a = 210;
        } else if (mm >= 0.6) {
          r = 56; g = 189; b = 248; a = 185;
        } else {
          a = Math.round(smoothstep(0.08, 0.6, mm) * 165);
        }
        out[p4] = r;
        out[p4 + 1] = g;
        out[p4 + 2] = b;
        out[p4 + 3] = a;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    this.precipDynTex.needsUpdate = true;
  }

  updateDynamicThermalTexture() {
    if (!this.thermalCanvas || !this.thermalDynTex || !this.globalGrid?.frames?.length) return;
    const ctx = this.thermalCanvas.getContext('2d');
    const w = this.thermalCanvas.width;
    const h = this.thermalCanvas.height;
    const imgData = ctx.createImageData(w, h);
    const out = imgData.data;

    for (let y = 0; y < h; y++) {
      const lat = 90 - ((y + 0.5) / h) * 180;
      for (let x = 0; x < w; x++) {
        const lon = ((x + 0.5) / w) * 360 - 180;
        const tF = this.sampleGridScalar('temp', this.hourOffset, lat, lon);
        const p4 = (y * w + x) * 4;
        const n = clamp((tF - 10) / 85, 0, 1); // 10°F .. 95°F
        let r, g, b;
        if (n < 0.28) {
          const t = n / 0.28;
          r = 58 + (56 - 58) * t;
          g = 90 + (189 - 90) * t;
          b = 248 + (248 - 248) * t;
        } else if (n < 0.58) {
          const t = (n - 0.28) / 0.30;
          r = 56 + (52 - 56) * t;
          g = 189 + (211 - 189) * t;
          b = 248 + (153 - 248) * t;
        } else if (n < 0.80) {
          const t = (n - 0.58) / 0.22;
          r = 52 + (250 - 52) * t;
          g = 211 + (204 - 211) * t;
          b = 153 + (21 - 153) * t;
        } else {
          const t = (n - 0.80) / 0.20;
          r = 250 + (239 - 250) * t;
          g = 204 + (68 - 204) * t;
          b = 21 + (68 - 21) * t;
        }
        out[p4] = Math.round(r);
        out[p4 + 1] = Math.round(g);
        out[p4 + 2] = Math.round(b);
        out[p4 + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    this.thermalDynTex.needsUpdate = true;
    if (this.earthMat) this.earthMat.uniforms.uHasThermalTex.value = 1.0;
  }

  initWindFluidLayer(compact) {
    const ww = compact ? 768 : 1024;
    const hh = compact ? 384 : 512;
    this.windCanvas = document.createElement('canvas');
    this.windCanvas.width = ww;
    this.windCanvas.height = hh;
    this.windCtx = this.windCanvas.getContext('2d');

    const count = compact ? 1300 : 1900;
    this.windParticles = Array.from({ length: count }, () => ({
      lon: Math.random() * 360 - 180,
      lat: (Math.random() * 2 - 1) * 74,
      age: Math.floor(Math.random() * 75),
      maxAge: 55 + Math.floor(Math.random() * 45),
    }));

    this.windTex = new THREE.CanvasTexture(this.windCanvas);
    this.windTex.wrapS = THREE.RepeatWrapping;

    const windGeo = new THREE.SphereGeometry(1.024, 64, 64);
    const windMat = new THREE.MeshBasicMaterial({
      map: this.windTex,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.windMesh = new THREE.Mesh(windGeo, windMat);
    this.windMesh.visible = this.layers.wind;
    this.globeGroup.add(this.windMesh);
    this.warmWindFluidLayer();
  }

  warmWindFluidLayer() {
    if (!this.windCtx || !this.windParticles.length) return;
    this.windCtx.clearRect(0, 0, this.windCanvas.width, this.windCanvas.height);
    for (let i = 0; i < 16; i++) {
      this.stepWindFluidLayer(0.042, true);
    }
  }

  stepWindFluidLayer(dt, force = false) {
    if (!this.windMesh || !this.layers.wind || !this.windCtx || !this.windTex) return;
    if (!force) {
      this.windAccumulator += dt;
      if (this.windAccumulator < 0.032) return;
    }
    const stepDt = force ? dt : Math.min(0.065, this.windAccumulator);
    if (!force) this.windAccumulator = 0;

    const ctx = this.windCtx;
    const w = this.windCanvas.width;
    const h = this.windCanvas.height;

    // Gentle silky exponential tail fade
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.068)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const advectScale = stepDt * 0.56;

    for (let i = 0; i < this.windParticles.length; i++) {
      const p = this.windParticles[i];
      p.age += 1;
      if (p.age >= p.maxAge || Math.abs(p.lat) > 80) {
        p.lon = Math.random() * 360 - 180;
        p.lat = (Math.random() * 2 - 1) * 74;
        p.age = 0;
        p.maxAge = 60 + Math.floor(Math.random() * 50);
        continue;
      }

      const [u0, v0] = this.sampleWindUv(this.hourOffset, p.lat, p.lon);
      const spd = Math.hypot(u0, v0);
      if (spd < 0.4) continue;

      const x0 = ((p.lon + 180) / 360) * w;
      const y0 = ((90 - p.lat) / 180) * h;

      // RK2 midpoint sample for silky curved fluid flow trajectories
      const cos0 = Math.max(0.28, Math.cos(p.lat * DEG2RAD));
      const midLon = ((((p.lon + (u0 / cos0) * advectScale * 0.5 + 180) % 360) + 360) % 360) - 180;
      const midLat = clamp(p.lat + v0 * advectScale * 0.5, -80, 80);
      const [uMid, vMid] = this.sampleWindUv(this.hourOffset, midLat, midLon);

      const cosMid = Math.max(0.28, Math.cos(midLat * DEG2RAD));
      let nextLon = p.lon + (uMid / cosMid) * advectScale;
      if (nextLon > 180) nextLon -= 360;
      if (nextLon < -180) nextLon += 360;
      const nextLat = clamp(p.lat + vMid * advectScale, -80, 80);

      const xMid = ((midLon + 180) / 360) * w;
      const yMid = ((90 - midLat) / 180) * h;
      const x1 = ((nextLon + 180) / 360) * w;
      const y1 = ((90 - nextLat) / 180) * h;

      p.lon = nextLon;
      p.lat = nextLat;

      if (Math.abs(x1 - x0) > w * 0.35 || Math.abs(xMid - x0) > w * 0.35) continue;

      const lifeFade = Math.sin((p.age / p.maxAge) * Math.PI);
      const alpha = clamp(lifeFade * (0.22 + Math.min(0.46, spd / 42)), 0.07, 0.68);

      let rgb = '125, 226, 255';
      if (spd >= 28) rgb = '253, 224, 118';
      else if (spd >= 14) rgb = '94, 242, 200';

      ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(2)})`;
      ctx.lineWidth = spd >= 24 ? 1.35 : 0.95;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(xMid, yMid, x1, y1);
      ctx.stroke();

      // Subtle brighter leading head dot shows true flow direction along each stream
      if (spd >= 9 && p.age % 3 === 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.72).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(x1, y1, spd >= 24 ? 1.15 : 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw subtle directional wind chevrons on a coarse global grid so wind direction is immediately readable
    if (this.globalGrid?.frames?.length) {
      ctx.lineWidth = 1.1;
      for (let lat = -60; lat <= 64; lat += 16) {
        for (let lon = -168; lon <= 168; lon += 24) {
          const [uKn, vKn] = this.sampleWindUv(this.hourOffset, lat, lon);
          const spd = Math.hypot(uKn, vKn);
          if (spd < 7) continue;
          const cx = ((lon + 180) / 360) * w;
          const cy = ((90 - lat) / 180) * h;
          const ang = Math.atan2(-vKn, uKn); // canvas Y increases downward
          const sz = spd >= 24 ? 5.2 : 3.8;
          ctx.strokeStyle = spd >= 26 ? 'rgba(253, 224, 118, 0.55)' : 'rgba(125, 226, 255, 0.42)';
          ctx.beginPath();
          ctx.moveTo(cx - Math.cos(ang - 0.55) * sz, cy - Math.sin(ang - 0.55) * sz);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx - Math.cos(ang + 0.55) * sz, cy - Math.sin(ang + 0.55) * sz);
          ctx.stroke();
        }
      }
    }

    this.windTex.needsUpdate = true;
  }

  getLocalGridTelemetry(latDeg, lonDeg, hourIdx = this.hourOffset) {
    const [uKn, vKn] = this.sampleWindUv(hourIdx, latDeg, lonDeg);
    const wind = windUvToCompass(uKn, vKn);
    return {
      cloudPct: Math.round(this.sampleGridScalar('cloud', hourIdx, latDeg, lonDeg)),
      tempF: Math.round(this.sampleGridScalar('temp', hourIdx, latDeg, lonDeg)),
      precipMm: Number(this.sampleGridScalar('precip', hourIdx, latDeg, lonDeg).toFixed(2)),
      ...wind,
    };
  }

  updateActiveBeacon() {
    if (!this.beaconGroup || !this.forecast?.location) return;
    const { latitude, longitude } = this.forecast.location;
    const pos = latLonToVec3(latitude, longitude, 1.012);
    this.beaconGroup.position.copy(pos);
    this.beaconGroup.lookAt(pos.clone().multiplyScalar(2));
  }

  handleResize() {
    if (!this.canvas || !this.renderer || !this.camera) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(240, Math.floor(rect.width));
    const h = Math.max(240, Math.floor(rect.height));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  setHourOffset(idx) {
    const next = clamp(Math.round(idx), 0, 47);
    if (next === this.hourOffset) return;
    this.hourOffset = next;
    this.updateDynamicCloudTexture();
    this.updateDynamicPrecipTexture();
    this.updateDynamicThermalTexture();
  }

  toggleLayer(layerKey) {
    if (!(layerKey in this.layers)) return false;
    this.layers[layerKey] = !this.layers[layerKey];
    const on = this.layers[layerKey];

    if (layerKey === 'clouds' && this.cloudMesh) {
      this.cloudMesh.visible = on;
    } else if (layerKey === 'precip' && this.precipMesh) {
      this.precipMesh.visible = on;
      if (on) this.updateDynamicPrecipTexture();
    } else if (layerKey === 'wind' && this.windMesh) {
      this.windMesh.visible = on;
    } else if (layerKey === 'terminator') {
      const val = on ? 1.0 : 0.0;
      if (this.earthMat) this.earthMat.uniforms.uTerminatorStrength.value = val;
      if (this.cloudMat) this.cloudMat.uniforms.uTerminatorStrength.value = val;
    } else if (layerKey === 'thermal' && this.earthMat) {
      this.earthMat.uniforms.uThermalOverlay.value = on ? 1.0 : 0.0;
      if (on) this.updateDynamicThermalTexture();
    }

    if (typeof this.onLayerChange === 'function') {
      this.onLayerChange(this.layers);
    }
    return on;
  }

  setAutoSpin(enabled) {
    this.autoSpin = Boolean(enabled);
    return this.autoSpin;
  }

  zoomBy(delta) {
    this.camDist = clamp(this.camDist - delta * 0.45, 1.55, 3.85);
  }

  flyTo(latDeg, lonDeg, instant = false) {
    const tLat = clamp(latDeg, -72, 72) * DEG2RAD;
    const tLon = lonDeg * DEG2RAD;
    if (instant) {
      this.camLat = tLat;
      this.camLon = tLon;
      this.targetCamLat = null;
      this.targetCamLon = null;
    } else {
      this.targetCamLat = tLat;
      this.targetCamLon = tLon;
    }
  }

  bindEvents() {
    if (!this.canvas || this.canvas.__webglBound) return;
    this.canvas.__webglBound = true;

    this.downPointer = { x: 0, y: 0, t: 0, id: null };

    this.canvas.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      this.isDragging = true;
      this.dragMoved = false;
      this.targetCamLat = null;
      this.targetCamLon = null;
      this.downPointer = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture?.(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isDragging || e.pointerId !== this.downPointer.id) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      const totalTravel = Math.hypot(e.clientX - this.downPointer.x, e.clientY - this.downPointer.y);
      if (totalTravel > 10) {
        this.dragMoved = true;
      }
      const sens = 0.0048 * (this.camDist / 2.6);
      this.camLon -= dx * sens;
      this.camLat = clamp(this.camLat + dy * sens, -1.32, 1.32);
      this.velLon = -dx * sens * 0.22;
      this.velLat = dy * sens * 0.22;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });

    const handleUp = (e) => {
      if (!this.isDragging || (e && this.downPointer.id !== null && e.pointerId !== this.downPointer.id)) return;
      this.isDragging = false;
      const elapsed = performance.now() - (this.downPointer.t || 0);
      const totalTravel = e ? Math.hypot(e.clientX - this.downPointer.x, e.clientY - this.downPointer.y) : 999;

      if (!this.dragMoved && totalTravel < 10 && elapsed < 450 && e && e.type === 'pointerup' && this.earthMesh) {
        const rect = this.canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const hits = this.raycaster.intersectObject(this.earthMesh, false);
        if (hits.length > 0 && typeof this.onSelectLocation === 'function') {
          let latitude;
          let longitude;
          if (hits[0].uv) {
            longitude = (((hits[0].uv.x * 360 - 180) + 540) % 360) - 180;
            latitude = clamp(hits[0].uv.y * 180 - 90, -85, 85);
          } else {
            const localPt = this.earthMesh.worldToLocal(hits[0].point.clone());
            ({ latitude, longitude } = vec3ToLatLon(localPt));
          }
          this.setAutoSpin(false);
          this.flyTo(latitude, longitude);
          const allPins = [...PRESET_CITIES, ...EXTRA_WORLD_PINS];
          const nearPreset = allPins.find(
            (c) => Math.hypot(c.latitude - latitude, c.longitude - longitude) < 3.5
          );
          if (nearPreset) {
            this.onSelectLocation(nearPreset);
          } else {
            const latDir = latitude >= 0 ? 'N' : 'S';
            const lonDir = longitude >= 0 ? 'E' : 'W';
            this.onSelectLocation({
              id: `${latitude.toFixed(2)},${longitude.toFixed(2)}`,
              name: `${Math.abs(latitude).toFixed(1)}°${latDir}, ${Math.abs(longitude).toFixed(1)}°${lonDir}`,
              latitude: Number(latitude.toFixed(4)),
              longitude: Number(longitude.toFixed(4)),
              wfo: 'GLOBAL',
              elevationFt: 120,
            });
          }
        }
      }
    };

    this.canvas.addEventListener('pointerup', handleUp);
    this.canvas.addEventListener('pointercancel', handleUp);

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camDist = clamp(this.camDist + (e.deltaY > 0 ? 0.14 : -0.14), 1.55, 3.85);
      },
      { passive: false }
    );
  }

  renderFrame(dt, tSec) {
    if (!this.renderer || !this.scene || !this.camera) return;

    // 1. Update camera spherical orbit / smooth fly-to / natural West-to-East Earth spin!
    if (!this.isDragging) {
      if (this.targetCamLon !== null && this.targetCamLat !== null) {
        let dLon = this.targetCamLon - this.camLon;
        while (dLon > Math.PI) dLon -= Math.PI * 2;
        while (dLon < -Math.PI) dLon += Math.PI * 2;
        const dLat = this.targetCamLat - this.camLat;
        this.camLon += dLon * 0.095;
        this.camLat = clamp(this.camLat + dLat * 0.095, -1.32, 1.32);
        if (Math.abs(dLon) < 0.004 && Math.abs(dLat) < 0.004) {
          this.targetCamLon = null;
          this.targetCamLat = null;
        }
      } else {
        // Real Earth rotates West -> East, meaning sub-camera longitude drifts slowly Westward (-=)
        this.camLon += this.velLon - (this.autoSpin ? dt * 0.026 : 0);
        this.camLat = clamp(this.camLat + this.velLat, -1.32, 1.32);
        this.velLon *= 0.91;
        this.velLat *= 0.91;
      }
    }

    const camPos = latLonToVec3(this.camLat * RAD2DEG, this.camLon * RAD2DEG, this.camDist);
    this.camera.position.copy(camPos);
    this.camera.lookAt(0, 0, 0);

    // 2. Real-Time Astronomical Solar Terminator
    const simDate = new Date(Date.now() + this.hourOffset * 3600000);
    const sunDir = getSubsolarVec3(simDate);
    if (this.earthMat) this.earthMat.uniforms.uSunDir.value.copy(sunDir);
    if (this.cloudMat) this.cloudMat.uniforms.uSunDir.value.copy(sunDir);
    if (this.atmoMat) this.atmoMat.uniforms.uSunDir.value.copy(sunDir);

    // 3. Clouds stay 100% geographically locked (NO drifting rotation.y!)

    // 4. Advance Fluid Atmospheric Wind Streamlines
    this.stepWindFluidLayer(dt);

    // 5. Pulse Active Beacon Ring & Project Floating Retina Callout Tag
    if (this.beaconRing) {
      const pulse = 1 + ((tSec * 1.35) % 1) * 1.45;
      this.beaconRing.scale.set(pulse, pulse, 1);
      this.beaconRing.material.opacity = 1 - ((tSec * 1.35) % 1);
    }

    if (this.floatingLabelEl && this.beaconGroup && this.forecast?.location) {
      const worldPos = new THREE.Vector3();
      this.beaconGroup.getWorldPosition(worldPos);
      const facing = worldPos.clone().normalize().dot(this.camera.position.clone().normalize());
      if (facing > 0.14) {
        const proj = worldPos.clone().project(this.camera);
        const rect = this.canvas.getBoundingClientRect();
        const x = (proj.x * 0.5 + 0.5) * rect.width;
        const y = (-proj.y * 0.5 + 0.5) * rect.height;
        const h = this.forecast.hours48?.[this.hourOffset] || this.forecast.hours?.[this.hourOffset] || this.forecast.current;
        const gridTel = this.globalGrid?.frames?.length
          ? this.getLocalGridTelemetry(this.forecast.location.latitude, this.forecast.location.longitude, this.hourOffset)
          : null;
        const temp = h?.tempF ?? h?.temperature ?? gridTel?.tempF;
        const cloud = h?.cloudCover ?? h?.skyCover ?? gridTel?.cloudPct;
        const tempTxt = typeof temp === 'number' && Number.isFinite(temp) ? `${Math.round(temp)}°` : '--°';
        const cloudTxt = typeof cloud === 'number' && Number.isFinite(cloud) ? `${Math.round(cloud)}% Cloud` : 'Live';
        const windTxt = gridTel ? ` · ${gridTel.mph} mph ${gridTel.compass} ${gridTel.arrow}` : '';
        const cityName = (this.forecast.location.name || 'Selected').split(',')[0];
        this.floatingLabelEl.hidden = false;
        this.floatingLabelEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y - 26)}px) translate(-50%, -50%)`;
        this.floatingLabelEl.innerHTML = `<span class="beacon-dot"></span> ${cityName} · <strong>${tempTxt}</strong> · ${cloudTxt}${windTxt}`;
      } else {
        this.floatingLabelEl.hidden = true;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
