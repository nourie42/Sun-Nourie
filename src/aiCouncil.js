import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public", "ai-council");

const PROVIDERS = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-5.6-sol" },
  { id: "anthropic", label: "Claude", defaultModel: "claude-opus-5" },
  { id: "gemini", label: "Gemini", defaultModel: "gemini-3.1-pro-preview" },
  { id: "xai", label: "Grok", defaultModel: "grok-4.6" },
  { id: "perplexity", label: "Perplexity", defaultModel: "sonar-pro" },
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
  if (id === "perplexity") return process.env.PERPLEXITY_API_KEY || "";
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

async function fetchJson(url, init, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) {
      const message = cleanText(data?.error?.message || data?.message || "", 220);
      throw new Error(`${response.status}${message ? `: ${message}` : ""}`);
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

async function callXai(question, system, maxOutputTokens = 1800) {
  const data = await fetchJson("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerKey("xai")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: providerModel("xai"),
      input: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
      max_output_tokens: maxOutputTokens,
    }),
  });
  return { text: extractResponsesText(data), citations: [] };
}

async function callPerplexity(question, system, maxOutputTokens = 1800) {
  const data = await fetchJson("https://api.perplexity.ai/v1/sonar", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerKey("perplexity")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: providerModel("perplexity"),
      max_tokens: maxOutputTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
    }),
  });
  const text = cleanText(data?.choices?.[0]?.message?.content, 30000);
  const citations = Array.isArray(data?.citations)
    ? data.citations.filter((url) => typeof url === "string" && /^https?:\/\//i.test(url)).slice(0, 12)
    : [];
  return { text, citations };
}

async function callProvider(id, question, system, maxOutputTokens = 1800) {
  if (id === "openai") return callOpenAi(question, system, maxOutputTokens);
  if (id === "anthropic") return callAnthropic(question, system, maxOutputTokens);
  if (id === "gemini") return callGemini(question, system, maxOutputTokens);
  if (id === "xai") return callXai(question, system, maxOutputTokens);
  if (id === "perplexity") return callPerplexity(question, system, maxOutputTokens);
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

export function registerAiCouncilRoutes(app) {
  const json = express.json({ limit: "40kb" });
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
    });
  });

  app.post("/api/ai-council/ask", json, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    if (!accessCode) {
      return res.status(503).json({ ok: false, error: "AI Council is locked until AI_COUNCIL_ACCESS_CODE is configured on the server." });
    }
    if (cleanText(req.headers["x-ai-council-code"], 200) !== accessCode) {
      return res.status(401).json({ ok: false, error: "Incorrect AI Council access code." });
    }

    const limiter = rateLimit(req);
    res.setHeader("X-AI-Council-Remaining", String(limiter.remaining));
    if (!limiter.allowed) {
      return res.status(429).json({ ok: false, error: "AI Council hourly request limit reached. Try again later." });
    }

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
        if (!result.text) throw new Error("No text returned");
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
          error: `Provider request failed${error?.name === "AbortError" ? " (timeout)" : ""}`,
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
      verdict = { text: "The independent answers loaded, but the Council Verdict could not be generated for this request.", chair: null };
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

  app.get("/ai-council", (_req, res) => res.redirect(302, "/ai-council/"));
  app.use("/ai-council", express.static(publicDir, { index: "index.html", maxAge: 0, etag: true }));
}
