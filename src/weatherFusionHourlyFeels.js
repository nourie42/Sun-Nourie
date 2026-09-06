import {finite,humidityFromDewpoint,tier3FeelsLike,thermalComfort} from '../public/weather-fusion/weather-math.js';
import {OUTDOOR_FEELS_VERSION} from '../public/weather-fusion/outdoor-feels.js';
const H=3600000,round=v=>finite(v)?Number(v.toFixed(1)):null;
/** A single numeric feels-like series, computed from the SAME hour's displayed
 * air temperature, dew point and wind. Never copy today's observation into future
 * days or hold a missing sample flat. Model interpolation happens upstream only.
 */
export function rebuildHourlyFeels(out,{now,temperatureAt,humidityAt,periods=[]}){
 const series=out.metricForecasts.series,start=Math.floor(now/H)*H;
 const original=new Map((series.temperature||[]).map(p=>[Date.parse(p.time),p]));
 const maps=Object.fromEntries(['dewpoint','wind','humidity'].map(k=>[k,new Map((series[k]||[]).map(p=>[Date.parse(p.time),p]))]));
 const hourMap=new Map(out.hours.map(h=>[Date.parse(h.time),h]));
 const temperatures=[],feels=[],shades=[],suns=[],humidities=[],dewpoints=[];
 for(let i=0;i<=240;i++){
  const epoch=start+i*H,time=new Date(epoch).toISOString(),old=original.get(epoch),hour=hourMap.get(epoch);
  const t=old||temperatureAt(epoch)||{value:null,source:null};
  const temperature=round(t.value),rawDewpoint=maps.dewpoint.get(epoch),wind=round(maps.wind.get(epoch)?.value);
  const dewpoint=round(finite(temperature)&&finite(rawDewpoint?.value)?Math.min(temperature,rawDewpoint.value):rawDewpoint?.value);
  const humidity=round(humidityFromDewpoint(temperature,dewpoint)??maps.humidity.get(epoch)?.value??humidityAt(epoch));
  const inputs={temperature,dewpoint,wind,humidity};
  const condition=hour?.condition||periods.find(p=>Date.parse(p.startTime)<=epoch&&epoch<Date.parse(p.endTime))?.shortForecast||'';
  const estimate=tier3FeelsLike({...inputs,condition,type:'guidance'},out.location,epoch,'outdoors');
  const shade=tier3FeelsLike({...inputs,condition,type:'guidance'},out.location,epoch,'shade');
  const sun=thermalComfort({...inputs,condition,type:'guidance'},out.location,epoch);
  temperatures.push({...t,time,value:temperature});
  dewpoints.push({...rawDewpoint,time,value:dewpoint});
  humidities.push({time,value:humidity,source:'Same-hour temperature and dew point; NWS humidity only when dew point is missing'});
  const value=round(estimate.value);
  const shadeValue=round(shade.value),sunValue=finite(sun.sun)?value:null;
  feels.push({time,value,inputs,condition,exposure:'outdoors',shadeValue,sunValue,daylight:sun.daylight,weatherKind:sun.weatherKind,source:estimate.method,alignmentFactor:0,rawInputs:inputs});
  shades.push({time,value:shadeValue,inputs,condition,exposure:'shade',source:shade.method});
  suns.push({time,value:sunValue,inputs,source:'Estimated sun-exposed apparent temperature at this forecast hour',daylight:sun.daylight});
  if(hour){hour.feelsLike=value;hour.feelsLikeShade=shadeValue;hour.feelsLikeSun=sunValue;hour.feelsLikeExposure='outdoors';hour.feelsLikeInputs=inputs;hour.apparent=value;}
 }
 series.temperature=temperatures;series.feels=feels;series.feelsShade=shades;series.feelsSun=suns;series.humidity=humidities;series.dewpoint=dewpoints;
 out.metricForecasts.comfortAlignment={status:'not-applied',note:'Forecast feels-like values use exactly the displayed temperature and the matching hourly dew point and wind. No separate temperature-only residual, daily maximum, or current observation is inserted into future hours.'};
 out.metricForecasts.notes.feels='One timestamp-matched outdoor exposure estimate per hour, including the same sky and sunlight estimate shown by the outdoor figure. Shade is retained separately in feelsShade. UTCI remains the all-season base; in warm humid air the warmer Steadman vapor-pressure result is kept as a moisture safeguard so cloud cover does not erase the dew-point effect. The current card uses observed conditions; future values use forecast inputs, not current humidity or a recycled daily value. Daily summaries use extrema of these same hourly values. Missing hours stay blank; this is a forecast, not a guarantee.';
 out.outdoorFeelsVersion=OUTDOOR_FEELS_VERSION;
 if(out.current){
  out.comfort=out.comfort||thermalComfort(out.current,out.location,now);
  out.current.feelsLike=out.comfort.outdoors;out.current.feelsLikeShade=out.comfort.shade;
  out.current.feelsLikeSun=out.comfort.sun;out.current.feelsLikeExposure='outdoors';
 }
 out.humidFeelsVersion='weather-nourie-humid-v1';
 out.thermalVersion='weather-nourie-hourly-feels-v2';
 return out;
}
