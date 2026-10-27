import express from "express";
import {
  anthropicHeaders,
  extractResponsesText,
  fetchJson,
  providerErrorMessage,
  providerKey,
  requireCouncilAccess,
} from "./aiCouncil.js";

// "My AIs": Grok, Muse, Claude and ChatGPT in the Grok-style chat page.
// Cost rules: no availability probes, web search only when the user turns it on,
// a fast/cheap model by default and the top model only when "Deep" is selected.
const HUB_BOTS = [
  { id: "xai", name: "Grok", maker: "xAI", fast: "grok-4.3", deep: "grok-4.7" },
  { id: "muse", name: "Muse", maker: "Meta", fast: "muse-spark-1.1", deep: "muse-spark-1.1" },
  { id: "anthropic", name: "Claude", maker: "Anthropic", fast: "claude-sonnet-5-5", deep: "claude-opus-5-5" },
  { id: "openai", name: "ChatGPT", maker: "OpenAI", fast: "gpt-5.6-terra", deep: "gpt-5.6" },
];

const MAX_HISTORY = 40;
const ROOM_MAX_TURNS = 12;

function cleanText(value, max = 12000) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function findBot(id) {
  return HUB_BOTS.find((bot) => bot.id === cleanText(id, 30)) || null;
}

function museBaseUrl() {
  return cleanText(process.env.MUSE_BASE_URL, 300).replace(/\/+$/, "");
}

function hubKey(id) {
  if (id === "muse") return process.env.MUSE_API_KEY || process.env.META_API_KEY || "";
  return providerKey(id);
}

function hubConfigured(id) {
  if (id === "muse") return Boolean(hubKey("muse") && museBaseUrl());
  return Boolean(hubKey(id));
}

// Override with e.g. MY_AIS_XAI_FAST_MODEL / MY_AIS_ANTHROPIC_DEEP_MODEL.
function hubModel(bot, deep) {
  const env = cleanText(process.env[`MY_AIS_${bot.id.toUpperCase()}_${deep ? "DEEP" : "FAST"}_MODEL`], 120);
  return env || (deep ? bot.deep : bot.fast);
}

// Keep a well-formed alternating history that starts with the user.
function normalizeHistory(raw) {
  const messages = [];
  for (const item of Array.isArray(raw) ? raw.slice(-MAX_HISTORY) : []) {
    const role = item?.role === "assistant" ? "assistant" : item?.role === "user" ? "user" : "";
    const content = cleanText(item?.content);
    if (!role || !content) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${content}`;
    else messages.push({ role, content });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  return messages;
}

function chatSystem(bot, web) {
  return [
    `You are ${bot.name}, chatting with your owner on their personal "My AIs" page.`,
    "Be helpful, accurate, and conversational. Match the length of your answer to the question: short questions get short answers.",
    "Say clearly when you are unsure.",
    web ? "Web search is on for this message; use it for anything current." : "",
  ].filter(Boolean).join(" ");
}

function roomSystem(bot, others) {
  return [
    `You are ${bot.name}, in a group chat with your owner and other AIs (${others.join(", ")}).`,
    "Respond to what was just said: agree, disagree, or add something new, and address the others by name when you do.",
    "Keep it to a short paragraph (under about 120 words). Do not repeat points already made.",
    "Never write lines for the other AIs or pretend to be them.",
  ].join(" ");
}

function anthropicText(data) {
  if (data?.stop_reason === "refusal") throw new Error("Claude declined to answer this one.");
  return (Array.isArray(data?.content) ? data.content : [])
    .filter((part) => part?.type === "text" && typeof part?.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

async function callBot(bot, { system, messages, deep, web, maxTokens }) {
  const model = hubModel(bot, deep);
  const timeoutMs = deep ? 240000 : 90000;

  if (bot.id === "openai" || bot.id === "xai") {
    const body = { model, instructions: system, input: messages, max_output_tokens: maxTokens };
    if (bot.id === "openai") body.reasoning = { effort: deep ? "high" : "low" };
    if (web) body.tools = [{ type: "web_search" }];
    const url = bot.id === "openai" ? "https://api.openai.com/v1/responses" : "https://api.x.ai/v1/responses";
    const data = await fetchJson(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${hubKey(bot.id)}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, timeoutMs);
    return { model, text: extractResponsesText(data) };
  }

  if (bot.id === "anthropic") {
    const body = {
      model,
      max_tokens: maxTokens,
      system,
      messages,
      output_config: { effort: deep ? "high" : "low" },
      // If Claude declines for safety reasons, the API retries on a fallback model in the same call.
      fallbacks: "default",
    };
    if (web) body.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }];
    const data = await fetchJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { ...anthropicHeaders(), "anthropic-beta": "server-side-fallback-2026-07-01" },
      body: JSON.stringify(body),
    }, timeoutMs);
    return { model, text: anthropicText(data) };
  }

  if (bot.id === "muse") {
    const data = await fetchJson(`${museBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hubKey("muse")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages], max_tokens: maxTokens }),
    }, timeoutMs);
    const content = data?.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map((part) => part?.text || "").join("") : String(content || "");
    return { model, text: text.trim() };
  }

  throw new Error("Unknown assistant");
}

