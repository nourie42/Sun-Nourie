/** My AIs: Grok, Muse, Claude and ChatGPT in one Grok-style chat, plus a group chat where they talk to each other. */
const $ = (id) => document.getElementById(id);
const CONVO_KEY = 'my-ais-convos-v1';
const VIEW_KEY = 'my-ais-view-v1';
const CODE_KEY = 'ai-council-access';

const LOOK = {
  xai: { color: '#000000', icon: 'G' },
  muse: { color: '#0866ff', icon: 'M' },
  anthropic: { color: '#d97757', icon: 'C' },
  openai: { color: '#10a37f', icon: '◎' },
};

let bots = [];
let roomMaxTurns = 12;
let balanceStorage = 'server';
let convos = loadJson(CONVO_KEY, []);
let view = loadJson(VIEW_KEY, { mode: 'bot', bot: 'xai' });
let convo = null;
let webOn = false;
let deepOn = false;
let rounds = 1;
let members = new Set();
let sending = false;
let stopRequested = false;
let controller = null;

function loadJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; }
}
function saveJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* Small, safe markdown: escape first, then format. */
function renderMarkdown(text) {
  const blocks = [];
  let html = escapeHtml(text).replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  html = html
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^#{1,4} (.+)$/gm, '<strong class="md-h">$1</strong>')
    .replace(/^\s*[-*] (.+)$/gm, '<span class="md-li">• $1</span>');
  return html.replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)]);
}

