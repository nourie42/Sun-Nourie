(() => {
  'use strict';

  const BOT_KEY = 'ai-council-bots-v1';
  const SELECTED_KEY = 'ai-council-selected-bots-v1';
  const HISTORY_KEY = 'ai-council-bot-room-history-v1';
  const ACTIVITY_KEY = 'ai-council-bot-activity-v1';
  const COLORS = ['#1687ff','#ff2146','#00c877','#8b46ff','#ff6d00','#9a6238','#f2ca36','#ff72b6'];
  let providers = [];
  let bots = loadArray(BOT_KEY);
  let selected = new Set(loadArray(SELECTED_KEY));
  let history = loadArray(HISTORY_KEY).slice(0, 30);
  let activity = loadObject(ACTIVITY_KEY);
  let editingId = null;
  let selectedColor = COLORS[0];
  let searchText = '';
  let pendingAction = null;

  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('botStatus'), searchBtn: $('searchBtn'), addBotBtn: $('addBotBtn'), searchWrap: $('searchWrap'), searchInput: $('searchInput'), botList: $('botList'),
    starterBtn: $('starterBtn'), exportBtn: $('exportBtn'), importBtn: $('importBtn'), importFile: $('importFile'),
    botsPanel: $('botsPanel'), hotPanel: $('hotPanel'), historyPanel: $('historyPanel'),
    hotPicker: $('hotPicker'), roomTopic: $('roomTopic'), roomMode: $('roomMode'), roomRounds: $('roomRounds'), runRoomBtn: $('runRoomBtn'), roomNotice: $('roomNotice'), roomResults: $('roomResults'), historyList: $('historyList'),
    editorBack: $('editorBack'), editorSheet: $('editorSheet'), editorTitle: $('editorTitle'), botName: $('botName'), botRole: $('botRole'), botProvider: $('botProvider'), botInstructions: $('botInstructions'),
    toolWeb: $('toolWeb'), toolGmail: $('toolGmail'), toolBrowser: $('toolBrowser'), toolShopping: $('toolShopping'), colorPalette: $('colorPalette'), deleteBotBtn: $('deleteBotBtn'), cancelBotBtn: $('cancelBotBtn'), saveBotBtn: $('saveBotBtn'),
    accessBack: $('accessBack'), accessSheet: $('accessSheet'), accessCode: $('accessCode'), cancelAccessBtn: $('cancelAccessBtn'), saveAccessBtn: $('saveAccessBtn'),
  };

  const roomAttachmentCtl=window.AIContext?.setupAttachmentController({textareaId:'roomTopic',key:'hot-room'})||{get:()=>[],clear:()=>{},has:()=>false,names:()=>[]};
  const locationContext=()=>window.AIContext?.getLocationContext?.()||Promise.resolve({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',locale:navigator.language||''});
  function loadArray(key) { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  function loadObject(key) { try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }
  function saveBots() { localStorage.setItem(BOT_KEY, JSON.stringify(bots.slice(0, 50))); }
  function saveSelected() { localStorage.setItem(SELECTED_KEY, JSON.stringify([...selected])); }
  function saveHistory() { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 30))); }
  function saveActivity() { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity)); }
  function code() { try { return sessionStorage.getItem('ai-council-access') || ''; } catch { return ''; } }
  function saveCode(value) { try { sessionStorage.setItem('ai-council-access', value); } catch {} }
  function id() { return `bot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  function initials(name) { return String(name || 'AI').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'AI'; }
  function provider(id) { return providers.find((p) => p.id === id); }
  function providerLabel(id) { return provider(id)?.label || ({ openai:'OpenAI', anthropic:'Claude', gemini:'Gemini', xai:'Grok' }[id] || id); }
  function configured(id) { return provider(id)?.configured === true; }
  function healthStatus(id) { return provider(id)?.healthStatus || (configured(id) ? 'unchecked' : 'not_connected'); }
  function healthBlocked(id) { return ['no_credits','auth_error','workspace_required','model_error','error','busy','not_connected'].includes(healthStatus(id)); }
  function healthLabel(id) { return provider(id)?.healthLabel || (configured(id) ? 'Credits not checked' : 'Not connected'); }
  async function checkHealth(ids = [], force = false) {
    if (!code()) return { ok:false, requiresAccess:true, checked:[] };
    const response = await fetch('/api/ai-agent/provider-health', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-ai-council-code':code()},
      body:JSON.stringify({providers:ids,force}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not check AI model availability.');
    providers = Array.isArray(data.providers) ? data.providers : providers;
    renderProviderSelect();
    renderBots();
    renderHotPicker();
    renderStatusText();
    return data;
  }
  function renderStatusText() {
    const connected = providers.filter((p) => p.configured).length;
    const ready = providers.filter((p) => p.healthStatus === 'ready').length;
    const blocked = providers.filter((p) => p.configured && healthBlocked(p.id)).length;
    const checked = providers.some((p) => p.healthStatus && p.healthStatus !== 'unchecked' && p.healthStatus !== 'not_connected');
    els.status.textContent = checked
      ? `${ready} AI model${ready === 1 ? '' : 's'} ready${blocked ? ` · ${blocked} unavailable` : ''}`
      : `${connected} of 4 AI providers connected · credits checked before use`;
  }
  function toolsOf(bot) { return { webSearch: true, gmail: !!bot?.tools?.gmail, browser: !!bot?.tools?.browser, shopping: !!bot?.tools?.shopping }; }
  function currentPreview(bot) { return activity[bot.id]?.preview || bot.role || 'Tap to chat'; }
  function fmt(ts) { if (!ts) return ''; const d = new Date(ts), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : d.toLocaleDateString([], { weekday:'short' }); }
  function openSheet(sheet, back) { back.classList.add('show'); sheet.classList.add('show'); sheet.setAttribute('aria-hidden', 'false'); }
  function closeSheet(sheet, back) { back.classList.remove('show'); sheet.classList.remove('show'); sheet.setAttribute('aria-hidden', 'true'); }
  function notice(el, text, type = 'notice') { el.innerHTML = text ? `<div class="notice ${type}">${String(text).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div>` : ''; }

  function migrateBots() {
    let changed = false;
    bots = bots.filter((b) => b && b.id && b.name).map((b, i) => {
      const next = { ...b };
      if (!['openai','anthropic','gemini','xai'].includes(next.provider)) { next.provider = 'openai'; changed = true; }
      next.color ||= COLORS[i % COLORS.length];
      next.tools = toolsOf(next);
      return next;
    });
    if (changed) saveBots();
  }

  function renderBots() {
    els.botList.replaceChildren();
    const q = searchText.trim().toLowerCase();
    const list = bots.filter((b) => !q || [b.name, b.role, b.instructions, providerLabel(b.provider)].join(' ').toLowerCase().includes(q));
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-list';
      empty.innerHTML = bots.length ? '<strong>No bots found</strong>Try a different search.' : '<strong>No bots yet</strong>Tap + to make one, or create the starter team.';
      els.botList.append(empty);
      return;
    }
    list.forEach((bot) => {
      const row = document.createElement('div');
      row.className = 'bot-row';
      row.tabIndex = 0;
      const avatar = document.createElement('div');
      avatar.className = 'bot-avatar';
      avatar.style.setProperty('--bot', bot.color || COLORS[0]);
      avatar.textContent = initials(bot.name);
      const main = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'bot-name';
      name.textContent = bot.name;
      const preview = document.createElement('div');
      preview.className = 'bot-preview';
      const state = healthStatus(bot.provider);
      preview.textContent = `${providerLabel(bot.provider)}${state === 'ready' ? '' : ` · ${healthLabel(bot.provider)}`} · ${currentPreview(bot)}`;
      main.append(name, preview);
      const t = toolsOf(bot);
      const labels = [];
      if (t.webSearch) labels.push('🌐 Web');
      if (t.gmail) labels.push('✉ Gmail');
      if (t.browser) labels.push('◎ Browser');
      if (t.shopping) labels.push('🛒 Shop');
      if (labels.length) {
        const badges = document.createElement('div');
        badges.className = 'tool-badges';
        labels.forEach((text) => { const badge = document.createElement('span'); badge.className = 'mini-badge'; badge.textContent = text; badges.append(badge); });
        main.append(badges);
      }
      const meta = document.createElement('div');
      meta.className = 'bot-meta';
      const time = document.createElement('div');
      time.textContent = fmt(activity[bot.id]?.at);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'edit-bot';
      edit.textContent = '⚙';
      edit.setAttribute('aria-label', `Edit ${bot.name}`);
      edit.addEventListener('click', (event) => { event.stopPropagation(); openEditor(bot.id); });
      meta.append(time, edit);
      row.append(avatar, main, meta);
      row.addEventListener('click', () => { location.href = `/ai-council/chat.html?bot=${encodeURIComponent(bot.id)}`; });
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter') location.href = `/ai-council/chat.html?bot=${encodeURIComponent(bot.id)}`; });
      els.botList.append(row);
    });
  }

  function renderProviderSelect(preferred) {
    els.botProvider.replaceChildren();
    providers.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.disabled = !p.configured || healthBlocked(p.id);
      option.textContent = `${p.label}${p.configured ? ` · ${p.model} · ${healthLabel(p.id)}` : ' · not connected'}`;
      els.botProvider.append(option);
    });
    const fallback = providers.find((p) => p.configured && !healthBlocked(p.id))?.id || providers.find((p) => p.configured)?.id || 'openai';
    els.botProvider.value = preferred && providers.some((p) => p.id === preferred && p.configured && !healthBlocked(p.id)) ? preferred : fallback;
  }

  function renderPalette() {
    els.colorPalette.replaceChildren();
    COLORS.forEach((color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = `width:32px;height:32px;border-radius:10px;background:${color};border:${selectedColor === color ? '3px solid #fff' : '2px solid transparent'}`;
      button.addEventListener('click', () => { selectedColor = color; renderPalette(); });
      els.colorPalette.append(button);
    });
  }

  function openEditor(botId = null) {
    editingId = botId;
    const bot = bots.find((b) => b.id === botId);
    els.editorTitle.textContent = bot ? `Edit ${bot.name}` : 'Create Bot';
    els.botName.value = bot?.name || '';
    els.botRole.value = bot?.role || '';
    els.botInstructions.value = bot?.instructions || '';
    const t = toolsOf(bot);
    els.toolWeb.checked = true; els.toolWeb.disabled = true;
    els.toolGmail.checked = t.gmail;
    els.toolBrowser.checked = t.browser;
    els.toolShopping.checked = t.shopping;
    selectedColor = bot?.color || COLORS[bots.length % COLORS.length];
    renderProviderSelect(bot?.provider);
    renderPalette();
    els.deleteBotBtn.classList.toggle('hidden', !bot);
    openSheet(els.editorSheet, els.editorBack);
    setTimeout(() => els.botName.focus(), 160);
  }

  function saveBot() {
    const name = els.botName.value.trim();
    const providerId = els.botProvider.value;
    if (!name) return alert('Give your bot a name.');
    if (!providerId) return alert('Choose an AI for this bot.');
    const record = {
      id: editingId || id(), name,
      role: els.botRole.value.trim() || 'Personal helper',
      provider: providerId,
      instructions: els.botInstructions.value.trim() || 'Be accurate, helpful, easy to understand, and follow the user’s request.',
      color: selectedColor,
      tools: { webSearch: true, gmail: els.toolGmail.checked, browser: els.toolBrowser.checked, shopping: els.toolShopping.checked },
    };
    const index = bots.findIndex((b) => b.id === editingId);
    if (index >= 0) bots[index] = record; else bots.unshift(record);
    saveBots();
    closeSheet(els.editorSheet, els.editorBack);
    editingId = null;
    renderBots();
    renderHotPicker();
  }

  function deleteBot() {
    if (!editingId) return;
    const bot = bots.find((b) => b.id === editingId);
    if (!confirm(`Delete ${bot?.name || 'this bot'}?`)) return;
    bots = bots.filter((b) => b.id !== editingId);
    selected.delete(editingId);
    delete activity[editingId];
    saveBots(); saveSelected(); saveActivity();
    closeSheet(els.editorSheet, els.editorBack);
    editingId = null;
    renderBots(); renderHotPicker();
  }

  function createStarterTeam() {
    const usable = providers.filter((p) => p.configured);
    if (!usable.length) return alert('Connect at least one AI first.');
    if (bots.length && !confirm('Add the starter bots to your current bots?')) return;
    const now = Date.now();
    const providerId = usable[0].id;
    bots.unshift(
      { id:`research-${now}`, name:'Researcher', role:'Find facts and current information', provider:providerId, color:COLORS[0], instructions:'Research carefully. Separate facts from guesses. Explain the answer simply and include the most useful evidence.', tools:{webSearch:true,gmail:false,browser:false,shopping:false} },
      { id:`shop-${now}`, name:'Shopping Helper', role:'Find and compare products', provider:providerId, color:COLORS[3], instructions:'Find products that match exactly what the user asks for. Compare real features, price, availability, and customer feedback. Explain the best choice clearly.', tools:{webSearch:true,gmail:false,browser:false,shopping:true} },
      { id:`helper-${now}`, name:'Everyday Helper', role:'Help with everyday questions and tasks', provider:providerId, color:COLORS[2], instructions:'Be friendly, practical, clear, and easy to understand. Ask a question only when you truly need more information.', tools:{webSearch:true,gmail:false,browser:false,shopping:false} },
    );
    saveBots(); renderBots(); renderHotPicker();
  }

  function renderHotPicker() {
    els.hotPicker.replaceChildren();
    if (!bots.length) { els.hotPicker.innerHTML = '<div class="empty-list"><strong>No bots yet</strong>Create bots first.</div>'; return; }
    bots.forEach((bot) => {
      const label = document.createElement('label');
      label.className = 'toggle-line';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(bot.id);
      checkbox.disabled = !configured(bot.provider) || healthBlocked(bot.provider);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (selected.size >= 6) { checkbox.checked = false; return alert('Hot Room can use up to 6 bots.'); }
          selected.add(bot.id);
        } else selected.delete(bot.id);
        saveSelected();
      });
      const text = document.createElement('span');
      text.innerHTML = `<b>${bot.name}</b><small>${providerLabel(bot.provider)} · ${healthLabel(bot.provider)} · ${bot.role || ''}</small>`;
      label.append(checkbox, text);
      els.hotPicker.append(label);
    });
  }

  function requestAccess(after) {
    if (code()) return after();
    pendingAction = after;
    els.accessCode.value = '';
    openSheet(els.accessSheet, els.accessBack);
    setTimeout(() => els.accessCode.focus(), 150);
  }

  async function prepareRoomAttachments(attachments) {
    if (!attachments.length) return { text: "", meta: [] };
    const texts = [];
    const meta = [];
    for (let i = 0; i < attachments.length; i += 1) {
      notice(els.roomNotice, `Reading attachment ${i + 1} of ${attachments.length}…`);
      let response;
      try {
        response = await fetch('/api/ai-agent/attachment/prepare', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'x-ai-council-code': code() },
          body: JSON.stringify({ attachment: attachments[i] }),
        });
      } catch (error) {
        throw new Error(`The connection closed while uploading ${attachments[i].name}. Try that file again or use a smaller copy.`);
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `Could not read ${attachments[i].name}.`);
      if (data.attachmentText) texts.push(data.attachmentText);
      if (Array.isArray(data.attachments)) meta.push(...data.attachments);
    }
    return { text: texts.join('\n\n'), meta };
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function hotRoomProgressText(progress = {}) {
    if (progress.message) return progress.message;
    if (progress.phase === 'summary') return 'Bots finished · building the team answer…';
    if (progress.phase === 'round') return `Round ${progress.round || 1} of ${progress.rounds || 1} · ${progress.completedTurns || 0} of ${progress.totalTurns || 0} bot turns complete…`;
    return 'The bots are working together…';
  }

  async function waitForHotRoom(jobId) {
    const deadline = Date.now() + 12 * 60 * 1000;
    let connectionFailures = 0;
    while (Date.now() < deadline) {
      await sleep(1200);
      let response;
      try {
        response = await fetch(`/api/ai-agent/bots/run/${encodeURIComponent(jobId)}`, {
          method: 'GET',
          headers: { 'x-ai-council-code': code() },
          cache: 'no-store',
        });
      } catch {
        connectionFailures += 1;
        notice(els.roomNotice, `Reconnecting to the Hot Room… (${connectionFailures})`);
        if (connectionFailures >= 8) throw new Error('The page could not reconnect to the Hot Room. The bots may still be finishing in the background. Wait a moment, then try again.');
        continue;
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || `Hot Room status check failed (${response.status}).`);
      connectionFailures = 0;
      notice(els.roomNotice, hotRoomProgressText(payload.progress));

      if (payload.status === 'complete') {
        if (!payload.result?.ok) throw new Error(payload.result?.error || 'The Hot Room finished without a usable answer.');
        return payload.result;
      }
      if (payload.status === 'failed') throw new Error(payload.error || payload.progress?.message || 'Hot Room failed.');
    }
    throw new Error('The Hot Room is taking longer than 12 minutes. Your topic and files are still here; try again in a moment.');
  }

  async function runRoom() {
    const chosen = bots.filter((b) => selected.has(b.id)).slice(0, 6);
    const topic = els.roomTopic.value.trim();
    if (chosen.length < 2) return notice(els.roomNotice, 'Pick at least two bots.', 'error');
    if (!topic && !roomAttachmentCtl.has()) return notice(els.roomNotice, 'Tell the bots what to work on or attach a file.', 'error');
    if (!code()) return requestAccess(runRoom);
    const modelIds = [...new Set(chosen.map((b) => b.provider))];
    try {
      await checkHealth(modelIds, true);
    } catch (error) {
      return notice(els.roomNotice, error.message || String(error), 'error');
    }
    const blockedModels = modelIds.filter((id) => healthStatus(id) !== 'ready');
    if (blockedModels.length) {
      const detail = blockedModels.map((id) => `${providerLabel(id)}: ${healthLabel(id)}`).join('; ');
      return notice(els.roomNotice, `Hot Room was not started. ${detail}`, 'error');
    }
    const attachments=roomAttachmentCtl.get(); const location=await locationContext();
    els.runRoomBtn.disabled = true;
    els.roomResults.replaceChildren();
    try {
      const preparedFiles = await prepareRoomAttachments(attachments);
      notice(els.roomNotice, 'The bots are working together…');
      const response = await fetch('/api/ai-agent/bots/run', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'x-ai-council-code': code() },
        body: JSON.stringify({ topic: topic || 'Review the attached file(s).', bots: chosen, mode: els.roomMode.value, rounds: Number(els.roomRounds.value), preparedAttachmentText: preparedFiles.text, preparedAttachments: preparedFiles.meta, location }),
      });
      const start = await response.json().catch(() => ({}));
      if (!response.ok || !start.ok) throw new Error(start.error || 'Hot Room failed.');
      let data = start;
      if (response.status === 202 && start.jobId) {
        notice(els.roomNotice, hotRoomProgressText(start.progress));
        data = await waitForHotRoom(start.jobId);
      }
      if (data.summary) {
        const card = document.createElement('div'); card.className = 'room-turn'; card.innerHTML = '<strong>Team Answer</strong>';
        const p = document.createElement('p'); p.textContent = data.summary; card.append(p); els.roomResults.append(card);
      }
      (data.turns || []).forEach((turn) => {
        const card = document.createElement('div'); card.className = 'room-turn';
        const strong = document.createElement('strong'); strong.textContent = `${turn.name} · ${providerLabel(turn.provider)} · Round ${turn.round}${turn.webSearchUsed ? ' · 🌐 Live web' : ''}`;
        const p = document.createElement('p'); p.textContent = turn.ok ? turn.text : `Error: ${turn.error}`;
        card.append(strong, p); els.roomResults.append(card);
        if (turn.ok) activity[turn.botId] = { at: Date.now(), preview: String(turn.text).slice(0, 150) };
      });
      saveActivity(); renderBots();
      history.unshift({ at:Date.now(), topic, mode:els.roomMode.value, botNames:chosen.map((b) => b.name), summary:data.summary || '', turns:data.turns || [] });
      saveHistory(); renderHistory();
      notice(els.roomNotice, 'Hot Room finished.', 'success');
    } catch (error) {
      const raw = error?.message || String(error);
      const message = raw === 'Failed to fetch'
        ? 'The connection dropped while starting the Hot Room. Your topic and files are still here. Check your connection and tap Start Hot Room again.'
        : raw;
      notice(els.roomNotice, message, 'error');
    } finally { els.runRoomBtn.disabled = false; }
  }

  function renderHistory() {
    els.historyList.replaceChildren();
    if (!history.length) { els.historyList.innerHTML = '<div class="empty-list"><strong>No history yet</strong>Your Hot Room sessions will show here.</div>'; return; }
    history.forEach((item) => {
      const card = document.createElement('div'); card.className = 'room-turn';
      const strong = document.createElement('strong'); strong.textContent = `${item.topic} · ${fmt(item.at)}`;
      const p = document.createElement('p'); p.textContent = item.summary || `${(item.botNames || []).join(', ')} worked on this.`;
      card.append(strong, p); els.historyList.append(card);
    });
  }

  function setView(view) {
    const map = { bots: els.botsPanel, hot: els.hotPanel, history: els.historyPanel };
    if (!map[view]) view = 'bots';
    Object.entries(map).forEach(([key, panel]) => panel.classList.toggle('active', key === view));
    document.querySelectorAll('.bottom-nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    els.searchBtn.classList.toggle('hidden', view !== 'bots');
    els.addBotBtn.classList.toggle('hidden', view !== 'bots');
    if (view === 'hot') renderHotPicker();
    if (view === 'history') renderHistory();
  }

  function exportBots() {
    const blob = new Blob([JSON.stringify({ version:2, exportedAt:new Date().toISOString(), bots }, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'ai-bots.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importBots(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = (Array.isArray(parsed) ? parsed : parsed.bots || []).filter((b) => b?.name).slice(0, 50).map((b, i) => ({
        id:b.id || id(), name:String(b.name).slice(0,60), role:String(b.role || 'Personal helper').slice(0,220),
        provider:['openai','anthropic','gemini','xai'].includes(b.provider) ? b.provider : 'openai', instructions:String(b.instructions || '').slice(0,5000), color:b.color || COLORS[i % COLORS.length], tools:toolsOf(b),
      }));
      if (!incoming.length) throw new Error('No bots were found in that file.');
      const map = new Map(bots.map((b) => [b.id, b])); incoming.forEach((b) => map.set(b.id, b)); bots = [...map.values()].slice(0,50); saveBots(); renderBots(); renderHotPicker();
    } catch (error) { alert(error.message || 'Could not import bots.'); }
    finally { els.importFile.value = ''; }
  }

  async function loadStatus() {
    try {
      const response = await fetch('/api/ai-agent/status', { cache:'no-store' });
      const data = await response.json();
      providers = Array.isArray(data.providers) ? data.providers : [];
      renderProviderSelect(); renderBots(); renderHotPicker(); renderStatusText();
      if (code()) {
        try { await checkHealth(); }
        catch (error) { els.status.textContent = error.message || 'AI model availability check failed'; }
      }
    } catch { els.status.textContent = 'AI provider status unavailable'; }
  }

  migrateBots();
  els.searchBtn.addEventListener('click', () => { els.searchWrap.classList.toggle('hidden'); if (!els.searchWrap.classList.contains('hidden')) els.searchInput.focus(); });
  els.searchInput.addEventListener('input', () => { searchText = els.searchInput.value; renderBots(); });
  els.addBotBtn.addEventListener('click', () => openEditor());
  els.starterBtn.addEventListener('click', createStarterTeam);
  els.exportBtn.addEventListener('click', exportBots);
  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => { const file = els.importFile.files?.[0]; if (file) importBots(file); });
  els.editorBack.addEventListener('click', () => closeSheet(els.editorSheet, els.editorBack));
  els.cancelBotBtn.addEventListener('click', () => closeSheet(els.editorSheet, els.editorBack));
  els.saveBotBtn.addEventListener('click', saveBot);
  els.deleteBotBtn.addEventListener('click', deleteBot);
  els.runRoomBtn.addEventListener('click', runRoom);
  document.querySelectorAll('.bottom-nav button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  els.cancelAccessBtn.addEventListener('click', () => { pendingAction = null; closeSheet(els.accessSheet, els.accessBack); });
  els.accessBack.addEventListener('click', () => { pendingAction = null; closeSheet(els.accessSheet, els.accessBack); });
  els.saveAccessBtn.addEventListener('click', () => {
    const value = els.accessCode.value.trim(); if (!value) return;
    saveCode(value); const after = pendingAction; pendingAction = null; closeSheet(els.accessSheet, els.accessBack); if (after) after();
  });

  renderBots(); renderHistory(); loadStatus();
  const params = new URLSearchParams(location.search);
  const requestedView = params.get('view');
  if (requestedView === 'council') location.href = '/ai-council/?view=council';
  else if (['bots','hot','history'].includes(requestedView)) setView(requestedView);
  const edit = params.get('edit'); if (edit) setTimeout(() => openEditor(edit), 250);
})();
