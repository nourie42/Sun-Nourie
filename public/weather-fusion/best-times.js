/* Best times to be outside.
 * A heat-map of the coming week, one square per hour, colored by how it will feel outdoors, with the
 * near-perfect hours in gold. It stays hidden until someone taps "Best Times" in the row of buttons at the top
 * of the page. The numbers come from the same forecast the page already loaded and the same calculation the
 * Atmos page uses (atmos-model.js), so the colors and the gold hours match it exactly. The calculation is
 * loaded only the first time the panel is opened, so this file costs the page almost nothing until then and
 * a problem here can never stop the forecast from loading. */
const MODEL_URL='./atmos-model.js?v=atmos-v5';
const $=id=>document.getElementById(id);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const deg=v=>finite(v)?`${Math.round(v)}°`:'–';
const DARK_BINS=new Set(['c3','c2','w3']);

const panel=$('best-times'),button=$('open-best-times');
if(panel&&button){
 let model=null,loading=null,grid=[],zone='America/New_York',selectedTime=null,renderedWidth=0,resizeTimer=null;
 const isOpen=()=>!panel.hidden;
 const forecast=()=>globalThis.__weatherNourieForecast||null;

 panel.innerHTML=`<div class="section-top"><h2 id="best-times-title">Best times to be outside</h2><span>Tap a square to see that hour</span></div>
  <p class="lead">Every square is one hour of the coming week, colored by how it will feel outdoors. Gold squares are the near-perfect hours.</p>
  <div class="bt-status" id="best-times-status" role="status" aria-live="polite">Loading the week…</div>
  <div class="bt-grid" id="best-times-grid"></div>
  <p class="bt-detail" id="best-times-detail" aria-live="polite" hidden></p>
  <div class="bt-legend" id="best-times-legend"></div>
  <div class="bt-windows" id="best-times-windows"></div>
  <details class="bt-science"><summary>What makes an hour perfect</summary><div id="best-times-science"></div></details>`;
 panel.setAttribute('aria-labelledby','best-times-title');

 const clear=()=>{for(const id of ['best-times-grid','best-times-legend','best-times-windows','best-times-science'])$(id).innerHTML='';$('best-times-detail').hidden=true;};
 const setStatus=text=>{const el=$('best-times-status');el.textContent=text;el.hidden=!text;};

 async function loadModel(){
  if(model)return model;
  loading=loading||import(MODEL_URL).then(m=>{model=m;return m;}).catch(error=>{loading=null;throw error;});
  return loading;
 }

 function cellDetail(cell){
  const verdict=cell.perfect?'Perfect hour (outdoor feels-like, dry daylight)':cell.bin?.label||'';
  const day=model.longDayLabel(cell.time,zone).slice(0,3),hour=model.hourLabel(cell.time,zone);
  const rain=finite(cell.rain)?(cell.rain<5?'under 5%':`${Math.round(cell.rain)}%`):'–';
  return `<strong>${esc(`${day} ${hour}`)}</strong> · ${esc(verdict)}. Feels like ${deg(cell.feels)}, thermometer ${deg(cell.temperature)}, dew point ${deg(cell.dewpoint)}, wind ${finite(cell.wind)?Math.round(cell.wind)+' mph':'–'}, rain chance ${rain}${cell.condition?`, ${esc(cell.condition)}`:''}.`;
 }

 function render(){
  const data=forecast();
  if(!model||!data){setStatus(data?'Loading the week…':'The forecast is still loading. Try again in a moment.');clear();return;}
  zone=data.location?.timeZone||'America/New_York';
  grid=model.comfortGrid(data,Date.now());
  const wrap=$('best-times-grid'),width=Math.max(280,Math.floor(wrap.clientWidth||panel.clientWidth-40||320));
  if(!grid.some(row=>row.cells.some(Boolean))){setStatus('The hourly feels-like forecast for the week is not available right now.');clear();return;}
  setStatus('');
  renderedWidth=width;
  const {PERFECT_RULES:r,COMFORT_BINS,perfectWindows,localParts,clockLabel,longDayLabel}=model;
  const label=width<520?46:64,headerH=20,rowH=width<520?24:30,gap=2,cols=24,cellW=(width-label)/cols,height=headerH+grid.length*(rowH+gap);
  const header=[0,6,12,18].map(h=>`<text x="${(label+cellW*h).toFixed(1)}" y="13">${h===0?'12a':h===12?'12p':h<12?`${h}a`:`${h-12}p`}</text>`).join('');
  const rows=grid.map((row,ri)=>{
   const y=headerH+ri*(rowH+gap);
   const cells=row.cells.map((cell,h)=>{
    const x=label+h*cellW;
    if(!cell)return `<rect x="${(x+1.5).toFixed(1)}" y="${y+1.5}" width="${Math.max(1,cellW-3).toFixed(1)}" height="${rowH-3}" rx="3" fill="none" stroke="var(--bt-line)" stroke-width="1"/>`;
    const fill=cell.perfect?'var(--bt-gold)':cell.bin?`var(--bt-${cell.bin.key})`:'var(--bt-none)';
    const light=!cell.perfect&&DARK_BINS.has(cell.bin?.key);
    const dot=finite(cell.rain)&&cell.rain>=50?`<circle cx="${(x+cellW/2).toFixed(1)}" cy="${y+rowH/2}" r="${cell.rain>=75?3.2:2.4}" fill="${light?'#fff':'#0e1d36'}" pointer-events="none"/>`:'';
    return `<rect class="bt-cell${cell.time===selectedTime?' selected':''}" data-t="${cell.time}" x="${x.toFixed(1)}" y="${y}" width="${cellW.toFixed(1)}" height="${rowH}" rx="3" fill="${fill}" opacity="${cell.past?.32:1}"/>${dot}`;
   }).join('');
   return `<text class="bt-row-label" x="0" y="${y+rowH/2+4}">${esc(row.label)}</text>${cells}`;
  }).join('');
  wrap.innerHTML=`<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="Seven days by twenty-four hours, colored by how each hour will feel, with perfect hours in gold">${header}${rows}</svg>`;
  wrap.dataset.label=label;wrap.dataset.cell=cellW;wrap.dataset.row=rowH+gap;wrap.dataset.header=headerH;

  $('best-times-legend').innerHTML='<span class="bt-key"><i class="perfect"></i>Perfect</span>'+COMFORT_BINS.map(bin=>`<span class="bt-key"><i style="background:var(--bt-${bin.key})"></i>${esc(bin.label)} ${esc(bin.range)}</span>`).join('')+'<span class="bt-key"><i class="rain"></i>Rain likely</span>';

  const windows=perfectWindows(grid);
  const describe=w=>{
   const temps=finite(w.low)?(Math.round(w.low)===Math.round(w.high)?deg(w.low):`${Math.round(w.low)}–${deg(w.high)}`):'';
   return `Dry daylight${temps?`, feels like ${temps} outdoors`:''}${finite(w.dewpoint)?`, dew point ${deg(w.dewpoint)}`:''}`;
  };
  const list=windows.slice(0,4).map(w=>{
   const crossesDay=localParts(w.end,zone).date!==localParts(w.start,zone).date;
   const span=`${longDayLabel(w.start,zone)} ${clockLabel(w.start,zone)} to ${crossesDay?`${longDayLabel(w.end,zone).slice(0,3)} `:''}${clockLabel(w.end,zone)}`;
   return `<li><span class="bt-span">${esc(span)}</span><span class="bt-why">${esc(describe(w))}, ${w.hours} forecast hour${w.hours===1?'':'s'}</span></li>`;
  }).join('');
  $('best-times-windows').innerHTML=windows.length?`<h3>Coming up</h3><ul>${list}</ul>`:`<h3>No perfect hours in the next ${r.horizonDays} days</h3><p>No available hour meets the same rules as the main page. The seven-day colors still show how the remaining hours are forecast to feel.</p>`;

  $('best-times-science').innerHTML=`<p><strong>A perfect hour</strong> has an outdoor feels-like of ${r.band.min}–${r.band.max}°, dew point at most ${r.dewpoint}°, cloud cover at most ${r.cloud}%, rain likelihood at most ${r.rain}%, and less than ${r.precipitation.toFixed(2)} inch of forecast precipitation. It must be daylight without rain, fog or other adverse conditions. Gold uses the main page's exact qualifying hours for the next ${r.horizonDays} local dates.</p>
   <p><strong>Every other hour</strong> is colored by its custom feels-like temperature. Comfortable is 65–79°, centered on the ${r.ideal}° ideal. The warm side applies UTCI-derived heat-stress thresholds (78.8°, 89.6° and 100.4°F) to that estimate; the cold side steps down through cool, cold and freezing.</p>
   <p>A dot marks an hour with a rain chance of 50% or more.</p>`;

  const picked=grid.flatMap(row=>row.cells).find(cell=>cell&&cell.time===selectedTime);
  const detail=$('best-times-detail');
  if(picked){detail.innerHTML=cellDetail(picked);detail.hidden=false;}else detail.hidden=true;
 }

 function cellAt(event){
  const wrap=$('best-times-grid'),svg=wrap.querySelector('svg');if(!svg)return null;
  const rect=wrap.getBoundingClientRect(),k=svg.viewBox.baseVal.width/rect.width;
  const x=(event.clientX-rect.left)*k,y=(event.clientY-rect.top)*k;
  const col=Math.floor((x-Number(wrap.dataset.label))/Number(wrap.dataset.cell)),row=Math.floor((y-Number(wrap.dataset.header))/Number(wrap.dataset.row));
  return col>=0&&col<24?grid[row]?.cells[col]||null:null;
 }
 $('best-times-grid').addEventListener('click',event=>{
  const cell=cellAt(event);if(!cell||!model)return;
  selectedTime=cell.time;
  $('best-times-grid').querySelectorAll('.bt-cell.selected').forEach(c=>c.classList.remove('selected'));
  $('best-times-grid').querySelector(`.bt-cell[data-t="${cell.time}"]`)?.classList.add('selected');
  const detail=$('best-times-detail');detail.innerHTML=cellDetail(cell);detail.hidden=false;
 });

 async function show(){
  panel.hidden=false;button.setAttribute('aria-expanded','true');
  setStatus('Loading the week…');
  panel.scrollIntoView({behavior:matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  try{await loadModel();}catch(error){
   console.error('Best times could not load',error);clear();setStatus('The best-times chart could not load. Please try again.');return;
  }
  if(isOpen())render();
 }
 function hide(){panel.hidden=true;button.setAttribute('aria-expanded','false');}
 button.addEventListener('click',()=>{if(isOpen())hide();else void show();});

 // A new forecast (refresh, or a new place) redraws the chart if it is open and forgets the old selection.
 document.addEventListener('weather-nourie:forecast',()=>{selectedTime=null;if(isOpen()&&model)render();});
 window.addEventListener('resize',()=>{
  if(!isOpen()||!model)return;
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{const w=Math.floor($('best-times-grid').clientWidth||0);if(w&&Math.abs(w-renderedWidth)>8)render();},150);
 });
}
