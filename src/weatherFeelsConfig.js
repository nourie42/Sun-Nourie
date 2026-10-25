/**
 * Shared, owner-editable feels-like method setting.
 *
 * One small JSON file on the `weather-config` branch is read at runtime by every
 * Weather Nourie deployment (main and prerelease), so editing that single file
 * changes both sites without a code change or redeploy.
 *
 * currentConditionsSource
 *   "hourly-blend"           Current conditions (air, wind, feels-like) come from the
 *                            same canonical hourly forecast blend the hourly cards use,
 *                            for every location. This is how Knightdale already works.
 *   "station-when-accepted"  A nearby station observation drives current conditions when
 *                            it passes the freshness/distance/agreement checks.
 *
 * If the file cannot be fetched or is invalid, the last good value is kept; with no
 * good value yet, the built-in default below applies. A bad edit never breaks the site.
 */
export const FEELS_CONFIG_URL='https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-config/weather-feels-like.json';
export const CURRENT_SOURCES=Object.freeze(['hourly-blend','station-when-accepted']);
export const DEFAULT_CURRENT_SOURCE='hourly-blend';
export const FEELS_CONFIG_CACHE_MS=5*60000;
export const FEELS_CONFIG_RETRY_MS=60000;
const TIMEOUT_MS=4000,MAX_BYTES=4096;

/** Returns a clean config object, or null when the file's content is not usable. */
export function normalizeFeelsConfig(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 return CURRENT_SOURCES.includes(raw.currentConditionsSource)?{currentConditionsSource:raw.currentConditionsSource}:null;
}

export function createFeelsConfigLoader({fetchImpl=globalThis.fetch,now=Date.now,url=FEELS_CONFIG_URL}={}){
 let good=null,goodAt=null,nextCheck=0,pending=null,lastError=null;
 const view=status=>({currentConditionsSource:good?.currentConditionsSource||DEFAULT_CURRENT_SOURCE,status,
  checkedAt:goodAt===null?null:new Date(goodAt).toISOString(),...(lastError&&status!=='remote'?{error:lastError}:{})});
 async function refresh(){
  const start=now();
  try{
   const controller=typeof AbortController==='function'?new AbortController():null;
   const timer=controller?setTimeout(()=>controller.abort(),TIMEOUT_MS):null;
   let text;
   try{
    const response=await fetchImpl(url,{headers:{Accept:'application/json'},redirect:'error',...(controller?{signal:controller.signal}:{})});
    if(!response||!response.ok)throw new Error(`settings file returned HTTP ${response?.status??'error'}`);
    text=await response.text();
   }finally{if(timer)clearTimeout(timer);}
   if(typeof text!=='string'||text.length>MAX_BYTES)throw new Error('settings file is missing or too large');
   const config=normalizeFeelsConfig(JSON.parse(text));
   if(!config)throw new Error(`currentConditionsSource must be one of: ${CURRENT_SOURCES.join(', ')}`);
   good=config;goodAt=start;lastError=null;nextCheck=start+FEELS_CONFIG_CACHE_MS;
   return view('remote');
  }catch(error){
   lastError=String(error?.message||error).slice(0,160);
   nextCheck=start+FEELS_CONFIG_RETRY_MS;
   return view(good?'last-good':'default');
  }
 }
 return {
  /** Cached for five minutes; a failed check is retried after one minute. */
  async get(){
   if(now()<nextCheck)return view(lastError===null?'remote':good?'last-good':'default');
   if(!pending)pending=refresh().finally(()=>{pending=null;});
   return pending;
  }
 };
}
