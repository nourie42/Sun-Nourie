import express from "express";
import crypto from "crypto";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REPORTS = new Map();
const JOBS = new Map();

const SECTION_CATALOG = {
  executive_read: "Executive Read",
  metric_detail: "Metric Detail",
  site_snapshot: "Site Snapshot",
  area_profile_demand_drivers: "Area Profile and Demand Drivers",
  residential_growth: "Residential Growth",
  commercial_retail_growth: "Commercial and Retail Growth",
  traffic_volume: "Traffic and Volume Read",
  current_competition: "Current Competition",
  competition_growth_future_risk: "Competition Growth and Future Risk",
  strengths_weaknesses_due_diligence: "Strengths, Weaknesses, and Key Due Diligence",
  recommended_site_positioning: "Recommended Site Positioning",
  revised_conclusion: "Revised Conclusion",
  sources_notes: "Sources and Notes",
};
const DEFAULT_SECTIONS = Object.keys(SECTION_CATALOG);
const PROPERTY_FIELDS = [
  ["owner_name", "Owner of record"], ["owner_type", "Owner type"],
  ["owner_mailing_address", "Owner mailing address"], ["situs_address", "Property address"],
  ["parcel_id", "Parcel / tax ID"], ["county", "County / jurisdiction"],
  ["assessed_value", "Assessed value"], ["last_sale_date", "Last sale date"],
  ["last_sale_price", "Last sale price"], ["lot_size", "Lot size"],
  ["building_size", "Building size"], ["year_built", "Year built / renovated"],
  ["zoning", "Zoning"], ["current_use", "Current use"],
  ["legal_description", "Legal description"], ["tax_status", "Tax status"],
  ["confidence", "Confidence"],
];

