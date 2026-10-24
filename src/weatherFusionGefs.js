const H=3600000,finite=v=>typeof v==='number'&&Number.isFinite(v);
const META='https://api.open-meteo.com/data/ncep_gefs025/static/meta.json';
export function validateGefs(data,meta,location,now){
 const run=meta?.last_run_initialisation_time*1000,end=meta?.data_end_time*1000;
 if(!finite(run)||run>now+300000||now-run>24*H||!finite(end)||end<=now)throw Error('GEFS initialization or horizon is stale');
 if(!finite(data?.latitude)||!finite(data.longitude)||Math.abs(data.latitude-location.latitude)>.35||Math.abs(data.longitude-location.longitude)>.35)throw Error('GEFS grid does not match selected location');
 const raw=data.hourly,units=data.hourly_units,times=raw?.time,keys=Object.keys(raw||{}).filter(k=>/^temperature_2m(?:_member\d+)?$/.test(k));
 if(units?.time!=='unixtime'||keys.length!==31||keys.some(k=>units[k]!=='°F')||!Array.isArray(times)||times.length>400||times.some((t,i)=>!finite(t)||(i&&t-times[i-1]!==3600)))throw Error('GEFS must supply 31 ensemble members, Fahrenheit and a unique hourly axis');
 const rainKeys=Object.keys(raw||{}).filter(k=>/^precipitation(?:_member\d+)?$/.test(k));
 const rain=rainKeys.length===31&&rainKeys.every(k=>units[k]==='inch')?times.map((t,i)=>{const vs=rainKeys.map(k=>raw[k]?.[i]);return t*1000>run&&t*1000<=end&&vs.every(v=>finite(v)&&v>=0&&v<=30)?vs.reduce((a,b)=>a+b,0)/31:null;}):null;
 const means=times.map((t,i)=>{const values=keys.map(k=>raw[k]?.[i]);return t*1000>=run&&t*1000<=end&&values.every(v=>finite(v)&&v>=-150&&v<=160)?values.reduce((a,b)=>a+b,0)/31:null;});
 if(!times.some((t,i)=>t*1000>=now&&finite(means[i])))throw Error('GEFS has no complete future member values');
 return {verifiedModel:true,model:'gefs',ensembleMembers:31,modelLabel:'NOAA GEFS 0.25° ensemble mean',runAt:new Date(run).toISOString(),validUntil:new Date(Math.min(end,Math.max(...times)*1000)).toISOString(),latitude:location.latitude,longitude:location.longitude,modelGrid:{latitude:data.latitude,longitude:data.longitude},hourly_units:{time:'unixtime',temperature_2m:'°F'},hourly:{time:times,temperature_2m:means},precipitationIntervals:rain?times.flatMap((t,i)=>finite(rain[i])?[{start:t-3600,end:t,value:rain[i]}]:[] ):[],transport:'Open-Meteo explicit gfs025 ensemble API',runScope:'Latest published NOAA GEFS initialization; provider hourly interpolation of the 3-hourly ensemble fields',sourceUrl:'https://open-meteo.com/en/docs/ensemble-api'};
}
export function createGefs({fetchImpl=globalThis.fetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map();let retryAt=0;
 const json=async url=>{const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(12000)});if(!r.ok){if(r.status===429){const header=r.headers?.get?.('retry-after'),seconds=Number(header);const delay=header&&Number.isFinite(seconds)?seconds*1000:Date.parse(header)-now();retryAt=now()+Math.max(60000,Number.isFinite(delay)&&delay>0?delay:5*60000);throw Error('GEFS provider rate limit; retry after '+new Date(retryAt).toISOString());}throw Error(`GEFS HTTP ${r.status}`);}const t=await r.text();if(Buffer.byteLength(t)>2500000)throw Error('GEFS response too large');return JSON.parse(t);};
 return async location=>{
  const key=`${location.latitude},${location.longitude}`,meta={id:'gefs',label:'NOAA GEFS ensemble mean',url:'https://open-meteo.com/en/docs/ensemble-api',status:'unavailable',fetchedAt:new Date(now()).toISOString()};
  try{
   const hit=cache.get(key);if(hit&&hit.until>now()&&now()-Date.parse(hit.value.runAt)<24*H&&Date.parse(hit.value.validUntil)>now())return hit.result;
   if(now()<retryAt)throw Error('GEFS provider rate limit; retry after '+new Date(retryAt).toISOString());
   if(!pending.has(key)){
    if(pending.size>=8)throw Error('GEFS sources are busy');
    const work=(async()=>{const query=new URLSearchParams({latitude:String(location.latitude),longitude:String(location.longitude),hourly:'temperature_2m,precipitation',models:'gfs025',temperature_unit:'fahrenheit',precipitation_unit:'inch',timezone:'GMT',forecast_days:'10',timeformat:'unixtime'});
     const [data,run]=await Promise.all([json('https://ensemble-api.open-meteo.com/v1/ensemble?'+query),json(META)]);
     const value=validateGefs(data,run,location,now()),result={value,meta:{...meta,status:'ready',issuedAt:value.runAt,validUntil:value.validUntil,contributes:true,message:'Mean of 31 genuine NOAA GEFS members; temperature blend and hourly expected rain-amount comparison only. No calibrated rain probability is inferred.'}};
     cache.delete(key);cache.set(key,{until:now()+10*60000,value,result});while(cache.size>24)cache.delete(cache.keys().next().value);return result;
    })().finally(()=>pending.delete(key));pending.set(key,work);
   }
   return await pending.get(key);
  }catch(e){const hit=cache.get(key);if(hit&&now()-Date.parse(hit.value.runAt)<24*H&&Date.parse(hit.value.validUntil)>now())return {value:hit.value,meta:{...hit.result.meta,retrievalStatus:'last-verified',checkedAt:new Date(now()).toISOString(),message:'Refresh failed; using previously verified GEFS data within its run-age and valid-horizon limits. '+e.message}};return {value:null,meta:{...meta,...(retryAt>now()?{retryAfter:new Date(retryAt).toISOString()}:{}),message:e.message}};}
 };
}
