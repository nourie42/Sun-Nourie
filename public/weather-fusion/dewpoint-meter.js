import {currentReadingFreshness} from './weather-freshness.js?v=accuracy-20261019-v1';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const HOUR=3600000;
let horizon=48,selectedEpoch=null,latest=null,lastNow=0,resizeInstalled=false,chartResizeObserver=null;
export function dewpointFeelLevel(dewpoint,wind=0){
  if(!finite(dewpoint))return {key:'unknown',label:'Waiting on the dew point',note:'We need a dew-point reading before calling it.'};
  if(dewpoint<35)return {key:'parched',label:'So dry, your doorknob may zap you',note:'Low moisture in the air. Heating it indoors can lower relative humidity and bring dry skin and static shocks; outdoor humidity can still be high.'};
  if(dewpoint<45)return {key:'crisp',label:'Lotion weather. Your elbows have entered the chat',note:'Crisp, low-moisture air. Heated indoor air may feel dry; the temperature still decides whether you need a coat.'};
  if(dewpoint<50)return {key:'dry',label:'You’re either cold or you’re gettin’ ashy',note:'On the dry side. This describes air moisture, not how warm or cold it feels.'};
  if(dewpoint<60)return {key:'nice',label:'Now this ain’t bad',note:'The air has enough room for sweat to evaporate pretty well.'};
  if(dewpoint<=63&&finite(wind)&&wind>=8)return {key:'nice-breeze',label:'Now this ain’t bad',note:`The ${Math.round(wind)} mph breeze is saving a borderline-humid dew point.`};
  if(dewpoint<65)return {key:'humid',label:'Dang, it’s a bit humid out',note:'You’ll notice the moisture, especially if the air is still.'};
  if(dewpoint<70)return {key:'gross',label:'It’s gettin’ a bit gross',note:'Sweat has a harder time evaporating, so the air starts feeling sticky.'};
  if(dewpoint<75)return {key:'nogo',label:'I’m not tryin’ to go out in this',note:'That is a muggy dew point. Your body has a much harder time dumping heat by evaporation.'};
  return {key:'nope',label:'Nope',note:'Extremely muggy air. Evaporative cooling is heavily limited.'};
}
// Keep existing integrations working while the visible meter uses its new name.
export const dewpointGrossLevel=dewpointFeelLevel;


export function forecastFeelLevel(dewpoint,wind=0){
 const level=dewpointFeelLevel(dewpoint,wind);
 const labels={parched:'Very dry air ahead — your doorknob may bring the sparks',crisp:'Crisp, dry air ahead — lotion gets a starring role',dry:'It should feel pleasantly dry',nice:'Moisture should feel pretty comfortable','nice-breeze':'The breeze should help with the humidity',humid:'It will feel a bit humid',gross:'It will feel sticky',nogo:'It will feel very muggy',nope:'It will feel extremely muggy',unknown:'The dew-point forecast is unavailable'};
 return {...level,label:labels[level.key]||labels.unknown};
}
export const forecastGrossLevel=forecastFeelLevel;

export function dewpointDryLevel(dewpoint){
 if(!finite(dewpoint))return {key:'unknown',label:'Waiting on the dew point',note:'We need a dew-point reading before calling it.'};
 if(dewpoint<35)return {key:'parched',label:'Your doorknob may be a tiny lightning bolt',note:'Very little moisture in the air. When heated indoors, it can favor static shocks and dry skin. Outdoor relative humidity may still be high.'};
 if(dewpoint<45)return {key:'crisp',label:'Your lip balm just got promoted',note:'Crisp, low-moisture air. Heating it indoors can make it feel dry; this is not a temperature comfort rating.'};
 if(dewpoint<55)return {key:'pleasant',label:'Pleasantly dry',note:'Lower moisture makes the air less sticky. Heat, cold, sun and wind still affect comfort.'};
 if(dewpoint<60)return {key:'comfortable',label:'Comfortable',note:'Still on the dry side of comfortable.'};
 if(dewpoint<65)return {key:'sticky',label:'Losing the dryness',note:'Dew point is climbing out of the dry zone.'};
 return {key:'humid',label:'Not dry at all',note:'Moist air can feel sticky; temperature and wind still affect comfort.'};
}
export function forecastDryLevel(dewpoint){
 const level=dewpointDryLevel(dewpoint);
 const labels={parched:'Very dry air ahead — indoor doorknobs may have opinions',crisp:'Crisp, dry air ahead — keep the lip balm handy',pleasant:'It should feel pleasantly dry',comfortable:'The moisture should feel comfortable',sticky:'It will feel a bit sticky',humid:'It will feel humid, not dry',unknown:'The dew-point forecast is unavailable'};
 return {...level,label:labels[level.key]||labels.unknown};
}

