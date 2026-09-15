from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing anchor: {label}')
    return text.replace(old, new, 1)

# ---------------- backend ----------------
p = Path('src/aiAgent.js')
s = p.read_text()

anchor = '''async function analyzeBinaryAttachments(files) {
  if (!files.length) return "";
  if (!providerKey("openai")) throw new Error("Photo and document attachments need OPENAI_API_KEY for file understanding.");
'''
if anchor not in s:
    raise SystemExit('missing analyzeBinaryAttachments')

insert_after = '''  return extractResponsesText(data);
}
'''
idx = s.index(insert_after, s.index(anchor)) + len(insert_after)
helpers = r'''

function normalizePreparedAttachmentContexts(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 6).map((item) => ({
    name: cleanText(item?.name, 160) || "attachment",
    type: cleanText(item?.type, 120) || "application/octet-stream",
    size: Math.max(0, Number(item?.size || 0)),
    text: cleanText(item?.text, 22000),
  })).filter((item) => item.text);
}

async function prepareOneAttachment(raw) {
  const files = normalizeAttachments([raw]);
  if (!files.length) throw new Error("The attachment is missing, empty, or too large.");
  const file = files[0];
  let text = "";
  if (textLikeAttachment(file)) {
    text = decodeTextAttachment(file);
  } else {
    text = await analyzeBinaryAttachments([file]);
  }
  if (!text) throw new Error(`No readable content was returned for ${file.name}.`);
  return { name: file.name, type: file.type, size: file.size, text: cleanText(text, 22000) };
}
'''
if 'function normalizePreparedAttachmentContexts' not in s:
    s = s[:idx] + helpers + s[idx:]

s = s.replace(
    'export async function prepareAiContext({ question = "", attachments = [], location = {}, webSearch: webMode = "auto" } = {}) {\n  const files = normalizeAttachments(attachments);',
    'export async function prepareAiContext({ question = "", attachments = [], attachmentContexts = [], location = {}, webSearch: webMode = "auto" } = {}) {\n  const files = normalizeAttachments(attachments);\n  const preparedContexts = normalizePreparedAttachmentContexts(attachmentContexts);',
    1,
)
s = replace_once(
    s,
    '''  const attachmentText = [
    ...textSections,
    attachmentAnalysis ? `Attachment analysis:\n${attachmentAnalysis}` : "",
    attachmentError ? `Attachment processing note: ${attachmentError}` : "",
  ].filter(Boolean).join("\\n\\n");''',
    '''  const attachmentText = [
    ...preparedContexts.map((item) => `Attachment: ${item.name}\\n${item.text}`),
    ...textSections,
    attachmentAnalysis ? `Attachment analysis:\n${attachmentAnalysis}` : "",
    attachmentError ? `Attachment processing note: ${attachmentError}` : "",
  ].filter(Boolean).join("\\n\\n");''',
    'attachmentText prepared contexts',
)
s = replace_once(
    s,
    '    attachments: files.map(({ name, type, size }) => ({ name, type, size })),',
    '    attachments: [...preparedContexts.map(({ name, type, size }) => ({ name, type, size })), ...files.map(({ name, type, size }) => ({ name, type, size }))],',
    'attachment metadata',
)

route_anchor = '''  app.post("/api/ai-agent/location", express.json({ limit: "8kb" }), async (req, res) => {'''
prepare_route = r'''  app.post("/api/ai-agent/attachments/prepare", express.json({ limit: "10mb" }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireAccess(req, res, accessCode)) return;
    const name = cleanText(req.body?.attachment?.name, 160) || "attachment";
    try {
      const attachment = await prepareOneAttachment(req.body?.attachment);
      return res.json({ ok: true, attachment });
    } catch (error) {
      console.error(`Attachment preparation failed for ${name}:`, error?.message || error);
      return res.status(422).json({ ok: false, error: `I could not read ${name}. ${cleanText(error?.message || error, 360)}` });
    }
  });

'''
if '/api/ai-agent/attachments/prepare' not in s:
    s = replace_once(s, route_anchor, prepare_route + route_anchor, 'attachment prepare route')

