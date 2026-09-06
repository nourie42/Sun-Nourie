/** Shared sky classification. Missing reports never mean clear weather. */
const finite = value => typeof value === 'number' && Number.isFinite(value);
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
  const observed = weatherState(current?.condition, current?.skyCover);
  if (observed.known) return {...current, weather: observed,
    conditionSource: current.conditionSource || (current.type === 'observation' ? 'Station weather report' : 'Hourly forecast')};
  const hour = hours.find(row => { const t = Date.parse(row.time); return t <= now && now < t + 3600000; });
  const fallback = weatherState(hour?.condition, skyCover);
  if (fallback.known) return {...current, condition: weatherState(hour?.condition).known ? hour.condition : fallback.label, weather: fallback,
    conditionSource: hour && weatherState(hour.condition).known ? 'NWS current-hour forecast (sky only)' : 'NWS current-hour sky-cover forecast',
    conditionTime: hour?.time || new Date(now).toISOString()};
  return {...current, condition: 'Sky conditions unavailable', weather: weatherState(), conditionSource: 'Sky conditions unavailable'};
}
/** Legacy comparison helper; the primary UTCI engine separately retains diffuse
 * and reflected radiation even when the direct solar beam is blocked. */
export function weatherTransmission(condition, skyCover = null) {
  const state = weatherState(condition, skyCover);
  if (!state.known) return null;
  if (['rain','storm','snow','fog','cloudy'].includes(state.kind)) return 0;
  if (state.kind === 'partly-cloudy') return 0.66;
  return /mostly sunny|mostly clear|few clouds/i.test(condition || '') ? 0.86 : 1;
}
