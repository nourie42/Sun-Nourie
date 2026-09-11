import {weatherState} from './weather-state.js';
import {dailyDisplay,finite} from './weather-math.js?v=weather-art-labels-v10';
import {dailyFeels,degrees,timeAt} from './hourly-feels.js?v=weather-art-labels-v10';
import {uvCategory} from './daily-uv.js?v=weather-art-labels-v10';
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
export function todaySkyProfile(day={},tonight=false){
 const condition=String(tonight?(day.nightCondition||day.condition):day.condition||''),detail=String(tonight?(day.nightDetail||day.detail):day.detail||'');
 const state=weatherState(condition),pop=finite(tonight?day.popNight:day.popDay)?(tonight?day.popNight:day.popDay):(finite(day.pop)?day.pop:0);
 const lift=/\b(lift|ascent|unstable|instability|cape|convection|convective|updraft|forcing)\b/i.test(`${condition} ${detail}`);
 let scene='clear';
 if(state.kind==='storm'&&(pop>=55||!/chance|possible|isolated|scattered/i.test(condition)))scene='storm';
 else if(state.kind==='storm'&&pop<30)scene='few-clouds';
 else if(state.kind==='storm'||(lift&&pop>=30&&/storm|thunder/i.test(`${condition} ${detail}`)))scene='building';
 else if(['rain','snow'].includes(state.kind)&&pop>=50)scene='overcast-rain';
 else if(state.kind==='cloudy'||pop>=45)scene='cloudy';
 else if(state.kind==='partly-cloudy'||state.kind==='fog'||pop>=15)scene='few-clouds';
 return {scene,pop,night:tonight,state:state.kind,lift};
}
export function todaySkySceneHTML(profile){
 const {scene,night}=profile;
 const asset=night?'night':['clear','few-clouds'].includes(scene)?'clear':scene==='cloudy'?'clouds':scene==='overcast-rain'?'rain':'storm';
 return `<img class="today-sky" data-scene="${scene}" src="/weather-fusion/today-sky-${asset}.webp" alt="" aria-hidden="true">`;
}
export function todayForecastHTML(forecast,now=Date.now()){
 const day=forecast.days?.[0];if(!day)return '<p class="muted">Daily forecast is unavailable.</p>';
 const p=dailyDisplay(day,0,now,forecast.location.timeZone),feel=dailyFeels(forecast,0,now),stats=periodWeatherStats(forecast,now);
 const uv=uvCategory(day.uvMax),confidence=day.confidence?.label||'Unavailable';
 const metric=(kind,value,label,note)=>`<span class="today-metric" title="${esc(note)}">${weatherMetricIcon(kind)}<span><strong>${value}</strong><small>${label}</small></span></span>`;
 const profile=todaySkyProfile(day,p.tonight),feelValue=p.tonight?feel.low?.low?.value:feel.high?.high?.value;
 return `<button type="button" class="today-weather-card ${p.tonight?'today-night':''}" data-today-forecast aria-haspopup="dialog" aria-label="${esc(p.label)}, ${esc(p.condition)}, ${p.primaryLabel} ${reading(p.primary)} degrees${finite(p.secondary)?`, low ${reading(p.secondary)} degrees`:''}. Forecast confidence ${esc(confidence)}. Open details.">
 ${todaySkySceneHTML(profile)}<span class="today-scene-shade"></span><span class="today-copy"><span class="day-name">${esc(p.label)}</span><span class="today-condition" title="${esc(p.condition)}">${esc(shortForecastCondition(p.condition))}</span><span class="today-temperatures">${p.tonight?'':`<span class="today-low"><strong>${degrees(p.secondary)}</strong><small>Low</small></span><i>—</i>`}<span class="today-high"><strong>${degrees(p.primary)}</strong><small>${p.primaryLabel}</small></span></span><span class="today-feels">Feels like <b>${degrees(feelValue)}</b></span></span>
 <span class="today-symbol">${weatherIcon(p.condition,!p.tonight,80)}<strong>${reading(p.pop,'%')}</strong><small>Chance of rain</small></span>
 <span class="today-metrics">${metric('wind',reading(stats.wind,' mph'),'Wind','Average available wind forecast for this period')}${metric('sun',`${uv.value===null?'—':uv.index}`,'UV Index','Peak UV forecast today')}</span><span class="today-more">Click for more details <b aria-hidden="true">›</b></span></button>`;
}