s = replace_once(
    s,
    '''    const rawAttachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    if (question.length < 1 && rawAttachments.length < 1) return res.status(400).json({ ok: false, error: "Type a message or attach a file first." });

    const pickText = question || rawAttachments.map((item) => cleanText(item?.name, 120)).filter(Boolean).join(" ") || "attachment help";''',
    '''    const rawAttachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    const attachmentContexts = Array.isArray(req.body?.attachmentContexts) ? req.body.attachmentContexts : [];
    if (question.length < 1 && rawAttachments.length < 1 && attachmentContexts.length < 1) return res.status(400).json({ ok: false, error: "Type a message or attach a file first." });

    const pickText = question || [...rawAttachments, ...attachmentContexts].map((item) => cleanText(item?.name, 120)).filter(Boolean).join(" ") || "attachment help";''',
    'chat attachment context input',
)
s = replace_once(
    s,
    '''      attachments: rawAttachments,
      location: req.body?.location,''',
    '''      attachments: rawAttachments,
      attachmentContexts,
      location: req.body?.location,''',
    'chat prepare context args',
)
s = replace_once(
    s,
    'const prepared = await prepareAiContext({ question: topic, attachments: req.body?.attachments, location: req.body?.location, webSearch: "auto" });',
    'const prepared = await prepareAiContext({ question: topic, attachments: req.body?.attachments, attachmentContexts: req.body?.attachmentContexts, location: req.body?.location, webSearch: "auto" });',
    'hot room prepared contexts',
)
p.write_text(s)

# Council: accept staged attachment contexts too.
p = Path('src/aiCouncil.js')
s = p.read_text()
s = replace_once(
    s,
    '''    const hasAttachments = Array.isArray(req.body?.attachments) && req.body.attachments.length > 0;
    if (question.length < 2 && !hasAttachments) return res.status(400).json({ ok: false, error: "Enter a question or attach a file first." });
    const prepared = await prepareAiContext({ question, attachments: req.body?.attachments, location: req.body?.location, webSearch: "auto" });''',
    '''    const hasAttachments = (Array.isArray(req.body?.attachments) && req.body.attachments.length > 0) || (Array.isArray(req.body?.attachmentContexts) && req.body.attachmentContexts.length > 0);
    if (question.length < 2 && !hasAttachments) return res.status(400).json({ ok: false, error: "Enter a question or attach a file first." });
    const prepared = await prepareAiContext({ question, attachments: req.body?.attachments, attachmentContexts: req.body?.attachmentContexts, location: req.body?.location, webSearch: "auto" });''',
    'council prepared contexts',
)
p.write_text(s)

# ---------------- shared browser helper ----------------
p = Path('public/ai-council/ai-context-v1.js')
s = p.read_text()
helper_anchor = '''  function attachmentNames(list) {
    return (Array.isArray(list) ? list : []).map((item) => item?.name).filter(Boolean);
  }

  window.AIContext = { setupAttachmentController, getLocationContext, attachmentNames };
'''
helper_new = r'''  function attachmentNames(list) {
    return (Array.isArray(list) ? list : []).map((item) => item?.name).filter(Boolean);
  }

  async function prepareAttachments(list, accessCode, onProgress) {
    const files = Array.isArray(list) ? list : [];
    if (!files.length) return [];
    const prepared = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (typeof onProgress === 'function') onProgress(index + 1, files.length, file.name || 'attachment');
      let response;
      try {
        response = await fetch('/api/ai-agent/attachments/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-ai-council-code': accessCode || '' },
          body: JSON.stringify({ attachment: file }),
        });
      } catch (firstError) {
        // Mobile browsers occasionally reset one large upload. Retry the single file once.
        await new Promise((resolve) => setTimeout(resolve, 450));
        try {
          response = await fetch('/api/ai-agent/attachments/prepare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-ai-council-code': accessCode || '' },
            body: JSON.stringify({ attachment: file }),
          });
        } catch {
          throw new Error(`The connection dropped while uploading ${file.name || 'an attachment'}. Please try that file again.`);
        }
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.attachment) {
        throw new Error(data.error || `I could not read ${file.name || 'that attachment'} (${response.status}).`);
      }
      prepared.push(data.attachment);
    }
    return prepared;
  }

  window.AIContext = { setupAttachmentController, getLocationContext, attachmentNames, prepareAttachments };
'''
s = replace_once(s, helper_anchor, helper_new, 'shared prepareAttachments helper')
p.write_text(s)