const clean = (value, max = 30000) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const list = (value) => Array.isArray(value) ? value : (value == null || value === "" ? [] : [value]);
const unique = (values) => [...new Set(values.filter(Boolean))];
const slug = (value) => clean(value, 140).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fuel-iq-site-report";
const html = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const attr = (value) => html(value).replace(/`/g, "&#96;");

function prune(map, limit = 100) {
  const now = Date.now();
  for (const [id, record] of map) if (record.expiresAt <= now) map.delete(id);
  while (map.size > limit) map.delete(map.keys().next().value);
}
function put(map, value, limit = 100) { prune(map, limit); map.set(value.id, value); return value; }
function get(map, id, limit = 100) { prune(map, limit); const value = map.get(id); if (value) value.expiresAt = Date.now() + CACHE_TTL_MS; return value || null; }
function validUrl(value) { try { const u = new URL(clean(value, 2000)); return ["http:", "https:"].includes(u.protocol) ? u.toString() : ""; } catch { return ""; } }
function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output || []).flatMap((item) => item?.type === "message" ? item.content || [] : [])
    .map((part) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n").trim();
}
function sourcesFrom(payload) {
  const out = [], seen = new Set();
  const add = (rawUrl, rawTitle, type = "OpenAI web-search source") => {
    const url = validUrl(rawUrl); if (!url || seen.has(url)) return; seen.add(url);
    out.push({ title: clean(rawTitle || url, 600), url, source_type: type, why_it_matters: "Used in an exhaustive site-research pass.", confidence: "Supporting source" });
  };
  for (const item of payload?.output || []) {
    if (item?.type === "message") for (const part of item.content || []) for (const a of part.annotations || []) if (a?.type === "url_citation") add(a.url, a.title, "OpenAI citation");
    if (item?.type === "web_search_call") for (const s of item?.action?.sources || []) add(s.url, s.title);
  }
  return out;
}
function parseJson(text) {
  let value = clean(text, 1000000).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = value.indexOf("{"); const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The synthesis response did not contain a JSON report.");
  return JSON.parse(value.slice(start, end + 1));
}
function sourceIds(value) { return list(value).map((x) => clean(x, 100)).filter(Boolean); }
function normalizeFinding(raw) {
  const v = raw && typeof raw === "object" ? raw : { detail: raw };
  return { topic: clean(v.topic || v.item || v.project || v.metric, 500), detail: clean(v.detail || v.finding || v.public_finding || v.description || v.evidence, 7000), site_implication: clean(v.site_implication || v.implication || v.relevance, 5000), confidence: clean(v.confidence || v.status, 200), source_ids: sourceIds(v.source_ids || v.sources) };
}
function normalizeTable(raw) {
  const v = raw && typeof raw === "object" ? raw : {};
  const columns = list(v.columns || v.headers).map((x) => clean(x, 300)).filter(Boolean).slice(0, 12);
  const rows = list(v.rows).map((row) => Array.isArray(row) ? row.map((x) => clean(x, 3000)).slice(0, 12) : Object.values(row || {}).map((x) => clean(x, 3000)).slice(0, 12)).filter((row) => row.some(Boolean)).slice(0, 150);
  return { title: clean(v.title || v.name, 500), columns, rows };
}
function normalizeSection(raw, key) {
  const v = raw && typeof raw === "object" ? raw : {};
  return { key, title: clean(v.title || SECTION_CATALOG[key] || key, 500), summary: clean(v.summary || v.narrative || v.overview || v.conclusion, 16000), findings: list(v.findings || v.items || v.projects || v.metrics || v.recommendations).map(normalizeFinding).filter((x) => x.topic || x.detail), tables: list(v.tables).map(normalizeTable).filter((x) => x.columns.length || x.rows.length), calculations: list(v.calculations || v.math || v.sensitivity_analysis).map((x) => clean(x, 5000)).filter(Boolean), cautions: list(v.cautions || v.caveats || v.data_gaps || v.notes).map((x) => clean(x, 5000)).filter(Boolean) };
}
function normalizeSources(raw, annotations = []) {
  const out = [], seen = new Set();
  for (const s of [...list(raw), ...annotations]) {
    if (!s || typeof s !== "object") continue;
    const url = validUrl(s.url || s.public_url); const key = url || clean(s.title || s.name, 600); if (!key || seen.has(key)) continue; seen.add(key);
    out.push({ id: `S${out.length + 1}`, title: clean(s.title || s.source || s.name || url || "Public source", 700), url, source_type: clean(s.source_type || s.type || "Public source", 300), why_it_matters: clean(s.why_it_matters || s.notes || s.description || "", 2500), confidence: clean(s.confidence || "", 200) });
  }
  return out;
}
function normalizeReport(raw, meta) {
  const report = raw && typeof raw === "object" ? raw : {};
  const byKey = new Map(list(report.sections).map((s) => [clean(s?.key, 120), s]));
  const property = report.property_records && typeof report.property_records === "object" ? report.property_records : {};
  const normalizedProperty = { summary: clean(property.summary || property.overview, 12000), record_details: list(property.record_details || property.details).map((r) => ({ field: clean(r?.field || r?.item, 500), value: clean(r?.value || r?.detail || r?.finding, 6000), confidence: clean(r?.confidence || r?.status, 200), source_ids: sourceIds(r?.source_ids || r?.sources) })).filter((r) => r.field || r.value), not_found: list(property.not_found || property.data_gaps).map((x) => clean(x, 2500)).filter(Boolean), source_ids: sourceIds(property.source_ids || property.sources) };
  for (const [key] of PROPERTY_FIELDS) normalizedProperty[key] = clean(property[key], 3500);
  return { prepared_at: clean(report.prepared_at || new Date().toISOString(), 120), address: clean(report.address || meta.address, 700), title: clean(report.title || `${meta.address} Detailed Site & Market Summary`, 900), disclaimer: clean(report.disclaimer || "Public-source research and model-assisted analysis only. Verify controlling property, traffic, zoning, environmental, competition, and development records before underwriting.", 3500), property_records: normalizedProperty, sections: meta.sections.map((key) => normalizeSection(byKey.get(key) || report[key], key)), source_register: normalizeSources(report.source_register || report.sources, meta.sources), _meta: { generated_at: new Date().toISOString(), model: meta.model, selected_sections: meta.sections, research_passes: meta.passes } };
}

function compactEstimate(value) {
  if (!value || typeof value !== "object") return null;
  return { aadtText: value.aadtText || "", competitionText: value.competitionText || "", base: value.base ?? null, low: value.low ?? null, high: value.high ?? null, year2: value.year2 ?? null, year3: value.year3 ?? null, inputs: value.inputs || null, competition: value.competition || null, competitor_details: value.competitor_details || value.competitors_1_5mi || null, roads: value.roads || null, developments: list(value.csv).slice(0, 25), calc_breakdown: value.calc_breakdown || null };
}
function commonContext(job) {
  return `EXACT TARGET ADDRESS: ${job.address}\nNORMALIZED ADDRESS/COORDINATES: ${JSON.stringify(job.normalizedAddress || {})}\nUSER NOTES: ${job.siteNotes || "None"}\nFUEL IQ CONTEXT (not independent proof): ${JSON.stringify(compactEstimate(job.estimateContext) || {})}\nThe competitive radius is exactly 1.5 miles. Do not report no competitors merely because one source returns zero; cross-check Google/official station pages/brand locators/OpenStreetMap/business listings and clearly label unresolved gaps.`;
}
const PASSES = [
  { key: "property", label: "property ownership and official site records", prompt: (job) => `${commonContext(job)}\nResearch the exact parcel exhaustively. Search official county assessor, tax, GIS, deed/register, zoning, planning, permits, UST and environmental records. Return detailed prose with direct URLs and dates. Find the current owner of record by name if publicly available, owner type, mailing address, parcel ID, acreage, building area, year built/renovated, assessed value, sale history, zoning, current use, legal description, tax status, UST/operator clues, environmental cases and unresolved gaps. Never infer a person behind an LLC.` },
  { key: "traffic_competition", label: "traffic, access, and 1.5-mile competition", prompt: (job) => `${commonContext(job)}\nResearch official DOT AADT stations and the three closest relevant readings, frontage/access/median/turn constraints, capture-rate sensitivity, and every operating fuel/convenience competitor within exactly 1.5 miles. Use multiple independent discovery methods and list name, brand, address, approximate distance, format, diesel, car wash, foodservice and competitive relevance. Separately search future gas stations, redevelopments, grocery fuel and travel-center proposals. Include direct URLs and dates.` },
  { key: "growth_market", label: "residential, commercial, and demographic growth", prompt: (job) => `${commonContext(job)}\nSearch municipal development maps, planning agendas, staff reports, meeting packets, project pages, permits, local news, Census/ACS and economic-development sources. Identify named residential, multifamily, retail, grocery, restaurant, medical, school, daycare, office, industrial, flex, warehouse and mixed-use projects with units/square feet, status, timing, location relationship, source date and traffic/fuel implication. Include population, households, income, commuting and employment demand drivers. Search alternate project names and archived records.` },
  { key: "operations_risk", label: "site operations, environmental risk, and positioning", prompt: (job) => `${commonContext(job)}\nResearch the current station/business identity, operating hours, brand, amenities, diesel/fleet cards, reviews, public photos, age/condition clues, tanks/environmental history, permits, litigation or enforcement clues, and redevelopment constraints. Build strengths, weaknesses, red flags, due-diligence priorities and practical modernization/positioning recommendations. Include direct URLs, dates, conflicting evidence and field-verification needs.` },
];
function researchPayload(job, pass, model) {
  return { model, background: true, store: true, tools: [{ type: "web_search", search_context_size: "high" }], tool_choice: "required", include: ["web_search_call.action.sources"], instructions: "You are a rigorous petroleum-site M&A research analyst. Search broadly, favor primary sources, open multiple results, cross-check exact addresses, include direct URLs and dates, distinguish fact from inference, and do not stop after obvious search results.", input: pass.prompt(job), max_output_tokens: Number(process.env.OPENAI_SITE_RESEARCH_PASS_TOKENS || 14000) };
}
function synthesisPrompt(job) {
  const selected = job.sections.map((key) => `${key}: ${SECTION_CATALOG[key]}`).join("\n");
  const evidence = job.passes.map((p) => `\n===== ${p.label.toUpperCase()} =====\n${p.output}`).join("\n");
  const urls = job.sources.map((s, i) => `S${i + 1}: ${s.title} | ${s.url}`).join("\n");
  return `Synthesize the exhaustive research below into one detailed Fuel IQ site report. Do not omit useful named projects, competitors, property fields, calculations, conflicts, or data gaps. Use the exact selected section keys and preserve source IDs.\n\nADDRESS: ${job.address}\nSELECTED SECTIONS:\n${selected}\n\nSOURCE REGISTER:\n${urls}\n\nRESEARCH EVIDENCE:\n${evidence}\n\nReturn exactly one JSON object with: prepared_at,address,title,disclaimer,property_records,sections,source_register. property_records must include summary, owner_name, owner_type, owner_mailing_address, situs_address, parcel_id, county, assessed_value, last_sale_date, last_sale_price, lot_size, building_size, year_built, zoning, current_use, legal_description, tax_status, confidence, source_ids, record_details, not_found. Each section must include key,title,summary,findings[{topic,detail,site_implication,confidence,source_ids}],tables[{title,columns,rows}],calculations,cautions. Include one section for every selected key in the same order. Current competition must be limited to 1.5 miles and must not claim zero unless multiple sources support zero. Use empty arrays, never omit required fields.`;
}
function synthesisPayload(job, model) {
  return { model, background: true, store: true, instructions: "You are a precise report synthesizer. Use only supplied research evidence, preserve uncertainty and URLs, and return one valid JSON object without markdown.", input: synthesisPrompt(job), max_output_tokens: Number(process.env.OPENAI_SITE_RESEARCH_SYNTHESIS_TOKENS || 30000), text: { format: { type: "json_object" } } };
}
function apiError(status, text, model) { let detail = ""; try { detail = JSON.parse(text)?.error?.message || ""; } catch {} return new Error(`OpenAI ${status} (${model}): ${clean(detail || text || "Request failed", 1600)}`); }
async function createResponse(apiKey, fetchWithTimeout, payload, model) {
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) }, Number(process.env.OPENAI_SITE_RESEARCH_CREATE_TIMEOUT_MS || 70000));
  const text = await response.text(); if (!response.ok) throw apiError(response.status, text, model); const data = JSON.parse(text); if (!data?.id) throw new Error("OpenAI did not return a response ID."); return data;
}
async function retrieveResponse(apiKey, fetchWithTimeout, id) {
  const response = await fetchWithTimeout(`https://api.openai.com/v1/responses/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${apiKey}` } }, 50000);
  const text = await response.text(); if (!response.ok) throw apiError(response.status, text, "retrieval"); return JSON.parse(text);
}
async function startResearch(job, apiKey, fetchWithTimeout) {
  const preferred = clean(process.env.OPENAI_SITE_RESEARCH_MODEL, 100) || "gpt-4.1-mini";
  job.model = preferred; job.phase = "research"; job.status = "starting";
  for (const definition of PASSES) {
    const pass = { ...definition, status: "starting", responseId: "", output: "", error: "" };
    job.passes.push(pass);
    try { const data = await createResponse(apiKey, fetchWithTimeout, researchPayload(job, definition, preferred), preferred); pass.responseId = data.id; pass.status = data.status || "queued"; }
    catch (error) { pass.status = "failed"; pass.error = clean(error?.message || error, 1600); job.errors.push(pass.error); }
  }
  if (job.passes.every((p) => p.status === "failed")) { job.status = "failed"; job.message = "All exhaustive research passes failed to start."; return false; }
  job.status = "in_progress"; job.message = "Running focused exhaustive research passes."; return true;
}
async function startSynthesis(job, apiKey, fetchWithTimeout) {
  const models = unique([job.model, "gpt-4.1-mini", "gpt-4.1"]);
  for (const model of models) {
    try { const data = await createResponse(apiKey, fetchWithTimeout, synthesisPayload(job, model), model); job.synthesis = { responseId: data.id, status: data.status || "queued", model }; job.phase = "synthesis"; job.status = "in_progress"; job.message = "Cross-checking and synthesizing the exhaustive research."; return true; }
    catch (error) { job.errors.push(clean(error?.message || error, 1600)); }
  }
  job.status = "failed"; job.message = "Research completed, but report synthesis could not start."; return false;
}
function progress(job) {
  const done = job.passes.filter((p) => p.status === "completed").length;
  if (job.phase === "synthesis") return "Research passes are complete; cross-checking findings and building the sourced Word report…";
  const active = job.passes.find((p) => ["queued", "in_progress", "starting"].includes(p.status));
  return `Exhaustive search ${done}/${job.passes.length} complete${active ? ` — searching ${active.label}` : ""}…`;
}
async function refresh(job, apiKey, fetchWithTimeout) {
  if (["completed", "failed"].includes(job.status) || job.polling) return;
  job.polling = true;
  try {
    if (job.phase === "research") {
      for (const pass of job.passes) {
        if (!pass.responseId || ["completed", "failed"].includes(pass.status)) continue;
        try {
          const data = await retrieveResponse(apiKey, fetchWithTimeout, pass.responseId);
          pass.status = data.status;
          if (data.status === "completed") { pass.output = outputText(data); const found = sourcesFrom(data); job.sources.push(...found); }
          else if (!["queued", "in_progress"].includes(data.status)) { pass.status = "failed"; pass.error = clean(data?.error?.message || data?.incomplete_details?.reason || data.status, 1400); }
        } catch (error) { pass.error = clean(error?.message || error, 1400); }
      }
      const terminal = job.passes.every((p) => ["completed", "failed"].includes(p.status));
      if (terminal) {
        if (!job.passes.some((p) => p.status === "completed" && p.output)) { job.status = "failed"; job.message = "The exhaustive searches returned no usable evidence."; return; }
        const deduped = new Map(); for (const s of job.sources) { const k = s.url || s.title; if (k && !deduped.has(k)) deduped.set(k, s); } job.sources = [...deduped.values()];
        await startSynthesis(job, apiKey, fetchWithTimeout);
      } else { job.status = "in_progress"; job.message = progress(job); }
      return;
    }
    if (job.phase === "synthesis") {
      const data = await retrieveResponse(apiKey, fetchWithTimeout, job.synthesis.responseId);
      job.synthesis.status = data.status;
      if (["queued", "in_progress"].includes(data.status)) { job.status = "in_progress"; return; }
      if (data.status !== "completed") { job.status = "failed"; job.message = "The final report synthesis failed."; return; }
      const report = normalizeReport(parseJson(outputText(data)), { address: job.address, sections: job.sections, model: job.synthesis.model, sources: job.sources, passes: job.passes.map((p) => ({ key: p.key, status: p.status })) });
      const reportId = crypto.randomUUID(); put(REPORTS, { id: reportId, report, expiresAt: Date.now() + CACHE_TTL_MS });
      job.status = "completed"; job.message = "Exhaustive site research complete."; job.result = { reportId, report, html: renderSiteReport(report), wordUrl: `/api/site-research/word/${reportId}` };
    }
  } catch (error) { job.errors.push(clean(error?.message || error, 1800)); job.status = "in_progress"; job.message = "A temporary research error occurred; Fuel IQ will retry on the next status check."; }
  finally { job.polling = false; }
}

