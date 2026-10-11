/* Halo — Weather Nourie as an Apple-Weather-style app.
 * Every number comes from /api/weather-fusion/forecast, the same blended
 * response the main site renders: hours[].temperature and rainLikelihood,
 * days[].high/low, rainTimeline, metricForecasts.series and precipitation.
 * Pure builders (model, series, chart layout, summaries) are exported for
 * tests; DOM wiring only runs in the browser. */
import { weatherIcon, windDirectionLabel } from './weather-display.js?v=weather-qa-v67';
import { weatherState } from './weather-state.js?v=weather-qa-v67';
import { finite, rainChanceValue } from './weather-math.js?v=weather-qa-v67';

export const H = 3600000;
const round = (n) => (finite(n) ? Math.round(n) : null);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Time helpers (cached Intl formatters) ---------- */
const FMT = new Map();
function formatter(locale, tz, opts) {
  const key = `${locale}|${tz}|${JSON.stringify(opts)}`;
  let f = FMT.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }); FMT.set(key, f); }
  return f;
}
export const fmt = (ms, tz, opts) => formatter('en-US', tz, opts).format(new Date(ms));
export const dayKey = (ms, tz) => formatter('en-CA', tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
export const localHour = (ms, tz) => Number(fmt(ms, tz, { hour: 'numeric', hourCycle: 'h23' })) % 24;
const hourShort = (ms, tz) => fmt(ms, tz, { hour: 'numeric' }).replace(' ', '');
const clock = (ms, tz) => fmt(ms, tz, { hour: 'numeric', minute: '2-digit' });

/* ---------- Colour ---------- */
const RAMP = [[0, [150, 140, 255]], [20, [120, 170, 255]], [35, [110, 205, 255]], [50, [100, 224, 210]], [62, [160, 232, 130]], [72, [240, 226, 100]], [82, [255, 176, 80]], [92, [255, 120, 80]], [104, [240, 70, 110]]];
export function tempColor(t) {
  if (!finite(t)) return 'rgb(200,210,225)';
  if (t <= RAMP[0][0]) return `rgb(${RAMP[0][1].join(',')})`;
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, c1] = RAMP[i], [t0, c0] = RAMP[i - 1];
    if (t <= t1) { const f = (t - t0) / (t1 - t0); return `rgb(${c0.map((c, k) => Math.round(c + f * (c1[k] - c))).join(',')})`; }
  }
  return `rgb(${RAMP.at(-1)[1].join(',')})`;
}
export function uvColor(v) {
  if (!finite(v)) return '#8fa3b8';
  return v < 3 ? '#7ddc6f' : v < 6 ? '#f2d94e' : v < 8 ? '#ffa43b' : v < 11 ? '#ff5b5b' : '#c27bff';
}

/* ---------- Sky ---------- */
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
export function sunProgress(solar, nowMs) {
  const rise = Date.parse(solar?.sunrise), set = Date.parse(solar?.sunset);
  if (!Number.isFinite(rise) || !Number.isFinite(set) || set <= rise) return null;
  const f = (nowMs - rise) / (set - rise);
  return f >= 0 && f <= 1 ? f : null;
}

/* ---------- Categories ---------- */
export function uvCategory(uv) { return !finite(uv) ? '' : uv < 3 ? 'Low' : uv < 6 ? 'Moderate' : uv < 8 ? 'High' : uv < 11 ? 'Very High' : 'Extreme'; }
export function aqiCategory(aqi) { return !finite(aqi) ? '' : aqi <= 50 ? 'Good' : aqi <= 100 ? 'Moderate' : aqi <= 150 ? 'Unhealthy for Sensitive Groups' : aqi <= 200 ? 'Unhealthy' : aqi <= 300 ? 'Very Unhealthy' : 'Hazardous'; }
export function dewComfort(dp) { return !finite(dp) ? '' : dp < 50 ? 'dry' : dp < 58 ? 'comfortable' : dp < 63 ? 'a touch humid' : dp < 68 ? 'sticky' : dp < 73 ? 'muggy' : 'oppressive'; }
export function inches(v) { return !finite(v) ? '—' : v === 0 ? '0"' : v < 0.01 ? '<0.01"' : `${v.toFixed(2)}"`; }
function windMph(v) {
  if (finite(v)) return v;
  const m = String(v ?? '').match(/(\d+)(?:\s*to\s*(\d+))?/);
  return m ? Number(m[2] || m[1]) : null;
}

/* ---------- Series: the same blended hourly values the main site charts ---------- */
function points(list, pick) {
  return (list || []).map((r) => ({ t: Date.parse(r.time), v: pick(r) })).filter((p) => Number.isFinite(p.t)).map((p) => ({ ...p, v: finite(p.v) ? p.v : null }));
}
/* Canonical hourly rows win where both exist; the longer metric series extends them. */
function merge(primary, secondary) {
  const map = new Map();
  for (const p of secondary) map.set(p.t, p);
  for (const p of primary) if (p.v != null || !map.has(p.t)) map.set(p.t, { ...map.get(p.t), ...p });
  return [...map.values()].sort((a, b) => a.t - b.t);
}
export function buildSeries(data) {
  const s = data?.metricForecasts?.series || {}, hours = data?.hours || [];
  const val = (r) => r.value;
  const rows = (data?.rainTimeline || []).length ? data.rainTimeline : hours;
  const rain = rows.map((r) => ({ t: Date.parse(r.time), v: rainChanceValue(r.rainLikelihood, r.officialPop ?? r.pop), amt: finite(r.precipitation) ? r.precipitation : null }));
  return {
    temperature: merge(points(hours, (h) => h.temperature), points(s.temperature, val)),
    feels: merge(points(hours, (h) => h.apparent), points(s.feels, val)),
    precip: rain.filter((p) => Number.isFinite(p.t)).map((p) => ({ ...p, v: finite(p.v) ? p.v : null })).sort((a, b) => a.t - b.t),
    wind: merge(points(hours, (h) => windMph(h.wind)), points(s.wind, val)),
    gust: merge(points(hours, (h) => windMph(h.gust)), points(s.gust, val)),
    humidity: merge(points(hours, (h) => h.humidity), points(s.humidity, val)),
    dewpoint: merge(points(hours, (h) => h.dewpoint), points(s.dewpoint, val)),
    uv: points(data?.uv?.hourly, val),
  };
}

export const METRICS = {
  temperature: { label: 'Temperature', unit: '°', kind: 'line', color: 'temp' },
  feels: { label: 'Feels Like', unit: '°', kind: 'line', color: 'temp' },
  precip: { label: 'Precipitation', unit: '%', kind: 'bars', domain: [0, 100], color: '#4fa8ff' },
  wind: { label: 'Wind', unit: ' mph', kind: 'line', min0: true, color: '#8ce8d5' },
  humidity: { label: 'Humidity', unit: '%', kind: 'line', domain: [0, 100], color: '#78c8ff' },
  dewpoint: { label: 'Dew Point', unit: '°', kind: 'line', color: '#9ef0c2' },
  uv: { label: 'UV Index', unit: '', kind: 'bars', domain: [0, 12], color: 'uv' },
};

/* ---------- Night bands from per-day calculated sunrise/sunset ---------- */
export function solarDays(data) {
  const list = data?.metricForecasts?.solar?.length ? data.metricForecasts.solar : (data?.solar ? [data.solar] : []);
  return list.map((d) => ({ rise: Date.parse(d.sunrise), set: Date.parse(d.sunset) })).filter((d) => Number.isFinite(d.rise) && Number.isFinite(d.set)).sort((a, b) => a.rise - b.rise);
}
export function nightBands(sol, t0, t1) {
  const out = [];
  if (!sol.length) return out;
  if (t0 < sol[0].rise) out.push([t0, Math.min(t1, sol[0].rise)]);
  for (let i = 0; i < sol.length; i++) {
    const a = sol[i].set, b = sol[i + 1]?.rise ?? sol[i].rise + 24 * H;
    if (b > t0 && a < t1) out.push([Math.max(a, t0), Math.min(b, t1)]);
  }
  return out.filter(([a, b]) => b > a);
}

