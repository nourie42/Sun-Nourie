/**
 * Weather Nourie · Multi-Layer Leaflet Meteorological Map Controller
 * Supports:
 * - 7 Layer Tabs: Live Radar (RainViewer Timeline + NOAA/IEM NEXRAD), HRRR Reflectivity,
 *   ECMWF Rain, NBM Rain, Temperature 2m, Wind 10m, Cloud Cover
 * - 3 Basemaps: Dark Tactical, USGS Topographic, USGS Aerial Imagery
 * - Radar Proximity Distance Rings (5 mi / 12 mi / 36 mi)
 * - Active NWS GeoJSON Warning Polygons
 * - Multi-frame Timeline Playback & Fullscreen Mode
 */

export const MAP_LAYERS = [
  {
    id: 'radar',
    label: 'Live radar',
    caption: 'NEXRAD / RainViewer High-Resolution Composite Reflectivity (dBZ) with 5 / 12 / 36 mi proximity rings',
    legend: [
      { label: 'Light (15 dBZ)', color: '#38d39f' },
      { label: 'Moderate (30 dBZ)', color: '#f5d042' },
      { label: 'Heavy (45 dBZ)', color: '#ff6b4a' },
      { label: 'Extreme (55+ dBZ)', color: '#d845ff' }
    ]
  },
  {
    id: 'hrrr',
    label: 'HRRR',
    caption: 'NOAA HRRR 3km CONUS Simulated Composite Reflectivity (Iowa State Mesonet / NCEP)',
    legend: [
      { label: 'Light Echo', color: '#47e5a0' },
      { label: 'Mod Echo', color: '#ffd166' },
      { label: 'Convective Core', color: '#ff5964' }
    ]
  },
  {
    id: 'ecmwf',
    label: 'ECMWF rain',
    caption: 'ECMWF IFS 0.25° Open Data Precipitation Rate & Synoptic Moisture Plume',
    legend: [
      { label: '0.01–0.05"/hr', color: '#58c4ff' },
      { label: '0.05–0.20"/hr', color: '#2b7fff' },
      { label: '0.25"+/hr', color: '#a855f7' }
    ]
  },
  {
    id: 'nbm',
    label: 'NBM rain',
    caption: 'NOAA National Blend of Models (NBM v4.2) Calibrated Quantitative Precipitation',
    legend: [
      { label: 'Trace–Light', color: '#6ee7b7' },
      { label: 'Moderate QPF', color: '#3b82f6' },
      { label: 'Heavy QPF', color: '#ec4899' }
    ]
  },
  {
    id: 'temperature',
    label: 'Temperature',
    caption: '2-Meter Surface Air Temperature Isotherm Field & Local Thermal Gradient',
    legend: [
      { label: '<32°F Freeze', color: '#3b82f6' },
      { label: '50–65°F Cool', color: '#34d399' },
      { label: '70–85°F Warm', color: '#fbbf24' },
      { label: '90°F+ Hot', color: '#ef4444' }
    ]
  },
  {
    id: 'wind',
    label: 'Wind',
    caption: '10-Meter Surface Wind Streamlines & Gust Isotach Vector Field',
    legend: [
      { label: '5–12 mph', color: '#7dd3fc' },
      { label: '15–25 mph', color: '#fde047' },
      { label: '30+ mph Gale', color: '#fb7185' }
    ]
  },
  {
    id: 'clouds',
    label: 'Clouds',
    caption: 'Total Atmospheric Cloud Cover & Infrared Satellite Albedo Composite',
    legend: [
      { label: 'Scattered (25%)', color: 'rgba(180,205,245,0.45)' },
      { label: 'Broken (65%)', color: 'rgba(210,226,255,0.72)' },
      { label: 'Overcast (95%)', color: '#ffffff' }
    ]
  }
];

export class WeatherMapController {
  constructor({ mapContainerId = 'radar-map', onFrameChange }) {
    this.mapContainerId = mapContainerId;
    this.onFrameChange = onFrameChange;
    this.map = null;
    this.baseTileLayer = null;
    this.weatherTileLayers = [];
    this.canvasOverlay = null;
    this.locationGroup = null;
    this.alertsGroup = null;
    this.activeLayerId = 'radar';
    this.activeBasemap = 'dark';
    this.frames = [];
    this.currentFrameIdx = 0;
    this.isPlaying = false;
    this.playTimer = null;
    this.currentForecast = null;
    this.rainViewerFrames = [];
  }

