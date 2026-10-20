import {calendarDayWindow} from './calendar-day.js?v=calendar-days-v1';
import {rainTiming,rainTimingHTML} from './rain-timing.js?v=current-rain-20261017-v3';
import {weatherState} from './weather-state.js?v=current-rain-20261017-v3';
import {dailyDisplay,dailyRainPeriod,finite} from './weather-math.js?v=current-rain-20261017-v3';
import {dailyFeels,degrees,timeAt} from './hourly-feels.js?v=current-rain-20261017-v3';
import {uvCategory} from './daily-uv.js?v=weather-art-labels-v10';
import {currentAirQuality} from './air-quality.js?v=mobile-repair-v1';
import {displayForecastConfidence,forecastConfidenceLabel} from './forecast-confidence.js?v=sky-rain-confidence-v6';
import {weatherIcon,weatherMetricIcon} from './weather-display.js?v=low-rain-display-v1';
import {hideLowRainChance,displayedRainChance,observedRainLabel,rainAwareCondition,dailySkyCover} from './rain-display.js?v=low-rain-display-v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reading=(value,unit='')=>finite(value)?`${Math.round(value)}${unit}`:'—';
export function periodWeatherStats(forecast,now=Date.now()){
 const day=forecast.days?.[0];if(!day)return {wind:null,humidity:null};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day.date||''))return {wind:null,humidity:null};
 const zone=forecast.location.timeZone||'America/New_York';
 const {start,end}=calendarDayWindow(day,0,now,zone);
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
 const explicitThunder=/thunder|\btstm\b|\bstorms?\b/i.test(condition);
 const wet=finite(pop)&&pop>=70;
 let scene='clear';
 if(explicitThunder&&state.kind==='storm'&&pop>=55&&!/chance|possible|isolated|scattered/i.test(condition))scene='storm';
 else if(wet)scene='overcast-rain';
 else if(explicitThunder&&state.kind==='storm')scene='building';
 else if(state.kind==='rain')scene=finite(pop)&&pop>=50?'overcast-rain':'cloudy';
 else if(state.kind==='snow'&&pop>=50)scene='overcast-rain';
 else if(state.kind==='cloudy'||pop>=45)scene='cloudy';
 else if(state.kind==='partly-cloudy'||state.kind==='fog'||pop>=15)scene='few-clouds';
 return {scene,pop,night:tonight,state:state.kind,lift,explicitThunder};
}

function hourlySkyKind(row={}){
 const textState=weatherState(row.condition);
 if(['storm','rain','snow','fog'].includes(textState.kind))return textState.kind;
 if(finite(row.skyCover)&&row.skyCover>=0&&row.skyCover<=100)return weatherState('',row.skyCover).kind;
 return textState.kind;
}
function skySceneFromKind(kind){
 if(['storm','rain','snow','fog','cloudy'].includes(kind))return 'cloudy';
 if(kind==='partly-cloudy')return 'few-clouds';
 if(kind==='clear')return 'clear';
 return null;
}
/** The large Today image should describe the weather that is actually left to experience,
 * not an earlier broad daily phrase. Current sky plus the next several hourly forecasts
 * are authoritative for Remainder of Today. */
