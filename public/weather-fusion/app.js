import {weatherIcon,renderHourlyWeather} from './weather-display.js?v=1-repair';
import {degrees,feelsAt,dayFeelsHTML} from './hourly-feels.js?v=2-hourly';
import {createFramePlayer} from './frame-player.js';
import {renderComfort,selectComfortHour,renderDailyRows,renderMetricTiles,resetExperience,installExperience} from './experience.js?v=10-weather-repair';
import {dailyDisplay} from './weather-math.js';
import {currentHero} from './current-temperature.js?v=1-current';
import {renderBulletins} from './bulletins.js?v=2-special';
import {dailyGrossHTML,modelFreshnessText} from './personal-details.js?v=3-weather';
import {renderDewpointMeter} from './dewpoint-meter.js?v=6-future';
import {renderWeatherPanel} from './render-safety.js';
/* Weather Nourie browser client. Forecast values never originate in AI prose. */
const $ = (id) => document.getElementById(id);
const presets = {
  knightdale: { id: 'knightdale', name: 'Knightdale / Raleigh', latitude: 35.787, longitude: -78.4806 },
  greenville: { id: 'greenville', name: 'Greenville, NC', latitude: 35.6127, longitude: -77.3664 },
};
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = (n, decimals = 0) => finite(n) ? n.toFixed(decimals) : '—';
const temperature = (n) => `${number(n)}°`;
const inches = (n) => finite(n) ? `${n.toFixed(2)} in` : 'Unavailable';
const percent = (n) => finite(n) ? `${Math.round(n)}%` : '—';
let place = presets.knightdale, forecast = null, generation = 0, busy = false, searchGeneration = 0;
let map = null, baseLayer = null, radarLayer = null, warningLayer = null, marker = null;
let frames = [], frameIndex = 0, radarTimer = null, selectedLayer = 'radar', radarMeta = null, radarGeneration = 0;
let modelCatalog = null, modelFetched = 0, modelFrames = [], modelIndex = 0, modelLayer = null, mapSelectionToken = 0, modelFrameToken = 0;
let framePlayer=null;
let lastRadarFetch = 0, currentBriefing = null, requestController = null;
const readSaved = () => {
  try { const p = JSON.parse(localStorage.getItem('weather-fusion-place')); if (p && finite(p.latitude) && finite(p.longitude) && p.latitude >= 24 && p.latitude <= 50 && p.longitude >= -125 && p.longitude <= -66) place = p; } catch { /* Storage may be unavailable. */ }
};
function clock(value, options = {}) {
  const t = new Date(value);
  return Number.isFinite(t.getTime()) ? new Intl.DateTimeFormat('en-US', { timeZone: forecast?.location.timeZone || 'America/New_York', hour: 'numeric', minute: '2-digit', ...options }).format(t) : 'Unavailable';
}
function shortHour(value) { return clock(value, { minute: undefined }).replace(' ', ''); }
function query(extra = {}) {
  return new URLSearchParams({ latitude: place.latitude, longitude: place.longitude, ...(presets[place.id] ? { location: place.id } : {}), ...extra });
}
async function api(path, params = '', signal) {
  const response = await fetch(`/api/weather-fusion/${path}${params ? `?${params}` : ''}`, { signal, headers: { Accept: 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Weather service unavailable.'), { status: response.status });
  return data;
}
function icon(condition = '', isDay = true, size = 32) { return weatherIcon(condition,isDay,size); }
function smallIcon(type) {
  const paths = { drop: 'M12 2C9 7 4 11 4 16a8 8 0 0 0 16 0c0-5-5-9-8-14Z',
    wind: 'M3 8h12c5 0 5-6 1-6M3 12h16c5 0 5 6 1 6M3 16h7c4 0 4 6 0 6',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
    temp: 'M9 15V5a3 3 0 0 1 6 0v10a5 5 0 1 1-6 0Zm3-8v11',
    gauge: 'M4 19a10 10 0 1 1 16 0M12 13l5-6M3 13h2M19 13h2',
    sun: 'M2 19h20M5 15a7 7 0 0 1 14 0M12 2v3M3 7l3 2M21 7l-3 2' };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="${paths[type] || paths.temp}"/></svg>`;
}
function isDaylight() {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: forecast?.location.timeZone || 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return h >= 7 && h < 19;
}
function render(data) {
  forecast = data;
  const failedPanels = [];
  const draw = (id, label, renderer) => renderWeatherPanel(id, label, renderer, (error) => {
    failedPanels.push(label);
    console.error(`Weather Nourie panel failed: ${label}`, error);
  });
  const c = data.current, d = data.days[0], day = isDaylight();
  document.body.dataset.sky = !day ? 'night' : /rain|storm|shower/i.test(c.condition) ? 'rain' : 'day';
  $('city-name').textContent = presets[place.id]?.name || data.location.name || place.name;
  $('hero-date').textContent = new Intl.DateTimeFormat('en-US', { timeZone: data.location.timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
  const currentDay = dailyDisplay(d, 0, Date.now(), data.location.timeZone);
  const hero = currentHero(data, day);
  $('temperature').innerHTML = `${number(hero.temperature)}<span>°</span>`;
  if($('hero-feels'))$('hero-feels').innerHTML=`Feels like <strong>${degrees(data.comfort?.shade)}</strong><small>In the shade · ${c.type==='observation'?'based on the current station reading':'estimated from forecast data'}</small>`;
  $('condition').textContent = hero.tonight ? `Tonight · ${hero.condition}` : hero.condition;
  $('high-low').textContent = hero.tonight ? 'Overnight low' : hero.range;
  $('observation-label').textContent = hero.tonight ? `Tonight’s forecast · updated ${clock(data.assembledAt)}` : (c.type === 'observation' ? `Nearby weather station · updated ${clock(c.time)}` : 'Estimated current conditions');
  $('hero-scene').innerHTML = icon(hero.condition, hero.isDay, 120);
  document.querySelectorAll('[data-place]').forEach((button) => { const active = button.dataset.place === place.id; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  draw('alerts', 'Official alerts', () => renderAlerts(data));
  draw('hourly', 'Hourly forecast', () => renderHours(data));
  draw('daily', 'Daily forecast', () => renderDays(data));
  draw('skin-exposure', 'Feels-like outlook', () => renderComfort(data));
  draw('dewpoint-gross-meter', 'Dew Point Gross Meter', () => renderDewpointMeter(data));
  draw('metrics', 'Weather details', () => renderMetrics(data));
  draw('scientific-stuff', 'Source details', () => renderEvidence(data));
  if (currentBriefing?.signature !== data.signature) {
    draw('briefing-summary', 'Local outlook', () => renderBriefing({ mode: 'nws-summary', signature: data.signature, headline: currentDay.tonight ? 'Your evening outlook' : d.condition, summary: currentDay.detail || 'The official forecast is temporarily unavailable.', nearTerm: d.nightDetail, extended: data.days[1]?.detail,
      uncertainty: '', reason: data.aiConfigured ? 'Updating your local outlook…' : 'National Weather Service forecast', sources: ['nws'] }));
  }
  if (map) { marker?.setLatLng([place.latitude, place.longitude]); renderMapWarnings(data); }
  const unavailable = data.feeds.filter((f) => ['unavailable', 'stale', 'not-configured'].includes(f.status));
  const locationLimited = data.feeds.filter((f) => f.status === 'not-covered');
  const sourceNote = unavailable.length ? ' · Some sources are unavailable or stale — details in Scientific Stuff below' : locationLimited.length ? ' · Some optional model details are limited for this location — details below' : '';
  $('status').textContent = `Updated ${clock(data.assembledAt)}${sourceNote}${failedPanels.length ? ` · Display issue: ${failedPanels.join(', ')}. Other forecasts remain available; use Refresh to retry.` : ''}`;
  $('status').classList.toggle('error', unavailable.length > 0 || failedPanels.length > 0);
}
function renderAlerts(data) { renderBulletins(data); }
function renderHours(data) { renderHourlyWeather(data,Date.now()); }
function renderDays(data) { renderDailyRows(data, icon); }
function compass(degrees) {
  return finite(degrees) ? ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(degrees / 22.5) % 16] : 'Direction unavailable';
}
function renderMetrics(data) { renderMetricTiles(data, smallIcon); }
function renderEvidence(data) {
  const important = ['nws', 'afd', 'hrrr', 'ecmwf', 'nbm', 'alerts'];
  const labels = { nws: 'NWS', afd: 'Local discussion', hrrr: 'HRRR', ecmwf: 'ECMWF IFS', nbm: 'National Blend', alerts: 'Alerts' };
  const names = { ready: 'Available', unavailable: 'Unavailable', stale: 'Stale — excluded', 'not-configured': 'Not configured', 'not-covered': 'Not collected for this location' };
  const sourceIssues=data.feeds.filter(f=>['unavailable','stale','not-configured','not-covered'].includes(f.status));
  const sourceSummary=$('source-unavailable-summary');
  if(sourceSummary){
    if(!sourceIssues.length){sourceSummary.hidden=true;sourceSummary.innerHTML='';}
    else{const issueNames={unavailable:'Unavailable',stale:'Stale and excluded','not-configured':'Not configured','not-covered':'Not collected for this location'};sourceSummary.innerHTML=`<strong>What is unavailable or limited</strong><ul>${sourceIssues.map(f=>`<li>${esc(f.label||f.id)} — ${esc(issueNames[f.status]||f.status)}${f.message?`: ${esc(f.message)}`:''}</li>`).join('')}</ul>`;sourceSummary.hidden=false;}
  }
  $('feed-health').innerHTML = important.map((id) => {
    const f = data.feeds.find((s) => s.id === id);
    return `<span class="feed-chip ${esc(f?.status || 'unavailable')}" title="${esc(f?.message || f?.label || '')}">${labels[id]} · ${f?.contributes ? 'Contributing' : names[f?.status] || 'Unavailable'}${f?.contributes && f.issuedAt ? `<small>Run ${esc(clock(f.issuedAt, { month: 'short', day: 'numeric' }))}</small>` : ''}</span>`;
  }).join('');
  $('afd-office').textContent = data.discussion?.office ? `NWS ${data.discussion.office}` : '';
  $('afd-stamp').textContent = data.discussion ? `Issued ${clock(data.discussion.issuanceTime, { month: 'short', day: 'numeric' })}. Regional discussion; point forecasts may differ.` : 'No fresh discussion is available from the local forecast office.';
  $('afd-text').textContent = data.discussion?.text || 'The NWS discussion feed is currently unavailable. AI synthesis is paused until a fresh local discussion is available.';
  $('afd-link').href = /^https:\/\/api\.weather\.gov\//.test(data.discussion?.url || '') ? data.discussion.url : 'https://www.weather.gov/';
  $('methodology').textContent = data.methodology;
  $('source-register').innerHTML = data.feeds.map((f) => {
    const url = /^https:\/\/(api\.weather\.gov|www\.nco\.ncep\.noaa\.gov|www\.ecmwf\.int|open-meteo\.com)\//.test(f.url || '') ? f.url : 'https://www.weather.gov/';
    return `<div class="source-item"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(f.label)} ↗</a><span>${esc(names[f.status] || f.status)} · retrieved ${f.fetchedAt ? esc(clock(f.fetchedAt)) : '—'}${f.issuedAt ? ` · issued ${esc(clock(f.issuedAt, { month: 'short', day: 'numeric' }))}` : ' · model run/issuance not supplied'}</span></div>`;
  }).join('');
}
function renderBriefing(data) {
  currentBriefing = data;
  $('briefing-title').textContent = data.headline || 'Local forecast';
  $('briefing-summary').textContent = data.summary || 'The source forecast is currently unavailable.';
  $('ai-label').textContent = data.mode === 'ai' ? 'YOUR LOCAL OUTLOOK' : 'NWS FORECAST';
  const refs = (data.sources || []).filter((id) => ['nws', 'afd', 'hrrr', 'ecmwf', 'nbm'].includes(id)).map((id) => {
    const f = forecast?.feeds.find((s) => s.id === id);
    const url = id === 'afd' ? forecast?.discussion?.url : f?.url;
    return url && /^https:\/\/(api\.weather\.gov|www\.nco\.ncep\.noaa\.gov|www\.ecmwf\.int)\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(f?.label || id)} ↗</a>` : esc(f?.label || id);
  });
  $('briefing-detail').innerHTML = `<div><strong>Tonight & tomorrow</strong><p>${esc(data.nearTerm || 'See the hourly forecast below.')}</p></div><div><strong>The week ahead</strong><p>${esc(data.extended || 'More details will appear with the next update.')}</p></div><div><strong>What could change - Dan's take</strong><p>${esc(data.uncertainty || '')}</p></div>`;
  // Reuse the same outlook uncertainty below today's graphic, including refresh/reset.
  const uncertainty = typeof data.uncertainty === 'string' ? data.uncertainty.trim() : '';
  const todayUncertainty = $('today-uncertainty'), todayUncertaintyText = $('today-uncertainty-text');
  if (todayUncertainty && todayUncertaintyText) {
    todayUncertaintyText.textContent = uncertainty;
    todayUncertainty.hidden = !uncertainty;
  }
  $('briefing-stamp').textContent = data.mode === 'ai' ? `Updated ${clock(data.generatedAt)} · based on your local NWS discussion` : 'National Weather Service forecast';
  $('outlook-science').innerHTML = `<p>Summary type: ${esc(data.mode === 'ai' ? 'AI plain-language paraphrase of the local discussion, checked against the point forecast and available model data' : 'Official NWS forecast fallback; not an AI paraphrase')}. ${esc(data.reason || '')}</p><p>Sources used: ${refs.join(' · ') || 'Waiting for the local outlook'}</p>`;

}
async function load({ moveMap = false, refreshModels = false } = {}) {
  const id = ++generation;
  let receivedForecast = false;
  requestController?.abort();
  requestController = new AbortController();
  busy = true; $('refresh').classList.add('loading');
  $('status').textContent = 'Checking the latest source forecasts…';
  try {
    const data = await api('forecast', query(), requestController.signal);
    if (id !== generation) return;
    receivedForecast = true;
    render(data);
    // Official notices are rendered synchronously; AI explanations never delay them.
    api('bulletins', query({ signature: data.signature }), requestController.signal).then((bulletins) => {
      if (id === generation && bulletins.signature === forecast?.signature) renderBulletins(forecast, bulletins);
    }).catch((error) => {
      if (id === generation && error.name !== 'AbortError' && forecast) renderBulletins(forecast, {mode:'official', signature:forecast.signature});
    });
    if (!map) initMap();
    if (moveMap && map) map.setView([place.latitude, place.longitude], 8);
    if (selectedLayer !== 'radar' && (refreshModels || moveMap || Date.now()-modelFetched >= 55000)) void loadModelMap(refreshModels);
    if (Date.now() - lastRadarFetch > 2 * 60000) void loadRadar();
    if (data.aiConfigured && !(currentBriefing?.mode === 'ai' && currentBriefing.signature === data.signature)) {
      api('briefing', query({ signature: data.signature }), requestController.signal).then((briefing) => {
        if (id === generation && briefing.signature === forecast?.signature) renderBriefing(briefing);
      }).catch((error) => {
        if (id !== generation || error.name === 'AbortError') return;
        $('briefing-stamp').textContent = error.status === 409 ? 'Sources changed while the briefing was prepared. The next refresh will use the new forecast.' : 'AI synthesis is unavailable. Official NWS wording remains visible.';
      });
    }
  } catch (e) {
    if (id !== generation || e.name === 'AbortError') return;
    console.error(receivedForecast ? 'Weather Nourie display failed' : 'Weather Nourie request failed', e);
    $('status').textContent = receivedForecast
      ? 'The forecast arrived, but a display component failed. Use Refresh to retry.'
      : `Weather update failed. ${forecast ? `The displayed snapshot was checked at ${clock(forecast.assembledAt)} and may be stale.` : 'Please retry or check weather.gov.'}`;
    $('status').classList.add('error');
    if (!receivedForecast) $('alerts').innerHTML = '<p class="alert-note warning">Live alert status could not be checked. Consult the official NWS forecast and warnings.</p>';
  } finally { if (id === generation) { busy = false; $('refresh').classList.remove('loading'); } }
}
function chooseLocation(value) {
  place = { ...value };
  stopRadar();framePlayer?.clear();++modelFrameToken;++mapSelectionToken;
  currentBriefing = null;
  resetExperience();
  if ($('day-dialog').open) $('day-dialog').close();
  // Clear the previous location immediately, including its alerts and AI text.
  forecast = null;
  $('city-name').textContent = value.name;
  $('temperature').innerHTML = '—<span>°</span>';
  if($('hero-feels'))$('hero-feels').textContent='Feels like —';
  $('condition').textContent = 'Loading the selected location';
  $('high-low').textContent = 'High —° · Low —°';
  $('observation-label').textContent = 'Awaiting the new location’s sources';
  $('alerts').innerHTML = '<p class="alert-note warning">Checking official alerts for the selected location…</p>';
  $('hourly').innerHTML = '<p class="muted">Loading hourly forecast…</p>';
  $('daily').innerHTML = '<p class="muted">Loading daily forecast…</p>';
  $('metrics').innerHTML = '';
  $('feed-health').innerHTML = '';
  $('afd-text').textContent = 'Loading the selected office’s discussion…';
  $('afd-office').textContent = '';
  $('afd-stamp').textContent = 'Checking the selected location’s forecast office…';
  $('afd-link').href = 'https://www.weather.gov/';
  $('source-register').replaceChildren();
  renderBriefing({ headline: 'Preparing your local outlook.', summary: 'Loading the latest NWS forecast and local discussion for this location.', sources: [] });
  $('search-results').hidden = true; $('city-search').value = ''; $('city-search').setAttribute('aria-expanded', 'false');
  try { localStorage.setItem('weather-fusion-place', JSON.stringify(place)); } catch { /* nonessential */ }
  warningLayer?.clearLayers();
  void load({ moveMap: true });
}
function showDay(index) {
  const d=forecast?.days[index]; if(!d) return;
  const p=dailyDisplay(d,index,Date.now(),forecast.location.timeZone);
  $('day-content').innerHTML=`<div class="dialog-eyebrow">WEATHER NOURIE</div><h2 id="day-title" class="dialog-title">${esc(p.label)}</h2><p class="dialog-condition">${esc(p.condition)}</p><div class="dialog-temps">${temperature(p.primary)}<span>${p.primaryLabel.toLowerCase()}${!p.tonight&&finite(p.secondary)?` · ${temperature(p.secondary)} low`:''}</span></div>${dayFeelsHTML(forecast,index,p.tonight)}<div class="dialog-stats"><div><strong>${percent(p.pop)}</strong><small>${p.tonight?'Rain chance tonight':'Rain chance'}</small></div><div><strong>${inches(d.qpf)}</strong><small>${p.tonight?'Forecast rain through morning':'Expected rain'}</small></div></div><p class="dialog-prose">${esc(p.detail || 'More details will appear when the forecast updates.')}</p>${!p.tonight&&d.nightDetail?`<h3 class="dialog-subtitle">Overnight</h3><p class="dialog-prose">${esc(d.nightDetail)}</p>`:''}${dailyGrossHTML(forecast,index,p.tonight)}<a href="#scientific-stuff" class="science-link" id="day-science-link">Scientific stuff ↓</a>`;
  $('day-dialog').showModal();
  $('day-science-link').addEventListener('click',()=>$('day-dialog').close());
}

