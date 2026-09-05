/* Pure presentation math shared by the weather API, browser and tests. */
export const EXPERIENCE_VERSION = 'weather-nourie-friendly-v1';
export const finite = n => typeof n === 'number' && Number.isFinite(n);
const fToC = f => (f - 32) / 1.8;
const cToF = c => c * 1.8 + 32;
const sat = t => 6.112 * Math.exp(17.67 * t / (t + 243.5));
export function localHour(time, zone = 'America/New_York') {
  return Number(new Intl.DateTimeFormat('en-US', {timeZone:zone, hour:'numeric', hourCycle:'h23'}).format(new Date(time)));
}
export function dailyDisplay(day, index, now, zone) {
  const tonight = index === 0 && localHour(now, zone) >= 15;
  return {tonight, label:tonight?'Tonight':index===0?'Today':day.label,
    primary:tonight?day.low:day.high, secondary:tonight?null:day.low,
    primaryLabel:tonight?'Low':'High', condition:tonight?(day.nightCondition||day.condition):day.condition,
    detail:tonight?(day.nightDetail||day.detail):day.detail,
    pop:tonight?day.popNight:day.pop};
}
export function temperatureBar(value, floor, ceiling) {
  if (![value,floor,ceiling].every(finite)) return null;
  return Math.min(100,Math.max(0,(value-floor)/Math.max(1,ceiling-floor)*100));
}
export function humidityFromDewpoint(temp, dewpoint) {
  return finite(temp)&&finite(dewpoint)&&dewpoint<=temp+1 ? Math.min(100,Math.max(0,100*sat(fToC(dewpoint))/sat(fToC(temp)))) : null;
}
export function vaporPressureFromDewpoint(temp, dewpoint, rh) {
  if (finite(dewpoint) && (!finite(temp) || dewpoint <= temp + 1)) return sat(fToC(dewpoint));
  if (finite(temp) && finite(rh) && rh >= 0 && rh <= 100) return sat(fToC(temp)) * rh / 100;
  return null;
}
function nwsHeatIndex(t, humidity) {
  const simple=.5*(t+61+1.2*(t-68)+.094*humidity);
  if((simple+t)/2<80)return null;
  let hi=-42.379+2.04901523*t+10.14333127*humidity-.22475541*t*humidity-.00683783*t*t-.05481717*humidity**2+.00122874*t*t*humidity+.00085282*t*humidity**2-.00000199*t*t*humidity**2;
  if(humidity<13&&t>=80&&t<=112)hi-=(13-humidity)/4*Math.sqrt(Math.max(0,(17-Math.abs(t-95))/17));
  else if(humidity>85&&t>=80&&t<=87)hi+=(humidity-85)/10*(87-t)/5;
  return hi;
}
/**
 * Physiologic shade apparent temperature.
 * Cold: NWS wind chill. Hot: NWS heat index when applicable.
 * Otherwise: Steadman/BOM apparent temperature using vapor pressure and wind.
 * Dew point is preferred for vapor pressure, so drier air lowers the estimate naturally.
 */
