import {weatherState} from './weather-state.js';
import {dailyDisplay,finite,temperatureBar} from './weather-math.js?v=weather-art-labels-v10';
import {dailyFeels,degrees,timeAt} from './hourly-feels.js?v=weather-art-labels-v10';
import {dailyUvHTML,uvCategory} from './daily-uv.js?v=weather-art-labels-v10';
import {weatherIcon,weatherMetricIcon} from './weather-display.js?v=compact-weather-v21';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reading=(value,unit='')=>finite(value)?`${Math.round(value)}${unit}`:'—';
export function periodWeatherStats(forecast,now=Date.now()){
 const day=forecast.days?.[0];if(!day)return {wind:null,humidity:null};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date||''))return {wind:null,humidity:null};
 const p=dailyDisplay(day,0,now,forecast.location.timeZone),zone=forecast.location.timeZone||'America/New_York';
 const next=new Date(Date.parse(day.date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const window=day[p.tonight?'lowWindow':'highWindow'];
 const start=Math.max(now,Date.parse(window?.start)||timeAt(day.date,p.tonight?19:7,zone));
 const end=Date.parse(window?.end)||timeAt(p.tonight?next:day.date,p.tonight?7:19,zone);
 const mean=key=>{const values=(forecast.metricForecasts?.series?.[key]||[]).filter(x=>Date.parse(x.time)>=start&&Date.parse(x.time)<end&&finite(x.value)&&x.value>=0&&(key!=='humidity'||x.value<=100)).map(x=>x.value);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;};
 return {wind:mean('wind'),humidity:mean('humidity')};
}
export function shortForecastCondition(condition){
 return String(condition||'Conditions unavailable').split(/ then /i).map(part=>{
  const state=weatherState(part);
  if(['storm','rain','snow'].includes(state.kind))return ({storm:'Storms',rain:'Rain',snow:'Snow / ice'}[state.kind])+(state.chance?' possible':'');
  return part.charAt(0).toUpperCase()+part.slice(1).toLowerCase();
 }).map((part,i)=>i?part.charAt(0).toLowerCase()+part.slice(1):part).join(', then ');
}
export function todayForecastHTML(forecast,now=Date.now()){
 const day=forecast.days?.[0];if(!day)return '<p class="muted">Daily forecast is unavailable.</p>';
 const p=dailyDisplay(day,0,now,forecast.location.timeZone),feel=dailyFeels(forecast,0,now),stats=periodWeatherStats(forecast,now);
 const confidence=day.confidence||{label:'Unavailable',key:'unavailable',score:null};
 const confidenceTitle=[`Forecast confidence: ${confidence.label}.`,...(confidence.factors||[]),confidence.note||''].join(' ');
 const uv=uvCategory(day.uvMax),values=forecast.days.flatMap(d=>[d.high,d.low]).filter(finite);
 const bar=temperatureBar(p.primary,values.length?Math.min(...values)-3:0,values.length?Math.max(...values)+3:1);
 const feels=(value,partial)=>`<span class="today-feels">Feels like <b>${degrees(value)}</b>${partial?'<small>Partial forecast</small>':''}</span>`;
 const metric=(kind,value,label,note)=>`<span class="today-metric" title="${esc(note)}">${weatherMetricIcon(kind)}<span><strong>${value}</strong><small>${label}</small></span></span>`;
 return `<button type="button" class="today-weather-card ${p.tonight?'today-night':''}" data-today-forecast aria-haspopup="dialog" aria-label="${esc(p.label)}, ${esc(p.condition)}, ${p.primaryLabel} ${reading(p.primary)} degrees${finite(p.secondary)?`, low ${reading(p.secondary)} degrees`:''}. Forecast confidence ${esc(confidence.label)}. Open details.">
 <span class="today-main"><span class="today-overview"><span class="today-description"><span class="day-name">${esc(p.label)}</span><span class="today-condition" title="${esc(p.condition)}">${esc(shortForecastCondition(p.condition))}</span></span><span class="today-symbol">${weatherIcon(p.condition,!p.tonight,80)}<strong>${reading(p.pop,'%')}</strong><small>Chance of rain</small></span></span>
 <span class="today-range"><span class="today-temperatures">${p.tonight?'<span class="today-night-note">Overnight<br>forecast</span>':`<span class="today-low"><strong>${degrees(p.secondary)}</strong><small>Low</small>${feels(feel.low?.low?.value,feel.low?.partial)}</span>`}<span class="today-temp-track" aria-hidden="true">${bar===null?'':`<span style="width:${bar}%"></span><i style="left:clamp(7px,${bar}%,calc(100% - 7px))"></i>`}</span><span class="today-high"><strong>${degrees(p.primary)}</strong><small>${p.primaryLabel}</small>${feels(p.tonight?feel.low?.low?.value:feel.high?.high?.value,(p.tonight?feel.low:feel.high)?.partial)}</span></span>
 <span class="today-meta"><span class="forecast-confidence" data-confidence="${esc(confidence.key)}" title="${esc(confidenceTitle)}"><span>Forecast confidence</span><b>${esc(confidence.label)}</b>${finite(confidence.score)?`<i class="confidence-meter" aria-hidden="true"><em style="width:${confidence.score}%"></em></i>`:''}</span>${dailyUvHTML(day.uvMax,p.tonight?'Peak UV today':'Peak UV')}</span></span></span>
 <span class="today-metrics">${metric('drop',reading(p.pop,'%'),'Precipitation',`Chance of precipitation ${p.tonight?'tonight':'today'}`)}${metric('wind',reading(stats.wind,' mph'),'Wind','Average available wind forecast for this period')}${metric('sun',`${uv.value===null?'—':uv.index} <em>· ${esc(uv.label)}</em>`,'UV Index','Peak UV forecast today')}${metric('humidity',reading(stats.humidity,'%'),'Humidity','Average available humidity forecast for this period')}</span></button>`;
}
