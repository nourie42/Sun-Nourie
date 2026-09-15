from pathlib import Path
import re

# ---------- Backend: shared attachments, location, and automatic web context ----------
p = Path('src/aiAgent.js')
s = p.read_text()

s = s.replace('const json = express.json({ limit: "120kb" });', 'const json = express.json({ limit: "20mb" });')

helper_anchor = '''function normalizeHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-14).map((m) => ({
    role: m?.role === "assistant" || m?.role === "ai" || m?.role === "bot" ? "Assistant" : "User",
    text: cleanText(m?.text, 6000),
  })).filter((m) => m.text);
}
'''
helper_block = helper_anchor + r'''
function normalizeAttachments(raw) {
  const out = [];
  let totalBytes = 0;
  for (const item of Array.isArray(raw) ? raw.slice(0, 6) : []) {
    const name = cleanText(item?.name, 160) || "attachment";
    const type = cleanText(item?.type, 120) || "application/octet-stream";
    const data = cleanText(item?.data, 9_000_000).replace(/\s+/g, "");
    const size = Math.max(0, Number(item?.size || 0));
    if (!data || size > 6 * 1024 * 1024) continue;
    totalBytes += size || Math.floor(data.length * 0.75);
    if (totalBytes > 16 * 1024 * 1024) break;
    out.push({ name, type, data, size });
  }
  return out;
}

function textLikeAttachment(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return type.startsWith("text/") || /\.(txt|md|csv|json|xml|yaml|yml|log)$/i.test(name);
}

function decodeTextAttachment(file) {
  try {
    return Buffer.from(file.data, "base64").toString("utf8").replace(/\u0000/g, "").slice(0, 18000);
  } catch { return ""; }
}

async function analyzeBinaryAttachments(files) {
  if (!files.length) return "";
  if (!providerKey("openai")) throw new Error("Photo and document attachments need OPENAI_API_KEY for file understanding.");
  const content = [{ type: "input_text", text: "Read the attached files. Extract the information, text, tables, objects, and visual details that may matter to the user's request. Be accurate and concise. Do not answer the user's request yet; create attachment context for another AI." }];
  for (const file of files) {
    if (String(file.type).toLowerCase().startsWith("image/")) {
      content.push({ type: "input_image", image_url: `data:${file.type};base64,${file.data}`, detail: "auto" });
    } else {
      content.push({ type: "input_file", filename: file.name, file_data: file.data });
    }
  }
  const data = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${providerKey("openai")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: providerModel("openai"),
      input: [{ role: "user", content }],
      max_output_tokens: 2200,
    }),
  }, 120000);
  return extractResponsesText(data);
}

function normalizeLocation(raw) {
  const location = raw && typeof raw === "object" ? raw : {};
  const lat = Number(location.lat);
  const lon = Number(location.lon);
  return {
    country: cleanText(location.country, 100),
    area: cleanText(location.area || location.region || location.state, 160),
    city: cleanText(location.city, 120),
    timezone: cleanText(location.timezone, 120),
    locale: cleanText(location.locale, 80),
    lat: Number.isFinite(lat) ? Math.round(lat * 10000) / 10000 : null,
    lon: Number.isFinite(lon) ? Math.round(lon * 10000) / 10000 : null,
    accuracy: Math.max(0, Math.round(Number(location.accuracy || 0))) || null,
    source: cleanText(location.source, 80),
  };
}

function locationDescription(raw) {
  const location = normalizeLocation(raw);
  const place = [location.city, location.area, location.country].filter(Boolean).join(", ");
  const parts = [
    place ? `Approximate user area: ${place}` : "",
    location.timezone ? `Time zone: ${location.timezone}` : "",
    location.locale ? `Browser locale: ${location.locale}` : "",
    location.lat != null && location.lon != null ? `Approximate coordinates: ${location.lat}, ${location.lon}${location.accuracy ? ` (accuracy about ${location.accuracy} m)` : ""}` : "",
  ].filter(Boolean);
  return { location, text: parts.join(". ") };
}

async function reverseGeocode(raw) {
  const base = normalizeLocation(raw);
  if (base.lat == null || base.lon == null) return base;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(base.lat)}&lon=${encodeURIComponent(base.lon)}&zoom=10&addressdetails=1`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Sun-Nourie-AI/1.0", "Accept-Language": base.locale || "en-US" },
    });
    if (!response.ok) return base;
    const data = await response.json();
    const a = data?.address || {};
    return {
      ...base,
      city: cleanText(a.city || a.town || a.village || a.municipality || a.county || base.city, 120),
      area: cleanText(a.state || a.region || a.county || base.area, 160),
      country: cleanText(a.country || a.country_code?.toUpperCase() || base.country, 100),
    };
  } catch { return base; }
  finally { clearTimeout(timer); }
}

export async function prepareAiContext({ question = "", attachments = [], location = {}, webSearch: webMode = "auto" } = {}) {
  const files = normalizeAttachments(attachments);
  const textFiles = files.filter(textLikeAttachment);
  const binaryFiles = files.filter((file) => !textLikeAttachment(file));
  const textSections = textFiles.map((file) => {
    const text = decodeTextAttachment(file);
    return text ? `Attachment: ${file.name}\n${text}` : `Attachment: ${file.name} (could not decode as text)`;
  });
  let attachmentAnalysis = "";
  let attachmentError = "";
  if (binaryFiles.length) {
    try { attachmentAnalysis = await analyzeBinaryAttachments(binaryFiles); }
    catch (error) { attachmentError = cleanText(error?.message || error, 320); }
  }
  const attachmentText = [
    ...textSections,
    attachmentAnalysis ? `Attachment analysis:\n${attachmentAnalysis}` : "",
    attachmentError ? `Attachment processing note: ${attachmentError}` : "",
  ].filter(Boolean).join("\n\n");

  const loc = locationDescription(location);
  const mode = webMode === false || webMode === "off" ? "off" : webMode === true || webMode === "on" ? "on" : "auto";
  const searchInput = [question, attachmentText, loc.text].filter(Boolean).join("\n\n");
  const useWeb = mode === "on" || (mode === "auto" && shouldSearchWeb(searchInput));
  let research = { text: "", citations: [] };
  let webSearchError = "";
  if (useWeb) {
    try { research = await webSearch(searchInput); }
    catch (error) { webSearchError = cleanText(error?.message || error, 320); }
  }
  return {
    location: loc.location,
    locationText: loc.text,
    attachmentText,
    attachmentError,
    attachments: files.map(({ name, type, size }) => ({ name, type, size })),
    research,
    webSearchUsed: Boolean(research.text),
    webSearchError,
  };
}
'''
if 'export async function prepareAiContext' not in s:
    s = s.replace(helper_anchor, helper_block, 1)

