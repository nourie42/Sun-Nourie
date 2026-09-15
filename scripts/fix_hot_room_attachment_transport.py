from pathlib import Path

# Backend: add a lightweight per-file preprocessing endpoint and let Hot Room consume compact context.
p = Path('src/aiAgent.js')
s = p.read_text()

route_anchor = '''  app.post("/api/ai-agent/chat", json, async (req, res) => {'''
prepare_route = '''  app.post("/api/ai-agent/attachment/prepare", json, async (req, res) => {\n    res.setHeader("Cache-Control", "no-store");\n    if (!requireAccess(req, res, accessCode)) return;\n    const attachment = req.body?.attachment;\n    if (!attachment) return res.status(400).json({ ok: false, error: "Choose a file first." });\n    try {\n      const prepared = await prepareAiContext({ question: "", attachments: [attachment], location: {}, webSearch: "off" });\n      if (!prepared.attachmentText) {\n        return res.status(422).json({ ok: false, error: prepared.attachmentError || "That file could not be read." });\n      }\n      return res.json({ ok: true, attachmentText: prepared.attachmentText, attachments: prepared.attachments });\n    } catch (error) {\n      console.error("AI attachment preparation failed:", error?.message || error);\n      return res.status(502).json({ ok: false, error: `Could not read the attachment. ${cleanText(error?.message || error, 320)}` });\n    }\n  });\n\n'''
if '/api/ai-agent/attachment/prepare' not in s:
    if route_anchor not in s:
        raise SystemExit('chat route anchor not found')
    s = s.replace(route_anchor, prepare_route + route_anchor, 1)

old_prepare = '''    const rounds = Math.max(1, Math.min(3, Number(req.body?.rounds || 1)));\n    const mode = ["debate", "collaborate", "roundtable"].includes(req.body?.mode) ? req.body.mode : "collaborate";\n    const prepared = await prepareAiContext({ question: topic, attachments: req.body?.attachments, location: req.body?.location, webSearch: "auto" });\n    const sharedResearch = prepared.research;\n    const turns = [];\n'''
new_prepare = '''    const rounds = Math.max(1, Math.min(3, Number(req.body?.rounds || 1)));\n    const mode = ["debate", "collaborate", "roundtable"].includes(req.body?.mode) ? req.body.mode : "collaborate";\n    const preparedAttachmentText = cleanText(req.body?.preparedAttachmentText, 42000);\n    const preparedAttachments = Array.isArray(req.body?.preparedAttachments)\n      ? req.body.preparedAttachments.slice(0, 6).map((item) => ({\n          name: cleanText(item?.name, 160),\n          type: cleanText(item?.type, 120),\n          size: Math.max(0, Number(item?.size || 0)),\n        }))\n      : [];\n    const prepared = await prepareAiContext({\n      question: [topic, preparedAttachmentText].filter(Boolean).join("\\n\\n"),\n      attachments: preparedAttachmentText ? [] : req.body?.attachments,\n      location: req.body?.location,\n      webSearch: "auto",\n    });\n    if (preparedAttachmentText) {\n      prepared.attachmentText = preparedAttachmentText;\n      prepared.attachments = preparedAttachments;\n    }\n    const sharedResearch = prepared.research;\n    const turns = [];\n'''
if old_prepare not in s:
    raise SystemExit('bots prepare anchor not found')
s = s.replace(old_prepare, new_prepare, 1)

old_prompt = '''          transcript ? `Conversation so far:\\n${transcript}` : "You are the first speaker.",\n          bot.tools.webSearch && sharedResearch.text ? `Current web research:\\n${sharedResearch.text}` : "",\n          `Now respond as ${bot.name}.`,\n'''
new_prompt = '''          transcript ? `Conversation so far:\\n${transcript}` : "You are the first speaker.",\n          prepared.locationText ? `User location context:\\n${prepared.locationText}` : "",\n          prepared.attachmentText ? `Attached file context:\\n${prepared.attachmentText}` : "",\n          sharedResearch.text ? `Current web research gathered automatically:\\n${sharedResearch.text}` : "",\n          `Now respond as ${bot.name}.`,\n'''
if old_prompt not in s:
    raise SystemExit('bots prompt anchor not found')
