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

/** Guidance now and the hourly display share one exact canonical timestamp.
 * Accepted observations retain their separate measurement and provenance. */
export function alignGuidanceCurrentWithHourly(out,now=Date.now()){
 const current=out.current;
 if(!current||current.type==='observation')return out;
 const series=out.metricForecasts?.series||{},epoch=Math.floor(now/HOUR)*HOUR;
 const at=rows=>(rows||[]).find(row=>Date.parse(row.time)===epoch);
 const temperature=at(series.temperature),feel=at(series.feels),inputs=feel?.inputs||{};
 // The final feels inputs normally carry the exact sky blend used for
 // radiation. Older/minimal rows can omit it; only then use this same
 // timestamp's cloud series. Explicit missing sky must remain missing.
 const sky=Object.hasOwn(inputs,'skyCover')?{value:inputs.skyCover,source:inputs.skySource,sources:inputs.skySources}:at(series.cloud);
 const hour=at(out.hours),time=iso(epoch),source='Selected-location current-hour forecast blend';
 const fields={temperature:finite(temperature?.value)?temperature.value:null,
  dewpoint:finite(inputs.dewpoint)?inputs.dewpoint:null,wind:finite(inputs.wind)&&inputs.wind>=0?inputs.wind:null,
  humidity:finite(inputs.humidity)&&inputs.humidity>=0&&inputs.humidity<=100?inputs.humidity:null,
  skyCover:finite(sky?.value)&&sky.value>=0&&sky.value<=100?sky.value:null};
 const provenance={temperature:{source:temperature?.source||source,time,sources:temperature?.sources||[]},
  dewpoint:{source:at(series.dewpoint)?.source||null,time,sources:at(series.dewpoint)?.sources||[]},
  wind:{source:at(series.wind)?.source||null,time,sources:at(series.wind)?.sources||[]},
  humidity:{source:at(series.humidity)?.source||null,time},skyCover:{source:sky?.source||null,time,sources:sky?.sources||[]}};
 out.current={...current,...fields,type:finite(fields.temperature)?'guidance':'unavailable',time,
  temperatureSource:temperature?.source||source,dewpointSource:provenance.dewpoint.source,windSource:provenance.wind.source,
  skySource:sky?.source||null,skySources:sky?.sources||[],fieldSources:provenance,
  thermalTime:time,thermalCondition:feel?.condition||'',
  gust:round(at(series.gust)?.value),visibility:round(at(series.visibility)?.value),pressure:round(at(series.pressure)?.value,2),pressurePa:null,
  windDirection:finite(hour?.windDirectionDegrees)?hour.windDirectionDegrees:null,
  feelsLike:round(feel?.value),feelsLikeShade:round(feel?.shadeValue),feelsLikeSun:round(feel?.sunValue),feelsLikeExposure:'outdoors',
  apparent:finite(feel?.value)?feel.value:null,apparentSource:finite(feel?.value)?`${feel.source||'Custom outdoor estimate'}; same-hour forecast-blend inputs`:'Unavailable',
  station:null,stationName:null,stationDistanceKm:null,
  localEstimate:{...current.localEstimate,source,validAt:time,basis:'canonical-hourly-blend'},
  modeledNowVersion:'weather-nourie-canonical-now-v1'};
 if(!finite(fields.temperature)){
  out.current.condition='Current conditions unavailable';out.current.conditionSource='No timestamp-matched canonical temperature is available.';
 }
 return out;
}

/**
 * A station is used as local only when it is fresh, close enough, and—outside
 * the closest five miles—not sharply inconsistent with selected-point NBM.
 * Rejected observations remain visible as provenance but cannot drive current
 * temperature, moisture, wind, pressure, or feels-like calculations.
 */