# Location endpoint before status.
status_anchor = '''  app.get("/api/ai-agent/status", (_req, res) => {'''
location_route = r'''  app.post("/api/ai-agent/location", express.json({ limit: "8kb" }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const location = await reverseGeocode(req.body || {});
    const headerCountry = cleanText(req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || req.headers["x-country-code"], 20);
    if (!location.country && headerCountry) location.country = headerCountry;
    res.json({ ok: true, location });
  });

'''
if '/api/ai-agent/location' not in s:
    s = s.replace(status_anchor, location_route + status_anchor, 1)

s = s.replace('''        webSearch: Boolean(providerKey("openai")),
        gmail: false,''', '''        webSearch: Boolean(providerKey("openai")),
        attachments: Boolean(providerKey("openai")),
        location: true,
        gmail: false,''')

# Replace chat request preparation through prompt construction.
chat_old = r'''    const question = cleanText(req.body?.question, 6000);
    if (question.length < 1) return res.status(400).json({ ok: false, error: "Type a message first." });

    const requested = cleanText(req.body?.provider, 30).toLowerCase() || "best";
    const best = chooseBestProvider(question);
    const providerId = requested === "best" ? best.id : requested;
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return res.status(400).json({ ok: false, error: "Choose an AI first." });
    if (!providerKey(providerId)) return res.status(400).json({ ok: false, error: `${provider.label} is not connected yet.` });

    const webMode = req.body?.webSearch === true || req.body?.webSearch === "on" ? "on" : req.body?.webSearch === false || req.body?.webSearch === "off" ? "off" : "auto";
    const useWeb = webMode === "on" || (webMode === "auto" && shouldSearchWeb(question));
    let research = { text: "", citations: [] };
    let webSearchError = "";
    if (useWeb) {
      try { research = await webSearch(question); }
      catch (error) { webSearchError = cleanText(error?.message || error, 300); }
    }

    const history = normalizeHistory(req.body?.history);
    const transcript = history.map((m) => `${m.role}: ${m.text}`).join("\n\n");
    const system = personaSystem(req.body?.persona, provider.label);
    const prompt = [
      transcript ? `Conversation so far:\n${transcript}` : "",
      `User's new message:\n${question}`,
      research.text ? `Current web research gathered for this request:\n${research.text}` : "",
      webSearchError ? `Web search was requested but unavailable: ${webSearchError}. Do not pretend that you searched the web.` : "",
    ].filter(Boolean).join("\n\n");
'''
chat_new = r'''    const question = cleanText(req.body?.question, 6000);
    const rawAttachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    if (question.length < 1 && rawAttachments.length < 1) return res.status(400).json({ ok: false, error: "Type a message or attach a file first." });

    const pickText = question || rawAttachments.map((item) => cleanText(item?.name, 120)).filter(Boolean).join(" ") || "attachment help";
    const requested = cleanText(req.body?.provider, 30).toLowerCase() || "best";
    const best = chooseBestProvider(pickText);
    const providerId = requested === "best" ? best.id : requested;
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return res.status(400).json({ ok: false, error: "Choose an AI first." });
    if (!providerKey(providerId)) return res.status(400).json({ ok: false, error: `${provider.label} is not connected yet.` });

    const prepared = await prepareAiContext({
      question,
      attachments: rawAttachments,
      location: req.body?.location,
      webSearch: req.body?.webSearch ?? "auto",
    });
    const history = normalizeHistory(req.body?.history);
    const transcript = history.map((m) => `${m.role}: ${m.text}`).join("\n\n");
    const system = personaSystem(req.body?.persona, provider.label) + (prepared.locationText ? ` Use this user context when relevant: ${prepared.locationText}.` : "");
    const prompt = [
      transcript ? `Conversation so far:\n${transcript}` : "",
      `User's new message:\n${question || "Please help with the attached file(s)."}`,
      prepared.locationText ? `User location context:\n${prepared.locationText}` : "",
      prepared.attachmentText ? `Attached file context:\n${prepared.attachmentText}` : "",
      prepared.research.text ? `Current web research gathered automatically for this request:\n${prepared.research.text}` : "",
      prepared.webSearchError ? `Automatic web research was unavailable: ${prepared.webSearchError}. Do not pretend that you searched the web.` : "",
    ].filter(Boolean).join("\n\n");
'''
if chat_old not in s:
    raise SystemExit('chat block anchor not found')
