/* Glance — Weather Nourie at a glance.
 * One API call (/api/weather-fusion/forecast) drives the whole page.
 * Pure view-model builders are exported for testing; DOM wiring runs in browser. */

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const round = (n) => (finite(n) ? Math.round(n) : null);

/* Standard NWS formulas, applied only in their valid ranges. */
export function feelsLike(tempF, humidityPct, windMph) {
  if (!finite(tempF)) return null;
  if (tempF >= 80 && finite(humidityPct)) {
    const T = tempF, R = humidityPct;
    let hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R
      - 0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R
      + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    if (R < 13 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    if (R > 85 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
    return round(hi);
  }
  if (tempF <= 50 && finite(windMph) && windMph > 3) {
    const v = Math.pow(windMph, 0.16);
    return round(35.74 + 0.6215 * tempF - 35.75 * v + 0.4275 * tempF * v);
  }
  return round(tempF);
}

function hourLabel(timeMs, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric' }).format(new Date(timeMs));
}

export function rainOutlook(hours, timeZone) {
  const upcoming = (hours || []).slice(0, 12);
  const first = upcoming.find((h) => finite(h.pop) && h.pop >= 30);
  if (!first) return { wet: false, text: 'No rain expected in the next 12 hours.' };
  const when = hourLabel(first.time, timeZone);
  if (first.pop >= 50) return { wet: true, text: `Rain likely around ${when} (${Math.round(first.pop)}%).` };
  return { wet: true, text: `Chance of rain around ${when} (${Math.round(first.pop)}%).` };
}

export function skyClass(hours, nowMs) {
  const h = (hours || []).find((x) => x.time <= nowMs && nowMs < x.time + 3600000) || hours?.[0];
  if (!h) return 'day';
  if (h.isDay === false) return 'night';
  if (finite(h.pop) && h.pop >= 40) return 'rain';
  return 'day';
}

export function buildGlanceModel(data, nowMs = Date.now()) {
  const loc = data?.location || {};
  const timeZone = loc.timeZone || 'America/New_York';
  const cur = data?.current || {};
  const allHours = (data?.hours || [])
    .map((h) => ({ ...h, time: Date.parse(h.time) }))
    .filter((h) => Number.isFinite(h.time));
  const hours = allHours.filter((h) => h.time + 3600000 > nowMs).slice(0, 12);
  const days = (data?.days || []).slice(0, 2);
  const feels = finite(cur.feelsLike) ? round(cur.feelsLike) : feelsLike(cur.temperature, cur.humidity, cur.wind);
  const rain = rainOutlook(hours, timeZone);
  const alerts = (data?.alerts || []).slice(0, 3).map((a) => ({
    event: a.event || 'Weather alert',
    headline: a.headline || a.description?.slice(0, 140) || '',
    watch: /watch/i.test(a.event || ''),
  }));
  return {
    place: loc.name || 'Knightdale / Raleigh',
    updatedAt: nowMs,
    sky: skyClass(allHours, nowMs),
    hero: {
      temp: round(cur.temperature),
      condition: cur.condition || 'Conditions unavailable',
      feels,
      high: round(days[0]?.high),
      low: round(days[0]?.low),
      station: cur.stationName || cur.station || null,
    },
    rain,
    hours: hours.map((h) => ({
      label: hourLabel(h.time, timeZone),
      temp: round(h.temperature),
      pop: finite(h.pop) ? Math.round(h.pop) : null,
    })),
    days: days.map((d) => ({
      label: d.label || '',
      high: round(d.high),
      low: round(d.low),
      condition: d.condition || '',
      pop: finite(d.pop) ? Math.round(d.pop) : null,
    })),
    details: [
      ['Humidity', finite(cur.humidity) ? `${Math.round(cur.humidity)}%` : '—'],
      ['Dew point', finite(cur.dewpoint) ? `${Math.round(cur.dewpoint)}°` : '—'],
      ['Wind', finite(cur.wind) ? `${Math.round(cur.wind)} mph` : '—'],
      ['Gusts', finite(cur.gust) ? `${Math.round(cur.gust)} mph` : '—'],
      ['Visibility', finite(cur.visibility) ? `${cur.visibility} mi` : '—'],
      ['Pressure', finite(cur.pressure) ? `${cur.pressure} in` : '—'],
    ],
    alerts,
  };
}

/* ---------- DOM wiring (browser only) ---------- */
function el(id) { return document.getElementById(id); }

function renderAlerts(alerts) {
  const strip = el('alert-strip');
  if (!alerts.length) { strip.hidden = true; strip.innerHTML = ''; return; }
  strip.hidden = false;
  strip.innerHTML = '';
  for (const a of alerts) {
    const div = document.createElement('div');
    div.className = 'alert-chip' + (a.watch ? ' watch' : '');
    div.textContent = a.headline ? `${a.event}: ${a.headline}` : a.event;
    strip.appendChild(div);
  }
}

export function render(model) {
  document.body.dataset.sky = model.sky;
  el('now-temp').textContent = model.hero.temp ?? '--';
  el('now-cond').textContent = model.hero.condition;
  el('now-feels').textContent = model.hero.feels != null && model.hero.temp != null && model.hero.feels !== model.hero.temp
    ? `Feels like ${model.hero.feels}°` : model.hero.station ? `Via ${model.hero.station}` : '';
  el('now-hilo').textContent = model.hero.high != null
    ? `H ${model.hero.high}°  ·  L ${model.hero.low ?? '--'}°` : '';
  const rain = el('rain-line');
  el('rain-text').textContent = model.rain.text;
  rain.classList.toggle('wet', model.rain.wet);
  const strip = el('hour-strip');
  strip.innerHTML = '';
  for (const h of model.hours) {
    const d = document.createElement('div');
    d.className = 'hour';
    const pop = document.createElement('div');
    pop.className = 'p' + (h.pop != null && h.pop >= 20 ? '' : ' dry');
    pop.textContent = h.pop != null && h.pop >= 20 ? `${h.pop}%` : '';
    d.innerHTML = `<div class="h">${h.label}</div><div class="t">${h.temp ?? '--'}°</div>`;
    d.appendChild(pop);
    strip.appendChild(d);
  }
  const cards = el('day-cards');
  cards.innerHTML = '';
  for (const d of model.days) {
    const c = document.createElement('div');
    c.className = 'day-card';
    c.innerHTML = `<div class="d">${d.label}</div>
      <div class="hl">${d.high ?? '--'}° <small>/ ${d.low ?? '--'}°</small></div>
      <div class="c">${d.condition}</div>
      ${d.pop != null && d.pop >= 20 ? `<div class="rp">Rain ${d.pop}%</div>` : ''}`;
    cards.appendChild(c);
  }
  const dl = el('detail-list');
  dl.innerHTML = '';
  for (const [k, v] of model.details) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<dt>${k}</dt><dd>${v}</dd>`;
    dl.appendChild(wrap);
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  el('updated').textContent = 'Updated ' + new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(model.updatedAt));
  renderAlerts(model.alerts);
}

async function load(location) {
  const err = el('error');
  err.hidden = true;
  try {
    const res = await fetch(`/api/weather-fusion/forecast?location=${encodeURIComponent(location)}`, { credentials: 'same-origin' });
    if (res.status === 401) {
      location.href = '/weather-fusion/login?returnTo=' + encodeURIComponent('/weather-fusion/glance.html');
      return;
    }
    if (!res.ok) throw new Error(`Weather service responded ${res.status}`);
    const data = await res.json();
    render(buildGlanceModel(data));
  } catch (e) {
    err.hidden = false;
    err.textContent = 'Could not load weather right now. Please retry in a bit.';
  }
}

function init() {
  const params = new URLSearchParams(location.search);
  const select = el('loc-select');
  const initial = params.get('location') || 'knightdale';
  if ([...select.options].some((o) => o.value === initial)) select.value = initial;
  select.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('location', select.value);
    history.replaceState(null, '', url);
    el('now-cond').textContent = 'Loading…';
    load(select.value);
  });
  load(select.value);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
