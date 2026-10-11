/* Halo insights — pure, testable explanations built from the same forecast
 * fields the rest of Halo shows. Nothing here invents data: every sentence is
 * derived from a blended value, a timestamp, or a documented NWS category. */
import { finite } from './weather-math.js?v=weather-qa-v67';

export const H = 3600000;

const hourShort = (ms, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' }).format(new Date(ms)).replace(' ', '');
const dayName = (ms, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(ms));
const inches = (v) => (!finite(v) ? null : v < 0.01 ? '<0.01 in' : `${v.toFixed(2)} in`);

/* Contiguous runs of hours at or above a rain-chance threshold.
 * Each window reports its peak chance and the liquid amount summed over it. */
export function rainWindows(points, t0, t1, threshold = 30) {
  const pts = (points || []).filter((p) => p.t >= t0 && p.t < t1 && Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  const out = [];
  let cur = null;
  for (const p of pts) {
    const wet = finite(p.v) && p.v >= threshold;
    if (wet && cur && p.t - cur.end <= 1.5 * H) {
      cur.end = p.t + H; cur.peak = Math.max(cur.peak, p.v); cur.amount += finite(p.amt) ? p.amt : 0; cur.hours += 1;
    } else if (wet) {
      if (cur) out.push(cur);
      cur = { start: p.t, end: p.t + H, peak: p.v, amount: finite(p.amt) ? p.amt : 0, hours: 1 };
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

/* One sentence describing the next rain window in the forecast. */
export function nextRainSentence(windows, nowMs, tz) {
  const w = windows.find((x) => x.end > nowMs);
  if (!w) return 'No rain is expected in the next 48 hours.';
  const amt = w.amount >= 0.01 ? `, about ${inches(w.amount)} total` : '';
  if (w.start <= nowMs) return `Rain is in the forecast now and until about ${hourShort(w.end, tz)}, peaking at ${Math.round(w.peak)}%${amt}.`;
  const day = w.start - nowMs > 12 * H ? ` on ${dayName(w.start, tz)}` : '';
  return `Rain starts around ${hourShort(w.start, tz)}${day}${w.end - w.start > H ? ` and runs to about ${hourShort(w.end, tz)}` : ''}, peaking at ${Math.round(w.peak)}%${amt}.`;
}

/* Day-to-day change in plain words: how the high moves and whether rain changes. */
export function dayChangeSentence(today, tomorrow, label = 'tomorrow') {
  if (!today || !tomorrow || !finite(today.high) || !finite(tomorrow.high)) return '';
  const d = tomorrow.high - today.high;
  const temp = Math.abs(d) < 2 ? `about as warm ${label}` : d > 0 ? `${Math.round(d)}° warmer ${label}` : `${Math.round(-d)}° cooler ${label}`;
  const wetNow = finite(today.chance) && today.chance >= 40, wetNext = finite(tomorrow.chance) && tomorrow.chance >= 40;
  const rain = wetNext && !wetNow ? ' with rain chances rising' : !wetNext && wetNow ? ' and drier' : wetNext ? ' with rain still possible' : '';
  return `Highs will be ${temp}${rain}.`;
}

/* What the NWS confidence label means for the user, from the factors it lists. */
export function confidenceExplanation(conf) {
  if (!conf?.label) return '';
  const factors = (conf.factors || []).slice(0, 3).map((f) => f.replace(/^same-day lead time$/i, 'short lead time').replace(/^1 forecast source: NWS$/, 'only one forecast source'));
  const head = { High: 'Forecasts agree closely.', Moderate: 'Some uncertainty in timing or amount.', Low: 'Models disagree; plans may change.' }[conf.label] || '';
  return [head, factors.length ? `Basis: ${factors.join('; ')}.` : ''].filter(Boolean).join(' ');
}

/* Plain-language meaning of a National Weather Service alert event. */
const GUIDE = [
  [/tornado warning/i, 'Take shelter now in a sturdy interior room on the lowest floor.'],
  [/tornado watch/i, 'Conditions favour tornadoes. Keep a way to receive warnings.'],
  [/severe thunderstorm warning/i, 'Move indoors and stay away from windows until the storm passes.'],
  [/severe thunderstorm watch/i, 'Storms may become severe. Watch the sky and keep alerts on.'],
  [/flash flood warning/i, 'Move to higher ground now. Never drive through flooded roads.'],
  [/flood warning/i, 'Flooding is happening or imminent. Avoid low areas and moving water.'],
  [/flood watch/i, 'Flooding is possible. Plan routes that avoid low-lying roads.'],
  [/heat advisory|excessive heat/i, 'Limit outdoor exertion, drink water often, and check on people who are vulnerable.'],
  [/wind chill|freeze|frost/i, 'Cover exposed skin and protect pipes and plants.'],
  [/winter storm|blizzard|ice storm/i, 'Travel may become hazardous. Keep supplies at home and drive only if essential.'],
  [/air quality/i, 'Sensitive groups should limit time outdoors; consider closing windows.'],
  [/dense fog|fog/i, 'Reduced visibility. Slow down and use low-beam headlights.'],
];
export function alertGuidance(event = '') {
  return GUIDE.find(([re]) => re.test(event))?.[1] || '';
}

/* Sun protection window and UV peak from hourly UV values. */
export function uvWindow(points, nowMs, tz) {
  const day = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const today = day(nowMs);
  const high = (points || []).filter((p) => finite(p.v) && p.v >= 3 && day(p.t) === today);
  if (!high.length) return null;
  const peak = high.reduce((a, b) => (b.v > a.v ? b : a));
  return { from: high[0].t, to: high.at(-1).t + H, peakAt: peak.t, peak: peak.v };
}

/* A short, honest "what to expect" line for the next 12 hours. */
export function nextTwelveSentence(hours) {
  const h = (hours || []).slice(0, 12).filter((x) => finite(x.temp));
  if (h.length < 3) return '';
  const hi = Math.max(...h.map((x) => x.temp)), lo = Math.min(...h.map((x) => x.temp));
  const first = h[0].temp, last = h.at(-1).temp;
  const trend = last - first;
  const dir = Math.abs(trend) < 2 ? 'steady' : trend > 0 ? 'warming' : 'cooling';
  return `Over the next 12 hours, temperatures stay between ${lo}° and ${hi}°, ${dir}.`;
}
