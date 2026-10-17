import {weatherState} from './weather-state.js?v=current-rain-20261017-v2';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const validCover=value=>finite(value)&&value>=0&&value<=100;

/** Cloud cover for this calendar date only. A later night's clouds must not
 * supply today's sky icon. Prefer the hourly sky input, then its metric input. */
export function dailySkyCover(forecast={},day={},index=0,now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day?.date||''))return null;
 const zone=forecast?.location?.timeZone||'America/New_York';
 let dateFormat;
 try{dateFormat=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});}catch{return null;}
 const localDate=epoch=>{
  const parts=Object.fromEntries(dateFormat.formatToParts(new Date(epoch)).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
 };
 const first=index===0?Math.floor(now/3600000)*3600000:-Infinity,points=new Map();
 const collect=(rows,valueAt)=>{
  for(const row of rows||[]){
   const epoch=Date.parse(row?.time),value=valueAt(row);
   if(!finite(epoch)||epoch<first||!validCover(value)||points.has(epoch)||localDate(epoch)!==day.date)continue;
   points.set(epoch,value);
  }
 };
 collect(forecast.hours,row=>row.skyCover);
 collect(forecast.metricForecasts?.series?.skyCover,row=>row.value);
 collect(forecast.metricForecasts?.series?.feels,row=>row.inputs?.skyCover);
 const values=[...points.values()];
 return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
}

export function rainObservedNow(forecast,now=Date.now(),maxAgeMs=15*60*1000){
 const radar=forecast?.current?.radarPrecipitation;
 if(radar?.status!=='ready'||radar.atLocation!==true)return false;
 const observed=Date.parse(radar.observedAt);
 if(Number.isFinite(observed)){
  const age=now-observed;
  if(age< -5*60*1000||age>maxAgeMs)return false;
 }
 return true;
}

export function displayedRainChance(forecast,forecastChance,{dayIndex=0,now=Date.now()}={}){
 const value=finite(forecastChance)&&forecastChance>=0&&forecastChance<=100?forecastChance:null;
 const observed=dayIndex===0&&rainObservedNow(forecast,now);
 return {value:observed?100:value,forecastValue:value,observed};
}

export function observedRainLabel(display){
 if(!display?.observed)return '';
 return finite(display.forecastValue)
  ? `Rain now · remaining forecast peak ${Math.round(display.forecastValue)}%`
  : 'Rain now · observed radar';
}

// Daily artwork describes the prevailing sky. Keep a small shower chance in the
// probability, rather than letting broad NWS shower wording make every day rainy.
export const RAIN_ICON_CHANCE = 35;
export function rainAwareCondition(condition = '', pop = null, day = {}, tonight = false, skyCover = day?.skyCover) {
  const text = String(condition || '');
  if(!finite(pop)||pop<0||pop>100)return text;
  // Snow/ice can matter even at a low probability; actual current rain is an
  // observation, not the low-probability daily forecast being simplified here.
  if(/snow|sleet|flurr|ice pellets|freezing rain|\bice\b/i.test(text)||/\b(?:rain|showers?|drizzle|thunderstorms?)\s+(?:now|observed)\b/i.test(text))return text;
  if(pop<RAIN_ICON_CHANCE){
   const state=weatherState(text);
   if(!['rain','storm','unknown'].includes(state.kind))return text;
   if(validCover(skyCover))return weatherState('',skyCover).label;
   // A combined phrase can still provide a real sky description. Never infer
   // sunshine merely from the absence of a likely rain event.
   const sky=text.match(/\b(?:partly (?:sunny|cloudy)|mostly (?:sunny|clear|cloudy)|few clouds|overcast|cloudy|sunny|clear|fair|fog|mist|haze)\b/i);
   return sky?sky[0]:'Cloudy';
  }
  if (/thunder|\btstm\b|storm|rain|shower|drizzle|snow|sleet|flurr|ice|freezing/i.test(text)) return text;
  const base = text.replace(/\s+then\s+.*$/i, '') || 'Mixed';
  // The shown probability already belongs to the selected calendar date. Do
  // not borrow tomorrow-morning thunder wording from an NWS overnight period.
  return tonight?'Chance of showers':`${base}, chance of showers`;
}