/* Money */
function fmtUsd(n) { return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`; }
function fmtCost(usd, exact) {
  if (!Number.isFinite(usd)) return '';
  const text = usd < 0.01 ? `${(usd * 100).toFixed(usd < 0.001 ? 2 : 1)}¢` : fmtUsd(usd);
  return `${exact ? '' : '≈ '}${text}`;
}
function balanceText(b) {
  if (!b?.configured) return 'Not connected';
  const bal = b.balance;
  if (!bal || bal.source === 'unset' || !Number.isFinite(bal.remainingUsd)) return 'Set balance';
  return `${bal.source === 'live' ? '' : '≈ '}${fmtUsd(bal.remainingUsd)} left`;
}
function balanceLow(b) { return Number.isFinite(b?.balance?.remainingUsd) && b.balance.remainingUsd < 1; }
function applyBalance(botId, balance) {
  const b = botById(botId);
  if (b && balance) b.balance = balance;
  renderSidebar();
  renderHeader();
}

function botById(id) { return bots.find((b) => b.id === id); }
function botName(id) { return botById(id)?.name || 'AI'; }
function readyBots() { return bots.filter((b) => b.configured); }

/* Conversations */
function newConvo() {
  convo = view.mode === 'group'
    ? { id: String(Date.now()), mode: 'group', title: '', messages: [], at: Date.now() }
    : { id: String(Date.now()), mode: 'bot', bot: view.bot, title: '', messages: [], at: Date.now() };
}
function persistConvo() {
  if (!convo.messages.length) return;
  if (!convo.title) convo.title = (convo.messages.find((m) => m.role === 'user')?.text || 'Chat').slice(0, 48);
  convo.at = Date.now();
  convos = [convo, ...convos.filter((c) => c.id !== convo.id)].slice(0, 40);
  saveJson(CONVO_KEY, convos);
  renderHistory();
}

/* Sidebar */
function renderSidebar() {
  $('botList').innerHTML = bots.map((b) => `
    <button class="bot-item${view.mode === 'bot' && view.bot === b.id ? ' active' : ''}" data-b="${b.id}" type="button">
      <div class="bot-avatar" style="background:${LOOK[b.id].color}">${LOOK[b.id].icon}</div>
      <div class="bot-info">
        <div class="bot-name">${escapeHtml(b.name)}</div>
        <div class="bot-desc"><span class="status-dot ${b.configured ? 'on' : 'off'}"></span><span class="money${balanceLow(b) ? ' low' : ''}">${escapeHtml(balanceText(b))}</span></div>
      </div>
    </button>`).join('');
  $('groupItem').classList.toggle('active', view.mode === 'group');
}

function renderHistory() {
  $('histList').innerHTML = convos.length
    ? convos.map((c) => `<button class="grok-hist-item${convo && c.id === convo.id ? ' active' : ''}" data-id="${c.id}" type="button">${c.mode === 'group' ? '👥 ' : `${escapeHtml(botName(c.bot))} · `}${escapeHtml(c.title)}</button>`).join('')
    : '<div class="hist-empty">No conversations yet</div>';
}

/* Header + mode */
function renderHeader() {
  const avatar = $('curBotAvatar');
  if (view.mode === 'group') {
    avatar.style.background = '#6e6e80';
    avatar.textContent = '👥';
    $('curBotName').textContent = 'Group chat';
    $('curBotModel').textContent = [...members].map(botName).join(', ') || 'Pick at least two AIs below';
  } else {
    const b = botById(view.bot);
    avatar.style.background = LOOK[view.bot]?.color || '#000';
    avatar.textContent = LOOK[view.bot]?.icon || '✦';
    $('curBotName').textContent = b?.name || 'AI';
    $('curBotModel').innerHTML = !b ? '' : !b.configured ? 'Not connected'
      : `${escapeHtml(deepOn ? b.deepModel : b.fastModel)} · <button class="balance-link money${balanceLow(b) ? ' low' : ''}" type="button" data-open-balances>${escapeHtml(balanceText(b))}</button>`;
  }
  $('groupBar').classList.toggle('hidden', view.mode !== 'group');
  $('webBtn').classList.toggle('hidden', view.mode === 'group');
  $('modeNote').textContent = deepOn ? 'Deep thinking: smarter, slower, costs more' : 'Fast mode';
  $('prompt').placeholder = view.mode === 'group' ? 'Give your AIs something to talk about' : `Message ${botById(view.bot)?.name || 'AI'}`;
  renderGroupBar();
  updateSend();
}

function renderGroupBar() {
  if (view.mode !== 'group') return;
  $('memberChips').innerHTML = bots.map((b) => `
    <button class="member-chip${members.has(b.id) ? ' on' : ''}" data-m="${b.id}" type="button" ${b.configured ? '' : 'disabled title="Not connected"'}
      style="--chip:${LOOK[b.id].color}">${escapeHtml(b.name)}</button>`).join('');
  $('roundChips').innerHTML = [1, 2, 3].map((n) => `<button class="round-chip${rounds === n ? ' on' : ''}" data-r="${n}" type="button">${n}</button>`).join('');
  const replies = turnsPlanned();
  $('groupCost').textContent = members.size < 2 ? 'Pick at least 2 AIs' : `${replies} AI replies per message`;
}

function turnsPlanned() { return Math.min(members.size * rounds, roomMaxTurns); }

/* Messages */
function renderMessages() {
  const wrap = $('messages');
  wrap.innerHTML = '';
  if (!convo.messages.length) {
    wrap.innerHTML = emptyState();
    return;
  }
  for (const m of convo.messages) wrap.appendChild(messageEl(m));
  wrap.scrollTop = wrap.scrollHeight;
}

function emptyState() {
  if (view.mode === 'group') {
    return `<div class="grok-empty"><div class="mark">👥</div><h1>Group chat</h1>
      <p>Pick who's in the chat below, then send a question or topic. Each AI reads what the others said and replies in turn. Send another message any time to jump in.</p></div>`;
  }
  const b = botById(view.bot);
  if (b && !b.configured) {
    return `<div class="grok-empty"><div class="mark">🔌</div><h1>${escapeHtml(b.name)} isn't connected yet</h1>
      <p>Add its API key on the server to turn it on. The other AIs still work.</p></div>`;
  }
  return `<div class="grok-empty"><div class="mark">✦</div><h1>Chat with ${escapeHtml(b?.name || 'your AI')}</h1>
    <p>Fast mode answers quickly and cheaply. Turn on 🧠 Deep for hard questions, or 🌐 Web for anything current.</p></div>`;
}

