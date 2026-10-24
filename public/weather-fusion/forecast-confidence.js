export const FORECAST_CONFIDENCE_VERSION='weather-nourie-confidence-split-v7';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const MODERATE_SCORE=70,HIGH_SCORE=85;
/** Main weather labels describe agreement about sky and rain. Retain legacy
 * snapshots as-is instead of relabeling a temperature score as sky agreement. */
export const displayForecastConfidence=confidence=>confidence?.weather??confidence;
export const displayTemperatureConfidence=confidence=>confidence?.temperature??confidence;
export function forecastConfidenceLabel(confidence,compact=false){
 return displayForecastConfidence(confidence)?.scope==='sky-and-rain'?'Sky/rain agreement':compact?'Confidence':'Forecast confidence';
}
// The marker shows the labeled category, not a probability or the raw index.
export function confidenceMeterPosition(confidence){
 if(!finite(confidence?.score))return null;
 return ({'very-low':0,low:0,moderate:50,high:100})[confidence?.key]??null;
}
/** Relative forecast-confidence index, deliberately NOT a probability.
 * Inputs are scientific forecast-quality signals already available in the app:
 * lead time, simultaneous temperature spread, liquid-precipitation spread,
 * source coverage and availability of matching official NWS temperatures. */
export function forecastConfidence({dayIndex=0,highSpread=null,temperatureSpreadBasis='daily-high',temperatureOutlierHours=0,qpfSpread=null,guidanceCount=0,sourceIds=null,officialDay=false,officialNight=false,officialCoverage=null,temperatureCoverage=null,rainCoverage=null,temperatureSourceCount=null,rainSourceCount=null,rainFallback=false}={}){
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
 const uncappedScore=clamp(Math.round(raw/5)*5,35,100);
 const evidenceScore=Math.min(uncappedScore,incomplete?65:limited?80:100);
 // Missing coverage must not turn otherwise Moderate/High same-day evidence
 // into Low. This guard never lifts genuine temperature/rain disagreement and
 // never creates a rating without at least two contributing sources.
 const comparable=(sourceIds?.length??guidanceCount)>=2;
 const sameDayCoverageFloorApplied=dayIndex===0&&comparable&&incomplete&&evidenceScore<MODERATE_SCORE&&uncappedScore>=MODERATE_SCORE;
 const score=sameDayCoverageFloorApplied?MODERATE_SCORE:evidenceScore;
 const label=score>=HIGH_SCORE?'High':score>=MODERATE_SCORE?'Moderate':score>=55?'Low':'Very low';
 const key=label.toLowerCase().replace(/\s+/g,'-');
 const factors=[];
 factors.push(dayIndex===0?'same-day lead time':`${dayIndex}-day lead time`);
 factors.push(finite(highSpread)?`${highSpread.toFixed(1)}°F ${temperatureSpreadBasis==='peer-consensus'?'largest hourly gap among the main temperature sources':temperatureSpreadBasis==='same-day-average'?'average same-hour temperature gap':temperatureSpreadBasis==='same-hour'?'maximum same-hour temperature gap':'daily-high temperature spread'}`:'limited temperature comparison');
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
 if(temperaturePenalty>0&&finite(highSpread))reasons.push(temperatureSpreadBasis==='peer-consensus'?`Main temperature forecasts differ by up to ${highSpread.toFixed(1)}°F.`:temperatureSpreadBasis==='same-day-average'?`Same-hour temperature forecasts differ by ${highSpread.toFixed(1)}°F on average across the remaining day.`:temperatureSpreadBasis==='same-hour'?`Hourly temperature forecasts differ by up to ${highSpread.toFixed(1)}°F, including overnight hours.`:`Forecast daily highs differ by ${highSpread.toFixed(1)}°F.`);
 if(precipitationPenalty>0&&finite(qpfSpread))reasons.push(`Rainfall guidance differs by ${qpfSpread.toFixed(2)} inches.`);
 if(!finite(highSpread)&&temperatureCoverage!==false)reasons.push('Temperature agreement cannot be compared.');
 if(!finite(qpfSpread)&&rainCoverage!==false)reasons.push('Rainfall agreement cannot be compared.');
 if(leadPenalty)reasons.push(`This forecast is ${dayIndex} day${dayIndex===1?'':'s'} away.`);
 if(officialPenalty&&finite(officialCoverage))reasons.push(officialCoverage>0?'Official NWS temperatures cover only part of these hours.':'Official NWS hourly temperatures are unavailable.');
 if(temperatureOutlierHours>0){factors.push(`Isolated temperature outlier downweighted in ${temperatureOutlierHours} hour${temperatureOutlierHours===1?'':'s'}`);reasons.push('An isolated temperature forecast has reduced influence; its removed weight goes to ECMWF.');}
 if(rainFallback)factors.push('Official NWS rain fallback; unavailable models do not establish agreement');
 if(temperatureCoverage===false||rainCoverage===false)factors.push('Incomplete hourly coverage');
 if(sameDayCoverageFloorApplied)factors.push(`A missing interval cannot lower otherwise Moderate or High same-day evidence below Moderate; the coverage-limited score is ${evidenceScore}`);
 const summary=reasons.length?reasons.join(' '):'Forecast sources agree closely for these hours.';
 const comparisonNote=temperatureSpreadBasis==='same-day-average'
  ?'Today uses the average timestamp-matched temperature gap across the remaining hours; the largest gap and daily-high range remain disclosed separately.'
  :'A daily-high range and a same-hour temperature gap describe different comparisons.';
 return {version:FORECAST_CONFIDENCE_VERSION,score,evidenceScore,uncappedScore,sameDayCoverageFloorApplied,label,key,factors,reasons,summary,temperatureSpreadBasis,temperatureOutlierHours,sourceIds,sourceCount:sourceIds?.length??guidanceCount,
   note:`Relative confidence index, not a probability or a measured accuracy percentage. It considers temperature agreement, rainfall agreement, lead time and missing inputs. Missing coverage cannot turn otherwise Moderate or High same-day evidence into Low; genuine disagreement is not raised. ${comparisonNote}`};
}