export function validateCurrentConditions(current,hours=[],modelRows={},now=Date.now(),options={}){
 if(current?.type!=='observation')return current;
 // Shared feels-like method setting (weather-config branch). Only an explicit
 // "hourly-blend" changes behavior; callers that pass nothing keep the station-when-accepted rules.
 const blendEverywhere=options?.currentConditionsSource==='hourly-blend';
 const epoch=Math.floor(now/HOUR)*HOUR;
 const currentHour=hours.find(hour=>{const start=Date.parse(hour.time);return finite(start)&&start<=now&&now<start+HOUR;});
 const selected=modelAt(modelRows,'nbm',epoch)||modelAt(modelRows,'hrrr',epoch)||modelAt(modelRows,'ecmwf',epoch);
 const localTemperature=selected?.row?.temperature_2m??currentHour?.temperature;
 const observedAt=Date.parse(current.time),ageMs=now-observedAt;
 const fresh=finite(observedAt)&&ageMs>=-5*60000&&ageMs<=MAX_STATION_AGE_MS;
 const knownDistance=finite(current.stationDistanceKm)&&current.stationDistanceKm>=0;
 const close=knownDistance&&current.stationDistanceKm<=MAX_DIRECT_STATION_DISTANCE_KM;
 const differenceF=finite(localTemperature)&&finite(current.temperature)?round(Math.abs(current.temperature-localTemperature),1):null;
 const agrees=(knownDistance&&current.stationDistanceKm<=ALWAYS_TRUST_STATION_DISTANCE_KM)||!finite(differenceF)||differenceF<=MAX_STATION_GUIDANCE_DIFFERENCE_F;
 const stationUsable=fresh&&close&&agrees;
 // The blend is used for every location, but never at the cost of showing nothing:
 // with no blend temperature available, a usable station is still the better answer.
 const accepted=stationUsable&&(!blendEverywhere||!finite(localTemperature));
 const checks={accepted,methodSetting:blendEverywhere?'hourly-blend':'station-when-accepted',stationDistanceKm:knownDistance?current.stationDistanceKm:null,stationAgeMinutes:finite(ageMs)?round(ageMs/60000,1):null,
  stationVsLocalGuidanceF:differenceF,limits:{distanceKm:MAX_DIRECT_STATION_DISTANCE_KM,ageMinutes:MAX_STATION_AGE_MS/60000,differenceF:MAX_STATION_GUIDANCE_DIFFERENCE_F,unconditionalDistanceKm:ALWAYS_TRUST_STATION_DISTANCE_KM}};
 if(accepted)return {...current,sourceValidation:checks};
 if(!finite(localTemperature))return {type:'unavailable',temperature:null,condition:'Current conditions unavailable',conditionSource:'No accepted local source',time:iso(epoch),station:null,stationName:null,stationDistanceKm:null,
  humidity:null,dewpoint:null,wind:null,gust:null,windDirection:null,visibility:null,pressure:null,pressurePa:null,pressureTrend:{status:'unavailable',direction:'unknown'},apparent:null,apparentSource:'Unavailable',
  sourceValidation:{...checks,reason:'The station failed local-source validation and no selected-location estimate is available.'},referenceObservation:{station:current.station||null,stationName:current.stationName||null,distanceKm:current.stationDistanceKm,temperature:current.temperature,observedAt:current.time||null}};
 const row=selected?.row||{},source=selected?.id==='nbm'?'NOAA National Blend · 2.5 km':selected?.id?selected.id.toUpperCase():'Selected-location hourly forecast';
 const reasons=[];
 if(!fresh)reasons.push('the station report is too old');
 if(!knownDistance)reasons.push('the station distance could not be verified');
 else if(!close)reasons.push('the station is more than 10 miles away');
 if(!agrees)reasons.push('the station differs too much from selected-location guidance');
 if(blendEverywhere&&stationUsable)reasons.push('this site shows the hourly forecast blend as current conditions in every location');
 const reason=`The station was not used because ${reasons.join(' and ')}.`;
 // Observed sky beats forecast wording: if a fresh station within ~25 miles reports its sky cover
 // (and good visibility), use it instead of e.g. "Patchy Fog" in the current-hour forecast.
 const SKY={SKC:'Clear',CLR:'Clear',FEW:'Mostly Clear',SCT:'Partly Cloudy',BKN:'Mostly Cloudy',OVC:'Cloudy'};
 const skyNear=fresh&&knownDistance&&current.stationDistanceKm<=40&&SKY[current.skyCover]&&(!finite(current.visibility)||current.visibility>=5);
 const forecastWet=/thunder|storm|rain|shower|drizzle|snow|sleet|flurr|ice|freezing/i.test(currentHour?.condition||'');
 const observedSky=skyNear&&!forecastWet?SKY[current.skyCover]:null;
 const observedWeather=fresh&&close&&/thunder|\btstm\b|\bstorm\b|rain|shower|drizzle|snow|sleet|flurr|ice pellets|freezing rain/i.test(current.condition||'')?current.condition:null;
 return {type:'guidance',temperature:round(localTemperature),condition:observedWeather||observedSky||currentHour?.condition||'Current conditions estimated',conditionSource:observedWeather?'Nearby station observation (weather); selected-location guidance (measurements)':observedSky?`Nearby station sky observation (${current.station||'station'}); selected-location guidance (measurements)`:'Selected-location current-hour forecast',time:iso(epoch),
  station:null,stationName:null,stationDistanceKm:null,humidity:round(row.relative_humidity_2m),dewpoint:round(row.dew_point_2m),wind:round(row.wind_speed_10m),gust:round(row.wind_gusts_10m),windDirection:round(row.wind_direction_10m),
  visibility:round(row.visibility),pressure:round(row.pressure_msl,2),pressurePa:null,pressureTrend:{status:'unavailable',direction:'unknown'},apparent:round(row.apparent_temperature??currentHour?.apparent),apparentSource:finite(row.apparent_temperature)?`${source} selected-location estimate`:finite(currentHour?.apparent)?'Selected-location current-hour estimate':'Unavailable',
  sourceValidation:{...checks,reason},localEstimate:{source,validAt:iso(epoch),reason,referenceStation:{station:current.station||null,stationName:current.stationName||null,distanceKm:current.stationDistanceKm,temperature:current.temperature,observedAt:current.time||null}}};
}
