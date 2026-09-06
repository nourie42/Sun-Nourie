import {comfortMode,comfortWindow,comfortNarrative} from './comfort-outlook.js';
import {dailyDisplay,temperatureBar,thermalComfort,finite,solarElevation} from './weather-math.js';
import {resetDewpointMeter} from './dewpoint-meter.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(n,d=0)=>finite(n)?n.toFixed(d):'—';
const temp=n=>`${number(n)}°`;
const defs={
 temperature:{title:'Temperature',unit:'°',field:'temperature',note:'How the air temperature is expected to change.',color:'#ffd58a'},
 feels:{title:'Feels like',unit:'°',field:'feels',note:'How warm or cool it may feel in the shade.',color:'#ffcf96'},
 precipitation:{title:'Precipitation',unit:' in',field:'precipitation',note:'How much rain or melted snow is expected each hour.',color:'#8bcfff',digits:2,bars:true,zero:true},
 wind:{title:'Wind',unit:' mph',field:'wind',note:'How breezy it is expected to be.',color:'#a7e5d1',zero:true},
 humidity:{title:'Humidity',unit:'%',field:'humidity',note:'How damp the air is expected to be.',color:'#9edfff',zero:true,max:100},
 pop:{title:'Rain chance',unit:'%',field:'pop',note:'The chance of rain during each forecast hour.',color:'#adcbff',zero:true,max:100},
 visibility:{title:'Visibility',unit:' mi',field:'visibility',note:'How far you may be able to see clearly.',color:'#c5dcf1',digits:1,zero:true},
 pressure:{title:'Pressure',unit:' inHg',field:'pressure',note:'How air pressure is expected to change.',color:'#c6bafa',digits:2},
 solar:{title:'Sunset',unit:'',field:'solar',note:'When the sun is expected to set over the next week.',color:'#ffdc9b',solar:true},
};
let data=null, active=null, horizon=24, selected=0, graphPoints=[], graphGeometry=null;
const formatTime=(v,options={})=>new Intl.DateTimeFormat('en-US',{timeZone:data?.location.timeZone||'America/New_York',hour:'numeric',minute:'2-digit',...options}).format(new Date(v));
const localMinutes=v=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:data?.location.timeZone||'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(v));return Number(p.find(x=>x.type==='hour').value)*60+Number(p.find(x=>x.type==='minute').value);};
const clockMinutes=n=>{const h=Math.floor(n/60)%24,m=Math.round(n%60);return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;};
const displayValue=(v,def)=>!finite(v)?'Not available':def.solar?clockMinutes(v):`${number(v,def.digits||0)}${def.unit}`;
function locationClock(time,zone='America/New_York'){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time));
 const get=type=>parts.find(p=>p.type===type)?.value;
 return {day:`${get('year')}-${get('month')}-${get('day')}`,hour:Number(get('hour')),minute:Number(get('minute'))};
}
export function comfortDisplayMode(time=Date.now(),zone='America/New_York'){return comfortMode(time,zone);}
export function overnightComfort(forecast,now=Date.now()){
 const summary=comfortWindow(forecast,now);return summary&&summary.mode!=='day'?summary:null;
}
function valuesThrough(series,now,end){return (series||[]).filter(p=>{const t=Date.parse(p.time);return finite(t)&&t>=now&&t<=Date.parse(end)&&finite(p.value);}).map(p=>p.value);}
export function comfortWeatherKind(forecast,now=Date.now()){
 const zone=forecast?.location?.timeZone||'America/New_York',mode=comfortDisplayMode(now,zone),evening=mode==='overnight';
 const elevation=solarElevation(now,forecast?.location?.latitude,forecast?.location?.longitude);
 const night=finite(elevation)?elevation<=0:mode!=='day';
 const d=forecast?.days?.[0]||{},condition=String(evening?(d.nightCondition||forecast?.current?.condition||''):(forecast?.current?.condition||d.condition||'')).toLowerCase();
 const pop=evening?d.popNight:d.pop,wind=forecast?.current?.wind;
 if(/thunder|storm/.test(condition))return 'storm';
 if(/snow|sleet|ice pellets|freezing rain/.test(condition))return 'snow';
 if(/rain|shower|drizzle/.test(condition)||(finite(pop)&&pop>=35))return 'rain';
 if(/fog|mist/.test(condition))return 'fog';
 if(finite(wind)&&wind>=18)return 'wind';
 if(night)return 'night';
 if(/sunny|clear|few clouds/.test(condition))return 'sun';
 if(/cloud|overcast/.test(condition))return 'cloud';
 return 'calm';
}
function weatherArt(kind){
 const items=(cls,count,symbol='')=>Array.from({length:count},(_,i)=>`<i class="${cls}" style="--i:${i};--x:${7+(i*37)%89}%;--delay:-${((i*43)%170)/100}s">${symbol}</i>`).join('');
 if(kind==='rain')return items('wx-drop',14);
 if(kind==='storm')return `<i class="wx-flash"></i>${items('wx-drop',16)}`;
 if(kind==='snow')return items('wx-flake',14,'✦');
 if(kind==='night')return items('wx-star',12,'✦');
 if(kind==='wind')return items('wx-wind-line',7);
 if(kind==='fog')return items('wx-fog-line',5);
 if(kind==='cloud')return '<i class="wx-cloud wx-cloud-a"></i><i class="wx-cloud wx-cloud-b"></i>';
 if(kind==='sun')return '<i class="wx-sun-glow"></i><i class="wx-sun-ring"></i>';
 return '';
}
function renderComfortArt(forecast,now){
 const tile=$('skin-exposure');if(!tile)return;
 let art=tile.querySelector('.comfort-weather-art');if(!art){art=document.createElement('div');art.className='comfort-weather-art';art.setAttribute('aria-hidden','true');tile.prepend(art);}
 const kind=comfortWeatherKind(forecast,now);tile.dataset.weather=kind;art.className=`comfort-weather-art weather-${kind}`;art.innerHTML=weatherArt(kind);
}
function ensureComfortStyles(){
 if(document.getElementById('weather-nourie-comfort-effects'))return;
 const link=document.createElement('link');link.id='weather-nourie-comfort-effects';link.rel='stylesheet';link.href='/weather-fusion/comfort-effects.css?v=1-evening';document.head.append(link);
}
function pointsFor(key, hours=48) {
 if(!data)return [];
 if(key==='solar')return (data.metricForecasts?.solar||[]).map(d=>({time:d.sunset,value:d.sunset?localMinutes(d.sunset):null,sunrise:d.sunrise,date:d.date})).filter(d=>d.time);
 return (data.metricForecasts?.series?.[defs[key].field]||[]).slice(0,hours);
}
function sparkline(points) {
 const values=points.map(p=>p.value).filter(finite);
 if(values.length<2)return '';
 const lo=Math.min(...values),hi=Math.max(...values),span=Math.max(1,hi-lo);
 let drawing='',continuous=false;
 points.forEach((p,i)=>{if(!finite(p.value)){continuous=false;return;}const x=2+i/Math.max(1,points.length-1)*116,y=29-(p.value-lo)/span*23;drawing+=`${continuous?'L':'M'}${x.toFixed(1)},${y.toFixed(1)} `;continuous=true;});
 return `<svg class="tile-spark" viewBox="0 0 120 34" aria-hidden="true"><path d="${drawing}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
export function renderComfort(forecast) {
 data=forecast;ensureComfortStyles();
 const now=Date.now(),c=forecast.comfort||thermalComfort(forecast.current,forecast.location,now),summary=comfortWindow(forecast,now);
 $('skin-values').innerHTML=`<span><strong>${temp(c.shade)}</strong> right now</span>${summary?`<span><strong>~${temp(summary.chosen.value)}</strong> ${summary.label}</span>`:''}`;
 $('skin-explanation').textContent=comfortNarrative(forecast.current,c,summary,forecast.location.timeZone);
 renderComfortArt(forecast,now);
 const alignment=forecast.metricForecasts?.comfortAlignment;
 $('skin-science').textContent=`${c.method}. Current air ${temp(forecast.current.temperature)}; dew point ${temp(forecast.current.dewpoint)}; relative humidity ${number(c.humidity)}%; wind ${number(forecast.current.wind)} mph. Station ${forecast.current.stationName||forecast.current.station||'unavailable'}, observation ${forecast.current.time||'unavailable'}. ${finite(c.wetBulb)?`Estimated wet bulb ${temp(c.wetBulb)}. `:''}${alignment?.note||''} ${c.note}`;
}
export function renderDailyRows(forecast,icon) {
 const values=forecast.days.flatMap(d=>[d.high,d.low]).filter(finite),lo=values.length?Math.min(...values)-3:0,hi=values.length?Math.max(...values)+3:1;
 $('daily').innerHTML=forecast.days.map((d,i)=>{
  const p=dailyDisplay(d,i,Date.now(),forecast.location.timeZone),bar=temperatureBar(p.primary,lo,hi);
  return `<button class="day-row ${p.tonight?'tonight-row':''}" data-day="${i}" aria-label="${esc(p.label)}, ${p.primaryLabel} ${number(p.primary)} degrees${finite(p.secondary)?`, low ${number(p.secondary)} degrees`:''}. Open details."><span class="day-name">${esc(p.label)}</span><span class="day-icon">${icon(p.condition,!p.tonight)}<small>${finite(p.pop)?`${number(p.pop)}%`:''}</small></span><span class="day-high"><strong>${temp(p.primary)}</strong><small>${p.primaryLabel}</small></span><span class="temp-track" aria-hidden="true">${bar===null?'':`<span class="temp-fill" style="left:0;width:${bar}%"></span><i class="high-marker" style="left:clamp(4px,${bar}%,calc(100% - 4px))"></i>`}</span>${p.tonight?'<span class="night-label">☾<small>Overnight</small></span>':`<span class="day-low">${temp(p.secondary)}<small>Low</small></span>`}</button>`;
 }).join('');
}
export function renderMetricTiles(forecast,smallIcon) {
 data=forecast;
 const c=data.current,d=dailyDisplay(data.days[0],0,Date.now(),data.location.timeZone);
 const currentComfort=data.comfort||thermalComfort(c,data.location,Date.parse(data.assembledAt));
 const windText=finite(c.wind)?c.wind<3?'Hardly a breeze.':c.wind<12?'A light breeze.':c.wind<25?'A breezy day.':'Strong winds.':'';
 const tiles=[
  ['feels','temp',temp(currentComfort.shade),'Temp + dew point + wind, in one all-weather calculation.'],
  ['precipitation','drop',finite(data.precipitation?.value)?`${number(data.precipitation.value,2)}<small>in</small>`:'—','Expected over the next 24 hours.'],
  ['wind','wind',`${number(c.wind)}<small>mph</small>`,windText],
  ['humidity','drop',`${number(c.humidity)}<small>%</small>`,finite(c.dewpoint)&&c.dewpoint>=65?'The air feels muggy.':finite(c.humidity)?'Moisture in the air.':'Waiting for an update.'],
  ['pop','drop',finite(d.pop)?`${number(d.pop)}<small>%</small>`:'—',d.tonight?'Chance of rain tonight.':'Chance of rain today or tonight.'],
  ['visibility','eye',`${number(c.visibility,finite(c.visibility)&&Number.isInteger(c.visibility)?0:1)}<small>mi</small>`,'How far you can see right now.'],
  ['pressure','gauge',`${number(c.pressure,2)}<small>inHg</small>`,'Current air pressure.'],
  ['solar','sun',data.solar.sunset?esc(formatTime(data.solar.sunset)):'—',data.solar.sunrise?`Sunrise ${formatTime(data.solar.sunrise)}.`:'Daylight through the week.'],
 ];
 $('metrics').innerHTML=tiles.map(([key,ic,value,note])=>`<button type="button" class="glass metric metric-${key}" data-metric="${key}" aria-haspopup="dialog" aria-label="${defs[key].title}: open forecast graph"><span class="metric-title">${smallIcon(ic)}${defs[key].title}<span class="tile-arrow" aria-hidden="true">↗</span></span><span class="metric-value">${value}</span><span class="metric-note">${esc(note)}</span>${sparkline(pointsFor(key,24))}<span class="tile-hint">${key==='solar'?'See the week ahead':'Explore the forecast'} <span aria-hidden="true">→</span></span></button>`).join('');
 $('metric-science').innerHTML=`<p>Current cards use the latest station observations when available. Tap a card for separate future forecast data. Current pressure is station pressure; the pressure graph is explicitly labeled mean sea-level pressure. One is not appended to the other.</p>${Object.entries(data.metricForecasts?.notes||{}).map(([key,note])=>`<p><strong>${esc(key)}:</strong> ${esc(note)}</p>`).join('')}`;
 if(active&&$('metric-dialog')?.open)drawChart();
}
function chartGrid(def,points) {
 const W=window.innerWidth<600?360:660,H=268,L=48,R=16,T=22,B=34;
 const vals=points.map(p=>p.value).filter(finite);
 let low=vals.length?Math.min(...vals):0,high=vals.length?Math.max(...vals):1;
 const delta=Math.max(def.digits?0.01:1,(high-low)*.18);
 low=def.zero?0:low-delta;high=def.max??high+delta;
 if(high<=low)high=low+1;
 const a=points.length?Date.parse(points[0].time):0,b=points.length?Date.parse(points.at(-1).time):1;
 const x=i=>L+(Date.parse(points[i].time)-a)/Math.max(1,b-a)*(W-L-R),y=v=>T+(high-v)/(high-low)*(H-T-B);
 const ticks=Array.from({length:4},(_,i)=>{const v=low+(high-low)*i/3;const label=def.solar?clockMinutes(Math.round(v)):def.unit===' in'?v.toFixed(2):def.unit===' inHg'?v.toFixed(2):Math.round(v)+ (def.unit==='°'?'°':'');return `<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="graph-grid"/><text x="${L-9}" y="${y(v)+4}" text-anchor="end" class="graph-axis">${label}</text>`;}).join('');
 const tickCount=points.length<2?1:4;
 const times=Array.from({length:tickCount},(_,i)=>{const ix=Math.round(i/Math.max(1,tickCount-1)*(points.length-1));return points[ix]?`<text x="${x(ix)}" y="${H-8}" text-anchor="${i===0?'start':i===tickCount-1?'end':'middle'}" class="graph-axis">${esc(def.solar?formatTime(points[ix].time,{weekday:'short',hour:undefined,minute:undefined}):formatTime(points[ix].time,{hour:'numeric',minute:undefined}))}</text>`:'';}).join('');
 let lines='',areas='',segment=[];
 function flush(){if(!segment.length)return;const path=segment.map(([xx,yy],i)=>`${i?'L':'M'}${xx},${yy}`).join(' ');lines+=`<path d="${path}" class="graph-line"/>`;if(segment.length>1)areas+=`<path d="${path} L${segment.at(-1)[0]},${H-B} L${segment[0][0]},${H-B} Z" fill="url(#chart-fill)"/>`;segment=[];}
 points.forEach((p,i)=>{if(!finite(p.value)){flush();return;}segment.push([x(i),y(p.value)]);});flush();
 const bw=Math.max(2,Math.min(24,(W-L-R)/Math.max(1,points.length)*.64));
 const bars=def.bars?points.map((p,i)=>finite(p.value)?`<rect x="${x(i)-bw/2}" y="${y(p.value)}" width="${bw}" height="${Math.max(p.value===0?1:2,H-B-y(p.value))}" rx="2" fill="${def.color}" opacity=".83"/>`:'').join(''):'';
 graphGeometry={W,H,L,R,x,y};
 return `<svg id="forecast-graph" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(def.title)} forecast graph. Use the slider below for each value." style="--graph-color:${def.color}"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${def.color}" stop-opacity=".28"/><stop offset="100%" stop-color="${def.color}" stop-opacity="0"/></linearGradient></defs>${ticks}${def.bars?bars:areas+lines}${times}<line id="graph-cursor" y1="${T}" y2="${H-B}" class="graph-cursor"/><circle id="graph-point-halo" r="9" fill="${def.color}" opacity=".18"/><circle id="graph-point" r="4" fill="${def.color}" stroke="white" stroke-width="1.5"/></svg>`;
}
function selectPoint(i) {
 const def=defs[active];if(!def)return;
 selected=Math.max(0,Math.min(graphPoints.length-1,i));
 const p=graphPoints[selected];if(!p)return;
 $('chart-value').textContent=displayValue(p.value,def);
 $('chart-time').textContent=formatTime(p.time,{weekday:'short',month:'short',day:'numeric'});
 if(def.solar&&p.sunrise)$('chart-note').textContent=`Sunrise ${formatTime(p.sunrise)} · sunset ${formatTime(p.time)}.`;
 else if(active==='pressure')$('chart-note').textContent='Sea-level forecast · separate from the station reading.';
 else $('chart-note').textContent=!finite(p.value)?'The forecast source has a gap at this time.':def.note;
 const {x,y}=graphGeometry;
 $('graph-cursor')?.setAttribute('x1',x(selected));$('graph-cursor')?.setAttribute('x2',x(selected));
 for(const id of ['graph-point','graph-point-halo']){const el=$(id);if(!el)continue;el.style.display=finite(p.value)?'':'none';if(finite(p.value)){el.setAttribute('cx',x(selected));el.setAttribute('cy',y(p.value));}}
 $('chart-scrubber').value=String(selected);
 $('chart-scrubber').setAttribute('aria-valuetext',`${$('chart-time').textContent}: ${displayValue(p.value,def)}`);
}
function drawChart() {
 const def=defs[active];graphPoints=pointsFor(active,horizon);
 const valid=graphPoints.filter(p=>finite(p.value));
 $('chart-title').textContent=def.title;
 $('chart-location').textContent=data.location.name;
 $('chart-periods').hidden=!!def.solar;
 $('chart-week-label').hidden=!def.solar;
 document.querySelectorAll('[data-hours]').forEach(b=>{const chosen=Number(b.dataset.hours)===horizon;b.setAttribute('aria-pressed',String(chosen));b.classList.toggle('selected',chosen);});
 $('chart-content').innerHTML=chartGrid(def,graphPoints);
 $('chart-empty').hidden=valid.length>=2;
 $('chart-empty').textContent=valid.length?'Only a few forecast readings are available. Gaps are left blank.':'A forecast for this item isn’t available at this location yet. We won’t draw a made-up line.';
 $('chart-scrubber').max=String(Math.max(0,graphPoints.length-1));$('chart-scrubber').disabled=!graphPoints.length;
 const minimum=valid.length?Math.min(...valid.map(p=>p.value)):null,maximum=valid.length?Math.max(...valid.map(p=>p.value)):null;
 $('chart-low').textContent=displayValue(minimum,def);$('chart-high').textContent=displayValue(maximum,def);
 $('chart-coverage').textContent=`${valid.length} of ${graphPoints.length} ${def.solar?'days':'hours'} available`;
 if(graphPoints.length)selectPoint(Math.min(selected,graphPoints.length-1));
 else {$('chart-value').textContent='Not available';$('chart-time').textContent='No forecast data';$('chart-note').textContent=def.note;}
 $('forecast-graph').addEventListener('pointermove',event=>{
  if(event.pointerType==='touch'&&event.buttons===0)return;
  const rect=event.currentTarget.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*graphGeometry.W;
  const nearest=graphPoints.reduce((best,_,i)=>Math.abs(graphGeometry.x(i)-x)<Math.abs(graphGeometry.x(best)-x)?i:best,0);
  selectPoint(nearest);
 });
 $('forecast-graph').addEventListener('pointerdown',event=>{event.currentTarget.setPointerCapture?.(event.pointerId);const rect=event.currentTarget.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*graphGeometry.W;selectPoint(graphPoints.reduce((best,_,i)=>Math.abs(graphGeometry.x(i)-x)<Math.abs(graphGeometry.x(best)-x)?i:best,0));});
}
export function openMetric(key) {
 if(!defs[key]||!data)return;
 active=key;horizon=24;selected=0;
 $('metric-dialog').showModal();document.body.classList.add('dialog-open');drawChart();
}
export function resetExperience() {
 data=null;active=null;
 if($('metric-dialog').open)$('metric-dialog').close();
 $('skin-values').textContent='Checking how it will feel…';$('skin-explanation').textContent='Getting the weather for this location.';
 $('skin-science').textContent='Waiting for this location’s weather.';
 const tile=$('skin-exposure');if(tile){delete tile.dataset.weather;tile.querySelector('.comfort-weather-art')?.remove();}
 resetDewpointMeter();
}
export function installExperience() {
 ensureComfortStyles();
 $('metrics').addEventListener('click',e=>{const card=e.target.closest('[data-metric]');if(card)openMetric(card.dataset.metric);});
 $('temperature').addEventListener('click',()=>openMetric('temperature'));
 $('temperature').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openMetric('temperature');}});
 $('close-metric').addEventListener('click',()=>$('metric-dialog').close());
 $('metric-dialog').addEventListener('close',()=>{active=null;document.body.classList.remove('dialog-open');});
 $('metric-dialog').addEventListener('click',e=>{if(e.target===$('metric-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
 $('chart-scrubber').addEventListener('input',e=>selectPoint(Number(e.target.value)));
 $('chart-periods').addEventListener('click',e=>{const b=e.target.closest('[data-hours]');if(b){horizon=Number(b.dataset.hours);selected=0;drawChart();}});
 $('chart-science-link').addEventListener('click',()=>$('metric-dialog').close());
 window.addEventListener('resize',()=>{if(active&&$('metric-dialog').open)drawChart();});
}