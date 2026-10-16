import {timeAt,forecastValue,displayedFeelsAt,degrees} from './hourly-feels.js?v=cold-feels-v1';
import {hourlyUvValue,uvCategory} from './daily-uv.js?v=clear-weather-daygraph-v3';
import {forecastGrossLevel} from './dewpoint-meter.js?v=feel-chart-v3';
import {dailyRainPeriod,rainChanceValue} from './weather-math.js?v=cold-feels-v1';
const H=3600000,finite=Number.isFinite;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function rainAt(f,time){
 const epoch=Date.parse(time),canonical=Array.isArray(f?.rainTimeline);
 // The extended rain timeline and the 48-hour strip publish the same hourly
 // likelihood. Match the instant and preserve an explicitly missing value.
 // Rainfall inches and a day/night probability cannot fill an hourly gap.
 const row=(canonical?f.rainTimeline:f?.hours||[]).find(p=>Date.parse(p.time)===epoch);
 const end=row?.end??row?.endTime;
 if(!row||(end!=null&&Date.parse(end)!==epoch+H))return {value:null,source:''};
 const hasLikelihood=row.rainLikelihood&&Object.hasOwn(row.rainLikelihood,'value');
 const value=hasLikelihood?rainChanceValue(row.rainLikelihood):rainChanceValue(null,row.pop);
 return {value,source:finite(value)?(hasLikelihood?row.rainLikelihood.source||'Hourly forecast blend':'NWS hourly forecast'):''};
}
export function dayGraphPoints(f,index,tonight=false,now=Date.now()){
 const d=f?.days?.[index];if(!d?.date)return [];
 const zone=f.location?.timeZone||'America/New_York',next=new Date(Date.parse(d.date+'T12:00Z')+24*H).toISOString().slice(0,10);
 const rain=dailyRainPeriod(d,tonight?'overnight':'overall');
 const a=Date.parse(rain.canonical?rain.window?.start:d[tonight?'lowWindow':'highWindow']?.start),b=Date.parse(rain.canonical?rain.window?.end:d.lowWindow?.end);
 const start=Math.max(finite(a)?a:timeAt(d.date,tonight?19:7,zone),index===0?now:-Infinity),end=finite(b)?b:timeAt(next,7,zone),points=[];
 for(let t=(rain.canonical?Math.floor(start/H):Math.ceil(start/H))*H;t<end&&points.length<30;t+=H){const time=new Date(t).toISOString(),rain=rainAt(f,time);points.push({time,temperature:forecastValue(f,'temperature',time),feels:displayedFeelsAt(f,time),dewpoint:forecastValue(f,'dewpoint',time),wind:forecastValue(f,'wind',time),uv:hourlyUvValue(f,t),rainChance:rain.value,rainChanceSource:rain.source});}
 return points;
}
const fields=[['temperature','Temp','#ffcd79'],['feels','Feels','#ff9caf'],['dewpoint','Feel · dew point','#83e3cc'],['uv','UV','#c8adff'],['rainChance','Chance of rain','#73d8ff']];
export function dayGraphHTML(f,index,tonight=false,now=Date.now()){
 const points=dayGraphPoints(f,index,tonight,now),zone=f.location?.timeZone||'America/New_York';
 if(!points.length)return '<section class="day-graph"><h3>Hour by hour</h3><p>Hourly forecast unavailable.</p></section>';
 const values=points.flatMap(p=>fields.slice(0,3).map(([k])=>p[k])).filter(finite),lo=values.length?Math.floor((Math.min(...values)-5)/10)*10:0,hi=values.length?Math.max(lo+20,Math.ceil((Math.max(...values)+5)/10)*10):100,uvMax=Math.max(12,...points.map(p=>p.uv).filter(finite));
 const x=i=>40+i/Math.max(1,points.length-1)*420,y=(v,k)=>k==='rainChance'?265-v/100*50:170-(k==='uv'?v/uvMax:(v-lo)/(hi-lo))*140;
 const paths=fields.map(([k,,color])=>{let pen=false;const d=points.map((p,i)=>{if(!finite(p[k])){pen=false;return '';}const s=`${pen?'L':'M'}${x(i).toFixed(1)},${y(p[k],k).toFixed(1)}`;pen=true;return s;}).join(' ');return `<path data-series="${k}" d="${d}" fill="none" stroke="${color}" stroke-width="3" ${k==='uv'||k==='rainChance'?'stroke-dasharray="5 4"':''}/>`;}).join('');
 const clock=time=>new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric'}).format(new Date(time));
 return `<section class="day-graph" aria-label="Temperature, feels-like, Feel Meter, UV and rain chance hourly graph"><h3>Hour by hour <small>Slide to explore</small></h3><div class="day-graph-readout" aria-live="polite"></div><svg viewBox="0 0 500 305" role="img" aria-label="Shared time axis. Temperature, feels-like and Feel Meter dew point use the left Fahrenheit scale. UV uses the right scale. Rain chance uses its own zero to 100 percent scale below."><text x="8" y="16">°F</text><text x="468" y="16">UV</text>${[0,.5,1].map(v=>`<path d="M40 ${170-v*140} H460" stroke="currentColor" opacity=".15"/><text x="4" y="${174-v*140}">${Math.round(lo+v*(hi-lo))}</text><text x="467" y="${174-v*140}">${Math.round(v*uvMax)}</text>`).join('')}<text x="40" y="202" fill="#73d8ff">Chance of rain</text>${[0,.5,1].map(v=>`<path d="M40 ${265-v*50} H460" stroke="currentColor" opacity=".15"/><text x="4" y="${269-v*50}">${Math.round(v*100)}%</text>`).join('')}${paths}<path class="day-graph-cursor" d="M40 25 V275" stroke="white" stroke-width="1" opacity=".7"/><text x="40" y="294">${esc(clock(points[0].time))}</text><text x="460" y="294" text-anchor="end">${esc(clock(points.at(-1).time))}</text></svg><label class="day-graph-time" for="day-graph-hour"></label><input id="day-graph-hour" aria-label="Forecast hour for all five graph values" type="range" min="0" max="${points.length-1}" value="0" step="1"></section>`;
}
export function installDayGraph(root,f,index,tonight=false,now=Date.now()){
 const points=dayGraphPoints(f,index,tonight,now),input=root.querySelector('#day-graph-hour');if(!input)return;
 const svg=root.querySelector('.day-graph svg'),zone=f.location?.timeZone||'America/New_York';
 const update=()=>{const i=Number(input.value),p=points[i],time=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(p.time));
  root.querySelector('.day-graph-time').textContent=time;
  root.querySelector('.day-graph-readout').innerHTML=fields.map(([k,label,color])=>`<div style="--line-color:${color}" data-readout="${k}"${k==='rainChance'&&p.rainChanceSource?` title="${esc(p.rainChanceSource)}"`:''}><span>${label}</span><strong>${k==='uv'?(uvCategory(p.uv).index??'—'):k==='rainChance'?(finite(p[k])?`${Math.round(p[k])}%`:'—'):degrees(p[k])}</strong><small>${k==='dewpoint'?esc(forecastGrossLevel(p.dewpoint,p.wind).label):k==='uv'?uvCategory(p.uv).label:finite(p[k])?(k==='rainChance'?'At this hour':'°F'):'Unavailable'}</small></div>`).join('');
  root.querySelector('.day-graph-cursor').setAttribute('d',`M${40+i/Math.max(1,points.length-1)*420} 25 V275`);input.setAttribute('aria-valuetext',time);
 };input.addEventListener('input',update);
 const point=e=>{const r=svg.getBoundingClientRect();input.value=String(Math.round(Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*500-40)/420))*(points.length-1)));update();};
 svg.addEventListener('pointerdown',e=>{svg.setPointerCapture(e.pointerId);point(e);});svg.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'||svg.hasPointerCapture(e.pointerId))point(e);});update();
}