/* ---------- Chart layout (pure) ---------- */
export function niceStep(x) {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x)), n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
export function smoothPath(xy) {
  if (!xy.length) return '';
  let d = `M${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[Math.max(0, i - 1)], p1 = xy[i], p2 = xy[i + 1], p3 = xy[Math.min(xy.length - 1, i + 2)];
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
export function layoutChart(spec) {
  const { points: pts = [], extra = [], t0, t1, width = 600, height = 220, domain, min0 = false, tz = 'America/New_York', multiDay = false } = spec;
  const pad = { l: 6, r: 38, t: 22, b: 26 };
  const inRange = (p) => p.t >= t0 && p.t <= t1;
  const vals = pts.filter(inRange), ext = extra.filter(inRange);
  const nums = [...vals, ...ext].map((p) => p.v).filter(finite);
  let lo, hi, step;
  if (domain) {
    [lo, hi] = domain;
    if (nums.length && Math.max(...nums) > hi) hi = Math.ceil(Math.max(...nums));
    step = niceStep((hi - lo) / 4);
  } else if (!nums.length) { lo = 0; hi = 4; step = 1; }
  else {
    const mn = Math.min(...nums), mx = Math.max(...nums);
    step = niceStep(Math.max(mx - mn, 4) / 4);
    lo = min0 ? 0 : Math.floor((mn - step * 0.25) / step) * step;
    hi = Math.ceil((mx + step * 0.25) / step) * step;
    if (hi === lo) hi = lo + step;
  }
  const W = width, Ht = height, iw = W - pad.l - pad.r, ih = Ht - pad.t - pad.b;
  const x = (t) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * ih;
  const segs = (list) => {
    const out = []; let cur = [];
    for (const p of list) {
      if (!finite(p.v) || (cur.length && p.t - cur.at(-1).t > 1.5 * H)) { if (cur.length) out.push(cur); cur = []; }
      if (finite(p.v)) cur.push(p);
    }
    if (cur.length) out.push(cur);
    return out;
  };
  const lineSegs = segs(vals).map((s) => s.map((p) => [x(p.t), y(p.v)]));
  const paths = lineSegs.map(smoothPath);
  const floor = (pad.t + ih).toFixed(1);
  const areas = lineSegs.filter((s) => s.length > 1).map((s) => `${smoothPath(s)}L${s.at(-1)[0].toFixed(1)} ${floor}L${s[0][0].toFixed(1)} ${floor}Z`);
  const extraPaths = segs(ext).map((s) => smoothPath(s.map((p) => [x(p.t), y(p.v)])));
  const bw = Math.max(2, (x(t0 + H) - x(t0)) * 0.62);
  const bars = vals.filter((p) => finite(p.v)).map((p) => ({ t: p.t, v: p.v, x: x(p.t) - bw / 2, y: y(Math.max(lo, p.v)), w: bw, h: Math.max(p.v > lo ? 1.5 : 0, pad.t + ih - y(Math.max(lo, p.v))) }));
  const yTicks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) yTicks.push({ v: Math.round(v * 100) / 100, y: y(v) });
  const xTicks = [];
  const every = multiDay ? 12 : 6;
  for (let t = Math.ceil(t0 / H) * H; t <= t1; t += H) {
    const hr = localHour(t, tz);
    if (hr % every === 0) xTicks.push({ t, x: x(t), label: hr === 0 && multiDay ? fmt(t, tz, { weekday: 'short' }) : hourShort(t, tz), midnight: hr === 0 });
  }
  const finiteVals = vals.filter((p) => finite(p.v));
  const hiPt = finiteVals.length ? finiteVals.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const loPt = finiteVals.length ? finiteVals.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  return { W, H: Ht, pad, iw, ih, lo, hi, x, y, paths, areas, extraPaths, bars, yTicks, xTicks, vals: finiteVals, extra: ext, hiPt, loPt };
}

/* ---------- Summaries ---------- */
export function story(cur, hours, tz) {
  const parts = [];
  const h24 = hours.slice(0, 24);
  const nowChance = h24[0]?.chance;
  if (finite(nowChance) && nowChance >= 50) {
    const dry = h24.find((h) => finite(h.chance) && h.chance < 30);
    parts.push(dry ? `Rain likely now, easing around ${hourShort(dry.time, tz)}.` : 'Rain likely through the next 24 hours.');
  } else {
    const wet = h24.find((h) => finite(h.chance) && h.chance >= 40);
    if (wet) parts.push(`Rain chance climbs to ${wet.chance}% around ${hourShort(wet.time, tz)}.`);
    else {
      const maybe = h24.find((h) => finite(h.chance) && h.chance >= 20);
      parts.push(maybe ? `Mostly dry, with a ${maybe.chance}% rain chance near ${hourShort(maybe.time, tz)}.` : 'Dry conditions for the next 24 hours.');
    }
  }
  const h12 = hours.slice(0, 12).filter((h) => finite(h.temp));
  if (h12.length > 2 && finite(cur.temp)) {
    const peak = h12.reduce((a, b) => (b.temp > a.temp ? b : a)), low = h12.reduce((a, b) => (b.temp < a.temp ? b : a));
    if (peak.temp >= cur.temp + 2) parts.unshift(`Warming to ${peak.temp}° by ${hourShort(peak.time, tz)}.`);
    else if (low.temp <= cur.temp - 3) parts.unshift(`Cooling to ${low.temp}° by ${hourShort(low.time, tz)}.`);
  }
  if (finite(cur.gust) && cur.gust >= 20) parts.push(`Wind gusts up to ${Math.round(cur.gust)} mph.`);
  return parts.join(' ');
}

export function dayPoints(series, key, tz) { return (series || []).filter((p) => dayKey(p.t, tz) === key); }

export function dailySummary(metric, pts, extra, dayLabel, tz) {
  const ok = pts.filter((p) => finite(p.v));
  if (!ok.length) return `No ${METRICS[metric].label.toLowerCase()} forecast is available for ${dayLabel === 'Today' ? 'today' : dayLabel} yet.`;
  const max = ok.reduce((a, b) => (b.v > a.v ? b : a)), min = ok.reduce((a, b) => (b.v < a.v ? b : a));
  const avg = ok.reduce((s, p) => s + p.v, 0) / ok.length;
  const at = (p) => hourShort(p.t, tz);
  const when = dayLabel;
  switch (metric) {
    case 'temperature': return `${when}, expect a high of ${Math.round(max.v)}° around ${at(max)} and a low of ${Math.round(min.v)}° near ${at(min)}.`;
    case 'feels': return `${when}, it will feel as warm as ${Math.round(max.v)}° around ${at(max)} and as cool as ${Math.round(min.v)}° near ${at(min)}, accounting for humidity, wind and sun.`;
    case 'precip': {
      const total = pts.reduce((s, p) => s + (finite(p.amt) ? p.amt : 0), 0);
      if (max.v < 10) return `${when}, rain is not expected. The blended chance stays below 10%.`;
      return `${when}, the blended rain chance peaks at ${Math.round(max.v)}% around ${at(max)}${total >= 0.01 ? `, with about ${inches(total)} of rain forecast` : ''}.`;
    }
    case 'wind': {
      const g = (extra || []).filter((p) => finite(p.v));
      const gmax = g.length ? Math.max(...g.map((p) => p.v)) : null;
      return `${when}, wind speeds range from ${Math.round(min.v)} to ${Math.round(max.v)} mph${gmax != null && gmax > max.v ? `, with gusts up to ${Math.round(gmax)} mph` : ''}.`;
    }
    case 'humidity': return `${when}, average humidity is ${Math.round(avg)}%, ranging from ${Math.round(min.v)}% around ${at(min)} to ${Math.round(max.v)}% around ${at(max)}.`;
    case 'dewpoint': return `${when}, the dew point ranges from ${Math.round(min.v)}° to ${Math.round(max.v)}°, which feels ${dewComfort(avg)}.`;
    case 'uv': {
      const prot = ok.filter((p) => p.v >= 3);
      return max.v < 3 ? `${when}, the UV index stays low.` : `${when}, the UV index peaks at ${Math.round(max.v)} (${uvCategory(max.v)}) around ${at(max)}.${prot.length ? ` Use sun protection from ${at(prot[0])} to ${hourShort(prot.at(-1).t + H, tz)}.` : ''}`;
    }
    default: return '';
  }
}

export function discussionExcerpt(text) {
  const t = String(text).replace(/\r/g, '');
  const key = t.match(/\.(?:KEY MESSAGES?|SYNOPSIS|WHAT HAS CHANGED)[^\n]*\n+([\s\S]*?)(?:\n\s*\n|&&)/i);
  const raw = key ? key[1] : (t.split(/\n\s*\n/).find((p) => p.replace(/\s+/g, ' ').trim().length > 60) || t);
  const flat = raw.replace(/\s+/g, ' ').replace(/^[-*\s]+/, '').trim();
  const out = /[a-z]/.test(flat) ? flat : flat.charAt(0) + flat.slice(1).toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
  return out.length > 420 ? `${out.slice(0, 417).replace(/\s+\S*$/, '')}…` : out;
}

/* ---------- The page model ---------- */
export function buildModel(data, nowMs = Date.now()) {
  const loc = data?.location || {};
  const tz = loc.timeZone || 'America/New_York';
  const cur = data?.current || {};
  const sol = solarDays(data);
  const todaySolar = data?.solar || null;
  const temp = round(cur.temperature);
  const hours = (data?.hours || []).map((h) => ({ ...h, t: Date.parse(h.time) })).filter((h) => Number.isFinite(h.t) && h.t + H > nowMs)
    .map((h) => ({ time: h.t, temp: round(h.temperature), chance: round(rainChanceValue(h.rainLikelihood, h.pop)), condition: h.condition || '', isDay: h.isDay !== false }));
  /* Hourly strip with sunrise/sunset inserted like the iOS app. */
  const windowEnd = (hours[0]?.time ?? nowMs) + 24 * H;
  const strip = hours.filter((h) => h.time < windowEnd).map((h, i) => ({ type: 'hour', ...h, label: i === 0 ? 'Now' : hourShort(h.time, tz) }));
  for (const d of sol) for (const [type, t] of [['sunrise', d.rise], ['sunset', d.set]]) {
    if (t > nowMs && t < windowEnd) strip.push({ type, time: t, label: clock(t, tz).replace(' ', '') });
  }
  strip.sort((a, b) => (a.label === 'Now' ? -1 : b.label === 'Now' ? 1 : a.time - b.time));

  const rawDays = (data?.days || []).slice(0, 10);
  const days = rawDays.map((d, i) => {
    const noon = Date.parse(`${d.date}T12:00:00Z`), ok = Number.isFinite(noon);
    return {
      key: d.date || '',
      label: i === 0 ? 'Today' : ok ? fmt(noon, 'UTC', { weekday: 'short' }) : (d.label || ''),
      long: i === 0 ? 'Today' : ok ? fmt(noon, 'UTC', { weekday: 'long' }) : (d.label || ''),
      dateLabel: ok ? fmt(noon, 'UTC', { weekday: 'long', month: 'long', day: 'numeric' }) : '',
      dayNum: ok ? fmt(noon, 'UTC', { day: 'numeric' }) : '',
      letter: ok ? fmt(noon, 'UTC', { weekday: 'narrow' }) : '',
      high: round(d.high), low: round(d.low),
      chance: round(rainChanceValue(d.rainLikelihood, d.pop)),
      qpf: finite(d.qpfBlend?.value) ? d.qpfBlend.value : (finite(d.qpf) ? d.qpf : null),
      condition: d.condition || '', detail: d.detail || '',
    };
  });
  const temps = days.flatMap((d) => [d.low, d.high]).filter(finite).concat(finite(temp) ? [temp] : []);
  const wLo = temps.length ? Math.min(...temps) : 0, wHi = temps.length ? Math.max(...temps) : 1, span = Math.max(1, wHi - wLo);
  for (const [i, d] of days.entries()) {
    const lo = finite(d.low) ? d.low : d.high, hi = finite(d.high) ? d.high : d.low;
    d.bar = finite(lo) && finite(hi) ? {
      left: ((lo - wLo) / span) * 100, width: Math.max(6, ((hi - lo) / span) * 100),
      gradient: `linear-gradient(90deg,${tempColor(lo)},${tempColor((lo + hi) / 2)},${tempColor(hi)})`,
      now: i === 0 && finite(temp) ? Math.min(100, Math.max(0, ((temp - wLo) / span) * 100)) : null,
    } : null;
  }

  const series = buildSeries(data);
  const feels = round(cur.feelsLike ?? cur.apparent);
  const wind = windMph(cur.wind), gust = windMph(cur.gust);
  const uvNowPt = series.uv.filter((p) => p.t <= nowMs && finite(p.v)).at(-1);
  const uvNow = uvNowPt ? Math.round(uvNowPt.v) : null;
  const uvToday = dayPoints(series.uv, dayKey(nowMs, tz), tz).filter((p) => finite(p.v));
  const uvAhead = uvToday.filter((p) => p.t >= nowMs - H && p.v >= 3);
  const aqi = finite(data?.airQuality?.aqi) ? Math.round(data.airQuality.aqi) : null;
  const sunEvents = sol.flatMap((d) => [{ type: 'Sunrise', t: d.rise }, { type: 'Sunset', t: d.set }]);
  const nextSun = sunEvents.find((e) => e.t > nowMs);
  const otherSun = nextSun && sunEvents.find((e) => e.t > nextSun.t);
  const nextWet = days.slice(1).find((d) => finite(d.qpf) && d.qpf >= 0.05);
  const p24 = data?.precipitation?.value;

  const tiles = [];
  if (aqi != null) tiles.push({ id: 'aqi', title: 'Air Quality', wide: true, value: String(aqi), sub: aqiCategory(aqi), meter: Math.min(1, aqi / 300), note: aqi <= 50 ? 'Air quality is ideal for most people today.' : aqi <= 100 ? 'Acceptable; unusually sensitive people should limit long outdoor exertion.' : 'Consider limiting time outdoors.' });
  tiles.push({ id: 'feels', metric: 'feels', title: 'Feels Like', value: feels != null ? `${feels}°` : '—',
    sub: finite(cur.feelsLikeShade) && feels != null && Math.round(cur.feelsLikeShade) !== feels ? `${Math.round(cur.feelsLikeShade)}° in shade` : '',
    note: feels == null || temp == null ? '' : feels > temp + 1 ? 'Humidity and sun make it feel warmer than the actual temperature.' : feels < temp - 1 ? 'Wind is making it feel cooler.' : 'Similar to the actual temperature.' });
  tiles.push({ id: 'uv', metric: 'uv', title: 'UV Index', value: uvNow != null ? String(uvNow) : '—', sub: uvNow != null ? uvCategory(uvNow) : 'Not reported', meter: uvNow != null ? Math.min(1, uvNow / 11) : null,
    note: uvAhead.length ? `Use sun protection until ${hourShort(uvAhead.at(-1).t + H, tz)}.` : uvToday.length ? 'Low for the rest of the day.' : 'UV forecast unavailable.' });
  tiles.push({ id: 'wind', metric: 'wind', title: 'Wind', value: wind != null ? String(Math.round(wind)) : '—', gust: gust != null ? Math.round(gust) : null,
    dir: finite(cur.windDirection) ? cur.windDirection : null, dirLabel: finite(cur.windDirection) ? windDirectionLabel(cur.windDirection) : '' });
  tiles.push({ id: 'sun', wide: true, title: nextSun ? nextSun.type : 'Sunset', value: nextSun ? clock(nextSun.t, tz) : '—', progress: sunProgress(todaySolar, nowMs),
    note: otherSun ? `${otherSun.type}: ${clock(otherSun.t, tz)}` : '' });
  tiles.push({ id: 'precip', metric: 'precip', title: 'Precipitation', value: inches(p24), sub: 'in next 24h',
    note: nextWet ? `Next expected is ${inches(nextWet.qpf)} on ${nextWet.long}.` : finite(p24) && p24 >= 0.01 ? 'Rain is in the forecast for the next 24 hours.' : 'None expected in the coming days.' });
  tiles.push({ id: 'humidity', metric: 'humidity', title: 'Humidity', value: finite(cur.humidity) ? `${Math.round(cur.humidity)}%` : '—',
    note: finite(cur.dewpoint) ? `The dew point is ${Math.round(cur.dewpoint)}° right now — ${dewComfort(cur.dewpoint)}.` : '' });
  tiles.push({ id: 'visibility', title: 'Visibility', wide: aqi != null, value: finite(cur.visibility) ? String(Math.round(cur.visibility)) : '—', unit: 'mi',
    note: !finite(cur.visibility) ? '' : cur.visibility >= 9 ? 'Perfectly clear view.' : cur.visibility >= 4 ? 'Haze is slightly reducing visibility.' : 'Fog or precipitation is reducing visibility.' });
  tiles.push({ id: 'pressure', title: 'Pressure', wide: aqi != null, pressure: finite(cur.pressure) ? cur.pressure : null });

  const policy = data?.blendPolicy || {};
  const SOURCES = [['nws', 'NWS', '#f4f1e8'], ['hrrr', 'HRRR', '#7fd4ff'], ['nbm', 'NBM', '#9ef0c2'], ['ecmwf', 'ECMWF', '#ffc27a']];
  const guidance = rawDays[0]?.guidance || {};
  const disc = data?.discussion?.text ? String(data.discussion.text) : '';
  const phaseSolar = todaySolar || (sol[0] && { sunrise: new Date(sol[0].rise).toISOString(), sunset: new Date(sol[0].set).toISOString() });
  return {
    place: loc.name || '',
    tz, phase: skyPhase(phaseSolar, nowMs),
    kind: cur.weather?.kind || weatherState(cur.condition).kind,
    sunProgress: sunProgress(phaseSolar, nowMs),
    localTime: clock(nowMs, tz),
    hero: { temp, condition: cur.condition || cur.weather?.label || 'Conditions unavailable', high: days[0]?.high ?? null, low: days[0]?.low ?? null, feels },
    summary: story({ temp, gust }, hours, tz),
    strip, days, series, sol, tiles,
    blend: {
      today: SOURCES.map(([id, label, color]) => ({ id, label, color, weight: policy.sameDay?.[id] })).filter((s) => finite(s.weight) && s.weight > 0),
      later: SOURCES.map(([id, label, color]) => ({ id, label, color, weight: policy.extendedRain?.[id] })).filter((s) => finite(s.weight) && s.weight > 0),
      highs: SOURCES.map(([id, label, color]) => ({ id, label, color, value: id === 'nws' ? round(rawDays[0]?.official?.high ?? rawDays[0]?.high) : round(guidance[id]?.high) })),
      note: (data?.modelContributions || []).length ? 'Weights renormalize over the sources reporting for this place and hour. Rain chance is a blended score, not a calibrated probability.' : 'Only the NWS forecast is available for this place right now, so it carries the full weight.',
    },
    alerts: (data?.alerts || []).slice(0, 4).map((a) => ({ event: a.event || 'Weather alert', headline: a.headline || '', severe: /warning|emergency/i.test(a.event || '') })),
    discussion: disc ? { office: data.discussion.office || '', issued: Date.parse(data.discussion.issuanceTime), excerpt: discussionExcerpt(disc), full: disc } : null,
  };
}

/* ======================================================================
 * Browser
 * ====================================================================== */
const $ = (id) => document.getElementById(id);
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let uid = 0;

/* ---------- Interactive chart ---------- */
function chartSVG(L, spec, def) {
  const id = `c${++uid}`;
  const tempLike = def.color === 'temp';
  const solid = def.color === 'uv' ? '#f2d94e' : def.color;
  const color = tempLike ? `url(#${id}-line)` : solid;
  const nowX = spec.nowT != null && spec.nowT > spec.t0 && spec.nowT < spec.t1 ? L.x(spec.nowT) : null;
  const top = L.pad.t, bottom = L.pad.t + L.ih;
  let defs = `<clipPath id="${id}-past"><rect x="0" y="0" width="${nowX ?? 0}" height="${L.H}"/></clipPath><clipPath id="${id}-future"><rect x="${nowX ?? 0}" y="0" width="${L.W}" height="${L.H}"/></clipPath>`;
  if (tempLike) {
    const stops = [0, 0.25, 0.5, 0.75, 1].map((f) => `<stop offset="${f}" stop-color="${tempColor(L.hi - f * (L.hi - L.lo))}"/>`).join('');
    defs += `<linearGradient id="${id}-line" gradientUnits="userSpaceOnUse" x1="0" y1="${top}" x2="0" y2="${bottom}">${stops}</linearGradient>`;
  }
  defs += `<linearGradient id="${id}-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${tempLike ? '#fff' : solid}" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  const nights = (spec.nights || []).map(([a, b]) => `<rect class="c-night" x="${L.x(a).toFixed(1)}" y="${top}" width="${(L.x(b) - L.x(a)).toFixed(1)}" height="${L.ih}"/>`).join('');
  const suffix = def.unit === '°' ? '°' : def.unit === '%' ? '%' : '';
  const grid = L.yTicks.map((tk) => `<line class="c-grid" x1="${L.pad.l}" x2="${L.W - L.pad.r}" y1="${tk.y.toFixed(1)}" y2="${tk.y.toFixed(1)}"/><text class="c-ylab" x="${L.W - L.pad.r + 7}" y="${(tk.y + 4).toFixed(1)}">${tk.v}${suffix}</text>`).join('');
  const xt = L.xTicks.map((tk) => `${tk.midnight ? `<line class="c-mid" x1="${tk.x.toFixed(1)}" x2="${tk.x.toFixed(1)}" y1="${top}" y2="${bottom}"/>` : ''}<text class="c-xlab" x="${tk.x.toFixed(1)}" y="${L.H - 6}">${esc(tk.label)}</text>`).join('');
  let body;
  if (def.kind === 'bars') {
    const rects = L.bars.map((b, i) => `<rect style="--d:${i * 12}ms" x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" rx="${Math.min(3, b.w / 2).toFixed(1)}" fill="${def.color === 'uv' ? uvColor(b.v) : def.color}"${nowX != null && b.t + H <= spec.nowT ? ' opacity=".35"' : ''}/>`).join('');
    body = `<g class="c-bars">${rects}</g>`;
  } else {
    const layer = (cls) => `${L.areas.map((d) => `<path class="c-area" d="${d}" fill="url(#${id}-area)"/>`).join('')}${L.extraPaths.map((d) => `<path class="c-extra" d="${d}" stroke="${color}"/>`).join('')}${L.paths.map((d) => `<path class="c-line ${cls}" pathLength="1" d="${d}" stroke="${color}"/>`).join('')}`;
    body = nowX != null ? `<g clip-path="url(#${id}-past)" class="c-past">${layer('')}</g><g clip-path="url(#${id}-future)">${layer('draw')}</g>` : `<g>${layer('draw')}</g>`;
  }
  let marks = '';
  if (def.kind === 'line' && L.hiPt && L.loPt && L.hiPt !== L.loPt) {
    marks += `<text class="c-hl" x="${L.x(L.hiPt.t).toFixed(1)}" y="${(L.y(L.hiPt.v) - 9).toFixed(1)}">H</text>`;
    marks += `<text class="c-hl" x="${L.x(L.loPt.t).toFixed(1)}" y="${(L.y(L.loPt.v) + 18).toFixed(1)}">L</text>`;
  }
  if (nowX != null && L.vals.length && def.kind === 'line') {
    const nowPt = L.vals.reduce((a, b) => (Math.abs(b.t - spec.nowT) < Math.abs(a.t - spec.nowT) ? b : a));
    marks += `<circle class="c-nowdot" cx="${nowX.toFixed(1)}" cy="${L.y(nowPt.v).toFixed(1)}" r="5"/>`;
  }
  const scrub = `<g class="c-scrub" visibility="hidden"><line x1="0" x2="0" y1="${top - 8}" y2="${bottom}"/><circle r="6"/></g>`;
  return `<svg width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}" role="img" aria-label="${esc(def.label)} graph">`
    + `<defs>${defs}</defs>${nights}${grid}${xt}${body}${marks}${scrub}</svg>`;
}

