/** Air-quality feed. It is displayed alongside weather and never changes the weather blend. */
export const AIR_QUALITY_VERSION='weather-nourie-air-quality-v1';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const HOUR=3600000;

export function airQualityUrl(location){
 return 'https://air-quality-api.open-meteo.com/v1/air-quality?'+new URLSearchParams({
  latitude:String(location.latitude),
  longitude:String(location.longitude),
  current:'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
  hourly:'us_aqi',
  forecast_days:'5',
  timezone:'GMT',
  timeformat:'unixtime'
 });
}

const iso=value=>{
 if(finite(value))return new Date(value*1000).toISOString();
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
};

export function normalizeAirQuality(raw){
 const current=raw?.current,hourly=raw?.hourly;
 if(!current||!finite(current.us_aqi))return null;
 const hours=Array.isArray(hourly?.time)?hourly.time.map((time,index)=>({
  time:iso(time),
  aqi:finite(hourly.us_aqi?.[index])?hourly.us_aqi[index]:null,
 })).filter(row=>row.time):[];
 return {
  source:'Open-Meteo / CAMS',
  url:'https://open-meteo.com/en/docs/air-quality-api',
  time:iso(current.time),
  aqi:current.us_aqi,
  pm25:finite(current.pm2_5)?current.pm2_5:null,
  pm10:finite(current.pm10)?current.pm10:null,
  ozone:finite(current.ozone)?current.ozone:null,
  nitrogenDioxide:finite(current.nitrogen_dioxide)?current.nitrogen_dioxide:null,
  hours,
 };
}

export function addAirQuality(out,airQuality){
 out.airQualityVersion=AIR_QUALITY_VERSION;
 if(!airQuality){out.airQuality=null;return out;}
 const start=Date.parse(out.assembledAt),end=start+24*HOUR;
 const values=(airQuality.hours||[]).filter(row=>{
  const time=Date.parse(row.time);return finite(row.aqi)&&time>=start&&time<=end;
 }).map(row=>row.aqi);
 out.airQuality={...airQuality,next24HourPeak:values.length?Math.max(...values):null};
 return out;
}