s = s.replace(chat_old, chat_new, 1)

s = s.replace('''          citations: [...new Set([...(research.citations || []), ...(answer.citations || [])])].slice(0, 12),
          webSearchUsed: Boolean(research.text),
          webSearchError,''', '''          citations: [...new Set([...(prepared.research.citations || []), ...(answer.citations || [])])].slice(0, 12),
          webSearchUsed: prepared.webSearchUsed,
          webSearchError: prepared.webSearchError,
          attachments: prepared.attachments,
          location: prepared.location,''')

# Hot Room automatic context.
room_anchor = '''    const rounds = Math.max(1, Math.min(3, Number(req.body?.rounds || 1)));
    const mode = ["debate", "collaborate", "roundtable"].includes(req.body?.mode) ? req.body.mode : "collaborate";
    let sharedResearch = { text: "", citations: [] };
    if (bots.some((b) => b.tools.webSearch)) {
      try { sharedResearch = await webSearch(topic); } catch {}
    }
    const turns = [];
'''
room_new = '''    const rounds = Math.max(1, Math.min(3, Number(req.body?.rounds || 1)));
    const mode = ["debate", "collaborate", "roundtable"].includes(req.body?.mode) ? req.body.mode : "collaborate";
    const prepared = await prepareAiContext({ question: topic, attachments: req.body?.attachments, location: req.body?.location, webSearch: "auto" });
    const sharedResearch = prepared.research;
    const turns = [];
'''
if room_anchor not in s:
    raise SystemExit('room block anchor not found')
s = s.replace(room_anchor, room_new, 1)
s = s.replace('''          bot.tools.webSearch && sharedResearch.text ? `Current web research:\n${sharedResearch.text}` : "",
          `Now respond as ${bot.name}.`,''', '''          prepared.locationText ? `User location context:\n${prepared.locationText}` : "",
          prepared.attachmentText ? `Attached file context:\n${prepared.attachmentText}` : "",
          sharedResearch.text ? `Current web research gathered automatically:\n${sharedResearch.text}` : "",
          `Now respond as ${bot.name}.`,''')