function mountChart(el, spec, def, onScrub) {
  const draw = () => {
    const width = Math.max(260, el.clientWidth), height = el.classList.contains('tall') ? 260 : 210;
    const L = layoutChart({ ...spec, width, height, domain: def.domain, min0: def.min0 });
    el.innerHTML = chartSVG(L, spec, def);
    if (!L.vals.length) el.insertAdjacentHTML('beforeend', '<p class="c-empty">No forecast data for this period yet</p>');
    const svg = el.querySelector('svg'), g = svg.querySelector('.c-scrub'), line = g.querySelector('line'), dot = g.querySelector('circle');
    const pick = (ev) => {
      if (!L.vals.length) return;
      const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * L.W;
      let best = L.vals[0];
      for (const p of L.vals) if (Math.abs(L.x(p.t) - px) < Math.abs(L.x(best.t) - px)) best = p;
      const cx = L.x(best.t), cy = def.kind === 'bars' ? L.y(Math.max(L.lo, best.v)) : L.y(best.v);
      line.setAttribute('x1', cx); line.setAttribute('x2', cx); dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
      dot.setAttribute('fill', def.color === 'temp' ? tempColor(best.v) : def.color === 'uv' ? uvColor(best.v) : def.color);
      g.setAttribute('visibility', 'visible');
      onScrub?.(best, (spec.extra || []).find((p) => p.t === best.t));
    };
    const end = () => { g.setAttribute('visibility', 'hidden'); onScrub?.(null); };
    svg.addEventListener('pointerdown', (e) => { svg.setPointerCapture?.(e.pointerId); pick(e); });
    svg.addEventListener('pointermove', pick);
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointerleave', end);
    svg.addEventListener('pointercancel', end);
  };
  el._redraw = draw;
  draw();
}
const chartRO = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver((entries) => { for (const e of entries) { const w = Math.round(e.contentRect.width); if (e.target._w !== w) { const first = e.target._w == null; e.target._w = w; if (!first) e.target._redraw?.(); } } })
  : null;

