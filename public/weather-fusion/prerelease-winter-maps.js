/** Official forecast maps loaded only after the user opens winter details. */
export const WINTER_MAP_SOURCES=Object.freeze({
  snow:'https://mapservices.weather.noaa.gov/geoserver/ndfd/snow/ows',
  qpf:'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer',
  probability:'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_prob_winter_precip/MapServer',
});
const HOUR=3600000;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=value=>{
  if(typeof value!=='string')return NaN;
  const iso=value.trim().replace(' ','T');return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(iso)?iso:iso+'Z');
};
const clock=(time,zone)=>new Intl.DateTimeFormat('en-US',{timeZone:zone||'America/New_York',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(time));

export function parseSnowMapTimes(xml,now=Date.now()){
  const match=String(xml).match(/<(?:\w+:)?(?:Dimension|Extent)\b[^>]*\bname=["']time["'][^>]*>([\s\S]*?)<\/(?:\w+:)?(?:Dimension|Extent)>/i);
  if(!match)return [];
  const times=[];
  for(const item of match[1].trim().split(',')){
    const parts=item.trim().split('/');
    if(parts.length===1)times.push(stamp(parts[0]));
    else if(parts.length===3&&/^PT6H$/i.test(parts[2])){
      const start=stamp(parts[0]),end=stamp(parts[1]);
      if(finite(start)&&finite(end)&&end>=start&&end-start<=14*24*HOUR)for(let value=start;value<=end;value+=6*HOUR)times.push(value);
    }
  }
  // The service advertises a historical default. Never use it. Every request
  // carries a verified future time explicitly, within the 72-hour snow horizon.
  return [...new Set(times.filter(time=>finite(time)&&time>now&&time<=now+78*HOUR))].sort((a,b)=>a-b).map(time=>new Date(time).toISOString());
}

export function validateWpcMapPeriod(features,now=Date.now()){
  const periods=(Array.isArray(features)?features:[]).map(feature=>{
    const a=feature.attributes||{},start=stamp(a.start_time),end=stamp(a.end_time),issued=stamp(a.issue_time);
    return {start,end,issued};
  });
  if(!periods.length)return null;
  const first=periods[0];
  if(!periods.every(period=>Object.values(period).every(finite)&&period.end>period.start&&period.end>now&&period.start<=now+36*HOUR&&period.issued<=now+5*60000&&now-period.issued<=36*HOUR&&period.start===first.start&&period.end===first.end&&period.issued===first.issued))return null;
  return first;
}

async function read(url,asText=false){
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!response.ok)throw new Error('Official map source unavailable.');
  return asText?response.text():response.json();
}
function addBase(map,L,status,isCurrent){
  L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',{maxZoom:12,attribution:'Background: USGS The National Map'}).addTo(map).on('tileerror',()=>{if(isCurrent())status.textContent+=' · Background map unavailable.';});
}
function setupMap({data,canvas,setMap,status,isCurrent}){
  const L=window.L,location=data?.location;
  if(!L||!finite(location?.latitude)||!finite(location?.longitude))throw new Error('Choose a forecast location and retry the map.');
  canvas.hidden=false;
  const map=L.map(canvas,{scrollWheelZoom:false,zoomControl:true,fadeAnimation:!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches}).setView([location.latitude,location.longitude],6);
  setMap(map);addBase(map,L,status,isCurrent);
  L.circleMarker([location.latitude,location.longitude],{radius:6,color:'#12263a',weight:2,fillColor:'#fff',fillOpacity:1}).addTo(map).bindTooltip('Selected forecast location');
  requestAnimationFrame(()=>{if(isCurrent())map.invalidateSize();});
  return {map,L};
}

export async function loadOfficialWinterMap(options){
  const {kind,data,canvas,status,legend,source,isCurrent}=options,now=Date.now(),zone=data?.location?.timeZone;
  if(!Object.hasOwn(WINTER_MAP_SOURCES,kind))throw new Error('Unknown winter map.');
  if(kind==='snow'){
    source.href='https://digital.weather.gov/';source.textContent='Open NWS digital forecast ↗';
    const url=WINTER_MAP_SOURCES.snow;
    const xml=await read(`${url}?service=WMS&version=1.3.0&request=GetCapabilities`,true);
    const times=parseSnowMapTimes(xml,now);if(!times.length)throw new Error('No current NDFD snow map periods.');
    if(!isCurrent())return;
    const {map,L}=setupMap(options);
    let layer=null,failed=false;
    legend.innerHTML=`<label for="winter-snow-period">Snow accumulation period</label><select id="winter-snow-period">${times.map(time=>`<option value="${esc(time)}">${esc(clock(time,zone))}</option>`).join('')}</select><p>6-hour snowfall amount · inches. Each map is one interval, not the entire storm. Issue time is not supplied by this map service.</p><img class="winter-legend-image" src="${url}?service=WMS&amp;request=GetLegendGraphic&amp;version=1.3.0&amp;format=image/png&amp;layer=snow&amp;style=nws_snow_accum" alt="Official NDFD snowfall color scale in inches">`;
    const choose=time=>{
      if(layer)map.removeLayer(layer);failed=false;
      const end=Date.parse(time),period=`NWS 6-hour snow amount · ${clock(end-6*HOUR,zone)} to ${clock(end,zone)}`;
      status.textContent=period+' · Retrieved '+clock(now,zone)+' · Loading';
      const active=L.tileLayer.wms(url,{layers:'snow',styles:'nws_snow_accum',format:'image/png',transparent:true,version:'1.3.0',time,opacity:.85,attribution:'Snow forecast: NOAA / NWS NDFD'}).addTo(map);
      layer=active;
      active.on('tileerror',()=>{failed=true;if(isCurrent()&&layer===active)status.textContent=period+' · Some snow tiles are unavailable. Blank areas are not a no-snow forecast.';});
      active.on('load',()=>{if(isCurrent()&&layer===active&&!failed)status.textContent=period+' · Retrieved '+clock(now,zone);});
    };
    choose(times[0]);legend.querySelector('select').addEventListener('change',event=>choose(event.target.value));
    return;
  }
  const root=WINTER_MAP_SOURCES[kind], layer=kind==='qpf'?9:1;
  source.href=kind==='qpf'?'https://www.wpc.ncep.noaa.gov/qpf/day1-3.shtml':'https://www.wpc.ncep.noaa.gov/pwpf/wwd_prob_guidance.php';
  source.textContent=kind==='qpf'?'Open official WPC precipitation forecast ↗':'Open official WPC winter guidance ↗';
  const fields='issue_time,start_time,end_time';
  const query=new URLSearchParams({f:'json',where:'1=1',outFields:fields,returnGeometry:'false',resultRecordCount:'1000'});
  const response=await read(`${root}/${layer}/query?${query}`);
  if(response.error||response.exceededTransferLimit)throw new Error('Unverified map coverage.');
  const period=validateWpcMapPeriod(response.features,now);
  if(!period)throw new Error('This map has no verified current issue and valid period.');
  const legendData=await read(`${root}/legend?f=json`);
  const legendLayer=legendData.layers?.find(row=>row.layerId===layer);
  if(!isCurrent())return;
  const {map,L}=setupMap(options);
  const title=kind==='qpf'?'WPC 72-hour expected precipitation · liquid equivalent (inches)':'WPC 24-hour probability of at least 4 inches of snow';
  const description=`${title}. Valid ${clock(period.start,zone)} to ${clock(period.end,zone)}. Issued ${clock(period.issued,zone)}.`;
  status.textContent=description+' Loading';
  legend.innerHTML=`<p>${kind==='qpf'?'Liquid equivalent includes rain and melted snow/ice. It is not snowfall depth.':'Threshold categories: Slight 10–39%, Moderate 40–69%, High 70–100%. These are not exact chances or a probability of any snow.'}</p><div class="winter-legend-items">${(legendLayer?.legend||[]).filter(item=>item.contentType==='image/png'&&/^[A-Za-z0-9+/=]+$/.test(item.imageData||'')).map(item=>`<span><img src="data:image/png;base64,${item.imageData}" alt=""><small>${esc(item.label)}</small></span>`).join('')}</div>`;
  let overlay=null,sequence=0;
  const draw=()=>{
    const current=++sequence;
    if(overlay){map.removeLayer(overlay);overlay=null;}
    const bounds=map.getBounds(),size=map.getSize();
    const params=new URLSearchParams({f:'image',bbox:[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()].join(','),bboxSR:'4326',imageSR:'3857',size:`${Math.round(size.x)},${Math.round(size.y)}`,dpi:'96',format:'png32',transparent:'true',layers:`show:${layer}`});
    const active=L.imageOverlay(`${root}/export?${params}`,bounds,{opacity:.85,attribution:'Forecast: NOAA / NWS WPC'}).addTo(map);overlay=active;
    active.on('load',()=>{if(isCurrent()&&current===sequence)status.textContent=description;});
    active.on('error',()=>{if(isCurrent()&&current===sequence){status.textContent=description+' Map image unavailable; blank areas do not establish no precipitation.';map.removeLayer(active);}});
  };
  map.on('moveend',draw);draw();
}
