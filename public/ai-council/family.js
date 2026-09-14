const root=document.documentElement;
const member=root.dataset.member||'Family';
const slug=member.toLowerCase();
const STORAGE=`ai-family-vault-${slug}-v1`;
const COLORS=['#1687ff','#ff2146','#00c877','#8b46ff','#ff6d00','#9a6238','#f2ca36','#ff72b6'];
const TOOL_DEFS={
  gmail:{label:'Gmail',icon:'✉',description:'Allow Gmail access after this page is connected to Google.'},
  browser:{label:'Browser',icon:'◎',description:'Allow a remote browser/computer after one is connected.'},
  shopping:{label:'Shopping / Cart',icon:'🛒',description:'Allow product research and cart actions. Checkout always requires approval.'},
};
const te=new TextEncoder(),td=new TextDecoder();
let providers=[],vault=null,secret='',activeBot=null,selectedColor=COLORS[0],editingId=null;
const $=id=>document.getElementById(id);
const els={lock:$('lock'),setup:$('setup'),unlock:$('unlock'),workspace:$('workspace'),setupSecret:$('setup-secret'),setupConfirm:$('setup-confirm'),ownerCode:$('owner-code'),unlockSecret:$('unlock-secret'),lockError:$('lock-error'),bots:$('bots'),messages:$('messages'),composer:$('composer'),prompt:$('prompt'),send:$('send'),chatTitle:$('chat-title'),chatRole:$('chat-role'),chatView:$('chat-view'),botsView:$('bots-view'),sheet:$('sheet'),sheetBack:$('sheet-back'),botName:$('bot-name'),botRole:$('bot-role'),botProvider:$('bot-provider'),botInstructions:$('bot-instructions'),palette:$('palette'),sheetTitle:$('sheet-title'),deleteBot:$('delete-bot'),providerStatus:$('provider-status')};

function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes)))}
function unb64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
function rand(n=16){return crypto.getRandomValues(new Uint8Array(n))}
async function derive(pass,salt){const base=await crypto.subtle.importKey('raw',te.encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:180000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function seal(obj,pass,salt=rand()){const iv=rand(12),key=await derive(pass,salt),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,te.encode(JSON.stringify(obj)));return{salt:b64(salt),iv:b64(iv),cipher:b64(cipher)}}
async function openVault(record,pass){const key=await derive(pass,unb64(record.salt));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(record.iv)},key,unb64(record.cipher));return JSON.parse(td.decode(plain))}
function stored(){try{return JSON.parse(localStorage.getItem(STORAGE)||'null')}catch{return null}}
async function save(){if(!vault||!secret)return;localStorage.setItem(STORAGE,JSON.stringify(await seal(vault,secret)))}
function show(el,on=true){el?.classList.toggle('hidden',!on)}
function err(t=''){els.lockError.textContent=t}
function now(){return Date.now()}
function fmt(t){if(!t)return'';const d=new Date(t),n=new Date();if(d.toDateString()===n.toDateString())return d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});return d.toLocaleDateString([],{weekday:'short'})}
function id(){return `bot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`}
function configured(id){return providers.some(p=>p.id===id&&p.configured)}
function normalizeTools(tools){return{gmail:!!tools?.gmail,browser:!!tools?.browser,shopping:!!tools?.shopping}}
function enabledTools(bot){const tools=normalizeTools(bot?.tools);return Object.keys(TOOL_DEFS).filter(key=>tools[key])}
function toolSummary(bot){const keys=enabledTools(bot);if(!keys.length)return'';return keys.map(key=>`${TOOL_DEFS[key].icon} ${TOOL_DEFS[key].label}`).join(' · ')}