export function todaySkyProfileForForecast(forecast={},day={},display={},now=Date.now()){
 const base=todaySkyProfile({...day,condition:display.condition,popDayLikelihood:{value:display.pop}},false);
 base.night=display.night===true;
 if(['storm','overcast-rain'].includes(base.scene))return base;
 const zone=forecast?.location?.timeZone||'America/New_York';
 const {end}=calendarDayWindow(day,0,now,zone);
 const samples=[];
 if(!display.night){
   const current=forecast?.current||{};
   const currentTime=Date.parse(current.time||forecast?.assembledAt);
   if(!finite(currentTime)||Math.abs(now-currentTime)<=3*3600000){
     const kind=hourlySkyKind(current);if(kind!=='unknown')samples.push({kind,weight:2});
   }
 }
 for(const row of forecast?.hours||[]){
   const t=Date.parse(row?.time);
   if(!finite(t)||t<now-15*60000||t>=end)continue;
   const kind=hourlySkyKind(row);if(kind==='unknown')continue;
   const lead=Math.max(0,(t-now)/3600000);
   samples.push({kind,weight:lead<=3?1.5:1});
   if(samples.length>=8)break;
 }
 if(!samples.length)return base;
 let cloudy=0,partial=0,clear=0,total=0;
 for(const sample of samples){
   const scene=skySceneFromKind(sample.kind),w=sample.weight;total+=w;
   if(scene==='cloudy')cloudy+=w;else if(scene==='few-clouds')partial+=w;else if(scene==='clear')clear+=w;
 }
 if(cloudy>=Math.max(partial+clear,total*.5))return {...base,scene:'cloudy',state:'cloudy',hourlySkyOverride:true};
 if(cloudy+partial>clear)return {...base,scene:'few-clouds',state:'partly-cloudy',hourlySkyOverride:true};
 if(clear>0)return {...base,scene:'clear',state:'clear',hourlySkyOverride:true};
 return base;
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
 const rainyNight=night&&['overcast-rain','storm'].includes(scene);
 if(scene==='cloudy'&&!night)return '<img class="today-sky today-sky-real-clouds today-sky-clouds-day" data-scene="cloudy" src="/weather-fusion/today-sky-clouds.webp" alt="" aria-hidden="true">';
 if(scene==='cloudy'&&night)return '<img class="today-sky today-sky-real-clouds today-sky-clouds-night" data-scene="cloudy" src="/weather-fusion/today-sky-clouds.webp" alt="" aria-hidden="true">';
 const asset=rainyNight?'rain':night?'night':['clear','few-clouds'].includes(scene)?'clear':scene==='overcast-rain'?'rain':'storm';
 const src=asset==='night'?'/weather-fusion/today-sky-night-v2.webp':`/weather-fusion/today-sky-${asset}.webp`;
 return `<img class="today-sky" data-scene="${scene}" src="${src}" alt="" aria-hidden="true">${night&&!rainyNight?moonPhaseHTML(epoch):''}`;
}
export function todayForecastHTML(forecast,now=Date.now()){
 const day=forecast.days?.[0];if(!day)return '<p class="muted">Daily forecast is unavailable.</p>';
 const p=dailyDisplay(day,0,now,forecast.location.timeZone,forecast),feel=dailyFeels(forecast,0,now),stats=periodWeatherStats(forecast,now);
 const timing=rainTiming(forecast,0,p.tonight,now);
 const rain=displayedRainChance(forecast,timing?timing.value:p.pop,{now}),shownPop=rain.value,shownCondition=rain.observed?'Rain now':rainAwareCondition(p.condition,shownPop,day,false,dailySkyCover(forecast,day,0,now));
 const uv=uvCategory(day.uvMax),confidence=displayForecastConfidence(day.confidence)?.label||'Unavailable',aqi=currentAirQuality(forecast,now)?.aqi;
 const metric=(kind,value,label,note)=>`<span class="today-metric" title="${esc(note)}">${weatherMetricIcon(kind)}<span><strong>${value}</strong><small>${label}</small></span></span>`;
 const baseProfile=todaySkyProfileForForecast(forecast,day,{...p,pop:shownPop,condition:shownCondition},now),profile=rain.observed?{...baseProfile,scene:'overcast-rain',state:'rain'}:baseProfile,feelPeak=feel.high?.high,feelValue=feelPeak?.value;
 const feelTime=feelPeak?new Intl.DateTimeFormat('en-US',{timeZone:forecast.location.timeZone||'America/New_York',hour:'numeric',minute:'2-digit'}).format(new Date(feelPeak.time)):null;
 const feelNote=feelTime?`${feelTime} · outdoors${feel.high?.partial?' · partial data':''}`:'Hourly estimate unavailable';
 const rt=forecast.rainTrend;
 const peakNote=timing?.peakLabel?`Peak ${timing.peakLabel}`:p.peakNote;
 const rainLabel=timing?.nwsFallback?'NWS rain chance':'Rain chance';
 const peakTime=timing?.peakLabel?`<span class="today-rain-peak">Peak ${esc(timing.peakLabel)}</span>`:'';
 const trend=rain.observed
  ? '<em data-rain-trend>Rain observed at this location</em>'
  : !rt||rt.direction==='first'
  ? '<em data-rain-trend>Change: — · first update</em>'
  : rt.direction==='same'
    ? '<em data-rain-trend>↔ 0 pts · unchanged</em>'
    : `<em data-rain-trend>${rt.direction==='up'?'↑ +':'↓ −'}${Math.round(rt.change)} pts${hideLowRainChance(rt.from)?'':` · was ${Math.round(rt.from)}%`}</em>`;
 const banner=confidenceBannerHTML(day);
 return `${banner}<button type="button" class="today-weather-card ${p.night?'today-night':p.remainder?'today-remainder':''}" data-today-forecast aria-haspopup="dialog" aria-label="${esc(p.label)}, ${esc(shownCondition)}, ${p.primaryLabel} ${reading(p.primary)} degrees${finite(p.secondary)?`, low ${reading(p.secondary)} degrees`:''}. ${rain.observed?'Rain is observed now at this location.':hideLowRainChance(shownPop)?'':finite(shownPop)?`Rain chance ${reading(shownPop)} percent.`:'Rain chance unavailable.'} ${forecastConfidenceLabel(day.confidence)} ${esc(confidence)}. Open details.">
 ${todaySkySceneHTML(profile,now)}<span class="today-scene-shade"></span><span class="today-copy"><span class="day-name">${esc(p.label)}</span><span class="today-condition" title="${esc(shownCondition)}">${esc(shortForecastCondition(shownCondition))}</span><span class="today-temperatures">${p.tonight?'':`<span class="today-low"><strong>${degrees(p.secondary)}</strong><small>Low</small></span><i>—</i>`}<span class="today-high"><strong>${degrees(p.primary)}</strong><small>${p.primaryLabel}</small></span></span><span class="today-feels">Peak forecast feels like <b>${degrees(feelValue)}</b><small>${esc(feelNote)}</small></span></span>
 <span class="today-symbol">${weatherIcon(shownCondition,!p.night,80)}${hideLowRainChance(shownPop)?'':`<strong>${reading(shownPop,'%')}</strong><small>${rain.observed?esc(observedRainLabel(rain)):!peakTime&&peakNote?`${rainLabel} · ${esc(peakNote)}`:rainLabel}</small>${rain.observed?'':peakTime}${trend}`}</span>
 <span class="today-metrics">${metric('wind',reading(stats.wind,' mph'),'Avg wind','Average available wind forecast for this period')}${metric('eye',reading(aqi),'AQI now',finite(aqi)?'Current modeled local air quality index.':'Current air-quality data is unavailable.')}${metric('sun',`${uv.value===null?'—':uv.index}`,'Peak UV','Peak UV forecast for the entire local calendar day, including elapsed hours')}</span><span class="today-more">Tap for more details</span></button>${rainTimingHTML(timing)}`;
}

