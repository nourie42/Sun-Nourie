// Isolated prerelease Feel Meter. Main-site dewpoint-meter.js is intentionally unchanged.
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const HOUR=3600000;
let horizon=48,selectedEpoch=null,latest=null,lastNow=0,resizeInstalled=false,panelObserver=null,meterMode='humid';
export function dewpointGrossLevel(dewpoint,wind=0){
  if(!finite(dewpoint))return {key:'unknown',label:'Waiting on the dew point',note:'We need a dew-point reading before calling it.'};
  if(dewpoint<50)return {key:'dry',label:'The air left the steam room',note:'Low outdoor dew point. Open the Dry view for the dry-air forecast.'};
  if(dewpoint<60)return {key:'nice',label:'Now this ain’t bad',note:'The air has enough room for sweat to evaporate pretty well.'};
  if(dewpoint<=63&&finite(wind)&&wind>=8)return {key:'nice-breeze',label:'Now this ain’t bad',note:`The ${Math.round(wind)} mph breeze is saving a borderline-humid dew point.`};
  if(dewpoint<65)return {key:'humid',label:'Dang, it’s a bit humid out',note:'You’ll notice the moisture, especially if the air is still.'};
  if(dewpoint<70)return {key:'gross',label:'It’s gettin’ a bit gross',note:'Sweat has a harder time evaporating, so the air starts feeling sticky.'};
  if(dewpoint<75)return {key:'nogo',label:'I’m not tryin’ to go out in this',note:'Very muggy air. Sweat may evaporate less readily, especially when the air is still.'};
  return {key:'nope',label:'Nope',note:'Extremely muggy air. Temperature, sun and wind also affect how it feels.'};
}


export function forecastGrossLevel(dewpoint,wind=0){
 const level=dewpointGrossLevel(dewpoint,wind);
 const labels={dry:'It will feel very dry',nice:'It should feel pretty comfortable','nice-breeze':'The breeze should make it feel comfortable',humid:'It will feel a bit humid',gross:'It will feel a bit gross',nogo:'It will feel very muggy',nope:'It will feel extremely muggy',unknown:'The dew-point forecast is unavailable'};
 return {...level,label:labels[level.key]||labels.unknown};
}