const evidenceNames={nws:'NWS',hrrr:'HRRR',ecmwf:'ECMWF',nbm:'NBM',wn:'Google WeatherNext',weathernext3:'WeatherNext 3',gefs:'GEFS'};
const escapeEvidence=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function evidenceTime(value,timeZone){
 const epoch=Date.parse(value);if(!finite(epoch))return null;
 try{return new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(epoch));}catch{return null;}
}
// Show enough precision that rounding cannot create an apparent gap mismatch.
export function temperatureRangePrecision(range){
 const target=Number(range.spread.toFixed(1));
 for(let p=1;p<5;p++)if(Number((Number(range.high.value.toFixed(p))-Number(range.low.value.toFixed(p))).toFixed(1))===target)return p;
 return 5;
}
function validEvidenceRange(range){return range&&finite(range.spread)&&range.spread>=0&&finite(range.low?.value)&&finite(range.high?.value)&&range.high.value>=range.low.value&&Math.abs(Number((range.high.value-range.low.value).toFixed(1))-range.spread)<0.00001;}
/** The confidence gap and the chart's daily highs share this forecast snapshot. */
export function confidenceTemperatureEvidenceHTML(confidence,{timeZone='America/New_York',assembledAt=null,temperatureRating=false}={}){
 const comparison=confidence?.temperatureComparison;if(comparison?.basis!=='maximum-same-hour-spread')return '';
 const worst=comparison.worstHour,daily=comparison.dailyHigh,rating=comparison.confidenceHour;
 const stamp=worst&&evidenceTime(worst.time,timeZone),updated=evidenceTime(assembledAt,timeZone);
 const hasHour=validEvidenceRange(worst)&&stamp,hasHigh=validEvidenceRange(daily);
 const adjusted=(comparison.adjustments||[]).length>0,averaged=String(comparison.confidenceBasis||'').startsWith('same-day-average')&&finite(comparison.averageHourlySpread),hasRating=adjusted&&validEvidenceRange(rating)&&evidenceTime(rating.time,timeZone);
 if(!hasHour&&!hasHigh&&!(daily?.sources||[]).some(row=>finite(row.value)))return '<section class="confidence-temperature-evidence"><p>Temperature comparison evidence is unavailable for this update.</p></section>';
 const hourPrecision=hasHour?temperatureRangePrecision(worst):1,highPrecision=hasHigh?temperatureRangePrecision(daily):1;
 const describe=(range,p)=>`${range.low.value.toFixed(p)}–${range.high.value.toFixed(p)}°F`;
 const dailyRows=new Map((daily?.sources||[]).map(row=>[row.id,row]));
 const sourceTable=(hour,{primary=true}={})=>{
  const rowsAtHour=hour?.allSources||hour?.sources||[],hourRows=new Map(rowsAtHour.map(row=>[row.id,row]));
  const ids=[...new Set([...dailyRows.keys(),...hourRows.keys()])],precision=validEvidenceRange(hour)?temperatureRangePrecision(hour):hourPrecision;
  const rows=ids.map(id=>{
   const a=dailyRows.get(id),b=hourRows.get(id),before=finite(b?.baseWeight)?b.baseWeight:finite(b?.receivedTemperatureWeight)?b.weight-b.receivedTemperatureWeight:null;
   const weight=finite(b?.weight)?`${(b.weight*100).toFixed(1)}%${finite(before)?`<small>was ${(before*100).toFixed(1)}%</small>`:''}`:'Unavailable';
   return `<tr ${primary?'data-confidence-source':'data-confidence-rated-source'}="${escapeEvidence(id)}"><th scope="row">${escapeEvidence(evidenceNames[id]||id)}${adjusted&&b?.temperatureOutlier?'<small>reduced weight</small>':''}</th><td>${finite(a?.value)?`${a.value.toFixed(highPrecision)}°`:'Unavailable'}</td><td>${finite(b?.value)?`${b.value.toFixed(precision)}°`:'Unavailable'}</td>${adjusted?`<td class="confidence-temperature-weight">${weight}</td>`:''}</tr>`;
  }).join('');
  const time=hour&&evidenceTime(hour.time,timeZone);
  return rows?`<div class="confidence-temperature-scroll ${primary?'confidence-temperature-primary':'confidence-temperature-rating'}"><table><caption>${time?`Model readings at ${escapeEvidence(time)}`:'Model daily highs'}</caption><thead><tr><th scope="col">Source</th><th scope="col">Daily high</th><th scope="col">${time?'At that hour':'Hourly'}</th>${adjusted?'<th scope="col">Weight</th>':''}</tr></thead><tbody>${rows}</tbody></table></div>`:'';
 };
 const ratingText=averaged?`<p data-confidence-used-gap>Average same-hour gap used for ${temperatureRating?'today\u2019s temperature rating':'today\u2019s confidence'}: <strong>${comparison.averageHourlySpread.toFixed(1)}°F</strong>.</p>`:hasRating?`<p data-confidence-used-gap>Gap used for ${temperatureRating?'temperature rating':'confidence'}: <strong>${rating.spread.toFixed(1)}°F</strong> at <strong>${escapeEvidence(hasRating)}</strong> (${describe(rating,temperatureRangePrecision(rating))}).</p>`:'';
 const explanation=adjusted&&averaged?`Today\u2019s rating averages the timestamp-matched peer gaps across the remaining forecast hours so one hour does not determine the whole day. At each adjusted hour, an isolated temperature forecast keeps 10% of its original weight and the other 90% goes to ECMWF. All original readings and the largest full-model gap remain visible.`:adjusted?`An isolated temperature forecast keeps 10% of its original weight; the other 90% goes to ECMWF. For each affected hour, ${temperatureRating?'temperature confidence':'confidence'} compares the agreeing group. All original model readings remain visible.`:averaged?`Today\u2019s rating averages the timestamp-matched model gaps across the remaining forecast hours so one hour does not determine the whole day. The largest same-hour gap remains visible above.`:`${temperatureRating?'Temperature confidence':'Confidence'} checks hourly differences, including overnight. The model chart compares daily highs.`;
 const weightChanges=adjusted?`<details class="confidence-weight-changes"><summary>Reduced temperature weights (${comparison.adjustments.length} hour${comparison.adjustments.length===1?'':'s'})</summary>${comparison.adjustments.map(row=>`<p>${escapeEvidence(evidenceTime(row.time,timeZone)||row.time)} · ${escapeEvidence(evidenceNames[row.sourceId]||row.sourceId)}: <strong>${(row.baseWeight*100).toFixed(1)}% → ${(row.weight*100).toFixed(1)}%</strong><small>${(row.transferredWeight*100).toFixed(1)} percentage points transferred to ECMWF.</small></p>`).join('')}</details>`:'';
 const ratingTable=hasRating&&rating.time!==worst?.time?`<details class="confidence-rating-values"><summary>Readings used for confidence</summary>${sourceTable(rating,{primary:false})}</details>`:'';
 return `<section class="confidence-temperature-evidence" data-temperature-basis="${averaged?(adjusted?'same-day-average-peer-consensus':'same-day-average'):adjusted?'peer-consensus':'same-hour'}"><h3>Temperature agreement</h3><p data-confidence-daily-high>${hasHigh?`Daily highs from included sources: <strong>${describe(daily,highPrecision)}</strong> · ${daily.spread.toFixed(1)}°F apart.`:'Daily-high comparison is unavailable.'}</p><p data-confidence-hourly-gap>${hasHour?`${adjusted?'Full model gap':'Largest same-hour gap'}: <strong>${worst.spread.toFixed(1)}°F</strong> at <strong>${escapeEvidence(stamp)}</strong> (${describe(worst,hourPrecision)}).`:'Same-hour comparison is unavailable.'}</p>${ratingText}<p>${explanation}</p>${sourceTable(worst)}${ratingTable}${weightChanges}${updated?`<small>Forecast updated ${escapeEvidence(updated)}.</small>`:''}</section>`;
}

