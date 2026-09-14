import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public", "ai-council");

const PROVIDERS = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-5.6" },
  { id: "anthropic", label: "Claude", defaultModel: "claude-opus-5" },
  { id: "gemini", label: "Gemini", defaultModel: "gemini-3.1-pro-preview" },
  { id: "xai", label: "Grok", defaultModel: "grok-4.6" },
];

const requestBuckets = new Map();

function cleanText(value, max = 6000) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function providerModel(id) {
  const envName = `AI_COUNCIL_${id.toUpperCase()}_MODEL`;
  return cleanText(process.env[envName], 120) || PROVIDERS.find((provider) => provider.id === id)?.defaultModel || "";
}

function providerKey(id) {
  if (id === "openai") return process.env.OPENAI_API_KEY || "";
  if (id === "anthropic") return process.env.ANTHROPIC_API_KEY || "";
  if (id === "gemini") return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
  if (id === "xai") return process.env.XAI_API_KEY || "";
  return "";
}

function clientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function rateLimit(req) {
  const limit = Math.max(2, Math.min(100, Number(process.env.AI_COUNCIL_RATE_LIMIT || 20)));
  const windowMs = 60 * 60 * 1000;
  const now = Date.now();
  const key = clientKey(req);
  const bucket = requestBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    requestBuckets.set(key, { startedAt: now, count: 1 });
    return { allowed: true, remaining: limit - 1 };
  }
  if (bucket.count >= limit) return { allowed: false, remaining: 0 };
  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count };
}

function requireCouncilAccess(req, res, accessCode) {
  if (!accessCode) {
    res.status(503).json({ ok: false, error: "AI Council is locked until AI_COUNCIL_ACCESS_CODE is configured on the server." });
    return false;
  }
  if (cleanText(req.headers["x-ai-council-code"], 200) !== accessCode) {
    res.status(401).json({ ok: false, error: "Incorrect AI Council access code." });
    return false;
  }
  const limiter = rateLimit(req);
  res.setHeader("X-AI-Council-Remaining", String(limiter.remaining));
  if (!limiter.allowed) {
    res.status(429).json({ ok: false, error: "AI Council hourly request limit reached. Try again later." });
    return false;
  }
  return true;
}

function providerErrorMessage(error) {
  if (error?.name === "AbortError") return "Provider request timed out";
  const raw = cleanText(error?.message || error || "Unknown provider error", 320);
  if (!raw) return "Provider request failed";
  return `Provider request failed — ${raw}`;
}

async function fetchJson(url, init, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) {
      const message = cleanText(
        data?.error?.message ||
        data?.error?.detail ||
        data?.error?.type ||
        data?.message ||
        text ||
        response.statusText ||
        "",
        260,
      );
      const code = cleanText(data?.error?.code || data?.code || "", 80);
      const suffix = [code, message].filter(Boolean).join(" — ");
      const error = new Error(`${response.status}${suffix ? `: ${suffix}` : ""}`);
      error.status = response.status;
      error.providerBody = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function extractResponsesText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === "string" && part.text.trim()) parts.push(part.text.trim());
    }
  }
  return parts.join("\n\n").trim();
}

async function callOpenAi(question, system, maxOutputTokens = 1800) {
  const data = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerKey("openai")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: providerModel("openai"),
      instructions: system,
      input: question,
      max_output_tokens: maxOutputTokens,
    }),
  });
  return { text: extractResponsesText(data), citations: [] };
}

async function callAnthropic(question, system, maxOutputTokens = 1800) {
  const data = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": providerKey("anthropic"),
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: providerModel("anthropic"),
      max_tokens: maxOutputTokens,
      system,
      messages: [{ role: "user", content: question }],
    }),
  });
  const text = (Array.isArray(data?.content) ? data.content : [])
    .filter((part) => part?.type === "text" && typeof part?.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return { text, citations: [] };
}

async function callGemini(question, system, maxOutputTokens = 1800) {
  const model = providerModel("gemini");
  const key = encodeURIComponent(providerKey("gemini"));
  const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: question }] }],
      generationConfig: { maxOutputTokens },
    }),
  });
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((part) => typeof part?.text === "string" ? part.text.trim() : "").filter(Boolean).join("\n\n");
  return { text, citations: [] };
}

