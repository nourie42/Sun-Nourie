/**
 * Weather Nourie · Experimental Fusion V3 Main Application Controller
 */

import { clamp, computePavementProfile, pavementDayPeak } from './physics.js?v=v3-pet-day-6';
import {
  fetchCompleteFusionForecast,
  nextSunnyBreak,
  outdoorExposureReadings,
  searchLocations
} from './fusion-engine.js?v=warning-first-v1';
import {todaySummary, twoDayHeadline} from './today-preview.js?v=two-day-headline-v1';
import {hourlyRainInputsHTML, rainPercent} from './hourly-rain.js?v=local-hourly-v1';
import { getLunarPhaseFraction, renderWeatherIconSvg } from './icons.js?v=v3-sky-8';
import {
  HOURLY_METRICS,
  extractHourMetricValue,
  renderDewPointFeelChart,
  renderHourlyExplorerChart
} from './charts.js?v=smooth-trend-v4';
import {
  WeatherMapController
} from './map.js?v=smooth-radar-v1';
import { dogWalkerScene, referenceScene } from '../../exposure-scene.js?v=true-night-art-v6';
import { danCard, danOverview, danTakeDisplay } from '../../dans-summary.js?v=warning-first-v1';
import { activeRiskOutlooks, outlookDetailHTML } from '../../risk-outlooks.js?v=risk-outlooks-v5';
import { forecastWindowBannerHTML, forecastWindowDetailHTML } from '../../forecast-window-banners.js?v=rain-hours-only-v1';
import {confidenceWarningDetailHTML,confidenceWarningHTML,lowConfidenceWarning} from '../../confidence-bar.js?v=multi-event-confidence-v4';
import {GlobePanel} from './globe-panel.js?v=wind-flow-v2';
import {outlookItems,renderOutlookPanel,openOutlookNote} from '../../outlook-panel.js?v=snow-aware-v3';
import { todayRainDisplay } from '../../today-card.js?v=hour-details-v1';
import {applyLocalRadar, displayedRainChance, observedRainLabel} from '../../rain-display.js?v=local-radar-v2';
import {currentWeatherDisplay} from '../../current-weather.js?v=freezing-aware-v1';
import { dayGraphHTML, installDayGraph } from '../../day-graph.js?v=hourly-rain-v5';
import { dewpointFeelLevel, renderDewpointMeter } from '../../dewpoint-meter.js?v=air-moisture-v2';
import { TREND_METRICS, mainTrendSeries, trendReading } from '../../main-hourly-trend.js?v=beta-glass-48h-v2';
import { mountChart, solarDays, nightBands, fmt as haloFmt, H as HALO_H } from '../../halo.js?v=smooth-trend-v4';

const LEGACY_LOC_KEY = 'weather-nourie-v3-location';
const SAVED_LOC_KEY = 'weather-nourie-v3-gps-location';
const DEVICE_LOC_KEY = 'weather-fusion-device-place';
const BETA_SELECTED_LOC_KEY = 'weather-nourie-v3-selected-location';
const RISK_COLORS = { Marginal: '#74d36a', Slight: '#f4e14a', Enhanced: '#e67a22', Moderate: '#e03b3b', High: '#d34cff' };

// Purge any legacy hardcoded preset/fallback cache on load
try {
  localStorage.removeItem(LEGACY_LOC_KEY);
} catch {}

// Prevent mobile browser bfcache from flashing an outdated page snapshot on return
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

function isValidCoordPair(lat, lon) {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    (lat !== 0 || lon !== 0)
  );
}

function loadInitialLocationContext() {
  try {
    const params = new URLSearchParams(window.location.search);
    const rawLat = params.get('latitude') ?? params.get('lat');
    const rawLon = params.get('longitude') ?? params.get('lon');
    const qLat = rawLat !== null && rawLat !== '' ? Number(rawLat) : NaN;
    const qLon = rawLon !== null && rawLon !== '' ? Number(rawLon) : NaN;
    const qName = params.get('name');
    if (isValidCoordPair(qLat, qLon)) {
      return { id: 'query', name: qName || 'Selected Location', latitude: qLat, longitude: qLon, explicitChoice: true, fromQuery: true };
    }
    for (const key of [BETA_SELECTED_LOC_KEY, 'weather-fusion-selected-city', SAVED_LOC_KEY, DEVICE_LOC_KEY]) {
      let place;
      try { place = JSON.parse(localStorage.getItem(key)); } catch { continue; }
      if (!isValidCoordPair(place?.latitude,place?.longitude)) continue;
      const device = place.gpsVerified === true || key === DEVICE_LOC_KEY;
      return {...place, fromCache:true, explicitChoice:!device};
    }
  } catch {}
  return null;
}

const state = {
  location: loadInitialLocationContext(),
  forecast: null,
  liveAlerts: null,
  liveBriefing: null,
  loadToken: 0,
  geoDenied: false,
  useCelsius: false,
  skyOverride: 'auto',
  activeViewMode: 'experimental',
  selectedHourIdx: 0,
  todayHourTime: null,
  feelsHourIdx: 0,
  expandedExposureIds: new Set(),
  selectedMetricId: 'temp',
  selectedDayIdx: 0,
  sevenDayDetailExpanded: false,
  sevenDayActiveCurve: null,
  explanationPeriod: 'all',
  compareExpanded: false,
  accuracyCache: new Map(),
  dewPointRangeHours: 48,
  selectedDewPointIdx: 0,
  aqiExpanded: false,
  mapController: null,
  globePanel: null,
  skyAudioActive: false,
  audioCtx: null,
  audioGainNode: null,
  skyMood: 'cloudy'
};

export function fmtTemp(tempF, includeUnit = false) {
  if (tempF === null || tempF === undefined || Number.isNaN(tempF)) return '—';
  const v = state.useCelsius ? Math.round(((tempF - 32) * 5) / 9) : Math.round(tempF);
  return `${v}°${includeUnit ? (state.useCelsius ? 'C' : 'F') : ''}`;
}

function setAwaitingLocationUi(isAwaiting, showCard = false) {
  document.body.classList.toggle('awaiting-location', Boolean(isAwaiting));
  const locCard = document.getElementById('location-needed-card');
  if (locCard) locCard.hidden = !showCard;
}

function locationStatus(message) {
  const status = document.getElementById('location-status');
  if (status) {
    status.hidden = !message;
    status.textContent = message;
  }
}

function showLocationNeededState() {
  const cityName = document.getElementById('city-name');
  if (cityName) cityName.textContent = 'Your local weather';
  setAwaitingLocationUi(true, true);
}

let gpsRequest = 0;
function requestDeviceLocation({manual = false} = {}) {
  const request = ++gpsRequest;
  const unable = () => {
    if (request !== gpsRequest) return;
    document.getElementById('locate-btn')?.removeAttribute('aria-busy');
    state.geoDenied = true;
    if (!state.location) showLocationNeededState();
    if (manual || !state.location) locationStatus('Location is unavailable. Allow location in your browser or search for your city or ZIP.');
  };
  if (!navigator.geolocation) {
    unable();
    return;
  }

  const locate = document.getElementById('locate-btn');
  locate?.setAttribute('aria-busy','true');
  if (manual || !state.location) locationStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(pos => {
    if (request !== gpsRequest) return;
    const latitude = Number(pos.coords.latitude.toFixed(4));
    const longitude = Number(pos.coords.longitude.toFixed(4));
    if (!isValidCoordPair(latitude,longitude)) { unable(); return; }
    state.geoDenied = false;
    locate?.removeAttribute('aria-busy');
    const samePoint = state.location?.latitude === latitude && state.location?.longitude === longitude;
    if (samePoint && !manual) return;
    const place = {id:'gps', name:'Current Location', latitude, longitude, gpsVerified:true, source:'device'};
    try {
      localStorage.setItem(SAVED_LOC_KEY,JSON.stringify(place));
      localStorage.setItem(DEVICE_LOC_KEY,JSON.stringify({...place,id:'device'}));
      localStorage.setItem(BETA_SELECTED_LOC_KEY,JSON.stringify(place));
    } catch {}
    document.getElementById('search-cluster')?.classList.remove('open');
    void loadLocationForecast(place,{forceRefresh:manual});
  },unable,{enableHighAccuracy:manual,timeout:12000,maximumAge:manual ? 0 : 120000});
}

document.addEventListener('DOMContentLoaded', () => {
  initBrandIcon();
  initSkyCanvas();
  initHeaderControls();
  initModalSystem();
  initMapSection();
  state.globePanel = new GlobePanel();
  initBottomNavDock();

  const initialLoc = state.location;
  if (initialLoc) void loadLocationForecast(initialLoc);
  else setAwaitingLocationUi(true, false);
  if (!initialLoc?.explicitChoice) requestDeviceLocation();

});

function initBrandIcon() {
  // The header reuses the main app’s actual Weather Nourie artwork.
}

let localRadarRequest;
let latestLocalRadar;
async function refreshLocalRadar(loc, token) {
  const coordinates = new URLSearchParams({latitude: loc.latitude, longitude: loc.longitude});
  const key = coordinates.toString();
  if (localRadarRequest?.key === key && localRadarRequest.token === token) return;
  const request = {key, token};
  localRadarRequest = request;
  try {
    const response = await fetch('/api/weather-fusion/radar?' + coordinates, {cache: 'no-store'});
    if (!response.ok || token !== state.loadToken) return;
    const data = await response.json();
    if (token !== state.loadToken) return;
    latestLocalRadar = {token, data};
    const f = state.forecast;
    if (f && applyLocalRadar(f.canonical, data)) updateObservedRain(f);
  } catch {
    // Keep the previous valid observation until its timestamp expires.
  } finally {
    if (localRadarRequest === request) localRadarRequest = null;
  }
}

function hasObservedRain(f) {
  return Boolean(f.canonical && currentWeatherDisplay(f.canonical).currentPrecipitation.label === 'Rain now');
}

function updateObservedRain(f) {
  updateSkyAtmosphere(f);
  renderHeroAndBriefing(f);
  renderBetaTodayCard(f);
  if (!state.feelsHourIdx) renderOutdoorExposureCards(f);
  renderTopCompactPills(f);
  renderSevenDayForecast(f);
}

setInterval(() => {
  if (!document.hidden && state.forecast?.canonical) {
    updateObservedRain(state.forecast);
    void refreshLocalRadar(state.location, state.loadToken);
  }
}, 120000);

async function loadLocationForecast(loc, { forceRefresh = false } = {}) {
  if (!loc || !isValidCoordPair(Number(loc.latitude), Number(loc.longitude))) return;
  const token = ++state.loadToken;
  const changingPoint = !state.forecast ||
    state.forecast.location.latitude !== loc.latitude || state.forecast.location.longitude !== loc.longitude;
  state.location = loc;
  if (changingPoint) {
    state.todayHourTime = null;
    state.forecast = null;
    const daySummary = document.getElementById('hero-day-summary');
    if (daySummary) daySummary.hidden = true;
    setAwaitingLocationUi(true, false);
    const cityName = document.getElementById('city-name');
    if (cityName) cityName.textContent = loc.name || 'Your local weather';
  }
  locationStatus('Loading local forecast…');
  state.liveAlerts = null;
  state.liveBriefing = null;
  void refreshLocalRadar(loc, token);

  fetch(`/api/weather-fusion/alerts?latitude=${encodeURIComponent(loc.latitude)}&longitude=${encodeURIComponent(loc.longitude)}`, {signal:AbortSignal.timeout(10000)})
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      if (token !== state.loadToken || !Array.isArray(data?.alerts)) return;
      state.liveAlerts = data.alerts;
      if (state.forecast) {
        if (data.alerts.length) state.forecast.alerts = data.alerts;
        renderStatusAndAlerts(state.forecast);
        renderTopCompactPills(state.forecast);
        state.mapController?.renderAlertPolygons(state.forecast.alerts);
      }
    }).catch(() => {});

  const liveForecast = await fetchCompleteFusionForecast(loc,{forceRefresh}).catch(() => null);
  if (token !== state.loadToken) return;
  if (!liveForecast?.isLiveApi) {
    locationStatus('Local forecast unavailable. Tap Refresh or search for another location.');
    if (!state.forecast) setAwaitingLocationUi(true,true);
    return;
  }
  if (state.liveAlerts?.length) liveForecast.alerts = state.liveAlerts;
  locationStatus('');
  setAwaitingLocationUi(false, false);
  if (!loc.fromQuery) {
    try { localStorage.setItem(BETA_SELECTED_LOC_KEY,JSON.stringify(liveForecast.location)); } catch {}
  }

  if (latestLocalRadar?.token === token) applyLocalRadar(liveForecast.canonical, latestLocalRadar.data);
  state.forecast = liveForecast;
  state.location = liveForecast.location;
  state.selectedHourIdx = 0;
  state.feelsHourIdx = 0;
  state.selectedDayIdx = 0;
  state.sevenDayDetailExpanded = false;
  state.selectedDewPointIdx = 0;
  renderAll();

  // Async layman's-terms NWS Forecast Discussion briefing (never blocks initial accurate paint)
  const sig = liveForecast.canonical?.signature;
  const briefingUrl = `/api/weather-fusion/briefing?latitude=${encodeURIComponent(loc.latitude)}&longitude=${encodeURIComponent(loc.longitude)}${sig ? `&signature=${encodeURIComponent(sig)}` : ''}`;
  fetch(briefingUrl, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((briefingRes) => {
      if (token !== state.loadToken || !briefingRes) return;
      if (briefingRes.headline || briefingRes.danTake || briefingRes.summary || briefingRes.danSummary) {
        state.liveBriefing = briefingRes;
        renderHeroAndBriefing(state.forecast);
        renderTopCompactPills(state.forecast);
      }
    });

  // Warm Model Accuracy Rankings cache in background so opening Rankings is instant
  setTimeout(() => {
    if (token !== state.loadToken) return;
    fetchAccuracyCached(loc.latitude, loc.longitude, 10, 24).catch(() => {});
  }, 500);
}

function fetchAccuracyCached(lat, lon, days = 10, horizon = 24) {
  const key = `${Number(lat).toFixed(2)}:${Number(lon).toFixed(2)}:${days}:${horizon}`;
  const existing = state.accuracyCache.get(key);
  if (existing) return existing;
  const url = `/api/weather-fusion/accuracy?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&days=${days}&horizon=${horizon}`;
  const req = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error('Accuracy service unavailable');
      return res.json();
    })
    .catch((err) => {
      state.accuracyCache.delete(key);
      throw err;
    });
  state.accuracyCache.set(key, req);
  return req;
}

