/**
 * Weather Nourie · Live 3D Atmospheric & Cloud Cover Earth Globe Engine
 * Features:
 * - Real-time 3D Orthographic Spherical Projection with inertia drag, zoom & smooth slerp Fly-To
 * - Live Cloud Cover Advection calibrated to actual Open-Meteo cloud cover %, wind speed & direction
 * - Real Astronomical Subsolar Point & Day/Night Solar Terminator + Night City Lights
 * - Animated 3D Coriolis & Jet Stream Wind Particle Trails on the sphere
 * - 5 Toggleable Layers: Live Clouds, Wind Streams, Thermal Field, Precip Cores, Day/Night Terminator
 * - Click-Anywhere-on-Earth 3D Raycast to teleport & fetch live multi-model forecast for any coordinate
 */

import { DEG2RAD, RAD2DEG, clamp, getSolarGeometry, lerp } from './physics.js';
import { PRESET_CITIES } from './fusion-engine.js';

// High-recognition continental coastline polygons [lon, lat] for crisp 3D vector landmass rendering
const CONTINENT_POLYGONS = [
  // North America
  [[-168,65],[-162,58],[-152,60],[-140,60],[-130,54],[-124,48],[-124,40],[-120,34],[-117,32],[-110,23],[-105,20],[-97,16],[-88,16],[-83,9],[-79,9],[-82,15],[-87,21],[-90,21],[-97,26],[-95,29],[-89,30],[-83,29],[-81,25],[-80,27],[-81,31],[-76,35],[-75,39],[-70,42],[-67,45],[-61,46],[-65,48],[-56,51],[-60,55],[-64,60],[-78,62],[-82,67],[-95,70],[-115,72],[-135,70],[-156,71],[-168,65]],
  // Greenland
  [[-44,60],[-22,70],[-18,81],[-46,82],[-56,76],[-52,66],[-44,60]],
  // South America
  [[-78,9],[-75,11],[-62,10],[-50,1],[-35,-6],[-38,-14],[-40,-22],[-48,-28],[-54,-34],[-62,-39],[-66,-48],[-68,-55],[-75,-52],[-73,-42],[-71,-30],[-71,-18],[-77,-12],[-81,-5],[-78,2],[-78,9]],
  // Europe
  [[-9,36],[-9,43],[-2,43],[-5,48],[2,51],[8,54],[10,58],[5,60],[6,63],[16,69],[28,71],[32,69],[42,67],[60,69],[60,55],[48,46],[38,45],[29,41],[26,40],[23,37],[15,38],[16,41],[12,44],[9,44],[3,42],[0,38],[-5,36],[-9,36]],
  // UK & Ireland
  [[-6,50],[-5,55],[-2,58],[1,53],[1,51],[-6,50]],
  // Africa
  [[-17,15],[-13,28],[-6,36],[10,37],[11,33],[25,32],[33,31],[39,22],[43,12],[51,12],[49,4],[41,-2],[40,-11],[35,-24],[28,-33],[18,-35],[15,-23],[12,-6],[9,4],[3,6],[-8,5],[-15,11],[-17,15]],
  // Madagascar
  [[44,-13],[50,-15],[47,-25],[43,-24],[44,-13]],
  // Asia
  [[28,41],[40,42],[50,40],[54,37],[48,30],[56,26],[62,25],[68,23],[73,15],[80,8],[88,22],[92,21],[98,16],[100,2],[104,1],[106,10],[109,13],[108,21],[114,22],[122,30],[120,38],[126,38],[129,35],[131,42],[140,48],[143,55],[156,51],[162,60],[178,65],[178,70],[140,73],[105,77],[72,73],[60,69],[48,46],[28,41]],
  // Japan
  [[130,31],[136,34],[141,38],[145,44],[140,42],[135,35],[130,31]],
  // Australia
  [[114,-22],[122,-17],[131,-12],[136,-12],[142,-11],[146,-18],[153,-26],[150,-37],[140,-38],[131,-32],[122,-34],[115,-34],[114,-22]],
  // New Zealand
  [[172,-35],[178,-38],[174,-42],[167,-46],[172,-35]],
  // Antarctica
  [[-180,-72],[-120,-73],[-60,-65],[0,-70],[60,-67],[120,-66],[179,-71],[180,-85],[-180,-85],[-180,-72]]
];