function setBasemap() {
  if (!map || !window.L) return;
  if (baseLayer) map.removeLayer(baseLayer);
  const selected = $('basemap').value;
  const service = selected === 'satellite' ? 'USGSImageryTopo' : 'USGSTopo';
  const pane = map.getPane('weather-base') || map.createPane('weather-base');
  pane.style.zIndex = '200';
  pane.style.filter = selected === 'dark' ? 'grayscale(1) invert(1) brightness(.7) contrast(.9)' : '';
  baseLayer = window.L.tileLayer(`https://basemap.nationalmap.gov/arcgis/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`, {
    pane: 'weather-base', maxZoom: 16, maxNativeZoom: 16, updateWhenIdle: true,
    attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener noreferrer">USGS The National Map</a> · background map, not live clouds'
  }).addTo(map);
  baseLayer.on('tileerror', () => mapMessage('The USGS background map could not load. Weather-model overlays and official source links remain available.'));
}
function initMap() {
  if (map) return;
  if (!window.L) { mapMessage('The mapping library could not load. Check your connection or use the official radar link.'); return; }
  const L = window.L;
  map = L.map('radar-map', { zoomControl: true, scrollWheelZoom: false }).setView([place.latitude, place.longitude], 8);
  for (const [name,z] of [['weather-base',200],['weather-model',360],['weather-radar',430],['weather-warnings',500]]) {
    const pane=map.getPane(name)||map.createPane(name);pane.style.zIndex=String(z);
  }
  map.getPane('weather-model').style.pointerEvents='none';map.getPane('weather-radar').style.pointerEvents='none';
  setBasemap();
  marker = L.marker([place.latitude, place.longitude], { icon: L.divIcon({ className: 'map-marker', iconSize: [13, 13] }) }).addTo(map);
  warningLayer = L.geoJSON(null, { pane:'weather-warnings', style: { color: '#ffc1b4', weight: 2, fillOpacity: 0.1 }, onEachFeature: (f, layer) => {
    const node = document.createElement('div'); node.textContent = `${f.properties?.event || 'NWS alert'} — ${f.properties?.headline || ''}`; layer.bindPopup(node);
  } }).addTo(map);
  map.on('click', (e) => {
    const box = document.createElement('div'), label = document.createElement('p'), button = document.createElement('button');
    label.textContent = `${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)}`;
    button.textContent = 'Forecast this point'; button.style.cssText = 'background:#cde5ff;color:#183451;border:0;border-radius:6px;padding:7px 10px;cursor:pointer';
    button.addEventListener('click', () => chooseLocation({ name: 'Selected map location', latitude: Number(e.latlng.lat.toFixed(4)), longitude: Number(e.latlng.lng.toFixed(4)), id: '' }));
    box.append(label, button); L.popup().setLatLng(e.latlng).setContent(box).openOn(map);
  });
  if (forecast) renderMapWarnings(forecast);
}
function renderMapWarnings(data) {
  if (!warningLayer) return;
  warningLayer.clearLayers();
  for (const a of data.alerts) if (a.geometry && Date.parse(a.expires) > Date.now()) warningLayer.addData({ type: 'Feature', geometry: a.geometry, properties: { event: a.event, headline: a.headline } });
}
function mapMessage(text) { $('map-error').textContent = text; $('map-error').hidden = !text; }
async function loadRadar() {
  const id = ++radarGeneration;
  lastRadarFetch = Date.now();
  try {
    const data = await api('radar');
    if (id !== radarGeneration) return;
    radarMeta = data; frames = data.frames || [];
    frameIndex = Math.max(0, frames.length-1);
    if (selectedLayer !== 'radar') return;
    configureFrames(frames.length,frameIndex);
    if (!frames.length) { if(radarLayer){map?.removeLayer(radarLayer);radarLayer=null;} $('radar-stamp').textContent='Unavailable'; mapMessage(data.message); return; }
    showFrame(frameIndex);
  } catch { if(id===radarGeneration && selectedLayer==='radar'){stopRadar();mapMessage('Radar timestamps could not be verified. Check the official radar link.');} }
}
function configureFrames(count,index=0) {
  $('radar-time').max=String(Math.max(0,count-1));$('radar-time').value=String(index);$('radar-time').disabled=!count;$('radar-play').disabled=count<2;
}
function showFrame(index) {
  if(selectedLayer!=='radar'||!map||!window.L||!radarMeta||!frames[index])return;
  frameIndex=index;
  if(radarLayer){map.removeLayer(radarLayer);radarLayer.off();}
  const expected=frames[index];
  radarLayer=window.L.tileLayer.wms(radarMeta.url,{pane:'weather-radar',layers:radarMeta.layer,format:'image/png',transparent:true,version:'1.1.1',opacity:.82,time:expected,attribution:'Observed radar © NOAA / NWS',updateWhenIdle:true,keepBuffer:3}).addTo(map);
  $('radar-time').value=String(index);$('radar-stamp').textContent=`${clock(expected)} · loading`;
  const activeRadar=radarLayer;
  radarLayer.on('load',()=>{if(radarLayer===activeRadar&&selectedLayer==='radar'&&frames[frameIndex]===expected){$('radar-stamp').textContent=clock(expected);mapMessage(radarMeta.status==='stale'?'Radar is stale; check its timestamp.':'');}});
  radarLayer.on('tileerror',()=>{if(radarLayer===activeRadar&&selectedLayer==='radar'){stopRadar();mapMessage('A radar tile failed to load. Blank areas do not establish clear weather.');}});
}
function stopRadar(){if(radarTimer)clearInterval(radarTimer);radarTimer=null;$('radar-play').textContent='▶';$('radar-play').setAttribute('aria-label','Play map animation');}
function modelCaption(layer,frame){
  const type=selectedLayer==='hrrr'?'Forecast reflectivity (not observed radar)':selectedLayer==='ecmwf'?'Accumulated precipitation since initialization':selectedLayer==='nbm'?'Interval precipitation':selectedLayer==='temperature'?'2 m temperature':selectedLayer==='wind'?'10 m wind speed':'Total cloud cover';
  const pointRun=forecast?.modelContributions?.find(m=>m.id===layer.model)?.runAt;
  const mismatch=pointRun && Date.parse(pointRun)!==Date.parse(layer.runAt)?' · Map and point forecast have different run times; refresh the forecast.':'';
  const interval=frame.field==='precipitation'?` · ${clock(frame.start,{month:'short',day:'numeric'})} → ${clock(frame.end,{month:'short',day:'numeric'})}`:'';
  const coverage=layer.coverage?` · ${layer.coverage}`:'';
  return `${layer.label} · ${type} · ${frame.units}${interval} · run ${clock(layer.runAt,{month:'short',day:'numeric'})}${coverage}${mismatch}`;
}
async function loadModelMap(force=false){
  const token=++mapSelectionToken,layerName=selectedLayer;
  if(layerName==='radar')return;
  try{
    if(force||!modelCatalog||Date.now()-modelFetched>=55000){modelCatalog=await api('models');modelFetched=Date.now();}
    if(token!==mapSelectionToken||selectedLayer!==layerName)return;
    const layer=modelCatalog.layers[layerName];
    const freshness=$('model-freshness');
    if(freshness){
      freshness.hidden=false;
      freshness.textContent=modelFreshnessText(layer,modelCatalog.checkedAt||new Date(modelFetched).toISOString(),forecast?.location?.timeZone);
      freshness.dataset.delayed=String(layer?.model==='hrrr'&&Date.now()-Date.parse(layer.runAt)>150*60000);
    }
    const previousTime=modelFrames[modelIndex]?.time,previousURL=modelFrames[modelIndex]?.url;
    modelFrames=layer?.frames || [];
    if(framePlayer?.visible && modelFrames.some(f=>f.url===previousURL)){
      modelIndex=modelFrames.findIndex(f=>f.url===previousURL);configureFrames(modelFrames.length,modelIndex);return;
    }
    framePlayer?.clear();modelIndex=0;
    configureFrames(modelFrames.length,0);
    if(!modelFrames.length){mapMessage('No verified current frames are available for this model. Other forecasts remain usable.');$('radar-stamp').textContent='Unavailable';return;}
    const nearest=modelFrames.findIndex(f=>Date.parse(f.time)>=Date.now());modelIndex=Math.max(0,nearest);
    const legend={hrrr:'Forecast reflectivity · 5 / 15 / 25 / 35 / 45 / 55 / 65 dBZ',ecmwf:'Precipitation · 0.05 / 0.1 / 0.25 / 0.5 / 1 / 2 / 4 in',nbm:'Interval precipitation · 0.05 / 0.1 / 0.25 / 0.5 / 1 / 2 / 4 in',temperature:'Temperature · 20 / 32 / 45 / 60 / 75 / 85 / 95 / 105 °F',wind:'Wind speed · 5 / 10 / 15 / 20 / 30 / 40 / 60 mph',clouds:'Cloud cover · 10 / 25 / 50 / 75 / 90%'};
    $('radar-legend').textContent=legend[layerName];
    $('map-source').href=layer.sourceUrl;$('map-source').textContent='Official data source ↗';
    showModelFrame(modelIndex);
  }catch{if(token===mapSelectionToken){configureFrames(0);mapMessage('Model map data could not be loaded. Retry with Refresh.');}}
}
async function showModelFrame(index){
  const f=modelFrames[index],layer=modelCatalog?.layers[selectedLayer];
  if(!f||!layer||!map||selectedLayer==='radar')return false;
  if(!framePlayer)framePlayer=createFramePlayer({map,makeImage:(url,bounds,options,frame)=>frame?.kind==='xyz'
    ? window.L.tileLayer(url,{...options,pane:'weather-model',maxZoom:12,minZoom:1,keepBuffer:3,updateWhenIdle:true})
    : window.L.imageOverlay(url,bounds,{...options,pane:'weather-model'})});
  const name=selectedLayer,token=++modelFrameToken;
  $('radar-time').value=String(index);$('radar-stamp').textContent=`${clock(f.time,{weekday:'short'})} · loading`;
  if(!framePlayer.visible)mapMessage('Loading decoded model data…');
  return framePlayer.show(f,{pane:'weather-model',attribution:layer.model==='ecmwf'?'ECMWF Open Data · CC BY 4.0':layer.provider?`${layer.provider} · NOAA HRRR guidance`:'NOAA model guidance'},{
    loaded:()=>{
      if(token!==modelFrameToken||selectedLayer!==name)return;
      modelIndex=index;
      $('radar-time').value=String(index);$('radar-stamp').textContent=clock(f.time,{weekday:'short'});$('map-caption').textContent=modelCaption(layer,f);
      mapMessage(map.getBounds().intersects(f.bounds)?'':'This model image does not cover the current map view. Pan back toward the selected forecast point.');
    },
    error:()=>{if(token===modelFrameToken&&selectedLayer===name){stopRadar();mapMessage('This frame could not load. The previous image has been cleared; choose another time or refresh.');$('radar-stamp').textContent='Frame unavailable';}}
  });
}
function selectLayer(layer){
  selectedLayer=layer;stopRadar();++mapSelectionToken;++modelFrameToken;
  const freshness=$('model-freshness');if(freshness){freshness.hidden=layer==='radar';freshness.textContent=layer==='radar'?'':'Checking the latest published run…';freshness.dataset.delayed='false';}
  document.querySelectorAll('[data-layer]').forEach(button=>{const active=button.dataset.layer===layer;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  if(radarLayer){map?.removeLayer(radarLayer);radarLayer.off();radarLayer=null;}framePlayer?.clear();
  $('radar-map').hidden=false;$('radar-map').style.display='';$('model-map').hidden=true;$('radar-controls').hidden=false;$('radar-controls').style.display='';$('radar-legend').hidden=false;$('radar-legend').style.display='';
  const official=$('model-official-source');if(official)official.hidden=true;
  mapMessage('');if(!map)initMap();map?.invalidateSize();
  if(layer==='radar'){$('map-source').href='https://radar.weather.gov/';$('map-source').textContent='Official radar ↗';$('map-caption').textContent='NOAA observed reflectivity · past frames only';$('radar-legend').textContent='Observed reflectivity · light → strong';configureFrames(frames.length,frameIndex);if(frames.length)showFrame(frameIndex);else void loadRadar();}
  else{configureFrames(0);void loadModelMap();}
}
function showSelectedFrame(index){if(selectedLayer==='radar')showFrame(index);else showModelFrame(index);}

$('refresh').addEventListener('click', () => { if (!busy) void load({refreshModels:true}); });
document.querySelectorAll('[data-place]').forEach((button) => button.addEventListener('click', () => chooseLocation(presets[button.dataset.place])));
document.querySelectorAll('[data-layer]').forEach((button) => button.addEventListener('click', () => selectLayer(button.dataset.layer)));
$('hourly').addEventListener('click',event=>{const button=event.target.closest('[data-comfort-time]');if(button)selectComfortHour(button.dataset.comfortTime);});
$('daily').addEventListener('click', (event) => { const button = event.target.closest('[data-day]'); if (button) showDay(Number(button.dataset.day)); });
$('close-day').addEventListener('click', () => $('day-dialog').close());
$('day-dialog').addEventListener('click', (e) => { if (e.target === $('day-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
$('expand-briefing').addEventListener('click', () => { const open = $('briefing-detail').hidden; $('briefing-detail').hidden = !open; $('expand-briefing').setAttribute('aria-expanded', String(open)); $('expand-briefing').textContent = open ? 'Less detail ↗' : 'Read full outlook ↗'; });
$('basemap').addEventListener('change', setBasemap);
$('radar-time').addEventListener('input', () => { stopRadar(); showSelectedFrame(Number($('radar-time').value)); });
$('radar-play').addEventListener('click', () => {
  if (radarTimer) return stopRadar();
  if ((selectedLayer==='radar'?frames:modelFrames).length < 2) return;
  $('radar-play').textContent = 'Ⅱ'; $('radar-play').setAttribute('aria-label', 'Pause radar animation');
  radarTimer = setInterval(() => { const count=(selectedLayer==='radar'?frames:modelFrames).length; const index=selectedLayer==='radar'?frameIndex:modelIndex; if(count&&!framePlayer?.loading)showSelectedFrame((index+1)%count); }, 1600);
});
$('fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('map-panel').requestFullscreen(); }
  catch { mapMessage('Fullscreen is not supported in this browser. The interactive map remains available here.'); }
});
document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? '⛶ Collapse' : '⛶ Expand'; setTimeout(() => map?.invalidateSize(), 100); });
let searchTimer;
$('city-search').addEventListener('input', () => {
  clearTimeout(searchTimer); const id = ++searchGeneration, q = $('city-search').value.trim();
  if (q.length < 2) { $('search-results').hidden = true; $('city-search').setAttribute('aria-expanded', 'false'); return; }
  searchTimer = setTimeout(async () => {
    try {
      const data = await api('search', new URLSearchParams({ q }));
      if (id !== searchGeneration) return;
      const box = $('search-results'); box.replaceChildren();
      for (const result of data.results) { const button = document.createElement('button'); button.type = 'button'; button.textContent = result.name; button.addEventListener('click', () => chooseLocation(result)); box.appendChild(button); }
      if (!data.results.length) { const p = document.createElement('p'); p.textContent = 'No matching U.S. cities found.'; box.appendChild(p); }
      box.hidden = false; $('city-search').setAttribute('aria-expanded', 'true');
    } catch { if (id === searchGeneration) { $('search-results').innerHTML = '<p>Location search is unavailable. Use a saved location.</p>'; $('search-results').hidden = false; } }
  }, 400);
});
$('city-search').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('search-results').hidden = true; $('city-search').setAttribute('aria-expanded', 'false'); } if (e.key === 'ArrowDown') { e.preventDefault(); $('search-results').querySelector('button')?.focus(); } if (e.key === 'Enter') $('search-results').querySelector('button')?.click(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) { $('search-results').hidden = true; $('city-search').setAttribute('aria-expanded', 'false'); } });
$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) { $('status').textContent = 'Browser location is not available. Search for a city instead.'; return; }
  $('status').textContent = 'Waiting for your browser’s location permission…';
  navigator.geolocation.getCurrentPosition((p) => chooseLocation({ id: '', name: 'My location', latitude: Number(p.coords.latitude.toFixed(3)), longitude: Number(p.coords.longitude.toFixed(3)) }), () => { $('status').textContent = 'Location access was unavailable. Use city search or a saved location.'; }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stopRadar(); else if (!busy) void load(); });
// The site refreshes while open; this is not a push-alert system or background task.
setInterval(() => { if (!document.hidden && !busy) void load(); }, 60000);
installExperience();
readSaved();
void load({ moveMap: true });
