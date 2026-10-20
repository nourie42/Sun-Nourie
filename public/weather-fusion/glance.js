/* Glance — Weather Nourie at a glance.
 * One API call (/api/weather-fusion/forecast) drives the whole page.
 * Pure builders (feelsLike, skyImage, buildArc, insights, buildGlanceModel)
 * are exported for testing; DOM wiring runs in the browser. */
import {calendarDayTemperatures,rainWindowPeak} from './calendar-day.js?v=calendar-days-v1';
import {forecastSnapshotFreshness} from './weather-freshness.js?v=accuracy-20261019-v1';
import {installForecastRefresh} from './weathernext-data.js';
import {currentAirQuality} from './air-quality.js?v=mobile-repair-v1';
import {currentSample,sampleCaption} from './weather-display.js?v=low-rain-display-v1';
import {hourlyUvValue} from './daily-uv.js?v=weather-art-labels-v10';

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

function hourAt(hours, nowMs) {
  return (hours || []).find((h) => h.time <= nowMs && nowMs < h.time + 3600000) || hours?.[0] || null;
}

export function skyImage(hours, nowMs) {
  const h = hourAt(hours, nowMs);
  const cond = String(h?.condition || '').toLowerCase();
  if (h?.isDay === false) return 'today-sky-night-v2.webp';
  if (/thunder|storm|tornado|hail/.test(cond)) return 'today-sky-storm.webp';
  if (/rain|shower|drizzle/.test(cond) || (h?.pop ?? 0) >= 40) return 'today-sky-rain.webp';
  if (/cloud|overcast|fog|mist|haze/.test(cond)) return 'today-sky-clouds.webp';
  return 'today-sky-clear.webp';
}

function hourLabel(timeMs, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric' }).format(new Date(timeMs));
}
function timeLabel(timeMs, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(timeMs));
}

/* ---- 24-hour temperature arc (pure SVG builder) ---- */
export function buildArc(hours, solar, timeZone, nowMs) {
  const pts = (hours || []).slice(0, 24).filter((h) => finite(h.time) && finite(h.temperature));
  if (pts.length < 4) return '';
  const W = 600, H = 230, PL = 10, PR = 10, PT = 34, PB = 40;
  const temps = pts.map((p) => p.temperature);
  let lo = Math.min(...temps), hi = Math.max(...temps);
  if (hi - lo < 6) { const mid = (hi + lo) / 2; lo = mid - 3; hi = mid + 3; }
  const X = (i) => PL + (i * (W - PL - PR)) / (pts.length - 1);
  const Y = (t) => PT + (1 - (t - lo) / (hi - lo)) * (H - PT - PB);
  const xy = pts.map((p, i) => [X(i), Y(p.temperature)]);
  // Catmull-Rom smoothing
  let d = `M ${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[Math.max(0, i - 1)], p1 = xy[i], p2 = xy[i + 1], p3 = xy[Math.min(xy.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = `${d} L ${xy[xy.length - 1][0].toFixed(1)} ${H - PB} L ${xy[0][0].toFixed(1)} ${H - PB} Z`;
  // Rain shading per hour segment
  let rain = '';
  for (let i = 0; i < pts.length; i++) {
    const pop = pts[i].pop;
    if (finite(pop) && pop >= 30) {
      const x0 = i === 0 ? X(0) : (X(i - 1) + X(i)) / 2;
      const x1 = i === pts.length - 1 ? X(i) : (X(i) + X(i + 1)) / 2;
      rain += `<rect class="arc-rain" x="${x0.toFixed(1)}" y="${PT}" width="${(x1 - x0).toFixed(1)}" height="${H - PT - PB}" rx="4" opacity="${(0.25 + Math.min(pop, 100) / 160).toFixed(2)}"/>`;
    }
  }
  // Now marker
  const nowMark = `<line class="arc-now" x1="${X(0).toFixed(1)}" y1="${PT - 6}" x2="${X(0).toFixed(1)}" y2="${H - PB}"/><circle class="arc-now-dot" cx="${X(0).toFixed(1)}" cy="${Y(pts[0].temperature).toFixed(1)}" r="5"/>`;
  // Sunrise / sunset markers
  let sunMarks = '';
  const t0 = pts[0].time, tN = pts[pts.length - 1].time + 3600000;
  for (const [key, glyph] of [['sunrise', '↑'], ['sunset', '↓']]) {
    const t = solar?.[key] ? Date.parse(solar[key]) : NaN;
    if (Number.isFinite(t) && t >= t0 && t <= tN) {
      const frac = pts.findIndex((p) => p.time + 3600000 > t);
      const i = Math.max(0, frac);
      const pA = pts[i], pB = pts[Math.min(pts.length - 1, i + 1)];
      const f = Math.min(1, Math.max(0, (t - pA.time) / 3600000));
      const x = X(i) + f * ((pB ? X(Math.min(pts.length - 1, i + 1)) : X(i)) - X(i));
      sunMarks += `<text class="arc-sun" x="${x.toFixed(1)}" y="${(H - 8).toFixed(1)}" text-anchor="middle">${glyph} ${hourLabel(t, timeZone)}</text>`;
    }
  }
  // Labels every 3 hours
  let labels = '';
  for (let i = 0; i < pts.length; i += 3) {
    labels += `<text x="${X(i).toFixed(1)}" y="${(H - 22).toFixed(1)}" text-anchor="middle">${hourLabel(pts[i].time, timeZone)}</text>`;
    labels += `<text class="arc-temp" x="${X(i).toFixed(1)}" y="${(Y(pts[i].temperature) - 10).toFixed(1)}" text-anchor="middle">${Math.round(pts[i].temperature)}°</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperature over the next 24 hours">`
    + `<defs><linearGradient id="arcGrad" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="#7fd4ff" stop-opacity=".55"/><stop offset="1" stop-color="#7fd4ff" stop-opacity="0"/>`
    + `</linearGradient></defs>`
    + rain + `<path class="arc-fill" d="${area}"/>` + `<path class="arc-line" d="${d}"/>`
    + nowMark + sunMarks + labels + `</svg>`;
}

