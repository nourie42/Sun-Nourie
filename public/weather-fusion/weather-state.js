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
/** Keep thunder tied to forecast wording while letting dominant rain replace dry-only artwork. */
export const THUNDER_DISPLAY_CHANCE = null;
export const RAIN_DOMINANT_CHANCE = 70;
export function conditionForRainChance(condition = '', chance = null, skyCover = null) {
  const state=weatherState(condition,skyCover);
  // A dominant rain score must not retain sunny, fog-only, or generic-cloud
  // artwork. Preserve explicit thunder and frozen-precipitation wording so
  // lightning and snow still come only from the displayed condition itself.
  if(finite(chance)&&chance>=RAIN_DOMINANT_CHANCE&&!['rain','storm','snow'].includes(state.kind))return 'Rain';
  return condition||state.label;
}
const PRECIPITATION_NAMES = {
  RA:'Rain', DZ:'Drizzle', SN:'Snow', SG:'Snow grains', IC:'Ice crystals',
  PL:'Sleet', GR:'Hail showers', GS:'Snow pellets', UP:'Unidentified precipitation'
};
const PRESENT_PRECIPITATION = {
  rain:'RA', drizzle:'DZ', snow:'SN', 'snow grains':'SG', 'ice crystals':'IC',
  'ice pellets':'PL', sleet:'PL', hail:'GR', 'small hail':'GS',
  'snow pellets':'GS', 'small hail snow pellets':'GS', 'unknown precipitation':'UP'
};
const intensityName = value => /^(?:very[ _-])?light$/i.test(value || '') ? 'Light '
  : /^(?:very[ _-])?heavy$/i.test(value || '') ? 'Heavy ' : '';
function precipitationLabel(codes, descriptor='', intensity='') {
  const phases=[...new Set(codes)].filter(code=>Object.hasOwn(PRECIPITATION_NAMES,code));
  if(!phases.length)return null;
  let label=phases.map(code=>PRECIPITATION_NAMES[code]).join(' and ');
  if(descriptor==='FZ'&&phases.some(code=>['RA','DZ'].includes(code)))label=`Freezing ${label.toLowerCase()}`;
  else if(descriptor==='SH')label=/showers/i.test(label)?label:`${label} showers`;
  else if(descriptor==='TS')label=`Thunderstorms with ${label.toLowerCase()}`;
  return intensity+label;
}
/** Only a complete, current METAR weather group is evidence of precipitation.
 * Recent weather (RE...), vicinity weather (VC...), remarks and trend forecasts
 * do not establish precipitation at the reporting station now. */
function metarPrecipitation(token='') {
  const match=String(token).toUpperCase().match(/^([+-])?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)){1,3})$/);
  if(!match)return null;
  // Blowing/drifting snow describes windblown particles, not falling snow.
  if(['BL','DR'].includes(match[2]))return null;
  return precipitationLabel(match[3].match(/.{2}/g)||[],match[2],match[1]==='-'?'Light ':match[1]==='+'?'Heavy ':'');
}
function stationPrecipitation(observation) {
  const structured=(Array.isArray(observation.presentWeather)?observation.presentWeather:[]).flatMap(report=>{
    if(!report||typeof report!=='object'||report.inVicinity===true)return [];
    const raw=String(report.rawString||'').trim().toUpperCase();
    if(/^[+-]?(?:VC|RE)/.test(raw)||/\b(?:RMK|TEMPO|BECMG|NOSIG)\b/.test(raw))return [];
    const coded=metarPrecipitation(raw);
    if(coded)return [coded];
    const normalize=value=>String(value||'').trim().toLowerCase().replace(/[_-]+/g,' ');
    const phase=PRESENT_PRECIPITATION[normalize(report.weather)],modifier=normalize(report.modifier);
    if(!phase||['blowing','drifting'].includes(modifier))return [];
    const descriptor=modifier==='freezing'?'FZ':/^(?:thunderstorm|thunderstorms)$/.test(modifier)?'TS':/^(?:shower|showers)$/.test(modifier)?'SH':'';
    return [precipitationLabel([phase],descriptor,intensityName(report.intensity))];
  });
  if(structured.length)return {condition:[...new Set(structured)].join(' and '),conditionSource:'Station present-weather report'};
  const main=String(observation.rawMessage||'').split('=')[0].split(/\b(?:RMK|TEMPO|BECMG|NOSIG|PROB\d{2}|FM\d{6})\b/i)[0];
  const reported=main.split(/\s+/).map(metarPrecipitation).filter(Boolean);
  return reported.length?{condition:[...new Set(reported)].join(' and '),conditionSource:'Station METAR weather report'}:null;
}
export function stationWeather(observation = {}) {
  const text = String(observation.textDescription || '').trim();
  const state=weatherState(text),precipitation=stationPrecipitation(observation);
  if(precipitation&&!['rain','storm','snow'].includes(state.kind))return {...precipitation,conditionTime:observation.timestamp||null};
  if (state.known) return {condition: text, conditionSource: 'Station weather report', conditionTime: observation.timestamp || null};
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
