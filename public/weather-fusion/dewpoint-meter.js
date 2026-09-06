const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const HOUR=3600000;
let horizon=48,selectedEpoch=null,latest=null,lastNow=0,resizeInstalled=false;
export function dewpointGrossLevel(dewpoint,wind=0){
  if(!finite(dewpoint))return {key:'unknown',label:'Waiting on the dew point',note:'We need a dew-point reading before calling it.'};
  if(dewpoint<50)return {key:'dry',label:'You’re either cold or you’re gettin’ ashy',note:'Very dry air. Moisture is not what is making the weather uncomfortable.'};
  if(dewpoint<60)return {key:'nice',label:'Now this ain’t bad',note:'The air has enough room for sweat to evaporate pretty well.'};
  if(dewpoint<=63&&finite(wind)&&wind>=8)return {key:'nice-breeze',label:'Now this ain’t bad',note:`The ${Math.round(wind)} mph breeze is saving a borderline-humid dew point.`};
  if(dewpoint<65)return {key:'humid',label:'Dang, it’s a bit humid out',note:'You’ll notice the moisture, especially if the air is still.'};
  if(dewpoint<70)return {key:'gross',label:'It’s gettin’ a bit gross',note:'Sweat has a harder time evaporating, so the air starts feeling sticky.'};
  if(dewpoint<75)return {key:'nogo',label:'I’m not tryin’ to go out in this',note:'That is a muggy dew point. Your body has a much harder time dumping heat by evaporation.'};
  return {key:'nope',label:'Nope',note:'Extremely muggy air. Evaporative cooling is heavily limited.'};
}


