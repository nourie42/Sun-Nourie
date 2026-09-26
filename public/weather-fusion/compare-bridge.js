import {displayedFeelsAt} from '/weather-fusion/hourly-feels.js?v=dewpoint-floor-v1';
import {currentSample} from '/weather-fusion/weather-display.js?v=sun-exposure-v1';
import {sunExposureTemperature} from '/weather-fusion/outdoor-feels.js?v=sun-exposure-v1';
import {installWeatherNextAccess} from '/weather-fusion/weathernext-access.js?v=private-location-v1';
const sections=['city-name','today-forecast','hourly','skin-exposure','daily-panel','metrics','air-quality','map-panel','scientific-stuff'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installComparisonPane(config,actions){
 const access=config.source==='google'?installWeatherNextAccess(actions):null;
 const $=id=>document.getElementById(id);let suppress=0,scrollTimer=null;
 const embedded=window.parent!==window;
 const post=payload=>{if(embedded)parent.postMessage({...payload,source:config.source,location:config.point.id},location.origin);};
 function addNotice(id,title,text){const root=$(id);if(!root)return;let note=root.querySelector('.google-unavailable');if(!note){note=document.createElement('div');note.className='google-unavailable';root.append(note);}note.innerHTML=`<strong>${esc(title)}</strong>${esc(text)}`;}
 function googleLabels(data){
  document.title='Experimental NVIDIA AI Weather';
  $('observation-label').textContent='Model forecast � valid '+new Intl.DateTimeFormat('en-US',{timeZone:data.location.timeZone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(data.current.time))+' � not a live station reading';
  const label=document.querySelector('.current-temp-label');if(label)label.textContent=sunExposureTemperature(currentSample(data)).active?'Forecast sun-exposure estimate':'Forecast air temperature';

  if($('ai-label'))$('ai-label').textContent='LOCAL OUTLOOK';
  if($('briefing-stamp'))$('briefing-stamp').textContent='Weather Nourie forecast summary';
  for(const id of ['briefing-summary','briefing-detail']){const root=$(id);if(root){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode())node.textContent=node.textContent.replaceAll('Rain chance is not available yet.','NWS supplemental rain chances are temporarily unavailable.');}}
  for(const button of document.querySelectorAll('#hourly [data-comfort-time]')){
   const time=button.dataset.comfortTime==='now'?data.current.time:button.dataset.comfortTime;
   const row=data.hours.find(h=>Date.parse(h.time)===Date.parse(time)),rain=button.querySelector('.hour-rain');
   if(rain){const pop=row?.rainLikelihood?.value;rain.title='NWS supplemental hourly rain probability. WeatherNext rainfall amount: '+(typeof row?.precipitation==='number'?row.precipitation.toFixed(2)+' in':'unavailable');rain.innerHTML=`<small class="hour-pop">${typeof pop==='number'?Math.round(pop)+'%':'-'}</small>`;}
  }
  addNotice('nws-bulletins','Official alerts','This experimental model does not provide official warnings. Check the main Fusion page or the official NWS link above.');
  if(!data.airQuality)addNotice('air-quality','Air quality temporarily unavailable','The supplemental air-quality feed could not be refreshed.');else $('air-quality')?.querySelector('.google-unavailable')?.remove();
  addNotice('map-panel','Live radar','WeatherNext forecasts are not observed radar. Your normal live radar remains on the main forecast page.');
  let science=$('compare-google-science');if(!science){science=document.createElement('div');science.id='compare-google-science';science.className='google-science';$('scientific-stuff').append(science);}
  science.innerHTML=`<p><strong>Source policy</strong><br>${esc(data.methodology.replaceAll('Google ','').replaceAll('Google-issued','model-issued').replace('No NWS, HRRR, ECMWF or Open-Meteo values enter this forecast.','Core weather fields use WeatherNext.'))}</p>${(data.comparison?.runs||[]).map(r=>`<p><strong>${r.id==='interimSurface'?'Short-range hourly run':r.id==='previousSurface'?'Previous main run':'Main run'}</strong><br>Initialized ${esc(r.runAt)}<br>Collected ${esc(r.fetchedAt||'not supplied')}<br>Status: ${esc(r.status)}</p>`).join('')}<p>Rain probability comes from NWS; UV and AQI use independently attributed supplemental feeds. Gusts and live radar are not inferred. Forecast confidence is a relative temperature-ensemble indicator. Cloud/precipitation scenes are display categories. The ensemble's hourly temperature spread is not a calibrated confidence percentage. Daily highs/lows summarize available hourly mean values-not an extreme-temperature ensemble distribution. Sunrise/sunset are astronomical calculations.</p><p><a href="/weathernext/" target="_top">Open WeatherNext dashboard ?</a></p>`;
  let coverage=$('google-coverage-note');if(!coverage){coverage=document.createElement('p');coverage.id='google-coverage-note';coverage.className='google-coverage-note';$('today-forecast').after(coverage);}coverage.textContent=(data.days[0]?.detail||'Forecast coverage is unavailable.').split(' Rain chances are supplemental')[0].replaceAll('Google ','');
 }
 function rendered(data){if(config.source==='google')googleLabels(data);post({type:'compare:forecast',current:{temperature:data.current.temperature,time:data.current.time,type:data.current.type},hours:(data.hours||[]).map(h=>({time:h.time,temperature:h.temperature,dewpoint:h.dewpoint,windMph:h.windMph??data.metricForecasts?.series?.wind?.find(p=>Date.parse(p.time)===Date.parse(h.time))?.value??null,skyCover:h.skyCover,precipitation:h.precipitation,feelsLike:displayedFeelsAt(data,h.time)}))});}
 window.addEventListener('message',e=>{
  if(!embedded||e.origin!==location.origin||e.source!==parent||!e.data)return;const m=e.data;
  if(m.type==='compare:refresh'){actions.refresh();return;}
  suppress=performance.now()+500;
  if(m.type==='compare:scroll'&&sections.includes(m.section)){const el=$(m.section);if(!el)return;const progress=Math.max(0,Math.min(1,Number(m.progress)||0)),i=sections.indexOf(m.section),next=sections.slice(i+1).map($).find(n=>n&&n.getBoundingClientRect().height>0);const top=el.getBoundingClientRect().top+scrollY,end=next?next.getBoundingClientRect().top+scrollY:document.documentElement.scrollHeight;scrollTo({top:Math.max(0,top-14+progress*Math.max(0,end-top)),behavior:'instant'});}
  if(m.type==='compare:hour'&&(m.time==='now'||actions.getForecast()?.hours?.some(h=>Date.parse(h.time)===Date.parse(m.time))))actions.selectHour(m.time);
  if(m.type==='compare:day'){const index=actions.getForecast()?.days?.findIndex(d=>d.date===m.date);if(index>=0)actions.showDay(index);}
  if(m.type==='compare:metric'&&typeof m.key==='string'&&/^[a-z]+$/.test(m.key))document.querySelector(`[data-metric="${m.key}"]`)?.click();
  if(m.type==='compare:close')document.querySelectorAll('dialog[open]').forEach(d=>d.close());
 });
 window.addEventListener('scroll',()=>{if(performance.now()<suppress)return;clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{if(performance.now()<suppress)return;let id=sections[0];for(const s of sections){const el=$(s);if(el&&el.getBoundingClientRect().height>0&&el.getBoundingClientRect().top<=35)id=s;}const el=$(id),i=sections.indexOf(id),next=sections.slice(i+1).map($).find(n=>n&&n.getBoundingClientRect().height>0);if(!el)return;const top=el.getBoundingClientRect().top+scrollY,end=next?next.getBoundingClientRect().top+scrollY:document.documentElement.scrollHeight;post({type:'compare:scroll',section:id,progress:Math.max(0,Math.min(1,(scrollY+14-top)/Math.max(1,end-top)))});},90);},{passive:true});
 document.addEventListener('click',e=>{if(performance.now()<suppress)return;const h=e.target.closest('[data-comfort-time]');if(h)post({type:'compare:hour',time:h.dataset.comfortTime});const b=e.target.closest('[data-day],[data-today-forecast]');if(b){const d=actions.getForecast()?.days?.[Number(b.dataset.day||0)];if(d)post({type:'compare:day',date:d.date});}const metric=e.target.closest('[data-metric]');if(metric)post({type:'compare:metric',key:metric.dataset.metric});});
 document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',()=>{if(performance.now()>=suppress)post({type:'compare:close'});}));
 new MutationObserver(()=>{const text=$('status')?.textContent||'';if(/Weather update failed|display component failed/i.test(text))post({type:'compare:error',message:text});}).observe($('status'),{childList:true,subtree:true,characterData:true});
 return {rendered,requestForecast:access?.requestForecast};
}