async function callXai(question, system) {
  const input = [
    system ? `System instructions:\n${system}` : "",
    `User question:\n${question}`,
  ].filter(Boolean).join("\n\n");
  const data = await fetchJson("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerKey("xai")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: providerModel("xai"),
      input,
    }),
  });
  return { text: extractResponsesText(data), citations: [] };
}

async function callProvider(id, question, system, maxOutputTokens = 1800) {
  if (id === "openai") return callOpenAi(question, system, maxOutputTokens);
  if (id === "anthropic") return callAnthropic(question, system, maxOutputTokens);
  if (id === "gemini") return callGemini(question, system, maxOutputTokens);
  if (id === "xai") return callXai(question, system, maxOutputTokens);
  throw new Error("Unknown provider");
}

function publicProviders() {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    model: providerModel(provider.id),
    configured: Boolean(providerKey(provider.id)),
  }));
}

async function buildVerdict(question, answers) {
  if (answers.length < 2) {
    return {
      text: "A Council Verdict needs at least two successful model responses. Configure another provider and ask again.",
      chair: null,
    };
  }

  const chairOrder = ["openai", "anthropic", "gemini", "xai"].filter((id) => providerKey(id));
  const chair = chairOrder[0];
  if (!chair) {
    return {
      text: "The independent answers are available, but no synthesis model is configured to create a Council Verdict.",
      chair: null,
    };
  }

  const transcript = answers.map((answer) => `### ${answer.label} (${answer.model})\n${answer.text}`).join("\n\n");
  const system = [
    "You are the neutral chair of an AI Council.",
    "Compare independent model answers to the same user question.",
    "Do not assume majority agreement proves correctness.",
    "Do not introduce new factual claims that are absent from the submitted answers.",
    "Call out important disagreements, uncertainty, and claims that need verification.",
    "Be concise but useful.",
    "Use exactly these headings: Council Verdict, Where They Agree, Important Disagreements, Best-Supported Takeaways, Confidence.",
  ].join(" ");
  const prompt = `Original question:\n${question}\n\nIndependent answers:\n${transcript}`;
  const result = await callProvider(chair, prompt, system, 1400);
  return { text: result.text || "Council synthesis returned no text.", chair };
}

function normalizeBot(raw, index) {
  const id = cleanText(raw?.id, 80) || `bot-${index + 1}`;
  const name = cleanText(raw?.name, 60) || `Bot ${index + 1}`;
  const role = cleanText(raw?.role, 180) || "General expert";
  const instructions = cleanText(raw?.instructions, 3500) || "Give useful, accurate answers and engage constructively with the other bots.";
  const provider = cleanText(raw?.provider, 30).toLowerCase();
  if (!PROVIDERS.some((item) => item.id === provider)) return null;
  return { id, name, role, instructions, provider };
}

function roomModeInstruction(mode) {
  if (mode === "debate") {
    return "This is a debate. Challenge weak assumptions, identify evidence gaps, directly address other bots' claims, and change your view when another bot makes a stronger case.";
  }
  if (mode === "collaborate") {
    return "This is a collaboration. Build on useful ideas from other bots, resolve disagreements, divide the problem into parts when helpful, and work toward a stronger shared solution.";
  }
  return "This is a roundtable. Add a distinct useful perspective, respond to important points raised by other bots, and avoid repeating what has already been said.";
}