export function dewpointDryLevel(dewpoint){
 if(!finite(dewpoint))return {key:'unknown',label:'Waiting on the dew point',note:'We need a dew-point reading before calling it.'};
 if(dewpoint<35)return {key:'parched',label:'Doorknobs might start throwing hands',note:'Very dry outdoor air. Warm it indoors and surprise static zaps may join the forecast.'};
 if(dewpoint<45)return {key:'crisp',label:'Your sweater is plotting a static zap',note:'Crisp, dry air. Indoor heating can make it feel drier; static depends on indoor humidity and materials.'};
 if(dewpoint<55)return {key:'pleasant',label:'The air has stopped clinging to you',note:'Low outdoor moisture. A generally comfortable break from muggy air.'};
 if(dewpoint<60)return {key:'comfortable',label:'The air is minding its business',note:'A middle-ground dew point, with neither very dry nor very muggy air.'};
 if(dewpoint<65)return {key:'sticky',label:'Dry air has left the group chat',note:'Moisture is creeping up. The Humid view has the sticky-air outlook.'};
 return {key:'humid',label:'The air brought a wet blanket',note:'A humid dew point. Open the Humid view for the muggy-air outlook.'};
}
export function forecastDryLevel(dewpoint){
 const level=dewpointDryLevel(dewpoint);
 const labels={
  parched:'Very dry air ahead. Heated rooms may turn doorknobs into jump scares.',
  crisp:'Crisp, dry air ahead. Heated rooms may give sweaters a static side hustle.',
  pleasant:'Pleasantly dry air ahead. The air should stop clinging to you.',
  comfortable:'The air should mind its business: neither very dry nor very muggy.',
  sticky:'Dry air may leave the group chat. A sticky feel is moving in.',
  humid:'The air is bringing a wet blanket. Expect a humid feel.',
  unknown:'The dew-point forecast is unavailable for this hour'
 };
 return {...level,label:labels[level.key]||labels.unknown};
}
// Preserve source values, including zero and decimals. Missing values stay missing.
export function formatDewpointValue(value,missing='—'){
 return finite(value)?`${value}°`:missing;
}
export function feelMeterScale(dewpoint,mode='humid'){
 const min=mode==='dry'?25:45,max=mode==='dry'?70:80;
 const labels=mode==='dry'
  ?[[25,'Very dry'],[40,'Dry'],[55,'Comfy'],[70,'Humid']]
  :[[45,'Dry'],[55,'Not bad'],[65,'Sticky'],[80,'Muggy']];
 return {min,max,labels,position:finite(dewpoint)?Math.max(0,Math.min(100,(dewpoint-min)/(max-min)*100)):null};
}
export function dewpointPoints(forecast,now,hours=240){
 const unique=new Map(),start=Math.ceil(now/HOUR)*HOUR,end=start+hours*HOUR;
 for(const p of forecast?.metricForecasts?.series?.dewpoint||[]){
  const t=Date.parse(p.time);if(!finite(t)||t<start||t>=end)continue;
  if(!unique.has(t)||(!finite(unique.get(t).value)&&finite(p.value)))unique.set(t,{...p,time:new Date(t).toISOString(),epoch:t});
 }
 return [...unique.values()].sort((a,b)=>a.epoch-b.epoch);
}
export function currentDewpointValue(forecast,now=Date.now()){
 const observed=forecast?.current?.dewpoint;
 if(finite(observed))return observed;
 const currentHour=(forecast?.metricForecasts?.series?.dewpoint||[]).find(point=>{
  const start=Date.parse(point.time);return finite(point.value)&&finite(start)&&start<=now&&now<start+HOUR;
 });
 return finite(currentHour?.value)?currentHour.value:null;
}
function styles(){
 if(document.getElementById('weather-nourie-prerelease-feel-meter-css'))return;
 const l=document.createElement('link');l.id='weather-nourie-prerelease-feel-meter-css';l.rel='stylesheet';l.href='/weather-fusion/prerelease-feel-meter.css?v=feel-meter-v1';
 l.addEventListener('load',()=>{if(latest)renderDewpointMeter(latest,lastNow);},{once:true});document.head.append(l);
}
const hourText=(t,z)=>new Intl.DateTimeFormat('en-US',{timeZone:z,hour:'numeric',minute:'2-digit'}).format(new Date(t));
const dayText=(t,z)=>new Intl.DateTimeFormat('en-US',{timeZone:z,weekday:'short',month:'numeric',day:'numeric'}).format(new Date(t));
function pairedWind(f,time){const t=Date.parse(time);return f?.metricForecasts?.series?.wind?.find(p=>Date.parse(p.time)===t)?.value??null;}
export function graphGeometry(points,hours,viewport=640,start=points[0]?.epoch??0){
 const vals=points.filter(p=>finite(p.value)).map(p=>p.value);
 const min=vals.length?Math.floor((Math.min(...vals)-4)/5)*5:40,max=vals.length?Math.ceil((Math.max(...vals)+4)/5)*5:80;
 // Keep the complete selected horizon inside the available width, not a wider scroll surface.
 const W=Math.max(120,finite(viewport)?Math.floor(viewport):640),height=W<600?210:230,L=W<400?40:48,R=16,T=24,B=42;
 // Missing leading/trailing hours stay blank instead of stretching available data.
 const first=start,last=first+Math.max(1,hours-1)*HOUR;
 return {W,height,L,R,T,B,min,max,first,last,x:t=>L+(t-first)/Math.max(HOUR,last-first)*(W-L-R),y:v=>T+(max-v)/Math.max(5,max-min)*(height-T-B)};
}
function graph(points,hours,zone,width,start){
 const g=graphGeometry(points,hours,width,start),{W,height,L,R,T,B,min,max,x,y}=g;
 const bands=meterMode==='dry'
  ?[[-Infinity,35,'dry-parched','PARCHED'],[35,45,'dry-crisp','CRISP'],[45,55,'dry-pleasant','PLEASANT'],[55,60,'dry-comfy','COMFY'],[60,65,'dry-sticky','STICKY'],[65,Infinity,'dry-humid','HUMID']]
  :[[-Infinity,50,'dry','DRY'],[50,60,'nice','NOT BAD'],[60,65,'humid','HUMID'],[65,70,'gross','GROSS'],[70,75,'nogo','NO-GO'],[75,Infinity,'nope','NOPE']];
 const rects=bands.filter(([a,b])=>a<max&&b>min).map(([a,b,c])=>`<rect class="gross-band band-${c}" x="${L}" y="${y(Math.min(max,b))}" width="${W-L-R}" height="${y(Math.max(min,a))-y(Math.min(max,b))}"/>`).join('');
 const ticks=[];for(let v=min;v<=max;v+=5)ticks.push(`<line class="gross-threshold" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="gross-y" x="${L-8}" y="${y(v)+4}" text-anchor="end">${v}°</text>`);
 // Both ends are always labeled. Interior labels adapt to the screen width;
 // every hourly value still appears in the path and remains selectable.
 const axis=[],step=hours>48?24:6;
 const compact=hours>48&&W<600;
 const label=t=>hours>48?(compact?new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'numeric',day:'numeric'}).format(new Date(t)):dayText(t,zone)):hourText(t,zone);
 const gap=compact?48:86;
 const tick=(t,anchor)=>{const xx=x(t);axis.push(`<line class="gross-day-line" x1="${xx}" x2="${xx}" y1="${T}" y2="${height-B}"/><text class="gross-x" x="${xx}" y="${height-12}" text-anchor="${anchor}">${esc(label(t))}</text>`);};
 tick(g.first,'start');let lastX=L;
 for(let t=g.first+HOUR;t<g.last;t+=HOUR){
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(t)));
  const xx=x(t);if(hour%step!==0||xx-lastX<gap||W-R-xx<gap)continue;
  tick(t,'middle');lastX=xx;
 }
 tick(g.last,'end');
 let d='',prev=null;
 for(const p of points){if(!finite(p.value)){prev=null;continue;}const continuous=prev&&p.epoch-prev.epoch<=HOUR*1.1;d+=`${continuous?'L':'M'}${x(p.epoch).toFixed(2)},${y(p.value).toFixed(2)} `;prev=p;}
 let dotX=-Infinity;
 const dots=points.filter(p=>{if(!finite(p.value)||x(p.epoch)-dotX<18)return false;dotX=x(p.epoch);return true;}).map(p=>`<circle class="gross-dot" cx="${x(p.epoch)}" cy="${y(p.value)}" r="2.4"/>`).join('');
 return {g,html:`<svg class="gross-chart" width="100%" height="${height}" viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" style="width:100%;height:${height}px;max-width:100%" role="img" aria-label="${hours/24}-day dew-point forecast. Tap a point or use the slider for its value.">${rects}${ticks.join('')}${axis.join('')}<path class="gross-line-shadow" d="${d}"/><path class="gross-line" d="${d}"/>${dots}<line class="gross-cursor" style="display:none" y1="${T}" y2="${height-B}"/><circle class="gross-selected" style="display:none" r="5"/></svg>`};
}
export function renderDewpointMeter(forecast,now=Date.now()){
 latest=forecast;lastNow=now;styles();
 const skin=document.getElementById('skin-exposure');if(!skin)return;
 const host=skin.closest?.('.exposure-cards')||skin;
 let panel=document.getElementById('dewpoint-gross-meter');
 if(!panel){const anchor=document.getElementById('car-wash-forecast')||host;panel=document.createElement('section');panel.id='dewpoint-gross-meter';panel.className='glass dewpoint-gross-meter prerelease-feel-meter';panel.setAttribute('aria-labelledby','gross-title');anchor.insertAdjacentElement('afterend',panel);}
 const focused=document.activeElement;
 const focusSelector=panel.contains(focused)?(focused?.dataset?.meterMode?`[data-meter-mode="${focused.dataset.meterMode}"]`:focused?.dataset?.grossHours?`[data-gross-hours="${focused.dataset.grossHours}"]`:focused?.id==='gross-scrubber'?'#gross-scrubber':null):null;
 const all=dewpointPoints(forecast,now,240),pts=dewpointPoints(forecast,now,horizon),valid=pts.filter(p=>finite(p.value));
 const zone=forecast?.location?.timeZone||'America/New_York',dp=currentDewpointValue(forecast,now),level=meterMode==='dry'?dewpointDryLevel(dp):dewpointGrossLevel(dp,forecast?.current?.wind);
 const extreme=valid.reduce((best,p)=>!best||(meterMode==='dry'?p.value<best.value:p.value>best.value)?p:best,null),coverage=all.filter(p=>finite(p.value)).at(-1);
 const hoursAvailable=coverage?Math.max(0,Math.floor((coverage.epoch-now)/HOUR)):0;
 const box=window.getComputedStyle(panel);
 const width=panel.clientWidth-(parseFloat(box.paddingLeft)||0)-(parseFloat(box.paddingRight)||0)-2;
 const built=graph(pts,horizon,zone,width,Math.ceil(now/HOUR)*HOUR);
 const scale=feelMeterScale(dp,meterMode),marker=scale.position??0;
 const pill=level.key==='nice-breeze'?'BREEZE SAVES IT':level.key==='nogo'?'NO-GO':level.key.toUpperCase();
 const humidity=forecast?.current?.humidity,air=forecast?.current?.temperature,feels=forecast?.comfort?.outdoors;
 panel.dataset.mode=meterMode;panel.dataset.level=level.key;panel.dataset.hours=String(horizon);
 panel.innerHTML=`<div class="gross-summary">
   <div class="gross-intro"><div class="gross-intro-copy"><div class="gross-eyebrow" id="gross-title"><strong>Feel Meter</strong><span>Dew point · ${meterMode==='dry'?'Dry':'Humid'} view</span></div><p class="gross-note">${esc(level.note)}</p></div><svg class="gross-drop" viewBox="0 0 64 76" aria-hidden="true"><path d="M32 3C23 20 10 36 10 51a22 22 0 0 0 44 0C54 36 41 20 32 3Z"/><path d="M53 26h8M53 38h8M53 50h8"/></svg></div>
   <div class="gross-now"><strong class="gross-number">${formatDewpointValue(dp)}</strong><small class="gross-now-label">Current dew point</small></div>
   <div class="gross-callout"><span class="gross-pill gross-${level.key}">${esc(pill)}</span><p class="gross-verdict">${esc(level.label)}</p></div>
   <div class="gross-current-scale" style="--gross-position:${marker}%"><div class="gross-current-track" aria-hidden="true"><i ${scale.position===null?'hidden':''}></i></div><div class="gross-current-labels">${scale.labels.map(([value,label])=>`<span style="--feel-label-position:${(value-scale.min)/(scale.max-scale.min)*100}%"><b>${value}°</b>${esc(label)}</span>`).join('')}</div></div>
  </div>
  <div class="gross-explore"><div class="gross-toolbar"><span>Explore the forecast</span><div class="gross-mode-toggle" role="group" aria-label="Feel Meter view"><button type="button" data-meter-mode="humid" aria-pressed="${meterMode==='humid'}" class="${meterMode==='humid'?'selected':''}">Humid</button><button type="button" data-meter-mode="dry" aria-pressed="${meterMode==='dry'}" class="${meterMode==='dry'?'selected':''}">Dry</button></div><div class="gross-periods" role="group" aria-label="Dew-point graph time range">${[[24,'24h'],[48,'48h'],[168,'7 days'],[240,'10 days']].map(([n,l])=>`<button type="button" data-gross-hours="${n}" aria-pressed="${horizon===n}" class="${horizon===n?'selected':''}">${l}</button>`).join('')}</div><p class="gross-coverage">${hoursAvailable>=24?`${Math.floor(hoursAvailable/24)} days ${hoursAvailable%24} hours of forecast available`:'Forecast coverage is limited'}${hoursAvailable<horizon?' · Missing hours stay blank.':''}</p></div>
   <p class="feel-meter-context">Outdoor dew point guides the air-feel forecast. Indoor humidity is not measured here.</p>
   <div class="gross-forecast-layout"><div class="gross-readout"><div class="gross-selection" aria-live="polite"><strong class="gross-selected-value">—</strong><span class="gross-selected-time"></span><span class="gross-selected-label">${pts.length?'':'No forecast hours are available in this view.'}</span></div><p class="gross-scroll-hint">Full range shown · Tap the line or use the slider for details</p></div>
    <div class="gross-scroll" tabindex="0" role="region" aria-label="Full-range dew-point forecast chart">${built.html}</div></div>
   <label class="gross-slider-label" for="gross-scrubber">Explore each forecast hour</label><input id="gross-scrubber" type="range" min="0" max="${Math.max(0,pts.length-1)}" value="0" ${pts.length?'':'disabled'} aria-label="Forecast dew-point hour"/>
   <div class="gross-scale">${meterMode==='dry'?'<span>Parched &lt;35°</span><span>Crisp 35–44°</span><span>Pleasant 45–54°</span><span>Comfy 55–59°</span><span>Sticky 60–64°</span><span>Humid 65°+</span>':'<span>Dry &lt;50°</span><span>Not bad 50–59°</span><span>Humid 60–64°</span><span>Gross 65–69°</span><span>No-go 70–74°</span><span>Nope 75°+</span>'}</div>
   ${extreme?`<p class="gross-worst"><strong>${meterMode==='dry'?'Driest':'Muggiest'} in this view:</strong> ${formatDewpointValue(extreme.value)} · ${esc(dayText(extreme.time,zone))} at ${esc(hourText(extreme.time,zone))}</p>`:'<p class="gross-empty">No dew-point forecast is available for these hours.</p>'}</div>
  <div class="gross-facts" aria-label="Current conditions supporting the Feel Meter">
   <span><i aria-hidden="true">●</i><b>${formatDewpointValue(dp)}</b><small>Dew point</small></span>
   <span><i aria-hidden="true">≋</i><b>${finite(humidity)?Math.round(humidity)+'%':'—'}</b><small>Outdoor humidity</small></span>
   <span><i aria-hidden="true">♨</i><b>${finite(air)?Math.round(air)+'°':'—'}</b><small>Air temperature</small></span>
   <span><i aria-hidden="true">◇</i><b>${finite(feels)?Math.round(feels)+'°':'—'}</b><small>Feels like</small></span>
  </div>`;
 const select=i=>{
  const p=pts[Math.max(0,Math.min(pts.length-1,i))];if(!p)return;selectedEpoch=p.epoch;
  const v=meterMode==='dry'?forecastDryLevel(p.value):forecastGrossLevel(p.value,pairedWind(forecast,p.time));
  panel.querySelector('.gross-selected-value').textContent=formatDewpointValue(p.value,'Unavailable');
  panel.querySelector('.gross-selected-time').textContent=`${dayText(p.time,zone)} · ${hourText(p.time,zone)} forecast`;
  panel.querySelector('.gross-selected-label').textContent=v.label;
  const dot=panel.querySelector('.gross-selected'),cursor=panel.querySelector('.gross-cursor');
  dot.style.display=finite(p.value)?'':'none';if(finite(p.value)){dot.setAttribute('cx',built.g.x(p.epoch));dot.setAttribute('cy',built.g.y(p.value));}
  cursor.style.display='';cursor.setAttribute('x1',built.g.x(p.epoch));cursor.setAttribute('x2',built.g.x(p.epoch));
  const slider=panel.querySelector('#gross-scrubber');slider.value=String(pts.indexOf(p));slider.setAttribute('aria-valuetext',`${dayText(p.time,zone)} ${hourText(p.time,zone)}: ${finite(p.value)?p.value+' degrees':'unavailable'}`);
 };
 const ix=pts.findIndex(p=>p.epoch===selectedEpoch);select(Math.max(0,ix));
 panel.querySelectorAll('[data-gross-hours]').forEach(button=>button.addEventListener('click',()=>{horizon=Number(button.dataset.grossHours);selectedEpoch=null;renderDewpointMeter(latest,lastNow);}));
 panel.querySelectorAll('[data-meter-mode]').forEach(button=>button.addEventListener('click',()=>{meterMode=button.dataset.meterMode;renderDewpointMeter(latest,lastNow);}));
 panel.querySelector('#gross-scrubber').addEventListener('input',e=>select(Number(e.target.value)));
 const svg=panel.querySelector('.gross-chart');svg.addEventListener('click',e=>{
  const rect=svg.getBoundingClientRect(),x=(e.clientX-rect.left)/Math.max(1,rect.width)*built.g.W;
  const i=pts.reduce((best,p,ix)=>Math.abs(built.g.x(p.epoch)-x)<Math.abs(built.g.x(pts[best].epoch)-x)?ix:best,0);select(i);
 });
 if(focusSelector)panel.querySelector(focusSelector)?.focus({preventScroll:true});
 // The shared jump control reveals a display:none panel without a window resize.
 // Rebuild at its real width when opened; never stretch the hidden 120px fallback.
 if(!panelObserver&&typeof ResizeObserver==='function'){
  let observedWidth=panel.clientWidth;
  panelObserver=new ResizeObserver(()=>{
   const width=panel.clientWidth;
   if(width>0&&width!==observedWidth){observedWidth=width;if(latest)renderDewpointMeter(latest,lastNow);}
  });
  panelObserver.observe(panel);
 }
 if(!resizeInstalled){resizeInstalled=true;let timer;window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(()=>{if(latest)renderDewpointMeter(latest,lastNow);},150);});}
}
export function resetDewpointMeter(){latest=null;selectedEpoch=null;panelObserver?.disconnect();panelObserver=null;document.getElementById('dewpoint-gross-meter')?.remove();}
