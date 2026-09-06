/** Independent, timestamp-pinned NOAA HRRR map source, published by Iowa State.
 * REFD at 1 km AGL is NOT composite REFC or observed radar. See IEM's primary
 * documentation: https://mesonet.agron.iastate.edu/GIS/model.phtml .
 * Rotating '-0' URLs are deliberately never used: an entire animation keeps the
 * same actual model initialization while updates are checked once per minute.
 */
export const HRRR_MAP_METADATA='https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json';
const H=3600000;
export function hrrrTileManifest(meta,now=Date.now(),checkedAt=new Date(now).toISOString()) {
 const run=Date.parse(meta?.model_init_utc),end=Date.parse(meta?.model_forecast_utc);
 if(!Number.isFinite(run)||run%H!==0||run>now||now-run>4*H||meta.forecast_minute!==1080||end-run!==18*H)throw new Error('Unverified or stale HRRR tile initialization.');
 const stamp=new Date(run).toISOString().replace(/[-:TZ]/g,'').slice(0,12);
 const frames=Array.from({length:19},(_,hour)=>({
  time:new Date(run+hour*H).toISOString(),runAt:new Date(run).toISOString(),
  field:'reflectivity',product:'REFD_1000m_AGL',units:'dBZ',kind:'xyz',
  bounds:[[20,-130],[55,-60]],
  url:`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F${String(hour*60).padStart(4,'0')}-${stamp}/{z}/{x}/{y}.png`
 })).filter(f=>Date.parse(f.time)>=now-3*H);
 return {model:'hrrr',label:'NOAA HRRR · hourly via Iowa State',resolution:'3 km model · tiled REFD at 1 km AGL',
  runAt:new Date(run).toISOString(),checkedAt,status:now-run>150*60000?'delayed':'ready',frames,
  product:'REFD_1000m_AGL',provider:'Iowa Environmental Mesonet',sourceUrl:'https://mesonet.agron.iastate.edu/GIS/model.phtml',
  note:'Low-level simulated reflectivity, not observed radar. Initialization is pinned in every tile URL. This independent map source does not modify the numeric point forecast.'};
}
export function createHrrrMapSource({fetchImpl=globalThis.fetch,now=Date.now}={}) {
 let cache=null,pending=null,until=0;
 return async()=>{
  if(until>now())return cache;
  if(pending)return pending;
  pending=(async()=>{
   try {
    const response=await fetchImpl(HRRR_MAP_METADATA,{signal:AbortSignal.timeout(7000),redirect:'error',cache:'no-store',headers:{Accept:'application/json','Cache-Control':'no-cache','User-Agent':'Weather-Nourie-HRRR-map/1.0'}});
    if(!response.ok)throw new Error('HRRR metadata HTTP '+response.status);
    const text=await response.text();if(Buffer.byteLength(text)>10000)throw new Error('HRRR metadata too large.');
    const layer=hrrrTileManifest(JSON.parse(text),now(),new Date(now()).toISOString());
    if(cache?.layer&&Date.parse(cache.layer.runAt)>Date.parse(layer.runAt)&&now()-Date.parse(cache.layer.runAt)<4*H)cache={...cache,status:'source-regressed'};
    else cache={layer,status:'ready'};
   }catch{
    // A failure is never converted to a newer initialization or a fresh check time.
    cache=cache?.layer&&now()-Date.parse(cache.layer.runAt)<4*H?{...cache,status:'check-failed'}:{layer:null,status:'unavailable'};
   }
   until=now()+60000;return cache;
  })().finally(()=>{pending=null;});
  return pending;
 };
}