/* ---- Smart insights (pure) ---- */
export function insights(hours, timeZone) {
  const out = [];
  const h12 = (hours || []).slice(0, 12);
  // Driest window: longest run of pop < 20 within 12h
  let best = null, run = null;
  h12.forEach((h, i) => {
    if(i&&h.time!==h12[i-1].time+3600000)run=null;
    if (finite(h.pop) && h.pop < 20) {
      run = run || { start: i, len: 0 };
      run.len++;
      if (!best || run.len > best.len) best = { ...run };
    } else run = null;
  });
  if (best && best.len >= 2) {
    out.push({ k: 'Driest window', v: `${hourLabel(h12[best.start].time, timeZone)} – ${hourLabel(h12[best.start + best.len - 1].time + 3600000, timeZone)}` });
  }
  // Rain start
  const wet = (hours || []).slice(0, 24).find((h) => finite(h.pop) && h.pop >= 40);
  if (wet) out.push({ k: 'Rain from', v: `${hourLabel(wet.time, timeZone)} · ${Math.round(wet.pop)}%` });
  // Peak temp
  const h24 = (hours || []).slice(0, 24).filter((h) => finite(h.temperature));
  if (h24.length) {
    const peak = h24.reduce((a, b) => (b.temperature > a.temperature ? b : a));
    out.push({ k: 'Warmest', v: `${Math.round(peak.temperature)}° around ${hourLabel(peak.time, timeZone)}` });
  }
  return out.slice(0, 3);
}

export function rainOutlook(hours, timeZone, nowMs=hours?.[0]?.time) {
  const upcoming = (hours || []).filter(h=>h.time+3600000>nowMs&&h.time<nowMs+12*3600000);
  const coverage=rainWindowPeak(upcoming.map(h=>({...h,time:new Date(h.time).toISOString(),rainLikelihood:{value:h.pop}})),{start:nowMs,end:nowMs+12*3600000});
  const first = upcoming.find((h) => finite(h.pop) && h.pop >= 30);
  if (!finite(coverage.value)) return {wet:false,text:'Rain outlook unavailable for some upcoming hours.'};
  if (!first) return { wet: false, text: 'No rain expected in the next 12 hours.' };
  const when = hourLabel(first.time, timeZone);
  if (first.pop >= 50) return { wet: true, text: `Rain likely around ${when} (${Math.round(first.pop)}%).` };
  return { wet: true, text: `Chance of rain around ${when} (${Math.round(first.pop)}%).` };
}

