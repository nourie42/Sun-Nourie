import {finite} from './weather-math.js';
const H=3600000;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const degrees=v=>finite(v)?`${Math.round(v)}°`:'—';
export function timeAt(date,hour,zone='America/New_York'){
 const target=Date.parse(`${date}T${String(hour).padStart(2,'0')}:00:00Z`);let guess=target;
 if(!finite(target))return NaN;
 for(let i=0;i<4;i++){
  const p=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));
  const get=k=>p.find(x=>x.type===k)?.value;
  const delta=target-Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);
  guess+=delta;if(!delta)break;
 }
 return guess;
}
export function forecastValue(f,key,time){
 const epoch=Date.parse(time);if(!finite(epoch))return null;
 // Match instants, not array indexes, local date strings or the current observation.
 const p=f?.metricForecasts?.series?.[key]?.find(p=>Date.parse(p.time)===epoch);
 return finite(p?.value)?p.value:null;
}
export function feelsAt(f,time){return forecastValue(f,'feels',time);}
export function summarizeFeels(f,start,end,now=-Infinity){
 const first=Math.max(start,Math.ceil(now/H)*H),unique=new Map();
 for(const p of f?.metricForecasts?.series?.feels||[]){const t=Date.parse(p.time);if(finite(t)&&t>=first&&t<end&&finite(p.value))unique.set(t,{...p,time:new Date(t).toISOString(),epoch:t});}
 const points=[...unique.values()].sort((a,b)=>a.epoch-b.epoch),expected=Math.max(0,Math.ceil((end-Math.ceil(first/H)*H)/H));
 if(!points.length)return null;
 const high=points.reduce((a,b)=>a.value>=b.value?a:b),low=points.reduce((a,b)=>a.value<=b.value?a:b);
 return {high,low,points,available:points.length,expected,partial:points.length<expected};
}
export function dailyFeels(f,index,now=Date.now()){
 const d=f?.days?.[index];if(!/^\d{4}-\d{2}-\d{2}$/.test(d?.date||''))return {high:null,low:null};
 const zone=f.location?.timeZone||'America/New_York',next=new Date(Date.parse(d.date+'T12:00:00Z')+24*H).toISOString().slice(0,10);
 const window=(name,start,end)=>{
  const a=Date.parse(d[name+'Window']?.start),b=Date.parse(d[name+'Window']?.end);
  return summarizeFeels(f,finite(a)?a:start,finite(b)?b:end,index===0?now:-Infinity);
 };
 return {high:window('high',timeAt(d.date,7,zone),timeAt(d.date,19,zone)),low:window('low',timeAt(d.date,19,zone),timeAt(next,7,zone))};
}
export function dayFeelsHTML(f,index,tonight=false,now=Date.now()){
 const s=dailyFeels(f,index,now),z=f.location?.timeZone||'America/New_York';
 const clock=t=>new Intl.DateTimeFormat('en-US',{timeZone:z,weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(t));
 const card=(summary,kind,label)=>{
  const p=summary?.[kind];
  if(!p)return `<div><small>${label}</small><strong>Unavailable</strong><span>Hourly inputs are missing.</span></div>`;
  return `<div><small>${label}${summary.partial?' · partial data':''}</small><strong>${degrees(p.value)}</strong><span>${esc(clock(p.time))} · air ${degrees(forecastValue(f,'temperature',p.time))}</span></div>`;
 };
 return `<section class="day-feels" aria-label="Hourly feels-like forecast"><h3>How it’s forecast to feel</h3><div class="day-feels-grid">${tonight?'':card(s.high,'high','Feels-like high')}${card(s.low,'low','Feels-like overnight low')}</div><p>Outdoor estimates from each hour’s temperature, dew point, wind and sky/sun exposure; the same values appear in the hourly forecast and outdoor figure. The feels-like peak and air-temperature high can occur at different hours.</p></section>`;
}
export function peakFeelsHTML(summary,zone='America/New_York'){
 if(!summary)return '<p class="comfort-later">Hourly feels-like outlook unavailable. Missing readings stay blank.</p>';
 const p=summary.chosen,time=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(p.time));
 return `<div class="comfort-later" data-peak-time="${esc(p.time)}"><span>${esc(summary.label)}${summary.partial?' · partial data':''}</span><strong>${degrees(p.value)}</strong><small>${esc(time)} · outdoors · hourly forecast</small></div>`;
}
