/* The main-page graph uses the same hourly clock as Atmos and the people.
 * It presents existing values; it never recalculates the forecast blend. */
import {buildTimeline,consensus,sourceLabel,H} from './atmos-model.js?v=atmos-v1';
import {selectComfortHour} from './experience.js?v=forecast-studio-v1';
import {hideLowRainChance} from './rain-display.js?v=low-rain-display-v1';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
export const EXPLORER_METRICS={
 temperature:{label:'Temperature',unit:'°F',color:'#ffd48a',note:'Air temperature. Now uses the current reading; later hours use the Weather Nourie forecast.'},
 feels:{label:'Feels like',unit:'°F',color:'#ffa9b8',note:'The outdoor feels-like estimate shown with the people, including that hour’s wind, moisture and sunlight.'},
 rain:{label:'Rain chance',unit:'%',color:'#91dfff',note:'The same hourly rain chance as the forecast cards. Now reflects observed rain when available. Chances below 5% are hidden.'},
 precipitation:{label:'Rain amount',unit:'in',color:'#9bc7ff',note:'Liquid precipitation forecast for each hour, including melted snow. These are hourly amounts, not a running total.'},
 wind:{label:'Wind',unit:'mph',color:'#8ce6ce',note:'Sustained wind for each hour. Gusts can be higher.'},
 clouds:{label:'Clouds',unit:'%',color:'#d7d4ff',note:'Published cloud cover for each hour. Missing cloud readings stay blank.'},
};
const modelName=id=>id==='wn'?'NVIDIA WeatherNext':sourceLabel(id);
const SOURCE_COLORS={nws:'#7fd4ff',hrrr:'#ffb47d',ecmwf:'#c49bff',nbm:'#7de8a8',wn:'#ffd479'};
const validPercent=value=>finite(value)&&value>=0&&value<=100;

/** Reuse Atmos's canonical hourly samples, matching precipitation by instant.
 * Raw small rain chances are retained separately for evidence, never printed. */
export function buildForecastExplorer(forecast,now=Date.now()){
 const timeline=buildTimeline(forecast,now).filter(step=>step.time<=now+48*H);
 const precipitation=new Map((forecast?.metricForecasts?.series?.precipitation||[]).map(row=>[Date.parse(row.time),row.value]));
 const rows=timeline.map(step=>({
  ...step,
  values:{temperature:finite(step.temperature)?step.temperature:null,feels:finite(step.feels)?step.feels:null,
   rain:validPercent(step.rain)&&!hideLowRainChance(step.rain)?step.rain:null,
   precipitation:!step.isNow&&finite(precipitation.get(step.hourStart))&&precipitation.get(step.hourStart)>=0?precipitation.get(step.hourStart):null,
   wind:finite(step.wind)&&step.wind>=0?step.wind:null,clouds:validPercent(step.skyCover)?step.skyCover:null},
 }));
 const sources=consensus(timeline).map(row=>row.isNow?{...row,min:null,max:null,sources:[]}:row);
 return {rows,sources,zone:forecast?.location?.timeZone||'America/New_York'};
}

/** Percent charts always span 0–100. Missing readings do not enter the domain. */
export function explorerScale(metric,values){
 if(metric==='rain'||metric==='clouds')return {min:0,max:100,ticks:[0,25,50,75,100]};
 const available=values.filter(finite),temperature=metric==='temperature'||metric==='feels';
 const min=available.length?Math.min(...available):0,max=available.length?Math.max(...available):1;
 const rawSpan=temperature?Math.max(8,max-min+4):Math.max(metric==='precipitation'?.04:4,max*1.12);
 const rawStep=rawSpan/4,mag=10**Math.floor(Math.log10(rawStep));
 const size=[1,2,2.5,5,10].map(n=>n*mag).find(n=>n>=rawStep)||mag*10;
 const lower=temperature?Math.floor((min-2)/size)*size:0;
 const upper=Math.max(lower+size,Math.ceil((temperature?max+2:rawSpan)/size)*size);
 const ticks=[];for(let value=lower;value<=upper+size/100;value+=size)ticks.push(Number(value.toFixed(6)));
 return {min:lower,max:upper,ticks};
}

