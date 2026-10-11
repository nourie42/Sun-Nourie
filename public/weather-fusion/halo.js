/* Halo — Weather Nourie as a living sky.
 * One call to /api/weather-fusion/forecast drives the page, so every number is
 * the same blended value the main site shows (hour.temperature, rainLikelihood,
 * day.high/low, precipitation). Pure builders are exported for tests; DOM wiring
 * only runs in the browser. */
import { weatherIcon, windDirectionLabel } from './weather-display.js?v=weather-qa-v67';
import { weatherState } from './weather-state.js?v=weather-qa-v67';
import { finite, rainChanceValue } from './weather-math.js?v=weather-qa-v67';

const H = 3600000;
const round = (n) => (finite(n) ? Math.round(n) : null);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (ms, timeZone, opts) => new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(new Date(ms));
const hourLabel = (ms, tz) => fmt(ms, tz, { hour: 'numeric' });
const timeLabel = (ms, tz) => fmt(ms, tz, { hour: 'numeric', minute: '2-digit' });

export const SOURCES = [
  { id: 'nws', label: 'NWS', color: '#f4f1e8' },
  { id: 'hrrr', label: 'HRRR', color: '#7fd4ff' },
  { id: 'nbm', label: 'NBM', color: '#9ef0c2' },
  { id: 'ecmwf', label: 'ECMWF', color: '#ffc27a' },
];

/* ---- Sky phase from the calculated sunrise/sunset ---- */
export function skyPhase(solar, nowMs) {
  const rise = Date.parse(solar?.sunrise), set = Date.parse(solar?.sunset);
  if (!Number.isFinite(rise) || !Number.isFinite(set)) return 'day';
  const m = 60000;
  if (nowMs < rise - 40 * m || nowMs > set + 40 * m) return 'night';
  if (nowMs < rise + 50 * m) return 'dawn';
  if (nowMs > set) return 'dusk';
  if (nowMs > set - 80 * m) return 'golden';
  return 'day';
}

/* 0 at sunrise → 1 at sunset; null outside daylight. */
export function sunProgress(solar, nowMs) {
  const rise = Date.parse(solar?.sunrise), set = Date.parse(solar?.sunset);
  if (!Number.isFinite(rise) || !Number.isFinite(set) || set <= rise) return null;
  const f = (nowMs - rise) / (set - rise);
  return f >= 0 && f <= 1 ? f : null;
}