function ensureToolUi(){
  if(document.getElementById('family-tool-style'))return;
  const style=document.createElement('style');style.id='family-tool-style';style.textContent=`
    .toolPanel{margin:16px 0 4px;padding:14px;border:1px solid #303037;border-radius:16px;background:#111115}
    .toolPanelTitle{font-weight:900;font-size:14px;margin-bottom:4px}.toolPanelIntro{color:#777780;font-size:11px;line-height:1.45;margin-bottom:10px}
    .toolToggle{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;padding:10px 0;border-top:1px solid #26262c}
    .toolToggle:first-of-type{border-top:0}.toolToggle input{margin-top:4px;accent-color:var(--member,#1687ff)}
    .toolToggle b{display:block;font-size:12px}.toolToggle small{display:block;color:#777780;font-size:10px;line-height:1.4;margin-top:2px}.toolToggle small.ready{color:#79dba7}.toolToggle small.warn{color:#e0b45b}
    .toolBadges{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.toolBadge{font-size:9px;padding:3px 6px;border:1px solid #35353c;border-radius:999px;color:#a7a7af;background:#151519}
    .toolNotice{margin:9px 0;padding:9px 11px;border:1px solid #313138;border-radius:12px;color:#a7a7af;background:#151519;font-size:10px;line-height:1.45}
    .sourceList{margin-top:7px;padding-top:7px;border-top:1px solid #2a2a30}.sourceList a{display:block;color:#79b9ff;font-size:10px;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px}
  `;document.head.appendChild(style);
  const actions=els.sheet?.querySelector('.actions');if(!actions)return;
  const panel=document.createElement('div');panel.className='toolPanel';panel.id='tool-panel';
  panel.innerHTML=`<div class="toolPanelTitle">Tools & Permissions</div><div class="toolPanelIntro">Tools are off by default. Turn on only what this bot should be allowed to use.</div>`+
    Object.entries(TOOL_DEFS).map(([key,tool])=>`<label class="toolToggle"><input id="tool-${key}" type="checkbox"><span><b>${tool.icon} ${tool.label}</b><small id="tool-${key}-status">${tool.description}</small></span></label>`).join('');
  actions.parentNode.insertBefore(panel,actions);
  refreshToolStatuses();
}
function refreshToolStatuses(){
  const gmail=$('tool-gmail-status');if(gmail){gmail.textContent='Permission can be saved now · Google OAuth connection is still required';gmail.className='warn'}
  const browser=$('tool-browser-status');if(browser){browser.textContent='Permission can be saved now · remote browser service is still required';browser.className='warn'}
  const shopping=$('tool-shopping-status');if(shopping){shopping.textContent='Product research can use Web Search · cart/checkout needs browser connection and explicit approval';shopping.className='warn'}
}
function readToolForm(){return Object.fromEntries(Object.keys(TOOL_DEFS).map(key=>[key,!!$(`tool-${key}`)?.checked]))}
function writeToolForm(tools){const normalized=normalizeTools(tools);for(const key of Object.keys(TOOL_DEFS)){const input=$(`tool-${key}`);if(input)input.checked=normalized[key]}}

