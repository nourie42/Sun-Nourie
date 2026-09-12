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
export function validateCurrentConditions(current,hours=[],modelRows={},now=Date.now()){
 if(current?.type!=='observation'||!finite(current.stationDistanceKm))return current;
 const epoch=Math.floor(now/HOUR)*HOUR;
 const currentHour=hours.find(hour=>{const start=Date.parse(hour.time);return finite(start)&&start<=now&&now<start+HOUR;})||hours[0];
 const selected=modelAt(modelRows,'nbm',epoch)||modelAt(modelRows,'hrrr',epoch)||modelAt(modelRows,'ecmwf',epoch);
 const localTemperature=selected?.row?.temperature_2m??currentHour?.temperature;
 const observedAt=Date.parse(current.time),ageMs=now-observedAt;
 const fresh=finite(observedAt)&&ageMs>=-5*60000&&ageMs<=MAX_STATION_AGE_MS;
 const close=current.stationDistanceKm<=MAX_DIRECT_STATION_DISTANCE_KM;
 const differenceF=finite(localTemperature)&&finite(current.temperature)?Math.abs(current.temperature-localTemperature):null;
 const agrees=current.stationDistanceKm<=ALWAYS_TRUST_STATION_DISTANCE_KM||!finite(differenceF)||differenceF<=MAX_STATION_GUIDANCE_DIFFERENCE_F;
 const accepted=fresh&&close&&agrees;
 const checks={accepted,stationDistanceKm:current.stationDistanceKm,stationAgeMinutes:finite(ageMs)?round(ageMs/60000,1):null,
  stationVsLocalGuidanceF:round(differenceF,1),limits:{distanceKm:MAX_DIRECT_STATION_DISTANCE_KM,ageMinutes:MAX_STATION_AGE_MS/60000,differenceF:MAX_STATION_GUIDANCE_DIFFERENCE_F,unconditionalDistanceKm:ALWAYS_TRUST_STATION_DISTANCE_KM}};
 if(accepted)return {...current,sourceValidation:checks};
 if(!finite(localTemperature))return {type:'unavailable',temperature:null,condition:'Current conditions unavailable',conditionSource:'No accepted local source',time:iso(epoch),station:null,stationName:null,stationDistanceKm:null,
  humidity:null,dewpoint:null,wind:null,gust:null,windDirection:null,visibility:null,pressure:null,pressurePa:null,pressureTrend:{status:'unavailable',direction:'unknown'},apparent:null,apparentSource:'Unavailable',
  sourceValidation:{...checks,reason:'The station failed local-source validation and no selected-location estimate is available.'},referenceObservation:{station:current.station||null,stationName:current.stationName||null,distanceKm:current.stationDistanceKm,temperature:current.temperature,observedAt:current.time||null}};
 const row=selected?.row||{},source=selected?.id==='nbm'?'NOAA National Blend · 2.5 km':selected?.id?selected.id.toUpperCase():'Selected-location hourly forecast';
 const reasons=[];
 if(!fresh)reasons.push('the station report is too old');
 if(!close)reasons.push('the station is more than 10 miles away');
 if(!agrees)reasons.push('the station differs too much from selected-location guidance');
 const reason=`The station was not used because ${reasons.join(' and ')}.`;
 return {type:'guidance',temperature:round(localTemperature),condition:currentHour?.condition||'Current conditions estimated',conditionSource:'Selected-location current-hour forecast',time:iso(epoch),
  station:null,stationName:null,stationDistanceKm:null,humidity:round(row.relative_humidity_2m),dewpoint:round(row.dew_point_2m),wind:round(row.wind_speed_10m),gust:round(row.wind_gusts_10m),windDirection:round(row.wind_direction_10m),
  visibility:round(row.visibility),pressure:round(row.pressure_msl,2),pressurePa:null,pressureTrend:{status:'unavailable',direction:'unknown'},apparent:round(row.apparent_temperature),apparentSource:`${source} selected-location estimate`,
  sourceValidation:{...checks,reason},localEstimate:{source,validAt:iso(epoch),reason,referenceStation:{station:current.station||null,stationName:current.stationName||null,distanceKm:current.stationDistanceKm,temperature:current.temperature,observedAt:current.time||null}}};
}