/* Temperature → colour ramp shared by the week bars and hourly curve. */
const RAMP = [[10, [124, 150, 255]], [32, [120, 200, 255]], [50, [110, 226, 214]], [65, [168, 236, 140]], [77, [255, 214, 110]], [88, [255, 150, 90]], [100, [255, 92, 110]]];
export function tempColor(t) {
  if (!finite(t)) return 'rgb(200,210,225)';
  if (t <= RAMP[0][0]) return `rgb(${RAMP[0][1].join(',')})`;
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, c1] = RAMP[i], [t0, c0] = RAMP[i - 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((c, k) => Math.round(c + f * (c1[k] - c))).join(',')})`;
    }
  }
  return `rgb(${RAMP.at(-1)[1].join(',')})`;
}

/* ---- One-sentence story built from the blended hours ---- */
export function story(cur, hours, timeZone) {
  const parts = [];
  const h24 = hours.slice(0, 24);
  const now = hours[0];
  const nowChance = now?.chance ?? null;
  if (finite(nowChance) && nowChance >= 50) {
    const dry = h24.find((h) => finite(h.chance) && h.chance < 30);
    parts.push(dry ? `Rain is likely now, easing around ${hourLabel(dry.time, timeZone)}.` : 'Rain is likely now and stays in the picture all day.');
  } else {
    const wet = h24.find((h) => finite(h.chance) && h.chance >= 40);
    if (wet) parts.push(`Rain chance climbs to ${wet.chance}% around ${hourLabel(wet.time, timeZone)}.`);
    else {
      const maybe = h24.find((h) => finite(h.chance) && h.chance >= 20);
      parts.push(maybe ? `Mostly dry — a slight rain chance (${maybe.chance}%) near ${hourLabel(maybe.time, timeZone)}.` : 'Dry for the next 24 hours.');
    }
  }
  const h12 = hours.slice(0, 12).filter((h) => finite(h.temp));
  if (h12.length > 2 && finite(cur.temp)) {
    const peak = h12.reduce((a, b) => (b.temp > a.temp ? b : a));
    const low = h12.reduce((a, b) => (b.temp < a.temp ? b : a));
    if (peak.temp >= cur.temp + 2) parts.unshift(`Warming to ${peak.temp}° by ${hourLabel(peak.time, timeZone)}.`);
    else if (low.temp <= cur.temp - 3) parts.unshift(`Cooling to ${low.temp}° by ${hourLabel(low.time, timeZone)}.`);
    else parts.unshift('Temperatures hold steady for the next few hours.');
  }
  return parts.join(' ');
}

/* ---- Hourly ribbon: columns plus a smooth temperature curve ---- */
export const HOUR_W = 64;
export function hourlyCurve(hours) {
  const pts = hours.filter((h) => finite(h.temp));
  if (pts.length < 2) return '';
  const W = hours.length * HOUR_W, Hh = 70, pad = 14;
  let lo = Math.min(...pts.map((p) => p.temp)), hi = Math.max(...pts.map((p) => p.temp));
  if (hi - lo < 6) { const m = (hi + lo) / 2; lo = m - 3; hi = m + 3; }
  const xy = hours.map((h, i) => (finite(h.temp) ? [i * HOUR_W + HOUR_W / 2, pad + (1 - (h.temp - lo) / (hi - lo)) * (Hh - 2 * pad)] : null)).filter(Boolean);
  let d = `M ${xy[0][0]} ${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[Math.max(0, i - 1)], p1 = xy[i], p2 = xy[i + 1], p3 = xy[Math.min(xy.length - 1, i + 2)];
    d += ` C ${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)}, ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)}, ${p2[0]} ${p2[1].toFixed(1)}`;
  }
  const stops = hours.map((h, i) => `<stop offset="${((i + 0.5) / hours.length).toFixed(3)}" stop-color="${tempColor(h.temp)}"/>`).join('');
  const area = `${d} L ${xy.at(-1)[0]} ${Hh} L ${xy[0][0]} ${Hh} Z`;
  const dots = xy.map(([x, y]) => `<circle cx="${x}" cy="${y.toFixed(1)}" r="2.6"/>`).join('');
  return `<svg class="curve" viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" preserveAspectRatio="none" aria-hidden="true">`
    + `<defs><linearGradient id="haloCurve" x1="0" x2="1" y1="0" y2="0">${stops}</linearGradient>`
    + `<linearGradient id="haloFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`
    + `<path d="${area}" fill="url(#haloFill)"/><path class="curve-line" d="${d}" stroke="url(#haloCurve)"/><g class="curve-dots">${dots}</g></svg>`;
}

