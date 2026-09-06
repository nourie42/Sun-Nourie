import {finite} from './weather-math.js';
export const OUTDOOR_FEELS_VERSION = 'weather-nourie-outdoor-v1';
/** One exposure contract for every primary feels-like reading. The existing
 * thermal model is unchanged; shade is a separately named comparison, never
 * silently substituted for a valid outdoor result. Explicit missing stays missing.
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
