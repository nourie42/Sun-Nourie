import {weatherState,weatherTransmission} from './weather-state.js';
import {utciF} from './utci.js?v=clear-weather-daygraph-v3';
/* Pure presentation math shared by the weather API, browser and tests. */
export const EXPERIENCE_VERSION = 'weather-nourie-friendly-v1';
export const finite = n => typeof n === 'number' && Number.isFinite(n);
const fToC = f => (f - 32) / 1.8;
const cToF = c => c * 1.8 + 32;
const sat = t => 6.112 * Math.exp(17.67 * t / (t + 243.5));
export function localHour(time, zone = 'America/New_York') {
  return Number(new Intl.DateTimeFormat('en-US', {timeZone:zone, hour:'numeric', hourCycle:'h23'}).format(new Date(time)));
}
export function rainChanceValue(likelihood, fallback = null) {
  const chance=value=>finite(value)&&value>=0&&value<=100?value:null;
  if(likelihood?.aggregation==='maximum-hourly')return likelihood.coverage?.complete===false?null:chance(likelihood.value);
  if(likelihood&&Object.hasOwn(likelihood,'value'))return chance(likelihood.value);
  return chance(likelihood?.value)??chance(fallback);
}
export function dailyRainPeriod(day, phase = 'overall') {
  const field=phase==='daytime'?'popDayLikelihood':phase==='overnight'?'popNightLikelihood':'rainLikelihood';
  const likelihood=day?.[field],canonical=likelihood?.aggregation==='maximum-hourly';
  const fallback=phase==='daytime'?(day?.popDay??rainChanceValue(day?.rainLikelihood,day?.pop)):phase==='overnight'?day?.popNight:day?.pop;
  return {phase,likelihood,canonical,value:rainChanceValue(likelihood,fallback),window:canonical?likelihood.window:null};
}
export function dailyDisplay(day, index, now, zone) {
  const tonight = index === 0 && localHour(now, zone) >= 15;
  const rain=dailyRainPeriod(day,tonight?'overnight':index===0?'daytime':'overall');
  return {tonight, label:tonight?'Tonight':index===0?'Today':day.label,
    primary:tonight?day.low:day.high, secondary:tonight?null:day.low,
    primaryLabel:tonight?'Low':'High', condition:tonight?(day.nightCondition||day.condition):day.condition,
    detail:tonight?(day.nightDetail||day.detail):day.detail,
    pop:rain.value,rainWindow:rain.window};
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
/**
 * One all-weather apparent-temperature model for cold, mild and hot weather.
 * Steadman's outdoor/shade equation uses air temperature, water-vapour pressure
 * and 10 m wind speed continuously instead of switching between formula families.
 * Dew point is preferred because it directly fixes vapour pressure, so drier air
 * naturally lowers the estimate at the same air temperature and wind.
 * Formula (°C): AT = Ta + 0.33e - 0.70v - 4.00.
 */
export function shadeFeelsLike(t, rh, wind, dewpoint) {
  if (!finite(t)) return {value:null,method:'Missing air temperature'};
  if (!finite(wind)||wind<0) return {value:null,method:'Wind unavailable'};
  const humidity=finite(rh)&&rh>=0&&rh<=100?rh:humidityFromDewpoint(t,dewpoint);
  const vapor=vaporPressureFromDewpoint(t,dewpoint,humidity);
  if(!finite(vapor))return {value:null,method:'Moisture data unavailable'};
  const c=fToC(t), ms=wind*.44704;
  return {value:cToF(c+.33*vapor-.7*ms-4),method:'Steadman apparent temperature (all-weather shade)',vaporPressure:vapor};
}
/**
 * Radiation-inclusive Steadman apparent temperature. Q is net extra radiation
 * absorbed per unit body-surface area (W/m²), not incident solar irradiance.
 * Formula (°C): AT = Ta + .348e - .70v + .70Q/(v+10) - 4.25.
 */
export function radiationFeelsLike(t, rh, wind, dewpoint, q) {
  if(!finite(t)||!finite(wind)||wind<0||!finite(q))return {value:null,method:'Radiation apparent temperature unavailable'};
  const humidity=finite(rh)&&rh>=0&&rh<=100?rh:humidityFromDewpoint(t,dewpoint);
  const vapor=vaporPressureFromDewpoint(t,dewpoint,humidity);
  if(!finite(vapor))return {value:null,method:'Moisture data unavailable'};
  const c=fToC(t),ms=wind*.44704,radiation=Math.max(-40,Math.min(130,q));
  return {value:cToF(c+.348*vapor-.7*ms+.7*radiation/(ms+10)-4.25),method:'Steadman apparent temperature with radiation',vaporPressure:vapor,radiation};
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
function skyTransmission(condition='') { return weatherTransmission(condition); }
/** Estimated absorbed net extra radiation for the Steadman radiation term.
 * The 130 W/m² ceiling follows the published range commonly used with the
 * radiation-inclusive apparent-temperature equation. This remains an estimate
 * because there is no person-level radiometer at the selected point.
 */
export function estimatedAbsorbedRadiation(condition, elevation) {
  const transmission=skyTransmission(condition);
  if(!finite(elevation)||elevation<=0||!finite(transmission))return null;
  return 130*Math.max(0,Math.sin(elevation))**.72*transmission;
}
function dewpointMessage(dewpoint) {
  if(!finite(dewpoint))return 'Dew point is unavailable.';
  if(dewpoint<50)return 'The air is dry, so sweat can evaporate easily and the same temperature usually feels cooler.';
  if(dewpoint<60)return 'The air is fairly dry, so evaporation still helps you cool off.';
  if(dewpoint<65)return 'There is some moisture in the air, but it is not especially muggy.';
  if(dewpoint<70)return 'The air is humid, so sweat does not evaporate as easily.';
  return 'The air is very humid, so sweat evaporates slowly and warmth feels heavier.';
}
function windMessage(temp,wind) {
  if(!finite(wind))return 'Wind data is unavailable.';
  if(wind<3)return 'There is very little wind, so moving-air cooling is small.';
  if(finite(temp)&&temp<55)return 'The wind removes heat faster, so cool or cold air can feel noticeably colder.';
  if(finite(temp)&&temp>80)return 'The breeze helps remove heat, although humid air can limit evaporative cooling.';
  return 'The breeze provides some moving-air cooling.';
}

/** One continuous UTCI calculation. No warmer-of-two-index selection.
 * MRT is explicitly a Tier-3 estimate, not measured radiation or skin temperature. */
export function thermalHumidity(current) {
  const derived=humidityFromDewpoint(current?.temperature,current?.dewpoint);
  if(finite(derived))return derived;
  return finite(current?.humidity)&&current.humidity>=0&&current.humidity<=100?current.humidity:null;
}
export function radiationSky(current={}) {
  const cover=current.skyCover;
  // Numeric sky cover at THIS forecast hour wins over a 12-hour weather phrase.
  if(finite(cover)&&cover>=0&&cover<=100) {
    const condition=cover<=12?'Clear':cover<=62?'Partly Cloudy':'Cloudy';
    return {...weatherState(condition),condition,cover,source:current.skySource||'Same-hour forecast sky cover'};
  }
  const text=String(current.condition||'');
  // A chance of a shower does not erase explicitly forecast sunny skies.
  const sky=text.match(/mostly sunny|mostly clear|partly cloudy|partly sunny|mostly cloudy|overcast|sunny|clear|cloudy/i)?.[0];
  const condition=sky||text;
  return {...weatherState(condition),condition,cover:null,source:current.conditionSource||'Weather-description sky estimate'};
}
function estimatedMrtDelta(current,elevation,exposure) {
  if(!finite(elevation)||elevation<=0)return 0;
  const sky=radiationSky(current),sun=Math.max(0,Math.sin(elevation))**.72;
  const diffuse={clear:18,'partly-cloudy':15,cloudy:8,rain:5,storm:4,snow:10,fog:5,unknown:0}[sky.kind]??0;
  // Smooth interpolation avoids a threshold jump when cloud cover crosses a category.
  const cloud=finite(sky.cover)?sky.cover/100:null;
  const trans=cloud===null?(weatherTransmission(sky.condition)||0):Math.max(0,1-cloud);
  const diffuseLoad=cloud===null?diffuse:18-10*cloud;
  const direct=exposure==='outdoors'?130*sun*trans:0;
  return (diffuseLoad*sun+direct)/6.1;
}
export function tier3FeelsLike(current,location,now,exposure='shade') {
  if(!finite(current?.temperature)||!finite(current?.wind)||current.wind<0)return {value:null,method:'UTCI inputs unavailable'};
  const rh=thermalHumidity(current);
  if(!finite(rh))return {value:null,method:'UTCI moisture unavailable'};
  const elevation=solarElevation(now,location?.latitude,location?.longitude),deltaC=estimatedMrtDelta(current,elevation,exposure);
  const tr=current.temperature+deltaC*1.8,value=utciF(current.temperature,tr,current.wind,rh);
  return {value,method:finite(value)?'UTCI Tier-3 fallback with estimated mean radiant temperature':'UTCI outside supported range',rh,tr,deltaMrtC:deltaC,
    windUsedMps:Math.max(.5,current.wind*.44704),warmerResultOverride:false};
}

export function thermalComfort(current, location, now) {
  const weather=radiationSky(current);
  const rh=thermalHumidity(current);
  const shade=tier3FeelsLike(current,location,now,'shade');
  const outdoor=tier3FeelsLike(current,location,now,'outdoors');
  const elevation=solarElevation(now,location.latitude,location.longitude);
  const daylight=finite(elevation)?elevation>0:null;
  const localContext=current.type==='observation'
    ? 'The nearby observed air temperature carries broad neighborhood influence, but block-level pavement, walls, shade and wind can still differ.'
    : 'Block-level pavement, walls, shade and street-canyon wind are not measured, so no fixed urban bonus or penalty is added.';
  const wet=wetBulb(current.temperature,rh);
  const shadeValue=finite(shade.value)?Math.round(shade.value):null,outdoorValue=finite(outdoor.value)?Math.round(outdoor.value):null;
  return {rawShade:shade.value,rawOutdoors:outdoor.value,
    inputEvidence:{temperature:current.temperature,dewpoint:current.dewpoint,humidity:rh,windMph:current.wind,windUsedMps:outdoor.windUsedMps,skyCover:weather.cover,skySource:weather.source,meanRadiantTemperatureF:outdoor.tr,sourceTime:current.time||null,station:current.station||null,stationDistanceKm:current.stationDistanceKm??null,
      windPolicy:current.wind*.44704<.5?'Calm-wind approximation: UTCI minimum 0.5 m/s':'Source wind; no observation-to-forecast adjustment',
      radiationBasis:daylight===false?'No solar load at night; unmeasured mean radiant temperature assumed equal to air':'Radiation estimated from the same-hour sky and solar elevation; not measured'},
    radiantCondition:weather.condition,shade:shadeValue,sun:daylight&&(weather.kind==='clear'||weather.kind==='partly-cloudy')?outdoorValue:null,outdoors:outdoorValue,
    weatherKind:weather.kind,weatherLabel:weather.label,condition:current.condition,conditionSource:current.conditionSource||null,
    radiationStatus:daylight===false?'night':weather.known?'estimated-by-sky-state':'unknown',
    method:shade.method,humidity:rh,wetBulb:wet,daylight,absorbedRadiation:finite(weather.cover)?(daylight?130*Math.max(0,Math.sin(elevation))**.72*(1-weather.cover/100):0):estimatedAbsorbedRadiation(weather.condition,elevation),
    solarAdjustment:finite(outdoorValue)&&finite(shadeValue)?outdoorValue-shadeValue:null,
    dewpointEffect:dewpointMessage(current.dewpoint),windEffect:windMessage(current.temperature,current.wind),microclimate:localContext,
    note:`Tier-3 operational fallback from the attached Real-Feel Skin Temperature research: UTCI is the all-season base using air temperature, humidity/dew point and standard wind, with solar elevation and broad sky state used for a generic radiant estimate. No warmer-formula override or observation-to-forecast offset is used. Numeric hourly cloud cover is preferred over broad period descriptions. Calm wind uses the UTCI minimum 0.5 m/s; out-of-domain conditions stay unavailable. Cloud attenuation and MRT are estimates, not local radiometer measurements. This is a modeled equivalent temperature, not measured skin temperature or validated EPST. ${dewpointMessage(current.dewpoint)} ${windMessage(current.temperature,current.wind)} ${localContext} Wet bulb is diagnostic only and is not added again to the result.`};
}