// Major urban night-light clusters [lon, lat, intensity]
const NIGHT_CITY_CLUSTERS = [
  [-74.0, 40.7, 1.0], [-87.6, 41.8, 0.85], [-118.2, 34.0, 0.95], [-122.4, 37.7, 0.9],
  [-78.5, 35.8, 0.8], [-80.2, 25.8, 0.85], [-95.4, 29.8, 0.85], [-99.1, 19.4, 0.9],
  [-46.6, -23.5, 0.95], [-58.4, -34.6, 0.85], [-0.1, 51.5, 1.0], [2.3, 48.8, 0.95],
  [13.4, 52.5, 0.85], [12.5, 41.9, 0.8], [37.6, 55.7, 0.9], [31.2, 30.0, 0.9],
  [55.3, 25.2, 0.85], [72.8, 19.0, 0.95], [77.2, 28.6, 0.95], [100.5, 13.7, 0.85],
  [103.8, 1.3, 0.9], [114.1, 22.3, 0.95], [121.5, 31.2, 1.0], [116.4, 39.9, 0.95],
  [126.9, 37.5, 0.9], [139.7, 35.7, 1.0], [151.2, -33.8, 0.85]
];

export class LiveCloudGlobe {
  constructor({ canvasId = 'cloud-globe-canvas', onSelectLocation, onLayerChange }) {
    this.canvasId = canvasId;
    this.onSelectLocation = onSelectLocation;
    this.onLayerChange = onLayerChange;
    this.canvas = null;
    this.ctx = null;

    // Camera spherical orientation (degrees)
    this.rotLon = -122.4194;
    this.rotLat = 34.0;
    this.targetLon = null;
    this.targetLat = null;
    this.velLon = 0;
    this.velLat = 0;
    this.zoom = 1.08;
    this.autoSpin = true;

    // Active layers
    this.layers = {
      clouds: true,
      wind: true,
      thermal: false,
      precip: true,
      terminator: true
    };

    // Time scrubber offset (0..47 hours)
    this.hourOffset = 0;
    this.forecast = null;
    this.globalSampleNodes = [];

    // Pre-generate 420 volumetric cloud puffs & synoptic cyclone bands on the sphere
    this.cloudPuffs = this.createSynopticCloudDeck();
    // Pre-generate 210 3D wind stream particles
    this.windParticles = this.createWindParticles();

    this.isDragging = false;
    this.dragMoved = false;
    this.lastPointer = { x: 0, y: 0 };
    this.animFrame = null;
  }

