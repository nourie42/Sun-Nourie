import {timeAt,forecastValue,degrees} from './hourly-feels.js?v=comfort-only-banners-v8';
import {hourlyUvValue,uvCategory} from './daily-uv.js?v=clear-weather-daygraph-v3';
import {forecastGrossLevel} from './dewpoint-meter.js?v=clear-weather-daygraph-v3';
const H=3600000,finite=Number.isFinite;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function dayGraphPoints(f,index,tonight=false,now=Date.now()){
 const d=f?.days?.[index];if(!d?.date)return [];
 const zone=f.location?.timeZone||'America/New_York',next=new Date(Date.parse(d.date+'T12:00Z')+24*H).toISOString().slice(0,10);
 const a=Date.parse(d[tonight?'lowWindow':'highWindow']?.start),b=Date.parse(d.lowWindow?.end);
 const start=Math.max(finite(a)?a:timeAt(d.date,tonight?19:7,zone),index===0?now:-Infinity),end=finite(b)?b:timeAt(next,7,zone),points=[];
 for(let t=Math.ceil(start/H)*H;t<end&&points.length<30;t+=H){const time=new Date(t).toISOString();points.push({time,temperature:forecastValue(f,'temperature',time),feels:forecastValue(f,'feels',time),dewpoint:forecastValue(f,'dewpoint',time),wind:forecastValue(f,'wind',time),uv:hourlyUvValue(f,t)});}
 return points;
}
const fields=[['temperature','Temp','#ffcd79'],['feels','Feels','#ff9caf'],['dewpoint','Gross · dew point','#83e3cc'],['uv','UV','#c8adff']];
export function dayGraphHTML(f,index,tonight=false,now=Date.now()){
 const points=dayGraphPoints(f,index,tonight,now),zone=f.location?.timeZone||'America/New_York';
 if(!points.length)return '<section class="day-graph"><h3>Hour by hour</h3><p>Hourly forecast unavailable.</p></section>';
 const values=points.flatMap(p=>fields.slice(0,3).map(([k])=>p[k])).filter(finite),lo=values.length?Math.floor((Math.min(...values)-5)/10)*10:0,hi=values.length?Math.max(lo+20,Math.ceil((Math.max(...values)+5)/10)*10):100,uvMax=Math.max(12,...points.map(p=>p.uv).filter(finite));
 const x=i=>40+i/Math.max(1,points.length-1)*420,y=(v,k)=>170-(k==='uv'?v/uvMax:(v-lo)/(hi-lo))*140;
 const paths=fields.map(([k,,color])=>{let pen=false;const d=points.map((p,i)=>{if(!finite(p[k])){pen=false;return '';}const s=`${pen?'L':'M'}${x(i).toFixed(1)},${y(p[k],k).toFixed(1)}`;pen=true;return s;}).join(' ');return `<path data-series="${k}" d="${d}" fill="none" stroke="${color}" stroke-width="3" ${k==='uv'?'stroke-dasharray="5 4"':''}/>`;}).join('');
 const clock=time=>new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric'}).format(new Date(time));
 return `<section class="day-graph" aria-label="Temperature, feels-like, Gross Meter and UV hourly graph"><h3>Hour by hour <small>Slide to explore</small></h3><div class="day-graph-readout" aria-live="polite"></div><svg viewBox="0 0 500 210" role="img" aria-label="Shared time axis. Temperature, feels-like and Gross Meter dew point use the left Fahrenheit scale. UV uses the right scale."><text x="8" y="16">°F</text><text x="468" y="16">UV</text>${[0,.5,1].map(v=>`<path d="M40 ${170-v*140} H460" stroke="currentColor" opacity=".15"/><text x="4" y="${174-v*140}">${Math.round(lo+v*(hi-lo))}</text><text x="467" y="${174-v*140}">${Math.round(v*uvMax)}</text>`).join('')}${paths}<path class="day-graph-cursor" d="M40 25 V175" stroke="white" stroke-width="1" opacity=".7"/><text x="40" y="199">${esc(clock(points[0].time))}</text><text x="460" y="199" text-anchor="end">${esc(clock(points.at(-1).time))}</text></svg><label class="day-graph-time" for="day-graph-hour"></label><input id="day-graph-hour" aria-label="Forecast hour for all four graph values" type="range" min="0" max="${points.length-1}" value="0" step="1"></section>`;
}
export function installDayGraph(root,f,index,tonight=false,now=Date.now()){
 const points=dayGraphPoints(f,index,tonight,now),input=root.querySelector('#day-graph-hour');if(!input)return;
 const svg=root.querySelector('.day-graph svg'),zone=f.location?.timeZone||'America/New_York';
 const update=()=>{const i=Number(input.value),p=points[i],time=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(p.time));
  root.querySelector('.day-graph-time').textContent=time;
  root.querySelector('.day-graph-readout').innerHTML=fields.map(([k,label,color])=>`<div style="--line-color:${color}" data-readout="${k}"><span>${label}</span><strong>${k==='uv'?(uvCategory(p.uv).index??'—'):degrees(p[k])}</strong><small>${k==='dewpoint'?esc(forecastGrossLevel(p.dewpoint,p.wind).label):k==='uv'?uvCategory(p.uv).label:finite(p[k])?'°F':'Unavailable'}</small></div>`).join('');
  root.querySelector('.day-graph-cursor').setAttribute('d',`M${40+i/Math.max(1,points.length-1)*420} 25 V175`);input.setAttribute('aria-valuetext',time);
 };input.addEventListener('input',update);
 const point=e=>{const r=svg.getBoundingClientRect();input.value=String(Math.round(Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*500-40)/420))*(points.length-1)));update();};
 svg.addEventListener('pointerdown',e=>{svg.setPointerCapture(e.pointerId);point(e);});svg.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'||svg.hasPointerCapture(e.pointerId))point(e);});update();
}