export function shadeFeelsLike(t, rh, wind, dewpoint) {
  if (!finite(t)) return {value:null,method:'Missing air temperature'};
  const humidity=finite(rh)&&rh>=0&&rh<=100?rh:humidityFromDewpoint(t,dewpoint);
  if(t<=50) {
    if(!finite(wind)||wind<0)return {value:null,method:'Missing wind for cold-weather calculation'};
    return wind>3?{value:35.74+.6215*t-35.75*wind**.16+.4275*t*wind**.16,method:'NWS wind chill'}:{value:t,method:'Air temperature; wind chill not applicable'};
  }
  if(t>=80 && finite(humidity)) {
    const hi=nwsHeatIndex(t,humidity);
    if(finite(hi))return {value:hi,method:'NWS heat index (shade)'};
  }
  if(!finite(wind)||wind<0)return {value:null,method:'Wind unavailable'};
  const vapor=vaporPressureFromDewpoint(t,dewpoint,humidity);
  if(!finite(vapor))return {value:null,method:'Moisture data unavailable'};
  const c=fToC(t), ms=wind*.44704;
  return {value:cToF(c+.33*vapor-.7*ms-4),method:'Steadman/BOM apparent temperature (shade)'};
}
export function wetBulb(t, rh) {
  if(!finite(t)||!finite(rh))return null;
  const c=fToC(t);
  if(c<0||c>50||rh<5||rh>99)return null;
  return cToF(c*Math.atan(.151977*Math.sqrt(rh+8.313659))+Math.atan(c+rh)-Math.atan(rh-1.676331)+.00391838*rh**1.5*Math.atan(.023101*rh)-4.686035);
}
export function solarElevation(time, latitude, longitude) {
  if(![time,latitude,longitude].every(finite))return null;
  const r=Math.PI/180,d=time/86400000-10957.5,lw=-longitude*r,phi=latitude*r,m=r*(357.5291+.98560028*d);
  const l=m+r*(1.9148*Math.sin(m)+.0200*Math.sin(2*m)+.0003*Math.sin(3*m))+r*102.9372+Math.PI;
  const dec=Math.asin(Math.sin(l)*Math.sin(r*23.4397)),ra=Math.atan2(Math.sin(l)*Math.cos(r*23.4397),Math.cos(l)),h=r*(280.16+360.9856235*d)-lw-ra;
  return Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(h));
}
function skyTransmission(condition='') {
  const text=String(condition).toLowerCase();
  if(/thunder|storm|rain|shower|drizzle|fog|mist/.test(text))return .18;
  if(/overcast/.test(text))return .12;
  if(/mostly cloudy/.test(text))return .32;
  if(/partly cloudy|partly sunny/.test(text))return .66;
  if(/mostly sunny|few clouds/.test(text))return .86;
  if(/cloudy/.test(text))return .42;
  if(/sunny|clear/.test(text))return 1;
  return null;
}
function dewpointMessage(dewpoint) {
  if(!finite(dewpoint))return 'Dew point is unavailable.';
  if(dewpoint<50)return 'The air is dry, so evaporation works well and warmth usually feels less sticky.';
  if(dewpoint<60)return 'The air is fairly comfortable, with good evaporative cooling.';
  if(dewpoint<65)return 'There is some moisture in the air, but it is not especially muggy.';
  if(dewpoint<70)return 'The air is humid, so sweat evaporates less efficiently.';
  return 'The air is very humid, so sweat evaporates slowly and warmth can feel heavier.';
}
export function thermalComfort(current, location, now) {
  const rh=finite(current.humidity)?current.humidity:humidityFromDewpoint(current.temperature,current.dewpoint);
  const shade=shadeFeelsLike(current.temperature,rh,current.wind,current.dewpoint);
  const elevation=solarElevation(now,location.latitude,location.longitude);
  const daylight=finite(elevation)?elevation>0:null;
  const transmission=skyTransmission(current.condition);
  // NWS notes full sunshine can add up to about 15°F to heat-index-type exposure.
  // We scale that ceiling by solar height and sky cover. This is a scenario estimate,
  // not measured shortwave/longwave radiation, WBGT, UTCI, or literal skin temperature.
  const adjustment=daylight&&finite(transmission)?15*Math.max(0,Math.sin(elevation))**.65*transmission:null;
  const localContext=current.type==='observation'
    ? 'The nearby observed air temperature already captures some broad local neighborhood heat. Exact pavement, building shade and street-canyon effects are not guessed.'
    : 'Exact urban pavement, building shade and street-canyon effects are not available, so no made-up city temperature bonus is added.';
  const coldContext=finite(current.temperature)&&current.temperature<=50
    ? 'In cold weather, moving air is handled with the NWS wind-chill formula; humidity is not artificially added to wind chill.'
    : '';
  return {shade:finite(shade.value)?Math.round(shade.value):null,sun:finite(shade.value)&&finite(adjustment)?Math.round(shade.value+adjustment):null,
    method:shade.method,humidity:rh,wetBulb:wetBulb(current.temperature,rh),daylight,solarAdjustment:adjustment,
    dewpointEffect:dewpointMessage(current.dewpoint),microclimate:localContext,coldContext,
    note:`Feels-like estimate, not measured skin temperature. ${dewpointMessage(current.dewpoint)} ${coldContext} ${localContext} The sun value is a solar-exposure scenario, not a radiation-sensor measurement.`};
}
