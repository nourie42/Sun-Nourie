const finite=value=>typeof value==='number'&&Number.isFinite(value);
const LEGEND={
 wpc:[{id:'MRGL',level:'Marginal',color:'#74d36a'},{id:'SLGT',level:'Slight',color:'#f4e14a'},{id:'MDT',level:'Moderate',color:'#e03b3b'},{id:'HIGH',level:'High',color:'#d34cff'}],
 spc:[{id:'MRGL',level:'Marginal',color:'#74d36a'},{id:'SLGT',level:'Slight',color:'#f4e14a'},{id:'ENH',level:'Enhanced',color:'#e67a22'},{id:'MDT',level:'Moderate',color:'#e03b3b'},{id:'HIGH',level:'High',color:'#d34cff'}],
};
const COLORS={Marginal:'#74d36a',Slight:'#f4e14a',Enhanced:'#e67a22',Moderate:'#e03b3b',High:'#d34cff'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let outlookMap=null,outlookLayer=null,boundDialog=false,pendingKind=null;

export function activeRiskOutlooks(forecast,now=Date.now()){
 return (forecast?.riskOutlooks||[])
  .filter(risk=>risk&&risk.id&&risk.kind&&Date.parse(risk.expires)>now)
  .sort((a,b)=>(b.rank||0)-(a.rank||0));
}

export function riskOutlookButtonHTML(risk,index){
 const level=esc(risk.level||'Risk');
 return `<button type="button" class="risk-outlook-item risk-${esc(String(risk.kind||'').toLowerCase())} risk-${esc(String(risk.level||'').toLowerCase())}" data-risk-index="${index}" data-risk-id="${esc(risk.id)}" data-risk-kind="${esc(risk.kind)}"><span class="risk-outlook-level">${level}</span><span class="risk-outlook-copy"><strong>${esc(risk.title||`${level} outlook`)}</strong><small>${esc(risk.summary||'Open the official outlook map and discussion.')}</small></span><span class="risk-outlook-action">View <b aria-hidden="true">›</b></span></button>`;
}

export function renderRiskOutlooks(forecast,now=Date.now()){
 const panel=document.getElementById('risk-outlooks'),list=document.getElementById('risk-outlook-list');
 if(!panel||!list)return [];
 const risks=activeRiskOutlooks(forecast,now);
 panel.hidden=!risks.length;
 list.innerHTML=risks.map(riskOutlookButtonHTML).join('');
 list.querySelectorAll('[data-risk-kind]').forEach(button=>button.addEventListener('click',()=>{
  const risk=risks[Number(button.dataset.riskIndex)];
  if(risk)void openRiskOutlook(risk,forecast);
 }));
 const take=document.getElementById('today-uncertainty');
 if(take){
  take.onclick=risks[0]?()=>{void openRiskOutlook(risks[0],forecast);}:null;
  take.style.cursor=risks[0]?'pointer':'';
  if(risks[0])take.setAttribute('title','Open outlook map and discussion');
  else take.removeAttribute('title');
 }
 bindOutlookDialog();
 if(shouldAutoOpenOutlooks()&&risks[0])void openRiskOutlook(risks[0],forecast);
 return risks;
}

export function resetRiskOutlooks(){
 const panel=document.getElementById('risk-outlooks'),list=document.getElementById('risk-outlook-list');
 if(panel)panel.hidden=true;
 if(list)list.innerHTML='';
 const dialog=document.getElementById('outlook-dialog');
 if(dialog?.open)dialog.close();
}

function shouldAutoOpenOutlooks(){
 return /\/weather-fusion\/outlooks\/?$/.test(globalThis.location?.pathname||'');
}

function bindOutlookDialog(){
 const dialog=document.getElementById('outlook-dialog');
 if(!dialog||boundDialog)return;
 boundDialog=true;
 document.getElementById('close-outlook')?.addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{
  pendingKind=null;
  document.body.classList.remove('dialog-open');
  destroyOutlookMap();
 });
}

