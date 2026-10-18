import {discussionPeriod} from './dans-take.js?v=audit-20261017-v1';
import {finite} from './weather-math.js?v=current-rain-20261017-v3';

const HOUR=3600000;
// A missing hour, probability, or amount is not proof of a dry period.
function completelyDry(rows,start,end){
 let cursor=start;
 for(const row of [...rows].sort((a,b)=>Date.parse(a.time)-Date.parse(b.time))){
  const a=Date.parse(row.time),b=Date.parse(row.end);
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return false;
  if(b<=cursor)continue;
  if(a>cursor||!finite(row.rainLikelihood?.value)||row.rainLikelihood.value<0||row.rainLikelihood.value>=5||!finite(row.precipitation)||row.precipitation!==0||/rain|drizzle|shower|snow|sleet|flurr|ice pellets|freezing|thunder|\btstm\b/i.test(row.condition||''))return false;
  cursor=Math.max(cursor,Math.min(b,end));
 }
 return cursor>=end;
}
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
  const wet=/\brain\b|\bshowers?\b|\bdrizzle\b|\bthunderstorms?\b/i.test(clause)
   &&!/\b(?:unlikely|little|low|slight|small|minimal|isolated|few)\b|\b(?:yesterday|last night|ended|stopped|departed|passed)\b/i.test(clause);
  if(!dry&&!allWet&&!wet)continue;
  // Pronouns inherit the preceding date; otherwise an overview describes today.
  const period=explicit||context||discussionPeriod('today',now,zone);
  if(!period||period.end<=now)continue;
  const start=Math.max(now,period.start),end=period.end;
  const periodRows=forecast.rainTimeline.filter(r=>Date.parse(r.time)<end&&Date.parse(r.end)>start);
  const rows=periodRows.filter(r=>finite(r.rainLikelihood?.value));
  const peak=rows.length?Math.max(...rows.map(r=>r.rainLikelihood.value)):null;
  const substantial=rows.some(r=>finite(r.precipitation)&&r.precipitation>=.01);
  if(dry&&finite(peak)&&(peak>=35||substantial))return {kind:'dry-during-forecast-rain',text:clause.trim(),start,end,peak};
  if(wet&&!dry&&!allWet&&completelyDry(periodRows,start,end))return {kind:'rain-during-dry-forecast',text:clause.trim(),start,end,peak};
  if(allWet){
   const dates=new Map();
   for(const r of rows){const date=new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date(r.time));const a=dates.get(date)||[];a.push(r);dates.set(date,a);}
   if([...dates.values()].some(day=>day.length>=12&&day.every(r=>r.rainLikelihood.value<25&&finite(r.precipitation)&&r.precipitation<.001)))return {kind:'rain-throughout-dry-period',text:clause.trim(),start,end,peak};
  }
 }
 return null;
}