function fmtValue(metric, p, gust) {
  if (!p || !finite(p.v)) return '--';
  if (metric === 'precip') return `${Math.round(p.v)}%${finite(p.amt) && p.amt >= 0.01 ? ` · ${inches(p.amt)}` : ''}`;
  if (metric === 'wind') return `${Math.round(p.v)} mph${gust && finite(gust.v) ? ` · gusts ${Math.round(gust.v)}` : ''}`;
  if (metric === 'uv') return `${Math.round(p.v)} ${uvCategory(p.v)}`;
  return `${Math.round(p.v)}${METRICS[metric].unit}`;
}

/* ---------- App state ---------- */
const PRESETS = [{ id: 'knightdale', name: 'Knightdale / Raleigh' }, { id: 'greenville', name: 'Greenville, NC' }];
const STORE = 'halo.places.v1';
const state = { places: [], index: 0, model: null, metric: 'temperature', trend: 'temperature', sheetDay: 0, cache: new Map() };
function loadPlaces() {
  let custom = [];
  try { custom = JSON.parse(localStorage.getItem(STORE) || '[]').filter((p) => p && finite(p.latitude) && finite(p.longitude) && typeof p.name === 'string').slice(0, 10); } catch { /* storage unavailable */ }
  state.places = [...PRESETS, ...custom];
}
function savePlaces() { try { localStorage.setItem(STORE, JSON.stringify(state.places.filter((p) => !p.id))); } catch { /* storage unavailable */ } }
const placeQuery = (p) => (p.id ? { location: p.id } : { latitude: String(p.latitude), longitude: String(p.longitude) });
const placeKey = (p) => (p.id ? p.id : `${p.latitude},${p.longitude}`);