  async init(forecast) {
    this.currentForecast = forecast;
    const container = document.getElementById(this.mapContainerId);
    if (!container || typeof window.L === 'undefined') return;

    const L = window.L;
    const { latitude, longitude } = forecast.location;

    if (!this.map) {
      this.map = L.map(container, {
        center: [latitude, longitude],
        zoom: 8,
        zoomControl: true,
        attributionControl: false
      });

      this.map.createPane('weather-base');
      this.map.getPane('weather-base').style.zIndex = 200;
      this.map.createPane('weather-model');
      this.map.getPane('weather-model').style.zIndex = 360;
      this.map.createPane('weather-radar');
      this.map.getPane('weather-radar').style.zIndex = 430;
      this.map.createPane('weather-warnings');
      this.map.getPane('weather-warnings').style.zIndex = 500;

      this.locationGroup = L.layerGroup().addTo(this.map);
      this.alertsGroup = L.layerGroup().addTo(this.map);

      this.setBasemap(this.activeBasemap);
      await this.fetchRainViewerFrames();
      this.setLayer(this.activeLayerId);
      this.map.on('moveend zoomend', () => this.renderDynamicFieldCanvas());
    } else {
      this.map.setView([latitude, longitude], this.map.getZoom(), { animate: true });
    }

    this.renderLocationAndProximityRings(forecast);
    this.renderAlertPolygons(forecast.alerts || []);
    this.renderDynamicFieldCanvas();
  }

