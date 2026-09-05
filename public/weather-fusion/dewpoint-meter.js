const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const DAY=86400000;

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

function ensureStyles(){
  if(document.getElementById('weather-nourie-dewpoint-meter-css'))return;
  const link=document.createElement('link');
  link.id='weather-nourie-dewpoint-meter-css';link.rel='stylesheet';link.href='/weather-fusion/dewpoint-meter.css?v=2-ten-day';
  document.head.append(link);
}
function formatHour(time,zone){return new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric'}).format(new Date(time));}
function formatDay(time,zone){return new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',month:'numeric',day:'numeric'}).format(new Date(time));}
function graph(points,zone){
  const valid=points.filter(p=>finite(p.value));
  if(valid.length<2)return '<div class="gross-empty">The dew-point forecast is still filling in.</div>';
  const W=900,H=330,L=48,R=16,T=14,B=44,min=Math.min(40,...valid.map(p=>p.value))-2,max=Math.max(80,...valid.map(p=>p.value))+2,span=Math.max(1,max-min);
  const x=i=>L+i/Math.max(1,points.length-1)*(W-L-R),y=v=>T+(max-v)/span*(H-T-B);
  const bands=[
    {a:75,b:max,cls:'band-nope',label:'NOPE'},
    {a:70,b:75,cls:'band-nogo',label:'NO-GO'},
    {a:65,b:70,cls:'band-gross',label:'GROSS'},
    {a:60,b:65,cls:'band-humid',label:'HUMID'},
    {a:50,b:60,cls:'band-nice',label:'NOT BAD'},
    {a:min,b:50,cls:'band-dry',label:'DRY'},
  ].filter(b=>b.b>min&&b.a<max);
  const bandRects=bands.map(b=>`<rect class="gross-band ${b.cls}" x="${L}" y="${y(Math.min(max,b.b))}" width="${W-L-R}" height="${Math.max(0,y(Math.max(min,b.a))-y(Math.min(max,b.b)))}"/>`).join('');
  const bandLabels=bands.map(b=>{const a=Math.max(min,b.a),z=Math.min(max,b.b),cy=(y(a)+y(z))/2;return `<text class="gross-band-label" x="${W-R-8}" y="${cy+4}" text-anchor="end">${b.label}</text>`;}).join('');
  const thresholds=[50,60,65,70,75].filter(v=>v>min&&v<max).map(v=>`<line class="gross-threshold" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="gross-y" x="${L-8}" y="${y(v)+4}" text-anchor="end">${v}°</text>`).join('');
  const first=Date.parse(points[0].time),last=Date.parse(points.at(-1).time),coverageDays=Math.max(1,Math.ceil((last-first)/DAY));
  const dayTicks=[];
  for(let d=0;d<=coverageDays;d++){
    const target=first+d*DAY;let best=0;
    points.forEach((p,i)=>{if(Math.abs(Date.parse(p.time)-target)<Math.abs(Date.parse(points[best].time)-target))best=i;});
    if(!dayTicks.includes(best))dayTicks.push(best);
  }
  const dayGrid=dayTicks.map((i,n)=>`<line class="gross-day-line" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H-B}"/><text class="gross-x" x="${x(i)}" y="${H-12}" text-anchor="${n===0?'start':n===dayTicks.length-1?'end':'middle'}">${n===0?'Now':esc(formatDay(points[i].time,zone))}</text>`).join('');
  let path='',drawing=false;
  points.forEach((p,i)=>{if(!finite(p.value)){drawing=false;return;}path+=`${drawing?'L':'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)} `;drawing=true;});
  const dots=points.map((p,i)=>finite(p.value)&&i%6===0?`<circle class="gross-dot" cx="${x(i)}" cy="${y(p.value)}" r="3.2"/>`:'').join('');
  const firstValid=points.findIndex(p=>finite(p.value));
  const currentMark=firstValid>=0?`<circle class="gross-current-halo" cx="${x(firstValid)}" cy="${y(points[firstValid].value)}" r="10"/><circle class="gross-current" cx="${x(firstValid)}" cy="${y(points[firstValid].value)}" r="5"/><text class="gross-current-label" x="${x(firstValid)+10}" y="${y(points[firstValid].value)-10}">NOW ${Math.round(points[firstValid].value)}°</text>`:'';
  return `<svg class="gross-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dew point forecast for the next ${coverageDays} days">${bandRects}${dayGrid}${thresholds}${bandLabels}<path class="gross-line-shadow" d="${path}"/><path class="gross-line" d="${path}"/>${dots}${currentMark}</svg>`;
}
function pairedWind(forecast,time){
  const rows=forecast?.metricForecasts?.series?.wind||[];
  const stamp=Date.parse(time);
  let best=null,distance=Infinity;
  for(const row of rows){const d=Math.abs(Date.parse(row.time)-stamp);if(d<distance&&finite(row.value)){best=row;distance=d;}}
  return best&&distance<=3600000?best.value:null;
}
export function renderDewpointMeter(forecast,now=Date.now()){
  ensureStyles();
  const host=document.getElementById('skin-exposure');if(!host)return;
  let panel=document.getElementById('dewpoint-gross-meter');
  if(!panel){panel=document.createElement('section');panel.id='dewpoint-gross-meter';panel.className='glass dewpoint-gross-meter';panel.setAttribute('aria-labelledby','gross-title');host.insertAdjacentElement('afterend',panel);}
  const zone=forecast?.location?.timeZone||'America/New_York';
  const current=forecast?.current?.dewpoint,wind=forecast?.current?.wind,level=dewpointGrossLevel(current,wind);
  const series=(forecast?.metricForecasts?.series?.dewpoint||[]).filter(p=>Date.parse(p.time)>=now).slice(0,241);
  const valid=series.filter(p=>finite(p.value));
  const worst=valid.length?valid.reduce((a,b)=>b.value>a.value?b:a):null,worstLevel=worst?dewpointGrossLevel(worst.value,pairedWind(forecast,worst.time)):null;
  const last=series.at(-1),coverageDays=last?Math.max(1,Math.ceil((Date.parse(last.time)-now)/DAY)):0;
  panel.dataset.level=level.key;
  panel.innerHTML=`
    <div class="gross-head">
      <div><div class="gross-eyebrow">DEW POINT · GROSS METER</div><h2 id="gross-title">${finite(current)?`${Math.round(current)}°`:'—'} <span>${esc(level.label)}</span></h2></div>
      <div class="gross-pill gross-${level.key}">${esc(level.key==='nice-breeze'?'BREEZE SAVES IT':level.key.replace('-',' ').toUpperCase())}</div>
    </div>
    <p class="gross-note">${esc(level.note)}</p>
    <div class="gross-forecast-title">${coverageDays>=7?`${coverageDays}-DAY`:'EXTENDED'} DEW POINT FORECAST</div>
    ${worst?`<p class="gross-worst"><strong>Worst in the next ${coverageDays||1} days:</strong> ${Math.round(worst.value)}° around ${esc(formatHour(worst.time,zone))} ${esc(formatDay(worst.time,zone))} · ${esc(worstLevel.label)}</p>`:''}
    ${graph(series,zone)}
    <div class="gross-scale" aria-label="Gross meter scale"><span>Dry</span><span>Not bad</span><span>Humid</span><span>Gross</span><span>No-go</span><span>Nope</span></div>`;
}
export function resetDewpointMeter(){document.getElementById('dewpoint-gross-meter')?.remove();}
