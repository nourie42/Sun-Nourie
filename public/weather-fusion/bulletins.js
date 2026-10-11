import {bulletinFacts,BULLETIN_GROUPS} from './bulletin-facts.js?v=county-warnings-v1';
import {alertHealth} from './live-alerts.js?v=county-warnings-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderBulletins(forecast,result=null,now=Date.now()){
 const root=document.getElementById('alerts'),panel=document.getElementById('nws-bulletins');if(!root)return;
 const items=bulletinFacts(forecast,now),status=forecast.feeds?.find(f=>f.id==='alerts')?.status;
 const health=alertHealth(forecast,now),urgent=document.getElementById('urgent-alerts');
 const time=value=>{const t=Date.parse(value);return Number.isFinite(t)?new Intl.DateTimeFormat('en-US',{timeZone:forecast.location?.timeZone||'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t)):'unavailable';};
 const scope=item=>item.scope==='county'?'County warning - check the official warning area':'NWS alert for the selected location';
 const detection=item=>item.emergency?'NWS Tornado Emergency':item.detection==='OBSERVED'?'NWS reports an observed tornado in this warning area':item.detection==='RADAR INDICATED'?'NWS reports a radar-indicated tornado':item.detection==='POSSIBLE'?'NWS says a tornado is possible':'';
 if(urgent){
  const warnings=items.filter(item=>item.kind==='warning');
  const priority=warnings.length?warnings:items.filter(item=>/tornado watch/i.test(item.title));
  urgent.hidden=!priority.length&&health.verified;
  urgent.innerHTML=(!health.verified?`<p class="urgent-alert-status">${esc(health.message)} <a href="https://www.weather.gov/" target="_blank" rel="noopener noreferrer">Official NWS warnings</a></p>`:'')+priority.map(item=>`<button type="button" class="urgent-alert${item.kind==='watch'?' urgent-alert-watch':''}" data-urgent-id="${esc(item.id)}" aria-haspopup="dialog"><strong>${esc(item.emergency?'Tornado Emergency':item.title)}</strong><span>${esc(scope(item))} · ${esc(item.area)}</span>${detection(item)?`<span class="urgent-alert-detection">${esc(detection(item))}</span>`:''}<span>${esc(item.instruction||(/tornado warning/i.test(item.title)?'If you are in the warning area, take shelter now in an interior room on the lowest floor, away from windows.':item.kind==='watch'?'Be ready to take shelter if a warning is issued.':'Follow the official NWS warning instructions.'))}</span><span class="urgent-alert-time">Until ${esc(time(item.expires))} · ${health.verified?'Checked':'Last verified'} ${esc(time(forecast.feeds?.find(f=>f.id==='alerts')?.fetchedAt))} · Open official details</span></button>`).join('');
  urgent.querySelectorAll('[data-urgent-id]').forEach(button=>button.addEventListener('click',()=>{const index=items.findIndex(item=>item.id===button.dataset.urgentId);root.querySelector(`[data-bulletin-index="${index}"]`)?.click();}));
 }
 const discussionStatus=forecast.feeds?.find(f=>f.id==='special-discussions')?.status;
 const precipitationDiscussionStatus=forecast.feeds?.find(f=>f.id==='precipitation-discussions')?.status;
 // The bulletin card is message-driven, not feed-health-driven. Source outages still
 // appear in Scientific Stuff, but an empty alert/special-discussion list shows no card.
 if(panel)panel.hidden=!items.length;
 const summaries=result?.signature===forecast.signature&&result?.mode==='ai'?result.summaries||[]:[];
 const notes=(status!=='ready'?'<p class="bulletin-unavailable">Live alert status is unavailable or stale. An empty list does not establish that there are no warnings. Check the NWS.</p>':'')+(discussionStatus!=='ready'?'<p class="bulletin-unavailable">The special-discussion feed is unavailable or stale. Routine forecast discussions are not listed here.</p>':'')+(precipitationDiscussionStatus!=='ready'?'<p class="bulletin-unavailable">The heavy-rain discussion feed is unavailable or stale. Public NWS alerts are checked separately.</p>':'');
 root.innerHTML=`${notes}${items.map((item,index)=>`<button type="button" class="bulletin-banner bulletin-${item.kind}" data-bulletin-index="${index}" aria-haspopup="dialog"><span class="bulletin-symbol" aria-hidden="true">!</span><span class="bulletin-banner-copy"><strong>${esc(item.title)}</strong>${item.scope==='county'?`<small class="bulletin-scope">${esc(scope(item))}</small>`:''}${detection(item)?`<small class="bulletin-detection">${esc(detection(item))}</small>`:''}<small>${esc(item.area)}${item.expires?` · Until ${esc(time(item.expires))}`:''}</small></span><span class="bulletin-banner-action">View <b aria-hidden="true">›</b></span></button>`).join('')}`;
 const dialog=document.getElementById('bulletin-dialog'),content=document.getElementById('bulletin-dialog-content');
 root.querySelectorAll('[data-bulletin-index]').forEach(button=>button.addEventListener('click',()=>{
  const item=items[Number(button.dataset.bulletinIndex)];if(!item||!dialog||!content)return;
  const aiSummary=item.kind==='warning'?null:summaries.find(s=>s.id===item.id&&s.sourceKey===item.sourceKey),summary=aiSummary?.summary||item.plainSummary;
  const official=item.kind==='discussion'?`<details class="bulletin-official-details"><summary>Show full official discussion</summary><pre class="bulletin-dialog-wording">${esc(item.description)}</pre></details>`:`<h3 class="dialog-subtitle">Complete official wording</h3>${item.headline?`<p class="dialog-prose">${esc(item.headline)}</p>`:''}<pre class="bulletin-dialog-wording">${esc(item.description)}</pre>`;
  content.innerHTML=`<div class="dialog-eyebrow">${esc(BULLETIN_GROUPS[item.kind]||'NWS bulletin')}</div><h2 id="bulletin-dialog-title" class="dialog-title">${esc(item.title)}</h2><p class="dialog-condition">${esc(item.area)}</p>${item.scope==='county'?`<p>${esc(scope(item))}. This warning is not confirmed to cover the selected point.</p>`:''}${detection(item)?`<p class="bulletin-detection">${esc(detection(item))}</p>`:''}<p class="bulletin-dialog-time">${item.kind==='discussion'?'Valid from':'Issued'} ${esc(time(item.issuedAt))}${item.expires?` · expires ${esc(time(item.expires))}`:''}</p>${summary?`<div class="bulletin-dialog-summary"><strong>What it means</strong><p>${esc(summary)}</p></div>`:''}${item.instruction?`<div class="bulletin-dialog-instruction"><strong>Official instructions</strong><p>${esc(item.instruction)}</p></div>`:''}${official}<a class="bulletin-dialog-source" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Open original NWS bulletin ↗</a>`;
  dialog.dataset.bulletinId=item.id;if(!dialog.open)dialog.showModal();document.body.classList.add('dialog-open');
 }));
 if(dialog?.open&&dialog.dataset.bulletinId&&!items.some(item=>item.id===dialog.dataset.bulletinId))dialog.close();
 if(dialog&&!dialog.dataset.installed){
  dialog.dataset.installed='true';
  document.getElementById('close-bulletin')?.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{delete dialog.dataset.bulletinId;document.body.classList.remove('dialog-open');});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}});
 }
}
