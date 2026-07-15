import express from "express";
import crypto from "crypto";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REPORT_CACHE = new Map();
const JOB_CACHE = new Map();

const SECTION_CATALOG = {
  executive_read: {
    title: "Executive Read",
    guidance: "Give the overall investment and underwriting view, the most important demand drivers, the principal cautions, and the recommended way to frame the opportunity.",
  },
  metric_detail: {
    title: "Metric Detail",
    guidance: "Summarize the current site, Fuel IQ base/range, AADT source and math, operating profile, and the most important caveat. Show assumptions and arithmetic.",
  },
  site_snapshot: {
    title: "Site Snapshot",
    guidance: "Document address, current use and brand, parcel/building size, age/renovation, zoning, physical condition clues, access, and practical redevelopment implications.",
  },
  area_profile_demand_drivers: {
    title: "Area Profile and Demand Drivers",
    guidance: "Research population, households, income, commuting, employment, schools, retail patterns, road access, trip purposes, and other demand drivers relevant to fuel and convenience sales.",
  },
  residential_growth: {
    title: "Residential Growth",
    guidance: "Identify active, approved, proposed, and recently delivered residential projects. Include project name, units/lots, status, distance or relationship to the site, timing, sources, and likely traffic/convenience implications.",
  },
  commercial_retail_growth: {
    title: "Commercial and Retail Growth",
    guidance: "Identify retail, grocery, restaurant, office, medical, daycare, industrial, flex, warehouse, and mixed-use projects. Include size, status, timing, relevance, and possible fuel/diesel demand.",
  },
  traffic_volume: {
    title: "Traffic and Volume Read",
    guidance: "Verify official AADT/count stations when possible, explain frontage relevance, show Fuel IQ capture-rate sensitivity and gallons math, discuss access/turn movements, and identify data gaps.",
  },
  current_competition: {
    title: "Current Competition",
    guidance: "Build a current competitive set with brand/name, address, approximate distance, format, operating features, diesel/car wash/food clues, and competitive relevance. Field-verification caveats must be explicit.",
  },
  competition_growth_future_risk: {
    title: "Competition Growth and Future Risk",
    guidance: "Search planning agendas, approvals, redevelopment files, permits, news, and development plans for future fuel, convenience, grocery fuel, travel-center, and modern-format competition.",
  },
  strengths_weaknesses_due_diligence: {
    title: "Strengths, Weaknesses, and Key Due Diligence",
    guidance: "Separate strengths, weaknesses, red flags, missing information, and prioritized diligence actions covering access, signage, tanks, environmental history, condition, ADA, lighting, foodservice, diesel/fleet, and local approvals.",
  },
  recommended_site_positioning: {
    title: "Recommended Site Positioning",
    guidance: "Recommend practical positioning for forecourt, price visibility, store, food/beverage, diesel/fleet, access, brand/loyalty, modernization, and redevelopment. Tie each recommendation to public findings.",
  },
  revised_conclusion: {
    title: "Revised Conclusion",
    guidance: "Provide the balanced final conclusion, a practical gallon range and most-likely case when supportable, the conditions needed for upside, and the principal reasons the opportunity could underperform.",
  },
  sources_notes: {
    title: "Sources and Notes",
    guidance: "Explain methodology, verification limits, stale-record risks, conflicting evidence, field-verification needs, and which official records should be checked before final underwriting.",
  },
};

const DEFAULT_SECTION_KEYS = Object.keys(SECTION_CATALOG);
const PROPERTY_FIELDS = [
  ["owner_name", "Owner of record"],
  ["owner_type", "Owner type"],
  ["owner_mailing_address", "Owner mailing address"],
  ["situs_address", "Property address"],
  ["parcel_id", "Parcel / tax ID"],
  ["county", "County / jurisdiction"],
  ["assessed_value", "Assessed value"],
  ["last_sale_date", "Last sale date"],
  ["last_sale_price", "Last sale price"],
  ["lot_size", "Lot size"],
  ["building_size", "Building size"],
  ["year_built", "Year built / renovated"],
  ["zoning", "Zoning"],
  ["current_use", "Current use"],
  ["legal_description", "Legal description"],
  ["tax_status", "Tax status"],
  ["confidence", "Confidence"],
];

