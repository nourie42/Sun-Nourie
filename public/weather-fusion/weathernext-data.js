/** Pure display calculations. Source values remain SI in downloads. */
export const HOUR = 3600000;
export const finite = v => typeof v === 'number' && Number.isFinite(v);
export const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function convert(v, kind) {
 if(!finite(v)) return null;
 if(kind==='temperature') return (v-273.15)*1.8+32;
 if(kind==='speed'||kind==='signed-speed') return v*2.2369362920544;
 if(kind==='rain') return v*39.37007874015748;
 if(kind==='fraction') return v*100;
 if(kind==='pressure') return v/100;
 if(kind==='solar') return v/3600;
 return v;
}
export function format(v,kind='number') {
 if(!finite(v)) return '—';
 if(kind==='rain') return v>0&&v<.005?'<0.01':v.toFixed(2);
 if(kind==='pressure') return v.toFixed(1);
 return String(Math.round(v));
}
export function value(row, field, statistic='mean') {return convert(row?.values?.[field.id]?.[statistic],field.kind);}
export function localDate(t, zone='America/New_York') {
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(t));
 const g=k=>parts.find(p=>p.type===k)?.value;
 return `${g('year')}-${g('month')}-${g('day')}`;
}
export function timeLabel(t,zone='America/New_York',date=true) {
 if(!Number.isFinite(Date.parse(t))) return 'Not supplied';
 return new Intl.DateTimeFormat('en-US',{timeZone:zone,...(date?{weekday:'short',month:'short',day:'numeric'}:{}),hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(t));
}
export function rowsFor(feed,sourceId,pointId) {
 return [...(feed?.sources?.[sourceId]?.points?.find(p=>p.id===pointId)?.hourly||[])].filter(r=>Number.isFinite(Date.parse(r.time))).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
}
export function statsAt(feed,sourceId,pointId,time,field) {
 const row=rowsFor(feed,sourceId,pointId).find(r=>r.time===time);
 return Object.fromEntries(['mean','p10','p25','p50','p75','p90'].map(s=>[s,value(row,field,s)]));
}
export function validateFeed(feed) {
 if(feed?.schema!=='weather-nourie-weathernext-site-v1'||!Array.isArray(feed.points)||!feed.sources?.surface) throw Error('The full WeatherNext feed has not been published yet.');
 const source=feed.sources.surface;
 if(!Number.isFinite(Date.parse(source.runAt))||!Array.isArray(source.points)||!source.points.some(p=>p.hourly?.length)) throw Error('WeatherNext returned no usable forecast hours.');
 return feed;
}
export function direction(u,v) {
 if(!finite(u)||!finite(v)||Math.hypot(u,v)<.5) return null;
 const degrees=(Math.atan2(-u,-v)*180/Math.PI+360)%360;
 return {degrees,compass:['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(degrees/22.5)%16]};
}
export function daysFrom(rows,zone,now=Date.now()) {
 const groups=new Map();
 for(const row of rows){
  // Amounts cover the PRECEDING hour; temperature is instantaneous at valid time.
  const k=localDate(Date.parse(row.time)-1,zone);
  if(k<localDate(now,zone))continue;
  if(!groups.has(k))groups.set(k,[]);
  groups.get(k).push(row);
 }
 return [...groups].slice(0,16).map(([date,hours])=>{
  const instant=rows.filter(r=>localDate(r.time,zone)===date);
  const sample=(rs,id,kind)=>rs.map(r=>convert(r.values?.[id]?.mean,kind)).filter(finite);
  const ts=sample(instant,'temperature_2m','temperature'),rain=sample(hours,'total_precipitation_1hr','rain'),winds=sample(instant,'wind_speed_10m','speed');
  const intervals=new Set(hours.map(r=>r.time));
  const cover=intervals.size;
  // 23/25-hour DST days are valid: compare adjacent local-midnight boundaries.
  const nextDate=localDate(Date.parse(`${date}T12:00:00Z`)+24*HOUR,'UTC');
  function midnight(day){let t=Date.parse(day+'T00:00:00Z');for(let i=0;i<4;i++){
   const p=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t));
   const g=k=>p.find(x=>x.type===k)?.value;const local=Date.parse(`${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:00Z`);
   t+=Date.parse(day+'T00:00:00Z')-local;
  }return t;}
  const expected=Math.round((midnight(nextDate)-midnight(date))/HOUR);
  return {date,hours,coverage:cover,expected,partial:cover!==expected||rain.length!==expected,
   high:ts.length?Math.max(...ts):null,low:ts.length?Math.min(...ts):null,
   rain:rain.length?rain.reduce((a,b)=>a+b,0):null,rainHours:rain.length,
   wind:winds.length?Math.max(...winds):null};
 });
}
export function csvText(feed,sourceId,pointId,fields) {
 const rows=rowsFor(feed,sourceId,pointId),source=feed.sources[sourceId];
 const applicable=fields.filter(f=>source?.fields?.includes(f.id));
 const stats=['mean','p10','p25','p50','p75','p90'];
 const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
 const header=['run_utc','valid_utc','lead_hours',...applicable.flatMap(f=>stats.map(s=>`${f.id}_${s} (${f.unit})`))];
 return [header,...rows.map(r=>[source.runAt,r.time,r.forecastHour,...applicable.flatMap(f=>stats.map(s=>value(r,f,s)??''))])].map(r=>r.map(quote).join(',')).join('\r\n');
}
