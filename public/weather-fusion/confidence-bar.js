import {displayForecastConfidence} from './forecast-confidence.js?v=ensemble-confidence-v1';

const LOW_KEYS=new Set(['low','very-low']);
const DETAILS=[
  {key:'rain',label:'rain'},
  {key:'temperature',label:'temperatures'},
  {key:'sky',label:'cloud cover'}
];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>\"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char]));
const clamp=value=>Math.max(0,Math.min(100,Math.round(value)));

function dayName(day,index,{short=false}={}){
  if(index===0)return 'Today';
  if(index===1)return 'Tomorrow';
  if(/^\d{4}-\d{2}-\d{2}$/.test(day?.date||'')){
    try{return new Intl.DateTimeFormat('en-US',{weekday:short?'short':'long',timeZone:'UTC'}).format(new Date(`${day.date}T12:00:00Z`));}catch{}
  }
  return day?.label||`Day ${index+1}`;
}

function listWords(words){
  if(words.length<2)return words[0]||'the details';
  if(words.length===2)return `${words[0]} and ${words[1]}`;
  return `${words.slice(0,-1).join(', ')}, and ${words.at(-1)}`;
}

function levelFor(score){
  if(!finite(score))return 'Unavailable';
  return score>=85?'High':score>=70?'Moderate':'Low';
}

function strongestGust(day){
  const values=Object.values(day?.guidance||{}).map(row=>row?.gust).filter(finite);
  return values.length?Math.max(...values):null;
}

function temperatureChange(day,previous){
  const changes=[];
  if(finite(day?.high)&&finite(previous?.high))changes.push(Math.abs(day.high-previous.high));
  if(finite(day?.low)&&finite(previous?.low))changes.push(Math.abs(day.low-previous.low));
  return changes.length?Math.max(...changes):0;
}

function impact(day,index,previous){
  const words=`${day?.condition||''} ${day?.nightCondition||''} ${day?.detail||''} ${day?.nightDetail||''}`;
  const winter=Boolean(day?.snowPossible||day?.freezingRainPossible||day?.sleetPossible||/\b(snow|sleet|freezing rain|ice storm|blizzard)\b/i.test(words));
  const storm=/\b(thunder|thunderstorms?|tornado|hurricane|tropical storm|severe)\b/i.test(words);
  const rain=storm||(finite(day?.pop)&&day.pop>=40)||(finite(day?.qpf)&&day.qpf>=.1)||/\b(rain|showers|downpour)\b/i.test(words);
  const gust=strongestGust(day),wind=(finite(gust)&&gust>=35)||/\b(very windy|strong winds?|damaging winds?)\b/i.test(words);
  const tempChange=temperatureChange(day,previous),temperature=tempChange>=12;
  if(!winter&&!storm&&!rain&&!wind&&!temperature)return null;

  let score=0;
  if(winter)score+=90;
  if(storm)score+=80;
  if(rain)score+=20+Math.min(35,(finite(day.pop)?day.pop:0)*.25)+Math.min(35,(finite(day.qpf)?day.qpf:0)*24);
  if(wind)score+=25+Math.min(20,Math.max(0,(gust||35)-35));
  if(temperature)score+=20+Math.min(20,tempChange-12);
  score-=index*.5;

  const kind=winter?'snow or ice':storm?'storms':rain?'rain':wind?'strong wind':'a temperature change';
  const reason=winter
    ? `${dayName(day,index)} stands out because snow or ice may affect plans.`
    : storm
      ? `${dayName(day,index)} is the most impactful forecast day because storms and meaningful rain are possible.`
      : rain
        ? `${dayName(day,index)} stands out because meaningful rain may affect plans.`
        : wind
          ? `${dayName(day,index)} stands out because strong wind may affect plans.`
          : `${dayName(day,index)} stands out because a large temperature change is forecast.`;
  return {score,kind,reason};
}

