import {displayForecastConfidence} from './forecast-confidence.js?v=ensemble-confidence-v1';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>\"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char]));
const clamp=value=>Math.max(0,Math.min(100,value));
const roundFive=value=>Math.round(clamp(value)/5)*5;

function dayName(day,index,{short=false}={}){
  if(index===0)return 'Today';
  if(index===1)return 'Tomorrow';
  if(/^\d{4}-\d{2}-\d{2}$/.test(day?.date||'')){
    try{return new Intl.DateTimeFormat('en-US',{weekday:short?'short':'long',timeZone:'UTC'}).format(new Date(`${day.date}T12:00:00Z`));}catch{}
  }
  return day?.label||`Day ${index+1}`;
}

function gustValues(day){
  return Object.values(day?.guidance||{}).map(row=>row?.gust).filter(finite);
}

function temperatureChange(day,previous){
  const changes=[];
  if(finite(day?.high)&&finite(previous?.high))changes.push(Math.abs(day.high-previous.high));
  if(finite(day?.low)&&finite(previous?.low))changes.push(Math.abs(day.low-previous.low));
  return changes.length?Math.max(...changes):0;
}

function impacts(day,index,previous){
  const words=`${day?.condition||''} ${day?.nightCondition||''} ${day?.detail||''} ${day?.nightDetail||''}`;
  const winter=Boolean(day?.snowPossible||day?.freezingRainPossible||day?.sleetPossible||/\b(snow|sleet|freezing rain|ice storm|blizzard)\b/i.test(words));
  const storm=/\b(thunder|thunderstorms?|tornado|hurricane|tropical storm|severe)\b/i.test(words);
  const meaningfulRain=(finite(day?.pop)&&day.pop>=60&&finite(day?.qpf)&&day.qpf>=.1)||(finite(day?.qpf)&&day.qpf>=.25);
  const gusts=gustValues(day),peakGust=gusts.length?Math.max(...gusts):null,strongWind=(finite(peakGust)&&peakGust>=40)||/\b(very windy|strong winds?|damaging winds?)\b/i.test(words);
  const swing=temperatureChange(day,previous),largeTemperatureChange=swing>=15;
  const labels={winter:'snow or ice',storm:'storms',rain:'rain',wind:'strong wind',temperature:'temperature swing'};
  const types=[];
  if(winter)types.push('winter');
  else if(storm)types.push('storm');
  else if(meaningfulRain)types.push('rain');
  if(strongWind)types.push('wind');
  if(largeTemperatureChange)types.push('temperature');
  return types.map(type=>{
    let score=type==='winter'?110:type==='storm'?100:type==='rain'?70:type==='wind'?60:50;
    if(type==='rain'||type==='storm')score+=Math.min(35,(finite(day.qpf)?day.qpf:0)*22)+Math.min(20,(finite(day.pop)?day.pop:0)*.2);
    if(type==='wind')score+=Math.min(25,Math.max(0,(peakGust||40)-40));
    if(type==='temperature')score+=Math.min(25,swing-15);
    score-=index*.5;
    return {type,kind:labels[type],score,peakGust,swing};
  });
}

function eventAgreement(dayImpact,components,day){
  if(dayImpact.type==='rain'||dayImpact.type==='storm')return {score:components.rain,why:dayImpact.type==='storm'?'whether the storm setup holds and when the strongest weather arrives':'whether meaningful rain develops and how much falls'};
  if(dayImpact.type==='winter'){
    const values=[components.rain,components.temperature].filter(finite);
    return {score:values.length?Math.min(...values):null,why:'whether snow or ice develops and how much accumulates'};
  }
  if(dayImpact.type==='temperature')return {score:components.temperature,why:'how large the temperature swing will be'};
  const gusts=gustValues(day);
  if(gusts.length<2)return {score:null,why:'how strong the wind will become'};
  const spread=Math.max(...gusts)-Math.min(...gusts);
  return {score:clamp(100-spread*4),why:'how strong the wind will become'};
}

function eventChangeRisk(agreementScore,dayIndex){
  if(!finite(agreementScore))return null;
  return roundFive(100-agreementScore+Math.min(18,dayIndex*3));
}

/** Show a notice only when the forecast's major event is itself unsettled.
 * Uncertainty in an unrelated field never qualifies the event. */
export function lowConfidenceWarning(days,{limit=7,minChangeRisk=35}={}){
  const candidates=[];
  for(const [index,day] of (days||[]).slice(0,limit).entries()){
    const confidence=displayForecastConfidence(day?.confidence);
    if(!confidence)continue;
    for(const dayImpact of impacts(day,index,days[index-1])){
      const event=eventAgreement(dayImpact,confidence.components||{},day),changeRisk=eventChangeRisk(event.score,index);
      if(!finite(changeRisk)||changeRisk<minChangeRisk)continue;
      candidates.push({index,day,confidence,dayImpact,event,changeRisk});
    }
  }
  candidates.sort((a,b)=>b.dayImpact.score-a.dayImpact.score||b.changeRisk-a.changeRisk||a.index-b.index);
  const selected=candidates[0];
  if(!selected)return null;

  const {index,day,dayImpact,event,changeRisk}=selected;
  const label=dayName(day,index),shortLabel=dayName(day,index,{short:true});
  const timing=index<2?'New updates could still change the important details.':`${label} is ${index} days away, so the important details can still shift.`;
  return {
    dayIndex:index,
    dayLabel:label,
    shortDayLabel:shortLabel,
    impactLabel:dayImpact.kind,
    changeRisk,
    title:`${shortLabel} ${dayImpact.kind}`,
    text:`There is an estimated ${changeRisk}% chance the important parts of this forecast will change. The forecast is still uncertain about ${event.why}. ${timing}`,
    method:'Estimated from forecast disagreement about this event and how far away it is. It is not a historically calibrated probability.'
  };
}

export function confidenceWarningHTML(warning){
  if(!warning)return '';
  const riskLevel=warning.changeRisk>=60?'high':warning.changeRisk>=40?'moderate':'low';
  return `<button type="button" class="forecast-confidence-button" data-risk="${riskLevel}" aria-haspopup="dialog" aria-label="${esc(warning.title)}. Estimated ${warning.changeRisk} percent chance the important forecast details change. Tap for details."><span class="forecast-confidence-symbol" aria-hidden="true">≈</span><span class="forecast-confidence-compact-copy"><small>Forecast still uncertain</small><strong>${esc(warning.title)}</strong></span><span class="forecast-confidence-level">${warning.changeRisk}%</span><span class="forecast-confidence-scale" role="meter" aria-label="Estimated chance the important forecast details change" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${warning.changeRisk}" aria-valuetext="${warning.changeRisk} percent change risk"><i style="--confidence-position:${warning.changeRisk}%"></i></span><span class="bar-chevron" aria-hidden="true">›</span></button>`;
}

export function confidenceWarningDetailHTML(warning){
  if(!warning)return '';
  return `<div class="forecast-confidence-detail"><div class="forecast-change-risk"><strong>${warning.changeRisk}%</strong><span>estimated chance the important forecast details change</span></div><p>${esc(warning.text)}</p><small>${esc(warning.method)}</small></div>`;
}
