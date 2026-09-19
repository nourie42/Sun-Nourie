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
const providerHealthCache = new Map();
const PROVIDER_HEALTH_TTL_MS = 10 * 60 * 1000;

function providerHealthFailure(error) {
  const raw = cleanText(error?.message || error, 500);
  const q = raw.toLowerCase();
  const detail = raw.replace(/(sk|xai)-[a-z0-9_-]+/gi, "[redacted]").slice(0, 180);
  if (/insufficient[_\s-]*quota|credit balance|no credits|credits? (?:remaining|available)|billing|payment required|spend limit|quota exceeded|resource_exhausted|budget (?:is )?exceeded/.test(q)) {
    return { status: "no_credits", label: "No credits / billing issue", reason: "This model cannot be used until credits or billing are restored." };
  }
  if (/rate limit|too many requests|\b429\b/.test(q)) {
    return { status: "busy", label: "Temporarily busy", reason: `The provider is rate-limited right now. ${detail}`.trim() };
  }
  if (/overloaded|overloaded_error|service unavailable|temporar(?:ily)? unavailable|\b500\b|\b502\b|\b503\b|\b504\b|\b529\b|aborterror|aborted|timed out|timeout/.test(q)) {
    return { status: "busy", label: "Temporarily unavailable", reason: `The provider had a temporary server or timeout error. ${detail}`.trim() };
  }
  if (/not scoped to a workspace|anthropic-workspace-id|workspace id header|workspace.*header/.test(q)) {
    return {
      status: "workspace_required",
      label: "Workspace ID required",
      reason: "The Anthropic API key is valid but is not scoped to a workspace. Add ANTHROPIC_WORKSPACE_ID in Render (for example, wrkspc_...) or replace the key with a workspace-scoped API key.",
    };
  }
  if (/model.{0,40}(?:not found|does not exist|unavailable)|invalid.{0,20}model|unsupported.{0,20}model|\b404\b/.test(q)) {
    return { status: "model_error", label: "Model unavailable", reason: `The configured model is unavailable. ${detail}`.trim() };
  }
  if (/invalid api key|authentication|unauthorized|forbidden|permission|\b401\b|\b403\b/.test(q)) {
    return { status: "auth_error", label: "Connection needs attention", reason: `The provider key or account permission needs attention. ${detail}`.trim() };
  }
  return { status: "error", label: "Unavailable", reason: `The provider check failed. ${detail}`.trim() };
}

function cachedProviderHealth(id) {
  const item = providerHealthCache.get(id);
  if (!item) return null;
  if (Date.now() - item.checkedAt > PROVIDER_HEALTH_TTL_MS) {
    providerHealthCache.delete(id);
    return null;
  }
  return item;
}

function publicProviderHealth(id) {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) return { id, status: "unknown", label: "Unknown model", reason: "Unknown AI provider.", checkedAt: 0 };
  if (!providerKey(id)) {
    return { id, status: "not_connected", label: "Not connected", reason: "No API key is configured for this provider.", checkedAt: 0 };
  }
  const cached = cachedProviderHealth(id);
  if (!cached) {
    return { id, status: "unchecked", label: "Credits not checked", reason: "Availability will be checked before this model is used.", checkedAt: 0 };
  }
  return { id, status: cached.status, label: cached.label, reason: cached.reason, checkedAt: cached.checkedAt };
}

function providerAllowedByHealth(id) {
  if (!providerKey(id)) return false;
  const cached = cachedProviderHealth(id);
  return !cached || cached.status === "ready";
}