const clean = (value, max = 30000) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const list = (value) => Array.isArray(value) ? value : (value == null || value === "" ? [] : [value]);
const unique = (values) => [...new Set(values.filter(Boolean))];
const slug = (value) => clean(value, 140).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fuel-iq-site-report";

function html(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attr(value) {
  return html(value).replace(/`/g, "&#96;");
}

function validUrl(value) {
  const raw = clean(value, 2000);
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function prune(map, limit = 100) {
  const now = Date.now();
  for (const [id, record] of map) {
    if (record.expiresAt <= now) map.delete(id);
  }
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
  if (value) value.expiresAt = Date.now() + CACHE_TTL_MS;
  return value || null;
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  return (payload?.output || [])
    .flatMap((item) => item?.type === "message" ? (item.content || []) : [])
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function sourcesFrom(payload) {
  const result = [];
  const seen = new Set();
  const add = (rawUrl, rawTitle, type = "OpenAI web-search citation") => {
    const url = validUrl(rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    result.push({
      id: "",
      title: clean(rawTitle || url, 500),
      url,
      source_type: type,
      why_it_matters: "Returned by the OpenAI web-search tool for this site report.",
      confidence: "Supporting source",
    });
  };
  for (const item of payload?.output || []) {
    if (item?.type === "message") {
      for (const part of item.content || []) {
        for (const annotation of part?.annotations || []) {
          if (annotation?.type === "url_citation") add(annotation.url, annotation.title);
        }
      }
    }
    if (item?.type === "web_search_call") {
      for (const source of item?.action?.sources || []) add(source.url, source.title, "OpenAI web-search source");
    }
  }
  return result;
}

function parseReport(text) {
  let value = clean(text, 900000).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The completed response did not contain a JSON site report.");
  return JSON.parse(value.slice(start, end + 1));
}

function normalizeSourceIds(value) {
  return list(value).map((item) => clean(item, 120)).filter(Boolean);
}

function normalizeFinding(raw) {
  const value = raw && typeof raw === "object" ? raw : { detail: raw };
  return {
    topic: clean(value.topic || value.item || value.metric || value.project || value.finding, 500),
    detail: clean(value.detail || value.public_finding || value.description || value.evidence || value.value, 6000),
    site_implication: clean(value.site_implication || value.implication || value.relevance || value.underwriting_implication, 4000),
    confidence: clean(value.confidence || value.status, 200),
    source_ids: normalizeSourceIds(value.source_ids || value.sources),
  };
}

function normalizeTable(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const columns = list(value.columns || value.headers).map((item) => clean(item, 300)).filter(Boolean).slice(0, 12);
  const rows = list(value.rows).map((row) => {
    if (Array.isArray(row)) return row.slice(0, Math.max(columns.length, 12)).map((cell) => clean(cell, 3000));
    if (row && typeof row === "object") {
      if (columns.length) return columns.map((column) => clean(row[column] ?? row[column.toLowerCase()] ?? "", 3000));
      return Object.values(row).slice(0, 12).map((cell) => clean(cell, 3000));
    }
    return [clean(row, 3000)];
  }).filter((row) => row.some(Boolean)).slice(0, 100);
  return {
    title: clean(value.title || value.name, 500),
    columns,
    rows,
  };
}

function normalizeSection(raw, key) {
  const value = raw && typeof raw === "object" ? raw : {};
  const catalog = SECTION_CATALOG[key] || { title: key };
  const findings = list(value.findings || value.items || value.projects || value.metrics || value.recommendations)
    .map(normalizeFinding)
    .filter((item) => item.topic || item.detail || item.site_implication);
  return {
    key,
    title: clean(value.title || catalog.title, 500),
    summary: clean(value.summary || value.narrative || value.overview || value.conclusion, 12000),
    findings,
    tables: list(value.tables).map(normalizeTable).filter((table) => table.columns.length || table.rows.length),
    calculations: list(value.calculations || value.math || value.sensitivity_analysis).map((item) => clean(item, 4000)).filter(Boolean),
    cautions: list(value.cautions || value.caveats || value.data_gaps || value.notes).map((item) => clean(item, 4000)).filter(Boolean),
  };
}

function normalizePropertyRecords(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  for (const [key] of PROPERTY_FIELDS) normalized[key] = clean(value[key], 3000);
  normalized.summary = clean(value.summary || value.overview, 10000);
  normalized.record_details = list(value.record_details || value.details || value.additional_records)
    .map((item) => {
      const record = item && typeof item === "object" ? item : { value: item };
      return {
        field: clean(record.field || record.item || record.record, 500),
        value: clean(record.value || record.detail || record.finding, 5000),
        confidence: clean(record.confidence || record.status, 200),
        source_ids: normalizeSourceIds(record.source_ids || record.sources),
      };
    })
    .filter((item) => item.field || item.value);
  normalized.not_found = list(value.not_found || value.data_gaps || value.missing)
    .map((item) => clean(item, 2000))
    .filter(Boolean);
  normalized.source_ids = normalizeSourceIds(value.source_ids || value.sources);
  return normalized;
}

function normalizeSources(rawSources, annotationSources = []) {
  const output = [];
  const seenUrls = new Set();
  const usedIds = new Set();
  const add = (raw, fromModel = false) => {
    if (!raw || typeof raw !== "object") return;
    const url = validUrl(raw.url || raw.public_url);
    if (url && seenUrls.has(url)) return;
    let id = clean(raw.id, 80);
    if (!id || usedIds.has(id)) {
      let next = output.length + 1;
      while (usedIds.has(`S${next}`)) next += 1;
      id = `S${next}`;
    }
    usedIds.add(id);
    if (url) seenUrls.add(url);
    output.push({
      id,
      title: clean(raw.title || raw.source || raw.name || url || "Public source", 700),
      url,
      source_type: clean(raw.source_type || raw.type || (fromModel ? "Public source" : "OpenAI web-search source"), 300),
      why_it_matters: clean(raw.why_it_matters || raw.notes || raw.description || "", 2500),
      confidence: clean(raw.confidence || "", 200),
    });
  };
  for (const source of list(rawSources)) add(source, true);
  for (const source of annotationSources) add(source, false);
  return output;
}

function normalizeReport(raw, meta) {
  const report = raw && typeof raw === "object" ? raw : {};
  const rawSections = Array.isArray(report.sections) ? report.sections : [];
  const byKey = new Map();
  for (const section of rawSections) {
    const key = clean(section?.key, 120);
    if (key) byKey.set(key, section);
  }
  for (const key of meta.sections) {
    if (!byKey.has(key) && report[key] && typeof report[key] === "object") byKey.set(key, { ...report[key], key });
  }

  const normalized = {
    prepared_at: clean(report.prepared_at || new Date().toISOString(), 120),
    address: clean(report.address || meta.address, 700),
    title: clean(report.title || `${meta.address} Detailed Site & Market Summary`, 900),
    disclaimer: clean(report.disclaimer || "Public-source research and model-assisted analysis only. Verify property, traffic, zoning, environmental, development, ownership, and competition findings with the controlling official records and field diligence before underwriting.", 3000),
    property_records: normalizePropertyRecords(report.property_records || report.property_ownership),
    sections: meta.sections.map((key) => normalizeSection(byKey.get(key), key)),
    source_register: normalizeSources(report.source_register || report.sources || report.appendices?.source_register, meta.sources || []),
  };
  normalized._meta = {
    generated_at: new Date().toISOString(),
    model: meta.model || "",
    response_id: meta.responseId || "",
    attempts: meta.attempts || [],
    selected_sections: meta.sections,
  };
  return normalized;
}

function compactEstimate(value) {
  if (!value || typeof value !== "object") return null;
  return {
    aadtText: value.aadtText || "",
    competitionText: value.competitionText || "",
    base: value.base ?? value.estimate?.base ?? null,
    low: value.low ?? value.estimate?.low ?? null,
    high: value.high ?? value.estimate?.high ?? null,
    year2: value.year2 ?? value.estimate?.year2 ?? null,
    year3: value.year3 ?? value.estimate?.year3 ?? null,
    inputs: value.inputs || null,
    flags: value.flags || null,
    competition: value.competition || null,
    roads: value.roads || null,
    developments: list(value.csv).slice(0, 20),
    calc_breakdown: value.calc_breakdown || null,
  };
}

function prompt(job) {
  const selected = job.sections.map((key, index) => {
    const section = SECTION_CATALOG[key];
    return `${index + 1}. ${section.title} [key: ${key}] — ${section.guidance}`;
  }).join("\n");
  const estimate = compactEstimate(job.estimateContext);
  const normalizedAddress = job.normalizedAddress && typeof job.normalizedAddress === "object" ? job.normalizedAddress : null;

  return `Create an exhaustive, current, public-source fuel-site and market report for the exact property below.

TARGET ADDRESS: ${job.address}
NORMALIZED ADDRESS / COORDINATES: ${JSON.stringify(normalizedAddress || {})}
USER SITE NOTES: ${job.siteNotes || "None supplied"}
EXISTING FUEL IQ ESTIMATE CONTEXT (use as a starting point, not as independent proof): ${JSON.stringify(estimate || {})}

PROPERTY RECORDS ARE ALWAYS REQUIRED:
- Determine the controlling county/municipality and search official assessor, tax, GIS, parcel, register-of-deeds, zoning, and related public property records.
- Return the current owner of record by name when publicly available. Distinguish a natural person from an LLC/corporation/trust. Never infer the people behind an entity unless an official public source proves it.
- Capture parcel/tax ID, situs and owner mailing addresses, acreage/lot size, building area, year built/renovated, assessed value, last recorded sale/date/price, zoning/current use, legal description, tax status, and record caveats when available.
- If an item cannot be confirmed, state "not publicly found" rather than guessing. Identify the official record that should be checked manually.

SELECTED REPORT SECTIONS:
${selected}

RESEARCH EXPECTATIONS:
- Use live web search extensively and cross-check multiple sources.
- Prioritize official county/municipal parcel and planning systems, state DOT traffic-count sources, U.S. Census/ACS, state environmental/UST databases, official development applications and agendas, official station/brand pages, company sites, and reputable local news. Use listing sites and directories only as lower-confidence clues.
- Search beyond the first page of obvious results. Look for alternate project names, parcel numbers, owner/entity names, planning case numbers, meeting packets, permit records, redevelopment approvals, maps, and archived pages.
- Verify the exact address and frontage. Do not silently substitute a nearby property, road segment, or similarly named project.
- For developments, distinguish proposed, approved, under construction, completed, withdrawn, and stale plans. Include scale, timing, relevance, and source dates.
- For competition, distinguish current operating sites from planned, closed, redeveloped, or uncertain sites. Include address and approximate relationship to the target.
- For traffic and gallons, clearly separate official counts, user-entered values, Fuel IQ model assumptions, and your own sensitivity calculations. Show arithmetic.
- Every material factual claim should carry source IDs such as S1 or S2. Put direct URLs in the source register.
- Separate confirmed facts, public clues, model estimates, and field-verification items. Include conflicting evidence and negative findings.
- Do not invent private facts or beneficial ownership. Avoid overstating what property, station-locator, UST, planning, or directory records prove.

Return exactly one valid JSON object and no markdown. Use this structure:
{
  "prepared_at": "ISO date-time",
  "address": "exact target address",
  "title": "Detailed Site & Market Summary",
  "disclaimer": "verification disclaimer",
  "property_records": {
    "summary": "narrative with source IDs",
    "owner_name": "public owner of record or not publicly found",
    "owner_type": "person, LLC, corporation, trust, government, or unknown",
    "owner_mailing_address": "",
    "situs_address": "",
    "parcel_id": "",
    "county": "",
    "assessed_value": "",
    "last_sale_date": "",
    "last_sale_price": "",
    "lot_size": "",
    "building_size": "",
    "year_built": "",
    "zoning": "",
    "current_use": "",
    "legal_description": "",
    "tax_status": "",
    "confidence": "",
    "source_ids": ["S1"],
    "record_details": [{"field":"", "value":"", "confidence":"", "source_ids":["S1"]}],
    "not_found": [""]
  },
  "sections": [
    {
      "key": "one selected key exactly",
      "title": "section title",
      "summary": "detailed narrative with source IDs",
      "findings": [{"topic":"", "detail":"", "site_implication":"", "confidence":"", "source_ids":["S1"]}],
      "tables": [{"title":"", "columns":["Column 1","Column 2"], "rows":[["value","value"]]}],
      "calculations": ["formula, assumptions, arithmetic, result"],
      "cautions": ["data gap, conflict, or field-verification item"]
    }
  ],
  "source_register": [{"id":"S1", "title":"", "url":"https://...", "source_type":"official assessor / DOT / planning / company / news / directory", "why_it_matters":"", "confidence":""}]
}

Return one section object for every selected key, in the same order. Use empty arrays instead of omitting fields.`;
}

function attempts() {
  const requested = clean(process.env.OPENAI_SITE_RESEARCH_MODEL, 100);
  return unique([requested, "gpt-5.6", "gpt-5.5", "gpt-4.1"])
    .map((model) => ({ model, reasoning: /^gpt-5/i.test(model) ? "high" : "" }));
}

function payloadFor(job, attempt) {
  const body = {
    model: attempt.model,
    background: true,
    store: true,
    tools: [{ type: "web_search", search_context_size: "high" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    instructions: "You are a rigorous fuel-site, real-estate, traffic, development, and convenience-retail research analyst. Use exhaustive live web search, favor controlling official records, distinguish fact from inference, and return exactly one valid JSON object.",
    input: prompt(job),
    max_output_tokens: Number(process.env.OPENAI_SITE_RESEARCH_MAX_OUTPUT_TOKENS || 48000),
  };
  if (attempt.reasoning) body.reasoning = { effort: attempt.reasoning };
  return body;
}

function apiError(status, text, model) {
  let detail = "";
  try { detail = JSON.parse(text)?.error?.message || ""; } catch {}
  return new Error(`OpenAI ${status} (${model}): ${clean(detail || text || "Request failed", 1400)}`);
}

function publicError(error) {
  const text = clean(error?.message || error, 1800);
  if (/429|rate.?limit/i.test(text)) return "OpenAI is temporarily rate-limited. Retry in a few minutes.";
  if (/quota|billing|credit|insufficient_quota/i.test(text)) return "The OpenAI API account needs credits or billing access.";
  if (/401|invalid api key|authentication/i.test(text)) return "The OpenAI API key is invalid or unauthorized.";
  if (/token|max_output|incomplete/i.test(text)) return "The site report exceeded the model output allowance after automatic retries.";
  return "The exhaustive site research could not be completed after automatic retries.";
}

async function startNext(job, apiKey, fetchWithTimeout, priorError = "") {
  if (priorError) job.errors.push(clean(priorError, 1800));
  while (job.next < job.attempts.length) {
    const attempt = job.attempts[job.next++];
    job.status = "starting";
    job.message = `Starting ${attempt.model} exhaustive site research…`;
    try {
      const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payloadFor(job, attempt)),
      }, Number(process.env.OPENAI_SITE_RESEARCH_CREATE_TIMEOUT_MS || 60000));
      const text = await response.text();
      if (!response.ok) throw apiError(response.status, text, attempt.model);
      const data = JSON.parse(text);
      if (!data?.id) throw new Error(`OpenAI did not return a response ID for ${attempt.model}.`);
      job.responseId = data.id;
      job.model = attempt.model;
      job.status = data.status || "queued";
      job.message = "OpenAI is searching public property, traffic, planning, development, competition, and market sources.";
      job.attemptLog.push({ model: attempt.model, responseId: data.id, startedAt: new Date().toISOString() });
      return true;
    } catch (error) {
      job.errors.push(clean(error?.message || error, 1800));
      job.attemptLog.push({ model: attempt.model, failedToStart: true, error: clean(error?.message || error, 900) });
    }
  }
  job.status = "failed";
  job.message = publicError(job.errors.at(-1));
  return false;
}

function progress(job) {
  const seconds = Math.floor((Date.now() - job.createdAt) / 1000);
  if (seconds < 60) return "Confirming the exact parcel, jurisdiction, and official property-record systems…";
  if (seconds < 150) return "Searching assessor, tax, deed, zoning, UST, and owner-of-record sources…";
  if (seconds < 260) return "Checking official traffic counts, access, current competitors, and planned fuel competition…";
  if (seconds < 380) return "Researching residential, commercial, retail, industrial, and mixed-use growth…";
  if (seconds < 520) return "Cross-checking market demand, risks, positioning, calculations, and source citations…";
  return "The exhaustive background search is still running. Fuel IQ will keep checking until it finishes.";
}

function jobJson(job) {
  const base = {
    ok: job.status !== "failed",
    jobId: job.id,
    status: job.status,
    model: job.model || "",
    message: ["queued", "in_progress", "starting"].includes(job.status) ? progress(job) : job.message,
    elapsedSeconds: Math.floor((Date.now() - job.createdAt) / 1000),
    attempt: Math.max(1, job.next),
    maxAttempts: job.attempts.length,
  };
  if (job.status === "completed") return { ...base, ...job.result };
  if (job.status === "failed") return { ...base, ok: false, detail: clean(job.errors.at(-1), 1200) };
  return base;
}

async function refresh(job, apiKey, fetchWithTimeout) {
  if (["completed", "failed"].includes(job.status) || job.polling) return;
  job.polling = true;
  try {
    const response = await fetchWithTimeout(
      `https://api.openai.com/v1/responses/${encodeURIComponent(job.responseId)}`,
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } },
      45000,
    );
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
        const report = normalizeReport(parseReport(outputText(data)), {
          address: job.address,
          sections: job.sections,
          model: job.model,
          responseId: data.id,
          attempts: job.attemptLog,
          sources: sourcesFrom(data),
        });
        const reportId = crypto.randomUUID();
        put(REPORT_CACHE, { id: reportId, report, expiresAt: Date.now() + CACHE_TTL_MS });
        job.status = "completed";
        job.message = "Exhaustive site research complete.";
        job.result = {
          reportId,
          report,
          html: renderSiteReport(report),
          wordUrl: `/api/site-research/word/${reportId}`,
        };
        return;
      } catch (error) {
        await startNext(job, apiKey, fetchWithTimeout, `Completed output could not be converted into a site report: ${error?.message || error}`);
        return;
      }
    }
    const reason = data?.error?.message || data?.incomplete_details?.reason || `status ${data.status}`;
    await startNext(job, apiKey, fetchWithTimeout, `${job.model} ended with ${reason}`);
  } catch (error) {
    job.pollErrors += 1;
    job.errors.push(clean(`Status check ${job.pollErrors}: ${error?.message || error}`, 1800));
    if (job.pollErrors <= 5) {
      job.status = "in_progress";
      job.message = "The research is still running; Fuel IQ is retrying a temporary status-check error.";
    } else {
      job.pollErrors = 0;
      await startNext(job, apiKey, fetchWithTimeout, error?.message || error);
    }
  } finally {
    job.polling = false;
  }
}

