import express from "express";
import crypto from "crypto";
import { renderDistributorReport } from "./distributorResearch.js";

const TTL = 24 * 60 * 60 * 1000;
const REPORTS = new Map();
const JOBS = new Map();
const SECTION_KEYS = [
  "executive_findings", "identity_operating_model", "revenue_sales_estimates",
  "sites_delivery_points", "geographic_footprint", "fleet_drivers_capacity_safety",
  "leadership_staff_map", "licensing_regulatory_records", "risk_assessment",
  "acquisition_due_diligence",
];

const clean = (v, max = 30000) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const list = (v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]);
const unique = (v) => [...new Set(v.filter(Boolean))];
const slug = (v) => clean(v, 120).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fuel-distributor-report";

function prune(map, limit = 100) {
  const now = Date.now();
  for (const [id, record] of map) if (record.expiresAt <= now) map.delete(id);
  while (map.size > limit) map.delete(map.keys().next().value);
}

function put(map, value, limit = 100) {
  prune(map, limit);
  map.set(value.id, value);
  return value;
}

function get(map, id, limit = 100) {
  prune(map, limit);
  const value = map.get(id);
  if (value) value.expiresAt = Date.now() + TTL;
  return value || null;
}

function validUrl(value) {
  const url = clean(value, 2000);
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch { return ""; }
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output || []).flatMap((item) => item?.type === "message" ? (item.content || []) : [])
    .map((part) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n").trim();
}

