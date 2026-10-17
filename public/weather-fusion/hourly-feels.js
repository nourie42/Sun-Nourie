import {timeAt,calendarDayWindow} from './calendar-day.js?v=calendar-days-v1';
import {finite} from './weather-math.js?v=current-rain-20261017-v1';
const H=3600000;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const degrees=v=>finite(v)?`${Math.round(v)}°`:'—';
export {timeAt} from './calendar-day.js?v=calendar-days-v1';
export function forecastValue(f,key,time){
 const epoch=Date.parse(time);if(!finite(epoch))return null;
 // Match instants, not array indexes, local date strings or the current observation.
 const p=f?.metricForecasts?.series?.[key]?.find(p=>Date.parse(p.time)===epoch);
 return finite(p?.value)?p.value:null;
}
export function feelsAt(f,time){return forecastValue(f,'feels',time);}
// Wind-chip highlighting only. Gusts do not select a different thermal model.
export const GUSTY_FEELS_DISPLAY_MPH=25;
/** Preserve the calculated equivalent temperature. Dew point is a moisture
 * input, not a lower bound for human thermal sensation. A gust threshold must
 * never cause a discontinuous change in the displayed feels-like reading.
 */
export function displayFeelsValue(value){return finite(value)?value:null;}
export function displayedFeelsAt(f,time){return displayFeelsValue(feelsAt(f,time));}
export function summarizeFeels(f,start,end,now=-Infinity){
 const first=Math.max(start,Math.ceil(now/H)*H),unique=new Map();
 for(const p of f?.metricForecasts?.series?.feels||[]){const t=Date.parse(p.time);if(finite(t)&&t>=first&&t<end&&finite(p.value)){const time=new Date(t).toISOString(),shown=displayedFeelsAt(f,time);unique.set(t,{...p,rawValue:p.value,value:shown,time,epoch:t});}}
 const points=[...unique.values()].sort((a,b)=>a.epoch-b.epoch),expected=Math.max(0,Math.ceil((end-Math.ceil(first/H)*H)/H));
 if(!points.length)return null;
 const high=points.reduce((a,b)=>a.value>=b.value?a:b),low=points.reduce((a,b)=>a.value<=b.value?a:b);
 return {high,low,points,available:points.length,expected,partial:points.length<expected};
}
export function dailyFeels(f,index,now=Date.now()){
 const d=f?.days?.[index];if(!/^\d{4}-\d{2}-\d{2}$/.test(d?.date||''))return {high:null,low:null};
 const window=calendarDayWindow(d,index,now,f.location?.timeZone),summary=summarizeFeels(f,window.start,window.end);
 return {high:summary,low:summary};
}
export function dayFeelsHTML(f,index,tonight=false,now=Date.now()){
 const s=dailyFeels(f,index,now),z=f.location?.timeZone||'America/New_York';
 const clock=t=>new Intl.DateTimeFormat('en-US',{timeZone:z,weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(t));
 const card=(summary,kind,label)=>{
  const p=summary?.[kind];
  if(!p)return `<div><small>${label}</small><strong>Unavailable</strong><span>Hourly inputs are missing.</span></div>`;
  return `<div><small>${label}${summary.partial?' · partial data':''}</small><strong>${degrees(p.value)}</strong><span>${esc(clock(p.time))} · air ${degrees(forecastValue(f,'temperature',p.time))}</span></div>`;
 };
 return `<section class="day-feels" aria-label="Hourly feels-like forecast"><h3>How it’s forecast to feel</h3><div class="day-feels-grid">${tonight?'':card(s.high,'high','Feels-like high')}${card(s.low,'low','Feels-like low on this date')}</div><p>Outdoor estimates from each hour’s temperature, dew point, wind and sky/sun exposure; the same values appear in the hourly forecast and outdoor figure. The feels-like peak and air-temperature high can occur at different hours.</p></section>`;
}
export function peakFeelsHTML(summary,zone='America/New_York'){
 if(!summary)return '<p class="comfort-later">Hourly feels-like outlook unavailable. Missing readings stay blank.</p>';
 const p=summary.chosen,time=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date(p.time));
 return `<div class="comfort-later" data-peak-time="${esc(p.time)}"><span>${esc(summary.label)}${summary.partial?' · partial data':''}</span><strong>${degrees(p.value)}</strong><small>${esc(time)} · outdoors · hourly forecast</small></div>`;
}