function respondWithBot(res, bot, call) {
  const started = Date.now();
  return call()
    .then((result) => {
      if (!result.text) throw new Error("No text returned by provider");
      res.json({ ok: true, bot: bot.id, model: result.model, text: result.text, latencyMs: Date.now() - started });
    })
    .catch((error) => {
      console.error(`My AIs ${bot.name} request failed:`, error?.message || error);
      res.status(502).json({ ok: false, error: providerErrorMessage(error) });
    });
}

export function registerAiHubRoutes(app) {
  const json = express.json({ limit: "2mb" });
  const accessCode = cleanText(process.env.AI_COUNCIL_ACCESS_CODE, 200);

  app.get("/api/ai-council/hub/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      roomMaxTurns: ROOM_MAX_TURNS,
      bots: HUB_BOTS.map((bot) => ({
        id: bot.id,
        name: bot.name,
        maker: bot.maker,
        fastModel: hubModel(bot, false),
        deepModel: hubModel(bot, true),
        configured: hubConfigured(bot.id),
      })),
    });
  });

  // One-on-one chat with a single AI.
  app.post("/api/ai-council/hub/chat", json, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireCouncilAccess(req, res, accessCode)) return;

    const bot = findBot(req.body?.bot);
    if (!bot) return res.status(400).json({ ok: false, error: "Unknown assistant." });
    if (!hubConfigured(bot.id)) return res.status(400).json({ ok: false, error: `${bot.name} is not connected yet.` });

    const messages = normalizeHistory(req.body?.messages);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return res.status(400).json({ ok: false, error: "Type a message first." });
    }
    const deep = req.body?.deep === true;
    const web = req.body?.web === true;
    await respondWithBot(res, bot, () => callBot(bot, {
      system: chatSystem(bot, web),
      messages,
      deep,
      web,
      maxTokens: deep ? 16000 : 4000,
    }));
  });

  // One turn in a group chat. The page runs the turns one at a time so each reply shows up as it lands.
  app.post("/api/ai-council/hub/room-turn", json, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireCouncilAccess(req, res, accessCode)) return;

    const bot = findBot(req.body?.bot);
    if (!bot) return res.status(400).json({ ok: false, error: "Unknown assistant." });
    if (!hubConfigured(bot.id)) return res.status(400).json({ ok: false, error: `${bot.name} is not connected yet.` });

    const transcript = (Array.isArray(req.body?.transcript) ? req.body.transcript.slice(-30) : [])
      .map((line) => ({ speaker: cleanText(line?.speaker, 40) || "Someone", text: cleanText(line?.text, 6000) }))
      .filter((line) => line.text);
    if (!transcript.length) return res.status(400).json({ ok: false, error: "Type a message first." });

    const others = (Array.isArray(req.body?.members) ? req.body.members : [])
      .map((id) => findBot(id)?.name)
      .filter((name) => name && name !== bot.name);
    const prompt = [
      "Group chat so far:",
      transcript.map((line) => `${line.speaker}: ${line.text}`).join("\n\n"),
      `Now it's your turn, ${bot.name}.`,
    ].join("\n\n");
    const deep = req.body?.deep === true;
    await respondWithBot(res, bot, () => callBot(bot, {
      system: roomSystem(bot, others.length ? others : ["the others"]),
      messages: [{ role: "user", content: prompt }],
      deep,
      web: false,
      maxTokens: deep ? 8000 : 1200,
    }));
  });

  app.get(["/my-ais", "/my-ais/", "/ai-council/hub", "/ai-council/hub/"], (_req, res) => res.redirect(302, "/ai-council/"));
}
