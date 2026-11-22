import {activeRiskOutlooks} from './risk-outlooks.js?v=risk-outlooks-v5';
import {weatherChangeMessages} from './weather-changes.js?v=current-rain-20261017-v3';
import {buildForecastWindows} from './forecast-windows.js?v=daily-hourly-v1';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={risk:'<svg viewBox="0 0 24 24"><path d="M12 22S3 13 3 9a9 9 0 0 1 18 0c0 4-9 13-9 13Z"/><circle cx="12" cy="9" r="3" fill="#153d49"/></svg>',change:'⚡',rain:'🌧',perfect:'🌤'};
export function outlookItems(data,now=Date.now(),providedView=null){
 const view=providedView||buildForecastWindows(data,now),items=[];
 for(const risk of activeRiskOutlooks(data,now))items.push({id:'risk-'+risk.id,kind:'risk',label:risk.kind==='wpc'?'Flood Risk':risk.kind==='spc'?'Storm Risk':'Winter Risk',preview:risk.level||risk.title,risk});
 const current=!view.snapshotFreshness||view.snapshotFreshness.status==='fresh';
 const changes=current?weatherChangeMessages(data,now):[];
 if(changes.length)items.push({id:'change',kind:'change',label:'Change Alert',preview:/less humid/i.test(changes[0])?'Air feels less humid':/more humid/i.test(changes[0])?'Air feels more humid':changes[0],messages:changes});
 if(current&&view.rain?.length){const values=view.rain.flatMap(w=>w.hours||[]).map(h=>h.rainChance).filter(Number.isFinite);items.push({id:'rain',kind:'rain',label:'Rain Outlook',preview:values.length?'Peak '+Math.round(Math.max(...values))+'%':'Rain ahead',view});}
 if(current&&view.perfect?.length){const first=view.perfect[0],hours=Math.ceil((first.start-now)/3600000),preview=first.start<=now?'Now':hours<24?`In ${hours} hour${hours===1?'':'s'}`:new Intl.DateTimeFormat('en-US',{timeZone:view.timeZone||data.location?.timeZone,weekday:'short',hour:'numeric'}).format(new Date(first.start));items.push({id:'perfect',kind:'perfect',label:'Perfect Weather',preview,view});}
 return items;
}
export function renderOutlookPanel(host,{summary='',items=[],onTake,onItem}){
 if(!host)return;
 const text=summary.trim();host.hidden=!text&&!items.length;if(host.hidden){host.replaceChildren();return;}
 host.classList.add('weather-outlook-panel','glass');
 host.innerHTML=`<button type="button" class="outlook-take" aria-haspopup="dialog"><i aria-hidden="true"></i><strong>Nourie Take</strong><span>${esc(text||items[0]?.risk?.title||items[0]?.preview||'Local weather outlook')}</span><b aria-hidden="true">›</b></button>${items.length?`<div class="outlook-items" data-count="${Math.min(4,items.length)}">${items.map(item=>`<button type="button" class="outlook-item outlook-${item.kind}" data-outlook-item="${esc(item.id)}" aria-haspopup="dialog"><span class="outlook-icon" aria-hidden="true">${icons[item.kind]}</span><span class="outlook-item-copy"><strong>${esc(item.label)}</strong><small>${esc(item.preview)}</small></span></button>`).join('')}</div>`:''}`;
 host.querySelector('.outlook-take').addEventListener('click',onTake);
 for(const button of host.querySelectorAll('[data-outlook-item]'))button.addEventListener('click',()=>{const item=items.find(item=>item.id===button.dataset.outlookItem);if(item)onItem(item);});
}
export function openOutlookNote(title,texts){
 let dialog=document.getElementById('weather-note-dialog');
 if(!dialog){dialog=document.createElement('dialog');dialog.id='weather-note-dialog';dialog.className='weather-note-dialog';dialog.setAttribute('aria-labelledby','weather-note-title');dialog.innerHTML='<button type="button" aria-label="Close weather details">×</button><h2 id="weather-note-title"></h2><div class="weather-note-content"></div>';dialog.querySelector('button').addEventListener('click',()=>dialog.close());document.body.append(dialog);}
 dialog.querySelector('h2').textContent=title;
 dialog.querySelector('.weather-note-content').innerHTML=texts.filter(Boolean).map(text=>`<p>${esc(text)}</p>`).join('');
 if(!dialog.open)dialog.showModal();
}
