import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  anthropicHeaders,
  extractResponsesText,
  fetchJson,
  providerErrorMessage,
  providerKey,
  providerModel,
  requireCouncilAccess,
} from "./aiCouncil.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public", "ai-council");

// The four assistants shown side by side on the "My AIs" page.
// Muse (Meta Muse Spark) speaks the OpenAI chat-completions format, so it only needs
// MUSE_API_KEY plus the MUSE_BASE_URL from the Meta Model API dashboard.
const HUB_BOTS = [
  { id: "xai", name: "Grok", maker: "xAI" },
  { id: "muse", name: "Muse", maker: "Meta" },
  { id: "anthropic", name: "Claude", maker: "Anthropic" },
  { id: "openai", name: "ChatGPT", maker: "OpenAI" },
];

const MAX_HISTORY = 40;

function cleanText(value, max = 12000) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function museBaseUrl() {
  return cleanText(process.env.MUSE_BASE_URL, 300).replace(/\/+$/, "");
}

function hubKey(id) {
  if (id === "muse") return process.env.MUSE_API_KEY || process.env.META_API_KEY || "";
  return providerKey(id);
}

function hubModel(id) {
  if (id === "muse") return cleanText(process.env.MUSE_MODEL, 120) || "muse-spark-1.1";
  return providerModel(id);
}

function hubConfigured(id) {
  if (id === "muse") return Boolean(hubKey("muse") && museBaseUrl());
  return Boolean(hubKey(id));
}

function hubSystem(name) {
  return [
    `You are ${name}, chatting with your owner on their personal "My AIs" page.`,
    "Be helpful, accurate, and conversational. Say clearly when you are unsure.",
  ].join(" ");
}

// Keep a well-formed alternating history that starts with the user and ends with the user.
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

async function chatCompletions(url, key, model, system, messages) {
  const data = await fetchJson(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages], max_tokens: 2000 }),
  });
  const content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) return content.map((part) => part?.text || "").join("").trim();
  return String(content || "").trim();
}

async function callHubBot(id, system, messages) {
  if (id === "openai") {
    const data = await fetchJson("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${hubKey("openai")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: hubModel("openai"), instructions: system, input: messages, max_output_tokens: 2000 }),
    });
    return extractResponsesText(data);
  }
  if (id === "anthropic") {
    const data = await fetchJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders(),
      body: JSON.stringify({ model: hubModel("anthropic"), max_tokens: 2000, system, messages }),
    });
    return (Array.isArray(data?.content) ? data.content : [])
      .filter((part) => part?.type === "text" && typeof part?.text === "string")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n");
  }
  if (id === "xai") return chatCompletions("https://api.x.ai/v1/chat/completions", hubKey("xai"), hubModel("xai"), system, messages);
  if (id === "muse") return chatCompletions(`${museBaseUrl()}/chat/completions`, hubKey("muse"), hubModel("muse"), system, messages);
  throw new Error("Unknown assistant");
}

export function registerAiHubRoutes(app) {
  const json = express.json({ limit: "2mb" });
  const accessCode = cleanText(process.env.AI_COUNCIL_ACCESS_CODE, 200);

  app.get("/api/ai-council/hub/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      bots: HUB_BOTS.map((bot) => ({ ...bot, model: hubModel(bot.id), configured: hubConfigured(bot.id) })),
    });
  });

  app.post("/api/ai-council/hub/chat", json, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireCouncilAccess(req, res, accessCode)) return;

    const bot = HUB_BOTS.find((item) => item.id === cleanText(req.body?.bot, 30));
    if (!bot) return res.status(400).json({ ok: false, error: "Unknown assistant." });
    if (!hubConfigured(bot.id)) return res.status(400).json({ ok: false, error: `${bot.name} is not connected yet.` });

    const messages = normalizeHistory(req.body?.messages);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return res.status(400).json({ ok: false, error: "Type a message first." });
    }

    const started = Date.now();
    try {
      const text = await callHubBot(bot.id, hubSystem(bot.name), messages);
      if (!text) throw new Error("No text returned by provider");
      return res.json({ ok: true, bot: bot.id, model: hubModel(bot.id), text, latencyMs: Date.now() - started });
    } catch (error) {
      console.error(`My AIs ${bot.name} request failed:`, error?.message || error);
      return res.status(502).json({ ok: false, error: providerErrorMessage(error) });
    }
  });

  // Short address; redirect so the page stays behind the private /ai-council login.
  app.get(["/my-ais", "/my-ais/"], (_req, res) => res.redirect(302, "/ai-council/hub/"));
  app.get(["/ai-council/hub", "/ai-council/hub/"], (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(publicDir, "hub.html"));
  });
}
