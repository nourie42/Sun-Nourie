/**
 * Weather Nourie · Experimental Fusion V3 Main Application Controller
 */

import { clamp } from './physics.js';
import {
  PRESET_CITIES,
  buildUnifiedFusionPayload,
  fetchCompleteFusionForecast,
  searchLocations
} from './fusion-engine.js';
import {
  renderExposureArtworkSvg,
  renderWeatherIconSvg
} from './icons.js';
import {
  COMPARE_MODELS,
  COMPARE_VARIABLES,
  HOURLY_METRICS,
  extractHourMetricValue,
  renderDewPointFeelChart,
  renderHourlyExplorerChart,
  renderModelCompareChart
} from './charts.js';
import {
  MAP_LAYERS,
  WeatherMapController
} from './map.js';
import { LiveCloudGlobe } from './globe.js';

const state = {
  location: PRESET_CITIES[0],
  forecast: null,
  useCelsius: false,
  skyOverride: 'auto',
  activeViewMode: 'experimental',
  selectedHourIdx: 0,
  selectedMetricId: 'temp',
  selectedDayIdx: 0,
  explanationPeriod: 'all',
  compareVariableId: 'highTemp',
  enabledCompareModels: new Set(['blend', 'nws', 'hrrr', 'nbm', 'ecmwf', 'gefs', 'weathernext']),
  dewPointRangeHours: 48,
  selectedDewPointIdx: 0,
  mapController: null,
  globeController: null,
  skyAudioActive: false,
  audioCtx: null,
  audioGainNode: null,
  skyMood: 'day'
};

export function fmtTemp(tempF, includeUnit = false) {
  if (tempF === null || tempF === undefined || Number.isNaN(tempF)) return '—';
  const v = state.useCelsius ? Math.round(((tempF - 32) * 5) / 9) : Math.round(tempF);
  return `${v}°${includeUnit ? (state.useCelsius ? 'C' : 'F') : ''}`;
}

document.addEventListener('DOMContentLoaded', () => {
  initBrandIcon();
  initSkyCanvas();
  initHeaderControls();
  initPresetCityChips();
  initModalSystem();
  initGlobeSection();
  initMapSection();

  // 1. Instant zero-latency initial render with synthetic seed
  state.forecast = buildUnifiedFusionPayload(state.location, null, null, null, {
    wfo: state.location.wfo || 'MTR',
    alerts: [],
    afdText: null,
    nwsHourlyMap: new Map(),
    available: false
  });
  renderAll();

  // 2. Live multi-model hydration from Open-Meteo + NOAA/NWS + CAMS Air Quality
  loadLocationForecast(state.location);
});

function initBrandIcon() {
  const slot = document.getElementById('brand-icon-slot');
  if (slot) {
    slot.innerHTML = renderWeatherIconSvg('partly-day', 30);
  }
}

async function loadLocationForecast(loc) {
  state.location = loc;
  const statusEl = document.getElementById('status-text');
  if (statusEl) {
    statusEl.textContent = `Fusing live models for ${loc.name} (NWS · HRRR · NBM · ECMWF IFS · GEFS · WeatherNext)…`;
  }
  updatePresetChipSelection();

  const liveForecast = await fetchCompleteFusionForecast(loc);
  state.forecast = liveForecast;
  state.selectedHourIdx = 0;
  state.selectedDayIdx = 0;
  state.selectedDewPointIdx = 0;
  renderAll();
  if (state.globeController) {
    state.globeController.updateForecast(liveForecast);
  }
}

function renderAll() {
  const f = state.forecast;
  if (!f) return;

  updateSkyAtmosphere(f);
  renderStatusAndAlerts(f);
  renderWindowBanners(f);
  renderHeroAndBriefing(f);
  renderSevenDayForecast(f);
  renderHourlyExplorerSection(f);
  renderOutdoorExposureCards(f);
  renderModelExplanationSection(f);
  renderCompareModelsSection(f);
  renderBestTimesHeatmap(f);
  renderDewPointFeelMeter(f);
  renderAqiAndGlanceTiles(f);
  renderScientificFeedsAndAfd(f);
  updateGlobeHUD(f, state.selectedHourIdx);

  if (state.globeController) {
    state.globeController.init(f);
  }
  if (state.mapController) {
    state.mapController.init(f);
  }
}

function updateSkyAtmosphere(f) {
  const autoMood = f.current?.skyMood || (f.current?.isDay ? 'day' : 'night');
  const mood = state.skyOverride === 'auto' ? autoMood : state.skyOverride;
  state.skyMood = mood;
  document.body.setAttribute('data-sky', mood);
}

function renderStatusAndAlerts(f) {
  const statusEl = document.getElementById('status-text');
  const coordsEl = document.getElementById('coords-text');
  const timeStr = new Date(f.fetchedAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });

  if (statusEl) {
    statusEl.textContent = `Updated ${timeStr} · Current forecast hour ${f.current.hourLabel} · ${
      f.isLiveApi ? 'Live Multi-Model Telemetry Active' : 'Offline Precision Fusion Engine Active'
    }`;
  }
  if (coordsEl) {
    const latStr = `${Math.abs(f.location.latitude).toFixed(4)}°${f.location.latitude >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(f.location.longitude).toFixed(4)}°${f.location.longitude >= 0 ? 'E' : 'W'}`;
    coordsEl.textContent = `${latStr}, ${lonStr} · Elev ${f.location.elevationFt || 85} ft · WFO ${f.location.wfo}`;
  }

  const alertsWrap = document.getElementById('urgent-alerts-container');
  if (!alertsWrap) return;
  if (!f.alerts || f.alerts.length === 0) {
    alertsWrap.innerHTML = '';
    return;
  }

  alertsWrap.innerHTML = f.alerts
    .slice(0, 2)
    .map(
      (a, idx) => `
      <div class="urgent-alert-banner" role="alert">
        <div>
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:#ffd0d0;">
            ⚠ Official NWS ${a.severity} Alert · ${a.senderName}
          </div>
          <div style="font-size:15.5px;font-weight:800;margin-top:2px;">${a.event}</div>
          <div style="font-size:12.5px;color:var(--muted);">${a.headline || a.areaDesc}</div>
        </div>
        <button class="icon-btn alert-view-btn" data-alert-idx="${idx}" type="button">View Bulletin ▸</button>
      </div>
    `
    )
    .join('');

  alertsWrap.querySelectorAll('.alert-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const a = f.alerts[Number(btn.dataset.alertIdx)] || f.alerts[0];
      if (!a) return;
      openModal(
        a.event,
        `<div style="font-size:13px;color:var(--gold);margin-bottom:8px;font-weight:700;">${a.headline || ''}</div>
         <pre class="afd-pre">${a.description || 'No additional text.'}\n\n${a.instruction || ''}</pre>`
      );
    });
  });
}

function renderWindowBanners(f) {
  const container = document.getElementById('forecast-window-banners');
  if (!container) return;

  container.innerHTML = (f.windows?.banners || [])
    .map(
      (b, idx) => `
      <div class="glass window-banner-card" data-type="${b.type}" data-win-idx="${idx}">
        <div style="display:flex;align-items:center;gap:12px;">
          <div>${renderWeatherIconSvg(b.type === 'rain' ? 'rain' : 'clear-day', 34)}</div>
          <div>
            <div style="font-size:14.5px;font-weight:800;color:#ffffff;">${b.title}</div>
            <div style="font-size:12.5px;color:var(--muted);">${b.subtitle}</div>
          </div>
        </div>
        <span class="wfo-pill" style="white-space:nowrap;">${b.badge} ▸</span>
      </div>
    `
    )
    .join('');

  container.querySelectorAll('.window-banner-card').forEach((card) => {
    card.addEventListener('click', () => {
      const b = f.windows.banners[Number(card.dataset.winIdx)];
      if (!b) return;
      openHourlyListModal(b.title, b.subtitle, b.hours.length ? b.hours : f.hours48.slice(0, 12));
    });
  });
}

