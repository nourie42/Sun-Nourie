import {displayedFeelsAt} from '/weather-fusion/hourly-feels.js?v=dewpoint-floor-v1';
const sections=['city-name','today-forecast','hourly','skin-exposure','daily-panel','metrics','air-quality','map-panel','scientific-stuff'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installComparisonPane(config,actions){
 const $=id=>document.getElementById(id);let suppress=0,scrollTimer=null;
 const post=payload=>parent.postMessage({...payload,source:config.source,location:config.point.id},location.origin);
 function addNotice(id,title,text){const root=$(id);if(!root)return;let note=root.querySelector('.google-unavailable');if(!note){note=document.createElement('div');note.className='google-unavailable';root.append(note);}note.innerHTML=`<strong>${esc(title)}</strong>${esc(text)}`;}
 function sourceNote(data){let note=$('compare-source-note');if(!note){note=document.createElement('div');note.id='compare-source-note';note.className='compare-source-note';$('forecast').prepend(note);}const google=config.source==='google';note.dataset.stale=String((data.feeds||[]).some(f=>f.status==='stale'));note.innerHTML=google?'<strong>Google WeatherNext · your familiar Weather Nourie layout</strong>Forecast—not a live observation. Feels-like, clothing and pavement use your existing calculations with Google-only inputs. Missing Google fields remain unavailable.':'<strong>Your Weather Fusion forecast</strong>Your normal forecast, observations, calculations and image tiles. Both panels use the same selected comparison point.';}
 function googleLabels(data){
  $('observation-label').textContent='Google model forecast · valid '+new Intl.DateTimeFormat('en-US',{timeZone:data.location.timeZone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(data.current.time))+' · not a live station reading';
  const label=document.querySelector('.current-temp-label');if(label)label.textContent='Google forecast temperature';
  if($('hero-uv'))$('hero-uv').textContent='UV index · not supplied by Google';
  if($('ai-label'))$('ai-label').textContent='GOOGLE-BASED OUTLOOK';
  if($('briefing-stamp'))$('briefing-stamp').textContent='Weather Nourie summary of the Google forecast, not a Google-issued narrative';
  addNotice('nws-bulletins','Official alerts are not a Google forecast product','Google WeatherNext does not provide official warnings. Check the main Fusion page or the official NWS link above.');
  addNotice('air-quality','Air quality · not supplied by Google','This Google feed has no AQI values. Nothing from another provider is inserted into this panel.');
  addNotice('map-panel','Live radar · not supplied by Google','WeatherNext forecasts are not observed radar. Your normal live radar remains on the Fusion side; Google’s full model data remain in the separate explorer.');
  let science=$('compare-google-science');if(!science){science=document.createElement('div');science.id='compare-google-science';science.className='google-science';$('scientific-stuff').append(science);}
  science.innerHTML=`<p><strong>Source policy</strong><br>${esc(data.methodology)}</p>${(data.comparison?.runs||[]).map(r=>`<p><strong>${r.id==='interimSurface'?'Short-range hourly run':r.id==='previousSurface'?'Previous main run':'Main run'}</strong><br>Initialized ${esc(r.runAt)}<br>Collected ${esc(r.fetchedAt||'not supplied')}<br>Status: ${esc(r.status)}</p>`).join('')}<p>Rain probability, UV, AQI, gusts and live radar are not inferred. Cloud/precipitation scenes are display categories. The ensemble’s hourly temperature spread is not a calibrated confidence percentage. Daily highs/lows summarize available hourly mean values—not an extreme-temperature ensemble distribution. Sunrise/sunset are astronomical calculations.</p><p><a href="/weathernext/" target="_top">Open all Google variables, ensemble ranges and downloads ↗</a></p>`;
  let coverage=$('google-coverage-note');if(!coverage){coverage=document.createElement('p');coverage.id='google-coverage-note';coverage.className='google-coverage-note';$('today-forecast').after(coverage);}coverage.textContent=data.days[0]?.detail||'Google coverage is unavailable.';
 }
 function rendered(data){sourceNote(data);if(config.source==='google')googleLabels(data);post({type:'compare:forecast',current:{temperature:data.current.temperature,time:data.current.time,type:data.current.type},hours:(data.hours||[]).map(h=>({time:h.time,temperature:h.temperature,dewpoint:h.dewpoint,windMph:h.windMph??data.metricForecasts?.series?.wind?.find(p=>Date.parse(p.time)===Date.parse(h.time))?.value??null,skyCover:h.skyCover,precipitation:h.precipitation,feelsLike:displayedFeelsAt(data,h.time)}))});}
 window.addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==parent||!e.data)return;const m=e.data;
  if(m.type==='compare:refresh'){actions.refresh();return;}
  suppress=Date.now()+500;
  if(m.type==='compare:scroll'&&sections.includes(m.section)){const el=$(m.section);if(!el)return;const progress=Math.max(0,Math.min(1,Number(m.progress)||0)),i=sections.indexOf(m.section),next=sections.slice(i+1).map($).find(n=>n&&n.getBoundingClientRect().height>0);const top=el.getBoundingClientRect().top+scrollY,end=next?next.getBoundingClientRect().top+scrollY:document.documentElement.scrollHeight;scrollTo({top:Math.max(0,top-14+progress*Math.max(0,end-top)),behavior:'instant'});}
  if(m.type==='compare:hour'&&(m.time==='now'||actions.getForecast()?.hours?.some(h=>Date.parse(h.time)===Date.parse(m.time))))actions.selectHour(m.time);
  if(m.type==='compare:day'){const index=actions.getForecast()?.days?.findIndex(d=>d.date===m.date);if(index>=0)actions.showDay(index);}
  if(m.type==='compare:metric'&&typeof m.key==='string'&&/^[a-z]+$/.test(m.key))document.querySelector(`[data-metric="${m.key}"]`)?.click();
  if(m.type==='compare:close')document.querySelectorAll('dialog[open]').forEach(d=>d.close());
 });
 window.addEventListener('scroll',()=>{if(Date.now()<suppress)return;clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{if(Date.now()<suppress)return;let id=sections[0];for(const s of sections){const el=$(s);if(el&&el.getBoundingClientRect().height>0&&el.getBoundingClientRect().top<=35)id=s;}const el=$(id),i=sections.indexOf(id),next=sections.slice(i+1).map($).find(n=>n&&n.getBoundingClientRect().height>0);if(!el)return;const top=el.getBoundingClientRect().top+scrollY,end=next?next.getBoundingClientRect().top+scrollY:document.documentElement.scrollHeight;post({type:'compare:scroll',section:id,progress:Math.max(0,Math.min(1,(scrollY+14-top)/Math.max(1,end-top)))});},90);},{passive:true});
 document.addEventListener('click',e=>{if(Date.now()<suppress)return;const h=e.target.closest('[data-comfort-time]');if(h)post({type:'compare:hour',time:h.dataset.comfortTime});const b=e.target.closest('[data-day],[data-today-forecast]');if(b){const d=actions.getForecast()?.days?.[Number(b.dataset.day||0)];if(d)post({type:'compare:day',date:d.date});}const metric=e.target.closest('[data-metric]');if(metric)post({type:'compare:metric',key:metric.dataset.metric});});
 document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',()=>{if(Date.now()>=suppress)post({type:'compare:close'});}));
 new MutationObserver(()=>{const text=$('status')?.textContent||'';if(/Weather update failed|display component failed/i.test(text))post({type:'compare:error',message:text});}).observe($('status'),{childList:true,subtree:true,characterData:true});
 return {rendered};
}