function messageEl(m) {
  const div = document.createElement('div');
  if (m.role === 'user') {
    div.className = 'msg-user';
    div.innerHTML = '<div class="bubble"></div>';
    div.querySelector('.bubble').textContent = m.text;
  } else if (m.role === 'error') {
    div.className = 'msg-ai';
    div.innerHTML = `<div class="msg-error">${escapeHtml(m.bot ? `${botName(m.bot)}: ` : '')}${escapeHtml(m.text)}</div>`;
  } else {
    const look = LOOK[m.bot] || { color: '#000', icon: '✦' };
    div.className = 'msg-ai';
    div.innerHTML = `<div class="who"><div class="dot" style="background:${look.color}">${look.icon}</div><span>${escapeHtml(botName(m.bot))}${m.deep ? ' · 🧠 deep' : ''}</span></div><div class="body md"></div>`;
    div.querySelector('.body').innerHTML = renderMarkdown(m.text);
    if (Number.isFinite(m.costUsd)) div.insertAdjacentHTML('beforeend', `<div class="msg-cost">${escapeHtml(fmtCost(m.costUsd, m.costExact))}</div>`);
  }
  return div;
}

function showTyping(botId) {
  const look = LOOK[botId] || { color: '#000', icon: '✦' };
  const div = document.createElement('div');
  div.className = 'msg-ai';
  div.id = 'typing';
  div.innerHTML = `<div class="who"><div class="dot" style="background:${look.color}">${look.icon}</div><span>${escapeHtml(botName(botId))}</span></div><div class="body msg-typing">${deepOn ? 'Thinking deeply…' : 'Typing…'}</div>`;
  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
}
function hideTyping() { $('typing')?.remove(); }

/* Server calls */
async function post(path, body) {
  const code = $('accessCode').value.trim();
  const headers = { 'Content-Type': 'application/json' };
  if (code) headers['x-ai-council-code'] = code;
  controller = new AbortController();
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 503) {
    $('codeRow').classList.remove('hidden');
    throw new Error(data.error || 'Enter your owner access code below.');
  }
  if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
  try { if (code) sessionStorage.setItem(CODE_KEY, code); } catch {}
  return data;
}

async function sendToBot(text) {
  const botId = view.bot;
  convo.messages.push({ role: 'user', text });
  renderMessages();
  showTyping(botId);
  const history = convo.messages.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.bot === botId))
    .map((m) => ({ role: m.role, content: m.text }));
  try {
    const data = await post('/api/ai-council/hub/chat', { bot: botId, messages: history, deep: deepOn, web: webOn });
    convo.messages.push({ role: 'assistant', bot: botId, text: data.text, deep: deepOn, costUsd: data.costUsd, costExact: data.costExact });
    applyBalance(botId, data.balance);
  } catch (e) {
    if (e.name !== 'AbortError') convo.messages.push({ role: 'error', bot: botId, text: e.message || 'No answer.' });
  }
}

async function sendToGroup(text) {
  const list = [...members];
  convo.messages.push({ role: 'user', text });
  renderMessages();
  let turns = 0;
  for (let r = 0; r < rounds && !stopRequested; r += 1) {
    for (const botId of list) {
      if (stopRequested || turns >= roomMaxTurns) break;
      turns += 1;
      showTyping(botId);
      const transcript = convo.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ speaker: m.role === 'user' ? 'Owner' : botName(m.bot), text: m.text }));
      try {
        const data = await post('/api/ai-council/hub/room-turn', { bot: botId, members: list, transcript, deep: deepOn });
        convo.messages.push({ role: 'assistant', bot: botId, text: data.text, deep: deepOn, costUsd: data.costUsd, costExact: data.costExact });
        applyBalance(botId, data.balance);
      } catch (e) {
        if (e.name === 'AbortError') break;
        convo.messages.push({ role: 'error', bot: botId, text: e.message || 'No answer.' });
      }
      hideTyping();
      renderMessages();
      persistConvo();
    }
  }
}

