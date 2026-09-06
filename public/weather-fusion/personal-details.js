import {forecastGrossLevel} from './dewpoint-meter.js?v=6-future';
import {exposureScene} from './exposure-scene.js?v=3-weather';
import {outdoorExposure} from './outdoor-feels.js?v=outdoor-v1';
import {solarElevation} from './weather-math.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const HOUR=3600000;
export const pressureMb=value=>finite(value)?value*33.86389:null;
export function stationPressureMb(current){return finite(current?.pressurePa)?current.pressurePa/100:pressureMb(current?.pressure);}
export function pressureTrendText(current){
 const t=current?.pressureTrend;
 if(t?.status!=='ready'||!finite(t.deltaMb)||!finite(t.hours))return 'Observed trend unavailable — comparable station readings are needed.';
 const direction=t.direction==='rising'?'↑ Rising':t.direction==='falling'?'↓ Dropping':'→ Nearly steady';
 return `${direction} · ${t.deltaMb>0?'+':''}${t.deltaMb.toFixed(1)} mb over ${t.hours.toFixed(1)} hours · observed`;
}
function wall(date,hour,zone){
 const target=Date.parse(`${date}T${String(hour).padStart(2,'0')}:00:00Z`);let guess=target;
 for(let i=0;i<4;i++){
  const p=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));
  const get=key=>p.find(v=>v.type===key)?.value;
  const offset=target-Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);
  guess+=offset;if(!offset)break;
 }
 return guess;
}
export function dailyGrossSummary(forecast,index,tonight=false,now=Date.now()){
 const d=forecast?.days?.[index];if(!/^\d{4}-\d{2}-\d{2}$/.test(d?.date||''))return null;
 const zone=forecast.location?.timeZone||'America/New_York';
 const next=new Date(Date.parse(d.date+'T12:00:00Z')+24*HOUR).toISOString().slice(0,10);
 const start=Math.max(wall(d.date,tonight?18:7,zone),index===0?now:-Infinity),end=wall(next,7,zone);
 const expected=Math.max(0,Math.ceil((end-Math.ceil(start/HOUR)*HOUR)/HOUR));
 const unique=new Map();
 for(const p of forecast.metricForecasts?.series?.dewpoint||[]){const t=Date.parse(p.time);if(t>=start&&t<end&&finite(p.value))unique.set(t,{...p,epoch:t});}
 const pts=[...unique.values()].sort((a,b)=>a.epoch-b.epoch);if(!pts.length)return null;
 const peak=pts.reduce((a,b)=>a.value>=b.value?a:b),low=Math.min(...pts.map(p=>p.value));
 const wind=forecast.metricForecasts?.series?.wind?.find(p=>Date.parse(p.time)===peak.epoch)?.value;
 return {peak:peak.value,low,time:peak.time,level:forecastGrossLevel(peak.value,wind),available:pts.length,expected,partial:pts.length<expected,zone,tonight};
}
export function dailyGrossHTML(forecast,index,tonight=false,now=Date.now()){
 const s=dailyGrossSummary(forecast,index,tonight,now);
 if(!s)return '<section class="day-gross"><h3>Gross Meter · dew point</h3><p>No dew-point forecast is available for this period.</p></section>';
 const when=new Intl.DateTimeFormat('en-US',{timeZone:s.zone,weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(s.time));
 return `<section class="day-gross" data-gross-level="${esc(s.level.key)}"><h3>Gross Meter · dew point</h3><div class="day-gross-reading"><strong>${Math.round(s.peak)}°</strong><span>Muggiest forecast${tonight?' tonight':''}<small>${esc(when)}</small></span></div><p class="day-gross-verdict">${esc(s.level.label)}</p><p>Forecast range: ${Math.round(s.low)}–${Math.round(s.peak)}°F dew point.</p><small>${s.partial?'Partial coverage · ':''}${s.available} of ${s.expected} forecast hours available · ${tonight?'Tonight through 7 AM':'7 AM through 7 AM the next day; past hours excluded'}.</small></section>`;
}
export function sunShadeHTML(comfort,location,now=Date.now(),context={}){
 const daylight=typeof comfort?.daylight==='boolean'?comfort.daylight:solarElevation(now,location?.latitude,location?.longitude)>0;
 const kind=comfort?.weatherKind||(finite(comfort?.sun)?'clear':'unknown');
 const condition=context.condition||comfort?.condition||({clear:'Clear','partly-cloudy':'Partly Cloudy',cloudy:'Cloudy',rain:'Rain',storm:'Thunderstorms',snow:'Snow',fog:'Fog'}[kind]||'');
 const shade=finite(comfort?.shade)?`${Math.round(comfort.shade)}°`:'Unavailable';
 const exposure=outdoorExposure({...comfort,daylight,weatherKind:kind,condition});
 const outdoorValue=exposure.value;
 const outside=finite(outdoorValue)?`${Math.round(outdoorValue)}°`:'Unavailable';
 const period=context.forecast?'forecast':'right now';
 const chance=/chance|possible|isolated|scattered (?:showers|storms)/i.test(condition);
 const labels={clear:'In direct sun','partly-cloudy':'During sunny breaks',cloudy:'Under clouds',rain:chance?'Rain possible':'In rainy weather',storm:chance?'Storms possible':'In stormy weather',snow:'In snowy weather',fog:'In fog or haze',unknown:'Outdoors · shade estimate only'};
 const label=exposure.label;
 const basis=comfort?.conditionSource?` · ${esc(comfort.conditionSource)}`:'';
 const note=!daylight?' · No direct sun at night.':kind==='unknown'?' · Sky data unavailable; no solar adjustment.':kind==='partly-cloudy'?' · Sunny-break estimate, not continuous direct sunlight.':['rain','storm','snow','fog','cloudy'].includes(kind)?' · No direct-sun adjustment; wet clothing is not modelled.':'';
 return `<div class="sun-shade-comparison"><figure class="exposure-person shade-person" data-weather="${esc(kind)}">${exposureScene(false,daylight,condition)}<figcaption><strong>${shade}</strong><span>In the shade · ${period}</span></figcaption></figure><figure class="exposure-person sun-person" data-weather="${esc(kind)}">${exposureScene(true,daylight,condition)}<figcaption><strong>${outside}</strong><span>${label} · ${period}</span></figcaption></figure></div><small class="exposure-estimate">Estimated feels-like temperatures · °F${note}${basis} Main readings match the outdoor figure; shade is shown separately.</small>`;
}
export function modelFreshnessText(layer,checkedAt,zone='America/New_York',now=Date.now()){
 if(!layer)return '';
 const run=Date.parse(layer.runAt),checked=Date.parse(checkedAt);
 const stamp=t=>finite(t)?new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t)):'unavailable';
 const delayed=layer.model==='hrrr'&&finite(run)&&now-run>150*60000;
 return `${layer.label} initialized ${stamp(run)} · checked ${stamp(checked)}${delayed?' · Update delayed: showing the last published run, not a newer run.':layer.model==='hrrr'?' · Checking for newly published hourly runs.':''}`;
}
