// Storm and Snow Beta: Rain Central and Snow Central.
// Every number shown comes from the canonical Weather Nourie forecast, the NWS,
// WPC or NOAA radar. Missing data stays missing; deterministic amounts and
// counts of agreeing forecast sources are never relabeled as probabilities.
import { winterAreaDataUrl, safeWinterMapUrl, winterSnowMapForDay } from '../../snow-outlook.js?v=snow-readable-v1';
import { renderWeatherIconSvg } from './icons.js?v=v3-sky-8';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const QPF_SERVICE = 'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer';
const QPF_LEVELS = [0.01, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 7, 10, 15, 20];
const RAIN_SOURCE = 'https://www.wpc.ncep.noaa.gov/qpf/day1-3.shtml';
const SNOW_SOURCE = 'https://www.wpc.ncep.noaa.gov/pwpf/wwd_accum_probs.php';
const RADAR_PAGE = 'https://radar.weather.gov/';
const SOURCE_NAMES = { nws: 'NWS', hrrr: 'HRRR', ecmwf: 'ECMWF', nbm: 'NBM', wn: 'WeatherNext', weathernext3: 'WeatherNext 3', gefs: 'GEFS', gfs: 'GFS', nam: 'NAM', wpc: 'WPC' };
const MATERIAL = { rain: 0.25, snow: 0.5, chance: 10 };
export const HORIZONS = [
  { id: 'today', label: 'Today' },
  { id: '1-3', label: '1–3 Days' },
  { id: '3-5', label: '3–5 Days' },
];

const finite = value => typeof value === 'number' && Number.isFinite(value);
const num = value => { const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value; return finite(n) ? n : null; };
const sum = list => list.reduce((total, value) => total + value, 0);
const ms = value => { const parsed = Date.parse(value ?? ''); return Number.isFinite(parsed) ? parsed : null; };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const floorHour = time => Math.floor(time / HOUR) * HOUR;
const slotCount = (a, b) => (b > a ? Math.round((Math.ceil(b / HOUR) * HOUR - floorHour(a)) / HOUR) : 0);
const overlap = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));

// ---------------------------------------------------------------- time
const formatters = new Map();
function fmt(time, zone, options) {
  const key = `${zone}|${JSON.stringify(options)}`;
  try {
    if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options }));
    return formatters.get(key).format(new Date(time));
  } catch { return new Date(time).toISOString(); }
}
export function localKey(time, zone) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time)); }
  catch { return new Date(time).toISOString().slice(0, 10); }
}
const addDays = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export function localWall(key, hour, zone) {
  const target = Date.parse(`${key}T${String(hour).padStart(2, '0')}:00:00Z`);
  let guess = target;
  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const part = type => Number(parts.find(row => row.type === type)?.value);
    const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    const next = guess + target - wall;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}
const hourText = (time, zone) => fmt(time, zone, { hour: 'numeric' });
const dayShort = (time, zone) => fmt(time, zone, { weekday: 'short' });
function when(time, zone, now) {
  return localKey(time, zone) === localKey(now, zone) ? hourText(time, zone) : `${dayShort(time, zone)} ${hourText(time, zone)}`;
}
const clock = (time, zone) => fmt(time, zone, { hour: 'numeric', minute: '2-digit' });
const dayHour = (time, zone) => `${dayShort(time, zone)} ${hourText(time, zone)}`;

// ---------------------------------------------------------------- formatting
export function inches(value, kind = 'rain') {
  if (!finite(value)) return '—';
  if (kind === 'snow') {
    if (value === 0) return '0″';
    if (value < 0.1) return '<0.1″';
    return `${value < 10 ? value.toFixed(1) : Math.round(value)}″`;
  }
  if (value === 0) return '0.00″';
  if (value < 0.01) return '<0.01″';
  return `${value.toFixed(2)}″`;
}
const short = value => (Number.isInteger(value) ? String(value) : value.toFixed(1));
export function rangeText(lo, hi, kind = 'rain') {
  if (!finite(lo) || !finite(hi)) return '—';
  if (kind === 'snow') {
    if (hi === 0) return '0″';
    if (lo === 0) return `Up to ${short(hi)}″`;
    return lo === hi ? `${short(lo)}″` : `${short(lo)}–${short(hi)}″`;
  }
  if (hi < 0.01) return '<0.01″';
  return `${lo.toFixed(2)}–${hi.toFixed(2)}″`;
}
const pct = value => (finite(value) ? `${Math.round(value)}%` : '—');
const sourceName = id => SOURCE_NAMES[id] || String(id || '').toUpperCase();

// ---------------------------------------------------------------- NWS wording
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, eighteen: 18, twenty: 20 };
const wordNumber = word => (word in NUMBER_WORDS ? NUMBER_WORDS[word] : finite(Number(word)) ? Number(word) : null);
/** Reads the official NWS snow range from a forecast period's text. */
export function parseSnowRange(text) {
  const sentences = String(text || '').toLowerCase().replace(/\s+/g, ' ').split(/(?<=\.)\s/);
  const sentence = sentences.find(row => /accumulation/.test(row) && /snow/.test(row));
  if (!sentence) return null;
  if (/little or no/.test(sentence)) return [0, 0];
  const value = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|eighteen|twenty)';
  let match = sentence.match(new RegExp(`${value} to ${value} inch`));
  if (match) return [wordNumber(match[1]), wordNumber(match[2])];
  if (/less than (?:a |one )?half (?:an )?inch/.test(sentence)) return [0, 0.5];
  if (/less than (?:one|an?|1) inch/.test(sentence)) return [0, 1];
  match = sentence.match(new RegExp(`less than ${value} inches`));
  if (match) return [0, wordNumber(match[1])];
  if (/(?:around|near|about) (?:a )?half (?:an )?inch/.test(sentence)) return [0.5, 0.5];
  if (/(?:around|near|about) (?:an?|one|1) inch/.test(sentence)) return [1, 1];
  match = sentence.match(new RegExp(`(?:around|near|about) ${value} inches`));
  if (match) return [wordNumber(match[1]), wordNumber(match[1])];
  match = sentence.match(new RegExp(`up to ${value} inch`));
  if (match) return [0, wordNumber(match[1])];
  return null;
}
export function precipType(condition = '') {
  const text = String(condition).toLowerCase();
  const snow = /snow|flurr|blizzard/.test(text), rain = /rain|shower|drizzle|thunder|storm/.test(text), ice = /freezing|sleet|ice pellets|\bice\b|wintry/.test(text);
  if (ice || (snow && rain)) return 'mix';
  if (snow) return 'snow';
  if (/thunder|t-storm/.test(text)) return 'storm';
  if (rain) return 'rain';
  return 'none';
}
function cleanCondition(text) {
  const raw = String(text || '').trim();
  if (!/(?:slight\s+)?chance|scattered|likely/i.test(raw)) return raw;
  const cleaned = raw.replace(/^slight\s+chance\s+(?:of\s+)?/i, '').replace(/^chance\s+(?:of\s+)?/i, '').replace(/^scattered\s+/i, '').replace(/\s+likely\b/i, '').trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : raw;
}

// ---------------------------------------------------------------- model
function sourceList(list) {
  return (Array.isArray(list) ? list : []).map(row => ({ id: row?.id, value: num(row?.value) })).filter(row => row.id && finite(row.value) && row.value >= 0);
}
function confidenceOf(value) {
  if (!value || typeof value !== 'object') return { score: null, label: typeof value === 'string' ? value : null, factors: [] };
  return { score: num(value.score), label: value.label || value.level || null, factors: Array.isArray(value.factors) ? value.factors.filter(row => typeof row === 'string') : [] };
}
export function buildStormModel(forecast, now = Date.now()) {
  const canonical = forecast?.canonical || {};
  const zone = forecast?.timeZone || forecast?.location?.timeZone || canonical.location?.timeZone || 'America/New_York';
  const viewDays = Array.isArray(forecast?.days) ? forecast.days : [];
  const sourceDays = Array.isArray(canonical.days) && canonical.days.length ? canonical.days : viewDays;
  const snowDays = Array.isArray(canonical.snow?.days) ? canonical.snow.days : [];
  const today = localKey(now, zone);
  const days = [];
  for (const raw of sourceDays) {
    const key = raw?.date || raw?.dayKey;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key)) || key < today || days.length >= 7) continue;
    const view = viewDays.find(row => row.dayKey === key) || {};
    const midnight = localWall(key, 0, zone), end = localWall(addDays(key, 1), 0, zone), noon = midnight + 12 * HOUR;
    days.push({
      key, index: days.length, midnight, end, start: days.length === 0 ? Math.max(midnight, now) : midnight,
      name: days.length === 0 ? 'Today' : fmt(noon, zone, { weekday: 'long' }),
      short: days.length === 0 ? 'Today' : fmt(noon, zone, { weekday: 'short' }),
      date: fmt(noon, zone, { month: 'short', day: 'numeric' }),
      qpf: num(raw.qpf ?? raw.totalQpfIn ?? view.totalQpfIn),
      pop: num(raw.rainLikelihood?.value ?? raw.pop ?? raw.rainChance ?? view.rainChance),
      sources: sourceList(raw.qpfBlend?.sources),
      confidence: confidenceOf(raw.confidence ?? view.confidence),
      condition: raw.condition || view.condition || '',
      high: num(raw.high ?? view.highF), low: num(raw.low ?? view.lowF),
      gust: num(view.maxGustMph),
      freezingRain: raw.freezingRainPossible === true, sleet: raw.sleetPossible === true,
      snow: snowDays.find(row => row.date === key) || null,
    });
  }
  const rawHours = Array.isArray(canonical.hours) && canonical.hours.length ? canonical.hours : (forecast?.hoursAll || forecast?.hours48 || []);
  const hours = rawHours.map(row => {
    const t = ms(row?.time);
    if (t === null) return null;
    const condition = String(row.condition || '');
    return {
      t, condition, type: precipType(condition),
      temp: num(row.temperature ?? row.tempF),
      precip: num(row.precipitation ?? row.precipIn),
      pop: num(row.rainLikelihood?.value ?? row.pop ?? row.rainChance),
      gust: num(row.gust ?? row.windGustMph),
      sources: sourceList(row.precipitationBlend?.sources),
    };
  }).filter(Boolean).sort((a, b) => a.t - b.t);
  const intervals = [], periods = [], events = [], seenIntervals = new Set(), seenPeriods = new Set();
  for (const day of snowDays) {
    for (const row of day.nwsRawIntervals || []) {
      const a = ms(row.start), b = ms(row.end), value = num(row.value);
      if (a === null || b === null || b <= a || value === null || value < 0 || seenIntervals.has(a)) continue;
      seenIntervals.add(a); intervals.push({ a, b, value });
    }
    for (const row of day.periods || []) {
      const a = ms(row.start), b = ms(row.end);
      if (a === null || b === null || b <= a || seenPeriods.has(a)) continue;
      seenPeriods.add(a);
      const text = `${row.wording || ''} ${row.detail || ''}`;
      periods.push({ a, b, name: row.name || '', wording: row.wording || '', detail: row.detail || '', pop: num(row.pop), snow: row.snowWording === true || /snow|flurr|blizzard/i.test(text), ice: row.freezingRainWording === true || row.sleetWording === true || /freezing|sleet/i.test(text), range: parseSnowRange(row.detail) });
    }
    for (const row of day.snowEventWindows || []) {
      const a = ms(row.start), b = ms(row.end);
      if (a !== null && b !== null && b > a) events.push({ a, b });
    }
  }
  intervals.sort((x, y) => x.a - y.a); periods.sort((x, y) => x.a - y.a); events.sort((x, y) => x.a - y.a);
  const merged = [];
  for (const row of events) { const last = merged.at(-1); if (last && row.a <= last.b) last.b = Math.max(last.b, row.b); else merged.push({ ...row }); }
  const current = forecast?.current || {};
  return {
    now, zone, days, hours, intervals, periods, snowEvents: merged,
    location: { name: forecast?.location?.name || canonical.location?.name || 'Selected location', lat: num(Number(forecast?.location?.latitude ?? canonical.location?.latitude)), lon: num(Number(forecast?.location?.longitude ?? canonical.location?.longitude)) },
    updated: ms(canonical.assembledAt) ?? ms(forecast?.fetchedAt),
    current: {
      temp: num(current.tempF ?? canonical.current?.temperature), feels: num(current.feelsLikeF ?? canonical.current?.feelsLike),
      condition: cleanCondition(current.condition || canonical.current?.condition || ''), icon: current.icon || null, isDay: current.isDay !== false,
      wind: num(current.windMph ?? canonical.current?.wind), windDir: current.windCardinal || '', humidity: num(current.humidity ?? canonical.current?.humidity),
    },
    alerts: Array.isArray(canonical.alerts) && canonical.alerts.length ? canonical.alerts : (Array.isArray(forecast?.alerts) ? forecast.alerts : []),
    outlooks: Array.isArray(canonical.riskOutlooks) ? canonical.riskOutlooks : (Array.isArray(forecast?.riskOutlooks) ? forecast.riskOutlooks : []),
    maps: Array.isArray(canonical.snow?.maps) ? canonical.snow.maps : [],
    snowState: canonical.snow || null,
  };
}

/** Today = now through 6 AM tomorrow (NWS "today and tonight").
 * 1–3 Days = 6 AM tomorrow through the end of day 3. 3–5 Days = days 4 and 5. */
