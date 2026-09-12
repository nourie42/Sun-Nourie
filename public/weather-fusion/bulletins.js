import {bulletinFacts,BULLETIN_GROUPS} from './bulletin-facts.js?v=convective-sigmet-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderBulletins(forecast,result=null,now=Date.now()){
 const root=document.getElementById('alerts'),panel=document.getElementById('nws-bulletins');if(!root)return;
 const items=bulletinFacts(forecast,now),status=forecast.feeds?.find(f=>f.id==='alerts')?.status;
 const discussionStatus=forecast.feeds?.find(f=>f.id==='special-discussions')?.status;
 const sigmetStatus=forecast.feeds?.find(f=>f.id==='convective-sigmets')?.status;
 // The bulletin card is message-driven, not feed-health-driven. Source outages still
 // appear in Scientific Stuff, but an empty alert/special-discussion list shows no card.
 if(panel)panel.hidden=!items.length;
 const summaries=result?.signature===forecast.signature&&result?.mode==='ai'?result.summaries||[]:[];
 const time=value=>{const t=Date.parse(value);return Number.isFinite(t)?new Intl.DateTimeFormat('en-US',{timeZone:forecast.location?.timeZone||'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t)):'unavailable';};
 const notes=(status!=='ready'?'<p class="bulletin-unavailable">Live alert status is unavailable or stale. An empty list does not establish that there are no warnings. Check the NWS.</p>':'')+(discussionStatus!=='ready'?'<p class="bulletin-unavailable">The special-discussion feed is unavailable or stale. Routine forecast discussions are not listed here.</p>':'')+(sigmetStatus!=='ready'?'<p class="bulletin-unavailable">The Convective SIGMET feed is unavailable or stale. Public NWS alerts are checked separately.</p>':'');
 root.innerHTML=`${notes}${items.map((item,index)=>`<button type="button" class="bulletin-banner bulletin-${item.kind}" data-bulletin-index="${index}" aria-haspopup="dialog"><span class="bulletin-symbol" aria-hidden="true">!</span><span class="bulletin-banner-copy"><strong>${esc(item.title)}</strong><small>${esc(item.area)}${item.expires?` · Until ${esc(time(item.expires))}`:''}</small></span><span class="bulletin-banner-action">View <b aria-hidden="true">›</b></span></button>`).join('')}`;
 const dialog=document.getElementById('bulletin-dialog'),content=document.getElementById('bulletin-dialog-content');
 root.querySelectorAll('[data-bulletin-index]').forEach(button=>button.addEventListener('click',()=>{
  const item=items[Number(button.dataset.bulletinIndex)];if(!item||!dialog||!content)return;
  const summary=summaries.find(s=>s.id===item.id&&s.sourceKey===item.sourceKey);
  content.innerHTML=`<div class="dialog-eyebrow">${esc(BULLETIN_GROUPS[item.kind]||'NWS bulletin')}</div><h2 id="bulletin-dialog-title" class="dialog-title">${esc(item.title)}</h2><p class="dialog-condition">${esc(item.area)}</p><p class="bulletin-dialog-time">${item.kind==='discussion'?'Valid from':'Issued'} ${esc(time(item.issuedAt))}${item.expires?` · expires ${esc(time(item.expires))}`:''}</p>${summary?`<div class="bulletin-dialog-summary"><strong>Quick summary</strong><p>${esc(summary.summary)}</p></div>`:''}${item.instruction?`<div class="bulletin-dialog-instruction"><strong>Official instructions</strong><p>${esc(item.instruction)}</p></div>`:''}<h3 class="dialog-subtitle">Complete official wording</h3>${item.headline?`<p class="dialog-prose">${esc(item.headline)}</p>`:''}<pre class="bulletin-dialog-wording">${esc(item.description)}</pre><a class="bulletin-dialog-source" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Open original NWS bulletin ↗</a>`;
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