s = s.replace('''    res.json({ ok: turns.some((t) => t.ok), topic, mode, rounds, turns, summary, citations: sharedResearch.citations });''', '''    res.json({ ok: turns.some((t) => t.ok), topic, mode, rounds, turns, summary, citations: sharedResearch.citations, attachments: prepared.attachments, location: prepared.location, webSearchUsed: prepared.webSearchUsed });''')
p.write_text(s)

# ---------- Council: same automatic context, attachments, location, web ----------
p = Path('src/aiCouncil.js')
s = p.read_text()
if 'prepareAiContext' not in s:
    s = s.replace('import { fileURLToPath } from "url";\n', 'import { fileURLToPath } from "url";\nimport { prepareAiContext } from "./aiAgent.js";\n', 1)
s = s.replace('const json = express.json({ limit: "80kb" });', 'const json = express.json({ limit: "20mb" });')
q_anchor = '''    const question = cleanText(req.body?.question, 6000);
    if (question.length < 2) return res.status(400).json({ ok: false, error: "Enter a question first." });

    const requested = Array.isArray(req.body?.providers) ? req.body.providers.map((id) => cleanText(id, 30)) : [];
'''
q_new = '''    const question = cleanText(req.body?.question, 6000);
    const hasAttachments = Array.isArray(req.body?.attachments) && req.body.attachments.length > 0;
    if (question.length < 2 && !hasAttachments) return res.status(400).json({ ok: false, error: "Enter a question or attach a file first." });
    const prepared = await prepareAiContext({ question, attachments: req.body?.attachments, location: req.body?.location, webSearch: "auto" });
    const effectiveQuestion = [
      question || "Review the attached file(s).",
      prepared.locationText ? `User location context:\n${prepared.locationText}` : "",
      prepared.attachmentText ? `Attached file context:\n${prepared.attachmentText}` : "",
      prepared.research.text ? `Current web research gathered automatically:\n${prepared.research.text}` : "",
    ].filter(Boolean).join("\n\n");

    const requested = Array.isArray(req.body?.providers) ? req.body.providers.map((id) => cleanText(id, 30)) : [];
'''
if q_anchor not in s:
    raise SystemExit('council question anchor not found')
s = s.replace(q_anchor, q_new, 1)
s = s.replace('const result = await callProvider(id, question, system);', 'const result = await callProvider(id, effectiveQuestion, system);', 1)
s = s.replace('citations: result.citations || [],', 'citations: [...new Set([...(prepared.research.citations || []), ...(result.citations || [])])].slice(0, 12),', 1)
s = s.replace('verdict = await buildVerdict(question, successful);', 'verdict = await buildVerdict(effectiveQuestion, successful);', 1)
s = s.replace('''      totalLatencyMs: Date.now() - startedAt,
    });''', '''      totalLatencyMs: Date.now() - startedAt,
      attachments: prepared.attachments,
      location: prepared.location,
      webSearchUsed: prepared.webSearchUsed,
      webSearchError: prepared.webSearchError,
    });''', 1)
p.write_text(s)

# ---------- Shared CSS ----------
p = Path('public/ai-council/ai-v2.css')
s = p.read_text()
css = '''\n.ai-attach-btn{width:46px;height:46px;flex:0 0 46px;border:1px solid #34343a;border-radius:14px;background:#1b1b20;color:#f3f3f6;font-size:26px;line-height:1;display:grid;place-items:center}.ai-attach-btn:active{transform:scale(.97)}.ai-attachment-input{display:none!important}.ai-attachment-strip{display:flex;gap:7px;flex-wrap:wrap;padding:4px 2px 8px}.ai-attachment-strip.hidden{display:none}.ai-attachment-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:6px 8px;border:1px solid #303036;border-radius:999px;background:#17171b;color:#b9b9c1;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ai-attachment-chip button{border:0;background:transparent;color:#8d8d96;font-size:15px;line-height:1;padding:0}.message-attachments{display:flex;gap:5px;flex-wrap:wrap;margin:0 0 5px}.message-attachments span{font-size:9px;color:#81818a;border:1px solid #2d2d33;border-radius:999px;padding:3px 6px}.auto-context{font-size:10px;color:#777781}''' 
if '.ai-attach-btn{' not in s:
    s += css
p.write_text(s)

