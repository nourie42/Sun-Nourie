import {finite,thermalHumidity} from './weather-math.js?v=clear-weather-daygraph-v3';
const H=3600000;
/** Preserve the station air reading. Fill only absent wind/moisture from the
 * current forecast hour, and retain per-field provenance. Never borrow a future
 * hour, another city's cached value, or a snapshot more than 90 minutes old. */
export function currentComfortInputs(forecast,now=Date.now()){
 const current={...(forecast?.current||{})},filled=[];
 const assembled=Date.parse(forecast?.assembledAt);
 const fresh=finite(assembled)&&now-assembled<=90*60000&&now>=assembled-5*60000;
 const p=fresh?forecast?.metricForecasts?.series?.feels?.find(p=>{
  const t=Date.parse(p.time);return t<=assembled&&assembled<t+H;
 }):null;
 const inputs=p?.inputs||{},sources={};
 const use=(key,value)=>{current[key]=value;filled.push(key);sources[key]={source:'Current-hour forecast',time:p.time};};
 if((!finite(current.wind)||current.wind<0)&&finite(inputs.wind)&&inputs.wind>=0)use('wind',inputs.wind);
 if(!finite(thermalHumidity(current))){
  if(finite(inputs.dewpoint)&&finite(current.temperature)&&inputs.dewpoint<=current.temperature+1)use('dewpoint',inputs.dewpoint);
  else if(finite(inputs.humidity)&&inputs.humidity>=0&&inputs.humidity<=100){use('humidity',inputs.humidity);current.dewpoint=null;}
 }
 current.comfortInputSources=sources;
 current.comfortEstimatedFields=filled;
 current.comfortSourceNote=filled.length?`${filled.map(k=>({wind:'Wind',dewpoint:'Moisture',humidity:'Moisture'}[k])).join(' and ')} estimated from the current forecast hour.`:'';
 return current;
}
