// Mounts the upgraded photorealistic 3D WebGL Earth Globe directly onto
// /weather-fusion/experimental-weather.html with auto user-location centering,
// live SSEC geostationary satellite clouds, directional wind streamlines,
// glitch-free click-anywhere spot forecasts, and 48h timeline scrubbing.

const US_CONUS_BOUNDS = { minLat: 24, maxLat: 50, minLon: -125, maxLon: -66 };
const QUICK_HUBS = [
  { id: 'knightdale', name: 'Knightdale, NC', latitude: 35.7877, longitude: -78.4806 },
  { id: 'sf', name: 'San Francisco, CA', latitude: 37.7749, longitude: -122.4194 },
  { id: 'nyc', name: 'New York, NY', latitude: 40.7128, longitude: -74.006 },
  { id: 'miami', name: 'Miami, FL', latitude: 25.7617, longitude: -80.1918 },
  { id: 'denver', name: 'Denver, CO', latitude: 39.7392, longitude: -104.9903 },
  { id: 'seattle', name: 'Seattle, WA', latitude: 47.6062, longitude: -122.3321 },
  { id: 'london', name: 'London, UK', latitude: 51.5072, longitude: -0.1276 },
  { id: 'tokyo', name: 'Tokyo, JP', latitude: 35.6762, longitude: 139.6503 },
];

const WMO_LABELS = {
  0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime Fog', 51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain', 71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
  80: 'Rain Showers', 81: 'Showers', 82: 'Heavy Showers', 95: 'Thunderstorm', 96: 'Storm + Hail', 99: 'Severe Storm',
};

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isConus = (lat, lon) =>
  finite(lat) &&
  finite(lon) &&
  lat >= US_CONUS_BOUNDS.minLat &&
  lat <= US_CONUS_BOUNDS.maxLat &&
  lon >= US_CONUS_BOUNDS.minLon &&
  lon <= US_CONUS_BOUNDS.maxLon;

function compassFromDeg(fromDeg) {
  if (!finite(fromDeg)) return { compass: '', arrow: '' };
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
  const idx = Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8;
  return { compass: dirs[idx], arrow: arrows[idx] };
}

function readSavedUserLocation() {
  try {
    for (const key of ['weather-fusion-device-place', 'weather-fusion-city', 'weather-nourie-city']) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const p = JSON.parse(raw);
      if (finite(p?.latitude) && finite(p?.longitude)) {
        return { name: p.name || 'Your location', latitude: p.latitude, longitude: p.longitude };
      }
    }
  } catch {}
  return null;
}

