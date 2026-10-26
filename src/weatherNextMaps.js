/** Google WeatherNext forecast map frames published by scripts/weather_weathernext_maps.py.
 *
 * The browser never receives a URL, size, layer or bound that this validator did
 * not recognize. A missing, malformed, mismatched or stale catalog becomes an
 * explicit status; no other model's map is ever substituted for it.
 */
import {DATA_ROOT} from './weatherFusionDirect.js';

export const WEATHERNEXT_MAPS_SCHEMA='weather-nourie-weathernext-maps-v1';
export const WEATHERNEXT_MAPS_URL=DATA_ROOT+'models/weathernext-maps.json';
export const MAP_BOUNDS=[[20,-130],[55,-60]];
const HOUR=3600000;
const LAYER_IDS=['temperature','dewpoint','wind','precipitation','clouds','pressure','solar'];
const FRAME=/^weathernext-maps\/wn3-(\d{10})-(temperature|dewpoint|wind|precipitation|clouds|pressure|solar)-(\d{3})\.png$/;
const COLOR=/^rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0?\.\d{1,3})\)$/;
const MAX_BYTES=600000;
const READY_HOURS=36;
const USABLE_HOURS=96;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max?v:null;
const stamp=ms=>new Date(ms).toISOString().replace(/[-:T]/g,'').slice(0,10);
const sameBounds=b=>JSON.stringify(b)===JSON.stringify(MAP_BOUNDS);

export function unavailableMaps(status,message,now=Date.now()){
 return {schema:WEATHERNEXT_MAPS_SCHEMA,status,message,checkedAt:new Date(now).toISOString(),layers:{}};
}

/** Turn the published catalog into a safe API payload, or throw with a reason. */
export function validateWeatherNextMaps(catalog,now=Date.now()){
 if(!catalog||typeof catalog!=='object'||catalog.schema!==WEATHERNEXT_MAPS_SCHEMA)throw new Error('Unrecognized WeatherNext map catalog.');
 const runAt=Date.parse(catalog.runAt);
 if(!finite(runAt)||runAt%HOUR!==0||runAt>now+HOUR)throw new Error('The WeatherNext map initialization time is invalid.');
 if(!sameBounds(catalog.bounds))throw new Error('Unexpected WeatherNext map bounds.');
 if(!catalog.layers||typeof catalog.layers!=='object')throw new Error('The WeatherNext map catalog has no layers.');
 const ageHours=(now-runAt)/HOUR,runStamp=stamp(runAt);
 const status=ageHours>USABLE_HOURS?'unavailable':ageHours>READY_HOURS?'stale':'ready';
 const layers={};
 for(const id of LAYER_IDS){
  const layer=catalog.layers[id];
  if(!layer)continue;
  const label=text(layer.label,60),units=text(layer.units,24),description=text(layer.description,240);
  const thresholds=layer.legend?.thresholds,colors=layer.legend?.colors;
  if(!label||!units||!description||!Array.isArray(thresholds)||thresholds.length<2||thresholds.length>14||!thresholds.every(finite)||thresholds.some((v,i)=>i&&v<=thresholds[i-1]))continue;
  if(!Array.isArray(colors)||colors.length!==thresholds.length+1||!colors.every(c=>typeof c==='string'&&COLOR.test(c)))continue;
  if(!Array.isArray(layer.frames))continue;
  const frames=[];
  for(const frame of layer.frames){
   const match=typeof frame?.file==='string'?FRAME.exec(frame.file):null;
   if(!match||match[1]!==runStamp||match[2]!==id)continue;
   const hour=Number(match[3]),time=Date.parse(frame.time);
   if(frame.hour!==hour||hour<1||hour>360||!finite(time)||time!==runAt+hour*HOUR)continue;
   if(!sameBounds(frame.bounds)||frame.field!==id)continue;
   // A frame older than the current local hour has nothing left to forecast.
   if(time<now-3*HOUR)continue;
   frames.push({time:new Date(time).toISOString(),hour,url:DATA_ROOT+frame.file,bounds:MAP_BOUNDS});
  }
  if(!frames.length)continue;
  frames.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  layers[id]={id,label,units,description,legend:{thresholds,colors},frames};
 }
 const available=Object.keys(layers);
 return {
  schema:WEATHERNEXT_MAPS_SCHEMA,
  status:available.length?status:'unavailable',
  message:available.length?(status==='stale'?'The newest published WeatherNext map run is more than 36 hours old.':''):'No current WeatherNext map frames are published.',
  model:'Google WeatherNext 3',
  statistic:'ensemble mean',
  runAt:new Date(runAt).toISOString(),
  generatedAt:finite(Date.parse(catalog.generatedAt))?new Date(Date.parse(catalog.generatedAt)).toISOString():null,
  checkedAt:new Date(now).toISOString(),
  runAgeHours:Math.round(ageHours*10)/10,
  bounds:MAP_BOUNDS,
  coverage:'Contiguous United States',
  note:text(catalog.note,400)||'WeatherNext ensemble-mean map forecasts are model output, not observations.',
  layers
 };
}

/** One cached, size-limited fetch of the catalog. A transient failure keeps the last valid payload, flagged as last-verified. */
export function createWeatherNextMapSource({fetchImpl=globalThis.fetch,now=Date.now,ttlMs=5*60000,url=WEATHERNEXT_MAPS_URL}={}){
 let cache=null,pending=null;
 const refresh=async()=>{
  try{
   const response=await fetchImpl(url,{signal:AbortSignal.timeout(12000),redirect:'error',cache:'no-store',headers:{Accept:'application/json','Cache-Control':'no-cache','User-Agent':'Weather-Nourie-WeatherNext-maps/1.0'}});
   if(response.status===404)return {at:now()-ttlMs+60000,value:unavailableMaps('not-published','WeatherNext map frames have not been published yet.',now())};
   if(!response.ok)throw new Error('WeatherNext map catalog HTTP '+response.status);
   const body=await response.text();
   if(Buffer.byteLength(body)>MAX_BYTES)throw new Error('WeatherNext map catalog is too large.');
   return {at:now(),value:validateWeatherNextMaps(JSON.parse(body),now())};
  }catch(error){
   if(cache?.value?.layers&&Object.keys(cache.value.layers).length&&now()-cache.at<6*HOUR){
    return {at:Math.min(cache.at,now()-ttlMs+60000),value:{...cache.value,status:'last-verified',message:'The map catalog could not be refreshed; showing the last verified WeatherNext run.'}};
   }
   return {at:now()-ttlMs+30000,value:unavailableMaps('unavailable','The WeatherNext map catalog could not be loaded.',now())};
  }
 };
 return async()=>{
  if(cache&&now()-cache.at<ttlMs)return cache.value;
  if(!pending)pending=refresh().then(result=>{cache=result;return result.value;}).finally(()=>{pending=null;});
  return pending;
 };
}