export function confidenceWeatherEvidenceHTML(confidence,{timeZone='America/New_York'}={}){
 const weather=displayForecastConfidence(confidence),evidence=weather?.evidence;
 if(weather?.scope!=='sky-and-rain'||!evidence)return '';
 const names=ids=>(ids||[]).map(id=>evidenceNames[id]||id).join(', ');
 const coverage=(kind,label)=>{
  const item=evidence[kind];if(!item)return `<li>${label}: comparison unavailable.</li>`;
  const count=item.completeSources?.length||0,scope=kind==='sky'?(item.scope==='remaining-night'?'remaining night hours':'daylight hours'):'hours through local midnight';
  const compared=finite(item.comparedHours)?item.comparedHours:item.coveredHours;
  const hours=finite(compared)&&finite(item.expectedHours)?`${compared} of ${item.expectedHours} ${scope} have comparisons`:'hourly coverage unavailable';
  return `<li><strong>${label}:</strong> ${escapeEvidence(hours)}. ${count} source${count===1?'':'s'} cover every hour${count?` (${escapeEvidence(names(item.completeSources))})`:''}.</li>`;
 };
 const category=value=>({clear:'Clear / mostly clear',mixed:'Mixed cloud',cloudy:'Mostly cloudy / overcast',dry:'Dry',trace:'Trace',wet:'Wet',split:'Models differ'}[value]||'Unavailable');
 const table=(kind,label)=>{
  const hour=evidence[kind]?.worstHour,time=evidenceTime(hour?.time,timeZone);
  if(!time||!hour.sources?.length)return '';
  const reading=value=>!finite(value)?'Unavailable':kind==='sky'?`${value.toFixed(1)}%`:value>0&&value<.001?'under 0.001':value.toFixed(3);
  const rows=hour.sources.map(row=>`<tr data-weather-source="${escapeEvidence(row.id)}"><th scope="row">${escapeEvidence(evidenceNames[row.id]||row.id)}</th><td>${escapeEvidence(reading(row.value))}</td><td>${escapeEvidence(category(row.category))}</td></tr>`).join('');
  return `<div class="confidence-weather-source-table"><table><caption>${label} comparison · ${escapeEvidence(time)}</caption><thead><tr><th scope="col">Source</th><th scope="col">${kind==='sky'?'Cloud cover':'Rain (in/hr)'}</th><th scope="col">Category</th></tr></thead><tbody>${rows}</tbody></table>${kind==='rain'&&hour.probabilityConflict?'<p>The official rain chance conflicts with the model wet/dry signals at this hour.</p>':''}</div>`;
 };
 const sourceTables=table('sky','Sky')+table('rain','Rain');
 return `<section class="confidence-weather-evidence"><h3>What the models agree on</h3><ul>${coverage('sky','Sky')}${coverage('rain','Rain')}</ul><p>These comparisons describe sky and precipitation. Temperature disagreement is rated separately below.</p>${sourceTables?`<details class="confidence-weather-readings"><summary>Compare sky and rain readings</summary>${sourceTables}</details>`:''}</section>`;
}