async function loadStatus(){
  try{const r=await fetch('/api/ai-council/status',{cache:'no-store'});const d=await r.json();providers=Array.isArray(d.providers)?d.providers:[];els.providerStatus.textContent=`${providers.filter(p=>p.configured).length} AI providers connected`;}
  catch{providers=[];els.providerStatus.textContent='Provider status unavailable'}
  populateProviders();refreshToolStatuses();
}
function populateProviders(preferred){els.botProvider.replaceChildren();for(const p of providers){const o=document.createElement('option');o.value=p.id;o.disabled=!p.configured;o.textContent=`${p.label}${p.configured?` · ${p.model}`:' — not connected'}`;els.botProvider.append(o)}const fallback=providers.find(p=>p.configured)?.id||providers[0]?.id||'';els.botProvider.value=preferred&&providers.some(p=>p.id===preferred)?preferred:fallback}
function initLock(){const exists=!!stored();show(els.setup,!exists);show(els.unlock,exists);show(els.lock,true);show(els.workspace,false)}
async function createVault(){const a=els.setupSecret.value,b=els.setupConfirm.value,owner=els.ownerCode.value.trim();if(a.length<6)return err('Use at least 6 characters for the secret key.');if(a!==b)return err('The secret keys do not match.');if(!owner)return err('Enter the owner access code once to authorize this page.');try{const r=await fetch('/api/ai-council/ask',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':owner},body:JSON.stringify({question:'Reply with OK only.',providers:[providers.find(p=>p.configured)?.id].filter(Boolean)})});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'Owner code was not accepted.')}secret=a;vault={member,ownerCode:owner,bots:[],chats:{},createdAt:now()};await save();unlockUi();}catch(e){err(e.message||'Could not create this private page.')}}
async function unlock(){const record=stored(),pass=els.unlockSecret.value;if(!record)return initLock();try{vault=await openVault(record,pass);secret=pass;vault.bots=(vault.bots||[]).map(bot=>({...bot,provider:bot.provider==='perplexity'?'openai':bot.provider,tools:normalizeTools(bot.tools)}));vault.chats=vault.chats||{};unlockUi()}catch{err('That secret key is not correct.')}}
function unlockUi(){err('');show(els.lock,false);show(els.workspace,true);vault.searchHistory??={};ensureAiSearch();renderBots();showFamilyAiSearch()}
function lock(){vault=null;secret='';activeBot=null;els.unlockSecret.value='';show(els.workspace,false);document.getElementById('familyAiComposer')?.remove();initLock()}

function ensureAiSearch(){if(document.getElementById('family-ai-search'))return;const style=document.createElement('style');style.textContent='.familyAiNav{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px}.familyAiNav button,.familyAiNav a{border:1px solid #303036;background:#17171b;color:#aaa;border-radius:999px;padding:9px 11px;font-size:11px;font-weight:850;text-decoration:none}.familyAiNav .active{background:#f2f2f4;color:#111}.familyAiSearch h1{font-size:clamp(32px,7vw,52px);letter-spacing:-.05em;margin:14px 0 6px}.familyAiSearch p{color:#8e8e97}.familyAiProviders{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:16px 0}.familyAiProvider{border:1px solid #303036;background:#151518;color:#bbb;border-radius:15px;padding:12px 9px;text-align:left}.familyAiProvider strong{display:block;color:#fff}.familyAiProvider small{display:block;color:#73737b;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.familyAiProvider.active{border-color:#666674;background:#222228}.familyAiProvider.off{opacity:.4}.familyAiMessages{display:flex;flex-direction:column;gap:10px;padding:8px 0 130px}.familyAiMsg{max-width:90%;padding:12px 14px;border-radius:17px;white-space:pre-wrap;line-height:1.5;font-size:14px}.familyAiMsg.user{align-self:flex-end;background:#f2f2f4;color:#111}.familyAiMsg.ai{align-self:flex-start;background:#18181c;border:1px solid #292930}.familyAiComposer{position:fixed;left:50%;bottom:max(10px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(760px,calc(100% - 16px));background:rgba(21,21,24,.97);border:1px solid #303037;border-radius:22px;padding:9px;z-index:30;display:grid;grid-template-columns:1fr auto;gap:8px}.familyAiComposer textarea{border:0;outline:0;background:transparent;color:#fff;resize:none;padding:11px;min-height:48px}.familyAiComposer button{width:48px;height:48px;border:0;border-radius:15px;background:#f2f2f4;color:#111;font-weight:950;font-size:20px}@media(max-width:620px){.familyAiProviders{grid-template-columns:1fr 1fr}}';document.head.append(style);const nav=document.createElement('div');nav.className='familyAiNav';nav.innerHTML='<button id="familyAiSearchTab" class="active">AI Search</button><button id="familyAiBotsTab">My Bots</button><a href="/ai-council/?mode=council">AI Council</a>';els.workspace.querySelector('.top').insertAdjacentElement('afterend',nav);const v=document.createElement('section');v.id='family-ai-search';v.className='familyAiSearch';v.innerHTML='<h1>Ask one AI.</h1><p>Choose OpenAI, Claude, Gemini, or Grok and ask your question.</p><div class="familyAiProviders" id="familyAiProviders"></div><div class="familyAiMessages" id="familyAiMessages"></div>';nav.insertAdjacentElement('afterend',v);const c=document.createElement('div');c.id='familyAiComposer';c.className='familyAiComposer';c.innerHTML='<textarea id="familyAiPrompt" placeholder="Ask anything…"></textarea><button id="familyAiSend">↑</button>';document.body.append(c);window.familyAiSelected='openai';document.getElementById('familyAiSearchTab').onclick=showFamilyAiSearch;document.getElementById('familyAiBotsTab').onclick=showBots;document.getElementById('familyAiSend').onclick=sendFamilyAi;document.getElementById('familyAiPrompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendFamilyAi()}});renderFamilyAiProviders()}
function renderFamilyAiProviders(){const r=document.getElementById('familyAiProviders');if(!r)return;const ids=['openai','anthropic','gemini','xai'],names={openai:'OpenAI',anthropic:'Claude',gemini:'Gemini',xai:'Grok'};r.replaceChildren();for(const id of ids){const p=providers.find(x=>x.id===id),b=document.createElement('button');b.className='familyAiProvider'+(window.familyAiSelected===id?' active':'')+(!p?.configured?' off':'');b.disabled=!p?.configured;b.innerHTML='<strong>'+names[id]+'</strong><small>'+(p?.configured?p.model:'Not connected')+'</small>';b.onclick=()=>{window.familyAiSelected=id;renderFamilyAiProviders();renderFamilyAiMessages()};r.append(b)}if(!providers.find(p=>p.id===window.familyAiSelected&&p.configured)){const x=providers.find(p=>ids.includes(p.id)&&p.configured);if(x){window.familyAiSelected=x.id;renderFamilyAiProviders()}}}
function renderFamilyAiMessages(){const r=document.getElementById('familyAiMessages');if(!r||!vault)return;vault.searchHistory??={};r.replaceChildren();for(const m of vault.searchHistory[window.familyAiSelected]||[]){const d=document.createElement('div');d.className='familyAiMsg '+(m.role==='user'?'user':'ai');d.textContent=m.text;r.append(d)}}
async function sendFamilyAi(){const q=document.getElementById('familyAiPrompt')?.value.trim(),id=window.familyAiSelected,p=providers.find(x=>x.id===id&&x.configured);if(!q||!p||!vault)return;vault.searchHistory??={};vault.searchHistory[id]??=[];vault.searchHistory[id].push({role:'user',text:q,at:Date.now()});document.getElementById('familyAiPrompt').value='';renderFamilyAiMessages();await save();try{const names={openai:'OpenAI',anthropic:'Claude',gemini:'Gemini',xai:'Grok'},transcript=vault.searchHistory[id].slice(-12).map(m=>(m.role==='user'?'User':names[id])+': '+m.text).join('\n\n'),r=await fetch('/api/ai-council/ask',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':vault.ownerCode},body:JSON.stringify({question:'You are '+names[id]+'. Continue this conversation naturally.\n\n'+transcript,providers:[id]})}),d=await r.json().catch(()=>({})),a=(d.answers||[]).find(x=>x.id===id&&x.ok);if(!r.ok||!a)throw new Error((d.answers||[])[0]?.error||d.error||'AI request failed.');vault.searchHistory[id].push({role:'ai',text:a.text,at:Date.now()})}catch(e){vault.searchHistory[id].push({role:'ai',text:'Error: '+e.message,at:Date.now()})}await save();renderFamilyAiMessages()}
function showFamilyAiSearch(){activeBot=null;show(document.getElementById('family-ai-search'),true);show(els.botsView,false);show(els.chatView,false);show(els.composer,false);show(document.getElementById('familyAiComposer'),true);document.getElementById('familyAiSearchTab')?.classList.add('active');document.getElementById('familyAiBotsTab')?.classList.remove('active');renderFamilyAiMessages()}


function renderBots(){
  els.bots.replaceChildren();const bots=vault?.bots||[];
  if(!bots.length){const e=document.createElement('div');e.className='empty';e.innerHTML='<strong>No bots yet</strong>Create a private bot for this page.';els.bots.append(e);return}
  for(const bot of bots){
    const row=document.createElement('div');row.className='botRow';
    const icon=document.createElement('div');icon.className='botIcon';icon.style.setProperty('--bot',bot.color||COLORS[0]);icon.textContent=(bot.name||'AI').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
    const main=document.createElement('div');const name=document.createElement('div');name.className='botName';name.textContent=bot.name;const last=(vault.chats?.[bot.id]||[]).at(-1);const prev=document.createElement('div');prev.className='botPreview';prev.textContent=last?.text||bot.role||'Ready';main.append(name,prev);
    const toolKeys=enabledTools(bot);if(toolKeys.length){const badges=document.createElement('div');badges.className='toolBadges';toolKeys.forEach(key=>{const badge=document.createElement('span');badge.className='toolBadge';badge.textContent=`${TOOL_DEFS[key].icon} ${TOOL_DEFS[key].label}`;badges.append(badge)});main.append(badges)}
    const time=document.createElement('div');time.className='botTime';time.textContent=fmt(last?.at);row.append(icon,main,time);row.onclick=()=>openChat(bot.id);row.oncontextmenu=e=>{e.preventDefault();openEditor(bot.id)};els.bots.append(row)
  }
}
function showBots(){activeBot=null;show(document.getElementById('family-ai-search'),false);show(els.botsView,true);show(els.chatView,false);show(els.composer,false);show(document.getElementById('familyAiComposer'),false);document.getElementById('familyAiSearchTab')?.classList.remove('active');document.getElementById('familyAiBotsTab')?.classList.add('active');renderBots()}
function openChat(botId){activeBot=vault.bots.find(b=>b.id===botId);if(!activeBot)return;show(document.getElementById('family-ai-search'),false);show(document.getElementById('familyAiComposer'),false);els.chatTitle.textContent=activeBot.name;const tools=toolSummary(activeBot);els.chatRole.textContent=`${activeBot.role||'General expert'} · ${providers.find(p=>p.id===activeBot.provider)?.label||activeBot.provider}${tools?` · ${tools}`:''}`;show(els.botsView,false);show(els.chatView,true);show(els.composer,true);renderMessages();setTimeout(()=>els.prompt.focus(),50)}
function renderMessages(){els.messages.replaceChildren();for(const m of vault.chats?.[activeBot.id]||[]){const wrap=document.createElement('div');const div=document.createElement('div');div.className=`msg ${m.role==='user'?'user':'bot'}`;div.textContent=m.text;wrap.append(div);if(Array.isArray(m.citations)&&m.citations.length){const sources=document.createElement('div');sources.className='sourceList';m.citations.slice(0,8).forEach((url,i)=>{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=`Source ${i+1}: ${url}`;sources.append(a)});wrap.append(sources)}els.messages.append(wrap)}window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})}

async function callAsk(provider,question){
  const r=await fetch('/api/ai-council/ask',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':vault.ownerCode},body:JSON.stringify({question,providers:[provider]})});
  const d=await r.json().catch(()=>({}));const a=d.answers?.find(x=>x.id===provider);if(!r.ok||!a?.ok)throw new Error(a?.error||d.error||'Bot request failed.');return a;
}
async function liveResearch(userText){
  if(!configured('perplexity'))return{warning:'Web Search is enabled, but Perplexity is not connected on the server.',text:'',citations:[]};
  const prompt=[
    'Search the live web for current information needed to answer the user request below.',
    'Return concise factual findings. Prefer authoritative or primary sources when possible.',
    'Do not answer as the custom bot; only provide research notes for another model.',
    `User request: ${userText}`,
  ].join('\n\n');
  const answer=await callAsk('perplexity',prompt);return{text:answer.text||'',citations:answer.citations||[],warning:''};
}
function toolContext(bot,research){
  const tools=normalizeTools(bot.tools),parts=[];
  if(tools.webSearch){if(research?.text)parts.push(`LIVE WEB RESEARCH (use this as current external context; verify conflicts):\n${research.text}\nSources:\n${(research.citations||[]).join('\n')}`);else if(research?.warning)parts.push(`WEB SEARCH STATUS: ${research.warning}`)}
  if(tools.gmail)parts.push('GMAIL PERMISSION: Enabled for this bot, but no Gmail OAuth account connection is wired into this site yet. Do not claim to have read, searched, drafted, or sent email. If Gmail data is needed, clearly say the Gmail connection must be completed first.');
  if(tools.browser)parts.push('BROWSER PERMISSION: Enabled for this bot, but no remote browser/computer service is connected yet. Do not claim you opened a site, clicked, typed, downloaded, or completed any browser action.');
  if(tools.shopping)parts.push('SHOPPING PERMISSION: Enabled. You may research products using available web research. Cart or checkout actions require a connected browser and explicit user approval. Never claim an item was added to a cart or purchased unless an actual browser tool confirms it.');
  return parts.join('\n\n');
}
async function send(){
  const text=els.prompt.value.trim();if(!text||!activeBot)return;els.prompt.value='';vault.chats[activeBot.id]??=[];vault.chats[activeBot.id].push({role:'user',text,at:now()});renderMessages();els.send.disabled=true;
  try{
    let research={text:'',citations:[],warning:''};
    const tools=normalizeTools(activeBot.tools);
    if(tools.webSearch&&activeBot.provider!=='perplexity'){
      try{research=await liveResearch(text)}catch(e){research={text:'',citations:[],warning:`Live search failed: ${e.message||e}`}}
    }
    const history=vault.chats[activeBot.id].slice(-12).map(m=>`${m.role==='user'?'User':activeBot.name}: ${m.text}`).join('\n\n');
    const context=toolContext(activeBot,research);
    const question=[
      `You are ${activeBot.name}.`,
      `Role: ${activeBot.role}.`,
      `Custom instructions: ${activeBot.instructions}`,
      context,
      `Conversation:\n${history}`,
      `Respond as ${activeBot.name}.`,
    ].filter(Boolean).join('\n\n');
    const a=await callAsk(activeBot.provider,question);
    const citations=[...(a.citations||[]),...(research.citations||[])].filter((url,i,all)=>url&&all.indexOf(url)===i).slice(0,12);
    vault.chats[activeBot.id].push({role:'assistant',text:a.text,at:now(),citations});await save();renderMessages();
  }catch(e){vault.chats[activeBot.id].push({role:'assistant',text:`Error: ${e.message}`,at:now()});await save();renderMessages();}
  finally{els.send.disabled=false}
}

function openEditor(botId=null){editingId=botId;const b=vault.bots.find(x=>x.id===botId);els.sheetTitle.textContent=b?'Edit Bot':'Create Bot';els.botName.value=b?.name||'';els.botRole.value=b?.role||'';els.botInstructions.value=b?.instructions||'';selectedColor=b?.color||COLORS[vault.bots.length%COLORS.length];populateProviders(b?.provider);writeToolForm(b?.tools);els.deleteBot.classList.toggle('hidden',!b);renderPalette();els.sheetBack.classList.add('show');els.sheet.classList.add('show')}
function closeEditor(){els.sheetBack.classList.remove('show');els.sheet.classList.remove('show');editingId=null}
function renderPalette(){els.palette.replaceChildren();for(const c of COLORS){const b=document.createElement('button');b.type='button';b.className=`color${c===selectedColor?' active':''}`;b.style.background=c;b.onclick=()=>{selectedColor=c;renderPalette()};els.palette.append(b)}}
async function saveBot(){const name=els.botName.value.trim(),provider=els.botProvider.value;if(!name||!provider)return;const record={id:editingId||id(),name,role:els.botRole.value.trim()||'General expert',instructions:els.botInstructions.value.trim()||'Be accurate, useful, and concise.',provider,color:selectedColor,tools:readToolForm()};const i=vault.bots.findIndex(b=>b.id===record.id);if(i>=0)vault.bots[i]=record;else vault.bots.unshift(record);vault.chats[record.id]??=[];await save();closeEditor();renderBots();if(activeBot?.id===record.id)activeBot=record}
async function deleteBot(){if(!editingId)return;const b=vault.bots.find(x=>x.id===editingId);if(!confirm(`Delete ${b?.name||'this bot'}?`))return;vault.bots=vault.bots.filter(x=>x.id!==editingId);delete vault.chats[editingId];await save();closeEditor();showBots()}
async function changeKey(){const next=prompt('Enter a new secret key (at least 6 characters):');if(!next||next.length<6)return;secret=next;await save();alert('Secret key changed for this device.')}

document.addEventListener('DOMContentLoaded',()=>{
  ensureToolUi();
  document.querySelectorAll('[data-member-name]').forEach(e=>e.textContent=member);
  $('create-vault').onclick=createVault;$('unlock-btn').onclick=unlock;$('lock-btn').onclick=lock;$('new-bot').onclick=()=>openEditor();$('back-bots').onclick=showBots;$('edit-active').onclick=()=>activeBot&&openEditor(activeBot.id);$('save-bot').onclick=saveBot;$('delete-bot').onclick=deleteBot;$('cancel-bot').onclick=closeEditor;els.sheetBack.onclick=closeEditor;els.send.onclick=send;els.prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});$('change-key').onclick=changeKey;initLock();loadStatus();
});