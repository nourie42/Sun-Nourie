/** Shared sky classification. Missing reports never mean clear weather. */
const finite = value => typeof value === 'number' && Number.isFinite(value);
function matchingCurrentHour(hours = [], now = Date.now()) {
  return hours.find(row => { const time = Date.parse(row?.time); return finite(time) && time <= now && now < time + 3600000; }) || null;
}
function hourlyWindMph(value) {
  if (finite(value)) return value >= 0 ? value : null;
  const text = String(value || '').trim();
  if (/\bcalm\b/i.test(text)) return 0;
  const values = [...text.matchAll(/\d+(?:\.\d+)?/g)].map(match => Number(match[0])).filter(finite);
  return values.length ? values.reduce((sum, number) => sum + number, 0) / values.length : null;
}
function supplementObservedThermal(current, hour) {
  if (current?.type !== 'observation' || !hour) return current || {};
  const patch = {}, fields = [];
  const humidityOk = finite(current.humidity) && current.humidity >= 0 && current.humidity <= 100;
  const dewpointOk = finite(current.dewpoint) && (!finite(current.temperature) || current.dewpoint <= current.temperature + 1);
  if (!dewpointOk) {
    if (humidityOk) {
      if (finite(current.dewpoint)) patch.dewpoint = null;
    } else if (finite(hour.dewpoint)) {
      patch.dewpoint = hour.dewpoint;
      fields.push('dew point');
    } else if (finite(hour.humidity) && hour.humidity >= 0 && hour.humidity <= 100) {
      patch.dewpoint = null;
      patch.humidity = hour.humidity;
      fields.push('humidity');
    }
  }
  if (!finite(current.wind) || current.wind < 0) {
    const wind = hourlyWindMph(hour.wind);
    if (finite(wind)) { patch.wind = wind; fields.push('wind'); }
  }
  if (!fields.length && !Object.keys(patch).length) return current;
  return {...current, ...patch, ...(fields.length ? {
    thermalInputFallbackFields: fields,
    thermalInputFallbackSource: 'NWS current-hour forecast',
    thermalInputFallbackTime: hour.time,
  } : {})};
}
export function weatherState(condition = '', skyCover = null) {
  const text = String(condition || '').trim(), lower = text.toLowerCase();
  let kind = 'unknown', label = 'Sky conditions unavailable';
  if (/thunder|\btstm\b|\bstorm/.test(lower)) { kind = 'storm'; label = 'Thunderstorms'; }
  else if (/snow|sleet|flurr|ice pellets|freezing rain/.test(lower)) { kind = 'snow'; label = 'Snow or ice'; }
  else if (/rain|shower|drizzle/.test(lower)) { kind = 'rain'; label = 'Rain'; }
  else if (/fog|mist|haze|smoke|obscured/.test(lower)) { kind = 'fog'; label = 'Obscured sky'; }
  else if (/partly|scattered/.test(lower)) { kind = 'partly-cloudy'; label = 'Partly cloudy'; }
  else if (/mostly cloudy|overcast|\bcloudy\b|broken/.test(lower)) { kind = 'cloudy'; label = 'Cloudy'; }
  else if (/sunny|clear|\bfair\b|few clouds/.test(lower)) { kind = 'clear'; label = 'Clear'; }
  else if (finite(skyCover) && skyCover >= 0 && skyCover <= 100) {
    kind = skyCover <= 12 ? 'clear' : skyCover <= 62 ? 'partly-cloudy' : 'cloudy';
    label = kind === 'clear' ? 'Clear' : kind === 'partly-cloudy' ? 'Partly cloudy' : 'Cloudy';
  }
  return {kind, label, condition: text || label, known: kind !== 'unknown',
    chance: /chance|possible|isolated|scattered (?:showers|storms)/.test(lower)};
}
export function stationWeather(observation = {}) {
  const text = String(observation.textDescription || '').trim();
  if (weatherState(text).known) return {condition: text, conditionSource: 'Station weather report', conditionTime: observation.timestamp || null};
  const ranks = {CLR:0, SKC:0, NSC:0, NCD:0, FEW:1, SCT:2, BKN:3, OVC:4, VV:4};
  const layers = (Array.isArray(observation.cloudLayers) ? observation.cloudLayers : [])
    .map(layer => String(layer?.amount || '').toUpperCase()).filter(amount => Object.hasOwn(ranks, amount));
  if (layers.length) {
    const top = layers.reduce((a, b) => ranks[a] >= ranks[b] ? a : b);
    const labels = {CLR:'Clear', SKC:'Clear', NSC:'Clear', NCD:'Clear', FEW:'A Few Clouds', SCT:'Partly Cloudy', BKN:'Mostly Cloudy', OVC:'Overcast', VV:'Obscured Sky'};
    return {condition: labels[top], conditionSource: 'Station cloud-layer report', conditionTime: observation.timestamp || null};
  }
  return {condition: text, conditionSource: 'Station sky unavailable', conditionTime: observation.timestamp || null};
}
export function resolveCurrentWeather(current, hours = [], now = Date.now(), skyCover = null) {
  const hour = matchingCurrentHour(hours, now);
  const resolvedCurrent = supplementObservedThermal(current, hour);
  const observed = weatherState(resolvedCurrent?.condition, resolvedCurrent?.skyCover);
  if (observed.known) return {...resolvedCurrent, weather: observed,
    conditionSource: resolvedCurrent.conditionSource || (resolvedCurrent.type === 'observation' ? 'Station weather report' : 'Hourly forecast')};
  const fallback = weatherState(hour?.condition, skyCover);
  if (fallback.known) return {...resolvedCurrent, condition: weatherState(hour?.condition).known ? hour.condition : fallback.label, weather: fallback,
    conditionSource: hour && weatherState(hour.condition).known ? 'NWS current-hour forecast (sky only)' : 'NWS current-hour sky-cover forecast',
    conditionTime: hour?.time || new Date(now).toISOString()};
  return {...resolvedCurrent, condition: 'Sky conditions unavailable', weather: weatherState(), conditionSource: 'Sky conditions unavailable'};
}
/** This is an explicit radiation-estimation policy, not measured irradiance.
 * Do not claim direct sunshine in overcast/rain/fog. Those scenes use the
 * temperature/humidity/wind baseline; wet clothing and diffuse radiation are
 * not modelled. Partly-cloudy values represent estimated sunny breaks.
 */
export function weatherTransmission(condition, skyCover = null) {
  const state = weatherState(condition, skyCover);
  if (!state.known) return null;
  if (['rain','storm','snow','fog','cloudy'].includes(state.kind)) return 0;
  if (state.kind === 'partly-cloudy') return 0.66;
  return /mostly sunny|mostly clear|few clouds/i.test(condition || '') ? 0.86 : 1;
}