function sourcesFrom(payload) {
  const result = [];
  const seen = new Set();
  const add = (rawUrl, rawTitle, type = "OpenAI web-search citation") => {
    const url = validUrl(rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    result.push({ id: "", title: clean(rawTitle || url, 500), url, source_type: type,
      why_it_matters: "Returned by the OpenAI web-search tool for this report.", confidence: "Supporting source" });
  };
  for (const item of payload?.output || []) {
    if (item?.type === "message") {
      for (const part of item.content || []) for (const a of part?.annotations || []) {
        if (a?.type === "url_citation") add(a.url, a.title);
      }
    }
    if (item?.type === "web_search_call") for (const s of item?.action?.sources || []) add(s.url, s.title, "OpenAI web-search source");
  }
  return result;
}

function parseReport(text) {
  let value = clean(text, 900000).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The completed response did not contain a JSON report.");
  return JSON.parse(value.slice(start, end + 1));
}

function normalizeReport(raw, meta) {
  const report = raw && typeof raw === "object" ? raw : {};
  report.company_name = clean(report.company_name || report.company?.legal_name || meta.query, 500);
  report.query = clean(report.query || meta.query, 500);
  report.prepared_at = clean(report.prepared_at || new Date().toISOString(), 100);
  report.title = clean(report.title || `${report.company_name} Public Company Intelligence Deep Dive`, 700);
  report.disclaimer = clean(report.disclaimer || "Public-source ChatGPT research only; not audited financial, legal, environmental, customer, tax, valuation, or management-provided information. Validate all findings and model estimates in diligence.", 2500);
  for (const key of SECTION_KEYS) if (report[key] == null) report[key] = key === "executive_findings" ? [] : {};
  report.appendices = report.appendices || {};
  report.appendices.publicly_identified_sites = list(report.appendices.publicly_identified_sites);
  report.appendices.station_urls = list(report.appendices.station_urls);

  const combined = [...list(report.appendices.source_register || report.sources), ...(meta.sources || [])];
  const byUrl = new Map();
  for (const source of combined) {
    if (!source || typeof source !== "object") continue;
    const url = validUrl(source.url || source.public_url);
    const title = clean(source.title || source.source || source.name || url || "Public source", 500);
    const key = url || title;
    if (!key || byUrl.has(key)) continue;
    byUrl.set(key, { id: "", title, url, source_type: clean(source.source_type || source.type || "Public source", 200),
      why_it_matters: clean(source.why_it_matters || source.notes || source.description || "", 1600), confidence: clean(source.confidence || "", 100) });
  }
  report.appendices.source_register = [...byUrl.values()].map((source, i) => ({ ...source, id: `S${i + 1}` }));
  report.sources = report.appendices.source_register;
  report._meta = { generated_at: new Date().toISOString(), model: meta.model || "", web_search_tool: "web_search",
    location_hint: meta.location || "", focus: meta.focus || "", background_response_id: meta.responseId || "", attempts: meta.attempts || [] };
  return report;
}

function prompt({ query, location, focus }) {
  return `Research this fuel distributor or petroleum marketer and create an exhaustive public-source M&A intelligence report.
TARGET: ${query}
GEOGRAPHY: ${location || "Not supplied"}
SPECIAL FOCUS: ${focus || "Full-company deep dive"}

Use live web search extensively. Prioritize the official company site, secretary-of-state records, FMCSA/SAFER, USDOT, state fuel licenses, UST/environmental databases and enforcement reports, courts, branded station locators, trade associations, press releases/acquisitions, job listings, property clues, and reputable directories.

Rules: never invent private facts; say "not publicly found" when appropriate; separate confirmed facts, public clues, model estimates, and historical evidence; show assumptions and arithmetic for revenue/gallon/customer/valuation estimates; do not equate gross fuel billings with EBITDA; do not claim station ownership/supply/delivery unless the source proves it; cite claims with S1/S2 IDs and put direct URLs in the source register; include negative findings and data gaps.

Return one valid JSON object only. Use these exact top-level keys and nested fields:
- prepared_at, query, company_name, title, disclaimer
- executive_findings: string[]
- identity_operating_model: {summary, facts:[{field,public_finding,confidence,source_ids}], business_segments:[{segment,evidence,confidence,source_ids}], ownership_and_history:string[], contact_information:[{type,value,source_ids}]}
- revenue_sales_estimates: {limitations, public_estimates:[{source,estimate,interpretation,confidence,source_ids}], modeled_revenue_scenarios:[{scenario,annual_revenue_or_billings,basis_and_arithmetic,confidence}], modeled_capacity_cases:[{case,load_assumption,weekly_loads,weekly_gallons,annual_gallons,confidence}], estimated_customer_site_count:[{scenario,estimate,basis,confidence}], ebitda_and_valuation_view:string[]}
- sites_delivery_points: {summary, publicly_attributable_count, sites:[{relationship_type,site_or_account,address_location,public_evidence,what_it_does_not_prove,confidence,source_ids}], site_count_model:string[], brands_and_programs:[{brand_or_program,evidence,confidence,source_ids}]}
- geographic_footprint: {summary, markets:[{state_region,publicly_identified_markets,evidence,confidence,source_ids}], terminal_and_supply_clues:[{terminal_supplier_market,evidence,confidence,source_ids}], hiring_and_operational_clues:[{market,roles_or_clues,source_ids}]}
- fleet_drivers_capacity_safety: {summary, metrics:[{metric,public_data,diligence_implication,confidence,source_ids}], safety_and_insurance_clues:[{topic,finding,diligence_action,source_ids}], fleet_capacity_implications:string[]}
- leadership_staff_map: {summary, people:[{person,role_and_basis,decision_maker_relevance,confidence,source_ids}], organization_and_succession_clues:string[]}
- licensing_regulatory_records: {licensing_and_registration:[{jurisdiction_area,public_record,status_or_date,confidence,source_ids}], environmental_ust_enforcement:[{year,facility_location,issue_and_outcome,penalty,confidence,source_ids}], litigation_liens_bankruptcy:[{year,matter,summary,outcome_or_status,confidence,source_ids}]}
- risk_assessment: {overall_acquisition_screen, strategic_fit_score_0_to_10, risks:[{risk_topic,public_signal,severity,diligence_action}], opportunities:[{opportunity,public_basis,validation_needed}], red_flags_and_data_gaps:string[]}
- acquisition_due_diligence: {questions_by_category:[{category,questions:string[]}], priority_documents:string[], first_30_day_diligence_plan:[{period,actions}]}
- appendices: {publicly_identified_sites:[{relationship_type,site_or_account,address_location,evidence_summary,confidence,source_ids}], station_urls:[{market,address,public_url,source_ids}], source_register:[{id,title,url,source_type,why_it_matters,confidence}]}
Use empty arrays rather than omitting fields.`;
}

function attempts() {
  const requested = clean(process.env.OPENAI_DISTRIBUTOR_MODEL, 100);
  return unique([requested, "gpt-5.5", "gpt-5.6", "gpt-4.1"]).map((model) => ({ model, reasoning: /^gpt-5/i.test(model) ? "high" : "" }));
}

function payloadFor(job, attempt) {
  const gpt5 = /^gpt-5/i.test(attempt.model);
  const body = {
    model: attempt.model, background: true, store: true,
    tools: [{ type: "web_search", search_context_size: "high", ...(gpt5 ? { return_token_budget: "unlimited" } : {}) }],
    tool_choice: "required", include: ["web_search_call.action.sources"],
    instructions: "You are a rigorous petroleum-industry M&A research analyst. Use web search, favor primary sources, distinguish facts from estimates, and output one valid JSON object only.",
    input: prompt(job), max_output_tokens: Number(process.env.OPENAI_DISTRIBUTOR_MAX_OUTPUT_TOKENS || 48000),
    text: { format: { type: "json_object" } },
  };
  if (attempt.reasoning) body.reasoning = { effort: attempt.reasoning };
  return body;
}

function apiError(status, text, model) {
  let detail = "";
  try { detail = JSON.parse(text)?.error?.message || ""; } catch {}
  return new Error(`OpenAI ${status} (${model}): ${clean(detail || text || "Request failed", 1200)}`);
}

function publicError(error) {
  const text = clean(error?.message || error, 1600);
  if (/429|rate.?limit/i.test(text)) return "OpenAI is temporarily rate-limited. Retry in a few minutes.";
  if (/quota|billing|credit|insufficient_quota/i.test(text)) return "The OpenAI API account needs credits or billing access.";
  if (/401|invalid api key|authentication/i.test(text)) return "The OpenAI API key in Render is invalid or unauthorized.";
  if (/token|max_output|incomplete/i.test(text)) return "The report exceeded the model output allowance after automatic retries.";
  return "ChatGPT could not complete the report after automatic retries.";
}

async function startNext(job, apiKey, fetchWithTimeout, priorError = "") {
  if (priorError) job.errors.push(clean(priorError, 1600));
  while (job.next < job.attempts.length) {
    const attempt = job.attempts[job.next++];
    job.status = "starting";
    job.message = `Starting ${attempt.model} background research…`;
    try {
      const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payloadFor(job, attempt)),
      }, Number(process.env.OPENAI_DISTRIBUTOR_CREATE_TIMEOUT_MS || 60000));
      const text = await response.text();
      if (!response.ok) throw apiError(response.status, text, attempt.model);
      const data = JSON.parse(text);
      if (!data?.id) throw new Error(`OpenAI did not return a response ID for ${attempt.model}.`);
      job.responseId = data.id;
      job.model = attempt.model;
      job.status = data.status || "queued";
      job.message = "OpenAI is researching public sources.";
      job.attemptLog.push({ model: attempt.model, responseId: data.id, startedAt: new Date().toISOString() });
      return true;
    } catch (error) {
      job.errors.push(clean(error?.message || error, 1600));
      job.attemptLog.push({ model: attempt.model, failedToStart: true, error: clean(error?.message || error, 700) });
    }
  }
  job.status = "failed";
  job.message = publicError(job.errors.at(-1));
  return false;
}

