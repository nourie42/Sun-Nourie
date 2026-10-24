import {buildSeries,METRICS,mountChart,solarDays,nightBands,fmt,H} from './halo.js?v=shared-chart-v2';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const TREND_METRICS={
 temperature:{...METRICS.temperature,label:'Temp'},feels:{...METRICS.feels,label:'Feels'},precip:{...METRICS.precip,label:'Rain chance'},
 rainfall:{label:'Rainfall',unit:' in',kind:'bars',min0:true,color:'#78c8ff'},wind:METRICS.wind,
 gust:{label:'Gusts',unit:' mph',kind:'line',min0:true,color:'#8ce8d5'},humidity:METRICS.humidity,dewpoint:METRICS.dewpoint,
 cloud:{label:'Cloud cover',unit:'%',kind:'line',domain:[0,100],color:'#b8d5f5'},uv:METRICS.uv,
 pressure:{label:'Pressure',unit:' mb',kind:'line',color:'#bba4f5'},aqi:{label:'Air quality',unit:' AQI',kind:'line',min0:true,color:'#9ef0c2'}
};
export function mainTrendSeries(data){
 const series=buildSeries(data),s=data.metricForecasts?.series||{},points=rows=>(rows||[]).map(r=>({t:Date.parse(r.time),v:finite(r.value)?r.value:null}));
 series.rainfall=(data.rainTimeline||[]).map(r=>({t:Date.parse(r.time),v:finite(r.precipitation)?r.precipitation:null}));
 series.cloud=points(s.feels?.length?s.feels.map(r=>({time:r.time,value:r.inputs?.skyCover})):s.cloud);
 series.pressure=points(s.pressure).map(p=>({...p,v:finite(p.v)?p.v*33.86389:null}));
 series.aqi=points(data.airQuality?.hours?.map(r=>({time:r.time,value:r.aqi}))||data.airQuality?.hourly||[]);
 return series;
}
export function trendReading(metric,point){if(!finite(point?.v))return 'Unavailable';return `${point.v.toFixed(metric==='rainfall'?2:metric==='pressure'?1:0)}${TREND_METRICS[metric].unit}`;}
if(typeof document!=='undefined'){
 const root=document.getElementById('main-hourly-trend');
 if(root){
  let forecast=null,metric='temperature',observer=null;
  root.innerHTML=`<div class="section-top"><h2>Next 48 hours</h2></div><div class="main-trend-tabs" role="tablist" aria-label="Hourly graph weather variable">${Object.entries(TREND_METRICS).map(([id,d])=>`<button type="button" role="tab" id="main-trend-tab-${id}" aria-controls="main-trend-chart" aria-selected="${id===metric}" data-trend="${id}">${d.label}</button>`).join('')}</div><div class="main-trend-reading" aria-live="polite"><strong id="main-trend-value">—</strong><span id="main-trend-time">Waiting for forecast</span></div><div id="main-trend-chart" class="chart tall" role="tabpanel" aria-labelledby="main-trend-tab-temperature" tabindex="0"></div><p class="main-trend-note">Tap or drag for the forecast time and value. Missing hours stay blank.</p>`;
  const chart=root.querySelector('.chart'),value=root.querySelector('#main-trend-value'),stamp=root.querySelector('#main-trend-time');
  let keyboardIndex=0,available=[];
  const show=p=>{value.textContent=trendReading(metric,p);stamp.textContent=p?fmt(p.t,forecast.location.timeZone,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Now · drag across the graph';};
  const render=()=>{
   if(!forecast)return;
   const series=mainTrendSeries(forecast),start=Math.floor(Date.now()/H)*H,end=start+48*H,def=TREND_METRICS[metric];
   const points=series[metric]||[];available=points.filter(p=>p.t>=start&&p.t<=end&&finite(p.v));keyboardIndex=0;
   const idle=()=>{show(available[0]);stamp.textContent=available[0]?.t===start?'Now · drag across the graph':available.length?'First available hour · drag across the graph':'No forecast data for this period';};
   root.querySelectorAll('[data-trend]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.trend===metric)));
   chart.setAttribute('aria-labelledby',`main-trend-tab-${metric}`);
   mountChart(chart,{points,extra:metric==='wind'?series.gust:[],t0:start,t1:end,tz:forecast.location.timeZone,nowT:null,nights:nightBands(solarDays(forecast),start,end),multiDay:true},def,p=>p?show(p):idle());idle();
  };
  root.addEventListener('click',e=>{const b=e.target.closest('[data-trend]');if(b){metric=b.dataset.trend;render();}});
  root.querySelector('[role=tablist]').addEventListener('keydown',e=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
   const buttons=[...root.querySelectorAll('[data-trend]')],index=buttons.indexOf(document.activeElement);if(index<0)return;e.preventDefault();
   const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();buttons[next].click();
  });
  chart.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||!available.length)return;e.preventDefault();keyboardIndex=e.key==='Home'?0:e.key==='End'?available.length-1:Math.max(0,Math.min(available.length-1,keyboardIndex+(e.key==='ArrowRight'?1:-1)));show(available[keyboardIndex]);});
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>chart._redraw?.());observer.observe(chart);}
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const evidence=data=>{
   document.getElementById('blend-v2-evidence')?.remove();if(!data.blendV2?.enabled)return;
   const holder=document.createElement('details');holder.id='blend-v2-evidence';
   const names={nws:'NWS',hrrr:'HRRR',nbm:'NBM',ecmwf:'ECMWF IFS',gefs:'GEFS',weathernext3:'WeatherNext 3',wn:'Legacy WeatherNext'};
   const rows=(data.metricForecasts?.series?.temperature||[]).filter(p=>Date.parse(p.time)>=Date.parse(data.blendV2.issuedAt)&&Date.parse(p.time)<Date.parse(data.blendV2.issuedAt)+168*H);
   holder.innerHTML=`<summary>Blend V2: requested weights and actual hourly sources</summary><p>Temperature uses the requested lead-hour weights below. Missing sources are excluded and available shares are renormalized. ECMWF here is deterministic IFS, not ENS. ${escape(data.blendV2.gefs)}. No local accuracy gain or bias correction has been established.</p><table><caption>Requested temperature shares</caption><tbody>${(data.blendV2.requestedTables?.temperature?.bands||[]).map(b=>`<tr><th>${escape(b.label)}</th><td>${Object.entries(b.weights_percent).map(([id,w])=>escape(names[id]||id)+' '+w+'%').join(' · ')}</td></tr>`).join('')}</tbody></table><p>${escape(data.blendV2.rainProbability)}. ${escape(data.blendV2.rainAmount)}. Winter and official alerts retain their existing rules.</p><details><summary>Actual temperature contributions for each of the next seven days’ hours</summary><table><tbody>${rows.map(p=>`<tr><th>${escape(fmt(Date.parse(p.time),data.location.timeZone,{weekday:'short',hour:'numeric'}))}</th><td>${finite(p.value)?p.value.toFixed(1)+'°F':'Unavailable'}</td><td>${(p.sources||[]).map(s=>escape(names[s.id]||s.id)+' '+(s.weight*100).toFixed(1)+'% ('+s.value.toFixed(1)+'°F)').join(' · ')||'No valid sources'}</td></tr>`).join('')}</tbody></table></details>`;
   document.getElementById('methodology')?.after(holder);
  };
  document.addEventListener('weather-nourie:forecast',e=>{forecast=e.detail;render();evidence(forecast);});
  if(globalThis.__weatherNourieForecast){forecast=globalThis.__weatherNourieForecast;render();}
 }
}