function cleanText(value, max = 12000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function providerModel(id) {
  const envName = `AI_COUNCIL_${String(id).toUpperCase()}_MODEL`;
  return cleanText(process.env[envName], 120) || PROVIDERS.find((p) => p.id === id)?.defaultModel || "";
}

function providerKey(id) {
  if (id === "openai") return process.env.OPENAI_API_KEY || "";
  if (id === "anthropic") return process.env.ANTHROPIC_API_KEY || "";
  if (id === "gemini") return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
  if (id === "xai") return process.env.XAI_API_KEY || "";
  return "";
}

function anthropicWorkspaceId() {
  return cleanText(process.env.ANTHROPIC_WORKSPACE_ID, 200);
}

function anthropicHeaders() {
  const headers = {
    "x-api-key": providerKey("anthropic"),
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  const workspaceId = anthropicWorkspaceId();
  if (workspaceId) headers["anthropic-workspace-id"] = workspaceId;
  return headers;
}

function publicProviders() {
  return PROVIDERS.map((p) => {
    const health = publicProviderHealth(p.id);
    return {
      id: p.id,
      label: p.label,
      model: providerModel(p.id),
      configured: Boolean(providerKey(p.id)),
      workspaceConfigured: p.id === "anthropic" ? Boolean(anthropicWorkspaceId()) : undefined,
      healthStatus: health.status,
      healthLabel: health.label,
      healthReason: health.reason,
      healthCheckedAt: health.checkedAt,
    };
  });
}

function clientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function allowRequest(req) {
  const limit = Math.max(10, Math.min(500, Number(process.env.AI_AGENT_RATE_LIMIT || 120)));
  const now = Date.now();
  const key = clientKey(req);
  const bucket = requestBuckets.get(key);
  if (!bucket || now - bucket.startedAt > 60 * 60 * 1000) {
    requestBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function requireAccess(req, res, accessCode) {
  if (!accessCode) {
    res.status(503).json({ ok: false, error: "AI access is not configured on the server." });
    return false;
  }
  if (cleanText(req.headers["x-ai-council-code"], 200) !== accessCode) {
    res.status(401).json({ ok: false, error: "That access code is not correct." });
    return false;
  }
  if (!allowRequest(req)) {
    res.status(429).json({ ok: false, error: "Too many AI requests right now. Try again in a little while." });
    return false;
  }
  return true;
}

async function fetchJson(url, init, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) {
      const detail = cleanText(data?.error?.message || data?.error?.detail || data?.message || text || response.statusText, 320);
      throw new Error(`${response.status}${detail ? `: ${detail}` : ""}`);
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

function extractOpenAiCitations(data) {
  const urls = [];
  const add = (url) => {
    const value = cleanText(url, 1200);
    if (/^https?:\/\//i.test(value) && !urls.includes(value)) urls.push(value);
  };
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      for (const annotation of Array.isArray(part?.annotations) ? part.annotations : []) {
        add(annotation?.url);
        add(annotation?.url_citation?.url);
      }
    }
  }
  return urls.slice(0, 12);
}

function extractAnthropicCitations(data) {
  const urls = [];
  const add = (url) => {
    const value = cleanText(url, 1200);
    if (/^https?:\/\//i.test(value) && !urls.includes(value)) urls.push(value);
  };
  for (const part of Array.isArray(data?.content) ? data.content : []) {
    for (const citation of Array.isArray(part?.citations) ? part.citations : []) {
      add(citation?.url);
      add(citation?.source?.url);
    }
    for (const result of Array.isArray(part?.content) ? part.content : []) add(result?.url);
  }
  return urls.slice(0, 12);
}

function extractGeminiCitations(data) {
  const urls = [];
  const add = (url) => {
    const value = cleanText(url, 1200);
    if (/^https?:\/\//i.test(value) && !urls.includes(value)) urls.push(value);
  };
  const metadata = data?.candidates?.[0]?.groundingMetadata || data?.candidates?.[0]?.grounding_metadata || {};
  for (const chunk of Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : Array.isArray(metadata?.grounding_chunks) ? metadata.grounding_chunks : []) {
    add(chunk?.web?.uri);
    add(chunk?.web?.url);
  }
  return urls.slice(0, 12);
}

function responsesUsedWeb(data) {
  return (Array.isArray(data?.output) ? data.output : []).some((item) =>
    item?.type === "web_search_call" || item?.type === "web_search"
  );
}

function anthropicUsedWeb(data) {
  return (Array.isArray(data?.content) ? data.content : []).some((part) =>
    part?.type === "server_tool_use" && part?.name === "web_search" ||
    part?.type === "web_search_tool_result"
  );
}

async function callOpenAi(question, system, maxOutputTokens = 2200, timeoutMs = 90000, useWebSearch = false) {
  const body = { model: providerModel("openai"), instructions: system, input: question, max_output_tokens: maxOutputTokens };
  if (useWebSearch) body.tools = [{ type: "web_search" }];
  const data = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${providerKey("openai")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs);
  return {
    text: extractResponsesText(data),
    citations: extractOpenAiCitations(data),
    webSearchUsed: useWebSearch && responsesUsedWeb(data),
  };
}

async function callAnthropic(question, system, maxOutputTokens = 2200, timeoutMs = 90000, useWebSearch = false) {
  const body = {
    model: providerModel("anthropic"),
    max_tokens: maxOutputTokens,
    system,
    messages: [{ role: "user", content: question }],
  };
  if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }];
  const data = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: anthropicHeaders(),
    body: JSON.stringify(body),
  }, timeoutMs);
  const text = (Array.isArray(data?.content) ? data.content : [])
    .filter((p) => p?.type === "text")
    .map((p) => cleanText(p.text, 30000))
    .filter(Boolean)
    .join("\n\n");
  return {
    text,
    citations: extractAnthropicCitations(data),
    webSearchUsed: useWebSearch && anthropicUsedWeb(data),
  };
}

async function callGemini(question, system, maxOutputTokens = 2200, timeoutMs = 90000, useWebSearch = false) {
  const model = providerModel("gemini");
  const key = encodeURIComponent(providerKey("gemini"));
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: question }] }],
    generationConfig: { maxOutputTokens },
  };
  if (useWebSearch) body.tools = [{ google_search: {} }];
  const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs);
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => cleanText(p?.text, 30000)).filter(Boolean).join("\n\n");
  const grounding = data?.candidates?.[0]?.groundingMetadata || data?.candidates?.[0]?.grounding_metadata;
  return {
    text,
    citations: extractGeminiCitations(data),
    webSearchUsed: useWebSearch && Boolean(grounding),
  };
}

