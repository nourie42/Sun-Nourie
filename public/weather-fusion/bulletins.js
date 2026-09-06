import {bulletinFacts,BULLETIN_GROUPS} from './bulletin-facts.js?v=2-special';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderBulletins(forecast,result=null,now=Date.now()){
 const root=document.getElementById('alerts'),panel=document.getElementById('nws-bulletins');if(!root)return;
 const items=bulletinFacts(forecast,now),status=forecast.feeds?.find(f=>f.id==='alerts')?.status;
 const discussionStatus=forecast.feeds?.find(f=>f.id==='special-discussions')?.status;
 if(panel)panel.hidden=!items.length&&status==='ready'&&discussionStatus==='ready';
 const open=new Set([...root.querySelectorAll('details[open]')].map(d=>d.dataset.bulletinId));
 const summaries=result?.signature===forecast.signature&&result?.mode==='ai'?result.summaries||[]:[];
 const time=value=>{const t=Date.parse(value);return Number.isFinite(t)?new Intl.DateTimeFormat('en-US',{timeZone:forecast.location?.timeZone||'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t)):'unavailable';};
 const counts=Object.entries(BULLETIN_GROUPS).map(([kind,label])=>{const count=items.filter(x=>x.kind===kind).length;return count?`<span class="bulletin-count count-${kind}">${esc(label)} <strong>${count}</strong></span>`:'';}).join('');
 const notes=(status!=='ready'?'<p class="bulletin-unavailable">Live alert status is unavailable or stale. An empty list does not establish that there are no warnings. Check the NWS.</p>':'')+(discussionStatus!=='ready'?'<p class="bulletin-unavailable">The special-discussion feed is unavailable or stale. Routine forecast discussions are not listed here.</p>':'');
 root.innerHTML=`${counts?`<div class="bulletin-counts">${counts}</div>`:''}${notes}${items.map(item=>{
  const summary=summaries.find(s=>s.id===item.id&&s.sourceKey===item.sourceKey);
  const fallback=item.kind==='discussion'?(result?'AI summary unavailable. The complete official discussion is below.':'Preparing a plain-language explanation of the special weather discussion…'):item.description.slice(0,650)+(item.description.length>650?'…':'');
  return `<article class="bulletin-item bulletin-${item.kind}"><h3>${esc(item.title)}</h3><p class="bulletin-area">${esc(item.area)}</p><p class="bulletin-time">${item.kind==='discussion'?'Valid from':'Issued'} ${esc(time(item.issuedAt))}${item.expires?` · expires ${esc(time(item.expires))}`:''}</p><span class="bulletin-mode">${summary?'AI plain-language summary':item.kind==='discussion'?'NWS special weather discussion':'Official NWS wording'}</span><p class="bulletin-summary">${esc(summary?.summary||fallback)}</p>${item.instruction?`<p class="bulletin-instruction"><strong>Official instructions:</strong> ${esc(item.instruction)}</p>`:''}<details data-bulletin-id="${esc(item.id)}"${open.has(item.id)?' open':''}><summary>Read the complete official bulletin</summary>${item.headline?`<p>${esc(item.headline)}</p>`:''}<pre>${esc(item.description)}</pre>${item.instruction?`<p>${esc(item.instruction)}</p>`:''}</details><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Original NWS source ↗</a></article>`;
 }).join('')}${!items.length&&status==='ready'?'<p class="bulletin-time">No active notices were returned for this point at the latest check.</p>':''}<p class="bulletin-footnote">Official NWS alerts and instructions take priority over the AI explanation. Checked ${esc(time(forecast.assembledAt))}.</p>`;
}