# ---------------- main chat + council ----------------
p = Path('public/ai-council/main-chat-v2.js')
s = p.read_text()
s = replace_once(
    s,
    '''    try {
      const response = await fetch('/api/ai-agent/chat', {''',
    '''    try {
      const attachmentContexts = await window.AIContext.prepareAttachments(attachments, accessCode(), (done, total, name) => {
        const typing = document.querySelector('#typingRow .typing');
        if (typing) typing.textContent = `Reading ${name} (${done} of ${total})…`;
      });
      const response = await fetch('/api/ai-agent/chat', {''',
    'main chat staged upload',
)
s = replace_once(
    s,
    "body: JSON.stringify({ question: userText, provider: selected, history: historyForApi, webSearch: 'auto', attachments, location }),",
    "body: JSON.stringify({ question: userText, provider: selected, history: historyForApi, webSearch: 'auto', attachmentContexts, location }),",
    'main chat refs payload',
)
s = replace_once(
    s,
    '''    councilNotice('The Council is asking each AI…');
    try {
      const response = await fetch('/api/ai-council/ask', {''',
    '''    councilNotice('The Council is asking each AI…');
    try {
      const attachmentContexts = await window.AIContext.prepareAttachments(attachments, accessCode(), (done, total, name) => councilNotice(`Reading ${name} (${done} of ${total})…`));
      councilNotice('The Council is asking each AI…');
      const response = await fetch('/api/ai-council/ask', {''',
    'main council staged upload',
)
s = replace_once(
    s,
    "body: JSON.stringify({ question: question || 'Review the attached file(s).', providers: ids, attachments, location }),",
    "body: JSON.stringify({ question: question || 'Review the attached file(s).', providers: ids, attachmentContexts, location }),",
    'main council refs payload',
)
p.write_text(s)

# ---------------- direct bot chat ----------------
p = Path('public/ai-council/bot-chat-v2.js')
s = p.read_text()
s = replace_once(
    s,
    "try{const response=await fetch('/api/ai-agent/chat'",
    "try{const attachmentContexts=await window.AIContext.prepareAttachments(attachments,code(),(done,total,name)=>notice(`Reading ${name} (${done} of ${total})…`));const response=await fetch('/api/ai-agent/chat'",
    'bot chat staged upload',
)
s = replace_once(
    s,
    "webSearch:'auto',attachments,location,persona:",
    "webSearch:'auto',attachmentContexts,location,persona:",
    'bot chat refs payload',
)
p.write_text(s)

