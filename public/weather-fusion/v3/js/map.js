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

import {RadarTileBuffer, RADAR_STEP_MS, RADAR_LATEST_HOLD_MS} from '../../radar-playback.js?v=1';

export const MAP_LAYERS = [
  {
    id: 'radar',
    label: 'Live radar',
    caption: 'Live precipitation radar near your location',
    legend: [
      { label: 'Light Rain', color: '#38d39f' },
      { label: 'Moderate', color: '#f5d042' },
      { label: 'Heavy', color: '#ff6b4a' },
      { label: 'Intense', color: '#d845ff' }
    ]
  }
];

export class WeatherMapController {
  constructor({ mapContainerId = 'radar-map', onFrameChange }) {
    this.mapContainerId = mapContainerId;
    this.onFrameChange = onFrameChange;
    this.map = null;
    this.baseTileLayer = null;
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
        minZoom: 4,
        maxZoom: 13,
        zoomControl: true,
        attributionControl: false,
        fadeAnimation: true,
        zoomAnimation: true
      });

      this.map.createPane('weather-base');
      this.map.getPane('weather-base').style.zIndex = 200;
      this.map.createPane('weather-model');
      this.map.getPane('weather-model').style.zIndex = 360;
      this.map.getPane('weather-model').style.pointerEvents = 'none';
      this.map.createPane('weather-radar');
      this.map.getPane('weather-radar').style.zIndex = 430;
      this.map.getPane('weather-radar').style.pointerEvents = 'none';
      this.map.createPane('weather-warnings');
      this.map.getPane('weather-warnings').style.zIndex = 500;

      this.locationGroup = L.layerGroup().addTo(this.map);
      this.alertsGroup = L.layerGroup().addTo(this.map);

      this.setBasemap(this.activeBasemap);
      await this.fetchRadarFrames(latitude, longitude);
      this.setLayer('radar');

      // Keep Leaflet canvas sharp when tabs/sections resize or scroll
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => this.map?.invalidateSize({ pan: false }));
        ro.observe(container);
      }
      setTimeout(() => this.map?.invalidateSize({ pan: false }), 120);
    } else {
      if(this.lastPoint===`${latitude},${longitude}`&&Date.now()-(this.lastRadarFetch||0)<120000){this.renderAlertPolygons(forecast.alerts||[]);return;}
      this.map.setView([latitude, longitude], this.map.getZoom(), { animate: true });
      await this.fetchRadarFrames(latitude, longitude);
      this.setLayer('radar');
    }

    this.lastPoint=`${latitude},${longitude}`;this.lastRadarFetch=Date.now();
    this.renderLocationAndProximityRings(forecast);
    this.renderAlertPolygons(forecast.alerts || []);
  }

  async fetchRadarFrames(lat, lon) {
    // Primary: official NOAA MRMS observed reflectivity WMS via our verified /api/weather-fusion/radar endpoint
    try {
      const res = await fetch(`/api/weather-fusion/radar?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.frames) && data.frames.length) {
          this.radarSource = { type: 'wms', url: data.url, layer: data.layer };
          this.rainViewerFrames = data.frames.map((iso, idx, arr) => ({
            time: Date.parse(iso) || Date.now(),
            isoTime: iso,
            isLive: idx === arr.length - 1
          }));
          return;
        }
      }
    } catch {}

    // Fallback: RainViewer public radar API (clean crisp composite PNG tiles, no blocky mesonet noise)
    try {
      const rv = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      if (rv.ok) {
        const json = await rv.json();
        const past = json?.radar?.past || [];
        if (past.length) {
          this.radarSource = { type: 'xyz', host: json.host || 'https://tilecache.rainviewer.com' };
          this.rainViewerFrames = past.slice(-8).map((f, idx, arr) => ({
            time: f.time * 1000,
            tileUrl: `${this.radarSource.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
            isLive: idx === arr.length - 1
          }));
          return;
        }
      }
    } catch {}

    this.rainViewerFrames = [];
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
      updateWhenIdle: true,
      keepBuffer: 2,
      className
    }).addTo(this.map);
  }

  setLayer() {
    if (!this.map || typeof window.L === 'undefined') return;
    this.activeLayerId = 'radar';
    this.stopPlayback();

    this.radarTiles?.clear();
    this.radarTiles = new RadarTileBuffer(this.map, .78);

    const timeFormat = {timeZone:this.currentForecast?.timeZone||'America/New_York',hour:'numeric',minute:'2-digit'};
    this.frames = (this.rainViewerFrames || []).map((f) => ({
      label: f.isLive
        ? `${new Date(f.time).toLocaleTimeString('en-US', timeFormat)} (Live Radar)`
        : new Date(f.time).toLocaleTimeString('en-US', timeFormat),
      isoTime: f.isoTime,
      tileUrl: f.tileUrl,
      timestamp: f.time
    }));
    this.currentFrameIdx = Math.max(0, this.frames.length - 1);

    this.applyCurrentFrame();
  }

  radarLayer(frame) {
    const options = {pane:'weather-radar', updateWhenIdle:true, keepBuffer:1, className:'radar-crisp-layer'};
    if (frame.isoTime && this.radarSource?.type === 'wms') {
      return window.L.tileLayer.wms(this.radarSource.url, {
        ...options, layers:this.radarSource.layer, format:'image/png', transparent:true,
        version:'1.1.1', time:frame.isoTime
      });
    }
    return window.L.tileLayer(frame.tileUrl, {...options, maxNativeZoom:12});
  }

  reportFrame(index, label) {
    this.onFrameChange?.({frameIdx:index, totalFrames:this.frames.length, label, layer:MAP_LAYERS[0]});
  }

  async applyCurrentFrame(index = this.currentFrameIdx) {
    if (!this.radarTiles) return;
    const frame = this.frames[index];
    if (!frame) {
      this.reportFrame(index, 'Radar unavailable');
      return;
    }
    const buffer = this.radarTiles;
    const shown = await buffer.show(frame.timestamp, () => this.radarLayer(frame));
    if (this.radarTiles !== buffer) return;
    if (shown) {
      this.currentFrameIdx = index;
      this.reportFrame(index, frame.label);
    } else if (!this.isPlaying && !buffer.active) {
      this.reportFrame(index, 'Radar frame unavailable');
    }
    if (!this.isPlaying) buffer.trim();
  }

  warmFrames(index) {
    const next = [1, 2].map(offset => this.frames[(index + offset) % this.frames.length]);
    this.radarTiles.trim(next.map(frame => frame.timestamp));
    for (const frame of new Set(next)) this.radarTiles.prepare(frame.timestamp, () => this.radarLayer(frame));
  }

  setFrameIndex(index) {
    if (this.frames[index]) void this.applyCurrentFrame(index);
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
    const playback = this.playback = {};
    let index = this.currentFrameIdx;
    this.warmFrames(index);
    const advance = async () => {
      if (this.playback !== playback) return;
      index = (index + 1) % this.frames.length;
      await this.applyCurrentFrame(index);
      if (this.playback !== playback) return;
      this.warmFrames(index);
      this.playTimer = setTimeout(advance, index === this.frames.length - 1 ? RADAR_LATEST_HOLD_MS : RADAR_STEP_MS);
    };
    this.playTimer = setTimeout(advance, RADAR_STEP_MS);
  }

  stopPlayback() {
    this.isPlaying = false;
    this.playback = null;
    clearTimeout(this.playTimer);
    this.playTimer = null;
    this.radarTiles?.trim();
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

    const safeName = String(name || 'Selected Location').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const markerIcon = L.divIcon({
      className: 'nourie-map-pin',
      html: `
        <div class="map-pin-point-anchor">
          <span class="map-pin-dot"></span>
          <span class="map-pin-offset-pill">${safeName} · ${cur.tempF}°</span>
        </div>
      `,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
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
}
