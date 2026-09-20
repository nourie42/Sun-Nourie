/** Purple perfect-weather and red storm banners from the live Weather Nourie forecast. */
import { classifyHour } from './whats-up-classify.js';

const HOUR = 3600000;

export function bannerStateFromForecast(forecast, now = Date.now()) {
  const hours = Array.isArray(forecast?.hours) ? forecast.hours : [];
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