function sourceIdsText(value) { const ids = sourceIds(value); return ids.length ? ids.join(", ") : "—"; }
function renderList(items) { const values = list(items).map((x) => clean(x, 6000)).filter(Boolean); return values.length ? `<ul>${values.map((x) => `<li>${html(x)}</li>`).join("")}</ul>` : ""; }
function renderTable(table) {
  const columns = list(table.columns), rows = list(table.rows), width = Math.max(columns.length, ...rows.map((r) => list(r).length), 1), headers = columns.length ? columns : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  return `${table.title ? `<h3>${html(table.title)}</h3>` : ""}<div class="table-wrap"><table><thead><tr>${headers.map((x) => `<th>${html(x)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${headers.map((_, i) => `<td>${html(list(r)[i] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function renderProperty(records) {
  const rows = PROPERTY_FIELDS.filter(([key]) => key === "owner_name" || clean(records?.[key])).map(([key, label]) => `<tr><th>${html(label)}</th><td>${html(clean(records?.[key]) || "Not publicly found")}</td></tr>`).join("");
  const details = list(records?.record_details);
  return `<section><h2>Property Records & Ownership</h2>${records?.summary ? `<p>${html(records.summary)}</p>` : ""}<table class="key-value"><tbody>${rows}</tbody></table>${details.length ? `<h3>Additional public-record details</h3><table><thead><tr><th>Record</th><th>Finding</th><th>Confidence</th><th>Sources</th></tr></thead><tbody>${details.map((x) => `<tr><td>${html(x.field)}</td><td>${html(x.value)}</td><td>${html(x.confidence)}</td><td>${html(sourceIdsText(x.source_ids))}</td></tr>`).join("")}</tbody></table>` : ""}${records?.not_found?.length ? `<h3>Not publicly confirmed</h3>${renderList(records.not_found)}` : ""}</section>`;
}
function renderSection(section) {
  const findings = list(section.findings);
  return `<section><h2>${html(section.title)}</h2>${section.summary ? `<p>${html(section.summary)}</p>` : ""}${findings.length ? `<table><thead><tr><th>Topic</th><th>Public finding</th><th>Site implication</th><th>Confidence</th><th>Sources</th></tr></thead><tbody>${findings.map((x) => `<tr><td>${html(x.topic)}</td><td>${html(x.detail)}</td><td>${html(x.site_implication)}</td><td>${html(x.confidence)}</td><td>${html(sourceIdsText(x.source_ids))}</td></tr>`).join("")}</tbody></table>` : ""}${list(section.tables).map(renderTable).join("")}${section.calculations?.length ? `<h3>Calculations and sensitivity</h3>${renderList(section.calculations)}` : ""}${section.cautions?.length ? `<h3>Cautions and verification items</h3>${renderList(section.cautions)}` : ""}</section>`;
}
function renderSources(sources) { return `<section><h2>Source Register</h2><table><thead><tr><th>ID</th><th>Source</th><th>Type</th><th>Why it matters</th><th>Confidence</th></tr></thead><tbody>${list(sources).map((s) => `<tr><td>${html(s.id)}</td><td>${s.url ? `<a href="${attr(s.url)}">${html(s.title || s.url)}</a>` : html(s.title)}</td><td>${html(s.source_type)}</td><td>${html(s.why_it_matters)}</td><td>${html(s.confidence)}</td></tr>`).join("")}</tbody></table></section>`; }
export function renderSiteReport(report, options = {}) {
  const body = `<article class="site-research-report"><header><h1>${html(report.title)}</h1><p class="site-report-address">${html(report.address)}</p><p class="site-report-prepared">Prepared ${html(report.prepared_at)}</p></header><div class="site-report-disclaimer">${html(report.disclaimer)}</div>${renderProperty(report.property_records || {})}${list(report.sections).map(renderSection).join("")}${renderSources(report.source_register)}</article>`;
  if (!options.document) return body;
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${html(report.title)}</title><style>body{font-family:Arial,sans-serif;color:#172033;font-size:10.5pt;line-height:1.45;margin:32px}h1{font-size:20pt;color:#0b1f33}h2{font-size:14pt;color:#123d61;border-bottom:1px solid #cbd5e1;padding-bottom:4px;margin-top:22px}h3{font-size:11.5pt;color:#334155}table{width:100%;border-collapse:collapse;margin:8px 0 14px}th,td{border:1px solid #cbd5e1;padding:6px;vertical-align:top;text-align:left}th{background:#e2e8f0}.key-value th{width:28%}.site-report-disclaimer{background:#f1f5f9;border:1px solid #cbd5e1;padding:10px}.site-report-address{font-size:12pt;font-weight:bold}a{color:#0b5ea8}</style></head><body>${body}</body></html>`;
}

export function registerSiteResearchRoutes(app, options = {}) {
  const router = express.Router(); const apiKey = options.openAiApiKey || process.env.OPENAI_API_KEY || "";
  const fetchWithTimeout = options.fetchWithTimeout || (async (url, init = {}, timeoutMs = 30000) => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await fetch(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); } });
  router.use(express.json({ limit: "4mb" }));
  router.get("/status", (_req, res) => res.json({ ok: true, openAiEnabled: Boolean(apiKey), backgroundResearch: true, multiPassExhaustiveSearch: true, defaultModel: process.env.OPENAI_SITE_RESEARCH_MODEL || "gpt-4.1-mini", propertyRecordsAlwaysIncluded: true, competitionRadiusMiles: 1.5, wordExport: true, sectionKeys: DEFAULT_SECTIONS, reportCacheHours: 24 }));
  router.post("/research", async (req, res) => {
    const address = clean(req.body?.address, 700), requested = unique(list(req.body?.sections).map((x) => clean(x, 120)).filter((x) => SECTION_CATALOG[x])), sections = requested.length ? requested : DEFAULT_SECTIONS;
    if (address.length < 4) return res.status(400).json({ ok: false, message: "Enter and select a valid site address." });
    if (!apiKey) return res.status(503).json({ ok: false, message: "OPENAI_API_KEY is not configured on the server." });
    const job = put(JOBS, { id: crypto.randomUUID(), address, sections, siteNotes: clean(req.body?.siteNotes, 4000), normalizedAddress: req.body?.normalizedAddress && typeof req.body.normalizedAddress === "object" ? req.body.normalizedAddress : null, estimateContext: req.body?.estimateContext && typeof req.body.estimateContext === "object" ? req.body.estimateContext : null, createdAt: Date.now(), expiresAt: Date.now() + CACHE_TTL_MS, status: "starting", phase: "research", message: "Starting focused exhaustive research passes…", model: "", passes: [], sources: [], synthesis: null, errors: [], polling: false, result: null }, 50);
    if (!await startResearch(job, apiKey, fetchWithTimeout)) return res.status(502).json({ ok: false, jobId: job.id, status: job.status, message: job.message });
    res.status(202).json({ ok: true, jobId: job.id, status: job.status, message: progress(job), elapsedSeconds: 0, attempt: 1, maxAttempts: PASSES.length + 1 });
  });
  router.get("/research/:jobId", async (req, res) => {
    const job = get(JOBS, req.params.jobId, 50); if (!job) return res.status(404).json({ ok: false, status: "expired", message: "This research job expired or the server restarted. Start the search again." });
    await refresh(job, apiKey, fetchWithTimeout);
    const base = { ok: job.status !== "failed", jobId: job.id, status: job.status, model: job.model, message: job.status === "completed" ? job.message : progress(job), elapsedSeconds: Math.floor((Date.now() - job.createdAt) / 1000), attempt: job.passes.filter((p) => p.status === "completed").length + (job.phase === "synthesis" ? 1 : 0), maxAttempts: PASSES.length + 1 };
    res.status(job.status === "failed" ? 502 : 200).json(job.status === "completed" ? { ...base, ...job.result } : job.status === "failed" ? { ...base, detail: clean(job.errors.at(-1), 1400) } : base);
  });
  router.get("/report/:id", (req, res) => { const record = get(REPORTS, req.params.id); if (!record) return res.status(404).json({ ok: false, message: "Report expired or was not found." }); res.json({ ok: true, report: record.report, html: renderSiteReport(record.report), wordUrl: `/api/site-research/word/${req.params.id}` }); });
  router.get("/word/:id", (req, res) => { const record = get(REPORTS, req.params.id); if (!record) return res.status(404).send("Report expired or was not found."); res.setHeader("Content-Type", "application/msword; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="${slug(record.report.address)}-fuel-iq-site-report.doc"`); res.setHeader("Cache-Control", "no-store"); res.send(renderSiteReport(record.report, { document: true })); });
  router.post("/word", (req, res) => { try { const raw = req.body?.report || {}; const sections = unique(list(raw?._meta?.selected_sections || raw?.sections?.map?.((s) => s?.key)).map((x) => clean(x, 120)).filter((x) => SECTION_CATALOG[x])); const report = normalizeReport(raw, { address: clean(raw.address || "Fuel IQ Site", 700), sections: sections.length ? sections : DEFAULT_SECTIONS, model: clean(raw?._meta?.model, 100), sources: [], passes: [] }); res.setHeader("Content-Type", "application/msword; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="${slug(report.address)}-fuel-iq-site-report.doc"`); res.send(renderSiteReport(report, { document: true })); } catch (error) { res.status(400).json({ ok: false, message: clean(error?.message || error, 1200) }); } });
  app.use("/api/site-research", router);
}
