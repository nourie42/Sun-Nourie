import {weatherState} from './weather-state.js';
import {dailyDisplay,dailyRainPeriod,finite} from './weather-math.js?v=forecast-trace-v40';
import {dailyFeels,degrees,timeAt} from './hourly-feels.js?v=weather-art-labels-v10';
import {uvCategory} from './daily-uv.js?v=weather-art-labels-v10';
import {weatherIcon,weatherMetricIcon} from './weather-display.js?v=rain-consensus-v41';
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
 const state=weatherState(condition),pop=dailyRainPeriod(day,tonight?'overnight':'daytime').value;
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
export function moonPhaseAt(epoch=Date.now()){
 const d=(epoch-Date.UTC(2000,0,1,12))/86400000,rad=Math.PI/180;
 const solarMean=(357.5291+.98560028*d)*rad;
 const sunLongitude=(280.147+.9856235*d+1.915*Math.sin(solarMean)+.02*Math.sin(2*solarMean))*rad;
 const lunarMean=(134.963+13.064993*d)*rad;
 const moonLongitude=(218.316+13.176396*d+6.289*Math.sin(lunarMean))*rad;
 const fraction=((moonLongitude-sunLongitude)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)/(2*Math.PI);
 const illumination=(1-Math.cos(2*Math.PI*fraction))/2;
 const names=['New moon','Waxing crescent','First quarter','Waxing gibbous','Full moon','Waning gibbous','Last quarter','Waning crescent'];
 const index=fraction<.03||fraction>=.97?0:fraction<.22?1:fraction<.28?2:fraction<.47?3:fraction<.53?4:fraction<.72?5:fraction<.78?6:7;
 return {fraction,illumination,name:names[index]};
}
function moonLightPath(fraction){
 const steps=48,theta=2*Math.PI*fraction,points=[];
 const point=(x,y)=>`${(50+44*x).toFixed(2)},${(50+44*y).toFixed(2)}`;
 if(fraction<=.5){
  for(let i=0;i<=steps;i++){const y=-1+2*i/steps;points.push(point(Math.sqrt(Math.max(0,1-y*y)),y));}
  for(let i=steps;i>=0;i--){const y=-1+2*i/steps;points.push(point(Math.cos(theta)*Math.sqrt(Math.max(0,1-y*y)),y));}
 }else{
  for(let i=0;i<=steps;i++){const y=-1+2*i/steps;points.push(point(-Math.cos(theta)*Math.sqrt(Math.max(0,1-y*y)),y));}
  for(let i=steps;i>=0;i--){const y=-1+2*i/steps;points.push(point(-Math.sqrt(Math.max(0,1-y*y)),y));}
 }
 return `M${points.join('L')}Z`;
}
export function moonPhaseHTML(epoch=Date.now()){
 const phase=moonPhaseAt(epoch),light=phase.illumination>.001?`<path d="${moonLightPath(phase.fraction)}" fill="url(#today-moon-light)"/>`:'';
 return `<span class="today-moon" role="img" aria-label="${phase.name}, ${Math.round(phase.illumination*100)} percent illuminated"><svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="today-moon-light" cx="35%" cy="32%"><stop offset="0" stop-color="#fff"/><stop offset=".68" stop-color="#edf3ee"/><stop offset="1" stop-color="#cbd8dc"/></radialGradient></defs><circle cx="50" cy="50" r="44" fill="#0b2d54" stroke="#b8d5e8" stroke-opacity=".5" stroke-width="1.5"/>${light}<circle cx="50" cy="50" r="44" fill="none" stroke="#fff" stroke-opacity=".34" stroke-width="1"/></svg></span>`;
}
export function todaySkySceneHTML(profile,epoch=Date.now()){
 const {scene,night}=profile;
 const asset=night?'night':['clear','few-clouds'].includes(scene)?'clear':scene==='cloudy'?'clouds':scene==='overcast-rain'?'rain':'storm';
 const src=night?'/weather-fusion/today-sky-night-v2.webp':`/weather-fusion/today-sky-${asset}.webp`;
 return `<img class="today-sky" data-scene="${scene}" src="${src}" alt="" aria-hidden="true">${night?moonPhaseHTML(epoch):''}`;
}
export function todayForecastHTML(forecast,now=Date.now()){
 const day=forecast.days?.[0];if(!day)return '<p class="muted">Daily forecast is unavailable.</p>';
 const p=dailyDisplay(day,0,now,forecast.location.timeZone),feel=dailyFeels(forecast,0,now),stats=periodWeatherStats(forecast,now);
 const uv=uvCategory(day.uvMax),confidence=day.confidence?.label||'Unavailable';
 const metric=(kind,value,label,note)=>`<span class="today-metric" title="${esc(note)}">${weatherMetricIcon(kind)}<span><strong>${value}</strong><small>${label}</small></span></span>`;
 const profile=todaySkyProfile(day,p.tonight),feelValue=p.tonight?feel.low?.low?.value:feel.high?.high?.value;
 const trend=forecast.rainTrend?.direction==='down'&&finite(forecast.rainTrend.change)?`<em>↓ Down ${Math.round(forecast.rainTrend.change)} points</em>`:'';
 return `<button type="button" class="today-weather-card ${p.tonight?'today-night':''}" data-today-forecast aria-haspopup="dialog" aria-label="${esc(p.label)}, ${esc(p.condition)}, ${p.primaryLabel} ${reading(p.primary)} degrees${finite(p.secondary)?`, low ${reading(p.secondary)} degrees`:''}. Forecast confidence ${esc(confidence)}. Open details.">
 ${todaySkySceneHTML(profile,now)}<span class="today-scene-shade"></span><span class="today-copy"><span class="day-name">${esc(p.label)}</span><span class="today-condition" title="${esc(p.condition)}">${esc(shortForecastCondition(p.condition))}</span><span class="today-temperatures">${p.tonight?'':`<span class="today-low"><strong>${degrees(p.secondary)}</strong><small>Low</small></span><i>—</i>`}<span class="today-high"><strong>${degrees(p.primary)}</strong><small>${p.primaryLabel}</small></span></span><span class="today-feels">Feels like <b>${degrees(feelValue)}</b></span></span>
 <span class="today-symbol">${weatherIcon(p.condition,!p.tonight,80)}<strong>${reading(p.pop,'%')}</strong><small>Rain chance</small>${trend}</span>
 <span class="today-metrics">${metric('wind',reading(stats.wind,' mph'),'Wind','Average available wind forecast for this period')}${metric('sun',`${uv.value===null?'—':uv.index}`,'UV Index','Peak UV forecast today')}</span><span class="today-more">Click for more details <b aria-hidden="true">›</b></span></button>`;
}
