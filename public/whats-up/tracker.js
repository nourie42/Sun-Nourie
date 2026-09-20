const STORAGE_KEY = 'whats-up-zip';

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const byId = (id) => document.getElementById(id);

function setStatus(message, isError = false) {
  const status = byId('status');
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function normalizeZip(value) {
  const digits = String(value || '').trim().match(/^(\d{5})(?:-\d{4})?$/);
  return digits ? digits[1] : null;
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
      <div class="skeleton-line short loading-shimmer"></div>
    </section>
    <section class="glass day-card skeleton-card" aria-hidden="true">
      <div class="skeleton-line mid loading-shimmer"></div>
      <div class="skeleton-line wide loading-shimmer"></div>
    </section>`;
}

function windowChips(windows, kind) {
  if (!windows.length) return '';
  return `<div class="window-list">${windows.map((window) => {
    const stormClass = kind === 'storm' ? ` storm ${window.level || ''}` : ' perfect';
    const meta = kind === 'storm'
      ? `${window.level === 'definite' ? 'Definitely stormy' : 'Elevated'} · ${window.peakChance ?? '—'}%`
      : `Rule ${window.rule} · ${window.hourCount} hr`;
    return `<span class="window-chip${stormClass}"><b>${esc(window.label)}</b><small>${esc(meta)}</small></span>`;
  }).join('')}</div>`;
}

function hourStrip(hours) {
  if (!hours.length) return '<p class="empty-windows">Hourly breakdown is not available for this day. Storm windows above use the NWS period forecast only.</p>';
  return `<div class="hour-strip" tabindex="0" aria-label="Hourly breakdown">${hours.map((hour) => {
    const cls = hour.perfect ? ' perfect' : hour.storm ? ` storm ${hour.storm}` : '';
    const rain = finite(hour.rainChance) ? `${Math.round(hour.rainChance)}%` : '—';
    const mark = hour.perfect ? `Perfect ${hour.perfect}` : hour.storm ? (hour.storm === 'definite' ? 'Storm' : 'Elevated') : hour.sky;
    return `<div class="hour-chip${cls}">
      <span>${esc(hour.label)}</span>
      <strong>${finite(hour.temperature) ? `${hour.temperature}°` : '—'}</strong>
      <small>${esc(rain)} rain</small>
      <small>${esc(mark)}</small>
    </div>`;
  }).join('')}</div>`;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function summaryCard(data) {
  const nextPerfect = data.summary.nextPerfect;
  const nextStorm = data.summary.nextStorm;
  return `
    <section class="glass briefing summary-card" aria-labelledby="briefing-title">
      <div class="section-top"><h2><span class="sparkle" aria-hidden="true">✦</span> EXECUTIVE SUMMARY</h2><span class="pill">${esc(data.status.rainFusion === 'ready' ? 'RAIN FUSION' : 'NWS POP')}</span></div>
      <h3 id="briefing-title">${esc(data.summary.headline)}</h3>
      <p>${esc(data.summary.detail)}</p>
    </section>
    <div class="summary-grid">
      <article class="glass summary-stat ${nextPerfect ? '' : 'empty'}">
        <div class="eyebrow">NEXT PERFECT WINDOW</div>
        <strong>${nextPerfect ? esc(`${nextPerfect.dayLabel} · ${nextPerfect.label}`) : 'None in the hourly forecast'}</strong>
        <span>${nextPerfect ? esc(`Rule ${nextPerfect.rule}. Sky, 70–74°F / breezy-warm, wind and dewpoint must all qualify.`) : 'No upcoming hour currently matches Rule A or Rule B.'}</span>
      </article>
      <article class="glass summary-stat ${nextStorm ? '' : 'empty'}">
        <div class="eyebrow">NEXT STORM WINDOW</div>
        <strong>${nextStorm ? esc(`${nextStorm.dayLabel} · ${nextStorm.label}`) : 'None at storm level'}</strong>
        <span>${nextStorm ? esc(`${nextStorm.level === 'definite' ? 'Definitely stormy' : 'Elevated'} · peak ${nextStorm.peakChance}%`) : 'No hour currently reaches a 75% rain chance.'}</span>
      </article>
    </div>`;
}

function dayCard(day) {
  const high = finite(day.high) ? `${day.high}°` : '—';
  const low = finite(day.low) ? `${day.low}°` : '—';
  const empty = !day.perfectWindows.length && !day.stormWindows.length
    ? '<p class="empty-windows">No perfect or storm-level windows on this day.</p>'
    : '';
  return `<section class="glass day-card" aria-labelledby="day-${esc(day.date)}">
    <div class="section-top">
      <h2 id="day-${esc(day.date)}">${esc(day.label)}</h2>
      <span class="day-temps">${esc(high)} high<span>${esc(low)} low</span></span>
    </div>
    <p class="day-condition">${esc(day.condition)}</p>
    ${windowChips(day.perfectWindows, 'perfect')}
    ${windowChips(day.stormWindows, 'storm')}
    ${empty}
    ${hourStrip(day.hours)}
  </section>`;
}

function assumptions(data) {
  const chips = data.sources.map((source) => (
    `<span class="feed-chip ${source.status === 'ready' ? '' : 'unavailable'}">${esc(source.label)}</span>`
  )).join('');
  const a = data.assumptions;
  return `<section class="glass evidence-panel assumptions" aria-labelledby="assumptions-title">
    <div class="section-top"><h2 id="assumptions-title">◈ &nbsp; ASSUMPTIONS &amp; SOURCE</h2><span>NWS + Weather Nourie fusion</span></div>
    <div class="feed-health">${chips}</div>
    <p>${esc(data.status.message)} Office ${esc(data.place.office || '—')} · ${esc(data.place.geocodeSource)} · assembled ${esc(data.assembledAt)}</p>
    <strong>${esc(a.title)}</strong>
    <p>${esc(a.perfectA)}</p>
    <p>${esc(a.perfectB)}</p>
    <p>${esc(a.storm)}</p>
    <p>${esc(a.exclusions)}</p>
    <p>${esc(a.sources)}</p>
  </section>`;
}

function render(data) {
  byId('city-name').textContent = data.place.name || 'Selected ZIP';
  byId('place-line').textContent = `${data.place.latitude}, ${data.place.longitude} · ${data.place.timeZone}`;
  byId('results').innerHTML = `${summaryCard(data)}${data.days.map(dayCard).join('')}${assumptions(data)}`;
}

async function track(zip, persist = true) {
  const button = byId('track');
  button.disabled = true;
  setStatus('Reading Census location and NWS forecasts…');
  byId('results').innerHTML = skeletons();
  try {
    const response = await fetch(`/api/whats-up/tracker?zip=${encodeURIComponent(zip)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Tracker request failed (${response.status}).`);
    }
    if (!data.days) throw new Error('The tracker response was incomplete.');
    render(data);
    if (persist) localStorage.setItem(STORAGE_KEY, zip);
    const fusion = data.status.rainFusion === 'ready' ? 'Rain fusion ready' : 'NWS PoP only';
    setStatus(`${data.place.name} · NWS ${data.status.nws} · ${fusion}`);
  } catch (error) {
    byId('results').innerHTML = '';
    setStatus(error.message || 'Weather data is temporarily unavailable. Please retry.', true);
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
