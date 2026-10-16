import {discussionPeriod} from './dans-take.js?v=clear-weather-daygraph-v3';
import {dailyDisplay,finite} from './weather-math.js?v=cold-feels-v1';

const HOUR=3600000;
/** Verify rain wording against the actual local hours it describes. Regional
 * discussion text is useful context, but cannot overrule the point forecast. */
export function forecastProseConflict(text,forecast,now=Date.now(),anchor=now){
 if(!text||!forecast?.rainTimeline?.length)return null;
 const zone=forecast.location?.timeZone||'America/New_York';
 let context=null;
 const clauses=String(text).split(/[.!?;,]|\bbut\b|\bwhile\b|\bthen\b|\band(?=\s+(?:dry|rain-free|wet|rain|showers|mostly|mainly)\b)/i);
 for(const clause of clauses){
  const explicit=discussionPeriod(clause,anchor,zone);
  if(explicit)context=explicit;
  const dry=/\bdry\b(?!\s+(?:air|skin|mouth|eyes|indoor|house|soil|ground)\b)|\brain[- ]free\b|\bno\s+(?:measurable\s+)?rain\b|\bwithout\s+(?:any\s+)?rain\b/i.test(clause);
  const allWet=/\b(?:rain|showers|wet)\b[^.!?]{0,40}\b(?:all|entire|throughout|both)\b[^.!?]{0,20}\b(?:weekend|days)\b/i.test(clause);
  if(!dry&&!allWet)continue;
  // Pronouns inherit the preceding date; otherwise an overview describes today.
  const period=explicit||context||discussionPeriod('today',now,zone);
  if(!period||period.end<=now)continue;
  const start=Math.max(now,period.start),end=period.end;
  const rows=forecast.rainTimeline.filter(r=>Date.parse(r.time)<end&&Date.parse(r.end)>start&&finite(r.rainLikelihood?.value));
  const peak=rows.length?Math.max(...rows.map(r=>r.rainLikelihood.value)):null;
  const substantial=rows.some(r=>finite(r.precipitation)&&r.precipitation>=.01);
  if(dry&&finite(peak)&&(peak>=35||substantial))return {kind:'dry-during-forecast-rain',text:clause.trim(),start,end,peak};
  if(allWet){
   const dates=new Map();
   for(const r of rows){const date=new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date(r.time));const a=dates.get(date)||[];a.push(r);dates.set(date,a);}
   if([...dates.values()].some(day=>day.length>=12&&day.every(r=>r.rainLikelihood.value<25&&finite(r.precipitation)&&r.precipitation<.001)))return {kind:'rain-throughout-dry-period',text:clause.trim(),start,end,peak};
  }
 }
 return null;
}

/** Safe fallback uses the same displayed day readings, never a second forecast. */
export function pointForecastOverview(forecast,now=Date.now()){
 const zone=forecast?.location?.timeZone||'America/New_York';
 if(!(forecast?.days||[]).some((day,index)=>finite(dailyDisplay(day,index,now,zone).pop)))return '';
 return (forecast?.days||[]).slice(0,3).map((day,index)=>{
  const display=dailyDisplay(day,index,now,zone),pop=display.pop;
  const label=index===0?display.label:new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long'}).format(new Date(day.date+'T12:00Z'));
  if(!finite(pop))return `${label}: rain chance is unavailable.`;
  const weather=pop>=60?'rain likely':pop>=25?'rain possible':pop>0?'a low rain chance':'no rain signal in the forecast';
  return `${label}: ${weather} (${Math.round(pop)}% peak hourly chance)${finite(display.primary)?`; ${display.primaryLabel.toLowerCase()} ${Math.round(display.primary)}°`:''}.`;
 }).join(' ');
}