async function fetchForecast(place, force = false) {
  const key = placeKey(place), hit = state.cache.get(key);
  if (!force && hit && Date.now() - hit.at < 5 * 60000) return hit.data;
  const res = await fetch(`/api/weather-fusion/forecast?${new URLSearchParams(placeQuery(place))}`, { credentials: 'same-origin' });
  if (res.status === 401) { window.location.href = `/weather-fusion/login?returnTo=${encodeURIComponent('/weather-fusion/halo.html' + window.location.search)}`; throw new Error('auth'); }
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  state.cache.set(key, { at: Date.now(), data });
  return data;
}

/* ---------- Rendering ---------- */
function countUp(node, target) {
  if (!finite(target) || reduced()) { node.textContent = target ?? '--'; return; }
  const from = Number(node.textContent), start = Number.isFinite(from) ? from : target - 8, t0 = performance.now();
  const step = (t) => { const f = Math.min(1, (t - t0) / 900), e = 1 - (1 - f) ** 4; node.textContent = Math.round(start + (target - start) * e); if (f < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const shortName = (name) => String(name || '').split(',')[0].split(' / ')[0];

function renderHero(m, place) {
  const name = shortName(place.name || m.place);
  $('hero-place').textContent = name;
  $('hero-kicker').textContent = state.index === 0 ? 'Home' : m.localTime;
  countUp($('now-temp'), m.hero.temp);
  $('now-cond').textContent = m.hero.condition;
  $('now-hilo').textContent = m.hero.high != null ? `H:${m.hero.high}°  L:${m.hero.low ?? '--'}°` : '';
  $('compact-place').textContent = name;
  $('compact-line').textContent = `${m.hero.temp ?? '--'}° | ${m.hero.condition}`;
}

const SUN_ICONS = {
  sunrise: '<svg viewBox="0 0 50 50" width="30" height="30" aria-hidden="true"><path d="M8 36h34" stroke="#ffd98f" stroke-width="2.4" stroke-linecap="round"/><path d="M15 36a10 10 0 0 1 20 0" fill="#ffdb83"/><path d="M25 8v9m-6-3 6-6 6 6" stroke="#ffdb83" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sunset: '<svg viewBox="0 0 50 50" width="30" height="30" aria-hidden="true"><path d="M8 36h34" stroke="#ffb98a" stroke-width="2.4" stroke-linecap="round"/><path d="M15 36a10 10 0 0 1 20 0" fill="#ffb98a"/><path d="M25 8v9m-6-3 6 6 6-6" stroke="#ffb98a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
function renderHourly(m) {
  $('hourly-summary').textContent = m.summary;
  $('hourly').innerHTML = m.strip.map((h) => {
    if (h.type !== 'hour') return `<li class="hr sun-event"><span class="hr-t">${esc(h.label)}</span><span class="hr-i">${SUN_ICONS[h.type]}</span><span class="hr-v">${h.type === 'sunrise' ? 'Sunrise' : 'Sunset'}</span></li>`;
    const c = finite(h.chance) && h.chance >= 10 ? `<span class="hr-p">${h.chance}%</span>` : '';
    return `<li class="hr${h.label === 'Now' ? ' now' : ''}"><span class="hr-t">${esc(h.label)}</span><span class="hr-i">${weatherIcon(h.condition, h.isDay, 30)}${c}</span><span class="hr-v">${h.temp ?? '--'}°</span></li>`;
  }).join('');
}

function renderDaily(m) {
  $('daily-count').textContent = `${m.days.length}-day forecast`;
  $('daily').innerHTML = m.days.map((d, i) => {
    const bar = d.bar ? `<span class="rng"><i style="left:${d.bar.left.toFixed(1)}%;width:${Math.min(100 - d.bar.left, d.bar.width).toFixed(1)}%;background:${d.bar.gradient}"></i>${d.bar.now != null ? `<b style="left:${d.bar.now.toFixed(1)}%"></b>` : ''}</span>` : '<span class="rng"></span>';
    return `<li><button type="button" class="day" data-day="${i}" style="--i:${i}" aria-label="${esc(`${d.long}: ${d.condition}, high ${d.high ?? 'unknown'}, low ${d.low ?? 'unknown'}`)}">`
      + `<span class="d-name">${esc(d.label)}</span>`
      + `<span class="d-icon">${weatherIcon(d.condition, true, 30)}${finite(d.chance) && d.chance >= 10 ? `<span class="d-pop">${d.chance}%</span>` : ''}</span>`
      + `<span class="d-lo">${d.low ?? '--'}°</span>${bar}<span class="d-hi">${d.high ?? '--'}°</span></button></li>`;
  }).join('');
}

function renderTrend(m) {
  const metric = state.trend, def = METRICS[metric];
  const now = Date.now(), t0 = Math.floor(now / H) * H, t1 = t0 + 48 * H;
  for (const b of $('trend-seg').children) b.setAttribute('aria-selected', String(b.dataset.metric === metric));
  const pts = m.series[metric] || [];
  const nowPt = pts.find((p) => p.t <= now && p.t + H > now) || pts.find((p) => p.t >= t0);
  const idle = () => { $('trend-v').textContent = fmtValue(metric, nowPt, metric === 'wind' ? m.series.gust.find((p) => p.t === nowPt?.t) : null); $('trend-t').textContent = 'Now · drag across the graph'; };
  idle();
  mountChart($('trend-chart'), { points: pts, extra: metric === 'wind' ? m.series.gust : [], t0, t1, tz: m.tz, nowT: null, nights: nightBands(m.sol, t0, t1), multiDay: true }, def, (p, gust) => {
    if (!p) return idle();
    $('trend-v').textContent = fmtValue(metric, p, gust);
    $('trend-t').textContent = `${fmt(p.t, m.tz, { weekday: 'short' })} ${hourShort(p.t, m.tz)}`;
  });
}

function compass(dir, value) {
  const ticks = Array.from({ length: 72 }, (_, i) => { const a = (i * 5 - 90) * Math.PI / 180, r1 = i % 18 === 0 ? 36 : 40; return `<line x1="${(50 + r1 * Math.cos(a)).toFixed(1)}" y1="${(50 + r1 * Math.sin(a)).toFixed(1)}" x2="${(50 + 44 * Math.cos(a)).toFixed(1)}" y2="${(50 + 44 * Math.sin(a)).toFixed(1)}"${i % 18 === 0 ? ' class="major"' : ''}/>`; }).join('');
  const arrow = dir != null ? `<g class="needle" style="transform:rotate(${(dir + 180) % 360}deg)"><path d="M50 7 55.5 19h-11Z"/><line x1="50" y1="18" x2="50" y2="32"/><line x1="50" y1="68" x2="50" y2="89"/><circle cx="50" cy="90" r="3"/></g>` : '';
  return `<svg class="compass" viewBox="0 0 100 100" aria-hidden="true"><g class="ticks">${ticks}</g><text x="50" y="29">N</text><text x="72" y="53.5">E</text><text x="50" y="78">S</text><text x="28" y="53.5">W</text>${arrow}<circle class="hub" cx="50" cy="50" r="15"/><text class="hub-v" x="50" y="51">${esc(value)}</text><text class="hub-u" x="50" y="60">mph</text></svg>`;
}
function sunCurve(progress) {
  const W = 160, Hh = 56, base = 36, yAt = (f) => base - Math.sin((f * 2 - 0.5) * Math.PI) * 22;
  let d = '';
  for (let i = 0; i <= 40; i++) d += `${i ? 'L' : 'M'}${(i / 40 * W).toFixed(1)} ${yAt(i / 40).toFixed(1)}`;
  let dot = '';
  if (progress != null) { const f = 0.25 + progress * 0.5, x = f * W, y = yAt(f); dot = `<circle class="sc-glow" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9"/><circle class="sc-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5"/>`; }
  return `<svg class="suncurve" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-hidden="true"><defs><clipPath id="sc-up"><rect width="${W}" height="${base}"/></clipPath></defs><path class="sc-line dim" d="${d}"/><path class="sc-line" d="${d}" clip-path="url(#sc-up)"/><line class="sc-hz" x1="0" x2="${W}" y1="${base}" y2="${base}"/>${dot}</svg>`;
}
function pressureGauge(v) {
  const lo = 28.6, hi = 31.0, f = v == null ? null : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const ticks = Array.from({ length: 41 }, (_, i) => { const a = (135 + i * 6.75) * Math.PI / 180; return `<line x1="${(50 + 37 * Math.cos(a)).toFixed(1)}" y1="${(50 + 37 * Math.sin(a)).toFixed(1)}" x2="${(50 + 44 * Math.cos(a)).toFixed(1)}" y2="${(50 + 44 * Math.sin(a)).toFixed(1)}"/>`; }).join('');
  let needle = '';
  if (f != null) { const a = (135 + f * 270) * Math.PI / 180; needle = `<line class="pg-needle" x1="${(50 + 31 * Math.cos(a)).toFixed(1)}" y1="${(50 + 31 * Math.sin(a)).toFixed(1)}" x2="${(50 + 47 * Math.cos(a)).toFixed(1)}" y2="${(50 + 47 * Math.sin(a)).toFixed(1)}"/>`; }
  return `<svg class="gauge" viewBox="0 0 100 100" aria-hidden="true"><g class="pg-ticks">${ticks}</g>${needle}<text class="pg-v" x="50" y="54">${v != null ? v.toFixed(2) : '—'}</text><text class="pg-u" x="50" y="66">inHg</text><text class="pg-l" x="27" y="90">Low</text><text class="pg-l" x="73" y="90">High</text></svg>`;
}
const TILE_ICON = { aqi: 'M3 12h4l3-8 4 16 3-8h4', feels: 'M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0Z', uv: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', wind: 'M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7', sun: 'M3 18h18M7 18a5 5 0 0 1 10 0M12 4v4M9 7l3-3 3 3', precip: 'M12 3c-3 5-6 8-6 12a6 6 0 0 0 12 0c0-4-3-7-6-12Z', humidity: 'M12 3c-3 5-6 8-6 12a6 6 0 0 0 12 0c0-4-3-7-6-12ZM9 15h6', visibility: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z', pressure: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18ZM12 12l4-4' };
function renderTiles(m) {
  $('tiles').innerHTML = m.tiles.map((t, i) => {
    let body;
    if (t.id === 'wind') {
      body = `<div class="wind-body"><dl><div><dt>Wind</dt><dd>${esc(t.value)} mph</dd></div><div><dt>Gusts</dt><dd>${t.gust != null ? `${t.gust} mph` : '—'}</dd></div><div><dt>Direction</dt><dd>${t.dir != null ? `${Math.round(t.dir)}° ${esc(t.dirLabel)}` : '—'}</dd></div></dl>${compass(t.dir, t.value)}</div>`;
    } else if (t.id === 'pressure') {
      body = pressureGauge(t.pressure);
    } else {
      body = `<p class="t-val">${esc(t.value)}${t.unit ? `<small> ${esc(t.unit)}</small>` : ''}</p>${t.sub ? `<p class="t-sub">${esc(t.sub)}</p>` : ''}`;
      if (t.meter != null) body += `<span class="meter meter-${t.id}"><i style="left:${(t.meter * 100).toFixed(1)}%"></i></span>`;
      if (t.id === 'sun') body += sunCurve(t.progress);
      if (t.note) body += `<p class="t-note">${esc(t.note)}</p>`;
    }
    const tag = t.metric ? 'button' : 'article';
    return `<${tag} ${t.metric ? `type="button" data-metric="${t.metric}" aria-label="${esc(t.title)} details" ` : ''}class="card tile tile-${t.id}${t.wide || t.id === 'wind' ? ' wide' : ''}" style="--i:${i}"><h2 class="card-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TILE_ICON[t.id] || ''}"/></svg>${esc(t.title)}</h2>${body}</${tag}>`;
  }).join('');
}

function renderBlend(m) {
  const bar = (list) => list.map((s) => `<i style="flex:${s.weight};background:${s.color}"></i>`).join('');
  const legend = (list, fv) => list.map((s) => `<li><span class="sw" style="background:${s.color}"></span>${s.label}<b>${fv(s)}</b></li>`).join('');
  const pct = (s) => `${Math.round(s.weight * 100)}%`;
  $('blend-today').innerHTML = bar(m.blend.today);
  $('blend-today-legend').innerHTML = legend(m.blend.today, pct);
  $('blend-later').innerHTML = bar(m.blend.later);
  $('blend-later-legend').innerHTML = legend(m.blend.later, pct);
  $('model-highs').innerHTML = legend(m.blend.highs, (s) => (s.value != null ? `${s.value}°` : '—')) + `<li class="final"><span class="sw ring"></span>Halo forecast<b>${m.hero.high ?? '—'}°</b></li>`;
  $('blend-note').textContent = m.blend.note;
}

function renderAlerts(m) {
  const card = $('alert-card');
  card.hidden = !m.alerts.length;
  if (!m.alerts.length) return;
  $('alert-title').textContent = m.alerts.some((a) => a.severe) ? 'Severe weather' : 'Weather alert';
  $('alert-body').innerHTML = m.alerts.map((a) => `<p class="alert-row${a.severe ? ' severe' : ''}"><strong>${esc(a.event)}</strong>${a.headline ? ` ${esc(a.headline.startsWith(a.event) ? a.headline.slice(a.event.length).replace(/^[\s:,-]+/, '') : a.headline)}` : ''}</p>`).join('') + '<p class="fine">National Weather Service</p>';
}

function renderDiscussion(m) {
  const d = m.discussion;
  $('discussion').hidden = !d;
  if (!d) return;
  $('disc-sub').textContent = `Forecaster notes · NWS ${d.office}${Number.isFinite(d.issued) ? ` · ${fmt(d.issued, m.tz, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}`;
  $('disc-quote').textContent = d.excerpt;
  $('disc-full').textContent = d.full;
}

function renderDots() {
  $('dots').innerHTML = state.places.map((p, i) => `<button type="button" role="tab" aria-selected="${i === state.index}" aria-label="${esc(p.name)}"${i === 0 ? ' class="home"' : ''}></button>`).join('');
}

function render(m, place) {
  state.model = m;
  document.body.dataset.phase = m.phase;
  document.body.dataset.weather = m.kind;
  const p = m.sunProgress;
  document.documentElement.style.setProperty('--sun-x', `${p != null ? 10 + p * 80 : 50}%`);
  document.documentElement.style.setProperty('--sun-y', `${p != null ? 30 - Math.sin(Math.PI * p) * 22 : 12}%`);
  renderHero(m, place);
  renderAlerts(m);
  renderHourly(m);
  renderDaily(m);
  renderTrend(m);
  renderTiles(m);
  renderBlend(m);
  renderDiscussion(m);
  renderDots();
  $('updated').textContent = `Updated ${clock(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)}`;
  $('cards').setAttribute('aria-busy', 'false');
  document.body.classList.add('ready');
  sky.set(m.kind, m.phase);
  radar.update(place, m);
  if ($('sheet').open) renderSheet();
}

/* ---------- Conditions sheet ---------- */
function openSheet(metric = state.metric, day = 0) {
  if (!state.model) return;
  state.metric = metric; state.sheetDay = day;
  $('sheet-metric').value = metric;
  if (!$('sheet').open) $('sheet').showModal();
  renderSheet();
}
function renderSheet() {
  const m = state.model, metric = state.metric, def = METRICS[metric];
  const day = m.days[state.sheetDay] || m.days[0];
  if (!day) return;
  $('day-strip').innerHTML = m.days.map((d, i) => `<button type="button" role="tab" data-day="${i}" aria-selected="${i === state.sheetDay}" aria-label="${esc(d.dateLabel)}"><span class="ds-l">${esc(d.letter)}</span><span class="ds-n">${esc(d.dayNum)}</span></button>`).join('');
  $('sheet-date').textContent = day.dateLabel;
  const pts = dayPoints(m.series[metric], day.key, m.tz);
  const extra = metric === 'wind' ? dayPoints(m.series.gust, day.key, m.tz) : [];
  const first = pts[0]?.t ?? (dayPoints(m.series.temperature, day.key, m.tz)[0]?.t) ?? Date.parse(`${day.key}T12:00:00Z`);
  const isToday = state.sheetDay === 0;
  const t0 = isToday ? first : first - localHour(first, m.tz) * H;
  const t1 = isToday ? Math.max(first + 6 * H, (pts.at(-1)?.t ?? first) + H) : t0 + 24 * H;
  const ok = pts.filter((p) => finite(p.v));
  const idle = () => {
    let v = '--', t = '';
    if (ok.length) {
      const max = Math.max(...ok.map((p) => p.v)), min = Math.min(...ok.map((p) => p.v));
      if (metric === 'temperature') { v = `${day.high ?? Math.round(max)}°`; t = `L:${day.low ?? Math.round(min)}° · ${day.condition}`; }
      else if (metric === 'feels' || metric === 'dewpoint') { v = `${Math.round(max)}°`; t = `L:${Math.round(min)}°`; }
      else if (metric === 'precip') { v = `${Math.round(max)}%`; t = 'Peak chance'; }
      else if (metric === 'wind') { v = `${Math.round(min)}–${Math.round(max)}`; t = 'mph'; }
      else if (metric === 'humidity') { v = `${Math.round(ok.reduce((s, p) => s + p.v, 0) / ok.length)}%`; t = 'Average'; }
      else if (metric === 'uv') { v = String(Math.round(max)); t = uvCategory(max); }
    }
    $('sheet-v').textContent = v; $('sheet-t').textContent = t;
  };
  idle();
  mountChart($('sheet-chart'), { points: m.series[metric], extra: metric === 'wind' ? m.series.gust : [], t0, t1, tz: m.tz, nowT: isToday ? Date.now() : null, nights: nightBands(m.sol, t0, t1) }, def, (p, gust) => {
    if (!p) return idle();
    $('sheet-v').textContent = fmtValue(metric, p, gust);
    $('sheet-t').textContent = clock(p.t, m.tz);
  });
  $('sheet-summary').textContent = dailySummary(metric, pts, extra, day.long, m.tz);
  const prev = m.days[state.sheetDay - 1], next = m.days[state.sheetDay + 1], other = prev || next;
  const wrap = $('sheet-compare-wrap');
  if (metric === 'temperature' && day.high != null && other?.high != null) {
    const diff = day.high - other.high;
    const scale = [day, other].flatMap((d) => [d.low, d.high]).filter(finite);
    const lo = Math.min(...scale), sp = Math.max(1, Math.max(...scale) - lo);
    const row = (d) => { const l = d.low ?? d.high; return `<div class="cmp"><span>${esc(d.long)}</span><span class="rng"><i style="left:${((l - lo) / sp * 100).toFixed(1)}%;width:${Math.max(6, ((d.high - l) / sp) * 100).toFixed(1)}%;background:${d.bar?.gradient || '#fff'}"></i></span><b>${d.high}°</b></div>`; };
    const ref = prev ? (prev.long === 'Today' ? 'today' : prev.long) : next.long;
    $('sheet-compare').innerHTML = `<p>${diff === 0 ? `The high is the same as ${esc(ref)}.` : `The high is ${Math.abs(diff)}° ${diff > 0 ? 'warmer' : 'cooler'} than ${esc(ref)}.`}</p>${prev ? row(prev) + row(day) : row(day) + row(next)}`;
    wrap.hidden = false;
  } else wrap.hidden = true;
  $('sheet-note').textContent = metric === 'precip' ? 'Rain chance is the Weather Nourie blended score (NWS plus HRRR, ECMWF and NBM where available), not a calibrated probability. Amounts are liquid-equivalent forecasts.'
    : metric === 'feels' ? 'Feels-like is calculated from forecast temperature, humidity, wind and estimated sun exposure.'
      : metric === 'uv' ? 'UV forecast from Open-Meteo.' : 'Hourly values from the Weather Nourie forecast blend.';
}

/* ---------- Sky particles ---------- */
const sky = (() => {
  let ctx, w, h, parts = [], mode = '', raf = 0, dpr = 1;
  const seed = () => {
    const n = { rain: 160, storm: 240, snow: 130, stars: 180 }[mode] || 0;
    parts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, s: Math.random(), p: Math.random() * 6.28 }));
  };
  const resize = () => {
    const c = $('sky-canvas'); if (!c) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = c.width = innerWidth * dpr; h = c.height = innerHeight * dpr;
    ctx = c.getContext('2d'); seed();
  };
  const frame = (t) => {
    ctx.clearRect(0, 0, w, h);
    if (mode === 'rain' || mode === 'storm') {
      ctx.strokeStyle = 'rgba(200,225,255,.32)'; ctx.lineWidth = 1.1 * dpr; ctx.beginPath();
      for (const p of parts) {
        const len = (12 + p.s * 18) * dpr;
        p.y += (12 + p.s * 10) * dpr; p.x -= 2 * dpr;
        if (p.y > h) { p.y = -len; p.x = Math.random() * w * 1.15; }
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 2 * dpr, p.y + len);
      }
      ctx.stroke();
      if (mode === 'storm' && Math.random() < 0.003) { document.body.classList.add('flash'); setTimeout(() => document.body.classList.remove('flash'), 120); }
    } else if (mode === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (const p of parts) {
        p.y += (0.5 + p.s) * dpr; p.x += Math.sin(t / 1500 + p.p) * 0.6 * dpr;
        if (p.y > h) { p.y = -4; p.x = Math.random() * w; }
        ctx.beginPath(); ctx.arc(p.x, p.y, (1 + p.s * 2.2) * dpr, 0, 6.28); ctx.fill();
      }
    } else if (mode === 'stars') {
      for (const p of parts) {
        if (p.y > h * 0.75) continue;
        ctx.fillStyle = `rgba(255,255,255,${(0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t / 1000 + p.p * 7)) * p.s).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, (0.6 + p.s * 1.2) * dpr, 0, 6.28); ctx.fill();
      }
    }
    raf = requestAnimationFrame(frame);
  };
  return {
    set(kind, phase) {
      const next = kind === 'storm' ? 'storm' : kind === 'rain' ? 'rain' : kind === 'snow' ? 'snow' : (phase === 'night' && !['cloudy', 'fog'].includes(kind)) ? 'stars' : '';
      if (!ctx) { resize(); addEventListener('resize', resize); }
      if (!ctx || (next === mode && (raf || !mode))) return;
      mode = next; cancelAnimationFrame(raf); raf = 0; seed(); ctx.clearRect(0, 0, w, h);
      if (!mode) return;
      if (reduced()) { frame(0); cancelAnimationFrame(raf); raf = 1; return; }
      raf = requestAnimationFrame(frame);
    },
  };
})();

/* ---------- Radar map ---------- */
const radar = (() => {
  let map, marker, layers = [], frames = [], idx = 0, timer = 0, playing = true, meta = null, key = '', pending = null;
  const msg = (t) => { $('map-msg').textContent = t; $('map-msg').hidden = !t; };
  const show = (i) => {
    idx = i;
    if (!layers[i]) layers[i] = window.L.tileLayer.wms(meta.url, { layers: meta.layer, format: 'image/png', transparent: true, version: '1.1.1', time: frames[i], opacity: 0, attribution: 'Radar © NOAA/NWS' }).addTo(map);
    layers.forEach((l, k) => l?.setOpacity(k === i ? 0.85 : 0));
    $('map-time').textContent = clock(Date.parse(frames[i]), state.model?.tz || 'America/New_York');
    $('map-progress').style.width = `${((i + 1) / frames.length) * 100}%`;
  };
  const loop = () => { clearInterval(timer); if (!playing || frames.length < 2 || reduced()) return; timer = setInterval(() => show((idx + 1) % frames.length), 700); };
  const init = () => {
    if (map) return true;
    if (!window.L) return false;
    map = window.L.map('map', { zoomControl: false, scrollWheelZoom: false, tap: false }).setView([35.78, -78.48], 7);
    window.L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'USGS The National Map', className: 'map-base' }).addTo(map);
    return true;
  };
  async function load(place, m, data) {
    if (!init()) { pending = [place, m, data]; return; }
    const lat = data?.location?.latitude, lon = data?.location?.longitude;
    if (finite(lat) && finite(lon)) {
      map.setView([lat, lon], 7);
      marker?.remove();
      marker = window.L.marker([lat, lon], { icon: window.L.divIcon({ className: 'temp-pin', html: `<span>${m.hero.temp ?? '--'}°</span>`, iconSize: [40, 40], iconAnchor: [20, 20] }), interactive: false }).addTo(map);
    }
    const k = placeKey(place);
    if (k === key && meta && Date.now() - meta.at < 5 * 60000) return;
    key = k;
    try {
      const res = await fetch(`/api/weather-fusion/radar?${new URLSearchParams(placeQuery(place))}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      const r = await res.json();
      clearInterval(timer);
      layers.forEach((l) => l?.remove()); layers = [];
      meta = { ...r, at: Date.now() }; frames = (r.frames || []).slice(-10);
      if (!frames.length || !r.url) { msg('Radar is unavailable right now.'); $('map-time').textContent = '—'; return; }
      msg(r.status === 'stale' ? 'Radar is delayed — check the timestamp.' : '');
      show(frames.length - 1); loop();
    } catch { msg('Radar is unavailable right now.'); }
  }
  if (typeof window !== 'undefined') window.addEventListener('halo-leaflet-ready', () => { if (pending) { const args = pending; pending = null; load(...args); } });
  return {
    update: (place, m) => load(place, m, state.cache.get(placeKey(place))?.data),
    toggle() { playing = !playing; $('map-play').textContent = playing ? '❚❚' : '▶'; $('map-play').setAttribute('aria-label', playing ? 'Pause radar loop' : 'Play radar loop'); loop(); },
    resize() { setTimeout(() => map?.invalidateSize(), 280); },
  };
})();

/* ---------- Loading & navigation ---------- */
let loadSeq = 0;
async function select(index, { force = false } = {}) {
  state.index = Math.max(0, Math.min(state.places.length - 1, index));
  const place = state.places[state.index];
  const url = new URL(window.location.href);
  url.search = place.id ? (state.index ? `?location=${place.id}` : '') : `?lat=${place.latitude}&lon=${place.longitude}&name=${encodeURIComponent(place.name)}`;
  history.replaceState(null, '', url);
  renderDots();
  const seq = ++loadSeq;
  $('error').hidden = true;
  $('cards').setAttribute('aria-busy', 'true');
  try {
    const data = await fetchForecast(place, force);
    if (seq !== loadSeq) return;
    render(buildModel(data), place);
  } catch (e) {
    if (seq !== loadSeq || e.message === 'auth') return;
    $('error').hidden = false;
    $('error').textContent = 'Weather data is temporarily unavailable. Please try again shortly.';
    $('cards').setAttribute('aria-busy', 'false');
  }
}

async function renderPlaceCards() {
  const list = $('place-cards');
  list.innerHTML = state.places.map((p, i) => `<li><button type="button" class="place-card${i === state.index ? ' current' : ''}" data-index="${i}"><span class="pc-l"><b>${esc(i === 0 ? 'Home' : shortName(p.name))}</b><small>${esc(i === 0 ? p.name : '')}</small><em class="pc-c">&nbsp;</em></span><span class="pc-r"><span class="pc-t">--°</span><small class="pc-hl"></small></span></button>${p.id ? '' : `<button type="button" class="pc-del" data-remove="${i}" aria-label="Remove ${esc(p.name)}">✕</button>`}</li>`).join('');
  await Promise.all(state.places.map(async (p, i) => {
    try {
      const m = buildModel(await fetchForecast(p));
      const card = list.querySelector(`[data-index="${i}"]`); if (!card) return;
      card.dataset.phase = m.phase; card.dataset.weather = m.kind;
      card.querySelector('.pc-t').textContent = `${m.hero.temp ?? '--'}°`;
      card.querySelector('.pc-c').textContent = m.hero.condition;
      card.querySelector('.pc-hl').textContent = m.hero.high != null ? `H:${m.hero.high}° L:${m.hero.low ?? '--'}°` : '';
      if (i !== 0) card.querySelector('small').textContent = m.localTime;
    } catch { /* leave placeholders */ }
  }));
}

function initPlaces() {
  const dlg = $('places');
  $('tool-list').addEventListener('click', () => { dlg.showModal(); renderPlaceCards(); });
  $('place-cards').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const i = Number(rm.dataset.remove);
      state.places.splice(i, 1); savePlaces();
      if (state.index === i) select(0); else if (state.index > i) state.index -= 1;
      renderPlaceCards(); renderDots();
      return;
    }
    const c = e.target.closest('[data-index]');
    if (c) { dlg.close(); select(Number(c.dataset.index)); }
  });
  let timer = 0, seq = 0;
  $('place-input').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim(), out = $('place-results');
    if (q.length < 2) { out.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await fetch(`/api/weather-fusion/search?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' });
        const { results = [] } = res.ok ? await res.json() : {};
        if (mine !== seq) return;
        out.innerHTML = results.length ? '' : '<li class="empty">No U.S. results</li>';
        for (const r of results.slice(0, 6)) {
          const li = document.createElement('li'), b = document.createElement('button');
          b.type = 'button'; b.textContent = r.name;
          b.addEventListener('click', () => {
            const preset = PRESETS.find((p) => p.id === r.id);
            let i = state.places.findIndex((p) => (preset && p.id === r.id) || (p.latitude === r.latitude && p.longitude === r.longitude));
            if (i < 0) { state.places.push(preset ? { ...preset } : { name: r.name, latitude: r.latitude, longitude: r.longitude }); savePlaces(); i = state.places.length - 1; }
            $('place-input').value = ''; out.innerHTML = '';
            dlg.close(); select(i);
          });
          li.appendChild(b); out.appendChild(li);
        }
      } catch { out.innerHTML = '<li class="empty">Search unavailable</li>'; }
    }, 250);
  });
}

