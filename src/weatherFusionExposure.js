/** Independent UV / surface-weather feed. It never changes the NWS/model blend. */
export const EXPOSURE_VERSION='compact-comfort-hourly-uv-v2';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function exposureWeatherUrl(location,zone='America/New_York'){
 return 'https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({
  latitude:String(location.latitude),longitude:String(location.longitude),timezone:zone,
  hourly:'temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m,cloud_cover,shortwave_radiation_instant,precipitation,uv_index',
  daily:'uv_index_max',past_days:'2',forecast_days:'8',timeformat:'unixtime',temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'mm'
 });
}
export function normalizeExposureWeather(raw){
 const h=raw?.hourly,u=raw?.hourly_units;
 if(!Array.isArray(h?.time)||!raw.timezone||u?.temperature_2m!=='°F'||u?.wind_speed_10m!=='mp/h'||u?.shortwave_radiation_instant!=='W/m²')return null;
 const value=(key,i)=>finite(h[key]?.[i])?h[key][i]:null;
 const rows=h.time.map((t,i)=>({time:finite(t)?new Date(t*1000).toISOString():null,temperature:value('temperature_2m',i),dewpoint:value('dew_point_2m',i),humidity:value('relative_humidity_2m',i),wind:value('wind_speed_10m',i),skyCover:value('cloud_cover',i),solar:value('shortwave_radiation_instant',i),rain:value('precipitation',i),uvIndex:finite(h.uv_index?.[i])&&h.uv_index[i]>=0?h.uv_index[i]:null})).filter(r=>r.time);
 const localDate=t=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:raw.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t*1000));const get=k=>p.find(x=>x.type===k)?.value;return `${get('year')}-${get('month')}-${get('day')}`;};
 const uv=(raw.daily?.time||[]).map((t,i)=>({date:finite(t)?localDate(t):null,value:finite(raw.daily.uv_index_max?.[i])&&raw.daily.uv_index_max[i]>=0?raw.daily.uv_index_max[i]:null})).filter(x=>x.date);
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
