const $=id=>document.getElementById(id);
const frames={fusion:$('fusion-frame'),google:$('google-frame')};
const mobile=()=>matchMedia('(max-width: 850px)').matches;
let points=[],point=null,view=mobile()?'fusion':'both',snapshots={},lastScroll=null,booting=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const send=(source,payload)=>frames[source].contentWindow?.postMessage(payload,location.origin);
const status=(text,error=false)=>{$('compare-status').textContent=text;$('compare-status').classList.toggle('error',error);};

function setView(next){
 view=['fusion','google','both'].includes(next)?next:'fusion';
 if(mobile()&&view==='both')view='fusion';
 document.querySelector('.compare-frames').dataset.view=view;
 document.querySelectorAll('[data-view]').forEach(button=>{
  if(button.tagName==='BUTTON')button.setAttribute('aria-pressed',String(button.dataset.view===view));
 });
 $('compare-view-note').textContent=mobile()
  ?'Switch forecasts; the other view stays at the same section and hour.'
  :'Switch views without losing your place. Scroll and selections can stay in sync.';
 if(lastScroll&&$('compare-sync').checked){
  requestAnimationFrame(()=>{for(const source of Object.keys(frames))send(source,lastScroll);});
 }
 try{localStorage.setItem('weather-compare-view',view);}catch{}
}

function choose(id){
 point=points.find(candidate=>candidate.id===id);if(!point)return;
 snapshots={};lastScroll=null;
 document.querySelector('.compare-match').hidden=true;
 $('compare-location').value=id;
 $('compare-coordinates').textContent=`Both forecasts: ${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;
 const url=new URL(location.href);url.searchParams.set('location',id);history.replaceState(null,'',url);
 for(const source of Object.keys(frames))frames[source].src='/weather-fusion/compare/pane?'+new URLSearchParams({source,location:id});
 document.querySelector('.compare-frames').hidden=false;
 status(`Loading both forecasts for ${point.name}…`);
}

function matches(){
 const dan=snapshots.fusion,nvidia=snapshots.google;
 if(!dan||!nvidia)return [];
 const nvidiaByTime=new Map(nvidia.hours.map(hour=>[Date.parse(hour.time),hour]));
 return dan.hours.filter(hour=>Date.parse(hour.time)>=Date.now()&&nvidiaByTime.has(Date.parse(hour.time)))
  .map(hour=>({time:hour.time,fusion:hour,google:nvidiaByTime.get(Date.parse(hour.time))}));
}

function renderDifferences(){
 const rows=matches();
 if(!rows.length){
  document.querySelector('.compare-match').hidden=true;
  status('No overlapping upcoming forecast hours are available. Each side keeps its own timestamps.',true);
  return;
 }
 const selected=$('compare-hour').value;
 const label=time=>new Intl.DateTimeFormat('en-US',{timeZone:point.timeZone,weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(time));
 $('compare-hour').innerHTML=rows.map(row=>`<option value="${esc(row.time)}">${esc(label(row.time))}</option>`).join('');
 if(rows.some(row=>row.time===selected))$('compare-hour').value=selected;
 const row=rows.find(item=>item.time===$('compare-hour').value)||rows[0];
 const fields=[['Temperature','temperature','°F',0],['Feels like','feelsLike','°F',0],['Dew point','dewpoint','°F',0],['Wind','windMph',' mph',0],['Cloud cover','skyCover','%',0],['Rain amount','precipitation',' in',2]];
 const format=(value,unit,digits)=>finite(value)?value.toFixed(digits)+unit:'Not supplied';
 $('compare-differences').innerHTML=fields.map(([name,key,unit,digits])=>{
  const dan=row.fusion[key],nvidia=row.google[key],difference=finite(dan)&&finite(nvidia)?nvidia-dan:null;
  return `<div class="compare-difference"><h3>${name}</h3><strong>Dan: ${format(dan,unit,digits)}</strong><strong>NVIDIA: ${format(nvidia,unit,digits)}</strong><small>${difference===null?'No paired value':`NVIDIA ${difference>=0?'+':''}${difference.toFixed(digits)}${unit}`}</small></div>`;
 }).join('');
 document.querySelector('.compare-match').hidden=false;
 status(`Both forecasts loaded for ${point.name}. Rain amounts cover the same hour; probabilities and amounts are not compared as if equivalent.`);
}

window.addEventListener('message',event=>{
 if(event.origin!==location.origin)return;
 const source=Object.keys(frames).find(key=>event.source===frames[key].contentWindow);
 if(!source||event.data?.source!==source||event.data?.location!==point?.id)return;
 const message=event.data;
 if(message.type==='compare:forecast'){
  snapshots[source]=message;
  if(snapshots.fusion&&snapshots.google)renderDifferences();
  return;
 }
 if(message.type==='compare:error'){
  delete snapshots[source];document.querySelector('.compare-match').hidden=true;
  status(`${source==='google'?'NVIDIA':'Dan’s forecast'}: ${message.message}`,true);
  return;
 }
 if(!$('compare-sync').checked)return;
 if(['compare:scroll','compare:hour','compare:day','compare:metric','compare:close'].includes(message.type)){
  if(message.type==='compare:scroll')lastScroll={type:message.type,section:message.section,progress:message.progress};
  send(source==='fusion'?'google':'fusion',message);
 }
});

async function boot(){
 if(booting)return;
 booting=true;$('compare-refresh').disabled=true;
 try{
  const response=await fetch('/api/weather-fusion/compare/locations',{cache:'no-store',signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok||!Array.isArray(data.points)||!data.points.length)throw Error(data.error||'No NVIDIA forecast locations are available.');
  points=data.points;
  $('compare-location').innerHTML=points.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  $('compare-location').disabled=false;
  const requested=new URLSearchParams(location.search).get('location');
  choose(points.some(item=>item.id===requested)?requested:points[0].id);
 }catch(error){status((error.message||'Forecast locations are unavailable.')+' The main weather page is unchanged. Use Refresh both to retry.',true);}
 finally{booting=false;$('compare-refresh').disabled=false;}
}

$('compare-location').addEventListener('change',event=>choose(event.target.value));
document.querySelectorAll('.compare-switch button').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
document.querySelectorAll('[data-section]').forEach(button=>button.addEventListener('click',()=>{
 lastScroll={type:'compare:scroll',section:button.dataset.section,progress:0};
 for(const source of Object.keys(frames))send(source,lastScroll);
}));
$('compare-hour').addEventListener('change',()=>{
 const time=$('compare-hour').value;renderDifferences();
 for(const source of Object.keys(frames))send(source,{type:'compare:hour',time});
});
$('compare-refresh').addEventListener('click',()=>{
 if(!point){void boot();return;}
 status('Refreshing both forecasts…');
 for(const source of Object.keys(frames))send(source,{type:'compare:refresh'});
});
window.addEventListener('resize',()=>{if(mobile()&&view==='both')setView('fusion');});
try{const stored=localStorage.getItem('weather-compare-view');if(['fusion','google','both'].includes(stored))view=stored;}catch{}
setView(view);void boot();
