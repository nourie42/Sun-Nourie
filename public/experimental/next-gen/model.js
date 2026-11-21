/** Presentation-only adapter. No weather calculations, model weights or API
 * values are replaced here. These are the same helpers used by the main app. */
import {buildTimeline,skyScene,wearText} from '../../weather-fusion/atmos-model.js?v=atmos-v5';
import {currentSample,forecastSample} from '../../weather-fusion/weather-display.js?v=low-rain-display-v1';
import {dailyForecastReadings} from '../../weather-fusion/seven-day.js?v=low-rain-display-v1';
import {displayForecastConfidence} from '../../weather-fusion/forecast-confidence.js?v=ensemble-confidence-v1';
import {currentAirQuality,aqiBand} from '../../weather-fusion/air-quality.js?v=mobile-repair-v1';
import {forecastGrossLevel} from '../../weather-fusion/dewpoint-meter.js?v=feel-chart-v3';
import {comfortArtworkContext,warmestTodayWindow} from '../../weather-fusion/comfort-outlook.js?v=current-rain-20261017-v3';
import {clothingForFeels,comfortSceneState} from '../../weather-fusion/exposure-scene.js?v=current-rain-20261017-v3';
import {selectWeatherPortrait} from '../../weather-fusion/weather-portraits.js?v=weather-portraits-v1';
import {pavementEstimate} from '../../weather-fusion/pavement.js?v=current-rain-20261017-v3';
import {comfortSubtitle} from '../../weather-fusion/personal-details.js?v=current-rain-20261017-v3';

export const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const HOUR=3600000;
export const MODELS={nourie:{label:'Nourie',color:'#f4e2b8'},nws:{label:'NWS',color:'#89cbe8'},nbm:{label:'NBM',color:'#a8d6ad'},ecmwf:{label:'ECMWF',color:'#c6b4df'},hrrr:{label:'HRRR',color:'#e9ab8f'},wn:{label:'WeatherNext',color:'#e1d584'},weathernext3:{label:'WeatherNext 3',color:'#e5a6b6'},gefs:{label:'GEFS',color:'#b8d2ba'},nam:{label:'NAM',color:'#8bd6cc'},gfs:{label:'GFS',color:'#babce6'}};
export const VARIABLES={temperature:{label:'Temperature',short:'Temp',unit:'°F'},feels:{label:'Feels like',short:'Feels like',unit:'°F'},rain:{label:'Rain',short:'Rain',unit:'%'},wind:{label:'Wind',short:'Wind',unit:'mph'},humidity:{label:'Humidity',short:'Humidity',unit:'%'},dewpoint:{label:'Dew point',short:'Dew point',unit:'°F'},precipitation:{label:'Rain amount',short:'Rain amount',unit:'in'},gust:{label:'Gusts',short:'Gusts',unit:'mph'},cloud:{label:'Cloud cover',short:'Clouds',unit:'%'}};
const formats=new Map();
export function formatTime(time,zone='America/New_York',options={hour:'numeric'}){
  const key=zone+JSON.stringify(options);
  if(!formats.has(key)){if(formats.size>=32)formats.delete(formats.keys().next().value);formats.set(key,new Intl.DateTimeFormat('en-US',{timeZone:zone,...options}));}
  return finite(time)?formats.get(key).format(time):'Unavailable';
}
export const valueText=(value,unit='',digits=0)=>finite(value)?`${value.toFixed(digits)}${unit}`:'—';
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function confidenceOf(day){const c=displayForecastConfidence(day?.confidence);return {label:c?.label||'Unavailable',key:c?.key||'unavailable'};}
export function buildNextGenModel(forecast,now=Date.now()){
  const timeline=buildTimeline(forecast,now);
  const current=currentSample(forecast,now);
  const days=dailyForecastReadings(forecast,now,7);
  const airQuality=currentAirQuality(forecast,now);
  return {forecast,now,timeline,current,days,airQuality,airQualityBand:aqiBand(airQuality?.aqi),zone:forecast.location?.timeZone||'America/New_York',precipitation:finite(forecast.precipitation?.value)?forecast.precipitation.value:null};
}
export function selectedSample(model,id='now'){
  if(id==='now')return model.current;
  return forecastSample(model.forecast,id);
}
export function stepForSample(model,sample){
  return model.timeline.find(row=>row.id===(sample?.now?'now':sample?.id))||null;
}
export function hourlyRows(model,hours=24){
  const end=model.now+hours*HOUR;
  return model.timeline.filter(row=>row.time<=end).map(row=>({...row,precipitation:row.precip,pop:row.rain}));
}
export function weeklyRows(model){return model.days.map(day=>({...day,time:Date.parse(day.date+'T12:00:00Z')}));}

/** Every source trace uses that exact metric timestamp, including comparison-
 * only sources. Missing fields/horizons are gaps, never zeros or extrapolation. */
