export const ALERT_REFRESH_MS=30000;
export const ALERT_STALE_MS=90000;
export const alertLocationKey=location=>Number.isFinite(location?.latitude)&&Number.isFinite(location?.longitude)?`${Number(location.latitude.toFixed(4))},${Number(location.longitude.toFixed(4))}`:null;
export function retainUnverifiedAlerts(previous,incoming){
  const feed=incoming?.feeds?.find(f=>f.id==='alerts');
  if(!previous||feed?.status==='ready'||!alertLocationKey(previous.location)||alertLocationKey(previous.location)!==alertLocationKey(incoming?.location))return incoming;
  const replaced=new Set((incoming.alerts||[]).flatMap(a=>(a.references||[]).flatMap(ref=>[ref['@id'],ref.identifier].filter(Boolean))));
  const retained=(previous.alerts||[]).filter(a=>!replaced.has(a.id)&&((a.scope==='county'?feed?.countyStatus:feed?.pointStatus)!=='ready'));
  if(!retained.length)return incoming;
  const alerts=new Map([...retained,...(incoming.alerts||[])].map(a=>[a.id,a]));
  const older=previous.feeds?.find(f=>f.id==='alerts')?.fetchedAt;
  const meta={...feed,fetchedAt:older&&(!feed?.fetchedAt||Date.parse(older)<Date.parse(feed.fetchedAt))?older:feed?.fetchedAt};
  return {...incoming,alerts:[...alerts.values()],feeds:[...(incoming.feeds||[]).filter(f=>f.id!=='alerts'),meta]};
}
export function withLiveAlerts(forecast,snapshot){
  if(!snapshot||!alertLocationKey(forecast?.location)||alertLocationKey(forecast.location)!==alertLocationKey(snapshot.location))return forecast;
  const live=snapshot.feeds?.find(f=>f.id==='alerts'),existing=forecast.feeds?.find(f=>f.id==='alerts');
  if(!live||live.status==='ready'&&Date.parse(live.fetchedAt)<Date.parse(existing?.fetchedAt))return forecast;
  const data=retainUnverifiedAlerts(forecast,snapshot);
  return {...forecast,alerts:data.alerts||[],feeds:[...(forecast.feeds||[]).filter(f=>f.id!=='alerts'),...data.feeds.filter(f=>f.id==='alerts')]};
}
export function alertHealth(forecast,now=Date.now()){
  const feed=forecast?.feeds?.find(f=>f.id==='alerts');
  if(feed?.status!=='ready')return {verified:false,message:'Live warnings could not be verified. Check the official NWS warnings now.'};
  const age=now-Date.parse(feed.fetchedAt);
  if(!Number.isFinite(age)||age< -60000||age>ALERT_STALE_MS)return {verified:false,message:'Warning updates are stale. Check the official NWS warnings now.'};
  return {verified:true,message:''};
}
