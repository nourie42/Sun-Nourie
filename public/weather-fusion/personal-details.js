import {weatherState} from './weather-state.js';
import {thermalRiskHTML} from './thermal-risk.js?v=weather-art-labels-v10';
import {forecastGrossLevel} from './dewpoint-meter.js?v=scenario-weather-v28';
import {exposureScene} from './exposure-scene.js?v=scenario-weather-v28';
import {outdoorExposure} from './outdoor-feels.js?v=clear-weather-daygraph-v3';
import {solarElevation} from './weather-math.js?v=clear-weather-daygraph-v3';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
const HOUR=3600000;
function ensureCinematicComfortStyles(){
 if(typeof document==='undefined'||document.getElementById('weather-nourie-cinematic-comfort'))return;
 const link=document.createElement('link');
 link.id='weather-nourie-cinematic-comfort';link.rel='stylesheet';link.href='/weather-fusion/comfort-cinematic.css?v=dynamic-scenes-v27';
 document.head.append(link);
}
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
export function exposureTitle(condition,daylight=true,skyCover=null){
 const w=weatherState(condition,skyCover),s=String(condition||'').toLowerCase();
 if(['rain','storm','snow'].includes(w.kind))return w.chance?(w.kind==='storm'?'Storms possible':w.kind==='rain'?'Rain possible':'Snow possible'):w.label;
 if(w.kind==='fog')return /haze/.test(s)?'Hazy':'Foggy';
 if(w.kind==='cloudy')return /mostly|broken/.test(s)?'Mostly cloudy':'Cloudy';
 if(w.kind==='partly-cloudy')return /partly sunny/.test(s)?'Partly sunny':'Partly cloudy';
 if(w.kind==='clear')return /mostly|few clouds/.test(s)?(daylight?'Mostly sunny':'Mostly clear'):(daylight?'Sun':'Clear');
 return 'Outdoors';
}
export function comfortSubtitle(value){
 if(!finite(value))return 'Feels-like unavailable';
 if(value>=100)return 'Very hot conditions';
 if(value>=88)return 'Hot & uncomfortable';
 if(value>=87)return 'Warm but manageable';
 if(value>=65)return 'Pleasant & comfortable';
 if(value>=50)return 'Cool & comfortable';
 if(value>=35)return 'Chilly outside';
 return 'Cold conditions';
}
function sunSubtitle(value,kind,daylight){
 if(!daylight)return comfortSubtitle(value);
 const direct=kind==='clear'?'in direct sunlight':kind==='partly-cloudy'?'during sunny breaks':'outdoors';
 if(!finite(value))return 'Feels-like unavailable';
 if(value>=100)return `Very hot ${direct}`;
 if(value>=88)return `Hot ${direct}`;
 if(value>=80)return `Warm ${direct}`;
 if(value>=65)return `Comfortable ${direct}`;
 return `${comfortSubtitle(value)} ${direct}`;
}
export function sunShadeHTML(comfort,location,now=Date.now(),context={}){
 ensureCinematicComfortStyles();
 const daylight=typeof comfort?.daylight==='boolean'?comfort.daylight:solarElevation(now,location?.latitude,location?.longitude)>0;
 const fallbackKind=comfort?.weatherKind||(finite(comfort?.sun)?'clear':'unknown');
 const condition=context.condition||comfort?.radiantCondition||comfort?.condition||({clear:'Clear','partly-cloudy':'Partly Cloudy',cloudy:'Cloudy',rain:'Rain',storm:'Thunderstorms',snow:'Snow',fog:'Fog'}[fallbackKind]||'');
 const conditionKind=weatherState(condition,comfort?.inputEvidence?.skyCover).kind;
 const kind=conditionKind==='unknown'?fallbackKind:conditionKind;
 const shadeDisplay=finite(comfort?.shade)?comfort.shade:null;
 const shade=finite(shadeDisplay)?`${Math.round(shadeDisplay)}°`:'Unavailable';
 const exposure=outdoorExposure({...comfort,daylight,weatherKind:kind,condition});
 const outdoorValue=exposure.value;
 const outside=finite(outdoorValue)?`${Math.round(outdoorValue)}°`:'Unavailable';
 const period=context.forecast?'forecast':'right now';
 const basis=comfort?.conditionSource?` · ${esc(comfort.conditionSource)}`:'';
 const note=!daylight?' · No direct sun at night.':finite(comfort?.inputEvidence?.skyCover)?' · Hourly cloud-adjusted radiation estimate; actual sun exposure varies.':kind==='unknown'?' · Sky data unavailable; no solar adjustment.':kind==='partly-cloudy'?' · Sunny-break estimate, not continuous direct sunlight.':['rain','storm','snow','fog','cloudy'].includes(kind)?' · No direct-sun adjustment; wet clothing is not modelled.':'';
 const shadeBasis=' Shade and outdoor are comparable modeled feels-like values from the same air temperature, moisture and wind; outdoor also includes the estimated radiant load.';
 const compactSunTitle=daylight&&['clear','partly-cloudy'].includes(kind)?'Sun':exposureTitle(condition,daylight,comfort?.inputEvidence?.skyCover);
 const sceneContext={pop:context.pop,precipitation:context.precipitation,forecast:context.forecast};
 return `<div class="sun-shade-comparison" role="group" aria-label="Shade, outdoor and pet temperatures"><figure class="exposure-person shade-person" data-reading="${finite(shadeDisplay)?'available':'unavailable'}" data-weather="${esc(kind)}">${context.compact?`<span class="exposure-label">Shade</span><span class="exposure-subtitle">${esc(comfortSubtitle(shadeDisplay))}</span><span class="exposure-alert-slot"></span>`:''}${exposureScene(false,daylight,condition,shadeDisplay,sceneContext)}<figcaption><strong>${shade}</strong>${context.compact?'':`<span>Modeled shade feels-like · ${period}</span>`}</figcaption></figure><figure class="exposure-person sun-person" data-reading="${finite(outdoorValue)?'available':'unavailable'}" data-weather="${esc(kind)}">${context.compact?`<span class="exposure-label">${esc(compactSunTitle)}</span><span class="exposure-subtitle">${esc(sunSubtitle(outdoorValue,kind,daylight))}</span><span class="exposure-alert-slot">${thermalRiskHTML(outdoorValue,true)}</span>`:''}${exposureScene(true,daylight,condition,outdoorValue,sceneContext)}<figcaption>${context.compact?'':thermalRiskHTML(outdoorValue,true)}<strong>${outside}</strong>${context.compact?'':`<span>${esc(exposure.label)} · ${period}</span>`}</figcaption></figure>${context.pavement||''}</div>${context.compact?'':`<small class="exposure-estimate">Estimated feels-like temperatures · °F${note}${basis}${shadeBasis}</small>`}`;
}
export function modelFreshnessText(layer,checkedAt,zone='America/New_York',now=Date.now()){
 if(!layer)return '';
 const run=Date.parse(layer.runAt),checked=Date.parse(checkedAt);
 const stamp=t=>finite(t)?new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t)):'unavailable';
 const delayed=layer.model==='hrrr'&&finite(run)&&now-run>150*60000;
 return `${layer.label} initialized ${stamp(run)} · checked ${stamp(checked)}${delayed?' · Update delayed: showing the last published run, not a newer run.':layer.model==='hrrr'?' · Checking for newly published hourly runs.':''}`;
}