function sourceIdsText(value) {
  const ids = normalizeSourceIds(value);
  return ids.length ? ids.join(", ") : "—";
}

function renderList(items, className = "") {
  const values = list(items).map((item) => clean(item, 5000)).filter(Boolean);
  if (!values.length) return "";
  return `<ul${className ? ` class="${attr(className)}"` : ""}>${values.map((item) => `<li>${html(item)}</li>`).join("")}</ul>`;
}

function renderPropertyRecords(records) {
  const rows = PROPERTY_FIELDS
    .filter(([key]) => key === "owner_name" || clean(records?.[key]))
    .map(([key, label]) => `<tr><th>${html(label)}</th><td>${html(clean(records?.[key]) || "Not publicly found")}</td></tr>`)
    .join("");
  const details = list(records?.record_details);
  const detailsTable = details.length ? `
    <h3>Additional public-record details</h3>
    <table><thead><tr><th>Record</th><th>Public finding</th><th>Confidence</th><th>Sources</th></tr></thead><tbody>
      ${details.map((item) => `<tr><td>${html(item.field)}</td><td>${html(item.value)}</td><td>${html(item.confidence || "—")}</td><td>${html(sourceIdsText(item.source_ids))}</td></tr>`).join("")}
    </tbody></table>` : "";
  return `
    <section class="site-report-section property-records">
      <h2>Property Records & Ownership</h2>
      ${records?.summary ? `<p>${html(records.summary)}</p>` : ""}
      <table class="key-value"><tbody>${rows}</tbody></table>
      ${detailsTable}
      ${records?.source_ids?.length ? `<p class="source-ids"><b>Primary sources:</b> ${html(sourceIdsText(records.source_ids))}</p>` : ""}
      ${records?.not_found?.length ? `<h3>Not publicly confirmed</h3>${renderList(records.not_found)}` : ""}
    </section>`;
}

