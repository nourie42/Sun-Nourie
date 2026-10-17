const MINUTE=60000;
const retryStatuses=new Set(['unavailable','stale']);
/** Retry missing hourly inputs as well as unavailable model feeds.
 * A confidence label alone never implies missing or stale forecast data. */
export function forecastNeedsModelRetry(forecast,now=Date.now()){
 const coverage=forecast?.days?.[0]?.confidence?.coverage;
 if(coverage?.temperature?.complete===false||coverage?.rain?.complete===false)return true;
 if((forecast?.feeds||[]).some(feed=>['hrrr','ecmwf','nbm'].includes(feed.id)&&(retryStatuses.has(feed.status)||feed.retrievalStatus==='last-verified')))return true;
 if(forecast?.days?.[0]?.confidence?.coverage?.rain?.officialFallback===true)return true;
 return (forecast?.rainTimeline||[]).some(row=>{
  const start=Date.parse(row.time),end=Date.parse(row.end)||start+3600000;
  return start<now+24*3600000&&end>now&&row.rainLikelihood?.mode==='nws-fallback'&&Number.isFinite(row.rainLikelihood.value);
 });
}
export function forecastRefreshDue(forecast,now=Date.now()){
 const assembled=Date.parse(forecast?.assembledAt);
 if(!Number.isFinite(assembled)||now<assembled-5*MINUTE)return true;
 const zone=forecast?.location?.timeZone||'America/New_York';
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 if(forecast?.days?.[0]?.date!==date)return true;
 return now-assembled>=(forecastNeedsModelRetry(forecast,now)?2:9)*MINUTE;
}
