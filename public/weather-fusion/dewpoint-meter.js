const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));

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
  link.id='weather-nourie-dewpoint-meter-css';link.rel='stylesheet';link.href='/weather-fusion/dewpoint-meter.css?v=1';
  document.head.append(link);
}
function formatTime(time,zone){
  return new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric'}).format(new Date(time));
}
function graph(points,zone){
  const valid=points.filter(p=>finite(p.value));
  if(valid.length<2)return '<div class="gross-empty">The hourly dew-point forecast is still filling in.</div>';
  const W=700,H=250,L=42,R=10,T=12,B=32,min=Math.min(40,...valid.map(p=>p.value))-2,max=Math.max(80,...valid.map(p=>p.value))+2,span=Math.max(1,max-min);
  const x=i=>L+i/Math.max(1,points.length-1)*(W-L-R),y=v=>T+(max-v)/span*(H-T-B);
  const bands=[
    {a:75,b:max,cls:'band-nope'},
    {a:70,b:75,cls:'band-nogo'},
    {a:65,b:70,cls:'band-gross'},
    {a:60,b:65,cls:'band-humid'},
    {a:50,b:60,cls:'band-nice'},
    {a:min,b:50,cls:'band-dry'},
  ].filter(b=>b.b>min&&b.a<max).map(b=>`<rect class="gross-band ${b.cls}" x="${L}" y="${y(Math.min(max,b.b))}" width="${W-L-R}" height="${Math.max(0,y(Math.max(min,b.a))-y(Math.min(max,b.b)))}"/>`).join('');
  const thresholds=[50,60,65,70,75].filter(v=>v>min&&v<max).map(v=>`<line class="gross-threshold" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="gross-y" x="${L-7}" y="${y(v)+4}" text-anchor="end">${v}°</text>`).join('');
  let path='',drawing=false;
  points.forEach((p,i)=>{if(!finite(p.value)){drawing=false;return;}path+=`${drawing?'L':'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)} `;drawing=true;});
  const indices=[0,Math.round((points.length-1)/3),Math.round((points.length-1)*2/3),points.length-1];
  const times=[...new Set(indices)].map((i,n,a)=>`<text class="gross-x" x="${x(i)}" y="${H-8}" text-anchor="${n===0?'start':n===a.length-1?'end':'middle'}">${esc(formatTime(points[i].time,zone))}</text>`).join('');
  const dots=points.map((p,i)=>finite(p.value)?`<circle class="gross-dot" cx="${x(i)}" cy="${y(p.value)}" r="2.6"/>`:'').join('');
  return `<svg class="gross-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dew point forecast for the next 24 hours">${bands}${thresholds}<path class="gross-line" d="${path}"/>${dots}${times}</svg>`;
}
function pairedWind(forecast,time){
  const rows=forecast?.metricForecasts?.series?.wind||[];
  const row=rows.find(r=>r.time===time);
  return finite(row?.value)?row.value:null;
}
export function renderDewpointMeter(forecast,now=Date.now()){
  ensureStyles();
  const host=document.getElementById('skin-exposure');if(!host)return;
  let panel=document.getElementById('dewpoint-gross-meter');
  if(!panel){panel=document.createElement('section');panel.id='dewpoint-gross-meter';panel.className='glass dewpoint-gross-meter';panel.setAttribute('aria-labelledby','gross-title');host.insertAdjacentElement('afterend',panel);}
  const zone=forecast?.location?.timeZone||'America/New_York';
  const current=forecast?.current?.dewpoint;
  const wind=forecast?.current?.wind;
  const level=dewpointGrossLevel(current,wind);
  const series=(forecast?.metricForecasts?.series?.dewpoint||[]).filter(p=>Date.parse(p.time)>=now).slice(0,24);
  const valid=series.filter(p=>finite(p.value));
  const worst=valid.length?valid.reduce((a,b)=>b.value>a.value?b:a):null;
  const worstLevel=worst?dewpointGrossLevel(worst.value,pairedWind(forecast,worst.time)):null;
  panel.dataset.level=level.key;
  panel.innerHTML=`
    <div class="gross-head">
      <div><div class="gross-eyebrow">DEW POINT · GROSS METER</div><h2 id="gross-title">${finite(current)?`${Math.round(current)}°`:'—'} <span>${esc(level.label)}</span></h2></div>
      <div class="gross-pill gross-${level.key}">${esc(level.key==='nice-breeze'?'BREEZE SAVES IT':level.key.replace('-',' ').toUpperCase())}</div>
    </div>
    <p class="gross-note">${esc(level.note)}</p>
    ${worst?`<p class="gross-worst"><strong>Worst in the next 24 hours:</strong> ${Math.round(worst.value)}° around ${esc(formatTime(worst.time,zone))} · ${esc(worstLevel.label)}</p>`:''}
    ${graph(series,zone)}
    <div class="gross-scale" aria-label="Gross meter scale"><span>Dry</span><span>Not bad</span><span>Humid</span><span>Gross</span><span>No-go</span><span>Nope</span></div>`;
}
export function resetDewpointMeter(){document.getElementById('dewpoint-gross-meter')?.remove();}