function escapeAttr(val) {
  return String(val ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function twoDayHeadlineFor(f) {
  const [d0, d1] = f?.days || [];
  if (!d0 || !d1) return '';
  const since = Date.now() - 60 * 60 * 1000;
  const rest = todayHours(f).filter(h => Date.parse(h.time) >= since);
  const sum = key => rest.reduce((total, h) => total + (Number(h[key]) || 0), 0);
  const peak = key => rest.reduce((top, h) => Math.max(top, Number(h[key]) || 0), 0);
  const storm = day => /thunder|t-storm/.test(String(day.condition || '').toLowerCase());
  const today = rest.length
    ? { qpf: sum('precipIn'), chance: peak('rainChance'), wind: peak('forecastWindMph'), gust: peak('windGustMph'), snow: sum('snowfallIn'), storm: storm(d0) }
    : { qpf: d0.totalQpfIn, chance: d0.rainChance, wind: d0.maxWindMph, gust: d0.maxGustMph, snow: d0.totalSnowIn, storm: storm(d0) };
  const tomorrow = { qpf: d1.totalQpfIn, chance: d1.rainChance, wind: d1.maxWindMph, gust: d1.maxGustMph, snow: d1.totalSnowIn, storm: storm(d1) };
  return twoDayHeadline(today, tomorrow);
}

function isPartlyCloudyCondition(f) {
  const cond = String(f?.current?.condition || f?.canonical?.current?.condition || '').toLowerCase();
  return /partly\s+(?:cloudy|sunny)|mostly sunny|few clouds|scattered/.test(cond);
}

function isSkyCloudyOrWet(f) {
  const cur = f?.current;
  if (!cur) return false;
  const cond = String(cur.condition || f?.canonical?.current?.condition || '').toLowerCase();
  const clouds = Math.max(Number(cur.cloudCover) || 0, Number(f?.canonical?.current?.skyCover) || 0);
  const isPartly = /partly\s+(?:cloudy|sunny)|few clouds|scattered/.test(cond);
  if (/storm|thunder|rain|shower|drizzle|snow|sleet|flurr|ice|freez|wintry|overcast|mostly cloudy|fog|mist|haze|smoke/.test(cond) || (!isPartly && /\bcloudy\b/.test(cond))) {
    return true;
  }
  if (!isPartly && !/sunny|clear/.test(cond) && clouds >= 70) return true;
  return (cur.precipIn || 0) >= 0.02 || (cur.rainChance || 0) >= 60;
}

function todayHours(f) {
  return f.hours48.filter(hour=>hour.dayKey===f.days[0]?.dayKey);
}

const REMAINDER_ICON_PATHS = {
  drop: '<path d="M12 2.5C12 2.5 5 10.5 5 15.2a7 7 0 0 0 14 0C19 10.5 12 2.5 12 2.5z"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z"/>',
  rain: '<path d="M7 14h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 14z"/><path d="M9 17.5l-1 2.5M13 17.5l-1 2.5M17 17.5l-1 2.5"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
  thermo: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};

function remIcon(name, size = 16) {
  const filled = name === 'drop';
  return `<svg class="rem-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="${filled ? 'none' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${REMAINDER_ICON_PATHS[name]}</svg>`;
}

function withAlerts(forecast, alerts) {
  if (!forecast) return forecast;
  return forecast.alerts?.length || !alerts?.length ? forecast : { ...forecast, alerts };
}

/** Picks the condition photograph and its label from the remaining hours of today. */
function remainderSky(hours, cur) {
  const night = !cur.isDay;
  const text = hours.map(h => String(h.condition || h.forecastCondition || '').toLowerCase()).join(' ');
  const sum = key => hours.reduce((total, h) => total + (Number(h[key]) || 0), 0);
  const peak = key => hours.reduce((top, h) => Math.max(top, Number(h[key]) || 0), 0);
  const qpf = sum('precipIn'), snowIn = sum('snowfallIn'), chance = peak('rainChance');
  const wind = peak('forecastWindMph'), gust = peak('windGustMph');
  const clouds = hours.length ? hours.reduce((t, h) => t + (Number(h.forecastCloudCover) || 0), 0) / hours.length : (cur.cloudCover ?? 50);
  const isFreezing = cur.temperature !== null && cur.temperature !== undefined && cur.temperature < 32;
  const storm = /thunder|t-storm|storm/.test(text);
  const freezing = /freezing|ice storm/.test(text);
  const snowy = /snow|sleet|wintry|flurr|blizzard/.test(text) || snowIn >= 0.1;
  const rainy = qpf >= 0.05 || chance >= 50 || /rain|shower|drizzle/.test(text);
  if (storm) return gust >= 40 ? { image: 'severe-storms', label: 'Severe Storms' } : { image: 'thunderstorms', label: 'Thunderstorms' };
  if (freezing) return { image: 'freezing-rain', label: 'Freezing Rain' };
  if (snowy && /wintry|sleet|mix/.test(text)) return { image: 'wintry-mix', label: 'Wintry Mix' };
  if (snowy) {
    if (wind >= 25 || gust >= 35) return { image: 'blowing-snow', label: 'Blowing Snow' };
    if (snowIn >= 4) return { image: 'snow', label: 'Heavy Snow' };
    return snowIn >= 0.5 ? { image: 'snow', label: 'Snow' } : { image: 'light-snow', label: 'Light Snow' };
  }
  if (rainy) {
    if (isFreezing) return { image: 'snow', label: 'Snow' };
    if (wind >= 25 || gust >= 40) return { image: 'rain-windy', label: 'Rain & Wind' };
    if (qpf >= 0.75 || (qpf >= 0.5 && chance >= 80)) return { image: 'rain', label: 'Heavy Rain' };
    if (qpf >= 0.1 || chance >= 60) return { image: 'rain', label: 'Rain' };
    if (!night && clouds < 60) return { image: 'showers-sun', label: 'Sun & Showers' };
    return { image: 'light-rain', label: 'Light Rain' };
  }
  if (/fog|mist/.test(text)) return { image: 'fog', label: 'Fog' };
  if (/haze|smoke/.test(text)) return { image: night ? 'fog' : 'haze', label: 'Haze' };
  if (/dust|sand/.test(text)) return { image: 'dust', label: 'Dust' };
  if (clouds >= 85) return { image: 'cloudy', label: 'Cloudy' };
  if (clouds >= 60) return { image: night ? 'cloudy' : 'mostly-cloudy', label: 'Mostly Cloudy' };
  if (clouds >= 30) return { image: night ? 'partly-cloudy-night' : 'partly-cloudy', label: 'Partly Cloudy' };
  if (clouds >= 15) return night ? { image: 'mostly-clear-night', label: 'Mostly Clear' } : { image: 'mostly-sunny', label: 'Mostly Sunny' };
  return night ? { image: 'clear-night', label: 'Clear' } : { image: 'sunny', label: 'Sunny' };
}

function remainderHourIcon(h, d) {
  const c = String(h.condition || h.forecastCondition || '').toLowerCase();
  const rain = Number(h.rainChance) || 0;
  const tempF = Number(h.tempF) !== undefined ? h.tempF : Number(h.forecastTempF);
  const isFreezing = tempF < 32 && Number.isFinite(tempF);
  if (/snow|sleet|wintry|flurr|blizzard/.test(c) || (Number(h.snowfallIn) || 0) > 0) return 'snow';
  if (/freez|ice/.test(c)) return 'snow';
  if (/thunder|t-storm|storm/.test(c)) return 'storm';
  if (/rain|shower|drizzle/.test(c)) return isFreezing ? 'snow' : rain >= 55 ? 'rain' : 'drizzle';
  if (/fog|mist|haze|smoke/.test(c)) return 'fog';
  if (/overcast|mostly cloudy|\bcloudy\b/.test(c) && !/partly/.test(c)) return 'cloudy';
  if (/partly|scattered|few clouds|mostly sunny/.test(c)) return h.isDay ? 'partly-day' : 'partly-night';
  if (/sunny|clear|fair/.test(c)) return h.isDay ? 'clear-day' : 'clear-night';
  if (isFreezing && rain >= 35) return 'snow';
  if (rain >= 55) return 'rain';
  if (rain >= 35) return 'drizzle';
  return h.icon || d.icon;
}

function snowyHour(h) {
  return /snow|sleet|wintry|flurr|blizzard|freez/.test(String(h.condition || h.forecastCondition || '').toLowerCase()) || (Number(h.snowfallIn) || 0) > 0;
}

function remainderHours(f) {
  const cutoff = Date.now() - 30 * 60 * 1000;
  return todayHours(f).filter(h => Date.parse(h.time) >= cutoff);
}

function renderBetaTodayCard(f) {
  const host = document.getElementById('today-forecast');
  if (!host) return;
  const d = f?.days?.[0];
  if (!d) {
    host.hidden = true;
    return;
  }
  const cur = f.current;
  const tz = f.timeZone;
  const fmtHour = (t, opts) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(new Date(Date.parse(t)));
  const hours = remainderHours(f);
  const dayHours = todayHours(f);
  const winds = hours.map(h => h.forecastWindMph).filter(Number.isFinite);
  const gusts = hours.map(h => h.windGustMph).filter(Number.isFinite);
  const totalRain = hours.reduce((sum, h) => sum + (Number(h.precipIn) || 0), 0);
  const totalSnow = hours.reduce((sum, h) => sum + (Number(h.snowfallIn) || 0), 0);
  const snowDay = hours.some(snowyHour);
  const avgWind = winds.length ? Math.round(winds.reduce((a, b) => a + b, 0) / winds.length) : null;
  const windLow = winds.length ? Math.round(Math.min(...winds)) : null;
  const windHigh = winds.length ? Math.round(Math.max(...winds)) : null;
  const windValue = windLow === null ? '—' : windLow === windHigh ? `${windHigh}` : `${windLow}–${windHigh}`;
  const gustMax = gusts.length ? Math.round(Math.max(...gusts)) : null;
  const num = (v, fmt = x => `${Math.round(x)}`) => (Number.isFinite(v) ? fmt(v) : '—');
  const hourTemp = h => (Object.hasOwn(h, 'forecastTempF') ? h.forecastTempF : h.tempF);
  const feelsHour = hours.reduce((best, h) => (best && best.feelsLikeF >= h.feelsLikeF ? best : h), null);
  const precipPeak = dayHours.reduce((best, h) => (best && best.rainChance >= h.rainChance ? best : h), null);
  const peakText = precipPeak && precipPeak.rainChance >= 5 ? `Peak ${fmtHour(precipPeak.time, { hour: 'numeric' })}` : 'No peak';
  const uv = Math.round(d.maxUvIndex ?? cur.uvIndex ?? 0);
  const uvLabel = uv <= 2 ? 'Low' : uv <= 5 ? 'Moderate' : uv <= 7 ? 'High' : uv <= 10 ? 'Very High' : 'Extreme';
  const uvTone = uv <= 2 ? 'good' : uv <= 5 ? 'mod' : 'bad';
  const aqi = f.airQuality?.currentAqi;
  const aqiTone = aqi > 100 ? 'bad' : aqi > 50 ? 'mod' : 'good';
  const aqiLabel = f.airQuality?.label || (aqi > 100 ? 'Unhealthy' : aqi > 50 ? 'Moderate' : 'Good');
  const pill = (label, tone) => `<em class="rem-pill rem-${tone}">${escapeAttr(label)}</em>`;
  const sky = remainderSky(hours, cur);
  const metric = (icon, value, caption) => `<div class="rem-metric">${remIcon(icon, 18)}<b>${value}</b>${caption}</div>`;

  host.hidden = false;
  host.innerHTML = `
    <section class="remainder-card" aria-label="Remainder of Today">
      <header class="rem-title">
        <span class="rem-bar" aria-hidden="true"></span>
        <h2>Remainder of Today</h2>
        <time>Updated ${fmtHour(new Date().toISOString(), { hour: 'numeric', minute: '2-digit' })}</time>
      </header>
      <div class="rem-top">
        <figure class="rem-cond" style="background-image:url(/weather-fusion/cond-${sky.image}.webp)" role="img" aria-label="${escapeAttr(sky.label)}">
          <figcaption>${escapeAttr(sky.label)}</figcaption>
        </figure>
        <div class="rem-temps">
          <div><strong>${fmtTemp(d.highF)}</strong><small>High</small></div>
          <span class="rem-divider" aria-hidden="true"></span>
          <div><strong>${fmtTemp(d.lowF)}</strong><small>Low</small></div>
        </div>
        <div class="rem-chance">
          ${remIcon(snowDay ? 'snow' : 'drop', 20)}
          <strong>${num(d.rainChance, x => `${x}%`)}</strong>
          <small>${snowDay ? 'Snow Chance' : 'Rain Chance'}</small>
          <small class="rem-sub">${escapeAttr(peakText)}</small>
        </div>
      </div>
      <div class="rem-stats">
        <div class="rem-stat">
          <span class="rem-stat-label">${remIcon('thermo', 15)}Feels Like</span>
          <strong>${fmtTemp(feelsHour?.feelsLikeF ?? d.peakFeelsF)}</strong>
          <small>${feelsHour ? `at ${fmtHour(feelsHour.time, { hour: 'numeric' })}` : 'peak today'}</small>
        </div>
        <div class="rem-stat">
          <span class="rem-stat-label">${remIcon(snowDay ? 'snow' : 'rain', 15)}${snowDay ? 'Total Snow' : 'Total Rain'}</span>
          <strong>${snowDay ? totalSnow.toFixed(1) : totalRain.toFixed(2)}<em>in</em></strong>
          <small>rest of today</small>
        </div>
        <div class="rem-stat">
          <span class="rem-stat-label">${remIcon('wind', 15)}Wind</span>
          <strong>${windValue}<em>mph</em></strong>
          <small>${gustMax === null ? 'Gusts —' : `Gusts ${gustMax} mph`}</small>
        </div>
      </div>
      <div class="rem-hours" tabindex="0" aria-label="Hourly forecast for the rest of today">
        ${hours.map(h => `
          <div class="rem-hour">
            <small>${fmtHour(h.time, { hour: 'numeric' })}</small>
            ${renderWeatherIconSvg(remainderHourIcon(h, d), 44)}
            <strong>${fmtTemp(hourTemp(h))}</strong>
            <span class="rem-rainline">${remIcon('drop', 11)}${num(h.rainChance, x => `${x}%`)}</span>
            <span>${snowyHour(h) ? `❄ ${Number.isFinite(h.snowfallIn) ? h.snowfallIn.toFixed(1) : '—'}"` : (Number.isFinite(h.precipIn) ? h.precipIn.toFixed(2) + '"' : '—')}</span>
            <span>${remIcon('wind', 11)}${num(h.forecastWindMph, x => `${x} mph`)}</span>
          </div>`).join('')}
      </div>
      <div class="rem-foot">
        ${metric('wind', num(avgWind, x => `${x} mph`), '<span>Avg Wind</span>')}
        ${metric('drop', fmtTemp(d.dewPointF ?? cur.dewPointF), '<span>Dew Point</span>')}
        ${metric('cloud', num(cur.cloudCover, x => `${x}%`), '<span>Clouds</span>')}
        ${metric('leaf', `AQI ${num(aqi)}`, Number.isFinite(aqi) ? pill(aqiLabel, aqiTone) : '<span>Air quality</span>')}
        ${metric('sun', `UV ${num(uv)}`, pill(uvLabel, uvTone))}
      </div>
      <button class="remainder-more" type="button" aria-haspopup="dialog">View 48-hour graph ›</button>
    </section>
  `;
  const strip = host.querySelector('.rem-hours');
  const markEnd = () => strip.classList.toggle('at-end', strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 4);
  strip.addEventListener('scroll', markEnd, { passive: true });
  markEnd();
  host.querySelector('.remainder-more').onclick = () => {
    state.selectedHourIdx = 0;
    state.selectedMetricId = 'temp';
    open48hExplorerModal(f);
  };
}

function renderForecastConfidenceBar(f){
  const host=document.getElementById('forecast-confidence-bar');
  if(!host)return;
  const warning=lowConfidenceWarning(f?.canonical?.days);
  const slot=host.closest('.hero-confidence-slot');
  host.hidden=!warning;
  if(slot)slot.hidden=!warning;
  host.innerHTML=confidenceWarningHTML(warning);
  const button=host.querySelector('.forecast-confidence-button');
  if(button&&warning)button.onclick=()=>openModal(warning.modalTitle,confidenceWarningDetailHTML(warning));
}

function renderAll() {
  const f = state.forecast;
  if (!f) return;

  if (f.canonical) {
    try {
      globalThis.__weatherNourieForecast = f.canonical;
      document.dispatchEvent(new CustomEvent('weather-nourie:forecast', { detail: f.canonical }));
    } catch {}
  }

  updateSkyAtmosphere(f);
  renderStatusAndAlerts(f);
  renderWeatherHazards(f);
  renderForecastConfidenceBar(f);
  renderHeroAndBriefing(f);
  renderTopCompactPills(f);
  renderBetaTodayCard(f);
  renderFeelsTimeAndTrio(f);
  renderSevenDayForecast(f);
  renderOutdoorExposureCards(f);
  renderAqiAndGlanceTiles(f);
  renderCarWashTeaser(f);
  renderBestTimesHeatmap(f);
  renderCompareModelsSection(f);

  state.globePanel?.updateForecast(f);
  // Preload radar immediately when forecast loads so first radar frame is ready without a 30-60s wait
  if (state.mapController) {
    void state.mapController.init(f);
  }
}

function applyBackdropPhotoForSky(f) {
  const heroBg = document.getElementById('hero-bg-photo');
  if (!heroBg || !f?.current) return;
  let photo;
  if (state.skyOverride === 'day') {
    photo = { src: '/weather-fusion/today-sky-clear.webp', cls: 'sky-clear' };
  } else if (state.skyOverride === 'partly') {
    photo = { src: '/weather-fusion/today-sky-clouds.webp', cls: 'sky-partly' };
  } else if (state.skyOverride === 'rain') {
    photo = { src: '/weather-fusion/today-sky-rain.webp', cls: '' };
  } else if (state.skyOverride === 'night') {
    photo = { src: '/weather-fusion/today-sky-night-v2.webp', cls: '' };
  } else if (state.skyOverride === 'sunset') {
    photo = { src: '/weather-fusion/today-sky-sunset.jpg', cls: 'sky-sunset' };
  } else {
    photo = hasObservedRain(f)
      ? { src: '/weather-fusion/today-sky-rain.webp', cls: f.current.isDay ? '' : 'sky-night-rain' }
      : selectHeroBackdropPhoto(f.current, f.canonical);
  }
  const targetCls = photo.cls ? `hero-bg-photo ${photo.cls}` : 'hero-bg-photo';
  if (heroBg.getAttribute('src') !== photo.src) {
    heroBg.onload = () => {
      heroBg.className = targetCls;
    };
    heroBg.setAttribute('src', photo.src);
    if (heroBg.complete && heroBg.naturalWidth > 0) {
      heroBg.className = targetCls;
    }
  } else {
    heroBg.className = targetCls;
  }
}

function updateSkyAtmosphere(f) {
  const observed = hasObservedRain(f);
  const cloudyOrWet = isSkyCloudyOrWet(f);
  const autoMood = observed ? 'rain' : cloudyOrWet
    ? ((f.current?.rainChance >= 60 || (f.current?.precipIn || 0) >= 0.02) ? 'rain' : 'cloudy')
    : (f.current?.skyMood || (f.current?.isDay ? 'day' : 'night'));
  const mood = state.skyOverride === 'auto' ? autoMood : state.skyOverride;
  state.skyMood = mood;
  document.body.setAttribute('data-sky', mood);
  applyBackdropPhotoForSky(f);
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
      <details class="nws-alert" role="alert">
        <summary>
          <span class="nws-alert-tag">⚠ NWS ${a.severity}</span>
          <span class="nws-alert-event">${a.event}</span>
          <span class="nws-alert-chev" aria-hidden="true">▸</span>
        </summary>
        <div class="nws-alert-body">
          <p>${a.headline || a.areaDesc || ''}</p>
          <button class="nws-alert-view alert-view-btn" data-alert-idx="${idx}" type="button">View bulletin</button>
        </div>
      </details>
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

function renderWeatherHazards(f) {
  const strip = document.getElementById('weather-hazards-strip');
  const canonical = f.canonical || f;
  const risks = activeRiskOutlooks(canonical, Date.now());

  if (strip) {
    if (!risks.length) {
      strip.hidden = true;
      strip.innerHTML = '';
    } else {
      strip.hidden = false;
      strip.innerHTML = risks
        .map((r, idx) => {
          const isSevere = /Moderate|Enhanced|High/i.test(r.level);
          const color = RISK_COLORS[r.level] || '#f4e14a';
          const shortTitle = r.title || `${r.level} Weather Risk`;
          return `
            <button type="button" class="hazard-slim-btn ${isSevere ? 'severe' : ''}" data-risk-kind="${r.kind}" data-risk-index="${idx}" style="border-left:4px solid ${color};">
              <span class="hazard-slim-left">
                <span class="hazard-slim-dot" style="background:${color};"></span>
                <span>${shortTitle}</span>
              </span>
              <span class="hazard-slim-action">Map ›</span>
            </button>
          `;
        })
        .join('');
      strip.querySelectorAll('[data-risk-kind]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const r = risks[Number(btn.dataset.riskIndex)];
          if (r) openRiskOutlookModal(r, f);
        });
      });
    }
  }
}

