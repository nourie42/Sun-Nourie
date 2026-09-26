import {finite} from './weather-math.js?v=weather-qa-v67';
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

/** Air temperature plus the modeled radiant difference between sun and shade.
 * This is a sun-exposure display estimate, not a thermometer reading or UTCI.
 */
export function sunExposureTemperature(sample = {}) {
  const air=sample.temperature,comfort=sample.comfort||{};
  const active=comfort.daylight===true&&['clear','partly-cloudy'].includes(comfort.weatherKind);
  const shade=comfort.rawShade,sun=comfort.rawOutdoors;
  if(!active||!finite(air)||!finite(shade)||!finite(sun))return {active:false,value:null,solarLift:null};
  const solarLift=Math.max(0,sun-shade);
  return {active:true,value:air+solarLift,solarLift};
}
