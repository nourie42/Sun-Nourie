/** Explicit named-model point forecasts for locations outside our native extracts.
 * Open-Meteo supplies a continuous series from successive runs of the SAME named
 * model. Never request best_match or present this transport as a pinned GRIB run. */
const H=3600000;
const MODELS={hrrr:{name:'gfs_hrrr',domain:'ncep_hrrr_conus',label:'HRRR',age:12,resolution:'3 km'},nbm:{name:'ncep_nbm_conus',domain:'ncep_nbm_conus',label:'NBM',age:12,resolution:'2.5 km'},ecmwf:{name:'ecmwf_ifs025',domain:'ecmwf_ifs025',label:'ECMWF IFS',age:30,resolution:'0.25°'}};
const FIELDS={temperature_2m:['°F',-150,160],dew_point_2m:['°F',-160,120],relative_humidity_2m:['%',0,100],precipitation:['inch',0,30],wind_speed_10m:['mp/h',0,300],wind_gusts_10m:['mp/h',0,350],wind_direction_10m:['°',0,360],cloud_cover:['%',0,100],pressure_msl:['hPa',800,1100],visibility:['m',0,200000]};
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function validatePointModel(data,meta,id,location,now){
 const model=MODELS[id],run=meta?.last_run_initialisation_time*1000;
 if(!model||!finite(run)||run>now+15*60000||now-run>model.age*H)throw new Error('Named model initialization is missing or stale.');
 if(!finite(data?.latitude)||!finite(data.longitude)||Math.abs(data.latitude-location.latitude)>.35||Math.abs(data.longitude-location.longitude)>.35)throw new Error('Model grid does not match the requested location.');
 const raw=data.hourly,units=data.hourly_units,times=raw?.time;
 if(units?.time!=='unixtime'||!Array.isArray(times)||times.length<12||times.length>500||times.some((t,i)=>!finite(t)||(i&&t-times[i-1]!==3600)))throw new Error('Invalid named-model time axis.');
 const hourly={time:[...times]},hourly_units={time:'unixtime'};
 for(const [field,[unit,min,max]] of Object.entries(FIELDS)){
  // Imperial query settings also convert visibility to feet, independently of
  // its field name. Normalize BEFORE range validation, then convert to miles.
  const feet=field==='visibility'&&units[field]==='ft';
  const values=feet?raw[field]?.map(v=>finite(v)?v*.3048:v):raw[field];
  if(!Array.isArray(values)||values.length!==times.length||values.some(v=>v!==null&&(!finite(v)||v<min||v>max)))throw new Error(`Invalid named-model field: ${field}.`);
  // Unsupported variables (e.g. NBM pressure) are genuinely null, not zero.
  if(values.some(finite)&&units[field]!==unit&&!feet)throw new Error(`Invalid named-model units: ${field}.`);
  hourly[field]=values.map((v,i)=>times[i]*1000>run+(id==='hrrr'?48:240)*H?null:v);
  hourly_units[field]=unit;
 }
 const future=times.filter((t,i)=>t*1000>now&&finite(hourly.temperature_2m[i]));
 if(!future.length)throw new Error('No future named-model temperatures.');
 hourly.pressure_msl=hourly.pressure_msl.map(v=>finite(v)?v/33.86389:null);hourly_units.pressure_msl='inHg';
 hourly.visibility=hourly.visibility.map(v=>finite(v)?v/1609.344:null);hourly_units.visibility='mi';
 const precipitationIntervals=times.flatMap((t,i)=>finite(hourly.precipitation[i])?[{start:t-3600,end:t,value:hourly.precipitation[i]}]:[]);
 return {latitude:location.latitude,longitude:location.longitude,modelGrid:{latitude:data.latitude,longitude:data.longitude},hourly,hourly_units,precipitationIntervals,
  verifiedModel:true,model:id,runAt:new Date(run).toISOString(),validUntil:new Date(Math.max(...future)*1000).toISOString(),resolution:model.resolution,
  sourceUrl:'https://open-meteo.com/en/docs',transport:'Open-Meteo explicit named-model point API',runScope:'Latest published initialization; continuous series may combine successive runs of this same model.',timezone:'GMT'};
}
export function createPointModels({fetchImpl=globalThis.fetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map();
 const remember=(key,value)=>{
  cache.delete(key);cache.set(key,{value,until:now()+5*60000});while(cache.size>96)cache.delete(cache.keys().next().value);
  return value;
 };
 async function json(url){
  const response=await fetchImpl(url,{cache:'no-store',headers:{Accept:'application/json','Cache-Control':'no-cache',Pragma:'no-cache','User-Agent':'Sun-Nourie-WeatherFusion/3.0'},redirect:'error',signal:AbortSignal.timeout(18000)});
  if(!response.ok)throw new Error(`Named model request returned HTTP ${response.status}.`);
  const text=await response.text();if(text.length>2500000)throw new Error('Named model response too large.');return JSON.parse(text);
 }
 return async function load(id,location){
  const model=MODELS[id];if(!model)throw new Error('Unknown named model.');
  const key=`${id}:${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`,hit=cache.get(key);
  const fresh=value=>value&&Date.parse(value.validUntil)>now()&&now()-Date.parse(value.runAt)<=model.age*H;
  if(hit?.until>now()&&fresh(hit.value))return hit.value;
  if(pending.has(key))return pending.get(key);
  if(pending.size>=50)throw new Error('Named model sources are busy. Please retry.');
  const task=(async()=>{
   const query=new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),models:model.name,hourly:Object.keys(FIELDS).join(','),temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'inch',timeformat:'unixtime',timezone:'GMT',forecast_days:'10'});
   try{
    const [data,metadata]=await Promise.all([json(`https://api.open-meteo.com/v1/forecast?${query}`),json(`https://api.open-meteo.com/data/${model.domain}/static/meta.json`)]);
    const value=validatePointModel(data,metadata,id,location,now());
    if(hit?.value&&Date.parse(value.runAt)<Date.parse(hit.value.runAt)){
     if(!fresh(hit.value))throw new Error('Provider returned an older model initialization and the previously verified newer data is no longer valid.');
     return remember(key,{...hit.value,checkedAt:new Date(now()).toISOString(),retrievalStatus:'last-verified',refreshWarning:'Provider returned an older initialization; retaining the previously verified, still-valid newer model data.'});
    }
    const fetchedAt=new Date(now()).toISOString();
    return remember(key,{...value,fetchedAt,checkedAt:fetchedAt,retrievalStatus:'fresh'});
   }catch(error){
    if(fresh(hit?.value))return remember(key,{...hit.value,checkedAt:new Date(now()).toISOString(),retrievalStatus:'last-verified',refreshWarning:'Refresh failed; retaining the previously verified, still-fresh model data.'});
    throw error;
   }
  })().finally(()=>pending.delete(key));pending.set(key,task);return task;
 };
}