async function openRiskOutlookModal(risk, f) {
  if (!risk) return;
  if (risk.kind === 'wssi' && risk.url) {
    window.open(risk.url, '_blank', 'noopener');
    return;
  }
  openModal(
    risk.title || `${risk.level} Weather Outlook`,
    `<div style="padding:14px 4px;color:var(--muted);">Loading official local outlook map &amp; summary for ${f.location.name}…</div>`
  );
  try {
    const q = new URLSearchParams({
      kind: risk.kind,
      latitude: String(f.location.latitude),
      longitude: String(f.location.longitude),
      place: f.location.name
    });
    if (risk.day) q.set('day', String(risk.day));
    if (f.location.wfo || f.location.office) q.set('office', f.location.wfo || f.location.office);
    const res = await fetch(`/api/weather-fusion/outlook?${q}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const detail = await res.json();
    if (!res.ok) throw new Error(detail?.error || 'Outlook unavailable.');

    const bodyEl = document.getElementById('modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = outlookDetailHTML(risk, detail);
      const mapHost = document.getElementById('outlook-map');
      if (mapHost && Array.isArray(detail.features) && detail.features.length && detail.location && window.L) {
        const center = [detail.location.latitude, detail.location.longitude];
        const oMap = window.L.map(mapHost, { zoomControl: true, scrollWheelZoom: false, attributionControl: false }).setView(center, 7);
        window.L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 10,
          className: 'outlook-basemap'
        }).addTo(oMap);
        window.L.geoJSON(
          {
            type: 'FeatureCollection',
            features: detail.features.map((row) => ({ type: 'Feature', properties: { level: row.level }, geometry: row.geometry }))
          },
          {
            style: (feat) => ({
              color: '#102033',
              weight: 1,
              fillColor: RISK_COLORS[feat.properties?.level] || '#74d36a',
              fillOpacity: 0.45
            })
          }
        ).addTo(oMap);
        window.L.circleMarker(center, { radius: 7, color: '#fff', weight: 2, fillColor: '#4cc3ff', fillOpacity: 1 }).addTo(oMap);
        requestAnimationFrame(() => oMap.invalidateSize());
      }
    }
  } catch (err) {
    const bodyEl = document.getElementById('modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = `<p style="color:#fecaca;">${err.message || 'Unable to load outlook details right now.'}</p><a class="bulletin-dialog-source" href="${risk.url || 'https://www.weather.gov/'}" target="_blank" rel="noopener noreferrer">Open official outlook ↗</a>`;
    }
  }
}

function renderTopCompactPills(f) {
  const host=document.getElementById('weather-outlook-summary');
  const perfectHost=document.getElementById('perfect-weather-window');
  if(!host)return;
  if(!f.canonical){host.hidden=true;if(perfectHost){perfectHost.hidden=true;perfectHost.replaceChildren();}return;}
  const now=Date.now(),items=outlookItems(withAlerts(f.canonical,f.alerts),now);
  const perfect=items.find(item=>item.kind==='perfect');
  const summary=items.find(item=>item.kind==='risk')?.risk.title||document.getElementById('take-banner-copy')?.textContent||'';
  renderOutlookPanel(host,{summary,items:items.filter(item=>item.kind!=='perfect'),onTake:()=>openWeatherTakeModal(f),onItem:item=>{
    if(item.kind==='risk'){
      if(item.risk.kind==='wssi')openOutlookNote(item.risk.title,[item.risk.summary,item.risk.url]);
      else void openRiskOutlookModal(item.risk,f);
    }else if(item.kind==='change')openModal('Change Alert',item.messages.map(message=>`<p>${cleanTakeJargon(message)}</p>`).join(''));
    else openModal(item.kind==='rain'?'Rain Outlook':'Perfect Weather',forecastWindowDetailHTML(item.view,item.kind,f.location.name,Date.now()));
  }});
  if(perfectHost){
    const banner=perfect?forecastWindowBannerHTML(perfect.view,'perfect',now):'';
    perfectHost.hidden=!banner;
    perfectHost.innerHTML=banner;
    const button=perfectHost.querySelector('button');
    if(button){
      button.removeAttribute('aria-controls');
      button.addEventListener('click',()=>openModal('Perfect Weather',forecastWindowDetailHTML(perfect.view,'perfect',f.location.name,Date.now())));
    }
  }
}

function selectHeroBackdropPhoto(cur, canonical = null) {
  const cond = String(cur.condition || canonical?.current?.condition || '').toLowerCase();
  const clouds = Math.max(Number(cur.cloudCover) || 0, Number(canonical?.current?.skyCover) || 0);
  const isNight = !cur.isDay;
  const isStorm = /storm|thunder|t-storm|lightning/.test(cond);
  const isRain = /rain|shower|drizzle|snow|sleet|flurr|ice|freez|wintry/.test(cond) || (cur.precipIn || 0) >= 0.02 || (cur.rainChance || 0) >= 60;
  const isPartlyCond = /partly\s+(?:cloudy|sunny)|mostly sunny|few clouds|scattered/.test(cond);
  const isExplicitSunny = (isPartlyCond || /sunny|clear/.test(cond)) && !/mostly cloudy|overcast/.test(cond) && (isPartlyCond || !/\bcloudy\b/.test(cond));
  const isOvercastCloudy = /overcast|mostly cloudy|fog|mist|haze|smoke/.test(cond) || (!isPartlyCond && /\bcloudy\b/.test(cond)) || (!isExplicitSunny && clouds >= 70);
  const isPartly = isPartlyCond || clouds >= 30;

  if (isStorm) {
    return { src: '/weather-fusion/today-sky-rain.webp', cls: 'sky-storm' };
  }
  if (isRain) {
    return { src: '/weather-fusion/today-sky-rain.webp', cls: isNight ? 'sky-overcast-night' : '' };
  }
  if (isOvercastCloudy) {
    return { src: '/weather-fusion/today-sky-rain.webp', cls: isNight ? 'sky-overcast-night' : 'sky-overcast' };
  }
  if (isNight && isPartlyCond) {
    return { src: '/weather-fusion/today-sky-clouds.webp', cls: 'sky-partly-night' };
  }
  if (isNight) {
    return { src: '/weather-fusion/today-sky-night-v2.webp', cls: '' };
  }
  if (isPartly) {
    return { src: '/weather-fusion/today-sky-clouds.webp', cls: 'sky-partly' };
  }
  return { src: '/weather-fusion/today-sky-clear.webp', cls: 'sky-clear' };
}

function computeWeatherMeterScore(cur, today, aqi, canonical = null) {
  let score = 96;
  const feels = cur.feelsLikeF ?? cur.tempF ?? 65;
  const cond = String(cur.condition || '').toLowerCase();
  const clouds = Number.isFinite(cur.cloudCover) ? cur.cloudCover : 0;

  // Optimal outdoor comfort is around 64–75°F
  if (feels < 64) score -= Math.min(32, (64 - feels) * 1.05);
  else if (feels > 76) score -= Math.min(36, (feels - 76) * 1.4);

  const dp = cur.dewPointF ?? 50;
  if (dp > 62) score -= Math.min(20, (dp - 62) * 1.25);
  else if (dp < 28) score -= Math.min(8, (28 - dp) * 0.35);

  // Sky / Cloud cover penalty (overcast gray skies cannot be "Ideal Outdoors")
  const isStorm = /storm|thunder|t-storm|lightning|hail/.test(cond);
  const isActiveWet = /rain|shower|drizzle|snow|sleet|flurr|ice|wintry|freez/.test(cond) || (cur.precipIn || 0) >= 0.01 || (cur.rainChance || 0) >= 55;
  const radarNearby = Boolean(
    canonical?.radar?.nearby ||
    canonical?.current?.rainAround ||
    /rain around|within \d+ mi/i.test(String(canonical?.current?.radarSummary || canonical?.current?.conditionSource || ''))
  );
  const isOvercast = !isActiveWet && !isStorm && (clouds >= 85 || /overcast|\bcloudy\b|fog|mist|haze/.test(cond));
  const isMostlyCloudy = !isOvercast && !isActiveWet && !isStorm && (clouds >= 70 || /mostly cloudy/.test(cond));
  const isPartlyCloudy = !isOvercast && !isMostlyCloudy && !isActiveWet && !isStorm && clouds >= 40;

  if (isOvercast) score -= 18;
  else if (isMostlyCloudy) score -= 13;
  else if (isPartlyCloudy) score -= 5;

  // Active rain, nearby radar rain, and daily rain risk
  const rain = Math.max(cur.rainChance || 0, Math.round((today?.rainChance || 0) * 0.65));
  if (isStorm) score -= 42;
  else if (isActiveWet) score -= 28;
  else if (radarNearby) score -= 18;
  else if (rain >= 20) score -= Math.min(24, (rain - 15) * 0.36);

  const wind = cur.windMph || 0;
  if (wind > 12) score -= Math.min(16, (wind - 12) * 0.85);

  if (aqi > 100) score -= Math.min(20, (aqi - 100) * 0.2);
  else if (aqi > 50) score -= Math.min(6, (aqi - 50) * 0.1);

  // Hard realism caps so rainy or overcast skies never claim "Ideal Outdoors"
  if (isStorm) score = Math.min(score, 40);
  else if (isActiveWet) score = Math.min(score, 58);
  else if (radarNearby) score = Math.min(score, 66);
  else if (isOvercast || isMostlyCloudy) score = Math.min(score, 76);

  const clamped = Math.round(clamp(score, 12, 99));
  let label = 'Ideal Outdoors';
  if (clamped < 45) label = 'Challenging';
  else if (clamped < 65) label = 'Fair Conditions';
  else if (clamped < 80) label = 'Pleasant';
  else if (clamped < 90) label = 'Mostly Comfortable';
  return { score: clamped, label, isStorm, isActiveWet, radarNearby, isOvercast, isMostlyCloudy, clouds };
}

function renderWeatherMeterArcSvg(score) {
  const pct = clamp(score / 100, 0.05, 0.99);
  const cx = 56;
  const cy = 50;
  const r = 38;
  const startAngle = Math.PI; // 180 deg (left)
  const endAngle = 0; // 0 deg (right)
  const angle = startAngle - pct * Math.PI;
  const dotX = cx + r * Math.cos(angle);
  const dotY = cy - r * Math.sin(angle);
  const arcLen = Math.PI * r;
  const dashOffset = arcLen * (1 - pct);

  return `
    <svg class="meter-arc-svg" viewBox="0 0 112 60" role="img" aria-label="Weather Meter ${score} out of 100">
      <defs>
        <linearGradient id="wm-arc-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#f0786a"/>
          <stop offset="55%" stop-color="#ffd470"/>
          <stop offset="100%" stop-color="#5ce0a0"/>
        </linearGradient>
      </defs>
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="5.5" stroke-linecap="round"/>
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="url(#wm-arc-grad)" stroke-width="5.5" stroke-linecap="round" stroke-dasharray="${arcLen.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}"/>
      <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="4.5" fill="#ffffff" stroke="#081426" stroke-width="1.5"/>
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#ffffff" font-size="18" font-weight="800">${score}<tspan font-size="10.5" fill="rgba(200,218,244,0.72)" font-weight="600">/100</tspan></text>
    </svg>
  `;
}

function renderCompassSvg(deg = 0) {
  const rot = Number.isFinite(deg) ? deg : 45;
  return `
    <svg class="compass-dial-svg" viewBox="0 0 46 46" aria-hidden="true">
      <circle cx="23" cy="23" r="20" fill="rgba(10, 26, 52, 0.55)" stroke="rgba(140, 196, 255, 0.35)" stroke-width="1.5"/>
      <circle cx="23" cy="5.5" r="1.4" fill="rgba(255,255,255,0.5)"/>
      <circle cx="23" cy="40.5" r="1.4" fill="rgba(255,255,255,0.28)"/>
      <circle cx="5.5" cy="23" r="1.4" fill="rgba(255,255,255,0.28)"/>
      <circle cx="40.5" cy="23" r="1.4" fill="rgba(255,255,255,0.28)"/>
      <g transform="rotate(${rot.toFixed(0)} 23 23)">
        <polygon points="23,9 28.5,28 23,24.5 17.5,28" fill="#7ac6ff" stroke="#ffffff" stroke-width="0.9" stroke-linejoin="round"/>
      </g>
    </svg>
  `;
}

function renderOutfitGraphicSvg(feelsF, isRain) {
  if (isRain) {
    return `
      <svg viewBox="0 0 64 64" width="54" height="54" aria-hidden="true">
        <defs><linearGradient id="coatG" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4e7a5a"/><stop offset="100%" stop-color="#2c4a38"/></linearGradient></defs>
        <path d="M18 20 L25 12 Q32 16 39 12 L46 20 L54 34 L46 38 L43 29 L43 54 L21 54 L21 29 L18 38 L10 34 Z" fill="url(#coatG)" stroke="rgba(255,255,255,0.35)" stroke-width="1.4" stroke-linejoin="round"/>
        <line x1="32" y1="16" x2="32" y2="54" stroke="rgba(255,255,255,0.28)" stroke-width="1.5"/>
        <path d="M25 12 Q32 4 39 12" fill="none" stroke="#9be2ff" stroke-width="2" stroke-linecap="round"/>
      </svg>`;
  }
  if (feelsF < 46) {
    return `
      <svg viewBox="0 0 64 64" width="54" height="54" aria-hidden="true">
        <defs><linearGradient id="parkaG" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4c6482"/><stop offset="100%" stop-color="#26384d"/></linearGradient></defs>
        <path d="M17 19 L25 11 Q32 16 39 11 L47 19 L55 36 L47 40 L44 30 L44 55 L20 55 L20 30 L17 40 L9 36 Z" fill="url(#parkaG)" stroke="rgba(255,255,255,0.38)" stroke-width="1.5" stroke-linejoin="round"/>
        <line x1="32" y1="15" x2="32" y2="55" stroke="rgba(255,255,255,0.3)" stroke-width="1.6"/>
        <line x1="21" y1="30" x2="43" y2="30" stroke="rgba(255,255,255,0.16)" stroke-width="1.4"/>
        <line x1="21" y1="42" x2="43" y2="42" stroke="rgba(255,255,255,0.16)" stroke-width="1.4"/>
      </svg>`;
  }
  if (feelsF < 64) {
    return `
      <svg viewBox="0 0 64 64" width="54" height="54" aria-hidden="true">
        <defs><linearGradient id="jktG" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#7c8752"/><stop offset="100%" stop-color="#464f2d"/></linearGradient></defs>
        <path d="M18 19 L25 11 Q32 16 39 11 L46 19 L54 35 L46 39 L43 29 L43 54 L21 54 L21 29 L18 39 L10 35 Z" fill="url(#jktG)" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M25 11 Q32 5 39 11" fill="#3a4225" stroke="rgba(255,255,255,0.28)" stroke-width="1.2"/>
        <line x1="32" y1="16" x2="32" y2="54" stroke="rgba(255,255,255,0.26)" stroke-width="1.5"/>
        <rect x="24" y="37" width="5" height="7" rx="1.5" fill="rgba(0,0,0,0.22)"/>
        <rect x="35" y="37" width="5" height="7" rx="1.5" fill="rgba(0,0,0,0.22)"/>
      </svg>`;
  }
  return `
    <svg viewBox="0 0 64 64" width="54" height="54" aria-hidden="true">
      <defs><linearGradient id="teeG" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#4ba8e8"/><stop offset="100%" stop-color="#2563a8"/></linearGradient></defs>
      <path d="M19 18 L26 12 Q32 17 38 12 L45 18 L54 27 L47 34 L43 29 L43 54 L21 54 L21 29 L17 34 L10 27 Z" fill="url(#teeG)" stroke="rgba(255,255,255,0.36)" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
}

function getFeelsVerdict(feelsF, isRain) {
  if (isRain && feelsF < 55) return { label: 'Cool & Damp', note: 'Rain shell recommended' };
  if (isRain) return { label: 'Wet & Breezy', note: 'Bring an umbrella' };
  if (feelsF < 34) return { label: 'Freezing Cold', note: 'Heavy coat & gloves' };
  if (feelsF < 46) return { label: 'Chilly', note: 'Warm jacket weather' };
  if (feelsF < 62) return { label: 'Cool & Comfortable', note: 'Light jacket or hoodie' };
  if (feelsF < 76) return { label: 'Mild & Pleasant', note: 'Comfortable outdoor air' };
  if (feelsF < 86) return { label: 'Warm', note: 'Short sleeves weather' };
  return { label: 'Hot & Humid', note: 'Stay hydrated & shaded' };
}

function getDewPointVerdict(dpF) {
  if (dpF < 35) return 'Very Dry';
  if (dpF < 50) return 'Crisp & Dry';
  if (dpF < 60) return 'Comfortable';
  if (dpF < 66) return 'Noticeably Humid';
  if (dpF < 72) return 'Sticky & Muggy';
  return 'Oppressive';
}

function formatZonedHourStamp(h, idx, timeZone) {
  if (!h) return 'Now';
  if (idx === 0) return 'Now';
  try {
    const dayStr = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(h.dateObj);
    return `${dayStr} · ${h.hourLabel}`;
  } catch {
    return h.hourLabel;
  }
}

function cleanTakeJargon(text) {
  return String(text || '')
    .replace(/\bour CWA\b/gi, 'our area')
    .replace(/\bCWA\b/g, 'local area')
    .replace(/\bPrecip\b/g, 'Rain');
}

function renderHeroAndBriefing(f) {
  const cur = f.current;
  const today = f.days[0];
  const aqi = f.airQuality?.currentAqi ?? 38;
  const tz = f.timeZone || f.location?.timeZone || 'America/New_York';

  // Dynamic clean photographic sky backdrop matching current conditions (zero false sun on cloudy days)
  applyBackdropPhotoForSky(f);

  const dateEl = document.getElementById('hero-date');
  const cityEl = document.getElementById('city-name');
  const sceneEl = document.getElementById('hero-scene');
  const tempEl = document.getElementById('temperature');
  const condEl = document.getElementById('hero-condition');
  const feelsLineEl = document.getElementById('hero-feels-line');
  const hiloEl = document.getElementById('hero-hilo');

  if (dateEl) {
    dateEl.textContent = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    }).format(cur.dateObj);
  }
  if (cityEl) cityEl.textContent = f.location.name;
  const oldAppLink = document.getElementById('old-app-link');
  if (oldAppLink) oldAppLink.href = '/weather-fusion/old/?' + new URLSearchParams({
    latitude:f.location.latitude,longitude:f.location.longitude,name:f.location.name
  });
  const observedRain = hasObservedRain(f);
  const summary = document.getElementById('hero-day-summary');
  if (summary) {
    const headline = twoDayHeadlineFor(f);
    summary.textContent = headline || todaySummary(todayHours(f),f.canonical?.days?.[0]?.high,{observedRain});
    summary.hidden = !summary.textContent;
  }
  if (sceneEl) sceneEl.innerHTML = renderWeatherIconSvg(observedRain ? 'rain' : cur.icon, 68);
  if (tempEl) tempEl.textContent = fmtTemp(cur.tempF);
  if (condEl) condEl.textContent = observedRain ? 'Rain now' : cur.condition;
  if (feelsLineEl) feelsLineEl.textContent = `Feels Like ${fmtTemp(cur.feelsLikeF)}`;
  if (hiloEl) {
    hiloEl.innerHTML = `High <strong>${fmtTemp(today.highF)}</strong> &nbsp;|&nbsp; Low <strong>${fmtTemp(today.lowF)}</strong>`;
  }

  // Top Slim Clickable Nourie Take Preview
  const canonical = f.canonical;
  const takeSource = withAlerts(canonical, f.alerts);
  const b = state.liveBriefing || canonical;
  const card = canonical ? danCard(b, takeSource, Date.now()) : null;
  const overview = canonical ? danOverview(b, takeSource, Date.now()) : null;
  const takeDisplay = canonical ? danTakeDisplay(b, takeSource, Date.now()) : '';

  const validTakeText =
    takeDisplay && !/unavailable right now/i.test(takeDisplay)
      ? takeDisplay
      : overview?.text && !/unavailable right now/i.test(overview.text)
      ? overview.text
      : '';
  const firstSentence = cleanTakeJargon(
    validTakeText
      .split(/\n+/)
      .map((s) => s.trim())
      .find(Boolean) || f.briefing.headline
  );

  const takeBannerCopy = document.getElementById('take-banner-copy');
  if (takeBannerCopy) {
    takeBannerCopy.textContent = card?.text ? cleanTakeJargon(card.text.replace(/\n+/g, ' · ')) : firstSentence;
  }

  // 4-Column Quick Stats Glass Strip (use exact canonical 24-hour QPF sum when available so Main and Beta match identically)
  const canonNext24 = f.canonical?.precipitation?.value;
  const next24Precip = typeof canonNext24 === 'number' && Number.isFinite(canonNext24)
    ? canonNext24
    : (f.hours48 || [])
        .slice(0, 24)
        .reduce((acc, h) => acc + (Number(h.precipIn) || 0), 0);
  const rainEl = document.getElementById('qs-rain-val');
  const precipEl = document.getElementById('qs-precip-val');
  const aqiValEl = document.getElementById('qs-aqi-val');
  const aqiSubEl = document.getElementById('qs-aqi-sub');
  const meterArcEl = document.getElementById('qs-weather-meter-arc');
  const meterSubEl = document.getElementById('qs-meter-sub');

  if (rainEl) {
    const rain = f.canonical ? todayRainDisplay(f.canonical) : {value: today.rainChance ?? cur.rainChance};
    rainEl.textContent = Number.isFinite(rain.value) ? `${Math.round(rain.value)}%` : '—';
    rainEl.title = observedRainLabel(rain) || cur.rainLedger?.tooltip || '';
    const rainCaption = document.getElementById('qs-rain-caption');
    if (rainCaption) rainCaption.textContent = rain.observed ? 'Rain now' : 'Today';
  }
  if (precipEl) precipEl.textContent = `${next24Precip.toFixed(2)}"`;
  if (aqiValEl) {
    aqiValEl.textContent = String(Math.round(aqi));
    const aqiColor = aqi <= 50 ? '#8fd3b4' : aqi <= 100 ? '#e8cf82' : aqi <= 150 ? '#e8a06e' : '#e58888';
    aqiValEl.style.color = aqiColor;
    if (aqiSubEl) {
      aqiSubEl.textContent = f.airQuality?.label || (aqi <= 50 ? 'Good' : aqi <= 100 ? 'Moderate' : 'Sensitive');
      aqiSubEl.style.color = aqiColor;
    }
  }
  const meter = computeWeatherMeterScore(cur, today, aqi, f.canonical);
  if (meterArcEl) meterArcEl.innerHTML = renderWeatherMeterArcSvg(meter.score);
  if (meterSubEl) meterSubEl.textContent = meter.label;
}

