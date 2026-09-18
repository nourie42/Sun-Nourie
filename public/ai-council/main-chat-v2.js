(() => {
  'use strict';

  const PROVIDER_ORDER = ['best', 'openai', 'anthropic', 'gemini', 'xai'];
  const PROVIDER_INFO = {
    best: { label: 'Pick the best for me', icon: '⭐', desc: "We'll choose the best connected AI for your question." },
    openai: { label: 'OpenAI', icon: '◎', desc: 'Great all-around for reasoning, coding, and analysis.' },
    anthropic: { label: 'Claude', icon: 'C', desc: 'Great for writing, documents, and careful language.' },
    gemini: { label: 'Gemini', icon: 'G', desc: 'Great for Google-centered questions and general help.' },
    xai: { label: 'Grok', icon: 'X', desc: 'Great for X/social topics and conversational answers.' },
  };
  const HISTORY_KEY = 'ai-main-chat-v2';
  const PREF_KEY = 'ai-main-provider-v2';
  const WEB_KEY = 'ai-main-web-v2';
  let providers = [];
  let selected = localStorage.getItem(PREF_KEY) || 'best';
  let webOn = true;
  let messages = loadMessages();
  let sending = false;
  let pendingAction = null;

  const $ = (id) => document.getElementById(id);
  const els = {
    statusText: $('statusText'), chatPanel: $('chatPanel'), councilPanel: $('councilPanel'), emptyState: $('emptyState'), messages: $('messages'),
    newChatBtn: $('newChatBtn'), councilBtn: $('councilBtn'), backToChatBtn: $('backToChatBtn'), settingsBtn: $('settingsBtn'),
    bestModeBtn: $('bestModeBtn'), chooseModelBtn: $('chooseModelBtn'), homeNotice: $('homeNotice'),
    composerWrap: $('composerWrap'), providerBtn: $('providerBtn'), webBtn: $('webBtn'), prompt: $('prompt'), sendBtn: $('sendBtn'),
    providerBack: $('providerBack'), providerSheet: $('providerSheet'), providerChoices: $('providerChoices'),
    settingsBack: $('settingsBack'), settingsSheet: $('settingsSheet'), accessCode: $('accessCode'), closeSettingsBtn: $('closeSettingsBtn'), saveSettingsBtn: $('saveSettingsBtn'), settingsNotice: $('settingsNotice'),
    checkModelsBtn: $('checkModelsBtn'), settingsProviderStatus: $('settingsProviderStatus'),
    councilQuestion: $('councilQuestion'), councilChecks: $('councilChecks'), runCouncilBtn: $('runCouncilBtn'), councilNotice: $('councilNotice'), councilResults: $('councilResults'),
  };

  const emptyAttachmentCtl = () => ({ get:()=>[], clear:()=>{}, has:()=>false, names:()=>[] });
  function safeAttachmentController(options) {
    try { return window.AIContext?.setupAttachmentController(options) || emptyAttachmentCtl(); }
    catch (error) {
      console.error('Attachment UI setup failed:', error);
      return emptyAttachmentCtl();
    }
  }
  const attachmentCtl = safeAttachmentController({ textareaId: 'prompt', key: 'main-chat' });
  const councilAttachmentCtl = safeAttachmentController({ textareaId: 'councilQuestion', key: 'main-council' });
  const locationContext = () => window.AIContext?.getLocationContext?.() || Promise.resolve({ timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || '', locale:navigator.language || '' });

  function loadMessages() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(value) ? value.slice(-60) : [];
    } catch { return []; }
  }
  function saveMessages() { localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-60))); }
  function accessCode() { try { return sessionStorage.getItem('ai-council-access') || ''; } catch { return ''; } }
  function saveAccessCode(value) { try { sessionStorage.setItem('ai-council-access', value); } catch {} }
  function providerStatus(id) { return providers.find((p) => p.id === id); }
  function configured(id) { return id === 'best' ? providers.some((p) => p.configured) : providerStatus(id)?.configured === true; }
  function healthStatus(id) { return providerStatus(id)?.healthStatus || (configured(id) ? 'unchecked' : 'not_connected'); }
  function healthBlocked(id) { return ['no_credits','auth_error','workspace_required','model_error','error','busy','not_connected'].includes(healthStatus(id)); }
  function usable(id) { return id === 'best' ? providers.some((p) => p.configured && !healthBlocked(p.id)) : configured(id) && !healthBlocked(id); }
  function healthLabel(id) {
    const p = providerStatus(id);
    if (!p?.configured) return 'Not connected';
    return p.healthLabel || (p.healthStatus === 'ready' ? 'Ready' : 'Credits not checked');
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }

  function openSheet(sheet, back) { back.classList.add('show'); sheet.classList.add('show'); sheet.setAttribute('aria-hidden', 'false'); }
  function closeSheet(sheet, back) { back.classList.remove('show'); sheet.classList.remove('show'); sheet.setAttribute('aria-hidden', 'true'); }
  function showSettings(after) {
    pendingAction = after || null;
    els.accessCode.value = accessCode();
    els.settingsNotice.innerHTML = '';
    renderSettingsProviderStatus();
    openSheet(els.settingsSheet, els.settingsBack);
    setTimeout(() => els.accessCode.focus(), 180);
  }

  function showHomeNotice(text) {
    if (els.homeNotice) els.homeNotice.textContent = text || '';
  }

  function renderConnectionSummary() {
    const connected = providers.filter((p) => p.configured).length;
    const ready = providers.filter((p) => p.healthStatus === 'ready').length;
    const blocked = providers.filter((p) => p.configured && healthBlocked(p.id)).length;
    const checked = providers.some((p) => p.healthStatus && p.healthStatus !== 'unchecked' && p.healthStatus !== 'not_connected');
    if (checked) {
      els.statusText.textContent = `${ready} AI model${ready === 1 ? '' : 's'} ready${blocked ? ` · ${blocked} unavailable` : ''}`;
    } else {
      els.statusText.textContent = `${connected} of 4 AIs connected · credits checked before use`;
    }
  }

  function renderSettingsProviderStatus() {
    if (!els.settingsProviderStatus) return;
    els.settingsProviderStatus.replaceChildren();
    if (!providers.length) {
      els.settingsProviderStatus.textContent = 'AI status is still loading.';
      return;
    }
    providers.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'settings-provider-row';
      const name = document.createElement('span');
      name.textContent = `${p.label} · ${p.model}`;
      const state = document.createElement('strong');
      state.textContent = healthLabel(p.id);
      row.append(name, state);
      els.settingsProviderStatus.append(row);
    });
  }

  async function checkProviderHealth(ids = [], { force = false } = {}) {
    if (!accessCode()) return { ok:false, requiresAccess:true, checked:[] };
    const response = await fetch('/api/ai-agent/provider-health', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-ai-council-code': accessCode() },
      body: JSON.stringify({ providers: ids, force }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not check AI model availability.');
    providers = Array.isArray(data.providers) ? data.providers : providers;
    renderProviderButton();
    renderProviderChoices();
    renderCouncilChecks();
    renderSettingsProviderStatus();
    renderConnectionSummary();
    return data;
  }

  async function preflightSelection() {
    const ids = selected === 'best'
      ? providers.filter((p) => p.configured).map((p) => p.id)
      : [selected];
    try {
      await checkProviderHealth(ids, { force:true });
    } catch (error) {
      showHomeNotice(error.message || String(error));
      els.statusText.textContent = error.message || 'AI availability check failed.';
      return false;
    }
    if (selected === 'best') {
      if (!providers.some((p) => p.healthStatus === 'ready')) {
        const noCredits = providers.filter((p) => p.healthStatus === 'no_credits').map((p) => p.label);
        const message = noCredits.length
          ? `No usable AI has credits right now. No credits: ${noCredits.join(', ')}.`
          : 'No AI model is available right now. Open the model list for details.';
        showHomeNotice(message);
        openSheet(els.providerSheet, els.providerBack);
        return false;
      }
      return true;
    }
    if (healthStatus(selected) !== 'ready') {
      const message = `${PROVIDER_INFO[selected]?.label || 'That AI'} cannot be used: ${healthLabel(selected)}.`;
      showHomeNotice(message);
      openSheet(els.providerSheet, els.providerBack);
      return false;
    }
    return true;
  }

  function currentProviderLabel() {
    const info = PROVIDER_INFO[selected] || PROVIDER_INFO.best;
    if (selected === 'best') return `${info.icon} ${info.label}`;
    const p = providerStatus(selected);
    const state = p?.configured ? healthLabel(selected) : 'Not connected';
    return `${info.icon} ${info.label} · ${state}`;
  }

  function renderProviderButton() {
    els.providerBtn.textContent = currentProviderLabel();
    els.providerBtn.classList.toggle('active', selected === 'best' ? providers.some((p) => p.configured) : usable(selected));
    els.webBtn.textContent = '🌐 Internet is automatic';
    els.webBtn.classList.add('active');
    if (els.bestModeBtn) els.bestModeBtn.classList.toggle('primary-choice', selected === 'best');
  }

  function renderProviderChoices() {
    els.providerChoices.replaceChildren();
    for (const id of PROVIDER_ORDER) {
      const info = PROVIDER_INFO[id];
      const p = id === 'best' ? null : providerStatus(id);
      const isOn = id === 'best' ? providers.some((item) => item.configured && !healthBlocked(item.id)) : configured(id) && !healthBlocked(id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `choice${isOn ? '' : ' off'}`;
      button.disabled = !isOn;
      const model = id === 'best' ? 'Automatically picks among models that pass the availability check' : (p?.configured ? p.model : 'Not connected');
      const state = id === 'best'
        ? (providers.some((item) => item.healthStatus === 'ready') ? 'Ready' : 'Checks models before use')
        : healthLabel(id);
      const stateClass = id === 'best' || state === 'Ready' ? 'ready' : (healthBlocked(id) ? 'blocked' : 'check');
      button.innerHTML = `<span class="choice-icon">${escapeHtml(info.icon)}</span><span><strong>${escapeHtml(info.label)}</strong><small>${escapeHtml(info.desc)}<br>${escapeHtml(model)}</small><span class="model-state ${stateClass}">${escapeHtml(state)}</span></span><span class="check">${selected === id ? '✓' : ''}</span>`;
      button.addEventListener('click', async () => {
        selected = id;
        localStorage.setItem(PREF_KEY, selected);
        showHomeNotice(id === 'best' ? 'Best AI mode selected.' : `${info.label} selected.`);
        renderProviderButton();
        renderProviderChoices();
        closeSheet(els.providerSheet, els.providerBack);
        if (id !== 'best' && accessCode() && healthStatus(id) === 'unchecked') {
          try { await checkProviderHealth([id]); }
          catch (error) { showHomeNotice(error.message || String(error)); }
        }
      });
      els.providerChoices.append(button);
    }
  }

  function renderMessages() {
    els.messages.replaceChildren();
    els.emptyState.classList.toggle('hidden', messages.length > 0);
    for (const m of messages) {
      const row = document.createElement('div');
      row.className = `message-row ${m.role === 'user' ? 'user' : 'assistant'}`;
      if (m.role !== 'user' && m.providerLabel) {
        const badge = document.createElement('span');
        badge.className = 'answer-badge';
        badge.textContent = m.pickedForMe ? `⭐ Picked ${m.providerLabel}` : m.providerLabel;
        row.append(badge);
      }
      const bubble = document.createElement('div');
      bubble.className = `message ${m.role === 'user' ? 'user' : 'assistant'}`;
      bubble.textContent = m.text;
      if (Array.isArray(m.attachments) && m.attachments.length) {
        const files = document.createElement('div'); files.className = 'message-attachments';
        m.attachments.forEach((name) => { const chip=document.createElement('span'); chip.textContent=`📎 ${name}`; files.append(chip); });
        bubble.prepend(files);
      }
      if (Array.isArray(m.citations) && m.citations.length) {
        const sources = document.createElement('div');
        sources.className = 'sources';
        m.citations.slice(0, 8).forEach((url, i) => {
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = `Source ${i + 1}: ${url}`;
          sources.append(a);
        });
        bubble.append(sources);
      }
      row.append(bubble);
      if (m.pickReason) {
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.textContent = m.pickReason;
        row.append(meta);
      }
      els.messages.append(row);
    }
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  }

  function setTyping(on) {
    document.getElementById('typingRow')?.remove();
    if (!on) return;
    const row = document.createElement('div');
    row.id = 'typingRow';
    row.className = 'message-row assistant';
    const bubble = document.createElement('div');
    bubble.className = 'message assistant typing';
    bubble.textContent = selected === 'best' ? 'Choosing the best AI and thinking…' : `${PROVIDER_INFO[selected]?.label || 'AI'} is thinking…`;
    row.append(bubble);
    els.messages.append(row);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  async function sendMessage() {
    if (sending) return;
    const text = els.prompt.value.trim();
    if (!text && !attachmentCtl.has()) return;
    if (!accessCode()) return showSettings(sendMessage);
    if (!(await preflightSelection())) return;

    const historyForApi = messages.slice(-14).map((m) => ({ role: m.role, text: m.text }));
    const attachments = attachmentCtl.get();
    const attachmentNames = attachmentCtl.names();
    const userText = text || 'Please help with the attached file(s).';
    const location = await locationContext();
    messages.push({ role: 'user', text: userText, attachments: attachmentNames, at: Date.now() });
    saveMessages();
    els.prompt.value = '';
    attachmentCtl.clear();
    renderMessages();
    sending = true;
    els.sendBtn.disabled = true;
    setTyping(true);

    try {
      const response = await fetch('/api/ai-agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ai-council-code': accessCode() },
        body: JSON.stringify({ question: userText, provider: selected, history: historyForApi, webSearch: 'auto', attachments, location }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `AI request failed (${response.status})`);
      messages.push({
        role: 'assistant', text: data.answer, provider: data.provider, providerLabel: data.providerLabel,
        model: data.model, citations: data.citations || [], pickedForMe: data.pickedForMe, pickReason: data.pickedForMe ? data.pickReason : '', at: Date.now(),
      });
      saveMessages();
    } catch (error) {
      messages.push({ role: 'assistant', text: `I couldn't complete that request. ${error.message || error}`, providerLabel: 'Error', at: Date.now() });
      saveMessages();
    } finally {
      setTyping(false);
      sending = false;
      els.sendBtn.disabled = false;
      renderMessages();
    }
  }

  function setView(name) {
    const council = name === 'council';
    els.chatPanel.classList.toggle('active', !council);
    els.councilPanel.classList.toggle('active', council);
    els.composerWrap.classList.toggle('hidden', council);
    window.history.replaceState(null, '', council ? '/ai-council/?view=council' : '/ai-council/');
    if (!council) setTimeout(() => els.prompt.focus(), 60);
  }

  function renderCouncilChecks() {
    els.councilChecks.replaceChildren();
    for (const p of providers) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = p.id;
      input.checked = p.configured && !healthBlocked(p.id);
      input.disabled = !p.configured || healthBlocked(p.id);
      label.append(input, document.createTextNode(` ${p.label} · ${p.model} · ${healthLabel(p.id)}`));
      els.councilChecks.append(label);
    }
  }

  function councilNotice(text, type = 'notice') {
    els.councilNotice.innerHTML = text ? `<div class="notice ${type}">${escapeHtml(text)}</div>` : '';
  }

  async function runCouncil() {
    const question = els.councilQuestion.value.trim();
    if (!question && !councilAttachmentCtl.has()) return councilNotice('Type a question or attach a file for the Council.', 'error');
    if (!accessCode()) return showSettings(runCouncil);
    let ids = [...els.councilChecks.querySelectorAll('input:checked')].map((input) => input.value);
    if (ids.length < 2) return councilNotice('Pick at least two available AI models.', 'error');
    try {
      await checkProviderHealth(ids, { force:true });
    } catch (error) {
      return councilNotice(error.message || String(error), 'error');
    }
    const blockedIds = ids.filter((id) => healthStatus(id) !== 'ready');
    if (blockedIds.length) {
      const detail = blockedIds.map((id) => `${PROVIDER_INFO[id]?.label || id}: ${healthLabel(id)}`).join('; ');
      return councilNotice(`Council was not started. ${detail}`, 'error');
    }
    ids = ids.filter((id) => healthStatus(id) === 'ready');
    const attachments = councilAttachmentCtl.get();
    const location = await locationContext();
    if (ids.length < 2) return councilNotice('At least two AI models must be ready.', 'error');
    els.runCouncilBtn.disabled = true;
    els.councilResults.replaceChildren();
    councilNotice('The Council is asking each AI…');
    try {
      const response = await fetch('/api/ai-council/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ai-council-code': accessCode() },
        body: JSON.stringify({ question: question || 'Review the attached file(s).', providers: ids, attachments, location }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Council request failed (${response.status})`);
      for (const answer of data.answers || []) {
        const card = document.createElement('div');
        card.className = 'result-card';
        const strong = document.createElement('strong');
        strong.textContent = `${answer.label} · ${answer.model}`;
        const pre = document.createElement('pre');
        pre.textContent = answer.ok ? answer.text : answer.error;
        card.append(strong, pre);
        els.councilResults.append(card);
      }
      if (data.verdict?.text) {
        const card = document.createElement('div');
        card.className = 'result-card';
        const strong = document.createElement('strong');
        strong.textContent = 'Council Verdict';
        const pre = document.createElement('pre');
        pre.textContent = data.verdict.text;
        card.append(strong, pre);
        els.councilResults.prepend(card);
      }
      councilAttachmentCtl.clear();
      councilNotice(`${data.successfulCount || 0} AI${data.successfulCount === 1 ? '' : 's'} answered.`, 'success');
    } catch (error) {
      councilNotice(error.message || String(error), 'error');
    } finally {
      els.runCouncilBtn.disabled = false;
    }
  }

  async function loadStatus() {
    els.statusText.textContent = 'Connecting to your AIs…';
    try {
      const response = await fetch('/api/ai-agent/status', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Provider status failed');
      providers = Array.isArray(data.providers) ? data.providers : [];
      if (!configured(selected)) selected = 'best';
      renderProviderButton();
      renderProviderChoices();
      renderCouncilChecks();
      renderSettingsProviderStatus();
      renderConnectionSummary();
    } catch (error) {
      els.statusText.textContent = 'Could not connect to AI status · tap ⚙ to check access';
      renderProviderButton();
    }
  }

  els.providerBtn.addEventListener('click', async () => {
    openSheet(els.providerSheet, els.providerBack);
    try { await loadStatus(); } catch {}
  });
  els.bestModeBtn?.addEventListener('click', async () => {
    selected = 'best';
    localStorage.setItem(PREF_KEY, selected);
    showHomeNotice('Best AI mode selected. We will only use a model that passes the availability check.');
    renderProviderButton();
    renderProviderChoices();
    try { await loadStatus(); }
    catch (error) { showHomeNotice(error.message || String(error)); }
  });
  els.chooseModelBtn?.addEventListener('click', async () => {
    openSheet(els.providerSheet, els.providerBack);
    try { await loadStatus(); }
    catch (error) { showHomeNotice(error.message || String(error)); }
  });
  els.providerBack.addEventListener('click', () => closeSheet(els.providerSheet, els.providerBack));
  els.webBtn.addEventListener('click', () => { webOn = true; renderProviderButton(); });
  els.sendBtn.addEventListener('click', sendMessage);
  els.prompt.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
  els.newChatBtn.addEventListener('click', () => {
    if (messages.length && !confirm('Start a new chat?')) return;
    messages = [];
    selected = 'best';
    localStorage.setItem(PREF_KEY, selected);
    saveMessages();
    attachmentCtl.clear();
    els.prompt.value = '';
    renderMessages();
    renderProviderButton();
    setView('chat');
    showHomeNotice('New chat started. Pick the best AI or choose a model.');
    setTimeout(() => els.prompt.focus(), 80);
  });
  els.councilBtn.addEventListener('click', () => setView('council'));
  els.backToChatBtn.addEventListener('click', () => setView('chat'));
  els.runCouncilBtn.addEventListener('click', runCouncil);
  els.settingsBtn.addEventListener('click', () => showSettings());
  els.settingsBack.addEventListener('click', () => closeSheet(els.settingsSheet, els.settingsBack));
  els.closeSettingsBtn.addEventListener('click', () => { pendingAction = null; closeSheet(els.settingsSheet, els.settingsBack); });
  els.checkModelsBtn?.addEventListener('click', async () => {
    els.settingsNotice.innerHTML = '<div class="notice">Checking all AI models now…</div>';
    try {
      await loadStatus();
      const unavailable = providers.filter((p) => p.configured && p.healthStatus !== 'ready');
      els.settingsNotice.innerHTML = unavailable.length
        ? `<div class="notice">Check finished. ${unavailable.map((p) => `${escapeHtml(p.label)}: ${escapeHtml(healthLabel(p.id))}`).join(' · ')}</div>`
        : '<div class="notice success">Check finished. All connected AI models are ready.</div>';
    } catch (error) {
      els.settingsNotice.innerHTML = `<div class="notice error">${escapeHtml(error.message || String(error))}</div>`;
    }
  });
  els.saveSettingsBtn.addEventListener('click', async () => {
    const value = els.accessCode.value.trim();
    if (!value) { els.settingsNotice.innerHTML = '<div class="notice error">Enter the access code first.</div>'; return; }
    saveAccessCode(value);
    els.settingsNotice.innerHTML = '<div class="notice">Saved. Checking AI models…</div>';
    try {
      await checkProviderHealth([], { force:true });
      els.settingsNotice.innerHTML = '<div class="notice success">Saved. AI model status is up to date.</div>';
      const after = pendingAction;
      pendingAction = null;
      setTimeout(() => { closeSheet(els.settingsSheet, els.settingsBack); if (after) after(); }, 220);
    } catch (error) {
      els.settingsNotice.innerHTML = `<div class="notice error">${escapeHtml(error.message || String(error))}</div>`;
    }
  });

  renderMessages();
  renderProviderButton();
  loadStatus();
  if (new URLSearchParams(location.search).get('view') === 'council') setView('council');
})();
