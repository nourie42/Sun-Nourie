import {displayForecastConfidence} from './forecast-confidence.js?v=ensemble-confidence-v1';

const LOW_KEYS=new Set(['low','very-low']);
const IMPORTANT_DETAILS=[
  {key:'rain',label:'rain'},
  {key:'temperature',label:'temperatures'},
  {key:'sky',label:'cloud cover'}
];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>\"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char]));

function dayName(day,index){
  if(index===0)return 'Today';
  if(index===1)return 'Tomorrow';
  if(/^\d{4}-\d{2}-\d{2}$/.test(day?.date||'')){
    try{return new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(new Date(`${day.date}T12:00:00Z`));}catch{}
  }
  return day?.label||`Day ${index+1}`;
}

function listWords(words){
  if(words.length<2)return words[0]||'the forecast details';
  if(words.length===2)return `${words[0]} and ${words[1]}`;
  return `${words.slice(0,-1).join(', ')}, and ${words.at(-1)}`;
}

/** Find the first low-confidence day in the near forecast and translate its
 * weakest important details into visitor-friendly language. */
export function lowConfidenceWarning(days,{limit=5}={}){
  for(const [index,day] of (days||[]).slice(0,limit).entries()){
    const confidence=displayForecastConfidence(day?.confidence);
    if(!confidence)continue;
    const components=confidence.components||{};
    const weak=IMPORTANT_DETAILS.filter(detail=>finite(components[detail.key])&&components[detail.key]<70);
    if(!weak.length&&!LOW_KEYS.has(confidence.key))continue;

    const label=dayName(day,index),phrase=index===0?'today':index===1?'tomorrow':label;
    const weakLabels=weak.map(detail=>detail.label);
    const score=weak.length?Math.min(...weak.map(detail=>components[detail.key])):confidence.score;
    const disagreement=weakLabels.length
      ? `The forecasts don’t agree yet about ${listWords(weakLabels)}.`
      : 'The important forecast details haven’t settled yet.';
    const timing=index<2
      ? 'Those details may change as new information comes in.'
      : `Those details may change as ${label} gets closer.`;
    return {
      dayIndex:index,
      dayLabel:label,
      score:finite(score)?Math.max(0,Math.min(100,Math.round(score))):35,
      level:'Low',
      title:`Low confidence for ${phrase}`,
      text:`${disagreement} ${timing}`
    };
  }
  return null;
}

export function confidenceWarningHTML(warning){
  if(!warning)return '';
  return `<div class="forecast-confidence-copy"><span class="forecast-confidence-kicker">Forecast confidence</span><strong>${esc(warning.title)}</strong><span>${esc(warning.text)}</span></div><div class="forecast-confidence-meter-wrap"><span class="forecast-confidence-level">${esc(warning.level)}</span><span class="forecast-confidence-scale" role="meter" aria-label="Relative forecast confidence for ${esc(warning.dayLabel)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${warning.score}" aria-valuetext="${esc(warning.level)}"><i style="--confidence-position:${warning.score}%"></i></span><span class="forecast-confidence-scale-labels" aria-hidden="true"><small>Low</small><small>High</small></span></div>`;
}
