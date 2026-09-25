import {timeAt} from './hourly-feels.js';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export const WEATHER_CHANGE_TITLE='Large weather change alert';
export function weatherChangeMessages(data,now=Date.now()){
 const zone=data.location?.timeZone||'America/New_York',today=new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date(now));
 const end=new Date(Date.parse(today+'T12:00:00Z')+5*86400000).toISOString().slice(0,10);
 const days=(data.days||[]).filter(d=>d.date>=today&&d.date<end).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5),messages=[];
 const average=(key,d)=>{const a=timeAt(d.date,7,zone),b=timeAt(d.date,19,zone),rows=(data.metricForecasts?.series?.[key]||[]).filter(p=>Date.parse(p.time)>=a&&Date.parse(p.time)<b&&finite(p.value));
 return rows.length>=6?rows.reduce((s,p)=>s+p.value,0)/rows.length:null;};
 const label=d=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long'}).format(new Date(d.date+'T12:00:00Z'));
 const temps=days.map(d=>average('temperature',d)),dew=days.map(d=>average('dewpoint',d));
 // Missing rain data is not a dry day. Use full-day amounts, not remaining rainfall.
 const dry=d=>finite(d.qpf)&&d.qpf===0&&finite(d.pop)&&d.pop<=20;
 const consecutive=(a,b)=>Date.parse(b.date)-Date.parse(a.date)===86400000;
 for(let j=1;j<days.length;j++){
  for(let i=0;i<j;i++){
   if(finite(temps[i])&&finite(temps[j])&&Math.abs(temps[j]-temps[i])>20&&!messages.some(m=>m.kind==='temperature'))messages.push({kind:'temperature',text:`A ${temps[j]>temps[i]?'warmer':'colder'} stretch is ahead: average daytime temperatures ${temps[j]>temps[i]?'rise':'fall'} more than 20°F from ${label(days[i])} to ${label(days[j])}.`});
   if(finite(dew[i])&&finite(dew[j])&&Math.abs(dew[j]-dew[i])>20&&!messages.some(m=>m.kind==='dewpoint'))messages.push({kind:'dewpoint',text:`${dew[j]>dew[i]?'Gross meter detecting high humidity':'Gross meter is tracking drier conditions'}: average daytime dew point ${dew[j]>dew[i]?'rises':'falls'} more than 20°F from ${label(days[i])} to ${label(days[j])}.`});
  }
  const d=days[j],before=days.slice(j-2,j);
  if(j>=2&&before.every(dry)&&consecutive(before[0],before[1])&&consecutive(before[1],d)&&finite(d.pop)&&d.pop>75&&finite(d.qpf)&&d.qpf>.25&&['moderate','high'].includes(d.confidence?.key)&&!messages.some(m=>m.kind==='rain'))messages.push({kind:'rain',text:`Rain returns ${label(d)} after two dry days: ${d.pop}% chance, with ${Number(d.qpf.toFixed(2))} inches expected and ${d.confidence.key} confidence.`});
 }
 return messages.map(m=>m.text);
}