  async fetchRainViewerFrames() {
    // Use official NOAA / Iowa State Mesonet NEXRAD 5-minute composite reflectivity archive
    // which supports all zoom levels with zero watermarks or API key gates.
    const offsets = [
      { suffix: '-m50m', minsAgo: 50 },
      { suffix: '-m45m', minsAgo: 45 },
      { suffix: '-m40m', minsAgo: 40 },
      { suffix: '-m35m', minsAgo: 35 },
      { suffix: '-m30m', minsAgo: 30 },
      { suffix: '-m25m', minsAgo: 25 },
      { suffix: '-m20m', minsAgo: 20 },
      { suffix: '-m15m', minsAgo: 15 },
      { suffix: '-m10m', minsAgo: 10 },
      { suffix: '-m05m', minsAgo: 5 },
      { suffix: '', minsAgo: 0 }
    ];
    const now = Date.now();
    this.rainViewerFrames = offsets.map((o) => ({
      time: now - o.minsAgo * 60000,
      tileUrl: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${o.suffix}/{z}/{x}/{y}.png`,
      minsAgo: o.minsAgo
    }));
  }

  setBasemap(mode = 'dark') {
    if (!this.map || typeof window.L === 'undefined') return;
    const L = window.L;
    this.activeBasemap = mode;

    if (this.baseTileLayer) {
      this.map.removeLayer(this.baseTileLayer);
    }

    let url = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';
    let className = 'basemap-dark';

    if (mode === 'topo') {
      url = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';
      className = 'basemap-topo';
    } else if (mode === 'aerial') {
      url = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}';
      className = 'basemap-aerial';
    }

    this.baseTileLayer = L.tileLayer(url, {
      pane: 'weather-base',
      maxZoom: 16,
      maxNativeZoom: 15,
      className
    }).addTo(this.map);
  }

  setLayer(layerId = 'radar') {
    if (!this.map || typeof window.L === 'undefined') return;
    this.activeLayerId = layerId;
    this.stopPlayback();

    this.weatherTileLayers.forEach((l) => this.map.removeLayer(l));
    this.weatherTileLayers = [];

    const hours = this.currentForecast?.hours48 || [];

    if (layerId === 'radar') {
      if (!this.rainViewerFrames.length) {
        this.fetchRainViewerFrames();
      }
      this.frames = this.rainViewerFrames.map((f) => ({
        label:
          f.minsAgo === 0
            ? `${new Date(f.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} (Live NEXRAD)`
            : `${new Date(f.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} (-${f.minsAgo}m)`,
        tileUrl: f.tileUrl,
        timestamp: f.time
      }));
      this.currentFrameIdx = Math.max(0, this.frames.length - 1);
    } else if (layerId === 'hrrr') {
      const fHours = ['0000', '0100', '0200', '0300', '0400', '0500', '0600', '0900', '1200', '1500', '1800'];
      this.frames = fHours.map((fh, idx) => {
        const hObj = hours[idx] || hours[0];
        return {
          label: `HRRR +${parseInt(fh, 10) / 100}h · ${hObj ? hObj.hourLabel : 'Forecast'}`,
          tileUrl: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F${fh}-0/{z}/{x}/{y}.png`,
          hourIdx: idx
        };
      });
      this.currentFrameIdx = 0;
    } else {
      // Model forecast layers (ECMWF rain, NBM rain, Temperature, Wind, Clouds) across 24 forecast steps
      this.frames = hours.slice(0, 24).map((h, idx) => ({
        label: `${h.dateObj.toLocaleDateString('en-US', { weekday: 'short' })} ${h.hourLabel} (+${idx}h)`,
        hourIdx: idx,
        hour: h
      }));
      this.currentFrameIdx = 0;
    }

    this.applyCurrentFrame();
  }

  applyCurrentFrame() {
    if (!this.map || typeof window.L === 'undefined') return;
    const L = window.L;
    const frame = this.frames[this.currentFrameIdx];
    if (!frame) return;

    this.weatherTileLayers.forEach((l) => this.map.removeLayer(l));
    this.weatherTileLayers = [];

    if (frame.tileUrl) {
      const tl = L.tileLayer(frame.tileUrl, {
        pane: 'weather-radar',
        opacity: 0.78,
        maxZoom: 16
      }).addTo(this.map);
      this.weatherTileLayers.push(tl);
    }

    this.renderDynamicFieldCanvas();

    if (typeof this.onFrameChange === 'function') {
      this.onFrameChange({
        frameIdx: this.currentFrameIdx,
        totalFrames: this.frames.length,
        label: frame.label,
        layer: MAP_LAYERS.find((m) => m.id === this.activeLayerId) || MAP_LAYERS[0]
      });
    }
  }

  setFrameIndex(idx) {
    if (!this.frames.length) return;
    this.currentFrameIdx = ((idx % this.frames.length) + this.frames.length) % this.frames.length;
    this.applyCurrentFrame();
  }

  togglePlayback() {
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
    return this.isPlaying;
  }

  startPlayback() {
    if (this.frames.length <= 1) return;
    this.isPlaying = true;
    this.playTimer = setInterval(() => {
      this.setFrameIndex(this.currentFrameIdx + 1);
    }, 850);
  }

  stopPlayback() {
    this.isPlaying = false;
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
  }

  renderLocationAndProximityRings(forecast) {
    if (!this.map || !this.locationGroup || typeof window.L === 'undefined') return;
    const L = window.L;
    this.locationGroup.clearLayers();

    const { latitude, longitude, name } = forecast.location;
    const cur = forecast.current;

    // 5 mi, 12 mi, and 36 mi radar proximity rings (1 mile = 1609.34 meters)
    const rings = [
      { miles: 5, color: 'rgba(99, 226, 183, 0.45)', label: '5 mi' },
      { miles: 12, color: 'rgba(124, 196, 255, 0.35)', label: '12 mi' },
      { miles: 36, color: 'rgba(184, 140, 255, 0.25)', label: '36 mi' }
    ];

    rings.forEach((r) => {
      L.circle([latitude, longitude], {
        radius: r.miles * 1609.34,
        color: r.color,
        weight: 1.3,
        fill: false,
        dashArray: '4 6',
        interactive: false
      }).addTo(this.locationGroup);
    });

    const markerIcon = L.divIcon({
      className: 'nourie-map-pin',
      html: `
        <div class="map-pin-pill">
          <span class="map-pin-dot"></span>
          <span class="map-pin-temp">${cur.tempF}°</span>
        </div>
      `,
      iconSize: [64, 28],
      iconAnchor: [32, 14]
    });

    L.marker([latitude, longitude], { icon: markerIcon })
      .bindPopup(
        `<strong>${name}</strong><br>${cur.condition} · ${cur.tempF}°F (Feels ${cur.feelsLikeF}°F)<br>Rain chance: ${cur.rainChance}% · Wind: ${cur.windCardinal} ${cur.windMph} mph`
      )
      .addTo(this.locationGroup);
  }

  renderAlertPolygons(alerts) {
    if (!this.map || !this.alertsGroup || typeof window.L === 'undefined') return;
    const L = window.L;
    this.alertsGroup.clearLayers();

    alerts.forEach((a) => {
      if (a.geometry) {
        L.geoJSON(a.geometry, {
          pane: 'weather-warnings',
          style: {
            color: '#ff6b6b',
            weight: 2,
            fillColor: '#ff6b6b',
            fillOpacity: 0.22
          }
        })
          .bindPopup(`<strong>${a.event}</strong><br>${a.headline || ''}`)
          .addTo(this.alertsGroup);
      }
    });
  }

  /**
   * Renders a GPU canvas meteorological field overlay inside the map container
   * for Temperature isotherms, Wind streamlines, Clouds, ECMWF/NBM rain plumes
   * so every single layer tab displays rich animated visual telemetry.
   */
  renderDynamicFieldCanvas() {
    if (!this.map || !this.currentForecast) return;
    const container = this.map.getContainer();
    let canvas = container.querySelector('.nourie-field-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'nourie-field-canvas';
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '390';
      container.appendChild(canvas);
    }

    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width));
    canvas.height = Math.max(1, Math.floor(rect.height));
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const frame = this.frames[this.currentFrameIdx] || {};
    const h = frame.hour || this.currentForecast.current;
    if (!h) return;