export function horizonWindow(model, id) {
  const days = model.days;
  if (!days.length) return null;
  const sixAm = index => (days[index] ? localWall(days[index].key, 6, model.zone) : null);
  if (id === 'today') return { id, start: model.now, end: sixAm(1) ?? days[0].end, label: 'Today & tonight' };
  if (id === '1-3') {
    if (!days[1]) return null;
    return { id, start: sixAm(1), end: days[3]?.end ?? days.at(-1).end, label: 'Next 3 days' };
  }
  if (!days[4]) return null;
  return { id, start: days[4].midnight, end: days[5]?.end ?? days[4].end, label: 'Days 4–5' };
}
export function windowText(model, win) {
  if (!win) return '';
  if (win.id === 'today') return `Now – ${when(win.end, model.zone, model.now)}`;
  const first = dayShort(win.start + HOUR, model.zone), last = dayShort(win.end - HOUR, model.zone);
  return first === last ? fmt(win.start + HOUR, model.zone, { weekday: 'long' }) : `${first} – ${last}`;
}
const hoursIn = (model, a, b) => model.hours.filter(row => row.t + HOUR > a && row.t < b);
const daysIn = (model, win) => model.days.filter(day => day.end > win.start && day.start < win.end);
function hourlySources(rows) {
  if (!rows.length || rows.some(row => !row.sources.length)) return null;
  let ids = new Set(rows[0].sources.map(row => row.id));
  for (const row of rows) { const own = new Set(row.sources.map(item => item.id)); ids = new Set([...ids].filter(id => own.has(id))); }
  if (!ids.size) return null;
  const totals = new Map([...ids].map(id => [id, 0]));
  for (const row of rows) for (const item of row.sources) if (totals.has(item.id)) totals.set(item.id, totals.get(item.id) + item.value);
  return totals;
}
function rainPortion(model, day, a, b) {
  const inside = hoursIn(model, a, b), slots = slotCount(a, b), known = inside.filter(row => finite(row.precip));
  if (slots && known.length >= slots) return { day, amount: sum(known.map(row => row.precip)), sources: hourlySources(known), mode: 'hourly' };
  if (!finite(day.qpf)) return { day, amount: null, sources: null, mode: 'missing' };
  const outsideSlots = slotCount(day.start, day.end) - slots;
  if (outsideSlots <= 0) return { day, amount: day.qpf, sources: day.sources.length ? new Map(day.sources.map(row => [row.id, row.value])) : null, mode: 'daily' };
  const outside = hoursIn(model, day.start, day.end).filter(row => !(row.t + HOUR > a && row.t < b) && finite(row.precip));
  if (outside.length >= outsideSlots) {
    const hourly = hourlySources(outside), rest = new Map();
    if (hourly) for (const row of day.sources) if (hourly.has(row.id)) rest.set(row.id, Math.max(0, row.value - hourly.get(row.id)));
    return { day, amount: Math.max(0, day.qpf - sum(outside.map(row => row.precip))), sources: rest.size ? rest : null, mode: 'daily' };
  }
  return { day, amount: day.qpf * (b - a) / (day.end - day.start), sources: null, mode: 'prorated' };
}
function confidenceFor(model, win) {
  const days = daysIn(model, win).filter(day => finite(day.confidence.score));
  if (!days.length) return { score: null, label: null, factors: [], days: [] };
  const weights = days.map(day => overlap(day.start, day.end, win.start, win.end));
  const score = Math.round(sum(days.map((day, index) => day.confidence.score * weights[index])) / sum(weights));
  const label = days.length === 1 && days[0].confidence.label ? days[0].confidence.label : score >= 85 ? 'High' : score >= 70 ? 'Moderate' : score >= 55 ? 'Low' : 'Very low';
  return { score, label, factors: days[0].confidence.factors, days: days.map(day => ({ name: day.name, date: day.date, score: day.confidence.score, label: day.confidence.label })) };
}
const wetHour = row => (finite(row.precip) && row.precip >= 0.01) || (finite(row.pop) && row.pop >= 60);

export function rainSummary(model, win) {
  if (!win) return null;
  const portions = daysIn(model, win).map(day => rainPortion(model, day, Math.max(win.start, day.start), Math.min(win.end, day.end)));
  const known = portions.filter(row => finite(row.amount));
  const amount = known.length ? sum(known.map(row => row.amount)) : null;
  let sources = null;
  if (portions.length && portions.every(row => row.sources)) {
    let ids = [...portions[0].sources.keys()];
    for (const row of portions) ids = ids.filter(id => row.sources.has(id));
    if (ids.length) sources = ids.map(id => ({ id, value: sum(portions.map(row => row.sources.get(id))) })).sort((a, b) => b.value - a.value);
  }
  const range = sources && sources.length >= 2 ? [Math.min(...sources.map(row => row.value)), Math.max(...sources.map(row => row.value))] : null;
  const windowHours = hoursIn(model, win.start, win.end);
  const chances = windowHours.map(row => row.pop).filter(finite).concat(portions.filter(row => row.mode !== 'hourly').map(row => row.day.pop).filter(finite));
  const chance = chances.length ? Math.max(...chances) : null;
  const wet = windowHours.filter(row => finite(row.precip) && row.precip > 0);
  const liquid = sum(wet.map(row => row.precip));
  const frozen = sum(wet.filter(row => row.type === 'snow' || row.type === 'mix').map(row => row.precip));
  const frozenShare = liquid >= 0.05 ? frozen / liquid : 0;
  return { kind: 'rain', win, amount, partial: known.length < portions.length, prorated: portions.some(row => row.mode === 'prorated'), sources, range, chance, frozen, frozenShare, thunder: windowHours.some(row => row.type === 'storm'), timing: rainTiming(model, win, portions), confidence: confidenceFor(model, win), maxGust: maxGust(model, win), portions };
}
function maxGust(model, win) {
  const values = hoursIn(model, win.start, win.end).map(row => row.gust).filter(finite).concat(daysIn(model, win).map(day => day.gust).filter(finite));
  return values.length ? Math.max(...values) : null;
}
function rainTiming(model, win, portions) {
  const all = model.hours;
  const inside = hoursIn(model, win.start, win.end);
  const wetInside = inside.filter(wetHour);
  const coveredEnd = inside.length ? inside.at(-1).t + HOUR : win.start;
  const later = portions.filter(row => row.mode !== 'hourly' && ((finite(row.amount) && row.amount >= 0.05) || (!finite(row.amount) && finite(row.day.pop) && row.day.pop >= 50))).map(row => row.day);
  const timing = { status: 'none', later, series: inside.map(row => ({ t: row.t, value: finite(row.precip) ? row.precip : 0, type: row.type })) };
  if (wetInside.length) {
    let first = all.indexOf(wetInside[0]), last = all.indexOf(wetInside.at(-1));
    while (first > 0 && wetHour(all[first - 1]) && all[first - 1].t + HOUR > win.start) first -= 1;
    while (last < all.length - 1 && wetHour(all[last + 1])) last += 1;
    timing.status = 'hourly';
    timing.onset = all[first].t;
    timing.underway = all[first].t <= model.now;
    timing.continuing = !timing.underway && first > 0 && wetHour(all[first - 1]);
    timing.end = all[last].t + HOUR;
    timing.openEnd = last === all.length - 1;
    let best = null;
    for (let i = 0; i < inside.length; i += 1) {
      const block = inside.slice(i, i + 3), total = sum(block.map(row => row.precip || 0));
      if (!best || total > best.amount) best = { a: block[0].t, b: block.at(-1).t + HOUR, amount: total };
    }
    if (best && best.amount >= 0.03) timing.heaviest = best;
  } else if (later.length) {
    timing.status = 'daily';
    timing.wettest = later.reduce((best, day) => ((portions.find(row => row.day === day)?.amount || 0) > (portions.find(row => row.day === best)?.amount || 0) ? day : best), later[0]);
  }
  timing.coveredEnd = coveredEnd;
  if (timing.status === 'hourly' && timing.end > win.end) timing.series = hoursIn(model, win.start, timing.end).map(row => ({ t: row.t, value: finite(row.precip) ? row.precip : 0, type: row.type }));
  return timing;
}
export function rainTimingText(model, summary) {
  const t = summary.timing;
  const tail = t.later.length && t.status === 'hourly' ? `, then ${t.later.map(day => day.short).join(', ')}` : '';
  const end = t.status === 'hourly' ? (t.openEnd ? `past ${when(t.end, model.zone, model.now)}` : when(t.end, model.zone, model.now)) : '';
  if (t.status === 'hourly') return t.continuing ? `Continues until ${end}${tail}` : `${t.underway ? 'Now' : when(t.onset, model.zone, model.now)} – ${end}${tail}`;
  if (t.status === 'daily') return t.later.length === 1 ? t.later[0].name : `${t.later[0].short} – ${t.later.at(-1).short}`;
  return 'No rain expected';
}

export function snowSummary(model, win) {
  if (!win) return null;
  const days = daysIn(model, win);
  const covered = model.intervals.filter(row => overlap(row.a, row.b, win.start, win.end) > 0);
  const coveredMs = sum(covered.map(row => overlap(row.a, row.b, win.start, win.end)));
  let amount = covered.length ? sum(covered.map(row => row.value * overlap(row.a, row.b, win.start, win.end) / (row.b - row.a))) : null;
  if (coveredMs < (win.end - win.start) * 0.9) {
    // Beyond the NWS 6-hour grid, use each fully uncovered day's displayed snowfall.
    for (const day of days) {
      const dayCovered = covered.some(row => overlap(row.a, row.b, day.start, day.end) > 0);
      const value = num(day.snow?.displaySnowfall?.value);
      if (!dayCovered && value !== null) amount = (amount || 0) + value * overlap(day.start, day.end, win.start, win.end) / (day.end - day.start);
    }
  }
  if (finite(amount)) amount = Math.round(amount * 10) / 10;
  const snowPeriods = model.periods.filter(row => row.snow && overlap(row.a, row.b, win.start, win.end) >= (row.b - row.a) / 2);
  const ranged = snowPeriods.filter(row => row.range);
  const range = snowPeriods.length && ranged.length === snowPeriods.length ? [sum(ranged.map(row => row.range[0])), sum(ranged.map(row => row.range[1]))] : null;
  const periodChances = model.periods.filter(row => row.snow && overlap(row.a, row.b, win.start, win.end) > 0).map(row => row.pop).filter(finite);
  const dayChances = days.map(day => num(day.snow?.snowChance)).filter(finite);
  const chance = periodChances.length ? Math.max(...periodChances) : dayChances.length ? Math.max(...dayChances) : null;
  const chanceSource = periodChances.length ? 'nws' : dayChances.length ? 'blend' : null;
  const freezingRain = days.some(day => day.freezingRain || num(day.snow?.freezingRainChance) > 0) || model.periods.some(row => row.ice && /freezing/i.test(row.detail + row.wording) && overlap(row.a, row.b, win.start, win.end) > 0);
  const sleet = days.some(day => day.sleet || num(day.snow?.sleetChance) > 0) || model.periods.some(row => /sleet/i.test(row.detail + row.wording) && overlap(row.a, row.b, win.start, win.end) > 0);
  const snowHours = hoursIn(model, win.start, win.end).filter(row => row.type === 'snow' || row.type === 'mix');
  const marginal = snowHours.length > 0 && snowHours.some(row => finite(row.temp) && row.temp >= 31 && row.temp <= 35);
  const wpc = new Map();
  for (const day of days) for (const row of day.snow?.wpc || []) {
    if (overlap(ms(row.start) ?? 0, ms(row.end) ?? 0, win.start, win.end) <= 0) continue;
    const key = `${row.kind}:${row.inches}`, current = wpc.get(key);
    const value = Array.isArray(row.probabilityRange) ? row.probabilityRange : row.belowPublishedCategories ? [0, 9] : null;
    if (!value) continue;
    if (!current || value[1] > current.range[1]) wpc.set(key, { kind: row.kind, inches: row.inches, range: value, day: row.day, start: ms(row.start), end: ms(row.end) });
  }
  const models = [], modelDays = days.filter(day => day.snow?.models || day.snow?.nearTermModels);
  for (const day of days) for (const [id, value] of Object.entries({ ...(day.snow?.models || {}), ...(day.snow?.nearTermModels || {}) })) {
    const amountValue = num(value?.value ?? value);
    if (amountValue !== null) { const row = models.find(item => item.id === id); if (row) row.value += amountValue; else models.push({ id, value: amountValue }); }
  }
  const events = model.snowEvents.filter(row => overlap(row.a, row.b, win.start, win.end) > 0);
  const timing = { status: 'none', series: covered.map(row => ({ t: row.a, b: row.b, value: row.value })) };
  if (events.length) {
    timing.status = 'event';
    timing.onset = Math.max(events[0].a, win.start); timing.underway = events[0].a <= model.now; timing.continuing = !timing.underway && events[0].a < win.start; timing.end = events.at(-1).b;
  } else {
    const snowy = covered.filter(row => row.value > 0);
    if (snowy.length) { timing.status = 'event'; timing.onset = snowy[0].a; timing.underway = snowy[0].a <= model.now; timing.end = snowy.at(-1).b; }
  }
  const heavy = covered.filter(row => row.value > 0).sort((x, y) => y.value - x.value)[0];
  if (heavy) timing.heaviest = { a: heavy.a, b: heavy.b, amount: heavy.value };
  const mixedWording = chanceSource === 'nws' && model.periods.some(row => row.snow && overlap(row.a, row.b, win.start, win.end) > 0 && /rain|shower|drizzle/i.test(row.wording));
  const modelSpan = modelDays.length ? (modelDays.length === 1 ? modelDays[0].name : `${modelDays[0].short} – ${modelDays.at(-1).short}`) : '';
  return { kind: 'snow', win, amount, range, chance, chanceSource, mixedWording, freezingRain, sleet, marginal, wpc: [...wpc.values()].sort((a, b) => (a.kind === b.kind ? a.inches - b.inches : a.kind === 'snow' ? -1 : 1)), models, modelSpan, periods: snowPeriods, timing, confidence: confidenceFor(model, win), liquid: rainSummary(model, win)?.amount ?? null };
}
export function snowTimingText(model, summary) {
  const t = summary.timing;
  if (t.status === 'event') return t.continuing ? `Continues until ${when(t.end, model.zone, model.now)}` : `${t.underway ? 'Now' : when(t.onset, model.zone, model.now)} – ${when(t.end, model.zone, model.now)}`;
  return 'No snow expected';
}
function headline(summary) {
  if (summary.kind === 'snow') {
    if (summary.range && summary.range[1] > 0 && summary.range[1] !== summary.range[0]) return rangeText(summary.range[0], summary.range[1], 'snow');
    return inches(summary.amount, 'snow');
  }
  if (summary.range && summary.range[1] - summary.range[0] >= 0.05) return rangeText(summary.range[0], summary.range[1]);
  return inches(summary.amount);
}
function hasEvent(summary) {
  if (!summary) return false;
  return summary.kind === 'snow' ? (summary.amount > 0 || (summary.range && summary.range[1] > 0) || summary.chance >= 30) : (summary.amount >= 0.01 || summary.chance >= 30);
}
export function featuredHorizon(model, mode) {
  for (const { id } of HORIZONS) {
    const win = horizonWindow(model, id);
    if (win && hasEvent(mode === 'snow' ? snowSummary(model, win) : rainSummary(model, win))) return id;
  }
  return 'today';
}

