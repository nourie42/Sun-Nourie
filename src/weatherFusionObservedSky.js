// Only a fresh, nearby station can resolve the current sky. A distant clear
// airport is reference information, not evidence that this selected point is sunny.
import {MAX_DIRECT_STATION_DISTANCE_KM,MAX_STATION_AGE_MS} from './weatherFusionCurrent.js';
import {weatherState} from '../public/weather-fusion/weather-state.js';
export const OBSERVED_SKY_VERSION='observed-sky-v3-local';
const LABEL={SKC:'Clear',CLR:'Clear',FEW:'Mostly Clear',SCT:'Partly Cloudy'};
const KNOWN_SKY=new Set([...Object.keys(LABEL),'BKN','OVC','VV']);
const WET=/thunder|storm|rain|shower|drizzle|snow|sleet|flurr|ice|freezing|hail/i;
const FOGGY=/fog|mist|haze|smoke|cloud|overcast/i;
const finite=Number.isFinite;
export function observedClearSky(list=[],now=Date.now()){
 const candidates=(Array.isArray(list)?list:[]).filter(o=>{
  const time=Date.parse(o?.time),distance=o?.stationDistanceKm;
  return finite(time)&&now-time<=MAX_STATION_AGE_MS&&time<=now+5*60000
   &&finite(distance)&&distance>=0&&distance<=MAX_DIRECT_STATION_DISTANCE_KM
   &&KNOWN_SKY.has(o.skyCover);
 }).sort((a,b)=>a.stationDistanceKm-b.stationDistanceKm);
 // Never search past a nearer cloudy/wet station just to find a sunny one.
 const o=candidates[0];
 if(!o||!LABEL[o.skyCover]||!finite(o.visibility)||o.visibility<5||WET.test(o.condition||''))return null;
 return {condition:LABEL[o.skyCover],station:o.station,skyCover:o.skyCover,visibility:o.visibility,time:o.time,distanceKm:o.stationDistanceKm};
}
export function dominantDaytime(condition=''){
 const m=String(condition).match(/^(.*?)\s+then\s+(.+)$/i);
 if(!m||!FOGGY.test(m[1])||WET.test(m[1])||WET.test(m[2]))return null;
 return m[2].replace(/\s+then\s+.*$/i,'').trim();
}
export function applyObservedSky(output,list,now=Date.now()){
 const sky=observedClearSky(list,now),cur=output.current;
 output.observedSky=sky?{...sky,version:OBSERVED_SKY_VERSION,applied:false}:{version:OBSERVED_SKY_VERSION,applied:false};
 // Accepted station conditions already describe this point. Unavailable current
 // readings and current precipitation must not be relabeled from another report.
 if(!sky||!cur||cur.type==='observation'||cur.type==='unavailable'||WET.test(cur.condition||''))return output;
 const day=output.hours?.find(h=>{const t=Date.parse(h.time);return t<=now&&now<t+3600000;})?.isDay;
 const label=day&&sky.condition==='Clear'?'Sunny':day&&sky.condition==='Mostly Clear'?'Mostly Sunny':sky.condition;
 Object.assign(cur,{condition:label,conditionSource:`Station sky observation (${sky.station} ${sky.skyCover}; visibility ${sky.visibility} mi; station ${Math.round(sky.distanceKm/1.609344)} mi away); current sky only`,observedSky:{...sky,applied:true},weather:weatherState(label)});
 // Observations describe now; hourly and daily forecast wording stays intact.
 output.observedSky.applied=true;
 return output;
}
