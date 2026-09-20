/** Perfect-weather and storm-window classification for /whats-up.
 * Numeric rules stay deterministic. Rain chance prefers Weather Fusion
 * rainLikelihood (same NWS + model-QPF scoring as Weather Nourie) and
 * falls back to official NWS PoP when fusion is missing.
 */
import { finite } from '../public/weather-fusion/weather-math.js';
import {
  PERFECT_TEMP_IDEAL_F,
  PERFECT_TEMP_BAND_F,
  RULE_B_TEMP_F,
  CALM_WIND_MAX_MPH,
  BREEZY_WIND_F,
  DEWPOINT_MAX_EXCLUSIVE_F,
  STORM_ELEVATED_MIN,
  STORM_DEFINITE_MIN,
  toFahrenheit,
  periodTemperature,
  periodPop,
  parseWindMph,
  skyAllowsPerfect,
  stormLevel,
  hourRainChance,
  classifyHour,
  normalizeNwsHour,
} from '../public/weather-fusion/whats-up-classify.js';

export const TRACKER_VERSION = 'whats-up-tracker-v1';
export {
  PERFECT_TEMP_IDEAL_F,
  PERFECT_TEMP_BAND_F,
  RULE_B_TEMP_F,
  CALM_WIND_MAX_MPH,
  BREEZY_WIND_F,
  DEWPOINT_MAX_EXCLUSIVE_F,
  STORM_ELEVATED_MIN,
  STORM_DEFINITE_MIN,
  toFahrenheit,
  periodTemperature,
  periodPop,
  parseWindMph,
  skyAllowsPerfect,
  stormLevel,
  hourRainChance,
  classifyHour,
  normalizeNwsHour,
};

export const ASSUMPTIONS = Object.freeze({
  title: 'How hours are classified',
  perfectA: 'Rule A — 72°F feel: sky sunny or only some clouds (clear, fair, mostly sunny, few clouds, partly cloudy). Temperature 70–74°F (band around the stated 72°F). Wind calm or very light (≤ 7 mph). Dewpoint below 60°F.',
  perfectB: 'Rule B — warm and breezy: temperature 70–82°F, wind breezy (8–18 mph), and sky sunny or partly cloudy. Dewpoint is not required for Rule B.',
  storm: 'Storm timing uses the Weather Nourie rain-likelihood score when that hour is available (same fusion as the experimental Weather Fusion page: NWS hourly PoP plus same-day model QPF points). Otherwise the official NWS hourly or period probability of precipitation is used. ≥ 75% is stormy / elevated. 90–100% is definitely stormy.',
  exclusions: 'An hour cannot be perfect if rain chance is already storm-level, the sky is overcast/rainy/foggy, a required reading is missing, or wind is stronger than a breeze. Period forecasts never invent perfect hours.',
  sources: 'Place: U.S. Census TIGERweb ZIP Code Tabulation Area (ZCTA) centroid, with a public ZIP fallback if Census is down. Forecast: api.weather.gov points, hourly, and period forecasts. Rain fusion is computed by the existing Weather Fusion service when that feed is ready.',
});

export function trackerError(message, status = 502, code = 'source') {
  return Object.assign(new Error(message), { status, code });
}

export function normalizeZip(value) {
  const digits = String(value || '').trim().match(/^(\d{5})(?:-\d{4})?$/);
  return digits ? digits[1] : null;
}

