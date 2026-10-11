/** Grok-style chat — clean UI over the existing AI backend. */
const $ = (id) => document.getElementById(id);
const HIST_KEY = 'grok-history-v1';

let messages = [];
let sending = false;
let webOn = true;
let thinkOn = false;

const MODELS = [
  { id: 'best', name: 'Auto', desc: 'Best AI for your question' },
  { id: 'xai', name: 'Grok', desc: 'xAI conversational' },
  { id: 'openai', name: 'OpenAI', desc: 'Reasoning & coding' },
  { id: 'anthropic', name: 'Claude', desc: 'Writing & documents' },
  { id: 'gemini', name: 'Gemini', desc: 'Google-powered' },
];
let model = localStorage.getItem('grok-model') || 'best';

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
    div.textContent = text;
  } else {
    div.className = 'msg-ai';
    div.innerHTML = `<div class="who"><div class="dot">✦</div><span>${modelName()}</span></div><div class="body"></div>`;
    div.querySelector('.body').textContent = text;
  }
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function modelName() {
  return MODELS.find((m) => m.id === model)?.name || 'AI';
}

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
        provider: model === 'best' ? undefined : model,
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
    <p>Ask anything. I'll pick the best AI for your question.</p>
    <div class="grok-suggest">
      <button data-q="Explain something complex simply">Explain something complex<small>Pick a topic, I'll break it down</small></button>
      <button data-q="Help me write something">Help me write<small>Emails, docs, messages</small></button>
      <button data-q="What happened in the news today?">Today's news<small>Catch me up quickly</small></button>
      <button data-q="Give me an interesting fact">Surprise me<small>Something I didn't know</small></button>
    </div></div>`;
  bindSuggest();
  closeSidebar();
}

/* Model picker */
function renderModels() {
  $('modelList').innerHTML = MODELS.map((m) => `
    <button class="choice" data-m="${m.id}" style="width:100%;border:1px solid #2c2c31;background:${m.id === model ? '#1e1e22' : 'transparent'};color:#f5f5f6;border-radius:14px;padding:13px;text-align:left;display:flex;gap:12px;align-items:center;margin-bottom:6px;cursor:pointer">
      <div style="width:36px;height:36px;border-radius:12px;background:#26262b;display:grid;place-items:center;font-weight:900">${m.name[0]}</div>
      <div><strong style="font-size:14px">${m.name}</strong><small style="display:block;color:#9a9aa3;font-size:11px;margin-top:2px">${m.desc}</small></div>
      ${m.id === model ? '<span style="margin-left:auto;color:#1d9bf0">✓</span>' : ''}
    </button>`).join('');
  $('modelList').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    model = b.dataset.m;
    localStorage.setItem('grok-model', model);
    $('modelName').textContent = modelName();
    renderModels();
    closeModels();
  };
}
function openModels() {
  renderModels();
  $('modelSheet').style.opacity = '1';
  $('modelSheet').style.pointerEvents = 'auto';
  $('modelSheet').style.transform = 'translate(-50%,-50%) scale(1)';
  $('modelScrim').classList.add('show');
}
function closeModels() {
  $('modelSheet').style.opacity = '0';
  $('modelSheet').style.pointerEvents = 'none';
  $('modelSheet').style.transform = 'translate(-50%,-50%) scale(.96)';
  $('modelScrim').classList.remove('show');
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
$('modelBtn').onclick = openModels;
$('modelScrim').onclick = closeModels;
$('webBtn').onclick = () => { webOn = !webOn; $('webBtn').classList.toggle('on', webOn); };
$('thinkBtn').onclick = () => { thinkOn = !thinkOn; $('thinkBtn').classList.toggle('on', thinkOn); };
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
$('modelName').textContent = modelName();
renderHist();
bindSuggest();
autoGrow();