/** Compares recorded snapshots over the same remaining window. */
export function historyTrend(snapshotsByDate, model, mode, win) {
  const dates = Object.keys(snapshotsByDate);
  if (!dates.length) return { status: 'none', points: [] };
  const byIssue = new Map();
  for (const date of dates) for (const row of snapshotsByDate[date] || []) {
    if (!byIssue.has(row.issuedAt)) byIssue.set(row.issuedAt, {});
    byIssue.get(row.issuedAt)[date] = row.day?.[mode];
  }
  const issues = [...byIssue.keys()].filter(key => dates.every(date => byIssue.get(key)[date])).sort((a, b) => ms(a) - ms(b));
  if (!issues.length) return { status: 'none', points: [] };
  const from = Math.max(win.start, ms(issues.at(-1)));
  const amountFor = rows => {
    let total = 0;
    for (const date of dates) {
      const row = rows[date], day = model.days.find(item => item.key === date);
      if (!row || !day) return null;
      const a = Math.max(from, day.midnight), b = Math.min(win.end, day.end);
      if (b <= a) continue;
      if (mode === 'snow') {
        const parts = (row.intervals || []).map(item => ({ a: ms(item.start), b: ms(item.end), value: num(item.value) })).filter(item => item.a !== null && item.b !== null && item.value !== null);
        const coveredMs = sum(parts.map(item => overlap(item.a, item.b, a, b)));
        if (coveredMs >= (b - a) * 0.9) { total += sum(parts.map(item => item.value * overlap(item.a, item.b, a, b) / (item.b - item.a))); continue; }
      } else {
        const parts = (row.hours || []).map(item => ({ t: ms(item.time), amount: num(item.amount) })).filter(item => item.t !== null && item.amount !== null && item.t + HOUR > a && item.t < b);
        if (parts.length >= slotCount(a, b)) { total += sum(parts.map(item => item.amount)); continue; }
      }
      if (a <= day.midnight && b >= day.end && finite(row.amount)) total += row.amount;
      else return null;
    }
    return total;
  };
  const points = issues.map(key => ({ t: ms(key), amount: amountFor(byIssue.get(key)), chance: (() => { const values = dates.map(date => num(byIssue.get(key)[date]?.chance)).filter(finite); return values.length ? Math.max(...values) : null; })() })).filter(row => finite(row.amount));
  if (points.length < 2) return { status: 'started', points, since: ms(issues[0]), from };
  const first = points[0], last = points.at(-1), previous = points.at(-2);
  const delta = last.amount - first.amount, threshold = MATERIAL[mode];
  const direction = Math.abs(delta) >= threshold ? (delta > 0 ? 'up' : 'down') : 'steady';
  const chanceDelta = finite(first.chance) && finite(last.chance) ? last.chance - first.chance : null;
  return { status: 'ready', points, first, last, previous, delta, direction, chanceDelta, from, since: first.t };
}

// ---------------------------------------------------------------- map layers
function qpfLayers(model, horizon) {
  const day1 = model.maps.find(row => row.id === 'wpc-qpf-day1');
  const base = safeWinterMapUrl(day1?.url) || QPF_SERVICE;
  const start = ms(day1?.start);
  if (start === null) return [];
  const legend = Array.isArray(day1?.legend) ? day1.legend : [];
  const layer = (id, number, label, a, b) => ({ id, kind: 'arcgis', url: base, layers: [number], unit: 'in', quantity: 'rain', label, start: a, end: b, legend, sourceUrl: RAIN_SOURCE });
  const day = n => [start + (n - 1) * DAY, start + n * DAY];
  if (horizon === 'today') return [layer('qpf-d1', 1, 'WPC 24-hour total', ...day(1))];
  if (horizon === '1-3') return [layer('qpf-d13', 9, 'WPC 3-day total', start, start + 3 * DAY), layer('qpf-d2', 2, 'WPC day 2', ...day(2)), layer('qpf-d3', 3, 'WPC day 3', ...day(3))];
  return [layer('qpf-d45', 4, 'WPC days 4–5', start + 3 * DAY, start + 5 * DAY), layer('qpf-d15', 10, 'WPC 5-day total', start, start + 5 * DAY)];
}
function snowLayers(model, horizon, win) {
  if (!win) return [];
  const all = model.maps.filter(row => row.kind === 'geojson' && row.quantity === 'snowfall' && row.unit !== '%').map(row => ({ ...row, start: ms(row.start), end: ms(row.end) })).filter(row => row.start !== null && row.end !== null);
  const wpc = all.filter(row => String(row.id).startsWith('wpc-expected-snow'));
  const grids = all.filter(row => String(row.id).startsWith('model-snow-grid'));
  const out = [];
  const fits = row => overlap(row.start, row.end, win.start, win.end) > 0;
  const best = wpc.filter(fits).sort((a, b) => overlap(b.start, b.end, win.start, win.end) - overlap(a.start, a.end, win.start, win.end) || a.start - b.start)[0];
  if (best) out.push({ ...best, label: 'WPC 24-hour snowfall' });
  if (horizon === 'today' && !best) {
    const aligned = winterSnowMapForDay(model.snowState, model.days[0]?.snow);
    if (aligned) out.push({ ...aligned, start: ms(aligned.start), end: ms(aligned.end), label: 'Snowfall today' });
  }
  for (const row of grids.filter(fits)) if (!out.some(item => item.id === row.id)) out.push({ ...row, label: `Model snowfall · ${dayShort(row.start + 12 * HOUR, model.zone)}` });
  const probability = model.maps.filter(row => row.kind === 'arcgis' && row.unit === '%' && /^wpc-snow-day\d-4$/.test(row.id)).map(row => ({ ...row, start: ms(row.start), end: ms(row.end), quantity: 'snow-probability', label: `Chance of 4″+ · ${dayShort(ms(row.start) + 12 * HOUR, model.zone)}` })).filter(row => row.start !== null && fits(row));
  return [...out, ...probability];
}
export function mapLayers(model, mode, horizon) {
  return mode === 'snow' ? snowLayers(model, horizon, horizonWindow(model, horizon)) : qpfLayers(model, horizon);
}
/** Kept for compatibility: the per-day accumulation products for a local day. */
export function accumulationMapDescriptors(forecast, day, mode) {
  const snow = (forecast?.canonical?.snow?.days || forecast?.snow?.days || []).find(row => row.date === (day?.dayKey || day?.date)) || null;
  const maps = forecast?.canonical?.snow?.maps || forecast?.snow?.maps || [];
  const zone = forecast?.timeZone || forecast?.location?.timeZone || 'America/New_York';
  const dayHours = (Array.isArray(day?.hours) && day.hours.length ? day.hours : (forecast?.hours || [])).filter(row => !day?.dayKey || localKey(row.time, zone) === day.dayKey);
  const start = ms(dayHours[0]?.time) ?? ms(snow?.amountWindow?.start);
  const end = dayHours.length ? ms(dayHours.at(-1).time) + HOUR : ms(snow?.amountWindow?.end);
  const fits = row => { const a = ms(row.start), b = ms(row.end); return a !== null && b !== null && (start === null || end === null || (a < end && b > start)); };
  if (mode === 'snow') {
    const aligned = winterSnowMapForDay(forecast?.canonical?.snow || forecast?.snow, snow);
    const snowfall = maps.filter(row => row.quantity === 'snowfall' && ['geojson', 'official-image', 'image'].includes(row.kind) && fits(row));
    return [...(aligned ? [aligned] : []), ...snowfall.filter(row => row.id !== aligned?.id)];
  }
  return maps.filter(row => row.id?.startsWith('wpc-qpf-') && row.kind === 'arcgis' && row.unit === 'in' && fits(row));
}
export function qpfBand(value) {
  const lower = num(Number(value));
  if (lower === null) return null;
  const index = QPF_LEVELS.findIndex(level => Math.abs(level - lower) < 1e-6);
  const upper = index >= 0 ? QPF_LEVELS[index + 1] : null;
  return upper ? `${lower.toFixed(2)}–${upper.toFixed(2)}″` : `${lower.toFixed(2)}″+`;
}
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function contourValueAt(geo, lat, lon) {
  let best = null;
  for (const feature of geo?.features || []) {
    const value = num(Number(feature?.properties?.value)), rings = feature?.geometry?.type === 'Polygon' ? [feature.geometry.coordinates] : feature?.geometry?.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
    if (value === null) continue;
    for (const polygon of rings) {
      if (polygon?.[0] && pointInRing(lon, lat, polygon[0]) && !polygon.slice(1).some(hole => pointInRing(lon, lat, hole))) { if (best === null || value > best) best = value; break; }
    }
  }
  return best;
}

// ---------------------------------------------------------------- icons & charts
const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', chev: '<path d="M9 5l7 7-7 7"/>',
  pin: '<path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  up: '<path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/>', down: '<path d="M4 7l6 6 4-4 6 7"/><path d="M15 16h5v-5"/>', flat: '<path d="M4 12h15"/><path d="M15 8l4 4-4 4"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>', drop: '<path d="M12 3.5s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z"/>',
  flake: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.3 4.2L12 6.4l2.7-2.2M9.3 19.8L12 17.6l2.7 2.2M4.4 11l2.6 1-1.2 2.6M19.6 11L17 12l1.2 2.6"/>',
  rain: '<path d="M7 14.5a4.3 4.3 0 1 1 1.4-8.4A5.4 5.4 0 0 1 18.6 8a3.3 3.3 0 0 1-.6 6.5z"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>',
  chart: '<path d="M4 18l5-6 4 3 7-9"/><path d="M4 21h16"/>', clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/>', gauge: '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l4-5"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.4"/>', pct: '<path d="M6 18L18 6"/><circle cx="7.5" cy="7.5" r="2.3"/><circle cx="16.5" cy="16.5" r="2.3"/>',
  play: '<path d="M8 5l11 7-11 7z"/>', pause: '<path d="M8 5v14M16 5v14"/>', target: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
};
const icon = (name, cls = '') => `<svg class="sb-i ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
function barChart(rows, { kind, zone, now, unitLabel }) {
  if (!rows.length) return '';
  const width = 340, height = 150, left = 30, bottom = 22, top = 10;
  const max = Math.max(kind === 'snow' ? 1 : 0.1, ...rows.map(row => row.value));
  const step = (width - left - 6) / rows.length, bar = Math.max(2, step * 0.72);
  const y = value => top + (height - top - bottom) * (1 - value / max);
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(rows.length / 6));
  return `<svg class="sb-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(unitLabel)}">${ticks.map(value => `<line x1="${left}" x2="${width}" y1="${y(value)}" y2="${y(value)}" class="sb-grid"/><text x="${left - 4}" y="${y(value) + 3}" text-anchor="end" class="sb-axis">${kind === 'snow' ? short(Math.round(value * 10) / 10) : value.toFixed(2)}</text>`).join('')}${rows.map((row, index) => { const x = left + index * step + (step - bar) / 2, h = Math.max(row.value > 0 ? 1.5 : 0, y(0) - y(row.value)); return `<rect x="${x.toFixed(1)}" y="${(y(0) - h).toFixed(1)}" width="${bar.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, bar / 3).toFixed(1)}" class="sb-bar sb-bar-${row.type || kind}"><title>${esc(when(row.t, zone, now))}: ${esc(inches(row.value, kind))}</title></rect>`; }).join('')}${rows.map((row, index) => (index % every === 0 ? `<text x="${(left + index * step + step / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="sb-axis">${esc(kind === 'snow' ? `${dayShort(row.t, zone)} ${hourText(row.t, zone)}` : hourText(row.t, zone))}</text>` : '')).join('')}</svg>`;
}
function lineChart(points, { kind, zone, now }) {
  const width = 340, height = 150, left = 34, bottom = 22, top = 12;
  const values = points.map(row => row.amount), lo = Math.min(...values), hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.2, kind === 'snow' ? 0.5 : 0.1), min = Math.max(0, lo - pad), max = hi + pad;
  const t0 = points[0].t, t1 = points.at(-1).t, x = t => left + (width - left - 10) * (t1 === t0 ? 1 : (t - t0) / (t1 - t0)), y = v => top + (height - top - bottom) * (1 - (v - min) / (max - min));
  const path = points.map((row, index) => `${index ? 'L' : 'M'}${x(row.t).toFixed(1)},${y(row.amount).toFixed(1)}`).join(' ');
  return `<svg class="sb-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Recorded forecast amounts over time">${[min, (min + max) / 2, max].map(v => `<line x1="${left}" x2="${width}" y1="${y(v)}" y2="${y(v)}" class="sb-grid"/><text x="${left - 4}" y="${y(v) + 3}" text-anchor="end" class="sb-axis">${kind === 'snow' ? v.toFixed(1) : v.toFixed(2)}</text>`).join('')}<path d="${path}" class="sb-line"/>${points.map(row => `<circle cx="${x(row.t).toFixed(1)}" cy="${y(row.amount).toFixed(1)}" r="3.2" class="sb-dot"><title>${esc(when(row.t, zone, now))}: ${esc(inches(row.amount, kind))}</title></circle>`).join('')}<text x="${left}" y="${height - 6}" class="sb-axis">${esc(when(t0, zone, now))}</text><text x="${width - 4}" y="${height - 6}" text-anchor="end" class="sb-axis">${esc(when(t1, zone, now))}</text></svg>`;
}
function gauge(score, label) {
  const value = finite(score) ? Math.max(0, Math.min(100, score)) : 0, angle = Math.PI * (1 - value / 100);
  const cx = 90, cy = 86, r = 66, end = [cx + r * Math.cos(angle), cy - r * Math.sin(angle)];
  return `<svg class="sb-gauge" viewBox="0 0 180 104" role="img" aria-label="Forecast confidence ${esc(label || 'unavailable')}"><path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}" class="sb-gauge-track"/>${finite(score) ? `<path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${end[0].toFixed(1)},${end[1].toFixed(1)}" class="sb-gauge-fill"/>` : ''}<text x="${cx}" y="${cy - 12}" text-anchor="middle" class="sb-gauge-value">${finite(score) ? Math.round(score) : '—'}</text><text x="${cx}" y="${cy + 10}" text-anchor="middle" class="sb-gauge-label">${esc(label || 'Unavailable')}</text></svg>`;
}