s = s.replace(old_prompt, new_prompt, 1)

p.write_text(s)

# Frontend: preprocess each attachment one at a time so the long-running Hot Room request stays small.
p = Path('public/ai-council/bots-v2.js')
s = p.read_text()

insert_anchor = '''  async function runRoom() {\n'''
helper = '''  async function prepareRoomAttachments(attachments) {\n    if (!attachments.length) return { text: "", meta: [] };\n    const texts = [];\n    const meta = [];\n    for (let i = 0; i < attachments.length; i += 1) {\n      notice(els.roomNotice, `Reading attachment ${i + 1} of ${attachments.length}…`);\n      let response;\n      try {\n        response = await fetch('/api/ai-agent/attachment/prepare', {\n          method: 'POST',\n          headers: { 'Content-Type':'application/json', 'x-ai-council-code': code() },\n          body: JSON.stringify({ attachment: attachments[i] }),\n        });\n      } catch (error) {\n        throw new Error(`The connection closed while uploading ${attachments[i].name}. Try that file again or use a smaller copy.`);\n      }\n      const data = await response.json().catch(() => ({}));\n      if (!response.ok || !data.ok) throw new Error(data.error || `Could not read ${attachments[i].name}.`);\n      if (data.attachmentText) texts.push(data.attachmentText);\n      if (Array.isArray(data.attachments)) meta.push(...data.attachments);\n    }\n    return { text: texts.join('\\n\\n'), meta };\n  }\n\n'''
if 'async function prepareRoomAttachments' not in s:
    if insert_anchor not in s:
        raise SystemExit('runRoom anchor not found')
    s = s.replace(insert_anchor, helper + insert_anchor, 1)

old_start = '''    const attachments=roomAttachmentCtl.get(); const location=await locationContext();\n    els.runRoomBtn.disabled = true;\n    els.roomResults.replaceChildren();\n    notice(els.roomNotice, 'The bots are working together…');\n    try {\n      const response = await fetch('/api/ai-agent/bots/run', {\n'''
new_start = '''    const attachments=roomAttachmentCtl.get(); const location=await locationContext();\n    els.runRoomBtn.disabled = true;\n    els.roomResults.replaceChildren();\n    try {\n      const preparedFiles = await prepareRoomAttachments(attachments);\n      notice(els.roomNotice, 'The bots are working together…');\n      const response = await fetch('/api/ai-agent/bots/run', {\n'''
if old_start not in s:
    raise SystemExit('runRoom start anchor not found')
s = s.replace(old_start, new_start, 1)

old_body = '''        body: JSON.stringify({ topic: topic || 'Review the attached file(s).', bots: chosen, mode: els.roomMode.value, rounds: Number(els.roomRounds.value), attachments, location }),\n'''
new_body = '''        body: JSON.stringify({ topic: topic || 'Review the attached file(s).', bots: chosen, mode: els.roomMode.value, rounds: Number(els.roomRounds.value), preparedAttachmentText: preparedFiles.text, preparedAttachments: preparedFiles.meta, location }),\n'''
if old_body not in s:
    raise SystemExit('runRoom body anchor not found')
s = s.replace(old_body, new_body, 1)

# Make generic network failures useful instead of showing only "Failed to fetch".
old_catch = '''    } catch (error) {\n      notice(els.roomNotice, error.message || String(error), 'error');\n    } finally {\n'''
new_catch = '''    } catch (error) {\n      const raw = error?.message || String(error);\n      const message = raw === 'Failed to fetch'\n        ? 'The connection to the AI service closed before the Hot Room finished. Your files are still attached. Try again; if it repeats, attach the files one at a time.'\n        : raw;\n      notice(els.roomNotice, message, 'error');\n    } finally {\n'''
# Only replace the first catch after runRoom by scoping from function position.
pos = s.find('  async function runRoom()')
if pos < 0:
    raise SystemExit('runRoom not found after patch')
sub = s[pos:]
if old_catch not in sub:
    raise SystemExit('runRoom catch anchor not found')
sub = sub.replace(old_catch, new_catch, 1)
s = s[:pos] + sub

p.write_text(s)
print('Hot Room attachment transport fix applied')