export function confidenceDetailsHTML(confidence,options={}){
 if(!confidence)return '';
 const primary=displayForecastConfidence(confidence),temperature=displayTemperatureConfidence(confidence),split=primary?.scope==='sky-and-rain';
 const factors=c=>Array.isArray(c?.factors)&&c.factors.length?`<p>${escapeEvidence(c.factors.join(' · '))}</p>`:'';
 const summary=c=>c?.summary?`<p>${escapeEvidence(c.summary)}</p>`:'';
 const note=c=>c?.note?`<small>${escapeEvidence(c.note)}</small>`:'';
 const temperatureSection=split?`<section class="dialog-temperature-confidence" data-confidence="${escapeEvidence(temperature?.key||'unavailable')}"><h3>Temperature confidence: ${escapeEvidence(temperature?.label||'Unavailable')}</h3>${summary(temperature)}${confidenceTemperatureEvidenceHTML(temperature,{...options,temperatureRating:true})}${factors(temperature)}${note(temperature)}</section>`:confidenceTemperatureEvidenceHTML(confidence,options);
 return `<details class="dialog-confidence" data-confidence="${escapeEvidence(primary?.key||'unavailable')}" data-confidence-scope="${split?'sky-and-rain':'legacy'}"><summary>${forecastConfidenceLabel(confidence)}: ${escapeEvidence(primary?.label||'Unavailable')} · ${primary?.sourceCount??'?'} source${primary?.sourceCount===1?'':'s'}</summary>${summary(primary)}${split?confidenceWeatherEvidenceHTML(primary,options):''}${factors(primary)}${note(primary)}${temperatureSection}</details>`;
}
