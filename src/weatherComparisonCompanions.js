import {addExposureWeather,exposureWeatherUrl,normalizeExposureWeather} from './weatherFusionExposure.js';
import {addAirQuality,airQualityUrl,normalizeAirQuality} from './weatherFusionAirQuality.js';
import {fetchNwsRain,addNwsRain} from './weatherComparisonRain.js';
import {createHash} from 'node:crypto';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const HOUR=3600000;

// An explicitly relative temperature-confidence indicator, not a calibrated
// probability that the entire weather forecast will be correct.
export function ensembleConfidence(rows,now,leadDays=0){
 const spreads=rows.filter(r=>finite(r.temperatureP10)&&finite(r.temperatureP90)&&r.temperatureP90>=r.temperatureP10).map(r=>r.temperatureP90-r.temperatureP10);
 const note='Relative temperature confidence from ensemble spread, forecast lead time, run age and coverage; not a calibrated accuracy percentage or rain probability.';
 if(spreads.length<6)return {label:'Unavailable',key:'unavailable',score:null,sourceCount:1,factors:['Insufficient published ensemble spread'],note};
 const spread=spreads.reduce((a,b)=>a+b,0)/spreads.length;
 const age=Math.max(...rows.map(r=>(now-Date.parse(r.provenance?.runAt))/HOUR).filter(finite),0);
 const coverage=Math.min(1,spreads.length/24);
 const score=Math.round(Math.max(10,Math.min(95,95-spread*3-Math.max(0,leadDays)*3-Math.max(0,age-24)*.5-(1-coverage)*20)));
 const key=score>=75?'high':score>=50?'moderate':'low';
 return {label:key[0].toUpperCase()+key.slice(1),key,score,sourceCount:1,factors:[`Average temperature P10–P90 spread: ${spread.toFixed(1)}°F`,`${spreads.length} hours with ensemble spread`,`Relative indicator · ${Math.round(age)}-hour-old initialization`],note};
}

export async function fetchComparisonCompanions(point,fetchImpl=globalThis.fetch){
 const get=async(url,normalize)=>{const r=await fetchImpl(url,{signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok)throw Error('Supplemental feed unavailable');return normalize(await r.json());};
 const results=await Promise.allSettled([get(exposureWeatherUrl(point,point.timeZone),normalizeExposureWeather),get(airQualityUrl(point),normalizeAirQuality),fetchNwsRain(point,fetchImpl)]);
 return {exposure:results[0].status==='fulfilled'?results[0].value:null,airQuality:results[1].status==='fulfilled'?results[1].value:null,rain:results[2].status==='fulfilled'?results[2].value:null};
}

export function addComparisonCompanions(out,{exposure=null,airQuality=null,rain=null}={}){
 // Keep the WeatherNext temperature, dew point, wind, rain and radiation.
 // UV, air quality and NWS rain probabilities are separately attributed.
 const modelExposure=out.exposureWeather;
 addExposureWeather(out,exposure);
 out.exposureWeather=modelExposure;
 if(modelExposure){const uv=new Map(out.uv.hourly.map(r=>[Date.parse(r.time),r.value]));modelExposure.uv=exposure?.uv||[];for(const row of modelExposure.rows)row.uvIndex=uv.get(Date.parse(row.time))??null;}
 addAirQuality(out,airQuality);
 out.comparison.missing=out.comparison.missing.filter(name=>!(name==='UV index'&&finite(out.uv.today))&&!(name==='Air quality'&&airQuality));
 out.methodology+=' UV is a separate Open-Meteo forecast; air quality is a separate Open-Meteo / CAMS forecast. Neither replaces the model weather fields.';
 addNwsRain(out,rain);
 out.signature=createHash('sha256').update(JSON.stringify({model:out.signature,uv:out.uv,aqi:out.airQuality,rain})).digest('hex').slice(0,24);
 return out;
}
