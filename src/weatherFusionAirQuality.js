/** Air-quality feed. It is displayed alongside weather and never changes the weather blend. */
export const AIR_QUALITY_VERSION='weather-nourie-air-quality-v1';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const nonnegative=value=>finite(value)&&value>=0?value:null;
const HOUR=3600000;
export const MAX_AIR_QUALITY_AGE_MS=2*HOUR;

export function airQualityUrl(location){
 return 'https://air-quality-api.open-meteo.com/v1/air-quality?'+new URLSearchParams({
  latitude:String(location.latitude),
  longitude:String(location.longitude),
  current:'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
  hourly:'us_aqi',
  forecast_days:'7',
  timezone:'GMT',
  timeformat:'unixtime'
 });
}

const iso=value=>{
 const parsed=finite(value)?value*1000:typeof value==='string'?Date.parse(value):NaN;
 const time=new Date(parsed);
 return finite(time.getTime())?time.toISOString():null;
};

export function normalizeAirQuality(raw){
 const current=raw?.current,hourly=raw?.hourly;
 const time=iso(current?.time);
 if(!current||nonnegative(current.us_aqi)===null||!time)return null;
 const hours=Array.isArray(hourly?.time)?hourly.time.map((time,index)=>({
  time:iso(time),
  aqi:nonnegative(hourly.us_aqi?.[index]),
 })).filter(row=>row.time):[];
 return {
  source:'Open-Meteo / CAMS',
  url:'https://open-meteo.com/en/docs/air-quality-api',
  time,
  aqi:current.us_aqi,
  pm25:nonnegative(current.pm2_5),
  pm10:nonnegative(current.pm10),
  ozone:nonnegative(current.ozone),
  nitrogenDioxide:nonnegative(current.nitrogen_dioxide),
  hours,
 };
}

export function addAirQuality(out,airQuality){
 out.airQualityVersion=AIR_QUALITY_VERSION;
 const start=Date.parse(out.assembledAt),end=start+24*HOUR;
 const reportedAt=Date.parse(airQuality?.time);
 if(!airQuality||nonnegative(airQuality.aqi)===null||!finite(start)||!finite(reportedAt)||reportedAt>start+5*60000||start-reportedAt>MAX_AIR_QUALITY_AGE_MS){out.airQuality=null;return out;}
 const values=(airQuality.hours||[]).filter(row=>{
  const time=Date.parse(row.time);return nonnegative(row.aqi)!==null&&time>=start&&time<end;
 }).map(row=>row.aqi);
 out.airQuality={...airQuality,next24HourPeak:values.length?Math.max(...values):null};
 return out;
}
