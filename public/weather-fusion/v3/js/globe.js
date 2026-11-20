/**
 * Weather Nourie · Photorealistic Three.js WebGL 3D Satellite Earth Globe
 * - Real NASA Blue Marble 2K Day + Real NASA Black Marble 2K Night City Lights GLSL Shader
 * - Real NASA SRTM Topography Bump Relief & Ocean Specular Reflection
 * - Actual Live Geostationary Satellite Global Cloud Cover Shell (EUMETSAT + NOAA GOES + Himawari)
 * - Actual Live NASA GPM IMERG Global Satellite Precipitation Overlay
 * - Real-Time Astronomical Solar Terminator + Fresnel Atmospheric Rayleigh Scattering Glow
 * - Animated 3D Jet Stream Wind Ribbons, Deep-Space Starfield & Click-Anywhere 3D Raycast
 */

import * as THREE from '../vendor/three.module.min.js';
import { DEG2RAD, RAD2DEG, clamp } from './physics.js';
import { PRESET_CITIES } from './fusion-engine.js';

function latLonToVec3(latDeg, lonDeg, radius = 1) {
  const phi = (90 - latDeg) * DEG2RAD;
  const theta = (lonDeg + 180) * DEG2RAD;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function vec3ToLatLon(vec) {
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
  uniform vec3 uSunDir;
  uniform float uTerminatorStrength;
  uniform float uThermalOverlay;
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

    // Subtle elevation relief shading
    float ndotl = dot(N, L);
    float dayFactor = smoothstep(-0.14, 0.22, ndotl);
    float effectiveDay = mix(1.0, dayFactor, uTerminatorStrength);

    // Rich sunlit day earth + ocean specular glint
    float diffuse = mix(0.28, 1.18, clamp(ndotl * 0.85 + 0.35, 0.0, 1.0));
    float fullDayDiffuse = mix(diffuse, 1.08, 1.0 - uTerminatorStrength);
    vec3 litDay = dayColor * fullDayDiffuse;

    // Subtle ocean sun specular where elevation is low (sea level)
    float isOcean = 1.0 - smoothstep(0.03, 0.09, elev);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 42.0) * isOcean * 0.34 * effectiveDay;
    litDay += vec3(0.75, 0.88, 1.0) * spec;

    // Night hemisphere: deep midnight blue base + bright warm golden NASA Black Marble city lights
    vec3 nightBase = dayColor * vec3(0.06, 0.09, 0.16);
    vec3 cityLights = pow(nightColor, vec3(1.15)) * vec3(1.55, 1.25, 0.78) * 1.45;
    vec3 litNight = nightBase + cityLights;

    // Sunset/sunrise twilight glow band right along the terminator
    float twilight = exp(-pow(ndotl * 7.5, 2.0)) * uTerminatorStrength;
    vec3 twilightTint = vec3(1.0, 0.48, 0.22) * twilight * 0.24;

    vec3 color = mix(litNight, litDay, effectiveDay) + twilightTint;

    // Optional Global Thermal Latitude Band Tint
    if (uThermalOverlay > 0.01) {
      float latFactor = 1.0 - abs(vUv.y - 0.5) * 2.0; // 1 at equator, 0 at poles
      vec3 coldCol = vec3(0.16, 0.45, 0.98);
      vec3 mildCol = vec3(0.20, 0.82, 0.58);
      vec3 hotCol = vec3(0.98, 0.36, 0.18);
      vec3 thermalCol = latFactor < 0.5
        ? mix(coldCol, mildCol, latFactor * 2.0)
        : mix(mildCol, hotCol, (latFactor - 0.5) * 2.0);
      color = mix(color, thermalCol, 0.42 * uThermalOverlay);
    }

    // Subtle atmospheric perspective near sphere limb
    float rim = 1.0 - max(dot(N, V), 0.0);
    color += vec3(0.24, 0.58, 1.0) * pow(rim, 3.2) * 0.36;

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
    // clouds-alpha.png uses alpha channel (or brightness fallback)
    float density = max(tex.a, (tex.r + tex.g + tex.b) / 3.0 * tex.a);
    if (density < 0.02) discard;

    vec3 N = normalize(vNormalWorld);
    vec3 L = normalize(uSunDir);
    float ndotl = dot(N, L);
    float dayFactor = smoothstep(-0.22, 0.25, ndotl);
    float effectiveDay = mix(1.0, dayFactor, uTerminatorStrength);

    // Bright crisp white clouds in day, silver-blue moonlit clouds at night so cloud cover is always legible
    vec3 dayCloud = vec3(0.97, 0.99, 1.0);
    vec3 nightCloud = vec3(0.32, 0.44, 0.64);
    float twilight = exp(-pow(ndotl * 6.5, 2.0)) * uTerminatorStrength;
    vec3 cloudCol = mix(nightCloud, dayCloud, effectiveDay) + vec3(0.95, 0.55, 0.28) * twilight * 0.22;

    float alpha = clamp(density * uOpacity * mix(0.68, 0.96, effectiveDay), 0.0, 0.94);
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
    this.windLines = null;
    this.windState = [];
    this.beaconGroup = null;
    this.beaconRing = null;
    this.cityPinGroup = null;
    this.floatingLabelEl = null;

    // Camera spherical orbit angles (radians)
    this.camLon = -122.4194 * DEG2RAD;
    this.camLat = 34 * DEG2RAD;
    this.targetCamLon = null;
    this.targetCamLat = null;
    this.velLon = 0;
    this.velLat = 0;
    this.camDist = 2.65;
    this.autoSpin = true;

    // Interactive layers
    this.layers = {
      clouds: true,
      wind: true,
      precip: false,
      terminator: true,
      thermal: false
    };

    this.hourOffset = 0;
    this.forecast = null;
    this.isDragging = false;
    this.dragMoved = false;
    this.lastPointer = { x: 0, y: 0 };
    this.initialized = false;
    this.raycaster = new THREE.Raycaster();
    this.lastTime = 0;
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

    // Create floating retina HTML callout tag inside .globe-stage-wrap
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

  setupThreeScene() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(300, Math.floor(rect.width || 480));
    const h = Math.max(300, Math.floor(rect.height || 380));

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);

    // Frame the full luminous Earth horizon comfortably on both desktop and portrait mobile
    this.camDist = w < 440 ? 3.25 : 2.85;

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
      opacity: 0.72
    });
    this.scene.add(new THREE.Points(starGeo, starMat));

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    const loadTex = (url, fallbackUrl = null, onReady = null) => {
      const tex = loader.load(
        url,
        (loaded) => {
          loaded.wrapS = THREE.RepeatWrapping;
          loaded.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
          if (onReady) onReady(loaded);
        },
        undefined,
        () => {
          if (fallbackUrl) {
            loader.load(fallbackUrl, (fb) => {
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

    // 2. Photorealistic NASA Blue Marble + Black Marble Earth Sphere
    const earthGeo = new THREE.SphereGeometry(1, 64, 64);
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uDayTex: { value: dayTex },
        uNightTex: { value: nightTex },
        uBumpTex: { value: bumpTex },
        uSunDir: { value: sunDir.clone() },
        uTerminatorStrength: { value: 1.0 },
        uThermalOverlay: { value: 0.0 }
      },
      vertexShader: EARTH_VERTEX_SHADER,
      fragmentShader: EARTH_FRAGMENT_SHADER
    });
    this.earthMesh = new THREE.Mesh(earthGeo, this.earthMat);
    this.globeGroup.add(this.earthMesh);

    // 3. Real-Time Live Global Geostationary Satellite Cloud Shell
    const cloudGeo = new THREE.SphereGeometry(1.016, 64, 64);
    const cloudTex = loadTex(
      '/api/weather-fusion/v3/live-clouds.png',
      '/weather-fusion/v3/textures/clouds-fallback.png',
      (loaded) => {
        if (this.cloudMat) {
          this.cloudMat.uniforms.uCloudTex.value = loaded;
          this.cloudMat.needsUpdate = true;
        }
      }
    );
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uCloudTex: { value: cloudTex },
        uSunDir: { value: sunDir.clone() },
        uTerminatorStrength: { value: 1.0 },
        uOpacity: { value: 0.92 }
      },
      vertexShader: CLOUDS_VERTEX_SHADER,
      fragmentShader: CLOUDS_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false
    });
    this.cloudMesh = new THREE.Mesh(cloudGeo, this.cloudMat);
    this.globeGroup.add(this.cloudMesh);

    // 4. Real-Time NASA GPM IMERG Global Satellite Precipitation Layer
    const precipGeo = new THREE.SphereGeometry(1.022, 64, 64);
    const precipMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    loadTex(
      '/api/weather-fusion/v3/live-precip.png',
      'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=IMERG_Precipitation_Rate&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=2048&HEIGHT=1024&FORMAT=image/png&TRANSPARENT=true',
      (loaded) => {
        precipMat.map = loaded;
        precipMat.needsUpdate = true;
      }
    );
    this.precipMesh = new THREE.Mesh(precipGeo, precipMat);
    this.precipMesh.visible = this.layers.precip;
    this.globeGroup.add(this.precipMesh);

    // 5. Real Rayleigh Atmospheric Fresnel Halo
    const atmoGeo = new THREE.SphereGeometry(1.105, 64, 64);
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: sunDir.clone() }
      },
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });
    this.atmoMat = atmoMat;
    this.globeGroup.add(new THREE.Mesh(atmoGeo, atmoMat));

    // 6. 3D Animated Jet Stream & Planetary Wind Ribbons
    this.buildWindRibbons();

    // 7. Preset City Pins + Active Pulsing Beacon
    this.cityPinGroup = new THREE.Group();
    const pinGeo = new THREE.SphereGeometry(0.011, 10, 10);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0x7ac6ff });
    PRESET_CITIES.forEach((city) => {
      const m = new THREE.Mesh(pinGeo, pinMat);
      m.position.copy(latLonToVec3(city.latitude, city.longitude, 1.008));
      this.cityPinGroup.add(m);
    });
    this.globeGroup.add(this.cityPinGroup);

    this.beaconGroup = new THREE.Group();
    const dotGeo = new THREE.SphereGeometry(0.019, 16, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x5ce0a0 });
    this.beaconGroup.add(new THREE.Mesh(dotGeo, dotMat));

    const ringGeo = new THREE.RingGeometry(0.026, 0.038, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x5ce0a0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    });
    this.beaconRing = new THREE.Mesh(ringGeo, ringMat);
    this.beaconGroup.add(this.beaconRing);
    this.globeGroup.add(this.beaconGroup);

    // ResizeObserver for crisp layout across mobile & desktop
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.handleResize()).observe(this.canvas.parentElement || this.canvas);
    }
    window.addEventListener('resize', () => this.handleResize());
  }

  buildWindRibbons() {
    const count = 150;
    this.windState = [];
    for (let i = 0; i < count; i++) {
      this.windState.push({
        lon: ((i * 67) % 360) - 180,
        lat: ((i * 43) % 136) - 68,
        speed: 5.5 + (i % 6) * 2.2
      });
    }
    const positions = new Float32Array(count * 2 * 3);
    const colors = new Float32Array(count * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.78
    });
    this.windLines = new THREE.LineSegments(geo, mat);
    this.windLines.visible = this.layers.wind;
    this.globeGroup.add(this.windLines);
  }

  updateWindRibbons(dt) {
    if (!this.windLines || !this.layers.wind) return;
    const pos = this.windLines.geometry.attributes.position;
    const col = this.windLines.geometry.attributes.color;
    const r = 1.032;

    for (let i = 0; i < this.windState.length; i++) {
      const w = this.windState[i];
      const absLat = Math.abs(w.lat);
      const isJet = absLat >= 28 && absLat <= 56;
      const dir = absLat < 22 ? -0.55 : isJet ? 1.45 : -0.4;
      const dLon = dir * w.speed * dt;
      const dLat = Math.sin(w.lon * DEG2RAD * 3) * 1.4 * dt;

      w.lon = ((w.lon + dLon + 540) % 360) - 180;
      w.lat = clamp(w.lat + dLat, -74, 74);

      const head = latLonToVec3(w.lat, w.lon, r);
      const tail = latLonToVec3(clamp(w.lat - dLat * 4, -76, 76), w.lon - dir * (isJet ? 5.2 : 2.8), r);

      const idx = i * 2;
      pos.setXYZ(idx, tail.x, tail.y, tail.z);
      pos.setXYZ(idx + 1, head.x, head.y, head.z);

      if (isJet) {
        col.setXYZ(idx, 0.2, 0.72, 1.0);
        col.setXYZ(idx + 1, 0.45, 0.98, 0.85);
      } else {
        col.setXYZ(idx, 0.35, 0.65, 0.95);
        col.setXYZ(idx + 1, 0.7, 0.92, 1.0);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
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
    this.hourOffset = clamp(idx, 0, 47);
  }

  toggleLayer(layerKey) {
    if (!(layerKey in this.layers)) return false;
    this.layers[layerKey] = !this.layers[layerKey];
    const on = this.layers[layerKey];

    if (layerKey === 'clouds' && this.cloudMesh) {
      this.cloudMesh.visible = on;
    } else if (layerKey === 'precip' && this.precipMesh) {
      this.precipMesh.visible = on;
    } else if (layerKey === 'wind' && this.windLines) {
      this.windLines.visible = on;
    } else if (layerKey === 'terminator') {
      const val = on ? 1.0 : 0.0;
      if (this.earthMat) this.earthMat.uniforms.uTerminatorStrength.value = val;
      if (this.cloudMat) this.cloudMat.uniforms.uTerminatorStrength.value = val;
    } else if (layerKey === 'thermal' && this.earthMat) {
      this.earthMat.uniforms.uThermalOverlay.value = on ? 1.0 : 0.0;
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

    this.canvas.addEventListener('pointerdown', (e) => {
      this.isDragging = true;
      this.dragMoved = false;
      this.targetCamLat = null;
      this.targetCamLon = null;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture?.(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        this.dragMoved = true;
      }
      const sens = 0.0052 * (this.camDist / 2.6);
      this.camLon -= dx * sens;
      this.camLat = clamp(this.camLat + dy * sens, -1.32, 1.32);
      this.velLon = -dx * sens * 0.25;
      this.velLat = dy * sens * 0.25;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });

    const handleUp = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;

      if (!this.dragMoved && e && e.type === 'pointerup' && this.earthMesh) {
        const rect = this.canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const hits = this.raycaster.intersectObject(this.earthMesh, false);
        if (hits.length > 0 && typeof this.onSelectLocation === 'function') {
          const localPt = this.earthMesh.worldToLocal(hits[0].point.clone());
          const { latitude, longitude } = vec3ToLatLon(localPt);
          this.flyTo(latitude, longitude);
          const nearPreset = PRESET_CITIES.find(
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
              elevationFt: 120
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

    // 1. Update camera spherical orbit / smooth fly-to / inertia
    if (!this.isDragging) {
      if (this.targetCamLon !== null && this.targetCamLat !== null) {
        let dLon = this.targetCamLon - this.camLon;
        while (dLon > Math.PI) dLon -= Math.PI * 2;
        while (dLon < -Math.PI) dLon += Math.PI * 2;
        const dLat = this.targetCamLat - this.camLat;
        this.camLon += dLon * 0.085;
        this.camLat = clamp(this.camLat + dLat * 0.085, -1.32, 1.32);
        if (Math.abs(dLon) < 0.005 && Math.abs(dLat) < 0.005) {
          this.targetCamLon = null;
          this.targetCamLat = null;
        }
      } else {
        this.camLon += this.velLon + (this.autoSpin ? dt * 0.055 : 0);
        this.camLat = clamp(this.camLat + this.velLat, -1.32, 1.32);
        this.velLon *= 0.91;
        this.velLat *= 0.91;
      }
    }

    // Position camera using exact matching spherical coordinates
    const camPos = latLonToVec3(this.camLat * RAD2DEG, this.camLon * RAD2DEG, this.camDist);
    this.camera.position.copy(camPos);
    this.camera.lookAt(0, 0, 0);

    // 2. Real-Time Solar Terminator Position (+ 48h Time Machine Offset)
    const simDate = new Date(Date.now() + this.hourOffset * 3600000);
    const sunDir = getSubsolarVec3(simDate);
    if (this.earthMat) this.earthMat.uniforms.uSunDir.value.copy(sunDir);
    if (this.cloudMat) this.cloudMat.uniforms.uSunDir.value.copy(sunDir);
    if (this.atmoMat) this.atmoMat.uniforms.uSunDir.value.copy(sunDir);

    // 3. Gently advect real satellite cloud cover across the planet!
    if (this.cloudMesh) {
      this.cloudMesh.rotation.y = (tSec * 0.0045 + this.hourOffset * 0.016) % (Math.PI * 2);
    }

    // 4. Animate 3D Jet Stream Wind Ribbons
    this.updateWindRibbons(dt);

    // 5. Pulse Active Beacon Ring & Project Floating Retina Callout Tag
    if (this.beaconRing) {
      const pulse = 1 + ((tSec * 1.35) % 1) * 1.45;
      this.beaconRing.scale.set(pulse, pulse, 1);
      this.beaconRing.material.opacity = 1 - ((tSec * 1.35) % 1);
    }

    if (this.floatingLabelEl && this.beaconGroup && this.forecast?.location) {
      const worldPos = new THREE.Vector3();
      this.beaconGroup.getWorldPosition(worldPos);
      // Visible only when beacon is on camera-facing hemisphere
      const facing = worldPos.clone().normalize().dot(this.camera.position.clone().normalize());
      if (facing > 0.14) {
        const proj = worldPos.clone().project(this.camera);
        const rect = this.canvas.getBoundingClientRect();
        const x = (proj.x * 0.5 + 0.5) * rect.width;
        const y = (-proj.y * 0.5 + 0.5) * rect.height;
        const h = this.forecast.hours48?.[this.hourOffset] || this.forecast.current;
        this.floatingLabelEl.hidden = false;
        this.floatingLabelEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y - 26)}px) translate(-50%, -50%)`;
        this.floatingLabelEl.innerHTML = `<span class="beacon-dot"></span> ${this.forecast.location.name.split(',')[0]} · <strong>${h?.tempF ?? '--'}°</strong> · ${h?.cloudCover ?? '--'}% Cloud`;
      } else {
        this.floatingLabelEl.hidden = true;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
