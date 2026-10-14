// Winter details open only on the Snow tab or forecast tile.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inch=n=>finite(n)&&n>=0?n>0&&n<.05?'<0.1″':`${n.toFixed(1)}″`:'Unavailable';
const officialWinterUrl='https://www.wpc.ncep.noaa.gov/pwpf/wwd_accum_probs.php';
const labels={wpc:'WPC winter',ecmwf:'ECMWF',weathernext:'Google WeatherNext',gfs:'GFS',hrrr:'HRRR',nam:'NAM'};
const windowTitle=w=>w.label||(w.mode==='nearTerm'?'Next 24 forecast hours':w.mode==='extended'?'Later snowfall':'Winter blend');
let latest=null,map=null,overlay=null,opened=false,initialized=false,pointLayer=null,pointHandler=null,pointRequest=null,selectedLayerId=null;
const pointCache=new Map();
const pointMarkers=new Map();
const dayName=r=>r.index===0?'Today':r.label||r.date;
const dayActive=r=>!!(r.possible||r.freezingRainPossible||r.sleetPossible||['snow','freezingRain','sleet'].some(kind=>finite(r[kind+'Chance'])&&r[kind+'Chance']>0&&r[kind+'Chance']<=100));
export function winterOutlookState(s){
 if(!s)return 'unavailable';
 if(s.possible||(s.days||[]).some(dayActive)||s.wssi)return 'active';
 if(s.error||s.status==='unavailable'||s.status==='failed'||s.coverageStatus==='unavailable')return 'unavailable';
 const known=['ready','complete','partial'].includes(s.status)||['ready','complete','partial'].includes(s.coverageStatus)||(s.days||[]).some(r=>r.nwsCovered||['ready','complete','partial'].includes(r.coverageStatus))||Object.entries(s.sources||{}).some(([id,value])=>id!=='nwsGridThrough'&&value===true);
 return known?'clear':'unavailable';
}
const active=s=>winterOutlookState(s)==='active';
const stamp=(v,z='America/New_York')=>{
 if(!finite(Date.parse(v)))return 'Time unavailable';
 try{return new Intl.DateTimeFormat('en-US',{timeZone:z||'America/New_York',weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(v));}catch{return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(v));}
};
const weightsText=w=>Object.entries(w||{}).filter(([,v])=>finite(v)&&v>=0&&v<=100).map(([id,v])=>`${labels[id]||id} ${Math.round(v)}%`).join(' · ');
export function safeWinterMapUrl(value){
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
export function winterMapDescriptors(s){
 const existing=Array.isArray(s?.maps)?s.maps:[];
 if(existing.some(d=>d.kind==='point-totals'))return existing;
 const windows=(s?.blendWindows||[]).map((w,index)=>({w,index})).filter(({w})=>finite(Date.parse(w.start))&&finite(Date.parse(w.end))&&Date.parse(w.end)>Date.parse(w.start));
 const points=windows.length?windows.map(({w,index},i)=>({id:`point-totals-${index}`,kind:'point-totals',label:i===0?'Snow totals · forecast points':`Snow totals · ${windowTitle(w)} ${i}`,windowIndex:index,windowStart:w.start,windowEnd:w.end,unit:'in',sourceUrl:officialWinterUrl,description:'Local forecast points from the available winter amount blend. These markers are not a continuous snow grid.'})):[{id:'point-totals',kind:'point-totals',label:'Snow totals · forecast points',unit:'in',sourceUrl:officialWinterUrl,description:'Winter amount guidance is unavailable for this point. Click another U.S. location to check its local forecast.'}];
 return [...points,...existing];
}
export function winterPointAmount(s,d={}){
 const windows=(s?.blendWindows||[]).map((w,index)=>({w,index})).filter(({w})=>finite(Date.parse(w.start))&&finite(Date.parse(w.end))&&Date.parse(w.end)>Date.parse(w.start));
 const exact=windows.find(({w})=>Date.parse(w.start)===Date.parse(d.windowStart)&&Date.parse(w.end)===Date.parse(d.windowEnd));
 const indexed=windows.find(row=>row.index===d.windowIndex);
 const target=Date.parse(d.windowStart),closest=finite(target)?windows.reduce((best,row)=>!best||Math.abs(Date.parse(row.w.start)-target)<Math.abs(Date.parse(best.w.start)-target)?row:best,null):null;
 const chosen=exact||indexed||closest||windows[0];
 if(!chosen)return {value:null,status:'unavailable',coverage:0,start:null,end:null,aligned:false};
 const b=chosen.w.snowfall||{};
 return {value:finite(b.value)&&b.value>=0?b.value:null,status:b.status||'unavailable',coverage:finite(b.coverage)?b.coverage:null,start:chosen.w.start,end:chosen.w.end,aligned:!!exact,windowIndex:chosen.index,weights:b.weights,actualWeights:b.actualWeights};
}
export function winterPointInBounds(lat,lon){return finite(lat)&&finite(lon)&&lat>=24&&lat<=50&&lon>=-125&&lon<=-66;}
export function winterPointPopupHTML(amount,place,zone='America/New_York'){
 return `<strong>${esc(place||'Local forecast point')}</strong><p class="winter-point-amount">${esc(inch(amount?.value))} snowfall</p>${amount?.start&&amount?.end?`<p>${esc(stamp(amount.start,zone))}–${esc(stamp(amount.end,zone))}</p>`:'<p>Forecast period unavailable.</p>'}<p>${finite(amount?.coverage)?`${Math.round(amount.coverage)}% of requested amount weight available. `:''}${amount?.status==='partial'?'Partial blend.':amount?.status==='unavailable'?'Compatible snowfall amounts unavailable.':''}</p>${amount?.actualWeights?`<p>${esc(weightsText(amount.actualWeights))}</p>`:''}<small>Local forecast point; this map is not a continuous snow grid. The times above belong to this point’s returned forecast.</small>`;
}
export function snowBannerSummary(s){
 const rows=(s?.days||[]).filter(dayActive);
 return rows.length?`${dayName(rows[0])}${rows.length>1?` · +${rows.length-1} more days`:''} · Snow, ice & sleet details`:s?.wssi?.title||'Winter precipitation possible';
}
function signal(r,kind){
 if(finite(r[kind+'Chance'])&&r[kind+'Chance']>=0&&r[kind+'Chance']<=100)return `${Math.round(r[kind+'Chance'])}% peak hourly`;
 const unknownPercentage=Object.hasOwn(r,kind+'Chance')?' · percentage unavailable':'';
 const text=r.typeSignals?.[kind];if(typeof text==='string')return esc(text)+(unknownPercentage&&!/unavailable/i.test(text)?unknownPercentage:'');if(text?.label)return esc(text.label)+(unknownPercentage&&!/unavailable/i.test(text.label)?unknownPercentage:'');
 const possible=kind==='snow'?(r.snowExpected??r.snowPossible??r.possible):r[kind+'Possible'];
 return possible?'Possible · percentage unavailable':r.coverageStatus==='unavailable'||possible!==false?'Unavailable':'No signal'+unknownPercentage;
}
function probabilitySourceHTML(r,zone){
 const hasPercentage=['snow','freezingRain','sleet'].some(kind=>finite(r[kind+'Chance'])&&r[kind+'Chance']>=0&&r[kind+'Chance']<=100);
 const source=typeof r.probabilitySource==='string'?r.probabilitySource:r.probabilitySource?.label||r.probabilitySource?.name||'';
 const method=typeof r.probabilityMethod==='string'?r.probabilityMethod:typeof r.method==='string'&&(source||hasPercentage)?r.method:'';
 const window=r.probabilityWindow,period=window?.start&&window?.end?`<span>Probability period: ${esc(stamp(window.start,zone))}–${esc(stamp(window.end,zone))}.</span>`:'';
 const coverage=Object.entries(r.probabilityCoverage||{}),partial=coverage.some(([,v])=>v.status!=='ready');
 const counts=partial?`<span>Available probability hours: ${coverage.map(([kind,v])=>`${esc(({snow:'Snow',freezingRain:'Freezing rain',sleet:'Sleet'})[kind]||kind)} ${finite(v.availableHours)?v.availableHours:'—'}/${finite(v.expectedHours)?v.expectedHours:'—'}`).join(' · ')}.</span>`:'';
 return hasPercentage||source||method?`<p class="winter-probability-source">${source?`${esc(source)}. `:''}${hasPercentage?'Percentages show the highest available hourly chance for each type in this day, not the chance over the full day. ':''}${esc(method)}${period}${counts}</p>`:'';
}
function sourceHTML(b){
 const all=['ready','complete'].includes(b?.status),missing=b?.status==='unavailable'||b?.coverage===0;
 return `<p class="winter-weights">Requested: ${esc(weightsText(b?.weights))}</p><p class="winter-coverage">${finite(b?.coverage)?`${Math.round(b.coverage)}% of requested weight has compatible data. `:''}${all?'All requested sources available.':missing?'No requested source has compatible accumulation data.':'Partial blend: only compatible available sources contribute.'}</p>${!all&&!missing&&b?.actualWeights?`<p class="winter-weights">Contributing weights: ${esc(weightsText(b.actualWeights))}</p>`:''}`;
}
export function snowDetailHTML(s,place,zone='America/New_York'){
 const head=`<div class="dialog-eyebrow" data-winter-outlook>${esc(place||'Your location')}</div><h2 id="forecast-window-title">Snow & winter weather</h2>`;
 if(!s)return head+`<p role="status">${place?'Winter forecast unavailable. We cannot confirm whether snow is expected.':'Choose a location first to check the winter forecast.'}</p>`;
 if(!active(s))return head+`<p class="winter-empty" role="status">${winterOutlookState(s)==='unavailable'?'Winter forecast unavailable. We cannot confirm whether snow is expected.':'No snow in the forecast.'}</p><p class="forecast-window-intro">${s.status==='partial'||s.coverageStatus==='partial'?'Coverage is limited; no winter precipitation signal appears in the available guidance. ':''}Winter details appear when the available forecast has a snow, sleet or freezing rain signal.</p>`;
 const days=(s.days||[]).filter(dayActive).map(r=>`<article class="winter-day"><h3>${esc(dayName(r))}<small>${esc(r.date)}</small></h3><div class="winter-type-grid">${[['snow','Snow'],['freezingRain','Freezing rain'],['sleet','Sleet']].map(([key,label])=>`<div><span>${label}</span><strong>${signal(r,key)}</strong></div>`).join('')}</div>${probabilitySourceHTML(r,zone)}<p class="winter-amount">Snow amount <strong>${Array.isArray(r.range)&&r.range.length===2&&r.range.every(finite)?`${r.range[0]}–${r.range[1]}″`:esc(inch(r.best))}</strong></p>${r.periods?.length?`<p>${r.periods.map(p=>`${esc(p.name)}: ${esc(p.wording)}`).join(' · ')}</p>`:''}${r.blend?sourceHTML(r.blend):''}</article>`).join('');
 const windows=(s.blendWindows||[]).map(w=>{
  const b=w.snowfall||w,raw=b.sources||w.sources;
  const sources=Array.isArray(raw)?raw:Object.entries(raw||{}).map(([id,s])=>({id,...(typeof s==='object'?s:{value:s})}));
  return `<article class="winter-window"><h3>${esc(windowTitle(w))} <strong>${esc(inch(b.value))}</strong></h3><p>${esc(stamp(w.start,zone))}–${esc(stamp(w.end,zone))}</p>${sourceHTML({...w,...b})}<ul class="winter-source-list">${sources.map(v=>`<li><span>${esc(v.label||labels[v.id]||v.id)}</span><strong>${esc(inch(v.value))}</strong><small>${esc(v.message||v.reason||v.status||'')}</small></li>`).join('')}</ul></article>`;
 }).join('');
 const probs=(s.days||[]).flatMap(r=>r.wpc||[]).filter(p=>p.start&&p.end);
 const probability=probs.length?`<section class="winter-probabilities"><h3>WPC snowfall & ice probabilities</h3><p>Chances of exceeding the stated accumulation, separate from the chance of any snow or ice.</p><ul>${probs.map(p=>`<li><strong>${p.kind==='ice'?'Ice':'Snow'} ${p.kind==='ice'?'over':'at least'} ${esc(p.inches)}″: ${esc(p.probabilityRange?`${p.probabilityRange[0]}–${p.probabilityRange[1]}%`:p.category||'Unavailable')}</strong><span>${esc(stamp(p.start,zone))}–${esc(stamp(p.end,zone))}</span></li>`).join('')}</ul></section>`:'';
 const maps=winterMapDescriptors(s);
 const mapHTML=maps.length?`<section class="winter-map-panel"><h3>Winter precipitation maps</h3><label for="winter-map-select">Map layer</label><select id="winter-map-select">${maps.map(m=>`<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</select><div id="winter-map" class="winter-map" role="region" aria-label="Winter precipitation forecast map" aria-describedby="winter-map-status winter-map-legend" tabindex="0"></div><div id="winter-map-legend" class="winter-map-legend"></div><p id="winter-map-status" role="status"></p><a id="winter-map-source" href="${esc(safeWinterMapUrl(maps[0].sourceUrl)||officialWinterUrl)}" target="_blank" rel="noopener noreferrer">Open official map ↗</a></section>`:`<p>Winter map data is unavailable. <a href="${officialWinterUrl}" target="_blank" rel="noopener noreferrer">WPC snow totals guidance ↗</a></p>`;
 return head+`<p class="forecast-window-intro">Your separate winter outlook. Amounts and probabilities use their own valid periods; unavailable data stays unavailable.</p>${s.wssi?`<p class="winter-impact">${esc(s.wssi.title||'WPC winter storm impacts may be possible.')}</p>`:''}${days}<section class="winter-blends"><h3>Snow accumulation blend</h3><p>First 24 hours: WPC 60% · HRRR 25% · NAM 15%. Beyond 24 hours: WPC 60% · ECMWF 20% · Google WeatherNext 10% · GFS 10%.</p>${windows}</section>${probability}${mapHTML}<p class="aqi-source">${esc(s.notes||'Official NWS wording is separate from deterministic snowfall. A model snow forecast does not establish a snow-only probability.')}</p>`;
}
function clearPointLayer(){
 pointRequest?.abort();pointRequest=null;
 if(map&&pointHandler)map.off('click',pointHandler);pointHandler=null;
 if(map&&pointLayer)map.removeLayer(pointLayer);pointLayer=null;
 pointMarkers.clear();
 const stage=typeof document!=='undefined'?document.getElementById('winter-map'):null;if(stage)stage.style.cursor='';
}
function disposeMap(){clearPointLayer();if(map)map.remove();map=null;overlay=null;}
function releaseSnowView(){opened=false;disposeMap();document.getElementById('forecast-window-dialog')?.classList.remove('winter-dialog');document.getElementById('open-snow')?.setAttribute('aria-expanded','false');}
function ensureInteractiveMap(){
 if(map)return true;
 if(!window.L){document.getElementById('winter-map-status').textContent='Map controls are loading. The official map link is available below.';return false;}
 const stage=document.getElementById('winter-map');stage.classList.remove('winter-static-map');stage.innerHTML='';
 const lat=latest?.location?.latitude,lon=latest?.location?.longitude,L=window.L;
 map=L.map('winter-map',{scrollWheelZoom:false}).setView([finite(lat)?lat:39,finite(lon)?lon:-96],finite(lat)?6:4);
 L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'© OpenStreetMap © CARTO',maxZoom:10}).addTo(map);
 if(finite(lat)&&finite(lon))L.circleMarker([lat,lon],{radius:5,color:'#fff',fillColor:'#87ccff',fillOpacity:1}).addTo(map).bindPopup(esc(latest.location.name||'Your location'));
 requestAnimationFrame(()=>map?.invalidateSize());return true;
}
function officialMapImage(d,status){
 disposeMap();const stage=document.getElementById('winter-map');stage.classList.add('winter-static-map');stage.innerHTML='';
 const url=safeWinterMapUrl(d.imageUrl||d.url),link=document.createElement('a');link.href=safeWinterMapUrl(d.sourceUrl)||url||officialWinterUrl;link.target='_blank';link.rel='noopener noreferrer';
 if(url){const img=document.createElement('img');img.src=url;img.alt=d.description||d.label||'Official WPC winter precipitation forecast';img.addEventListener('error',()=>{if(stage.contains(img))status.textContent='The official forecast image could not load. Use the official map link below.';});link.append(img);}else link.textContent='Open official winter precipitation map ↗';
 stage.append(link);
}
function displayPointTotal(data,lat,lon,d){
 const amount=winterPointAmount(data?.snow,d),zone=data?.location?.timeZone||latest?.location?.timeZone;
 const name=data?.location?.name||`Forecast point ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
 const period=amount.start&&amount.end?`${stamp(amount.start,zone)}–${stamp(amount.end,zone)}`:'Period unavailable';
 const status=document.getElementById('winter-map-status');
 status.textContent=`${name}: ${inch(amount.value)} snowfall · ${period}${finite(amount.coverage)?` · ${Math.round(amount.coverage)}% of requested weight available`:''}. Click a point in the contiguous U.S. to check its forecast. These markers are not a continuous snow grid.`;
 if(map&&pointLayer&&finite(lat)&&finite(lon)){
  const L=window.L,color=finite(amount.value)?'#c4e6ff':'#9bacc4';
  const key=`${lat.toFixed(3)},${lon.toFixed(3)}`,text=finite(amount.value)?inch(amount.value):'Unavailable',html=winterPointPopupHTML(amount,name,zone),existing=pointMarkers.get(key);
  if(existing){existing.setTooltipContent(esc(text));existing.setPopupContent(html);}
  else{const marker=L.circleMarker([lat,lon],{radius:8,color,fillColor:color,fillOpacity:.85,bubblingMouseEvents:false}).addTo(pointLayer).bindTooltip(esc(text),{permanent:true,direction:'top',className:'winter-point-label'}).bindPopup(html);pointMarkers.set(key,marker);if(pointMarkers.size>24){const oldest=pointMarkers.keys().next().value;pointLayer.removeLayer(pointMarkers.get(oldest));pointMarkers.delete(oldest);}}
 }
}
async function loadPointTotal(lat,lon,d){
 const status=document.getElementById('winter-map-status');
 if(!winterPointInBounds(lat,lon)){status.textContent='Choose a point within the contiguous U.S. coverage area. Snowfall outside that area has not been checked.';return;}
 pointRequest?.abort();const controller=new AbortController();pointRequest=controller;
 const key=`${lat.toFixed(3)},${lon.toFixed(3)}`,cached=pointCache.get(key),deadline=setTimeout(()=>controller.abort(),30000);
 status.textContent=`Checking snowfall guidance near ${lat.toFixed(2)}, ${lon.toFixed(2)}…`;
 try{
  let data=cached&&Date.now()-cached.at<5*60000?cached.data:null;
  if(!data){
   const response=await fetch('/api/weather-fusion/forecast?'+new URLSearchParams({latitude:lat.toFixed(4),longitude:lon.toFixed(4)}),{signal:controller.signal,cache:'no-store',headers:{Accept:'application/json'}});
   if(!response.ok)throw new Error('Point forecast unavailable');
   data=await response.json();
   if(!data?.snow||!finite(data.location?.latitude)||!finite(data.location?.longitude)||Math.abs(data.location.latitude-lat)>.1||Math.abs(data.location.longitude-lon)>.1)throw new Error('The returned forecast does not match this point');
   pointCache.set(key,{data,at:Date.now()});if(pointCache.size>24)pointCache.delete(pointCache.keys().next().value);
  }
  if(pointRequest===controller&&!controller.signal.aborted&&selectedLayerId===d.id&&map)displayPointTotal(data,lat,lon,d);
 }catch{
  if(pointRequest===controller&&selectedLayerId===d.id)status.textContent=controller.signal.aborted?'The point forecast took too long to load. Click again to retry; snowfall is unknown at that point.':'This point’s snowfall forecast could not be checked. Try another point or open official guidance; missing data is not zero snowfall.';
 }finally{clearTimeout(deadline);if(pointRequest===controller)pointRequest=null;}
}
function selectLayer(id){
 const d=winterMapDescriptors(latest?.snow).find(m=>m.id===id);if(!d)return;
 clearPointLayer();selectedLayerId=id;
 if(overlay)map.removeLayer(overlay);overlay=null;
 const status=document.getElementById('winter-map-status'),legend=document.getElementById('winter-map-legend');
 document.getElementById('winter-map-source').href=safeWinterMapUrl(d.sourceUrl)||officialWinterUrl;
 status.textContent=(d.start&&d.end?`${stamp(d.start,latest?.location?.timeZone)}–${stamp(d.end,latest?.location?.timeZone)} · ${d.unit||''}. `:'')+(d.description||'Official guidance; check issue and valid times on the source.');
 legend.innerHTML=(d.legend||[]).map(l=>`<span>${/^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i.test(l.image||'')?`<img src="${esc(l.image)}" alt="" aria-hidden="true">`:/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(l.color||'')?`<i style="background:${l.color}"></i>`:''}${esc(l.label)}</span>`).join('');
 if(d.kind==='point-totals'){
  const available=ensureInteractiveMap();
  if(available){pointLayer=window.L.layerGroup().addTo(map);pointHandler=e=>{void loadPointTotal(e.latlng.lat,e.latlng.lng,d);};map.on('click',pointHandler);document.getElementById('winter-map').style.cursor='crosshair';}
  const lat=latest?.location?.latitude,lon=latest?.location?.longitude;
  if(finite(lat)&&finite(lon))displayPointTotal(latest,lat,lon,d);else status.textContent='Choose a location to populate snowfall totals. Markers are individual forecast points, not a continuous snow grid.';
  if(!available)status.textContent+=' Map controls are loading; official guidance is linked below.';
  return;
 }
 const layerUrl=safeWinterMapUrl(d.url);
 if(d.kind==='official-image'||d.imageUrl||(d.kind==='image'&&!d.bounds)){officialMapImage(d,status);return;}
 if(d.kind==='wpc-portal'||d.kind==='portal'||d.kind==='official-link'){
  disposeMap();const stage=document.getElementById('winter-map');stage.classList.add('winter-static-map');stage.innerHTML='';
  const link=document.createElement('a');link.href=safeWinterMapUrl(d.sourceUrl)||layerUrl||officialWinterUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open official winter precipitation map ↗';stage.append(link);return;
 }
 if(!layerUrl){status.textContent='This forecast layer is unavailable. Open the official map for guidance.';return;}
 if(!ensureInteractiveMap())return;
 const L=window.L;
 if(d.kind==='image'&&d.bounds)overlay=L.imageOverlay(layerUrl,d.bounds,{opacity:.75});
 else if(layerUrl){
  const currentMap=map;
  const Layer=L.TileLayer.extend({getTileUrl(c){
   const nw=currentMap.options.crs.project(currentMap.unproject(L.point(c.x*256,c.y*256),c.z)),se=currentMap.options.crs.project(currentMap.unproject(L.point((c.x+1)*256,(c.y+1)*256),c.z));
   return layerUrl.replace(/\/$/,'')+'/export?'+new URLSearchParams({f:'image',bbox:`${nw.x},${se.y},${se.x},${nw.y}`,bboxSR:'3857',imageSR:'3857',size:'256,256',format:'png32',transparent:'true',layers:'show:'+(d.layers||[]).join(',')});
  }});
  overlay=new Layer('',{opacity:.8,attribution:'NOAA / NWS WPC',maxZoom:10});
 }
 if(overlay){const selected=overlay;overlay.on('tileerror error',()=>{if(selected===overlay)status.textContent='The forecast layer could not fully load. Open the official map for the latest guidance.';});overlay.addTo(map);}
}
function initializeMap(){
 if(!opened||!document.getElementById('winter-map'))return;
 const select=document.getElementById('winter-map-select');if(!select.dataset.winterBound){select.dataset.winterBound='true';select.addEventListener('change',()=>selectLayer(select.value));}selectLayer(select.value);
}
export function openSnowOutlook(){
 const dialog=document.getElementById('forecast-window-dialog'),content=document.getElementById('forecast-window-content');if(!dialog||!content)return;
 disposeMap();opened=true;dialog.classList.add('winter-dialog');content.innerHTML=snowDetailHTML(latest?.snow,latest?.location?.name,latest?.location?.timeZone);
 if(!dialog.open)dialog.showModal();document.body.classList.add('dialog-open');document.getElementById('open-snow')?.setAttribute('aria-expanded','true');initializeMap();
}
function install(){
 if(initialized||typeof document==='undefined')return;initialized=true;
 document.getElementById('open-snow')?.addEventListener('click',openSnowOutlook);
 document.getElementById('close-forecast-window')?.addEventListener('click',()=>document.getElementById('forecast-window-dialog')?.close());
 document.getElementById('forecast-window-dialog')?.addEventListener('close',()=>{releaseSnowView();if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');});
 const content=document.getElementById('forecast-window-content');
 if(content&&typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(opened&&!content.querySelector('[data-winter-outlook]'))releaseSnowView();}).observe(content,{childList:true});
 window.addEventListener('weather-map-library-ready',initializeMap);
 const link=document.createElement('link');link.rel='stylesheet';link.href='/weather-fusion/winter-outlook.css?v=3';document.head.append(link);
}
export function renderSnowOutlook(data){
 latest=data;install();let root=document.getElementById('snow-outlook-banner');
 if(!root){const anchor=document.getElementById('forecast-window-banners');if(!anchor)return;root=document.createElement('section');root.id='snow-outlook-banner';root.className='forecast-window-banners snow-outlook-banners';root.setAttribute('aria-label','Winter weather outlook');anchor.after(root);}
 root.hidden=!active(data?.snow);root.innerHTML='';
 if(!root.hidden){root.innerHTML=`<button type="button" class="glass forecast-window-banner forecast-window-snow" data-snow-outlook aria-haspopup="dialog" aria-controls="forecast-window-dialog"><span class="forecast-window-icon" aria-hidden="true">❄</span><span class="forecast-window-copy"><strong>Snow & winter weather</strong><span>${esc(snowBannerSummary(data.snow))}</span></span><span class="forecast-window-action">View forecast <b aria-hidden="true">›</b></span></button>`;root.querySelector('[data-snow-outlook]').addEventListener('click',openSnowOutlook);}
 if(opened&&document.querySelector('#forecast-window-content [data-winter-outlook]'))openSnowOutlook();else if(opened)releaseSnowView();
}
export function resetSnowOutlook(){
 latest=null;
 pointCache.clear();
 if(typeof document==='undefined')return;
 const dialog=document.getElementById('forecast-window-dialog');
 if(dialog?.open&&document.querySelector('#forecast-window-content [data-winter-outlook]'))dialog.close();
 releaseSnowView();
 const banner=document.getElementById('snow-outlook-banner');if(banner){banner.hidden=true;banner.innerHTML='';}
 if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
}