function uvNow(uv, nowMs) {
  const value=hourlyUvValue({uv},nowMs);
  return finite(value)?Math.round(value*10)/10:null;
}

export function buildGlanceModel(data, nowMs = Date.now()) {
  const loc = data?.location || {};
  const timeZone = loc.timeZone || 'America/New_York';
  const current=currentSample({...data,location:loc},nowMs),cur=current.inputs;
  const allHours = (data?.hours || [])
    .map((h) => ({ ...h, pop:h.rainLikelihood&&Object.hasOwn(h.rainLikelihood,'value')?h.rainLikelihood.value:h.pop, time: Date.parse(h.time) }))
    .filter((h) => Number.isFinite(h.time));
  const hours = allHours.filter((h) => h.time + 3600000 > nowMs).slice(0, 24);
  const days = (data?.days || []).slice(0, 3).map((day,index)=>({...day,...calendarDayTemperatures(data,index,nowMs)}));
  const feels = round(current.feels);
  const solar = data?.solar || null;
  const sun = (key) => (solar?.[key] ? timeLabel(Date.parse(solar[key]), timeZone) : null);
  const alerts = (data?.alerts || []).slice(0, 3).map((a) => ({
    event: a.event || 'Weather alert',
    headline: a.headline || (a.description || '').slice(0, 140),
    watch: /watch/i.test(a.event || ''),
  }));
  return {
    place: loc.name || 'Knightdale / Raleigh',
    updatedAt: data?.assembledAt || null,
    timeZone,
    sky: skyImage(allHours, nowMs),
    hero: {
      temp: round(cur.temperature),
      condition: current.condition || 'Conditions unavailable',
      feels,
      feelsSource:sampleCaption(current,timeZone),
      high: round(days[0]?.high),
      low: round(days[0]?.low),
      sunrise: sun('sunrise'),
      sunset: sun('sunset'),
    },
    rain: forecastSnapshotFreshness(data,nowMs).expired ? {wet:false,text:'Rain outlook unavailable until the forecast refreshes.'} : rainOutlook(hours, timeZone,nowMs),
    insightList: insights(hours, timeZone),
    arc: buildArc(hours, solar, timeZone, nowMs),
    days: days.map((d) => ({
      label: d.label || '',
      high: round(d.high),
      low: round(d.low),
      condition: d.condition || '',
      pop: finite(d.rainLikelihood&&Object.hasOwn(d.rainLikelihood,'value')?d.rainLikelihood.value:d.pop) ? Math.round(d.rainLikelihood&&Object.hasOwn(d.rainLikelihood,'value')?d.rainLikelihood.value:d.pop) : null,
    })),
    details: [
      ['Humidity', finite(cur.humidity) ? `${Math.round(cur.humidity)}%` : '—'],
      ['Dew point', finite(cur.dewpoint) ? `${Math.round(cur.dewpoint)}°` : '—'],
      ['Wind', finite(cur.wind) ? `${Math.round(cur.wind)} mph` : '—'],
      ['Gusts', finite(cur.gust) ? `${Math.round(cur.gust)} mph` : '—'],
      ['UV index', (() => { const u = uvNow(data?.uv, nowMs); return u != null ? String(u) : '—'; })()],
      ['Air quality', (()=>{const aq=currentAirQuality(data,nowMs);return aq?`AQI ${Math.round(aq.aqi)}`:'—';})()],
      ['Visibility', finite(cur.visibility) ? `${cur.visibility} mi` : '—'],
      ['Pressure', finite(cur.pressure) ? `${cur.pressure} in` : '—'],
    ],
    alerts,
  };
}

/* ---------- DOM wiring (browser only) ---------- */
function el(id) { return document.getElementById(id); }
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let skyFlip = false;
function setSky(image) {
  const url = `/weather-fusion/${image}`;
  const show = skyFlip ? el('sky-a') : el('sky-b');
  const hide = skyFlip ? el('sky-b') : el('sky-a');
  if (show.dataset.img === image) return;
  const pre = new Image();
  pre.onload = () => {
    show.style.backgroundImage = `url("${url}")`;
    show.dataset.img = image;
    show.classList.add('on');
    hide.classList.remove('on');
    skyFlip = !skyFlip;
  };
  pre.onerror = () => {};
  pre.src = url;
}