function initGestures() {
  let sx = 0, sy = 0, active = false;
  const hero = $('hero');
  hero.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; active = true; });
  hero.addEventListener('pointerup', (e) => {
    if (!active) return; active = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const next = state.index + (dx < 0 ? 1 : -1);
      if (next >= 0 && next < state.places.length) select(next);
    }
  });
  addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || e.target.closest?.('input,select,textarea')) return;
    if (e.key === 'ArrowRight' && state.index < state.places.length - 1) select(state.index + 1);
    if (e.key === 'ArrowLeft' && state.index > 0) select(state.index - 1);
  });
}

function initCompactHeader() {
  const compact = $('compact'), hero = $('hero');
  const onScroll = () => {
    const f = Math.min(1, Math.max(0, (scrollY - hero.offsetHeight * 0.45) / (hero.offsetHeight * 0.35)));
    compact.style.opacity = String(f);
    compact.classList.toggle('on', f > 0.6);
    hero.style.opacity = String(1 - f);
    hero.style.transform = `translateY(${Math.min(60, scrollY * 0.25).toFixed(1)}px) scale(${(1 - f * 0.05).toFixed(3)})`;
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function init() {
  loadPlaces();
  const q = new URLSearchParams(window.location.search);
  let start = 0;
  const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
  if (q.get('lat') && finite(lat) && finite(lon)) {
    start = state.places.findIndex((p) => p.latitude === lat && p.longitude === lon);
    if (start < 0) { state.places.push({ name: q.get('name') || 'Selected place', latitude: lat, longitude: lon }); savePlaces(); start = state.places.length - 1; }
  } else if (q.get('location')) start = Math.max(0, state.places.findIndex((p) => p.id === q.get('location')));

  for (const b of $('trend-seg').children) b.addEventListener('click', () => { state.trend = b.dataset.metric; if (state.model) renderTrend(state.model); });
  $('trend-more').addEventListener('click', () => openSheet(state.trend, 0));
  $('hourly').addEventListener('click', () => openSheet('temperature', 0));
  $('daily').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (b) openSheet('temperature', Number(b.dataset.day)); });
  $('tiles').addEventListener('click', (e) => { const b = e.target.closest('[data-metric]'); if (b) openSheet(b.dataset.metric, 0); });
  $('day-strip').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (b) { state.sheetDay = Number(b.dataset.day); renderSheet(); } });
  $('sheet-metric').addEventListener('change', (e) => { state.metric = e.target.value; renderSheet(); });
  for (const dlg of document.querySelectorAll('dialog')) dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  $('tool-map').addEventListener('click', () => $('map-card').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }));
  $('dots').addEventListener('click', (e) => { const i = [...$('dots').children].indexOf(e.target.closest('button')); if (i >= 0) select(i); });
  $('map-play').addEventListener('click', () => radar.toggle());
  $('map-expand').addEventListener('click', () => { $('map-card').classList.toggle('full'); document.body.classList.toggle('map-open'); radar.resize(); });
  if (chartRO) { chartRO.observe($('trend-chart')); chartRO.observe($('sheet-chart')); }
  initPlaces();
  initGestures();
  initCompactHeader();
  select(start);
  setInterval(() => { if (document.visibilityState === 'visible') select(state.index, { force: true }); }, 10 * 60000);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