# ---------- HTML: load shared context before page scripts ----------
for filename, script_name in [
    ('public/ai-council/index.html','main-chat-v2.js'),
    ('public/ai-council/bot-chat-v2.html','bot-chat-v2.js'),
    ('public/ai-council/bots-v2.html','bots-v2.js'),
    ('public/ai-council/family-v2.html','family-v2.js'),
]:
    p = Path(filename); h = p.read_text()
    marker = f'<script src="/ai-council/{script_name}'
    if '/ai-council/ai-context-v1.js' not in h and marker in h:
        h = h.replace(marker, '<script src="/ai-council/ai-context-v1.js?v=1" defer></script>\n' + marker, 1)
    if filename.endswith('index.html'):
        h = h.replace('id="webBtn" type="button">🌐 Search web when needed</button>', 'id="webBtn" type="button" aria-disabled="true">🌐 Internet is automatic</button>')
    p.write_text(h)

# ---------- Main chat client ----------
p = Path('public/ai-council/main-chat-v2.js')
s = p.read_text()
s = re.sub(r"let webOn = localStorage\.getItem\(WEB_KEY\) !== 'off';", "let webOn = true;", s, count=1)
controller_anchor = '''  const els = {
'''
# insert controllers after els object closes, before loadMessages
marker = '''  function loadMessages() {'''
controller_code = '''  const attachmentCtl = window.AIContext?.setupAttachmentController({ textareaId: 'prompt', key: 'main-chat' }) || { get:()=>[], clear:()=>{}, has:()=>false, names:()=>[] };
  const councilAttachmentCtl = window.AIContext?.setupAttachmentController({ textareaId: 'councilQuestion', key: 'main-council' }) || { get:()=>[], clear:()=>{}, has:()=>false, names:()=>[] };
  const locationContext = () => window.AIContext?.getLocationContext?.() || Promise.resolve({ timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || '', locale:navigator.language || '' });

'''
if 'const attachmentCtl =' not in s:
    s = s.replace(marker, controller_code + marker, 1)
s = s.replace("els.webBtn.textContent = webOn ? '🌐 Search web when needed' : '🌐 Web search off';\n    els.webBtn.classList.toggle('active', webOn);", "els.webBtn.textContent = '🌐 Internet is automatic';\n    els.webBtn.classList.add('active');")
# Render attachment names
msg_anchor = '''      const bubble = document.createElement('div');
      bubble.className = `message ${m.role === 'user' ? 'user' : 'assistant'}`;
      bubble.textContent = m.text;
'''
msg_new = msg_anchor + '''      if (Array.isArray(m.attachments) && m.attachments.length) {
        const files = document.createElement('div'); files.className = 'message-attachments';
        m.attachments.forEach((name) => { const chip=document.createElement('span'); chip.textContent=`📎 ${name}`; files.append(chip); });
        bubble.prepend(files);
      }
'''
if 'message-attachments' not in s[s.find('function renderMessages'):s.find('function setTyping')]:
    s = s.replace(msg_anchor, msg_new, 1)
# send message block modifications
s = s.replace("    if (!text) return;", "    if (!text && !attachmentCtl.has()) return;", 1)
s = s.replace("    const historyForApi = messages.slice(-14).map((m) => ({ role: m.role, text: m.text }));\n    messages.push({ role: 'user', text, at: Date.now() });", "    const historyForApi = messages.slice(-14).map((m) => ({ role: m.role, text: m.text }));\n    const attachments = attachmentCtl.get();\n    const attachmentNames = attachmentCtl.names();\n    const userText = text || 'Please help with the attached file(s).';\n    const location = await locationContext();\n    messages.push({ role: 'user', text: userText, attachments: attachmentNames, at: Date.now() });")
s = s.replace("    els.prompt.value = '';\n    renderMessages();", "    els.prompt.value = '';\n    attachmentCtl.clear();\n    renderMessages();", 1)
s = s.replace("body: JSON.stringify({ question: text, provider: selected, history: historyForApi, webSearch: webOn ? 'auto' : 'off' }),", "body: JSON.stringify({ question: userText, provider: selected, history: historyForApi, webSearch: 'auto', attachments, location }),")
# council
s = s.replace("    if (!question) return councilNotice('Type a question for the Council.', 'error');", "    if (!question && !councilAttachmentCtl.has()) return councilNotice('Type a question or attach a file for the Council.', 'error');")
s = s.replace("    const ids = [...els.councilChecks.querySelectorAll('input:checked')].map((input) => input.value);", "    const ids = [...els.councilChecks.querySelectorAll('input:checked')].map((input) => input.value);\n    const attachments = councilAttachmentCtl.get();\n    const location = await locationContext();")
s = s.replace("body: JSON.stringify({ question, providers: ids }),", "body: JSON.stringify({ question: question || 'Review the attached file(s).', providers: ids, attachments, location }),")
s = s.replace("      councilNotice(`${data.successfulCount || 0} AI${data.successfulCount === 1 ? '' : 's'} answered.`, 'success');", "      councilAttachmentCtl.clear();\n      councilNotice(`${data.successfulCount || 0} AI${data.successfulCount === 1 ? '' : 's'} answered.`, 'success');")
# no web toggle
s = s.replace("  els.webBtn.addEventListener('click', () => { webOn = !webOn; localStorage.setItem(WEB_KEY, webOn ? 'auto' : 'off'); renderProviderButton(); });", "  els.webBtn.addEventListener('click', () => { webOn = true; renderProviderButton(); });")
p.write_text(s)