async function send() {
  const text = $('prompt').value.trim();
  if (!text || sending || !canSend()) return;
  sending = true;
  stopRequested = false;
  $('prompt').value = '';
  autoGrow();
  updateSend();
  try {
    if (view.mode === 'group') await sendToGroup(text);
    else await sendToBot(text);
  } finally {
    hideTyping();
    sending = false;
    controller = null;
    renderMessages();
    persistConvo();
    updateSend();
  }
}

function canSend() {
  if (view.mode === 'group') return members.size >= 2;
  return Boolean(botById(view.bot)?.configured);
}

function updateSend() {
  $('sendBtn').disabled = sending || !$('prompt').value.trim() || !canSend();
  $('sendBtn').classList.toggle('hidden', sending);
  $('stopBtn').classList.toggle('hidden', !sending);
}

function autoGrow() {
  const t = $('prompt');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
  updateSend();
}

/* Navigation */
function switchView(next) {
  if (sending) return;
  view = next;
  saveJson(VIEW_KEY, view);
  newConvo();
  renderSidebar();
  renderHeader();
  renderMessages();
  renderHistory();
  closeSidebar();
}

function openConvo(id) {
  const found = convos.find((c) => c.id === id);
  if (!found || sending) return;
  view = found.mode === 'group' ? { mode: 'group' } : { mode: 'bot', bot: found.bot };
  saveJson(VIEW_KEY, view);
  convo = found;
  renderSidebar();
  renderHeader();
  renderMessages();
  renderHistory();
  closeSidebar();
}

/* Balances sheet */
function renderBalances() {
  $('balanceRows').innerHTML = bots.map((b) => {
    const bal = b.balance || {};
    const look = LOOK[b.id];
    const link = bal.billingUrl ? `<a href="${escapeHtml(bal.billingUrl)}" target="_blank" rel="noopener">Open ${escapeHtml(b.maker)} billing ↗</a>` : `Check your ${escapeHtml(b.maker)} developer dashboard`;
    let amount = 'Not set';
    let sub = `${link}, then type the balance it shows.`;
    if (bal.source === 'live') {
      amount = `${fmtUsd(bal.remainingUsd)} left`;
      sub = 'Live from your xAI account.';
    } else if (bal.source === 'estimate') {
      amount = `≈ ${fmtUsd(bal.remainingUsd)} left`;
      sub = `You set ${fmtUsd(bal.startUsd)} on ${new Date(bal.setAt).toLocaleDateString()}; about ${fmtUsd(bal.spentUsd)} used here since. ${link} to correct it.`;
    }
    const form = bal.source === 'live' ? '' : `
      <form class="balance-form" data-bot="${b.id}">
        <input name="usd" inputmode="decimal" placeholder="e.g. 18.50" aria-label="${escapeHtml(b.name)} balance in dollars">
        <button type="submit">Save</button>
      </form><div class="balance-msg" data-msg="${b.id}"></div>`;
    return `<div class="balance-row">
      <div class="bot-avatar" style="background:${look.color}">${look.icon}</div>
      <div><strong>${escapeHtml(b.name)}</strong>${b.configured ? '' : ' · <span class="balance-sub">not connected</span>'}
        <div class="balance-amount money${balanceLow(b) ? ' low' : ''}">${escapeHtml(amount)}</div>
        <div class="balance-sub">${sub}</div>${form}</div>
    </div>`;
  }).join('');
  $('balanceStorage').textContent = balanceStorage === 'server'
    ? 'Saved on your server, so your phone and computer show the same numbers.'
    : 'Saved on your server, but it resets when the server restarts. Set DATA_DIR on the server to keep it.';
}
function openBalances() {
  renderBalances();
  closeSidebar();
  $('balanceScrim').classList.remove('hidden');
  $('balanceSheet').classList.remove('hidden');
}
function closeBalances() {
  $('balanceScrim').classList.add('hidden');
  $('balanceSheet').classList.add('hidden');
}
async function saveBalance(form) {
  const botId = form.dataset.bot;
  const msg = document.querySelector(`[data-msg="${botId}"]`);
  msg.textContent = 'Saving…';
  try {
    const data = await post('/api/ai-council/hub/balance', { bot: botId, usd: form.elements.usd.value });
    applyBalance(botId, data.balance);
    renderBalances();
  } catch (e) {
    msg.textContent = e.message || 'Could not save.';
  }
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('scrim').classList.remove('show');
}

