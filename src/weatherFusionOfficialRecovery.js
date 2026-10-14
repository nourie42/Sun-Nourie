// Retain verified official guidance briefly during a failed refresh. The
// original fetch time and valid period remain visible; age never resets.
const MINUTE=60000;
function duration(text){
 const m=/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(text||'');
 return m?(Number(m[1]||0)*24*60+Number(m[2]||0)*60+Number(m[3]||0)+Number(m[4]||0)/60)*MINUTE:NaN;
}
export function retainOfficialFeed(url,saved,now){
 const age=now-Date.parse(saved?.fetchedAt),properties=saved?.data?.properties;
 if(!Number.isFinite(age)||age<0||!properties)return false;
 let path;try{const u=new URL(url);if(u.hostname!=='api.weather.gov')return false;path=u.pathname;}catch{return false;}
 if(path.startsWith('/points/')){
  if(age>48*60*MINUTE)return false;
  try{
   new Intl.DateTimeFormat('en-US',{timeZone:properties.timeZone});
   return ['forecast','forecastHourly','forecastGridData'].every(key=>{const u=new URL(properties[key]);return u.protocol==='https:'&&u.hostname==='api.weather.gov'&&u.pathname.startsWith('/gridpoints/');});
  }catch{return false;}
 }
 if(age>30*MINUTE)return false;
 if(Array.isArray(properties.periods))return properties.periods.some(p=>{
  const start=Date.parse(p.startTime),end=Date.parse(p.endTime);
  return Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end>now&&typeof p.shortForecast==='string'&&p.shortForecast.trim()&&typeof p.temperature==='number'&&Number.isFinite(p.temperature);
 });
 if(Array.isArray(properties.temperature?.values))return properties.temperature.values.some(p=>{
  const [date,span]=String(p.validTime||'').split('/'),start=Date.parse(date),end=start+duration(span);
  return Number.isFinite(start)&&Number.isFinite(end)&&end>now&&typeof p.value==='number'&&Number.isFinite(p.value);
 });
 return false;
}
export function validateOfficialPayload(url,data){
 let path;try{const u=new URL(url);if(u.hostname!=='api.weather.gov')return;path=u.pathname;}catch{return;}
 if(/\/gridpoints\/[^/]+\/\d+,\d+\/forecast(?:\/hourly)?$/.test(path)){
  if(!Array.isArray(data?.properties?.periods)||!data.properties.periods.some(p=>Number.isFinite(Date.parse(p.startTime))&&Date.parse(p.endTime)>Date.parse(p.startTime)&&typeof p.shortForecast==='string'&&p.shortForecast.trim()))throw new Error('Official forecast did not supply usable periods.');
 }
 if(/^\/points\//.test(path)&&(!data?.properties?.timeZone||!data.properties.forecast))throw new Error('Official location lookup did not supply forecast references.');
}
export function criticalOfficialUrl(url){
 try{const u=new URL(url);return u.hostname==='api.weather.gov'&&/^\/(?:points|gridpoints|stations)\//.test(u.pathname);}catch{return false;}
}