async function callXai(question, system, _maxOutputTokens = 2200, timeoutMs = 90000, useWebSearch = false) {
  const input = [system ? `System instructions:\n${system}` : "", `User request:\n${question}`].filter(Boolean).join("\n\n");
  const body = { model: providerModel("xai"), input };
  if (useWebSearch) body.tools = [{ type: "web_search" }];
  const data = await fetchJson("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${providerKey("xai")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, timeoutMs);
  return {
    text: extractResponsesText(data),
    citations: extractOpenAiCitations(data),
    webSearchUsed: useWebSearch && responsesUsedWeb(data),
  };
}

async function callProvider(id, question, system, maxOutputTokens = 2200, timeoutMs = 90000, useWebSearch = false) {
  if (id === "openai") return callOpenAi(question, system, maxOutputTokens, timeoutMs, useWebSearch);
  if (id === "anthropic") return callAnthropic(question, system, maxOutputTokens, timeoutMs, useWebSearch);
  if (id === "gemini") return callGemini(question, system, maxOutputTokens, timeoutMs, useWebSearch);
  if (id === "xai") return callXai(question, system, maxOutputTokens, timeoutMs, useWebSearch);
  throw new Error("Unknown AI provider.");
}

async function probeProvider(id, { force = false } = {}) {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider || !providerKey(id)) return publicProviderHealth(id);
  const cached = force ? null : cachedProviderHealth(id);
  if (cached) return publicProviderHealth(id);

  const timeoutMs = id === "anthropic" ? 45000 : 30000;
  let lastClassified = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await callProvider(
        id,
        "Reply only with OK.",
        "This is a small availability check. Reply only with OK.",
        32,
        timeoutMs,
        false,
      );
      if (!cleanText(result?.text, 80)) throw new Error("Provider returned no text during availability check");
      providerHealthCache.set(id, {
        status: "ready",
        label: "Ready",
        reason: "API key, model access, and text generation are working.",
        checkedAt: Date.now(),
      });
      return publicProviderHealth(id);
    } catch (error) {
      lastError = error;
      lastClassified = providerHealthFailure(error);
      console.warn(`AI provider health check failed for ${id} (attempt ${attempt}):`, cleanText(error?.message || error, 500));
      const retryable = lastClassified.status === "busy" || lastClassified.status === "error";
      if (!retryable || attempt >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }

  providerHealthCache.set(id, {
    ...(lastClassified || providerHealthFailure(lastError)),
    checkedAt: Date.now(),
  });
  return publicProviderHealth(id);
}

async function webSearch(query) {
  if (!providerKey("openai")) throw new Error("Internet search needs OPENAI_API_KEY.");
  const data = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${providerKey("openai")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: providerModel("openai"),
      input: `Search the current web for accurate information that will help answer this request. Prefer reliable primary sources. Request: ${cleanText(query, 5000)}`,
      tools: [{ type: "web_search" }],
      max_output_tokens: 1400,
    }),
  });
  return { text: extractResponsesText(data), citations: extractOpenAiCitations(data) };
}