/** Find the most impactful near-term day that still has a low-confidence
 * component. Quiet cloud-cover disagreements do not create a page banner. */
export function lowConfidenceWarning(days,{limit=7}={}){
  const candidates=[];
  for(const [index,day] of (days||[]).slice(0,limit).entries()){
    const confidence=displayForecastConfidence(day?.confidence),dayImpact=impact(day,index,days[index-1]);
    if(!confidence||!dayImpact)continue;
    const components=confidence.components||{};
    const weak=DETAILS.filter(detail=>finite(components[detail.key])&&components[detail.key]<70);
    if(!weak.length&&!LOW_KEYS.has(confidence.key))continue;
    candidates.push({index,day,confidence,components,weak,dayImpact});
  }
  candidates.sort((a,b)=>b.dayImpact.score-a.dayImpact.score||a.index-b.index);
  const selected=candidates[0];
  if(!selected)return null;

  const {index,day,confidence,components,weak,dayImpact}=selected;
  const label=dayName(day,index),shortLabel=dayName(day,index,{short:true});
  const weakLabels=weak.map(detail=>detail.label);
  const settled=DETAILS.filter(detail=>finite(components[detail.key])&&components[detail.key]>=70).map(detail=>detail.label);
  const disagreement=weakLabels.length
    ? `The forecasts don’t agree yet about ${listWords(weakLabels)}.`
    : 'The important details have not settled yet.';
  const agreement=settled.length?`They agree more closely about ${listWords(settled)}.`:'';
  const timing=index<2?'The details can still change as new updates arrive.':`Because ${label} is ${index} days away, exact timing and amounts can still change.`;
  const score=finite(confidence.score)?clamp(confidence.score):clamp(Math.min(...weak.map(detail=>components[detail.key])));
  return {
    dayIndex:index,
    dayLabel:label,
    shortDayLabel:shortLabel,
    impactLabel:dayImpact.kind,
    score,
    level:confidence.label||levelFor(score),
    title:`${shortLabel} ${dayImpact.kind}`,
    text:`${dayImpact.reason} ${disagreement} ${agreement} ${timing}`.replace(/\s+/g,' ').trim(),
    components:DETAILS.map(detail=>({label:detail.key==='sky'?'Cloud cover':detail.label[0].toUpperCase()+detail.label.slice(1),score:components[detail.key],level:levelFor(components[detail.key])})).filter(row=>finite(row.score))
  };
}

export function confidenceWarningHTML(warning){
  if(!warning)return '';
  return `<button type="button" class="forecast-confidence-button" data-level="${esc(warning.level.toLowerCase())}" aria-haspopup="dialog" aria-label="${esc(warning.title)}. ${esc(warning.level)} forecast confidence. Tap for details."><span class="forecast-confidence-symbol" aria-hidden="true">≈</span><span class="forecast-confidence-compact-copy"><small>Forecast confidence</small><strong>${esc(warning.title)}</strong></span><span class="forecast-confidence-level">${esc(warning.level)}</span><span class="forecast-confidence-scale" role="meter" aria-label="Relative forecast confidence for ${esc(warning.dayLabel)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${warning.score}" aria-valuetext="${esc(warning.level)}"><i style="--confidence-position:${warning.score}%"></i></span><span class="bar-chevron" aria-hidden="true">›</span></button>`;
}

export function confidenceWarningDetailHTML(warning){
  if(!warning)return '';
  const rows=warning.components.map(row=>`<div class="forecast-confidence-detail-row"><span>${esc(row.label)}</span><strong data-level="${esc(row.level.toLowerCase())}">${esc(row.level)} agreement</strong></div>`).join('');
  return `<div class="forecast-confidence-detail"><p>${esc(warning.text)}</p><div class="forecast-confidence-detail-list" aria-label="Forecast agreement by detail">${rows}</div><small>This is a relative agreement check, not an accuracy percentage.</small></div>`;
}
