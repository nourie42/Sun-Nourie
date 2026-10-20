import {finite} from './weather-math.js?v=current-rain-20261017-v3';
export const OUTDOOR_FEELS_VERSION = 'weather-nourie-outdoor-v3';
/** One exposure contract for every primary feels-like reading. Direct-sun
 * values use the shared standing-person solar projection; shade is a separately
 * named comparison, never silently substituted for a valid outdoor result.
 * Explicit missing stays missing.
 */
export function outdoorExposure(comfort = {}) {
  const day = comfort.daylight;
  const kind = comfort.weatherKind || 'unknown';
  const condition = comfort.condition || '';
  const chance = /chance|possible|isolated|scattered (?:showers|storms)/i.test(condition);
  const labels = {
    clear:['In direct sun','In sun'],
    'partly-cloudy':['During sunny breaks','Sunny breaks'],
    cloudy:['Under clouds','Under clouds'],
    rain:chance?['Rain possible','Rain possible']:['In rainy weather','In rain'],
    storm:chance?['Storms possible','Storms possible']:['In stormy weather','In storms'],
    snow:['In snowy weather','In snow'], fog:['In fog or haze','In fog'],
    unknown:['Outdoors · shade estimate only','Shade estimate']
  };
  const [label,shortLabel] = day === false ? ['Outdoors at night','At night'] : (labels[kind] || labels.unknown);
  const candidate = Object.hasOwn(comfort,'outdoors') ? comfort.outdoors
    : day && ['clear','partly-cloudy'].includes(kind) && finite(comfort.sun) ? comfort.sun : comfort.shade;
  return {value:finite(candidate)?candidate:null,label,shortLabel,basis:'outdoors'};
}

/** The canonical outdoor feels-like value during a sunny forecast hour.
 * Kept as a named sunny-exposure selector for callers: do not add radiant lift
 * to air temperature, which creates a second, incompatible feels-like scale.
 */
export function sunExposureTemperature(sample = {}) {
  const comfort=sample.comfort||{};
  const active=comfort.daylight===true&&['clear','partly-cloudy'].includes(comfort.weatherKind);
  const outdoors=outdoorExposure(comfort).value;
  if(!active||!finite(outdoors))return {active:false,value:null,solarLift:null};
  const solarLift=finite(comfort.shade)?Math.max(0,outdoors-comfort.shade):null;
  return {active:true,value:outdoors,solarLift};
}
