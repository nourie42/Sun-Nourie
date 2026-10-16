import {forecastPeriodSummary,rainWindowPeak} from './forecast-story.js?v=calendar-days-v1';

const finite=n=>typeof n==='number'&&Number.isFinite(n);

/** Describe the exact hourly forecasts remaining on the labeled calendar date. */
export function rainTiming(forecast,index=0,tonight=false,now=Date.now()){
 const day=forecast?.days?.[index],zone=forecast?.location?.timeZone||'America/New_York';
 const likelihood=day?.rainLikelihood;
 if(likelihood?.aggregation!=='maximum-hourly')return null;
 const period=forecastPeriodSummary(forecast,index,'overall',now);
 const start=Math.max(period.window.start,index===0?now:-Infinity),end=period.window.end;
 if(!finite(start)||!finite(end)||end<=start)return {value:null,peakLabel:'',split:false,beforeMidnight:null,afterMidnight:null};
 const format=time=>new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'numeric'}).format(new Date(time)).replace(',','');
 const segment=(a,b)=>{
  if(b<=a)return null;
  const peak=rainWindowPeak(period.rows,{start:a,end:b});
  return {value:peak.value,peakLabel:finite(peak.time)?format(peak.time):'',start:a,end:b};
 };
 const all=segment(start,end);
 const nwsFallback=period.rows.some(row=>row.rainLikelihood?.mode==='nws-fallback'&&finite(row.rainLikelihood.value));
 return {...all,value:period.chance,peakLabel:finite(period.chance)?all.peakLabel:'',split:false,nwsFallback,beforeMidnight:null,afterMidnight:null};
}

export function rainTimingHTML(timing){
 return timing?.nwsFallback?'<p class="rain-source-note">Official NWS rain chances are shown while model data is unavailable.</p>':'';
}
