/** Purple perfect-weather and red storm banners from the same rules as /whats-up. */
import { classifyHour, normalizeNwsHour } from './whats-up-classify.js';

const HOUR = 3600000;

function fusionHourIndex(forecast) {
  const map = new Map();
  for (const hour of forecast?.hours || []) {
    const time = Date.parse(hour.time);
    if (Number.isFinite(time)) map.set(time, hour);
  }
  return map;
}

export function bannerStateFromHours(hours = [], now = Date.now()) {
  let perfect = false;
  let storm = false;
  for (const hour of hours) {
    const start = Date.parse(hour.time);
    if (!Number.isFinite(start) || start + HOUR <= now) continue;
    const classified = classifyHour(hour);
    if (classified.perfect) perfect = true;
    if (classified.storm) storm = true;
    if (perfect && storm) break;
  }
  return { perfect, storm };
}

export function bannerStateFromNwsPeriods(periods = [], fusion = null, now = Date.now()) {
  const index = fusionHourIndex(fusion);
  let perfect = false;
  let storm = false;
  for (const period of periods) {
    const end = Date.parse(period.endTime || period.startTime);
    if (!Number.isFinite(end) || end <= now) continue;
    const classified = classifyHour(normalizeNwsHour(period, index.get(Date.parse(period.startTime))));
    if (classified.perfect) perfect = true;
    if (classified.storm) storm = true;
    if (perfect && storm) break;
  }
  return { perfect, storm };
}

export function bannerStateFromForecast(forecast, now = Date.now()) {
  const fromHours = bannerStateFromHours(forecast?.hours, now);
  const fromPeriods = bannerStateFromNwsPeriods(forecast?.hourlyPeriods, forecast, now);
  const flags = forecast?.alertBanners;
  return {
    perfect: !!(flags?.perfect || fromHours.perfect || fromPeriods.perfect),
    storm: !!(flags?.storm || fromHours.storm || fromPeriods.storm),
  };
}

export function updateAlertBanners(forecast, now = Date.now(), root = typeof document === 'undefined' ? null : document) {
  const state = bannerStateFromForecast(forecast, now);
  const stack = root?.getElementById('weather-alert-banners');
  const perfectEl = root?.getElementById('perfect-weather-banner');
  const stormEl = root?.getElementById('storm-weather-banner');
  if (perfectEl) perfectEl.hidden = !state.perfect;
  if (stormEl) stormEl.hidden = !state.storm;
  if (stack) stack.hidden = !state.perfect && !state.storm;
  return state;
}