export function explorerValue(metric,value){
 if(!finite(value))return 'Unavailable';
 if(metric==='rain'&&hideLowRainChance(value))return '';
 if(metric==='precipitation')return value>0&&value<.01?'under 0.01 in':`${value.toFixed(2)} in`;
 return `${Math.round(value)}${metric==='temperature'||metric==='feels'?'°':metric==='wind'?' mph':'%'}`;
}
export function explorerLinePath(points){
 let path='',pen=false;for(const point of points){if(!point){pen=false;continue;}path+=`${pen?'L':'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`;pen=true;}return path;
}
function clock(time,zone,day=false){return new Intl.DateTimeFormat('en-US',{timeZone:zone,...(day?{weekday:'short'}:{}),hour:'numeric'}).format(new Date(time));}
function dateKey(time,zone){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));}

export function installForecastExplorer(){
 const panel=document.getElementById('forecast-explorer-panel');
 if(!panel||panel.dataset.installed==='true')return;
 panel.dataset.installed='true';
 let data={rows:[],sources:[],zone:'America/New_York'},metric='temperature',index=0,showModels=false,selectedTime='now',resizeTimer=0,geometry=null;
 panel.innerHTML=`<div class="explorer-heading"><div><h2>Explore the forecast</h2><p>The same hour, from sky to sidewalk.</p></div><span class="explorer-horizon">Next 48 hours</span></div>
 <div class="explorer-tabs" role="group" aria-label="Forecast graph metric"></div>
 <div class="explorer-readout" aria-live="off"><div><span class="explorer-selected-label"></span><strong class="explorer-reading"></strong></div><p class="explorer-condition"></p></div>
 <div class="explorer-options"><label><input type="checkbox" class="explorer-model-toggle"> Compare temperature models</label></div>
 <div class="explorer-chart" tabindex="0" role="group" aria-label="Hourly forecast graph. Use left and right arrow keys to select an hour."></div>
 <div class="explorer-legend"></div><div class="explorer-model-readings" hidden></div>
 <label class="explorer-scrub-label" for="explorer-hour">Explore each hour <span class="explorer-when"></span></label>
 <input type="range" id="explorer-hour" min="0" max="0" value="0" step="1" aria-label="Select forecast hour">
 <p class="explorer-note"></p>`;
 const find=selector=>panel.querySelector(selector);
 const tabs=find('.explorer-tabs'),chart=find('.explorer-chart'),slider=find('#explorer-hour');
 const when=row=>row?.isNow?'Now':row?clock(row.time,data.zone,true):'';
 const matchSelection=()=>{const found=data.rows.findIndex(row=>row.id===selectedTime);index=found>=0?found:0;};
 function pick(next,publish=true){
  if(!data.rows.length)return;
  const chosen=clamp(Math.round(next),0,data.rows.length-1);
  if(publish&&chosen===index&&selectedTime===data.rows[chosen].id)return;
  index=chosen;selectedTime=data.rows[index].id;
  renderSelection();
  if(publish)selectComfortHour(selectedTime);
 }
 function renderTabs(){
  tabs.innerHTML=Object.entries(EXPLORER_METRICS).filter(([id])=>id!=='clouds'||data.rows.some(row=>finite(row.values.clouds)))
   .map(([id,def])=>`<button type="button" data-explorer-metric="${id}" aria-pressed="${id===metric}">${def.label}</button>`).join('');
 }
 function draw(){
  const def=EXPLORER_METRICS[metric],rows=data.rows;
  slider.disabled=!rows.length;
  panel.style.setProperty('--explorer-color',def.color);
  panel.style.setProperty('--explorer-line',metric==='temperature'&&showModels?'#f5f9ff':def.color);
  find('.explorer-note').textContent=def.note;
  find('.explorer-options').hidden=metric!=='temperature';
  if(!rows.length){chart.innerHTML='<p class="explorer-empty">The hourly forecast will appear here when it is available.</p>';geometry=null;return;}
  const width=Math.max(240,chart.clientWidth||320),height=width<600?222:258,left=metric==='precipitation'?47:35,right=13,top=18,bottom=44;
  const values=rows.map(row=>row.values[metric]);
  const modelValues=metric==='temperature'&&showModels?data.sources.flatMap(row=>row.sources.map(source=>source.value)):[];
  const scale=explorerScale(metric,[...values,...modelValues]),plotWidth=width-left-right,plotHeight=height-top-bottom;
  const first=rows[0].time,last=rows.at(-1).time,span=last-first||H;
  const x=i=>left+(rows[i].time-first)/span*plotWidth,y=value=>top+(scale.max-value)/(scale.max-scale.min)*plotHeight;
  geometry={width,height,left,right,top,bottom,scale,x,y};
  const grid=scale.ticks.map(value=>`<line x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left-8}" y="${y(value)+4}" text-anchor="end">${metric==='precipitation'?value.toFixed(2):value}</text>`).join('');
  const labels=[0];const labelCount=width<380?3:width<650?4:6;
  for(let i=1;i<labelCount;i++)labels.push(Math.round((rows.length-1)*i/(labelCount-1)));
  const axis=labels.map((i,order)=>{const day=i===0||dateKey(rows[i].time,data.zone)!==dateKey(rows[labels[order-1]].time,data.zone);return `<text class="explorer-hour-label" x="${x(i)}" y="${height-23}" text-anchor="${order===0?'start':order===labels.length-1?'end':'middle'}">${rows[i].isNow?'Now':esc(clock(rows[i].time,data.zone))}</text>${day?`<text class="explorer-day-label" x="${x(i)}" y="${height-7}" text-anchor="${order===0?'start':order===labels.length-1?'end':'middle'}">${esc(new Intl.DateTimeFormat('en-US',{timeZone:data.zone,weekday:'short'}).format(new Date(rows[i].time)))}</text>`:''}`;}).join('');
  let modelPaths='',band='';const ids=new Set();
  if(metric==='temperature'&&showModels){
   const segments=[];let segment=[];const flush=()=>{if(segment.length>1)segments.push(segment);segment=[];};
   data.sources.forEach((row,i)=>{if(row.sources.length>1&&finite(row.min)&&finite(row.max))segment.push([i,row.min,row.max]);else flush();row.sources.forEach(source=>ids.add(source.id));});flush();
   band=segments.map(points=>`<path class="explorer-spread" d="M${points.map(([i,,max])=>`${x(i)} ${y(max)}`).join('L')}L${points.slice().reverse().map(([i,min])=>`${x(i)} ${y(min)}`).join('L')}Z"/>`).join('');
   modelPaths=[...ids].map(id=>`<path class="explorer-source" stroke="${SOURCE_COLORS[id]||'#d7e7ff'}" d="${explorerLinePath(data.sources.map((row,i)=>{const source=row.sources.find(source=>source.id===id);return source?[x(i),y(source.value)]:null;}))}"/>`).join('');
  }
  const points=rows.map((row,i)=>finite(row.values[metric])?[x(i),y(row.values[metric])]:null);
  const path=explorerLinePath(points),bars=metric==='precipitation';
  const missing=!points.some(Boolean),lowRain=metric==='rain'&&rows.some(row=>validPercent(row.rain));
  const empty=missing?`<text class="explorer-empty-label" x="${left+plotWidth/2}" y="${top+plotHeight/2-6}" text-anchor="middle">${lowRain?'No rain chances of 5% or more':'Forecast values are unavailable'}<tspan x="${left+plotWidth/2}" dy="17">${lowRain?'in the available forecast.':'for these hours.'}</tspan></text>`:'';
  const isolated=points.map((point,i)=>point&&!points[i-1]&&!points[i+1]?`<circle class="explorer-isolated" cx="${point[0]}" cy="${point[1]}" r="2.4"/>`:'').join('');
  const plot=bars?points.map(point=>point?`<rect class="explorer-bar" x="${point[0]-Math.max(1.5,plotWidth/rows.length*.32)}" y="${point[1]}" width="${Math.max(3,plotWidth/rows.length*.64)}" height="${Math.max(0,y(0)-point[1])}" rx="2"/>`:'').join(''):`<path class="explorer-main-line" d="${path}"/>${isolated}`;
  chart.innerHTML=`<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="${esc(def.label)} by hour, in ${esc(def.unit)}"><g class="explorer-grid">${grid}</g><text class="explorer-unit" x="${left}" y="11">${esc(def.unit)}</text>${band}${modelPaths}${plot}${empty}<g class="explorer-axis">${axis}</g><g class="explorer-cursor"></g></svg>`;
  find('.explorer-legend').innerHTML=`<span><i class="explorer-main-key"></i>${metric==='temperature'?'Air temperature':esc(def.label)}</span>${[...ids].map(id=>`<span><i style="--key-color:${SOURCE_COLORS[id]||'#d7e7ff'}"></i>${esc(modelName(id))}</span>`).join('')}${ids.size?'<span><i class="explorer-spread-key"></i>Model range</span>':''}`;
  renderSelection();
 }
 function renderSelection(){
  const row=data.rows[index];if(!row)return;
  const value=row.values[metric],rawRain=row.rain,hiddenRain=metric==='rain'&&validPercent(rawRain)&&hideLowRainChance(rawRain);
  find('.explorer-selected-label').textContent=`${when(row)} · ${metric==='rain'&&row.rainNow?'Rain observed':EXPLORER_METRICS[metric].label}`;
  find('.explorer-reading').textContent=hiddenRain?'':explorerValue(metric,value);
  find('.explorer-reading').hidden=hiddenRain;
  find('.explorer-reading').dataset.missing=String(!finite(value));
  find('.explorer-condition').textContent=metric==='precipitation'&&row.isNow?'Select a future hour for its forecast amount.':row.condition;
  const readings=find('.explorer-model-readings'),sourceRow=data.sources[index];readings.hidden=metric!=='temperature'||!showModels;
  if(!readings.hidden)readings.innerHTML=row.isNow?'<span>Now is the current reading. Select a future hour to compare its models.</span>':sourceRow?.sources.length?sourceRow.sources.map(source=>`<span><i style="--key-color:${SOURCE_COLORS[source.id]||'#d7e7ff'}"></i>${esc(modelName(source.id))} <b>${explorerValue('temperature',source.value)}</b></span>`).join(''):'<span>Individual model readings are unavailable for this hour.</span>';
  find('.explorer-when').textContent=when(row);
  slider.value=String(index);slider.max=String(data.rows.length-1);slider.setAttribute('aria-valuetext',`${when(row)}${hiddenRain?'':`, ${explorerValue(metric,value)}`} · ${row.condition}`);
  const group=find('.explorer-cursor');if(!group||!geometry)return;
  const {x,y,top,height,bottom}=geometry,cx=x(index);
  group.innerHTML=`<line x1="${cx}" x2="${cx}" y1="${top}" y2="${height-bottom}"/>${finite(value)?`<circle cx="${cx}" cy="${y(value)}" r="5.5"/>`:''}`;
 }
 tabs.addEventListener('click',event=>{const button=event.target.closest('[data-explorer-metric]');if(!button)return;metric=button.dataset.explorerMetric;renderTabs();draw();});
 find('.explorer-model-toggle').addEventListener('change',event=>{showModels=event.target.checked;draw();});
 slider.addEventListener('input',()=>pick(Number(slider.value)));
 let dragging=false;
 const pointerPick=event=>{if(!geometry||!data.rows.length)return;const rect=chart.getBoundingClientRect(),ratio=clamp(((event.clientX-rect.left)*geometry.width/rect.width-geometry.left)/(geometry.width-geometry.left-geometry.right),0,1);const time=data.rows[0].time+ratio*(data.rows.at(-1).time-data.rows[0].time);let best=0;data.rows.forEach((row,i)=>{if(Math.abs(row.time-time)<Math.abs(data.rows[best].time-time))best=i;});pick(best);};
 chart.addEventListener('pointerdown',event=>{dragging=true;chart.setPointerCapture?.(event.pointerId);pointerPick(event);});
 chart.addEventListener('pointermove',event=>{if(dragging)pointerPick(event);});
 chart.addEventListener('pointerup',()=>{dragging=false;});chart.addEventListener('pointercancel',()=>{dragging=false;});
 chart.addEventListener('keydown',event=>{const next={ArrowLeft:index-1,ArrowRight:index+1,Home:0,End:data.rows.length-1}[event.key];if(next===undefined)return;event.preventDefault();pick(next);});
 function update(forecast){
  try{data=buildForecastExplorer(forecast);matchSelection();if(metric==='clouds'&&!data.rows.some(row=>finite(row.values.clouds)))metric='temperature';renderTabs();draw();}
  catch(error){console.error('Forecast explorer failed',error);chart.innerHTML='<p class="explorer-empty">This graph could not be drawn. Refresh to try again.</p>';}
 }
 document.addEventListener('weather-nourie:forecast',event=>update(event.detail));
 document.addEventListener('weather-nourie:hour',event=>{selectedTime=event.detail?.time||'now';matchSelection();renderSelection();});
 document.addEventListener('weather-nourie:reset',()=>{
  data={rows:[],sources:[],zone:data.zone};selectedTime='now';index=0;geometry=null;
  find('.explorer-selected-label').textContent='Waiting for this location’s forecast';find('.explorer-reading').textContent='';find('.explorer-condition').textContent='';find('.explorer-when').textContent='';find('.explorer-legend').innerHTML='';find('.explorer-model-readings').hidden=true;slider.value='0';slider.max='0';renderTabs();draw();
 });
 window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(draw,120);});
 if(globalThis.__weatherNourieForecast)update(globalThis.__weatherNourieForecast);else{renderTabs();draw();}
}
