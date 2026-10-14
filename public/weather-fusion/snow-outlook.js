// Winter details open only on the Snow tab or forecast tile.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inch=n=>finite(n)&&n>=0?n>0&&n<.05?'<0.1″':`${n.toFixed(1)}″`:'Unavailable';
const officialWinterUrl='https://www.wpc.ncep.noaa.gov/pwpf/wwd_accum_probs.php';
const labels={wpc:'WPC winter',ecmwf:'ECMWF',weathernext:'Google WeatherNext',gfs:'GFS',hrrr:'HRRR',nam:'NAM'};
const windowTitle=w=>w.label||(finite(w.snowfall?.sources?.find(s=>s.id==='wpc')?.value)?'WPC 24-hour snowfall blend':w.mode==='nearTerm'?'Next 24 forecast hours':w.mode==='extended'?'Later snowfall':'Winter blend');
let latest=null,map=null,overlay=null,opened=false,initialized=false,pointLayer=null,pointHandler=null,pointRequest=null,areaRequest=null,selectedLayerId=null,selectedSnowDate=null,snowView='forecast';
const pointCache=new Map();
const pointMarkers=new Map();
const areaCache=new Map();
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
export function winterSnowDays(s){return (s?.days||[]).filter(r=>{
 const expected=r.snowExpected===true||r.snowPossible===true||(r.snowExpected==null&&r.snowPossible==null&&finite(r.snowChance)&&r.snowChance>=10);
 if(!expected)return false;
 const wording=(r.periods||[]).some(p=>p.snowWording===true||p.snowWording!==false&&/snow|flurr|blizzard/i.test(`${p.wording||''} ${p.detail||''}`));
 const amount=winterDayAmount(r),boundedTrace=Array.isArray(amount.range)&&(amount.range[1]===null||finite(amount.range[1])&&amount.range[1]>0);
 // A weak native probability alone is not an expected snowfall day when the
 // point accumulation is known to be zero. Keep that chance in winter details.
 return wording||amount.value!==0||boundedTrace;
});}
export const snowForecastPresent=s=>Array.isArray(s?.days)?winterSnowDays(s).length>0:s?.snowExpected===true;
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
 const area=existing.filter(d=>d.kind==='geojson'&&d.quantity==='snowfall'),rest=existing.filter(d=>!area.includes(d));
 if(existing.some(d=>d.kind==='point-totals'))return [...area,...rest];
 const windows=(s?.blendWindows||[]).map((w,index)=>({w,index})).filter(({w})=>finite(Date.parse(w.start))&&finite(Date.parse(w.end))&&Date.parse(w.end)>Date.parse(w.start));
 const points=windows.length?windows.map(({w,index},i)=>({id:`point-totals-${index}`,kind:'point-totals',label:i===0?'Snow totals · forecast points':`Snow totals · ${windowTitle(w)} ${i}`,windowIndex:index,windowStart:w.start,windowEnd:w.end,unit:'in',sourceUrl:officialWinterUrl,description:'Local forecast points from the available winter amount blend. These markers are not a continuous snow grid.'})):[{id:'point-totals',kind:'point-totals',label:'Snow totals · forecast points',unit:'in',sourceUrl:officialWinterUrl,description:'Winter amount guidance is unavailable for this point. Click another U.S. location to check its local forecast.'}];
 return [...area,...points,...rest];
}
export function winterAreaDataUrl(value){
 if(typeof value!=='string'||!value.startsWith('/api/weather-fusion/winter-map?'))return null;
 try{
  const u=new URL(value,'https://local-weather.invalid'),file=u.searchParams.get('file');
  if(u.pathname!=='/api/weather-fusion/winter-map')return null;
  if(u.searchParams.get('kind')!=='model-grid')return /^ppp_co_24hr_expected_sn_in_\d{10}f\d{3}\.kmz$/.test(file||'')?u.pathname+'?'+new URLSearchParams({file}):null;
  const lat=Number(u.searchParams.get('lat')),lon=Number(u.searchParams.get('lon')),start=Date.parse(u.searchParams.get('start')),end=Date.parse(u.searchParams.get('end'));
  if(!u.searchParams.has('lat')||!u.searchParams.has('lon')||!winterPointInBounds(lat,lon)||!finite(start)||!finite(end)||start%3600000||end%3600000||end<=start||end-start>26*3600000)return null;
  const segments=JSON.parse(u.searchParams.get('segments')||'null');
  if(!Array.isArray(segments)||!segments.length||segments.length>2)return null;
  let through=start;
  for(const s of segments){const a=Date.parse(s.start),b=Date.parse(s.end);if(a!==through||!finite(b)||a%3600000||b%3600000||b<=a||b>end||!Array.isArray(s.models)||!s.models.length||s.models.length>2||new Set(s.models).size!==s.models.length||s.models.some(id=>!['ecmwf','gfs','hrrr','nam'].includes(id)))return null;through=b;}
  if(through!==end)return null;
  return u.pathname+'?'+new URLSearchParams({kind:'model-grid',lat:String(lat),lon:String(lon),start:new Date(start).toISOString(),end:new Date(end).toISOString(),segments:JSON.stringify(segments.map(s=>({start:new Date(s.start).toISOString(),end:new Date(s.end).toISOString(),models:s.models})))});
 }catch{return null;}
}
export function winterAmountText(value,range){
 if(Array.isArray(range)&&finite(range[0])&&range[0]>=0){
  if(finite(range[1])&&range[1]>range[0]){
   if(range[0]===0&&range[1]<=.1)return '<0.1″';
   return `${(Math.floor(range[0]*10)/10).toFixed(1)}–${(Math.ceil(range[1]*10)/10).toFixed(1)}″`;
  }
  if(range[1]===null)return `${inch(value)}+`;
 }
 return inch(value);
}
export function winterDayAmount(r){
 const a=r?.displaySnowfall;
 if(a)return {value:finite(a.value)&&a.value>=0?a.value:null,range:a.range||null,source:a.source||'',remainingDay:!!a.remainingDay,start:a.start,end:a.end,status:a.status};
 // Older cached responses do not expose a correctly clipped NWS daily total.
 // Only a complete, explicitly same-period model amount is a usable fallback.
 return {value:finite(r?.best)&&r.best>=0?r.best:null,range:null,source:r?.amountSource||'Forecast guidance',start:r?.amountWindow?.start,end:r?.amountWindow?.end};
}
export function winterSnowMapForDay(s,r){
 const period=r?.amountWindow||r?.displaySnowfall,from=Date.parse(period?.start),to=Date.parse(period?.end);
 if(!finite(from)||!finite(to)||to<=from)return null;
 const modelMap=(s?.maps||[]).find(d=>d.source==='model-grid'&&d.quantity==='snowfall'&&d.kind==='geojson'&&Date.parse(d.start)===from&&Date.parse(d.end)===to);
 if(modelMap)return modelMap;
 const events=(r.snowEventWindows||[]).map(w=>({start:Math.max(from,Date.parse(w.start)),end:Math.min(to,Date.parse(w.end))})).filter(w=>finite(w.start)&&finite(w.end)&&w.end>w.start);
 const eventMiddle=events.length?(Math.min(...events.map(w=>w.start))+Math.max(...events.map(w=>w.end)))/2:(from+to)/2;
 const rows=(s?.maps||[]).filter(d=>d.quantity==='snowfall'&&['geojson','official-image','image'].includes(d.kind)).map(d=>{
  const start=Date.parse(d.start),end=Date.parse(d.end),dayOverlap=Math.max(0,Math.min(to,end)-Math.max(from,start));
  const overlap=events.length?events.reduce((sum,w)=>sum+Math.max(0,Math.min(w.end,end)-Math.max(w.start,start)),0):dayOverlap;
  return {d,start,overlap,dayOverlap,distance:Math.abs((start+end)/2-eventMiddle),duration:end-start};
 }).filter(r=>finite(r.overlap)&&r.overlap>0&&r.duration>0);
 // A map without overlap is a different forecast, not a default for this day.
 rows.sort((a,b)=>b.overlap-a.overlap||a.distance-b.distance||b.dayOverlap-a.dayOverlap||a.duration-b.duration||b.start-a.start);
 return rows[0]?.d||null;
}
export function winterPointAmount(s,d={}){
 const windows=(s?.blendWindows||[]).map((w,index)=>({w,index})).filter(({w})=>finite(Date.parse(w.start))&&finite(Date.parse(w.end))&&Date.parse(w.end)>Date.parse(w.start));
 const exact=windows.find(({w})=>Date.parse(w.start)===Date.parse(d.windowStart)&&Date.parse(w.end)===Date.parse(d.windowEnd));
 const indexed=windows.find(row=>row.index===d.windowIndex);
 const target=Date.parse(d.windowStart),closest=finite(target)?windows.reduce((best,row)=>!best||Math.abs(Date.parse(row.w.start)-target)<Math.abs(Date.parse(best.w.start)-target)?row:best,null):null;
 const chosen=exact||indexed||closest||windows[0];
 if(!chosen)return {value:null,status:'unavailable',coverage:0,start:null,end:null,aligned:false};
 const b=chosen.w.snowfall||{};
 return {value:finite(b.value)&&b.value>=0?b.value:null,status:b.status||'unavailable',coverage:finite(b.coverage)?b.coverage:null,start:chosen.w.start,end:chosen.w.end,aligned:!!exact,windowIndex:chosen.index,weights:b.weights,actualWeights:b.actualWeights,range:b.range,precision:b.precision};
}
export function winterPointInBounds(lat,lon){return finite(lat)&&finite(lon)&&lat>=24&&lat<=50&&lon>=-125&&lon<=-66;}
export function winterPointPopupHTML(amount,place,zone='America/New_York'){
 return `<strong>${esc(place||'Local forecast point')}</strong><p class="winter-point-amount">${esc(winterAmountText(amount?.value,amount?.range))} snowfall</p>${amount?.start&&amount?.end?`<p>${esc(stamp(amount.start,zone))}–${esc(stamp(amount.end,zone))}</p>`:'<p>Forecast period unavailable.</p>'}<p>${finite(amount?.coverage)?`${Math.round(amount.coverage)}% of requested amount weight available. `:''}${amount?.status==='partial'?'Partial blend.':amount?.status==='unavailable'?'Compatible snowfall amounts unavailable.':''}</p>${amount?.actualWeights?`<p>${esc(weightsText(amount.actualWeights))}</p>`:''}${amount?.precision?`<p>${esc(amount.precision)}</p>`:''}<small>Local forecast point; this map is not a continuous snow grid. The times above belong to this point’s returned forecast.</small>`;
}
export function snowBannerSummary(s){
 const snowRows=winterSnowDays(s);
 const rows=snowRows.length?snowRows:(s?.days||[]).filter(dayActive);
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
 return `<p class="winter-weights">Requested: ${esc(weightsText(b?.weights))}</p><p class="winter-coverage">${finite(b?.coverage)?`${Math.round(b.coverage)}% of requested weight has compatible data. `:''}${all?'All requested sources available.':missing?'No requested source has compatible accumulation data.':'Partial blend: only compatible available sources contribute.'}</p>${!all&&!missing&&b?.actualWeights?`<p class="winter-weights">Contributing weights: ${esc(weightsText(b.actualWeights))}</p>`:''}${b?.precision?`<p class="winter-coverage">${esc(b.precision)}</p>`:''}`;
}
function winterTechnicalHTML(s,zone){
 const days=(s.days||[]).filter(dayActive).map(r=>`<article class="winter-day"><h3>${esc(dayName(r))}<small>${esc(r.date)}</small></h3><div class="winter-type-grid">${[['snow','Snow'],['freezingRain','Freezing rain'],['sleet','Sleet']].map(([key,label])=>`<div><span>${label}</span><strong>${signal(r,key)}</strong></div>`).join('')}</div>${probabilitySourceHTML(r,zone)}<p class="winter-amount">Snow amount <strong>${Array.isArray(r.range)&&r.range.length===2&&r.range.every(finite)?`${r.range[0]}–${r.range[1]}″`:esc(inch(r.best))}</strong></p><p class="winter-coverage">Local calendar-day guidance; WPC uses the separate 24-hour periods below.</p>${r.periods?.length?`<p>${r.periods.map(p=>`${esc(p.name)}: ${esc(p.wording)}`).join(' · ')}</p>`:''}${r.blend?sourceHTML(r.blend):''}</article>`).join('');
 const windows=(s.blendWindows||[]).map(w=>{
  const b=w.snowfall||w,raw=b.sources||w.sources;
  const sources=Array.isArray(raw)?raw:Object.entries(raw||{}).map(([id,s])=>({id,...(typeof s==='object'?s:{value:s})}));
  return `<article class="winter-window"><h3>${esc(windowTitle(w))} <strong>${esc(winterAmountText(b.value,b.range))}</strong></h3><p>${esc(stamp(w.start,zone))}–${esc(stamp(w.end,zone))}</p>${sourceHTML({...w,...b})}<ul class="winter-source-list">${sources.map(v=>`<li><span>${esc(v.label||labels[v.id]||v.id)}</span><strong>${esc(winterAmountText(v.value,v.range))}</strong><small>${esc(v.message||v.reason||v.status||'')}</small></li>`).join('')}</ul></article>`;
 }).join('');
 const probs=(s.days||[]).flatMap(r=>r.wpc||[]).filter(p=>p.start&&p.end);
 const probability=probs.length?`<section class="winter-probabilities"><h3>WPC snowfall & ice probabilities</h3><p>Chances of exceeding the stated accumulation, separate from the chance of any snow or ice.</p><ul>${probs.map(p=>`<li><strong>${p.kind==='ice'?'Ice':'Snow'} ${p.kind==='ice'?'over':'at least'} ${esc(p.inches)}″: ${esc(p.probabilityRange?`${p.probabilityRange[0]}–${p.probabilityRange[1]}%`:p.category||'Unavailable')}</strong><span>${esc(stamp(p.start,zone))}–${esc(stamp(p.end,zone))}</span></li>`).join('')}</ul></section>`:'';
 return `${s.wssi?`<p class="winter-impact">${esc(s.wssi.title||'WPC winter storm impacts may be possible.')}</p>`:''}${days}<section class="winter-blends"><h3>Snow accumulation blend</h3><p>First 24 hours: WPC 60% · HRRR 25% · NAM 15%. Beyond 24 hours: WPC 60% · ECMWF 20% · Google WeatherNext 10% · GFS 10%.</p>${windows}</section>${probability}${winterMapDescriptors(s).length?'<button type="button" class="winter-secondary-button" data-winter-maps>Explore winter precipitation maps</button>':''}<p class="aqi-source">${esc(s.notes||'Official NWS wording is separate from deterministic snowfall. A model snow forecast does not establish a snow-only probability.')}</p>`;
}
function mapPanelHTML(d,{technical=false,maps=[]}={}){
 if(!d)return '<p class="winter-map-unavailable">An official snow totals map is not available for this date.</p>';
 return `<section class="winter-map-panel"><h3>${technical?'Winter precipitation maps':'Snow totals map'}</h3>${technical?`<label for="winter-map-select">Map layer</label><select id="winter-map-select">${maps.map(m=>`<option value="${esc(m.id)}"${m.id===d.id?' selected':''}>${esc(m.label)}</option>`).join('')}</select>`:''}<div id="winter-map" data-map-id="${esc(d.id)}" class="winter-map" role="region" aria-label="${technical?'Winter precipitation forecast map':d.source==='model-grid'?'Forecast snowfall totals map':'Official snowfall totals map'}" aria-describedby="winter-map-status winter-map-legend" tabindex="0"></div><div id="winter-map-legend" class="winter-map-legend"></div><p id="winter-map-status" role="status"></p><a id="winter-map-source" href="${esc(safeWinterMapUrl(d.sourceUrl)||officialWinterUrl)}" target="_blank" rel="noopener noreferrer">${d.source==='model-grid'?'Model forecast data':technical?'Open official map':'WPC snowfall map'} ↗</a></section>`;
}
export function snowDetailHTML(s,place,zone='America/New_York',selectedDate){
 const head=`<div class="dialog-eyebrow" data-winter-outlook>${esc(place||'Your location')}</div><h2 id="forecast-window-title">Snow forecast</h2>`;
 if(!s)return head+`<p role="status">${place?'Winter forecast unavailable. We cannot confirm whether snow is expected.':'Choose a location first to check the winter forecast.'}</p>`;
 const rows=winterSnowDays(s),selected=rows.find(r=>r.date===selectedDate)||rows[0];
 const technical=active(s)?`<details class="winter-more"><summary>More winter details</summary><div class="winter-more-content">${winterTechnicalHTML(s,zone)}</div></details>`:'';
 if(!selected)return head+`<p class="winter-empty" role="status">${winterOutlookState(s)==='unavailable'?'Winter forecast unavailable. We cannot confirm whether snow is expected.':'No snow in the forecast.'}</p>${winterOutlookState(s)!=='unavailable'&&(s.status==='partial'||s.coverageStatus==='partial')?'<p class="winter-limited">Coverage is limited.</p>':''}${technical}`;
 const amount=winterDayAmount(selected),descriptor=winterSnowMapForDay(s,selected);
 const shortDate=r=>{
  const time=Date.parse(r.date+'T12:00:00Z');if(!finite(time))return 'Date unavailable';
  try{return new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric'}).format(new Date(time));}
  catch{return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(time));}
 };
 const controls=rows.length>1?`<div class="winter-snow-days" role="group" aria-label="Days with snow in the forecast">${rows.map(r=>`<button type="button" data-snow-date="${esc(r.date)}" aria-pressed="${r===selected}"><span>${esc(dayName(r))}</span><small>${esc(shortDate(r))}</small></button>`).join('')}</div>`:'';
 const events=(selected.snowEventWindows||[]).filter(w=>finite(Date.parse(w.start))&&finite(Date.parse(w.end)));
 const wording=events.length?`Snow possible ${stamp(events[0].start,zone)}–${stamp(events.at(-1).end,zone)}`:'';
 const estimated=amount.status==='partial'&&finite(amount.value)&&amount.value>0&&!amount.range;
 const source=amount.source==='Available model guidance'?'Model estimate':amount.source;
 return head+`<div class="winter-primary">${controls}<article class="winter-snow-summary" data-snow-day="${esc(selected.date)}"><h3>${esc(dayName(selected))}<small>${esc(shortDate(selected))}</small></h3><p class="winter-snow-amount"><strong>${estimated?'About ':''}${esc(winterAmountText(amount.value,amount.range))}</strong><span>of snow${amount.remainingDay?' for the rest of today':''}</span></p>${wording?`<p class="winter-snow-wording">${esc(wording)}</p>`:''}<p class="winter-snow-source">${finite(amount.value)?esc(source||'Forecast guidance'):'Snowfall amount is not available yet.'}</p></article>${mapPanelHTML(descriptor)}</div>${technical}`;
}
export function winterMapsHTML(s,place){
 const maps=winterMapDescriptors(s),selected=maps.find(d=>d.id===selectedLayerId)||maps[0];
 return `<div class="dialog-eyebrow" data-winter-outlook>${esc(place||'Your location')}</div><h2 id="forecast-window-title">Winter precipitation maps</h2><button type="button" class="winter-secondary-button" data-winter-back>← Back to snow forecast</button>${mapPanelHTML(selected,{technical:true,maps})}`;
}
function clearPointLayer(){
 areaRequest?.abort();areaRequest=null;
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
 map=L.map('winter-map',{scrollWheelZoom:false,preferCanvas:true}).setView([finite(lat)?lat:39,finite(lon)?lon:-96],finite(lat)?6:4);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',maxZoom:10}).addTo(map);
 const day=(latest?.snow?.days||[]).find(r=>r.date===selectedSnowDate),amount=winterDayAmount(day),name=latest?.location?.name||'Your location';
 const pointText=snowView==='forecast'&&finite(amount.value)?`${name} · ${winterAmountText(amount.value,amount.range)}`:name;
 if(finite(lat)&&finite(lon))L.circleMarker([lat,lon],{pane:'markerPane',radius:5,color:'#fff',fillColor:'#87ccff',fillOpacity:1}).addTo(map).bindTooltip(esc(pointText),{permanent:true,direction:'top'}).bindPopup(esc(pointText));
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
 status.textContent=`${name}: ${winterAmountText(amount.value,amount.range)} snowfall · ${period}${finite(amount.coverage)?` · ${Math.round(amount.coverage)}% of requested weight available`:''}. Click a point in the contiguous U.S. to check its forecast. These markers are not a continuous snow grid.`;
 if(map&&pointLayer&&finite(lat)&&finite(lon)){
  const L=window.L,color=finite(amount.value)?'#c4e6ff':'#9bacc4';
  const key=`${lat.toFixed(3)},${lon.toFixed(3)}`,text=finite(amount.value)?winterAmountText(amount.value,amount.range):'Unavailable',html=winterPointPopupHTML(amount,name,zone),existing=pointMarkers.get(key);
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
function renderWinterLegend(rows,node){
 node.innerHTML=(rows||[]).map(l=>`<span>${/^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i.test(l.image||'')?`<img src="${esc(l.image)}" alt="" aria-hidden="true">`:/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(l.color||'')?`<i style="background:${l.color}"></i>`:''}${esc(l.label)}</span>`).join('');
}
async function loadWinterArea(d,status,legend){
 const url=winterAreaDataUrl(d.url);if(!url){status.textContent='The snow totals map is unavailable. Open the official source below.';return;}
 const controller=new AbortController();areaRequest=controller;const deadline=setTimeout(()=>controller.abort(),30000),original=status.textContent;
 status.textContent=original+' Loading snowfall forecast…';
 try{
  const cached=areaCache.get(url);let geo=cached&&Date.now()-cached.at<5*60000?cached.geo:null;
  if(!geo){const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/geo+json,application/json'}});if(!response.ok)throw new Error('Winter area map unavailable');geo=await response.json();}
  if(geo.type!=='FeatureCollection'||!Array.isArray(geo.features)||geo.features.length>20000||geo.metadata?.quantity!=='snowfall'||geo.metadata?.unit!=='in'||Date.parse(geo.metadata.start)!==Date.parse(d.start)||Date.parse(geo.metadata.end)!==Date.parse(d.end)||geo.features.some(f=>f?.type!=='Feature'||f.geometry?.type!=='Polygon'||!finite(f.properties?.value)||f.properties.value<0))throw new Error('Unexpected snowfall map data');
  if(areaRequest!==controller||controller.signal.aborted||selectedLayerId!==d.id||!map)return;
  areaCache.set(url,{geo,at:Date.now()});if(areaCache.size>3)areaCache.delete(areaCache.keys().next().value);
  const zone=latest?.location?.timeZone,L=window.L;
  const modelGrid=d.source==='model-grid',title=modelGrid?'Forecast snowfall':'WPC expected snowfall';
  const modelLabel=(geo.metadata.models||[]).map(m=>m.label||labels[m.id]||m.id).join(' / ')||'Regional model forecast';
  overlay=L.geoJSON(geo,{style:f=>({color:/^#[0-9a-f]{6}$/i.test(f.properties.color||'')?f.properties.color:'#d3e9f7',weight:0,fillColor:/^#[0-9a-f]{6}$/i.test(f.properties.color||'')?f.properties.color:'#d3e9f7',fillOpacity:finite(f.properties.opacity)?Math.max(.2,Math.min(.85,f.properties.opacity)):.5}),onEachFeature:(feature,layer)=>layer.bindPopup(`<strong>${title}</strong><p>${esc(inch(feature.properties.value))}${modelGrid?' of snow':' contour · conservative lower bound'}</p><p>${esc(stamp(geo.metadata.start,zone))}–${esc(stamp(geo.metadata.end,zone))}</p><small>${modelGrid?esc(modelLabel):'Official deterministic snowfall depth in inches. Actual amounts vary within the published contour band.'}</small>`)}).addTo(map);
  renderWinterLegend(geo.metadata.legend,legend);
  status.textContent=`Map period: ${stamp(geo.metadata.start,zone)}–${stamp(geo.metadata.end,zone)} · inches of snow.${modelGrid?` ${modelLabel}.`:''}${snowView==='maps'?` ${geo.metadata.precision||''}`:''}${geo.features.length?'':modelGrid?' No measurable snowfall is shown by this model map.':' No measurable snowfall contour is published in this product.'}`;
 }catch{if(areaRequest===controller&&selectedLayerId===d.id)status.textContent=original+' The expected snow map could not load. Use the official source below; missing map data is not a zero snow forecast.';}
 finally{clearTimeout(deadline);if(areaRequest===controller)areaRequest=null;}
}
function selectLayer(id){
 const d=winterMapDescriptors(latest?.snow).find(m=>m.id===id);if(!d)return;
 clearPointLayer();selectedLayerId=id;
 if(overlay)map.removeLayer(overlay);overlay=null;
 const status=document.getElementById('winter-map-status'),legend=document.getElementById('winter-map-legend');
 document.getElementById('winter-map-source').href=safeWinterMapUrl(d.sourceUrl)||officialWinterUrl;
 status.textContent=(d.start&&d.end?`Map period: ${stamp(d.start,latest?.location?.timeZone)}–${stamp(d.end,latest?.location?.timeZone)} · ${snowView==='forecast'?'inches of snow':d.unit||''}. `:'')+(snowView==='maps'?(d.description||'Official guidance; check issue and valid times on the source.'):'');
 renderWinterLegend(d.legend,legend);
 if(d.kind==='geojson'&&d.quantity==='snowfall'){if(ensureInteractiveMap())void loadWinterArea(d,status,legend);return;}
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
 const select=document.getElementById('winter-map-select');if(select&&!select.dataset.winterBound){select.dataset.winterBound='true';select.addEventListener('change',()=>selectLayer(select.value));}selectLayer(select?.value||document.getElementById('winter-map').dataset.mapId);
}
function renderSnowView(){
 const content=document.getElementById('forecast-window-content');if(!content)return;
 disposeMap();
 const rows=winterSnowDays(latest?.snow);if(!rows.some(r=>r.date===selectedSnowDate))selectedSnowDate=rows[0]?.date||null;
 content.innerHTML=snowView==='maps'?winterMapsHTML(latest?.snow,latest?.location?.name):snowDetailHTML(latest?.snow,latest?.location?.name,latest?.location?.timeZone,selectedSnowDate);
 initializeMap();
}
export function openSnowOutlook(){
 const dialog=document.getElementById('forecast-window-dialog'),content=document.getElementById('forecast-window-content');if(!dialog||!content)return;
 opened=true;snowView='forecast';dialog.classList.add('winter-dialog');
 renderSnowView();if(!dialog.open)dialog.showModal();document.body.classList.add('dialog-open');document.getElementById('open-snow')?.setAttribute('aria-expanded','true');requestAnimationFrame(()=>map?.invalidateSize());
}
function install(){
 if(initialized||typeof document==='undefined')return;initialized=true;
 document.getElementById('open-snow')?.addEventListener('click',openSnowOutlook);
 document.getElementById('close-forecast-window')?.addEventListener('click',()=>document.getElementById('forecast-window-dialog')?.close());
 document.getElementById('forecast-window-dialog')?.addEventListener('close',()=>{releaseSnowView();if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');});
 const content=document.getElementById('forecast-window-content');
 content?.addEventListener('click',event=>{
  if(!opened||!content.querySelector('[data-winter-outlook]'))return;
  const day=event.target.closest('[data-snow-date]');
  if(day&&winterSnowDays(latest?.snow).some(r=>r.date===day.dataset.snowDate)){
   selectedSnowDate=day.dataset.snowDate;snowView='forecast';renderSnowView();content.querySelector('[data-snow-date][aria-pressed="true"]')?.focus({preventScroll:true});return;
  }
  if(event.target.closest('[data-winter-maps]')){snowView='maps';renderSnowView();content.querySelector('[data-winter-back]')?.focus({preventScroll:true});return;}
  if(event.target.closest('[data-winter-back]')){snowView='forecast';renderSnowView();content.querySelector('.winter-more summary')?.focus({preventScroll:true});}
 });
 if(content&&typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(opened&&!content.querySelector('[data-winter-outlook]'))releaseSnowView();}).observe(content,{childList:true});
 window.addEventListener('weather-map-library-ready',initializeMap);
 const link=document.createElement('link');link.rel='stylesheet';link.href='/weather-fusion/winter-outlook.css?v=snow-simple-v5';document.head.append(link);
}
export function renderSnowOutlook(data){
 latest=data;install();let root=document.getElementById('snow-outlook-banner');
 if(!root){const anchor=document.getElementById('forecast-window-banners');if(!anchor)return;root=document.createElement('section');root.id='snow-outlook-banner';root.className='forecast-window-banners snow-outlook-banners';root.setAttribute('aria-label','Winter weather outlook');anchor.after(root);}
 root.hidden=!snowForecastPresent(data?.snow);root.innerHTML='';
 if(!root.hidden){root.innerHTML=`<button type="button" class="glass forecast-window-banner forecast-window-snow" data-snow-outlook aria-haspopup="dialog" aria-controls="forecast-window-dialog"><span class="forecast-window-icon" aria-hidden="true">❄</span><span class="forecast-window-copy"><strong>Snow & winter weather</strong><span>${esc(snowBannerSummary(data.snow))}</span></span><span class="forecast-window-action">View forecast <b aria-hidden="true">›</b></span></button>`;root.querySelector('[data-snow-outlook]').addEventListener('click',openSnowOutlook);}
 if(opened&&document.querySelector('#forecast-window-content [data-winter-outlook]'))renderSnowView();else if(opened)releaseSnowView();
}
export function resetSnowOutlook(){
 latest=null;
 selectedSnowDate=null;snowView='forecast';
 pointCache.clear();
 areaCache.clear();
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