// ---------------------------------------------------------------- styles
const CSS = `
.nourie-modal.sb-dialog{box-sizing:border-box;width:min(980px,calc(100vw - 24px));max-width:none;height:min(940px,calc(100dvh - 24px));max-height:none;padding:0;border:1px solid rgba(176,216,255,.22);border-radius:24px;background:radial-gradient(120% 60% at 15% 0%,rgba(44,122,196,.32),transparent 58%),radial-gradient(90% 50% at 90% 10%,rgba(20,184,166,.18),transparent 55%),linear-gradient(180deg,#0a1728 0%,#0e2036 48%,#091524 100%);color:#f2f8ff;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;box-shadow:0 32px 96px rgba(2,10,24,.72)}
.nourie-modal.sb-dialog>div:first-child{display:none!important}.nourie-modal.sb-dialog #modal-body{padding:0;margin:0}
@media(max-width:700px){.nourie-modal.sb-dialog{width:100vw;height:100dvh;max-height:100dvh;border:0;border-radius:0;margin:0}}
.sb{--ink:#f2f8ff;--muted:#9cb8d4;--line:rgba(176,216,255,.16);--card:rgba(16,34,56,.74);--card-solid:#122741;--accent:#2dd4bf;--accent2:#38bdf8;--pale:rgba(45,212,191,.14);font-family:inherit;color:var(--ink);min-height:100%;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.sb[data-mode=snow]{--accent:#60a5fa;--accent2:#818cf8;--pale:rgba(96,165,250,.16)}
.sb *{box-sizing:border-box}.sb h2,.sb h3,.sb h4,.sb p{margin:0;color:inherit}.sb button{font:inherit;color:inherit;cursor:pointer}.sb a{color:var(--accent2)}
.sb .sb-i{width:20px;height:20px;flex:0 0 auto}
.sb-bar{position:sticky;top:0;z-index:1200;display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(10,23,40,.82);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-bottom:1px solid var(--line)}
.sb-btn{display:inline-grid;place-items:center;width:42px;height:42px;border-radius:14px;border:1px solid rgba(186,222,255,.2);background:rgba(255,255,255,.07);color:var(--ink);flex:0 0 auto;transition:background .15s ease,border-color .15s ease,transform .12s ease}
.sb-btn:hover{background:rgba(255,255,255,.14);border-color:rgba(186,222,255,.34)}.sb-btn:active{transform:scale(.96)}
.sb-btn:focus-visible,.sb button:focus-visible{outline:2px solid #7dd3fc;outline-offset:2px}
.sb-title{display:flex;align-items:center;gap:11px;min-width:0;flex:1}.sb-title-mark{display:grid;place-items:center;width:40px;height:40px;border-radius:13px;background:linear-gradient(135deg,rgba(45,212,191,.22),rgba(56,189,248,.16));border:1px solid rgba(125,211,252,.24);color:var(--accent);flex:0 0 auto;box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}.sb-title-mark .sb-i{width:22px;height:22px}
.sb[data-mode=snow] .sb-title-mark{background:linear-gradient(135deg,rgba(96,165,250,.24),rgba(129,140,248,.18));border-color:rgba(147,197,253,.28)}
.sb-title h2{font-size:19px;font-weight:800;letter-spacing:-.015em;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sb-title p{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sb-title p .sb-i{width:13px;height:13px;color:var(--accent2)}
.sb-main{padding:14px 14px 30px;display:grid;gap:13px;max-width:940px;margin:0 auto}
.sb-card{background:var(--card);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--line);border-radius:20px;box-shadow:0 12px 32px rgba(3,12,26,.34),inset 0 1px 0 rgba(255,255,255,.07);padding:15px}
.sb-card h3{font-size:15.5px;font-weight:800;letter-spacing:-.01em;display:flex;align-items:center;gap:8px;margin-bottom:10px}.sb-card h3 .sb-i{color:var(--accent)}
.sb-note{font-size:12px;color:var(--muted);line-height:1.45}
.sb-now{position:relative;border-radius:22px;overflow:hidden;border:1px solid rgba(186,222,255,.22);background:#10253e center/cover no-repeat;box-shadow:0 16px 40px rgba(3,12,26,.46),inset 0 1px 0 rgba(255,255,255,.12)}
.sb-now:before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,rgba(9,22,38,.84) 0%,rgba(13,32,54,.68) 54%,rgba(13,32,54,.44) 100%)}
.sb-now-in{position:relative;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:14px;padding:18px}
.sb-now-main{display:flex;align-items:center;gap:12px;min-width:0}.sb-now-icon svg{width:66px;height:66px;filter:drop-shadow(0 6px 14px rgba(0,0,0,.35))}.sb-now-temp{font-size:58px;font-weight:800;line-height:.95;letter-spacing:-.035em;text-shadow:0 4px 18px rgba(0,0,0,.28)}.sb-now-cond{font-size:17px;font-weight:750;margin-top:4px;color:#fff}.sb-now-feels{font-size:13px;color:#b8d3ec;margin-top:2px}
.sb-facts{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;align-content:center;margin:0;padding:10px 12px;border-radius:15px;background:rgba(8,20,36,.48);border:1px solid rgba(186,222,255,.14);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.sb-facts div{min-width:0}.sb-facts dt{font-size:11px;color:#98b7d4;font-weight:650;letter-spacing:.02em;text-transform:uppercase}.sb-facts dd{margin:2px 0 0;font-size:15.5px;font-weight:800;color:#fff;white-space:nowrap}
.sb-entries{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sb-entry{position:relative;display:flex;flex-direction:column;text-align:left;padding:0;border-radius:22px;border:1px solid rgba(186,222,255,.2);background:var(--card);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);overflow:hidden;box-shadow:0 14px 34px rgba(3,12,26,.4),inset 0 1px 0 rgba(255,255,255,.08);min-width:0;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}
.sb-entry:hover{transform:translateY(-2px);border-color:rgba(125,211,252,.38);box-shadow:0 18px 40px rgba(3,12,26,.52)}
.sb-entry:active{transform:translateY(0)}
.sb-entry-photo{position:relative;display:block;height:122px;background:center/115% no-repeat;filter:saturate(1.12) brightness(.96)}
.sb-entry-photo:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,20,36,.08) 0%,rgba(14,31,52,.42) 68%,rgba(16,34,56,.96) 100%)}
.sb-entry[data-select=snow] .sb-entry-photo{filter:saturate(.95) brightness(1.06) contrast(1.02)}
.sb-entry-chip{position:absolute;left:11px;top:86px;z-index:2;display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:999px;background:rgba(11,26,45,.86);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(186,222,255,.26);box-shadow:0 6px 16px rgba(2,10,24,.38);font-weight:800;font-size:13.5px;color:#fff;white-space:nowrap}
.sb-entry[data-select=rain] .sb-entry-chip .sb-i{color:#2dd4bf}.sb-entry[data-select=snow] .sb-entry-chip .sb-i{color:#60a5fa}
.sb-entry-body{display:grid;gap:5px;padding:16px 30px 15px 14px}.sb-entry-amount{font-size:28px;font-weight:850;letter-spacing:-.025em;line-height:1.05;color:#fff}
.sb-entry-chance{font-size:13px;font-weight:700;color:#b2cce5}.sb-entry-when,.sb-entry-trend{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:650;color:#dcebfb;min-width:0}.sb-entry-when span,.sb-entry-trend span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sb-entry-when .sb-i,.sb-entry-trend .sb-i{width:15px;height:15px;color:#8cb0d1}
.sb-entry-go{position:absolute;right:10px;bottom:13px;color:#8cb0d1;transition:transform .15s ease,color .15s ease}.sb-entry:hover .sb-entry-go{color:#fff;transform:translateX(2px)}.sb-entry-go .sb-i{width:18px;height:18px}
.sb-trend-up{color:#4ade80!important}.sb-trend-down{color:#fb923c!important}
.sb-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:4px;border-radius:16px;background:rgba(10,23,40,.65);border:1px solid var(--line)}
.sb-seg button{min-height:42px;border:0;border-radius:12px;background:transparent;font-weight:750;font-size:14px;color:var(--muted);transition:color .15s ease,background .15s ease}
.sb-seg button[aria-pressed=true]{background:linear-gradient(110deg,var(--accent),var(--accent2));color:#061523;box-shadow:0 6px 16px rgba(14,165,233,.3)}
.sb[data-mode=snow] .sb-seg button[aria-pressed=true]{color:#fff}
.sb-seg button:disabled{opacity:.38;cursor:not-allowed}
.sb-window{font-size:12px;font-weight:700;color:var(--muted);text-align:center;margin-top:-4px}
.sb-hero{position:relative;overflow:hidden;padding:18px}
.sb-hero:after{content:"";position:absolute;right:-30px;top:-20px;width:48%;height:150%;background:var(--hero-photo) center/cover no-repeat;opacity:.28;-webkit-mask-image:linear-gradient(90deg,transparent,#000 62%);mask-image:linear-gradient(90deg,transparent,#000 62%);pointer-events:none}
.sb-hero>*{position:relative;z-index:1}
.sb-hero-stats{display:grid;grid-template-columns:1.25fr 1fr;gap:12px}.sb-stat strong{display:block;font-size:36px;font-weight:850;letter-spacing:-.025em;line-height:1.05;color:#fff}.sb-stat span{display:block;font-size:13px;font-weight:700;color:var(--muted);margin-top:4px}.sb-stat small{display:block;font-size:12px;color:var(--accent);font-weight:750;margin-top:3px}
.sb-hero-rows{display:grid;gap:7px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}.sb-row-i{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:650;min-width:0;color:#e3f0fc}.sb-row-i .sb-i{width:17px;height:17px;color:var(--accent2)}.sb-row-i span{min-width:0}
.sb-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:var(--pale);border:1px solid rgba(125,211,252,.22);color:var(--accent);font-size:12.5px;font-weight:800;white-space:nowrap}
.sb-hero-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap}
.sb-callout{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:15px;background:var(--pale);border:1px solid rgba(125,211,252,.2);font-size:13px;font-weight:650;line-height:1.35;color:#e6f3ff}.sb-callout button{margin-left:auto;border:1px solid rgba(125,211,252,.28);background:rgba(10,24,42,.78);border-radius:11px;padding:8px 12px;font-weight:800;color:var(--accent);white-space:nowrap;min-height:40px}
.sb-mapcard{padding:0;overflow:hidden}.sb-mapcard-head{display:flex;align-items:center;gap:8px;padding:11px 14px;background:linear-gradient(95deg,rgba(14,116,144,.88),rgba(29,78,216,.84));border-bottom:1px solid rgba(255,255,255,.14);color:#fff}
.sb-mapcard-head strong{font-size:14px;font-weight:800;flex:1;min-width:0;line-height:1.25}.sb-mapcard-head em{font-style:normal;font-weight:600;opacity:.88;font-size:12px;display:block}
.sb-mapcard-head .sb-btn{width:38px;height:38px;border-radius:11px;background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.3);color:#fff}
.sb-mapwrap{position:relative}.sb-map{height:255px;background:#0e2036;z-index:0}.sb-map.sb-map-tall{height:min(62dvh,560px)}
.sb-legend{position:absolute;right:8px;top:8px;z-index:500;background:rgba(10,23,40,.9);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(186,222,255,.22);border-radius:11px;padding:7px 8px;box-shadow:0 6px 18px rgba(0,0,0,.35);display:grid;gap:3px;font-size:10.5px;font-weight:700;color:#e6f2ff;pointer-events:none}
.sb-legend span{display:flex;align-items:center;gap:5px;white-space:nowrap}.sb-legend i{display:inline-block;width:13px;height:10px;border-radius:2px;background-size:cover;border:1px solid rgba(255,255,255,.18)}
.sb-map-status{font-size:12px;color:var(--muted);padding:9px 14px;line-height:1.4}.sb-map-status strong{color:var(--ink)}
.sb-tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sb-tile{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;text-align:left;padding:13px;border-radius:17px;border:1px solid var(--line);background:var(--card);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 8px 22px rgba(3,12,26,.28),inset 0 1px 0 rgba(255,255,255,.06);min-height:78px;min-width:0;transition:transform .14s ease,border-color .14s ease,background .14s ease}
.sb-tile:hover{transform:translateY(-1px);border-color:rgba(125,211,252,.32);background:rgba(22,45,72,.82)}
.sb-tile-ic{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--pale);border:1px solid rgba(125,211,252,.18);color:var(--accent)}.sb-tile-ic .sb-i{width:19px;height:19px}.sb-tile-ic.sb-warn{background:rgba(248,113,113,.16);border-color:rgba(248,113,113,.28);color:#fca5a5}
.sb-tile strong{display:block;font-size:14px;font-weight:800;line-height:1.2;color:#fff}.sb-tile small{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;color:var(--muted);line-height:1.3;margin-top:2px}.sb-tile>span:nth-child(2){min-width:0}.sb-tile .sb-i.sb-go{width:16px;height:16px;color:#7fa1c2}
.sb-chips{display:flex;gap:6px;overflow-x:auto;padding:2px 0 4px;scrollbar-width:none}.sb-chips::-webkit-scrollbar{display:none}
.sb-chip{flex:0 0 auto;min-height:38px;padding:7px 13px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.06);font-size:12.5px;font-weight:750;color:var(--muted);transition:background .15s ease,color .15s ease,border-color .15s ease}.sb-chip[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#061523}
.sb[data-mode=snow] .sb-chip[aria-pressed=true]{color:#fff}
.sb-big{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.sb-big strong{font-size:40px;font-weight:850;letter-spacing:-.03em;color:var(--accent);line-height:1}.sb-big span{font-size:14px;font-weight:700;color:var(--muted)}
.sb-rows{display:grid}.sb-kv{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}.sb-kv:last-child{border-bottom:0}.sb-kv span{color:var(--muted);font-weight:600}.sb-kv strong{text-align:right;font-weight:800;color:#fff}
.sb-bars{display:grid;gap:9px}.sb-barrow{display:grid;grid-template-columns:72px 1fr 74px;align-items:center;gap:8px;font-size:13px;font-weight:700}.sb-barrow>span:last-child{text-align:right;color:#fff}.sb-track{height:11px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden}.sb-track i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.sb-chart{width:100%;height:auto;display:block;margin-top:6px}.sb-grid{stroke:rgba(186,222,255,.14);stroke-width:1}.sb-axis{font-size:9.5px;fill:#9cb8d4;font-weight:600}.sb-bar{fill:var(--accent)}.sb-bar-snow,.sb-bar-mix{fill:#60a5fa}.sb-bar-storm{fill:#a78bfa}.sb-line{fill:none;stroke:var(--accent);stroke-width:2.6;stroke-linejoin:round}.sb-dot{fill:#0c1c30;stroke:var(--accent);stroke-width:2}
.sb-key{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;font-weight:700;color:var(--muted);margin-top:6px}.sb-key span{display:flex;align-items:center;gap:5px}.sb-key i{width:11px;height:11px;border-radius:3px;background:var(--accent)}.sb-key-storm{background:#a78bfa!important}.sb-key-snow,.sb-key-mix{background:#60a5fa!important}
.sb-gauge{width:200px;max-width:100%;display:block;margin:0 auto}.sb-gauge-track{fill:none;stroke:rgba(255,255,255,.12);stroke-width:14;stroke-linecap:round}.sb-gauge-fill{fill:none;stroke:var(--accent);stroke-width:14;stroke-linecap:round}.sb-gauge-value{font-size:30px;font-weight:850;fill:#f2f8ff}.sb-gauge-label{font-size:12px;font-weight:700;fill:#9cb8d4}
.sb-alert{border-radius:16px;border:1px solid rgba(248,113,113,.34);border-left:4px solid #f87171;background:rgba(127,29,29,.28);padding:13px;display:grid;gap:4px}.sb-alert[data-sev=Moderate],.sb-alert[data-sev=Minor]{border-color:rgba(251,191,36,.34);border-left-color:#fbbf24;background:rgba(120,53,15,.26)}.sb-alert strong{font-size:15px;color:#fff}.sb-alert small{font-size:12px;color:#cbdceb;font-weight:650}.sb-alert p{font-size:13px;line-height:1.45;color:#e8f2fc}
.sb-alert details summary{cursor:pointer;font-size:12.5px;font-weight:800;color:var(--accent2);min-height:32px;display:flex;align-items:center}.sb-alert pre{white-space:pre-wrap;font:inherit;font-size:12.5px;line-height:1.45;margin:6px 0 0;max-height:260px;overflow:auto;color:#d6e7f7}
.sb-list{margin:0;padding-left:18px;display:grid;gap:6px;font-size:13.5px;line-height:1.45;color:#e2effb}
.sb-quote{border-left:3px solid var(--accent);padding:8px 12px;background:var(--pale);border-radius:0 12px 12px 0;font-size:13px;line-height:1.45;color:#e6f3ff}
.sb-live-ctl{display:flex;align-items:center;gap:8px;padding:10px 14px}.sb-live-ctl input{flex:1;accent-color:var(--accent)}.sb-live-ctl output{font-size:12px;font-weight:700;color:var(--muted);min-width:76px;text-align:right}
.sb-alerts{display:grid;gap:8px}.sb-alert-strip{display:flex;align-items:center;gap:10px;width:100%;text-align:left;min-height:48px;padding:10px 13px;border-radius:15px;border:1px solid rgba(248,113,113,.36);border-left:4px solid #f87171;background:linear-gradient(90deg,rgba(153,27,27,.34),rgba(30,41,59,.56));color:#fff5f5;font-size:13.5px;box-shadow:0 6px 18px rgba(3,12,26,.28);transition:background .15s ease,transform .12s ease}.sb-alert-strip:hover{background:linear-gradient(90deg,rgba(185,28,28,.44),rgba(30,41,59,.68))}.sb-alert-strip span{flex:1;min-width:0}.sb-alert-strip .sb-i{width:18px;height:18px;color:#fca5a5}
.sb-sub{font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px}
.sb-foot{font-size:11.5px;color:#84a3c2;text-align:center;line-height:1.45;padding-top:2px}
.sb .leaflet-container{font:inherit}.sb .leaflet-popup-content{font-size:13px;line-height:1.4;margin:10px 12px;color:#12304a}
@media(min-width:620px){.sb-main{padding:18px 20px 32px;gap:14px}.sb-tiles{grid-template-columns:repeat(3,1fr)}.sb-map{height:320px}.sb-entry-photo{height:152px}.sb-entry-chip{top:114px}.sb-now-temp{font-size:66px}.sb-now-icon svg{width:76px;height:76px}}
@media(max-width:400px){.sb-main{padding:10px 10px 24px;gap:10px}.sb-entries{gap:9px}.sb-entry-body{padding:14px 24px 12px 11px}.sb-entry-amount{font-size:23px}.sb-entry-chip{font-size:12.5px;padding:5px 9px}.sb-now-in{grid-template-columns:1fr;gap:10px}.sb-facts{grid-template-columns:repeat(4,auto);justify-content:space-between}.sb-stat strong{font-size:29px}.sb-tile{grid-template-columns:auto 1fr;padding:10px;gap:8px}.sb-tile .sb-i.sb-go{display:none}.sb-tile-ic{width:32px;height:32px}.sb-barrow{grid-template-columns:58px 1fr 70px}}
`;