# ---------- Bot chat client ----------
p = Path('public/ai-council/bot-chat-v2.js')
s = p.read_text()
marker = "  function loadArray(key)"
code = "  const attachmentCtl=window.AIContext?.setupAttachmentController({textareaId:'prompt',key:'bot-chat'})||{get:()=>[],clear:()=>{},has:()=>false,names:()=>[]};\n  const locationContext=()=>window.AIContext?.getLocationContext?.()||Promise.resolve({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',locale:navigator.language||''});\n"
if 'const attachmentCtl=' not in s:
    s=s.replace(marker,code+marker,1)
s=s.replace("if(t.webSearch)defs.push(['🌐 Internet Search','ready']);", "defs.push(['🌐 Internet Search · automatic','ready']);")
# render attachment names
needle="const bubble=document.createElement('div');bubble.className=`message ${m.role==='user'?'user':'assistant'}`;bubble.textContent=m.text;"
replacement=needle+"if(Array.isArray(m.attachments)&&m.attachments.length){const files=document.createElement('div');files.className='message-attachments';m.attachments.forEach(name=>{const chip=document.createElement('span');chip.textContent=`📎 ${name}`;files.append(chip)});bubble.prepend(files)}"
s=s.replace(needle,replacement,1)
# replace send function whole via regex
pattern=r"  async function send\(\)\{[\s\S]*?\n  function addToHotRoom"
new_send=r'''  async function send(){if(sending||!currentBot)return;const text=els.prompt.value.trim();if(!text&&!attachmentCtl.has())return;if(!code())return requestAccess(send);const history=botMessages().slice(-14).map(m=>({role:m.role,text:m.text}));const attachments=attachmentCtl.get();const names=attachmentCtl.names();const userText=text||'Please help with the attached file(s).';const location=await locationContext();const list=botMessages();list.push({role:'user',text:userText,attachments:names,at:Date.now()});chats[currentBot.id]=list;saveChats();els.prompt.value='';attachmentCtl.clear();renderMessages();setTyping(true);sending=true;els.sendBtn.disabled=true;notice('');try{const response=await fetch('/api/ai-agent/chat',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':code()},body:JSON.stringify({question:userText,provider:currentBot.provider,history,webSearch:'auto',attachments,location,persona:{name:currentBot.name,role:currentBot.role,instructions:currentBot.instructions}})});const data=await response.json().catch(()=>({}));if(!response.ok||!data.ok)throw new Error(data.error||'Bot request failed.');const next=botMessages();next.push({role:'assistant',text:data.answer,providerLabel:data.providerLabel,citations:data.citations||[],at:Date.now()});chats[currentBot.id]=next;saveChats();saveActivity(data.answer)}catch(error){notice(error.message||String(error),'error')}finally{setTyping(false);sending=false;els.sendBtn.disabled=false;renderMessages()}}
  function addToHotRoom'''
s2,n=re.subn(pattern,new_send,s,count=1)
if n!=1: raise SystemExit('bot chat send function not found')
p.write_text(s2)