  init(forecast) {
    this.forecast = forecast;
    this.canvas = document.getElementById(this.canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    if (forecast?.location) {
      this.flyTo(forecast.location.latitude, forecast.location.longitude);
    }

    this.bindEvents();
    this.fetchGlobalCloudSamples();

    if (!this.animFrame) {
      const loop = (ts) => {
        this.renderFrame(ts);
        this.animFrame = requestAnimationFrame(loop);
      };
      this.animFrame = requestAnimationFrame(loop);
    }
  }

  updateForecast(forecast) {
    this.forecast = forecast;
    if (forecast?.location) {
      this.flyTo(forecast.location.latitude, forecast.location.longitude);
    }
  }

  setHourOffset(idx) {
    this.hourOffset = clamp(idx, 0, 47);
  }

  toggleLayer(layerKey) {
    if (layerKey in this.layers) {
      this.layers[layerKey] = !this.layers[layerKey];
      if (typeof this.onLayerChange === 'function') {
        this.onLayerChange(this.layers);
      }
    }
    return this.layers[layerKey];
  }

  setAutoSpin(enabled) {
    this.autoSpin = Boolean(enabled);
    return this.autoSpin;
  }

  flyTo(lat, lon) {
    this.targetLat = clamp(lat, -70, 70);
    this.targetLon = lon;
  }

  /**
   * Fetches live global cloud-cover & temperature telemetry across key global anchor coordinates
   * from Open-Meteo so the 3D globe's regional cloud density reflects live planetary weather.
   */
  async fetchGlobalCloudSamples() {
    const anchors = [
      { lat: 37.77, lon: -122.42 }, // West Coast US
      { lat: 35.78, lon: -78.48 },  // East Coast US
      { lat: 41.88, lon: -87.63 },  // Midwest US
      { lat: 25.76, lon: -80.19 },  // Gulf / Atlantic
      { lat: 51.51, lon: -0.13 },   // Western Europe
      { lat: 35.68, lon: 139.77 },  // East Asia
      { lat: -23.55, lon: -46.63 }, // South America
      { lat: -33.87, lon: 151.21 }  // Australia
    ];

    try {
      const lats = anchors.map((a) => a.lat).join(',');
      const lons = anchors.map((a) => a.lon).join(',');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=cloud_cover,temperature_2m,precipitation,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : [data];
      this.globalSampleNodes = list.map((item, idx) => ({
        lat: anchors[idx].lat,
        lon: anchors[idx].lon,
        cloudCover: item?.current?.cloud_cover ?? 55,
        tempF: item?.current?.temperature_2m ?? 60,
        precip: item?.current?.precipitation ?? 0,
        windMph: item?.current?.wind_speed_10m ?? 12,
        windDir: item?.current?.wind_direction_10m ?? 250
      }));
    } catch {
      // Uses deterministic planetary synoptic state if offline
    }
  }

  createSynopticCloudDeck() {
    const puffs = [];
    // 1. ITCZ Equatorial Cloud Belt + Mid-Latitude Baroclinic Frontal Systems + Polar Vortices
    const stormCenters = [
      { lon: -138, lat: 46, radius: 22, spin: 1 },
      { lon: -74, lat: 39, radius: 19, spin: 1 },
      { lon: -28, lat: 54, radius: 25, spin: 1 },
      { lon: 18, lat: 48, radius: 18, spin: 1 },
      { lon: 145, lat: 42, radius: 24, spin: 1 },
      { lon: -110, lat: 8, radius: 16, spin: 0 },
      { lon: -45, lat: 4, radius: 18, spin: 0 },
      { lon: 95, lat: 5, radius: 20, spin: 0 },
      { lon: -55, lat: -44, radius: 24, spin: -1 },
      { lon: 85, lat: -48, radius: 26, spin: -1 }
    ];

    for (let i = 0; i < 360; i++) {
      const center = stormCenters[i % stormCenters.length];
      const armAngle = (i / 18) * Math.PI * 2;
      const dist = ((i * 17) % 100) / 100 * center.radius;
      // Comma-cloud spiral offset
      const spiralAngle = armAngle + (dist / center.radius) * 2.1 * center.spin;
      const lat = clamp(center.lat + Math.sin(spiralAngle) * dist * 0.72, -82, 82);
      const lon = ((center.lon + Math.cos(spiralAngle) * dist * 1.15 + 540) % 360) - 180;
      const size = 2.6 + ((i * 13) % 7) * 0.85;
      const baseOpacity = 0.22 + ((i * 29) % 50) / 100;
      const driftLonPerSec = (Math.abs(lat) > 25 ? 0.42 : -0.25) * (0.7 + ((i % 5) * 0.15));
      const driftLatPerSec = Math.sin(i) * 0.06;

      puffs.push({
        baseLon: lon,
        baseLat: lat,
        size,
        baseOpacity,
        driftLonPerSec,
        driftLatPerSec,
        isLocalCluster: false
      });
    }

    // 2. Local High-Detail Cloud Deck around the active selected location (65 puffs)
    for (let j = 0; j < 65; j++) {
      const r = Math.sqrt(j / 65) * 14;
      const theta = j * 2.39996; // Golden angle distribution
      puffs.push({
        offsetLon: Math.cos(theta) * r * 1.25,
        offsetLat: Math.sin(theta) * r,
        size: 2.2 + (j % 5) * 0.9,
        baseOpacity: 0.35 + (j % 4) * 0.12,
        phase: j * 0.5,
        isLocalCluster: true
      });
    }

    return puffs;
  }

  createWindParticles() {
    const list = [];
    for (let i = 0; i < 210; i++) {
      list.push({
        lon: ((i * 73) % 360) - 180,
        lat: ((i * 41) % 150) - 75,
        trail: [],
        speedFactor: 0.7 + (i % 7) * 0.14
      });
    }
    return list;
  }

  /**
   * Projects spherical [lon, lat] (degrees) onto 2D canvas [x, y, z]
   * where z > 0 means visible on the front hemisphere.
   */
  project(lonDeg, latDeg, cx, cy, radius) {
    const lam = (lonDeg - this.rotLon) * DEG2RAD;
    const phi = latDeg * DEG2RAD;
    const phi0 = this.rotLat * DEG2RAD;

    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const cosPhi0 = Math.cos(phi0);
    const sinPhi0 = Math.sin(phi0);
    const cosLam = Math.cos(lam);
    const sinLam = Math.sin(lam);

    const z = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosLam;
    const x = cx + radius * cosPhi * sinLam;
    const y = cy - radius * (cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosLam);

    return { x, y, z, visible: z > 0 };
  }

  /**
   * Inverse orthographic projection: converts canvas (px, py) click to spherical [lon, lat]
   */
  unproject(px, py, cx, cy, radius) {
    const nx = (px - cx) / radius;
    const ny = (cy - py) / radius;
    const rho = Math.sqrt(nx * nx + ny * ny);
    if (rho > 1) return null;

    const c = Math.asin(rho);
    const cosC = Math.cos(c);
    const sinC = Math.sin(c);
    const phi0 = this.rotLat * DEG2RAD;
    const lam0 = this.rotLon * DEG2RAD;

    const phi =
      rho === 0
        ? phi0
        : Math.asin(cosC * Math.sin(phi0) + (ny * sinC * Math.cos(phi0)) / rho);
    const lam =
      lam0 +
      Math.atan2(
        nx * sinC,
        rho * Math.cos(phi0) * cosC - ny * Math.sin(phi0) * sinC
      );

    let lon = lam * RAD2DEG;
    lon = ((lon + 540) % 360) - 180;
    const lat = clamp(phi * RAD2DEG, -85, 85);
    return { latitude: lat, longitude: lon };
  }

  bindEvents() {
    if (!this.canvas || this.canvas.__globeBound) return;
    this.canvas.__globeBound = true;

    this.canvas.addEventListener('pointerdown', (e) => {
      this.isDragging = true;
      this.dragMoved = false;
      this.targetLat = null;
      this.targetLon = null;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture?.(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this.dragMoved = true;
      }
      const sensitivity = 0.28 / this.zoom;
      this.rotLon = ((this.rotLon - dx * sensitivity + 540) % 360) - 180;
      this.rotLat = clamp(this.rotLat + dy * sensitivity, -78, 78);
      this.velLon = -dx * sensitivity * 0.35;
      this.velLat = dy * sensitivity * 0.35;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });

    const endDrag = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;

      // If it was a clean click/tap without dragging, raycast to Earth coordinates!
      if (!this.dragMoved && e && e.type === 'pointerup') {
        const rect = this.canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const radius = Math.min(cx, cy) * 0.82 * this.zoom;
        const hit = this.unproject(px, py, cx, cy, radius);
        if (hit && typeof this.onSelectLocation === 'function') {
          this.flyTo(hit.latitude, hit.longitude);
          // Check if near a preset city first
          const nearPreset = PRESET_CITIES.find(
            (c) => Math.hypot(c.latitude - hit.latitude, c.longitude - hit.longitude) < 3.5
          );
          if (nearPreset) {
            this.onSelectLocation(nearPreset);
          } else {
            const latDir = hit.latitude >= 0 ? 'N' : 'S';
            const lonDir = hit.longitude >= 0 ? 'E' : 'W';
            this.onSelectLocation({
              id: `${hit.latitude.toFixed(2)},${hit.longitude.toFixed(2)}`,
              name: `Globe Point (${Math.abs(hit.latitude).toFixed(1)}°${latDir}, ${Math.abs(hit.longitude).toFixed(1)}°${lonDir})`,
              latitude: Number(hit.latitude.toFixed(4)),
              longitude: Number(hit.longitude.toFixed(4)),
              wfo: 'GLOBAL',
              elevationFt: 120
            });
          }
        }
      }
    };

    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        this.zoom = clamp(this.zoom + delta, 0.78, 2.35);
      },
      { passive: false }
    );
  }

  renderFrame(ts) {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));

    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Update camera rotation / fly-to interpolation / inertia
    if (!this.isDragging) {
      if (this.targetLon !== null && this.targetLat !== null) {
        let dLon = ((this.targetLon - this.rotLon + 540) % 360) - 180;
        let dLat = this.targetLat - this.rotLat;
        this.rotLon = ((this.rotLon + dLon * 0.09 + 540) % 360) - 180;
        this.rotLat = clamp(this.rotLat + dLat * 0.09, -78, 78);
        if (Math.abs(dLon) < 0.25 && Math.abs(dLat) < 0.25) {
          this.targetLon = null;
          this.targetLat = null;
        }
      } else {
        this.rotLon = ((this.rotLon + this.velLon + (this.autoSpin ? 0.09 : 0) + 540) % 360) - 180;
        this.rotLat = clamp(this.rotLat + this.velLat, -78, 78);
        this.velLon *= 0.92;
        this.velLat *= 0.92;
      }
    }

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) * 0.82 * this.zoom;
    const tSec = ts * 0.001;

    const activeHour =
      this.forecast?.hours48?.[this.hourOffset] ||
      this.forecast?.current ||
      { cloudCover: 65, tempF: 57, rainChance: 45, precipIn: 0.02, windMph: 10, windDirDeg: 245, time: new Date().toISOString() };

    // 1. Outer Atmospheric Limb Halo Glow
    const haloGrad = ctx.createRadialGradient(cx, cy, radius * 0.88, cx, cy, radius * 1.18);
    haloGrad.addColorStop(0, 'rgba(68, 168, 255, 0.35)');
    haloGrad.addColorStop(0.5, 'rgba(56, 145, 255, 0.14)');
    haloGrad.addColorStop(1, 'rgba(10, 25, 55, 0)');
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.18, 0, Math.PI * 2);
    ctx.fill();

    // 2. Clip to 3D Ocean Sphere & Render Deep Bathymetric Ocean
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    const oceanGrad = ctx.createRadialGradient(
      cx - radius * 0.28,
      cy - radius * 0.28,
      radius * 0.08,
      cx,
      cy,
      radius
    );
    oceanGrad.addColorStop(0, '#18477d');
    oceanGrad.addColorStop(0.55, '#0c294e');
    oceanGrad.addColorStop(1, '#051329');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    // 3. Latitude / Longitude Graticule Grid
    ctx.strokeStyle = 'rgba(130, 190, 255, 0.11)';
    ctx.lineWidth = 0.8;
    for (let lon = -150; lon <= 180; lon += 30) {
      ctx.beginPath();
      let started = false;
      for (let lat = -80; lat <= 80; lat += 6) {
        const pt = this.project(lon, lat, cx, cy, radius);
        if (pt.visible) {
          if (!started) {
            ctx.moveTo(pt.x, pt.y);
            started = true;
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      let started = false;
      for (let lon = -180; lon <= 180; lon += 6) {
        const pt = this.project(lon, lat, cx, cy, radius);
        if (pt.visible) {
          if (!started) {
            ctx.moveTo(pt.x, pt.y);
            started = true;
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }

    // 4. Vector Continents & Topographic Biome Fill
    CONTINENT_POLYGONS.forEach((poly, idx) => {
      ctx.beginPath();
      let visibleCount = 0;
      poly.forEach(([lon, lat], pIdx) => {
        const pt = this.project(lon, lat, cx, cy, radius);
        if (pt.z > -0.15) visibleCount++;
        if (pIdx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      if (visibleCount > 2) {
        ctx.closePath();
        const isPolar = idx === 1 || idx === CONTINENT_POLYGONS.length - 1;
        ctx.fillStyle = isPolar
          ? 'rgba(195, 222, 248, 0.72)'
          : 'rgba(34, 82, 92, 0.82)';
        ctx.strokeStyle = 'rgba(115, 218, 200, 0.42)';
        ctx.lineWidth = 1.1;
        ctx.fill();
        ctx.stroke();
      }
    });

    // 5. Optional Layer: 3D Global Thermal Anomaly Field
    if (this.layers.thermal) {
      for (let lat = -65; lat <= 65; lat += 16) {
        for (let lon = -165; lon <= 165; lon += 22) {
          const pt = this.project(lon, lat, cx, cy, radius);
          if (!pt.visible) continue;
          const latWarmth = Math.cos(lat * DEG2RAD);
          const hue = clamp(235 - latWarmth * 215, 10, 235);
          const r = radius * 0.22 * pt.z;
          const g = ctx.createRadialGradient(pt.x, pt.y, 1, pt.x, pt.y, r);
          g.addColorStop(0, `hsla(${hue}, 90%, 55%, 0.26)`);
          g.addColorStop(1, `hsla(${hue}, 90%, 50%, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 6. Layer: Live Volumetric Moving Cloud Cover
    if (this.layers.clouds) {
      const locLat = this.forecast?.location?.latitude ?? 37.77;
      const locLon = this.forecast?.location?.longitude ?? -122.42;
      const localCloudFrac = clamp((activeHour.cloudCover ?? 60) / 100, 0.05, 1);
      const windSpeedFactor = clamp((activeHour.windMph ?? 10) / 15, 0.3, 2.4);
      const windRad = ((activeHour.windDirDeg ?? 250) + 180) * DEG2RAD;

      this.cloudPuffs.forEach((puff) => {
        let lon;
        let lat;
        let alpha;

        if (puff.isLocalCluster) {
          // Advect local cloud deck directly over the user's selected location at the actual wind angle & cloud %!
          const drift = ((tSec * 0.45 * windSpeedFactor + this.hourOffset * 0.9 + puff.phase) % 10) - 5;
          lon = locLon + puff.offsetLon + Math.sin(windRad) * drift;
          lat = clamp(locLat + puff.offsetLat + Math.cos(windRad) * drift, -84, 84);
          alpha = puff.baseOpacity * localCloudFrac * 1.15;
        } else {
          const timeShift = tSec * 1.4 + this.hourOffset * 1.85;
          lon = ((puff.baseLon + puff.driftLonPerSec * timeShift + 540) % 360) - 180;
          lat = clamp(puff.baseLat + Math.sin(tSec * 0.3 + puff.baseLon) * 1.2, -82, 82);
          alpha = puff.baseOpacity;

          // Modulate by nearest live Open-Meteo global anchor sample if within 28 degrees
          if (this.globalSampleNodes.length > 0) {
            for (let s = 0; s < this.globalSampleNodes.length; s++) {
              const node = this.globalSampleNodes[s];
              const d = Math.hypot(node.lat - lat, node.lon - lon);
              if (d < 28) {
                alpha *= lerp(clamp(node.cloudCover / 75, 0.15, 1.35), 1, d / 28);
                break;
              }
            }
          }
        }

        if (alpha < 0.04) return;
        const pt = this.project(lon, lat, cx, cy, radius);
        if (!pt.visible) return;

        const r = Math.max(4, (puff.size / 18) * radius * (0.45 + 0.55 * pt.z));
        const cGrad = ctx.createRadialGradient(pt.x, pt.y, r * 0.1, pt.x, pt.y, r);
        const edgeAlpha = clamp(alpha * pt.z, 0, 0.78);
        cGrad.addColorStop(0, `rgba(245, 250, 255, ${edgeAlpha.toFixed(3)})`);
        cGrad.addColorStop(0.55, `rgba(215, 232, 255, ${(edgeAlpha * 0.55).toFixed(3)})`);
        cGrad.addColorStop(1, 'rgba(185, 215, 255, 0)');

        ctx.fillStyle = cGrad;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // 7. Layer: Active Precipitation & Storm Radar Cores on Globe
    if (this.layers.precip) {
      const locLat = this.forecast?.location?.latitude ?? 37.77;
      const locLon = this.forecast?.location?.longitude ?? -122.42;
      const pop = activeHour.rainChance ?? 0;

      if (pop >= 25) {
        const coreCount = Math.ceil((pop / 100) * 14);
        for (let c = 0; c < coreCount; c++) {
          const angle = c * 1.7 + tSec * 0.4;
          const dist = 1.2 + (c % 5) * 1.8;
          const pLon = locLon + Math.cos(angle) * dist;
          const pLat = locLat + Math.sin(angle) * dist * 0.8;
          const pt = this.project(pLon, pLat, cx, cy, radius);
          if (pt.visible) {
            const r = radius * 0.065 * pt.z;
            const pGrad = ctx.createRadialGradient(pt.x, pt.y, 1, pt.x, pt.y, r);
            const color = pop >= 75 ? '255, 115, 90' : pop >= 50 ? '255, 212, 96' : '72, 228, 165';
            pGrad.addColorStop(0, `rgba(${color}, 0.68)`);
            pGrad.addColorStop(1, `rgba(${color}, 0)`);
            ctx.fillStyle = pGrad;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    // 8. Layer: Animated 3D Jet Stream & Wind Flow Particles
    if (this.layers.wind) {
      this.windParticles.forEach((wp) => {
        // Zonal wind profile: Easterly trades near equator, strong westerly jet streams at 30-60°
        const absLat = Math.abs(wp.lat);
        const zonalVel =
          absLat < 22
            ? -0.35 * wp.speedFactor
            : absLat < 62
            ? 0.65 * wp.speedFactor
            : -0.22 * wp.speedFactor;
        const meridionalVel = Math.sin(wp.lon * DEG2RAD * 3 + tSec * 0.7) * 0.14;

        wp.lon = ((wp.lon + zonalVel + 540) % 360) - 180;
        wp.lat = clamp(wp.lat + meridionalVel, -78, 78);

        const pt = this.project(wp.lon, wp.lat, cx, cy, radius);
        const tailLon = wp.lon - zonalVel * 7.5;
        const tailLat = wp.lat - meridionalVel * 7.5;
        const tailPt = this.project(tailLon, tailLat, cx, cy, radius);

        if (pt.visible && tailPt.visible) {
          ctx.strokeStyle =
            absLat >= 30 && absLat <= 55
              ? `rgba(115, 238, 255, ${(0.58 * pt.z).toFixed(2)})`
              : `rgba(140, 220, 195, ${(0.38 * pt.z).toFixed(2)})`;
          ctx.lineWidth = absLat >= 32 && absLat <= 52 ? 1.7 : 1.15;
          ctx.beginPath();
          ctx.moveTo(tailPt.x, tailPt.y);
          ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
        }
      });
    }

    // 9. Layer: Real-Time Astronomical Day/Night Terminator & Night City Lights
    if (this.layers.terminator) {
      const simDate = new Date(Date.now() + this.hourOffset * 3600000);
      const utcHrs = simDate.getUTCHours() + simDate.getUTCMinutes() / 60;
      const subsolarLon = ((12 - utcHrs) * 15 + 540) % 360 - 180;
      const dayOfYear = Math.floor(
        (simDate - new Date(Date.UTC(simDate.getUTCFullYear(), 0, 1))) / 86400000
      );
      const subsolarLat = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));

      // Project subsolar direction vector into camera view space
      const subPt = this.project(subsolarLon, subsolarLat, cx, cy, radius);
      const sunDx = (subPt.x - cx) / radius;
      const sunDy = (subPt.y - cy) / radius;

      const termGrad = ctx.createLinearGradient(
        cx + sunDx * radius,
        cy + sunDy * radius,
        cx - sunDx * radius * 1.1,
        cy - sunDy * radius * 1.1
      );
      termGrad.addColorStop(0, 'rgba(255, 245, 200, 0.04)');
      termGrad.addColorStop(0.48, 'rgba(10, 22, 48, 0.05)');
      termGrad.addColorStop(0.56, 'rgba(6, 14, 34, 0.48)');
      termGrad.addColorStop(1, 'rgba(2, 6, 18, 0.76)');
      ctx.fillStyle = termGrad;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      // Night-side glowing golden urban city lights
      NIGHT_CITY_CLUSTERS.forEach(([cLon, cLat, intensity]) => {
        const pt = this.project(cLon, cLat, cx, cy, radius);
        if (!pt.visible) return;
        const solar = getSolarGeometry(cLat, cLon, simDate);
        if (solar.elevationDeg < -2) {
          const glowR = 4.5 * intensity * pt.z;
          const cg = ctx.createRadialGradient(pt.x, pt.y, 0.5, pt.x, pt.y, glowR);
          cg.addColorStop(0, `rgba(255, 220, 130, ${(0.85 * pt.z).toFixed(2)})`);
          cg.addColorStop(1, 'rgba(255, 180, 70, 0)');
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, glowR, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // 10. Preset City Beacons + Selected Active Location Pulsing Radar Beacon
    PRESET_CITIES.forEach((city) => {
      const pt = this.project(city.longitude, city.latitude, cx, cy, radius);
      if (!pt.visible) return;
      ctx.fillStyle = 'rgba(165, 215, 255, 0.72)';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    if (this.forecast?.location) {
      const { latitude, longitude, name } = this.forecast.location;
      const pt = this.project(longitude, latitude, cx, cy, radius);
      if (pt.visible) {
        const pulse = (tSec * 1.4) % 1;
        const pulseR = 8 + pulse * 26;
        ctx.strokeStyle = `rgba(92, 224, 160, ${(1 - pulse) * 0.85})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pulseR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#5ce0a0';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Floating 3D HUD Callout Tag
        const label = `${name.split(',')[0]} · ${activeHour.tempF}° (${activeHour.cloudCover}% Cloud)`;
        ctx.font = '700 11.5px Inter, system-ui, sans-serif';
        const tw = ctx.measureText(label).width;
        const bx = clamp(pt.x - tw / 2 - 8, 12, w - tw - 28);
        const by = pt.y - 28;

        ctx.fillStyle = 'rgba(8, 18, 38, 0.88)';
        ctx.strokeStyle = 'rgba(92, 224, 160, 0.65)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(bx, by, tw + 16, 20, 999);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, bx + 8, by + 14);
      }
    }

    // 11. Specular Glass Limb Inner Rim Highlight
    const rimGrad = ctx.createRadialGradient(cx, cy, radius * 0.82, cx, cy, radius);
    rimGrad.addColorStop(0, 'rgba(100, 185, 255, 0)');
    rimGrad.addColorStop(0.85, 'rgba(100, 185, 255, 0.08)');
    rimGrad.addColorStop(1, 'rgba(135, 215, 255, 0.36)');
    ctx.fillStyle = rimGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // end sphere clip

    // Outer Crisp Specular Ring
    ctx.strokeStyle = 'rgba(145, 210, 255, 0.34)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}