function getFeelsTimePresets(f) {
  const hrs = f.hours48 || [];
  const todayKey = hrs[0]?.dayKey;
  const tomAmIdx = hrs.findIndex((h) => h.dayKey !== todayKey && h.hourOfDay === 9);
  const tomPmIdx = hrs.findIndex((h) => h.dayKey !== todayKey && h.hourOfDay === 15);
  return [
    { label: 'Now', idx: 0 },
    { label: '+3h', idx: Math.min(3, hrs.length - 1) },
    { label: '+6h', idx: Math.min(6, hrs.length - 1) },
    { label: '+12h', idx: Math.min(12, hrs.length - 1) },
    ...(tomAmIdx > 0 ? [{ label: 'Tom AM', idx: tomAmIdx }] : []),
    ...(tomPmIdx > 0 ? [{ label: 'Tom PM', idx: tomPmIdx }] : [])
  ];
}

function renderFeelsTimeAndTrio(f) {
  const hrs = f.hours48 || [f.current];
  const idx = clamp(state.feelsHourIdx || 0, 0, hrs.length - 1);
  state.feelsHourIdx = idx;
  const h = hrs[idx] || f.current;
  const tz = f.timeZone || f.location?.timeZone || 'America/New_York';
  const isRain = (h.rainChance || 0) >= 55 || (h.precipIn || 0) >= 0.02;

  const stampText = formatZonedHourStamp(h, idx, tz);
  const timeLbl = document.getElementById('feels-selected-time-label');
  const tempPill = document.getElementById('feels-selected-temp-pill');
  const slider = document.getElementById('feels-hour-slider');
  const quickPills = document.getElementById('feels-quick-pills');

  if (timeLbl) {
    timeLbl.textContent = idx === 0
      ? 'Showing right now · drag slider or tap a time below'
      : `Previewing ${stampText} (${h.condition}) · updates outfit & cartoon cards`;
  }
  if (tempPill) tempPill.textContent = `${idx === 0 ? 'Now' : h.hourLabel} · Feels ${fmtTemp(h.feelsLikeF)}`;
  if (slider) {
    slider.max = String(Math.max(0, hrs.length - 1));
    slider.value = String(idx);
    slider.oninput = () => {
      state.feelsHourIdx = Number(slider.value) || 0;
      renderFeelsTimeAndTrio(f);
      renderOutdoorExposureCards(f);
    };
  }
  if (quickPills) {
    const presets = getFeelsTimePresets(f);
    quickPills.innerHTML = presets
      .map(
        (p) => `<button class="mode-pill ${p.idx === idx ? 'active' : ''}" data-feels-idx="${p.idx}" type="button">${p.label}</button>`
      )
      .join('');
    quickPills.querySelectorAll('[data-feels-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.feelsHourIdx = Number(btn.dataset.feelsIdx) || 0;
        renderFeelsTimeAndTrio(f);
        renderOutdoorExposureCards(f);
      });
    });
  }

  // Update 3-Column Bottom Comfort Trio for selected hour
  const feelsVerdict = getFeelsVerdict(h.feelsLikeF ?? h.tempF, isRain);
  const trioFeelsLbl = document.getElementById('trio-feels-label');
  const trioFeelsNote = document.getElementById('trio-feels-note');
  const trioOutfitEl = document.getElementById('trio-outfit-visual');
  const trioDpVal = document.getElementById('trio-dewpoint-val');
  const trioDpLbl = document.getElementById('trio-dewpoint-label');
  const trioWindSpd = document.getElementById('trio-wind-speed');
  const trioWindUnit = document.getElementById('trio-wind-unit');
  const trioWindGust = document.getElementById('trio-wind-gust');
  const trioCompass = document.getElementById('trio-wind-compass');

  const advice = buildWardrobeAdvice(h.feelsLikeF ?? h.tempF, h);
  if (trioFeelsLbl) trioFeelsLbl.textContent = feelsVerdict.label;
  if (trioFeelsNote) trioFeelsNote.textContent = advice.items[0];
  if (trioOutfitEl) {
    const sceneCtx = { pop: h.rainChance, rainExpected: isRain, snowExpected: /snow|flurr/i.test(h.condition || '') };
    trioOutfitEl.innerHTML = referenceScene(1, Boolean(h.isDay), h.condition || 'Clear', h.feelsLikeF ?? h.tempF, sceneCtx);
  }
  if (trioDpVal) trioDpVal.textContent = fmtTemp(h.dewPointF);
  const feelMeterVerdict = dewpointFeelLevel(h.dewPointF ?? 50, h.windMph ?? 0);
  if (trioDpLbl) trioDpLbl.textContent = feelMeterVerdict?.label || getDewPointVerdict(h.dewPointF ?? 50);
  if (trioWindSpd) trioWindSpd.textContent = String(Math.round(h.windMph ?? 0));
  if (trioWindUnit) trioWindUnit.textContent = `mph ${h.windCardinal || 'N'}`;
  if (trioWindGust) trioWindGust.textContent = `Gusts ${Math.round(h.windGustMph ?? h.windMph ?? 0)} mph`;
  if (trioCompass) trioCompass.innerHTML = renderCompassSvg(h.windDirDeg ?? 45);
}

function formatHHMMTo12h(hhmm) {
  if (!hhmm || !String(hhmm).includes(':')) return hhmm || '—';
  const [hStr, mStr] = String(hhmm).split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function openDayHourlyModal(day, f) {
  if (!day) return;
  const hrs = Array.isArray(day.hours) ? day.hours : [];
  const rows = hrs
    .map(
      (h) => `
      <tr>
        <td><strong>${h.hourLabel}</strong></td>
        <td><span style="display:inline-flex;align-items:center;gap:5px;">${renderWeatherIconSvg(h.icon, 20)}<span>${h.condition}</span></span></td>
        <td><strong>${fmtTemp(h.tempF)}</strong></td>
        <td>${fmtTemp(h.feelsLikeF)}</td>
        <td title="${escapeAttr(h.rainLedger?.tooltip || '')}">💧 ${rainPercent(h.rainChance)}</td>
        <td><strong>${Number.isFinite(h.precipIn) ? h.precipIn.toFixed(2)+'″' : '—'}</strong></td>
        <td>${h.windMph} mph ${h.windCardinal || ''}</td>
        <td>${h.cloudCover ?? '—'}%</td>
      </tr>
    `
    )
    .join('');

  openModal(
    `${day.dayName} (${day.dateLabel}) · ${f.location.name}`,
    `
      <div class="d7-modal-summary">
        <div><strong>${day.condition}</strong> · High ${fmtTemp(day.highF)} / Low ${fmtTemp(day.lowF)}</div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:3px;">
          Feels ${fmtTemp(day.minFeelsF)}–${fmtTemp(day.peakFeelsF)} · Rain ${rainPercent(day.rainChance)} (${day.totalQpfIn.toFixed(2)}") · Wind up to ${day.maxWindMph} mph (gusts ${day.maxGustMph} mph)
        </div>
      </div>
      <div class="compare-table-wrap" style="margin-top:10px;max-height:380px;overflow-y:auto;">
        <table class="compare-days-table" aria-label="Hourly forecast for ${day.dayName}">
          <thead>
            <tr>
              <th>Time</th>
              <th>Sky</th>
              <th>Temp</th>
              <th>Feels</th>
              <th>Rain %</th>
              <th>Rain Amt</th>
              <th>Wind</th>
              <th>Clouds</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `
  );
}

function renderSevenDayForecast(f) {
  const dualStage = document.getElementById('seven-day-dual-stage');
  const days7 = f.days.slice(0, 7);
  if (f.canonical && days7[0]) {
    const rain = displayedRainChance(f.canonical, days7[0].rainChance);
    days7[0] = {...days7[0], rainChance:rain.value, rainObserved:rain.observed};
  }
  const selIdx = clamp(state.selectedDayIdx, 0, Math.max(0, days7.length - 1));
  const d = days7[selIdx] || days7[0];
  const isExpanded = Boolean(state.sevenDayDetailExpanded);

  const chipEl = document.getElementById('d7-selected-chip');
  if (chipEl && d) {
    chipEl.textContent = isExpanded ? `${d.dayName} · Hide details ▴` : 'Expand Details ▾';
    chipEl.setAttribute('aria-expanded', String(isExpanded));
    chipEl.style.cursor = 'pointer';
    chipEl.onclick = () => {
      state.sevenDayDetailExpanded = !state.sevenDayDetailExpanded;
      renderSevenDayForecast(f);
    };
  }

  if (dualStage) {
    dualStage.innerHTML = `<div class="d7-columns">${days7.map((day, idx) => {
      const dayWinds = (f.hours48 || []).filter(h => h.dayKey === day.dayKey).map(h => h.forecastWindMph).filter(Number.isFinite);
      const windText = dayWinds.length
        ? `${Math.round(Math.min(...dayWinds))}–${Math.round(Math.max(...dayWinds))} mph`
        : `${Math.round(day.maxWindMph ?? 0)} mph`;
      return `
      <button type="button" class="d7-col${isExpanded && idx === selIdx ? ' is-selected' : ''}" data-d7-idx="${idx}" aria-label="${escapeAttr(day.shortWeekday)}, ${escapeAttr(day.dateLabel)}">
        <strong class="d7-col-day">${escapeAttr(day.shortWeekday)}</strong>
        <small class="d7-col-date">${escapeAttr(day.dateLabel)}</small>
        <span class="d7-col-icon">${renderWeatherIconSvg(day.icon, 44)}</span>
        <span class="d7-col-rain">${remIcon('drop', 12)}${rainPercent(day.rainChance)}</span>
        <span class="d7-col-amt">${Number(day.totalQpfIn ?? 0).toFixed(2)}"</span>
        <span class="d7-col-temps"><b>${fmtTemp(day.highF)}</b><small>${fmtTemp(day.lowF)}</small></span>
        <span class="d7-col-wind">${windText.replace(' mph', '')}<small>mph</small></span>
      </button>`;
    }).join('')}</div>`;
    dualStage.querySelectorAll('[data-d7-idx]').forEach(el => {
      el.onclick = () => {
        const idx = Number(el.dataset.d7Idx);
        if (state.sevenDayDetailExpanded && state.selectedDayIdx === idx) {
          state.sevenDayDetailExpanded = false;
        } else {
          state.selectedDayIdx = idx;
          state.sevenDayDetailExpanded = true;
        }
        renderSevenDayForecast(f);
        renderModelExplanationSection(f);
        renderCompareModelsSection(f);
      };
    });
  }

  const detailEl = document.getElementById('seven-day-selected-detail');
  if (detailEl && d) {
    detailEl.hidden = !isExpanded;
    if (!isExpanded) {
      detailEl.innerHTML = '';
      return;
    }
    const dayDp = Math.min(d.lowF, d.dewPointF ?? d.maxDewPointF ?? d.lowF);
    const dpLabel = getDewPointVerdict(dayDp);
    const windDir = d.hours?.[Math.floor((d.hours?.length || 1) / 2)]?.windCardinal || '';
    const rainLine = d.totalSnowIn > 0
      ? `${rainPercent(d.rainChance)} · ${d.totalQpfIn.toFixed(2)}" · ❄ ${d.totalSnowIn}"`
      : `${rainPercent(d.rainChance)} · ${d.totalQpfIn.toFixed(2)}"`;
    detailEl.innerHTML = `
      <div class="d7-detail-head">
        <div>
          <strong>${d.dayName}, ${d.dateLabel}</strong>
          <span class="d7-detail-cond">· ${d.condition}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button id="d7-hourly-btn" class="d7-hourly-link" type="button">
            <span>Hourly Breakdown</span>
            <span class="bar-chevron" aria-hidden="true">›</span>
          </button>
          <button id="d7-detail-close-btn" class="icon-btn compact-btn" type="button" aria-label="Collapse day details" style="width:28px;height:28px;font-size:13px;">✕</button>
        </div>
      </div>
      <div class="d7-detail-grid">
        <div class="d7-stat-cell">
          <span class="d7-stat-lbl">Feels Like</span>
          <strong class="d7-stat-val">${fmtTemp(d.minFeelsF)} – ${fmtTemp(d.peakFeelsF)}</strong>
        </div>
        <div class="d7-stat-cell">
          <span class="d7-stat-lbl">Rain &amp; Total</span>
          <strong class="d7-stat-val">${rainLine}</strong>
        </div>
        <div class="d7-stat-cell">
          <span class="d7-stat-lbl">Wind &amp; Gusts</span>
          <strong class="d7-stat-val">${d.maxWindMph} mph ${windDir} · G${d.maxGustMph}</strong>
        </div>
        <div class="d7-stat-cell">
          <span class="d7-stat-lbl">Dew Point &amp; RH</span>
          <strong class="d7-stat-val">${fmtTemp(dayDp)} · ${dpLabel} · ${d.avgHumidity}%</strong>
        </div>
        <div class="d7-stat-cell">
          <span class="d7-stat-lbl">Clouds &amp; UV</span>
          <strong class="d7-stat-val">${d.avgCloudCover}% clouds · UV ${d.maxUvIndex}</strong>
        </div>
        <div class="d7-stat-cell">
          <span class="d7-stat-lbl">Sun</span>
          <strong class="d7-stat-val">${formatHHMMTo12h(d.sunrise)} / ${formatHHMMTo12h(d.sunset)}</strong>
        </div>
      </div>
    `;
    document.getElementById('d7-hourly-btn')?.addEventListener('click', () => openDayHourlyModal(d, f));
    document.getElementById('d7-detail-close-btn')?.addEventListener('click', () => {
      state.sevenDayDetailExpanded = false;
      renderSevenDayForecast(f);
    });
  }
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
    const fmtV = Number.isFinite(val) ? (activeMetric.decimals ? val.toFixed(activeMetric.decimals) : Math.round(val))+activeMetric.unit : "—";

    if (readoutWrap) {
      readoutWrap.innerHTML = `
        <div class="hourly-readout-primary">
          <span class="readout-big-val" style="color:${activeMetric.color};">${fmtV}</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#ffffff;">
              ${h.dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${h.hourLabel} (${h.condition})
            </div>
            <div class="readout-meta">
              Blend: ${fmtTemp(h.tempF)} (P10–P90: ${fmtTemp(h.ensemble.p10)}–${fmtTemp(h.ensemble.p90)}) · Shade ${fmtTemp(h.shadeFeelsF)} / ${h.hasDirectSun ? `Sun ${fmtTemp(h.sunFeelsF)}` : `Clouds ${fmtTemp(h.feelsLikeF)}`} · Dew point ${fmtTemp(h.dewPointF)}
            </div>
          </div>
        </div>
        ${hourlyRainInputsHTML(h.rainLedger)}
      `;
    }

    if (stripWrap) {
      stripWrap.querySelectorAll('.hour-tile').forEach((tile, tIdx) => {
        tile.classList.toggle('active', tIdx === state.selectedHourIdx);
      });
    }
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
          <span class="hour-pop-pill">💧 ${rainPercent(h.rainChance)}</span>
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

  const hrs = f.hours48 || [f.current];
  const hIdx = clamp(state.feelsHourIdx || 0, 0, hrs.length - 1);
  const cur = hrs[hIdx] || f.current;
  const tz = f.timeZone || f.location?.timeZone || 'America/New_York';
  const allHours = f.hoursAll?.length >= hrs.length ? f.hoursAll : hrs;
  const dayEnd = allHours.findLastIndex(hour => hour.dayKey === cur.dayKey) + 1;
  const pave = computePavementProfile(allHours, hIdx, f.location.latitude, f.location.longitude, Math.max(hIdx + 1, dayEnd));
  const peak = pavementDayPeak(pave.series, cur.time, tz);
  const peakLabel = peak.isToday ? 'Today peak' : `${peak.dayLabel} peak`;
  const observedRain = hIdx === 0 && hasObservedRain(f);
  const {wet:isRaining, shade, outdoor, compareSun, solarGain} = outdoorExposureReadings(cur,observedRain);
  const isCloudyNoSun = !isRaining && cur.isDay && !compareSun;
  const titleEl = document.getElementById('exposure-section-title');
  if (titleEl) {
    titleEl.textContent = hIdx === 0 ? 'How it feels outside' : 'Outside Forecast';
  }
  const noteEl = document.getElementById('exposure-time-note');
  if (noteEl) {
    noteEl.textContent = hIdx === 0
      ? 'Right now'
      : formatZonedHourStamp(cur, hIdx, tz);
  }

  const sunWindow = nextSunnyBreak(f, cur.time);
  const sunTime = sunWindow ? new Intl.DateTimeFormat('en-US',{
    timeZone:tz, weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'
  }).format(new Date(sunWindow.time)) : null;
  const sceneCtx = { pop: cur.rainChance, rainExpected: isRaining, snowExpected: /snow|flurr/i.test(cur.condition || '') };

  const condition = observedRain ? 'Rain now' : cur.condition;
  const shadeSvg = referenceScene(0, Boolean(cur.isDay), condition || 'Overcast', shade, sceneCtx);
  const sunSvg = referenceScene(1, Boolean(cur.isDay), condition || 'Overcast', outdoor, sceneCtx);
  const petsSvg = dogWalkerScene(Boolean(cur.isDay), condition || 'Overcast', outdoor, sceneCtx);

  const concretePct = clamp(((pave.concreteTempF - 30) / 120) * 100, 8, 100);
  const asphaltPct = clamp(((pave.asphaltTempF - 30) / 120) * 100, 8, 100);

  const items = [
    {
      id: 'shade',
      badgeVal: fmtTemp(shade),
      badgeColor: '#ffffff',
      svg: shadeSvg,
      detailsHtml: `
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <span class="exposure-big-temp">${fmtTemp(shade)}</span>
          <span class="wfo-pill">Air ${fmtTemp(cur.tempF)}</span>
        </div>
        <div style="font-size:14.5px;font-weight:700;color:#ffffff;margin-bottom:4px;">
          ${compareSun ? 'Feels like in shade' : 'Same outdoor feels-like estimate'}
        </div>
        <p style="font-size:13px;color:var(--muted);margin:0;line-height:1.45;">
          ${compareSun ? 'The shade estimate uses the same air temperature, humidity and wind as the sunny estimate.' : 'A separate shade temperature is shown only when the forecast supports a direct-sun comparison.'}
        </p>
      `
    },
    {
      id: 'sun',
      badgeVal: fmtTemp(outdoor),
      badgeColor: isRaining ? '#7ac6ff' : isCloudyNoSun || !cur.isDay ? '#bae6fd' : '#ffd470',
      svg: sunSvg,
      detailsHtml: `
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <span class="exposure-big-temp" style="color:${isRaining ? '#7ac6ff' : isCloudyNoSun || !cur.isDay ? '#bae6fd' : '#ffd470'};">
            ${fmtTemp(outdoor)}
          </span>
          <span class="wfo-pill">${observedRain ? 'Rain now' : isRaining ? `Rain chance ${rainPercent(cur.rainChance)}` : !cur.isDay ? 'Night' : isCloudyNoSun ? (Number.isFinite(cur.cloudCover) ? `${cur.cloudCover}% clouds` : 'Cloud cover unavailable') : `UV ${cur.uvIndex}`}</span>
        </div>
        <div style="font-size:14.5px;font-weight:700;color:#ffffff;margin-bottom:4px;">
          ${
            isRaining
              ? 'Outdoor feels-like during rainy weather'
              : !cur.isDay
              ? 'Outdoor feels-like at night'
              : isCloudyNoSun
              ? 'Outdoor feels-like under clouds'
              : `In sun · ${Math.round(solarGain * (state.useCelsius ? 5/9 : 1))}° warmer than shade`
          }
        </div>
        <p style="font-size:13px;color:var(--muted);margin:0;line-height:1.45;">
          ${
            sunWindow
              ? `Next sunny break forecast for <strong><time datetime="${escapeAttr(sunWindow.time)}">${escapeAttr(sunTime)}</time></strong>.`
              : 'No sunny break in the remaining hourly forecast.'
          }
        </p>
      `
    },
    {
      id: 'pets',
      badgeVal: pave.pawSafety.level === 'danger' ? 'Hot' : pave.pawSafety.level === 'caution' ? 'Warm' : (pave.isWetSurface || observedRain) ? 'Wet' : 'Low risk',
      badgeColor: pave.pawSafety.color,
      svg: petsSvg,
      detailsHtml: `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
          <strong style="font-size:15px;color:${pave.pawSafety.color};">Estimated pavement temperatures</strong>
        </div>
        <div class="pavement-compare-bars">
          <div class="pave-row">
            <div class="pave-row-head">
              <span>Light concrete sidewalk</span>
              <strong>${fmtTemp(pave.concreteTempF)} (${peakLabel} ${fmtTemp(peak.concreteF)})</strong>
            </div>
            <div class="pave-progress-bg">
              <div class="pave-progress-fill" style="width:${concretePct}%;background:#7ac6ff;"></div>
            </div>
          </div>
          <div class="pave-row">
            <div class="pave-row-head">
              <span>Dark asphalt street</span>
              <strong style="color:${pave.asphaltTempF >= 135 ? '#ff6b6b' : pave.asphaltTempF >= 120 ? '#ffd166' : '#5ce0a0'};">
                ${fmtTemp(pave.asphaltTempF)} (${peakLabel} ${fmtTemp(peak.asphaltF)})
              </strong>
            </div>
            <div class="pave-progress-bg">
              <div class="pave-progress-fill" style="width:${asphaltPct}%;background:${pave.pawSafety.color};"></div>
            </div>
          </div>
        </div>
        <p class="pavement-peak-note">${peak.hours ? `Peak for ${peak.dateLabel} · ${peak.hours} available forecast hours` : 'Peak estimate unavailable for the selected day.'}</p>
        <p style="font-size:12.5px;color:var(--muted);margin:8px 0 0;line-height:1.45;">
          ${pave.pawSafety.level === 'safe' && observedRain ? 'Rain can leave pavement wet. These estimates describe the surfaces your pet walks on.' : pave.pawSafety.advice}
        </p>
      `
    }
  ];

  const contextEl=document.getElementById('exposure-weather-context');
  if(contextEl)contextEl.textContent=`Air ${fmtTemp(cur.tempF)} · ${condition} · Wind ${Number.isFinite(cur.windMph)?Math.round(cur.windMph)+' mph':'unavailable'}`;
  const titles={shade:'Shade',sun:isRaining?'Rain':!cur.isDay?'Night':isCloudyNoSun?'Day':'Sun',pets:'For Pets'};
  container.innerHTML=items.map(item=>{
    const isOpen=state.expandedExposureIds.has(item.id),pets=item.id==='pets';
    const value=item.badgeVal;
    const humanFeels=item.id==='shade'?shade:outdoor;
    const snowExpected=/snow|flurr|blizzard/i.test(cur.condition||'');
    const subtitle=pets?snowExpected?'Protect paws from cold':'Paw heat safety':Number.isFinite(humanFeels)?getFeelsVerdict(humanFeels,isRaining).label:'Estimate unavailable';
    const caption=pets?'Pavement conditions':item.id==='shade'?(compareSun?'Feels like in shade':'Same outdoor estimate'):!cur.isDay&&!isRaining?'Feels like at night':compareSun?'Feels like in sun':'Feels like outdoors';
    return `<article class="glass exposure-person-card" data-exp-card="${item.id}"><button type="button" class="exposure-person-button" data-exp-toggle="${item.id}" aria-expanded="${isOpen}" aria-controls="exposure-detail-${item.id}"><span class="person-card-title">${titles[item.id]}</span><span class="person-card-scene">${item.svg}</span><span class="person-card-reading"><strong${pets?' class="pet-surface-status"':''}>${value}</strong><span>${caption}</span></span><span class="person-card-description"${pets?` style="color:${pave.pawSafety.color}"`:''}>${subtitle}</span><small class="person-card-detail-hint">${isOpen?'Close details':'Details'} ›</small></button></article>`;
  }).join('')+items.filter(item=>state.expandedExposureIds.has(item.id)).map(item=>`<section class="exposure-expanded-body" id="exposure-detail-${item.id}" data-exp-id="${item.id}" aria-label="${titles[item.id]} details">${item.detailsHtml}</section>`).join('');

  container.querySelectorAll('[data-exp-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.expToggle;
      if (state.expandedExposureIds.has(id)) {
        state.expandedExposureIds.delete(id);
      } else {
        state.expandedExposureIds.add(id);
      }
      renderOutdoorExposureCards(f);
    });
  });
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
  if (rainCard) {
    rainCard.innerHTML = `<h3>Peak hourly rain chance · ${escapeAttr(wettest.hourLabel)}</h3>${hourlyRainInputsHTML(wettest.rainLedger)}`;
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
              <td>${Number.isFinite(h.precipIn) ? h.precipIn.toFixed(3)+'″' : '—'}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;
  }
}