function countUp(node, target) {
  if (!node || !finite(target)) { if (node) node.textContent = target ?? '--'; return; }
  if (reducedMotion()) { node.textContent = target; return; }
  const t0 = performance.now(), dur = 900;
  const step = (t) => {
    const f = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - f, 3);
    node.textContent = Math.round(target * e);
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function render(model) {
  setSky(model.sky);
  countUp(el('now-temp'), model.hero.temp);
  el('now-cond').textContent = model.hero.condition;
  el('now-feels').textContent = model.hero.feels != null && model.hero.temp != null && model.hero.feels !== model.hero.temp
    ? `Feels like ${model.hero.feels}°` : '';
  el('now-feels').title=model.hero.feelsSource||'';
  el('now-hilo').textContent = model.hero.high != null ? `H ${model.hero.high}°  ·  L ${model.hero.low ?? '--'}°` : '';
  el('sun-times').textContent = model.hero.sunrise ? `↑ ${model.hero.sunrise}   ↓ ${model.hero.sunset}` : '';
  const rain = el('rain-line');
  el('rain-text').textContent = model.rain.text;
  rain.classList.toggle('wet', model.rain.wet);
  const row = el('insight-row');
  row.innerHTML = '';
  for (const ins of model.insightList) {
    const d = document.createElement('div');
    d.className = 'insight';
    const k = document.createElement('div'); k.className = 'k'; k.textContent = ins.k;
    const v = document.createElement('div'); v.className = 'v'; v.textContent = ins.v;
    d.append(k, v);
    row.appendChild(d);
  }
  el('arc').innerHTML = model.arc;
  const cards = el('day-cards');
  cards.innerHTML = '';
  for (const d of model.days) {
    const c = document.createElement('div');
    c.className = 'day-card';
    const k = document.createElement('div'); k.className = 'd'; k.textContent = d.label; c.appendChild(k);
    const hl = document.createElement('div'); hl.className = 'hl';
    hl.innerHTML = ''; hl.append(document.createTextNode(`${d.high ?? '--'}° `));
    const sm = document.createElement('small'); sm.textContent = `/ ${d.low ?? '--'}°`; hl.appendChild(sm); c.appendChild(hl);
    const cc = document.createElement('div'); cc.className = 'c'; cc.textContent = d.condition; c.appendChild(cc);
    if (d.pop != null && d.pop >= 20) {
      const rp = document.createElement('div'); rp.className = 'rp'; rp.textContent = `Rain ${d.pop}%`; c.appendChild(rp);
    }
    cards.appendChild(c);
  }
  const dl = el('detail-list');
  dl.innerHTML = '';
  for (const [k, v] of model.details) {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    wrap.append(dt, dd);
    dl.appendChild(wrap);
  }
  el('updated').textContent=Number.isFinite(Date.parse(model.updatedAt))?'Forecast updated '+new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:model.timeZone}).format(new Date(model.updatedAt)):'Forecast update time unavailable';
  const strip = el('alert-strip');
  strip.innerHTML = '';
  if (!model.alerts.length) { strip.hidden = true; }
  else {
    strip.hidden = false;
    for (const a of model.alerts) {
      const div = document.createElement('div');
      div.className = 'alert-chip' + (a.watch ? ' watch' : '');
      div.textContent = a.headline ? `${a.event}: ${a.headline}` : a.event;
      strip.appendChild(div);
    }
  }
}

let lastForecast=null,latestRequest=0;
async function load(location) {
  const request=++latestRequest;
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
    if(request!==latestRequest)return;
    lastForecast=data;render(buildGlanceModel(data));
  } catch (e) {
    if(request!==latestRequest)return;
    if(lastForecast)render(buildGlanceModel(lastForecast));
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
  installForecastRefresh(()=>load(select.value));
  setInterval(()=>{if(lastForecast)render(buildGlanceModel(lastForecast));},60000);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
