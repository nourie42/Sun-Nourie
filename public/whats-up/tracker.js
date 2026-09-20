import { weatherIcon } from '/weather-fusion/weather-display.js?v=whats-up-ui-v2';

const STORAGE_KEY = 'whats-up-zip';

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const byId = (id) => document.getElementById(id);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function setStatus(message, isError = false) {
  const status = byId('status');
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function normalizeZip(value) {
  const digits = String(value || '').trim().match(/^(\d{5})(?:-\d{4})?$/);
  return digits ? digits[1] : null;
}

function rangeText(min, max, suffix = '') {
  if (!finite(min) && !finite(max)) return '—';
  if (!finite(max) || min === max) return `${finite(min) ? min : max}${suffix}`;
  return `${min}–${max}${suffix}`;
}

function weatherLine(window) {
  if (!window) return '';
  return [
    rangeText(window.temperatureMin, window.temperatureMax, '°'),
    finite(window.dewpointMin) || finite(window.dewpointMax) ? `dew ${rangeText(window.dewpointMin, window.dewpointMax, '°')}` : '',
    finite(window.windMin) || finite(window.windMax) ? `${rangeText(window.windMin, window.windMax, ' mph')}` : '',
    window.condition || window.sky || '',
    finite(window.rainPeak ?? window.peakChance) ? `${Math.round(window.rainPeak ?? window.peakChance)}% rain` : '',
  ].filter(Boolean).join(' · ');
}

function skeletons() {
  return `
    <section class="glass briefing skeleton-card" aria-hidden="true">
      <div class="skeleton-line wide loading-shimmer"></div>
      <div class="skeleton-line mid loading-shimmer"></div>
      <div class="skeleton-line short loading-shimmer"></div>
    </section>
    <section class="glass day-card skeleton-card" aria-hidden="true">
      <div class="skeleton-line mid loading-shimmer"></div>
      <div class="skeleton-line wide loading-shimmer"></div>
    </section>`;
}

function pathFrom(points, getY) {
  let drawing = false;
  return points.map((point) => {
    if (!finite(point.value)) {
      drawing = false;
      return '';
    }
    const command = `${drawing ? 'L' : 'M'}${point.x.toFixed(1)},${getY(point.value).toFixed(1)}`;
    drawing = true;
    return command;
  }).join(' ');
}

function chartSvg(hours, { title, kind }) {
  if (!hours.length) return '';
  const width = 640;
  const height = kind === 'rain' ? 108 : 168;
  const left = 36;
  const right = 16;
  const top = 18;
  const bottom = 26;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const xs = hours.map((_, index) => left + (index / Math.max(1, hours.length - 1)) * innerW);
  const bands = hours.map((hour, index) => {
    if (!hour.perfect && !hour.storm) return '';
    const start = index === 0 ? xs[0] : (xs[index - 1] + xs[index]) / 2;
    const end = index === hours.length - 1 ? xs[index] : (xs[index] + xs[index + 1]) / 2;
    const fill = hour.perfect ? 'rgba(255,220,149,.16)' : 'rgba(255,175,176,.18)';
    return `<rect x="${start.toFixed(1)}" y="${top}" width="${Math.max(1, end - start).toFixed(1)}" height="${innerH}" fill="${fill}"></rect>`;
  }).join('');
  const ticks = [0, Math.floor((hours.length - 1) / 2), hours.length - 1]
    .filter((value, index, all) => all.indexOf(value) === index)
    .map((index) => `<text x="${xs[index].toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(hours[index].label)}</text>`)
    .join('');

  if (kind === 'rain') {
    const barW = Math.max(4, innerW / hours.length * 0.62);
    const bars = hours.map((hour, index) => {
      const chance = finite(hour.rainChance) ? Math.max(0, Math.min(100, hour.rainChance)) : 0;
      const barH = (chance / 100) * innerH;
      const fill = chance >= 90 ? '#ffafb0' : chance >= 75 ? '#ffd38a' : '#71d7ff';
      return `<rect x="${(xs[index] - barW / 2).toFixed(1)}" y="${(top + innerH - barH).toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="2" fill="${fill}"></rect>`;
    }).join('');
    return `<figure class="day-chart">
      <figcaption>${esc(title)}</figcaption>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">${bands}${[0, 50, 100].map((value) => {
        const y = top + innerH - (value / 100) * innerH;
        return `<path d="M${left} ${y.toFixed(1)} H${width - right}" stroke="currentColor" opacity=".14"/><text x="4" y="${(y + 4).toFixed(1)}">${value}</text>`;
      }).join('')}${bars}${ticks}</svg>
    </figure>`;
  }

  const series = [
    { key: 'temperature', color: '#ffcd79', values: hours.map((hour) => hour.temperature) },
    { key: 'dewpoint', color: '#83e3cc', values: hours.map((hour) => hour.dewpoint) },
  ];
  const values = series.flatMap((row) => row.values).filter(finite);
  const low = values.length ? Math.floor((Math.min(...values) - 4) / 5) * 5 : 40;
  const high = values.length ? Math.max(low + 15, Math.ceil((Math.max(...values) + 4) / 5) * 5) : 90;
  const y = (value) => top + innerH - ((value - low) / Math.max(1, high - low)) * innerH;
  const lines = series.map((row) => {
    const points = row.values.map((value, index) => ({ x: xs[index], value }));
    return `<path d="${pathFrom(points, y)}" fill="none" stroke="${row.color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>`;
  }).join('');
  return `<figure class="day-chart">
    <figcaption>${esc(title)} <span><i class="swatch temp"></i> Temp <i class="swatch dew"></i> Dewpoint</span></figcaption>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">${bands}${[0, 0.5, 1].map((stop) => {
      const value = low + (high - low) * stop;
      const yPos = y(value);
      return `<path d="M${left} ${yPos.toFixed(1)} H${width - right}" stroke="currentColor" opacity=".14"/><text x="4" y="${(yPos + 4).toFixed(1)}">${Math.round(value)}°</text>`;
    }).join('')}${lines}${ticks}</svg>
  </figure>`;
}

function windowCard(window, kind) {
  if (!window) {
    return `<article class="glass summary-stat empty">
      <div class="eyebrow">${kind === 'perfect' ? 'NEXT PLEASANT STRETCH' : 'NEXT STORMY STRETCH'}</div>
      <strong>None in the hourly forecast</strong>
    </article>`;
  }
  const icon = weatherIcon(window.condition || window.sky, window.isDay !== false, 42);
  const stormNote = kind === 'storm'
    ? (window.level === 'definite' ? 'Stormy' : 'Wet stretch')
    : 'Pleasant';
  return `<article class="glass summary-stat ${kind}">
    <div class="eyebrow">${kind === 'perfect' ? 'NEXT PLEASANT STRETCH' : 'NEXT STORMY STRETCH'}</div>
    <div class="window-head">${icon}<div>
      <strong>${esc(`${window.dayLabel ? `${window.dayLabel} · ` : ''}${window.label}`)}</strong>
      <span>${esc(stormNote)}${window.condition ? ` · ${esc(window.condition)}` : ''}</span>
    </div></div>
    <dl class="weather-metrics">
      <div><dt>Temp</dt><dd>${esc(rangeText(window.temperatureMin, window.temperatureMax, '°'))}</dd></div>
      <div><dt>Dewpoint</dt><dd>${esc(rangeText(window.dewpointMin, window.dewpointMax, '°'))}</dd></div>
      <div><dt>Wind</dt><dd>${esc(rangeText(window.windMin, window.windMax, ' mph'))}</dd></div>
      <div><dt>Rain</dt><dd>${finite(window.rainPeak ?? window.peakChance) ? `${Math.round(window.rainPeak ?? window.peakChance)}%` : '—'}</dd></div>
    </dl>
  </article>`;
}

function outlook(data) {
  const hours = data.days.flatMap((day) => day.hours).slice(0, 36);
  return `
    <section class="glass briefing outlook-card" aria-labelledby="outlook-title">
      <div class="section-top"><h2 id="outlook-title">AT A GLANCE</h2><span class="pill">${esc(data.status.nws === 'ready' ? 'NWS' : 'NWS OFFLINE')}</span></div>
      <h3>${esc(data.summary.headline)}</h3>
      <p>${esc(data.summary.detail || weatherLine(data.summary.nextPerfect || data.summary.nextStorm))}</p>
    </section>
    <div class="summary-grid">
      ${windowCard(data.summary.nextPerfect, 'perfect')}
      ${windowCard(data.summary.nextStorm, 'storm')}
    </div>
    ${hours.length ? `<section class="glass day-card outlook-charts" aria-label="Next hours">
      ${chartSvg(hours, { title: 'Temperature and dewpoint', kind: 'temp' })}
      ${chartSvg(hours, { title: 'Rain chance', kind: 'rain' })}
    </section>` : ''}`;
}

function dayWindows(windows, kind) {
  if (!windows.length) return '';
  return `<div class="window-list">${windows.map((window) => `
    <article class="window-chip ${kind}${window.level === 'definite' ? ' definite' : ''}">
      ${weatherIcon(window.condition || window.sky, window.isDay !== false, 28)}
      <div>
        <b>${esc(window.label)}</b>
        <small>${esc(weatherLine(window))}</small>
      </div>
    </article>`).join('')}</div>`;
}

function hourStrip(hours) {
  if (!hours.length) return '<p class="empty-windows">Hourly numbers are not available for this day.</p>';
  return `<div class="hour-strip" tabindex="0" aria-label="Hourly weather">${hours.map((hour) => {
    const cls = hour.perfect ? ' perfect' : hour.storm ? ` storm ${hour.storm}` : '';
    return `<div class="hour-chip${cls}">
      <span>${esc(hour.label)}</span>
      ${weatherIcon(hour.condition || hour.sky, hour.isDay !== false, 30)}
      <strong>${finite(hour.temperature) ? `${hour.temperature}°` : '—'}</strong>
      <small>dew ${finite(hour.dewpoint) ? `${hour.dewpoint}°` : '—'}</small>
      <small>${finite(hour.windMph) ? `${Math.round(hour.windMph)} mph` : '—'}</small>
      <small>${finite(hour.rainChance) ? `${Math.round(hour.rainChance)}%` : '—'} rain</small>
    </div>`;
  }).join('')}</div>`;
}

function dayCard(day) {
  const high = finite(day.high) ? `${day.high}°` : '—';
  const low = finite(day.low) ? `${day.low}°` : '—';
  return `<section class="glass day-card" aria-labelledby="day-${esc(day.date)}">
    <div class="section-top">
      <h2 id="day-${esc(day.date)}">${weatherIcon(day.condition, true, 28)}${esc(day.label)}</h2>
      <span class="day-temps">${esc(high)} high<span>${esc(low)} low</span></span>
    </div>
    <p class="day-condition">${esc(day.condition)}</p>
    ${dayWindows(day.perfectWindows, 'perfect')}
    ${dayWindows(day.stormWindows, 'storm')}
    ${chartSvg(day.hours, { title: 'Temperature and dewpoint', kind: 'temp' })}
    ${chartSvg(day.hours, { title: 'Rain chance', kind: 'rain' })}
    ${hourStrip(day.hours)}
  </section>`;
}

function sources(data) {
  const chips = data.sources.map((source) => (
    `<span class="feed-chip ${source.status === 'ready' ? '' : 'unavailable'}">${esc(source.label)}</span>`
  )).join('');
  return `<section class="glass evidence-panel source-panel" aria-labelledby="source-title">
    <div class="section-top"><h2 id="source-title">SOURCE</h2><span>${esc(data.place.office || 'NWS')}</span></div>
    <div class="feed-health">${chips}</div>
    <p>${esc(data.status.message)}</p>
  </section>`;
}

function render(data) {
  byId('city-name').textContent = data.place.name || 'Selected ZIP';
  byId('place-line').textContent = `${data.place.latitude}, ${data.place.longitude} · ${data.place.timeZone}`;
  byId('results').innerHTML = `${outlook(data)}${data.days.map(dayCard).join('')}${sources(data)}`;
}

async function track(zip, persist = true) {
  const button = byId('track');
  button.disabled = true;
  setStatus('Reading Census location and NWS forecasts…');
  byId('results').innerHTML = skeletons();
  try {
    const response = await fetch(`/api/whats-up/tracker?zip=${encodeURIComponent(zip)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Tracker request failed (${response.status}).`);
    if (!data.days) throw new Error('The tracker response was incomplete.');
    render(data);
    if (persist) localStorage.setItem(STORAGE_KEY, zip);
    setStatus(`${data.place.name} · NWS ${data.status.nws}`);
  } catch (error) {
    const message = error.message || 'Weather data is temporarily unavailable. Please retry.';
    byId('results').innerHTML = `<section class="glass briefing outlook-card" role="alert">
      <div class="section-top"><h2>FORECAST UNAVAILABLE</h2></div>
      <h3>Could not load this ZIP</h3>
      <p>${esc(message)}</p>
    </section>`;
    setStatus(message, true);
  } finally {
    button.disabled = false;
  }
}

function boot() {
  const form = byId('zip-form');
  const input = byId('zip');
  const saved = normalizeZip(localStorage.getItem(STORAGE_KEY) || '');
  if (saved) input.value = saved;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const zip = normalizeZip(input.value);
    if (!zip) {
      setStatus('Use a 5-digit U.S. ZIP code.', true);
      return;
    }
    input.value = zip;
    track(zip);
  });
  if (saved) track(saved, false);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
