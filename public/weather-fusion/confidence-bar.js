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

function temperatureChange(day,previous){
  const changes=[];
  if(finite(day?.high)&&finite(previous?.high))changes.push(Math.abs(day.high-previous.high));
  if(finite(day?.low)&&finite(previous?.low))changes.push(Math.abs(day.low-previous.low));
  return changes.length?Math.max(...changes):0;
}

function eventChangeRisk(agreementScore,dayIndex){
  if(!finite(agreementScore))return null;
  return roundFive(100-agreementScore+Math.min(18,dayIndex*3));
}

function rainEvidence(day,index,components){
  const peak=day?.rainLikelihood?.peak||day?.popDayLikelihood?.peak||{};
  const wet=new Set(peak.wetSources||[]),dry=new Set(peak.drySources||[]);
  for(const [id,value] of Object.entries(peak.sourceValues||{})){
    if(!finite(value))continue;
    if(id==='nws'||id==='nbm'){
      if(value>=60)wet.add(id);
      else if(value<=20)dry.add(id);
    }else if(value>=80)wet.add(id);
    else if(value<=20)dry.add(id);
  }
  for(const id of wet)dry.delete(id);
  const split=wet.size>0&&dry.size>0&&wet.size+dry.size>=3&&(wet.size>=2||dry.size>=2);

  const sourceAmounts=day?.fullWindowQpf?.sourceValues||day?.qpfBlend?.sourceValues;
  const amounts=sourceAmounts
    ?Object.values(sourceAmounts).filter(finite)
    :Object.values(day?.guidance||{}).map(row=>row?.qpf).filter(finite);
  const maximum=amounts.length?Math.max(...amounts):0,minimum=amounts.length?Math.min(...amounts):0;
  const range=maximum-minimum;
  const amountSplit=amounts.length>=3&&maximum>=.25&&range>=.25&&maximum>=Math.max(.01,minimum)*1.75;

  let changeRisk=null,reason='',kind='',priority=0;
  if(split){
    changeRisk=eventChangeRisk(components.rain,index)??roundFive(45+Math.min(18,index*3));
    reason='whether it rains enough to matter';
    kind='rain chance';
    priority=95;
  }else if(amountSplit){
    changeRisk=roundFive(25+Math.min(35,(range/maximum)*40)+Math.min(18,index*3));
    reason='how much rain will fall';
    kind='rain amount';
    priority=85;
  }else{
    const meaningful=(finite(day?.pop)&&day.pop>=60&&finite(day?.qpf)&&day.qpf>=.1)||(finite(day?.qpf)&&day.qpf>=.25);
    const risk=meaningful?eventChangeRisk(components.rain,index):null;
    if(finite(risk)&&risk>=35){changeRisk=risk;reason='whether the expected rain develops and how much falls';kind='rain';priority=90;}
  }
  return finite(changeRisk)?{type:'rain',kind,reason,priority,changeRisk,split,amountSplit}:null;
}

function hazardousWindEvidence(day,index){
  const words=`${day?.condition||''} ${day?.nightCondition||''} ${day?.detail||''} ${day?.nightDetail||''}`;
  const explicit=/\b(damaging winds?|high wind|wind (?:warning|watch|advisory)|severe winds?)\b/i.test(words);
  const officialSpeeds=[...`${day?.wind||''} ${day?.detail||''} ${day?.nightDetail||''}`.matchAll(/(\d+(?:\.\d+)?)\s*mph/gi)].map(match=>Number(match[1])).filter(finite);
  const officialHazard=officialSpeeds.some(value=>value>=45);
  const supportedGusts=Object.values(day?.guidance||{}).filter(row=>finite(row?.gust)&&(!finite(row?.coverageHours)||row.coverageHours>=12)).map(row=>row.gust);
  const multiSourceHazard=supportedGusts.filter(value=>value>=45).length>=2;
  if(!explicit&&!officialHazard&&!multiSourceHazard)return null;
  if(supportedGusts.length<2)return null;
  const spread=Math.max(...supportedGusts)-Math.min(...supportedGusts),agreement=clamp(100-spread*4),changeRisk=eventChangeRisk(agreement,index);
  return finite(changeRisk)&&changeRisk>=35?{type:'wind',kind:'hazardous wind',reason:'whether winds become hazardous and how strong the worst gusts will be',priority:75,changeRisk}:null;
}

