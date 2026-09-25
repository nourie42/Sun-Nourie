/** Google-only, timestamp-preserving adapter. No other provider is a fallback. */
export const HOUR=3600000;
export const GOOGLE_FEED='https://raw.githubusercontent.com/nourie42/Sun-Nourie/weather-fusion-data/models/weathernext-full.json';
export const finite=v=>typeof v==='number'&&Number.isFinite(v);
const n=v=>finite(v)?v:null;
const at=(r,k,s='mean')=>n(r?.values?.[k]?.[s]);
const f=v=>finite(v)?(v-273.15)*1.8+32:null;
const mph=v=>finite(v)?v*2.2369362921:null;
const inches=v=>finite(v)?v/0.0254:null;
const validTime=t=>Number.isFinite(Date.parse(t));
const allowed=['surface','interimSurface','previousSurface'];
const stationFor={surface:'station',interimSurface:'interimStation',previousSurface:'previousStation'};
export function googlePoints(feed){
 if(!feed||!Array.isArray(feed.points)||!feed.sources)throw Error('The published Google forecast is unavailable or invalid.');
 return feed.points.filter(p=>p&&typeof p.id==='string'&&finite(p.latitude)&&finite(p.longitude)&&p.latitude>=24&&p.latitude<=50&&p.longitude>=-125&&p.longitude<=-66).map(p=>({id:p.id,name:p.name||p.id,latitude:p.latitude,longitude:p.longitude,timeZone:p.timeZone||'America/New_York'}));
}
export function skyDescription(cloud,rain){
 if(finite(rain)&&rain>=.005)return 'Rain forecast';
 if(!finite(cloud))return 'Sky cover unavailable';
 return cloud>=90?'Overcast':cloud>=70?'Mostly cloudy':cloud>=20?'Partly cloudy':'Clear';
}
export function selectGoogleForecast(feed,pointId,now=Date.now()){
 const point=googlePoints(feed).find(p=>p.id===pointId);
 if(!point)throw Object.assign(Error('Google has no published forecast for that location. Choose a listed comparison location.'),{status:404});
 const chosen=new Map(),stationMaps=new Map(),used=new Map();
 for(const id of allowed){
  const source=feed.sources[id],init=Date.parse(source?.runAt),p=source?.points?.find(p=>p.id===pointId);
  if(!source||!['ready','last-verified'].includes(source.status)||!finite(init)||init>now||!Array.isArray(p?.hourly))continue;
  const station=feed.sources[stationFor[id]],sp=station?.points?.find(p=>p.id===pointId);
  const stationGood=['ready','last-verified'].includes(station?.status)&&Date.parse(station?.runAt)===init;
  stationMaps.set(id,stationGood?new Map((sp?.hourly||[]).filter(r=>validTime(r.time)).map(r=>[Date.parse(r.time),r])):new Map());
  for(const row of p.hourly){
   const time=Date.parse(row?.time);
   if(!finite(time)||time<=init||time<now-72*HOUR||time>now+360*HOUR)continue;
   if(id==='interimSurface'&&time-init>48*HOUR)continue;
   const old=chosen.get(time);
   if(!old||init>old.init||(init===old.init&&id==='surface'))chosen.set(time,{id,source,row,init,point:p});
  }
 }
 if(![...chosen.keys()].some(t=>t>=Math.floor(now/HOUR)*HOUR))throw Object.assign(Error('No Google forecast covers the current or upcoming hours. Older data is not presented as current.'),{status:503});
 const rows=[...chosen].sort((a,b)=>a[0]-b[0]).map(([time,c])=>{
  const sr=stationMaps.get(c.id)?.get(time);
  const stationTemp=at(sr,'station_head_temperature_2m')??at(sr,'temperature_2m');
  const stationDew=at(sr,'station_head_dewpoint_temperature_2m')??at(sr,'dewpoint_temperature_2m');
  const temperature=f(stationTemp??at(c.row,'temperature_2m'));
  const dewpoint=f(stationDew??at(c.row,'dewpoint_temperature_2m'));
  const cloud=at(c.row,'total_cloud_cover');
  const u=at(c.row,'u_component_of_wind_10m'),v=at(c.row,'v_component_of_wind_10m');
  const wind=mph(at(c.row,'wind_speed_10m'));
  const windDirection=finite(u)&&finite(v)&&Math.hypot(u,v)>0?(Math.atan2(-u,-v)*180/Math.PI+360)%360:null;
  const next=chosen.get(time+HOUR);
  // An accumulation ending at t+1 belongs to [t,t+1), not [t-1,t).
  const precipitation=inches(at(next?.row,'total_precipitation_1hr'));
  const skyCover=finite(cloud)&&cloud>=0&&cloud<=1?cloud*100:null;
  const meta={id:c.id,runAt:c.source.runAt,fetchedAt:c.source.fetchedAt,status:c.source.status,gridLatitude:c.point.gridLatitude,gridLongitude:c.point.gridLongitude};
  used.set(c.id,meta);
  return {time:new Date(time).toISOString(),epoch:time,temperature,dewpoint,wind,windDirection,skyCover,
   pressure:finite(at(c.row,'mean_sea_level_pressure'))?at(c.row,'mean_sea_level_pressure')/3386.389:null,
   solar:finite(at(c.row,'surface_solar_radiation_downwards_1hr'))?at(c.row,'surface_solar_radiation_downwards_1hr')/3600:null,
   precipitation,precedingPrecipitation:inches(at(c.row,'total_precipitation_1hr')),
   precipitationStart:new Date(time).toISOString(),precipitationEnd:new Date(time+HOUR).toISOString(),
   precipitationRunAt:next?.source.runAt??null,condition:skyDescription(skyCover,precipitation),
   pop:null,gust:null,visibility:null,uvIndex:null,
   temperatureSource:finite(stationTemp)?'Google WeatherNext station-trained':'Google WeatherNext surface',
   dewpointSource:finite(stationDew)?'Google WeatherNext station-trained':'Google WeatherNext surface',
   temperatureP10:f(finite(stationTemp)?(at(sr,'station_head_temperature_2m','p10')??at(sr,'temperature_2m','p10')):at(c.row,'temperature_2m','p10')),
   temperatureP90:f(finite(stationTemp)?(at(sr,'station_head_temperature_2m','p90')??at(sr,'temperature_2m','p90')):at(c.row,'temperature_2m','p90')),
   provenance:meta};
 });
 return {point,rows,runs:[...used.values()],fetchedAt:feed.fetchedAt||feed.generatedAt||null};
}
/** Compare only identical forecast timestamps; never nearest-neighbor hours. */
export function matchedForecastValues(fusion,google,now=Date.now()){
 const googleHours=new Map((google?.hours||[]).map(r=>[Date.parse(r.time),r]));
 const h=(fusion?.hours||[]).find(r=>Date.parse(r.time)>=now&&googleHours.has(Date.parse(r.time)));
 if(!h)return null;
 return {time:h.time,fusion:h,google:googleHours.get(Date.parse(h.time))};
}