function transcriptForPrompt(turns, maxChars = 22000) {
  const text = turns.map((turn) => `${turn.name}: ${turn.text}`).join("\n\n");
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

async function summarizeBotRoom(topic, mode, turns) {
  const chairOrder = ["openai", "anthropic", "gemini", "xai"].filter((id) => providerKey(id));
  const chair = chairOrder[0];
  if (!chair || turns.length < 2) return { text: "", chair: null };

  const system = [
    "You are the moderator of a multi-bot discussion.",
    "Summarize the strongest conclusions from the transcript without pretending consensus exists when it does not.",
    "Separate agreement from unresolved disagreement and call out anything that still needs verification.",
    "Do not invent claims that were not present in the room.",
    "Use the headings: Room Conclusion, Strongest Points, Remaining Disagreements, What To Do Next.",
  ].join(" ");
  const prompt = `Topic:\n${topic}\n\nRoom mode: ${mode}\n\nTranscript:\n${transcriptForPrompt(turns, 28000)}`;
  const result = await callProvider(chair, prompt, system, 1200);
  return { text: result.text || "", chair };
}

export function registerAiCouncilRoutes(app) {
  const json = express.json({ limit: "80kb" });
  const accessCode = cleanText(process.env.AI_COUNCIL_ACCESS_CODE, 200);

  app.get("/api/ai-council/status", (_req, res) => {
    const providers = publicProviders();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      enabled: Boolean(accessCode),
      accessRequired: true,
      providers,
      configuredCount: providers.filter((provider) => provider.configured).length,
      botStudio: true,
    });
  });

  app.post("/api/ai-council/ask", json, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireCouncilAccess(req, res, accessCode)) return;

    const question = cleanText(req.body?.question, 6000);
    if (question.length < 2) return res.status(400).json({ ok: false, error: "Enter a question first." });

    const requested = Array.isArray(req.body?.providers) ? req.body.providers.map((id) => cleanText(id, 30)) : [];
    const selectedIds = PROVIDERS.map((provider) => provider.id).filter((id) => !requested.length || requested.includes(id));
    if (!selectedIds.length) return res.status(400).json({ ok: false, error: "Select at least one AI provider." });

    const system = [
      "Answer the user's question independently as a knowledgeable AI assistant.",
      "Prioritize factual accuracy and clearly distinguish uncertainty from fact.",
      "Do not mention the AI Council or speculate about what other models might say.",
      "Keep the answer readable and reasonably concise while including the reasoning or evidence needed to support the conclusion.",
    ].join(" ");

    const startedAt = Date.now();
    const results = await Promise.all(selectedIds.map(async (id) => {
      const provider = PROVIDERS.find((item) => item.id === id);
      const model = providerModel(id);
      if (!providerKey(id)) {
        return { id, label: provider.label, model, ok: false, error: "Not configured", latencyMs: 0, citations: [] };
      }
      const started = Date.now();
      try {
        const result = await callProvider(id, question, system);
        if (!result.text) throw new Error("No text returned by provider");
        return {
          id,
          label: provider.label,
          model,
          ok: true,
          text: result.text,
          citations: result.citations || [],
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        console.error(`AI Council ${id} request failed:`, error?.message || error);
        return {
          id,
          label: provider.label,
          model,
          ok: false,
          error: providerErrorMessage(error),
          latencyMs: Date.now() - started,
          citations: [],
        };
      }
    }));

    const successful = results.filter((result) => result.ok);
    let verdict = { text: "", chair: null };
    try {
      verdict = await buildVerdict(question, successful);
    } catch (error) {
      console.error("AI Council synthesis failed:", error?.message || error);
      verdict = { text: `The independent answers loaded, but the Council Verdict could not be generated. ${providerErrorMessage(error)}`, chair: null };
    }

    return res.json({
      ok: successful.length > 0,
      question,
      answers: results,
      verdict,
      successfulCount: successful.length,
      totalLatencyMs: Date.now() - startedAt,
    });
  });

  app.post("/api/ai-council/bots/run", json, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireCouncilAccess(req, res, accessCode)) return;

    const topic = cleanText(req.body?.topic, 6000);
    if (topic.length < 2) return res.status(400).json({ ok: false, error: "Enter a room topic first." });

    const rawBots = Array.isArray(req.body?.bots) ? req.body.bots.slice(0, 6) : [];
    const bots = rawBots.map(normalizeBot).filter(Boolean);
    if (bots.length < 2) return res.status(400).json({ ok: false, error: "Choose at least two valid bots for the room." });

    const unavailable = bots.filter((bot) => !providerKey(bot.provider));
    if (unavailable.length) {
      return res.status(400).json({
        ok: false,
        error: `These bots use providers that are not configured: ${unavailable.map((bot) => bot.name).join(", ")}.`,
      });
    }

    const mode = ["roundtable", "debate", "collaborate"].includes(req.body?.mode) ? req.body.mode : "roundtable";
    const rounds = Math.max(1, Math.min(3, Number(req.body?.rounds || 2)));
    const includeSummary = req.body?.includeSummary !== false;
    const maxTurns = Math.max(4, Math.min(18, Number(process.env.AI_COUNCIL_BOT_MAX_TURNS || 12)));
    const requestedTurns = bots.length * rounds;
    if (requestedTurns > maxTurns) {
      return res.status(400).json({
        ok: false,
        error: `This room would use ${requestedTurns} AI turns. The server limit is ${maxTurns}. Use fewer bots or fewer rounds.`,
      });
    }

    const roomInstruction = roomModeInstruction(mode);
    const turns = [];
    const startedAt = Date.now();

    for (let round = 1; round <= rounds; round += 1) {
      for (const bot of bots) {
        const transcript = transcriptForPrompt(turns);
        const system = [
          `You are ${bot.name}, a reusable custom bot participating in a multi-bot room.`,
          `Your role: ${bot.role}.`,
          `Your custom instructions: ${bot.instructions}`,
          roomInstruction,
          "Stay in your assigned role while remaining factual and useful.",
          "You may address other bots by name and explicitly agree, disagree, refine, or build on their points.",
          "Do not impersonate other bots, fabricate statements they did not make, or claim private communication with them.",
          "Avoid repeating the transcript. Focus on the most valuable next contribution.",
        ].join(" ");
        const prompt = [
          `Room topic:\n${topic}`,
          `Round ${round} of ${rounds}.`,
          transcript ? `Conversation so far:\n${transcript}` : "You are opening the discussion; no bot has spoken yet.",
          `It is now ${bot.name}'s turn. Respond to the room in your own voice.`,
        ].join("\n\n");

        const turnStarted = Date.now();
        try {
          const result = await callProvider(bot.provider, prompt, system, 900);
          const text = cleanText(result.text, 16000);
          if (!text) throw new Error("No text returned by provider");
          turns.push({
            round,
            botId: bot.id,
            name: bot.name,
            role: bot.role,
            provider: bot.provider,
            providerLabel: PROVIDERS.find((item) => item.id === bot.provider)?.label || bot.provider,
            model: providerModel(bot.provider),
            text,
            citations: result.citations || [],
            latencyMs: Date.now() - turnStarted,
            ok: true,
          });
        } catch (error) {
          console.error(`AI Council bot ${bot.name} failed:`, error?.message || error);
          turns.push({
            round,
            botId: bot.id,
            name: bot.name,
            role: bot.role,
            provider: bot.provider,
            providerLabel: PROVIDERS.find((item) => item.id === bot.provider)?.label || bot.provider,
            model: providerModel(bot.provider),
            text: "",
            citations: [],
            latencyMs: Date.now() - turnStarted,
            ok: false,
            error: providerErrorMessage(error),
          });
        }
      }
    }

    let summary = { text: "", chair: null };
    if (includeSummary) {
      try {
        summary = await summarizeBotRoom(topic, mode, turns.filter((turn) => turn.ok));
      } catch (error) {
        console.error("AI Council bot-room summary failed:", error?.message || error);
        summary = { text: `The bots finished talking, but the moderator summary could not be generated. ${providerErrorMessage(error)}`, chair: null };
      }
    }

    const successfulTurns = turns.filter((turn) => turn.ok).length;
    return res.json({
      ok: successfulTurns > 0,
      topic,
      mode,
      rounds,
      bots: bots.map((bot) => ({ ...bot, model: providerModel(bot.provider) })),
      turns,
      summary,
      successfulTurns,
      totalTurns: turns.length,
      totalLatencyMs: Date.now() - startedAt,
    });
  });

  app.get(["/ai-council", "/ai-council/"], (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(publicDir, "index.html"));
  });
  app.get(["/ai-council/bots", "/ai-council/bots/"], (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(publicDir, "bots.html"));
  });
  app.use("/ai-council", express.static(publicDir, { index: false, redirect: false, maxAge: 0, etag: true }));
}
