/** Generic current-condition source validation for every supported coordinate. */
export const MAX_DIRECT_STATION_DISTANCE_KM=16.1;
export const ALWAYS_TRUST_STATION_DISTANCE_KM=8;
export const MAX_STATION_AGE_MS=75*60000;
export const MAX_STATION_GUIDANCE_DIFFERENCE_F=5;
const HOUR=3600000;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const round=(value,digits=1)=>finite(value)?Number(value.toFixed(digits)):null;
const iso=value=>new Date(value).toISOString();

function modelAt(modelRows,id,epoch){
 const row=modelRows?.[id]?.find(item=>item.time===epoch);
 return finite(row?.temperature_2m)?{id,row}:null;
}

/**
 * A station is used as local only when it is fresh, close enough, and—outside
 * the closest five miles—not sharply inconsistent with selected-point NBM.
 * Rejected observations remain visible as provenance but cannot drive current
 * temperature, moisture, wind, pressure, or feels-like calculations.
 */
export function validateCurrentConditions(current,hours=[],modelRows={},now=Date.now(),options={}){
 if(current?.type!=='observation'||!finite(current.stationDistanceKm))return current;
 // Shared feels-like method setting (weather-config branch). Only an explicit
 // "hourly-blend" changes behavior; callers that pass nothing keep the station-when-accepted rules.
 const blendEverywhere=options?.currentConditionsSource==='hourly-blend';
 const epoch=Math.floor(now/HOUR)*HOUR;
 const currentHour=hours.find(hour=>{const start=Date.parse(hour.time);return finite(start)&&start<=now&&now<start+HOUR;})||hours[0];
 const selected=modelAt(modelRows,'nbm',epoch)||modelAt(modelRows,'hrrr',epoch)||modelAt(modelRows,'ecmwf',epoch);
 const localTemperature=selected?.row?.temperature_2m??currentHour?.temperature;
 const observedAt=Date.parse(current.time),ageMs=now-observedAt;
 const fresh=finite(observedAt)&&ageMs>=-5*60000&&ageMs<=MAX_STATION_AGE_MS;
 const close=current.stationDistanceKm<=MAX_DIRECT_STATION_DISTANCE_KM;
 const differenceF=finite(localTemperature)&&finite(current.temperature)?round(Math.abs(current.temperature-localTemperature),1):null;
 const agrees=current.stationDistanceKm<=ALWAYS_TRUST_STATION_DISTANCE_KM||!finite(differenceF)||differenceF<=MAX_STATION_GUIDANCE_DIFFERENCE_F;
 const stationUsable=fresh&&close&&agrees;
 // The blend is used for every location, but never at the cost of showing nothing:
 // with no blend temperature available, a usable station is still the better answer.
 const accepted=stationUsable&&(!blendEverywhere||!finite(localTemperature));
 const checks={accepted,methodSetting:blendEverywhere?'hourly-blend':'station-when-accepted',stationDistanceKm:current.stationDistanceKm,stationAgeMinutes:finite(ageMs)?round(ageMs/60000,1):null,
  stationVsLocalGuidanceF:differenceF,limits:{distanceKm:MAX_DIRECT_STATION_DISTANCE_KM,ageMinutes:MAX_STATION_AGE_MS/60000,differenceF:MAX_STATION_GUIDANCE_DIFFERENCE_F,unconditionalDistanceKm:ALWAYS_TRUST_STATION_DISTANCE_KM}};
 if(accepted)return {...current,sourceValidation:checks};
 if(!finite(localTemperature))return {type:'unavailable',temperature:null,condition:'Current conditions unavailable',conditionSource:'No accepted local source',time:iso(epoch),station:null,stationName:null,stationDistanceKm:null,
  humidity:null,dewpoint:null,wind:null,gust:null,windDirection:null,visibility:null,pressure:null,pressurePa:null,pressureTrend:{status:'unavailable',direction:'unknown'},apparent:null,apparentSource:'Unavailable',
  sourceValidation:{...checks,reason:'The station failed local-source validation and no selected-location estimate is available.'},referenceObservation:{station:current.station||null,stationName:current.stationName||null,distanceKm:current.stationDistanceKm,temperature:current.temperature,observedAt:current.time||null}};
 const row=selected?.row||{},source=selected?.id==='nbm'?'NOAA National Blend · 2.5 km':selected?.id?selected.id.toUpperCase():'Selected-location hourly forecast';
 const reasons=[];
 if(!fresh)reasons.push('the station report is too old');
 if(!close)reasons.push('the station is more than 10 miles away');
 if(!agrees)reasons.push('the station differs too much from selected-location guidance');
 if(blendEverywhere&&stationUsable)reasons.push('this site shows the hourly forecast blend as current conditions in every location');
 const reason=`The station was not used because ${reasons.join(' and ')}.`;
 // Observed sky beats forecast wording: if a fresh station within ~25 miles reports its sky cover
 // (and good visibility), use it instead of e.g. "Patchy Fog" in the current-hour forecast.
 const SKY={SKC:'Clear',CLR:'Clear',FEW:'Mostly Clear',SCT:'Partly Cloudy',BKN:'Mostly Cloudy',OVC:'Cloudy'};
 const skyNear=fresh&&current.stationDistanceKm<=40&&SKY[current.skyCover]&&(!finite(current.visibility)||current.visibility>=5);
 const forecastWet=/thunder|storm|rain|shower|drizzle|snow|sleet|flurr|ice|freezing/i.test(currentHour?.condition||'');
 const observedSky=skyNear&&!forecastWet?SKY[current.skyCover]:null;
 const observedWeather=fresh&&close&&/thunder|\btstm\b|\bstorm\b|rain|shower|drizzle|snow|sleet|flurr|ice pellets|freezing rain/i.test(current.condition||'')?current.condition:null;
 return {type:'guidance',temperature:round(localTemperature),condition:observedWeather||observedSky||currentHour?.condition||'Current conditions estimated',conditionSource:observedWeather?'Nearby station observation (weather); selected-location guidance (measurements)':observedSky?`Nearby station sky observation (${current.station||'station'}); selected-location guidance (measurements)`:'Selected-location current-hour forecast',time:iso(epoch),
  station:null,stationName:null,stationDistanceKm:null,humidity:round(row.relative_humidity_2m),dewpoint:round(row.dew_point_2m),wind:round(row.wind_speed_10m),gust:round(row.wind_gusts_10m),windDirection:round(row.wind_direction_10m),
  visibility:round(row.visibility),pressure:round(row.pressure_msl,2),pressurePa:null,pressureTrend:{status:'unavailable',direction:'unknown'},apparent:round(row.apparent_temperature??current.apparent),apparentSource:finite(row.apparent_temperature)?`${source} selected-location estimate`:current.apparentSource,
  sourceValidation:{...checks,reason},localEstimate:{source,validAt:iso(epoch),reason,referenceStation:{station:current.station||null,stationName:current.stationName||null,distanceKm:current.stationDistanceKm,temperature:current.temperature,observedAt:current.time||null}}};
}