export function confidenceBannerHTML(day={}){
 const notice=confidenceNotice(day.confidence,'today');
 if(!notice)return '';
 return `<button type="button" class="today-confidence-banner" data-today-forecast aria-haspopup="dialog"><strong>${esc(notice.title)}</strong><span>${esc(notice.text)}</span></button>`;
}

export function confidenceNotice(confidence,subject='forecast'){
 const c=displayForecastConfidence(confidence);
 if(!c||!['low','very-low'].includes(c.key))return null;
 if(c.scope==='sky-and-rain')return {title:`${c.key==='very-low'?'Very low':'Low'} sky/rain agreement${subject==='today'?' today':''}`,text:`${c.summary||'Sky and rain forecasts disagree or lack complete source coverage.'} Click for details.`};
 const factors=Array.isArray(c.factors)?c.factors.join(' '):'';
 const reasons=[];
 const temperatureSpread=finite(c.temperatureSpread)?c.temperatureSpread:Number(factors.match(/([\d.]+)°F (?:maximum same-hour temperature gap|(?:high-|daily-high )?temperature spread)/i)?.[1]),rainSpread=Number(factors.match(/([\d.]+) in rainfall-guidance spread/i)?.[1]);
 if(temperatureSpread>4||rainSpread>.15||/disagreement/i.test(factors))reasons.push('the forecast sources do not line up cleanly');
 if(/limited|unavailable|1 usable|0 usable|one NWS/i.test(factors))reasons.push('some usual forecast inputs are missing or limited');
 if(!reasons.length)reasons.push(`${subject==='today'?'today':'this forecast'} has more uncertainty than normal`);
 const title=c.key==='very-low'?`Very low confidence ${subject}`:`Lower confidence ${subject}`;
 return {title,text:c.summary?`${c.summary} Click for details.`:`${reasons.slice(0,2).join(', ')}. Click for details.`};
}
