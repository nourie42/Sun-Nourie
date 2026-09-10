export const FORECAST_CONFIDENCE_VERSION='weather-nourie-confidence-actual-blend-v2';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/** Relative forecast-confidence index, deliberately NOT a probability.
 * Inputs are scientific forecast-quality signals already available in the app:
 * lead time, temperature spread, liquid-precipitation spread, number of usable
 * model guidance sources, and whether official NWS day/night periods exist. */
export function forecastConfidence({dayIndex=0,highSpread=null,qpfSpread=null,guidanceCount=0,sourceIds=null,officialDay=false,officialNight=false}={}){
 const leadPenalty=clamp(dayIndex,0,6)*5;
 const temperaturePenalty=!finite(highSpread)?12:highSpread<=2?0:highSpread<=4?5:highSpread<=7?12:22;
 const precipitationPenalty=!finite(qpfSpread)?5:qpfSpread<=.05?0:qpfSpread<=.15?3:qpfSpread<=.35?7:12;
 const guidancePenalty=guidanceCount>=3?0:guidanceCount===2?4:guidanceCount===1?10:18;
 const officialPenalty=officialDay&&officialNight?0:officialDay||officialNight?5:12;
 const raw=100-leadPenalty-temperaturePenalty-precipitationPenalty-guidancePenalty-officialPenalty;
 const score=clamp(Math.round(raw/5)*5,35,100);
 const label=score>=85?'High':score>=70?'Moderate':score>=55?'Low':'Very low';
 const key=label.toLowerCase().replace(/\s+/g,'-');
 const factors=[];
 factors.push(dayIndex===0?'same-day lead time':`${dayIndex}-day lead time`);
 factors.push(finite(highSpread)?`${highSpread.toFixed(1)}°F high-temperature spread`:'limited temperature comparison');
 factors.push(finite(qpfSpread)?`${qpfSpread.toFixed(2)} in rainfall-guidance spread`:'limited rainfall comparison');
 factors.push(sourceIds?`${sourceIds.length} forecast sources: ${sourceIds.map(id=>id.toUpperCase()).join(', ')}`:`${guidanceCount} usable model source${guidanceCount===1?'':'s'}`);
 factors.push(officialDay&&officialNight?'NWS day and night periods available':officialDay||officialNight?'one NWS period available':'NWS day/night period unavailable');
 return {version:FORECAST_CONFIDENCE_VERSION,score,label,key,factors,sourceIds,sourceCount:sourceIds?.length??guidanceCount,
   note:'Relative confidence index, not a probability. It decreases with lead time and forecast spread, and can improve on a later day when guidance agrees better.'};
}