export function dateKey(ms, zone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function weekdayLabel(ms, zone, todayKey) {
  const key = dateKey(ms, zone);
  if (key === todayKey) return 'Today';
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(new Date(ms));
}

export function formatClock(ms, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: 'numeric', minute: 'numeric', hour12: true,
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const minute = get('minute');
  const hour = get('hour');
  const dayPeriod = (get('dayPeriod') || '').toLowerCase().replace(/\./g, '');
  return minute === '00' ? `${hour}${dayPeriod}` : `${hour}:${minute}${dayPeriod}`;
}

export function formatWindowLabel(start, end, zone) {
  return `${formatClock(start, zone)}–${formatClock(end, zone)}`;
}

export function rangeText(min, max, suffix = '') {
  if (!finite(min) && !finite(max)) return '';
  if (!finite(max) || min === max) return `${finite(min) ? min : max}${suffix}`;
  return `${min}–${max}${suffix}`;
}

export function groupRuns(items, predicate) {
  const runs = [];
  let current = [];
  for (const item of items) {
    if (predicate(item)) current.push(item);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

function rangeOf(hours, key) {
  const values = hours.map((hour) => hour[key]).filter(finite);
  if (!values.length) return { min: null, max: null };
  return { min: Math.round(Math.min(...values)), max: Math.round(Math.max(...values)) };
}

export function windowWeather(hours = []) {
  const temperature = rangeOf(hours, 'temperature');
  const dewpoint = rangeOf(hours, 'dewpoint');
  const wind = rangeOf(hours, 'windMph');
  const rain = rangeOf(hours, 'rainChance');
  const mid = hours[Math.floor(hours.length / 2)] || hours[0] || {};
  return {
    temperatureMin: temperature.min,
    temperatureMax: temperature.max,
    dewpointMin: dewpoint.min,
    dewpointMax: dewpoint.max,
    windMin: wind.min,
    windMax: wind.max,
    rainMin: rain.min,
    rainMax: rain.max,
    rainPeak: rain.max,
    condition: mid.condition || mid.sky || '',
    sky: mid.sky?.label || mid.sky || '',
    isDay: hours.some((hour) => hour.isDay),
  };
}

function windowFromHours(hours, zone, extra = {}) {
  const start = Date.parse(hours[0].time);
  const last = hours[hours.length - 1];
  const end = finite(Date.parse(last.end)) ? Date.parse(last.end) : start + hours.length * 3600000;
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    label: formatWindowLabel(start, end, zone),
    hourCount: hours.length,
    ...windowWeather(hours),
    ...extra,
  };
}

export function fusionHourIndex(forecast) {
  const map = new Map();
  for (const hour of forecast?.hours || []) {
    const time = Date.parse(hour.time);
    if (Number.isFinite(time)) map.set(time, hour);
  }
  for (const row of forecast?.rainTimeline || []) {
    const time = Date.parse(row.time);
    if (!Number.isFinite(time)) continue;
    const existing = map.get(time) || {};
    map.set(time, {
      ...existing,
      rainLikelihood: row.rainLikelihood || existing.rainLikelihood,
      officialPop: finite(row.officialPop) ? row.officialPop : existing.officialPop,
      pop: finite(row.officialPop) ? row.officialPop : existing.pop,
    });
  }
  return map;
}

function summarizeDayHours(hours, zone) {
  const temps = hours.map((hour) => hour.temperature).filter(finite);
  const perfectWindows = groupRuns(hours, (hour) => hour.perfect).map((run) => windowFromHours(run, zone, {
    kind: 'perfect',
    hours: run.map((hour) => hour.label),
  }));
  const stormWindows = groupRuns(hours, (hour) => hour.storm).map((run) => windowFromHours(run, zone, {
    kind: 'storm',
    level: run.some((hour) => hour.storm === 'definite') ? 'definite' : 'elevated',
    peakChance: Math.max(...run.map((hour) => hour.rainChance).filter(finite)),
    hours: run.map((hour) => hour.label),
  }));
  return {
    high: temps.length ? Math.max(...temps) : null,
    low: temps.length ? Math.min(...temps) : null,
    perfectWindows,
    stormWindows,
  };
}

export function buildTrackerView({
  zip, place, hourlyPeriods = [], periodForecasts = [], fusion = null, now = Date.now(),
}) {
  const zone = place.timeZone || fusion?.location?.timeZone || 'America/New_York';
  const today = dateKey(now, zone);
  const fusionHours = fusionHourIndex(fusion);
  const classified = hourlyPeriods
    .filter((period) => Date.parse(period.endTime || period.startTime) > now - 3600000)
    .map((period) => {
      const raw = normalizeNwsHour(period, fusionHours.get(Date.parse(period.startTime)));
      const info = classifyHour(raw);
      const start = Date.parse(raw.time);
      return {
        ...raw,
        ...info,
        label: formatClock(start, zone),
        date: dateKey(start, zone),
      };
    })
    .filter((hour) => Date.parse(hour.end || hour.time) > now);

  const rainFusionReady = classified.some((hour) => hour.rainSource === 'Weather Nourie rain likelihood');
  const days = [];
  const byDate = new Map();
  for (const hour of classified) {
    if (!byDate.has(hour.date)) byDate.set(hour.date, []);
    byDate.get(hour.date).push(hour);
  }

  const periodByDate = new Map();
  for (const period of periodForecasts) {
    const start = Date.parse(period.startTime);
    if (!Number.isFinite(start)) continue;
    const key = dateKey(start, zone);
    if (!periodByDate.has(key)) periodByDate.set(key, []);
    periodByDate.get(key).push(period);
  }

  const dates = [...new Set([...byDate.keys(), ...periodByDate.keys()])].sort();
  for (const date of dates) {
    const hours = byDate.get(date) || [];
    const periods = periodByDate.get(date) || [];
    const dayPeriod = periods.find((period) => period.isDaytime) || periods[0];
    const nightPeriod = periods.find((period) => !period.isDaytime);
    const fromHours = summarizeDayHours(hours, zone);
    const high = periodTemperature(dayPeriod) ?? fromHours.high;
    const low = periodTemperature(nightPeriod) ?? fromHours.low;
    const stormWindows = [...fromHours.stormWindows];
    if (!hours.length) {
      for (const period of periods) {
        const chance = periodPop(period);
        const level = stormLevel(chance);
        if (!level) continue;
        const start = Date.parse(period.startTime);
        const end = Date.parse(period.endTime);
        stormWindows.push({
          start: period.startTime,
          end: period.endTime,
          label: period.name || formatWindowLabel(start, end, zone),
          hourCount: 0,
          kind: 'storm',
          level,
          peakChance: chance,
          rainPeak: chance,
          rainMin: chance,
          rainMax: chance,
          condition: String(period.shortForecast || '').trim(),
          hours: [],
          source: 'NWS period forecast',
        });
      }
    }
    const noon = Date.parse(`${date}T16:00:00Z`);
    days.push({
      date,
      label: weekdayLabel(noon, zone, today),
      high: finite(high) ? Math.round(high) : null,
      low: finite(low) ? Math.round(low) : null,
      condition: String(dayPeriod?.shortForecast || nightPeriod?.shortForecast || hours[0]?.condition || 'Forecast unavailable').trim(),
      detail: String(dayPeriod?.detailedForecast || nightPeriod?.detailedForecast || '').trim(),
      perfectWindows: fromHours.perfectWindows,
      stormWindows,
      hours: hours.map((hour) => ({
        time: hour.time,
        end: hour.end,
        label: hour.label,
        temperature: hour.temperature,
        dewpoint: hour.dewpoint,
        windMph: hour.windMph,
        wind: hour.wind,
        condition: hour.condition,
        sky: hour.sky.label,
        rainChance: hour.rainChance,
        rainSource: hour.rainSource,
        isDay: hour.isDay,
        perfect: Boolean(hour.perfect),
        storm: hour.storm,
      })),
    });
  }

  const upcomingHours = classified.filter((hour) => Date.parse(hour.time) >= now - 30 * 60000);
  const nextPerfectRun = groupRuns(upcomingHours, (hour) => hour.perfect)[0] || null;
  const nextStormRun = groupRuns(upcomingHours, (hour) => hour.storm)[0] || null;
  const nextPerfect = nextPerfectRun ? windowFromHours(nextPerfectRun, zone, {
    kind: 'perfect',
    dayLabel: weekdayLabel(Date.parse(nextPerfectRun[0].time), zone, today),
  }) : null;
  const nextStorm = nextStormRun ? windowFromHours(nextStormRun, zone, {
    kind: 'storm',
    level: nextStormRun.some((hour) => hour.storm === 'definite') ? 'definite' : 'elevated',
    peakChance: Math.max(...nextStormRun.map((hour) => hour.rainChance).filter(finite)),
    dayLabel: weekdayLabel(Date.parse(nextStormRun[0].time), zone, today),
  }) : null;

  const nwsReady = classified.length > 0 || periodForecasts.length > 0;
  const headline = nextPerfect
    ? `${nextPerfect.dayLabel} ${nextPerfect.label}`
    : nextStorm
      ? `${nextStorm.dayLabel} ${nextStorm.label}`
      : nwsReady
        ? 'No perfect weather or high rain chance in the hourly forecast'
        : 'Forecast is not available';
  const detail = nextPerfect
    ? [rangeText(nextPerfect.temperatureMin, nextPerfect.temperatureMax, '°'), nextPerfect.condition].filter(Boolean).join(' · ')
    : nextStorm
      ? `${nextStorm.rainPeak ?? nextStorm.peakChance}% rain chance · ${nextStorm.condition || 'wet weather'}`
      : '';

  return {
    version: TRACKER_VERSION,
    assembledAt: new Date(now).toISOString(),
    zip,
    place: {
      zip,
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      timeZone: zone,
      office: place.office || fusion?.location?.office || null,
      geocodeSource: place.source,
    },
    status: {
      nws: nwsReady ? 'ready' : 'unavailable',
      rainFusion: rainFusionReady ? 'ready' : 'unavailable',
      geocode: 'ready',
      message: nwsReady
        ? (rainFusionReady
          ? 'NWS forecast ready. Storm timing uses Weather Nourie rain likelihood where the fusion hour exists.'
          : 'NWS forecast ready. Storm timing uses official NWS precipitation probability because rain fusion was unavailable.')
        : 'The National Weather Service forecast is unavailable.',
    },
    summary: { headline, detail, nextPerfect, nextStorm },
    days,
    sources: [
      { id: 'geocode', label: place.source || 'ZIP geocoder', status: 'ready' },
      { id: 'nws', label: 'NWS points / hourly / period forecast', status: nwsReady ? 'ready' : 'unavailable' },
      { id: 'rain-fusion', label: 'Weather Nourie rain likelihood', status: rainFusionReady ? 'ready' : 'unavailable' },
    ],
  };
}
