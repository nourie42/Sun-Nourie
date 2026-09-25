import {timeAt} from '../public/weather-fusion/hourly-feels.js';
import {nextDate} from './weatherFusion.js';
const HOUR=3600000;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const probability=v=>finite(v)&&v>=0&&v<=100?v:null;
const SOURCE='NWS supplemental rain probability';

export function normalizeNwsRain(raw,now=Date.now()){
 const p=raw?.properties,issuedAt=p?.updateTime||p?.updated||p?.generatedAt;
 const age=now-Date.parse(issuedAt);
 if(!Number.isFinite(age)||age>24*HOUR||age< -HOUR)return null;
 const periods=(p.periods||[]).map(r=>({start:r.startTime,end:r.endTime,value:probability(r.probabilityOfPrecipitation?.value),isDaytime:r.isDaytime}))
  .filter(r=>Number.isFinite(Date.parse(r.start))&&Date.parse(r.end)>Date.parse(r.start));
 return periods.length?{issuedAt,periods}:null;
}

export async function fetchNwsRain(point,fetchImpl=globalThis.fetch,now=Date.now()){
 const read=async url=>{
  const u=new URL(url);
  if(u.origin!=='https://api.weather.gov'||!/^\/(points|gridpoints)\//.test(u.pathname))throw Error('Unexpected NWS endpoint');
  const r=await fetchImpl(u.href,{headers:{Accept:'application/geo+json','User-Agent':'WeatherNourie (sun-nourie-live.onrender.com)'},signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!r.ok)throw Error('NWS rain probability unavailable');return r.json();
 };
 const p=await read('https://api.weather.gov/points/'+point.latitude+','+point.longitude);
 const settled=await Promise.allSettled([read(p.properties.forecast),read(p.properties.forecastHourly)]);
 const result=i=>settled[i].status==='fulfilled'?normalizeNwsRain(settled[i].value,now):null;
 return {daily:result(0),hourly:result(1)};
}

export function addNwsRain(out,rain){
 const daily=rain?.daily?.periods||[],hourly=rain?.hourly?.periods||[];
 const at=(rows,t)=>rows.find(r=>Date.parse(r.start)<=t&&t<Date.parse(r.end));
 const likelihood=(r,kind)=>({value:r?.value??null,source:SOURCE,sourceId:'nws-rain',kind,window:r?{start:r.start,end:r.end}:null});
 for(const row of [...out.hours,...out.rainTimeline]){
  const p=at(hourly,Date.parse(row.time));row.pop=p?.value??null;row.rainLikelihood=likelihood(p,'hourly');
 }
 const current=at(hourly,Date.parse(out.current.time));out.current.pop=current?.value??null;
 out.metricForecasts.series.pop=out.rainTimeline.map(r=>({time:r.time,value:r.pop,source:SOURCE}));
 for(const day of out.days){
  const zone=out.location.timeZone;
  const daytime=at(daily,timeAt(day.date,13,zone)),night=at(daily,timeAt(nextDate(day.date),1,zone));
  day.popDayLikelihood=likelihood(daytime,'NWS daytime period');day.popNightLikelihood=likelihood(night,'NWS overnight period');
  day.popDay=daytime?.value??null;day.popNight=night?.value??null;
  // Never reinterpret hourly maximum or mean rain amount as a daily probability.
  // The headline is explicitly the larger of the two official period probabilities.
  const values=[day.popDay,day.popNight].filter(finite);
  day.pop=values.length?Math.max(...values):null;
  day.rainLikelihood={value:day.pop,source:SOURCE,sourceId:'nws-rain',kind:'maximum NWS day/night period probability',partial:values.length<2};
  day.popLabel=SOURCE;
  const note=' Rain chances are supplemental NWS forecasts. Daily percentage is the higher available NWS daytime/overnight chance; it is not the probability of rain over the combined 24 hours. Rain amounts remain WeatherNext ensemble means.';
  day.detail+=note;day.nightDetail+=note;
 }
 const available=out.days.some(d=>finite(d.pop))||out.hours.some(h=>finite(h.pop));
 out.comparison.rainProbabilitySource={source:SOURCE,url:'https://www.weather.gov/',dailyIssuedAt:rain?.daily?.issuedAt??null,hourlyIssuedAt:rain?.hourly?.issuedAt??null};
 if(available)out.comparison.missing=out.comparison.missing.filter(n=>n!=='Rain probability');
 out.metricForecasts.notes.pop='NWS hourly precipitation probability, not a WeatherNext ensemble probability. Missing or stale NWS values remain unavailable.';
 out.feeds.push({id:'nws-rain',label:'NWS supplemental rain chances',status:available?'ready':'unavailable',contributes:available,issuedAt:rain?.hourly?.issuedAt||rain?.daily?.issuedAt||null,url:'https://www.weather.gov/',message:available?'Rain probabilities only; WeatherNext temperatures and amounts are unchanged.':'NWS rain probabilities could not be refreshed. WeatherNext weather fields remain available.'});
 out.methodology+=' Rain probabilities are supplemental NWS forecasts; they do not replace WeatherNext temperatures or rainfall amounts.';
 return out;
}