function renderGenericTable(table) {
  const columns = list(table.columns);
  const rows = list(table.rows);
  const width = Math.max(columns.length, ...rows.map((row) => list(row).length), 1);
  const headers = columns.length ? columns : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  return `
    ${table.title ? `<h3>${html(table.title)}</h3>` : ""}
    <div class="table-wrap"><table><thead><tr>${headers.map((column) => `<th>${html(column)}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((row) => {
        const cells = list(row);
        return `<tr>${Array.from({ length: headers.length }, (_, index) => `<td>${html(cells[index] || "")}</td>`).join("")}</tr>`;
      }).join("")}
    </tbody></table></div>`;
}

function renderSection(section) {
  const findings = list(section.findings);
  const findingTable = findings.length ? `
    <div class="table-wrap"><table><thead><tr><th>Topic</th><th>Public finding</th><th>Site implication</th><th>Confidence</th><th>Sources</th></tr></thead><tbody>
      ${findings.map((item) => `<tr><td>${html(item.topic)}</td><td>${html(item.detail)}</td><td>${html(item.site_implication)}</td><td>${html(item.confidence || "—")}</td><td>${html(sourceIdsText(item.source_ids))}</td></tr>`).join("")}
    </tbody></table></div>` : "";
  const tables = list(section.tables).map(renderGenericTable).join("");
  const calculations = section.calculations?.length ? `<h3>Calculations and sensitivity</h3>${renderList(section.calculations)}` : "";
  const cautions = section.cautions?.length ? `<h3>Cautions and verification items</h3>${renderList(section.cautions)}` : "";
  const hasContent = section.summary || findings.length || section.tables?.length || section.calculations?.length || section.cautions?.length;
  return `
    <section class="site-report-section" data-section-key="${attr(section.key)}">
      <h2>${html(section.title)}</h2>
      ${section.summary ? `<p>${html(section.summary)}</p>` : ""}
      ${findingTable}${tables}${calculations}${cautions}
      ${hasContent ? "" : "<p>Not publicly found.</p>"}
    </section>`;
}

function renderSources(sources) {
  const items = list(sources);
  if (!items.length) return "";
  return `
    <section class="site-report-section sources">
      <h2>Source Register</h2>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>Source</th><th>Type</th><th>Why it matters</th><th>Confidence</th></tr></thead><tbody>
        ${items.map((source) => {
          const title = html(source.title || source.url || "Public source");
          const link = source.url ? `<a href="${attr(source.url)}">${title}</a>` : title;
          return `<tr><td>${html(source.id)}</td><td>${link}</td><td>${html(source.source_type)}</td><td>${html(source.why_it_matters)}</td><td>${html(source.confidence)}</td></tr>`;
        }).join("")}
      </tbody></table></div>
    </section>`;
}

export function renderSiteReport(report, options = {}) {
  const body = `
    <article class="site-research-report">
      <header class="site-report-header">
        <h1>${html(report.title)}</h1>
        <p class="site-report-address">${html(report.address)}</p>
        <p class="site-report-prepared">Prepared ${html(report.prepared_at)}</p>
      </header>
      <div class="site-report-disclaimer">${html(report.disclaimer)}</div>
      ${renderPropertyRecords(report.property_records || {})}
      ${list(report.sections).map(renderSection).join("")}
      ${renderSources(report.source_register)}
    </article>`;
  if (!options.document) return body;
  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="en">
<head>
<meta charset="utf-8">
<title>${html(report.title)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:10.5pt;line-height:1.45;margin:32px}
  h1{font-size:20pt;color:#0b1f33;margin:0 0 4px} h2{font-size:14pt;color:#123d61;border-bottom:1px solid #cbd5e1;padding-bottom:4px;margin-top:22px} h3{font-size:11.5pt;color:#334155;margin-top:16px}
  p{margin:7px 0} .site-report-address{font-size:12pt;font-weight:bold}.site-report-prepared{color:#64748b}.site-report-disclaimer{background:#f1f5f9;border:1px solid #cbd5e1;padding:10px;margin:14px 0}
  table{width:100%;border-collapse:collapse;margin:8px 0 14px;page-break-inside:auto} th,td{border:1px solid #cbd5e1;padding:6px;vertical-align:top;text-align:left} th{background:#e2e8f0;font-weight:bold}
  .key-value th{width:28%} ul{margin:6px 0 10px 20px;padding:0} li{margin:3px 0} a{color:#0b5ea8;text-decoration:underline}.source-ids{color:#475569}
</style>
</head><body>${body}</body></html>`;
}

