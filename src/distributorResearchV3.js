import express from "express";
import crypto from "crypto";
import {
  REPORT_JSON_SCHEMA,
  buildSourceCatalog,
  clean,
  normalizeDistributorReport,
  renderDistributorReport,
  slug,
  validUrl,
} from "./distributorReportV3.js";
import { buildDistributorWordDocument } from "./distributorWordV3.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const REPORT_LIMIT = 100;
const JOB_LIMIT = 50;
const REPORTS = new Map();
const JOBS = new Map();

function prune(map, limit) {
  const now = Date.now();
  for (const [id, record] of map) {
    if (record.expiresAt <= now) map.delete(id);
  }
  while (map.size > limit) map.delete(map.keys().next().value);
}

function put(map, value, limit) {
  prune(map, limit);
  map.set(value.id, value);
  return value;
}

function get(map, id, limit) {
  prune(map, limit);
  const value = map.get(id);
  if (value) value.expiresAt = Date.now() + TTL_MS;
  return value || null;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => clean(value, 100)).filter(Boolean))];
}

function responseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const chunks = [];
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const part of item.content || []) {
      if (typeof part?.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

function sourcesFrom(payload) {
  const sources = [];
  const seen = new Set();
  const add = (rawUrl, rawTitle, sourceType = "OpenAI web-search source") => {
    const url = validUrl(rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    sources.push({
      title: clean(rawTitle || new URL(url).hostname, 500),
      url,
      source_type: sourceType,
      why_it_matters: "Public source returned by the OpenAI web-search tool for this report.",
      confidence: "Supporting source",
    });
  };

  for (const item of payload?.output || []) {
    if (item?.type === "message") {
      for (const part of item.content || []) {
        for (const annotation of part?.annotations || []) {
          if (annotation?.type === "url_citation") add(annotation.url, annotation.title, "OpenAI URL citation");
        }
      }
    }
    if (item?.type === "web_search_call") {
      for (const source of item?.action?.sources || []) add(source.url, source.title, "OpenAI web-search source");
    }
  }
  return buildSourceCatalog(sources).slice(0, 160);
}

function parseFirstJsonObject(text) {
  const trimmed = clean(text, 1500000)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!trimmed) throw new Error("The formatter returned no report text.");

  try {
    const direct = JSON.parse(trimmed);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  } catch {}

  for (let start = 0; start < trimmed.length; start += 1) {
    if (trimmed[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = trimmed.slice(start, index + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
          } catch {}
          break;
        }
      }
    }
  }
  throw new Error("The completed formatter response did not contain one usable JSON report object.");
}

function researchPrompt(job) {
  return `Conduct exhaustive public-source research on this fuel distributor or petroleum marketer.

TARGET COMPANY: ${job.query}
HEADQUARTERS / GEOGRAPHY HINT: ${job.location || "Not supplied"}
SPECIAL FOCUS: ${job.focus || "Full-company deep dive"}

Research broadly and cross-check the official company website, secretary-of-state records, FMCSA/SAFER and USDOT data, motor-fuel dealer/wholesaler/transporter licenses, UST and environmental records, enforcement reports, court records, branded station locators, trade associations, acquisitions, press releases, job listings, property clues, PPP/SBA records, and reputable directories.

Cover all of these areas in a detailed research dossier:
1. Executive findings.
2. Legal identity, ownership, history, contacts, and operating model.
3. Public financial estimates and clearly labeled modeled revenue, gallon, capacity, customer-count, EBITDA, and valuation implications.
4. Every publicly attributable site, station, delivery point, customer clue, brand relationship, and the limits of what each source proves.
5. Geographic markets, terminal and supplier clues, and current hiring evidence.
6. Fleet, power units, drivers, mileage, safety, insurance, capacity, loads, and gallons.
7. Leadership, staff, decision makers, succession, and organization clues.
8. Licensing, environmental/UST matters, enforcement, litigation, liens, and bankruptcy clues.
9. Risks, opportunities, data gaps, and acquisition implications.
10. Acquisition diligence questions, priority documents, and a first-30-day diligence plan.

RESEARCH RULES:
- Use live web search extensively and favor primary/official sources.
- Never invent private facts. State when something was not publicly found.
- Distinguish confirmed facts, public clues, historical evidence, and model estimates.
- Show assumptions and arithmetic for estimates. Gross fuel billings are not EBITDA.
- Never claim ownership, supply, or delivery relationships beyond what the source proves.
- Include source titles and direct URLs in the dossier.
- Do not output JSON. Produce a thorough, readable research dossier with headings and source links; a separate formatting step will convert it to the final report.`;
}

function sourceCatalogForPrompt(sources) {
  if (!sources.length) return "No attributable source URLs were returned. Leave all source ID fields empty.";
  return sources.map((source) => `${source.id} | ${source.title} | ${source.url}`).join("\n");
}

function formatterPrompt(job) {
  return `Convert the research dossier below into the exact structured fuel-distributor report required by the supplied JSON schema.

MANDATORY RULES:
- Preserve every material fact, estimate, caveat, site, market, fleet metric, leader, license, regulatory item, risk, opportunity, and diligence question found in the dossier.
- Use only source IDs from the authoritative source catalog below.
- Never output internal tool references such as turn0search0, turn1view2, or similar tokens.
- If a statement cannot be tied to a catalog source, leave its source_ids field as an empty string.
- In appendices.source_register, include only catalog sources with real URLs. Do not invent URLs.
- Do not place raw URLs inside narrative or evidence fields; URLs belong in station_urls or source_register.
- Clearly label modeled estimates and assumptions.
- Use empty strings or empty arrays when information is unavailable.

AUTHORITATIVE SOURCE CATALOG:
${sourceCatalogForPrompt(job.sources)}

RESEARCH DOSSIER:
${clean(job.researchText, 700000)}`;
}

function researchAttempts() {
  const requested = clean(process.env.OPENAI_DISTRIBUTOR_MODEL, 100);
  return uniqueStrings([requested, "gpt-5.6", "gpt-5.5", "gpt-4.1"]).map((model) => ({
    model,
    reasoning: /^gpt-5/i.test(model) ? "high" : "",
  }));
}

function formatterAttempts() {
  const requested = clean(process.env.OPENAI_DISTRIBUTOR_FORMATTER_MODEL, 100);
  const models = uniqueStrings([requested, "gpt-4.1-mini", "gpt-4.1", "gpt-5.5"]);
  const attempts = models.map((model) => ({ model, format: "json_schema", reasoning: /^gpt-5/i.test(model) ? "low" : "" }));
  attempts.push({ model: "gpt-4.1", format: "json_object", reasoning: "" });
  return attempts;
}

function researchPayload(job, attempt) {
  const gpt5 = /^gpt-5/i.test(attempt.model);
  const body = {
    model: attempt.model,
    background: true,
    store: true,
    tools: [{
      type: "web_search",
      search_context_size: "high",
      ...(gpt5 ? { return_token_budget: "unlimited" } : {}),
    }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    instructions: "You are a rigorous petroleum-industry M&A research analyst. Use web search, favor primary sources, and produce a comprehensive factual research dossier. Do not output JSON.",
    input: researchPrompt(job),
    max_output_tokens: Number(process.env.OPENAI_DISTRIBUTOR_RESEARCH_MAX_OUTPUT_TOKENS || 32000),
  };
  if (attempt.reasoning) body.reasoning = { effort: attempt.reasoning };
  return body;
}

function formatterPayload(job, attempt) {
  const format = attempt.format === "json_object"
    ? { type: "json_object" }
    : { type: "json_schema", name: "fuel_distributor_report", strict: true, schema: REPORT_JSON_SCHEMA };
  const body = {
    model: attempt.model,
    background: true,
    store: true,
    instructions: "You are a report normalization engine. Convert the supplied research dossier into one complete JSON report that follows the requested schema. Do not omit researched facts.",
    input: formatterPrompt(job),
    max_output_tokens: Number(process.env.OPENAI_DISTRIBUTOR_FORMAT_MAX_OUTPUT_TOKENS || 32000),
    text: { format },
  };
  if (attempt.reasoning) body.reasoning = { effort: attempt.reasoning };
  return body;
}

function apiError(status, text, model) {
  let detail = "";
  try { detail = JSON.parse(text)?.error?.message || ""; } catch {}
  return new Error(`OpenAI ${status} (${model}): ${clean(detail || text || "Request failed", 1600)}`);
}

function publicError(error) {
  const text = clean(error?.message || error, 2000);
  if (/429|rate.?limit/i.test(text)) return "OpenAI is temporarily rate-limited. Retry in a few minutes.";
  if (/quota|billing|credit|insufficient_quota/i.test(text)) return "The OpenAI API account needs credits or billing access.";
  if (/401|invalid api key|authentication/i.test(text)) return "The OpenAI API key in Render is invalid or unauthorized.";
  if (/token|max_output|incomplete/i.test(text)) return "The report exceeded the model output allowance after automatic retries.";
  if (/json|schema|formatter/i.test(text)) return "The research completed, but the report formatter could not produce a valid report after automatic retries.";
  return "ChatGPT could not complete the report after automatic retries.";
}

async function createBackgroundResponse(payload, model, apiKey, fetchWithTimeout) {
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, Number(process.env.OPENAI_DISTRIBUTOR_CREATE_TIMEOUT_MS || 60000));
  const text = await response.text();
  if (!response.ok) throw apiError(response.status, text, model);
  const data = JSON.parse(text);
  if (!data?.id) throw new Error(`OpenAI did not return a response ID for ${model}.`);
  return data;
}

async function startNextResearch(job, apiKey, fetchWithTimeout, priorError = "") {
  if (priorError) job.errors.push(clean(priorError, 2000));
  while (job.researchNext < job.researchAttempts.length) {
    const attempt = job.researchAttempts[job.researchNext++];
    job.phase = "research";
    job.status = "starting";
    job.message = `Starting ${attempt.model} public-source research…`;
    try {
      const data = await createBackgroundResponse(researchPayload(job, attempt), attempt.model, apiKey, fetchWithTimeout);
      job.responseId = data.id;
      job.model = attempt.model;
      job.status = data.status || "queued";
      job.message = "OpenAI is researching public sources.";
      job.attemptLog.push({ phase: "research", model: attempt.model, responseId: data.id, startedAt: new Date().toISOString() });
      return true;
    } catch (error) {
      job.errors.push(clean(error?.message || error, 2000));
      job.attemptLog.push({ phase: "research", model: attempt.model, failedToStart: true, error: clean(error?.message || error, 900) });
    }
  }
  job.status = "failed";
  job.message = publicError(job.errors.at(-1));
  return false;
}

async function startNextFormatter(job, apiKey, fetchWithTimeout, priorError = "") {
  if (priorError) job.errors.push(clean(priorError, 2000));
  while (job.formatNext < job.formatAttempts.length) {
    const attempt = job.formatAttempts[job.formatNext++];
    job.phase = "formatting";
    job.status = "starting";
    job.message = `Formatting the complete report with ${attempt.model}…`;
    try {
      const data = await createBackgroundResponse(formatterPayload(job, attempt), attempt.model, apiKey, fetchWithTimeout);
      job.responseId = data.id;
      job.formatterModel = attempt.model;
      job.status = data.status || "queued";
      job.message = "Research is complete. Fuel IQ is formatting and validating the report.";
      job.attemptLog.push({ phase: "formatting", model: attempt.model, format: attempt.format, responseId: data.id, startedAt: new Date().toISOString() });
      return true;
    } catch (error) {
      job.errors.push(clean(error?.message || error, 2000));
      job.attemptLog.push({ phase: "formatting", model: attempt.model, format: attempt.format, failedToStart: true, error: clean(error?.message || error, 900) });
    }
  }
  job.status = "failed";
  job.message = publicError(job.errors.at(-1));
  return false;
}

function progress(job) {
  const seconds = Math.floor((Date.now() - job.createdAt) / 1000);
  if (job.phase === "formatting") {
    if (seconds < 420) return "Research is complete. Structuring every section and validating sources…";
    return "Building the final report and Word document data…";
  }
  if (seconds < 50) return "Confirming the legal entity, official site, and operating model…";
  if (seconds < 120) return "Checking fleet, drivers, mileage, markets, and safety records…";
  if (seconds < 210) return "Searching licenses, UST records, environmental matters, and public sites…";
  if (seconds < 320) return "Mapping leadership, ownership, brands, terminals, and acquisition history…";
  return "Completing the public-source research dossier…";
}

function jobJson(job) {
  const maxAttempts = job.researchAttempts.length + job.formatAttempts.length;
  const attempt = job.researchNext + job.formatNext;
  const base = {
    ok: job.status !== "failed",
    jobId: job.id,
    status: job.status,
    phase: job.phase,
    model: job.phase === "formatting" ? (job.formatterModel || job.model || "") : (job.model || ""),
    message: ["queued", "in_progress"].includes(job.status) ? progress(job) : job.message,
    elapsedSeconds: Math.floor((Date.now() - job.createdAt) / 1000),
    attempt: Math.max(1, attempt),
    maxAttempts,
  };
  if (job.status === "completed") return { ...base, ...job.result };
  if (job.status === "failed") return { ...base, ok: false, detail: clean(job.errors.at(-1), 1400) };
  return base;
}

async function retrieveResponse(job, apiKey, fetchWithTimeout) {
  const response = await fetchWithTimeout(
    `https://api.openai.com/v1/responses/${encodeURIComponent(job.responseId)}`,
    { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } },
    45000
  );
  const text = await response.text();
  if (!response.ok) throw apiError(response.status, text, "background retrieval");
  return JSON.parse(text);
}