function progress(job) {
  const seconds = Math.floor((Date.now() - job.createdAt) / 1000);
  if (seconds < 50) return "Confirming the legal entity, official site, and operating model…";
  if (seconds < 120) return "Checking fleet, drivers, mileage, markets, and safety records…";
  if (seconds < 200) return "Searching licenses, UST records, environmental matters, and public sites…";
  if (seconds < 300) return "Mapping leadership, ownership, brands, terminals, and acquisition history…";
  if (seconds < 430) return "Modeling revenue, gallons, customer count, risks, and diligence questions…";
  return "Background research is still running. Fuel IQ will keep checking until OpenAI finishes.";
}

function jobJson(job) {
  const base = { ok: job.status !== "failed", jobId: job.id, status: job.status, model: job.model || "",
    message: ["queued", "in_progress"].includes(job.status) ? progress(job) : job.message,
    elapsedSeconds: Math.floor((Date.now() - job.createdAt) / 1000), attempt: Math.max(1, job.next), maxAttempts: job.attempts.length };
  if (job.status === "completed") return { ...base, ...job.result };
  if (job.status === "failed") return { ...base, ok: false, detail: clean(job.errors.at(-1), 1000) };
  return base;
}

async function refresh(job, apiKey, fetchWithTimeout) {
  if (["completed", "failed"].includes(job.status) || job.polling) return;
  job.polling = true;
  try {
    const response = await fetchWithTimeout(`https://api.openai.com/v1/responses/${encodeURIComponent(job.responseId)}`,
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } }, 45000);
    const text = await response.text();
    if (!response.ok) throw apiError(response.status, text, "background retrieval");
    const data = JSON.parse(text);
    job.pollErrors = 0;
    if (["queued", "in_progress"].includes(data.status)) {
      job.status = data.status;
      job.message = progress(job);
      return;
    }
    if (data.status === "completed") {
      try {
        const report = normalizeReport(parseReport(outputText(data)), { query: job.query, location: job.location, focus: job.focus,
          model: job.model, responseId: data.id, attempts: job.attemptLog, sources: sourcesFrom(data) });
        const reportId = crypto.randomUUID();
        put(REPORTS, { id: reportId, report, expiresAt: Date.now() + TTL });
        job.status = "completed";
        job.message = "Research complete.";
        job.result = { reportId, report, html: renderDistributorReport(report), wordUrl: `/api/distributors/word/${reportId}` };
        return;
      } catch (error) {
        await startNext(job, apiKey, fetchWithTimeout, `Completed output could not be converted into a report: ${error?.message || error}`);
        return;
      }
    }
    const reason = data?.error?.message || data?.incomplete_details?.reason || `status ${data.status}`;
    await startNext(job, apiKey, fetchWithTimeout, `${job.model} ended with ${reason}`);
  } catch (error) {
    job.pollErrors += 1;
    job.errors.push(clean(`Status check ${job.pollErrors}: ${error?.message || error}`, 1600));
    if (job.pollErrors <= 5) {
      job.status = "in_progress";
      job.message = "The job is still running; Fuel IQ is retrying a temporary status-check error.";
    } else {
      job.pollErrors = 0;
      await startNext(job, apiKey, fetchWithTimeout, error?.message || error);
    }
  } finally { job.polling = false; }
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
  router.use(express.json({ limit: "3mb" }));

  router.get("/status", (_req, res) => res.json({ ok: true, openAiEnabled: Boolean(apiKey),
    configuredModel: process.env.OPENAI_DISTRIBUTOR_MODEL || "gpt-5.5 background research",
    backgroundResearch: true, validJsonOutput: true, reportCacheHours: TTL / 3600000 }));

  router.post("/research", async (req, res) => {
    const query = clean(req.body?.query, 500);
    const location = clean(req.body?.location, 300);
    const focus = clean(req.body?.focus, 4000);
    if (query.length < 2) return res.status(400).json({ ok: false, message: "Enter a fuel distributor name." });
    if (!apiKey) return res.status(503).json({ ok: false, message: "OPENAI_API_KEY is not configured on the server." });
    const job = put(JOBS, { id: crypto.randomUUID(), query, location, focus, createdAt: Date.now(), expiresAt: Date.now() + TTL,
      status: "starting", message: "Starting background research…", attempts: attempts(), next: 0, attemptLog: [], errors: [],
      responseId: "", model: "", polling: false, pollErrors: 0, result: null }, 50);
    if (!await startNext(job, apiKey, fetchWithTimeout)) return res.status(502).json(jobJson(job));
    res.status(202).json(jobJson(job));
  });

  router.get("/research/:jobId", async (req, res) => {
    const job = get(JOBS, req.params.jobId, 50);
    if (!job) return res.status(404).json({ ok: false, status: "expired", message: "This job expired or the server restarted. Start the search again." });
    await refresh(job, apiKey, fetchWithTimeout);
    res.status(job.status === "failed" ? 502 : 200).json(jobJson(job));
  });

  router.get("/report/:id", (req, res) => {
    const record = get(REPORTS, req.params.id);
    if (!record) return res.status(404).json({ ok: false, message: "Report expired or was not found." });
    res.json({ ok: true, report: record.report, html: renderDistributorReport(record.report), wordUrl: `/api/distributors/word/${req.params.id}` });
  });

  router.get("/word/:id", (req, res) => {
    const record = get(REPORTS, req.params.id);
    if (!record) return res.status(404).send("Report expired or was not found.");
    res.setHeader("Content-Type", "application/msword; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${slug(record.report.company_name)}-public-company-intelligence-deep-dive.doc"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(renderDistributorReport(record.report, { document: true }));
  });

  router.post("/word", (req, res) => {
    try {
      const report = normalizeReport(req.body?.report || {}, { query: req.body?.report?.query || req.body?.report?.company_name || "Fuel Distributor", model: req.body?.report?._meta?.model || "", sources: [] });
      res.setHeader("Content-Type", "application/msword; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${slug(report.company_name)}-public-company-intelligence-deep-dive.doc"`);
      res.send(renderDistributorReport(report, { document: true }));
    } catch (error) { res.status(400).json({ ok: false, message: clean(error?.message, 1000) }); }
  });

  app.use("/api/distributors", router);
}
