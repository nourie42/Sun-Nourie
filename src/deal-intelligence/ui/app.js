/* Deal Intelligence: dependency-free private acquisition workspace. */
(() => {
'use strict';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const money = (n, compact = false) => n!==null && n!==undefined && Number.isFinite(Number(n)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard' }).format(Number(n)) : '—';
const number = n => n===null || n===undefined || !Number.isFinite(Number(n)) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(n) || 0);
const percent = n => n === null || n === undefined || !Number.isFinite(Number(n)) ? 'N/A' : `${Number(n).toFixed(1)}%`;
const dateLabel = value => { if (!value) return 'No date'; const date = new Date(`${String(value).slice(0,10)}T12:00:00`); return Number.isNaN(date.valueOf()) ? 'Date unknown' : date.toLocaleDateString('en-US', { month:'short',day:'numeric',year:'numeric' }); };
const today = () => new Date().toISOString().slice(0,10);
const stages = ['Research','Ready to contact','Contacted','Interested','NDA','Diligence','Closed','Passed'];
const activeStages = stages.slice(0,6);
const tabs = [
  ['today','Today','M3 10 9 4l6 6v8H5v-8m4 8v-5h4v5'],
  ['hunter','Acquisition hunter','M8 3v4M8 13v4M3 10h4m6 0h4M14 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1z'],
  ['targets','Targets & owners','M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 1a2.5 2.5 0 1 0 0-5m-12 13v-3c0-4 8-4 8 0v3m3-7c3 0 5 1 5 4v3'],
  ['underwriting','Underwriting','M3 2h13v16H3zM6 5h7M6 9h1m4 0h2M6 12h1m4 0h2M6 15h1m4 0h2'],
  ['sites','Site intelligence','M10 18s6-7 6-11a6 6 0 0 0-12 0c0 4 6 11 6 11zm0-14a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  ['pipeline','Pipeline','M2 3h4v14H2zm6 0h4v10H8zm6 0h4v6h-4z'],
  ['briefs','Investment briefs','M4 2h8l4 4v12H4zM12 2v5h4M7 10h6M7 13h6M7 16h4'],
  ['watchtower','Watchtower','M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6zm8-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  ['analyst','Analyst','M4 17V9m6 8V3m6 14v-5M2 18h16']
];
const emptyState = () => ({schemaVersion:1,sampleMode:false,targets:[],sites:[],signals:[],tasks:[],notes:[],documents:[],settings:{targetStates:[],minSites:5,maxSites:35,targetYieldPercent:15,targetIrrPercent:15}});
const defaults = {siteCount:18,annualGallonsPerSite:1300000,fuelMarginCPG:20,merchandiseRevenuePerSite:1200000,merchandiseMarginPercent:30,otherProfitPerSite:15000,opexPerSite:420000,sustainingCapexPerSite:35000,purchasePrice:42000000,realEstateValue:12000000,transactionCostPercent:2,growthPercent:2,terminalMultiple:7,terminalSellingCostPercent:2,targetYieldPercent:15,targetIrrPercent:15,years:10,structure:'COOP',synergyPerSite:0,operatorFuelMarginCPG:null,operatorMerchandiseMarginPercent:null,annualRentPerSite:0,operatorOpexPerSite:null};
let state = emptyState();
let ai = {connected:false,model:''};
let storage = 'browser';
let tab = tabs.some(t => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'today';
let search = '';
let targetFilter = {stage:'',state:'',seller:''};
let selectedFinance = '';
let financeInputs = {...defaults};
let financeResult = null;
let financeFields = [];
let financeTimer;
let saveTimer;
let saveSequence = 0;
let serverVersion;
let saveInFlight=false;
let savePending=false;
let saveConflict=false;
let toastTimer;
let hunterResult = null;
let analystResult = null;
let watchResult = null;
let currentBrief = null;
let aiBusy = false;
let analysisBusy = false;
let importedData = null;
const localKey = 'sun-nourie.deal-intelligence.workspace.v1';

function safeUrl(value) {
  try { const url = new URL(String(value)); return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password ? url.href : ''; } catch { return ''; }
}
function link(url, label) { const valid = safeUrl(url); return valid ? `<a href="${escape(valid)}" target="_blank" rel="noopener noreferrer">${escape(label || new URL(valid).hostname)} ↗</a>` : ''; }
function normalizedState(value) {
  const base = emptyState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  for (const key of ['targets','sites','signals','tasks','notes','documents']) base[key] = Array.isArray(value[key]) ? value[key].filter(v => v && typeof v === 'object') : [];
  base.targets = base.targets.map(t => ({...t,id:String(t.id||uid()),name:String(t.name||t.legalName||'Untitled target'),states:Array.isArray(t.states)?t.states:typeof t.states==='string'?t.states.split(/[,;|]/).map(s=>s.trim()).filter(Boolean):[],stage:stages.includes(t.stage)?t.stage:'Research',sourceUrls:Array.isArray(t.sourceUrls)?t.sourceUrls.filter(safeUrl):[],financials:t.financials&&typeof t.financials==='object'?t.financials:{}}));
  base.settings = {...base.settings,...value.settings};
  base.sampleMode = Boolean(value.sampleMode);
  base.updatedAt = value.updatedAt;
  return base;
}
async function api(path, body, timeout = 90000) {
  if (location.protocol === 'file:') throw new Error('Device-only workspace. Connect the hosted app to use AI research.');
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeout);
  try {
    const apiPath='/api/deal-intelligence'+path.slice(4);
    const response = await fetch(apiPath,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
    const result = await response.json().catch(()=>({error:'The service returned an unreadable response.'}));
    if (!response.ok) {const error=new Error(result.error || `Request failed (${response.status}).`);error.status=response.status;throw error;}
    return result;
  } catch(error) { if(error.name==='AbortError') throw new Error('The request timed out. Your workspace data is still saved locally.'); throw error; }
  finally { clearTimeout(timer); }
}
function localSave() {
  try { localStorage.setItem(localKey,JSON.stringify(state)); return true; }
  catch { toast('This browser could not save data. Export a backup before closing.',true); return false; }
}
function commit(message) {
  state.updatedAt = new Date().toISOString();
  state.sampleMode = state.targets.some(t=>t.sample) || state.sites.some(s=>s.sample) || state.signals.some(s=>s.sample);
  localSave();
  updateShell();
  $('#save-status').textContent = saveConflict?'Local changes not synced · workspace changed elsewhere':'Saving…';
  clearTimeout(saveTimer);
  ++saveSequence;savePending=true;
  saveTimer=setTimeout(flushSave,180);
  if(message)toast(message);
}
async function flushSave() {
  if(saveInFlight||!savePending||saveConflict)return;
  saveInFlight=true;savePending=false;const sequence=saveSequence;const snapshot=JSON.parse(JSON.stringify(state));
  try {
    const saved=await api('/api/state',{state:snapshot,expectedUpdatedAt:serverVersion},12000);
    storage=saved.storage||'durable';serverVersion=saved.state?.updatedAt||saved.updatedAt||serverVersion;if(saved.ai)ai=saved.ai;
    if(sequence===saveSequence){if(serverVersion)state.updatedAt=serverVersion;localSave();$('#save-status').textContent='All changes saved';}
  } catch(error) {
    if(error.status===409){saveConflict=true;$('#save-status').textContent='Local changes not synced · workspace changed elsewhere';toast('Workspace changed elsewhere. Export a full backup of your local edits, then reload to review the latest saved workspace.',true);}
    else {storage='browser';if(sequence===saveSequence)$('#save-status').textContent='Saved on this device';}
  } finally {saveInFlight=false;updateShell();if(savePending&&!saveConflict)flushSave();}
}
function toast(message,error=false) {
  const box=$('#toast');box.textContent=message;box.className=`toast${error?' error':''}`;box.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.hidden=true,5000);
}
function svg(path) { return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${path}"/></svg>`; }
function updateShell() {
  $('#nav').innerHTML=tabs.map(([id,label,path])=>`<button class="nav-item${tab===id?' active':''}" data-nav="${id}" ${tab===id?'aria-current="page"':''}><span class="nav-icon">${svg(path)}</span><span>${label}</span>${id==='targets'?`<span class="nav-count">${state.targets.length}</span>`:id==='watchtower'&&state.signals.length?`<span class="nav-count">${state.signals.length}</span>`:''}</button>`).join('');
  $('#breadcrumb').textContent=tabs.find(t=>t[0]===tab)?.[1]||'Today';
  $('#sample-banner').hidden=!state.sampleMode;
  $('#storage-label').textContent=storage==='durable'?'Saved to private workspace':storage==='server'?'Browser backup + server cache':'Device-only storage';
  const status=$('#ai-status');status.classList.toggle('connected',ai.connected);status.innerHTML=`<span></span>${ai.connected?'AI research connected':'AI research not connected'}`;
  status.title=ai.connected?`Connected${ai.model?` · ${ai.model}`:''}`:'Connect AI to run sourced research. Workspace and underwriting tools work without it.';
}
function navigate(next) {
  if(!tabs.some(t=>t[0]===next))return;
  tab=next;location.hash=next;$('#search-results').hidden=true;$('.sidebar').classList.remove('mobile-open');$('#mobile-menu').setAttribute('aria-expanded','false');updateShell();render();window.scrollTo({top:0,behavior:'instant'});
}
function targetById(id) { return state.targets.find(t=>t.id===id); }
function initials(name) { return String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase(); }
function badge(value,type='') { return `<span class="badge ${type}">${escape(value||'Unknown')}</span>`; }
function sellerBadge(t) { return badge(t.sellerSignal||'Unknown',t.sellerSignal==='Strong'?'green':t.sellerSignal==='Watch'?'yellow':''); }
function sampleBadge(item) { return item?.sample?'<span class="badge sample">Sample</span>':''; }
function targetRow(t) { return `<div class="target-row"><span class="company-mark ${t.sellerSignal==='Strong'?'yellow':''}">${escape(initials(t.name))}</span><div class="target-row-main">${t.id?`<button class="target-name" data-action="target-detail" data-id="${escape(t.id)}">${escape(t.name)}</button>`:`<strong class="target-name">${escape(t.name)}</strong>`}${sampleBadge(t)}<div class="target-meta">${escape(t.states.join(', ')||'Geography unknown')} <span>·</span> ${number(t.siteCount)} sites <span>·</span> ${escape(t.stage)}</div></div><div class="target-row-right">${sellerBadge(t)}<span class="score">${t.score!==null&&t.score!==undefined&&Number.isFinite(Number(t.score))?`${number(t.score)} / 100 score`:'Unscored'}</span></div></div>`; }
function heading(eyebrow,title,description,actions='') { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${actions||`<div class="heading-aside"><strong>${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</strong>Your next opportunity starts here.</div>`}</div>`; }
function empty(title,detail,action='',compact=false) { return `<div class="empty${compact?' compact':''}"><div class="empty-icon" aria-hidden="true">◇</div><h3>${title}</h3><p>${detail}</p>${action}</div>`; }
function metric(label,value,footer,icon='◇',accent=false) { return `<div class="metric-card${accent?' accent':''}"><div class="metric-top"><span class="metric-label">${label}</span><span class="metric-icon" aria-hidden="true">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-footer">${footer}</div></div>`; }
function filteredTargets() {
  const q=search.toLowerCase();return state.targets.filter(t=>(!q||[t.name,t.legalName,t.ownerName,...t.states].join(' ').toLowerCase().includes(q))&&(!targetFilter.stage||t.stage===targetFilter.stage)&&(!targetFilter.state||t.states.includes(targetFilter.state))&&(!targetFilter.seller||t.sellerSignal===targetFilter.seller));
}
function taskRows(tasks) {
  return tasks.map(t=>`<div class="task-row${t.done?' done':''}"><input type="checkbox" data-task="${escape(t.id)}" ${t.done?'checked':''} aria-label="Mark ${escape(t.title)} ${t.done?'incomplete':'complete'}"><div><div class="task-title">${escape(t.title)}</div><div class="task-meta">${escape(targetById(t.targetId)?.name||'Workspace task')}${t.sample?' · Sample':''}</div></div>${t.dueDate?`<span class="task-date">${dateLabel(t.dueDate)}</span>`:''}</div>`).join('');
}
function signalRows(signals) {
  return signals.map(s=>`<div class="signal-row"><span class="signal-dot"></span><div><h3>${escape(s.title)}${sampleBadge(s)}</h3><p>${escape(targetById(s.targetId)?.name||'Workspace')} · ${dateLabel(s.date)} · ${escape(s.confidence||'Unverified')} confidence</p>${s.detail?`<p>${escape(s.detail)}</p>`:''}${link(s.sourceUrl,'View source')}</div></div>`).join('');
}
function render() {
  const views={today:renderToday,hunter:renderHunter,targets:renderTargets,underwriting:renderUnderwriting,sites:renderSites,pipeline:renderPipeline,briefs:renderBriefs,watchtower:renderWatchtower,analyst:renderAnalyst};
  $('#main').innerHTML=views[tab]();
  if(tab==='underwriting'){bindFinance();calculateFinance();}
  if(tab==='pipeline')bindPipeline();
}
function renderToday() {
  const active=state.targets.filter(t=>activeStages.includes(t.stage));
  const siteCount=state.targets.reduce((n,t)=>n+(Number(t.siteCount)||0),0);
  const strong=state.targets.filter(t=>t.sellerSignal==='Strong');
  const tasks=state.tasks.filter(t=>!t.done).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
  const priority=[...active].sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)).slice(0,4);
  const signals=[...state.signals].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,3);
  const sourced=state.targets.filter(t=>t.sourceUrls?.length).length;
  const owners=state.targets.filter(t=>t.ownerName).length;
  return heading('THE DAILY BRIEF','Today’s acquisition desk','A clear view of your opportunities, priorities and next moves.')+
  `<div class="metrics">${metric('Targets in your universe',number(state.targets.length),`${number(active.length)} active opportunities`,'◎')}${metric('Portfolio sites tracked',number(siteCount),`${number(state.sites.length)} site records in workspace`,'⌖')}${metric('Strong seller signals',number(strong.length),'Recorded signals · verify before outreach','↗',true)}${metric('Actions to take',number(tasks.length),`${tasks.filter(t=>t.dueDate&&t.dueDate<=today()).length} due today or overdue`,'☑')}</div>
  <div class="dashboard-grid"><div>
  <section class="panel"><div class="panel-header"><div><h2>Priority targets <span class="count-badge">${active.length}</span></h2><p>Your active opportunities, ordered by recorded score.</p></div><button class="button ghost" data-nav="targets">View all →</button></div><div class="panel-body">${priority.length?priority.map(targetRow).join(''):empty('Build your acquisition universe','Add a company you know or use Acquisition hunter to research a new one.','<button class="button primary" data-action="add-target">＋ Add your first target</button>',true)}</div><div class="panel-footer"><span>Scores reflect your saved assessment.</span><button class="button ghost" data-nav="hunter">Find new targets ↗</button></div></section>
  <section class="panel"><div class="panel-header"><div><h2>Your next moves <span class="count-badge">${tasks.length}</span></h2><p>Small actions that move a deal forward.</p></div><button class="button ghost" data-action="add-task">＋ Add task</button></div>${tasks.length?`<div class="task-list">${taskRows(tasks.slice(0,5))}</div>`:empty('A clear desk','Capture an owner question, diligence request or follow-up to keep it moving.','<button class="button secondary small" data-action="add-task">Add a task</button>',true)}</section>
  </div><div>
  <section class="insight-card"><div class="insight-top"><span class="spark-icon">✦</span> Your acquisition analyst</div><h3>Find the gaps.<br>Build a stronger thesis.</h3><p>Review ownership evidence, site coverage and underwriting assumptions before your next conversation.</p><button class="button dark" data-action="quick-audit">Review my workspace →</button><p>${ai.connected?'AI research is connected.':'Workspace checks work now. Connect AI for sourced research.'}</p></section>
  <section class="panel"><div class="panel-header"><div><h2>Latest signals</h2><p>Saved observations from your watchtower.</p></div><button class="button ghost" data-nav="watchtower">All →</button></div><div class="panel-body">${signals.length?signalRows(signals):empty('Your watch starts here','Save public changes, ownership news and evidence as you research.','<button class="button secondary small" data-action="add-signal">Save a signal</button>',true)}</div></section>
  <section class="panel"><div class="panel-header"><h2>Research coverage</h2><button class="button ghost" data-action="coverage">Review →</button></div><div class="panel-body"><div class="coverage-row"><span>Targets with source links</span><span class="coverage-number">${sourced} / ${state.targets.length}</span></div><div class="coverage-bar"><span style="width:${state.targets.length?sourced/state.targets.length*100:0}%"></span></div><div class="coverage-row"><span>Named owners</span><span class="coverage-number">${owners} / ${state.targets.length}</span></div><div class="coverage-bar"><span style="width:${state.targets.length?owners/state.targets.length*100:0}%"></span></div><p class="help-text" style="margin-top:15px">${state.sampleMode?'Sample records do not count as verified research.':'A saved source is a reference, not independent verification.'}</p></div></section>
  </div></div>`;
}
function renderTargets() {
  const targets=filteredTargets();const states=[...new Set(state.targets.flatMap(t=>t.states))].sort();
  return heading('YOUR ACQUISITION UNIVERSE','Targets & owners','Company facts, ownership evidence and the next action for every opportunity.',`<div class="heading-actions"><button class="button secondary" data-action="export-csv">Export CSV ↧</button></div>`)+
  `<div class="filter-bar"><select data-filter="stage" aria-label="Filter by pipeline stage"><option value="">All stages</option>${stages.map(s=>`<option ${targetFilter.stage===s?'selected':''}>${s}</option>`).join('')}</select><select data-filter="state" aria-label="Filter by state"><option value="">All states</option>${states.map(s=>`<option ${targetFilter.state===s?'selected':''}>${escape(s)}</option>`).join('')}</select><select data-filter="seller" aria-label="Filter by seller signal"><option value="">All seller signals</option>${['Unknown','Watch','Strong'].map(s=>`<option ${targetFilter.seller===s?'selected':''}>${s}</option>`).join('')}</select><span class="results-count">${targets.length} target${targets.length===1?'':'s'}${search?` matching “${escape(search)}”`:''}</span></div>
  <section class="panel">${targets.length?`<div class="table-scroll"><table class="data-table"><thead><tr><th>Company / owner</th><th>Geography</th><th>Sites</th><th>Pipeline stage</th><th>Seller signal</th><th>Score</th><th>Next action</th></tr></thead><tbody>${targets.map(t=>`<tr><td><div class="inline-company"><span class="company-mark">${escape(initials(t.name))}</span><div><button class="target-name table-name" data-action="target-detail" data-id="${escape(t.id)}">${escape(t.name)}</button>${sampleBadge(t)}<div class="table-secondary">${escape(t.ownerName||'Owner not yet identified')}</div></div></div></td><td>${escape(t.states.join(', ')||'Unknown')}</td><td>${number(t.siteCount)}</td><td>${badge(t.stage,t.stage==='Diligence'?'green':t.stage==='NDA'?'blue':'')}</td><td>${sellerBadge(t)}</td><td><span class="score-display">${t.score===undefined||t.score===null?'—':number(t.score)}</span>${t.score!==undefined&&t.score!==null?`<span class="score-meter"><span style="width:${Math.min(100,Math.max(0,Number(t.score)||0))}%"></span></span>`:''}</td><td><div style="max-width:225px;white-space:normal">${escape(t.nextAction||'Set your next action')}</div>${t.dueDate?`<div class="table-secondary">${dateLabel(t.dueDate)}</div>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty(search||Object.values(targetFilter).some(Boolean)?'No matching targets':'Start with a company','Add a known target or import your existing research spreadsheet.','<button class="button primary" data-action="add-target">＋ Add target</button>')}<div class="panel-footer"><span>${state.sampleMode?'Sample company records are illustrative and unverified.':'Your facts, source links and ownership notes stay together.'}</span><button class="button ghost" data-action="import">Import research ↥</button></div></section>`;
}
function aiResponse(result) {
  if(!result)return '';
  if(result.error)return `<div class="callout error" role="alert">${escape(result.error)}</div>`;
  const sources=Array.isArray(result.sources)?result.sources:[];
  return `<div class="ai-output">${escape(result.text||'The service returned no written analysis.')}</div>${sources.length?`<div class="output-sources"><div class="panel-label">RESEARCH SOURCES</div>${sources.map((s,i)=>link(typeof s==='string'?s:s.url||s.sourceUrl,typeof s==='string'?s:s.title||`Source ${i+1}`)).join('')}</div>`:''}`;
}
function renderHunter() {
  const discovered=hunterResult?.data?.targets||[];
  return heading('FIND YOUR NEXT OPPORTUNITY','Acquisition hunter','Search for privately owned fuel marketers and convenience store operators.')+
  `<div class="split-layout"><div><section class="research-intro"><div class="eyebrow">PURPOSEFUL DISCOVERY</div><h2>A focused search.<br>A better starting point.</h2><p>Describe the geography, footprint and ownership profile you want. Review the evidence before adding companies to your universe.</p></section><section class="panel"><div class="panel-header"><h2>What are you looking for?</h2>${badge(ai.connected?'AI connected':'Connection required',ai.connected?'green':'yellow')}</div><div class="panel-body"><form id="hunter-form" class="prompt-form"><textarea name="prompt" required aria-label="Describe target acquisition search" placeholder="Find private convenience retailers with 5–35 sites in North Carolina, South Carolina and Virginia. Prioritize identifiable owners and cite public sources.">${escape(state.settings.lastSearch||'')}</textarea><div class="prompt-examples"><button type="button" class="prompt-chip" data-prompt="Find family-owned fuel marketers with 10–30 locations in the Southeast. Identify the legal owner and cite each company’s official website.">Family-owned operators</button><button type="button" class="prompt-chip" data-prompt="Find independent convenience store groups in North Carolina, South Carolina and Virginia with 5–35 sites. Clearly distinguish verified facts from unknowns.">Carolinas & Virginia</button><button type="button" class="prompt-chip" data-prompt="Find private fuel distributors in Georgia and Tennessee. Separate wholesale accounts from company-operated stores and cite your sources.">Fuel distributors</button></div><div class="form-actions"><span class="help-text" style="margin-right:auto">Public evidence. No inferred seller intent.</span><button class="button primary" type="submit" ${aiBusy?'disabled':''}>${aiBusy?'Researching…':'✦ Discover targets'}</button></div></form>${aiBusy?'<div class="loading"><span class="spinner"></span>Searching and organizing public evidence…</div>':''}</div></section>${hunterResult?`<section class="panel"><div class="panel-header"><h2>Research results</h2>${discovered.length?`<button class="button primary small" data-action="save-discovered">Save ${discovered.length} target${discovered.length===1?'':'s'}</button>`:''}</div><div class="panel-body">${aiResponse(hunterResult)}${discovered.length?`<div style="margin-top:18px">${discovered.map(t=>targetRow({...t,id:'',states:t.states||[],stage:t.stage||'Research'})).join('')}</div><p class="help-text">Results are a research starting point. Saving merges duplicate company names and preserves your existing notes.</p>`:''}</div></section>`:''}</div>
  <div><section class="panel"><div class="panel-header"><h2>Your search mandate</h2><button class="button ghost" data-action="settings">Edit →</button></div><div class="panel-body"><div class="research-fact"><strong>Geographic focus</strong><p>${escape((state.settings.targetStates||[]).join(' · ')||'Add focus states in workspace settings.')}</p></div><div class="research-fact"><strong>Footprint</strong><p>${number(state.settings.minSites)}–${number(state.settings.maxSites)} sites per target</p></div><div class="research-fact"><strong>Return threshold</strong><p>${percent(state.settings.targetIrrPercent??15)} target investment IRR · ${percent(state.settings.targetYieldPercent)} annual cash yield</p></div></div></section><section class="panel"><div class="panel-header"><h2>Research that holds up</h2></div><div class="panel-body"><div class="research-fact"><strong>01 · Establish the company</strong><p>Confirm legal names, operating geography and the retail versus wholesale footprint.</p></div><div class="research-fact"><strong>02 · Identify the owner</strong><p>Keep named decision makers and contact details only when backed by a source.</p></div><div class="research-fact"><strong>03 · Separate facts from signals</strong><p>Expansion, succession and property changes are clues. They do not establish willingness to sell.</p></div></div></section></div></div>`;
}
function fallbackFinance(input) {
  const i={...defaults,...input};const n=k=>Number(i[k])||0;const gallons=n('siteCount')*n('annualGallonsPerSite');
  const fuelGrossProfit=gallons*(i.operatorFuelMarginCPG===null||i.operatorFuelMarginCPG===undefined||i.operatorFuelMarginCPG===''?n('fuelMarginCPG'):n('operatorFuelMarginCPG'))/100;
  const merchandiseGrossProfit=n('siteCount')*n('merchandiseRevenuePerSite')*(i.operatorMerchandiseMarginPercent===null||i.operatorMerchandiseMarginPercent===undefined||i.operatorMerchandiseMarginPercent===''?n('merchandiseMarginPercent'):n('operatorMerchandiseMarginPercent'))/100;
  const otherGrossProfit=n('siteCount')*n('otherProfitPerSite');const grossProfit=fuelGrossProfit+merchandiseGrossProfit+otherGrossProfit;
  const opex=n('siteCount')*(i.operatorOpexPerSite===null||i.operatorOpexPerSite===undefined||i.operatorOpexPerSite===''?n('opexPerSite'):n('operatorOpexPerSite'))+n('siteCount')*n('annualRentPerSite');
  const ebitda=grossProfit-opex;const synergy=n('siteCount')*n('synergyPerSite');const adjustedEbitda=ebitda+synergy;const sustainingCapex=n('siteCount')*n('sustainingCapexPerSite');const cashFlow=adjustedEbitda-sustainingCapex;const transactionCosts=n('purchasePrice')*n('transactionCostPercent')/100;const acquisitionCost=n('purchasePrice')+transactionCosts;
  return {gallons,fuelGrossProfit,merchandiseGrossProfit,otherGrossProfit,grossProfit,opex,ebitda,synergy,adjustedEbitda,sustainingCapex,cashFlow,transactionCosts,acquisitionCost,enterpriseValue:n('purchasePrice'),operatingBusinessValue:Math.max(0,n('purchasePrice')-n('realEstateValue')),yieldPercent:acquisitionCost>0?cashFlow/acquisitionCost*100:null,impliedMultiple:adjustedEbitda>0?n('purchasePrice')/adjustedEbitda:null,irrPercent:null,maxPriceForTargetYield:n('targetYieldPercent')>0?cashFlow/(n('targetYieldPercent')/100)/(1+n('transactionCostPercent')/100):null,scenarios:[],flags:[{severity:'info',message:'Core operating metrics calculated locally. Full scenario and IRR analysis require the included financial engine.'}],projections:[]};
}
function financeMetric(result,key) { return result?.[key]??null; }
function renderUnderwriting() {
  const t=targetById(selectedFinance);const r=financeResult||fallbackFinance(financeInputs);
  const input=(key,label,unit='',optional=false)=>{const descriptor=(financeFields.length?financeFields:window.DealFinance?.inputFields||[]).find(f=>f.key===key);return `<div class="finance-row"><label for="fin-${key}">${label}${unit?` <span class="muted">${unit}</span>`:''}</label><input id="fin-${key}" data-finance="${key}" type="number" ${optional?'':'required'} step="${descriptor?.integer?1:'any'}" min="${descriptor?.min??0}" ${descriptor?.max!==undefined?`max="${descriptor.max}"`:''} value="${escape(financeInputs[key]??'')}" ${optional?'placeholder="Use baseline"':''} ${descriptor?.description?`title="${escape(descriptor.description)}"`:''}></div>`;};
  return heading('TURN A THESIS INTO NUMBERS','Underwriting','A transparent, unlevered operating model. All assumptions are editable.',`<div class="heading-actions"><button class="button secondary" data-action="export-model">Export model ↧</button><button class="button primary" data-action="save-model">Save assumptions</button></div>`)+
  `<div class="filter-bar"><select id="finance-target" aria-label="Select target to underwrite"><option value="">Independent model</option>${state.targets.map(t=>`<option value="${escape(t.id)}" ${selectedFinance===t.id?'selected':''}>${escape(t.name)}</option>`).join('')}</select><span class="results-count">${t?.sample?'Illustrative sample assumptions':t?'Model for '+escape(t.name):'Starting assumptions are illustrative'}</span></div>
  <div class="finance-overview" id="finance-metrics">${renderFinanceMetrics(r)}</div><div class="finance-layout"><section class="panel finance-inputs"><div class="panel-header"><div><h2>Model assumptions</h2><p>Portfolio price; operating inputs per site.</p></div><button class="button ghost" data-action="reset-model">Reset</button></div><div class="panel-body"><div class="finance-group"><h3>Acquisition & ownership</h3><div class="finance-row"><label for="fin-structure">Operating structure</label><select id="fin-structure" data-finance="structure">${['COOP','COAG','CALS'].map(s=>`<option ${financeInputs.structure===s?'selected':''}>${s}</option>`).join('')}</select></div>${input('siteCount','Number of sites')}${input('purchasePrice','Total portfolio price','$')}${input('realEstateValue','Included real estate','$')}${input('transactionCostPercent','Transaction costs','%')}${input('targetIrrPercent','Target investment IRR','%')}${input('targetYieldPercent','Target annual cash yield','%')}</div><div class="finance-group"><h3>Site-level operating economics</h3>${input('annualGallonsPerSite','Annual fuel gallons')}${input('fuelMarginCPG','Fuel gross margin','¢/gal')}${input('merchandiseRevenuePerSite','Annual inside sales','$')}${input('merchandiseMarginPercent','Inside gross margin','%')}${input('otherProfitPerSite','Other gross profit','$')}${input('opexPerSite','Operating expense','$')}${input('sustainingCapexPerSite','Sustaining capex','$')}${input('synergyPerSite','Annual synergy','$')}</div><div class="finance-group"><h3>Operator-specific adjustments</h3><p class="help-text" style="margin-bottom:12px">COOP: company operated. COAG: commission agent. CALS: company owned, leased site. Structure is a label; specify the economics below when they differ.</p>${input('operatorFuelMarginCPG','Operator fuel margin','¢/gal',true)}${input('operatorMerchandiseMarginPercent','Operator inside margin','%',true)}${input('annualRentPerSite','Annual additional rent','$')}${input('operatorOpexPerSite','Operator expense','$',true)}</div><div class="finance-group"><h3>Holding period & exit</h3>${input('years','Holding period','years')}${input('growthPercent','Annual operating growth','%')}${input('terminalMultiple','Exit EBITDA multiple','×')}${input('terminalSellingCostPercent','Exit selling costs','%')}</div><p class="help-text">No debt, income tax, working capital or environmental remediation is assumed. Confirm what the purchase price includes.</p></div></section><div><section class="panel"><div class="panel-header"><h2>Annual operating cash flow</h2><span class="panel-label">UNLEVERED · PRE-TAX</span></div><div id="finance-statement" class="panel-body">${renderStatement(r)}</div></section><section class="panel"><div class="panel-header"><h2>Scenario comparison</h2><span class="panel-label">ILLUSTRATIVE SENSITIVITY</span></div><div id="finance-scenarios" class="panel-body">${renderScenarios(r)}</div></section><section class="panel"><div class="panel-header"><h2>Model review</h2><button class="button ghost" data-action="audit-model">Run audit →</button></div><div class="panel-body" id="finance-flags">${renderFinanceFlags(r)}</div></section></div></div>`;
}
function renderFinanceMetrics(r) { return metric('Adjusted EBITDA',money(r.adjustedEbitda,true),'Annual · before sustaining capex','↗')+metric('Free cash flow',money(r.cashFlow,true),'Unlevered · pre-tax','◇')+metric('Annual cash yield',percent(r.yieldPercent),'FCF ÷ total acquisition cost','%',true)+metric('Holding period IRR',percent(r.irrPercent),'Includes modeled exit proceeds','↗'); }
function renderStatement(r) {
  const row=(label,key,total=false)=>`<div class="statement-row${total?' total':''}"><span>${label}</span><strong>${money(r[key])}</strong></div>`;
  return `<div class="statement-row"><span>Annual gallons</span><strong>${number(r.gallons)}</strong></div>${row('Fuel gross profit','fuelGrossProfit')}${row('Merchandise gross profit','merchandiseGrossProfit')}${row('Other gross profit','otherGrossProfit')}${row('Total gross profit','grossProfit',true)}${row('Operating expenses, including entered rent','opex')}${row('Operating EBITDA','ebitda',true)}${row('Entered synergy','synergy')}${row('Adjusted EBITDA','adjustedEbitda',true)}${row('Sustaining capital expenditure','sustainingCapex')}${row('Annual free cash flow','cashFlow',true)}<div class="statement-row"><span>Acquisition cost, including transaction costs</span><strong>${money(r.acquisitionCost)}</strong></div><div class="statement-row"><span>Portfolio purchase price / adjusted EBITDA</span><strong>${r.impliedMultiple===null||r.impliedMultiple===undefined?'N/A':`${Number(r.impliedMultiple).toFixed(1)}×`}</strong></div><div class="callout yellow">At your ${percent(financeInputs.targetIrrPercent)} investment IRR target, modeled maximum portfolio price is <strong>${money(r.maxPriceForTargetIrr)}</strong>, including exit proceeds and transaction costs. At the separate ${percent(financeInputs.targetYieldPercent)} annual cash-yield target, it is <strong>${money(r.maxPriceForTargetYield)}</strong>.</div>`;
}
function renderScenarios(r) {
  if(!r.scenarios?.length)return `<p class="help-text">${r.flags?.some(f=>f.severity==='error')?'Correct the input errors to calculate scenarios.':'Full scenario and IRR analysis are available when the financial engine finishes loading.'}</p>`;
  return `<div class="scenario-grid">${r.scenarios.map(s=>`<div class="scenario-card${s.key==='base'?' base':''}"><h3>${escape(s.label)}</h3><div class="scenario-value">${percent(s.yieldPercent)}</div><p>Annual cash yield</p><div class="scenario-stat"><span>EBITDA</span><strong>${money(s.adjustedEbitda??s.ebitda,true)}</strong></div><div class="scenario-stat"><span>IRR</span><strong>${percent(s.irrPercent)}</strong></div></div>`).join('')}</div><p class="help-text" style="margin-top:13px">Downside and upside change operating and acquisition assumptions. ${r.scenarios.filter(s=>s.key!=='base').map(s=>`${s.label}: ${typeof s.changes==='string'?escape(s.changes):escape(JSON.stringify(s.changes))}`).join(' · ')}</p>`;
}
function renderFinanceFlags(r) { return r.flags?.length?r.flags.map(f=>`<div class="callout${f.severity==='error'?' error':f.severity==='warning'?' yellow':''}">${escape(f.message||f)}</div>`).join(''):'<div class="callout">No calculation warnings for the entered assumptions. Validate every operating assumption against source records.</div>'; }
function bindFinance() {
  $$('[data-finance]').forEach(el=>el.addEventListener('input',()=>{
    financeInputs[el.dataset.finance]=el.dataset.finance==='structure'?el.value:el.value===''?null:Number(el.value);
    clearTimeout(financeTimer);financeTimer=setTimeout(calculateFinance,220);
  }));
  $('#finance-target').addEventListener('change',event=>{
    selectedFinance=event.target.value;const t=targetById(selectedFinance);financeInputs=t?modelInputs(t):{...defaults,...state.settings.independentModel};financeResult=null;render();
  });
}
let financeSequence=0;
async function calculateFinance() {
  const seq=++financeSequence;let result;
  try { result=await api('/api/finance',{inputs:financeInputs},10000); }
  catch(error) {
    try {result=window.DealFinance?.calculate?window.DealFinance.calculate(financeInputs):fallbackFinance(financeInputs);}
    catch(validationError){result={flags:[{severity:'error',message:validationError.message}],scenarios:[]};}
  }
  if(seq!==financeSequence)return;financeResult=result;
  if(tab==='underwriting'){
    $('#finance-metrics').innerHTML=renderFinanceMetrics(result);$('#finance-statement').innerHTML=renderStatement(result);$('#finance-scenarios').innerHTML=renderScenarios(result);$('#finance-flags').innerHTML=renderFinanceFlags(result);
  }
}
const stateCenters={AL:[32.7,-86.7],AR:[34.8,-92.2],AZ:[34.1,-111.6],CA:[36.8,-119.4],CO:[39,-105.5],CT:[41.6,-72.7],DE:[39,-75.5],FL:[28,-82],GA:[32.2,-83.4],IA:[42,-93.5],ID:[44.2,-114.4],IL:[40,-89],IN:[40,-86],KS:[38.5,-98],KY:[37.7,-85.3],LA:[31,-92],MA:[42.3,-71.8],MD:[39,-76.7],ME:[45,-69],MI:[44,-85],MN:[46,-94],MO:[38.5,-92.5],MS:[32.7,-89.7],MT:[47,-110],NC:[35.8,-79.8],ND:[47.5,-100.5],NE:[41.5,-99.8],NH:[43.8,-71.6],NJ:[40,-74.5],NM:[34.5,-106],NV:[39,-117],NY:[43,-75.5],OH:[40.4,-82.8],OK:[35.5,-97.5],OR:[44,-120.5],PA:[41,-77.5],RI:[41.7,-71.5],SC:[34,-81],SD:[44,-100],TN:[35.8,-86],TX:[31,-99],UT:[39.5,-111.7],VA:[37.5,-79],VT:[44,-72.7],WA:[47.5,-120.5],WI:[44.5,-89.5],WV:[38.5,-80.5],WY:[43,-107.5]};
function renderMap(sites) {
  const points=sites.map(s=>{const fallback=stateCenters[String(s.state||'').toUpperCase()];const lat=Number(s.latitude)||fallback?.[0],lon=Number(s.longitude)||fallback?.[1];if(!lat||!lon||lon < -126||lon > -66||lat < 24||lat > 50)return '';const x=(lon+126)/60*700+35,y=(50-lat)/26*275+10;return `<circle class="map-dot" cx="${x}" cy="${y}" r="${s.sample?4:5}"><title>${escape(`${s.address||s.city||'Site'} · ${s.city||''}, ${s.state||''}${s.sample?' · Sample':''}`)}</title></circle>`;}).join('');
  return `<div class="map-panel"><svg viewBox="0 0 770 300" role="img" aria-label="Regional schematic of contiguous United States showing recorded sites; not a geographic basemap"><path class="map-outline" d="M73 21 152 42 242 39 378 38 506 41 540 61 578 59 605 89 633 63 663 52 670 30 698 16 711 36 715 72 696 85 684 104 672 119 651 130 625 154 600 172 572 186 570 214 588 249 580 280 565 270 548 236 533 219 504 217 486 223 444 212 424 224 402 210 390 229 378 262 355 269 338 250 313 221 300 220 280 193 233 192 215 184 191 188 166 174 148 165 118 157 94 127 86 90 70 77 65 46Z"/><path class="map-state" d="M155 43 142 159M230 42v150M300 40v180M378 41v180M450 40v174M505 42v174M95 91h496M113 129h494M153 168h392M244 191h263M541 69l-17 151M592 96l-36 94"/><text class="map-label" x="112" y="215">WEST</text><text class="map-label" x="329" y="107">CENTRAL</text><text class="map-label" x="566" y="135">EAST</text>${points}</svg><div class="map-caption"><span>Regional schematic · Approximate placement · Contiguous U.S. only</span><span>${sites.length} records</span></div></div>`;
}
function renderSites() {
  const q=search.toLowerCase();const sites=state.sites.filter(s=>!q||[s.address,s.city,s.state,targetById(s.targetId)?.name].join(' ').toLowerCase().includes(q));
  return heading('KNOW THE FOOTPRINT','Site intelligence','Keep site records, fuel branding and property facts connected to their owner.',`<div class="heading-actions"><button class="button primary" data-action="add-site">＋ Add site</button></div>`)+renderMap(sites)+
  `<section class="panel"><div class="panel-header"><div><h2>Site register <span class="count-badge">${sites.length}</span></h2><p>Recorded locations. A company’s stated footprint may include unrecorded sites.</p></div></div>${sites.length?`<div class="table-scroll"><table class="data-table"><thead><tr><th>Location</th><th>Target owner</th><th>Fuel brand</th><th>Property structure</th><th>Annual gallons</th><th>Record</th></tr></thead><tbody>${sites.map(s=>`<tr><td><div class="table-name">${escape(s.address||'Address unknown')}${sampleBadge(s)}</div><div class="table-secondary">${escape([s.city,s.state].filter(Boolean).join(', '))}</div></td><td>${targetById(s.targetId)?`<button class="target-name" data-action="target-detail" data-id="${escape(s.targetId)}">${escape(targetById(s.targetId).name)}</button>`:'Unassigned'}</td><td>${escape(s.fuelBrand||'Unknown')}</td><td>${escape(s.ownership||'Unknown')}</td><td>${s.annualGallons?number(s.annualGallons):'Unknown'}</td><td><button class="button ghost" data-action="edit-site" data-id="${escape(s.id)}">Edit →</button></td></tr>`).join('')}</tbody></table></div>`:empty('Add the first location','Start with the address, city and state. Add ownership and operating facts as they are verified.','<button class="button primary" data-action="add-site">＋ Add site</button>')}</section>`;
}
function renderPipeline() {
  const q=search.toLowerCase();const targets=state.targets.filter(t=>!q||[t.name,t.ownerName,...t.states].join(' ').toLowerCase().includes(q));
  return heading('KEEP EVERY OPPORTUNITY MOVING','Pipeline','Drag a card to a new stage or use its stage selector. Every move is saved.')+
  `<div class="pipeline">${stages.map(stage=>{const group=targets.filter(t=>t.stage===stage);return `<section class="pipeline-column" data-stage="${stage}" aria-label="${stage} stage"><div class="pipeline-heading"><span>${stage}</span><span class="count-badge">${group.length}</span></div>${group.map(t=>`<article class="pipeline-card" draggable="true" data-target="${escape(t.id)}"><button class="target-name" data-action="target-detail" data-id="${escape(t.id)}">${escape(t.name)}</button>${sampleBadge(t)}<p>${escape(t.states.join(', '))} · ${number(t.siteCount)} sites</p>${sellerBadge(t)}<p>${escape(t.nextAction||'Add a next action')}</p><select data-stage-target="${escape(t.id)}" aria-label="Pipeline stage for ${escape(t.name)}">${stages.map(s=>`<option ${t.stage===s?'selected':''}>${s}</option>`).join('')}</select></article>`).join('')}${!group.length?'<p class="help-text">Move an opportunity here when it is ready.</p>':''}</section>`;}).join('')}</div>${!targets.length?empty('Your pipeline is ready','Add a target to start tracking your acquisition process.','<button class="button primary" data-action="add-target">＋ Add target</button>'):''}`;
}
function moveStage(id,stage) { const t=targetById(id);if(!t||!stages.includes(stage))return;t.stage=stage;t.updatedAt=new Date().toISOString();commit(`${t.name} moved to ${stage}.`);render(); }
function bindPipeline() {
  $$('.pipeline-card').forEach(card=>card.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',card.dataset.target);e.dataTransfer.effectAllowed='move';}));
  $$('.pipeline-column').forEach(column=>{column.addEventListener('dragover',e=>{e.preventDefault();column.classList.add('drag-over');});column.addEventListener('dragleave',()=>column.classList.remove('drag-over'));column.addEventListener('drop',e=>{e.preventDefault();column.classList.remove('drag-over');moveStage(e.dataTransfer.getData('text/plain'),column.dataset.stage);});});
  $$('[data-stage-target]').forEach(el=>el.addEventListener('change',()=>moveStage(el.dataset.stageTarget,el.value)));
}
function renderBriefs() {
  const briefs=state.documents.filter(d=>d.type==='brief');
  return heading('MAKE THE INVESTMENT CASE','Investment briefs','A decision-ready summary grounded in your saved company facts and assumptions.')+
  `<div class="split-layout"><div><section class="panel brief-controls"><div class="panel-header"><h2>Build a brief</h2><span class="panel-label">FROM YOUR WORKSPACE</span></div><div class="panel-body"><form id="brief-form"><div class="form-field"><label for="brief-target">Select target</label><select id="brief-target" name="targetId" required><option value="">Choose a company…</option>${state.targets.map(t=>`<option value="${escape(t.id)}" ${currentBrief?.targetId===t.id?'selected':''}>${escape(t.name)}</option>`).join('')}</select></div><div class="callout">The baseline brief uses your recorded facts and operating model. Missing evidence stays visible. AI enrichment requires a connected research service.</div><div class="form-actions"><button class="button secondary" type="button" data-action="ai-brief" ${aiBusy?'disabled':''}>✦ Research & enrich</button><button class="button primary" type="submit">Create baseline brief →</button></div></form>${aiBusy?'<div class="loading"><span class="spinner"></span>Building sourced analysis…</div>':''}</div></section>${currentBrief?`<div class="row-actions" style="justify-content:flex-end;margin-bottom:12px"><button class="button secondary small" data-action="download-brief">Download text ↧</button><button class="button secondary small" data-action="print-brief">Print</button><button class="button primary small" data-action="save-brief">Save brief</button></div><article class="brief-preview">${escape(currentBrief.text)}</article>`:empty('Choose a target to build conviction','Your brief will bring together the ownership picture, seller signals, operating economics, risks and next steps.')}</div><div><section class="panel"><div class="panel-header"><h2>Saved briefs <span class="count-badge">${briefs.length}</span></h2></div><div class="panel-body">${briefs.length?briefs.map(b=>`<div class="document-row"><div><h3>${escape(b.title)}</h3><p>${dateLabel(b.createdAt)} · ${escape(targetById(b.targetId)?.name||'Archived target')}</p></div><button class="button ghost" data-action="open-brief" data-id="${escape(b.id)}">Open →</button></div>`).join(''):empty('Your decision library','Save a brief to revisit your thesis as the evidence evolves.','',true)}</div></section><section class="panel"><div class="panel-header"><h2>What a useful brief answers</h2></div><div class="panel-body"><div class="research-fact"><strong>Why this company?</strong><p>The footprint, ownership picture and your investment hypothesis.</p></div><div class="research-fact"><strong>Do the economics work?</strong><p>Entered purchase price, operating cash flow and cash yield.</p></div><div class="research-fact"><strong>What must be proven?</strong><p>Evidence gaps, property and environmental questions, and concrete next actions.</p></div></div></section></div></div>`;
}
function modelInputs(t) {
  return {...defaults,...(t.siteCount>0?{siteCount:Number(t.siteCount)}:{}),...t.financials};
}
function baselineBrief(t) {
  const inputs=modelInputs(t);
  const r=window.DealFinance?.calculate?window.DealFinance.calculate(inputs):fallbackFinance(inputs);
  const sources=(t.sourceUrls||[]).map((s,i)=>`${i+1}. ${s}`).join('\n')||'No source links saved. Company facts require verification.';
  const companySites=state.sites.filter(s=>s.targetId===t.id);const signals=state.signals.filter(s=>s.targetId===t.id);
  const hasModel=Object.keys(t.financials||{}).length>0;
  return {id:uid(),type:'brief',targetId:t.id,title:`${t.name} — Investment brief`,createdAt:new Date().toISOString(),text:`DEAL INTELLIGENCE\n${t.name.toUpperCase()}\nInvestment brief · ${dateLabel(today())}\n${t.sample?'ILLUSTRATIVE SAMPLE — NOT A RESEARCHED ACQUISITION TARGET\n':''}\nCOMPANY & OWNERSHIP\nLegal name: ${t.legalName||'Not verified'}\nBusiness: ${t.type||'Not recorded'}\nGeography: ${t.states.join(', ')||'Not recorded'}\nReported footprint: ${number(t.siteCount)} sites; ${companySites.length} site-level records in this workspace.\nOwner / decision maker: ${t.ownerName||'Not identified'}${t.ownerTitle?' · '+t.ownerTitle:''}\nPipeline stage: ${t.stage}\nRecorded confidence: ${t.confidence||'Unassessed'}; no independent verification is implied.\n\nINVESTMENT THESIS & NOTES\n${t.notes||'No investment thesis or research notes saved.'}\n\nSELLER SIGNALS\nRecorded assessment: ${t.sellerSignal||'Unknown'}. ${t.sellerSignalReason||'Seller willingness has not been established.'}\n${signals.length?signals.map(s=>`• ${s.title} (${dateLabel(s.date)}) — ${s.detail||'Detail not recorded'}${s.sourceUrl?'\n  Source: '+s.sourceUrl:''}`).join('\n'):'No saved public signals.'}\n\nOPERATING ECONOMICS\n${hasModel?'Entered model assumptions; validate against operating statements.':'Illustrative starting assumptions; no target-specific financial evidence entered.'}\nStructure: ${inputs.structure}; ${number(inputs.siteCount)} modeled sites.\nTotal portfolio purchase price: ${money(inputs.purchasePrice)}\nIncluded real estate: ${money(inputs.realEstateValue)}\nAdjusted annual EBITDA: ${money(r.adjustedEbitda)}\nAnnual sustaining capex: ${money(r.sustainingCapex)}\nUnlevered, pre-tax free cash flow: ${money(r.cashFlow)}\nAnnual cash yield: ${percent(r.yieldPercent)}\n${r.irrPercent===null?'Holding-period IRR not calculated.':`Modeled holding-period IRR: ${percent(r.irrPercent)}`}\nNo debt, taxes, working capital or environmental remediation is modeled.\n\nDILIGENCE & EVIDENCE GAPS\n${!t.ownerName?'• Establish legal owner and beneficial control.\n':''}${!t.sourceUrls?.length?'• Add primary company and ownership sources.\n':''}${companySites.length<Number(t.siteCount)?`• Reconcile ${number(t.siteCount)} reported sites with ${companySites.length} recorded locations.\n`:''}• Verify site-level gallons, fuel and inside margins, rent, labor and sustaining capital expenditure.\n• Review title / leases, tank age, environmental records, supply contracts and transfer restrictions.\n• Confirm price allocation and actual willingness to discuss a sale.\n\nNEXT ACTION\n${t.nextAction||'Define the next evidence-gathering step before outreach.'}${t.dueDate?'\nDue: '+dateLabel(t.dueDate):''}\n\nSAVED SOURCES\n${sources}\n\nPrepared from saved workspace records. This is a research and screening tool, not an appraisal or investment recommendation.`};
}
function renderWatchtower() {
  const q=search.toLowerCase();const signals=[...state.signals].filter(s=>!q||[s.title,s.detail,targetById(s.targetId)?.name].join(' ').toLowerCase().includes(q)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  return heading('STAY CLOSE TO YOUR UNIVERSE','Watchtower','Capture public changes and keep the evidence behind every seller signal.',`<div class="heading-actions"><button class="button secondary" data-action="check-updates" ${aiBusy?'disabled':''}>✦ Check for updates</button><button class="button primary" data-action="add-signal">＋ Save signal</button></div>`)+
  `<div class="callout">Updates run when you click Check for updates. There is no scheduled monitoring. Public signals do not establish seller intent.</div><div class="split-layout"><div><section class="panel"><div class="panel-header"><div><h2>Saved signals <span class="count-badge">${signals.length}</span></h2><p>Evidence, dates and your confidence assessment.</p></div></div><div class="panel-body">${signals.length?signalRows(signals):empty('Keep the important changes','Record an ownership announcement, property transaction or operating change with its source.','<button class="button primary" data-action="add-signal">＋ Save signal</button>',true)}</div></section>${aiBusy?'<div class="loading"><span class="spinner"></span>Checking current public sources…</div>':''}${watchResult?`<section class="panel"><div class="panel-header"><h2>Latest check</h2>${(watchResult.data?.signals?.length||watchResult.data?.findings?.length)?'<button class="button primary small" data-action="save-ai-signals">Save reported signals</button>':''}</div><div class="panel-body">${aiResponse(watchResult)}</div></section>`:''}</div><div><section class="panel"><div class="panel-header"><h2>Seller signal breakdown</h2></div><div class="panel-body">${['Strong','Watch','Unknown'].map(s=>{const n=state.targets.filter(t=>(t.sellerSignal||'Unknown')===s).length;return `<div class="coverage-row"><span>${s}</span><span class="coverage-number">${n} target${n===1?'':'s'}</span></div><div class="coverage-bar"><span style="width:${state.targets.length?n/state.targets.length*100:0}%"></span></div>`;}).join('')}<p class="help-text" style="margin-top:17px">Manually recorded assessments. Add the reason and source on the target record.</p></div></section><section class="insight-card"><div class="insight-top"><span class="spark-icon">✦</span> Evidence before outreach</div><h3>A signal is the beginning<br>of a question.</h3><p>Confirm ownership, explain the context and build a thoughtful next action before you approach a business.</p><button class="button secondary" data-nav="targets">Review target universe →</button></section></div></div>`;
}
function renderAnalyst() {
  return heading('A SECOND SET OF EYES','Your acquisition analyst','Review the workspace, challenge assumptions and investigate a focused question.')+
  `<div class="analyst-grid"><button class="analyst-tool" data-analysis="today"><span class="tool-icon">☑</span><h3>Prioritize next moves</h3><p>Review open tasks, stalled records and the next useful action.</p></button><button class="analyst-tool" data-analysis="audit"><span class="tool-icon">◇</span><h3>Audit the workspace</h3><p>Find missing ownership, sources and financial evidence.</p></button><button class="analyst-tool" data-analysis="coverage"><span class="tool-icon">◎</span><h3>Check research coverage</h3><p>See where your universe needs more site and owner research.</p></button></div>
  <div class="split-layout"><div><section class="panel"><div class="panel-header"><div><h2>Ask a focused question</h2><p>Connected AI can research and analyze the context you provide.</p></div>${badge(ai.connected?'AI connected':'Connection required',ai.connected?'green':'yellow')}</div><div class="panel-body"><form id="analyst-form" class="prompt-form"><div class="form-field" style="margin-bottom:14px"><label for="analyst-target">Context</label><select id="analyst-target" name="targetId"><option value="">Full workspace</option>${state.targets.map(t=>`<option value="${escape(t.id)}">${escape(t.name)}</option>`).join('')}</select></div><textarea name="prompt" required aria-label="Question for acquisition analyst" placeholder="Which ownership facts and operating assumptions should I verify before approaching this company?"></textarea><div class="form-actions"><span class="help-text" style="margin-right:auto">Facts and uncertainty stay distinct.</span><button class="button primary" type="submit" ${aiBusy?'disabled':''}>✦ Ask analyst</button></div></form></div></section>${aiBusy||analysisBusy?'<div class="loading"><span class="spinner"></span>Reviewing your acquisition workspace…</div>':''}${analystResult?`<section class="panel"><div class="panel-header"><h2>${escape(analystResult.title||'Analyst findings')}</h2><button class="button ghost" data-action="export-analysis">Download ↧</button></div><div class="panel-body">${aiResponse(analystResult)}</div></section>`:''}</div><div><section class="panel"><div class="panel-header"><h2>A useful decision process</h2></div><div class="panel-body"><div class="research-fact"><strong>Start with evidence</strong><p>Ownership, legal identity, footprint and source dates form the foundation.</p></div><div class="research-fact"><strong>Stress the assumptions</strong><p>Small changes in fuel margin, operating costs and price can change the return materially.</p></div><div class="research-fact"><strong>Ask the next question</strong><p>Turn every uncertainty into a concrete research or diligence action.</p></div><div class="callout">The three workspace checks work without AI. They assess your saved records; they do not verify public facts.</div></div></section></div></div>`;
}
function offlineAnalysis(mode) {
  const real=state.targets.filter(t=>!t.sample);const samples=state.targets.length-real.length;
  const missingOwners=real.filter(t=>!t.ownerName);const missingSources=real.filter(t=>!t.sourceUrls?.length);const missingModels=real.filter(t=>!Object.keys(t.financials||{}).length);
  const tasks=state.tasks.filter(t=>!t.done);const overdue=tasks.filter(t=>t.dueDate&&t.dueDate<today());
  let lines=[`Workspace review · ${dateLabel(today())}`,`Saved records: ${real.length} personal targets${samples?`, ${samples} illustrative sample targets (excluded from evidence coverage)`:''}.`,''];
  if(mode==='today') {
    lines.push('NEXT ACTIONS',`${tasks.length} open tasks; ${overdue.length} overdue.`,...tasks.slice().sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,8).map(t=>`• ${t.title} — ${targetById(t.targetId)?.name||'Workspace'}${t.dueDate?' · due '+dateLabel(t.dueDate):''}${t.sample?' · Sample':''}`));
    const next=real.filter(t=>activeStages.includes(t.stage)&&!t.nextAction);if(next.length)lines.push('',`Define a next action for: ${next.map(t=>t.name).join(', ')}.`);
    if(!real.length)lines.push('Add your first real company and identify a primary source before outreach.');
  } else {
    lines.push('EVIDENCE COVERAGE',`${real.length-missingOwners.length}/${real.length} personal targets have a named owner.`,`${real.length-missingSources.length}/${real.length} personal targets have saved source links.`,`${real.length-missingModels.length}/${real.length} personal targets have financial assumptions.`,`${state.sites.filter(s=>!s.sample).length} personal site records saved.`,'');
    if(missingOwners.length)lines.push(`OWNERSHIP GAPS\n${missingOwners.map(t=>'• '+t.name+': establish legal owner and beneficial control.').join('\n')}`,'');
    if(missingSources.length)lines.push(`SOURCE GAPS\n${missingSources.map(t=>'• '+t.name+': add a primary company or ownership source.').join('\n')}`,'');
    if(mode==='audit'&&missingModels.length)lines.push(`MODEL GAPS\n${missingModels.map(t=>'• '+t.name+': record target-specific operating assumptions before relying on returns.').join('\n')}`,'');
    const gaps=real.map(t=>({t,n:state.sites.filter(s=>s.targetId===t.id&&!s.sample).length})).filter(v=>v.n<Number(v.t.siteCount));
    if(gaps.length)lines.push('FOOTPRINT RECONCILIATION',...gaps.map(v=>`• ${v.t.name}: ${v.n} site records versus ${number(v.t.siteCount)} stated sites.`),'');
    if(!real.length)lines.push('Coverage begins when you add a personal company. Sample data illustrates the workflow only.');
  }
  lines.push('','This check uses saved records only. A recorded owner, source or assumption does not imply independent verification.');
  return {title:mode==='today'?'Prioritized next moves':mode==='coverage'?'Research coverage':'Workspace audit',text:lines.join('\n'),sources:[]};
}
async function runAnalysis(mode) {
  tab='analyst';location.hash='analyst';analysisBusy=true;analystResult=null;updateShell();render();
  try { analystResult={...await api('/api/analysis',{mode},15000),title:mode==='today'?'Prioritized next moves':mode==='coverage'?'Research coverage':'Workspace audit'}; }
  catch { analystResult=offlineAnalysis(mode); }
  analysisBusy=false;if(tab==='analyst')render();
}
function showModal(title,description,body) {
  const modal=$('#modal');modal.innerHTML=`<div class="modal-header"><div><h2 id="modal-title">${title}</h2>${description?`<p>${description}</p>`:''}</div><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></div><div class="modal-body">${body}</div>`;if(!modal.open)modal.showModal();requestAnimationFrame(()=>modal.querySelector('input,select,textarea,button:not(.modal-close)')?.focus());
}
function field(name,label,value='',type='text',extra='') { return `<div class="form-field ${extra.includes('span-2')?'span-2':''}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${escape(value)}" ${extra.replace('span-2','')}></div>`; }
function selectField(name,label,options,value='') { return `<div class="form-field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(o=>`<option value="${escape(typeof o==='string'?o:o.value)}" ${(typeof o==='string'?o:o.value)===value?'selected':''}>${escape(typeof o==='string'?o:o.label)}</option>`).join('')}</select></div>`; }
function targetOptions(includeEmpty=true) { return [...(includeEmpty?[{value:'',label:'Workspace / no target'}]:[]),...state.targets.map(t=>({value:t.id,label:t.name}))]; }
function showTargetForm(id='') {
  const t=targetById(id)||{};
  showModal(id?'Edit target':'Add an acquisition target','Start with what you know. Keep unverified ownership and contact details blank.',`<form id="target-form" data-id="${escape(id)}"><div class="form-grid">${field('name','Company name',t.name||'','text','required maxlength="200"')}${field('legalName','Legal entity name',t.legalName||'')}${selectField('type','Business type',['Convenience retailer','Fuel marketer','Fuel distributor','Mixed retail / wholesale','Other'],t.type||'Convenience retailer')}${field('states','States / regions (comma separated)',t.states?.join(', ')||'')}${field('siteCount','Reported site count',t.siteCount??'','number','min="0" max="100000"')}${selectField('stage','Pipeline stage',stages,t.stage||'Research')}${field('ownerName','Owner / decision maker',t.ownerName||'')}${field('ownerTitle','Owner title',t.ownerTitle||'')}${field('contactEmail','Sourced contact email',t.contactEmail||'','email')}${field('contactPhone','Sourced contact phone',t.contactPhone||'','tel')}${field('score','Your target score (0–100)',t.score??'','number','min="0" max="100"')}${selectField('confidence','Evidence confidence',['Low','Medium','High'],t.confidence||'Low')}${selectField('sellerSignal','Seller signal assessment',['Unknown','Watch','Strong'],t.sellerSignal||'Unknown')}${field('sellerSignalReason','Reason for the signal assessment',t.sellerSignalReason||'')}${field('nextAction','Next action',t.nextAction||'')}${field('dueDate','Next action due',t.dueDate||'','date')}<div class="form-field span-2"><label for="f-sourceUrls">Public source URLs (one per line)</label><textarea id="f-sourceUrls" name="sourceUrls" placeholder="https://company.example/about">${escape((t.sourceUrls||[]).join('\n'))}</textarea><small>Only valid http / https URLs are saved. Include evidence for named owners and contact details.</small></div><div class="form-field span-2"><label for="f-notes">Investment thesis & research notes</label><textarea id="f-notes" name="notes">${escape(t.notes||'')}</textarea></div></div><div class="form-actions"><button type="button" class="button secondary" data-action="close-modal">Cancel</button><button class="button primary" type="submit">${id?'Save changes':'Add target'}</button></div></form>`);
}
function showTargetDetail(id) {
  const t=targetById(id);if(!t)return;
  const records=state.sites.filter(s=>s.targetId===id);const tasks=state.tasks.filter(s=>s.targetId===id);
  showModal(escape(t.name),'Target record · '+escape(t.stage),`<div class="detail-hero"><span class="company-mark">${escape(initials(t.name))}</span><div>${sellerBadge(t)}${sampleBadge(t)}<p>${escape(t.type||'Business type unknown')} · ${escape(t.states.join(', ')||'Geography unknown')}</p></div></div><dl class="detail-facts"><div><dt>Reported sites</dt><dd>${number(t.siteCount)} · ${records.length} recorded</dd></div><div><dt>Owner</dt><dd>${escape(t.ownerName||'Not identified')}</dd></div><div><dt>Evidence confidence</dt><dd>${escape(t.confidence||'Unassessed')}</dd></div><div><dt>Legal name</dt><dd>${escape(t.legalName||'Not verified')}</dd></div><div><dt>Your assessment score</dt><dd>${t.score===undefined||t.score===null?'Unscored':number(t.score)+' / 100'}</dd></div><div><dt>Next action due</dt><dd>${t.dueDate?dateLabel(t.dueDate):'Not set'}</dd></div></dl>${t.sample?'<div class="callout yellow">This is an illustrative sample record. Its ownership, footprint and financial assumptions are not researched company facts.</div>':''}<div class="detail-section"><h3>Next action</h3><p>${escape(t.nextAction||'Define your next evidence-gathering step.')}</p></div><div class="detail-section"><h3>Seller signal context</h3><p>${escape(t.sellerSignalReason||'Seller willingness has not been established.')}</p></div>${t.contactEmail||t.contactPhone?`<div class="detail-section"><h3>Recorded contact</h3><p>${escape([t.contactEmail,t.contactPhone].filter(Boolean).join(' · '))}</p><p>Verify contact details against the saved source.</p></div>`:''}<div class="detail-section"><h3>Investment thesis & notes</h3><p>${escape(t.notes||'No notes saved.')}</p></div><div class="detail-section"><h3>Saved source links</h3>${t.sourceUrls?.length?t.sourceUrls.map(s=>link(s,s)).join(''):'<p>No public sources saved. Add evidence before relying on these facts.</p>'}</div>${tasks.length?`<div class="detail-section"><h3>Target tasks</h3>${taskRows(tasks)}</div>`:''}<div class="detail-controls"><button class="button primary" data-action="edit-target" data-id="${escape(id)}">Edit record</button><button class="button secondary" data-action="underwrite-target" data-id="${escape(id)}">Underwrite</button><button class="button secondary" data-action="research-target" data-id="${escape(id)}">✦ Research</button><button class="button secondary" data-action="target-brief" data-id="${escape(id)}">Build brief</button><button class="button ghost" data-action="target-task" data-id="${escape(id)}">＋ Task</button></div><hr class="section-divider"><button class="button danger small" data-action="delete-target" data-id="${escape(id)}">Delete target record</button>`);
}
function showTaskForm(targetId='') {
  showModal('Add a next action','Capture one useful step that moves the work forward.',`<form id="task-form"><div class="form-grid">${field('title','Action', '','text','required span-2 maxlength="300"')}${selectField('targetId','Related target',targetOptions(),targetId)}${field('dueDate','Due date',today(),'date')}</div><div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button primary">Save task</button></div></form>`);
}
function showSignalForm() {
  showModal('Save a public signal','Record the event and its source. Assess seller interest separately.',`<form id="signal-form"><div class="form-grid">${field('title','Signal headline','','text','required span-2 maxlength="300"')}${selectField('targetId','Related target',targetOptions())}${field('date','Event / observation date',today(),'date')}${selectField('confidence','Evidence confidence',['Low','Medium','High'],'Low')}${field('sourceUrl','Source URL','','url')}<div class="form-field span-2"><label for="f-detail">What changed? What remains uncertain?</label><textarea id="f-detail" name="detail" required></textarea></div></div><div class="form-actions"><button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button primary">Save signal</button></div></form>`);
}
function showSiteForm(id='') {
  const s=state.sites.find(s=>s.id===id)||{};
  showModal(id?'Edit site record':'Add a site record','Keep property facts and operating inputs tied to the company.',`<form id="site-form" data-id="${escape(id)}"><div class="form-grid">${selectField('targetId','Target company',targetOptions(),s.targetId||'')}${field('address','Street address / location name',s.address||'','text','required')}${field('city','City',s.city||'')}${field('state','State / region',s.state||'')}${field('fuelBrand','Fuel brand',s.fuelBrand||'')}${selectField('ownership','Property structure',['Unknown','Owned','Leased','Dealer-operated','Other'],s.ownership||'Unknown')}${field('annualGallons','Annual fuel gallons',s.annualGallons??'','number','min="0"')}${field('sourceUrl','Source URL',s.sourceUrl||'','url')}${field('latitude','Latitude (optional)',s.latitude??'','number','min="-90" max="90" step="0.000001"')}${field('longitude','Longitude (optional)',s.longitude??'','number','min="-180" max="180" step="0.000001"')}<div class="form-field span-2"><label for="f-site-notes">Site notes</label><textarea id="f-site-notes" name="notes">${escape(s.notes||'')}</textarea></div></div><div class="form-actions">${id?`<button class="button danger" type="button" data-action="delete-site" data-id="${escape(id)}" style="margin-right:auto">Delete site</button>`:''}<button class="button secondary" type="button" data-action="close-modal">Cancel</button><button class="button primary">Save site</button></div></form>`);
}
function showSettings() {
  const docs=state.documents.filter(d=>d.type!=='brief');
  showModal('Workspace settings','Your acquisition mandate, storage and data controls.',`<section class="settings-section"><h3>Research mandate</h3><form id="settings-form"><div class="form-grid">${field('targetStates','Focus states (comma separated)',(state.settings.targetStates||[]).join(', '),'text','span-2')}${field('minSites','Minimum target sites',state.settings.minSites,'number','min="0"')}${field('maxSites','Maximum target sites',state.settings.maxSites,'number','min="0"')}${field('targetIrrPercent','Target investment IRR (%)',state.settings.targetIrrPercent??15,'number','min="0.01" max="100" step="0.1"')}${field('targetYieldPercent','Target annual cash yield (%)',state.settings.targetYieldPercent,'number','min="0.01" max="100" step="0.1"')}${field('watchTerms','Watch terms',state.settings.watchTerms||'')}</div><div class="form-actions"><button class="button primary small">Save preferences</button></div></form></section><section class="settings-section"><h3>Private workspace storage</h3><p>${storage==='durable'?'Changes are saved to the private app workspace, with a browser backup.':'Changes are saved only in this browser on this device. Export a backup to transfer data or preserve it before clearing browser storage.'}</p><div class="row-actions"><button class="button secondary small" data-action="export-json">Export full backup ↧</button><button class="button secondary small" data-action="export-csv">Export targets CSV ↧</button><button class="button secondary small" data-action="import">Import data ↥</button></div></section><section class="settings-section"><h3>AI research connection</h3><p>${ai.connected?`AI research is connected${ai.model?` (${escape(ai.model)})`:''}. Searches use public sources and your requested workspace context.`:'AI research is not connected. Connect OpenAI in the hosted app’s environment settings to enable sourced discovery, company research and analyst questions. Your workspace, briefs and financial model remain available.'}</p><button class="button secondary small" data-action="check-connection">Check connection</button></section>${docs.length?`<section class="settings-section"><h3>Imported documents</h3>${docs.map(d=>`<div class="document-row"><div><h3>${escape(d.name||d.title||'Document')}</h3><p>${dateLabel(d.uploadedAt||d.createdAt)}${d.sheets?' · '+d.sheets.map(s=>`${escape(s.name)}: ${number(s.rowCount)} rows, ${number(s.formulaCount)} formulas`).join(' · '):''}</p></div></div>`).join('')}<p class="help-text">Workbook formulas use saved values from the uploaded file; they are not recalculated here.</p></section>`:''}<section class="settings-section" style="margin-bottom:0;border:0"><h3>Sample dataset</h3><p>${state.sampleMode?'The sample dataset contains fictional profiles and illustrative operating assumptions. Clear it when you are ready to work with your own companies. Your personal records are kept.':'Your workspace has no sample records.'}</p><button class="button danger small" data-action="clear-samples" ${state.sampleMode?'':'disabled'}>Clear sample records</button></section>`);
}
function download(name,text,type='text/plain') {
  const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function csvValue(value) { const text=String(value??'');const safe=/^\s*[=+\-@]/.test(text)?"'"+text:text;return `"${safe.replace(/"/g,'""')}"`; }
function exportCsv() {
  const columns=['name','legalName','type','states','siteCount','ownerName','ownerTitle','contactEmail','contactPhone','stage','score','confidence','sellerSignal','sellerSignalReason','sourceUrls','notes','nextAction','dueDate','sample'];
  const rows=[columns.map(csvValue).join(','),...state.targets.map(t=>columns.map(k=>csvValue(Array.isArray(t[k])?t[k].join(k==='sourceUrls'?' | ':'; '):t[k])).join(','))];download(`deal-intelligence-targets-${today()}.csv`,rows.join('\r\n'),'text/csv;charset=utf-8');toast('Target CSV exported.');
}
function parseCsv(text) {
  const rows=[];let row=[],cell='',quoted=false;const input=text.replace(/^\uFEFF/,'');
  for(let n=0;n<input.length;n++){const c=input[n];if(c==='"'){if(quoted&&input[n+1]==='"'){cell+='"';n++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[n+1]==='\n')n++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
  if(quoted)throw new Error('CSV has an unclosed quoted field.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);if(!rows.length)return [];
  const headers=rows.shift().map(h=>h.trim());return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}
function mapImportedTarget(t) {
  const entries=Object.fromEntries(Object.entries(t).map(([k,v])=>[k.toLowerCase().replace(/[^a-z0-9]/g,''),v]));
  const pick=(...keys)=>keys.map(k=>entries[k]).find(v=>v!==undefined&&v!==null&&v!=='');
  const statesValue=pick('states','state','geography','region');const sources=pick('sourceurls','sources','sourceurl','website','url');
  const name=pick('name','companyname','company','target','targetname','legalname');
  if(!name)return null;
  const numeric=(...keys)=>{const v=pick(...keys);if(v===undefined)return undefined;const n=Number(String(v).replace(/[$,%\s,]/g,''));return Number.isFinite(n)?n:undefined;};
  return {...t,id:uid(),name:String(name),legalName:String(pick('legalname','legalentity')||''),type:String(pick('type','businesstype')||'Convenience retailer'),states:Array.isArray(statesValue)?statesValue:String(statesValue||'').split(/[,;|]/).map(v=>v.trim()).filter(Boolean),siteCount:numeric('sitecount','sites','locations','numberofsites')??null,ownerName:String(pick('ownername','owner','decisionmaker')||''),ownerTitle:String(pick('ownertitle','title')||''),contactEmail:String(pick('contactemail','email')||''),contactPhone:String(pick('contactphone','phone')||''),stage:stages.includes(pick('stage','pipelinestage'))?pick('stage','pipelinestage'):'Research',score:numeric('score','targetscore'),confidence:['High','Medium','Low'].includes(pick('confidence'))?pick('confidence'):'Low',sellerSignal:['Unknown','Watch','Strong'].includes(pick('sellersignal'))?pick('sellersignal'):'Unknown',sellerSignalReason:String(pick('sellersignalreason')||''),sourceUrls:(Array.isArray(sources)?sources:String(sources||'').split(/[\n|]/)).map(v=>typeof v==='string'?v:v.url||'').filter(safeUrl),notes:String(pick('notes','investmentthesis')||''),nextAction:String(pick('nextaction','action')||''),dueDate:String(pick('duedate')||''),sample:t.sample===true||t.sample==='true',financials:t.financials&&typeof t.financials==='object'?t.financials:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function mergeTargets(targets) {
  let added=0,duplicates=0;const key=t=>String(t.legalName||t.name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  for(const raw of targets){const t=mapImportedTarget(raw);if(!t)continue;const existing=state.targets.find(v=>key(v)===key(t)||String(v.name).toLowerCase().trim()===t.name.toLowerCase().trim());if(existing){duplicates++;existing.sourceUrls=[...new Set([...(existing.sourceUrls||[]),...t.sourceUrls])];for(const k of ['legalName','ownerName','ownerTitle','contactEmail','contactPhone'])if(!existing[k]&&t[k])existing[k]=t[k];}else{state.targets.push(t);added++;}}
  return {added,duplicates};
}
async function importFile(file) {
  if(!file)return;if(file.size>10*1024*1024){toast('Choose a file smaller than 10 MB.',true);return;}
  try {
    let data,targets,warnings=[],documentRecord=null;
    if(/\.xlsx$/i.test(file.name)) {
      if(!window.DealWorkbook?.readWorkbook)throw new Error('Workbook reader is unavailable in this version. Export the sheet as CSV, or open the fully built app.');
      const workbook=await window.DealWorkbook.readWorkbook(file);targets=workbook.targets||[];warnings=workbook.warnings||[];data={sites:workbook.sites||[]};documentRecord={id:uid(),name:file.name,type:'workbook',size:file.size,uploadedAt:new Date().toISOString(),sheets:workbook.sheets.map(s=>({name:s.name,rowCount:s.rows.length,formulaCount:typeof s.formulas==='number'?s.formulas:Array.isArray(s.formulaCells)?s.formulaCells.length:0}))};
    } else { const text=await file.text();if(/\.json$/i.test(file.name)){data=JSON.parse(text);targets=Array.isArray(data)?data:Array.isArray(data.targets)?data.targets:data.state?.targets;if(data.state)data=data.state;if(!targets)throw new Error('JSON must contain an array of targets or a workspace object with targets.');}else if(/\.csv$/i.test(file.name)){targets=parseCsv(text);data={};}else throw new Error('Use CSV, JSON or XLSX. Older XLS files should be exported as CSV or XLSX.'); }
    const valid=targets.map(mapImportedTarget).filter(Boolean);if(!valid.length&&!documentRecord)throw new Error('No target rows found. Include a name, company or target column.');
    importedData={targets:valid,full:data,documentRecord,warnings};
    showModal('Review your import',escape(file.name),`<div class="callout">${valid.length} company records found. Matching company names are merged; existing notes and assessments are preserved.</div>${warnings.map(w=>`<div class="callout yellow">${escape(w)}</div>`).join('')}${valid.slice(0,4).map(t=>`<div class="research-fact"><strong>${escape(t.name)}</strong><p>${escape(t.states.join(', ')||'Geography not supplied')} · ${number(t.siteCount)} sites</p></div>`).join('')}${valid.length>4?`<p class="help-text">Plus ${valid.length-4} more company records.</p>`:''}${Array.isArray(data?.sites)&&data.sites.length?`<p class="help-text">Includes ${data.sites.length} site records.</p>`:''}<div class="form-actions"><button class="button secondary" data-action="close-modal">Cancel</button><button class="button primary" data-action="confirm-import">Import ${valid.length?'records':'workbook'}</button></div>`);
  } catch(error) {toast(error.message,true);}finally{$('#import-file').value='';}
}
function confirmImport() {
  if(!importedData)return;const {added,duplicates}=mergeTargets(importedData.targets);
  const full=importedData.full;
  if(full&&typeof full==='object'&&!Array.isArray(full)){
    const map=new Map();for(const old of Array.isArray(full.targets)?full.targets:[]){const match=state.targets.find(t=>t.name.toLowerCase()===String(old.name||'').toLowerCase()||(old.legalName&&t.legalName===old.legalName));if(match&&old.id)map.set(old.id,match.id);}
    for(const key of ['sites','signals','tasks','notes','documents'])if(Array.isArray(full[key]))for(const entry of full[key]){if(!entry||typeof entry!=='object')continue;if(!state[key].some(e=>e.id&&e.id===entry.id))state[key].push({...entry,id:entry.id||uid(),targetId:map.get(entry.targetId)||entry.targetId||''});}
  }
  if(importedData.documentRecord)state.documents.push(importedData.documentRecord);
  importedData=null;$('#modal').close();commit(`${added} targets added${duplicates?`, ${duplicates} matching records merged`:''}.`);navigate('targets');
}
async function runAI(mode,prompt,targetId) {
  if(!ai.connected)throw new Error('AI research is not connected. Connect OpenAI in the hosted app’s environment settings, then check the connection in Workspace settings. Your saved data and underwriting remain available.');
  return await api('/api/ai',{mode,prompt,targetId});
}
async function researchTarget(id) {
  const t=targetById(id);if(!t)return;$('#modal').close();tab='analyst';location.hash='analyst';updateShell();aiBusy=true;analystResult=null;render();
  try {analystResult={...await runAI('research',`Research ${t.name}. Verify its legal identity, operating footprint, owners and sourced public contact details. Distinguish confirmed facts from gaps. Do not infer willingness to sell.`,id),title:`Research: ${t.name}`};}
  catch(error){analystResult={title:'Research connection',error:error.message};}aiBusy=false;if(tab==='analyst')render();
}
function saveBrief() {
  if(!currentBrief)return;if(state.documents.some(d=>d.id===currentBrief.id)){toast('This brief is already saved.');return;}state.documents.push({...currentBrief});commit('Investment brief saved.');render();
}
async function handleAction(action,id,button) {
  switch(action){
    case 'settings':showSettings();break;
    case 'close-modal':$('#modal').close();break;
    case 'add-target':showTargetForm();break;
    case 'edit-target':showTargetForm(id);break;
    case 'target-detail':if(id)showTargetDetail(id);break;
    case 'add-task':showTaskForm();break;
    case 'target-task':showTaskForm(id);break;
    case 'add-site':showSiteForm();break;
    case 'edit-site':showSiteForm(id);break;
    case 'add-signal':showSignalForm();break;
    case 'import':$('#import-file').click();break;
    case 'confirm-import':confirmImport();break;
    case 'export-json':download(`deal-intelligence-backup-${today()}.json`,JSON.stringify(state,null,2),'application/json');toast('Full workspace backup exported.');break;
    case 'export-csv':exportCsv();break;
    case 'clear-samples':{const ids=new Set(state.targets.filter(t=>t.sample).map(t=>t.id));for(const key of ['targets','sites','signals','tasks','notes','documents'])state[key]=state[key].filter(v=>!v.sample&&!ids.has(v.targetId));state.sampleMode=false;commit('Sample records cleared. Your personal records are kept.');showSettings();render();break;}
    case 'check-connection':button.disabled=true;try{const r=await api('/api/state',undefined,10000);ai=r.ai||ai;storage=r.storage||storage;updateShell();showSettings();toast(ai.connected?'AI research is connected.':'AI research is not connected yet.');}catch{toast('Using device-only storage. Hosted connection unavailable.',true);button.disabled=false;}break;
    case 'delete-target':{const t=targetById(id);if(!t)break;state.targets=state.targets.filter(t=>t.id!==id);for(const k of ['sites','signals','tasks','notes'])state[k]=state[k].filter(v=>v.targetId!==id);$('#modal').close();commit('Target and associated workspace records deleted.');render();break;}
    case 'delete-site':state.sites=state.sites.filter(s=>s.id!==id);$('#modal').close();commit('Site record deleted.');render();break;
    case 'quick-audit':runAnalysis('audit');break;
    case 'coverage':runAnalysis('coverage');break;
    case 'underwrite-target':{const t=targetById(id);selectedFinance=id;financeInputs=modelInputs(t);financeResult=null;$('#modal').close();navigate('underwriting');break;}
    case 'target-brief':currentBrief=baselineBrief(targetById(id));$('#modal').close();navigate('briefs');break;
    case 'research-target':researchTarget(id);break;
    case 'save-model':{const t=targetById(selectedFinance);if(t){t.financials={...financeInputs};t.updatedAt=new Date().toISOString();commit(`Model assumptions saved for ${t.name}.`);}else{state.settings.independentModel={...financeInputs};commit('Independent model assumptions saved.');}break;}
    case 'reset-model':financeInputs={...defaults};financeResult=null;render();toast('Model restored to illustrative starting assumptions.');break;
    case 'export-model':download(`deal-intelligence-model-${today()}.json`,JSON.stringify({target:targetById(selectedFinance)?.name||'Independent model',inputs:financeInputs,results:financeResult,exportedAt:new Date().toISOString()},null,2),'application/json');toast('Inputs and model results exported.');break;
    case 'audit-model':{const audit=window.DealFinance?.auditModel?.(financeInputs);const flags=audit?.issues||financeResult?.flags||[];const result={text:flags.length?flags.map(f=>f.message||String(f)).join('\n\n'):'No calculation warnings for the current inputs. Validate assumptions against operating records, leases and environmental reports.'};showModal('Underwriting review','Review current, unsaved model assumptions.',aiResponse(result));break;}
    case 'save-discovered':{const targets=hunterResult?.data?.targets||[];const result=mergeTargets(targets);commit(`${result.added} research targets saved${result.duplicates?`; ${result.duplicates} matches merged`:''}.`);navigate('targets');break;}
    case 'ai-brief':{const targetId=$('#brief-target').value;const t=targetById(targetId);if(!t){toast('Choose a target first.',true);break;}aiBusy=true;render();try{const r=await runAI('brief',`Create a sourced acquisition investment brief for ${t.name}. Use saved company facts and financial assumptions; label all unknowns and illustrative inputs.`,targetId);currentBrief={id:uid(),type:'brief',targetId,title:`${t.name} — Researched brief`,createdAt:new Date().toISOString(),text:(r.data?.brief||r.text||'No brief text was returned.')+(r.sources?.length?'\n\nSOURCES\n'+r.sources.map(s=>typeof s==='string'?s:s.url||s.sourceUrl).filter(Boolean).join('\n'):'')};}catch(error){toast(error.message,true);}aiBusy=false;if(tab==='briefs')render();break;}
    case 'save-brief':saveBrief();break;
    case 'download-brief':if(currentBrief)download(`${currentBrief.title.replace(/[^a-z0-9 -]/gi,'')}.txt`,currentBrief.text);break;
    case 'print-brief':if(currentBrief)window.print();break;
    case 'open-brief':currentBrief={...state.documents.find(d=>d.id===id)};render();break;
    case 'export-analysis':if(analystResult)download(`workspace-analysis-${today()}.txt`,analystResult.text||analystResult.error||'');break;
    case 'check-updates':{if(!state.targets.length){toast('Add targets before checking public updates.',true);break;}aiBusy=true;watchResult=null;render();try{watchResult=await runAI('monitor','Check saved target companies for recent public ownership, expansion, closure, property or succession developments. Cite sources and dates. Exclude sample targets. Do not infer seller willingness.');}catch(error){watchResult={error:error.message};}aiBusy=false;if(tab==='watchtower')render();break;}
    case 'save-ai-signals':{const signals=watchResult?.data?.signals||watchResult?.data?.findings||[];let added=0;for(const s of signals){if(!s.title)continue;if(state.signals.some(v=>v.title===s.title&&v.targetId===s.targetId))continue;state.signals.push({...s,id:uid(),targetId:s.targetId||'',date:s.date||today(),sourceUrl:safeUrl(s.sourceUrl)||safeUrl(s.sourceUrls?.[0])||'',confidence:['High','Medium','Low'].includes(s.confidence)?s.confidence:s.confidence==='confirmed'?'High':s.confidence==='reported'?'Medium':'Low',sample:false});added++;}commit(`${added} reported signals saved. Verify source context before updating seller assessments.`);render();break;}
  }
}

document.addEventListener('click',event=>{
  const nav=event.target.closest('[data-nav]');if(nav){navigate(nav.dataset.nav);return;}
  const action=event.target.closest('[data-action]');if(action){handleAction(action.dataset.action,action.dataset.id||'',action).catch(error=>toast(error.message,true));return;}
  const analysis=event.target.closest('[data-analysis]');if(analysis){runAnalysis(analysis.dataset.analysis);return;}
  const prompt=event.target.closest('[data-prompt]');if(prompt){$('#hunter-form textarea').value=prompt.dataset.prompt;$('#hunter-form textarea').focus();return;}
  if(!event.target.closest('.search-wrap'))$('#search-results').hidden=true;
});
document.addEventListener('change',event=>{
  if(event.target.dataset.task){const task=state.tasks.find(t=>t.id===event.target.dataset.task);if(task){task.done=event.target.checked;commit(task.done?'Task completed.':'Task reopened.');event.target.closest('.task-row').classList.toggle('done',task.done);}}
  if(event.target.dataset.filter){targetFilter[event.target.dataset.filter]=event.target.value;render();}
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!['target-form','task-form','signal-form','site-form','settings-form','hunter-form','analyst-form','brief-form'].includes(form.id))return;event.preventDefault();
  const values=Object.fromEntries(new FormData(form));
  try {
    switch(form.id){
      case 'target-form':{const current=targetById(form.dataset.id);const sources=values.sourceUrls.split(/[\n\r]/).map(v=>v.trim()).filter(Boolean);if(sources.some(s=>!safeUrl(s)))throw new Error('Each source must be a valid http or https URL.');const t={...(current||{}),...values,id:current?.id||uid(),name:values.name.trim(),states:values.states.split(/[,;|]/).map(s=>s.trim().toUpperCase()).filter(Boolean),siteCount:values.siteCount===''?null:Number(values.siteCount),score:values.score===''?undefined:Number(values.score),sourceUrls:sources,financials:current?.financials||{},sample:current?.sample||false,createdAt:current?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};if(!t.name)throw new Error('Enter a company name.');if(current)state.targets[state.targets.indexOf(current)]=t;else state.targets.push(t);$('#modal').close();commit(current?'Target updated.':'Target added to your universe.');render();break;}
      case 'task-form':state.tasks.push({...values,id:uid(),done:false,sample:false});$('#modal').close();commit('Next action saved.');render();break;
      case 'signal-form':if(values.sourceUrl&&!safeUrl(values.sourceUrl))throw new Error('Enter a valid http or https source URL.');state.signals.push({...values,id:uid(),sample:false});$('#modal').close();commit('Public signal saved.');render();break;
      case 'site-form':{if(values.sourceUrl&&!safeUrl(values.sourceUrl))throw new Error('Enter a valid http or https source URL.');const current=state.sites.find(s=>s.id===form.dataset.id);const s={...values,id:current?.id||uid(),latitude:values.latitude===''?null:Number(values.latitude),longitude:values.longitude===''?null:Number(values.longitude),annualGallons:values.annualGallons===''?null:Number(values.annualGallons),sample:current?.sample||false};if(current)state.sites[state.sites.indexOf(current)]=s;else state.sites.push(s);$('#modal').close();commit('Site record saved.');render();break;}
      case 'settings-form':if(Number(values.maxSites)<Number(values.minSites))throw new Error('Maximum site count must be at least the minimum.');state.settings={...state.settings,...values,targetStates:values.targetStates.split(/[,;|]/).map(s=>s.trim().toUpperCase()).filter(Boolean),minSites:Number(values.minSites)||0,maxSites:Number(values.maxSites)||0,targetYieldPercent:Number(values.targetYieldPercent)||15,targetIrrPercent:Number(values.targetIrrPercent)||15};commit('Research preferences saved.');showSettings();render();break;
      case 'hunter-form':aiBusy=true;state.settings.lastSearch=values.prompt;hunterResult=null;render();try{hunterResult=await runAI('discover',values.prompt);}catch(error){hunterResult={error:error.message};}aiBusy=false;if(tab==='hunter')render();break;
      case 'analyst-form':aiBusy=true;analystResult=null;render();try{analystResult=await runAI('analyst',values.prompt,values.targetId||undefined);}catch(error){analystResult={error:error.message};}aiBusy=false;if(tab==='analyst')render();break;
      case 'brief-form':{const t=targetById(values.targetId);if(!t)throw new Error('Choose a target first.');currentBrief=baselineBrief(t);render();break;}
    }
  }catch(error){toast(error.message,true);}
});
$('#global-search').addEventListener('input',event=>{
  search=event.target.value.trim();const box=$('#search-results');if(!search){box.hidden=true;if(['targets','sites','pipeline','watchtower'].includes(tab))render();return;}
  const q=search.toLowerCase();const results=state.targets.filter(t=>[t.name,t.legalName,t.ownerName,...t.states].join(' ').toLowerCase().includes(q)).slice(0,6);
  box.innerHTML=results.length?results.map(t=>`<button data-action="target-detail" data-id="${escape(t.id)}">${escape(t.name)}<small>${escape(t.ownerName||'Owner unknown')} · ${escape(t.states.join(', '))} · ${number(t.siteCount)} sites</small></button>`).join(''):`<p>No targets match “${escape(search)}”.</p>`;box.hidden=false;if(['targets','sites','pipeline','watchtower'].includes(tab))render();
});
$('#global-search').addEventListener('keydown',event=>{if(event.key==='Escape'){$('#search-results').hidden=true;event.target.blur();}if(event.key==='ArrowDown'){$('#search-results button')?.focus();event.preventDefault();}});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)&&!$('#modal').open){event.preventDefault();$('#global-search').focus();}if(event.target.closest('#search-results')&&['ArrowDown','ArrowUp'].includes(event.key)){const buttons=$$('#search-results button');let n=buttons.indexOf(event.target)+(event.key==='ArrowDown'?1:-1);buttons[(n+buttons.length)%buttons.length]?.focus();event.preventDefault();}});
$('#import-file').accept='.csv,.json,.xlsx,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
$('#import-file').addEventListener('change',event=>importFile(event.target.files[0]));
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('#modal').close();}});
$('#mobile-menu').addEventListener('click',()=>{const expanded=$('.sidebar').classList.toggle('mobile-open');$('#mobile-menu').setAttribute('aria-expanded',String(expanded));});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(next!==tab&&tabs.some(t=>t[0]===next)){tab=next;updateShell();render();}});

async function boot() {
  let cached=null;try{const value=localStorage.getItem(localKey);if(value)cached=JSON.parse(value);}catch{}
  if(cached)state=normalizedState(cached);else if(window.DealSeed)state=normalizedState(window.DealSeed());
  updateShell();render();
  const [workspaceResult,financeConfig]=await Promise.allSettled([api('/api/state',undefined,12000),api('/api/finance',undefined,12000)]);
  if(workspaceResult.status==='fulfilled') {
    const r=workspaceResult.value;storage=r.storage||'durable';ai=r.ai||ai;
    state=storage!=='durable'&&cached?normalizedState(cached):normalizedState(r.state);
    serverVersion=r.state?.updatedAt;
    localSave();$('#save-status').textContent=storage==='durable'?'All changes saved':'Saved on this device';
    if(storage!=='durable'&&cached){
      try{const restored=await api('/api/state',{state,expectedUpdatedAt:serverVersion},12000);serverVersion=restored.state?.updatedAt||serverVersion;if(serverVersion)state.updatedAt=serverVersion;localSave();}
      catch(error){if(error.status===409){saveConflict=true;$('#save-status').textContent='Local changes not synced · workspace changed elsewhere';toast('Workspace changed elsewhere. Export a backup of your local edits before reloading.',true);}}
    }
  }
  else {storage='browser';$('#save-status').textContent='Saved on this device';if(!cached&&!window.DealSeed){try{const module=await import('../lib/seed.mjs');state=normalizedState(module.initialState());localSave();}catch{}}}
  if(financeConfig.status==='fulfilled'){Object.assign(defaults,financeConfig.value.defaults||{});financeFields=financeConfig.value.fields||[];}
  if(!window.DealFinance){try{window.DealFinance=await import('../lib/finance.mjs');Object.assign(defaults,window.DealFinance.defaultInputs||{});}catch{}}
  if(!window.DealWorkbook){try{await import('../lib/workbook.js');}catch{}}
  financeInputs={...defaults,...state.settings.independentModel};updateShell();render();
}
boot();

})();