async function refresh(job, apiKey, fetchWithTimeout) {
  if (["completed", "failed"].includes(job.status) || job.polling) return;
  job.polling = true;
  try {
    const data = await retrieveResponse(job, apiKey, fetchWithTimeout);
    job.pollErrors = 0;

    if (["queued", "in_progress"].includes(data.status)) {
      job.status = data.status;
      job.message = progress(job);
      return;
    }

    if (data.status === "completed") {
      if (job.phase === "research") {
        const dossier = responseText(data);
        if (!dossier) {
          await startNextResearch(job, apiKey, fetchWithTimeout, `${job.model} completed without research text.`);
          return;
        }
        job.researchText = dossier;
        job.sources = sourcesFrom(data);
        await startNextFormatter(job, apiKey, fetchWithTimeout);
        return;
      }

      try {
        const rawReport = parseFirstJsonObject(responseText(data));
        const report = normalizeDistributorReport(rawReport, {
          query: job.query,
          location: job.location,
          focus: job.focus,
          model: job.model,
          formatterModel: job.formatterModel,
          responseId: data.id,
          attempts: job.attemptLog,
          sources: job.sources,
        });
        const reportId = crypto.randomUUID();
        put(REPORTS, { id: reportId, report, expiresAt: Date.now() + TTL_MS }, REPORT_LIMIT);
        job.status = "completed";
        job.message = "Research complete.";
        job.result = {
          reportId,
          report,
          html: renderDistributorReport(report),
          wordUrl: `/api/distributors/word/${reportId}`,
        };
        return;
      } catch (error) {
        await startNextFormatter(job, apiKey, fetchWithTimeout, `Formatter output could not be converted into a report: ${error?.message || error}`);
        return;
      }
    }

    const reason = data?.error?.message || data?.incomplete_details?.reason || `status ${data.status}`;
    if (job.phase === "research") await startNextResearch(job, apiKey, fetchWithTimeout, `${job.model} ended with ${reason}`);
    else await startNextFormatter(job, apiKey, fetchWithTimeout, `${job.formatterModel} ended with ${reason}`);
  } catch (error) {
    job.pollErrors += 1;
    job.errors.push(clean(`Status check ${job.pollErrors}: ${error?.message || error}`, 2000));
    if (job.pollErrors <= 5) {
      job.status = "in_progress";
      job.message = "The job is still running; Fuel IQ is retrying a temporary status-check error.";
    } else {
      job.pollErrors = 0;
      if (job.phase === "research") await startNextResearch(job, apiKey, fetchWithTimeout, error?.message || error);
      else await startNextFormatter(job, apiKey, fetchWithTimeout, error?.message || error);
    }
  } finally {
    job.polling = false;
  }
}

