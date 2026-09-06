import {solarElevation} from './weather-math.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function localHour(time=Date.now(),zone='America/New_York'){
  return Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(time)));
}
export function heroWeather(data,time=Date.now()){
  const zone=data?.location?.timeZone||'America/New_York',hour=localHour(time,zone),tonight=hour>=15;
  const c=data?.current||{},d=data?.days?.[0]||{},hourly=data?.hours?.[0]||{};
  if(tonight){
    return {
      tonight:true,
      temperature:finite(d.low)?d.low:null,
      condition:d.nightCondition||hourly.condition||d.condition||c.condition||'Tonight',
      range:'Tonight',
      isDay:false,
      sourceLabel:'Tonight’s forecast',
    };
  }
  return {
    tonight:false,
    temperature:c.temperature,
    condition:c.condition||(hourly.condition?`${hourly.condition} · forecast`:'Current condition description unavailable'),
    range:`High ${finite(d.high)?Math.round(d.high)+'°':'—'} · Low ${finite(d.low)?Math.round(d.low)+'°':'—'}`,
    isDay:(solarElevation(time,data?.location?.latitude,data?.location?.longitude)??-1)>0,
    sourceLabel:c.type==='observation'?'Nearby weather station':'Estimated current conditions',
  };
}