export async function openRiskOutlook(risk,forecast){
 const dialog=document.getElementById('outlook-dialog'),content=document.getElementById('outlook-dialog-content');
 if(!dialog||!content||!risk?.kind)return null;
 bindOutlookDialog();
 pendingKind=risk.kind;
 content.innerHTML=`<div class="dialog-eyebrow">OUTLOOKS</div><h2 id="outlook-dialog-title" class="dialog-title">${esc(risk.title)}</h2><p class="dialog-condition">Loading the official map and discussion…</p>`;
 if(!dialog.open)dialog.showModal();
 document.body.classList.add('dialog-open');
 const query=new URLSearchParams({kind:risk.kind});
 const lat=forecast?.location?.latitude,lon=forecast?.location?.longitude;
 if(finite(lat)&&finite(lon)){query.set('latitude',String(lat));query.set('longitude',String(lon));}
 try{
  const response=await fetch(`/api/weather-fusion/outlook?${query}`,{cache:'no-store',headers:{Accept:'application/json'}});
  const detail=await response.json();
  if(!response.ok)throw new Error(detail.error||'Outlook unavailable.');
  if(pendingKind!==risk.kind)return detail;
  renderOutlookDetail(content,risk,detail);
  paintOutlookMap(detail);
  return detail;
 }catch(error){
  if(pendingKind!==risk.kind)return null;
  content.innerHTML=`<div class="dialog-eyebrow">OUTLOOKS</div><h2 id="outlook-dialog-title" class="dialog-title">${esc(risk.title)}</h2><p class="dialog-prose">${esc(error.message||'The outlook could not be loaded.')}</p><a class="bulletin-dialog-source" href="${esc(risk.url||'https://www.weather.gov/')}" target="_blank" rel="noopener noreferrer">Open official outlook ↗</a>`;
  return null;
 }
}

export function outlookDetailHTML(risk,detail={}){
 const legend=(detail.legend||LEGEND[risk.kind]||LEGEND.wpc).map(item=>`<span><i style="background:${esc(item.color)}"></i>${esc(item.id)}</span>`).join('');
 const meta=[detail.office,detail.issued,detail.validLabel].filter(Boolean).join('\n');
 return `<div class="dialog-eyebrow">OUTLOOKS</div>
  <h2 id="outlook-dialog-title" class="dialog-title">${esc(detail.product||risk.title)}</h2>
  <div id="outlook-map" class="outlook-map" role="img" aria-label="Outlook risk contours"></div>
  <div class="outlook-legend" aria-label="Risk legend">${legend}</div>
  <h3 class="dialog-subtitle">${esc(detail.product||'Official discussion')}</h3>
  <p class="outlook-meta">${esc(meta)}</p>
  <pre class="outlook-discussion">${esc(detail.discussion||'Discussion text is temporarily unavailable.')}</pre>
  <a class="bulletin-dialog-source" href="${esc(detail.sourceUrl||risk.url||'https://www.weather.gov/')}" target="_blank" rel="noopener noreferrer">Open official outlook ↗</a>`;
}

function renderOutlookDetail(content,risk,detail){
 content.innerHTML=outlookDetailHTML(risk,detail);
}

function destroyOutlookMap(){
 outlookLayer=null;
 if(outlookMap){outlookMap.remove();outlookMap=null;}
}

function paintOutlookMap(detail){
 destroyOutlookMap();
 const host=document.getElementById('outlook-map');
 if(!host||!globalThis.L)return;
 const center=detail.location&&finite(detail.location.latitude)?[detail.location.latitude,detail.location.longitude]:[39.5,-98.35];
 outlookMap=L.map(host,{zoomControl:true,scrollWheelZoom:false,attributionControl:false}).setView(center,detail.location?6:4);
 L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:8}).addTo(outlookMap);
 const collection={type:'FeatureCollection',features:(detail.features||[]).map(row=>({type:'Feature',properties:{level:row.level},geometry:row.geometry}))};
 outlookLayer=L.geoJSON(collection,{
  style:feature=>({color:'#102033',weight:1,fillColor:COLORS[feature.properties?.level]||'#74d36a',fillOpacity:.45}),
 }).addTo(outlookMap);
 if(detail.location&&finite(detail.location.latitude))L.circleMarker(center,{radius:6,color:'#fff',weight:2,fillColor:'#4cc3ff',fillOpacity:1}).addTo(outlookMap);
 requestAnimationFrame(()=>{
  outlookMap?.invalidateSize();
  const bounds=outlookLayer?.getBounds();
  if(bounds?.isValid())outlookMap.fitBounds(bounds.pad(0.08),{maxZoom:6});
 });
}