export function registerDistributorResearchRoutes(app, options = {}) {
  const router = express.Router();
  const apiKey = options.openAiApiKey || process.env.OPENAI_API_KEY || "";
  const fetchWithTimeout = options.fetchWithTimeout || (async (url, init = {}, timeoutMs = 30000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  });

  router.use(express.json({ limit: "6mb" }));

  router.get("/status", (_req, res) => res.json({
    ok: true,
    openAiEnabled: Boolean(apiKey),
    configuredModel: process.env.OPENAI_DISTRIBUTOR_MODEL || "GPT background web research",
    formatterModel: process.env.OPENAI_DISTRIBUTOR_FORMATTER_MODEL || "gpt-4.1-mini structured formatter",
    backgroundResearch: true,
    twoPhaseReportPipeline: true,
    structuredFormatter: true,
    internalCitationFiltering: true,
    wordDocxExport: true,
    reportCacheHours: TTL_MS / 3600000,
  }));

  router.post("/research", async (req, res) => {
    const query = clean(req.body?.query, 500);
    const location = clean(req.body?.location, 300);
    const focus = clean(req.body?.focus, 4000);
    if (query.length < 2) return res.status(400).json({ ok: false, message: "Enter a fuel distributor name." });
    if (!apiKey) return res.status(503).json({ ok: false, message: "OPENAI_API_KEY is not configured on the server." });

    const job = put(JOBS, {
      id: crypto.randomUUID(),
      query,
      location,
      focus,
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
      phase: "research",
      status: "starting",
      message: "Starting public-source research…",
      researchAttempts: researchAttempts(),
      researchNext: 0,
      formatAttempts: formatterAttempts(),
      formatNext: 0,
      attemptLog: [],
      errors: [],
      responseId: "",
      model: "",
      formatterModel: "",
      researchText: "",
      sources: [],
      polling: false,
      pollErrors: 0,
      result: null,
    }, JOB_LIMIT);

    if (!await startNextResearch(job, apiKey, fetchWithTimeout)) return res.status(502).json(jobJson(job));
    res.status(202).json(jobJson(job));
  });

  router.get("/research/:jobId", async (req, res) => {
    const job = get(JOBS, req.params.jobId, JOB_LIMIT);
    if (!job) return res.status(404).json({
      ok: false,
      status: "expired",
      message: "This job expired or the server restarted. Start the search again.",
    });
    await refresh(job, apiKey, fetchWithTimeout);
    res.status(job.status === "failed" ? 502 : 200).json(jobJson(job));
  });

  router.get("/report/:id", (req, res) => {
    const record = get(REPORTS, req.params.id, REPORT_LIMIT);
    if (!record) return res.status(404).json({ ok: false, message: "Report expired or was not found." });
    res.json({
      ok: true,
      report: record.report,
      html: renderDistributorReport(record.report),
      wordUrl: `/api/distributors/word/${req.params.id}`,
    });
  });

  router.get("/word/:id", async (req, res) => {
    const record = get(REPORTS, req.params.id, REPORT_LIMIT);
    if (!record) return res.status(404).send("Report expired or was not found.");
    try {
      const buffer = await buildDistributorWordDocument(record.report);
      const filename = `${slug(record.report.company_name)}-public-company-intelligence-deep-dive.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Cache-Control", "no-store");
      res.send(buffer);
    } catch (error) {
      console.error("Distributor Word export failed:", error);
      res.status(500).json({ ok: false, message: "Word export failed.", detail: process.env.NODE_ENV === "production" ? undefined : clean(error?.message, 1200) });
    }
  });

  router.post("/word", async (req, res) => {
    try {
      const report = normalizeDistributorReport(req.body?.report || {}, {
        query: req.body?.report?.query || req.body?.report?.company_name || "Fuel Distributor",
        model: req.body?.report?._meta?.model || "",
        formatterModel: req.body?.report?._meta?.formatter_model || "",
        sources: req.body?.report?.appendices?.source_register || [],
      });
      const buffer = await buildDistributorWordDocument(report);
      const filename = `${slug(report.company_name)}-public-company-intelligence-deep-dive.docx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error) {
      res.status(400).json({ ok: false, message: "Word export failed.", detail: clean(error?.message, 1200) });
    }
  });

  app.use("/api/distributors", router);
}