# ---------------- Hot Room ----------------
p = Path('public/ai-council/bots-v2.js')
s = p.read_text()
s = replace_once(
    s,
    '''    notice(els.roomNotice, 'The bots are working together…');
    try {
      const response = await fetch('/api/ai-agent/bots/run', {''',
    '''    notice(els.roomNotice, 'Preparing your task…');
    try {
      const attachmentContexts = await window.AIContext.prepareAttachments(attachments, code(), (done, total, name) => notice(els.roomNotice, `Reading ${name} (${done} of ${total})…`));
      notice(els.roomNotice, 'The bots are working together…');
      const response = await fetch('/api/ai-agent/bots/run', {''',
    'hot room staged upload',
)
s = replace_once(
    s,
    "body: JSON.stringify({ topic: topic || 'Review the attached file(s).', bots: chosen, mode: els.roomMode.value, rounds: Number(els.roomRounds.value), attachments, location }),",
    "body: JSON.stringify({ topic: topic || 'Review the attached file(s).', bots: chosen, mode: els.roomMode.value, rounds: Number(els.roomRounds.value), attachmentContexts, location }),",
    'hot room refs payload',
)
s = s.replace(
    "} catch (error) {\n      notice(els.roomNotice, error.message || String(error), 'error');",
    "} catch (error) {\n      const message = error?.message === 'Failed to fetch' ? 'The connection dropped while starting the Hot Room. Your task and attachments are still here — tap Start Hot Room to retry.' : (error.message || String(error));\n      notice(els.roomNotice, message, 'error');",
    1,
)
p.write_text(s)

# ---------------- family chats + council ----------------
p = Path('public/ai-council/family-v2.js')
s = p.read_text()
# Main family chat.
s = replace_once(
    s,
    "try{const r=await fetch('/api/ai-agent/chat',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':vault.ownerCode},body:JSON.stringify({question:userText,provider:selectedProvider,history,webSearch:'auto',attachments,location})});",
    "try{const attachmentContexts=await window.AIContext.prepareAttachments(attachments,vault.ownerCode);const r=await fetch('/api/ai-agent/chat',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':vault.ownerCode},body:JSON.stringify({question:userText,provider:selectedProvider,history,webSearch:'auto',attachmentContexts,location})});",
    'family main staged upload',
)
# Family bot chat.
s = replace_once(
    s,
    "body:JSON.stringify({question:userText,provider:activeBot.provider,history,webSearch:'auto',attachments,location,persona:",
    "body:JSON.stringify({question:userText,provider:activeBot.provider,history,webSearch:'auto',attachmentContexts,location,persona:",
    'family bot refs payload',
)
# Insert the staged upload in the family bot try block just before its fetch.
needle = "try{const r=await fetch('/api/ai-agent/chat',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':vault.ownerCode},body:JSON.stringify({question:userText,provider:activeBot.provider"
if needle not in s:
    raise SystemExit('missing family bot fetch anchor')
s = s.replace(needle, "try{const attachmentContexts=await window.AIContext.prepareAttachments(attachments,vault.ownerCode);const r=await fetch('/api/ai-agent/chat',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':vault.ownerCode},body:JSON.stringify({question:userText,provider:activeBot.provider", 1)
# Family council.
needle = "try{const r=await fetch('/api/ai-council/ask',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':vault.ownerCode},body:JSON.stringify({question:question||'Review the attached file(s).',providers:ids,attachments,location})});"
if needle in s:
    s = s.replace(needle, "try{const attachmentContexts=await window.AIContext.prepareAttachments(attachments,vault.ownerCode);const r=await fetch('/api/ai-council/ask',{method:'POST',headers:{'Content-Type':'application/json','x-ai-council-code':vault.ownerCode},body:JSON.stringify({question:question||'Review the attached file(s).',providers:ids,attachmentContexts,location})});", 1)
else:
    # tolerate spaces in generated family source
    s = s.replace("providers:ids,attachments,location", "providers:ids,attachmentContexts,location", 1)
    council_fetch = "try{const r=await fetch('/api/ai-council/ask'"
    pos = s.find(council_fetch)
    if pos < 0:
        raise SystemExit('missing family council fetch anchor')
    s = s[:pos] + "try{const attachmentContexts=await window.AIContext.prepareAttachments(attachments,vault.ownerCode);const r=await fetch('/api/ai-council/ask'" + s[pos+len(council_fetch):]
p.write_text(s)

print('staged attachment transport patch applied')
