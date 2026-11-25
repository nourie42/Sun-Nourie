/**
 * Storm and Snow Beta snapshot contract.
 *
 * This module deliberately stores only facts already present in the canonical
 * forecast. It never turns deterministic guidance into a probability and it
 * never treats missing precipitation as zero. Snapshots are immutable records
 * of equivalent location/center/local-day windows so the beta can explain a
 * real forecast revision when the process has observed more than one cycle.
 */

const HOUR = 3600000;
const DAY = 24 * HOUR;
const HISTORY_BUCKET_MS = 30 * 60000;
export const STORM_SNOW_BETA_VERSION = 'storm-snow-beta-v3';
export const MATERIAL_CHANGE_THRESHOLDS = Object.freeze({
  rainAmountIn: 0.25,
  snowAmountIn: 0.5,
  probabilityPoints: 10,
  timingHours: 2,
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const iso = value => new Date(value).toISOString();
const round = (value, digits = 2) => finite(value) ? Number(value.toFixed(digits)) : null;
const dateKey = (value, zone) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
};
const nextDate = date => iso(Date.parse(`${date}T12:00:00Z`) + DAY).slice(0, 10);

function localMidnight(date, zone) {
  const target = Date.parse(`${date}T00:00:00Z`);
  let guess = target;
  for (let i = 0; i < 5; i += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const part = name => Number(parts.find(row => row.type === name)?.value);
    const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    const next = guess + target - wall;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

// The canonical forecast uses precipitation/pop/qpf; the V3 view model uses
// precipIn/rainChance/totalQpfIn. Both are accepted so history is never empty.
const hourAmount = row => finite(row?.precipIn) ? row.precipIn : finite(row?.precipitation) ? row.precipitation : null;
const hourChance = row => finite(row?.rainChance) ? row.rainChance : finite(row?.rainLikelihood?.value) ? row.rainLikelihood.value : finite(row?.pop) ? row.pop : null;
const dayAmount = day => finite(day?.totalQpfIn) ? day.totalQpfIn : finite(day?.qpf) ? day.qpf : null;
const dayChance = day => finite(day?.rainChance) ? day.rainChance : finite(day?.rainLikelihood?.value) ? day.rainLikelihood.value : finite(day?.pop) ? day.pop : null;

function forecastTiming(hours, zone, { snow = false } = {}) {
  const candidates = hours.filter(row => {
    const condition = String(row?.condition || '').toLowerCase();
    if (snow) return /snow|sleet|flurr|blizzard|freez|ice|wintry/.test(condition) || (finite(row?.snowfallIn) && row.snowfallIn >= 0.1);
    return (finite(hourChance(row)) && hourChance(row) >= 35) || (finite(hourAmount(row)) && hourAmount(row) >= 0.005) || /rain|shower|drizzle|storm|thunder/.test(condition);
  });
  if (!candidates.length) return { status: 'unavailable', onset: null, peak: null, end: null, windows: [] };
  const onset = Date.parse(candidates[0].time);
  const end = Date.parse(candidates.at(-1).time) + HOUR;
  const peakRow = candidates.reduce((best, row) => {
    const score = snow ? (Number(row.snowfallIn ?? row.snowfall) || 0) : Math.max(hourChance(row) || 0, (hourAmount(row) || 0) * 100);
    const bestScore = snow ? (Number(best?.snowfallIn ?? best?.snowfall) || 0) : Math.max(hourChance(best) || 0, (hourAmount(best) || 0) * 100);
    return score > bestScore ? row : best;
  }, candidates[0]);
  const peak = Date.parse(peakRow.time);
  return {
    status: 'available',
    onset: finite(onset) ? iso(onset) : null,
    peak: finite(peak) ? iso(peak) : null,
    end: finite(end) ? iso(end) : null,
    windows: [{ start: iso(onset), end: iso(end), label: `${new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(onset))}–${new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(end))}` }],
  };
}

function rainDaySnapshot(day, hours, start, end, index, zone) {
  const inWindow = hours.filter(row => {
    const time = Date.parse(row?.time);
    return finite(time) && time >= start && time < end;
  });
  const amounts = inWindow.map(hourAmount).filter(finite);
  const chances = inWindow.map(hourChance).filter(finite);
  const amount = amounts.length ? round(amounts.reduce((sum, value) => sum + value, 0), 3) : (index > 0 && finite(dayAmount(day)) ? round(dayAmount(day), 3) : null);
  const chance = chances.length ? Math.round(Math.max(...chances)) : (finite(dayChance(day)) ? Math.round(dayChance(day)) : null);
  return {
    amount,
    amountUnit: 'in liquid-equivalent precipitation',
    chance,
    chanceKind: 'occurrence',
    probabilitySource: chance === null ? null : 'Canonical Weather Nourie hourly rain-likelihood blend',
    timing: forecastTiming(inWindow, zone),
    confidence: day?.confidence ? {
      level: day.confidence.level || null,
      score: finite(day.confidence.score) ? day.confidence.score : null,
      spreadF: finite(day.confidence.spreadF) ? day.confidence.spreadF : null,
    } : null,
    supportHours: amounts.length,
    expectedHours: inWindow.length,
    // Hourly amounts let the client compare snapshots over the same remaining
    // window instead of mistaking rain that already fell for a downward trend.
    hours: inWindow.map(row => ({ time: iso(Date.parse(row.time)), amount: finite(hourAmount(row)) ? round(hourAmount(row), 3) : null })),
    range: null,
    quantiles: null,
    sourceWindow: { start: iso(start), end: iso(end) },
  };
}

function snowDaySnapshot(snowDay, start, end) {
  const display = snowDay?.displaySnowfall || {};
  const eventWindows = (snowDay?.snowEventWindows || []).map(row => ({
    start: row.start,
    end: row.end,
    source: row.source || 'Snow guidance',
  })).filter(row => Date.parse(row.end) > start && Date.parse(row.start) < end);
  return {
    amount: finite(display.value) ? round(display.value, 3) : null,
    amountUnit: 'in snowfall depth',
    amountSource: display.source || null,
    chance: finite(snowDay?.snowChance) ? Math.round(snowDay.snowChance) : null,
    chanceKind: 'peak hourly snow-type occurrence',
    probabilitySource: snowDay?.probabilitySource || null,
    timing: eventWindows.length ? {
      status: 'available',
      onset: eventWindows[0].start,
      peak: null,
      end: eventWindows.at(-1).end,
      windows: eventWindows,
    } : { status: 'unavailable', onset: null, peak: null, end: null, windows: [] },
    confidence: { level: snowDay?.confidence || null, score: null, spreadF: null },
    intervals: (snowDay?.nwsRawIntervals || []).filter(row => finite(row?.value) && finite(Date.parse(row?.start)) && finite(Date.parse(row?.end))).map(row => ({ start: row.start, end: row.end, value: round(row.value, 2) })),
    supportHours: finite(snowDay?.nwsCoveredHours) ? snowDay.nwsCoveredHours : null,
    expectedHours: finite(snowDay?.expectedHours) ? snowDay.expectedHours : null,
    range: Array.isArray(display.range) ? display.range.map(value => finite(value) ? round(value, 3) : null) : (Array.isArray(snowDay?.range) ? snowDay.range : null),
    quantiles: null,
    sourceWindow: { start: iso(start), end: iso(end) },
    type: {
      snow: snowDay?.snowExpected === true,
      freezingRain: snowDay?.freezingRainPossible === true,
      sleet: snowDay?.sleetPossible === true,
    },
  };
}

export function buildStormSnowSnapshot(forecast, now = Date.now()) {
  const location = forecast?.location || {};
  const latitude = Number(location.latitude), longitude = Number(location.longitude);
  if (!finite(latitude) || !finite(longitude)) return null;
  const zone = location.timeZone || forecast.timeZone || 'America/New_York';
  const assembledAt = Date.parse(forecast.assembledAt || '') || now;
  const hours = Array.isArray(forecast.hours) ? forecast.hours : [];
  const days = Array.isArray(forecast.days) ? forecast.days.slice(0, 5) : [];
  const snowDays = Array.isArray(forecast.snow?.days) ? forecast.snow.days : (Array.isArray(forecast.canonical?.snow?.days) ? forecast.canonical.snow.days : []);
  const rows = days.map((day, index) => {
    const date = day.dayKey || day.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
    const midnight = localMidnight(date, zone);
    const end = localMidnight(nextDate(date), zone);
    const start = index === 0 ? Math.max(midnight, assembledAt) : midnight;
    const rain = rainDaySnapshot(day, hours, start, end, index, zone);
    const snow = snowDaySnapshot(snowDays.find(row => row.date === date), start, end);
    return {
      date,
      index,
      label: day.dayName || day.shortWeekday || date,
      period: { start: iso(start), end: iso(end), localDate: date, timeZone: zone },
      rain,
      snow,
      eventSignature: [date, rain.amount, rain.chance, snow.amount, snow.chance].join('|'),
    };
  }).filter(Boolean);
  return Object.freeze({
    version: STORM_SNOW_BETA_VERSION,
    signature: String(forecast.signature || `${assembledAt}:${latitude}:${longitude}`),
    issuedAt: iso(assembledAt),
    retrievedAt: iso(now),
    location: Object.freeze({ name: location.name || 'Selected location', latitude: round(latitude, 4), longitude: round(longitude, 4), timeZone: zone }),
    source: Object.freeze({
      forecastVersion: forecast.version || forecast.canonical?.version || null,
      accuracyVersion: forecast.accuracyVersion || forecast.canonical?.accuracyVersion || null,
      snowVersion: forecast.snow?.version || forecast.canonical?.snow?.version || null,
      methodology: forecast.canonical?.methodology || forecast.methodology || null,
    }),
    days: Object.freeze(rows.map(row => Object.freeze(row))),
  });
}

function historyKey({ latitude, longitude, center, date }) {
  return `${Number(latitude).toFixed(2)}:${Number(longitude).toFixed(2)}:${center}:${date}`;
}

function validQuery(query = {}) {
  const latitude = Number(query.latitude ?? query.lat), longitude = Number(query.longitude ?? query.lon);
  const center = String(query.center || '').toLowerCase();
  const dates = String(query.dates || query.date || '').split(',').filter(Boolean);
  if (!finite(latitude) || !finite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || !['rain', 'snow'].includes(center) || !dates.length || dates.length > 7 || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    const error = new Error('A valid latitude, longitude, center and local forecast date are required.');
    error.status = 400;
    throw error;
  }
  return { latitude, longitude, center, date: dates[0], dates };
}

export function createStormSnowBetaService({ now = Date.now } = {}) {
  const histories = new Map();
  function recordForecast(forecast) {
    const snapshot = buildStormSnowSnapshot(forecast, now());
    if (!snapshot) return null;
    for (const row of snapshot.days) {
      for (const center of ['rain', 'snow']) {
        const key = historyKey({ latitude: snapshot.location.latitude, longitude: snapshot.location.longitude, center, date: row.date });
        const entry = { ...snapshot, center, day: row, days: undefined };
        const list = histories.get(key) || [];
        if (list.some(previous => previous.issuedAt === entry.issuedAt && previous.signature === entry.signature)) continue;
        // Forecasts reassemble every few minutes. Keeping only the newest record
        // per 30-minute bucket lets 48 records span a day of real revisions.
        const last = list.at(-1);
        if (last && Date.parse(entry.issuedAt) >= Date.parse(last.issuedAt) && Date.parse(entry.issuedAt) - Date.parse(last.issuedAt) < HISTORY_BUCKET_MS && list.length > 1) list.pop();
        // JSON cloning gives callers a detached immutable response while the
        // retained record remains untouched by route serialization.
        list.push(JSON.parse(JSON.stringify(entry)));
        list.sort((a, b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt));
        while (list.length > 48) list.shift();
        histories.set(key, list);
      }
    }
    if (histories.size > 2500) histories.delete(histories.keys().next().value);
    return snapshot;
  }
  function getHistory(query) {
    const input = validQuery(query);
    const list = date => (histories.get(historyKey({ ...input, date })) || []).map(row => ({
      version: row.version,
      center: row.center,
      issuedAt: row.issuedAt,
      retrievedAt: row.retrievedAt,
      signature: row.signature,
      location: row.location,
      source: row.source,
      day: row.day,
    }));
    // One request can cover every local date of a forecast period.
    const byDate = Object.fromEntries(input.dates.map(date => [date, list(date)]));
    return { version: STORM_SNOW_BETA_VERSION, key: historyKey(input), location: { latitude: input.latitude, longitude: input.longitude }, center: input.center, date: input.date, dates: input.dates, thresholds: MATERIAL_CHANGE_THRESHOLDS, snapshots: byDate[input.date], byDate };
  }
  return { recordForecast, getHistory, size: () => histories.size };
}

export function compareStormSnowSnapshots(previous, current, center) {
  const a = previous?.day?.[center], b = current?.day?.[center];
  if (!a || !b) return { status: 'unavailable', reason: 'Equivalent prior snapshot is unavailable.' };
  const amountDelta = finite(a.amount) && finite(b.amount) ? round(b.amount - a.amount, 3) : null;
  const probabilityDelta = finite(a.chance) && finite(b.chance) ? Math.round(b.chance - a.chance) : null;
  const aOnset = Date.parse(a.timing?.onset || ''), bOnset = Date.parse(b.timing?.onset || '');
  const timingDeltaHours = finite(aOnset) && finite(bOnset) ? round((bOnset - aOnset) / HOUR, 1) : null;
  const materialAmount = finite(amountDelta) && Math.abs(amountDelta) >= (center === 'snow' ? MATERIAL_CHANGE_THRESHOLDS.snowAmountIn : MATERIAL_CHANGE_THRESHOLDS.rainAmountIn);
  const materialProbability = finite(probabilityDelta) && Math.abs(probabilityDelta) >= MATERIAL_CHANGE_THRESHOLDS.probabilityPoints;
  const materialTiming = finite(timingDeltaHours) && Math.abs(timingDeltaHours) >= MATERIAL_CHANGE_THRESHOLDS.timingHours;
  return { status: 'available', amountDelta, probabilityDelta, timingDeltaHours, material: materialAmount || materialProbability || materialTiming, materialAmount, materialProbability, materialTiming };
}
