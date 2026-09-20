/** Shared perfect-hour and storm-level rules for the tracker and weather banners. */
import { weatherState } from './weather-state.js';
import { finite, rainChanceValue } from './weather-math.js';

export const PERFECT_TEMP_IDEAL_F = 72;
export const PERFECT_TEMP_BAND_F = Object.freeze({ min: 70, max: 74 });
export const RULE_B_TEMP_F = Object.freeze({ min: 70, max: 82 });
export const CALM_WIND_MAX_MPH = 7;
export const BREEZY_WIND_F = Object.freeze({ min: 8, max: 18 });
export const DEWPOINT_MAX_EXCLUSIVE_F = 60;
export const STORM_ELEVATED_MIN = 75;
export const STORM_DEFINITE_MIN = 90;

export function toFahrenheit(quantity) {
  if (finite(quantity)) return quantity;
  if (!finite(quantity?.value)) return null;
  if (quantity.unitCode === 'wmoUnit:degF') return quantity.value;
  if (quantity.unitCode === 'wmoUnit:degC') return quantity.value * 1.8 + 32;
  return null;
}

export function periodTemperature(period) {
  if (!finite(period?.temperature)) return null;
  if (period.temperatureUnit === 'C') return period.temperature * 1.8 + 32;
  if (period.temperatureUnit === 'F' || !period.temperatureUnit) return period.temperature;
  return null;
}

export function periodPop(period) {
  const value = period?.probabilityOfPrecipitation?.value ?? period?.pop;
  return finite(value) && value >= 0 && value <= 100 ? value : null;
}

export function parseWindMph(value) {
  if (finite(value) && value >= 0) return { min: value, max: value, typical: value };
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'calm' || text === '0 mph') return { min: 0, max: 0, typical: 0 };
  const nums = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1])).filter((n) => finite(n) && n >= 0);
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max, typical: (min + max) / 2 };
}

export function skyAllowsPerfect(condition, skyCover = null) {
  const state = weatherState(condition, skyCover);
  return state.kind === 'clear' || state.kind === 'partly-cloudy' ? state : null;
}

export function stormLevel(chance) {
  if (!finite(chance)) return null;
  if (chance >= STORM_DEFINITE_MIN) return 'definite';
  if (chance >= STORM_ELEVATED_MIN) return 'elevated';
  return null;
}

export function hourRainChance(hour = {}) {
  const fused = rainChanceValue(hour.rainLikelihood);
  const official = finite(hour.officialPop) ? hour.officialPop : finite(hour.pop) ? hour.pop : null;
  if (finite(fused)) {
    return {
      value: fused,
      official,
      source: 'Weather Nourie rain likelihood',
      detail: hour.rainLikelihood?.source || 'NWS hourly probability plus same-day model QPF points',
    };
  }
  if (finite(official)) {
    return { value: official, official, source: 'NWS probability of precipitation', detail: 'Official NWS PoP; rain fusion was not available for this hour' };
  }
  return { value: null, official: null, source: 'unavailable', detail: 'No usable rain probability for this hour' };
}

export function normalizeNwsHour(period, fusionHour = null) {
  const officialPop = periodPop(period);
  return {
    time: period.startTime,
    end: period.endTime,
    temperature: periodTemperature(period),
    dewpoint: toFahrenheit(period.dewpoint),
    wind: period.windSpeed,
    windDirection: period.windDirection,
    humidity: finite(period.relativeHumidity?.value) ? period.relativeHumidity.value : null,
    condition: String(period.shortForecast || '').trim(),
    isDay: !!period.isDaytime,
    officialPop,
    pop: officialPop,
    skyCover: finite(fusionHour?.skyCover) ? fusionHour.skyCover : null,
    rainLikelihood: fusionHour?.rainLikelihood || null,
  };
}

export function classifyHour(hour = {}) {
  const sky = weatherState(hour.condition, hour.skyCover);
  const temperature = finite(hour.temperature) ? hour.temperature : periodTemperature(hour);
  const dewpoint = toFahrenheit(hour.dewpoint);
  const wind = parseWindMph(hour.wind ?? hour.windSpeed);
  const rain = hourRainChance(hour);
  const storm = stormLevel(rain.value);
  const goodSky = sky.kind === 'clear' || sky.kind === 'partly-cloudy';
  let perfect = null;
  if (!storm && goodSky && finite(temperature) && wind) {
    const calm = wind.typical <= CALM_WIND_MAX_MPH;
    const breezy = wind.typical >= BREEZY_WIND_F.min && wind.typical <= BREEZY_WIND_F.max;
    const dewOk = finite(dewpoint) && dewpoint < DEWPOINT_MAX_EXCLUSIVE_F;
    if (temperature >= PERFECT_TEMP_BAND_F.min && temperature <= PERFECT_TEMP_BAND_F.max && calm && dewOk) {
      perfect = 'A';
    } else if (temperature >= RULE_B_TEMP_F.min && temperature <= RULE_B_TEMP_F.max && breezy) {
      perfect = 'B';
    }
  }
  return {
    sky,
    temperature: finite(temperature) ? Math.round(temperature) : null,
    dewpoint: finite(dewpoint) ? Math.round(dewpoint) : null,
    windMph: wind ? Number(wind.typical.toFixed(1)) : null,
    rainChance: rain.value,
    rainOfficial: rain.official,
    rainSource: rain.source,
    rainDetail: rain.detail,
    storm,
    perfect,
  };
}