function renderHeroAndBriefing(f) {
  const cur = f.current;
  const today = f.days[0];

  const dateEl = document.getElementById('hero-date');
  const wfoEl = document.getElementById('hero-wfo');
  const cityEl = document.getElementById('city-name');
  const sceneEl = document.getElementById('hero-scene');
  const tempEl = document.getElementById('temperature');
  const condEl = document.getElementById('hero-condition');
  const hiloEl = document.getElementById('hero-hilo');
  const uvEl = document.getElementById('hero-uv');
  const chipsEl = document.getElementById('hero-telemetry-chips');
  const radarPillEl = document.getElementById('radar-proximity-pill');

  if (dateEl) {
    dateEl.textContent = cur.dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });
  }
  if (wfoEl) wfoEl.textContent = `NWS WFO ${f.location.wfo} · Blend V2 (${cur.tempFusion.baseWeights.label})`;
  if (cityEl) cityEl.textContent = f.location.name;
  if (sceneEl) sceneEl.innerHTML = renderWeatherIconSvg(cur.icon, 86);
  if (tempEl) tempEl.textContent = fmtTemp(cur.tempF);
  if (condEl) condEl.textContent = cur.condition;
  if (hiloEl) {
    hiloEl.textContent = `High ${fmtTemp(today.highF)} · Low ${fmtTemp(today.lowF)} · Confidence ${today.confidence.level} (±${today.confidence.spreadF}°F)`;
  }
  if (uvEl) {
    const uvTier = today.maxUvIndex >= 8 ? 'Very High' : today.maxUvIndex >= 6 ? 'High' : today.maxUvIndex >= 3 ? 'Moderate' : 'Low';
    uvEl.textContent = `Peak UV today ${today.maxUvIndex} · ${uvTier}`;
  }

  if (chipsEl) {
    chipsEl.innerHTML = `
      <span class="telemetry-chip">🌡 Feels Like <strong>${fmtTemp(cur.feelsLikeF)}</strong> (Shade ${fmtTemp(cur.shadeFeelsF)} · Sun ${fmtTemp(cur.sunFeelsF)})</span>
      <span class="telemetry-chip">💧 Rain Score <strong>${cur.rainChance}/100 pts</strong> (${cur.precipIn}"/hr)</span>
      <span class="telemetry-chip">💨 Wind <strong>${cur.windCardinal} ${cur.windMph} mph</strong> (Gusts ${cur.windGustMph})</span>
      <span class="telemetry-chip">🐾 Sidewalk <strong>${fmtTemp(f.pavement.asphaltTempF, true)}</strong> Asphalt</span>
    `;
  }

  const celestialEl = document.getElementById('hero-celestial-strip');
  if (celestialEl) {
    const hrNow = cur.dateObj.getHours() + cur.dateObj.getMinutes() / 60;
    const sunPct = clamp(((hrNow - 6.75) / 10.5) * 100, 0, 100);
    celestialEl.innerHTML = `
      <span style="font-size:12px;color:var(--gold);font-weight:700;">🌅 ${today.sunrise}</span>
      <div class="sun-arc-bar" title="Solar Daylight Arc">
        <div class="sun-arc-fill" style="width:${sunPct.toFixed(0)}%;"></div>
        <span class="sun-arc-dot" style="left:${sunPct.toFixed(0)}%;"></span>
      </div>
      <span style="font-size:12px;color:var(--blue);font-weight:700;">🌇 ${today.sunset}</span>
      <span style="font-size:11.5px;color:var(--muted);">Solar Flux: <strong>${cur.shortwaveWm2} W/m²</strong> · Cloud Deck: <strong>${cur.cloudCover}%</strong></span>
    `;
  }

  if (radarPillEl) {
    if (cur.rainChance >= 55 || cur.precipIn >= 0.01) {
      radarPillEl.style.color = '#7ac6ff';
      radarPillEl.textContent = `● Precip echoes active within 12 mi (${cur.rainChance}% score)`;
    } else {
      radarPillEl.style.color = '#5ce0a0';
      radarPillEl.textContent = '● Radar clear within 36 mi proximity rings';
    }
  }

  // Remainder of Today stats grid
  const remGrid = document.getElementById('remainder-stats-grid');
  if (remGrid) {
    remGrid.innerHTML = `
      <div class="rem-stat">
        <span class="rem-stat-label">Low – High</span>
        <span class="rem-stat-val">${fmtTemp(today.lowF)} – ${fmtTemp(today.highF)}</span>
      </div>
      <div class="rem-stat">
        <span class="rem-stat-label">Peak Feels-Like</span>
        <span class="rem-stat-val">${fmtTemp(today.peakFeelsF)}</span>
      </div>
      <div class="rem-stat">
        <span class="rem-stat-label">Rain Now / Peak</span>
        <span class="rem-stat-val">${cur.rainChance}% / ${today.rainChance}%</span>
      </div>
      <div class="rem-stat">
        <span class="rem-stat-label">Expected Rain (QPF)</span>
        <span class="rem-stat-val">${today.totalQpfIn} in</span>
      </div>
      <div class="rem-stat">
        <span class="rem-stat-label">Peak Wind / Gust</span>
        <span class="rem-stat-val">${today.maxWindMph} / ${today.maxGustMph} mph</span>
      </div>
      <div class="rem-stat">
        <span class="rem-stat-label">Local AQI / Peak UV</span>
        <span class="rem-stat-val">${f.airQuality.currentAqi} AQI · UV ${today.maxUvIndex}</span>
      </div>
    `;
  }

  // Nourie Weather Take
  const takeHead = document.getElementById('take-headline');
  const takeSum = document.getElementById('take-summary');
  const takeBullets = document.getElementById('take-bullets');
  const riskPill = document.getElementById('risk-outlook-pill');

  if (takeHead) takeHead.textContent = f.briefing.headline;
  if (takeSum) takeSum.textContent = f.briefing.summary;
  if (riskPill && f.briefing.riskOutlook) {
    riskPill.textContent = `${f.briefing.riskOutlook.agency}: ${f.briefing.riskOutlook.level}`;
    riskPill.style.color = f.briefing.riskOutlook.color;
    riskPill.style.borderColor = f.briefing.riskOutlook.color;
  }
  if (takeBullets) {
    takeBullets.innerHTML = f.briefing.bullets
      .map((b) => `<li><strong>${b.label}:</strong> ${b.text}</li>`)
      .join('');
  }
}