function setCompareExpanded(expanded, { scroll = false } = {}) {
  state.compareExpanded = Boolean(expanded);
  const body = document.getElementById('compare-expand-body');
  const toggleBtn = document.getElementById('compare-toggle-btn');
  if (body) body.hidden = !state.compareExpanded;
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(state.compareExpanded));
  if (state.compareExpanded && state.forecast) {
    renderCompareModelsSection(state.forecast);
  }
  if (scroll) {
    document.getElementById('wn-compare-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

let betaComparison;
async function renderCompareModelsSection(f) {
  if (!state.compareExpanded || !f) return;
  const host = document.getElementById('beta-model-comparison');
  if (!host) return;
  betaComparison ??= import('../../wn-blend.js?v=published-model-points-v1')
    .then(({mountModelComparison}) => mountModelComparison(host))
    .catch(() => {
      betaComparison = null;
      host.textContent = 'Comparison is temporarily unavailable. Close and reopen Compare to retry.';
      return null;
    });
  const comparison = await betaComparison;
  if (state.compareExpanded && state.forecast === f) comparison?.update(f.canonical);
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
      <div class="heatmap-day-label" style="font-size:10px;color:var(--faint);">Hour</div>
      ${Array.from({ length: 24 }, (_, h) => {
        const lbl = h === 0 ? '12a' : h === 6 ? '6a' : h === 12 ? '12p' : h === 18 ? '6p' : '';
        return `<div style="font-size:9.5px;color:var(--faint);text-align:center;">${lbl}</div>`;
      }).join('')}
    </div>
  `;

  const dayRows = days7
    .map((d) => {
      const hourMap = new Map();
      d.hours.forEach((h) => hourMap.set(h.hourOfDay ?? h.dateObj.getHours(), h));

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
          <div class="heatmap-day-label">${d.shortWeekday}</div>
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
    const uvVal = Number(today.maxUvIndex ?? cur.uvIndex ?? 0);
    const uvPct = clamp((uvVal / 11) * 100, 4, 100);
    const uvLevel = uvVal >= 8 ? 'Very High' : uvVal >= 6 ? 'High' : uvVal >= 3 ? 'Moderate' : 'Low';
    const humPct = clamp(cur.humidity ?? 50, 4, 100);
    const pressInHg = Number(cur.pressureInHg) || 29.92;
    const pressPct = clamp(((pressInHg - 29.2) / 1.4) * 100, 8, 92);
    const visMi = Number(cur.visibilityMi) || 10;
    const visPct = clamp((visMi / 10) * 100, 10, 100);
    const hrNow = cur.dateObj.getHours() + cur.dateObj.getMinutes() / 60;
    const sunProgress = clamp(((hrNow - 6.75) / 10.5) * 100, 4, 96);

    const fmtClock12 = (hhmm) => {
      if (!hhmm || !String(hhmm).includes(':')) return hhmm || '—';
      const [hRaw, mRaw] = String(hhmm).split(':');
      const h = parseInt(hRaw, 10);
      if (!Number.isFinite(h)) return hhmm;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${mRaw.slice(0, 2)} ${ampm}`;
    };
    const riseStr = fmtClock12(today.sunrise);
    const setStr = fmtClock12(today.sunset);

    const tiles = [
      {
        id: 'uvIndex',
        label: '☀ UV Index',
        val: `${uvVal}`,
        badge: uvLevel,
        visual: `<div class="apple-uv-bar"><span class="apple-bar-dot" style="left:${uvPct.toFixed(0)}%;"></span></div>`,
        sub: uvVal >= 6 ? 'Sunscreen & sunglasses advised' : 'Low sunburn risk today'
      },
      {
        id: 'feels',
        label: '🌡 Feels Like',
        val: fmtTemp(cur.feelsLikeF),
        badge: `Air ${fmtTemp(cur.tempF)}`,
        visual: `<div class="apple-meter-track"><div class="apple-meter-fill" style="width:${clamp(((cur.feelsLikeF - 15) / 85) * 100, 8, 100).toFixed(0)}%;background:linear-gradient(90deg,#38bdf8,#f59e0b);"></div></div>`,
        sub: outdoorExposureReadings(cur, hasObservedRain(f)).compareSun ? `Shade ${fmtTemp(cur.shadeFeelsF)} · Sun ${fmtTemp(cur.feelsLikeF)}` : 'Outdoor feels-like estimate'
      },
      {
        id: 'humidity',
        label: '💧 Humidity',
        val: `${cur.humidity}%`,
        badge: getDewPointVerdict(cur.dewPointF),
        visual: `<div class="apple-meter-track"><div class="apple-meter-fill" style="width:${humPct.toFixed(0)}%;background:linear-gradient(90deg,#38bdf8,#818cf8);"></div></div>`,
        sub: `Dew point ${fmtTemp(cur.dewPointF)}`
      },
      {
        id: 'wind',
        label: '💨 Wind',
        val: `${cur.windMph} mph`,
        badge: `${cur.windCardinal}`,
        visual: `<div class="apple-wind-row"><div class="apple-mini-compass">${renderCompassSvg(cur.windDirDeg)}</div><span class="apple-wind-detail">Gusts up to <strong>${cur.windGustMph} mph</strong></span></div>`,
        sub: cur.windMph >= 15 ? 'Noticeable breeze outdoors' : 'Light & gentle breeze'
      },
      {
        id: 'temp',
        label: '🌅 Sunset',
        val: setStr,
        badge: `Rise ${riseStr}`,
        visual: `<div class="sun-arc-bar" style="margin:8px 0 4px;"><div class="sun-arc-fill" style="width:${sunProgress.toFixed(0)}%;"></div><span class="sun-arc-dot" style="left:${sunProgress.toFixed(0)}%;"></span></div>`,
        sub: cur.isDay ? `Daylight until ${setStr}` : `Sunrise at ${riseStr}`
      },
      {
        id: 'rainfall',
        label: '🌧 Precip',
        val: `${today.totalQpfIn}"`,
        badge: `${rainPercent(today.rainChance)} chance`,
        visual: `<div class="apple-meter-track"><div class="apple-meter-fill" style="width:${clamp(today.rainChance, 6, 100)}%;background:linear-gradient(90deg,#0ea5e9,#3b82f6);"></div></div>`,
        sub: cur.precipIn > 0 ? `Currently ${cur.precipIn}"/hr` : 'Expected today total'
      },
      {
        id: 'pressure',
        label: '⏲ Pressure',
        val: `${cur.pressureInHg}`,
        badge: 'inHg',
        visual: `<div class="apple-pressure-bar"><span class="apple-bar-dot" style="left:${pressPct.toFixed(0)}%;"></span></div>`,
        sub: pressInHg >= 30.05 ? 'High & steady pressure' : pressInHg <= 29.8 ? 'Low pressure system nearby' : 'Steady surface pressure'
      },
      {
        id: 'cloudCover',
        label: '👁 Visibility',
        val: `${visMi} mi`,
        badge: `${cur.cloudCover}% clouds`,
        visual: `<div class="apple-meter-track"><div class="apple-meter-fill" style="width:${visPct.toFixed(0)}%;background:linear-gradient(90deg,#5eead4,#38bdf8);"></div></div>`,
        sub: visMi >= 8 ? 'Clear viewing distance' : 'Reduced haze or mist'
      }
    ];

    metricsGrid.innerHTML = tiles
      .map(
        (t) => `
        <article class="glass apple-tile" data-jump-metric="${t.id}" role="button" tabindex="0">
          <div class="apple-tile-top">
            <span class="apple-tile-lbl">${t.label}</span>
            <span class="apple-tile-badge">${t.badge}</span>
          </div>
          <div class="apple-tile-val">${t.val}</div>
          ${t.visual}
          <div class="apple-tile-sub">${t.sub}</div>
        </article>
      `
      )
      .join('');

    metricsGrid.querySelectorAll('.apple-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        const metricId = tile.dataset.jumpMetric || 'temp';
        if (metricId === 'dewPoint') {
          openDewPointFeelMeterModal(f);
          return;
        }
        if (metricId === 'wind') {
          openWindCompassModal(f);
          return;
        }
        state.selectedMetricId = metricId;
        open48hExplorerModal(f);
      });
    });
  }
}

function buildCarWashSummaryData(f) {
  const days5 = f.days.slice(0, 5);
  const first3Low = days5.slice(0, 3).every((d) => d.rainChance <= 25);
  const isRainingNow = (f.current.rainChance || 0) >= 50 || (f.current.precipIn || 0) >= 0.02;
  const canWash = !isRainingNow && first3Low;
  const verdictClass = canWash ? 'wash' : 'wait';
  const verdictText = canWash ? 'YES' : 'WAIT!';
  const wetBlocker = days5.slice(0, 3).find((d) => d.rainChance > 25);
  const reason = isRainingNow
    ? 'Rain is nearby or falling right now.'
    : canWash
    ? 'Three dry days ahead (low rain chance).'
    : wetBlocker
    ? `${wetBlocker.shortWeekday} has a ${wetBlocker.rainChance}% rain chance within 3 days.`
    : 'Rain possible within the next 3 days.';
  return { days5, canWash, verdictClass, verdictText, reason };
}

