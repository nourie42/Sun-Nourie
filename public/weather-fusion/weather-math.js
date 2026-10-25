import {calendarDayTemperatures,calendarDayWindow,rainWindowPeak} from './calendar-day.js?v=calendar-days-v1';
import {weatherState,weatherTransmission,conditionForRainChance} from './weather-state.js?v=current-rain-20261017-v3';
import {utciF} from './utci.js?v=clear-weather-daygraph-v3';
/* Pure presentation math shared by the weather API, browser and tests. */
export const EXPERIENCE_VERSION = 'weather-nourie-friendly-v2';
export const finite = n => typeof n === 'number' && Number.isFinite(n);
export const TONIGHT_START_HOUR = 18;
/** Site-wide rule for the "feels like in the sun" number, used by the server and the browser alike
 * (the browser re-checks every hourly card against this same math, so this is the only place to edit).
 * In direct sun the feels-like temperature is never lower than the air temperature unless it is windy:
 * the rule is fully on below calmWindMph and fades smoothly to nothing at windyMph and above, so there
 * is no sudden jump. It also fades in over the first 5 degrees of sun height, and out as cloud cover
 * passes the partly-cloudy range (62%), matching the site's no-sudden-change contract.
 * Set enabled:false to turn the rule off. */
export const SUN_FEELS_LIKE_RULE = Object.freeze({enabled:true, calmWindMph:10, windyMph:15});
const fToC = f => (f - 32) / 1.8;
const cToF = c => c * 1.8 + 32;
const sat = t => 6.112 * Math.exp(17.67 * t / (t + 243.5));
export function localHour(time, zone = 'America/New_York') {
  return Number(new Intl.DateTimeFormat('en-US', {timeZone:zone, hour:'numeric', hourCycle:'h23'}).format(new Date(time)));
}
export function isTonightPeriod(time, zone = 'America/New_York') {
  return localHour(time,zone) >= TONIGHT_START_HOUR;
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
export function rainPeakCaption(day, zone) {
  const peak=Date.parse(day?.rainLikelihood?.peakTime);
  if(!finite(peak))return '';
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(peak));
  if(day.date&&date!==day.date)return '';
  return localHour(peak,zone)>=18?'Peak this evening':'';
}
export function dailyDisplay(day, index, now, zone, forecast=null) {
  const night=index===0&&isTonightPeriod(now,zone),remainder=index===0&&localHour(now,zone)>=12;
  const rain=dailyRainPeriod(day,'overall'),temperatures=forecast?calendarDayTemperatures(forecast,index,now):{high:day.high,low:day.low};
  const window=temperatures.window;
  const chance=forecast&&rain.canonical?(rain.value===null?null:rainWindowPeak(forecast.rainTimeline||forecast.hours||[],calendarDayWindow(day,index,now,zone)).value):rain.value;
  const hours=night&&forecast?(forecast.hours||[]).filter(row=>Date.parse(row.time)>=window.start&&Date.parse(row.time)<window.end):[];
  const rawCondition=hours.length?hours.reduce((best,row)=>(row.rainLikelihood?.value??row.pop??0)>(best.rainLikelihood?.value??best.pop??0)?row:best).condition||'Cloudy':day.condition;
  return {tonight:false,night,remainder,phase:'overall',label:remainder?'Remainder of Today':index===0?'Today':day.label,
    primary:temperatures.high,secondary:temperatures.low,primaryLabel:'High',condition:conditionForRainChance(rawCondition,chance),
    detail:day.detail,pop:chance,rainWindow:rain.window,peakNote:rainPeakCaption(day,zone)};
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

/** UTCI is the base for the displayed thermal estimate. The existing cold-wind
 * adjustment below gradually lifts cold results toward NWS wind chill.
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
const SOLAR_ALTITUDES=[0,15,30,45,60,75,90];
// Orientation-average of the ASHRAE 55 standing projected-area table. The
// average avoids inventing which way a person is facing while retaining the
// way a vertical body intercepts low and mid-angle sunlight.
const STANDING_PROJECTED_AREA=[.2989583333,.2989583333,.2683333333,.2194166667,.173875,.122,.082];
function interpolate(x,xs,ys) {
  if(x<=xs[0])return ys[0];
  if(x>=xs.at(-1))return ys.at(-1);
  const i=xs.findIndex(value=>value>=x)-1;
  return ys[i]+(ys[i+1]-ys[i])*(x-xs[i])/(xs[i+1]-xs[i]);
}
/**
 * Estimated mean-radiant-temperature delta for shade or a standing person.
 * The prior outdoor estimate projected direct sun onto a horizontal surface,
 * which substantially understated the load on a standing body. The outdoor
 * branch now follows the ASHRAE 55 effective-radiant-field structure using an
 * orientation-average standing projected-area factor. Inputs remain generic
 * estimates because person orientation, clothing colour and local radiation
 * are not measured at the selected point.
 */
function estimatedMrt(current,elevation,exposure) {
  if(!finite(elevation)||elevation<=0)return {deltaC:0,transmission:0,projectedAreaFactor:null,effectiveRadiantFieldWm2:0,model:'No solar load'};
  const sky=radiationSky(current),sun=Math.max(0,Math.sin(elevation))**.72;
  const diffuse={clear:18,'partly-cloudy':15,cloudy:8,rain:5,storm:4,snow:10,fog:5,unknown:0}[sky.kind]??0;
  const cloud=finite(sky.cover)?sky.cover/100:null;
  const transmission=cloud===null?(weatherTransmission(sky.condition)||0):Math.max(0,1-cloud);
  const diffuseLoad=cloud===null?diffuse:18-10*cloud;
  const shadeDeltaC=diffuseLoad*sun/6.1;
  if(exposure!=='outdoors')return {deltaC:shadeDeltaC,transmission,projectedAreaFactor:null,effectiveRadiantFieldWm2:shadeDeltaC*6.1,model:'Generic diffuse-sky MRT estimate'};

  const altitudeDegrees=elevation*180/Math.PI,projectedAreaFactor=interpolate(altitudeDegrees,SOLAR_ALTITUDES,STANDING_PROJECTED_AREA);
  // Generic clear-sky direct normal irradiance. The 800 W/m² ceiling stays
  // inside the ordinary ASHRAE solar-gain input range and avoids pretending
  // that a point radiometer is present.
  const sinAltitude=Math.max(.001,Math.sin(elevation));
  const directNormalWm2=Math.min(800,1098*Math.exp(-.059/sinAltitude));
  const diffuseHorizontalWm2=.2*directNormalWm2;
  const effectiveBodyFraction=.725,skyViewFraction=1,bodyExposureFraction=.5;
  const shortwaveAbsorptivity=.7,longwaveAbsorptivity=.95,groundReflectance=.2,radiativeCoefficient=6;
  const diffuseSolar=effectiveBodyFraction*skyViewFraction*.5*diffuseHorizontalWm2;
  const directSolar=effectiveBodyFraction*projectedAreaFactor*bodyExposureFraction*directNormalWm2;
  const reflectedSolar=effectiveBodyFraction*skyViewFraction*.5*(directNormalWm2*sinAltitude+diffuseHorizontalWm2)*groundReflectance;
  const clearEffectiveRadiantField=Math.min(130,(diffuseSolar+directSolar+reflectedSolar)*(shortwaveAbsorptivity/longwaveAbsorptivity));
  const clearSunDeltaC=clearEffectiveRadiantField/(radiativeCoefficient*effectiveBodyFraction);
  const clearHorizontalWm2=directNormalWm2*sinAltitude+diffuseHorizontalWm2;
  const modeledSolar=finite(current.solarRadiation)&&current.solarRadiation>=0?current.solarRadiation:null;
  // Prefer the timestamp-matched, already cloud-adjusted model radiation.
  // Scaling the clear-sky body load by GHI preserves its direct/diffuse body
  // geometry without multiplying the model value by cloud cover a second time.
  const solarScale=finite(modeledSolar)&&clearHorizontalWm2>0
    ? Math.min(1,Math.max(0,modeledSolar/clearHorizontalWm2)):transmission;
  // Without modeled radiation, cloud cover fades from standing direct sun to
  // shade. With modeled radiation, the same interpolation is driven by GHI.
  const deltaC=shadeDeltaC+solarScale*Math.max(0,clearSunDeltaC-shadeDeltaC);
  return {deltaC,shadeDeltaC,clearSunDeltaC,transmission,solarScale,projectedAreaFactor,directNormalWm2,clearHorizontalWm2,
    solarRadiationWm2:modeledSolar,solarRadiationSource:finite(modeledSolar)?current.solarSource||'Same-hour model shortwave radiation':null,
    effectiveRadiantFieldWm2:deltaC*radiativeCoefficient*effectiveBodyFraction,
    model:`ASHRAE-style standing-person effective radiant field (${finite(modeledSolar)?'same-hour model radiation':'sky-cover fallback'})`};
}
/** Custom cold-wind floor for feels-like. UTCI's 10 m wind term runs far
 * colder than the U.S. standard index and lived experience in cold wind
 * (about 8°F at 36°F air and 13 mph wind, where NWS wind chill is 27°F).
 * In the cold regime the value is lifted toward the result of the NWS
 * equation. The standard NWS index is intended for 50°F or below and wind
 * above 3 mph; this custom transition extends that equation only as a
 * smoothing target. Full adjustment applies at or below 40°F and fades to
 * pure UTCI by 60°F. The wind gate fades in from 2 to 4 mph. Solar-warmed
 * UTCI values already above the equation result are never reduced. */
function coldWindChillBlend(tF,windMph,utciValue){
  if(!finite(tF)||!finite(windMph)||!finite(utciValue))return utciValue;
  if(tF>=60||windMph<2)return utciValue;
  const wT=Math.min(1,Math.max(0,(60-tF)/20)),wV=Math.min(1,Math.max(0,(windMph-2)/2));
  if(wT<=0||wV<=0)return utciValue;
  const p=Math.pow(windMph,.16),windChill=35.74+.6215*tF-35.75*p+.4275*tF*p;
  return utciValue+wT*wV*Math.max(0,windChill-utciValue);
}
export function tier3FeelsLike(current,location,now,exposure='shade') {
  if(!finite(current?.temperature)||!finite(current?.wind)||current.wind<0)return {value:null,method:'UTCI inputs unavailable'};
  const rh=thermalHumidity(current);
  if(!finite(rh))return {value:null,method:'UTCI moisture unavailable'};
  const elevation=solarElevation(now,location?.latitude,location?.longitude),radiation=estimatedMrt(current,elevation,exposure),deltaC=radiation.deltaC;
  const tr=current.temperature+deltaC*1.8,rawValue=utciF(current.temperature,tr,current.wind,rh);
  // Temperate-weather baseline: use the standard Steadman apparent
  // temperature, retaining the UTCI radiant difference for sun versus shade.
  // Smooth joins preserve the existing cold and hot-weather models. This is
  // an explicitly hybrid comfort estimate, not unmodified UTCI or air temp.
  const smooth=x=>{const v=Math.max(0,Math.min(1,x));return v*v*(3-2*v);};
  const mildWeight=smooth((current.temperature-55)/10)*(1-smooth((current.temperature-75)/10));
  const shadeApparent=shadeFeelsLike(current.temperature,rh,current.wind,current.dewpoint).value;
  const neutralUtci=utciF(current.temperature,current.temperature,current.wind,rh);
  const mildAdjustment=finite(rawValue)&&finite(shadeApparent)&&finite(neutralUtci)
    ? mildWeight*(shadeApparent-neutralUtci):0;
  const value=coldWindChillBlend(current.temperature,current.wind,rawValue+mildAdjustment);
  // Direct sun cannot make a calm or lightly breezy spot feel colder than the air itself. The lift fades in
  // with sun height, fades out with cloud beyond the partly-cloudy range, and fades out as wind rises from
  // calmWindMph to windyMph, so no input change can cause a sudden jump.
  const rule=SUN_FEELS_LIKE_RULE,sky=radiationSky(current);
  const cloudFade=finite(sky.cover)?(sky.cover<=62?1:Math.max(0,(100-sky.cover)/38)):(sky.known&&(sky.kind==='clear'||sky.kind==='partly-cloudy')?1:0);
  const heightFade=finite(elevation)&&elevation>0?smooth(elevation*180/Math.PI/5):0;
  const windFade=Math.max(0,Math.min(1,(rule.windyMph-current.wind)/(rule.windyMph-rule.calmWindMph)));
  const sunWeight=rule.enabled&&exposure==='outdoors'?cloudFade*heightFade*windFade:0;
  const lift=finite(value)&&value<current.temperature?(current.temperature-value)*sunWeight:0;
  const sunFloorApplied=lift>.001;
  const finalValue=finite(value)?value+lift:value;
  const adjusted=finite(value)&&finite(rawValue)&&value>rawValue+mildAdjustment+.001;
  const solarMethod=exposure==='outdoors'&&deltaC>0?' (ASHRAE-style standing-person solar projection)':'';
  return {value:finalValue,sunFloorApplied,valueBeforeSunFloor:value,method:finite(value)?`UTCI Tier-3 fallback with estimated mean radiant temperature${solarMethod}${mildWeight>0?' with a Steadman mild-weather baseline':''}${adjusted?' and custom cold-weather blend':''}${sunFloorApplied?' and sun-never-below-air-temperature floor':''}`:'UTCI outside supported range',rh,tr,deltaMrtC:deltaC,
    windUsedMps:Math.max(.5,current.wind*.44704),sourceWindMph:current.wind,effectiveWindMph:current.wind,
    radiationModel:radiation.model,solarTransmission:radiation.transmission,solarScale:radiation.solarScale??radiation.transmission,
    solarRadiationWm2:radiation.solarRadiationWm2??null,solarRadiationSource:radiation.solarRadiationSource??null,projectedAreaFactor:radiation.projectedAreaFactor,
    clearSunMrtDeltaC:radiation.clearSunDeltaC??null,effectiveRadiantFieldWm2:radiation.effectiveRadiantFieldWm2,
    mildWeatherWeight:mildWeight,mildWeatherAdjustmentF:mildAdjustment,shadeApparentBaselineF:shadeApparent,
    warmerResultOverride:false,
    windChillFloor:finite(value)&&finite(rawValue)&&value>rawValue+mildAdjustment+.001};
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
    inputEvidence:{sunFloorApplied:outdoor.sunFloorApplied===true,mildWeatherAdjustmentF:outdoor.mildWeatherAdjustmentF,mildWeatherWeight:outdoor.mildWeatherWeight,shadeApparentBaselineF:outdoor.shadeApparentBaselineF,temperature:current.temperature,dewpoint:current.dewpoint,humidity:rh,windMph:current.wind,windUsedMps:outdoor.windUsedMps,skyCover:weather.cover,skySource:weather.source,meanRadiantTemperatureF:outdoor.tr,radiationModel:outdoor.radiationModel,solarTransmission:outdoor.solarTransmission,solarScale:outdoor.solarScale,solarRadiationWm2:outdoor.solarRadiationWm2,solarRadiationSource:outdoor.solarRadiationSource,projectedAreaFactor:outdoor.projectedAreaFactor,clearSunMrtDeltaC:outdoor.clearSunMrtDeltaC,effectiveRadiantFieldWm2:outdoor.effectiveRadiantFieldWm2,sourceTime:current.time||null,station:current.station||null,stationDistanceKm:current.stationDistanceKm??null,
      windPolicy:current.wind*.44704<.5?'Calm-wind approximation: UTCI minimum 0.5 m/s':'Source 10 m wind; no observation-to-forecast adjustment',
      radiationBasis:!finite(elevation)?'Solar position unavailable; unmeasured mean radiant temperature assumed equal to air':daylight===false?'No solar load at night; unmeasured mean radiant temperature assumed equal to air':!weather.known?'Sky data unavailable; no direct-sun adjustment is estimated':finite(outdoor.solarRadiationWm2)?'Same-hour model shortwave radiation drives the standing-person solar estimate; not measured at person level':'Standing-person solar load estimated from the same-hour sky and solar elevation; not measured'},
    radiantCondition:weather.condition,shade:shadeValue,sun:daylight&&(weather.kind==='clear'||weather.kind==='partly-cloudy')?outdoorValue:null,outdoors:outdoorValue,
    weatherKind:weather.kind,weatherLabel:weather.label,condition:current.condition,conditionSource:current.conditionSource||null,
    radiationStatus:daylight===false?'night':weather.known?'estimated-by-sky-state':'unknown',
    method:outdoor.method,humidity:rh,wetBulb:wet,daylight,
    absorbedRadiation:daylight===false?0:!weather.known?null:(weather.kind==='clear'||weather.kind==='partly-cloudy'?outdoor.effectiveRadiantFieldWm2:0),
    solarAdjustment:finite(outdoorValue)&&finite(shadeValue)?outdoorValue-shadeValue:null,
    dewpointEffect:dewpointMessage(current.dewpoint),windEffect:windMessage(current.temperature,current.wind),microclimate:localContext,
    note:`Tier-3 operational fallback from the attached Real-Feel Skin Temperature research: UTCI is the all-season base using air temperature, humidity/dew point and standard 10 m wind. Same-hour model shortwave radiation drives the radiant environment when available; solar elevation and broad sky state provide the fallback. Direct sun uses an ASHRAE-style effective-radiant-field calculation for a standing person with orientation averaged because the person's direction is unknown; the radiation or cloud input fades it to the existing shade estimate. The displayed estimate also includes a gradual custom cold-wind adjustment toward the NWS wind-chill equation when that result is warmer than UTCI. The standard NWS index is intended for 50°F or below with wind above 3 mph; this site extends the equation only as a smoothing target. The temperature adjustment is full at or below 40°F and fades to zero at 60°F; the wind adjustment fades in from 2 to 4 mph. For mild weather, the shade baseline transitions to standard Steadman apparent temperature from 55°F to 65°F, remains fully applied through 75°F, and transitions back to UTCI by 85°F. Both exposures receive the same baseline correction, retaining the UTCI radiant difference between sun and shade. This is a hybrid comfort estimate, not unmodified UTCI; no fixed degree bonus or air-temperature floor is applied. No observation-to-forecast offset is used. Numeric hourly cloud cover is preferred over broad period descriptions when model radiation is missing. Calm wind uses the UTCI minimum 0.5 m/s; out-of-domain conditions stay unavailable. Model radiation, cloud attenuation, body projection and MRT are estimates, not local radiometer or person-level measurements. This is a modeled equivalent temperature, not measured skin temperature or validated EPST. ${dewpointMessage(current.dewpoint)} ${windMessage(current.temperature,current.wind)} ${localContext} Wet bulb is diagnostic only and is not added again to the result.`};
}
