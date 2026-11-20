// Mounts the upgraded photorealistic 3D WebGL Earth Globe directly onto
// /weather-fusion/experimental-weather.html with auto user-location centering,
// real cloud cover, directional wind streamlines, 48h timeline scrubbing, and click-anywhere inspection.

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

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
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
  const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘']; // blowing TOWARD
  const idx = Math.round(((fromDeg % 360) + 360) % 360 / 45) % 8;
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
        <span class="exp-eyebrow">LIVE SATELLITE &amp; GLOBAL MODEL FIELD · 3D WEBGL</span>
        <h2 id="exp-globe-title">Interactive Earth · Real Clouds &amp; Wind Direction</h2>
      </div>
      <div class="exp-globe-actions">
        <button type="button" id="exp-globe-locate" class="exp-pill-btn" title="Center on your live GPS location">📍 My Location</button>
        <button type="button" id="exp-globe-spin" class="exp-pill-btn is-active" aria-pressed="true" title="Toggle West-to-East Earth rotation">⟳ Spin</button>
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
        Real cloud cover &amp; wind vectors loading…
      </div>
      <canvas id="exp-cloud-globe-canvas" aria-label="Interactive 3D Earth showing real global cloud cover and directional wind streamlines"></canvas>
      <div class="exp-globe-fallback" id="exp-globe-fallback" hidden>3D globe loading…</div>
    </div>

    <div class="exp-globe-controls">
      <div class="exp-layer-bar" role="group" aria-label="3D Earth weather layers">
        <button type="button" class="exp-layer-btn is-active" data-layer="clouds" aria-pressed="true">☁ Clouds</button>
        <button type="button" class="exp-layer-btn is-active" data-layer="wind" aria-pressed="true">〰 Wind Flow</button>
        <button type="button" class="exp-layer-btn" data-layer="precip" aria-pressed="false">🌧 Precip</button>
        <button type="button" class="exp-layer-btn is-active" data-layer="terminator" aria-pressed="true">◐ Day / Night</button>
        <button type="button" class="exp-layer-btn" data-layer="thermal" aria-pressed="false">🌡 Temp Contours</button>
      </div>

      <div class="exp-time-bar">
        <button type="button" id="exp-globe-play" class="exp-pill-btn" aria-pressed="false">▶ Play 48h</button>
        <input id="exp-globe-hour" type="range" min="0" max="47" value="0" step="1" aria-label="3D Globe forecast hour offset">
        <span id="exp-globe-hour-label" class="exp-hour-badge">Now (+0h)</span>
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
  let userPickedRemote = false;
  const hourInput = document.getElementById('exp-globe-hour');
  const hourLabel = document.getElementById('exp-globe-hour-label');
  const locPill = document.getElementById('exp-globe-loc-pill');
  const windPill = document.getElementById('exp-globe-wind-pill');
  const spinBtn = document.getElementById('exp-globe-spin');
  const playBtn = document.getElementById('exp-globe-play');

  const updateHudReadout = (hourIdx, override = null) => {
    const h = globe?.globalGrid?.hours?.[hourIdx];
    if (hourIdx === 0) {
      hourLabel.textContent = 'Now (+0h)';
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
    const loc = fx?.location || activeLocation;
    const gridTel =
      globe?.globalGrid?.frames?.length && finite(loc?.latitude) && finite(loc?.longitude)
        ? globe.getLocalGridTelemetry(loc.latitude, loc.longitude, hourIdx)
        : null;

    if (fx?.location && !userPickedRemote) {
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

  async function inspectRemotePoint(loc, { fromUserClick = true } = {}) {
    activeLocation = loc;
    userPickedRemote = !isConus(loc.latitude, loc.longitude);
    locPill.textContent = `Loading ${loc.name}…`;
    window.dispatchEvent(new CustomEvent('weather-nourie:accuracy-location', { detail: loc }));

    if (isConus(loc.latitude, loc.longitude)) {
      if (fromUserClick) {
        window.dispatchEvent(new CustomEvent('weather-nourie:select-location', { detail: loc }));
      }
      if (globe) globe.flyTo(loc.latitude, loc.longitude);
      return;
    }

    // Outside US NWS grid: fetch crisp Open-Meteo current temp, clouds, wind speed & direction, precip!
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude.toFixed(3)}&longitude=${loc.longitude.toFixed(3)}&current=temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m,precipitation,relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const cur = data?.current;
      if (cur) {
        const wd = compassFromDeg(cur.wind_direction_10m);
        const locText = `${loc.name} · ${Math.round(cur.temperature_2m)}°F · ${Math.round(cur.cloud_cover)}% clouds`;
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
      }
    } catch {
      updateHudReadout(Number(hourInput.value), { locText: `${loc.name}` });
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
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const loc = {
          id: 'device',
          name: 'Your location',
          latitude: Number(lat.toFixed(4)),
          longitude: Number(lon.toFixed(4)),
        };
        globe?.setAutoSpin(false);
        if (spinBtn) {
          spinBtn.classList.remove('is-active');
          spinBtn.setAttribute('aria-pressed', 'false');
        }
        globe?.flyTo(lat, lon);
        inspectRemotePoint(loc, { fromUserClick: true });
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

  import('/weather-fusion/v3/js/globe.js?v=real-clouds-dir-v3')
    .then(({ LiveCloudGlobe }) => {
      globe = new LiveCloudGlobe({
        canvasId: 'exp-cloud-globe-canvas',
        onSelectLocation: (loc) => {
          if (spinBtn) {
            spinBtn.classList.toggle('is-active', Boolean(globe?.autoSpin));
            spinBtn.setAttribute('aria-pressed', String(Boolean(globe?.autoSpin)));
          }
          inspectRemotePoint(loc, { fromUserClick: true });
        },
        onLayerChange: (layers) => {
          section.querySelectorAll('[data-layer]').forEach((btn) => {
            const active = Boolean(layers[btn.dataset.layer]);
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
          });
        },
      });
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
        // Automatically check if geolocation permission is already granted so globe opens right on the user
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
      // Refresh wind/cloud HUD once global grid finishes loading
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
    const loc = globe?.forecast?.location || latestForecast?.location || activeLocation;
    globe?.flyTo(loc.latitude, loc.longitude);
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
    }, 420);
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
      inspectRemotePoint(hub, { fromUserClick: true });
    });
  });

  document.addEventListener('weather-nourie:forecast', (e) => {
    const fx = e.detail;
    if (!fx?.location) return;
    latestForecast = fx;
    activeLocation = fx.location;
    userPickedRemote = false;
    globe?.updateForecast(fx);
    globe?.flyTo(fx.location.latitude, fx.location.longitude);
    updateHudReadout(Number(hourInput?.value || 0));
  });
}