function renderCarWashTeaser(f) {
  const pill = document.getElementById('carwash-teaser-pill');
  const sub = document.getElementById('carwash-teaser-sub');
  if (!f) return;
  const cw = buildCarWashSummaryData(f);
  if (pill) {
    pill.textContent = cw.canWash ? '✓ YES' : 'WAIT!';
    pill.className = `cw-pill-badge ${cw.verdictClass}`;
  }
  if (sub) sub.textContent = cw.reason;
}

function renderMainStyleCarWashHtml(f) {
  const { days5, canWash, verdictClass, verdictText, reason } = buildCarWashSummaryData(f);
  const cur = f.current;
  const today = days5[0] || f.days[0];
  const lowRainDays = days5.slice(0, 3).filter((d) => d.rainChance <= 25).length;
  const washCandidates = days5.filter((d) => d.rainChance <= 25);
  const bestDay = washCandidates[0] || f.carWash?.bestDay;
  const bestTitle = canWash
    ? 'Today · Great 3-Day Dry Stretch'
    : bestDay
    ? `Try ${bestDay.dayName || bestDay.shortWeekday}`
    : 'Wait for a drier 3-day window';

  const dp = Math.round(cur.dewPointF ?? 50);
  const dpWord = dp >= 65 ? 'HUMID' : dp >= 52 ? 'COMFY' : 'DRY AIR';

  const cardsHtml = days5
    .map((d, idx) => {
      const stretch = f.days.slice(idx, idx + 3);
      const dayCanWash = stretch.length >= 2 && stretch.every((s) => s.rainChance <= 25);
      const dayState = dayCanWash ? 'wash' : 'wait';
      const dayVerdict = dayCanWash ? 'YES' : 'WAIT!';
      return `
        <article class="car-wash-day" data-car-wash-state="${dayState}">
          <strong>${idx === 0 ? 'Today' : d.shortWeekday}</strong>
          <small>${d.dateLabel}</small>
          ${renderWeatherIconSvg(d.icon, 42)}
          <span class="car-wash-temps">${fmtTemp(d.lowF)} <i>|</i> ${fmtTemp(d.highF)}</span>
          <span class="car-wash-chance">💧 ${rainPercent(d.rainChance)}</span>
          <b class="car-wash-day-verdict">${dayVerdict}</b>
        </article>
      `;
    })
    .join('');

  return `
    <div class="car-wash-forecast" data-verdict="${verdictClass}">
      <header class="car-wash-header">
        <span class="car-wash-logo" aria-hidden="true">💧🚙</span>
        <span>
          <h2>Car Wash Forecast</h2>
          <p>Plan for three days of low rain risk</p>
        </span>
        <em>Clean rides.<br>Brighter days.</em>
      </header>
      <div class="car-wash-hero">
        <div class="car-wash-answer">
          <h3>Can I Wash<br>My Car Today?</h3>
          <strong class="car-wash-verdict ${verdictClass}" role="status">${canWash ? '✓ ' : ''}${verdictText}</strong>
          <p>${reason}</p>
        </div>
        <div class="car-wash-checks">
          <span class="car-wash-fact ${today.rainChance <= 25 ? 'good' : ''}">
            <i aria-hidden="true">💧</i>
            <span><b>${rainPercent(today.rainChance)}</b><small>Rain chance today</small></span>
          </span>
          <span class="car-wash-fact ${lowRainDays === 3 ? 'good' : ''}">
            <i aria-hidden="true">☀</i>
            <span><b>${lowRainDays} of 3 days</b><small>Rain chance ≤25%</small></span>
          </span>
          <span class="car-wash-fact">
            <i aria-hidden="true">≋</i>
            <span><b>${cur.windMph}–${today.maxWindMph} mph</b><small>Wind</small></span>
          </span>
          <span class="car-wash-fact">
            <i aria-hidden="true">♨</i>
            <span><b>${fmtTemp(today.lowF)}–${fmtTemp(today.highF)}</b><small>Low / high</small></span>
          </span>
          <span class="car-wash-fact">
            <i aria-hidden="true">💦</i>
            <span><b>${dp}° · ${dpWord}</b><small>Air moisture feel</small></span>
          </span>
        </div>
      </div>
      <div class="car-wash-photo">
        <img class="car-wash-art" src="/weather-fusion/car-wash-corvette-hood.webp" alt="Cherry-red Corvette C8 on driveway" loading="lazy" decoding="async" />
      </div>
      <div class="car-wash-days-wrap">
        <h3>Next 5 Days</h3>
        <div class="car-wash-days">${cardsHtml}</div>
      </div>
      <div class="car-wash-window">
        <span class="car-wash-spark" aria-hidden="true">✦</span>
        <span>
          <small>Best Washing Window</small>
          <strong>${bestTitle}</strong>
          <em>${reason}</em>
        </span>
        <span class="car-wash-tip">☀<small>Avoid hot<br>midday sun</small></span>
        <span class="car-wash-tip">≋<small>Light wind<br>helps drying</small></span>
        <span class="car-wash-tip">🚙<small>Enjoy that<br>clean shine</small></span>
      </div>
      <div class="car-wash-footer">WEATHER NOURIE · CLEAN RIDES, BRIGHTER DAYS</div>
    </div>
  `;
}

function openCarWashModal(f) {
  openModal(`🚗 Car Wash Forecast · ${f.location.name}`, renderMainStyleCarWashHtml(f));
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
          document.getElementById('search-cluster')?.classList.remove('open');
          if (picked) {
            ++gpsRequest;
            locateBtn?.removeAttribute('aria-busy');
            void loadLocationForecast({...picked, source:'search', explicitChoice:true});
          }
        });
      });
    }, 180);
  });

  const showSearchEmptyHelper = () => {
    if (!searchInput?.value.trim() && dropdown) {
      dropdown.hidden = false;
      dropdown.innerHTML = `
        <button id="search-use-gps-btn" class="search-result-item" type="button">
          <span><strong>⌖ Use my current location</strong></span>
          <span style="font-size:11.5px;color:var(--blue);">Auto GPS</span>
        </button>
        <div class="search-helper-row">Type any US street address, ZIP code, or city above</div>
      `;
      document.getElementById('search-use-gps-btn')?.addEventListener('click', () => {
        dropdown.hidden = true;
        locateBtn?.click();
      });
    }
  };

  searchInput?.addEventListener('focus', showSearchEmptyHelper);

  document.addEventListener('click', (e) => {
    if (dropdown && !e.target.closest('.search-box-wrap')) {
      dropdown.hidden = true;
    }
  });

  locateBtn?.addEventListener('click', () => requestDeviceLocation({manual:true}));

  unitBtn?.addEventListener('click', () => {
    state.useCelsius = !state.useCelsius;
    unitBtn.textContent = state.useCelsius ? '°C' : '°F';
    renderAll();
  });

  refreshBtn?.addEventListener('click', () => {
    if (state.location) {
      loadLocationForecast(state.location, { forceRefresh: true });
    } else {
      locateBtn?.click();
    }
  });

  skySelect?.addEventListener('change', () => {
    state.skyOverride = skySelect.value;
    if (state.forecast) updateSkyAtmosphere(state.forecast);
  });

  // Mobile Tools Drawer Toggle
  const toolsBtn = document.getElementById('tools-drawer-btn');
  const toolsStrip = document.getElementById('tools-strip');
  toolsBtn?.addEventListener('click', () => {
    const isOpen = toolsStrip?.classList.toggle('open');
    toolsBtn.setAttribute('aria-expanded', String(Boolean(isOpen)));
  });

  // Search Toggle, Hero Live Location Refresh & Location Needed Actions
  const searchCluster = document.getElementById('search-cluster');
  const mobileSearchBtn = document.getElementById('mobile-search-toggle');
  const cityPickerBtn = document.getElementById('city-picker-btn');
  const openSearchBar = () => {
    searchCluster?.classList.add('open');
    showSearchEmptyHelper();
    searchInput?.focus();
  };
  mobileSearchBtn?.addEventListener('click', () => {
    const open = searchCluster?.classList.toggle('open');
    if (open) {
      showSearchEmptyHelper();
      searchInput?.focus();
    }
  });
  cityPickerBtn?.addEventListener('click', () => {
    openSearchBar();
  });
  document.getElementById('location-retry-btn')?.addEventListener('click', () => {
    locateBtn?.click();
  });
  document.getElementById('location-search-btn')?.addEventListener('click', openSearchBar);

  // Compare Weather Forecasts — collapsed by default, opens only when clicked
  document.getElementById('compare-toggle-btn')?.addEventListener('click', () => {
    setCompareExpanded(!state.compareExpanded);
  });

  // Weather Take Banner Click -> Scroll smoothly to Nourie Weather Take card or open full modal
  const takeBanner = document.getElementById('weather-take-banner');
  takeBanner?.addEventListener('click', () => {
    if (state.forecast) openWeatherTakeModal(state.forecast);
  });

  // Weather Meter Click -> Plain-English score breakdown modal
  document.getElementById('qs-weather-meter-btn')?.addEventListener('click', () => {
    if (state.forecast) openWeatherMeterModal(state.forecast);
  });

  // Air Quality Badge Click -> Expand / Collapse Air Quality details
  const toggleAqiDrawer = () => {
    const drawer = document.getElementById('aqi-expand-drawer');
    const aqiBtn = document.getElementById('qs-aqi-btn');
    if (!drawer) return;
    state.aqiExpanded = !state.aqiExpanded;
    drawer.hidden = !state.aqiExpanded;
    aqiBtn?.setAttribute('aria-expanded', String(state.aqiExpanded));
    if (state.aqiExpanded) {
      drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };
  document.getElementById('qs-aqi-btn')?.addEventListener('click', toggleAqiDrawer);
  document.getElementById('aqi-close-btn')?.addEventListener('click', () => {
    state.aqiExpanded = false;
    const drawer = document.getElementById('aqi-expand-drawer');
    if (drawer) drawer.hidden = true;
    document.getElementById('qs-aqi-btn')?.setAttribute('aria-expanded', 'false');
  });

  // Dew Point Feel Meter Card -> Open Main-Site Dew Point Feel Meter Modal
  document.getElementById('dewpoint-feel-card-btn')?.addEventListener('click', () => {
    if (state.forecast) openDewPointFeelMeterModal(state.forecast);
  });

  // Wind Compass Card -> Open Interactive Animated Wind Compass Modal
  document.getElementById('wind-compass-card-btn')?.addEventListener('click', () => {
    if (state.forecast) openWindCompassModal(state.forecast);
  });

  // Legacy How It Feels Trio Card (if present) -> Open What to Wear & Comfort Modal
  document.getElementById('how-feels-card-btn')?.addEventListener('click', () => {
    if (state.forecast) openWardrobeModal(state.forecast);
  });

  const audioBtn = document.getElementById('sky-audio-btn');
  audioBtn?.addEventListener('click', () => toggleProceduralSkyAudio(audioBtn));
}

