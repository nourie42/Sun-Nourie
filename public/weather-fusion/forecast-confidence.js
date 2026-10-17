export const FORECAST_CONFIDENCE_VERSION='weather-nourie-confidence-calendar-inputs-v3';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const MODERATE_SCORE=70,HIGH_SCORE=85;
// The marker shows the labeled category, not a probability or the raw index.
export function confidenceMeterPosition(confidence){
 if(!finite(confidence?.score))return null;
 return ({'very-low':0,low:0,moderate:50,high:100})[confidence?.key]??null;
}
/** Relative forecast-confidence index, deliberately NOT a probability.
 * Inputs are scientific forecast-quality signals already available in the app:
 * lead time, simultaneous temperature spread, liquid-precipitation spread,
 * source coverage and availability of matching official NWS temperatures. */
export function forecastConfidence({dayIndex=0,highSpread=null,qpfSpread=null,guidanceCount=0,sourceIds=null,officialDay=false,officialNight=false,officialCoverage=null,temperatureCoverage=null,rainCoverage=null,temperatureSourceCount=null,rainSourceCount=null,rainFallback=false}={}){
 const leadPenalty=clamp(dayIndex,0,6)*5;
 const temperaturePenalty=!finite(highSpread)?12:highSpread<=2?0:highSpread<=4?5:highSpread<=7?12:22;
 const precipitationPenalty=!finite(qpfSpread)?5:qpfSpread<=.05?0:qpfSpread<=.15?3:qpfSpread<=.35?7:12;
 const guidancePenalty=guidanceCount>=3?0:guidanceCount===2?4:guidanceCount===1?10:18;
 const officialPenalty=finite(officialCoverage)?officialCoverage>=1?0:officialCoverage>0?5:12:officialDay&&officialNight?0:officialDay||officialNight?5:12;
 const raw=100-leadPenalty-temperaturePenalty-precipitationPenalty-guidancePenalty-officialPenalty;
 // Agreement cannot be measured from one source, or inferred across missing
 // hours. Keep the established scoring thresholds while limiting unsupported
 // confidence claims. An official rain fallback is not model corroboration.
 const incomplete=temperatureCoverage===false||rainCoverage===false;
 const limited=(finite(temperatureSourceCount)&&temperatureSourceCount<2)||(finite(rainSourceCount)&&rainSourceCount<2)||rainFallback;
 const score=Math.min(clamp(Math.round(raw/5)*5,35,100),incomplete?65:limited?80:100);
 const label=score>=HIGH_SCORE?'High':score>=MODERATE_SCORE?'Moderate':score>=55?'Low':'Very low';
 const key=label.toLowerCase().replace(/\s+/g,'-');
 const factors=[];
 factors.push(dayIndex===0?'same-day lead time':`${dayIndex}-day lead time`);
 factors.push(finite(highSpread)?`${highSpread.toFixed(1)}°F temperature spread for the displayed hours`:'limited temperature comparison');
 factors.push(finite(qpfSpread)?`${qpfSpread.toFixed(2)} in rainfall-guidance spread`:'limited rainfall comparison');
 factors.push(sourceIds?`${sourceIds.length} forecast source${sourceIds.length===1?'':'s'}: ${sourceIds.map(id=>id.toUpperCase()).join(', ')}`:`${guidanceCount} usable model source${guidanceCount===1?'':'s'}`);
 if(finite(temperatureSourceCount)&&finite(rainSourceCount))factors.push(`${temperatureSourceCount} temperature sources and ${rainSourceCount} rainfall sources cover all of these hours`);
 factors.push(finite(officialCoverage)?officialCoverage>=1?'NWS hourly temperatures cover this date':officialCoverage>0?'NWS hourly temperatures cover part of this date':'NWS hourly temperatures unavailable':officialDay&&officialNight?'NWS day and night periods available':officialDay||officialNight?'one NWS period available':'NWS day/night period unavailable');
 const reasons=[];
 if(temperatureCoverage===false)reasons.push('Some temperature forecast hours are missing.');
 if(rainCoverage===false)reasons.push('Some rain forecast hours are missing.');
 if(rainFallback)reasons.push('Rain-model inputs are missing, so rain chances use the official NWS forecast.');
 if(finite(temperatureSourceCount)&&temperatureSourceCount<2)reasons.push('Fewer than two temperature sources cover all of these hours.');
 if(finite(rainSourceCount)&&rainSourceCount<2)reasons.push('Fewer than two rainfall sources cover all of these hours.');
 if(temperaturePenalty>0&&finite(highSpread))reasons.push(`Temperature guidance differs by up to ${highSpread.toFixed(1)}°F.`);
 if(precipitationPenalty>0&&finite(qpfSpread))reasons.push(`Rainfall guidance differs by ${qpfSpread.toFixed(2)} inches.`);
 if(!finite(highSpread)&&temperatureCoverage!==false)reasons.push('Temperature agreement cannot be compared.');
 if(!finite(qpfSpread)&&rainCoverage!==false)reasons.push('Rainfall agreement cannot be compared.');
 if(leadPenalty)reasons.push(`This forecast is ${dayIndex} day${dayIndex===1?'':'s'} away.`);
 if(officialPenalty&&finite(officialCoverage))reasons.push(officialCoverage>0?'Official NWS temperatures cover only part of these hours.':'Official NWS hourly temperatures are unavailable.');
 if(rainFallback)factors.push('Official NWS rain fallback; unavailable models do not establish agreement');
 if(temperatureCoverage===false||rainCoverage===false)factors.push('Incomplete hourly coverage');
 const summary=reasons.length?reasons.join(' '):'Forecast sources agree closely for these hours.';
 return {version:FORECAST_CONFIDENCE_VERSION,score,label,key,factors,reasons,summary,sourceIds,sourceCount:sourceIds?.length??guidanceCount,
   note:'Relative confidence index, not a probability or a measured accuracy percentage. It compares the sources for the same forecast hours and accounts for lead time and missing inputs.'};
}