export function comparisonRows(forecast,variable='temperature',now=Date.now(),hours=48){
  const rows=forecast.metricForecasts?.series?.[variable]||[];
  const start=Math.floor(now/HOUR)*HOUR,end=start+hours*HOUR;
  return rows.filter(point=>{const time=Date.parse(point.time);return finite(time)&&time>=start&&time<=end;}).map(point=>{
    const out={time:Date.parse(point.time),nourie:finite(point.value)?point.value:null};
    const sources=point.comparisonSources||point.sources||Object.entries(point.sourceValues||{}).map(([id,value])=>({id,value}));
    for(const source of sources)if(source?.id&&source.id!=='nourie')out[source.id]=finite(source.value)?source.value:null;
    return out;
  });
}
export function availableModels(rows){
  const present=new Set(['nourie']);
  for(const row of rows)for(const [key,value]of Object.entries(row))if(key!=='time'&&finite(value))present.add(key);
  return [...Object.keys(MODELS),...present].filter((id,index,all)=>present.has(id)&&all.indexOf(id)===index);
}
export function modelCoverage(rows,id){return {available:rows.filter(row=>finite(row[id])).length,expected:rows.length};}
export function sourceRange(row,ids){
  const values=ids.filter(id=>id!=='nourie').map(id=>row[id]).filter(finite);
  return values.length>=2?{min:Math.min(...values),max:Math.max(...values),sources:values.length}:null;
}

/** Reuse the existing portrait mapping, but let numeric same-hour overcast
 * suppress a sunny photograph. This changes imagery only, never weather data. */
export function portraitForSample(model,sample,exposure='outdoors'){
  if(!sample)return {available:false,reason:'Weather readings unavailable'};
  const step=stepForSample(model,sample),context=comfortArtworkContext(model.forecast,sample,model.now);
  const feels=exposure==='shade'?sample.comfort?.shade:sample.feels;
  const skyCover=finite(step?.skyCover)?step.skyCover:sample.inputs?.skyCover;
  let condition=sample.condition;
  if(finite(skyCover)&&skyCover>=90&&!/rain|shower|drizzle|storm|snow|sleet|ice|fog|mist|haze/i.test(condition))condition='Overcast';
  else if((sample.inputs?.wind>=20||sample.inputs?.gust>=30)&&!/rain|shower|drizzle|storm|snow|sleet|ice|fog/i.test(condition))condition='Windy';
  const row={condition,temperature:sample.temperature,feels,isDay:sample.isDay,skyCover,time:sample.now?model.now:Date.parse(sample.time),rainNow:step?.rainNow};
  const portrait=selectWeatherPortrait(row,{solar:model.forecast.metricForecasts?.solar||[model.forecast.solar]});
  const scene=comfortSceneState(sample.isDay,sample.condition,feels,{...context,pop:sample.pop,rainExpected:sample.rainExpected,rainAround:sample.rainAround,radarThreat:sample.radarThreat});
  const outfit=clothingForFeels(feels,{...context,snowExpected:scene.key==='snow'});
  return {...portrait,clothing:finite(feels)?wearText(scene.key,outfit):'Clothing guidance unavailable',scene:step?skyScene(step):null,context};
}
export function exposureReading(model,sample,mode='sun'){
  const portrait=portraitForSample(model,sample,mode);
  if(!sample)return {value:null,label:'Weather readings unavailable',note:'Choose an available forecast hour.',portrait};
  const comfort=sample.comfort||{};
  if(mode==='pets'){
    const time=sample.now?model.now:Date.parse(sample.time);
    const pavement=pavementEstimate(model.forecast,sample.inputs,time,{...portrait.context,checkedAt:model.now,condition:sample.condition,pop:sample.pop,precipitation:sample.precipitation,rainAround:sample.rainAround,radarThreat:sample.radarThreat});
    return {value:finite(pavement.concrete?.value)?pavement.concrete.value:null,label:pavement.status==='winter'?'Snow & ice paw care':pavement.status==='estimated'?'Concrete surface estimate':'Pavement estimate unavailable',note:pavement.advice||pavement.note||pavement.reason||'Check the actual surface before walking.',clothing:portrait.clothing,portrait,pavement};
  }
  const value=mode==='shade'?comfort.shade:mode==='night'?(sample.isDay===false?sample.feels:null):(sample.isDay===true?comfort.sun:null);
  const label=mode==='shade'?'Feels like in shade':mode==='night'?'Feels like at night':'Feels like in sun';
  const noSun=finite(sample.feels)&&(sample.inputs?.skyCover>=70||['cloudy','rain','storm','snow','fog'].includes(comfort.weatherKind));
  const note=finite(value)?comfortSubtitle(value):mode==='night'?'Select a nighttime hour to see its estimate.':sample.isDay===false?'No direct sun at night.':noSun?'No sun forecast for this hour.':'Sun estimate unavailable: sky or thermal readings are missing.';
  return {value:finite(value)?value:null,label,note,clothing:portrait.clothing,portrait};
}
export function warmestSunText(model){
  const summary=warmestTodayWindow(model.forecast,model.now);
  if(summary)return `Warmest sun feels like from now: ${valueText(summary.chosen.value,'°')} at ${formatTime(Date.parse(summary.chosen.time),model.zone)}${summary.partial?' · partial coverage':''}.`;
  const remaining=model.timeline.filter(row=>row.time>=model.now&&formatTime(row.time,model.zone,{year:'numeric',month:'2-digit',day:'2-digit'})===formatTime(model.now,model.zone,{year:'numeric',month:'2-digit',day:'2-digit'}));
  if(!remaining.length||remaining.some(row=>!finite(row.skyCover)||!finite(row.feels)))return 'Warmest sun feels-like forecast unavailable: some readings are missing.';
  return remaining.some(row=>row.isDay)?'No sun forecast for the rest of today.':'No remaining daylight today.';
}
export function meterReading(model){
  const dewpoint=model.current.inputs?.dewpoint,wind=model.current.inputs?.wind;
  return {value:finite(dewpoint)?dewpoint:null,level:forecastGrossLevel(dewpoint,wind)};
}
