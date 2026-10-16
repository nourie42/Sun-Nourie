/* Displayed days always use the selected location's midnight-to-midnight date. */
const H=3600000,finite=Number.isFinite;
export function timeAt(date,hour,zone='America/New_York'){
 const target=Date.parse(`${date}T${String(hour).padStart(2,'0')}:00:00Z`);let guess=target;
 if(!finite(target))return NaN;
 for(let i=0;i<4;i++){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));
  const get=k=>parts.find(p=>p.type===k)?.value;
  const delta=target-Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);
  guess+=delta;if(!delta)break;
 }
 return guess;
}
export function calendarDayWindow(day,index=0,now=Date.now(),zone='America/New_York'){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day?.date||''))return {start:NaN,end:NaN};
 const next=new Date(Date.parse(day.date+'T12:00Z')+24*H).toISOString().slice(0,10);
 const midnight=timeAt(day.date,0,zone),end=timeAt(next,0,zone);
 return {start:index===0?Math.max(midnight,Math.floor(now/H)*H):midnight,end};
}
export function calendarDayTemperatures(forecast,index=0,now=Date.now()){
 const day=forecast?.days?.[index],window=calendarDayWindow(day,index,now,forecast?.location?.timeZone);
 if(day?.rainLikelihood?.aggregation!=='maximum-hourly')return {high:day?.high??null,low:day?.low??null,window};
 const metric=forecast?.metricForecasts?.series?.temperature;
 const series=metric?.length?metric:forecast?.hours?.map(row=>({time:row.time,value:row.temperature}))||[];
 const values=new Map(series.filter(row=>{const time=Date.parse(row.time);return time>=window.start&&time<window.end&&finite(row.value);}).map(row=>[Date.parse(row.time),row.value]));
 for(let time=window.start;time<window.end;time+=H)if(!values.has(time))return {high:null,low:null,window};
 const readings=[...values.values()];
 return {high:readings.length?Math.max(...readings):null,low:readings.length?Math.min(...readings):null,window};
}

const validChance=value=>finite(value)&&value>=0&&value<=100?value:null;
/** A period peak is supported only by complete, matching hourly coverage. */
export function rainWindowPeak(rows,window){
 if(!Number.isFinite(window.start)||!Number.isFinite(window.end)||window.end<=window.start)return {value:null,time:null};
 let cursor=window.start,peak=null;
 for(const row of rows){
  const start=Date.parse(row.time),end=Date.parse(row.end||row.endTime||new Date(start+H).toISOString());
  if(start>=window.end||end<=window.start)continue;
  const value=validChance(row.rainLikelihood?.value);
  if(start>cursor||value===null||end<=start)return {value:null,time:null};
  cursor=Math.max(cursor,Math.min(end,window.end));
  if(!peak||value>peak.value)peak={value,time:start};
 }
 return cursor>=window.end&&peak?peak:{value:null,time:null};
}

