import {createSign,randomUUID} from 'node:crypto';

const fields=['temperature_2m_mean','temperature_2m_p10','temperature_2m_p90','dewpoint_temperature_2m_mean','wind_speed_10m_mean','u_component_of_wind_10m_mean','v_component_of_wind_10m_mean','total_cloud_cover_mean','mean_sea_level_pressure_mean','surface_solar_radiation_downwards_1hr_mean','total_precipitation_1hr_mean'];
const failure=(message,status=503,code='LOOKUP_UNAVAILABLE')=>Object.assign(new Error(message),{status,code});
const parameter=(name,type,value)=>({name,parameterType:{type},parameterValue:{value:String(value)}});
export function locationPoint(query){
 const lat=query?.latitude,lon=query?.longitude;
 if(!['number','string'].includes(typeof lat)||!['number','string'].includes(typeof lon)||String(lat).trim()===''||String(lon).trim()==='')throw failure('Choose a city or allow device location.',400);
 const latitude=Number(lat),longitude=Number(lon);
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude<24||latitude>50||longitude< -125||longitude> -66)throw failure('Location lookup currently supports the contiguous United States.',400);
 // Keep the exact requested coordinates: never silently replace a location.
 return {id:`local:${latitude}:${longitude}`,latitude,longitude,name:'Selected location'};
}

/** Disabled until credentials, a linked table and an explicit byte ceiling exist.
 * Uses parameterized SELECTs only. HTTP GET routes never invoke this provider.
 * Project-level BigQuery quotas are required for durable multi-instance limits.
 */