/* Events */
$('sendBtn').onclick = send;
$('stopBtn').onclick = () => { stopRequested = true; controller?.abort(); };
$('prompt').addEventListener('input', autoGrow);
$('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('newChatBtn').onclick = () => switchView(view);
$('menuBtn').onclick = () => { $('sidebar').classList.add('open'); $('scrim').classList.add('show'); };
$('scrim').onclick = closeSidebar;
$('webBtn').onclick = () => { webOn = !webOn; $('webBtn').classList.toggle('on', webOn); $('webBtn').setAttribute('aria-pressed', String(webOn)); };
$('thinkBtn').onclick = () => { deepOn = !deepOn; $('thinkBtn').classList.toggle('on', deepOn); $('thinkBtn').setAttribute('aria-pressed', String(deepOn)); renderHeader(); };
$('botList').onclick = (e) => { const b = e.target.closest('.bot-item'); if (b) switchView({ mode: 'bot', bot: b.dataset.b }); };
$('groupItem').onclick = () => switchView({ mode: 'group' });
$('histList').onclick = (e) => { const b = e.target.closest('.grok-hist-item'); if (b) openConvo(b.dataset.id); };
$('memberChips').onclick = (e) => {
  const chip = e.target.closest('.member-chip');
  if (!chip || chip.disabled) return;
  members.has(chip.dataset.m) ? members.delete(chip.dataset.m) : members.add(chip.dataset.m);
  renderHeader();
};
$('roundChips').onclick = (e) => { const chip = e.target.closest('.round-chip'); if (chip) { rounds = Number(chip.dataset.r); renderGroupBar(); } };

$('balancesBtn').onclick = openBalances;
$('balanceClose').onclick = closeBalances;
$('balanceScrim').onclick = closeBalances;
$('balanceRows').addEventListener('submit', (e) => { e.preventDefault(); saveBalance(e.target); });
document.addEventListener('click', (e) => { if (e.target.closest('[data-open-balances]')) openBalances(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBalances(); });

/* Init */
try { $('accessCode').value = sessionStorage.getItem(CODE_KEY) || ''; } catch {}
fetch('/api/ai-council/hub/status', { cache: 'no-store' })
  .then((r) => r.json())
  .then((data) => {
    bots = Array.isArray(data.bots) ? data.bots : [];
    roomMaxTurns = Number(data.roomMaxTurns) || roomMaxTurns;
    balanceStorage = data.balanceStorage || balanceStorage;
    members = new Set(readyBots().map((b) => b.id));
    if (view.mode !== 'group' && !botById(view.bot)) view = { mode: 'bot', bot: (readyBots()[0] || bots[0])?.id };
    newConvo();
    renderSidebar();
    renderHeader();
    renderMessages();
    renderHistory();
  })
  .catch(() => {
    $('messages').innerHTML = '<div class="grok-empty"><div class="mark">⚠️</div><h1>Could not reach the server</h1><p>Refresh the page to try again.</p></div>';
  });