export function dewpointPoints(forecast,now,hours=240){
 const unique=new Map(),start=Math.ceil(now/HOUR)*HOUR,end=start+hours*HOUR;
 for(const p of forecast?.metricForecasts?.series?.dewpoint||[]){
  const t=Date.parse(p.time);if(!finite(t)||t<start||t>=end)continue;
  if(!unique.has(t)||(!finite(unique.get(t).value)&&finite(p.value)))unique.set(t,{...p,time:new Date(t).toISOString(),epoch:t});
 }
 return [...unique.values()].sort((a,b)=>a.epoch-b.epoch);
}
function styles(){
 if(document.getElementById('weather-nourie-dewpoint-meter-css'))return;
 const l=document.createElement('link');l.id='weather-nourie-dewpoint-meter-css';l.rel='stylesheet';l.href='/weather-fusion/dewpoint-meter.css?v=3-readable';document.head.append(l);
}
const hourText=(t,z)=>new Intl.DateTimeFormat('en-US',{timeZone:z,hour:'numeric',minute:'2-digit'}).format(new Date(t));
const dayText=(t,z)=>new Intl.DateTimeFormat('en-US',{timeZone:z,weekday:'short',month:'numeric',day:'numeric'}).format(new Date(t));
function pairedWind(f,time){const t=Date.parse(time);return f?.metricForecasts?.series?.wind?.find(p=>Date.parse(p.time)===t)?.value??null;}
export function graphGeometry(points,hours,viewport=640){
 const vals=points.filter(p=>finite(p.value)).map(p=>p.value);
 const min=vals.length?Math.floor((Math.min(...vals)-4)/5)*5:40,max=vals.length?Math.ceil((Math.max(...vals)+4)/5)*5:80;
 const W=Math.max(viewport,hours>48?Math.ceil(hours/24)*120:hours===48?660:500),height=300,L=48,R=24,T=24,B=42;
 const first=points[0]?.epoch??0,last=points.at(-1)?.epoch??first+HOUR;
 return {W,height,L,R,T,B,min,max,first,last,x:t=>L+(t-first)/Math.max(HOUR,last-first)*(W-L-R),y:v=>T+(max-v)/Math.max(5,max-min)*(height-T-B)};
}
function graph(points,hours,zone,width){
 const g=graphGeometry(points,hours,width),{W,height,L,R,T,B,min,max,x,y}=g;
 const bands=[[-Infinity,50,'dry','DRY'],[50,60,'nice','NOT BAD'],[60,65,'humid','HUMID'],[65,70,'gross','GROSS'],[70,75,'nogo','NO-GO'],[75,Infinity,'nope','NOPE']];
 const rects=bands.filter(([a,b])=>a<max&&b>min).map(([a,b,c])=>`<rect class="gross-band band-${c}" x="${L}" y="${y(Math.min(max,b))}" width="${W-L-R}" height="${y(Math.max(min,a))-y(Math.min(max,b))}"/>`).join('');
 const ticks=[];for(let v=min;v<=max;v+=5)ticks.push(`<line class="gross-threshold" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="gross-y" x="${L-8}" y="${y(v)+4}" text-anchor="end">${v}°</text>`);
 const step=hours>48?24:6,axis=[];let lastX=-1000;
 for(const p of points){
  const local=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(p.epoch));
  const isFirst=p===points[0];
  if(!isFirst&&Number(local)%step!==0)continue;
  const xx=x(p.epoch);if(xx-lastX<78||xx>W-R-50&&!isFirst)continue;lastX=xx;
  axis.push(`<line class="gross-day-line" x1="${xx}" x2="${xx}" y1="${T}" y2="${height-B}"/><text class="gross-x" x="${xx}" y="${height-12}" text-anchor="${isFirst?'start':'middle'}">${esc(hours>48?dayText(p.time,zone):hourText(p.time,zone))}</text>`);
 }
 let d='',prev=null;
 for(const p of points){if(!finite(p.value)){prev=null;continue;}const continuous=prev&&p.epoch-prev.epoch<=HOUR*1.1;d+=`${continuous?'L':'M'}${x(p.epoch).toFixed(2)},${y(p.value).toFixed(2)} `;prev=p;}
 const dots=points.filter((p,i)=>finite(p.value)&&i%3===0).map(p=>`<circle class="gross-dot" cx="${x(p.epoch)}" cy="${y(p.value)}" r="2.4"/>`).join('');
 return {g,html:`<svg class="gross-chart" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" style="width:${W}px;height:${height}px;max-width:none" role="img" aria-label="${hours/24}-day dew-point forecast. Tap a point or use the slider for its value.">${rects}${ticks.join('')}${axis.join('')}<path class="gross-line-shadow" d="${d}"/><path class="gross-line" d="${d}"/>${dots}<line class="gross-cursor" y1="${T}" y2="${height-B}"/><circle class="gross-selected" r="5"/></svg>`};
}
export function renderDewpointMeter(forecast,now=Date.now()){
 latest=forecast;lastNow=now;styles();
 const host=document.getElementById('skin-exposure');if(!host)return;
 let panel=document.getElementById('dewpoint-gross-meter');
 if(!panel){panel=document.createElement('section');panel.id='dewpoint-gross-meter';panel.className='glass dewpoint-gross-meter';panel.setAttribute('aria-labelledby','gross-title');host.insertAdjacentElement('afterend',panel);}
 const scroll=panel.querySelector('.gross-scroll')?.scrollLeft||0;
 const zone=forecast.location.timeZone||'America/New_York',dp=forecast.current.dewpoint,level=dewpointGrossLevel(dp,forecast.current.wind);
 const all=dewpointPoints(forecast,now,240),pts=dewpointPoints(forecast,now,horizon),valid=pts.filter(p=>finite(p.value));
 const worst=valid.reduce((best,p)=>!best||p.value>best.value?p:best,null),coverage=all.filter(p=>finite(p.value)).at(-1);
 const hoursAvailable=coverage?Math.max(0,Math.floor((coverage.epoch-now)/HOUR)):0;
 const built=graph(pts,horizon,zone,Math.max(280,panel.clientWidth-40));
 panel.dataset.level=level.key;panel.dataset.hours=String(horizon);
 panel.innerHTML=`<div class="gross-eyebrow" id="gross-title">DEW POINT · GROSS METER</div>
  <div class="gross-now"><strong class="gross-number">${finite(dp)?Math.round(dp)+'°':'—'}</strong><span class="gross-now-label">current dew point</span></div>
  <p class="gross-verdict">${esc(level.label)}</p><span class="gross-pill gross-${level.key}">${esc(level.key==='nice-breeze'?'BREEZE SAVES IT':level.key==='nogo'?'NO-GO':level.key.toUpperCase())}</span>
  <p class="gross-note">${esc(level.note)}</p>
  <div class="gross-toolbar"><span>Explore the forecast</span><div class="gross-periods" role="group" aria-label="Dew-point graph time range">${[[24,'24h'],[48,'48h'],[168,'7 days'],[240,'10 days']].map(([n,l])=>`<button type="button" data-gross-hours="${n}" aria-pressed="${horizon===n}" class="${horizon===n?'selected':''}">${l}</button>`).join('')}</div></div>
  <p class="gross-coverage">${hoursAvailable>=24?`${Math.floor(hoursAvailable/24)} days ${hoursAvailable%24} hours of forecast available`:'Forecast coverage is limited'}${hoursAvailable<horizon?' · Missing hours stay blank.':''}</p>
  <div class="gross-selection" aria-live="polite"><strong class="gross-selected-value">—</strong><span class="gross-selected-time"></span><span class="gross-selected-label"></span></div>
  <p class="gross-scroll-hint">Swipe the timeline ↔ · Tap the line for details</p>
  <div class="gross-scroll" tabindex="0" role="region" aria-label="Scrollable dew-point forecast chart">${built.html}</div>
  <label class="gross-slider-label" for="gross-scrubber">Explore each forecast hour</label><input id="gross-scrubber" type="range" min="0" max="${Math.max(0,pts.length-1)}" value="0" ${pts.length?'':'disabled'} aria-label="Forecast dew-point hour"/>
  <div class="gross-scale"><span>Dry &lt;50°</span><span>Not bad 50–59°</span><span>Humid 60–64°</span><span>Gross 65–69°</span><span>No-go 70–74°</span><span>Nope 75°+</span></div>
  ${worst?`<p class="gross-worst"><strong>Muggiest in this view:</strong> ${Math.round(worst.value)}° · ${esc(dayText(worst.time,zone))} at ${esc(hourText(worst.time,zone))}</p>`:'<p class="gross-empty">No dew-point forecast is available for these hours.</p>'}`;
 const select=i=>{
  const p=pts[Math.max(0,Math.min(pts.length-1,i))];if(!p)return;selectedEpoch=p.epoch;
  const v=dewpointGrossLevel(p.value,pairedWind(forecast,p.time));
  panel.querySelector('.gross-selected-value').textContent=finite(p.value)?Math.round(p.value)+'°':'Unavailable';
  panel.querySelector('.gross-selected-time').textContent=`${dayText(p.time,zone)} · ${hourText(p.time,zone)} forecast`;
  panel.querySelector('.gross-selected-label').textContent=v.label;
  const dot=panel.querySelector('.gross-selected'),cursor=panel.querySelector('.gross-cursor');
  dot.style.display=finite(p.value)?'':'none';if(finite(p.value)){dot.setAttribute('cx',built.g.x(p.epoch));dot.setAttribute('cy',built.g.y(p.value));}
  cursor.setAttribute('x1',built.g.x(p.epoch));cursor.setAttribute('x2',built.g.x(p.epoch));
  const slider=panel.querySelector('#gross-scrubber');slider.value=String(pts.indexOf(p));slider.setAttribute('aria-valuetext',`${dayText(p.time,zone)} ${hourText(p.time,zone)}: ${finite(p.value)?Math.round(p.value)+' degrees':'unavailable'}`);
 };
 const ix=pts.findIndex(p=>p.epoch===selectedEpoch);select(Math.max(0,ix));
 panel.querySelector('.gross-scroll').scrollLeft=scroll;
 panel.querySelectorAll('[data-gross-hours]').forEach(button=>button.addEventListener('click',()=>{horizon=Number(button.dataset.grossHours);selectedEpoch=null;panel.querySelector('.gross-scroll').scrollLeft=0;renderDewpointMeter(latest,lastNow);}));
 panel.querySelector('#gross-scrubber').addEventListener('input',e=>{
  select(Number(e.target.value));const p=pts[Number(e.target.value)],scroller=panel.querySelector('.gross-scroll');
  if(p){const x=built.g.x(p.epoch);if(x<scroller.scrollLeft+50||x>scroller.scrollLeft+scroller.clientWidth-30)scroller.scrollLeft=Math.max(0,x-scroller.clientWidth/2);}
 });
 const svg=panel.querySelector('.gross-chart');svg.addEventListener('click',e=>{const rect=svg.getBoundingClientRect(),x=e.clientX-rect.left;const i=pts.reduce((best,p,ix)=>Math.abs(built.g.x(p.epoch)-x)<Math.abs(built.g.x(pts[best].epoch)-x)?ix:best,0);select(i);});
 if(!resizeInstalled){resizeInstalled=true;let timer;window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(()=>{if(latest)renderDewpointMeter(latest,lastNow);},150);});}
}
export function resetDewpointMeter(){latest=null;selectedEpoch=null;document.getElementById('dewpoint-gross-meter')?.remove();}