export function createWeatherNextLocationProvider({env=process.env,fetchImpl=globalThis.fetch,now=Date.now}={}){
 let credentials;
 try{credentials=JSON.parse(env.WEATHERNEXT_GCP_CREDENTIALS||'null');}catch{}
 const table=env.WEATHERNEXT_BQ_TABLE||'',project=credentials?.project_id;
 const maxBytes=Number(env.WEATHERNEXT_MAX_BYTES_PER_QUERY);
 const configured=!!(credentials?.client_email&&credentials?.private_key&&/^[a-z][a-z0-9-]{4,62}$/.test(project||'')&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.weathernext_3_0_0_0p1deg$/.test(table)&&Number.isSafeInteger(maxBytes)&&maxBytes>0);
 let auth=null,authPending=null,runCache=null,lookups=[];
 async function json(url,options={}){
  const response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw failure('WeatherNext could not complete the request. The site owner should check Google Cloud access and query limits.');
  return response.json();
 }
 async function accessToken(){
  if(auth&&auth.expires>now()+60000)return auth.value;
  if(authPending)return authPending;
  authPending=(async()=>{
   const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),iat=Math.floor(now()/1000);
   const unsigned=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/bigquery',aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600});
   const assertion=unsigned+'.'+createSign('RSA-SHA256').update(unsigned).sign(credentials.private_key,'base64url');
   const data=await json('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString()});
   if(typeof data.access_token!=='string')throw failure('Google Cloud authentication is unavailable.');
   auth={value:data.access_token,expires:now()+Math.min(Number(data.expires_in)||3600,3600)*1000};return auth.value;
  })();
  try{return await authPending;}finally{authPending=null;}
 }
 async function query(sql,params=[]){
  const headers={Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'};
  const url=`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`;
  const body={query:sql,useLegacySql:false,parameterMode:'NAMED',queryParameters:params,location:'US',useQueryCache:true,maximumBytesBilled:String(maxBytes),maxResults:1000,timeoutMs:20000};
  const probe=await json(url,{method:'POST',headers,body:JSON.stringify({...body,dryRun:true})});
  const estimate=Number(probe.totalBytesProcessed);
  if(!Number.isFinite(estimate)||estimate>maxBytes)throw failure('This location exceeds the configured query-cost limit. No forecast query was started.',429,'QUERY_LIMIT');
  // A unique requestId prevents an ambiguous HTTP retry from creating a second job.
  let result=await json(url,{method:'POST',headers,body:JSON.stringify({...body,requestId:randomUUID()})});
  for(let attempts=0;!result.jobComplete&&attempts<4;attempts++){
   const job=result.jobReference;
   if(!job?.jobId||job.projectId!==project)throw failure('WeatherNext query is still pending.');
   result=await json(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries/${encodeURIComponent(job.jobId)}?location=US&timeoutMs=20000&maxResults=1000`,{headers});
  }
  if(!result.jobComplete||result.errors?.length||result.pageToken)throw failure('WeatherNext did not return a complete forecast.');
  const names=result.schema?.fields?.map(f=>f.name)||[];
  return (result.rows||[]).map(row=>Object.fromEntries(names.map((name,i)=>[name,row.f[i]?.v??null])));
 }
 async function runs(){
  if(runCache&&runCache.expires>now())return runCache.value;
  const rows=await query(`SELECT CAST(MAX(IF(MOD(EXTRACT(HOUR FROM init_time),6)=0,init_time,NULL)) AS STRING) AS main_run, CAST(MAX(init_time) AS STRING) AS newest_run FROM \`${table}\` WHERE init_time BETWEEN TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 48 HOUR) AND CURRENT_TIMESTAMP()`);
  const main=rows[0]?.main_run,newest=rows[0]?.newest_run;
  if(!main||!Number.isFinite(Date.parse(main))||Date.parse(main)>now())throw failure('No current WeatherNext initialization is available.');
  const value=[main,...(newest&&newest!==main?[newest]:[])];runCache={value,expires:now()+30*60000};return value;
 }
 async function lookup(point){
  if(!configured)throw failure('Private location lookups are awaiting server setup.',503,'SETUP_REQUIRED');
  lookups=lookups.filter(t=>t>now()-3600000);
  if(lookups.length>=3)throw failure('New-location query limit reached. Try again in an hour; saved forecasts still work.',429,'QUERY_LIMIT');
  lookups.push(now());
  // NWS supplies the location's name/time zone, not the core weather values.
  const local=await json(`https://api.weather.gov/points/${point.latitude},${point.longitude}`,{headers:{Accept:'application/geo+json','User-Agent':'WeatherNourie (sun-nourie-live.onrender.com)'}});
  const zone=local.properties?.timeZone;
  try{if(!zone)throw Error();new Intl.DateTimeFormat('en-US',{timeZone:zone});}catch{throw failure('The selected location time zone could not be resolved.');}
  const place=local.properties.relativeLocation?.properties;
  const p={...point,timeZone:zone,name:place?.city?`${place.city}${place.state?', '+place.state:''}`:'Selected location'};
  const dates=await runs();
  const rows=await query(`SELECT CAST(t.init_time AS STRING) AS run_at, CAST(f.time AS STRING) AS valid_time, f.hours AS lead_hours, ST_X(t.geography) AS grid_lon, ST_Y(t.geography) AS grid_lat, ${fields.map(f=>'f.`'+f+'`').join(', ')} FROM \`${table}\` AS t, UNNEST(t.forecast) AS f WHERE t.init_time IN (${dates.map((_,i)=>'@run'+i).join(',')}) AND ST_DWITHIN(t.geography,ST_GEOGPOINT(@longitude,@latitude),15000) AND ST_INTERSECTS(t.geography_polygon,ST_GEOGPOINT(@longitude,@latitude)) AND f.hours BETWEEN 1 AND 360 QUALIFY ROW_NUMBER() OVER(PARTITION BY t.init_time,f.time ORDER BY ST_DISTANCE(t.geography,ST_GEOGPOINT(@longitude,@latitude)))=1 ORDER BY t.init_time,f.time`,[...dates.map((d,i)=>parameter('run'+i,'TIMESTAMP',d)),parameter('latitude','FLOAT64',p.latitude),parameter('longitude','FLOAT64',p.longitude)]);
  const sources={};
  for(let index=0;index<dates.length;index++){
   const selected=rows.filter(r=>Date.parse(r.run_at)===Date.parse(dates[index]));
   if(!selected.length){if(index===0)throw failure('WeatherNext has no forecast for the selected coordinates.');continue;}
   const hourly=selected.map(r=>{
    const values={};for(const field of fields){const split=field.lastIndexOf('_'),key=field.slice(0,split),stat=field.slice(split+1);const n=r[field]===null?null:Number(r[field]);(values[key]??={})[stat]=Number.isFinite(n)?n:null;}
    return {time:new Date(r.valid_time).toISOString(),forecastHour:Number(r.lead_hours),values};
   });
   sources[index===0?'surface':'interimSurface']={status:'ready',runAt:new Date(dates[index]).toISOString(),fetchedAt:new Date(now()).toISOString(),sourceTable:table,points:[{...p,gridLatitude:Number(selected[0].grid_lat),gridLongitude:Number(selected[0].grid_lon),hourly}]};
  }
  return {points:[p],sources,generatedAt:new Date(now()).toISOString()};
 }
 return {configured,lookup};
}