# ---------- Bots/Hot Room client ----------
p=Path('public/ai-council/bots-v2.js');s=p.read_text()
marker="  function loadArray(key)"
code="  const roomAttachmentCtl=window.AIContext?.setupAttachmentController({textareaId:'roomTopic',key:'hot-room'})||{get:()=>[],clear:()=>{},has:()=>false,names:()=>[]};\n  const locationContext=()=>window.AIContext?.getLocationContext?.()||Promise.resolve({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',locale:navigator.language||''});\n"
if 'const roomAttachmentCtl=' not in s:s=s.replace(marker,code+marker,1)
s=s.replace("function toolsOf(bot) { return { webSearch: !!bot?.tools?.webSearch,", "function toolsOf(bot) { return { webSearch: true,")
s=s.replace("els.toolWeb.checked = t.webSearch;", "els.toolWeb.checked = true; els.toolWeb.disabled = true;")
s=s.replace("tools: { webSearch: els.toolWeb.checked,", "tools: { webSearch: true,")
s=s.replace("tools:{webSearch:false,gmail:false,browser:false,shopping:false}", "tools:{webSearch:true,gmail:false,browser:false,shopping:false}")
s=s.replace("    if (!topic) return notice(els.roomNotice, 'Tell the bots what to work on.', 'error');", "    if (!topic && !roomAttachmentCtl.has()) return notice(els.roomNotice, 'Tell the bots what to work on or attach a file.', 'error');")
s=s.replace("    els.runRoomBtn.disabled = true;", "    const attachments=roomAttachmentCtl.get(); const location=await locationContext();\n    els.runRoomBtn.disabled = true;",1)
s=s.replace("body: JSON.stringify({ topic, bots: chosen, mode: els.roomMode.value, rounds: Number(els.roomRounds.value) }),", "body: JSON.stringify({ topic: topic || 'Review the attached file(s).', bots: chosen, mode: els.roomMode.value, rounds: Number(els.roomRounds.value), attachments, location }),")
s=s.replace("      notice(els.roomNotice, 'Done.', 'success');", "      roomAttachmentCtl.clear();\n      notice(els.roomNotice, 'Done.', 'success');")
p.write_text(s)

# ---------- Family client ----------
p=Path('public/ai-council/family-v2.js');s=p.read_text()
s=s.replace("let selectedProvider='best';let webOn=true;", "let selectedProvider='best';let webOn=true;")
marker="  function b64(bytes)"
code="  const mainAttachmentCtl=window.AIContext?.setupAttachmentController({textareaId:'familyPrompt',key:`${slug}-main`})||{get:()=>[],clear:()=>{},has:()=>false,names:()=>[]};\n  const botAttachmentCtl=window.AIContext?.setupAttachmentController({textareaId:'familyBotPrompt',key:`${slug}-bot`})||{get:()=>[],clear:()=>{},has:()=>false,names:()=>[]};\n  const councilAttachmentCtl=window.AIContext?.setupAttachmentController({textareaId:'familyCouncilQuestion',key:`${slug}-council`})||{get:()=>[],clear:()=>{},has:()=>false,names:()=>[]};\n  const locationContext=()=>window.AIContext?.getLocationContext?.()||Promise.resolve({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'',locale:navigator.language||''});\n"
if 'const mainAttachmentCtl=' not in s:s=s.replace(marker,code+marker,1)
s=s.replace("function toolsOf(bot){return{webSearch:!!bot?.tools?.webSearch,", "function toolsOf(bot){return{webSearch:true,")
s=s.replace("els.familyWebBtn.textContent=webOn?'🌐 Search web when needed':'🌐 Web search off';els.familyWebBtn.classList.toggle('active',webOn)", "els.familyWebBtn.textContent='🌐 Internet is automatic';els.familyWebBtn.classList.add('active')")
# main send function
pattern=r"  async function sendMain\(\)\{[\s\S]*?\n  function renderBots"
new=r'''  async function sendMain(){if(sending)return;const text=els.familyPrompt.value.trim();if(!text&&!mainAttachmentCtl.has())return;if(!configured(selectedProvider)){selectedProvider='best';vault.selectedProvider='best';renderProviderButton()}const history=(vault.aiChat||[]).slice(-14).map(m=>({role:m.role,text:m.text}));const attachments=mainAttachmentCtl.get();const names=mainAttachmentCtl.names();const userText=text||'Please help with the attached file(s).';const location=await locationContext();vault.aiChat.push({role:'user',text:userText,attachments:names,at:Date.now()});els.familyPrompt.value='';mainAttachmentCtl.clear();await save();renderMainMessages();sending=true;els.familySendBtn.disabled=true;try{const r=await fetch('/api/ai-agent/chat',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':vault.ownerCode},body:JSON.stringify({question:userText,provider:selectedProvider,history,webSearch:'auto',attachments,location})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'AI request failed.');vault.aiChat.push({role:'assistant',text:d.answer,providerLabel:d.providerLabel,pickedForMe:d.pickedForMe,pickReason:d.pickReason,citations:d.citations||[],at:Date.now()})}catch(e){vault.aiChat.push({role:'assistant',text:`I couldn't answer that. ${e.message||e}`,providerLabel:'Error',at:Date.now()})}await save();sending=false;els.familySendBtn.disabled=false;renderMainMessages()}
  function renderBots'''
