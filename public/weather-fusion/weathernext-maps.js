/* Google WeatherNext forecast maps for the WeatherNext page.
 *
 * Every frame comes from /api/weather-fusion/weathernext-maps, which validates a
 * catalog built only from published WeatherNext ensemble-mean values. If frames are
 * missing or old this panel says so; it never substitutes another model's map.
 */
import {createFramePlayer} from '/weather-fusion/frame-player.js';

const API='/api/weather-fusion/weathernext-maps';
const LAB_URL='https://deepmind.google.com/science/weatherlab';
const DOCS_URL='https://developers.google.com/weathernext';
const BOUNDS=[[20,-130],[55,-60]];
const ORDER=['temperature','dewpoint','wind','precipitation','clouds','pressure','solar'];
const SHORT={temperature:'Temperature',dewpoint:'Dew point',wind:'Wind',precipitation:'Rain',clouds:'Clouds',pressure:'Pressure',solar:'Sunlight'};
const REFRESH_MS=10*60*1000;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Frame closest to `now`, preferring the one already valid when two are equally close. */
export function initialFrameIndex(frames,now=Date.now()){
  let best=0,distance=Infinity;
  frames.forEach((f,i)=>{const d=Math.abs(Date.parse(f.time)-now);if(d<distance||(d===distance&&Date.parse(f.time)<=now)){best=i;distance=d;}});
  return best;
}
const trim=v=>Number.isInteger(v)?String(v):String(Math.round(v*1000)/1000);
/** Swatch labels: "<20", "20–32", … "105+". Colors are the catalog's own. */
export function legendSegments(legend){
  const t=legend?.thresholds||[],c=legend?.colors||[];
  if(!t.length||c.length!==t.length+1)return [];
  return c.map((color,i)=>({color,label:i===0?`<${trim(t[0])}`:i===t.length?`${trim(t[t.length-1])}+`:`${trim(t[i-1])}–${trim(t[i])}`}));
}
export function frameLabel(frame,timeZone='America/New_York'){
  if(!frame||!Number.isFinite(Date.parse(frame.time)))return 'Time unavailable';
  const text=new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',hour:'numeric',timeZoneName:'short'}).format(new Date(frame.time));
  return `${text} · +${frame.hour}h`;
}
export function runLabel(runAt,timeZone='America/New_York'){
  if(!Number.isFinite(Date.parse(runAt)))return 'unknown run';
  return new Intl.DateTimeFormat('en-US',{timeZone,month:'short',day:'numeric',hour:'numeric',timeZoneName:'short'}).format(new Date(runAt));
}
function leafletReady(timeout=20000){
  return new Promise(resolve=>{
    if(window.L)return resolve(window.L);
    let timer,limit;
    const done=()=>{clearInterval(timer);clearTimeout(limit);window.removeEventListener('weather-map-library-ready',done);resolve(window.L||null);};
    window.addEventListener('weather-map-library-ready',done);
    timer=setInterval(()=>{if(window.L)done();},250);
    limit=setTimeout(done,timeout);
  });
}
function ensureStylesheet(){
  if(document.querySelector('link[data-wn-maps-css]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='/weather-fusion/weathernext-maps.css?v=wn-maps-v1';link.dataset.wnMapsCss='1';document.head.append(link);
}

export function installWeatherNextMaps(panel,place={}){
  if(!panel)return null;
  if(panel.__wnMaps){panel.__wnMaps.update(place);return panel.__wnMaps;}
  ensureStylesheet();
  const root=document.createElement('div');root.className='wn-maps';
  root.innerHTML=`<div class="section-top"><h2>◎ &nbsp; WEATHERNEXT FORECAST MAPS</h2><button id="wn-expand" class="text-button" type="button" aria-label="Expand WeatherNext map" aria-pressed="false">⛶ Expand</button></div>
<div id="wn-body" hidden>
<div id="wn-tabs" class="map-tabs wn-tabs" role="group" aria-label="WeatherNext map layer"></div>
<div class="map-stage wn-stage"><div id="wn-map" role="region" aria-label="Interactive WeatherNext forecast map" tabindex="-1"></div><div id="wn-message" class="map-error wn-message" role="status" hidden></div></div>
<div class="radar-controls wn-controls"><button id="wn-play" class="play-button" type="button" aria-label="Play WeatherNext map animation" disabled>▶</button><label for="wn-time" class="sr-only">Forecast hour</label><input id="wn-time" type="range" min="0" max="0" value="0" disabled><span id="wn-stamp">Loading…</span><button id="wn-us" class="text-button wn-us" type="button" aria-label="Show the whole United States">U.S.</button><label class="sr-only" for="wn-basemap">Base map</label><select id="wn-basemap"><option value="dark">Dark</option><option value="street">Topographic</option><option value="satellite">Aerial imagery</option></select></div>
<div id="wn-legend" class="radar-legend wn-legend" role="img"></div>
<div class="map-caption wn-caption"><span id="wn-caption"></span><span><a href="${LAB_URL}" target="_blank" rel="noopener noreferrer">Google Weather Lab ↗</a> <a href="${DOCS_URL}" target="_blank" rel="noopener noreferrer">WeatherNext ↗</a></span></div>
</div>
<div id="wn-empty" class="wn-empty" role="status"><strong>Loading WeatherNext forecast maps…</strong></div>`;
  panel.append(root);
  panel.querySelector('.google-unavailable')?.remove();
  const $=id=>root.querySelector('#'+id);
  const state={catalog:null,layer:null,frames:[],index:0,map:null,marker:null,base:null,player:null,timer:null,playing:false,
    place:{...place},L:null,token:0,movedByUser:false,viewKey:''};
  const zone=()=>state.place.timeZone||'America/New_York';

  function message(text=''){const el=$('wn-message');el.textContent=text;el.hidden=!text;}
  function showEmpty(title,text){
    $('wn-body').hidden=true;const el=$('wn-empty');el.hidden=false;
    el.innerHTML=`<strong>${esc(title)}</strong><p>${esc(text)}</p><a href="${LAB_URL}" target="_blank" rel="noopener noreferrer">Open Google Weather Lab ↗</a>`;
  }
  function setBasemap(){
    const {L,map}=state;if(!L||!map)return;
    if(state.base)map.removeLayer(state.base);
    const selected=$('wn-basemap').value,service=selected==='satellite'?'USGSImageryTopo':'USGSTopo';
    const pane=map.getPane('wn-base')||map.createPane('wn-base');pane.style.zIndex='200';
    pane.style.filter=selected==='dark'?'grayscale(1) invert(1) brightness(.7) contrast(.9)':'';
    state.base=L.tileLayer(`https://basemap.nationalmap.gov/arcgis/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`,{pane:'wn-base',maxZoom:16,maxNativeZoom:16,updateWhenIdle:true,
      attribution:'<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener noreferrer">USGS The National Map</a> · background map'}).addTo(map);
    state.base.on('tileerror',()=>message('The USGS background map could not load. The WeatherNext forecast overlay is still shown.'));
  }
  function ensureMap(){
    if(state.map||!state.L)return;
    const L=state.L;
    state.map=L.map($('wn-map'),{zoomControl:true,scrollWheelZoom:false,worldCopyJump:false});
    for(const [name,z] of [['wn-base',200],['wn-overlay',360]]){const pane=state.map.getPane(name)||state.map.createPane(name);pane.style.zIndex=String(z);}
    state.map.getPane('wn-overlay').style.pointerEvents='none';
    state.map.on('dragstart zoomstart',()=>{state.movedByUser=true;});
    state.player=createFramePlayer({map:state.map,makeImage:(url,bounds,options)=>L.imageOverlay(url,bounds,{...options,pane:'wn-overlay',interactive:false,alt:''})});
    setBasemap();
    const p=state.place;
    if(finite(p.latitude)&&finite(p.longitude))state.map.setView([p.latitude,p.longitude],5);else state.map.fitBounds(BOUNDS);
  }
  function placeMarker(){
    const {L,map}=state,p=state.place;if(!L||!map||!finite(p.latitude)||!finite(p.longitude))return;
    if(!state.marker)state.marker=L.marker([p.latitude,p.longitude],{icon:L.divIcon({className:'map-marker',iconSize:[13,13]}),keyboard:false,interactive:false}).addTo(map);
    else state.marker.setLatLng([p.latitude,p.longitude]);
    const key=`${p.latitude.toFixed(2)},${p.longitude.toFixed(2)}`;
    if(key!==state.viewKey&&!state.movedByUser)map.setView([p.latitude,p.longitude],map.getZoom()||5);
    state.viewKey=key;
  }
  function stopPlaying(){clearTimeout(state.timer);state.timer=null;state.playing=false;$('wn-play').textContent='▶';$('wn-play').setAttribute('aria-label','Play WeatherNext map animation');}
  function preload(index){
    for(const f of state.frames.slice(index+1,index+3)){const img=new Image();img.decoding='async';img.src=f.url;}
  }
  async function showFrame(index,{fromPlayback=false}={}){
    const frame=state.frames[index];if(!frame||!state.player)return false;
    const token=++state.token;state.index=index;
    $('wn-time').value=String(index);$('wn-time').setAttribute('aria-valuetext',frameLabel(frame,zone()));
    $('wn-stamp').textContent=frameLabel(frame,zone());
    const ok=await state.player.show(frame,{},{error:()=>{if(token===state.token){stopPlaying();message('A WeatherNext map frame failed to load. A blank map is not a forecast of clear weather.');}}});
    if(token!==state.token)return false;
    if(ok){message('');preload(index);}
    return ok;
  }
  function scheduleNext(){
    clearTimeout(state.timer);if(!state.playing)return;
    state.timer=setTimeout(async()=>{
      if(!state.playing||document.hidden){scheduleNext();return;}
      const next=state.index+1>=state.frames.length?0:state.index+1;
      const wrapped=next===0;
      const ok=await showFrame(next,{fromPlayback:true});
      if(!state.playing)return;
      if(!ok){stopPlaying();return;}
      state.timer=setTimeout(scheduleNext,wrapped?400:0);
    },state.index+1>=state.frames.length?1400:800);
  }
  function renderLegend(layer){
    const el=$('wn-legend'),segments=legendSegments(layer.legend);
    el.setAttribute('aria-label',`${layer.label} color scale in ${layer.units}`);
    el.innerHTML=`<span class="wn-legend-title">${esc(layer.label)} · ${esc(layer.units)}</span><span class="wn-swatches">${segments.map(s=>`<span class="wn-swatch"><i style="background:${esc(s.color)}"></i><b>${esc(s.label)}</b></span>`).join('')}</span>`;
  }
  function renderCaption(layer){
    const c=state.catalog,age=c.status==='stale'||c.status==='last-verified';
    $('wn-caption').textContent=`${layer.label} · ${layer.units} · WeatherNext 3 ensemble mean · model run ${runLabel(c.runAt,zone())} · a forecast, not observed radar${age?' · '+c.message:''}`;
    $('wn-caption').dataset.status=c.status;
  }
  async function selectLayer(id){
    const layer=state.catalog?.layers?.[id];if(!layer)return;
    stopPlaying();state.layer=id;state.token++;state.player?.clear();
    state.frames=layer.frames;
    for(const b of root.querySelectorAll('#wn-tabs button')){const on=b.dataset.wnLayer===id;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));}
    $('wn-time').max=String(Math.max(0,state.frames.length-1));$('wn-time').disabled=state.frames.length<2;$('wn-play').disabled=state.frames.length<2;
    renderLegend(layer);renderCaption(layer);message('');
    await showFrame(initialFrameIndex(state.frames));
  }
  function buildTabs(){
    const ids=ORDER.filter(id=>state.catalog.layers[id]);
    $('wn-tabs').innerHTML=ids.map(id=>`<button type="button" data-wn-layer="${id}" aria-pressed="false" title="${esc(state.catalog.layers[id].description)}">${esc(SHORT[id]||state.catalog.layers[id].label)}</button>`).join('');
    for(const button of root.querySelectorAll('#wn-tabs button'))button.addEventListener('click',()=>void selectLayer(button.dataset.wnLayer));
    return ids;
  }
  async function load(initial=false){
    let catalog;
    try{
      const response=await fetch(API,{cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error('HTTP '+response.status);
      catalog=await response.json();
    }catch{
      if(initial||!state.catalog)showEmpty('WeatherNext maps are temporarily unavailable','The map catalog could not be loaded. Try again shortly, or open Google Weather Lab.');
      return;
    }
    const ids=Object.keys(catalog?.layers||{});
    if(!ids.length){
      if(!state.catalog||initial)showEmpty(catalog?.status==='not-published'?'WeatherNext maps are not published yet':'No current WeatherNext map frames',catalog?.message||'No current WeatherNext map frames are published.');
      return;
    }
    const sameRun=state.catalog&&state.catalog.runAt===catalog.runAt&&state.catalog.status===catalog.status;
    state.catalog=catalog;
    if(sameRun)return;
    state.L=state.L||await leafletReady();
    if(!state.L){showEmpty('The mapping library could not load','Check your connection, or open Google Weather Lab for interactive WeatherNext maps.');return;}
    $('wn-empty').hidden=true;$('wn-body').hidden=false;
    ensureMap();placeMarker();
    const shown=buildTabs(),keep=shown.includes(state.layer)?state.layer:shown.includes('temperature')?'temperature':shown[0];
    state.map.invalidateSize();
    await selectLayer(keep);
  }
  $('wn-play').addEventListener('click',()=>{
    if(state.playing){stopPlaying();return;}
    state.playing=true;$('wn-play').textContent='Ⅱ';$('wn-play').setAttribute('aria-label','Pause WeatherNext map animation');scheduleNext();
  });
  $('wn-time').addEventListener('input',e=>{stopPlaying();void showFrame(Number(e.target.value));});
  $('wn-basemap').addEventListener('change',setBasemap);
  $('wn-us').addEventListener('click',()=>{state.movedByUser=true;state.map?.fitBounds(BOUNDS);});
  // A fixed overlay inside the page's blurred glass card would be positioned against the card,
  // so the whole panel moves to <body> while expanded and returns to its place afterward.
  const expansion={marker:null,inert:[]};
  function setExpanded(open){
    if(open===root.classList.contains('wn-expanded'))return;
    if(open){
      expansion.marker=document.createComment('wn-maps');root.before(expansion.marker);
      document.body.append(root);
      for(const el of document.body.children)if(el!==root&&!el.inert&&el.tagName!=='SCRIPT'){el.inert=true;expansion.inert.push(el);}
      root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','WeatherNext forecast maps');
    }else{
      for(const el of expansion.inert)el.inert=false;expansion.inert=[];
      root.removeAttribute('role');root.removeAttribute('aria-modal');root.removeAttribute('aria-label');
      expansion.marker?.replaceWith(root);expansion.marker=null;
    }
    root.classList.toggle('wn-expanded',open);document.documentElement.classList.toggle('wn-map-open',open);
    const button=$('wn-expand');
    button.textContent=open?'⛶ Close':'⛶ Expand';button.setAttribute('aria-pressed',String(open));button.setAttribute('aria-label',open?'Close expanded WeatherNext map':'Expand WeatherNext map');
    button.focus({preventScroll:true});
    setTimeout(()=>state.map?.invalidateSize(),60);
  }
  $('wn-expand').addEventListener('click',()=>setExpanded(!root.classList.contains('wn-expanded')));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&root.classList.contains('wn-expanded'))setExpanded(false);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)return;if(!state.catalog||Date.now()-Date.parse(state.catalog.checkedAt)>REFRESH_MS)void load(false);});
  setInterval(()=>{if(!document.hidden)void load(false);},REFRESH_MS);

  const controller={update(next={}){state.place={...state.place,...next};if(state.map)placeMarker();if(state.catalog&&state.layer)renderCaption(state.catalog.layers[state.layer]);},get state(){return state;}};
  panel.__wnMaps=controller;
  void load(true);
  return controller;
}