function dayCandidates(day,index,previous,components){
  const result=[],words=`${day?.condition||''} ${day?.nightCondition||''} ${day?.detail||''} ${day?.nightDetail||''}`;
  const winter=Boolean(day?.snowPossible||day?.freezingRainPossible||day?.sleetPossible||/\b(snow|sleet|freezing rain|ice storm|blizzard)\b/i.test(words));
  if(winter){
    const values=[components.rain,components.temperature].filter(finite),risk=eventChangeRisk(values.length?Math.min(...values):null,index);
    if(finite(risk)&&risk>=35)result.push({type:'winter',kind:'snow or ice',reason:'whether snow or ice develops and how much accumulates',priority:120,changeRisk:risk});
  }

  const rain=rainEvidence(day,index,components);
  if(rain){
    const storm=/\b(thunder|thunderstorms?|tornado|hurricane|tropical storm|severe)\b/i.test(words);
    result.push(storm?{...rain,type:'storm',kind:'storms',reason:rain.split?'whether storms and steady rain develop':'how much rain the storm will bring',priority:110}:rain);
  }

  const swing=temperatureChange(day,previous),spread=Math.max(finite(day?.highSpread)?day.highSpread:0,finite(day?.lowSpread)?day.lowSpread:0);
  if(swing>=15||spread>=12){
    const risk=eventChangeRisk(components.temperature,index);
    if(finite(risk)&&risk>=35)result.push({type:'temperature',kind:swing>=15?'temperature swing':'temperature forecast',reason:swing>=15?'how sharp the temperature change will be':'how warm or cold it will get',priority:80,changeRisk:risk});
  }

  const wind=hazardousWindEvidence(day,index);
  if(wind)result.push(wind);
  return result;
}

function warningItem(candidate,day,index){
  const dayLabel=dayName(day,index),shortDayLabel=dayName(day,index,{short:true});
  const timing=index===1?'New updates could still change this.':`${dayLabel} is ${index} days away, so this can still shift.`;
  return {
    ...candidate,dayIndex:index,dayLabel,shortDayLabel,
    title:`${shortDayLabel} ${candidate.kind}`,
    text:`There is an estimated ${candidate.changeRisk}% chance this important part of the forecast will change. It is still uncertain ${candidate.reason}. ${timing}`
  };
}

/** Find the most important unsettled future-day events. Unrelated fields and
 * isolated wind outliers cannot create a notice. */
export function lowConfidenceWarning(days,{limit=5,minChangeRisk=35,maxItems=3}={}){
  const candidates=[];
  for(const [index,day] of (days||[]).slice(0,limit).entries()){
    if(index===0)continue;
    const confidence=displayForecastConfidence(day?.confidence);
    if(!confidence)continue;
    const perDay=dayCandidates(day,index,days[index-1],confidence.components||{}).filter(item=>item.changeRisk>=minChangeRisk);
    perDay.sort((a,b)=>b.priority-a.priority||b.changeRisk-a.changeRisk);
    if(perDay[0])candidates.push(warningItem(perDay[0],day,index));
  }
  candidates.sort((a,b)=>b.priority-a.priority||a.dayIndex-b.dayIndex||b.changeRisk-a.changeRisk);
  const items=candidates.slice(0,maxItems);
  if(!items.length)return null;
  const highestRisk=Math.max(...items.map(item=>item.changeRisk)),primary=items[0],multiple=items.length>1;
  return {
    items,changeRisk:highestRisk,
    title:multiple?`${items.length} important days`:primary.title,
    dayLabel:multiple?`${items.length} days`:primary.dayLabel,
    modalTitle:multiple?`Forecast confidence · ${items.length} days`:`Forecast confidence · ${primary.dayLabel}`,
    method:'Each percentage is estimated from disagreement about that specific event and how far away it is. These are not historically calibrated probabilities.'
  };
}

export function confidenceWarningHTML(warning){
  if(!warning)return '';
  const riskLevel=warning.changeRisk>=60?'high':warning.changeRisk>=40?'moderate':'low';
  const level=warning.items?.length>1?`Up to ${warning.changeRisk}%`:`${warning.changeRisk}%`;
  return `<button type="button" class="forecast-confidence-button" data-risk="${riskLevel}" aria-haspopup="dialog" aria-label="${esc(warning.title)}. ${esc(level)} estimated change risk. Tap for details."><span class="forecast-confidence-symbol" aria-hidden="true">≈</span><span class="forecast-confidence-compact-copy"><small>Forecast still uncertain</small><strong>${esc(warning.title)}</strong></span><span class="forecast-confidence-level">${esc(level)}</span><span class="forecast-confidence-scale" role="meter" aria-label="Highest estimated chance an important forecast detail changes" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${warning.changeRisk}" aria-valuetext="${warning.changeRisk} percent maximum change risk"><i style="--confidence-position:${warning.changeRisk}%"></i></span><span class="bar-chevron" aria-hidden="true">›</span></button>`;
}

export function confidenceWarningDetailHTML(warning){
  if(!warning)return '';
  const items=warning.items?.length?warning.items:[warning];
  return `<div class="forecast-confidence-detail"><p class="forecast-confidence-intro">These are the most important unsettled parts of the next seven days.</p><div class="forecast-confidence-list">${items.map(item=>`<section class="forecast-confidence-item"><div class="forecast-confidence-item-head"><strong>${esc(item.dayLabel)} · ${esc(item.kind)}</strong><b>${item.changeRisk}%</b></div><p>${esc(item.text)}</p></section>`).join('')}</div><small>${esc(warning.method)}</small></div>`;
}
