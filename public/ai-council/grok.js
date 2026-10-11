/** Grok-style chat — clean UI over the existing AI backend. */
const $ = (id) => document.getElementById(id);
const HIST_KEY = 'grok-history-v1';

let messages = [];
let sending = false;
let webOn = true;
let thinkOn = false;

const BOTS = [
  { id: 'assistant', name: 'AI Assistant', desc: 'General help', color: '#000000', icon: '✦' },
  { id: 'aiden', name: 'Aiden', desc: 'Your AI companion', color: '#1687ff', icon: 'A' },
  { id: 'alicia', name: 'Alicia', desc: 'Creative & writing', color: '#8b46ff', icon: 'A' },
  { id: 'anaiya', name: 'Anaiya', desc: 'Research & analysis', color: '#00c877', icon: 'A' },
  { id: 'christian', name: 'Christian', desc: 'Coding & technical', color: '#ff6d00', icon: 'C' },
];
let bot = localStorage.getItem('grok-bot') || 'assistant';

/* History */
function loadHist() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}
function saveHist(h) { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 30))); }
function renderHist() {
  const h = loadHist();
  $('histList').innerHTML = h.length
    ? h.map((c, i) => `<button class="grok-hist-item" data-i="${i}">${escapeHtml(c.title)}</button>`).join('')
    : '<div style="padding:10px 12px;font-size:12px;color:var(--faint)">No conversations yet</div>';
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* Messages */
function addMsg(role, text) {
  messages.push({ role, text });
  const wrap = $('messages');
  $('emptyState')?.remove();
  const div = document.createElement('div');
  if (role === 'user') {
    div.className = 'msg-user';
    div.innerHTML = `<div class="bubble"></div>`;
    div.querySelector('.bubble').textContent = text;
  } else {
    div.className = 'msg-ai';
    div.innerHTML = `<div class="who"><div class="dot">✦</div><span>${botName()}</span></div><div class="body"></div>`;
    div.querySelector('.body').textContent = text;
  }
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function botInfo() {
  return BOTS.find((b) => b.id === bot) || BOTS[0];
}
function botName() { return botInfo().name; }

async function send() {
  const text = $('prompt').value.trim();
  if (!text || sending) return;
  sending = true;
  $('sendBtn').disabled = true;
  $('prompt').value = '';
  autoGrow();

  addMsg('user', text);
  const aiDiv = addMsg('assistant', '');
  const body = aiDiv.querySelector('.body');
  body.innerHTML = '<span class="msg-typing">Thinking…</span>';

  try {
    const res = await fetch('/api/ai-agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        bot: bot,
        web: webOn,
        history: messages.slice(0, -2).map((m) => ({ role: m.role, content: m.text })),
      }),
    });
    const data = await res.json();
    const reply = data.reply || data.text || data.message || 'No response.';
    body.textContent = reply;
    messages[messages.length - 1].text = reply;

    // Save to history
    const h = loadHist();
    const title = text.slice(0, 42);
    const existing = h.findIndex((c) => c.title === title);
    if (existing >= 0) h.splice(existing, 1);
    h.unshift({ title, messages: messages.slice(-20), at: Date.now() });
    saveHist(h);
    renderHist();
  } catch (e) {
    body.textContent = `Error: ${e.message}`;
  } finally {
    sending = false;
    $('sendBtn').disabled = !$('prompt').value.trim();
    $('messages').scrollTop = $('messages').scrollHeight;
  }
}

function autoGrow() {
  const t = $('prompt');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 180) + 'px';
  $('sendBtn').disabled = !t.value.trim() || sending;
}

function newChat() {
  messages = [];
  $('messages').innerHTML = `<div class="grok-empty" id="emptyState">
    <div class="mark">✦</div><h1>What do you want to know?</h1>
    <p>Ask anything.</p>
    <div class="grok-suggest">
      <button data-q="Explain something complex simply">Explain something complex<small>Pick a topic, I'll break it down</small></button>
      <button data-q="Help me write something">Help me write<small>Emails, docs, messages</small></button>
      <button data-q="What happened in the news today?">Today's news<small>Catch me up quickly</small></button>
      <button data-q="Give me an interesting fact">Surprise me<small>Something I didn't know</small></button>
    </div></div>`;
  bindSuggest();
  closeSidebar();
}

/* Bot list */
function renderBots() {
  $('botList').innerHTML = BOTS.map((b) => `
    <button class="bot-item${b.id === bot ? ' active' : ''}" data-b="${b.id}">
      <div class="bot-avatar" style="background:${b.color}">${b.icon}</div>
      <div class="bot-info">
        <div class="bot-name">${b.name}</div>
        <div class="bot-desc">${b.desc}</div>
      </div>
    </button>`).join('');
  const info = botInfo();
  $('curBotAvatar').style.background = info.color;
  $('curBotAvatar').textContent = info.icon;
  $('curBotName').textContent = info.name;
}
function selectBot(id) {
  bot = id;
  localStorage.setItem('grok-bot', bot);
  renderBots();
  newChat();
}

/* Sidebar */
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('scrim').classList.remove('show');
}

function bindSuggest() {
  document.querySelectorAll('.grok-suggest button').forEach((b) => {
    b.onclick = () => { $('prompt').value = b.dataset.q; autoGrow(); $('prompt').focus(); };
  });
}

/* Events */
$('sendBtn').onclick = send;
$('prompt').addEventListener('input', autoGrow);
$('prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
$('newChatBtn').onclick = newChat;
$('menuBtn').onclick = () => { $('sidebar').classList.add('open'); $('scrim').classList.add('show'); };
$('scrim').onclick = closeSidebar;


$('webBtn').onclick = () => { webOn = !webOn; $('webBtn').classList.toggle('on', webOn); };
$('thinkBtn').onclick = () => { thinkOn = !thinkOn; $('thinkBtn').classList.toggle('on', thinkOn); };
$('botList').onclick = (e) => {
  const b = e.target.closest('.bot-item');
  if (!b) return;
  selectBot(b.dataset.b);
};
$('histList').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const h = loadHist()[+b.dataset.i];
  if (!h) return;
  messages = h.messages || [];
  $('messages').innerHTML = '';
  for (const m of messages) addMsg(m.role, m.text);
  document.querySelectorAll('.grok-hist-item').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  closeSidebar();
};

/* Init */
renderBots();
renderHist();
bindSuggest();
autoGrow();