function renderSevenDayForecast(f) {
  const container = document.getElementById('experimental-week');
  if (!container) return;

  const days7 = f.days.slice(0, 7);
  const weekMin = Math.min(...days7.map((d) => d.lowF));
  const weekMax = Math.max(...days7.map((d) => d.highF));
  const weekSpan = Math.max(4, weekMax - weekMin);

  container.innerHTML = days7
    .map((d, idx) => {
      const isActive = idx === state.selectedDayIdx;
      const leftPct = clamp(((d.lowF - weekMin) / weekSpan) * 100, 0, 88);
      const widthPct = clamp(((d.highF - d.lowF) / weekSpan) * 100, 12, 100 - leftPct);
      return `
        <article class="day-card ${isActive ? 'active' : ''}" data-day-idx="${idx}" role="button" tabindex="0">
          <div class="day-card-title">${d.shortWeekday}</div>
          <div class="day-card-date">${d.dateLabel}</div>
          <div>${renderWeatherIconSvg(d.icon, 46)}</div>
          <div class="day-card-temps">
            <span class="day-hi">${fmtTemp(d.highF)}</span>
            <span class="day-lo">${fmtTemp(d.lowF)}</span>
          </div>
          <div class="day-temp-range-track" title="Daily temperature range vs 7-day span">
            <div class="day-temp-range-fill" style="left:${leftPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%;"></div>
          </div>
          <div class="day-metrics-list">
            <span style="color:${d.rainChance >= 45 ? '#7ac6ff' : 'var(--muted)'};font-weight:700;">💧 ${d.rainChance}% · ${d.totalQpfIn} in</span>
            <span>💨 ${d.maxWindMph} mph</span>
            ${d.snowPossible ? `<span class="snow-badge">❄ Snow possible</span>` : ''}
          </div>
          <div class="confidence-box">
            <div class="confidence-label-row">
              <span style="color:var(--faint);">Confidence</span>
              <strong style="color:${d.confidence.color};">${d.confidence.level}</strong>
            </div>
            <div class="confidence-bar-track">
              <span class="confidence-pip" style="left:${d.confidence.score}%;"></span>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  container.querySelectorAll('.day-card').forEach((card) => {
    card.addEventListener('click', () => {
      state.selectedDayIdx = Number(card.dataset.dayIdx) || 0;
      renderSevenDayForecast(f);
      renderModelExplanationSection(f);
      renderCompareModelsSection(f);
    });
  });
}

function renderHourlyExplorerSection(f) {
  const tabsWrap = document.getElementById('hourly-metric-tabs');
  const readoutWrap = document.getElementById('hourly-readout');
  const descEl = document.getElementById('hourly-metric-desc');
  const chartStage = document.getElementById('hourly-chart-stage');
  const stripWrap = document.getElementById('hourly-strip');

  const activeMetric = HOURLY_METRICS.find((m) => m.id === state.selectedMetricId) || HOURLY_METRICS[0];
  if (descEl) descEl.textContent = activeMetric.desc;

  if (tabsWrap) {
    tabsWrap.innerHTML = HOURLY_METRICS.map(
      (m) => `
      <button class="metric-tab-btn ${m.id === state.selectedMetricId ? 'active' : ''}" data-metric-id="${m.id}" type="button">
        ${m.label}
      </button>
    `
    ).join('');

    tabsWrap.querySelectorAll('.metric-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedMetricId = btn.dataset.metricId;
        renderHourlyExplorerSection(f);
      });
    });
  }

  function updateSelectedHourUI(idx) {
    state.selectedHourIdx = clamp(idx, 0, f.hours48.length - 1);
    const h = f.hours48[state.selectedHourIdx];
    const val = extractHourMetricValue(h, state.selectedMetricId, state.useCelsius);
    const fmtV = activeMetric.decimals ? Number(val).toFixed(activeMetric.decimals) : Math.round(val);
    const rl = h.rainLedger.breakdown;

    if (readoutWrap) {
      readoutWrap.innerHTML = `
        <div class="hourly-readout-primary">
          <span class="readout-big-val" style="color:${activeMetric.color};">${fmtV}${activeMetric.unit}</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#ffffff;">
              ${h.dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${h.hourLabel} (${h.condition})
            </div>
            <div class="readout-meta">
              Blend: ${fmtTemp(h.tempF)} (P10–P90: ${fmtTemp(h.ensemble.p10)}–${fmtTemp(h.ensemble.p90)}) · Shade ${fmtTemp(h.shadeFeelsF)} / Sun ${fmtTemp(h.sunFeelsF)} · Dew point ${fmtTemp(h.dewPointF)}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <span class="wfo-pill">Rain 100-Pt: <strong>${h.rainChance}%</strong> (NWS ${rl.nws.pts} + HRRR ${rl.hrrr.pts} + NBM ${rl.nbm.pts} + ECMWF ${rl.ecmwf.pts} + WN ${rl.weathernext.pts})</span>
        </div>
      `;
    }

    if (stripWrap) {
      stripWrap.querySelectorAll('.hour-tile').forEach((tile, tIdx) => {
        tile.classList.toggle('active', tIdx === state.selectedHourIdx);
      });
    }
    updateGlobeHUD(f, state.selectedHourIdx);
  }

  // Render 48-hour strip cards
  if (stripWrap) {
    stripWrap.innerHTML = f.hours48
      .map(
        (h, idx) => `
        <div class="hour-tile ${idx === state.selectedHourIdx ? 'active' : ''}" data-hour-idx="${idx}">
          <span class="hour-tile-time">${h.hourLabel}</span>
          <div>${renderWeatherIconSvg(h.icon, 30)}</div>
          <span class="hour-tile-temp">${fmtTemp(h.tempF)}</span>
          <span class="hour-tile-feels">Feels ${fmtTemp(h.feelsLikeF)}</span>
          <span class="hour-pop-pill">💧 ${h.rainChance}%</span>
          <span style="font-size:10.5px;color:var(--faint);">${h.windMph} mph</span>
        </div>
      `
      )
      .join('');

    stripWrap.querySelectorAll('.hour-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        const idx = Number(tile.dataset.hourIdx) || 0;
        updateSelectedHourUI(idx);
        renderHourlyExplorerChart({
          containerEl: chartStage,
          hours48: f.hours48,
          metricId: state.selectedMetricId,
          selectedHourIdx: state.selectedHourIdx,
          useCelsius: state.useCelsius,
          onSelectHour: (newIdx) => {
            updateSelectedHourUI(newIdx);
            renderHourlyExplorerChart({
              containerEl: chartStage,
              hours48: f.hours48,
              metricId: state.selectedMetricId,
              selectedHourIdx: state.selectedHourIdx,
              useCelsius: state.useCelsius,
              onSelectHour: null
            });
          }
        });
      });
    });
  }

  updateSelectedHourUI(state.selectedHourIdx);
  renderHourlyExplorerChart({
    containerEl: chartStage,
    hours48: f.hours48,
    metricId: state.selectedMetricId,
    selectedHourIdx: state.selectedHourIdx,
    useCelsius: state.useCelsius,
    onSelectHour: (newIdx) => {
      if (newIdx === state.selectedHourIdx) return;
      updateSelectedHourUI(newIdx);
      // Fast cursor move without rebuilding full DOM
      const svg = chartStage.querySelector('svg');
      if (svg) {
        const x = 32 + (newIdx / Math.max(1, f.hours48.length - 1)) * (920 - 32 - 54);
        const line = svg.querySelector('#hourly-cursor-line');
        const dot = svg.querySelector('#hourly-cursor-dot');
        if (line) {
          line.setAttribute('x1', x.toFixed(1));
          line.setAttribute('x2', x.toFixed(1));
        }
        if (dot) {
          dot.setAttribute('cx', x.toFixed(1));
        }
      }
    }
  });
}

function renderOutdoorExposureCards(f) {
  const container = document.getElementById('exposure-cards-grid');
  if (!container) return;

  const cur = f.current;
  const pave = f.pavement;
  const isRaining = cur.rainChance >= 50 || cur.precipIn >= 0.01;
  const sunWindow = f.windows?.sunHours?.[0];

  const concretePct = clamp(((pave.concreteTempF - 30) / 120) * 100, 8, 100);
  const asphaltPct = clamp(((pave.asphaltTempF - 30) / 120) * 100, 8, 100);

  container.innerHTML = `
    <!-- Card 1: In the Shade -->
    <article class="glass exposure-card">
      <div class="exposure-art-banner">
        ${renderExposureArtworkSvg('shade', { isDay: cur.isDay })}
        <div class="exposure-art-overlay">
          <span class="exposure-tag">In the Shade · UTCI / Steadman</span>
        </div>
      </div>
      <div class="exposure-body">
        <div style="display:flex;align-items:baseline;justify-content:space-between;">
          <span class="exposure-big-temp">${fmtTemp(cur.shadeFeelsF)}</span>
          <span class="wfo-pill">Air ${fmtTemp(cur.tempF)}</span>
        </div>
        <div style="font-size:14px;font-weight:700;color:#ffffff;">
          ${cur.shadeFeelsF < cur.tempF ? `Breeze cools shade by ${cur.tempF - cur.shadeFeelsF}°F` : 'Calm air keeps shade near ambient'}
        </div>
        <p style="font-size:12.5px;color:var(--muted);margin:0;">
          Computed via Weather Nourie's hybrid UTCI → Steadman → NWS Wind Chill curve (${cur.windMph} mph wind, ${cur.humidity}% RH, wet-bulb ${fmtTemp(cur.wetBulbF)}).
        </p>
      </div>
    </article>

    <!-- Card 2: In Direct Sun / Active Precip -->
    <article class="glass exposure-card">
      <div class="exposure-art-banner">
        ${renderExposureArtworkSvg('sun', { isRaining, isDay: cur.isDay })}
        <div class="exposure-art-overlay">
          <span class="exposure-tag">${isRaining ? 'Wet Exposure · Rain Chill' : 'In Direct Sun · Solar ERF'}</span>
        </div>
      </div>
      <div class="exposure-body">
        <div style="display:flex;align-items:baseline;justify-content:space-between;">
          <span class="exposure-big-temp" style="color:${isRaining ? '#7ac6ff' : '#ffd470'};">
            ${fmtTemp(isRaining ? cur.rainFeelsF : cur.sunFeelsF)}
          </span>
          <span class="wfo-pill">${isRaining ? `${cur.rainChance}% Rain Score` : `+${cur.sunDeltaF}°F Solar Delta`}</span>
        </div>
        <div style="font-size:14px;font-weight:700;color:#ffffff;">
          ${
            isRaining
              ? 'Evaporative moisture & breeze lower outdoor apparent temp'
              : `Shortwave flux: ${cur.shortwaveWm2} W/m² · UV Index ${cur.uvIndex}`
          }
        </div>
        <p style="font-size:12.5px;color:var(--muted);margin:0;">
          ${
            sunWindow
              ? `Next bright sun window: <strong>${sunWindow.hourLabel}</strong> (${fmtTemp(sunWindow.tempF)}, ${100 - sunWindow.cloudCover}% clear).`
              : 'Cloud deck limits direct solar radiative gain across upcoming daylight hours.'
          }
        </p>
      </div>
    </article>

    <!-- Card 3: For Pets & 2-Layer Sidewalk Heat -->
    <article class="glass exposure-card">
      <div class="exposure-art-banner">
        ${renderExposureArtworkSvg('pets', { pawLevel: pave.pawSafety.level })}
        <div class="exposure-art-overlay">
          <span class="exposure-tag" style="border-color:${pave.pawSafety.color};color:${pave.pawSafety.color};">
            🐾 For Pets · ${pave.pawSafety.label}
          </span>
        </div>
      </div>
      <div class="exposure-body">
        <div class="pavement-compare-bars">
          <div class="pave-row">
            <div class="pave-row-head">
              <span>Light Concrete Sidewalk</span>
              <strong>${fmtTemp(pave.concreteTempF, true)} (Peak ${fmtTemp(pave.peakConcreteTodayF)})</strong>
            </div>
            <div class="pave-progress-bg">
              <div class="pave-progress-fill" style="width:${concretePct}%;background:#7ac6ff;"></div>
            </div>
          </div>
          <div class="pave-row">
            <div class="pave-row-head">
              <span>Dark Asphalt Street</span>
              <strong style="color:${pave.asphaltTempF >= 135 ? '#ff6b6b' : pave.asphaltTempF >= 120 ? '#ffd166' : '#5ce0a0'};">
                ${fmtTemp(pave.asphaltTempF, true)} (Peak ${fmtTemp(pave.peakAsphaltTodayF)})
              </strong>
            </div>
            <div class="pave-progress-bg">
              <div class="pave-progress-fill" style="width:${asphaltPct}%;background:${pave.pawSafety.color};"></div>
            </div>
          </div>
        </div>
        <p style="font-size:12px;color:var(--muted);margin:4px 0 0;">
          ${pave.pawSafety.advice} (AAHA paw-burn threshold: <strong>135°F</strong>).
        </p>
      </div>
    </article>
  `;
}

function renderModelExplanationSection(f) {
  const pillsWrap = document.getElementById('explanation-day-pills');
  const rainCard = document.getElementById('rain-ledger-card');
  const tempCard = document.getElementById('temp-weights-card');
  const matrixWrap = document.getElementById('all-hours-matrix');

  const day = f.days[clamp(state.selectedDayIdx, 0, f.days.length - 1)] || f.days[0];

  if (pillsWrap) {
    pillsWrap.innerHTML = f.days
      .map(
        (d, idx) => `
        <button class="mode-pill ${idx === state.selectedDayIdx ? 'active' : ''}" data-exp-day="${idx}" type="button">
          ${d.shortWeekday} · ${d.dateLabel}
        </button>
      `
      )
      .join('');

    pillsWrap.querySelectorAll('[data-exp-day]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedDayIdx = Number(btn.dataset.expDay) || 0;
        renderSevenDayForecast(f);
        renderModelExplanationSection(f);
        renderCompareModelsSection(f);
      });
    });
  }

  // Filter hours by selected period (all, daytime 6a-6p, overnight 6p-6a)
  let periodHours = day.hours;
  if (state.explanationPeriod === 'daytime') {
    const filtered = day.hours.filter((h) => h.dateObj.getHours() >= 6 && h.dateObj.getHours() < 18);
    if (filtered.length) periodHours = filtered;
  } else if (state.explanationPeriod === 'overnight') {
    const filtered = day.hours.filter((h) => h.dateObj.getHours() < 6 || h.dateObj.getHours() >= 18);
    if (filtered.length) periodHours = filtered;
  }

  const wettest = periodHours.reduce((best, h) => (h.rainChance > best.rainChance ? h : best), periodHours[0]);
  const warmest = periodHours.reduce((best, h) => (h.tempF > best.tempF ? h : best), periodHours[0]);
  const rl = wettest.rainLedger;
  const bd = rl.breakdown;

  if (rainCard) {
    rainCard.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
        <div>
          <span class="section-kicker">100-Point Rain Scoring Ledger</span>
          <h3 style="margin:3px 0;font-size:17px;">Peak Hour: ${wettest.hourLabel} (${rl.totalPts}/100 pts)</h3>
        </div>
        <span class="wfo-pill">${rl.blendedQpfIn}"/hr Blended QPF</span>
      </div>

      <div class="ledger-stacked-bar">
        <div style="width:${bd.nws.pts}%;background:#6bc5ff;" title="NWS: ${bd.nws.pts} pts"></div>
        <div style="width:${bd.hrrr.pts}%;background:#ff9f5a;" title="HRRR: ${bd.hrrr.pts} pts"></div>
        <div style="width:${bd.nbm.pts}%;background:#5ce0a0;" title="NBM: ${bd.nbm.pts} pts"></div>
        <div style="width:${bd.ecmwf.pts}%;background:#b88cff;" title="ECMWF: ${bd.ecmwf.pts} pts"></div>
        <div style="width:${bd.gefs.pts}%;background:#ffd166;" title="GEFS: ${bd.gefs.pts} pts"></div>
        <div style="width:${bd.weathernext.pts}%;background:#ff7eb6;" title="WeatherNext: ${bd.weathernext.pts} pts"></div>
      </div>

      <table class="math-table">
        <thead>
          <tr>
            <th>Source Feed</th>
            <th>Input Value</th>
            <th>Rule / Threshold</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong style="color:#6bc5ff;">NWS Official PoP</strong></td>
            <td>${bd.nws.pop}% PoP</td>
            <td>Proportional 40-pt share</td>
            <td><strong>${bd.nws.pts} / ${bd.nws.maxPts}</strong></td>
          </tr>
          <tr>
            <td><strong style="color:#ff9f5a;">NOAA HRRR 3km</strong></td>
            <td>${bd.hrrr.maxPts > 0 ? bd.hrrr.qpf.toFixed(3) + '"/hr' : 'Out of range (>48h)'}</td>
            <td>${bd.hrrr.tier}</td>
            <td><strong>${bd.hrrr.pts} / ${bd.hrrr.maxPts}</strong></td>
          </tr>
          <tr>
            <td><strong style="color:#5ce0a0;">National Blend (NBM)</strong></td>
            <td>${bd.nbm.qpf.toFixed(3)}"/hr</td>
            <td>${bd.nbm.tier}</td>
            <td><strong>${bd.nbm.pts} / ${bd.nbm.maxPts}</strong></td>
          </tr>
          <tr>
            <td><strong style="color:#b88cff;">ECMWF IFS 0.25°</strong></td>
            <td>${bd.ecmwf.qpf.toFixed(3)}"/hr</td>
            <td>${bd.ecmwf.tier}</td>
            <td><strong>${bd.ecmwf.pts} / ${bd.ecmwf.maxPts}</strong></td>
          </tr>
          <tr>
            <td><strong style="color:#ffd166;">GEFS Ensemble</strong></td>
            <td>${bd.gefs.maxPts > 0 ? bd.gefs.qpf.toFixed(3) + '"/hr' : 'Carved Day 3+'}</td>
            <td>${bd.gefs.tier}</td>
            <td><strong>${bd.gefs.pts} / ${bd.gefs.maxPts}</strong></td>
          </tr>
          <tr>
            <td><strong style="color:#ff7eb6;">WeatherNext AI</strong></td>
            <td>${bd.weathernext.qpf.toFixed(3)}"/hr</td>
            <td>${bd.weathernext.tier}</td>
            <td><strong>+${bd.weathernext.pts} / ${bd.weathernext.maxPts}</strong></td>
          </tr>
        </tbody>
      </table>
    `;
  }

  const tf = warmest.tempFusion;
  const mt = warmest.modelTemps;
  const ew = tf.effectiveWeights;
  const bw = tf.baseWeights;

  if (tempCard) {
    const modelRows = [
      { key: 'nws', name: 'NWS Gridpoint', color: '#6bc5ff' },
      { key: 'hrrr', name: 'NOAA HRRR 3km', color: '#ff9f5a' },
      { key: 'nbm', name: 'National Blend (NBM)', color: '#5ce0a0' },
      { key: 'ecmwf', name: 'ECMWF IFS 0.25°', color: '#b88cff' },
      { key: 'gefs', name: 'GEFS Ensemble Mean', color: '#ffd166' },
      { key: 'weathernext', name: 'WeatherNext AI', color: '#ff7eb6' }
    ];

    tempCard.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
        <div>
          <span class="section-kicker">Blend V2 Temperature Calculation</span>
          <h3 style="margin:3px 0;font-size:17px;">Peak Hour: ${warmest.hourLabel} → ${fmtTemp(warmest.tempF, true)}</h3>
        </div>
        <span class="wfo-pill">${bw.label}</span>
      </div>

      <div style="margin:10px 0;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,0.06);font-size:12px;color:var(--muted);">
        ${
          tf.outlierDampened
            ? `⚠ <strong>Outlier Dampening Triggered:</strong> ${tf.outlierReason}`
            : `✓ <strong>Outlier Check Passed:</strong> Model spread is ±${tf.spreadF}°F (${fmtTemp(tf.minF)} to ${fmtTemp(tf.maxF)}); standard horizon weights applied.`
        }
      </div>

      <table class="math-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Raw Temp</th>
            <th>Base Wt</th>
            <th>Effective Wt</th>
            <th>Contribution</th>
          </tr>
        </thead>
        <tbody>
          ${modelRows
            .map((m) => {
              const val = mt[m.key];
              const baseW = Math.round((bw[m.key] || 0) * 100);
              const effW = ew[m.key] ? Math.round(ew[m.key] * 100) : 0;
              const contrib = val !== null && ew[m.key] ? (val * ew[m.key]).toFixed(1) + '°' : '—';
              return `
                <tr>
                  <td><strong style="color:${m.color};">${m.name}</strong></td>
                  <td>${val !== null ? fmtTemp(val) : 'Unavailable'}</td>
                  <td>${baseW}%</td>
                  <td><strong>${effW}%</strong></td>
                  <td>${contrib}</td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `;
  }

  if (matrixWrap) {
    matrixWrap.innerHTML = `
      <table class="math-table">
        <thead>
          <tr>
            <th>Hour</th>
            <th>Nourie Blend</th>
            <th>NWS</th>
            <th>HRRR</th>
            <th>NBM</th>
            <th>ECMWF</th>
            <th>GEFS</th>
            <th>WeatherNext</th>
            <th>Rain Score</th>
            <th>Blended QPF</th>
          </tr>
        </thead>
        <tbody>
          ${periodHours
            .map(
              (h) => `
            <tr>
              <td><strong>${h.hourLabel}</strong></td>
              <td><strong>${fmtTemp(h.tempF)}</strong></td>
              <td>${fmtTemp(h.modelTemps.nws)}</td>
              <td>${h.modelTemps.hrrr !== null ? fmtTemp(h.modelTemps.hrrr) : '—'}</td>
              <td>${fmtTemp(h.modelTemps.nbm)}</td>
              <td>${fmtTemp(h.modelTemps.ecmwf)}</td>
              <td>${fmtTemp(h.modelTemps.gefs)}</td>
              <td>${fmtTemp(h.modelTemps.weathernext)}</td>
              <td>${h.rainChance} pts</td>
              <td>${h.precipIn.toFixed(3)}"</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;
  }
}

function renderCompareModelsSection(f) {
  const varTabs = document.getElementById('compare-var-tabs');
  const modelToggles = document.getElementById('compare-model-toggles');
  const chartStage = document.getElementById('compare-chart-stage');
  const breakdownEl = document.getElementById('compare-day-breakdown');

  if (varTabs) {
    varTabs.innerHTML = COMPARE_VARIABLES.map(
      (v) => `
      <button class="metric-tab-btn ${v.id === state.compareVariableId ? 'active' : ''}" data-comp-var="${v.id}" type="button">
        ${v.label}
      </button>
    `
    ).join('');

    varTabs.querySelectorAll('[data-comp-var]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.compareVariableId = btn.dataset.compVar;
        renderCompareModelsSection(f);
      });
    });
  }

  if (modelToggles) {
    modelToggles.innerHTML = COMPARE_MODELS.map((m) => {
      const isOn = state.enabledCompareModels.has(m.id) || m.alwaysOn;
      return `
        <button class="mode-pill ${isOn ? 'active' : ''}" data-comp-model="${m.id}" type="button" style="border-color:${isOn ? m.color : 'rgba(255,255,255,0.16)'};">
          <span style="display:inline-block;width:10px;height:3px;border-radius:2px;background:${m.color};"></span>
          <span>${m.label}</span>
        </button>
      `;
    }).join('');

    modelToggles.querySelectorAll('[data-comp-model]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.compModel;
        if (id === 'blend') return;
        if (state.enabledCompareModels.has(id)) {
          state.enabledCompareModels.delete(id);
        } else {
          state.enabledCompareModels.add(id);
        }
        renderCompareModelsSection(f);
      });
    });
  }

  renderModelCompareChart({
    containerEl: chartStage,
    days: f.days,
    variableId: state.compareVariableId,
    enabledModels: state.enabledCompareModels,
    selectedDayIdx: state.selectedDayIdx,
    useCelsius: state.useCelsius,
    onSelectDay: (dIdx) => {
      state.selectedDayIdx = dIdx;
      renderSevenDayForecast(f);
      renderModelExplanationSection(f);
      renderCompareModelsSection(f);
    }
  });

  if (breakdownEl) {
    const d = f.days[clamp(state.selectedDayIdx, 0, f.days.length - 1)] || f.days[0];
    breakdownEl.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12.5px;">
        <span class="wfo-pill">Selected Day: <strong>${d.dayName} (${d.dateLabel})</strong></span>
        <span class="telemetry-chip">Nourie Blend: <strong>${fmtTemp(d.highF)} / ${fmtTemp(d.lowF)}</strong></span>
        <span class="telemetry-chip" style="border-color:#6bc5ff;">NWS: <strong>${fmtTemp(d.modelHighs.nws)}</strong></span>
        <span class="telemetry-chip" style="border-color:#ff9f5a;">HRRR: <strong>${d.modelHighs.hrrr !== null ? fmtTemp(d.modelHighs.hrrr) : '48h only'}</strong></span>
        <span class="telemetry-chip" style="border-color:#5ce0a0;">NBM: <strong>${fmtTemp(d.modelHighs.nbm)}</strong></span>
        <span class="telemetry-chip" style="border-color:#b88cff;">ECMWF: <strong>${fmtTemp(d.modelHighs.ecmwf)}</strong></span>
        <span class="telemetry-chip" style="border-color:#ffd166;">GEFS: <strong>${fmtTemp(d.modelHighs.gefs)}</strong></span>
        <span class="telemetry-chip" style="border-color:#ff7eb6;">WeatherNext AI: <strong>${fmtTemp(d.modelHighs.weathernext)}</strong></span>
      </div>
    `;
  }
}

function renderBestTimesHeatmap(f) {
  const gridEl = document.getElementById('best-times-grid');
  const badgeEl = document.getElementById('perfect-hours-badge');
  const readoutEl = document.getElementById('heatmap-hover-readout');
  if (!gridEl) return;

  const days7 = f.days.slice(0, 7);
  let perfectCount = 0;

  const headerRow = `
    <div class="heatmap-row" style="margin-bottom:2px;">
      <div class="heatmap-day-label" style="font-size:11px;color:var(--faint);">Hour</div>
      ${Array.from({ length: 24 }, (_, h) => {
        const lbl = h === 0 ? '12a' : h === 6 ? '6a' : h === 12 ? '12p' : h === 18 ? '6p' : '';
        return `<div style="font-size:10px;color:var(--faint);text-align:center;">${lbl}</div>`;
      }).join('')}
    </div>
  `;

  const dayRows = days7
    .map((d) => {
      const hourMap = new Map();
      d.hours.forEach((h) => hourMap.set(h.dateObj.getHours(), h));

      const cells = Array.from({ length: 24 }, (_, hr) => {
        const h = hourMap.get(hr) || d.hours[0];
        const cat = h.comfortCategory;
        if (cat.id === 'perfect') perfectCount++;
        const rainClass = cat.rainLikely ? 'rain-dot' : '';
        return `
          <div
            class="heatmap-cell ${rainClass}"
            style="background:${cat.color};"
            data-hm-day="${d.shortWeekday}"
            data-hm-date="${d.dateLabel}"
            data-hm-time="${h.hourLabel}"
            data-hm-label="${cat.label}"
            data-hm-temp="${fmtTemp(h.tempF)}"
            data-hm-feels="${fmtTemp(h.feelsLikeF)}"
            data-hm-dp="${fmtTemp(h.dewPointF)}"
            data-hm-pop="${h.rainChance}"
            data-hm-wind="${h.windMph}"
          ></div>
        `;
      }).join('');

      return `
        <div class="heatmap-row">
          <div class="heatmap-day-label">${d.shortWeekday} <span style="font-size:10.5px;color:var(--faint);font-weight:500;">${d.dateLabel.split(' ')[1]}</span></div>
          ${cells}
        </div>
      `;
    })
    .join('');

  gridEl.innerHTML = headerRow + dayRows;

  if (badgeEl) {
    badgeEl.textContent =
      perfectCount > 0
        ? `★ ${perfectCount} Near-Perfect Outdoor Hours in 7 Days`
        : 'Cool / Active Pattern · See comfortable green & blue windows below';
    badgeEl.style.color = perfectCount > 0 ? '#ffd66b' : 'var(--muted)';
  }

  gridEl.querySelectorAll('.heatmap-cell').forEach((cell) => {
    const showCell = () => {
      if (!readoutEl) return;
      readoutEl.innerHTML = `
        <strong>${cell.dataset.hmDay} (${cell.dataset.hmDate}) · ${cell.dataset.hmTime}:</strong>
        ${cell.dataset.hmLabel} · Temp ${cell.dataset.hmTemp} (Feels ${cell.dataset.hmFeels}) · Dew Point ${cell.dataset.hmDp} · Wind ${cell.dataset.hmWind} mph · Rain Chance ${cell.dataset.hmPop}%
      `;
    };
    cell.addEventListener('pointerenter', showCell);
    cell.addEventListener('click', showCell);
  });
}

function renderDewPointFeelMeter(f) {
  const pipEl = document.getElementById('feel-spectrum-pip');
  const readoutEl = document.getElementById('dewpoint-readout-row');
  const chartStage = document.getElementById('dewpoint-chart-stage');

  const slice = f.hoursAll.slice(0, Math.min(state.dewPointRangeHours, f.hoursAll.length));
  const activeIdx = clamp(state.selectedDewPointIdx, 0, slice.length - 1);
  const h = slice[activeIdx] || f.current;
  const muggiest = slice.reduce((a, b) => (b.dewPointF > a.dewPointF ? b : a), slice[0]);

  const pipLeft = clamp(((h.dewPointF - 20) / 60) * 100, 2, 98);
  if (pipEl) pipEl.style.left = `${pipLeft.toFixed(1)}%`;

  let dpDesc = 'Moisture feels crisp and comfortable';
  if (h.dewPointF < 40) dpDesc = 'Dry air — indoor heating may drop indoor humidity low';
  else if (h.dewPointF >= 70) dpDesc = 'Oppressive tropical mugginess outdoors';
  else if (h.dewPointF >= 65) dpDesc = 'Noticeably sticky & humid air';
  else if (h.dewPointF >= 60) dpDesc = 'Slightly humid outdoor air';

  if (readoutEl) {
    readoutEl.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:12px;">
        <span style="font-size:38px;font-weight:800;font-variant-numeric:tabular-nums;">${fmtTemp(h.dewPointF)}</span>
        <div>
          <div style="font-size:14.5px;font-weight:700;color:#ffffff;">
            ${h.dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${h.hourLabel} Dew Point
          </div>
          <div style="font-size:13px;color:var(--muted);">${dpDesc}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <span class="telemetry-chip">🏠 Indoor RH @ 70°F: <strong>${h.indoorRh70F}%</strong></span>
        <span class="telemetry-chip">Peak Muggiest in View: <strong>${fmtTemp(muggiest.dewPointF)}</strong> (${muggiest.hourLabel})</span>
      </div>
    `;
  }

  renderDewPointFeelChart({
    containerEl: chartStage,
    hoursAll: f.hoursAll,
    rangeHours: state.dewPointRangeHours,
    selectedIdx: activeIdx,
    useCelsius: state.useCelsius,
    onSelectHour: (idx) => {
      state.selectedDewPointIdx = idx;
      renderDewPointFeelMeter(f);
    }
  });
}