export function registerSiteResearchRoutes(app, options = {}) {
  const router = express.Router();
  const apiKey = options.openAiApiKey || process.env.OPENAI_API_KEY || "";
  const fetchWithTimeout = options.fetchWithTimeout || (async (url, init = {}, timeoutMs = 30000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  });

  router.use(express.json({ limit: "3mb" }));

  router.get("/status", (_req, res) => {
    res.json({
      ok: true,
      openAiEnabled: Boolean(apiKey),
      backgroundResearch: true,
      propertyRecordsAlwaysIncluded: true,
      wordExport: true,
      sectionKeys: DEFAULT_SECTION_KEYS,
      reportCacheHours: CACHE_TTL_MS / 3600000,
    });
  });

  router.post("/research", async (req, res) => {
    const address = clean(req.body?.address, 700);
    const requested = unique(list(req.body?.sections).map((key) => clean(key, 120)).filter((key) => SECTION_CATALOG[key]));
    const sections = requested.length ? requested : DEFAULT_SECTION_KEYS;
    const siteNotes = clean(req.body?.siteNotes, 3000);
    const normalizedAddress = req.body?.normalizedAddress && typeof req.body.normalizedAddress === "object" ? req.body.normalizedAddress : null;
    const estimateContext = req.body?.estimateContext && typeof req.body.estimateContext === "object" ? req.body.estimateContext : null;

    if (address.length < 4) return res.status(400).json({ ok: false, message: "Enter and select a valid site address." });
    if (!apiKey) return res.status(503).json({ ok: false, message: "OPENAI_API_KEY is not configured on the server." });

    const job = put(JOB_CACHE, {
      id: crypto.randomUUID(),
      address,
      sections,
      siteNotes,
      normalizedAddress,
      estimateContext,
      createdAt: Date.now(),
      expiresAt: Date.now() + CACHE_TTL_MS,
      status: "starting",
      message: "Starting exhaustive site research…",
      attempts: attempts(),
      next: 0,
      attemptLog: [],
      errors: [],
      responseId: "",
      model: "",
      polling: false,
      pollErrors: 0,
      result: null,
    }, 50);

    if (!await startNext(job, apiKey, fetchWithTimeout)) return res.status(502).json(jobJson(job));
    res.status(202).json(jobJson(job));
  });

  router.get("/research/:jobId", async (req, res) => {
    const job = get(JOB_CACHE, req.params.jobId, 50);
    if (!job) return res.status(404).json({ ok: false, status: "expired", message: "This research job expired or the server restarted. Start the search again." });
    await refresh(job, apiKey, fetchWithTimeout);
    res.status(job.status === "failed" ? 502 : 200).json(jobJson(job));
  });

  router.get("/report/:id", (req, res) => {
    const record = get(REPORT_CACHE, req.params.id);
    if (!record) return res.status(404).json({ ok: false, message: "Report expired or was not found." });
    res.json({
      ok: true,
      report: record.report,
      html: renderSiteReport(record.report),
      wordUrl: `/api/site-research/word/${req.params.id}`,
    });
  });

  router.get("/word/:id", (req, res) => {
    const record = get(REPORT_CACHE, req.params.id);
    if (!record) return res.status(404).send("Report expired or was not found.");
    res.setHeader("Content-Type", "application/msword; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${slug(record.report.address)}-fuel-iq-site-report.doc"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(renderSiteReport(record.report, { document: true }));
  });

  router.post("/word", (req, res) => {
    try {
      const raw = req.body?.report || {};
      const sections = unique(list(raw?._meta?.selected_sections || raw?.sections?.map?.((section) => section?.key))
        .map((key) => clean(key, 120)).filter((key) => SECTION_CATALOG[key]));
      const report = normalizeReport(raw, {
        address: clean(raw.address || "Fuel IQ Site", 700),
        sections: sections.length ? sections : DEFAULT_SECTION_KEYS,
        model: clean(raw?._meta?.model, 100),
        sources: [],
      });
      res.setHeader("Content-Type", "application/msword; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${slug(report.address)}-fuel-iq-site-report.doc"`);
      res.send(renderSiteReport(report, { document: true }));
    } catch (error) {
      res.status(400).json({ ok: false, message: clean(error?.message || error, 1200) });
    }
  });

  app.use("/api/site-research", router);
}
