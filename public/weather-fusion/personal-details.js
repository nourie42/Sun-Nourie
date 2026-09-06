import {dewpointGrossLevel} from './dewpoint-meter.js';
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
 return {peak:peak.value,low,time:peak.time,level:dewpointGrossLevel(peak.value,wind),available:pts.length,expected,partial:pts.length<expected,zone,tonight};
}
export function dailyGrossHTML(forecast,index,tonight=false,now=Date.now()){
 const s=dailyGrossSummary(forecast,index,tonight,now);
 if(!s)return '<section class="day-gross"><h3>Gross Meter · dew point</h3><p>No dew-point forecast is available for this period.</p></section>';
 const when=new Intl.DateTimeFormat('en-US',{timeZone:s.zone,weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(s.time));
 return `<section class="day-gross" data-gross-level="${esc(s.level.key)}"><h3>Gross Meter · dew point</h3><div class="day-gross-reading"><strong>${Math.round(s.peak)}°</strong><span>Muggiest forecast${tonight?' tonight':''}<small>${esc(when)}</small></span></div><p class="day-gross-verdict">${esc(s.level.label)}</p><p>Forecast range: ${Math.round(s.low)}–${Math.round(s.peak)}°F dew point.</p><small>${s.partial?'Partial coverage · ':''}${s.available} of ${s.expected} forecast hours available · ${tonight?'Tonight through 7 AM':'7 AM through 7 AM the next day; past hours excluded'}.</small></section>`;
}
function person(){return '<ellipse cx="109" cy="133" rx="31" ry="5" fill="#10293c" opacity=".28"/><circle cx="110" cy="68" r="10" fill="#f3cfaf"/><path d="M100 78Q110 74 120 78L124 104H96Z" fill="#c8e7f4"/><path d="M100 103L98 128M118 103L121 128" stroke="#deeff9" stroke-width="8" stroke-linecap="round"/><path d="M100 82L89 102M120 82L130 101" stroke="#f3cfaf" stroke-width="6" stroke-linecap="round"/>';}
function scene(sun,daylight){
 const sky=sun?'<circle cx="47" cy="37" r="16" fill="#ffdc83"/><g stroke="#ffdc83" stroke-width="3" stroke-linecap="round"><path d="M47 10v-5M47 64v5M20 37h-5M74 37h5M27 17l-4-4M67 57l4 4M27 57l-4 4M67 17l4-4"/></g>':'<path d="M46 53L47 131" stroke="#a1b9bc" stroke-width="9" stroke-linecap="round"/><path d="M48 86L80 55" stroke="#a1b9bc" stroke-width="6"/><path d="M40 68C-4 66 2 26 34 25C34-1 80 0 89 22C125 11 144 55 117 68Z" fill="#78b4ac"/><path d="M55 75L145 130H60Z" fill="#122d47" opacity=".24"/>';
 return `<svg viewBox="0 0 170 146" role="img" aria-label="${sun?'A person in direct sunlight':'A person standing in the shade of a tree'}"${sun&&!daylight?' class="sun-unavailable"':''}>${sky}<path d="M14 134H157" stroke="#b5d5d9" stroke-opacity=".35" stroke-width="2"/>${person()}</svg>`;
}
export function sunShadeHTML(comfort,location,now=Date.now()){
 const elevation=solarElevation(now,location?.latitude,location?.longitude),daylight=finite(elevation)&&elevation>0;
 const shade=finite(comfort?.shade)?`${Math.round(comfort.shade)}°`:'—';
 const sun=daylight&&finite(comfort?.sun)?`${Math.round(comfort.sun)}°`:'—';
 return `<div class="sun-shade-comparison"><figure class="exposure-person shade-person">${scene(false,daylight)}<figcaption><strong>${shade}</strong><span>In the shade · right now</span></figcaption></figure><figure class="exposure-person sun-person">${scene(true,daylight)}<figcaption><strong>${sun}</strong><span>${daylight?'In direct sun · right now':'No direct sun at night'}</span></figcaption></figure></div><small class="exposure-estimate">Estimated feels-like temperatures · °F${daylight&&!finite(comfort?.sun)?' · Sun estimate unavailable':''}</small>`;
}
export function modelFreshnessText(layer,checkedAt,zone='America/New_York',now=Date.now()){
 if(!layer)return '';
 const run=Date.parse(layer.runAt),checked=Date.parse(checkedAt);
 const stamp=t=>finite(t)?new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t)):'unavailable';
 const delayed=layer.model==='hrrr'&&finite(run)&&now-run>150*60000;
 return `${layer.label} initialized ${stamp(run)} · checked ${stamp(checked)}${delayed?' · Update delayed: showing the last published run, not a newer run.':layer.model==='hrrr'?' · Checking for newly published hourly runs.':''}`;
}