/* ---- Sun arc (SVG) ---- */
export function sunArc(progress, phase) {
  const W = 300, Hh = 150, cx = 150, cy = 138, r = 118;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  let marker = '', done = '';
  if (progress != null) {
    const a = Math.PI * (1 - progress);
    const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
    done = `<path class="arc-done" d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}"/>`;
    marker = `<circle class="arc-glow" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="20"/><circle class="arc-sun" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9"/>`;
  } else if (phase === 'night' || phase === 'dusk') {
    marker = `<path class="arc-moon" d="M156 54a22 22 0 1 0 16 36 18 18 0 0 1-16-36Z"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${progress != null ? `The sun is ${Math.round(progress * 100)}% of the way across today's sky` : 'The sun is below the horizon'}">`
    + `<path class="arc-track" d="${arc}"/>${done}<line class="arc-horizon" x1="12" y1="${cy}" x2="${W - 12}" y2="${cy}"/>${marker}</svg>`;
}

/* ---- Category helpers ---- */
export function dewComfort(dp) {
  if (!finite(dp)) return '';
  if (dp < 50) return 'Crisp and dry';
  if (dp < 58) return 'Comfortable';
  if (dp < 63) return 'A touch humid';
  if (dp < 68) return 'Sticky';
  if (dp < 73) return 'Muggy';
  return 'Oppressive';
}
export function uvCategory(uv) {
  if (!finite(uv)) return '';
  return uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very high' : 'Extreme';
}
export function aqiCategory(aqi) {
  if (!finite(aqi)) return '';
  return aqi <= 50 ? 'Good' : aqi <= 100 ? 'Moderate' : aqi <= 150 ? 'Unhealthy for sensitive groups' : aqi <= 200 ? 'Unhealthy' : aqi <= 300 ? 'Very unhealthy' : 'Hazardous';
}
function uvAt(uv, nowMs) {
  let best = null;
  for (const e of uv?.hourly || []) {
    const t = Date.parse(e.time);
    if (Number.isFinite(t) && t <= nowMs && finite(e.value) && (!best || t > best.t)) best = { t, v: e.value };
  }
  return best ? Math.round(best.v * 10) / 10 : null;
}
function uvMaxToday(uv, nowMs, timeZone) {
  const day = fmt(nowMs, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const vals = (uv?.hourly || []).filter((e) => finite(e.value) && Number.isFinite(Date.parse(e.time)) && fmt(Date.parse(e.time), timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }) === day).map((e) => e.value);
  return vals.length ? Math.round(Math.max(...vals) * 10) / 10 : null;
}
function windMph(v) {
  if (finite(v)) return v;
  const m = String(v ?? '').match(/(\d+)(?:\s*to\s*(\d+))?/);
  return m ? Number(m[2] || m[1]) : null;
}
export function inches(v) {
  if (!finite(v)) return '—';
  if (v === 0) return '0"';
  if (v < 0.01) return '< 0.01"';
  return `${v.toFixed(2)}"`;
}

/* ---- The whole page model ---- */
export function buildHaloModel(data, nowMs = Date.now()) {
  const loc = data?.location || {};
  const timeZone = loc.timeZone || 'America/New_York';
  const cur = data?.current || {};
  const solar = data?.solar || null;
  const hours = (data?.hours || [])
    .map((h) => ({ ...h, t: Date.parse(h.time) }))
    .filter((h) => Number.isFinite(h.t) && h.t + H > nowMs)
    .slice(0, 24)
    .map((h) => ({
      time: h.t,
      temp: round(h.temperature),
      chance: round(rainChanceValue(h.rainLikelihood, h.pop)),
      precipitation: finite(h.precipitation) ? h.precipitation : null,
      condition: h.condition || '',
      isDay: h.isDay !== false,
    }));
  const rawDays = (data?.days || []).slice(0, 7);
  const days = rawDays.map((d) => ({
    label: d.label || d.date || '',
    date: d.date || '',
    high: round(d.high),
    low: round(d.low),
    chance: round(rainChanceValue(d.rainLikelihood, d.pop)),
    qpf: finite(d.qpfBlend?.value) ? d.qpfBlend.value : (finite(d.qpf) ? d.qpf : null),
    condition: d.condition || '',
    detail: d.detail || '',
    confidence: d.confidence?.label || null,
  }));
  const lows = days.map((d) => d.low).filter(finite), highs = days.map((d) => d.high).filter(finite);
  const temp = round(cur.temperature);
  const weekLo = Math.min(...lows, ...highs, ...(finite(temp) ? [temp] : []));
  const weekHi = Math.max(...lows, ...highs, ...(finite(temp) ? [temp] : []));
  const span = Math.max(1, weekHi - weekLo);
  const week = days.map((d, i) => {
    const lo = finite(d.low) ? d.low : d.high, hi = finite(d.high) ? d.high : d.low;
    return {
      ...d,
      bar: finite(lo) && finite(hi) ? {
        left: ((lo - weekLo) / span) * 100,
        width: Math.max(4, ((hi - lo) / span) * 100),
        from: tempColor(lo), to: tempColor(hi),
        now: i === 0 && finite(temp) ? ((temp - weekLo) / span) * 100 : null,
      } : null,
    };
  });
  const feels = round(cur.feelsLike ?? cur.apparent);
  const phase = skyPhase(solar, nowMs);
  const kind = cur.weather?.kind || weatherState(cur.condition).kind;
  const policy = data?.blendPolicy || {};
  const guidance = rawDays[0]?.guidance || {};
  const official = rawDays[0]?.official || {};
  const modelHighs = SOURCES.map((s) => ({
    ...s,
    value: s.id === 'nws' ? round(official.high ?? rawDays[0]?.high) : round(guidance[s.id]?.high),
  }));
  const wind = windMph(cur.wind), gust = windMph(cur.gust);
  const uvNow = uvAt(data?.uv, nowMs), uvMax = uvMaxToday(data?.uv, nowMs, timeZone);
  const aqi = finite(data?.airQuality?.aqi) ? Math.round(data.airQuality.aqi) : null;
  const tiles = [
    { id: 'feels', title: 'Feels like', value: feels != null ? `${feels}°` : '—',
      note: finite(cur.feelsLikeSun) && finite(cur.feelsLikeShade) && Math.round(cur.feelsLikeSun) !== Math.round(cur.feelsLikeShade)
        ? `${Math.round(cur.feelsLikeSun)}° in sun · ${Math.round(cur.feelsLikeShade)}° in shade`
        : (feels != null && temp != null ? (feels > temp ? 'Humidity makes it feel warmer' : feels < temp ? 'Wind makes it feel cooler' : 'Close to the actual temperature') : '') },
    { id: 'wind', title: 'Wind', value: wind != null ? `${Math.round(wind)}` : '—', unit: 'mph',
      note: [finite(cur.windDirection) ? `From the ${windDirectionLabel(cur.windDirection)}` : '', gust != null ? `gusts ${Math.round(gust)} mph` : ''].filter(Boolean).join(' · '),
      dir: finite(cur.windDirection) ? cur.windDirection : null },
    { id: 'humidity', title: 'Humidity', value: finite(cur.humidity) ? `${Math.round(cur.humidity)}%` : '—',
      note: finite(cur.dewpoint) ? `Dew point ${Math.round(cur.dewpoint)}° · ${dewComfort(cur.dewpoint)}` : '', meter: finite(cur.humidity) ? cur.humidity / 100 : null },
    { id: 'rain', title: 'Rain, next 24h', value: inches(data?.precipitation?.value),
      note: data?.precipitation?.source ? `Blend: ${data.precipitation.source}` : 'Liquid-equivalent forecast' },
    { id: 'uv', title: 'UV index', value: uvNow != null ? String(uvNow) : '—',
      note: uvNow != null ? `${uvCategory(uvNow)}${uvMax != null ? ` · peak ${uvMax} today` : ''}` : (uvMax != null ? `Peak ${uvMax} today` : 'Not reported'), meter: uvNow != null ? Math.min(1, uvNow / 11) : null },
    { id: 'aqi', title: 'Air quality', value: aqi != null ? String(aqi) : '—', note: aqi != null ? aqiCategory(aqi) : 'Not reported', meter: aqi != null ? Math.min(1, aqi / 300) : null },
    { id: 'pressure', title: 'Pressure', value: finite(cur.pressure) ? cur.pressure.toFixed(2) : '—', unit: 'inHg', note: cur.station ? `Observed at ${cur.station}` : '' },
    { id: 'visibility', title: 'Visibility', value: finite(cur.visibility) ? String(Math.round(cur.visibility)) : '—', unit: 'mi', note: finite(cur.visibility) ? (cur.visibility >= 9 ? 'Clear view' : cur.visibility >= 4 ? 'Slight haze' : 'Reduced') : '' },
  ];
  const rise = Date.parse(solar?.sunrise), set = Date.parse(solar?.sunset);
  const daylight = Number.isFinite(rise) && Number.isFinite(set) ? set - rise : null;
  const left = Number.isFinite(set) && nowMs < set ? set - Math.max(nowMs, rise) : null;
  const dur = (ms) => `${Math.floor(ms / H)}h ${Math.round((ms % H) / 60000)}m`;
  const disc = data?.discussion?.text ? String(data.discussion.text) : '';
  return {
    place: loc.name || '',
    timeZone,
    phase,
    kind,
    nowLabel: fmt(nowMs, timeZone, { weekday: 'long', hour: 'numeric', minute: '2-digit' }),
    hero: {
      temp,
      condition: cur.condition || cur.weather?.label || 'Conditions unavailable',
      feels: feels != null && temp != null && feels !== temp ? feels : null,
      high: days[0]?.high ?? null,
      low: days[0]?.low ?? null,
    },
    story: story({ temp }, hours, timeZone),
    hours,
    curve: hourlyCurve(hours),
    week,
    sun: {
      progress: sunProgress(solar, nowMs),
      sunrise: Number.isFinite(rise) ? timeLabel(rise, timeZone) : null,
      sunset: Number.isFinite(set) ? timeLabel(set, timeZone) : null,
      sub: Number.isFinite(rise) && nowMs < rise ? `Sunrise in ${dur(rise - nowMs)}` : left != null && left > 0 ? `${dur(left)} of daylight left` : daylight ? `${dur(daylight)} of daylight today` : '',
    },
    tiles,
    blend: {
      today: SOURCES.map((s) => ({ ...s, weight: policy.sameDay?.[s.id] ?? null })).filter((s) => finite(s.weight) && s.weight > 0),
      later: SOURCES.map((s) => ({ ...s, weight: policy.extendedRain?.[s.id] ?? null })).filter((s) => finite(s.weight) && s.weight > 0),
      modelHighs,
      note: (data?.modelContributions || []).length
        ? 'Weights renormalize over the sources that reported for this place and hour.'
        : 'Only the NWS forecast is available for this place right now, so it carries the full weight.',
    },
    alerts: (data?.alerts || []).slice(0, 4).map((a) => ({
      event: a.event || 'Weather alert',
      headline: a.headline || '',
      severe: /warning|emergency/i.test(a.event || ''),
    })),
    discussion: disc ? {
      office: data.discussion.office || '',
      issued: Date.parse(data.discussion.issuanceTime),
      excerpt: discussionExcerpt(disc),
      full: disc,
    } : null,
  };
}

/* Pull a readable paragraph from an Area Forecast Discussion. */
export function discussionExcerpt(text) {
  const t = String(text).replace(/\r/g, '');
  const key = t.match(/\.(?:KEY MESSAGES?|SYNOPSIS|WHAT HAS CHANGED)[^\n]*\n+([\s\S]*?)(?:\n\s*\n|&&)/i);
  const raw = (key ? key[1] : t.split(/\n\s*\n/).find((p) => p.replace(/\s+/g, ' ').trim().length > 60) || t);
  const flat = raw.replace(/\s+/g, ' ').replace(/^[-*\s]+/, '').trim();
  const sentence = flat.charAt(0) + flat.slice(1).toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
  const out = /[a-z]/.test(flat) ? flat : sentence;
  return out.length > 420 ? `${out.slice(0, 417).replace(/\s+\S*$/, '')}…` : out;
}

/* ================= Browser ================= */
const $ = (id) => document.getElementById(id);
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function countUp(node, target) {
  if (!finite(target) || reduced()) { node.textContent = target ?? '--'; return; }
  const from = Number(node.textContent) || target - 12, t0 = performance.now(), dur = 1100;
  const step = (t) => {
    const f = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - f, 4);
    node.textContent = Math.round(from + (target - from) * e);
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderHourly(m) {
  const track = $('hourly');
  track.style.width = `${m.hours.length * HOUR_W}px`;
  const cols = m.hours.map((h, i) => {
    const c = finite(h.chance) ? h.chance : 0;
    return `<div class="hour${i === 0 ? ' is-now' : ''}" style="width:${HOUR_W}px">`
      + `<span class="h-time">${i === 0 ? 'Now' : esc(hourLabel(h.time, m.timeZone))}</span>`
      + `<span class="h-icon">${weatherIcon(h.condition, h.isDay, 30)}</span>`
      + `<span class="h-temp">${h.temp ?? '--'}°</span>`
      + `<span class="h-rain${c >= 40 ? ' wet' : ''}"><i style="height:${Math.max(2, c * 0.42).toFixed(1)}px"></i></span>`
      + `<span class="h-pct">${c >= 10 ? `${c}%` : ''}</span></div>`;
  }).join('');
  track.innerHTML = `<div class="hour-cols">${cols}</div><div class="curve-wrap">${m.curve}</div>`;
}

function renderWeek(m) {
  $('week').innerHTML = m.week.map((d, i) => {
    const bar = d.bar
      ? `<span class="range"><i style="left:${d.bar.left.toFixed(1)}%;width:${d.bar.width.toFixed(1)}%;background:linear-gradient(90deg,${d.bar.from},${d.bar.to})"></i>${d.bar.now != null ? `<b style="left:${d.bar.now.toFixed(1)}%"></b>` : ''}</span>`
      : '<span class="range"></span>';
    const rain = finite(d.chance) && d.chance >= 10 ? `<span class="w-rain">${d.chance}%</span>` : '<span class="w-rain"></span>';
    return `<li class="w-row" style="--i:${i}" title="${esc(d.detail)}">`
      + `<span class="w-day">${esc(i === 0 ? 'Today' : d.label.split(' ')[0])}</span>`
      + `<span class="w-icon">${weatherIcon(d.condition, true, 28)}</span>${rain}`
      + `<span class="w-lo">${d.low ?? '--'}°</span>${bar}<span class="w-hi">${d.high ?? '--'}°</span>`
      + `${d.confidence ? `<span class="w-conf" data-conf="${esc(d.confidence.toLowerCase())}" title="Forecast confidence: ${esc(d.confidence)}"></span>` : '<span class="w-conf"></span>'}</li>`;
  }).join('');
}

function renderTiles(m) {
  $('tiles').innerHTML = m.tiles.map((t, i) => {
    let art = '';
    if (t.id === 'wind' && t.dir != null) art = `<svg class="compass" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34"/><text x="40" y="14">N</text><g style="transform:rotate(${(t.dir + 180) % 360}deg);transform-origin:40px 40px"><path class="needle" d="M40 16 46 42H34Z"/><circle cx="40" cy="40" r="3.5"/></g></svg>`;
    if (t.meter != null) art = `<span class="meter meter-${t.id}"><i style="left:${(t.meter * 100).toFixed(1)}%"></i></span>`;
    return `<article class="tile" style="--i:${i}"><h3>${esc(t.title)}</h3><p class="t-val">${esc(t.value)}${t.unit ? `<small>${esc(t.unit)}</small>` : ''}</p>${art}<p class="t-note">${esc(t.note)}</p></article>`;
  }).join('');
}

function renderBlend(m) {
  const bar = (list) => list.map((s) => `<i style="flex:${s.weight};background:${s.color}" title="${s.label} ${Math.round(s.weight * 100)}%"></i>`).join('');
  const legend = (list) => list.map((s) => `<li><span class="sw" style="background:${s.color}"></span>${s.label}<b>${Math.round(s.weight * 100)}%</b></li>`).join('');
  $('blend-today').innerHTML = bar(m.blend.today);
  $('blend-today-legend').innerHTML = legend(m.blend.today);
  $('blend-later').innerHTML = bar(m.blend.later);
  $('blend-later-legend').innerHTML = legend(m.blend.later);
  $('model-highs').innerHTML = m.blend.modelHighs.map((s) => `<li><span class="sw" style="background:${s.color}"></span>${s.label}<b>${s.value != null ? `${s.value}°` : '—'}</b></li>`).join('')
    + `<li class="final"><span class="sw halo"></span>Blend<b>${m.hero.high ?? '—'}°</b></li>`;
  $('blend-note').textContent = m.blend.note;
}

function render(m) {
  document.body.dataset.phase = m.phase;
  document.body.dataset.weather = m.kind;
  document.documentElement.style.setProperty('--sun-x', `${m.sun.progress != null ? 8 + m.sun.progress * 84 : 50}%`);
  document.documentElement.style.setProperty('--sun-y', `${m.sun.progress != null ? 34 - Math.sin(Math.PI * m.sun.progress) * 24 : 70}%`);
  if (m.place) $('place-name').textContent = m.place;
  $('hero-time').textContent = m.nowLabel;
  countUp($('now-temp'), m.hero.temp);
  $('now-cond').textContent = m.hero.condition;
  $('now-feels').textContent = m.hero.feels != null ? `Feels like ${m.hero.feels}°` : '';
  $('now-hilo').textContent = m.hero.high != null ? `H ${m.hero.high}°  ·  L ${m.hero.low ?? '--'}°` : '';
  $('story').textContent = m.story;
  renderHourly(m);
  renderWeek(m);
  $('sun-arc').innerHTML = sunArc(m.sun.progress, m.phase);
  $('sunrise').textContent = m.sun.sunrise || '—';
  $('sunset').textContent = m.sun.sunset || '—';
  $('sun-sub').textContent = m.sun.sub;
  renderTiles(m);
  renderBlend(m);
  const alerts = $('alerts');
  alerts.hidden = !m.alerts.length;
  alerts.innerHTML = m.alerts.map((a) => `<div class="alert${a.severe ? ' severe' : ''}"><strong>${esc(a.event)}</strong>${a.headline ? `<span>${esc(a.headline)}</span>` : ''}</div>`).join('');
  const disc = $('discussion');
  disc.hidden = !m.discussion;
  if (m.discussion) {
    $('disc-sub').textContent = `NWS ${m.discussion.office}${Number.isFinite(m.discussion.issued) ? ` · ${fmt(m.discussion.issued, m.timeZone, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}`;
    $('disc-quote').textContent = m.discussion.excerpt;
    $('disc-full').textContent = m.discussion.full;
  }
  $('updated').textContent = `Updated ${fmt(Date.now(), m.timeZone, { hour: 'numeric', minute: '2-digit' })} · ${m.place}`;
  $('main').setAttribute('aria-busy', 'false');
  document.body.classList.add('ready');
  sky.set(m.kind, m.phase);
}

/* ---- Particle sky: rain, snow and stars on one canvas ---- */
const sky = (() => {
  let ctx, w, h, parts = [], mode = '', raf = 0, dpr = 1;
  const resize = () => {
    const c = $('sky-canvas'); if (!c) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = c.width = innerWidth * dpr; h = c.height = innerHeight * dpr;
    ctx = c.getContext('2d');
    seed();
  };
  const seed = () => {
    const n = mode === 'rain' ? 140 : mode === 'storm' ? 220 : mode === 'snow' ? 120 : mode === 'stars' ? 160 : 0;
    parts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, s: Math.random(), p: Math.random() * 6.28 }));
  };
  const frame = (t) => {
    ctx.clearRect(0, 0, w, h);
    if (mode === 'rain' || mode === 'storm') {
      ctx.strokeStyle = 'rgba(190,220,255,.35)'; ctx.lineWidth = 1.1 * dpr; ctx.beginPath();
      for (const p of parts) {
        const len = (10 + p.s * 16) * dpr;
        p.y += (9 + p.s * 9) * dpr; p.x -= 1.6 * dpr;
        if (p.y > h) { p.y = -len; p.x = Math.random() * w * 1.1; }
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 1.6 * dpr, p.y + len);
      }
      ctx.stroke();
      if (mode === 'storm' && Math.random() < 0.004) document.body.classList.add('flash'), setTimeout(() => document.body.classList.remove('flash'), 140);
    } else if (mode === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      for (const p of parts) {
        p.y += (0.6 + p.s) * dpr; p.x += Math.sin(t / 1400 + p.p) * 0.5 * dpr;
        if (p.y > h) { p.y = -4; p.x = Math.random() * w; }
        ctx.beginPath(); ctx.arc(p.x, p.y, (1 + p.s * 2) * dpr, 0, 6.28); ctx.fill();
      }
    } else if (mode === 'stars') {
      for (const p of parts) {
        if (p.y > h * 0.7) continue;
        ctx.fillStyle = `rgba(255,255,255,${(0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t / 900 + p.p * 7)) * p.s).toFixed(2)})`;
        ctx.fillRect(p.x, p.y, (0.8 + p.s * 1.4) * dpr, (0.8 + p.s * 1.4) * dpr);
      }
    }
    raf = requestAnimationFrame(frame);
  };
  return {
    set(kind, phase) {
      const next = kind === 'storm' ? 'storm' : kind === 'rain' ? 'rain' : kind === 'snow' ? 'snow' : phase === 'night' && kind !== 'cloudy' && kind !== 'fog' ? 'stars' : '';
      if (next === mode && ctx) return;
      mode = next; cancelAnimationFrame(raf);
      if (!ctx) { resize(); addEventListener('resize', resize); } else seed();
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      if (!mode) return;
      if (reduced()) { frame(0); cancelAnimationFrame(raf); return; }
      raf = requestAnimationFrame(frame);
    },
  };
})();

/* ---- Location picker ---- */
const state = { query: { location: 'knightdale' }, name: '' };
const RETURN = '/weather-fusion/halo.html';

async function load() {
  const err = $('error');
  err.hidden = true;
  $('main').setAttribute('aria-busy', 'true');
  try {
    const res = await fetch(`/api/weather-fusion/forecast?${new URLSearchParams(state.query)}`, { credentials: 'same-origin' });
    if (res.status === 401) { window.location.href = `/weather-fusion/login?returnTo=${encodeURIComponent(RETURN + window.location.search)}`; return; }
    if (!res.ok) throw new Error(String(res.status));
    const model = buildHaloModel(await res.json());
    if (state.name) model.place = state.name;
    render(model);
  } catch {
    err.hidden = false;
    err.textContent = 'The sky is not answering right now. Weather data is temporarily unavailable — please try again shortly.';
    $('main').setAttribute('aria-busy', 'false');
  }
}

function choose(query, name) {
  state.query = query; state.name = name || '';
  const url = new URL(window.location.href);
  url.search = new URLSearchParams(query.location ? { location: query.location } : { lat: query.latitude, lon: query.longitude, name: name || '' }).toString();
  history.replaceState(null, '', url);
  togglePanel(false);
  $('now-cond').textContent = 'Reading the sky…';
  load();
}

function togglePanel(open) {
  const panel = $('place-panel'), btn = $('place-btn');
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) $('place-input').focus();
}

function initPicker() {
  $('place-btn').addEventListener('click', () => togglePanel($('place-panel').hidden));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') togglePanel(false); });
  document.addEventListener('click', (e) => { if (!$('place').contains(e.target)) togglePanel(false); });
  for (const b of document.querySelectorAll('[data-location]')) b.addEventListener('click', () => choose({ location: b.dataset.location }, b.textContent));
  let timer = 0, seq = 0;
  $('place-input').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    const list = $('place-results');
    if (q.length < 2) { list.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await fetch(`/api/weather-fusion/search?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' });
        const { results = [] } = res.ok ? await res.json() : {};
        if (mine !== seq) return;
        list.innerHTML = results.length ? '' : '<li class="empty">No U.S. matches</li>';
        for (const r of results.slice(0, 6)) {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = r.name;
          b.addEventListener('click', () => choose(r.id === 'knightdale' || r.id === 'greenville' ? { location: r.id } : { latitude: r.latitude, longitude: r.longitude }, r.name));
          li.appendChild(b); list.appendChild(li);
        }
      } catch { list.innerHTML = '<li class="empty">Search unavailable</li>'; }
    }, 260);
  });
}

function init() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('lat') && p.get('lon')) { state.query = { latitude: p.get('lat'), longitude: p.get('lon') }; state.name = p.get('name') || ''; }
  else if (['knightdale', 'greenville'].includes(p.get('location'))) state.query = { location: p.get('location') };
  initPicker();
  load();
  setInterval(() => { if (document.visibilityState === 'visible') load(); }, 10 * 60000);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