export function mountExperimentalGlobe() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('experimental-globe-section')) return;

  const todayPanel = document.querySelector('.today-panel');
  const mainTrend = document.getElementById('main-hourly-trend');
  const hero = document.querySelector('.hero');
  const anchor = todayPanel || mainTrend || hero;
  if (!anchor) return;

  const section = document.createElement('section');
  section.id = 'experimental-globe-section';
  section.className = 'glass exp-globe-card';
  section.setAttribute('aria-labelledby', 'exp-globe-title');
  section.innerHTML = `
    <div class="exp-globe-head">
      <div>
        <span class="exp-eyebrow">LIVE GEOSTATIONARY SATELLITE · 3D EARTH</span>
        <h2 id="exp-globe-title">Interactive Earth · Live Clouds &amp; Wind Direction</h2>
      </div>
      <div class="exp-globe-actions">
        <button type="button" id="exp-globe-locate" class="exp-pill-btn" title="Center on your live GPS location">📍 My Location</button>
        <button type="button" id="exp-globe-spin" class="exp-pill-btn" aria-pressed="false" title="Toggle West-to-East Earth rotation">⟳ Spin</button>
        <button type="button" id="exp-globe-center" class="exp-pill-btn" title="Center on active pin">⌖ Center</button>
        <button type="button" id="exp-globe-zoom-in" class="exp-pill-btn exp-icon-btn" aria-label="Zoom in">+</button>
        <button type="button" id="exp-globe-zoom-out" class="exp-pill-btn exp-icon-btn" aria-label="Zoom out">−</button>
      </div>
    </div>

    <div class="exp-globe-stage">
      <div class="exp-globe-hud exp-hud-top-left" id="exp-globe-telemetry">
        <span class="exp-hud-dot"></span>
        <span id="exp-globe-loc-pill">Locating your weather…</span>
      </div>
      <div class="exp-globe-hud exp-hud-bottom-strip" id="exp-globe-wind-pill">
        Drag to rotate · Tap anywhere on Earth to inspect live forecast
      </div>
      <canvas id="exp-cloud-globe-canvas" aria-label="Interactive 3D Earth showing live satellite cloud cover and directional wind streamlines"></canvas>
      <div class="exp-globe-fallback" id="exp-globe-fallback" hidden>3D globe loading…</div>
    </div>

    <div id="exp-spot-bar" class="exp-spot-bar" hidden></div>

    <div class="exp-globe-controls">
      <div class="exp-layer-bar" role="group" aria-label="3D Earth weather layers">
        <button type="button" class="exp-layer-btn is-active" data-layer="clouds" aria-pressed="true">☁ Live Clouds</button>
        <button type="button" class="exp-layer-btn is-active" data-layer="wind" aria-pressed="true">〰 Wind Flow</button>
        <button type="button" class="exp-layer-btn" data-layer="precip" aria-pressed="false">🌧 Precip</button>
        <button type="button" class="exp-layer-btn is-active" data-layer="terminator" aria-pressed="true">◐ Day / Night</button>
        <button type="button" class="exp-layer-btn" data-layer="thermal" aria-pressed="false">🌡 Temp Contours</button>
      </div>

      <div class="exp-time-bar">
        <button type="button" id="exp-globe-play" class="exp-pill-btn" aria-pressed="false">▶ Play 48h</button>
        <input id="exp-globe-hour" type="range" min="0" max="47" value="0" step="1" aria-label="3D Globe forecast hour offset">
        <span id="exp-globe-hour-label" class="exp-hour-badge">Now (Live Satellite)</span>
      </div>

      <div class="exp-hub-strip" aria-label="Quick global hubs on 3D globe">
        ${QUICK_HUBS.map((h) => `<button type="button" class="exp-hub-chip" data-hub-id="${h.id}">${h.name.split(',')[0]}</button>`).join('')}
      </div>
    </div>
  `;

  if (todayPanel) {
    todayPanel.insertAdjacentElement('afterend', section);
  } else if (mainTrend) {
    mainTrend.insertAdjacentElement('beforebegin', section);
  } else {
    hero.appendChild(section);
  }

  let globe = null;
  let latestForecast = globalThis.__weatherNourieForecast || null;
  let activeLocation = latestForecast?.location || readSavedUserLocation() || QUICK_HUBS[0];
  let playTimer = null;
  let inspectToken = 0;
  let inspectedSpot = null;
  const hourInput = document.getElementById('exp-globe-hour');
  const hourLabel = document.getElementById('exp-globe-hour-label');
  const locPill = document.getElementById('exp-globe-loc-pill');
  const windPill = document.getElementById('exp-globe-wind-pill');
  const spotBar = document.getElementById('exp-spot-bar');
  const spinBtn = document.getElementById('exp-globe-spin');
  const playBtn = document.getElementById('exp-globe-play');

  const renderSpotBar = (spot) => {
    if (!spotBar) return;
    if (!spot) {
      spotBar.hidden = true;
      return;
    }
    const canSwitchPage = isConus(spot.latitude, spot.longitude);
    spotBar.hidden = false;
    spotBar.innerHTML = `
      <div class="exp-spot-main">
        <strong>${esc(spot.name)}</strong>
        <span>${esc(spot.summary)}</span>
      </div>
      <div class="exp-spot-actions">
        ${canSwitchPage ? `<button type="button" id="exp-spot-apply" class="exp-pill-btn is-active">Use for Full Forecast →</button>` : ''}
        <button type="button" id="exp-spot-close" class="exp-pill-btn" aria-label="Close spot details">×</button>
      </div>
    `;
    document.getElementById('exp-spot-apply')?.addEventListener('click', () => {
      window.dispatchEvent(
        new CustomEvent('weather-nourie:select-location', {
          detail: {
            id: spot.id || `${spot.latitude.toFixed(2)},${spot.longitude.toFixed(2)}`,
            name: spot.name,
            latitude: spot.latitude,
            longitude: spot.longitude,
          },
        })
      );
      spotBar.hidden = true;
    });
    document.getElementById('exp-spot-close')?.addEventListener('click', () => {
      inspectedSpot = null;
      spotBar.hidden = true;
    });
  };

  const updateHudReadout = (hourIdx, override = null) => {
    const h = globe?.globalGrid?.hours?.[hourIdx];
    if (hourIdx === 0) {
      hourLabel.textContent = 'Now (Live Satellite)';
    } else if (h) {
      const d = new Date(h);
      hourLabel.textContent = `+${hourIdx}h · ${d.toLocaleTimeString([], { hour: 'numeric' })}`;
    } else {
      hourLabel.textContent = `+${hourIdx}h`;
    }

    if (override) {
      if (override.locText) locPill.textContent = override.locText;
      if (override.windText) windPill.textContent = override.windText;
      return;
    }

    const fx = latestForecast;
    const loc = inspectedSpot || fx?.location || activeLocation;
    const gridTel =
      globe?.globalGrid?.frames?.length && finite(loc?.latitude) && finite(loc?.longitude)
        ? globe.getLocalGridTelemetry(loc.latitude, loc.longitude, hourIdx)
        : null;

    if (fx?.location && !inspectedSpot) {
      const hr = fx.hours?.[hourIdx] || fx.current;
      const t = finite(hr?.temperature) ? `${Math.round(hr.temperature)}°F` : gridTel ? `${gridTel.tempF}°F` : '--°';
      const cloud = finite(hr?.skyCover) ? `${Math.round(hr.skyCover)}% clouds` : gridTel ? `${gridTel.cloudPct}% clouds` : 'Live clouds';
      const wDir = finite(hr?.windDirection)
        ? compassFromDeg(hr.windDirection)
        : gridTel
        ? { compass: gridTel.compass, arrow: gridTel.arrow }
        : { compass: '', arrow: '' };
      const wSpd = finite(hr?.windMph)
        ? `${Math.round(hr.windMph)} mph`
        : hr?.wind
        ? String(hr.wind)
        : gridTel
        ? `${gridTel.mph} mph`
        : '--';
      locPill.textContent = `${fx.location.name || 'Your location'} · ${t} · ${cloud}`;
      windPill.textContent = `Wind: ${wSpd} ${wDir.compass} ${wDir.arrow}`.trim();
    } else if (gridTel && loc) {
      locPill.textContent = `${loc.name || 'Selected'} · ${gridTel.tempF}°F · ${gridTel.cloudPct}% clouds`;
      windPill.textContent = `Wind: ${gridTel.mph} mph ${gridTel.compass} ${gridTel.arrow} · Precip ${gridTel.precipMm} mm/h`;
    }
  };

  // Glitch-free spot inspection: never reloads the whole page on random globe clicks.
  // Fetches accurate live Open-Meteo current + daily forecast right for the tapped spot.
  async function inspectSpotOnGlobe(loc, { alsoSwitchPage = false } = {}) {
    const token = ++inspectToken;
    activeLocation = loc;
    inspectedSpot = loc;
    locPill.textContent = `Checking ${loc.name}…`;

    if (globe) {
      globe.updateForecast({
        location: loc,
        current: { temperature: null, skyCover: null },
      });
    }

    if (alsoSwitchPage && isConus(loc.latitude, loc.longitude)) {
      inspectedSpot = null;
      window.dispatchEvent(new CustomEvent('weather-nourie:select-location', { detail: loc }));
      window.dispatchEvent(new CustomEvent('weather-nourie:accuracy-location', { detail: loc }));
      renderSpotBar(null);
      return;
    }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude.toFixed(4)}&longitude=${loc.longitude.toFixed(4)}&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,precipitation,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
      const res = await fetch(url);
      if (token !== inspectToken || !res.ok) return;
      const data = await res.json();
      if (token !== inspectToken) return;
      const cur = data?.current;
      const day = data?.daily;
      if (cur) {
        const wd = compassFromDeg(cur.wind_direction_10m);
        const cond = WMO_LABELS[cur.weather_code] || 'Live';
        const hi = finite(day?.temperature_2m_max?.[0]) ? `${Math.round(day.temperature_2m_max[0])}°` : '—';
        const lo = finite(day?.temperature_2m_min?.[0]) ? `${Math.round(day.temperature_2m_min[0])}°` : '—';
        const pop = finite(day?.precipitation_probability_max?.[0]) ? `${Math.round(day.precipitation_probability_max[0])}% rain` : '';
        const locText = `${loc.name} · ${Math.round(cur.temperature_2m)}°F · ${cond} · ${Math.round(cur.cloud_cover)}% clouds`;
        const windText = `Wind: ${Math.round(cur.wind_speed_10m)} mph ${wd.compass} ${wd.arrow} · RH ${Math.round(cur.relative_humidity_2m ?? 0)}%`;
        updateHudReadout(Number(hourInput.value), { locText, windText });

        if (globe) {
          globe.updateForecast({
            location: loc,
            current: {
              temperature: cur.temperature_2m,
              skyCover: cur.cloud_cover,
              windMph: cur.wind_speed_10m,
              windDirection: cur.wind_direction_10m,
            },
          });
        }
        renderSpotBar({
          ...loc,
          summary: `${Math.round(cur.temperature_2m)}°F ${cond} · High ${hi} / Low ${lo} · ${Math.round(cur.cloud_cover)}% clouds · Wind ${Math.round(cur.wind_speed_10m)} mph ${wd.compass} ${wd.arrow}${pop ? ` · ${pop}` : ''}`,
        });
      }
    } catch {
      if (token !== inspectToken) return;
      updateHudReadout(Number(hourInput.value), { locText: loc.name });
    }
  }

  function centerOnUserDeviceLocation({ quiet = false } = {}) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      if (!quiet && latestForecast?.location) {
        globe?.flyTo(latestForecast.location.latitude, latestForecast.location.longitude);
      }
      return;
    }
    if (!quiet) locPill.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        const loc = { id: 'device', name: 'Your location', latitude: lat, longitude: lon };
        globe?.setAutoSpin(false);
        if (spinBtn) {
          spinBtn.classList.remove('is-active');
          spinBtn.setAttribute('aria-pressed', 'false');
        }
        globe?.flyTo(lat, lon);
        inspectSpotOnGlobe(loc, { alsoSwitchPage: isConus(lat, lon) });
      },
      () => {
        if (!quiet && latestForecast?.location) {
          globe?.flyTo(latestForecast.location.latitude, latestForecast.location.longitude);
          updateHudReadout(Number(hourInput.value));
        }
      },
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 }
    );
  }

  import('/weather-fusion/v3/js/globe.js?v=real-sat-noglitch-v4')
    .then(({ LiveCloudGlobe }) => {
      globe = new LiveCloudGlobe({
        canvasId: 'exp-cloud-globe-canvas',
        onSelectLocation: (loc) => {
          if (spinBtn) {
            spinBtn.classList.remove('is-active');
            spinBtn.setAttribute('aria-pressed', 'false');
          }
          inspectSpotOnGlobe(loc, { alsoSwitchPage: false });
        },
        onLayerChange: (layers) => {
          section.querySelectorAll('[data-layer]').forEach((btn) => {
            const active = Boolean(layers[btn.dataset.layer]);
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
          });
        },
      });
      // Default autoSpin OFF so the globe stays steady on the user's location and is easy to inspect
      globe.setAutoSpin(false);
      globe.init(
        latestForecast || {
          location: activeLocation,
          current: { temperature: null, skyCover: null },
        }
      );
      if (latestForecast) {
        globe.flyTo(latestForecast.location.latitude, latestForecast.location.longitude, true);
        updateHudReadout(0);
      } else {
        if (navigator.permissions?.query) {
          navigator.permissions
            .query({ name: 'geolocation' })
            .then((st) => {
              if (st.state === 'granted') centerOnUserDeviceLocation({ quiet: true });
            })
            .catch(() => {});
        }
        updateHudReadout(0);
      }
      const waitGrid = setInterval(() => {
        if (globe?.globalGrid?.frames?.length) {
          clearInterval(waitGrid);
          updateHudReadout(Number(hourInput?.value || 0));
        }
      }, 400);
      setTimeout(() => clearInterval(waitGrid), 12000);
    })
    .catch(() => {
      const fb = document.getElementById('exp-globe-fallback');
      if (fb) {
        fb.hidden = false;
        fb.textContent = 'WebGL 3D Earth requires hardware acceleration in this browser.';
      }
    });

  document.getElementById('exp-globe-locate')?.addEventListener('click', () => {
    centerOnUserDeviceLocation({ quiet: false });
  });

  spinBtn?.addEventListener('click', () => {
    if (!globe) return;
    const on = globe.setAutoSpin(!globe.autoSpin);
    spinBtn.classList.toggle('is-active', on);
    spinBtn.setAttribute('aria-pressed', String(on));
  });

  document.getElementById('exp-globe-center')?.addEventListener('click', () => {
    const loc = latestForecast?.location || activeLocation;
    inspectedSpot = null;
    renderSpotBar(null);
    if (latestForecast) globe?.updateForecast(latestForecast);
    globe?.flyTo(loc.latitude, loc.longitude);
    updateHudReadout(Number(hourInput?.value || 0));
  });
  document.getElementById('exp-globe-zoom-in')?.addEventListener('click', () => globe?.zoomBy(1));
  document.getElementById('exp-globe-zoom-out')?.addEventListener('click', () => globe?.zoomBy(-1));

  section.querySelectorAll('[data-layer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!globe) return;
      const on = globe.toggleLayer(btn.dataset.layer);
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  });

  hourInput?.addEventListener('input', () => {
    const idx = Number(hourInput.value);
    globe?.setHourOffset(idx);
    updateHudReadout(idx);
  });

  playBtn?.addEventListener('click', () => {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
      playBtn.textContent = '▶ Play 48h';
      playBtn.classList.remove('is-active');
      playBtn.setAttribute('aria-pressed', 'false');
      return;
    }
    playBtn.textContent = '⏸ Pause';
    playBtn.classList.add('is-active');
    playBtn.setAttribute('aria-pressed', 'true');
    playTimer = setInterval(() => {
      const next = (Number(hourInput.value) + 1) % 48;
      hourInput.value = String(next);
      globe?.setHourOffset(next);
      updateHudReadout(next);
    }, 480);
  });

  section.querySelectorAll('[data-hub-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hub = QUICK_HUBS.find((h) => h.id === btn.dataset.hubId);
      if (!hub) return;
      section.querySelectorAll('.exp-hub-chip').forEach((c) => c.classList.toggle('is-active', c === btn));
      globe?.setAutoSpin(false);
      if (spinBtn) {
        spinBtn.classList.remove('is-active');
        spinBtn.setAttribute('aria-pressed', 'false');
      }
      globe?.flyTo(hub.latitude, hub.longitude);
      inspectSpotOnGlobe(hub, { alsoSwitchPage: isConus(hub.latitude, hub.longitude) });
    });
  });

  document.addEventListener('weather-nourie:forecast', (e) => {
    const fx = e.detail;
    if (!fx?.location) return;
    latestForecast = fx;
    activeLocation = fx.location;
    inspectedSpot = null;
    renderSpotBar(null);
    globe?.updateForecast(fx);
    globe?.flyTo(fx.location.latitude, fx.location.longitude);
    updateHudReadout(Number(hourInput?.value || 0));
  });
}
