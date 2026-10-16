import {forecastPeriodSummary,rainWindowPeak} from './forecast-story.js?v=tonight-timing-v1';
import {timeAt} from './hourly-feels.js?v=cold-feels-v1';

const finite=n=>typeof n==='number'&&Number.isFinite(n);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Describe the exact hourly forecasts on either side of local midnight. */
export function rainTiming(forecast,index=0,tonight=false,now=Date.now()){
 const day=forecast?.days?.[index],zone=forecast?.location?.timeZone||'America/New_York';
 const likelihood=day?.[tonight?'popNightLikelihood':'rainLikelihood'];
 if(likelihood?.aggregation!=='maximum-hourly')return null;
 const period=forecastPeriodSummary(forecast,index,tonight?'overnight':'overall',now);
 const start=Math.max(period.window.start,index===0?now:-Infinity),end=period.window.end;
 if(!finite(start)||!finite(end)||end<=start)return {value:null,peakLabel:'',split:false,beforeMidnight:null,afterMidnight:null};
 const format=time=>new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'numeric'}).format(new Date(time)).replace(',','');
 const segment=(a,b)=>{
  if(b<=a)return null;
  const peak=rainWindowPeak(period.rows,{start:a,end:b});
  return {value:peak.value,peakLabel:finite(peak.time)?format(peak.time):'',start:a,end:b};
 };
 const all=segment(start,end),following=new Date(Date.parse(day.date+'T12:00Z')+86400000).toISOString().slice(0,10),midnight=timeAt(following,0,zone);
 const split=tonight&&start<midnight&&end>midnight;
 const endClock=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric'}).format(new Date(end));
 return {...all,value:period.chance,peakLabel:finite(period.chance)?all.peakLabel:'',split,afterMidnightLabel:`Midnight–${endClock}`,beforeMidnight:split?segment(start,midnight):null,afterMidnight:split?segment(midnight,end):null};
}

export function rainTimingHTML(timing){
 if(!timing?.split)return '';
 const part=(label,segment)=>`<span><small>${label}</small><strong>${finite(segment?.value)?`${Math.round(segment.value)}%`:'Unavailable'}</strong>${segment?.peakLabel?`<small>Peak ${esc(segment.peakLabel)}</small>`:''}</span>`;
 return `<div class="rain-period-timing" role="group" aria-label="Tonight rain chances before and after midnight">${part('Before midnight',timing.beforeMidnight)}${part(esc(timing.afterMidnightLabel||'After midnight'),timing.afterMidnight)}</div>`;
}