// ---------------------------------------------------------------- photos
function skyPhoto(current) {
  const text = current.condition.toLowerCase();
  if (/thunder|storm/.test(text)) return 'today-sky-storm.webp';
  if (/snow|flurr|blizzard/.test(text)) return 'cond-snow.webp';
  if (/sleet|freezing|ice/.test(text)) return 'cond-freezing-rain.webp';
  if (/rain|shower|drizzle/.test(text)) return 'today-sky-rain.webp';
  if (/fog|mist|haze|smoke/.test(text)) return 'cond-fog.webp';
  if (!current.isDay) return /partly|mostly cloudy|cloud/.test(text) ? 'cond-partly-cloudy-night.webp' : 'today-sky-night-v2.webp';
  if (/mostly cloudy/.test(text)) return 'cond-mostly-cloudy.webp';
  if (/partly|mostly sunny|few clouds/.test(text)) return 'today-sky-clouds.webp';
  if (/cloud|overcast/.test(text)) return 'cond-cloudy.webp';
  return 'today-sky-clear.webp';
}
const centerPhoto = mode => (mode === 'snow' ? '/weather-fusion/cond-snow.webp' : '/weather-fusion/cond-rain.webp');

// ---------------------------------------------------------------- app
export function openStormAndSnowBeta(forecast, openModal) {
  if (!document.getElementById('sb-css')) { const style = document.createElement('style'); style.id = 'sb-css'; style.textContent = CSS; document.head.append(style); }
  document.getElementById('storm-beta-css')?.remove();
  const dialog = document.getElementById('nourie-dialog'), body = document.getElementById('modal-body');
  if (!dialog || !body) return;
  openModal('Storm and Snow Beta', '<div class="sb" data-mode="home"></div>');
  dialog.classList.add('sb-dialog');
  const root = body.querySelector('.sb');
  if (!root) return;
  const model = buildStormModel(forecast, Date.now());
  const zone = model.zone;
  const state = { mode: null, view: 'home', horizon: 'today', layer: {}, maps: [], history: new Map(), pending: new Set(), radar: null, radarTimer: null, renderId: 0 };
  const cache = new Map();
  const summary = (mode, horizon = state.horizon) => {
    const key = `${mode}|${horizon}`;
    if (!cache.has(key)) { const win = horizonWindow(model, horizon); cache.set(key, win ? (mode === 'snow' ? snowSummary(model, win) : rainSummary(model, win)) : null); }
    return cache.get(key);
  };
  const timingText = s => (s.kind === 'snow' ? snowTimingText(model, s) : rainTimingText(model, s));
  const disposeMaps = () => { for (const map of state.maps) { try { map.remove(); } catch {} } state.maps = []; clearInterval(state.radarTimer); state.radarTimer = null; };
  dialog.addEventListener('close', () => { disposeMaps(); dialog.classList.remove('sb-dialog'); }, { once: true });

  const updated = model.updated ? `Updated ${clock(model.updated, zone)}` : 'Update time unavailable';
  function bar() {
    const mode = state.mode, title = mode === 'snow' ? 'Snow Central' : mode === 'rain' ? 'Rain Central' : 'Storm & Snow';
    const mark = mode === 'snow' ? icon('flake') : mode === 'rain' ? icon('rain') : icon('drop');
    return `<header class="sb-bar">${mode ? `<button type="button" class="sb-btn" data-back aria-label="Back">${icon('back')}</button>` : ''}<div class="sb-title"><span class="sb-title-mark">${mark}</span><div style="min-width:0"><h2>${title}${mode ? '' : ' <span style="font-weight:600;color:var(--muted);font-size:13px">Beta</span>'}</h2><p>${icon('pin')}<span>${esc(model.location.name)} · ${esc(mode ? (model.updated ? clock(model.updated, zone) : '') : updated)}</span></p></div></div><button type="button" class="sb-btn" data-close aria-label="Close Storm and Snow Beta">${icon('close')}</button></header>`;
  }
  function trendLine(mode, horizon, compact = false) {
    const history = state.history.get(`${mode}|${horizon}`);
    if (!history) return compact ? '' : `<div class="sb-row-i" data-trend>${icon('chart')}<span>Checking recorded forecast changes…</span></div>`;
    const kind = mode === 'snow' ? 'snow' : 'rain';
    let text, cls = '', name = 'flat';
    if (history.status === 'ready') {
      if (history.direction === 'up') { text = `Increasing · up from ${inches(history.first.amount, kind)}`; cls = 'sb-trend-up'; name = 'up'; }
      else if (history.direction === 'down') { text = `Decreasing · down from ${inches(history.first.amount, kind)}`; cls = 'sb-trend-down'; name = 'down'; }
      else text = `Steady since ${when(history.first.t, zone, model.now)}`;
    } else if (compact) return '';
    else text = history.status === 'error' ? 'Forecast history unavailable' : `Tracking changes since ${when(history.since ?? model.now, zone, model.now)}`;
    return compact ? `<span class="sb-entry-trend ${cls}">${icon(name)}<span>${esc(text)}</span></span>` : `<div class="sb-row-i ${cls}" data-trend>${icon(name)}<span>${esc(text)}</span></div>`;
  }

  // ---------------- landing
  function alertStrip() {
    const alerts = model.alerts.map(alert => ({ event: alert.event || alert.properties?.event || '', ends: ms(alert.ends || alert.expires || alert.properties?.ends || alert.properties?.expires) })).filter(alert => alert.event);
    if (!alerts.length) return '';
    return `<div class="sb-alerts" role="list">${alerts.slice(0, 3).map(alert => { const mode = /winter|snow|ice|freez|blizzard|sleet|cold/i.test(alert.event) ? 'snow' : 'rain'; return `<button type="button" class="sb-alert-strip" role="listitem" data-open-impacts="${mode}">${icon('warn')}<span><strong>${esc(alert.event)}</strong>${alert.ends ? ` · until ${esc(when(alert.ends, zone, model.now))}` : ''}</span>${icon('chev')}</button>`; }).join('')}</div>`;
  }
  function landing() {
    const c = model.current, today = model.days[0] || {};
    const facts = [['High', finite(today.high) ? `${Math.round(today.high)}°` : '—'], ['Low', finite(today.low) ? `${Math.round(today.low)}°` : '—'], ['Wind', finite(c.wind) ? `${c.windDir ? `${c.windDir} ` : ''}${Math.round(c.wind)} mph` : '—'], ['Humidity', finite(c.humidity) ? `${Math.round(c.humidity)}%` : '—']];
    const entry = mode => {
      const horizon = featuredHorizon(model, mode), s = summary(mode, horizon);
      if (!s) return '';
      const chanceText = mode === 'snow' ? (finite(s.chance) ? `${pct(s.chance)} chance of ${s.mixedWording ? 'rain or snow' : 'snow'}` : 'Snow chance unavailable') : `${pct(s.chance)} chance of ${s.frozenShare >= 0.5 ? 'precipitation' : 'rain'}`;
      return `<button type="button" class="sb-entry" data-select="${mode}" data-horizon-pick="${horizon}" aria-label="Open ${mode === 'snow' ? 'Snow' : 'Rain'} Central"><span class="sb-entry-photo" style="background-image:url('${centerPhoto(mode)}')"></span><span class="sb-entry-chip">${icon(mode === 'snow' ? 'flake' : 'rain')}${mode === 'snow' ? 'Snow Central' : 'Rain Central'}</span><span class="sb-entry-body"><strong class="sb-entry-amount">${esc(headline(s))}</strong><span class="sb-entry-chance">${esc(chanceText)}</span><span class="sb-entry-when">${icon('cal')}<span>${esc(timingText(s))}</span></span>${trendLine(mode, horizon, true)}</span><span class="sb-entry-go">${icon('chev')}</span></button>`;
    };
    return `${bar()}<main class="sb-main"><section class="sb-now" style="background-image:url('/weather-fusion/${skyPhoto(c)}')"><div class="sb-now-in"><div class="sb-now-main"><span class="sb-now-icon">${c.icon ? renderWeatherIconSvg(c.icon, 64) : ''}</span><div><div class="sb-now-temp">${finite(c.temp) ? `${Math.round(c.temp)}°` : '—'}</div><div class="sb-now-cond">${esc(c.condition || 'Conditions unavailable')}</div><div class="sb-now-feels">${finite(c.feels) ? `Feels like ${Math.round(c.feels)}°` : ''}</div></div></div><dl class="sb-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div></section>${alertStrip()}<div class="sb-entries">${entry('rain')}${entry('snow')}</div><p class="sb-foot">Beta · Amounts from the NWS, NOAA's Weather Prediction Center and the Weather Nourie forecast blend.</p></main>`;
  }

  // ---------------- center home
  function seg() {
    return `<nav class="sb-seg" aria-label="Forecast period">${HORIZONS.map(h => `<button type="button" data-horizon="${h.id}" aria-pressed="${state.horizon === h.id}" ${horizonWindow(model, h.id) ? '' : 'disabled'}>${h.label}</button>`).join('')}</nav><p class="sb-window">${esc(horizonWindow(model, state.horizon)?.label || '')} · ${esc(windowText(model, horizonWindow(model, state.horizon)))}</p>`;
  }
  function heroCard(s) {
    const mode = state.mode;
    const frozen = mode === 'rain' && s.frozenShare >= 0.5;
    const amountLabel = mode === 'snow' ? 'Expected snowfall' : frozen ? 'Total precipitation (melted)' : 'Expected rainfall';
    const most = mode === 'snow'
      ? (s.range && finite(s.amount) && s.range[1] !== s.range[0] ? `Most likely ${inches(s.amount, 'snow')} · range from NWS` : s.range && s.range[1] === 0 ? 'NWS: little or no accumulation' : s.range ? 'NWS forecast' : '')
      : (s.range && s.range[1] - s.range[0] >= 0.05 ? `Most likely ${inches(s.amount)}` : '');
    const chanceLabel = mode === 'snow' ? (s.mixedWording ? 'Chance of rain or snow' : 'Chance of snow') : frozen ? 'Chance of precipitation' : 'Chance of rain';
    const conf = s.confidence;
    const notes = [];
    if (mode === 'rain' && s.frozenShare >= 0.2) notes.push(`<div class="sb-callout">${icon('flake')}<span>${s.frozenShare >= 0.5 ? 'Most' : 'Some'} of this falls as snow or a rain–snow mix (${inches(s.frozen)} of melted liquid).</span><button type="button" data-switch="snow">Snow Central</button></div>`);
    if (mode === 'snow' && s.marginal && (s.amount > 0 || s.range?.[1] > 0)) notes.push(`<div class="sb-callout">${icon('warn')}<span>Temperatures near 32°F: a degree or two decides rain versus snow, so totals can shift.</span></div>`);
    if (mode === 'snow' && (s.freezingRain || s.sleet)) notes.push(`<div class="sb-callout">${icon('warn')}<span>${[s.freezingRain && 'Freezing rain', s.sleet && 'sleet'].filter(Boolean).join(' and ')} also possible in this period.</span></div>`);
    return `<section class="sb-card sb-hero" style="--hero-photo:url('${centerPhoto(mode)}')"><div class="sb-hero-stats"><div class="sb-stat"><strong>${esc(headline(s))}</strong><span>${amountLabel}</span>${most ? `<small>${esc(most)}</small>` : ''}</div><div class="sb-stat"><strong>${esc(pct(s.chance))}</strong><span>${chanceLabel}</span></div></div><div class="sb-hero-rows"><div class="sb-row-i">${icon('cal')}<span>${esc(timingText(s))}</span></div>${trendLine(mode, state.horizon)}</div><div class="sb-hero-foot"><span class="sb-pill">${icon('gauge')}Confidence: ${esc(conf.label || 'Unavailable')}</span>${s.partial || s.prorated ? '<span class="sb-note">Some days have incomplete guidance</span>' : ''}</div></section>${notes.join('')}`;
  }
  function layersFor() { return mapLayers(model, state.mode, state.horizon); }
  function selectedLayer() {
    const layers = layersFor(), key = `${state.mode}|${state.horizon}`;
    return layers.find(row => row.id === state.layer[key]) || layers[0] || null;
  }
  function mapTitle(layer) {
    if (!layer) return `Forecast ${state.mode === 'snow' ? 'snowfall' : 'rainfall'} totals`;
    const what = layer.quantity === 'snow-probability' ? 'Chance of 4″+ snow' : state.mode === 'snow' ? 'Forecast snowfall totals' : 'Forecast rainfall totals';
    return `${what}<em>${esc(layer.label)} · ${esc(dayHour(layer.start, zone))} – ${esc(dayHour(layer.end, zone))}</em>`;
  }
  function tiles(s) {
    const mode = state.mode, kind = mode === 'snow' ? 'snow' : 'rain';
    const alerts = relevantAlerts(mode);
    const history = state.history.get(`${mode}|${state.horizon}`);
    const changeText = history?.status === 'ready' ? `${inches(history.first.amount, kind)} → ${inches(history.last.amount, kind)}` : 'Recorded forecast updates';
    const live = liveSummaryText();
    const timing = s.timing.heaviest ? `Heaviest ${when(s.timing.heaviest.a, zone, model.now)}` : timingText(s);
    const list = [
      ['probabilities', 'pct', 'Chance & Amounts', `${pct(s.chance)} · ${headline(s)}`],
      ['changes', 'chart', 'Forecast Changes', changeText],
      ['timing', 'clock', 'Storm Timing', timing],
      ['live', 'radar', 'Live Tracking', live],
      ['confidence', 'gauge', 'Forecast Confidence', s.confidence.label ? `${s.confidence.label}${finite(s.confidence.score) ? ` (${s.confidence.score})` : ''}` : 'Unavailable'],
      ['impacts', 'warn', 'Weather Impacts', alerts.length ? alerts[0].event : 'No active alerts'],
    ];
    return `<div class="sb-tiles">${list.map(([id, ic, title, text]) => `<button type="button" class="sb-tile" data-view="${id}"><span class="sb-tile-ic${id === 'impacts' && alerts.length ? ' sb-warn' : ''}">${icon(ic)}</span><span><strong>${title}</strong><small data-tile="${id}">${esc(text)}</small></span>${icon('chev', 'sb-go')}</button>`).join('')}</div>`;
  }
  function center() {
    const s = summary(state.mode);
    if (!s) return `${bar()}<main class="sb-main">${seg()}<section class="sb-card"><p>Forecast data for this period is unavailable.</p></section></main>`;
    const layer = selectedLayer();
    return `${bar()}<main class="sb-main">${seg()}${heroCard(s)}<section class="sb-card sb-mapcard"><div class="sb-mapcard-head"><strong>${mapTitle(layer)}</strong><button type="button" class="sb-btn" data-view="map" aria-label="Open full accumulation map">${icon('expand')}</button></div><div class="sb-mapwrap"><div class="sb-map" data-map role="img" aria-label="${state.mode === 'snow' ? 'Snowfall' : 'Rainfall'} accumulation map preview"></div><div class="sb-legend" data-legend hidden></div></div><p class="sb-map-status" data-map-status role="status">${layer ? 'Loading map…' : 'No accumulation map is published for this period.'}</p></section>${tiles(s)}</main>`;
  }

  // ---------------- detail views
  function detailShell(title, ic, content) {
    return `${bar()}<main class="sb-main">${seg()}<section class="sb-card"><h3>${icon(ic)}${title}</h3>${content}</section></main>`;
  }
  function probabilitiesView(s) {
    const mode = state.mode;
    if (mode === 'snow') {
      const quotes = s.periods.filter(row => /accumulation/i.test(row.detail)).map(row => `<p class="sb-quote"><strong>${esc(row.name)}:</strong> ${esc((row.detail.match(/[^.]*accumulation[^.]*\./i) || [''])[0].trim())}</p>`).join('');
      const wpcRows = s.wpc.map(row => { const [a, b] = row.range, label = row.kind === 'ice' ? `Ice ${row.inches}″+` : `${row.inches}″+`; return `<div class="sb-barrow"><span>${esc(label)}</span><span class="sb-track"><i style="width:${Math.max(2, b)}%"></i></span><span>${a === 0 ? '<10%' : `${a}–${b}%`}</span></div>`; }).join('');
      return detailShell('Chance &amp; Amounts', 'pct', `<div class="sb-big"><strong>${esc(pct(s.chance))}</strong><span>${s.chanceSource === 'nws' ? `NWS chance of precipitation in periods that mention snow${s.mixedWording ? ' (rain and snow)' : ''}` : 'Chance of snow'}</span></div><div class="sb-rows" style="margin-top:8px">${row('Expected snowfall', headline(s))}${finite(s.amount) ? row('NWS hourly-grid total', inches(s.amount, 'snow')) : ''}${finite(s.liquid) ? row('Melted liquid (all types)', inches(s.liquid)) : ''}</div>${s.models.length ? `<p class="sb-sub">Computer models · full days ${esc(s.modelSpan)}</p><div class="sb-rows">${s.models.map(item => row(sourceName(item.id), inches(item.value, 'snow'))).join('')}</div>` : ''}${quotes ? `<h3 style="margin-top:14px">${icon('flake')}What the NWS forecast says</h3><div style="display:grid;gap:8px">${quotes}</div>` : ''}${wpcRows ? `<h3 style="margin-top:14px">${icon('pct')}WPC chance of at least</h3><div class="sb-bars">${wpcRows}</div><p class="sb-note" style="margin-top:6px">Official WPC probability categories for their 24-hour periods.</p>` : ''}<p class="sb-note" style="margin-top:12px">Snowfall ranges come straight from NWS forecast wording. Percentile ranges are shown only when a calibrated distribution is published; none is estimated from model amounts.</p>`);
    }
    const sources = s.sources || [];
    const thresholds = [0.01, 0.1, 0.25, 0.5, 1, 2, 3];
    const max = Math.max(0.01, ...sources.map(item => item.value));
    const sourceRows = sources.map(item => `<div class="sb-barrow"><span>${esc(sourceName(item.id))}</span><span class="sb-track"><i style="width:${(item.value / max) * 100}%"></i></span><span>${esc(inches(item.value))}</span></div>`).join('');
    const thresholdRows = sources.length >= 2 ? thresholds.map(level => { const count = sources.filter(item => item.value >= level).length; return `<div class="sb-barrow"><span>${level.toFixed(2)}″+</span><span class="sb-track"><i style="width:${(count / sources.length) * 100}%"></i></span><span>${count} of ${sources.length}</span></div>`; }).join('') : '';
    return detailShell('Chance &amp; Amounts', 'pct', `<div class="sb-big"><strong>${esc(pct(s.chance))}</strong><span>Highest hourly chance of measurable ${s.frozenShare >= 0.5 ? 'precipitation' : 'rain'}</span></div><div class="sb-rows" style="margin-top:8px">${row('Most likely amount', inches(s.amount))}${s.range ? row('Range across forecast sources', rangeText(s.range[0], s.range[1])) : ''}${s.frozenShare >= 0.2 ? row('Falls as snow or mix (melted)', inches(s.frozen)) : ''}</div>${sourceRows ? `<h3 style="margin-top:14px">${icon('drop')}What each forecast source expects</h3><div class="sb-bars">${sourceRows}</div>` : ''}${thresholdRows ? `<h3 style="margin-top:14px">${icon('pct')}Sources reaching each amount</h3><div class="sb-bars">${thresholdRows}</div>` : ''}<p class="sb-note" style="margin-top:12px">Source counts show agreement between forecasts, not a calibrated probability. Percentile ranges are shown only when a calibrated distribution is published.</p>`);
  }
  function row(label, value) { return `<div class="sb-kv"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function timingView(s) {
    const t = s.timing, kind = state.mode === 'snow' ? 'snow' : 'rain';
    const rows = [];
    if (t.status === 'hourly' || t.status === 'event') {
      rows.push(row('Begins', t.underway ? 'Underway now' : t.continuing ? 'Already underway' : when(t.onset, zone, model.now)));
      if (t.heaviest) rows.push(row('Heaviest', `${when(t.heaviest.a, zone, model.now)} – ${when(t.heaviest.b, zone, model.now)} (${inches(t.heaviest.amount, kind)})`));
      rows.push(row(t.openEnd ? 'Continues past' : 'Ends', when(t.end, zone, model.now)));
      if (t.later?.length) rows.push(row('More rain later', t.later.map(day => day.name).join(', ')));
    } else if (t.status === 'daily') {
      rows.push(row('Wettest day', `${t.wettest.name} (${inches(s.portions.find(item => item.day === t.wettest)?.amount)})`));
      rows.push(row('Days with rain', t.later.map(day => day.name).join(', ')));
    } else rows.push(row('Status', kind === 'snow' ? 'No snow expected' : 'No rain expected'));
    const series = kind === 'snow' ? t.series.filter(item => item.t + HOUR > model.now) : t.series;
    const typeNames = { rain: 'Rain', storm: 'Thunderstorms', snow: 'Snow', mix: 'Rain–snow mix' };
    const present = kind === 'rain' ? [...new Set(series.filter(item => item.value > 0).map(item => (item.type === 'none' ? 'rain' : item.type)))] : [];
    const key = present.length > 1 ? `<div class="sb-key">${present.map(type => `<span><i class="sb-key-${type}"></i>${typeNames[type] || type}</span>`).join('')}</div>` : '';
    const daily = kind === 'rain' && t.later?.length ? `<h3 style="margin-top:14px">${icon('cal')}Later days</h3><div class="sb-rows">${s.portions.filter(item => item.mode !== 'hourly').map(item => row(`${item.day.name} ${item.day.date}`, `${inches(item.amount)} · ${pct(item.day.pop)}`)).join('')}</div>` : '';
    return detailShell('Storm Timing', 'clock', `<div class="sb-rows">${rows.join('')}</div>${series.some(item => item.value > 0) ? `<h3 style="margin-top:14px">${icon(kind === 'snow' ? 'flake' : 'drop')}${kind === 'snow' ? 'NWS snowfall every 6 hours' : 'Hourly precipitation'}</h3>${barChart(series, { kind, zone, now: model.now, unitLabel: kind === 'snow' ? 'Snowfall per 6 hours in inches' : 'Hourly precipitation in inches' })}${key}` : ''}${daily}<p class="sb-note" style="margin-top:10px">${kind === 'snow' ? 'Snow timing follows NWS snow hours and 6-hour snowfall grids.' : 'Hourly timing covers the next 48 hours; later days use daily totals.'}</p>`);
  }
  function changesView() {
    const kind = state.mode === 'snow' ? 'snow' : 'rain', history = state.history.get(`${state.mode}|${state.horizon}`);
    let content;
    if (!history) content = '<p class="sb-note">Loading recorded forecast updates…</p>';
    else if (history.status === 'ready') {
      const deltaText = `${history.delta >= 0 ? '+' : ''}${kind === 'snow' ? history.delta.toFixed(1) : history.delta.toFixed(2)}″`;
      content = `<div class="sb-big"><strong class="${history.direction === 'up' ? 'sb-trend-up' : history.direction === 'down' ? 'sb-trend-down' : ''}">${history.direction === 'up' ? 'Increasing' : history.direction === 'down' ? 'Decreasing' : 'Steady'}</strong><span>${esc(deltaText)} since ${esc(when(history.first.t, zone, model.now))}</span></div><div class="sb-rows" style="margin-top:8px">${row(`First recorded (${when(history.first.t, zone, model.now)})`, inches(history.first.amount, kind))}${row(`Previous (${when(history.previous.t, zone, model.now)})`, inches(history.previous.amount, kind))}${row(`Latest (${when(history.last.t, zone, model.now)})`, inches(history.last.amount, kind))}${finite(history.chanceDelta) ? row('Chance change', `${history.chanceDelta >= 0 ? '+' : ''}${Math.round(history.chanceDelta)} points`) : ''}</div>${lineChart(history.points, { kind, zone, now: model.now })}<p class="sb-note">Each point is a recorded forecast for the same remaining window (from ${esc(when(history.from, zone, model.now))}), so rain that has already fallen is not counted as a decrease. "Increasing" or "Decreasing" needs a change of at least ${kind === 'snow' ? '0.5″' : '0.25″'}.</p>`;
    } else if (history.status === 'error') content = '<p class="sb-note">Forecast history could not be loaded. No change is claimed.</p>';
    else content = `<div class="sb-big"><strong>Tracking</strong><span>since ${esc(when(history.since ?? model.now, zone, model.now))}</span></div><p class="sb-note" style="margin-top:8px">Weather Nourie has one recorded forecast for this period so far. Changes appear after the next forecast update, usually within the hour. No trend is claimed until then.</p>`;
    return detailShell('Forecast Changes', 'chart', content);
  }
  function confidenceView(s) {
    const c = s.confidence;
    return detailShell('Forecast Confidence', 'gauge', `${gauge(c.score, c.label)}<div class="sb-rows">${c.days.map(day => row(`${day.name} ${day.date}`, `${day.label || '—'}${finite(day.score) ? ` (${day.score})` : ''}`)).join('')}${s.kind === 'rain' && s.range ? row('Source spread', rangeText(s.range[0], s.range[1])) : ''}</div>${c.factors.length ? `<h3 style="margin-top:14px">${icon('chart')}What drives it</h3><ul class="sb-list">${c.factors.slice(0, 6).map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}${s.kind === 'snow' && s.marginal ? '<p class="sb-callout" style="margin-top:10px">Snow amounts are less certain than this score suggests because temperatures sit near freezing.</p>' : ''}<div data-accuracy class="sb-note" style="margin-top:12px">Loading recent verification…</div><p class="sb-note" style="margin-top:8px">The score measures agreement between forecast sources and lead time. It is not a calibrated chance of being right.</p>`);
  }
  function relevantAlerts(mode) {
    const pattern = mode === 'snow' ? /winter|snow|ice|freez|blizzard|sleet|wind chill|cold|frost/i : /flood|rain|wind|thunder|tornado|hurricane|tropical|surge|coastal|storm/i;
    return model.alerts.filter(alert => pattern.test(alert?.event || alert?.properties?.event || '')).map(alert => ({ event: alert.event || alert.properties?.event || 'NWS alert', severity: alert.severity || alert.properties?.severity || '', headline: alert.headline || alert.properties?.headline || '', description: alert.description || alert.properties?.description || '', instruction: alert.instruction || alert.properties?.instruction || '', ends: ms(alert.ends || alert.expires || alert.properties?.ends || alert.properties?.expires) }));
  }
  function guidance(s) {
    const out = [];
    if (s.kind === 'snow') {
      const top = s.range ? s.range[1] : s.amount;
      if (top >= 4) out.push('Significant snow: roads likely snow-covered and travel may be difficult.');
      else if (top >= 1) out.push('Slick, snow-covered roads possible, especially bridges and overpasses.');
      else if (top > 0) out.push('Light snow could make untreated surfaces slippery.');
      if (s.freezingRain) out.push('Freezing rain: a glaze of ice on roads, trees and power lines is possible.');
      if (s.marginal && top > 0) out.push('Wet, heavy snow near 32°F can weigh down branches.');
    } else {
      if (s.frozenShare >= 0.5) out.push('Most of this precipitation falls as snow or a rain–snow mix. See Snow Central for snow impacts.');
      if (s.amount >= 2) out.push('Heavy rain: flooding of poor-drainage areas, creeks and low roads is possible.');
      else if (s.amount >= 1) out.push('Ponding on roads; allow extra travel time.');
      if (s.thunder) out.push('Thunderstorms: lightning and brief torrential downpours.');
      if (s.maxGust >= 45) out.push(`Damaging gusts near ${Math.round(s.maxGust)} mph could down trees and power lines.`);
      else if (s.maxGust >= 35) out.push(`Gusts near ${Math.round(s.maxGust)} mph may bring down small limbs.`);
    }
    return out;
  }
  function impactsView(s) {
    const alerts = relevantAlerts(state.mode), other = model.alerts.length - alerts.length;
    const outlooks = state.mode === 'rain' ? model.outlooks.filter(item => /wpc|flood|rain/i.test(`${item.kind} ${item.title}`)) : [];
    const tips = guidance(s);
    return detailShell('Weather Impacts', 'warn', `<p class="sb-sub" style="margin-top:2px">Official NWS alerts</p>${alerts.length ? `<div style="display:grid;gap:8px">${alerts.map(alert => `<article class="sb-alert" data-sev="${esc(alert.severity)}"><strong>${esc(alert.event)}</strong><small>${esc(alert.severity)}${alert.ends ? ` · until ${esc(when(alert.ends, zone, model.now))}` : ''}</small>${alert.headline ? `<p>${esc(alert.headline)}</p>` : ''}${alert.description ? `<details><summary>Read the full alert</summary><pre>${esc(alert.description)}${alert.instruction ? `\n\n${esc(alert.instruction)}` : ''}</pre></details>` : ''}</article>`).join('')}</div>` : `<p class="sb-note">No ${state.mode === 'snow' ? 'winter' : 'rain, flood or wind'} alerts are active for this location.${other > 0 ? ` ${other} other alert${other > 1 ? 's are' : ' is'} active.` : ''}</p>`}${outlooks.length ? `<p class="sb-sub">WPC flooding-rain outlook</p><div class="sb-rows">${outlooks.map(item => row(item.title || 'Excessive rainfall outlook', item.level || item.category || '')).join('')}</div>` : ''}<p class="sb-sub">Weather Nourie guidance</p>${tips.length ? `<ul class="sb-list">${tips.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : `<p class="sb-note">No notable ${state.mode === 'snow' ? 'snow or ice' : 'rain'} impacts expected in this period.</p>`}<p class="sb-note" style="margin-top:10px">Guidance is based on the forecast amounts above and is not an official warning. ${state.mode === 'snow' ? `<a href="${SNOW_SOURCE}" target="_blank" rel="noopener">WPC winter outlook</a>` : `<a href="https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php" target="_blank" rel="noopener">WPC excessive rainfall outlook</a>`}</p>`);
  }
  const precipKind = value => (/rain|snow|sleet|hail|graupel|ice|drizzle|mix/i.test(String(value || '')) ? String(value).replace(/_/g, ' ').toLowerCase() : null);
  const radarReady = r => r && !r.error && r.status === 'ready' && r.precipitation?.status === 'ready';
  function liveSummaryText() {
    const r = state.radar;
    if (!r) return 'Loading NOAA radar…';
    if (!radarReady(r)) return 'Radar check unavailable';
    const p = r.precipitation, type = precipKind(p.atLocation ? p.observedTypeAtLocation : p.nearestObservedType);
    if (p.atLocation) return `Falling now${type ? ` · ${type}` : ''}`;
    if (finite(p.nearestRainMiles)) return `${type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Precipitation'} ${Math.round(p.nearestRainMiles)} mi ${p.nearestRainDirection || ''}${p.approaching ? ', approaching' : ''}`.trim();
    return 'None within 36 mi';
  }
  function liveView() {
    const r = state.radar, p = r?.precipitation || {};
    const s = summary(state.mode), next = s && (s.timing.status === 'hourly' || s.timing.status === 'event') && !s.timing.underway ? `Forecast to begin ${when(s.timing.onset, zone, model.now)}` : s?.timing.underway ? 'Forecast: underway now' : 'No precipitation forecast in this period';
    const ok = radarReady(r), type = ok ? precipKind(p.atLocation ? p.observedTypeAtLocation : p.nearestObservedType) : null;
    const rows = !r ? '<p class="sb-note">Loading NOAA radar…</p>' : [row('Radar frame', r.frames?.length ? clock(ms(r.frames.at(-1)), zone) : 'Unavailable'), row('At your location', !ok ? 'Unavailable' : p.atLocation ? 'Falling now' : 'Not falling'), row('Nearest', !ok ? 'Unavailable' : finite(p.nearestRainMiles) ? `${Math.round(p.nearestRainMiles)} mi ${p.nearestRainDirection || ''}`.trim() : 'None within 36 mi'), row('Motion', !ok ? 'Unavailable' : p.approaching === true ? 'Approaching' : 'Not approaching'), row('Radar-detected type', type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Not classified'), row('Forecast', next)].join('');
    return `${bar()}<main class="sb-main">${seg()}<section class="sb-card sb-mapcard"><div class="sb-mapcard-head"><strong>Live radar<em>NOAA MRMS observed reflectivity</em></strong></div><div class="sb-mapwrap"><div class="sb-map sb-map-tall" data-live-map role="img" aria-label="Live radar map"></div></div><div class="sb-live-ctl"><button type="button" class="sb-btn" data-play aria-label="Play radar loop">${icon('play')}</button><input type="range" min="0" max="0" value="0" data-frame aria-label="Radar frame"/><output data-frame-time>—</output></div></section><section class="sb-card"><h3>${icon('radar')}Right now</h3><div class="sb-rows">${rows}</div><p class="sb-note" style="margin-top:8px">Radar shows where precipitation is falling; it does not measure snow depth or rainfall totals. <a href="${RADAR_PAGE}" target="_blank" rel="noopener">Official NWS radar</a></p></section></main>`;
  }
  function mapView() {
    const layers = layersFor(), layer = selectedLayer();
    return `${bar()}<main class="sb-main">${seg()}<section class="sb-card sb-mapcard"><div class="sb-mapcard-head"><strong>${mapTitle(layer)}</strong><button type="button" class="sb-btn" data-recenter aria-label="Recenter map">${icon('target')}</button></div>${layers.length > 1 ? `<div class="sb-chips" style="padding:8px 10px 0" role="group" aria-label="Map layer">${layers.map(item => `<button type="button" class="sb-chip" data-layer="${esc(item.id)}" aria-pressed="${item.id === layer?.id}">${esc(item.label)}</button>`).join('')}</div>` : ''}<div class="sb-mapwrap" style="margin-top:8px"><div class="sb-map sb-map-tall" data-map data-interactive role="region" aria-label="Interactive accumulation map" tabindex="0"></div><div class="sb-legend" data-legend hidden></div></div><p class="sb-map-status" data-map-status role="status">${layer ? 'Loading map…' : 'No accumulation map is published for this period.'}</p></section><p class="sb-note">Tap anywhere on the map for the forecast amount there. ${layer?.sourceUrl ? `<a href="${esc(safeWinterMapUrl(layer.sourceUrl) || '#')}" target="_blank" rel="noopener">Source product</a>` : ''}</p></main>`;
  }

  // ---------------- maps
  function basemap(L, map) {
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 13, attribution: 'Tiles © Esri' }).addTo(map);
    map.createPane('sb-labels');
    map.getPane('sb-labels').style.zIndex = 650;
    map.getPane('sb-labels').style.pointerEvents = 'none';
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 13, pane: 'sb-labels' }).addTo(map);
  }
  function newMap(host, interactive) {
    const L = window.L, center = [model.location.lat, model.location.lon];
    const map = L.map(host, { zoomControl: interactive, attributionControl: true, dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive, scrollWheelZoom: false, boxZoom: false, keyboard: interactive, tap: interactive }).setView(center, 7);
    map.attributionControl.setPrefix(false);
    basemap(L, map);
    L.circleMarker(center, { radius: 7, weight: 3, color: '#fff', fillColor: '#12304a', fillOpacity: 1, pane: 'markerPane' }).addTo(map);
    state.maps.push(map);
    requestAnimationFrame(() => map.invalidateSize());
    return map;
  }
  function legendHTML(layer, geo) {
    if (layer.kind === 'arcgis' && layer.quantity !== 'snow-probability') {
      const want = [3, 2, 1.5, 1, 0.5, 0.25, 0.1, 0.01];
      const rows = want.map(level => ({ level, item: (layer.legend || []).find(entry => Math.abs(parseFloat(entry.label) - level) < 1e-6) })).filter(row => row.item?.image);
      return rows.map(row => `<span><i style="background-image:url('${esc(row.item.image)}')"></i>${row.level === 3 ? '3″+' : `${row.level}″`}</span>`).join('');
    }
    if (layer.kind === 'arcgis') return (layer.legend || []).slice(0, 6).map(entry => `<span>${entry.image ? `<i style="background-image:url('${esc(entry.image)}')"></i>` : ''}${esc(entry.label || '')}</span>`).join('');
    const legend = (geo?.metadata?.legend || []).slice(0, 8).reverse();
    return legend.map(entry => `<span><i style="background:${esc(entry.color)}"></i>${esc(String(entry.label || '').replace(/ contour$/, '+'))}</span>`).join('');
  }
  async function identify(layer, lat, lon) {
    const base = safeWinterMapUrl(layer.url);
    if (!base) return null;
    const query = new URLSearchParams({ f: 'json', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', sr: '4326', layers: `all:${layer.layers[0]}`, tolerance: '1', mapExtent: `${lon - 1},${lat - 1},${lon + 1},${lat + 1}`, imageDisplay: '400,400,96', returnGeometry: 'false' });
    const response = await fetch(`${base.replace(/\/$/, '')}/identify?${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('identify failed');
    const data = await response.json();
    const attributes = data?.results?.[0]?.attributes;
    if (!attributes) return { text: layer.quantity === 'snow-probability' ? 'Below 10%' : 'Less than 0.01″' };
    if (layer.quantity === 'snow-probability') return { text: attributes.outlook || attributes.Outlook || attributes.label || 'In a published category' };
    return { text: qpfBand(attributes.QPF ?? attributes.qpf) || 'Unavailable', valid: attributes['Valid Time'] };
  }
  async function mountAccumulation(renderId) {
    const host = root.querySelector('[data-map]'), status = root.querySelector('[data-map-status]'), legend = root.querySelector('[data-legend]');
    const layer = selectedLayer();
    if (!host || !status) return;
    if (!window.L || !finite(model.location.lat) || !finite(model.location.lon)) { status.textContent = 'The interactive map is unavailable.'; return; }
    const interactive = host.hasAttribute('data-interactive');
    const map = newMap(host, interactive);
    if (!interactive) { host.style.cursor = 'pointer'; host.addEventListener('click', () => { state.view = 'map'; render(); }); }
    if (!layer) return;
    const L = window.L, name = model.location.name.split(',')[0];
    if (layer.kind === 'arcgis') {
      const base = safeWinterMapUrl(layer.url);
      if (!base) { status.textContent = 'The WPC map address failed validation.'; return; }
      const Tile = L.TileLayer.extend({ getTileUrl(coords) { const size = 256, nw = this._map.options.crs.project(this._map.unproject(L.point(coords.x * size, coords.y * size), coords.z)), se = this._map.options.crs.project(this._map.unproject(L.point((coords.x + 1) * size, (coords.y + 1) * size), coords.z)); return `${base.replace(/\/$/, '')}/export?${new URLSearchParams({ f: 'image', format: 'png32', transparent: 'true', layers: `show:${layer.layers[0]}`, bbox: `${nw.x},${se.y},${se.x},${nw.y}`, bboxSR: '3857', imageSR: '3857', size: '256,256' })}`; } });
      const overlay = new Tile('', { opacity: 0.72, tileSize: 256, maxZoom: 13, crossOrigin: true }).addTo(map);
      overlay.on('tileerror', () => { if (renderId === state.renderId) status.textContent = 'Some WPC map tiles failed to load.'; });
      if (legend) { legend.innerHTML = legendHTML(layer); legend.hidden = !legend.innerHTML; }
      const span = `${esc(dayHour(layer.start, zone))} – ${esc(dayHour(layer.end, zone))}`;
      status.innerHTML = `<strong>${esc(layer.label)}</strong> · ${span}`;
      identify(layer, model.location.lat, model.location.lon).then(result => { if (renderId === state.renderId && result) status.innerHTML = `<strong>${esc(layer.label)} at ${esc(name)}: ${esc(result.text)}</strong> · ${span}`; }).catch(() => {});
      if (interactive) map.on('click', event => { const popup = L.popup().setLatLng(event.latlng).setContent('Checking WPC…').openOn(map); identify(layer, event.latlng.lat, event.latlng.lng).then(result => popup.setContent(`<strong>${esc(result?.text || 'Unavailable')}</strong><br><small>${esc(layer.label)}</small>`)).catch(() => popup.setContent('WPC value unavailable here.')); });
      return;
    }
    const url = winterAreaDataUrl(layer.url);
    if (!url) { status.textContent = 'The snowfall map address failed validation.'; return; }
    status.textContent = 'Loading snowfall contours…';
    const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/geo+json,application/json' } });
    const geo = await response.json();
    if (renderId !== state.renderId || !state.maps.includes(map)) return;
    const valid = geo?.type === 'FeatureCollection' && Array.isArray(geo.features) && geo.features.length <= 20000 && geo.metadata?.unit === 'in' && geo.metadata?.quantity === 'snowfall' && ms(geo.metadata?.start) === layer.start && ms(geo.metadata?.end) === layer.end;
    if (!valid) { status.textContent = 'The snowfall map did not match this period, so it is not shown.'; return; }
    const sorted = [...geo.features].sort((a, b) => (Number(a.properties?.value) || 0) - (Number(b.properties?.value) || 0));
    L.geoJSON({ type: 'FeatureCollection', features: sorted }, { interactive: false, style: feature => ({ weight: 0.6, color: feature.properties?.color || '#3182bd', fillColor: feature.properties?.color || '#3182bd', fillOpacity: 0.5, opacity: 0.7 }) }).addTo(map);
    const levels = geo.metadata?.levels || [];
    const describe = value => { if (value === null) return `Under ${levels[0] ?? 0.1}″`; const next = levels.find(level => level > value); return next ? `${short(value)}–${short(next)}″` : `${short(value)}″+`; };
    if (legend) { legend.innerHTML = legendHTML(layer, geo); legend.hidden = !legend.innerHTML; }
    status.innerHTML = `<strong>${esc(layer.label)} at ${esc(name)}: ${esc(describe(contourValueAt(geo, model.location.lat, model.location.lon)))}</strong> · ${esc(dayHour(layer.start, zone))} – ${esc(dayHour(layer.end, zone))}`;
    if (interactive) map.on('click', event => L.popup().setLatLng(event.latlng).setContent(`<strong>${esc(describe(contourValueAt(geo, event.latlng.lat, event.latlng.lng)))}</strong><br><small>${esc(layer.label)}</small>`).openOn(map));
  }
  function mountLive(renderId) {
    const host = root.querySelector('[data-live-map]');
    if (!host || !window.L || !finite(model.location.lat)) return;
    const r = state.radar;
    const map = newMap(host, true);
    if (!r || r.status !== 'ready' || !r.frames?.length || !safeWinterMapUrl(r.url)) return;
    const L = window.L, frames = r.frames.slice(-8);
    const layers = frames.map(time => L.tileLayer.wms(r.url, { layers: r.layer || 'conus_bref_qcd', format: 'image/png', transparent: true, version: '1.3.0', time, opacity: 0, zIndex: 300 }).addTo(map));
    const slider = root.querySelector('[data-frame]'), out = root.querySelector('[data-frame-time]'), play = root.querySelector('[data-play]');
    const show = index => { layers.forEach((layer, i) => layer.setOpacity(i === index ? 0.75 : 0)); if (slider) slider.value = String(index); if (out) out.textContent = clock(ms(frames[index]), zone); };
    if (slider) { slider.max = String(frames.length - 1); slider.addEventListener('input', () => { clearInterval(state.radarTimer); state.radarTimer = null; if (play) play.innerHTML = icon('play'); show(Number(slider.value)); }); }
    show(frames.length - 1);
    play?.addEventListener('click', () => {
      if (state.radarTimer) { clearInterval(state.radarTimer); state.radarTimer = null; play.innerHTML = icon('play'); play.setAttribute('aria-label', 'Play radar loop'); return; }
      let index = 0; show(index); play.innerHTML = icon('pause'); play.setAttribute('aria-label', 'Pause radar loop');
      state.radarTimer = setInterval(() => { if (renderId !== state.renderId) return; index = (index + 1) % frames.length; show(index); }, 700);
    });
  }

  // ---------------- data loading
  async function loadHistory(mode, horizon) {
    const key = `${mode}|${horizon}`;
    if (state.history.has(key) || state.pending.has(key) || !finite(model.location.lat)) return;
    state.pending.add(key);
    const win = horizonWindow(model, horizon);
    if (!win) return;
    const dates = daysIn(model, win).map(day => day.key);
    try {
      const results = await Promise.all(dates.map(date => fetch(`/api/weather-fusion/storm-snow/history?${new URLSearchParams({ latitude: model.location.lat, longitude: model.location.lon, center: mode, date })}`, { cache: 'no-store' }).then(response => (response.ok ? response.json() : null))));
      const byDate = {};
      results.forEach((data, index) => { byDate[dates[index]] = Array.isArray(data?.snapshots) ? data.snapshots : []; });
      state.history.set(key, historyTrend(byDate, model, mode, win));
    } catch { state.history.set(key, { status: 'error', points: [] }); }
    state.pending.delete(key);
    patch();
  }
  async function loadRadar() {
    if (state.radar || state.pending.has('radar') || !finite(model.location.lat)) return;
    state.pending.add('radar');
    try {
      const response = await fetch(`/api/weather-fusion/radar?${new URLSearchParams({ latitude: model.location.lat, longitude: model.location.lon })}`, { cache: 'no-store' });
      state.radar = response.ok ? await response.json() : { error: true };
    } catch { state.radar = { error: true }; }
    state.pending.delete('radar');
    if (state.view === 'live') render(); else patch();
  }
  async function loadAccuracy(renderId) {
    const target = root.querySelector('[data-accuracy]');
    if (!target) return;
    try {
      const response = await fetch(`/api/weather-fusion/accuracy?${new URLSearchParams({ latitude: model.location.lat, longitude: model.location.lon, days: 30, horizon: 24 })}`, { cache: 'no-store' });
      const data = await response.json();
      if (renderId !== state.renderId) return;
      const nourie = (data.rankings || []).find(item => item.isNourie || /nourie/i.test(item.name || item.id || ''));
      const score = num(Number(nourie?.overallScore ?? nourie?.accuracyScore));
      target.innerHTML = score !== null ? `Recent verification here: Weather Nourie scored <strong>${score.toFixed(1)}/100</strong> over ${esc(data.truthSummary?.totalHours ?? 'recent')} verified hours.` : 'Recent verification is not available for this location yet.';
    } catch { if (renderId === state.renderId) target.textContent = 'Recent verification is not available right now.'; }
  }
  function patch() {
    for (const node of root.querySelectorAll('[data-trend]')) node.outerHTML = trendLine(state.mode, state.horizon);
    if (state.mode && state.view === 'home') {
      const history = state.history.get(`${state.mode}|${state.horizon}`), kind = state.mode === 'snow' ? 'snow' : 'rain';
      const changes = root.querySelector('[data-tile=changes]');
      if (changes && history?.status === 'ready') changes.textContent = `${inches(history.first.amount, kind)} → ${inches(history.last.amount, kind)}`;
      const live = root.querySelector('[data-tile=live]');
      if (live) live.textContent = liveSummaryText();
    }
    if (!state.mode) {
      for (const entry of root.querySelectorAll('.sb-entry')) {
        const mode = entry.dataset.select, horizon = entry.dataset.horizonPick;
        if (!entry.querySelector('.sb-entry-trend')) { const html = trendLine(mode, horizon, true); if (html) entry.querySelector('.sb-entry-body')?.insertAdjacentHTML('beforeend', html); }
      }
    }
    if (state.view === 'changes') { const main = root.querySelector('.sb-main'); if (main) { const scroll = dialog.scrollTop; root.innerHTML = changesView(); dialog.scrollTop = scroll; } }
  }

  // ---------------- render
  function render() {
    disposeMaps();
    state.renderId += 1;
    const id = state.renderId;
    root.dataset.mode = state.mode || 'home';
    if (!state.mode) root.innerHTML = landing();
    else {
      const s = summary(state.mode);
      root.innerHTML = state.view === 'home' || !s ? center()
        : state.view === 'probabilities' ? probabilitiesView(s)
        : state.view === 'timing' ? timingView(s)
        : state.view === 'changes' ? changesView()
        : state.view === 'confidence' ? confidenceView(s)
        : state.view === 'impacts' ? impactsView(s)
        : state.view === 'live' ? liveView()
        : mapView();
    }
    dialog.scrollTop = 0;
    if (state.mode && (state.view === 'home' || state.view === 'map')) void mountAccumulation(id).catch(() => { const status = root.querySelector('[data-map-status]'); if (status && id === state.renderId) status.textContent = 'The accumulation map could not load. Try again shortly.'; });
    if (state.view === 'live') mountLive(id);
    if (state.view === 'confidence') void loadAccuracy(id);
    if (state.mode) void loadHistory(state.mode, state.horizon);
    else for (const mode of ['rain', 'snow']) void loadHistory(mode, featuredHorizon(model, mode));
    void loadRadar();
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.hasAttribute('data-close')) { dialog.close(); return; }
    if (button.hasAttribute('data-back')) { if (state.view !== 'home') state.view = 'home'; else state.mode = null; render(); return; }
    if (button.dataset.select) { state.mode = button.dataset.select; state.horizon = button.dataset.horizonPick || featuredHorizon(model, state.mode); state.view = 'home'; render(); return; }
    if (button.dataset.openImpacts) { state.mode = button.dataset.openImpacts; state.horizon = featuredHorizon(model, state.mode); state.view = 'impacts'; render(); return; }
    if (button.dataset.switch) { state.mode = button.dataset.switch; state.view = 'home'; render(); return; }
    if (button.dataset.horizon && !button.disabled) { state.horizon = button.dataset.horizon; render(); return; }
    if (button.dataset.layer) { state.layer[`${state.mode}|${state.horizon}`] = button.dataset.layer; render(); return; }
    if (button.hasAttribute('data-recenter')) { state.maps[0]?.setView([model.location.lat, model.location.lon], 7); return; }
    if (button.dataset.view) { state.view = button.dataset.view; render(); }
  });
  render();
}
