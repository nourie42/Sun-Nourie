import {displayForecastConfidence} from './forecast-confidence.js?v=sky-rain-agreement-v1';
import {timeAt} from './hourly-feels.js?v=current-rain-20261017-v3';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export const WEATHER_CHANGE_TITLE='Large weather change alert';
export function weatherChangeMessages(data,now=Date.now()){
 const zone=data.location?.timeZone||'America/New_York',today=new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date(now));
 const end=new Date(Date.parse(today+'T12:00:00Z')+5*86400000).toISOString().slice(0,10);
 const days=(data.days||[]).filter(d=>d.date>=today&&d.date<end).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5),messages=[];
 const average=(key,d)=>{
  const start=timeAt(d.date,7,zone),end=timeAt(d.date,19,zone),values=new Map();
  for(const row of data.metricForecasts?.series?.[key]||[]){
   const time=Date.parse(row.time);if(!finite(time)||time<start||time>=end)continue;
   if(values.has(time))return null;
   values.set(time,row.value);
  }
  let total=0,count=0;
  // Only matching, complete hourly daytime windows establish an average.
  // Missing mornings cannot be compared with another date's afternoons.
  for(let time=start;time<end;time+=3600000){if(!finite(values.get(time)))return null;total+=values.get(time);count++;}
  return count?total/count:null;
 };
 const label=d=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long'}).format(new Date(d.date+'T12:00:00Z'));
 const temps=days.map(d=>average('temperature',d)),dew=days.map(d=>average('dewpoint',d));
 // These are forecast amounts; today's amount may cover only the hours ahead.
 const dry=d=>finite(d.qpf)&&d.qpf===0&&finite(d.pop)&&d.pop<=20;
 const consecutive=(a,b)=>Date.parse(b.date)-Date.parse(a.date)===86400000;
 for(let j=1;j<days.length;j++){
  for(let i=0;i<j;i++){
   if(finite(temps[i])&&finite(temps[j])&&Math.abs(temps[j]-temps[i])>20&&!messages.some(m=>m.kind==='temperature'))messages.push({kind:'temperature',text:`A ${temps[j]>temps[i]?'warmer':'colder'} stretch is ahead: average daytime temperatures ${temps[j]>temps[i]?'rise':'fall'} more than 20°F from ${label(days[i])} to ${label(days[j])}.`});
   if(finite(dew[i])&&finite(dew[j])&&Math.abs(dew[j]-dew[i])>20&&!messages.some(m=>m.kind==='dewpoint')){
    const rising=dew[j]>dew[i],rain=days.slice(i,j+1).some(d=>finite(d.pop)&&d.pop>20||finite(d.qpf)&&d.qpf>0);
    messages.push({kind:'dewpoint',text:`The air will feel ${rising?'more':'less'} humid from ${label(days[i])} to ${label(days[j])} as average daytime dew points ${rising?'rise':'fall'} more than 20°F.${!rising&&rain?' Rain is still possible during that period.':''}`});
   }
  }
  const d=days[j],before=days.slice(j-2,j),confidence=displayForecastConfidence(d.confidence);
  if(j>=2&&before.every(dry)&&consecutive(before[0],before[1])&&consecutive(before[1],d)&&finite(d.pop)&&d.pop>75&&finite(d.qpf)&&d.qpf>.25&&['moderate','high'].includes(confidence?.key)&&!messages.some(m=>m.kind==='rain')){
   const includesRemainingToday=before.some(day=>day.date===today&&now>timeAt(day.date,0,zone));
   const preceding=includesRemainingToday?'two low-rain forecast periods from now':'two dry forecast days';
   messages.push({kind:'rain',text:`Rain returns ${label(d)} after ${preceding}: ${d.pop}% chance, with ${Number(d.qpf.toFixed(2))} inches expected and ${confidence.key} ${confidence.scope==='sky-and-rain'?'sky/rain agreement':'confidence'}.`});
  }
 }
 return messages.map(m=>m.text);
}