s,n=re.subn(pattern,new,s,count=1)
if n!=1:raise SystemExit('family sendMain not found')
# bot send
pattern=r"  async function sendBot\(\)\{[\s\S]*?\n  function openEditor"
new=r'''  async function sendBot(){if(botSending||!activeBot)return;const text=els.familyBotPrompt.value.trim();if(!text&&!botAttachmentCtl.has())return;const list=Array.isArray(vault.chats[activeBot.id])?vault.chats[activeBot.id]:[];const history=list.slice(-14).map(m=>({role:m.role,text:m.text}));const attachments=botAttachmentCtl.get();const names=botAttachmentCtl.names();const userText=text||'Please help with the attached file(s).';const location=await locationContext();list.push({role:'user',text:userText,attachments:names,at:Date.now()});vault.chats[activeBot.id]=list;els.familyBotPrompt.value='';botAttachmentCtl.clear();await save();renderBotMessages();botSending=true;els.familyBotSendBtn.disabled=true;try{const r=await fetch('/api/ai-agent/chat',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':vault.ownerCode},body:JSON.stringify({question:userText,provider:activeBot.provider,history,webSearch:'auto',attachments,location,persona:{name:activeBot.name,role:activeBot.role,instructions:activeBot.instructions}})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Bot request failed.');list.push({role:'assistant',text:d.answer,citations:d.citations||[],providerLabel:d.providerLabel,at:Date.now()})}catch(e){list.push({role:'assistant',text:`I couldn't answer that. ${e.message||e}`,at:Date.now()})}vault.chats[activeBot.id]=list;await save();botSending=false;els.familyBotSendBtn.disabled=false;renderBotMessages()}
  function openEditor'''
s,n=re.subn(pattern,new,s,count=1)
if n!=1:raise SystemExit('family sendBot not found')
# council add attachments/location
s=s.replace("if(!q)return notice(els.familyCouncilNotice,'Type a question first.','error');", "if(!q&&!councilAttachmentCtl.has())return notice(els.familyCouncilNotice,'Type a question or attach a file first.','error');")
s=s.replace("const ids=[...els.familyCouncilChecks.querySelectorAll('input:checked')].map(i=>i.value);", "const ids=[...els.familyCouncilChecks.querySelectorAll('input:checked')].map(i=>i.value);const attachments=councilAttachmentCtl.get();const location=await locationContext();")
s=s.replace("body:JSON.stringify({question:q,providers:ids})", "body:JSON.stringify({question:q||'Review the attached file(s).',providers:ids,attachments,location})")
s=s.replace("notice(els.familyCouncilNotice,`${d.successfulCount||0} AIs answered.`,'success')", "councilAttachmentCtl.clear();notice(els.familyCouncilNotice,`${d.successfulCount||0} AIs answered.`,'success')")
# tool editor auto web
s=s.replace("els.familyToolWeb.checked=t.webSearch;", "els.familyToolWeb.checked=true;els.familyToolWeb.disabled=true;")
s=s.replace("tools:{webSearch:els.familyToolWeb.checked,", "tools:{webSearch:true,")
# web button handler toggle -> no-op
s=re.sub(r"els\.familyWebBtn\.onclick=.*?;", "els.familyWebBtn.onclick=()=>{webOn=true;vault.webOn=true;renderProviderButton()};", s, count=1)
p.write_text(s)

# Add attachment names rendering for family main/bot using targeted simple replacement.
p=Path('public/ai-council/family-v2.js');s=p.read_text()
needle="bubble.textContent=m.text;if(Array.isArray(m.citations)"
if needle in s:
    s=s.replace(needle,"bubble.textContent=m.text;if(Array.isArray(m.attachments)&&m.attachments.length){const files=document.createElement('div');files.className='message-attachments';m.attachments.forEach(name=>{const chip=document.createElement('span');chip.textContent=`📎 ${name}`;files.append(chip)});bubble.prepend(files)}if(Array.isArray(m.citations)",1)
needle2="b.textContent=m.text;if(Array.isArray(m.citations)"
if needle2 in s:
    s=s.replace(needle2,"b.textContent=m.text;if(Array.isArray(m.attachments)&&m.attachments.length){const files=document.createElement('div');files.className='message-attachments';m.attachments.forEach(name=>{const chip=document.createElement('span');chip.textContent=`📎 ${name}`;files.append(chip)});b.prepend(files)}if(Array.isArray(m.citations)",1)
p.write_text(s)

print('AI context upgrade applied')
