const H=3600000,finite=v=>typeof v==='number'&&Number.isFinite(v);
export const WN3_URL='https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext3.json';
export function validateWeatherNext3(feed,location,now){
 const run=Date.parse(feed?.runAt),generated=Date.parse(feed?.generatedAt);
 if(feed?.schema!=='weather-nourie-weathernext3-v1'||feed.model!=='Google WeatherNext 3'||!String(feed.sourceTable).endsWith('.weathernext_3_0_0_0p1deg')||feed.status!=='ready'||feed.units?.temperature!=='degF'||feed.timeStepHours!==1||feed.ensembleMembers<2)throw Error('Unverified WeatherNext 3 provenance or temperature units');
 if(!finite(run)||!finite(generated)||run>now+300000||generated>now+300000||now-run>36*H||now-generated>6*H)throw Error('WeatherNext 3 is stale');
 const point=feed.points?.find(p=>finite(p.latitude)&&finite(p.longitude)&&Math.abs(p.latitude-location.latitude)<=.1&&Math.abs(p.longitude-location.longitude)<=.1);
 if(!point)throw Error('WeatherNext 3 does not cover this location');
 const rows=point.hourly||[],seen=new Set(),times=[],temperatures=[];
 for(const row of rows){const time=Date.parse(row.time);if(!finite(time)||seen.has(time)||time<=run||time>run+Math.min(168,feed.horizonHours)*H||(time-run)%H!==0)throw Error('Invalid WeatherNext 3 valid time');seen.add(time);times.push(time/1000);temperatures.push(finite(row.temperatureF)&&row.temperatureF>=-150&&row.temperatureF<=160?row.temperatureF:null);}
 if(!times.some(t=>t*1000>=now)||!temperatures.some(finite))throw Error('WeatherNext 3 has no remaining temperature coverage');
 const fields={wind_speed_10m:['windMph','wind','mph',0,300,'mp/h'],dew_point_2m:['dewpointF','dewpoint','degF',-160,120,'°F'],cloud_cover:['skyCoverPercent','cloudCover','percent',0,100,'%']};
 const extra={},extraUnits={};
 for(const [field,[key,unitKey,unit,min,max,outputUnit]] of Object.entries(fields)){
  if(feed.units[unitKey]!==unit)continue;
  extra[field]=rows.map(r=>finite(r[key])&&r[key]>=min&&r[key]<=max?r[key]:null);extraUnits[field]=outputUnit;
 }
 const precipitationIntervals=feed.units.precipitation==='inch per 1-hour window'?rows.filter(r=>finite(r.precipitationInches)&&r.precipitationInches>=0&&r.precipitationInches<=30).map(r=>({start:Date.parse(r.time)/1000-3600,end:Date.parse(r.time)/1000,value:r.precipitationInches})):[];
 return {verifiedModel:true,model:'weathernext3',modelLabel:'Google WeatherNext 3 ensemble mean',runAt:feed.runAt,validUntil:new Date(Math.max(...times)*1000).toISOString(),latitude:point.latitude,longitude:point.longitude,sourceUrl:WN3_URL,transport:feed.source,publicBlendApproved:true,previouslyComparisonOnly:feed.comparisonOnly===true,hourly_units:{time:'unixtime',temperature_2m:'°F',...extraUnits},hourly:{time:times,temperature_2m:temperatures,...extra},precipitationIntervals};
}
export function createWeatherNext3({fetchImpl=globalThis.fetch,now=Date.now}={}){
 let cached=null,pending=null;
 return async location=>{
  const meta={id:'weathernext3',label:'Google WeatherNext 3',url:WN3_URL,status:'unavailable',fetchedAt:new Date(now()).toISOString()};
  try{
   if(!cached||now()-cached.at>5*60000){
    if(!pending)pending=(async()=>{const r=await fetchImpl(WN3_URL,{redirect:'error',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(`WeatherNext 3 HTTP ${r.status}`);const text=await r.text();if(Buffer.byteLength(text)>2500000)throw Error('WeatherNext 3 feed too large');cached={at:now(),data:JSON.parse(text)};})().finally(()=>{pending=null;});
    await pending;
   }
   const value=validateWeatherNext3(cached.data,location,now());return {value,meta:{...meta,status:'ready',issuedAt:value.runAt,validUntil:value.validUntil,contributes:true,message:'Validated native WeatherNext 3 ensemble-mean temperature; approved for V2 temperature. Native wind, dew point, cloud cover and hourly expected rain amounts are available for comparison where supplied. No calibrated rain probability is supplied.'}};
  }catch(e){return {value:null,meta:{...meta,message:e.message}};}
 };
}