export function heatedIndoorHumidity(dewpoint,temperature=68){
 if(!finite(dewpoint)||!finite(temperature)||dewpoint>temperature)return null;
 const c=f=>(f-32)*5/9,saturation=t=>Math.exp(17.625*t/(243.04+t));
 return Math.max(0,Math.min(100,Math.round(100*saturation(c(dewpoint))/saturation(c(temperature)))));
}

export function dryForecastSummary(forecast,now=Date.now(),hours=48){
 const points=dewpointPoints(forecast,now,hours).filter(p=>finite(p.value));
 if(!points.length)return {available:0,expected:hours,partial:true,label:'The dry-air forecast is unavailable.',note:'Missing dew-point readings stay unknown.'};
 const low=Math.min(...points.map(p=>p.value)),high=Math.max(...points.map(p=>p.value));
 const driest=points.find(p=>p.value===low),veryDryHours=points.filter(p=>p.value<35).length,dryHours=points.filter(p=>p.value<45).length;
 const label=veryDryHours?`${veryDryHours} of ${points.length} available forecast hours have very low moisture.`:dryHours?`${dryHours} of ${points.length} available forecast hours bring crisp, dry air.`:low<55?'The lowest dew points bring less sticky air.':'Little dry-air relief is showing in this forecast.';
 const note=veryDryHours?'When that air is heated indoors, lotion and lip balm may become the household MVPs. Watch for the surprise doorknob zap.':dryHours?'Lip balm gets a promotion if you heat this air indoors. Outdoor humidity alone does not tell the whole dryness story.':'Dew point tracks moisture in the air. It does not predict whether it will rain. Temperature and wind still affect how warm or cold you feel.';
 return {available:points.length,expected:hours,partial:points.length<hours,low,high,driest,veryDryHours,dryHours,label,note};
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
 if(currentReadingFreshness(forecast,now).expired)return null;
 const observed=forecast?.current?.dewpoint;
 if(finite(observed))return observed;
 const currentHour=(forecast?.metricForecasts?.series?.dewpoint||[]).find(point=>{
  const start=Date.parse(point.time);return finite(point.value)&&finite(start)&&start<=now&&now<start+HOUR;
 });
 return finite(currentHour?.value)?currentHour.value:null;
}
function styles(){
 if(document.getElementById('weather-nourie-dewpoint-meter-css'))return;
 const l=document.createElement('link');l.id='weather-nourie-dewpoint-meter-css';l.rel='stylesheet';l.href='/weather-fusion/dewpoint-meter.css?v=feel-chart-v3';
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
export function graphAxisTicks(g,hours,zone){
 const compact=g.W<600,step=hours>48?24:6;
 const formatter=new Intl.DateTimeFormat('en-US',{timeZone:zone,...(hours>48?(compact?{month:'numeric',day:'numeric'}:{weekday:'short',month:'numeric',day:'numeric'}):{hour:'numeric'})});
 // Reserve each label's complete width, including both endpoint labels.
 // The short hour labels keep the axis legible on the narrowest phones.
 const tick=(epoch,anchor)=>{
  const text=formatter.format(new Date(epoch)),x=g.x(epoch),width=text.length*7+6;
  return {epoch,x,text,anchor,left:anchor==='start'?x:anchor==='end'?x-width:x-width/2,right:anchor==='start'?x+width:anchor==='end'?x:x+width/2};
 };
 const first=tick(g.first,'start'),last=tick(g.last,'end'),ticks=[first];let edge=first.right;
 for(let epoch=g.first+HOUR;epoch<g.last;epoch+=HOUR){
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(new Date(epoch)));
  if(hour%step!==0)continue;
  const next=tick(epoch,'middle');if(next.left<edge+10||next.right>last.left-10)continue;
  ticks.push(next);edge=next.right;
 }
 // A hidden panel may initially have no usable width. Its ResizeObserver
 // redraws the axis when opened; even this temporary axis cannot overlap.
 if(last.left>=edge+10)ticks.push(last);
 return ticks;
}
function graph(points,hours,zone,width,start){
 const g=graphGeometry(points,hours,width,start),{W,height,L,R,T,B,min,max,x,y}=g;
 const bands=[[-Infinity,35,'dry-parched','PARCHED'],[35,50,'dry','DRY'],[50,60,'nice','NOT BAD'],[60,65,'humid','HUMID'],[65,70,'gross','STICKY'],[70,75,'nogo','MUGGY'],[75,Infinity,'nope','VERY MUGGY']];
 const rects=bands.filter(([a,b])=>a<max&&b>min).map(([a,b,c])=>`<rect class="gross-band band-${c}" x="${L}" y="${y(Math.min(max,b))}" width="${W-L-R}" height="${y(Math.max(min,a))-y(Math.min(max,b))}"/>`).join('');
 const ticks=[];for(let v=min;v<=max;v+=5)ticks.push(`<line class="gross-threshold" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="gross-y" x="${L-8}" y="${y(v)+4}" text-anchor="end">${v}°</text>`);
 const axis=graphAxisTicks(g,hours,zone).map(t=>`<line class="gross-day-line" x1="${t.x}" x2="${t.x}" y1="${T}" y2="${height-B}"/><text class="gross-x" x="${t.x}" y="${height-12}" text-anchor="${t.anchor}">${esc(t.text)}</text>`).join('');
 let d='',prev=null;
 for(const p of points){if(!finite(p.value)){prev=null;continue;}const continuous=prev&&p.epoch-prev.epoch<=HOUR*1.1;d+=`${continuous?'L':'M'}${x(p.epoch).toFixed(2)},${y(p.value).toFixed(2)} `;prev=p;}
 let dotX=-Infinity;
 const dots=points.filter(p=>{if(!finite(p.value)||x(p.epoch)-dotX<18)return false;dotX=x(p.epoch);return true;}).map(p=>`<circle class="gross-dot" cx="${x(p.epoch)}" cy="${y(p.value)}" r="2.4"/>`).join('');
 return {g,html:`<svg class="gross-chart" width="100%" height="${height}" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMinYMin meet" style="width:100%;height:${height}px;max-width:100%" role="img" aria-label="${hours/24}-day dew-point forecast. Tap a point or use the slider for its value.">${rects}${ticks.join('')}${axis}<path class="gross-line-shadow" d="${d}"/><path class="gross-line" d="${d}"/>${dots}<line class="gross-cursor" y1="${T}" y2="${height-B}"/><circle class="gross-selected" r="5"/></svg>`};
}
export function renderDewpointMeter(forecast,now=Date.now()){
 latest=forecast;lastNow=now;styles();
 const skin=document.getElementById('skin-exposure');if(!skin)return;
 const host=skin.closest?.('.exposure-cards')||skin;
 let panel=document.getElementById('dewpoint-gross-meter');
 if(!panel){const anchor=document.getElementById('car-wash-forecast')||host;panel=document.createElement('section');panel.id='dewpoint-gross-meter';panel.className='glass dewpoint-gross-meter';panel.setAttribute('aria-labelledby','gross-title');anchor.insertAdjacentElement('afterend',panel);}
 const all=dewpointPoints(forecast,now,240),pts=dewpointPoints(forecast,now,horizon),valid=pts.filter(p=>finite(p.value));
 const zone=forecast.location.timeZone||'America/New_York',dp=currentDewpointValue(forecast,now),level=dewpointFeelLevel(dp,forecast.current.wind),dryFocus=finite(dp)&&dp<50;
 const extreme=valid.reduce((best,p)=>!best||(dryFocus?p.value<best.value:p.value>best.value)?p:best,null),coverage=all.filter(p=>finite(p.value)).at(-1);
 const hoursAvailable=coverage?Math.max(0,Math.floor((coverage.epoch-now)/HOUR)):0;
 chartResizeObserver?.disconnect();chartResizeObserver=null;
 const start=Math.ceil(now/HOUR)*HOUR;
 // A closed Feel Meter is display:none. Do not use its zero-width panel
 // as the coordinate system for the subsequently visible chart.
 let built=graph(pts,horizon,zone,Math.max(240,Math.min(640,window.innerWidth-76)),start);
 const marker=finite(dp)?Math.max(0,Math.min(100,(dp-20)/60*100)):0;
 const pill=({'nice-breeze':'BREEZE HELPS',gross:'STICKY',nogo:'MUGGY',nope:'VERY MUGGY'})[level.key]||level.key.toUpperCase();
 const humidity=forecast.current.humidity,air=forecast.current.temperature,feels=forecast.comfort?.outdoors;
 const dryness=dryForecastSummary(forecast,now,horizon),indoorRH=finite(air)&&air<60?heatedIndoorHumidity(dp):null;
 const indoorNote=finite(indoorRH)&&dp<45?`Heating this outdoor air to 68°F without adding moisture would put it near ${indoorRH}% relative humidity. Your actual indoor humidity depends on moisture sources and ventilation.`:'';
 panel.dataset.level=level.key;panel.dataset.hours=String(horizon);
 panel.innerHTML=`<div class="gross-summary">
   <div class="gross-intro"><div class="gross-intro-copy"><div class="gross-eyebrow" id="gross-title"><strong>Dew Point</strong><span>Feel Meter</span></div><p class="gross-note">${esc(level.note)}</p></div><svg class="gross-drop" viewBox="0 0 64 76" aria-hidden="true"><path d="M32 3C23 20 10 36 10 51a22 22 0 0 0 44 0C54 36 41 20 32 3Z"/><path d="M53 26h8M53 38h8M53 50h8"/></svg></div>
   <div class="gross-now"><strong class="gross-number">${finite(dp)?Math.round(dp)+'°':'—'}</strong><small class="gross-now-label">Current dew point</small></div>
   <div class="gross-callout"><span class="gross-pill gross-${level.key}">${esc(pill)}</span><p class="gross-verdict">${esc(level.label)}</p></div>
   <div class="gross-current-scale" style="--gross-position:${marker}%"><div class="gross-current-track"><i ${finite(dp)?'':'hidden'}></i></div><div class="gross-current-labels"><span><b>20°</b>Very dry</span><span><b>40°</b>Crisp</span><span><b>60°</b>Humid</span><span><b>80°</b>Very muggy</span></div></div>
  </div>
  <div class="gross-explore"><div class="gross-toolbar"><span>Explore the forecast</span><div class="gross-periods" role="group" aria-label="Dew-point graph time range">${[[24,'24h'],[48,'48h'],[168,'7 days'],[240,'10 days']].map(([n,l])=>`<button type="button" data-gross-hours="${n}" aria-pressed="${horizon===n}" class="${horizon===n?'selected':''}">${l}</button>`).join('')}</div><p class="gross-coverage">${hoursAvailable>=24?`${Math.floor(hoursAvailable/24)} days ${hoursAvailable%24} hours of forecast available`:'Forecast coverage is limited'}${hoursAvailable<horizon?' · Missing hours stay blank.':''}</p></div>
   <div class="gross-forecast-layout"><div class="gross-readout"><div class="gross-selection" aria-live="polite"><strong class="gross-selected-value">—</strong><span class="gross-selected-time"></span><span class="gross-selected-label"></span></div><p class="gross-scroll-hint">Full range shown · Tap the line or use the slider for details</p></div>
    <div class="gross-scroll" tabindex="0" role="region" aria-label="Full-range dew-point forecast chart">${built.html}</div></div>
   <label class="gross-slider-label" for="gross-scrubber">Explore each forecast hour</label><input id="gross-scrubber" type="range" min="0" max="${Math.max(0,pts.length-1)}" value="0" ${pts.length?'':'disabled'} aria-label="Forecast dew-point hour"/>
   <div class="gross-scale"><span>Dry &lt;50°</span><span>Not bad 50–59°</span><span>Humid 60–64°</span><span>Sticky 65–69°</span><span>Muggy 70–74°</span><span>Very muggy 75°+</span></div>
   ${extreme?`<p class="gross-worst"><strong>${dryFocus?'Driest':'Muggiest'} in this view:</strong> ${Math.round(extreme.value)}° · ${esc(dayText(extreme.time,zone))} at ${esc(hourText(extreme.time,zone))}</p>`:'<p class="gross-empty">No dew-point forecast is available for these hours.</p>'}
   <section class="feel-dry-summary" aria-label="How dry will the air feel?"><h3>How dry will the air feel?</h3><p>${esc(dryness.label)}${dryness.available?` Dew point ranges from ${Math.round(dryness.low)}° to ${Math.round(dryness.high)}°F.`:''}</p><p>${esc(dryness.note)}</p>${indoorNote?`<p class="feel-indoor-note">${esc(indoorNote)}</p>`:''}${dryness.partial&&dryness.available?`<small>Partial coverage: ${dryness.available} of ${horizon} hours available.</small>`:''}</section></div>
  <div class="gross-facts" aria-label="Current conditions supporting the Feel Meter">
   <span><i aria-hidden="true">●</i><b>${finite(dp)?Math.round(dp)+'°':'—'}</b><small>Dew point</small></span>
   <span><i aria-hidden="true">≋</i><b>${finite(humidity)?Math.round(humidity)+'%':'—'}</b><small>Humidity</small></span>
   <span><i aria-hidden="true">♨</i><b>${finite(air)?Math.round(air)+'°':'—'}</b><small title="Air temperature">Air temp</small></span>
   <span><i aria-hidden="true">◇</i><b>${finite(feels)?Math.round(feels)+'°':'—'}</b><small>Feels like</small></span>
  </div>`;
 const select=i=>{
  const p=pts[Math.max(0,Math.min(pts.length-1,i))];if(!p)return;selectedEpoch=p.epoch;
  const v=forecastFeelLevel(p.value,pairedWind(forecast,p.time));
  panel.querySelector('.gross-selected-value').textContent=finite(p.value)?Math.round(p.value)+'°':'Unavailable';
  panel.querySelector('.gross-selected-time').textContent=`${dayText(p.time,zone)} · ${hourText(p.time,zone)} forecast`;
  panel.querySelector('.gross-selected-label').textContent=v.label;
  const dot=panel.querySelector('.gross-selected'),cursor=panel.querySelector('.gross-cursor');
  dot.style.display=finite(p.value)?'':'none';if(finite(p.value)){dot.setAttribute('cx',built.g.x(p.epoch));dot.setAttribute('cy',built.g.y(p.value));}
  cursor.setAttribute('x1',built.g.x(p.epoch));cursor.setAttribute('x2',built.g.x(p.epoch));
  const slider=panel.querySelector('#gross-scrubber');slider.value=String(pts.indexOf(p));slider.setAttribute('aria-valuetext',`${dayText(p.time,zone)} ${hourText(p.time,zone)}: ${finite(p.value)?Math.round(p.value)+' degrees':'unavailable'}`);
 };
 const ix=pts.findIndex(p=>p.epoch===selectedEpoch);select(Math.max(0,ix));
 panel.querySelectorAll('[data-gross-hours]').forEach(button=>button.addEventListener('click',()=>{horizon=Number(button.dataset.grossHours);selectedEpoch=null;renderDewpointMeter(latest,lastNow);}));
 panel.querySelector('#gross-scrubber').addEventListener('input',e=>select(Number(e.target.value)));
 const scroll=panel.querySelector('.gross-scroll');
 const redraw=()=>{
  const width=scroll.clientWidth;if(width<=0)return;
  built=graph(pts,horizon,zone,width,start);scroll.innerHTML=built.html;
  select(Math.max(0,pts.findIndex(p=>p.epoch===selectedEpoch)));
 };
 // Measuring after insertion includes the mobile padding and the desktop
 // readout column, keeping SVG coordinates and on-screen pixels in sync.
 redraw();
 scroll.addEventListener('click',e=>{
  const svg=scroll.querySelector('.gross-chart');if(!svg||!pts.length)return;
  const rect=svg.getBoundingClientRect(),x=(e.clientX-rect.left)/Math.max(1,rect.width)*built.g.W;
  const i=pts.reduce((best,p,ix)=>Math.abs(built.g.x(p.epoch)-x)<Math.abs(built.g.x(pts[best].epoch)-x)?ix:best,0);select(i);
 });
 if(typeof window.ResizeObserver==='function'){
  chartResizeObserver=new window.ResizeObserver(()=>{if(scroll.clientWidth>0&&Math.abs(scroll.clientWidth-built.g.W)>=1)redraw();});
  chartResizeObserver.observe(scroll);
 }
 if(!resizeInstalled){resizeInstalled=true;let timer;window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(()=>{if(latest)renderDewpointMeter(latest,lastNow);},150);});}
}
export function resetDewpointMeter(){latest=null;selectedEpoch=null;chartResizeObserver?.disconnect();chartResizeObserver=null;document.getElementById('dewpoint-gross-meter')?.remove();}