function shouldSearchWeb(text) {
  const q = cleanText(text, 5000).toLowerCase();
  return /\b(latest|today|tonight|current|currently|recent|news|online|internet|search|look up|lookup|find me|in stock|price|prices|buy|shopping|review|reviews|weather|score|schedule|release|available|availability|near me|nearby|website|link)\b/.test(q) || /https?:\/\//.test(q);
}

function chooseBestProvider(question) {
  const available = new Set(PROVIDERS.filter((p) => providerAllowedByHealth(p.id)).map((p) => p.id));
  const q = cleanText(question, 5000).toLowerCase();
  const choose = (id, reason) => available.has(id) ? { id, reason } : null;
  if (/\b(x|twitter|tweet|trending|social media|grok)\b/.test(q)) return choose("xai", "Grok is a strong fit for this kind of social/current-web question") || choose("openai", "OpenAI is the best available general option");
  if (/\b(write|rewrite|essay|letter|email|tone|story|creative|summarize|document)\b/.test(q)) return choose("anthropic", "Claude is a strong fit for writing and long-form language work") || choose("openai", "OpenAI is the best available general option");
  if (/\b(google|youtube|android|gemini|sheets|docs|maps)\b/.test(q)) return choose("gemini", "Gemini is a strong fit for Google-centered questions") || choose("openai", "OpenAI is the best available general option");
  if (/\b(code|coding|program|debug|math|science|analy|research|plan|compare|decision)\b/.test(q)) return choose("openai", "OpenAI is a strong fit for reasoning, coding, and analysis") || choose("anthropic", "Claude is the best available reasoning option");
  return choose("openai", "OpenAI is the default best fit for a general question") || choose("anthropic", "Claude is the best available general option") || choose("gemini", "Gemini is the best available general option") || choose("xai", "Grok is the best available general option") || { id: "", reason: "No AI provider is connected" };
}

function normalizeHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-14).map((m) => ({
    role: m?.role === "assistant" || m?.role === "ai" || m?.role === "bot" ? "Assistant" : "User",
    text: cleanText(m?.text, 6000),
  })).filter((m) => m.text);
}

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

function personaSystem(persona, providerLabel) {
  const name = cleanText(persona?.name, 60);
  const role = cleanText(persona?.role, 240);
  const instructions = cleanText(persona?.instructions, 5000);
  return [
    name ? `You are ${name}, a custom AI bot.` : `You are ${providerLabel}, a helpful AI assistant.`,
    role ? `Your role is: ${role}.` : "",
    instructions ? `Custom instructions: ${instructions}` : "",
    "Answer the user directly in clear language.",
    "Never claim you used an external tool unless tool results were actually supplied to you.",
    "When current web research is supplied, use it carefully and do not invent details beyond it.",
  ].filter(Boolean).join(" ");
}

function normalizeBot(raw, index) {
  const provider = cleanText(raw?.provider, 30).toLowerCase();
  if (!PROVIDERS.some((p) => p.id === provider)) return null;
  return {
    id: cleanText(raw?.id, 80) || `bot-${index}`,
    name: cleanText(raw?.name, 60) || `Bot ${index + 1}`,
    role: cleanText(raw?.role, 240) || "General helper",
    instructions: cleanText(raw?.instructions, 5000) || "Be accurate, useful, and easy to understand.",
    provider,
    tools: {
      webSearch: Boolean(raw?.tools?.webSearch),
      gmail: Boolean(raw?.tools?.gmail),
      browser: Boolean(raw?.tools?.browser),
      shopping: Boolean(raw?.tools?.shopping),
    },
  };
}