function initBottomNavDock() {
  const items = Array.from(document.querySelectorAll('.bnav-item'));
  if (!items.length) return;
  items.forEach((item) => {
    item.addEventListener('click', (e) => {
      items.forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      if (item.dataset.bnav === 'compare') {
        e.preventDefault();
        setCompareExpanded(true, { scroll: true });
      }
    });
  });
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

  const mapPanel=document.getElementById('map-panel');
  const mapObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&state.forecast&&!state.mapController.map)void state.mapController.init(state.forecast);},{rootMargin:'80px'});
  if(mapPanel)mapObserver.observe(mapPanel);

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

  const closeTools = () => document.getElementById('tools-strip')?.classList.remove('open');

  document.getElementById('car-wash-launcher-btn')?.addEventListener('click', () => { if (state.forecast) openCarWashModal(state.forecast); });
  document.getElementById('more-carwash-btn')?.addEventListener('click', () => { if (state.forecast) openCarWashModal(state.forecast); });
  document.getElementById('open-carwash-menu')?.addEventListener('click', () => { closeTools(); if (state.forecast) openCarWashModal(state.forecast); });

  document.getElementById('open-rankings-modal')?.addEventListener('click', () => { closeTools(); if (state.forecast) openModelRankingsModal(state.forecast); });
  document.getElementById('compare-rankings-cta')?.addEventListener('click', () => { if (state.forecast) openModelRankingsModal(state.forecast); });
  document.getElementById('more-rankings-btn')?.addEventListener('click', () => { if (state.forecast) openModelRankingsModal(state.forecast); });

  document.getElementById('open-wardrobe-modal')?.addEventListener('click', () => { closeTools(); if (state.forecast) openWardrobeModal(state.forecast); });
  document.getElementById('more-wardrobe-btn')?.addEventListener('click', () => { if (state.forecast) openWardrobeModal(state.forecast); });

  document.getElementById('open-behind-modal')?.addEventListener('click', () => { closeTools(); if (state.forecast) openBehindForecastModal(state.forecast); });
  document.getElementById('more-behind-btn')?.addEventListener('click', () => { if (state.forecast) openBehindForecastModal(state.forecast); });

  document.getElementById('open-48h-explorer-btn')?.addEventListener('click', () => { if (state.forecast) open48hExplorerModal(state.forecast); });

  document.getElementById('open-snow-modal')?.addEventListener('click', () => {
    closeTools();
    const f = state.forecast;
    if (!f) return;
    const total10dSnow = f.days.reduce((s, d) => s + (d.totalSnowIn || 0), 0).toFixed(1);
    openModal(
      `❄️ Snow Outlook · ${f.location.name}`,
      `
        <div style="font-size:20px;font-weight:800;margin-bottom:8px;">
          ${Number(total10dSnow) > 0 ? `${total10dSnow}" snow possible over the next 10 days` : 'No snow expected in the next 10 days'}
        </div>
        <table class="math-table">
          <thead><tr><th>Day</th><th>High / Low</th><th>Rain Chance</th><th>Snow</th><th>Outlook Confidence</th></tr></thead>
          <tbody>
            ${f.days.slice(0, 7).map((d) => `
              <tr>
                <td><strong>${d.shortWeekday} · ${d.dateLabel}</strong></td>
                <td>${fmtTemp(d.highF)} / ${fmtTemp(d.lowF)}</td>
                <td>${rainPercent(d.rainChance)}</td>
                <td><strong>${d.totalSnowIn}"</strong></td>
                <td style="color:${d.confidence.color};">${d.confidence.level}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
    );
  });
}

function buildWardrobeAdvice(feelsF, cur) {
  const isRain = (cur.rainChance || 0) >= 50 || (cur.precipIn || 0) >= 0.02;
  const windy = (cur.windMph || 0) >= 16;
  if (feelsF < 32) {
    return {
      title: 'Bundle Up Warm',
      items: ['Heavy winter coat', 'Warm sweater + long pants', 'Gloves, scarf & warm hat', isRain ? 'Waterproof boots' : 'Warm closed shoes']
    };
  }
  if (feelsF < 48) {
    return {
      title: 'Chilly Weather Layers',
      items: [isRain ? 'Warm rain jacket' : 'Medium jacket or fleece', 'Long-sleeve shirt', 'Jeans or long pants', windy ? 'Windbreaker outer layer' : 'Closed-toe shoes']
    };
  }
  if (feelsF < 64) {
    return {
      title: isRain ? 'Light Jacket & Umbrella' : 'Light Jacket Weather',
      items: [isRain ? 'Light rain jacket or umbrella' : 'Light jacket, hoodie, or sweater', 'T-shirt underneath', 'Long pants or jeans', 'Comfortable sneakers']
    };
  }
  if (feelsF < 78) {
    return {
      title: isRain ? 'Mild with Rain Gear' : 'Light & Comfortable',
      items: ['Short sleeves or light top', isRain ? 'Keep an umbrella nearby' : 'Light sweater if out late', 'Shorts or light pants', 'Sunglasses for sunny breaks']
    };
  }
  return {
    title: 'Keep Cool & Light',
    items: ['Light, breathable shirt', 'Shorts or light clothing', 'Sunglasses & sunscreen', 'Bring water outdoors']
  };
}

function openWeatherMeterModal(f) {
  const cur = f.current;
  const today = f.days[0];
  const aqi = f.airQuality?.currentAqi ?? 38;
  const meter = computeWeatherMeterScore(cur, today, aqi, f.canonical);
  const feels = cur.feelsLikeF ?? cur.tempF ?? 65;

  const tempComfort = feels >= 60 && feels <= 78 ? 'Very comfortable' : feels >= 45 && feels < 60 ? 'Crisp / Jacket needed' : feels > 78 ? 'Warm' : 'Chilly';
  const skyNote = meter.isStorm
    ? 'Stormy skies'
    : meter.isActiveWet
    ? cur.condition || 'Rainy skies'
    : meter.isOvercast
    ? `Overcast (${Math.round(meter.clouds)}% clouds)`
    : meter.isMostlyCloudy
    ? `Mostly cloudy (${Math.round(meter.clouds)}% clouds)`
    : meter.clouds >= 40
    ? `Partly cloudy (${Math.round(meter.clouds)}% clouds)`
    : 'Clear / Sunny skies';
  const airComfort = (cur.dewPointF ?? 50) <= 60 ? 'Fresh, not sticky' : (cur.dewPointF ?? 50) <= 66 ? 'A little humid' : 'Muggy / Sticky';
  const rainNote = meter.isStorm
    ? 'Thunderstorms nearby'
    : meter.isActiveWet
    ? 'Active rain / showers'
    : meter.radarNearby
    ? 'Rain around nearby'
    : today.rainChance <= 20
    ? 'Mostly dry today'
    : today.rainChance <= 50
    ? 'Chance of a passing shower'
    : 'Likely wet at times';
  const windNote = cur.windMph <= 10 ? 'Light breeze' : cur.windMph <= 18 ? 'Breezy outside' : 'Windy';
  const aqiNote = aqi <= 50 ? 'Clean air (Good)' : aqi <= 100 ? 'Acceptable (Moderate)' : 'Hazy / Sensitive';

  openModal(
    `What is the Weather Meter?`,
    `
      <div style="text-align:center;padding:8px 0 14px;">
        <div style="width:155px;margin:0 auto;">${renderWeatherMeterArcSvg(meter.score)}</div>
        <div style="font-size:20px;font-weight:800;color:#ffffff;margin-top:4px;">${meter.score} / 100 · ${meter.label}</div>
        <p style="font-size:13.5px;color:var(--muted);margin:6px auto 0;max-width:440px;line-height:1.5;">
          The <strong>Weather Meter</strong> gives you one quick 0–100 score showing how nice it feels to be outside right now. Higher scores mean comfortable temperatures, brighter skies, fresh air, low rain risk, and gentle wind.
        </p>
      </div>
      <div style="display:grid;gap:8px;">
        <div class="take-modal-row"><span>🌡 Temperature Feel (${fmtTemp(feels)})</span><strong>${tempComfort}</strong></div>
        <div class="take-modal-row"><span>☁ Sky &amp; Clouds</span><strong>${skyNote}</strong></div>
        <div class="take-modal-row"><span>💧 Air Freshness</span><strong>${airComfort}</strong></div>
        <div class="take-modal-row"><span>☔ Rain Risk (${rainPercent(today.rainChance)})</span><strong>${rainNote}</strong></div>
        <div class="take-modal-row"><span>💨 Wind (${cur.windMph} mph)</span><strong>${windNote}</strong></div>
        <div class="take-modal-row"><span>🍃 Air Quality (${aqi} AQI)</span><strong>${aqiNote}</strong></div>
      </div>
    `
  );
}

function openWeatherTakeModal(f) {
  const canonical = f.canonical;
  const takeSource = withAlerts(canonical, f.alerts);
  const b = state.liveBriefing || canonical;
  const risks = canonical ? activeRiskOutlooks(canonical, Date.now()) : [];
  const card = canonical ? danCard(b, takeSource, Date.now()) : null;
  const overview = canonical ? danOverview(b, takeSource, Date.now()) : null;
  const takeDisplay = canonical ? danTakeDisplay(b, takeSource, Date.now()) : '';

  const rawTake = cleanTakeJargon(
    takeDisplay && !/unavailable right now/i.test(takeDisplay)
      ? takeDisplay
      : overview?.text && !/unavailable right now/i.test(overview.text)
      ? overview.text
      : card?.text || f.briefing.summary
  );

  const paragraphs = String(rawTake || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  openModal(
    `Nourie Weather Take · ${f.location.name}`,
    `
      ${
        risks.length
          ? `<div style="display:grid;gap:7px;margin-bottom:12px;">
              ${risks
                .map(
                  (r, i) => `<button type="button" class="take-hazard-chip ${/Moderate|Enhanced|High/i.test(r.level) ? 'severe' : ''}" data-modal-risk-idx="${i}">
                    <span>⚠ ${r.title || `${r.level} risk`}</span><span>View Map ›</span>
                  </button>`
                )
                .join('')}
            </div>`
          : ''
      }
      <div class="take-layman-box" style="margin:0;white-space:normal;">
        ${paragraphs.map((p, idx) => `<p style="margin:${idx === 0 ? '0' : '10px 0 0'};line-height:1.58;font-size:14.5px;color:#eaf2ff;">${p.replace(/\n/g, '<br/>')}</p>`).join('')}
      </div>
    `
  );

  document.querySelectorAll('[data-modal-risk-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = risks[Number(btn.dataset.modalRiskIdx)];
      if (r) openRiskOutlookModal(r, f);
    });
  });
}

function openWardrobeModal(f) {
  const hrs = f.hours48 || [f.current];
  const tz = f.timeZone || f.location?.timeZone || 'America/New_York';

  const drawWardrobeContent = () => {
    const idx = clamp(state.feelsHourIdx || 0, 0, hrs.length - 1);
    const cur = hrs[idx] || f.current;
    const isRaining = (cur.rainChance || 0) >= 50 || (cur.precipIn || 0) >= 0.02;
    const sceneCtx = { pop: cur.rainChance, rainExpected: isRaining, snowExpected: /snow|flurr/i.test(cur.condition || '') };
    const cartoonHtml = referenceScene(1, Boolean(cur.isDay), cur.condition || 'Clear', cur.feelsLikeF ?? cur.tempF, sceneCtx);
    const advice = buildWardrobeAdvice(cur.feelsLikeF ?? cur.tempF, cur);
    const dpDesc = getDewPointVerdict(cur.dewPointF ?? 50);
    const presets = getFeelsTimePresets(f);

    const bodyEl = document.getElementById('modal-body');
    if (!bodyEl) return;
    bodyEl.innerHTML = `
      <div style="margin-bottom:14px;padding:11px 13px;border-radius:14px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
          <strong style="font-size:13px;color:#7dd3fc;">Select Time to Check What to Wear</strong>
          <span class="wfo-pill">${formatZonedHourStamp(cur, idx, tz)} · ${cur.condition}</span>
        </div>
        <div class="pill-scroll-row" style="margin-bottom:8px;">
          ${presets
            .map(
              (p) => `<button class="mode-pill ${p.idx === idx ? 'active' : ''}" data-mw-idx="${p.idx}" type="button">${p.label}</button>`
            )
            .join('')}
        </div>
        <div class="feels-slider-row">
          <span class="feels-slider-edge">Now</span>
          <input id="modal-feels-slider" class="modal-feels-slider" type="range" min="0" max="${Math.max(0, hrs.length - 1)}" value="${idx}" aria-label="Change time for What to Wear" />
          <span class="feels-slider-edge">+47h</span>
        </div>
      </div>

      <div class="wardrobe-modal-hero">
        <div class="wardrobe-cartoon-box">${cartoonHtml}</div>
        <div class="wardrobe-hero-info">
          <div class="wardrobe-badge">${advice.title}</div>
          <div style="font-size:28px;font-weight:800;line-height:1.1;margin:6px 0;">Feels Like ${fmtTemp(cur.feelsLikeF)}</div>
          <div style="font-size:13.5px;color:var(--muted);margin-bottom:10px;">
            Air ${fmtTemp(cur.tempF)}${outdoorExposureReadings(cur, idx === 0 && hasObservedRain(f)).compareSun ? ` · Shade ${fmtTemp(cur.shadeFeelsF)}` : ''} · Wind ${cur.windMph} mph · Rain ${rainPercent(cur.rainChance)} · Air feels <strong>${dpDesc.toLowerCase()}</strong>
          </div>
          <ul class="wardrobe-list">
            ${advice.items.map((item) => `<li>✓ ${item}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;

    bodyEl.querySelectorAll('[data-mw-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.feelsHourIdx = Number(btn.dataset.mwIdx) || 0;
        drawWardrobeContent();
        renderFeelsTimeAndTrio(f);
        renderOutdoorExposureCards(f);
      });
    });
    const mSlider = document.getElementById('modal-feels-slider');
    mSlider?.addEventListener('input', () => {
      state.feelsHourIdx = Number(mSlider.value) || 0;
      drawWardrobeContent();
      renderFeelsTimeAndTrio(f);
      renderOutdoorExposureCards(f);
    });
  };

  openModal(`What to Wear · ${f.location.name}`, '<div></div>');
  drawWardrobeContent();
}

function openDewPointFeelMeterModal(f) {
  openModal(
    `Dew Point Feel Meter · ${f.location.name}`,
    `<section id="dewpoint-gross-meter" class="gross-panel" aria-label="Dew Point Feel Meter"></section>`
  );
  if (f?.canonical) {
    renderDewpointMeter(f.canonical, Date.now());
  } else {
    const host = document.getElementById('dewpoint-gross-meter');
    const cur = f.current;
    const verdict = dewpointFeelLevel(cur?.dewPointF, cur?.windMph);
    if (host) {
      host.innerHTML = `
        <div style="padding:12px;">
          <div style="font-size:32px;font-weight:800;">${fmtTemp(cur?.dewPointF)}</div>
          <div style="font-size:17px;font-weight:700;margin:4px 0;">${escapeAttr(verdict.label)}</div>
          <p style="font-size:13.5px;color:var(--muted);margin:0 0 12px;">${escapeAttr(verdict.note)}</p>
          <div id="fallback-dp-chart" style="height:210px;"></div>
        </div>
      `;
      const chartEl = document.getElementById('fallback-dp-chart');
      if (chartEl) {
        renderDewPointFeelChart({
          containerEl: chartEl,
          hoursAll: f.hoursAll || f.hours48,
          rangeHours: 48,
          selectedHourIdx: 0,
          useCelsius: state.useCelsius
        });
      }
    }
  }
}

function openWindCompassModal(f) {
  const hrs = f.hours48 || [f.current];
  let idx = clamp(state.feelsHourIdx || 0, 0, hrs.length - 1);
  const tz = f.timeZone || f.location?.timeZone || 'America/New_York';

  openModal(
    `Wind & Live Compass · ${f.location.name}`,
    `
      <div class="wind-compass-modal-shell">
        <div class="wind-compass-stage">
          <svg class="wind-compass-large-svg" viewBox="0 0 240 240" width="216" height="216" role="img" aria-label="Interactive wind direction compass">
            <defs>
              <radialGradient id="wc-dial-bg" cx="50%" cy="45%" r="55%">
                <stop offset="0%" stop-color="rgba(26, 56, 94, 0.72)"/>
                <stop offset="100%" stop-color="rgba(8, 22, 42, 0.88)"/>
              </radialGradient>
            </defs>
            <circle cx="120" cy="120" r="106" fill="url(#wc-dial-bg)" stroke="rgba(210, 235, 255, 0.42)" stroke-width="2"/>
            <circle cx="120" cy="120" r="86" fill="none" stroke="rgba(180, 215, 250, 0.18)" stroke-width="1" stroke-dasharray="3 5"/>
            <text x="120" y="30" text-anchor="middle" fill="#ffffff" font-size="14" font-weight="800">N</text>
            <text x="176" y="64" text-anchor="middle" fill="rgba(210,230,250,0.65)" font-size="11" font-weight="600">NE</text>
            <text x="210" y="125" text-anchor="middle" fill="#dcecfb" font-size="13" font-weight="700">E</text>
            <text x="176" y="184" text-anchor="middle" fill="rgba(210,230,250,0.65)" font-size="11" font-weight="600">SE</text>
            <text x="120" y="216" text-anchor="middle" fill="#dcecfb" font-size="13" font-weight="700">S</text>
            <text x="64" y="184" text-anchor="middle" fill="rgba(210,230,250,0.65)" font-size="11" font-weight="600">SW</text>
            <text x="30" y="125" text-anchor="middle" fill="#dcecfb" font-size="13" font-weight="700">W</text>
            <text x="64" y="64" text-anchor="middle" fill="rgba(210,230,250,0.65)" font-size="11" font-weight="600">NW</text>
            <!-- Smoothly rotating wind needle (points in direction wind is coming from / blowing toward) -->
            <g id="wc-live-needle" style="transform-origin:120px 120px;transition:transform 0.38s cubic-bezier(0.22, 1, 0.36, 1);">
              <line x1="120" y1="44" x2="120" y2="188" stroke="rgba(140, 204, 255, 0.85)" stroke-width="3.2" stroke-linecap="round"/>
              <!-- Arrowhead at meteorological wind origin (From bearing) -->
              <polygon points="120,34 111,56 120,50 129,56" fill="#8fd3ff" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>
              <!-- Tail feathers -->
              <circle cx="120" cy="188" r="4.5" fill="rgba(255,255,255,0.45)"/>
            </g>
            <circle cx="120" cy="120" r="32" fill="rgba(10, 24, 46, 0.88)" stroke="rgba(210, 235, 255, 0.36)" stroke-width="1.5"/>
            <text id="wc-center-spd" x="120" y="119" text-anchor="middle" fill="#ffffff" font-size="20" font-weight="800">--</text>
            <text id="wc-center-unit" x="120" y="135" text-anchor="middle" fill="#b8d8f8" font-size="10.5" font-weight="600">mph</text>
          </svg>
        </div>
        <div id="wc-readout-box" style="text-align:center;margin:10px 0 12px;"></div>
        <div class="feels-slider-row" style="margin-top:6px;">
          <span class="feels-slider-edge">Now</span>
          <input id="wc-hour-slider" type="range" min="0" max="${Math.max(0, hrs.length - 1)}" value="${idx}" aria-label="Preview wind direction and speed across 48 hours" />
          <span class="feels-slider-edge">+47h</span>
        </div>
      </div>
    `
  );

  const updateCompassUI = (hIdx) => {
    idx = clamp(hIdx, 0, hrs.length - 1);
    const h = hrs[idx] || f.current;
    const deg = Number.isFinite(h.windDirDeg) ? h.windDirDeg : 45;
    const needle = document.getElementById('wc-live-needle');
    const spdEl = document.getElementById('wc-center-spd');
    const readoutEl = document.getElementById('wc-readout-box');
    if (needle) needle.style.transform = `rotate(${deg}deg)`;
    if (spdEl) spdEl.textContent = `${Math.round(h.windMph ?? 0)}`;
    if (readoutEl) {
      const stamp = formatZonedHourStamp(h, idx, tz);
      readoutEl.innerHTML = `
        <div style="font-size:17px;font-weight:800;color:#ffffff;">
          From ${escapeAttr(h.windCardinal || 'N')} (${Math.round(deg)}°) · ${Math.round(h.windMph ?? 0)} mph
        </div>
        <div style="font-size:13px;color:var(--muted);margin-top:3px;">
          ${escapeAttr(stamp)} · Gusts up to <strong>${Math.round(h.windGustMph ?? h.windMph ?? 0)} mph</strong>
        </div>
      `;
    }
  };

  updateCompassUI(idx);
  const slider = document.getElementById('wc-hour-slider');
  slider?.addEventListener('input', () => {
    updateCompassUI(Number(slider.value) || 0);
  });
}

function mapV3MetricToMainTrend(metricId) {
  const map = {
    temp: 'temperature',
    temperature: 'temperature',
    feels: 'feels',
    rainChance: 'precip',
    precip: 'precip',
    rainfall: 'rainfall',
    wind: 'wind',
    gusts: 'gust',
    gust: 'gust',
    humidity: 'humidity',
    dewPoint: 'dewpoint',
    dewpoint: 'dewpoint',
    cloudCover: 'cloud',
    cloud: 'cloud',
    uvIndex: 'uv',
    uv: 'uv',
    pressure: 'pressure',
    airQuality: 'aqi',
    aqi: 'aqi'
  };
  return map[metricId] || 'temperature';
}

function open48hExplorerModal(f) {
  openModal(
    `Next 48 Hours · ${f.location.name}`,
    `
      <section class="beta-hourly-trend">
      <div id="modal-hourly-tabs" class="main-trend-tabs" role="tablist" aria-label="Hourly graph weather variable"></div>
      <div class="main-trend-reading" aria-live="polite" style="margin:10px 0 8px;">
        <strong id="modal-main-trend-value">—</strong>
        <span id="modal-main-trend-time">Now · drag across the graph</span>
      </div>
      <div id="modal-hourly-chart" class="chart tall" tabindex="0" role="tabpanel"></div>
      <details id="modal-rain-inputs" class="beta-hour-rain-details">
        <summary id="modal-rain-input-title">Rain chance inputs</summary>
        <div id="modal-rain-input-rows"></div>
      </details>
      <details class="beta-all-hours">
        <summary>All 48 hours</summary>
        <div id="modal-hourly-strip" class="beta-hourly-table-wrap"></div>
      </details>
      </section>
    `
  );

  const tabsWrap = document.getElementById('modal-hourly-tabs');
  const valEl = document.getElementById('modal-main-trend-value');
  const timeEl = document.getElementById('modal-main-trend-time');
  const chartStage = document.getElementById('modal-hourly-chart');
  const stripWrap = document.getElementById('modal-hourly-strip');
  let activeTrendKey = mapV3MetricToMainTrend(state.selectedMetricId);

  const inputs = document.getElementById('modal-rain-inputs');
  const inputTitle = document.getElementById('modal-rain-input-title');
  const inputRows = document.getElementById('modal-rain-input-rows');
  let shownHour;
  const showRainInputs = index => {
    const hour = f.hours48[index];
    if (!hour || shownHour === hour) return;
    shownHour = hour;
    state.selectedHourIdx = index;
    inputTitle.textContent = `Rain chance inputs · ${rainPercent(hour.rainChance)}`;
    inputRows.innerHTML = hourlyRainInputsHTML(hour.rainLedger);
    for (const tile of stripWrap.querySelectorAll('[data-m-h]')) {
      const selected = Number(tile.dataset.mH) === index;
      tile.closest('tr')?.classList.toggle('active',selected);
      tile.setAttribute('aria-pressed',String(selected));
    }
  };
  inputs.open = activeTrendKey === 'precip';
  const hoursByTime = new Map(f.hours48.map((hour,index) => [Date.parse(hour.time),index]));

  let plottedHours = [];
  const drawModalHourly = () => {
    if (tabsWrap && !tabsWrap.children.length) {
      tabsWrap.innerHTML = Object.entries(TREND_METRICS)
        .map(
          ([id, d]) =>
            `<button type="button" role="tab" id="beta-trend-tab-${id}" aria-controls="modal-hourly-chart" aria-selected="${id === activeTrendKey}" data-m-trend="${id}">${d.label}</button>`
        )
        .join('');
      tabsWrap.querySelectorAll('[data-m-trend]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeTrendKey = btn.dataset.mTrend;
          if (activeTrendKey === 'precip') inputs.open = true;
          drawModalHourly();
        });
      });
    }

    for (const tab of tabsWrap.querySelectorAll('[data-m-trend]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.mTrend === activeTrendKey));
    }
    chartStage.setAttribute('aria-labelledby', 'beta-trend-tab-' + activeTrendKey);
    if (f.canonical && chartStage) {
      const series = mainTrendSeries(f.canonical);
      series.precip = f.hours48.map(hour => ({t:Date.parse(hour.time),v:hour.rainChance}));
      const start = Math.floor(Date.now() / HALO_H) * HALO_H;
      const end = start + 47 * HALO_H;
      const def = TREND_METRICS[activeTrendKey] || TREND_METRICS.temperature;
      const rawPoints = series[activeTrendKey] || [];
      const points = state.useCelsius && def.unit === '°'
        ? rawPoints.map(p => ({...p,v:Number.isFinite(p.v) ? (p.v-32)*5/9 : null}))
        : rawPoints;
      const available = points.filter((p) => p.t >= start && p.t <= end && typeof p.v === 'number' && Number.isFinite(p.v));
      plottedHours = available;
      const tz = f.canonical.location?.timeZone || f.timeZone || 'America/New_York';
      const showPoint = (p) => {
        if (valEl) valEl.textContent = trendReading(activeTrendKey, p);
        if (p) showRainInputs(hoursByTime.get(p.t));
        if (timeEl) {
          timeEl.textContent = p
            ? haloFmt(p.t, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : 'Now · drag across the graph';
        }
      };
      mountChart(
        chartStage,
        {
          points,
          extra: activeTrendKey === 'wind' ? series.gust : [],
          t0: start,
          t1: end,
          tz,
          nowT: null,
          nights: nightBands(solarDays(f.canonical), start, end),
          multiDay: true,
          keepSelection: true,
          glow: !state.useCelsius
        },
        def,
        (p) => showPoint(p || available[0])
      );
      const selected = Date.parse(f.hours48[state.selectedHourIdx]?.time);
      if (available.some(point => point.t === selected)) chartStage.selectChartTime(selected);
      else if (Number.isFinite(selected)) showPoint({t:selected,v:null});
      else showPoint(available[0]);
    } else if (chartStage) {
      renderHourlyExplorerChart({
        containerEl: chartStage,
        hours48: f.hours48,
        metricId: HOURLY_METRICS.find(m => mapV3MetricToMainTrend(m.id) === activeTrendKey)?.id || 'temp',
        selectedHourIdx: state.selectedHourIdx,
        useCelsius: state.useCelsius,
        onSelectHour: showRainInputs
      });
    }

    if (stripWrap && !stripWrap.children.length) {
      const time = new Intl.DateTimeFormat('en-US',{timeZone:f.timeZone,weekday:'short',hour:'numeric'});
      const rows = f.hours48.map((hour, index) => {
        const selected = index === state.selectedHourIdx;
        return `<tr class="${selected ? 'active' : ''}">
          <th scope="row"><button type="button" data-m-h="${index}" data-time="${Date.parse(hour.time)}" aria-pressed="${selected}" aria-label="${escapeAttr(time.format(hour.dateObj))} · ${escapeAttr(hour.condition || 'Conditions unavailable')}">${renderWeatherIconSvg(hour.icon, 15)}${escapeAttr(time.format(hour.dateObj))}</button></th>
          <td>${fmtTemp(hour.tempF)}</td>
          <td>${fmtTemp(hour.feelsLikeF)}</td>
          <td title="${escapeAttr(hour.rainLedger.tooltip)}">${rainPercent(hour.rainChance)}</td>
          <td>${Number.isFinite(hour.precipIn) ? hour.precipIn.toFixed(2)+'″' : '—'}</td>
        </tr>`;
      }).join('');
      stripWrap.innerHTML = `<table class="beta-hourly-table" aria-label="Hourly forecast">
        <thead><tr><th scope="col">Time</th><th scope="col">Temp</th><th scope="col">Feels</th><th scope="col">Rain</th><th scope="col">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
      stripWrap.querySelectorAll('[data-m-h]').forEach((el) => {
        el.addEventListener('click', () => {
          const index = Number(el.dataset.mH);
          showRainInputs(index);
          if (f.canonical && plottedHours.some(point => point.t === +el.dataset.time)) chartStage.selectChartTime(+el.dataset.time);
          else if (f.canonical) {
            chartStage.querySelector('.c-scrub')?.setAttribute('visibility','hidden');
            valEl.textContent = 'Unavailable';
            timeEl.textContent = haloFmt(+el.dataset.time,f.timeZone,{weekday:'short',hour:'numeric',minute:'2-digit'});
          } else drawModalHourly();
        });
      });
    }
  };
  chartStage.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || !plottedHours.length) return;
    event.preventDefault();
    const current = plottedHours.findIndex(p => p.t === Date.parse(f.hours48[state.selectedHourIdx]?.time));
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? plottedHours.length-1
      : clamp(current + (event.key === 'ArrowRight' ? 1 : -1), 0, plottedHours.length-1);
    const time = plottedHours[index].t;
    state.selectedHourIdx = Math.max(0, f.hours48.findIndex(h => Date.parse(h.time) === time));
    chartStage.selectChartTime(time);
  });
  drawModalHourly();
  showRainInputs(state.selectedHourIdx);
}

function openBehindForecastModal(f) {
  const day = f.days[clamp(state.selectedDayIdx, 0, f.days.length - 1)] || f.days[0];
  const warmest = day.hours.reduce((b, h) => (h.tempF > b.tempF ? h : b), day.hours[0]);
  const mt = warmest.modelTemps;
  const ew = warmest.tempFusion.effectiveWeights;

  const modelRows = [
    { key: 'nws', name: 'National Weather Service (NWS)', color: '#38bdf8' },
    { key: 'hrrr', name: 'Short-Range US Radar Model (HRRR)', color: '#ff9248' },
    { key: 'nbm', name: 'National Blend (NBM)', color: '#34d399' },
    { key: 'ecmwf', name: 'European Model (ECMWF)', color: '#c084fc' },
    { key: 'gefs', name: 'Global Ensemble Average', color: '#facc15' },
    { key: 'weathernext', name: 'Google WeatherNext AI', color: '#f472b6' }
  ];

  openModal(
    `ℹ Behind the Forecast · ${f.location.name}`,
    `
      <p style="font-size:13.5px;color:var(--muted);margin-top:0;line-height:1.5;">
        Weather Nourie combines official National Weather Service updates with top US, European, and AI forecasts to give you one clear, dependable answer.
      </p>

      <div style="margin-bottom:14px;padding:12px;border-radius:14px;background:rgba(255,255,255,0.05);">
        <div style="font-size:13px;font-weight:700;color:#7ac6ff;margin-bottom:8px;">
          Today's Warmest Hour Comparison (${warmest.hourLabel} → ${fmtTemp(warmest.tempF)})
        </div>
        <table class="math-table">
          <thead><tr><th>Forecast Source</th><th>Temp</th><th>Share Used Today</th></tr></thead>
          <tbody>
            ${modelRows.map((m) => `
              <tr>
                <td><strong style="color:${m.color};">${m.name}</strong></td>
                <td>${mt[m.key] != null ? fmtTemp(mt[m.key]) : '—'}</td>
                <td><strong>${ew[m.key] ? Math.round(ew[m.key] * 100) : 0}%</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <details>
        <summary style="cursor:pointer;font-weight:700;font-size:13.5px;color:var(--blue);">▸ Read Local Weather Office Notes (${f.afd.wfo})</summary>
        <pre class="afd-pre" style="margin-top:8px;">${f.afd.text}</pre>
      </details>
    `
  );
}

async function openModelRankingsModal(f) {
  let days = 10;
  let horizon = 24;
  let rankMode = 'overall';

  openModal(
    `🏆 Model Accuracy Rankings · ${f.location.name}`,
    `<div id="modal-rankings-host"><div style="padding:20px;text-align:center;color:var(--muted);">Scoring Weather Nourie against 7 US &amp; global models using real observed weather…</div></div>`
  );

  const loadAndRender = async () => {
    const host = document.getElementById('modal-rankings-host');
    if (!host) return;
    const cacheKey = `${Number(f.location.latitude).toFixed(2)}:${Number(f.location.longitude).toFixed(2)}:${days}:${horizon}`;
    if (!state.accuracyCache.has(cacheKey)) {
      host.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);">Loading past ${days}-day accuracy results…</div>`;
    }
    try {
      const data = await fetchAccuracyCached(f.location.latitude, f.location.longitude, days, horizon);
      renderRankingsUi(host, data);
    } catch {
      host.innerHTML = `<div style="padding:18px;color:#ff8f8f;">Unable to load rankings right now. Please try again in a moment.</div>`;
    }
  };

  const renderRankingsUi = (host, data) => {
    const list = [...(data.rankings || [])];
    if (rankMode === 'temp') list.sort((a, b) => (a.maeF ?? 99) - (b.maeF ?? 99));
    else if (rankMode === 'rain') list.sort((a, b) => (b.scores?.rain ?? -1) - (a.scores?.rain ?? -1));
    else if (rankMode === 'wind') list.sort((a, b) => (a.windMaeMph ?? 99) - (b.windMaeMph ?? 99));
    else list.sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1));

    const wn = list.find((r) => r.id === 'nourie' || r.id === 'weather_nourie' || r.isNourie);
    const wnPos = wn ? list.indexOf(wn) + 1 : null;
    const modeExplanation =
      rankMode === 'temp'
        ? 'Average degrees off from real recorded temperatures (lower = more accurate).'
        : rankMode === 'rain'
        ? 'How often rain vs. dry calls matched real weather (higher % = more accurate).'
        : rankMode === 'wind'
        ? 'Average mph off from real recorded wind speeds (lower = more accurate).'
        : 'Combined 0–100 score from real past temperature, rain & wind checks (higher = better).';

    host.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;justify-content:space-between;align-items:center;">
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${[
            ['overall', '🏆 Overall'],
            ['temp', '🌡 Temp'],
            ['rain', '🌧 Rain'],
            ['wind', '💨 Wind']
          ].map(([id, lbl]) => `<button class="mode-pill ${rankMode === id ? 'active' : ''}" data-r-mode="${id}" type="button">${lbl}</button>`).join('')}
        </div>
        <div style="display:flex;gap:4px;">
          ${[7, 10, 14].map((d) => `<button class="mode-pill ${days === d ? 'active' : ''}" data-r-days="${d}" type="button">${d}d</button>`).join('')}
          ${[24, 48].map((h) => `<button class="mode-pill ${horizon === h ? 'active' : ''}" data-r-hr="${h}" type="button">${h}h</button>`).join('')}
        </div>
      </div>

      <p style="font-size:12.5px;color:var(--muted);margin:0 0 10px;line-height:1.45;">${modeExplanation}</p>

      ${wn ? `
        <div style="padding:11px 14px;border-radius:14px;background:rgba(56,189,248,0.14);border:1px solid rgba(56,189,248,0.38);margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div>
            <div style="font-size:11px;font-weight:800;color:#7dd3fc;text-transform:uppercase;">Weather Nourie (${days} days · ${horizon}h ahead)</div>
            <div style="font-size:17px;font-weight:800;">Rank #${wnPos} of ${list.length} · Score ${(wn.overallScore ?? wn.accuracyScore ?? 0).toFixed(1)}/100</div>
          </div>
          <div style="text-align:right;font-size:12px;color:var(--muted);">
            <div>Avg Temp Diff: <strong>${wn.maeF?.toFixed(1) ?? '—'}°F off</strong></div>
            <div>Rain Right: <strong>${wn.precipHitPct != null ? Math.round(wn.precipHitPct) + '%' : '—'}</strong></div>
          </div>
        </div>
      ` : ''}

      <div style="display:flex;flex-direction:column;gap:7px;max-height:360px;overflow-y:auto;">
        ${list.map((r, i) => {
          const scoreVal = rankMode === 'temp'
            ? `avg ${r.maeF?.toFixed(1) ?? '—'}°F off`
            : rankMode === 'rain'
            ? `${r.precipHitPct != null ? Math.round(r.precipHitPct) + '% right' : '—'}`
            : rankMode === 'wind'
            ? `avg ${r.windMaeMph?.toFixed(1) ?? '—'} mph off`
            : `${(r.overallScore ?? r.accuracyScore ?? 0).toFixed(1)} / 100`;
          const barPct = rankMode === 'temp'
            ? clamp(r.scores?.temp ?? 65, 10, 100)
            : rankMode === 'rain'
            ? clamp(r.scores?.rain ?? 55, 10, 100)
            : rankMode === 'wind'
            ? clamp(r.scores?.wind ?? 60, 10, 100)
            : clamp(r.overallScore ?? r.accuracyScore ?? 60, 10, 100);
          return `
            <div style="padding:9px 12px;border-radius:12px;background:${r.id === 'weather_nourie' ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.05)'};border:1px solid ${r.id === 'weather_nourie' ? 'rgba(122,198,255,0.45)' : 'rgba(255,255,255,0.1)'};">
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px;margin-bottom:5px;">
                <span><strong>#${i + 1} ${r.name}</strong></span>
                <strong style="color:${r.color || '#7dd3fc'};">${scoreVal}</strong>
              </div>
              <div class="pave-progress-bg"><div class="pave-progress-fill" style="width:${barPct}%;background:${r.color || '#38bdf8'};"></div></div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    host.querySelectorAll('[data-r-mode]').forEach((b) => b.addEventListener('click', () => { rankMode = b.dataset.rMode; renderRankingsUi(host, data); }));
    host.querySelectorAll('[data-r-days]').forEach((b) => b.addEventListener('click', () => { days = Number(b.dataset.rDays); loadAndRender(); }));
    host.querySelectorAll('[data-r-hr]').forEach((b) => b.addEventListener('click', () => { horizon = Number(b.dataset.rHr); loadAndRender(); }));
  };

  loadAndRender();
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

  // Pre-rendered offscreen lunar disc texture with accurate current moon phase
  let moonCanvas = null;
  let moonPhaseKey = '';

  function ensureMoonCanvas(radius) {
    const now = new Date();
    const key = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${Math.round(radius)}`;
    if (moonCanvas && moonPhaseKey === key) return moonCanvas;
    moonPhaseKey = key;

    const pad = Math.round(radius * 2.2);
    const size = Math.round((radius + pad) * 2);
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const mctx = off.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const phase = getLunarPhaseFraction(now);
    const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const isWaxing = phase < 0.5;

    // 1. Soft atmospheric lunar halo proportional to illumination
    const haloGrad = mctx.createRadialGradient(cx, cy, radius * 0.75, cx, cy, radius * 2.8);
    haloGrad.addColorStop(0, `rgba(220, 234, 255, ${(0.08 + illumination * 0.2).toFixed(3)})`);
    haloGrad.addColorStop(0.45, `rgba(175, 204, 248, ${(0.03 + illumination * 0.08).toFixed(3)})`);
    haloGrad.addColorStop(1, 'rgba(175, 204, 248, 0)');
    mctx.fillStyle = haloGrad;
    mctx.beginPath();
    mctx.arc(cx, cy, radius * 2.8, 0, Math.PI * 2);
    mctx.fill();

    // 2. Subtle dark-side earthshine disc so the full moon outline is gently perceptible
    mctx.save();
    mctx.beginPath();
    mctx.arc(cx, cy, radius, 0, Math.PI * 2);
    mctx.clip();

    const earthshine = mctx.createRadialGradient(cx - radius * 0.25, cy - radius * 0.25, radius * 0.1, cx, cy, radius);
    earthshine.addColorStop(0, 'rgba(110, 134, 174, 0.2)');
    earthshine.addColorStop(1, 'rgba(42, 58, 88, 0.28)');
    mctx.fillStyle = earthshine;
    mctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    // 3. Geometrically accurate illuminated lunar phase region
    if (illumination > 0.015) {
      const litOff = document.createElement('canvas');
      litOff.width = size;
      litOff.height = size;
      const lctx = litOff.getContext('2d');

      // Base illuminated lunar surface gradient
      const surf = lctx.createRadialGradient(cx - radius * 0.28, cy - radius * 0.28, radius * 0.12, cx, cy, radius * 1.05);
      surf.addColorStop(0, '#fbfcfe');
      surf.addColorStop(0.58, '#e3e8f0');
      surf.addColorStop(0.88, '#c5cfde');
      surf.addColorStop(1, '#a5b2c6');
      lctx.fillStyle = surf;
      lctx.beginPath();
      lctx.arc(cx, cy, radius, 0, Math.PI * 2);
      lctx.fill();

      // Subtle natural lunar maria (seas/craters)
      const maria = [
        [-0.28, -0.22, 0.28, 0.22, 0.16],
        [0.14, -0.18, 0.24, 0.18, 0.14],
        [0.24, 0.12, 0.26, 0.22, 0.15],
        [-0.12, 0.24, 0.22, 0.15, 0.11],
        [-0.42, 0.1, 0.15, 0.12, 0.1]
      ];
      maria.forEach(([ox, oy, rxm, rym, op]) => {
        lctx.fillStyle = `rgba(98, 110, 132, ${op})`;
        lctx.beginPath();
        lctx.ellipse(cx + ox * radius, cy + oy * radius, rxm * radius, rym * radius, 0.35, 0, Math.PI * 2);
        lctx.fill();
      });

      // Clip to exact astronomical phase terminator
      lctx.globalCompositeOperation = 'destination-in';
      lctx.beginPath();
      if (illumination >= 0.985) {
        lctx.arc(cx, cy, radius, 0, Math.PI * 2);
      } else {
        const termRx = Math.abs(Math.cos(2 * Math.PI * phase)) * radius;
        const isGibbous = illumination > 0.5;
        if (isWaxing) {
          // Right limb lit
          lctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI / 2, false);
          lctx.ellipse(cx, cy, Math.max(0.5, termRx), radius, 0, Math.PI / 2, -Math.PI / 2, !isGibbous);
        } else {
          // Left limb lit
          lctx.arc(cx, cy, radius, Math.PI / 2, -Math.PI / 2, false);
          lctx.ellipse(cx, cy, Math.max(0.5, termRx), radius, 0, -Math.PI / 2, Math.PI / 2, !isGibbous);
        }
      }
      lctx.closePath();
      lctx.fillStyle = '#ffffff';
      lctx.fill();

      mctx.drawImage(litOff, 0, 0);
    }

    mctx.restore();
    moonCanvas = off;
    return moonCanvas;
  }

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
    } else if (mood === 'night' && (state.skyOverride === 'night' || !isSkyCloudyOrWet(state.forecast))) {
      // Stars only on clear nights; partly cloudy nights keep the moon phase, seen through cloud
      const partlyNight = state.skyOverride !== 'night' && isPartlyCloudyCondition(state.forecast);
      if (!partlyNight) {
        particles.slice(0, 55).forEach((p) => {
          const twinkle = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(ts * 0.002 + p.phase));
          ctx.fillStyle = `rgba(220, 236, 255, ${twinkle.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y * 0.65, p.radius, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      const moonR = W < 600 ? 25 : 32;
      const mImg = ensureMoonCanvas(moonR);
      const mx = W < 600 ? W * 0.23 : W * 0.22;
      const my = W < 600 ? 224 : 210;
      ctx.save();
      ctx.globalAlpha = partlyNight ? 0.72 : 1;
      ctx.drawImage(mImg, Math.round(mx - mImg.width / 2), Math.round(my - mImg.height / 2));
      ctx.restore();
    } else if (mood !== 'cloudy' && mood !== 'sunset' && !isSkyCloudyOrWet(state.forecast)) {
      // Subtle floating solar light motes (never on overcast/cloudy days)
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

setInterval(()=>{if(state.forecast&&!document.hidden)renderTopCompactPills(state.forecast);},60000);
