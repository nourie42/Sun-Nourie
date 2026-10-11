export const ALERT_REFRESH_MS=30000;
export const ALERT_STALE_MS=90000;
export const alertLocationKey=location=>Number.isFinite(location?.latitude)&&Number.isFinite(location?.longitude)?`${Number(location.latitude.toFixed(4))},${Number(location.longitude.toFixed(4))}`:null;
export function withLiveAlerts(forecast,snapshot){
  if(!snapshot||!alertLocationKey(forecast?.location)||alertLocationKey(forecast.location)!==alertLocationKey(snapshot.location))return forecast;
  const live=snapshot.feeds?.find(f=>f.id==='alerts'),existing=forecast.feeds?.find(f=>f.id==='alerts');
  if(!live||live.status==='ready'&&Date.parse(live.fetchedAt)<Date.parse(existing?.fetchedAt))return forecast;
  return {...forecast,alerts:snapshot.alerts||[],feeds:[...(forecast.feeds||[]).filter(f=>f.id!=='alerts'),live]};
}
export function alertHealth(forecast,now=Date.now()){
  const feed=forecast?.feeds?.find(f=>f.id==='alerts');
  if(feed?.status!=='ready')return {verified:false,message:'Live warnings could not be verified. Check the official NWS warnings now.'};
  const age=now-Date.parse(feed.fetchedAt);
  if(!Number.isFinite(age)||age< -60000||age>ALERT_STALE_MS)return {verified:false,message:'Warning updates are stale. Check the official NWS warnings now.'};
  return {verified:true,message:''};
}
