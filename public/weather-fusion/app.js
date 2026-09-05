/* Weather Fusion browser client. Forecast values never originate in AI prose. */
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
function icon(condition = '', isDay = true, size = 32) {
  const text = String(condition).toLowerCase();
  const storm = /thunder|storm/.test(text), snow = /snow|sleet|flurr/.test(text), rain = /rain|shower|drizzle/.test(text), fog = /fog|mist|haze/.test(text), cloudy = /cloud|overcast/.test(text);
  const sun = '<circle cx="18" cy="17" r="8" fill="#ffda8c"/><g stroke="#ffda8c" stroke-width="2" stroke-linecap="round"><path d="M18 3v3M18 28v3M4 17h3M29 17h3M8 7l2 2M26 25l2 2M8 27l2-2M26 9l2-2"/></g>';
  const moon = '<path d="M27 6A13 13 0 1 0 36 27 14 14 0 0 1 27 6" fill="#e6eaf5"/>';
  const cloud = '<path d="M10 32a8 8 0 0 1-1-16 12 12 0 0 1 22-4 9 9 0 1 1 5 20Z" fill="#e4edf8"/><path d="M10 32h26a9 9 0 0 0 7-3H7a8 8 0 0 0 3 3" fill="#c6d9ed"/>';
  let shapes = '';
  if (storm) shapes = cloud + '<path d="m23 31-5 10h6l-2 7 11-14h-7l3-5" fill="#ffdd83"/>';
  else if (snow) shapes = cloud + '<g fill="#c4e7ff"><circle cx="14" cy="39" r="2"/><circle cx="26" cy="42" r="2"/><circle cx="37" cy="38" r="2"/></g>';
  else if (rain) shapes = cloud + '<g stroke="#9dcffe" stroke-width="2.7" stroke-linecap="round"><path d="m14 37-2 5M25 37l-2 5M36 37l-2 5"/></g>';
  else if (fog) shapes = cloud + '<g stroke="#c6d8ef" stroke-width="2" stroke-linecap="round"><path d="M9 38h29M13 43h21"/></g>';
  else if (cloudy) shapes = (/partly|mostly sunny|few/.test(text) ? (isDay ? sun : moon) : '') + cloud;
  else if (!text || /unavailable|loading/.test(text)) shapes = '<path d="M12 29h25" stroke="#a3bad6" stroke-width="3" stroke-linecap="round"/>';
  else shapes = isDay ? `<g transform="translate(7 7)">${sun}</g>` : moon;
  return `<svg width="${size}" height="${size}" viewBox="0 0 50 50" aria-hidden="true">${shapes}</svg>`;
}
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
  const c = data.current, d = data.days[0], day = isDaylight();
  document.body.dataset.sky = !day ? 'night' : /rain|storm|shower/i.test(c.condition) ? 'rain' : 'day';
  $('city-name').textContent = presets[place.id]?.name || data.location.name || place.name;
  $('hero-date').textContent = new Intl.DateTimeFormat('en-US', { timeZone: data.location.timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
  $('temperature').innerHTML = `${number(c.temperature)}<span>°</span>`;
  $('condition').textContent = c.condition || 'Current conditions unavailable';
  $('high-low').innerHTML = `High ${temperature(d.high)} <span>Low ${temperature(d.low)}</span>`;
  $('observation-label').textContent = c.type === 'observation' ? `Observed at ${c.station} · ${clock(c.time)} · nearby station, not your exact address` : 'Current observation unavailable · showing forecast guidance';
  $('hero-scene').innerHTML = icon(c.condition, day, 120);
  document.querySelectorAll('[data-place]').forEach((button) => { const active = button.dataset.place === place.id; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  renderAlerts(data);
  renderHours(data);
  renderDays(data);
  renderMetrics(data);
  renderEvidence(data);
  if (currentBriefing?.signature !== data.signature) {
    renderBriefing({ mode: 'nws-summary', signature: data.signature, headline: d.condition, summary: d.detail || 'The official forecast is temporarily unavailable.', nearTerm: d.nightDetail, extended: data.days[1]?.detail,
      uncertainty: 'Available model comparisons are shown in the daily details. Agreement is not a guarantee.', reason: data.aiConfigured ? 'Updating AI synthesis from the latest source forecast…' : 'AI is not configured. Showing the official NWS text.', sources: ['nws'] });
  }
  if (map) { marker?.setLatLng([place.latitude, place.longitude]); renderMapWarnings(data); }
  const unavailable = data.feeds.filter((f) => ['unavailable', 'stale', 'not-configured'].includes(f.status));
  $('status').textContent = `Checked ${clock(data.assembledAt)} · ${unavailable.length ? `${unavailable.length} source${unavailable.length === 1 ? '' : 's'} limited — see feed health` : 'Source feeds available'} · °F / mph / inches`;
  $('status').classList.toggle('error', unavailable.length > 0);
}
function renderAlerts(data) {
  const status = data.feeds.find((f) => f.id === 'alerts')?.status;
  const cards = data.alerts.filter((a) => Date.parse(a.expires) > Date.now()).map((a) => {
    const source = /^https:\/\/api\.weather\.gov\//.test(a.id || '') ? a.id : 'https://www.weather.gov/';
    return `<details class="alert-card ${['Extreme', 'Severe'].includes(a.severity) ? 'urgent' : ''}"><summary>⚠ ${esc(a.event)} · ${esc(a.headline || a.areaDesc)}</summary><p>${esc(a.description)}</p><p><strong>${esc(a.instruction || 'Follow the official NWS guidance.')}</strong></p><p>Issued ${esc(clock(a.sent))} · expires ${esc(clock(a.expires))}</p><a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Original NWS alert ↗</a></details>`;
  });
  $('alerts').innerHTML = status !== 'ready' ? '<p class="alert-note warning">Alert feed unavailable or stale. The absence of an alert here does not mean there are no warnings. Check weather.gov.</p>' + cards.join('') : cards.length ? cards.join('') : '<p class="alert-note">No active NWS alerts returned for this point at the last check. Conditions can change.</p>';
}
function renderHours(data) {
  const position = $('hourly').scrollLeft;
  $('hourly').innerHTML = data.hours.length ? data.hours.map((h, i) => `<div class="hour ${i === 0 ? 'now' : ''}" title="${esc(h.condition)} · NWS rain chance ${percent(h.pop)} · ${esc(h.wind)} ${esc(h.windDirection)}"><span>${i === 0 ? 'Now' : esc(shortHour(h.time))}</span>${icon(h.condition, h.isDay)}<strong>${temperature(h.temperature)}</strong><small>${finite(h.pop) ? percent(h.pop) : '—'}</small></div>`).join('') : '<p class="muted">Official hourly guidance is unavailable. No substitute forecast has been invented.</p>';
  $('hourly').scrollLeft = position;
}
function renderDays(data) {
  const valid = data.days.flatMap((d) => [d.high, d.low]).filter(finite);
  const low = valid.length ? Math.min(...valid) : 0, high = valid.length ? Math.max(...valid) : 1, range = Math.max(1, high - low);
  $('daily').innerHTML = data.days.map((d, i) => {
    const left = finite(d.low) ? Math.max(0, Math.min(100, (d.low - low) / range * 100)) : 0;
    const width = finite(d.high) && finite(d.low) ? Math.max(2, Math.min(100 - left, (d.high - d.low) / range * 100)) : 0;
    return `<button class="day-row" data-day="${i}" aria-label="${esc(d.label)}, ${esc(d.condition)}, high ${number(d.high)}, low ${number(d.low)}, NWS rain chance ${percent(d.pop)}. Open details."><span class="day-name">${esc(d.label)}</span><span class="day-icon">${icon(d.condition)}<small>${finite(d.pop) ? percent(d.pop) : '—'}</small></span><span class="day-low">${temperature(d.low)}</span><span class="temp-track"><span class="temp-fill" style="left:${left}%;width:${width}%"></span></span><span class="day-high">${temperature(d.high)}</span></button>`;
  }).join('');
}
function compass(degrees) {
  return finite(degrees) ? ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(degrees / 22.5) % 16] : 'Direction unavailable';
}
function renderMetrics(data) {
  const c = data.current, d = data.days[0];
  const card = (title, type, value, note, extra = '', cls = '') => `<article class="glass metric ${cls}"><h2>${smallIcon(type)}${title}</h2><div class="metric-value">${value}</div>${extra}<p>${esc(note)}</p></article>`;
  $('metrics').innerHTML = [
    card('FEELS LIKE', 'temp', temperature(c.apparent), c.apparentSource || 'Feels-like calculation unavailable.'),
    card('PRECIPITATION', 'drop', finite(data.precipitation?.value) ? `${number(data.precipitation.value, 2)}<small>in</small>` : '—', `Next 24 hours from ${clock(data.precipitation?.start)} · ${data.precipitation?.source || 'Unavailable'}. Forecast liquid equivalent.`),
    card('WIND', 'wind', `${number(c.wind)}<small>mph</small>`, `${compass(c.windDirection)} · ${c.type === 'observation' ? 'station observation' : 'model guidance'}`, `<div class="tiny-value">Gusts ${finite(c.gust) ? `${number(c.gust)} mph` : 'unavailable'}</div>${finite(c.windDirection) ? `<div class="compass" aria-hidden="true"><span class="north">N</span><div class="needle" style="transform:rotate(${c.windDirection}deg)"></div></div>` : ''}`, 'metric-wind'),
    card('HUMIDITY', 'drop', `${number(c.humidity)}<small>%</small>`, `Dew point ${temperature(c.dewpoint)} · ${c.type === 'observation' ? 'nearby station' : 'model guidance'}`, `<div class="mini-track" aria-hidden="true"><div style="width:${finite(c.humidity) ? Math.max(0, Math.min(100, c.humidity)) : 0}%"></div></div>`),
    card('RAIN CHANCE', 'drop', percent(d.pop), `NWS day ${percent(d.popDay)} · night ${percent(d.popNight)}. Highest period shown, not a combined daily probability.`),
    card('VISIBILITY', 'eye', `${number(c.visibility, 1)}<small>mi</small>`, finite(c.visibility) ? 'Latest available nearby station observation.' : 'The observation feed did not supply visibility.'),
    card('PRESSURE', 'gauge', `${number(c.pressure, 2)}<small>inHg</small>`, finite(c.pressure) ? 'Station barometric pressure. No trend is inferred from one reading.' : 'Station pressure is currently unavailable.'),
    card('SUNSET', 'sun', data.solar.sunset ? esc(clock(data.solar.sunset)) : '—', data.solar.sunrise ? `Sunrise ${clock(data.solar.sunrise)} · calculated local time.` : 'Astronomical times are temporarily unavailable.', data.solar.sunset ? '<div class="sun-arc" aria-hidden="true"></div>' : '', 'metric-sun'),
  ].join('');
}
function renderEvidence(data) {
  const important = ['nws', 'afd', 'hrrr', 'ecmwf', 'nbm', 'alerts'];
  const labels = { nws: 'NWS', afd: 'Local discussion', hrrr: 'HRRR', ecmwf: 'ECMWF IFS', nbm: 'National Blend', alerts: 'Alerts' };
  const names = { ready: 'Available', unavailable: 'Unavailable', stale: 'Stale — excluded', 'not-covered': 'NWS-only location' };
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
  $('ai-label').textContent = data.mode === 'ai' ? 'AI + NUMERICAL MODELS' : 'OFFICIAL NWS TEXT';
  const refs = (data.sources || []).filter((id) => ['nws', 'afd', 'hrrr', 'ecmwf', 'nbm'].includes(id)).map((id) => {
    const f = forecast?.feeds.find((s) => s.id === id);
    const url = id === 'afd' ? forecast?.discussion?.url : f?.url;
    return url && /^https:\/\/(api\.weather\.gov|www\.nco\.ncep\.noaa\.gov|www\.ecmwf\.int)\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(f?.label || id)} ↗</a>` : esc(f?.label || id);
  });
  $('briefing-detail').innerHTML = `<div><strong>Tonight & near term</strong><p>${esc(data.nearTerm || 'See the official hourly forecast below.')}</p></div><div><strong>Looking ahead</strong><p>${esc(data.extended || 'Extended details are currently unavailable.')}</p></div><div><strong>Confidence & uncertainty</strong><p>${esc(data.uncertainty || '')}</p></div><div><strong>Sources used</strong><p>${refs.join(' · ')}</p></div>`;
  $('briefing-stamp').textContent = data.mode === 'ai' ? `AI synthesis · ${clock(data.generatedAt)} · checked against this forecast’s source signature` : data.reason || 'Official NWS wording; not an AI-generated forecast.';
}
async function load({ moveMap = false } = {}) {
  const id = ++generation;
  requestController?.abort();
  requestController = new AbortController();
  busy = true; $('refresh').classList.add('loading');
  $('status').textContent = 'Checking the latest source forecasts…';
  try {
    const data = await api('forecast', query(), requestController.signal);
    if (id !== generation) return;
    render(data);
    if (!map) initMap();
    if (moveMap && map) map.setView([place.latitude, place.longitude], 8);
    if (selectedLayer !== 'radar' && (moveMap || Date.now()-modelFetched > 120000)) void loadModelMap();
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
    $('status').textContent = `Weather update failed. ${forecast ? `The displayed snapshot was checked at ${clock(forecast.assembledAt)} and may be stale.` : 'Please retry or check weather.gov.'}`;
    $('status').classList.add('error');
    $('alerts').innerHTML = '<p class="alert-note warning">Live alert status could not be checked. Consult the official NWS forecast and warnings.</p>';
  } finally { if (id === generation) { busy = false; $('refresh').classList.remove('loading'); } }
}
function chooseLocation(value) {
  place = { ...value };
  currentBriefing = null;
  // Clear the previous location immediately, including its alerts and AI text.
  forecast = null;
  $('city-name').textContent = value.name;
  $('temperature').innerHTML = '—<span>°</span>';
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
  const d = forecast?.days[index];
  if (!d) return;
  const names = { hrrr: 'NOAA HRRR', ecmwf: 'ECMWF IFS · 0.25°', nbm: 'NOAA National Blend' };
  const modelRows = Object.entries(d.guidance).map(([id,v])=>`<tr><td>${names[id] || esc(id)}</td><td>${temperature(v.high)} / ${temperature(v.low)}</td><td>${inches(v.qpf)}</td><td>${finite(v.gust)?`${number(v.gust)} mph`:'—'}</td></tr>`).join('');
  const weights = (blend) => (blend?.sources || []).map(x=>`${x.id.toUpperCase()} ${Math.round(x.weight*100)}%`).join(' / ') || 'Unavailable';
  $('day-content').innerHTML = `<div class="dialog-eyebrow">${esc(d.date)} · Weather Fusion</div><h2 id="day-title" class="dialog-title">${esc(d.label==='Today'?'Today & tonight':d.label)}</h2><p class="dialog-condition">${esc(d.condition)}</p><div class="dialog-temps">${temperature(d.high)}<span>${temperature(d.low)}</span></div><div class="dialog-stats"><div><strong>${percent(d.popDay)} / ${percent(d.popNight)}</strong><small>Official NWS chance · day / night</small></div><div><strong>${inches(d.qpf)}</strong><small>${esc(d.qpfWindowLabel || 'Forecast window')}</small></div></div><p class="dialog-prose"><strong>Official NWS detail:</strong> ${esc(d.detail || 'Unavailable')}</p>${d.nightDetail && d.nightDetail!==d.detail?`<p class="dialog-prose"><strong>Tonight:</strong> ${esc(d.nightDetail)}</p>`:''}<h3 class="dialog-subtitle">Source comparison · ${esc(d.agreement)}</h3><table class="comparison"><thead><tr><th>Source</th><th>High / low</th><th>Precipitation</th><th>Peak gust</th></tr></thead><tbody><tr><td><strong>Weather Fusion</strong></td><td>${temperature(d.high)} / ${temperature(d.low)}</td><td>${inches(d.qpf)}</td><td>—</td></tr><tr><td>NWS official</td><td>${temperature(d.official?.high)} / ${temperature(d.official?.low)}</td><td>${inches(d.qpfBlend?.sourceValues?.nws)}</td><td>—</td></tr>${modelRows}</tbody></table><p class="table-note"><strong>Temperature blend:</strong> high ${esc(weights(d.highBlend))}; low ${esc(weights(d.lowBlend))}.</p><p class="table-note"><strong>Precipitation blend:</strong> ${esc(d.qpfSource)}. ${esc(clock(d.qpfWindow.start,{month:'short',day:'numeric'}))} → ${esc(clock(d.qpfWindow.end,{month:'short',day:'numeric'}))}.</p><p class="table-note">Model temperatures are aligned to NWS daytime / overnight forecast periods. Missing coverage is not zero. Coarse model precipitation intervals are prorated at window boundaries. These are forecast values, not measured accumulation.</p><p class="table-note">Starting blend weights are uncalibrated; model agreement is not an accuracy probability. Official NWS rain probability and warnings remain separate.</p>`;
  $('day-dialog').showModal();
}
function setBasemap() {
  if (!map || !window.L) return;
  if (baseLayer) map.removeLayer(baseLayer);
  const selected = $('basemap').value;
  const options = selected === 'satellite' ? ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Imagery © Esri, Maxar, Earthstar Geographics · background imagery, not live clouds'] : selected === 'street' ? ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© OpenStreetMap contributors'] : ['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', '© OpenStreetMap contributors © CARTO'];
  baseLayer = window.L.tileLayer(options[0], { maxZoom: 16, attribution: options[1], zIndex: 0 }).addTo(map);
  baseLayer.on('tileerror', () => mapMessage('The base map could not load. Weather feeds and official source links remain available.'));
}
function initMap() {
  if (map) return;
  if (!window.L) { mapMessage('The mapping library could not load. Check your connection or use the official radar link.'); return; }
  const L = window.L;
  map = L.map('radar-map', { zoomControl: true, scrollWheelZoom: false }).setView([place.latitude, place.longitude], 8);
  setBasemap();
  marker = L.marker([place.latitude, place.longitude], { icon: L.divIcon({ className: 'map-marker', iconSize: [13, 13] }) }).addTo(map);
  warningLayer = L.geoJSON(null, { style: { color: '#ffc1b4', weight: 2, fillOpacity: 0.1 }, onEachFeature: (f, layer) => {
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
  if(radarLayer)map.removeLayer(radarLayer);
  const expected=frames[index];
  radarLayer=window.L.tileLayer.wms(radarMeta.url,{layers:radarMeta.layer,format:'image/png',transparent:true,version:'1.1.1',opacity:.72,time:expected,zIndex:200,attribution:'Observed radar © NOAA / NWS',updateWhenIdle:true}).addTo(map);
  $('radar-time').value=String(index);$('radar-stamp').textContent=`${clock(expected)} · loading`;
  radarLayer.on('load',()=>{if(selectedLayer==='radar'&&frames[frameIndex]===expected){$('radar-stamp').textContent=clock(expected);mapMessage(radarMeta.status==='stale'?'Radar is stale; check its timestamp.':'');}});
  radarLayer.on('tileerror',()=>{if(selectedLayer==='radar'){stopRadar();mapMessage('A radar tile failed to load. Blank areas do not establish clear weather.');}});
}
function stopRadar(){if(radarTimer)clearInterval(radarTimer);radarTimer=null;$('radar-play').textContent='▶';$('radar-play').setAttribute('aria-label','Play map animation');}
function modelCaption(layer,frame){
  const type=selectedLayer==='hrrr'?'Forecast reflectivity (not observed radar)':selectedLayer==='ecmwf'?'Accumulated precipitation since initialization':selectedLayer==='nbm'?'Interval precipitation':selectedLayer==='temperature'?'2 m temperature':selectedLayer==='wind'?'10 m wind speed':'Total cloud cover';
  const pointRun=forecast?.modelContributions?.find(m=>m.id===layer.model)?.runAt;
  const mismatch=pointRun && Date.parse(pointRun)!==Date.parse(layer.runAt)?' · Map and point forecast have different run times; refresh the forecast.':'';
  const interval=frame.field==='precipitation'?` · ${clock(frame.start,{month:'short',day:'numeric'})} → ${clock(frame.end,{month:'short',day:'numeric'})}`:'';
  return `${layer.label} · ${type} · ${frame.units}${interval} · run ${clock(layer.runAt,{month:'short',day:'numeric'})}${mismatch}`;
}
async function loadModelMap(){
  const token=++mapSelectionToken,layerName=selectedLayer;
  if(layerName==='radar')return;
  try{
    if(!modelCatalog||Date.now()-modelFetched>120000){modelCatalog=await api('models');modelFetched=Date.now();}
    if(token!==mapSelectionToken||selectedLayer!==layerName)return;
    const layer=modelCatalog.layers[layerName];modelFrames=layer?.frames || [];modelIndex=0;
    configureFrames(modelFrames.length,0);
    if(!modelFrames.length){mapMessage('No verified current frames are available for this model. Other forecasts remain usable.');$('radar-stamp').textContent='Unavailable';return;}
    const nearest=modelFrames.findIndex(f=>Date.parse(f.time)>=Date.now());modelIndex=Math.max(0,nearest);
    const legend={hrrr:'Forecast reflectivity · 5 / 15 / 25 / 35 / 45 / 55 / 65 dBZ',ecmwf:'Precipitation · 0.05 / 0.1 / 0.25 / 0.5 / 1 / 2 / 4 in',nbm:'Interval precipitation · 0.05 / 0.1 / 0.25 / 0.5 / 1 / 2 / 4 in',temperature:'Temperature · 20 / 32 / 45 / 60 / 75 / 85 / 95 / 105 °F',wind:'Wind speed · 5 / 10 / 15 / 20 / 30 / 40 / 60 mph',clouds:'Cloud cover · 10 / 25 / 50 / 75 / 90%'};
    $('radar-legend').textContent=legend[layerName];
    $('map-source').href=layer.sourceUrl;$('map-source').textContent='Official data source ↗';
    showModelFrame(modelIndex);
  }catch{if(token===mapSelectionToken){configureFrames(0);mapMessage('Model map data could not be loaded. Retry with Refresh.');}}
}
function showModelFrame(index){
  const f=modelFrames[index],layer=modelCatalog?.layers[selectedLayer];
  if(!f||!layer||!map||selectedLayer==='radar')return;
  modelIndex=index;const token=++modelFrameToken;
  $('radar-time').value=String(index);$('radar-stamp').textContent=`${clock(f.time,{weekday:'short'})} · loading`;
  mapMessage('Loading decoded model data…');
  const image=window.L.imageOverlay(f.url,f.bounds,{opacity:1,zIndex:200,attribution:layer.model==='ecmwf'?'ECMWF Open Data · CC BY 4.0':'NOAA model guidance'});
  const previous=modelLayer;modelLayer=image;
  image.on('load',()=>{
    if(token!==modelFrameToken){map.removeLayer(image);return;}
    if(previous)map.removeLayer(previous);
    $('radar-stamp').textContent=clock(f.time,{weekday:'short'});$('map-caption').textContent=modelCaption(layer,f);
    mapMessage(map.getBounds().intersects(f.bounds)?'':'Model image covers North Carolina and the surrounding region. Pan back to the saved locations.');
  });
  image.on('error',()=>{if(token===modelFrameToken){stopRadar();map.removeLayer(image);if(previous)map.removeLayer(previous);modelLayer=null;mapMessage('This model image did not load. Choose another frame or refresh.');}});
  image.addTo(map);
}
function selectLayer(layer){
  selectedLayer=layer;stopRadar();++mapSelectionToken;++modelFrameToken;
  document.querySelectorAll('[data-layer]').forEach(button=>{const active=button.dataset.layer===layer;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  if(radarLayer){map?.removeLayer(radarLayer);radarLayer=null;}if(modelLayer){map?.removeLayer(modelLayer);modelLayer=null;}
  $('radar-map').hidden=false;$('radar-map').style.display='';$('model-map').hidden=true;$('radar-controls').hidden=false;$('radar-controls').style.display='';$('radar-legend').hidden=false;$('radar-legend').style.display='';
  const official=$('model-official-source');if(official)official.hidden=true;
  mapMessage('');if(!map)initMap();map?.invalidateSize();
  if(layer==='radar'){$('map-source').href='https://radar.weather.gov/';$('map-source').textContent='Official radar ↗';$('map-caption').textContent='NOAA observed reflectivity · past frames only';$('radar-legend').textContent='Observed reflectivity · light → strong';configureFrames(frames.length,frameIndex);if(frames.length)showFrame(frameIndex);else void loadRadar();}
  else{configureFrames(0);void loadModelMap();}
}
function showSelectedFrame(index){if(selectedLayer==='radar')showFrame(index);else showModelFrame(index);}

$('refresh').addEventListener('click', () => { if (!busy) void load(); });
document.querySelectorAll('[data-place]').forEach((button) => button.addEventListener('click', () => chooseLocation(presets[button.dataset.place])));
document.querySelectorAll('[data-layer]').forEach((button) => button.addEventListener('click', () => selectLayer(button.dataset.layer)));
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
  radarTimer = setInterval(() => { const count=(selectedLayer==='radar'?frames:modelFrames).length; const index=selectedLayer==='radar'?frameIndex:modelIndex; if(count)showSelectedFrame((index+1)%count); }, 1600);
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
readSaved();
void load({ moveMap: true });