function renderAqiAndGlanceTiles(f) {
  const aqiCard = document.getElementById('air-quality');
  const aqiNum = document.getElementById('aqi-big-number');
  const aqiLabel = document.getElementById('aqi-category-label');
  const aqiAdvice = document.getElementById('aqi-advice-text');
  const aqiPeak = document.getElementById('aqi-peak-badge');
  const pollWrap = document.getElementById('pollutant-bars');
  const metricsGrid = document.getElementById('metrics-grid');

  const aq = f.airQuality;
  if (aqiCard) aqiCard.style.background = aq.bg;
  if (aqiNum) aqiNum.textContent = aq.currentAqi;
  if (aqiLabel) {
    aqiLabel.textContent = aq.label;
    aqiLabel.style.color = aq.color;
  }
  if (aqiAdvice) aqiAdvice.textContent = aq.advice;
  if (aqiPeak) aqiPeak.textContent = `24h Forecast Peak: ${aq.peak24h} AQI`;

  if (pollWrap) {
    pollWrap.innerHTML = aq.pollutants
      .map((p) => {
        const pct = clamp((p.value / p.max) * 100, 6, 100);
        return `
          <div class="pollutant-item">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">
              <span style="color:var(--muted);">${p.name}</span>
              <strong>${p.value} ${p.unit}</strong>
            </div>
            <div class="pave-progress-bg">
              <div class="pave-progress-fill" style="width:${pct}%;background:${aq.color};"></div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  if (metricsGrid) {
    const cur = f.current;
    const today = f.days[0];
    const tiles = [
      { id: 'feels', kicker: '🌡 Feels Like', val: fmtTemp(cur.feelsLikeF), sub: `Shade ${fmtTemp(cur.shadeFeelsF)} · Sun ${fmtTemp(cur.sunFeelsF)}` },
      { id: 'rainfall', kicker: '💧 Precipitation', val: `${today.totalQpfIn}"`, sub: `24h total · ${cur.precipIn}"/hr now` },
      { id: 'wind', kicker: '💨 Wind', val: `${cur.windMph} mph`, sub: `${cur.windCardinal} · Gusts ${cur.windGustMph} mph` },
      { id: 'humidity', kicker: '🌫 Humidity', val: `${cur.humidity}%`, sub: `Dew point ${fmtTemp(cur.dewPointF)}` },
      { id: 'rainChance', kicker: '☔ Rain Chance', val: `${cur.rainChance}%`, sub: `Today peak ${today.rainChance}% (100-pt)` },
      { id: 'cloudCover', kicker: '👁 Visibility & Sky', val: `${cur.visibilityMi} mi`, sub: `Cloud cover ${cur.cloudCover}%` },
      { id: 'pressure', kicker: '⏲ Pressure', val: `${cur.pressureInHg}`, sub: `${cur.pressureHpa} hPa surface` },
      { id: 'uvIndex', kicker: '☀ Sun & Peak UV', val: `UV ${today.maxUvIndex}`, sub: `Rise ${today.sunrise} · Set ${today.sunset}` }
    ];

    metricsGrid.innerHTML = tiles
      .map(
        (t) => `
        <article class="glass metric-tile" data-jump-metric="${t.id}" role="button" tabindex="0">
          <span class="metric-tile-kicker">${t.kicker}</span>
          <span class="metric-tile-val">${t.val}</span>
          <span class="metric-tile-sub">${t.sub}</span>
        </article>
      `
      )
      .join('');

    metricsGrid.querySelectorAll('.metric-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        state.selectedMetricId = tile.dataset.jumpMetric || 'temp';
        renderHourlyExplorerSection(f);
        document.getElementById('main-hourly-trend')?.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }
}

function renderScientificFeedsAndAfd(f) {
  const cloudEl = document.getElementById('feeds-cloud');
  const wfoLbl = document.getElementById('afd-wfo-label');
  const afdPre = document.getElementById('afd-text-block');

  if (cloudEl) {
    cloudEl.innerHTML = f.feeds
      .map(
        (fd) => `
        <span class="feed-badge">
          <span class="live-dot" style="margin:0;"></span>
          <strong style="color:#ffffff;">${fd.name}</strong>
          <span>· ${fd.status} (${fd.run})</span>
        </span>
      `
      )
      .join('');
  }

  if (wfoLbl) wfoLbl.textContent = `NWS ${f.afd.wfo}`;
  if (afdPre) afdPre.textContent = f.afd.text;
}

function initHeaderControls() {
  const searchInput = document.getElementById('city-search');
  const dropdown = document.getElementById('search-results');
  const locateBtn = document.getElementById('locate-btn');
  const unitBtn = document.getElementById('unit-toggle');
  const refreshBtn = document.getElementById('refresh-btn');
  const skySelect = document.getElementById('sky-mood-select');
  const heroTemp = document.getElementById('temperature');

  // Press '/' anywhere to focus city search
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput?.focus();
    }
  });

  let debounceTimer = null;
  searchInput?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = searchInput.value.trim();
    debounceTimer = setTimeout(async () => {
      const results = await searchLocations(q);
      if (!dropdown) return;
      if (!results.length) {
        dropdown.hidden = true;
        return;
      }
      dropdown.hidden = false;
      dropdown.innerHTML = results
        .map(
          (r, idx) => `
          <button class="search-result-item" data-res-idx="${idx}" type="button">
            <span><strong>${r.name}</strong></span>
            <span style="font-size:11.5px;color:var(--faint);">${r.latitude.toFixed(2)}°, ${r.longitude.toFixed(2)}°</span>
          </button>
        `
        )
        .join('');

      dropdown.querySelectorAll('.search-result-item').forEach((item) => {
        item.addEventListener('click', () => {
          const picked = results[Number(item.dataset.resIdx)];
          dropdown.hidden = true;
          searchInput.value = '';
          if (picked) loadLocationForecast(picked);
        });
      });
    }, 180);
  });

  searchInput?.addEventListener('focus', async () => {
    if (!searchInput.value.trim()) {
      const results = PRESET_CITIES;
      if (!dropdown) return;
      dropdown.hidden = false;
      dropdown.innerHTML = results
        .map(
          (r, idx) => `
          <button class="search-result-item" data-res-idx="${idx}" type="button">
            <span><strong>${r.name}</strong></span>
            <span style="font-size:11.5px;color:var(--faint);">WFO ${r.wfo}</span>
          </button>
        `
        )
        .join('');
      dropdown.querySelectorAll('.search-result-item').forEach((item) => {
        item.addEventListener('click', () => {
          const picked = results[Number(item.dataset.resIdx)];
          dropdown.hidden = true;
          if (picked) loadLocationForecast(picked);
        });
      });
    }
  });

  document.addEventListener('click', (e) => {
    if (dropdown && !e.target.closest('.search-box-wrap')) {
      dropdown.hidden = true;
    }
  });

  locateBtn?.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        loadLocationForecast({
          id: 'gps',
          name: 'Current GPS Location',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          wfo: 'NWS'
        });
      },
      () => {
        loadLocationForecast(PRESET_CITIES[0]);
      }
    );
  });

  unitBtn?.addEventListener('click', () => {
    state.useCelsius = !state.useCelsius;
    unitBtn.textContent = state.useCelsius ? '°C' : '°F';
    renderAll();
  });

  refreshBtn?.addEventListener('click', () => {
    loadLocationForecast(state.location);
  });

  skySelect?.addEventListener('change', () => {
    state.skyOverride = skySelect.value;
    if (state.forecast) updateSkyAtmosphere(state.forecast);
  });

  heroTemp?.addEventListener('click', () => {
    state.selectedMetricId = 'temp';
    if (state.forecast) renderHourlyExplorerSection(state.forecast);
    document.getElementById('main-hourly-trend')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Mobile Tools Drawer Toggle
  const toolsBtn = document.getElementById('tools-drawer-btn');
  const toolsStrip = document.getElementById('tools-strip');
  toolsBtn?.addEventListener('click', () => {
    const isOpen = toolsStrip?.classList.toggle('open');
    toolsBtn.setAttribute('aria-expanded', String(Boolean(isOpen)));
  });

  // View Mode Switcher (Experimental, Globe Focus, Glance, Blend, Today)
  document.querySelectorAll('[data-view-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-view-mode]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      applyWorkspaceViewMode(btn.dataset.viewMode);
    });
  });

  // Explanation period pills
  document.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-period]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.explanationPeriod = btn.dataset.period;
      if (state.forecast) renderModelExplanationSection(state.forecast);
    });
  });

  // Dew point range pills
  document.querySelectorAll('[data-dp-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-dp-range]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.dewPointRangeHours = Number(btn.dataset.dpRange) || 48;
      state.selectedDewPointIdx = 0;
      if (state.forecast) renderDewPointFeelMeter(state.forecast);
    });
  });
}

function applyWorkspaceViewMode(mode) {
  state.activeViewMode = mode;
  const deck = document.getElementById('hero-globe-deck');
  if (deck) {
    deck.classList.toggle('globe-expanded', mode === 'halo');
    setTimeout(() => state.globeController?.handleResize(), 60);
  }
  const sections = document.querySelectorAll('[data-section]');
  sections.forEach((sec) => {
    const id = sec.dataset.section;
    if (mode === 'experimental' || mode === 'halo') {
      sec.style.display = '';
    } else if (mode === 'glance') {
      sec.style.display = ['briefing', 'daily', 'hourly', 'your-day'].includes(id) ? '' : 'none';
    } else if (mode === 'blend') {
      sec.style.display = ['hourly', 'explanation', 'compare', 'scientific'].includes(id) ? '' : 'none';
    } else if (mode === 'today') {
      sec.style.display = ['briefing', 'hourly', 'exposure', 'explanation', 'best-times'].includes(id) ? '' : 'none';
    }
  });
}

function initPresetCityChips() {
  const wrap = document.getElementById('preset-city-chips');
  if (!wrap) return;
  wrap.innerHTML = PRESET_CITIES.map(
    (c) => `
      <button class="city-chip ${c.id === state.location.id ? 'active' : ''}" data-city-id="${c.id}" type="button">
        ${c.name}
      </button>
    `
  ).join('');

  wrap.querySelectorAll('.city-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const found = PRESET_CITIES.find((c) => c.id === chip.dataset.cityId);
      if (found) loadLocationForecast(found);
    });
  });
}

function updatePresetChipSelection() {
  document.querySelectorAll('.city-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.cityId === state.location.id);
  });
}

function initGlobeSection() {
  state.globeController = new LiveCloudGlobe({
    canvasId: 'cloud-globe-canvas',
    onSelectLocation: (loc) => {
      loadLocationForecast(loc);
    }
  });

  const spinBtn = document.getElementById('globe-spin-btn');
  const centerBtn = document.getElementById('globe-center-btn');
  const zoomInBtn = document.getElementById('globe-zoom-in');
  const zoomOutBtn = document.getElementById('globe-zoom-out');
  const timeSlider = document.getElementById('globe-time-slider');
  const audioBtn = document.getElementById('sky-audio-btn');

  spinBtn?.addEventListener('click', () => {
    const active = state.globeController.setAutoSpin(!state.globeController.autoSpin);
    spinBtn.classList.toggle('active', active);
  });

  centerBtn?.addEventListener('click', () => {
    if (state.forecast?.location) {
      state.globeController.flyTo(
        state.forecast.location.latitude,
        state.forecast.location.longitude
      );
    }
  });

  zoomInBtn?.addEventListener('click', () => {
    state.globeController.zoomBy(1);
  });

  zoomOutBtn?.addEventListener('click', () => {
    state.globeController.zoomBy(-1);
  });

  document.querySelectorAll('[data-globe-layer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.globeLayer;
      const isOn = state.globeController.toggleLayer(key);
      btn.classList.toggle('active', isOn);
    });
  });

  timeSlider?.addEventListener('input', () => {
    const idx = Number(timeSlider.value) || 0;
    state.globeController.setHourOffset(idx);
    if (state.forecast) {
      updateGlobeHUD(state.forecast, idx);
    }
  });

  audioBtn?.addEventListener('click', () => {
    toggleProceduralSkyAudio(audioBtn);
  });
}

function updateGlobeHUD(f, hourIdx = 0) {
  const h = f.hours48?.[clamp(hourIdx, 0, f.hours48.length - 1)] || f.current;
  if (!h) return;

  const cloudHud = document.getElementById('globe-cloud-hud');
  const windHud = document.getElementById('globe-wind-hud');
  const timeLbl = document.getElementById('globe-time-label');
  const timeSlider = document.getElementById('globe-time-slider');

  if (cloudHud) {
    cloudHud.textContent = `☁️ Cloud Deck: ${h.cloudCover}% · Rain ${h.rainChance}%`;
  }
  if (windHud) {
    windHud.textContent = `💨 Flow: ${h.windCardinal} ${h.windMph} mph (Gusts ${h.windGustMph})`;
  }
  if (timeLbl) {
    timeLbl.textContent =
      hourIdx === 0
        ? 'Now (Live)'
        : `+${hourIdx}h · ${h.dateObj.toLocaleDateString('en-US', { weekday: 'short' })} ${h.hourLabel}`;
  }
  if (timeSlider && Number(timeSlider.value) !== hourIdx) {
    timeSlider.value = hourIdx;
  }
  if (state.globeController) {
    state.globeController.setHourOffset(hourIdx);
  }
}

function toggleProceduralSkyAudio(btnEl) {
  if (state.skyAudioActive) {
    state.skyAudioActive = false;
    btnEl?.classList.remove('audio-btn-active');
    if (btnEl) btnEl.textContent = '🔊 Sky Audio';
    try {
      state.audioCtx?.close();
    } catch {}
    state.audioCtx = null;
    return;
  }

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const bufferSize = ctx.sampleRate * 3;
    const noiseBuffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const out = noiseBuffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.032;
        b6 = white * 0.115926;
      }
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = ctx.createBiquadFilter();
    const isRain = state.skyMood === 'rain' || state.skyMood === 'storm';
    filter.type = isRain ? 'bandpass' : 'lowpass';
    filter.frequency.value = isRain ? 920 : 380;
    filter.Q.value = isRain ? 0.7 : 0.5;

    const gain = ctx.createGain();
    gain.gain.value = 0.25;

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    whiteNoise.start(0);

    state.audioCtx = ctx;
    state.audioGainNode = gain;
    state.skyAudioActive = true;
    btnEl?.classList.add('audio-btn-active');
    if (btnEl) btnEl.textContent = isRain ? '🌧️ Rain Audio On' : '🌬️ Breeze Audio On';
  } catch {
    state.skyAudioActive = false;
  }
}

function initMapSection() {
  const layerTabs = document.getElementById('map-layer-tabs');
  const captionEl = document.getElementById('map-layer-caption');
  const legendEl = document.getElementById('map-legend');
  const playBtn = document.getElementById('radar-play');
  const sliderEl = document.getElementById('radar-time');
  const stampEl = document.getElementById('radar-stamp');
  const fsBtn = document.getElementById('map-fullscreen-btn');
  const mapStageWrap = document.getElementById('map-stage-wrap');

  state.mapController = new WeatherMapController({
    mapContainerId: 'radar-map',
    onFrameChange: ({ frameIdx, totalFrames, label, layer }) => {
      if (sliderEl) {
        sliderEl.max = Math.max(0, totalFrames - 1);
        sliderEl.value = frameIdx;
      }
      if (stampEl) stampEl.textContent = label;
      if (captionEl && layer) captionEl.textContent = layer.caption;
      if (legendEl && layer) {
        legendEl.innerHTML = layer.legend
          .map(
            (l) => `<span><i class="legend-swatch" style="background:${l.color};"></i>${l.label}</span>`
          )
          .join('');
      }
    }
  });

  if (layerTabs) {
    layerTabs.innerHTML = MAP_LAYERS.map(
      (l, idx) => `
      <button class="metric-tab-btn ${idx === 0 ? 'active' : ''}" data-map-layer="${l.id}" type="button">
        ${l.label}
      </button>
    `
    ).join('');

    layerTabs.querySelectorAll('[data-map-layer]').forEach((btn) => {
      btn.addEventListener('click', () => {
        layerTabs.querySelectorAll('[data-map-layer]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (playBtn) playBtn.textContent = '▶ Play';
        state.mapController.setLayer(btn.dataset.mapLayer);
      });
    });
  }

  document.querySelectorAll('[data-basemap]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-basemap]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.mapController.setBasemap(btn.dataset.basemap);
    });
  });

  playBtn?.addEventListener('click', () => {
    const playing = state.mapController.togglePlayback();
    playBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
  });

  sliderEl?.addEventListener('input', () => {
    state.mapController.stopPlayback();
    if (playBtn) playBtn.textContent = '▶ Play';
    state.mapController.setFrameIndex(Number(sliderEl.value) || 0);
  });

  fsBtn?.addEventListener('click', () => {
    if (!mapStageWrap) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      mapStageWrap.requestFullscreen?.();
    }
  });
}

function initModalSystem() {
  const dialog = document.getElementById('nourie-dialog');
  const closeBtn = document.getElementById('modal-close');
  closeBtn?.addEventListener('click', () => dialog?.close());
  dialog?.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  document.getElementById('open-today-scrubber')?.addEventListener('click', () => {
    const f = state.forecast;
    if (!f) return;
    openHourlyListModal(
      `Remainder of Today & Tonight · ${f.location.name}`,
      'Hour-by-hour multi-model blend, UTCI/Steadman feels-like, and 100-point rain scoring.',
      f.hours48.slice(0, 18)
    );
  });

  document.getElementById('open-car-wash-modal')?.addEventListener('click', () => {
    const f = state.forecast;
    if (!f) return;
    const cw = f.carWash;
    openModal(
      `🚗 5-Day Car Wash & Outdoor Project Advisor · ${f.location.name}`,
      `
        <div style="margin-bottom:14px;padding:12px 16px;border-radius:14px;background:rgba(255,255,255,0.07);">
          <div style="font-size:12px;color:var(--faint);text-transform:uppercase;font-weight:700;">Best Upcoming Window</div>
          <div style="font-size:18px;font-weight:800;color:${cw.bestDay.color};margin-top:2px;">
            ${cw.bestDay.dayName} (${cw.bestDay.dateLabel}) · Score ${cw.bestDay.score}/100 (${cw.bestDay.verdict})
          </div>
          <div style="font-size:13px;color:var(--muted);margin-top:2px;">${cw.bestDay.note}</div>
        </div>
        <table class="math-table">
          <thead>
            <tr><th>Day</th><th>Verdict</th><th>Score</th><th>Rain Risk</th><th>Guidance</th></tr>
          </thead>
          <tbody>
            ${cw.days
              .map(
                (d) => `
              <tr>
                <td><strong>${d.dayName} · ${d.dateLabel}</strong></td>
                <td><strong style="color:${d.color};">${d.verdict}</strong></td>
                <td>${d.score}/100</td>
                <td>${d.rainChance}%</td>
                <td>${d.note}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `
    );
  });

  document.getElementById('open-snow-modal')?.addEventListener('click', () => {
    const f = state.forecast;
    if (!f) return;
    const total10dSnow = f.days.reduce((s, d) => s + (d.totalSnowIn || 0), 0).toFixed(1);
    openModal(
      `❄️ Snow & Winter Outlook · ${f.location.name}`,
      `
        <div style="font-size:22px;font-weight:800;margin-bottom:6px;">
          ${Number(total10dSnow) > 0 ? `${total10dSnow}" Total 10-Day Snow Potential` : 'No Accumulating Snow in the 10-Day Forecast'}
        </div>
        <p style="font-size:13.5px;color:var(--muted);margin-top:0;">
          Evaluated across NBM v4.2, ECMWF IFS, GEFS, and surface wet-bulb freezing profiles (${fmtTemp(f.current.wetBulbF, true)} current wet-bulb).
        </p>
        <table class="math-table">
          <thead>
            <tr><th>Day</th><th>High / Low</th><th>Precip Chance</th><th>Snowfall</th><th>Confidence</th></tr>
          </thead>
          <tbody>
            ${f.days
              .slice(0, 7)
              .map(
                (d) => `
              <tr>
                <td><strong>${d.shortWeekday} · ${d.dateLabel}</strong></td>
                <td>${fmtTemp(d.highF)} / ${fmtTemp(d.lowF)}</td>
                <td>${d.rainChance}%</td>
                <td><strong>${d.totalSnowIn}"</strong></td>
                <td style="color:${d.confidence.color};">${d.confidence.level}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `
    );
  });

  document.getElementById('open-afd-modal')?.addEventListener('click', () => {
    const f = state.forecast;
    if (!f) return;
    openModal(
      `📡 NWS ${f.afd.wfo} Area Forecast Discussion`,
      `<pre class="afd-pre" style="max-height:420px;">${f.afd.text}</pre>`
    );
  });
}

function openModal(title, htmlContent) {
  const dialog = document.getElementById('nourie-dialog');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  if (!dialog || !titleEl || !bodyEl) return;
  titleEl.textContent = title;
  bodyEl.innerHTML = htmlContent;
  dialog.showModal();
}

function openHourlyListModal(title, subtitle, hoursList) {
  openModal(
    title,
    `
      <p style="font-size:13px;color:var(--muted);margin-top:0;">${subtitle}</p>
      <div style="max-height:380px;overflow-y:auto;">
        <table class="math-table">
          <thead>
            <tr><th>Time</th><th>Condition</th><th>Temp</th><th>Feels (Shade/Sun)</th><th>100-Pt Rain</th><th>QPF</th><th>Wind</th></tr>
          </thead>
          <tbody>
            ${hoursList
              .map(
                (h) => `
              <tr>
                <td><strong>${h.hourLabel}</strong></td>
                <td>${h.condition}</td>
                <td><strong>${fmtTemp(h.tempF)}</strong></td>
                <td>${fmtTemp(h.shadeFeelsF)} / ${fmtTemp(h.sunFeelsF)}</td>
                <td style="color:#7ac6ff;font-weight:700;">${h.rainChance}%</td>
                <td>${h.precipIn.toFixed(3)}"</td>
                <td>${h.windCardinal} ${h.windMph} mph</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `
  );
}

/**
 * GPU Canvas Atmospheric Sky Particle Renderer
 * Renders smooth falling rain droplets, drifting golden motes, or twinkling night stars.
 */
function initSkyCanvas() {
  const canvas = document.getElementById('sky-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W = (canvas.width = window.innerWidth);
  let H = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  });

  const particles = Array.from({ length: 85 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    speedY: 4 + Math.random() * 7,
    speedX: -1.5 - Math.random() * 1.5,
    len: 14 + Math.random() * 18,
    alpha: 0.15 + Math.random() * 0.35,
    radius: 0.8 + Math.random() * 1.6,
    phase: Math.random() * Math.PI * 2
  }));

  function animate(ts) {
    ctx.clearRect(0, 0, W, H);
    const mood = state.skyMood;

    if (mood === 'rain' || mood === 'storm') {
      ctx.strokeStyle = 'rgba(155, 208, 255, 0.28)';
      ctx.lineWidth = 1.25;
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.speedX * 2.2, p.y + p.len);
        ctx.stroke();

        p.x += p.speedX * 1.6;
        p.y += p.speedY * 2.1;
        if (p.y > H) {
          p.y = -20;
          p.x = Math.random() * (W + 120);
        }
        if (p.x < -40) p.x = W + 20;
      });
    } else if (mood === 'night') {
      particles.slice(0, 55).forEach((p) => {
        const twinkle = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(ts * 0.002 + p.phase));
        ctx.fillStyle = `rgba(220, 236, 255, ${twinkle.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y * 0.65, p.radius, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      // Subtle floating solar light motes
      particles.slice(0, 35).forEach((p) => {
        ctx.fillStyle = `rgba(255, 232, 175, ${(p.alpha * 0.38).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 1.3, 0, Math.PI * 2);
        ctx.fill();
        p.y -= 0.18;
        p.x += Math.sin(ts * 0.0006 + p.phase) * 0.2;
        if (p.y < -10) p.y = H + 10;
      });
    }

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
}
