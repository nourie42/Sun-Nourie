import {timeAt} from './hourly-feels.js';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function weatherChangeMessages(data,now=Date.now()){
 const zone=data.location?.timeZone||'America/New_York',today=new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(new Date(now));
 const days=(data.days||[]).filter(d=>d.date>=today).slice(0,5),messages=[];
 const average=(key,d)=>{const a=timeAt(d.date,7,zone),b=timeAt(d.date,19,zone),rows=(data.metricForecasts?.series?.[key]||[]).filter(p=>Date.parse(p.time)>=a&&Date.parse(p.time)<b&&finite(p.value));
 return rows.length>=6?rows.reduce((s,p)=>s+p.value,0)/rows.length:null;};
 const label=d=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long'}).format(new Date(d.date+'T12:00:00Z'));
 const temps=days.map(d=>average('temperature',d)),dew=days.map(d=>average('dewpoint',d));
 for(let j=1;j<days.length;j++){
  if(finite(temps[0])&&finite(temps[j])&&temps[j]-temps[0]>20&&!messages.some(m=>m.kind==='temperature'))messages.push({kind:'temperature',text:`A warmer stretch is ahead: average daytime temperatures rise more than 20°F by ${label(days[j])}.`});
  if(finite(dew[0])&&finite(dew[j])&&Math.abs(dew[j]-dew[0])>20&&!messages.some(m=>m.kind==='dewpoint'))messages.push({kind:'dewpoint',text:`${dew[j]>dew[0]?'Gross meter detecting high humidity':'Gross meter is tracking drier conditions'}: average daytime dew point ${dew[j]>dew[0]?'rises':'falls'} more than 20°F by ${label(days[j])}.`});
  const d=days[j],wet=days.slice(Math.max(0,j-2),j);
  if(wet.length===2&&wet.every(p=>finite(p.qpf)&&p.qpf>0)&&d.pop>75&&finite(d.qpf)&&d.qpf>.25&&['moderate','high'].includes(d.confidence?.key)&&!messages.some(m=>m.kind==='rain'))messages.push({kind:'rain',text:`More rain after a wet stretch: ${label(d)} has a greater than 75% chance and more than 0.25 inches forecast, with ${d.confidence.label.toLowerCase()} confidence.`});
 }
 return messages.map(m=>m.text);
}