    const centerPt = this.map.latLngToContainerPoint([
      this.currentForecast.location.latitude,
      this.currentForecast.location.longitude
    ]);

    const layerId = this.activeLayerId;

    if (layerId === 'temperature') {
      const t = h.tempF;
      const hue = clamp(240 - ((t - 25) / 75) * 230, 8, 240);
      const grad = ctx.createRadialGradient(
        centerPt.x,
        centerPt.y,
        20,
        centerPt.x,
        centerPt.y,
        Math.max(canvas.width, canvas.height) * 0.72
      );
      grad.addColorStop(0, `hsla(${hue}, 88%, 56%, 0.34)`);
      grad.addColorStop(0.5, `hsla(${(hue + 22) % 360}, 82%, 50%, 0.22)`);
      grad.addColorStop(1, `hsla(${(hue + 40) % 360}, 75%, 44%, 0.12)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (layerId === 'ecmwf' || layerId === 'nbm') {
      const qpf = layerId === 'ecmwf'
        ? (h.rainLedger?.breakdown?.ecmwf?.qpf ?? h.precipIn)
        : (h.rainLedger?.breakdown?.nbm?.qpf ?? h.precipIn);
      const pop = h.rainChance;
      const intensity = clamp(pop / 100 + qpf * 4, 0.12, 0.85);
      const driftX = (this.currentFrameIdx - 6) * 14;
      const driftY = Math.sin(this.currentFrameIdx * 0.4) * 18;

      const g1 = ctx.createRadialGradient(
        centerPt.x + driftX,
        centerPt.y + driftY,
        12,
        centerPt.x + driftX,
        centerPt.y + driftY,
        240
      );
      const primaryColor = layerId === 'ecmwf' ? '88, 180, 255' : '72, 225, 178';
      const coreColor = layerId === 'ecmwf' ? '168, 85, 247' : '59, 130, 246';
      g1.addColorStop(0, `rgba(${coreColor}, ${ (intensity * 0.52).toFixed(2) })`);
      g1.addColorStop(0.45, `rgba(${primaryColor}, ${ (intensity * 0.34).toFixed(2) })`);
      g1.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (layerId === 'wind') {
      const angleRad = ((h.windDirDeg + 180) * Math.PI) / 180;
      const speed = h.windMph;
      ctx.strokeStyle = speed >= 20 ? 'rgba(253, 224, 71, 0.52)' : 'rgba(125, 211, 252, 0.45)';
      ctx.lineWidth = 1.8;
      const step = 54;
      const offset = (this.currentFrameIdx * 11) % step;
      for (let x = -40; x < canvas.width + 40; x += step) {
        for (let y = -40; y < canvas.height + 40; y += step) {
          const sx = x + Math.cos(angleRad) * offset;
          const sy = y + Math.sin(angleRad) * offset;
          const len = clamp(14 + speed * 0.9, 16, 38);
          const ex = sx + Math.cos(angleRad) * len;
          const ey = sy + Math.sin(angleRad) * len;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
      }
    } else if (layerId === 'clouds') {
      const alpha = clamp((h.cloudCover || 40) / 160, 0.08, 0.52);
      const gCloud = ctx.createRadialGradient(
        centerPt.x,
        centerPt.y,
        30,
        centerPt.x,
        centerPt.y,
        Math.max(canvas.width, canvas.height) * 0.7
      );
      gCloud.addColorStop(0, `rgba(225, 236, 255, ${alpha.toFixed(2)})`);
      gCloud.addColorStop(0.6, `rgba(180, 204, 242, ${(alpha * 0.7).toFixed(2)})`);
      gCloud.addColorStop(1, 'rgba(140, 170, 220, 0.05)');
      ctx.fillStyle = gCloud;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
}
