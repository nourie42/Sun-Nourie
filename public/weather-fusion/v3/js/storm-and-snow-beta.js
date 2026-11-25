// Storm and Snow Beta: point-forecast UI, using the existing canonical forecast.
// Regional rain grids, calibrated distributions and verified history are not fabricated.
import {winterDayAmount,winterAmountText,winterSnowMapForDay,winterAreaDataUrl,safeWinterMapUrl} from '../../snow-outlook.js?v=snow-readable-v1';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>finite(v)&&v>=0&&v<=100?Math.round(v)+'%':'Unavailable';
const inches=v=>finite(v)&&v>=0?v.toFixed(2)+'″':'Unavailable';
const rainSource='https://www.wpc.ncep.noaa.gov/qpf/qpf2.shtml';
const snowSource='https://www.wpc.ncep.noaa.gov/pwpf/wwd_accum_probs.php';
const detailNames={map:'Accumulation map',probabilities:'Chance & amounts',changes:'Forecast changes',timing:'Storm timing',live:'Live tracking',confidence:'Forecast confidence',impacts:'Weather impacts'};
const icons={map:'◈',probabilities:'%',changes:'↗',timing:'◷',live:'◎',confidence:'◇',impacts:'⚠'};
const css=`
.storm-beta{color:#183b52;background:#edf7fc;border-radius:16px;padding:14px;line-height:1.4;--accent:#197e83;--pale:#e0f3ed;max-width:100%;overflow-wrap:anywhere}
.storm-beta[data-mode=snow]{--accent:#246ead;--pale:#e4f0ff}
.storm-beta *{box-sizing:border-box}
.storm-beta h3,.storm-beta h4,.storm-beta p{color:inherit;margin:0}
.storm-beta h3{font-size:22px}.storm-beta h4{font-size:16px}
.storm-beta small,.storm-beta .sb-note{color:#48677a;font-size:12px}
.storm-beta .sb-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.storm-beta .sb-card,.storm-beta .sb-tile{background:rgba(255,255,255,.89);border:1px solid #ccdfe9;border-radius:14px;box-shadow:0 3px 12px #1c4b7210;padding:13px;margin:0;color:#183b52}
.storm-beta .sb-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}
.storm-beta button{cursor:pointer;min-height:44px;font:inherit;color:#183b52}
.storm-beta button.sb-tile{text-align:left;display:flex;flex-direction:column;gap:6px;min-width:0}
.storm-beta .sb-tile strong{font-size:14px;color:#183b52}.storm-beta .sb-tile span{color:var(--accent);font-weight:700}
.storm-beta .sb-hero{background:linear-gradient(110deg,#ffffffec,var(--pale));margin:10px 0;display:grid;gap:7px}
.storm-beta .sb-hero strong{font-size:30px;color:var(--accent)}
.storm-beta .sb-entry{min-height:128px;background:linear-gradient(145deg,#fff,var(--pale))}
.storm-beta .sb-entry[data-select=snow]{--pale:#e4f0ff;--accent:#246ead}
.storm-beta .sb-back,.storm-beta select{border:1px solid #b9d2df;background:white;border-radius:10px;padding:8px 12px;color:#183b52;min-height:44px}
.storm-beta .sb-row{display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid #e0ebf0;padding:9px 0;align-items:center}
.storm-beta .sb-row:last-child{border:0}.storm-beta a{color:#126496;text-decoration:underline}
.storm-beta .sb-map{height:320px;min-height:240px;border-radius:10px;overflow:hidden;background:#e6eef2;margin:8px 0}
.storm-beta .sb-legend{display:flex;flex-wrap:wrap;gap:8px;font-size:12px}.storm-beta .sb-legend i{width:12px;height:12px;display:inline-block;margin-right:4px;border:1px solid #adbdca}
.storm-beta .sb-map-tile{width:100%;min-height:76px;margin-top:8px}
.storm-beta .sb-alert{border-left:3px solid #b34a35;padding-left:10px;margin:10px 0}
@media(max-width:370px){.storm-beta{padding:9px}.storm-beta .sb-grid{gap:6px}.storm-beta .sb-tile{padding:9px}}
`;
function stamp(v,z){try{return new Intl.DateTimeFormat('en-US',{timeZone:z,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(v));}catch{return 'Time unavailable';}}
function row(a,b){return '<div class="sb-row"><span>'+esc(a)+'</span><strong>'+esc(b)+'</strong></div>';}
function link(url,title){return '<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(title)+'</a>';}
function amountFor(f,d,mode){if(mode==='snow'){const r=f?.canonical?.snow?.days?.find(x=>x.date===d?.dayKey);const a=winterDayAmount(r);return {text:winterAmountText(a.value,a.range),label:a.source||'Snowfall guidance unavailable',winter:r,a};}
 const c=f?.canonical?.days?.find(x=>x.date===d?.dayKey);return {text:inches(c?.qpf),label:'Liquid-equivalent precipitation (may include frozen precipitation)'};}
export function openStormAndSnowBeta(f,openModal){
 if(!document.getElementById('storm-beta-css')){const s=document.createElement('style');s.id='storm-beta-css';s.textContent=css;document.head.append(s);}
 const dialog=document.getElementById('nourie-dialog'),body=document.getElementById('modal-body');
 if(!dialog||!body)return;
 openModal('Storm and Snow Beta','<div class="storm-beta"></div>');
 const root=body.querySelector('.storm-beta');if(!root)return;
 let mode=null,view='landing',dayIndex=0,map=null,controller=null;
 const days=(f?.days||[]).slice(0,5),z=f?.timeZone||'America/New_York';
 function dispose(){controller?.abort();controller=null;map?.remove();map=null;}
 dialog.addEventListener('close',dispose,{once:true});
 function render(){
  dispose();root.dataset.mode=mode||'rain';
  const d=days[dayIndex],a=amountFor(f,d,mode),w=a.winter;
  const chance=mode==='snow'?pct(w?.snowChance):pct(d?.rainChance);
  const chanceLabel=mode==='snow'?'Peak hourly snow-type chance':'Existing daily blended rain chance';
  const head='<div class="sb-top">'+(mode?'<button class="sb-back" data-back>‹ Back</button>':'')+'<div><h3>'+esc(mode?(mode==='snow'?'Snow Central':'Rain Central'):'Storm and Snow Beta')+'</h3><small>'+esc(f?.location?.name||'Select a forecast location')+'</small></div></div>';
  if(!mode){root.innerHTML=head+'<p class="sb-note">Explore rain and winter weather using your existing forecast.</p><div class="sb-grid">'+['rain','snow'].map(m=>'<button class="sb-tile sb-entry" data-select="'+m+'"><span>'+ (m==='rain'?'☂ Rain Central':'❄ Snow Central')+'</span><strong>'+esc(amountFor(f,days[0],m).text)+'</strong><small>'+esc(amountFor(f,days[0],m).label)+'</small><span>Explore ›</span></button>').join('')+'</div>';return;}
  const select='<label class="sb-note">Forecast date <select data-day>'+days.map((x,i)=>'<option value="'+i+'"'+(i===dayIndex?' selected':'')+'>'+esc(x.shortWeekday+' · '+x.dateLabel)+'</option>').join('')+'</select></label>';
  const tile=(id,summary)=>'<button class="sb-tile'+(id==='map'?' sb-map-tile':'')+'" data-view="'+id+'"><span>'+icons[id]+' '+detailNames[id]+' ›</span><small>'+esc(summary)+'</small></button>';
  if(view==='landing'){root.innerHTML=head+select+'<section class="sb-card sb-hero"><small>'+esc(a.label)+'</small><strong>'+esc(a.text)+'</strong><b>'+esc(chance+' · '+chanceLabel)+'</b><small>Forecast assembled '+esc(stamp(f?.fetchedAt,z))+'</small></section>'+tile('map',mode==='snow'?'Explore available snowfall grids and official guidance':'Official rainfall guidance; regional beta layer pending')+'<div class="sb-grid">'+tile('probabilities',chance+' · '+chanceLabel)+tile('changes','Forecast history pending')+tile('timing',d?.condition||'Timing unavailable')+tile('live','Current weather and observations')+tile('confidence','Source coverage and uncertainty')+tile('impacts','Official weather alerts')+'</div>';return;}
  let html='';
  if(view==='probabilities'){
   html='<section class="sb-card">'+row(chanceLabel,chance)+(mode==='snow'?row('Peak hourly freezing rain chance',pct(w?.freezingRainChance))+row('Peak hourly sleet chance',pct(w?.sleetChance)):'')+'<h4>Published accumulation probabilities</h4>';
   const products=(w?.wpc||[]).filter(p=>p.kind==='snow'&&p.start&&p.end);
   html+=products.length?products.map(p=>row('At least '+p.inches+'″ · '+stamp(p.start,z)+' – '+stamp(p.end,z),Array.isArray(p.probabilityRange)?p.probabilityRange.join('–')+'%':'Unavailable')).join(''):'<p class="sb-note">Calibrated amount probabilities are not available for this period.</p>';
   html+='<p class="sb-note">Hourly or daily occurrence chances are not accumulation probabilities. Mutually exclusive outcomes require a validated distribution.</p></section>';
  }else if(view==='map'){
   const descriptor=mode==='snow'?winterSnowMapForDay(f?.canonical?.snow,w):null;
   html='<section class="sb-card"><h4>'+esc(descriptor?.label||'Regional accumulation guidance')+'</h4><p class="sb-note">'+esc(descriptor?.start&&descriptor?.end?stamp(descriptor.start,z)+' – '+stamp(descriptor.end,z):'No compatible regional grid available in this beta.')+'</p><div data-map class="sb-map" hidden></div><p data-status role="status" class="sb-note"></p><div data-legend class="sb-legend"></div>'+link(safeWinterMapUrl(descriptor?.sourceUrl)||(mode==='snow'?snowSource:rainSource),'Open official NOAA accumulation map')+'</section>';
   root.innerHTML=head+select+html;
   if(descriptor?.kind==='geojson')void mountMap(descriptor);else root.querySelector('[data-status]').textContent='Interactive layer unavailable; use the official forecast link.';
   return;
  }else if(view==='changes'){html='<section class="sb-card"><h4>Forecast history</h4><p>Comparable archived forecast snapshots are not wired into this beta. A change cannot be calculated from a single forecast.</p></section>';
  }else if(view==='timing'){html='<section class="sb-card"><h4>Available timing guidance</h4>'+row('Forecast condition',d?.condition||'Unavailable')+(w?.snowEventWindows||[]).map(v=>row(v.source||'Snow window',stamp(v.start,z)+' – '+stamp(v.end,z))).join('')+'<p class="sb-note">Storm arrival, peak and ending require validated event windows.</p></section>';
  }else if(view==='live'){html='<section class="sb-card">'+row('Current weather reading',f?.current?.condition||'Unavailable')+'<p class="sb-note">Current reading may be a forecast or observation; observed totals and remaining accumulation are not connected here.</p>'+link('https://radar.weather.gov/','Open official live radar')+'</section>';
  }else if(view==='confidence'){html='<section class="sb-card">'+row('Existing daily forecast confidence',d?.confidence?.level||'Unavailable')+(mode==='snow'?row('Winter data coverage',w?.coverageStatus||'Unavailable'):'')+'<p class="sb-note">Event-specific calibrated confidence and historical performance are pending verification.</p></section>';
  }else if(view==='impacts'){const alerts=Array.isArray(f?.alerts)?f.alerts:[];html='<section class="sb-card"><h4>Available official alerts</h4>'+(alerts.length?alerts.map(x=>'<div class="sb-alert"><strong>'+esc(x.event||x.properties?.event||x.headline||'Official alert')+'</strong><p>'+esc(x.headline||x.properties?.headline||'')+'</p></div>').join(''):'<p>No alert entries in the current snapshot; check official guidance for updates.</p>')+link('https://www.weather.gov/','National Weather Service')+'</section>';}
  root.innerHTML=head+select+html;
 }
 async function mountMap(d){
  const el=root.querySelector('[data-map]'),status=root.querySelector('[data-status]'),legend=root.querySelector('[data-legend]'),url=winterAreaDataUrl(d.url);
  if(!url||!window.L||!finite(f?.location?.latitude)||!finite(f?.location?.longitude)){status.textContent='Compatible map or location unavailable.';return;}
  const c=new AbortController();controller=c;el.hidden=false;
  const L=window.L;map=L.map(el).setView([f.location.latitude,f.location.longitude],6);const activeMap=map;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:12}).addTo(map);
  L.circleMarker([f.location.latitude,f.location.longitude],{radius:6,color:'#173b65',fillColor:'#fff',fillOpacity:1}).addTo(map);
  status.textContent='Loading snowfall accumulation…';requestAnimationFrame(()=>activeMap.invalidateSize());
  const timeout=setTimeout(()=>c.abort(),25000);
  try{const res=await fetch(url,{signal:c.signal,headers:{Accept:'application/geo+json,application/json'}});if(!res.ok)throw Error('map');const geo=await res.json();
   if(geo.type!=='FeatureCollection'||!Array.isArray(geo.features)||geo.features.length>20000||geo.metadata?.quantity!=='snowfall'||geo.metadata?.unit!=='in'||Date.parse(geo.metadata.start)!==Date.parse(d.start)||Date.parse(geo.metadata.end)!==Date.parse(d.end)||geo.features.some(x=>x.geometry?.type!=='Polygon'||!finite(x.properties?.value)||x.properties.value<0))throw Error('invalid');
   if(controller!==c||!map||c.signal.aborted)return;
   const color=x=>/^#[0-9a-f]{6}$/i.test(x||'')?x:'#83b6de';
   L.geoJSON(geo,{style:x=>({weight:0,fillColor:color(x.properties.color),fillOpacity:.65}),onEachFeature:(x,layer)=>layer.bindPopup(esc(inches(x.properties.value))+' snowfall · '+(d.source==='model-grid'?'model estimate':'contour lower bound'))}).addTo(map);
   legend.innerHTML=(geo.metadata.legend||[]).map(x=>'<span><i style="background:'+color(x.color)+'"></i>'+esc(x.label)+'</span>').join('');
   status.textContent=geo.features.length?'Snowfall in inches · '+(d.source==='model-grid'?'regional model guidance':'official WPC contours'):'No measurable contour published for this product.';
  }catch{if(controller===c)status.textContent='Map unavailable; this is not a zero snowfall forecast.';}finally{clearTimeout(timeout);}
 }
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-back')){if(view==='landing')mode=null;else view='landing';render();}else if(b.dataset.select){mode=b.dataset.select;view='landing';render();}else if(b.dataset.view){view=b.dataset.view;render();}});
 root.addEventListener('change',e=>{if(e.target.matches('[data-day]')){dayIndex=Number(e.target.value);render();}});
 render();
}
