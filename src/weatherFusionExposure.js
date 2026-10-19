/** Independent UV / surface-weather feed. It never changes the NWS/model blend. */
export const EXPOSURE_VERSION='clear-weather-daygraph-v3';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const HOUR=3600000;
const isoTime=value=>{const time=finite(value)?new Date(value*1000):null;return time&&finite(time.getTime())?time.toISOString():null;};
export function exposureWeatherUrl(location,zone='America/New_York'){
 return 'https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({
  latitude:String(location.latitude),longitude:String(location.longitude),timezone:zone,
  hourly:'temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m,cloud_cover,shortwave_radiation_instant,precipitation,uv_index,weather_code',
  daily:'uv_index_max',past_days:'2',forecast_days:'8',timeformat:'unixtime',temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'mm'
 });
}
export function normalizeExposureWeather(raw){
 const h=raw?.hourly,u=raw?.hourly_units;
 if(!Array.isArray(h?.time)||!raw.timezone||u?.temperature_2m!=='°F'||u?.wind_speed_10m!=='mp/h'||u?.shortwave_radiation_instant!=='W/m²')return null;
 try{new Intl.DateTimeFormat('en-US',{timeZone:raw.timezone});}catch{return null;}
 // Optional fields may be absent. Explicitly conflicting units are never
 // relabelled, and invalid values stay missing rather than becoming dry/calm.
 const optionalUnits={dew_point_2m:'°F',relative_humidity_2m:'%',cloud_cover:'%',precipitation:'mm'};
 const value=(key,i,min=-Infinity,max=Infinity)=>{
  const v=h[key]?.[i],unit=optionalUnits[key];
  return finite(v)&&v>=min&&v<=max&&(!unit||u[key]===undefined||u[key]===unit)?v:null;
 };
 const rows=h.time.map((t,i)=>({time:isoTime(t),temperature:value('temperature_2m',i),dewpoint:value('dew_point_2m',i),humidity:value('relative_humidity_2m',i,0,100),wind:value('wind_speed_10m',i,0),skyCover:value('cloud_cover',i,0,100),solar:value('shortwave_radiation_instant',i,0),rain:value('precipitation',i,0),weatherCode:u.weather_code==='wmo code'&&Number.isInteger(h.weather_code?.[i])&&h.weather_code[i]>=0&&h.weather_code[i]<=99?h.weather_code[i]:null,uvIndex:value('uv_index',i,0)})).filter(r=>r.time);
 const localDate=t=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:raw.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t*1000));const get=k=>p.find(x=>x.type===k)?.value;return `${get('year')}-${get('month')}-${get('day')}`;};
 const uv=(raw.daily?.time||[]).map((t,i)=>({date:isoTime(t)?localDate(t):null,value:finite(raw.daily.uv_index_max?.[i])&&raw.daily.uv_index_max[i]>=0?raw.daily.uv_index_max[i]:null})).filter(x=>x.date);
 return {source:'Open-Meteo',url:'https://open-meteo.com/en/docs',timezone:raw.timezone,rows,uv,
  historyBasis:'Recent model weather, not measured sidewalk temperatures',radiationBasis:'Cloud-adjusted model shortwave radiation at each timestamp'};
}
export function addExposureWeather(out,exposureWeather){
 out.exposureVersion=EXPOSURE_VERSION;
 out.exposureWeather=exposureWeather||null;
 for(const day of out.days)day.uvMax=exposureWeather?.uv?.find(u=>u.date===day.date)?.value??null;
 out.uv={source:'Open-Meteo',url:'https://open-meteo.com/en/docs',kind:'Hourly UV forecast and daily maximum',today:out.days[0]?.uvMax??null,hourly:(exposureWeather?.rows||[]).map(r=>({time:r.time,value:finite(r.uvIndex)&&r.uvIndex>=0?r.uvIndex:null}))};
 for(const hour of out.hours||[])hour.uvIndex=out.uv.hourly.find(p=>Date.parse(p.time)===Date.parse(hour.time))?.value??null;
 return out;
}

/** Keep the last verified surface/UV forecast through a brief provider outage.
 * Separate caching prevents radar traffic from evicting the long-lived history.
 * Original fetch time is preserved; missing data is never turned into zero. */
export function createExposureWeatherService({request,now=Date.now}){
 const saved=new Map(),pending=new Map();
 const keyFor=(location,zone)=>`${location.latitude},${location.longitude}:${zone}`;
 const usable=value=>Array.isArray(value?.rows)&&value.rows.length>=48&&value.rows.some(r=>{
  const time=Date.parse(r.time),at=now();
  return time<=at&&at<time+HOUR&&finite(r.temperature)&&finite(r.wind)&&finite(r.skyCover);
 });
 return async function load(location,zone='America/New_York'){
  const key=keyFor(location,zone),previous=saved.get(key),url=exposureWeatherUrl(location,zone),time=now();
  const meta={id:'exposure',label:'UV and surface-weather forecast',url,issuedAt:null,checkedAt:new Date(time).toISOString()};
  const result=(value,fetchedAt,extra={})=>({value:{...value,fetchedAt,checkedAt:meta.checkedAt},meta:{...meta,status:'ready',fetchedAt,...extra}});
  if(previous&&time>=Date.parse(previous.fetchedAt)&&time-Date.parse(previous.fetchedAt)<30*60000&&usable(previous.value))return result(previous.value,previous.fetchedAt);
  if(pending.has(key))return pending.get(key);
  const work=(async()=>{
   let failure;
   for(let attempt=0;attempt<2;attempt++){
    try{
     const raw=await request(url,{timeout:12000,revalidate:attempt>0}),value=normalizeExposureWeather(raw);
     if(!usable(value))throw new Error('Surface forecast did not include usable recent weather history.');
     const fetchedAt=new Date(now()).toISOString();
     if(saved.size>=150&&!saved.has(key))saved.delete(saved.keys().next().value);
     saved.set(key,{value,fetchedAt});return result(value,fetchedAt);
    }catch(error){failure=error;if(/HTTP (?:400|401|403|429)/.test(error.message))break;}
   }
   const age=time-Date.parse(previous?.fetchedAt);
   if(previous&&age>=0&&age<=6*3600000&&usable(previous.value))return result(previous.value,previous.fetchedAt,{status:'stale',recovered:true,retrievalStatus:'last-verified',message:'Surface/UV refresh failed; using the last verified forecast with its original fetch time.'});
   return {value:null,meta:{...meta,status:'unavailable',fetchedAt:null,message:String(failure?.message||'Surface forecast unavailable.').slice(0,160)}};
  })().finally(()=>pending.delete(key));
  pending.set(key,work);return work;
 };
}