export function registerAiAgentRoutes(app) {
  const json = express.json({ limit: "20mb" });
  const accessCode = cleanText(process.env.AI_COUNCIL_ACCESS_CODE, 200);
  const hotRoomJobs = new Map();
  const HOT_ROOM_JOB_TTL_MS = 30 * 60 * 1000;
  const hotRoomJobId = () => `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const pruneHotRoomJobs = () => {
    const cutoff = Date.now() - HOT_ROOM_JOB_TTL_MS;
    for (const [id, job] of hotRoomJobs) if ((job.updatedAt || job.createdAt) < cutoff) hotRoomJobs.delete(id);
  };

  app.post("/api/ai-agent/location", express.json({ limit: "8kb" }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const location = await reverseGeocode(req.body || {});
    const headerCountry = cleanText(req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || req.headers["x-country-code"], 20);
    if (!location.country && headerCountry) location.country = headerCountry;
    res.json({ ok: true, location });
  });

  app.get("/api/ai-agent/status", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const configuredIds = PROVIDERS.filter((p) => providerKey(p.id)).map((p) => p.id);
    await Promise.all(configuredIds.map((id) => probeProvider(id)));
    const providers = publicProviders();
    res.json({
      ok: true,
      enabled: Boolean(accessCode),
      providers,
      configuredCount: providers.filter((p) => p.configured).length,
      readyCount: providers.filter((p) => p.healthStatus === "ready").length,
      checkedCount: providers.filter((p) => p.healthStatus !== "unchecked").length,
      autoChecked: true,
      tools: {
        webSearch: PROVIDERS.some((p) => Boolean(providerKey(p.id))),
        nativeWebSearch: Object.fromEntries(PROVIDERS.map((p) => [p.id, Boolean(providerKey(p.id))])),
        attachments: Boolean(providerKey("openai")),
        location: true,
        gmail: false,
        browser: false,
        shopping: false,
      },
    });
  });

  app.post("/api/ai-agent/provider-health", express.json({ limit: "8kb" }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireAccess(req, res, accessCode)) return;
    const requested = Array.isArray(req.body?.providers)
      ? req.body.providers.map((id) => cleanText(id, 30).toLowerCase()).filter(Boolean)
      : [];
    const ids = PROVIDERS.map((p) => p.id).filter((id) => !requested.length || requested.includes(id));
    if (!ids.length) return res.status(400).json({ ok: false, error: "Choose at least one valid AI model." });
    const force = req.body?.force === true;
    const health = await Promise.all(ids.map((id) => probeProvider(id, { force })));
    return res.json({
      ok: true,
      providers: publicProviders(),
      checked: health,
      readyCount: health.filter((item) => item.status === "ready").length,
    });
  });

  app.post("/api/ai-agent/attachment/prepare", json, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireAccess(req, res, accessCode)) return;
    const attachment = req.body?.attachment;
    if (!attachment) return res.status(400).json({ ok: false, error: "Choose a file first." });
    try {
      const prepared = await prepareAiContext({ question: "", attachments: [attachment], location: {}, webSearch: "off" });
      if (!prepared.attachmentText) {
        return res.status(422).json({ ok: false, error: prepared.attachmentError || "That file could not be read." });
      }
      return res.json({ ok: true, attachmentText: prepared.attachmentText, attachments: prepared.attachments });
    } catch (error) {
      console.error("AI attachment preparation failed:", error?.message || error);
      return res.status(502).json({ ok: false, error: `Could not read the attachment. ${cleanText(error?.message || error, 320)}` });
    }
  });

  app.post("/api/ai-agent/chat", json, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireAccess(req, res, accessCode)) return;

    const question = cleanText(req.body?.question, 6000);
    const rawAttachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    if (question.length < 1 && rawAttachments.length < 1) return res.status(400).json({ ok: false, error: "Type a message or attach a file first." });

    const pickText = question || rawAttachments.map((item) => cleanText(item?.name, 120)).filter(Boolean).join(" ") || "attachment help";
    const requested = cleanText(req.body?.provider, 30).toLowerCase() || "best";
    if (requested !== "best" && !PROVIDERS.some((p) => p.id === requested)) {
      return res.status(400).json({ ok: false, error: "Choose a valid AI model first." });
    }

    const idsToCheck = requested === "best"
      ? PROVIDERS.filter((p) => providerKey(p.id)).map((p) => p.id)
      : [requested];
    const checkedHealth = await Promise.all(idsToCheck.map((id) => probeProvider(id)));
    if (requested !== "best") {
      const selectedHealth = checkedHealth[0];
      if (selectedHealth?.status !== "ready") {
        const status = selectedHealth?.status === "no_credits" ? 402 : 503;
        return res.status(status).json({
          ok: false,
          error: `${PROVIDERS.find((p) => p.id === requested)?.label || "That AI"} cannot be used right now: ${selectedHealth?.label || "Unavailable"}. ${selectedHealth?.reason || ""}`.trim(),
          providerHealth: selectedHealth,
        });
      }
    }

    const best = chooseBestProvider(pickText);
    const providerId = requested === "best" ? best.id : requested;
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) {
      const noCredits = checkedHealth.filter((item) => item.status === "no_credits").map((item) => PROVIDERS.find((p) => p.id === item.id)?.label).filter(Boolean);
      const extra = noCredits.length ? ` No credits are available for: ${noCredits.join(", ")}.` : "";
      return res.status(noCredits.length ? 402 : 503).json({ ok: false, error: `No usable AI model is available right now.${extra}` });
    }
    if (!providerKey(providerId)) return res.status(400).json({ ok: false, error: `${provider.label} is not connected yet.` });

    const internetEnabled = req.body?.webSearch !== false && req.body?.webSearch !== "off";
    const prepared = await prepareAiContext({
      question,
      attachments: rawAttachments,
      location: req.body?.location,
      webSearch: "off",
    });
    const history = normalizeHistory(req.body?.history);
    const transcript = history.map((m) => `${m.role}: ${m.text}`).join("\n\n");
    const system = [
      personaSystem(req.body?.persona, provider.label),
      prepared.locationText ? `Use this user context when relevant: ${prepared.locationText}.` : "",
      internetEnabled ? "You have live internet access through a server-side web search tool on this request. For current or time-sensitive information, use it. Never claim you lack internet access when this tool is available." : "",
    ].filter(Boolean).join(" ");
    const prompt = [
      transcript ? `Conversation so far:\n${transcript}` : "",
      `User's new message:\n${question || "Please help with the attached file(s)."}`,
      prepared.locationText ? `User location context:\n${prepared.locationText}` : "",
      prepared.attachmentText ? `Attached file context:\n${prepared.attachmentText}` : "",
    ].filter(Boolean).join("\n\n");

    const candidates = requested === "best"
      ? [providerId, ...PROVIDERS.map((p) => p.id).filter((id) => id !== providerId && providerAllowedByHealth(id))]
      : [providerId];
    let lastError = null;
    for (const id of candidates) {
      try {
        const current = PROVIDERS.find((p) => p.id === id);
        const providerSystem = [
          personaSystem(req.body?.persona, current.label),
          internetEnabled ? "You have live internet access through a server-side web search tool. Use it whenever the request needs current information. Never say you cannot access the internet when the tool is available." : "",
        ].filter(Boolean).join(" ");
        const answer = await callProvider(id, prompt, providerSystem, 2200, 90000, internetEnabled);
        if (!answer.text) throw new Error("The AI returned an empty response.");
        return res.json({
          ok: true,
          provider: id,
          providerLabel: current.label,
          model: providerModel(id),
          answer: answer.text,
          citations: [...new Set(answer.citations || [])].slice(0, 12),
          webSearchUsed: Boolean(answer.webSearchUsed),
          webSearchError: "",
          attachments: prepared.attachments,
          location: prepared.location,
          pickedForMe: requested === "best",
          pickReason: id === best.id ? best.reason : `${best.reason}; the first choice was unavailable so ${current.label} was used instead`,
        });
      } catch (error) {
        lastError = error;
        console.error(`AI Agent ${id} request failed:`, error?.message || error);
      }
    }
    return res.status(502).json({ ok: false, error: `The AI could not answer. ${cleanText(lastError?.message || lastError, 320)}` });
  });

  async function runHotRoomJob(job, input) {
    const { topic, bots, rounds, mode, preparedAttachmentText, preparedAttachments, attachments, location } = input;
    try {
      job.status = "running";
      job.updatedAt = Date.now();
      job.progress = { phase: "preparing", round: 0, rounds, completedTurns: 0, totalTurns: bots.length * rounds, message: "Preparing the Hot Room…" };

      const prepared = await prepareAiContext({
        question: [topic, preparedAttachmentText].filter(Boolean).join("\n\n"),
        attachments: preparedAttachmentText ? [] : attachments,
        location,
        webSearch: "off",
      });
      if (preparedAttachmentText) {
        prepared.attachmentText = preparedAttachmentText;
        prepared.attachments = preparedAttachments;
      }

      const turns = [];
      for (let round = 1; round <= rounds; round += 1) {
        const priorTranscript = turns.slice(-18).filter((t) => t.ok).map((t) => `${t.name}: ${t.text}`).join("\n\n");
        job.progress = {
          phase: "round",
          round,
          rounds,
          completedTurns: turns.length,
          totalTurns: bots.length * rounds,
          message: `Round ${round} of ${rounds} · asking ${bots.length} bots…`,
        };
        job.updatedAt = Date.now();

        const roundTurns = await Promise.all(bots.map(async (bot) => {
          const system = personaSystem(bot, bot.name) + ` This is a ${mode} with other bots. Build on useful ideas and disagree clearly when needed.`;
          const prompt = [
            `Team task: ${topic}`,
            `Round ${round} of ${rounds}`,
            priorTranscript ? `Earlier rounds:\n${priorTranscript}` : "This is the first round. Give your own best answer.",
            prepared.locationText ? `User location context:\n${prepared.locationText}` : "",
            prepared.attachmentText ? `Attached file context:\n${prepared.attachmentText}` : "",
            `Now respond as ${bot.name}.`,
          ].filter(Boolean).join("\n\n");
          const startedAt = Date.now();
          try {
            const botSystem = [
              system,
              bot.tools.webSearch ? "Live internet search is enabled for this bot. Use the server-side web search tool when current information would help. Never claim you lack internet access when this tool is enabled." : "",
            ].filter(Boolean).join(" ");
            const result = await callProvider(bot.provider, prompt, botSystem, 1000, 90000, bot.tools.webSearch);
            return {
              round,
              botId: bot.id,
              name: bot.name,
              provider: bot.provider,
              model: providerModel(bot.provider),
              ok: true,
              text: result.text,
              citations: result.citations || [],
              webSearchUsed: Boolean(result.webSearchUsed),
              latencyMs: Date.now() - startedAt,
            };
          } catch (error) {
            return {
              round,
              botId: bot.id,
              name: bot.name,
              provider: bot.provider,
              model: providerModel(bot.provider),
              ok: false,
              text: "",
              error: cleanText(error?.message || error, 300),
              citations: [],
              webSearchUsed: false,
              latencyMs: Date.now() - startedAt,
            };
          }
        }));

        turns.push(...roundTurns);
        job.progress = {
          phase: "round",
          round,
          rounds,
          completedTurns: turns.length,
          totalTurns: bots.length * rounds,
          message: `Round ${round} of ${rounds} finished · ${turns.length} of ${bots.length * rounds} bot turns complete.`,
        };
        job.updatedAt = Date.now();
      }

      let summary = "";
      const successful = turns.filter((t) => t.ok);
      if (successful.length) {
        const chairId = [...new Set(successful.map((t) => t.provider))].find((id) => providerAllowedByHealth(id)) || successful[0].provider;
        job.progress = {
          phase: "summary",
          round: rounds,
          rounds,
          completedTurns: turns.length,
          totalTurns: bots.length * rounds,
          message: "Bots finished · building the team answer…",
        };
        job.updatedAt = Date.now();
        try {
          const result = await callProvider(
            chairId,
            `Task: ${topic}\n\nTeam transcript:\n${successful.map((t) => `${t.name}: ${t.text}`).join("\n\n")}`,
            "Summarize the team's strongest answer, important disagreements, and next steps. Be concise and practical.",
            1100,
            60000,
            false,
          );
          summary = result.text;
        } catch (error) {
          console.warn("Hot Room summary failed:", cleanText(error?.message || error, 300));
        }
      }

      job.result = {
        ok: turns.some((t) => t.ok),
        topic,
        mode,
        rounds,
        turns,
        summary,
        citations: [...new Set(turns.flatMap((t) => t.citations || []))].slice(0, 12),
        attachments: prepared.attachments,
        location: prepared.location,
        webSearchUsed: turns.some((t) => t.webSearchUsed),
      };
      job.status = "complete";
      job.progress = {
        phase: "complete",
        round: rounds,
        rounds,
        completedTurns: turns.length,
        totalTurns: bots.length * rounds,
        message: "Hot Room finished.",
      };
      job.updatedAt = Date.now();
    } catch (error) {
      job.status = "failed";
      job.error = cleanText(error?.message || error, 500) || "Hot Room failed.";
      job.progress = { ...(job.progress || {}), phase: "failed", message: job.error };
      job.updatedAt = Date.now();
      console.error("Hot Room background job failed:", error?.message || error);
    }
  }

  app.post("/api/ai-agent/bots/run", json, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireAccess(req, res, accessCode)) return;
    pruneHotRoomJobs();

    const topic = cleanText(req.body?.topic, 6000);
    if (!topic) return res.status(400).json({ ok: false, error: "Tell the bots what to work on." });
    const bots = (Array.isArray(req.body?.bots) ? req.body.bots : []).slice(0, 6).map(normalizeBot).filter(Boolean);
    if (bots.length < 2) return res.status(400).json({ ok: false, error: "Pick at least two bots." });
    const unavailable = bots.filter((b) => !providerKey(b.provider));
    if (unavailable.length) return res.status(400).json({ ok: false, error: `${unavailable.map((b) => b.name).join(", ")} uses an AI that is not connected.` });

    const roomProviderIds = [...new Set(bots.map((b) => b.provider))];
    const roomHealth = await Promise.all(roomProviderIds.map((id) => probeProvider(id)));
    const blocked = roomHealth.filter((item) => item.status !== "ready");
    if (blocked.length) {
      const details = blocked.map((item) => {
        const label = PROVIDERS.find((p) => p.id === item.id)?.label || item.id;
        return `${label}: ${item.label}`;
      }).join("; ");
      return res.status(blocked.some((item) => item.status === "no_credits") ? 402 : 503).json({
        ok: false,
        error: `Hot Room was not started because one or more AI models are unavailable. ${details}`,
        providerHealth: blocked,
      });
    }

    const rounds = Math.max(1, Math.min(3, Number(req.body?.rounds || 1)));
    const mode = ["debate", "collaborate", "roundtable"].includes(req.body?.mode) ? req.body.mode : "collaborate";
    const preparedAttachmentText = cleanText(req.body?.preparedAttachmentText, 42000);
    const preparedAttachments = Array.isArray(req.body?.preparedAttachments)
      ? req.body.preparedAttachments.slice(0, 6).map((item) => ({
          name: cleanText(item?.name, 160),
          type: cleanText(item?.type, 120),
          size: Math.max(0, Number(item?.size || 0)),
        }))
      : [];

    const id = hotRoomJobId();
    const job = {
      id,
      status: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      progress: { phase: "queued", round: 0, rounds, completedTurns: 0, totalTurns: bots.length * rounds, message: "Hot Room queued…" },
      result: null,
      error: "",
    };
    hotRoomJobs.set(id, job);

    const input = {
      topic,
      bots,
      rounds,
      mode,
      preparedAttachmentText,
      preparedAttachments,
      attachments: preparedAttachmentText ? [] : req.body?.attachments,
      location: req.body?.location,
    };
    void runHotRoomJob(job, input);

    return res.status(202).json({
      ok: true,
      accepted: true,
      jobId: id,
      status: job.status,
      progress: job.progress,
      pollUrl: `/api/ai-agent/bots/run/${encodeURIComponent(id)}`,
    });
  });

  app.get("/api/ai-agent/bots/run/:jobId", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!requireAccess(req, res, accessCode)) return;
    pruneHotRoomJobs();
    const id = cleanText(req.params?.jobId, 120);
    const job = hotRoomJobs.get(id);
    if (!job) return res.status(404).json({ ok: false, error: "That Hot Room session is no longer available. Start it again." });
    return res.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      result: job.status === "complete" ? job.result : null,
      error: job.status === "failed" ? job.error : "",
    });
  });


  // Friendly UI routes are registered before the legacy Council routes.
  app.get(["/ai-council", "/ai-council/"], (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  app.get(["/ai-council/bots", "/ai-council/bots/", "/ai-council/bots.html"], (_req, res) => res.sendFile(path.join(publicDir, "bots-v2.html")));
  app.get(["/ai-council/chat", "/ai-council/chat/", "/ai-council/chat.html"], (_req, res) => res.sendFile(path.join(publicDir, "bot-chat-v2.html")));
  app.get(["/ai-council/christian.html", "/ai-council/alicia.html", "/ai-council/anaiya.html", "/ai-council/aiden.html"], (_req, res) => res.sendFile(path.join(publicDir, "family-v2.html")));
}
