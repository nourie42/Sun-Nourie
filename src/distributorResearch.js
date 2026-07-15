import express from "express";
import crypto from "crypto";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 100;
const REPORT_CACHE = new Map();

const REPORT_SECTIONS = [
  ["executive_findings", "Executive Findings"],
  ["identity_operating_model", "Identity and Operating Model"],
  ["revenue_sales_estimates", "Revenue and Sales Estimates"],
  ["sites_delivery_points", "Sites, Delivery Points, and Customer Evidence"],
  ["geographic_footprint", "Geographic Footprint and Operating Markets"],
  ["fleet_drivers_capacity_safety", "Fleet, Drivers, Capacity, and Safety"],
  ["leadership_staff_map", "Leadership and Staff Map"],
  ["licensing_regulatory_records", "Licensing, State Footprint, and Regulatory Records"],
  ["risk_assessment", "Risk Assessment and Diligence Implications"],
  ["acquisition_due_diligence", "Acquisition Due Diligence Questions"],
];

function clean(value, max = 30000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

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

function list(value) {
  if (Array.isArray(value)) return value;
  return value == null || value === "" ? [] : [value];
}

function plain(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(plain).filter(Boolean).join("; ");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, val]) => `${key}: ${plain(val)}`)
      .filter((item) => !item.endsWith(": "))
      .join("; ");
  }
  return String(value).trim();
}

function slug(value) {
  return clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "fuel-distributor-report";
}

function normalizeUrl(value) {
  const url = clean(value, 2000);
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function pruneCache() {
  const now = Date.now();
  for (const [id, record] of REPORT_CACHE) {
    if (record.expiresAt <= now) REPORT_CACHE.delete(id);
  }
  while (REPORT_CACHE.size > CACHE_LIMIT) {
    REPORT_CACHE.delete(REPORT_CACHE.keys().next().value);
  }
}

function saveReport(report) {
  pruneCache();
  const id = crypto.randomUUID();
  REPORT_CACHE.set(id, { report, expiresAt: Date.now() + CACHE_TTL_MS });
  return id;
}

function readReport(id) {
  pruneCache();
  const record = REPORT_CACHE.get(id);
  if (!record) return null;
  record.expiresAt = Date.now() + CACHE_TTL_MS;
  return record.report;
}

function responseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  const chunks = [];
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const part of item.content || []) {
      if (typeof part?.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

function annotationSources(payload) {
  const sources = [];
  const seen = new Set();
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const part of item.content || []) {
      for (const annotation of part?.annotations || []) {
        if (annotation?.type !== "url_citation") continue;
        const url = normalizeUrl(annotation.url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        sources.push({
          id: "",
          title: clean(annotation.title || url, 500),
          url,
          source_type: "OpenAI web-search citation",
          why_it_matters: "Cited by the research model in the generated report.",
          confidence: "Supporting source",
        });
      }
    }
  }
  return sources;
}

function parseJson(text) {
  let value = clean(text, 500000);
  value = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return a JSON object.");
  return JSON.parse(value.slice(start, end + 1));
}

function renumberSources(report, extras = []) {
  const existing = list(report?.appendices?.source_register || report?.sources);
  const all = [...existing, ...extras];
  const byUrl = new Map();
  for (const source of all) {
    if (!source || typeof source !== "object") continue;
    const url = normalizeUrl(source.url || source.public_url);
    const key = url || `${plain(source.title || source.source)}|${plain(source.why_it_matters)}`;
    if (!key || byUrl.has(key)) continue;
    byUrl.set(key, {
      id: "",
      title: clean(source.title || source.source || source.name || url || "Public source", 500),
      url,
      source_type: clean(source.source_type || source.type || "Public source", 200),
      why_it_matters: clean(source.why_it_matters || source.notes || source.description || "", 1500),
      confidence: clean(source.confidence || "", 100),
    });
  }
  const sources = [...byUrl.values()].map((source, index) => ({ ...source, id: `S${index + 1}` }));
  report.appendices = report.appendices || {};
  report.appendices.source_register = sources;
  report.sources = sources;
  return report;
}

function normalizeReport(raw, metadata) {
  const report = raw && typeof raw === "object" ? raw : {};
  report.company_name = clean(report.company_name || report.company?.legal_name || metadata.query, 500);
  report.query = clean(report.query || metadata.query, 500);
  report.prepared_at = clean(report.prepared_at || new Date().toISOString(), 100);
  report.title = clean(report.title || `${report.company_name} Public Company Intelligence Deep Dive`, 700);
  report.disclaimer = clean(
    report.disclaimer ||
      "This report is based only on publicly available information and ChatGPT-assisted web research. It is not a management-provided data room, audited financial statement, customer list, tax return, valuation opinion, environmental opinion, or legal opinion. Estimates are model outputs and must be validated in diligence.",
    2500
  );
  for (const [key] of REPORT_SECTIONS) {
    if (report[key] == null) report[key] = key === "executive_findings" ? [] : {};
  }
  report.appendices = report.appendices || {};
  report.appendices.publicly_identified_sites = list(report.appendices.publicly_identified_sites);
  report.appendices.station_urls = list(report.appendices.station_urls);
  report._meta = {
    generated_at: new Date().toISOString(),
    model: metadata.model,
    web_search_tool: metadata.webSearchTool,
    location_hint: metadata.location || "",
    focus: metadata.focus || "",
  };
  return renumberSources(report, metadata.annotationSources);
}

function researchPrompt({ query, location, focus }) {
  return `Research the fuel distributor or petroleum marketer named below and produce an exhaustive public-source M&A intelligence report.

TARGET COMPANY: ${query}
GEOGRAPHY HINT: ${location || "None provided"}
USER FOCUS: ${focus || "Full-company deep dive"}

The required depth and organization are modeled after a professional fuel-distributor public-source report. Search broadly and cross-check official and public records. Research, where available:
- official company site, history, service pages, locations, careers and leadership;
- state secretary-of-state/business registrations and assumed names;
- FMCSA SAFER, USDOT/MC, MCS-150 mileage, power units, drivers, cargo, safety rating and inspection/crash clues;
- federal/state motor-fuel dealer, wholesaler, transporter, carrier, IFTA/IRP, hazmat and terminal-access clues;
- state UST/environmental databases, enforcement reports, spills, delivery-prohibition matters, consent orders and penalties;
- branded station locators and public station pages for 76, Phillips 66, Exxon, Mobil, Shell, BP, Amoco, Marathon, ARCO, Citgo, Valero, Sunoco and other brands;
- public property/UST ownership records, customer or delivery evidence, litigation, bankruptcy and lien clues;
- trade associations, acquisition history, press releases, PPP/SBA records, commercial directories, job postings and credible news;
- leadership names, roles, family ownership, second-line management and likely decision makers;
- operating markets, terminals, fleet capacity, estimated loads, estimated gallons, customer/site counts, revenue ranges, EBITDA implications and valuation limitations.

RESEARCH RULES:
1. Use live web search and favor primary/official sources. Use commercial directories only as lower-confidence clues.
2. Never invent private facts. Explicitly say "not publicly found" when unavailable.
3. Separate confirmed facts, public clues, model estimates and historical-only evidence.
4. Every estimate must show assumptions, arithmetic/basis, a range and confidence. Gross fuel billings are not gross profit or EBITDA.
5. Do not claim a station is owned, supplied or delivered by the target unless the evidence supports that exact relationship. State what the source proves and does not prove.
6. Cite sources throughout using source IDs such as S1, S2 and include direct URLs in the source register.
7. Include negative findings and inconsistencies, not only favorable findings.
8. The result should be exhaustive enough for acquisition screening and a first diligence meeting.

Return ONLY valid JSON, with no markdown fences and no text outside the object. Use this exact top-level structure. Empty arrays are acceptable when nothing was found:
{
  "prepared_at": "ISO date-time",
  "query": "",
  "company_name": "",
  "title": "",
  "disclaimer": "",
  "executive_findings": ["Detailed finding with [S#] citations"],
  "identity_operating_model": {
    "summary": "",
    "facts": [{"field":"", "public_finding":"", "confidence":"", "source_ids":"S1"}],
    "business_segments": [{"segment":"", "evidence":"", "confidence":"", "source_ids":""}],
    "ownership_and_history": [""],
    "contact_information": [{"type":"", "value":"", "source_ids":""}]
  },
  "revenue_sales_estimates": {
    "limitations": "",
    "public_estimates": [{"source":"", "estimate":"", "interpretation":"", "confidence":"", "source_ids":""}],
    "modeled_revenue_scenarios": [{"scenario":"", "annual_revenue_or_billings":"", "basis_and_arithmetic":"", "confidence":""}],
    "modeled_capacity_cases": [{"case":"", "load_assumption":"", "weekly_loads":"", "weekly_gallons":"", "annual_gallons":"", "confidence":""}],
    "estimated_customer_site_count": [{"scenario":"", "estimate":"", "basis":"", "confidence":""}],
    "ebitda_and_valuation_view": [""]
  },
  "sites_delivery_points": {
    "summary": "",
    "publicly_attributable_count": "",
    "sites": [{"relationship_type":"", "site_or_account":"", "address_location":"", "public_evidence":"", "what_it_does_not_prove":"", "confidence":"", "source_ids":""}],
    "site_count_model": [""],
    "brands_and_programs": [{"brand_or_program":"", "evidence":"", "confidence":"", "source_ids":""}]
  },
  "geographic_footprint": {
    "summary": "",
    "markets": [{"state_region":"", "publicly_identified_markets":"", "evidence":"", "confidence":"", "source_ids":""}],
    "terminal_and_supply_clues": [{"terminal_supplier_market":"", "evidence":"", "confidence":"", "source_ids":""}],
    "hiring_and_operational_clues": [{"market":"", "roles_or_clues":"", "source_ids":""}]
  },
  "fleet_drivers_capacity_safety": {
    "summary": "",
    "metrics": [{"metric":"", "public_data":"", "diligence_implication":"", "confidence":"", "source_ids":""}],
    "safety_and_insurance_clues": [{"topic":"", "finding":"", "diligence_action":"", "source_ids":""}],
    "fleet_capacity_implications": [""]
  },
  "leadership_staff_map": {
    "summary": "",
    "people": [{"person":"", "role_and_basis":"", "decision_maker_relevance":"", "confidence":"", "source_ids":""}],
    "organization_and_succession_clues": [""]
  },
  "licensing_regulatory_records": {
    "licensing_and_registration": [{"jurisdiction_area":"", "public_record":"", "status_or_date":"", "confidence":"", "source_ids":""}],
    "environmental_ust_enforcement": [{"year":"", "facility_location":"", "issue_and_outcome":"", "penalty":"", "confidence":"", "source_ids":""}],
    "litigation_liens_bankruptcy": [{"year":"", "matter":"", "summary":"", "outcome_or_status":"", "confidence":"", "source_ids":""}]
  },
  "risk_assessment": {
    "overall_acquisition_screen":"",
    "strategic_fit_score_0_to_10":"",
    "risks": [{"risk_topic":"", "public_signal":"", "severity":"Low/Medium/High", "diligence_action":""}],
    "opportunities": [{"opportunity":"", "public_basis":"", "validation_needed":""}],
    "red_flags_and_data_gaps": [""]
  },
  "acquisition_due_diligence": {
    "questions_by_category": [{"category":"", "questions":[""]}],
    "priority_documents": [""],
    "first_30_day_diligence_plan": [{"period":"", "actions":""}]
  },
  "appendices": {
    "publicly_identified_sites": [{"relationship_type":"", "site_or_account":"", "address_location":"", "evidence_summary":"", "confidence":"", "source_ids":""}],
    "station_urls": [{"market":"", "address":"", "public_url":"", "source_ids":""}],
    "source_register": [{"id":"S1", "title":"", "url":"https://...", "source_type":"Official/company/federal/state/court/trade/news/directory", "why_it_matters":"", "confidence":"High/Medium/Low"}]
  }
}`;
}

async function callOpenAI({ query, location, focus, apiKey, fetchWithTimeout }) {
  const requested = clean(process.env.OPENAI_DISTRIBUTOR_MODEL, 100);
  const models = [...new Set([requested, "gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-4.1"].filter(Boolean))];
  let lastError = null;

  for (const model of models) {
    const isGpt5 = /^gpt-5/i.test(model);
    const payload = {
      model,
      tools: [{
        type: "web_search",
        search_context_size: "high",
        ...(isGpt5 ? { return_token_budget: "unlimited" } : {}),
      }],
      tool_choice: "required",
      instructions: "You are a rigorous petroleum-industry M&A research analyst. You must use web search, prioritize primary sources, distinguish facts from estimates, and output strict valid JSON only.",
      input: researchPrompt({ query, location, focus }),
      max_output_tokens: Number(process.env.OPENAI_DISTRIBUTOR_MAX_OUTPUT_TOKENS || 20000),
      ...(isGpt5 ? { reasoning: { effort: "high" } } : {}),
    };

    try {
      const response = await fetchWithTimeout(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        Number(process.env.OPENAI_DISTRIBUTOR_TIMEOUT_MS || 240000)
      );
      const text = await response.text();
      if (!response.ok) {
        lastError = new Error(`OpenAI ${response.status} (${model}): ${text.slice(0, 2000)}`);
        continue;
      }
      const data = JSON.parse(text);
      const output = responseText(data);
      if (!output) {
        lastError = new Error(`OpenAI returned no output text (${model}).`);
        continue;
      }
      return {
        report: parseJson(output),
        model,
        webSearchTool: "web_search",
        annotationSources: annotationSources(data),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("OpenAI research failed.");
}

function renderBullets(items) {
  const values = list(items).map(plain).filter(Boolean);
  if (!values.length) return '<p class="empty">No public information found.</p>';
  return `<ul>${values.map((value) => `<li>${html(value)}</li>`).join("")}</ul>`;
}

function renderParagraph(value) {
  const text = plain(value);
  return text ? `<p>${html(text)}</p>` : '<p class="empty">No public information found.</p>';
}

function renderTable(rows, columns) {
  const values = list(rows).filter((row) => row != null);
  if (!values.length) return '<p class="empty">No public records found.</p>';
  const headers = columns.map((column) => `<th>${html(column.label)}</th>`).join("");
  const body = values.map((row) => {
    if (typeof row !== "object") return `<tr><td colspan="${columns.length}">${html(plain(row))}</td></tr>`;
    return `<tr>${columns.map((column) => {
      let value = "";
      for (const key of column.keys) {
        if (row[key] != null && row[key] !== "") { value = row[key]; break; }
      }
      const text = plain(value);
      if (column.url) {
        const url = normalizeUrl(text);
        return `<td>${url ? `<a href="${attr(url)}" target="_blank" rel="noopener noreferrer">${html(url)}</a>` : "—"}</td>`;
      }
      return `<td>${text ? html(text) : "—"}</td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<div class="table-scroll"><table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderQuestionGroups(groups) {
  const values = list(groups);
  if (!values.length) return '<p class="empty">No questions generated.</p>';
  return values.map((group) => {
    if (!group || typeof group !== "object") return `<p>${html(plain(group))}</p>`;
    return `<div class="question-group"><h4>${html(group.category || "Diligence")}</h4>${renderBullets(group.questions)}</div>`;
  }).join("");
}

function sectionHtml(key, report) {
  const value = report[key] || {};
  switch (key) {
    case "executive_findings":
      return renderBullets(value);
    case "identity_operating_model":
      return `${renderParagraph(value.summary)}
        ${renderTable(value.facts, [
          { label: "Field", keys: ["field"] },
          { label: "Public finding", keys: ["public_finding", "finding"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids", "source"] },
        ])}
        <h3>Business Segments</h3>${renderTable(value.business_segments, [
          { label: "Segment", keys: ["segment"] },
          { label: "Evidence", keys: ["evidence"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}
        <h3>Ownership and History</h3>${renderBullets(value.ownership_and_history)}
        <h3>Contact Information</h3>${renderTable(value.contact_information, [
          { label: "Type", keys: ["type"] },
          { label: "Value", keys: ["value"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}`;
    case "revenue_sales_estimates":
      return `${renderParagraph(value.limitations)}
        <h3>Public Third-Party Estimates</h3>${renderTable(value.public_estimates, [
          { label: "Source", keys: ["source"] },
          { label: "Estimate", keys: ["estimate"] },
          { label: "Interpretation", keys: ["interpretation"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}
        <h3>Modeled Revenue Scenarios</h3>${renderTable(value.modeled_revenue_scenarios, [
          { label: "Scenario", keys: ["scenario"] },
          { label: "Annual revenue / billings", keys: ["annual_revenue_or_billings"] },
          { label: "Basis and arithmetic", keys: ["basis_and_arithmetic", "basis"] },
          { label: "Confidence", keys: ["confidence"] },
        ])}
        <h3>Modeled Capacity Cases</h3>${renderTable(value.modeled_capacity_cases, [
          { label: "Case", keys: ["case"] },
          { label: "Load assumption", keys: ["load_assumption"] },
          { label: "Weekly loads", keys: ["weekly_loads"] },
          { label: "Weekly gallons", keys: ["weekly_gallons"] },
          { label: "Annual gallons", keys: ["annual_gallons"] },
          { label: "Confidence", keys: ["confidence"] },
        ])}
        <h3>Estimated Customer / Site Count</h3>${renderTable(value.estimated_customer_site_count, [
          { label: "Scenario", keys: ["scenario"] },
          { label: "Estimate", keys: ["estimate"] },
          { label: "Basis", keys: ["basis"] },
          { label: "Confidence", keys: ["confidence"] },
        ])}
        <h3>EBITDA and Valuation View</h3>${renderBullets(value.ebitda_and_valuation_view)}`;
    case "sites_delivery_points":
      return `${renderParagraph(value.summary)}<p><b>Publicly attributable count:</b> ${html(plain(value.publicly_attributable_count) || "Not determined")}</p>
        ${renderTable(value.sites, [
          { label: "Relationship", keys: ["relationship_type"] },
          { label: "Site / account", keys: ["site_or_account"] },
          { label: "Address / location", keys: ["address_location"] },
          { label: "Public evidence", keys: ["public_evidence"] },
          { label: "Does not prove", keys: ["what_it_does_not_prove"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}
        <h3>Site Count Model</h3>${renderBullets(value.site_count_model)}
        <h3>Brands and Programs</h3>${renderTable(value.brands_and_programs, [
          { label: "Brand / program", keys: ["brand_or_program"] },
          { label: "Evidence", keys: ["evidence"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}`;
    case "geographic_footprint":
      return `${renderParagraph(value.summary)}
        <h3>Markets</h3>${renderTable(value.markets, [
          { label: "State / region", keys: ["state_region"] },
          { label: "Markets", keys: ["publicly_identified_markets"] },
          { label: "Evidence", keys: ["evidence"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}
        <h3>Terminal and Supply Clues</h3>${renderTable(value.terminal_and_supply_clues, [
          { label: "Terminal / supplier / market", keys: ["terminal_supplier_market"] },
          { label: "Evidence", keys: ["evidence"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}
        <h3>Hiring and Operational Clues</h3>${renderTable(value.hiring_and_operational_clues, [
          { label: "Market", keys: ["market"] },
          { label: "Roles / clues", keys: ["roles_or_clues"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}`;
    case "fleet_drivers_capacity_safety":
      return `${renderParagraph(value.summary)}
        ${renderTable(value.metrics, [
          { label: "Metric", keys: ["metric"] },
          { label: "Public data", keys: ["public_data"] },
          { label: "Diligence implication", keys: ["diligence_implication"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}
        <h3>Safety and Insurance Clues</h3>${renderTable(value.safety_and_insurance_clues, [
          { label: "Topic", keys: ["topic"] },
          { label: "Finding", keys: ["finding"] },
          { label: "Diligence action", keys: ["diligence_action"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}
        <h3>Fleet Capacity Implications</h3>${renderBullets(value.fleet_capacity_implications)}`;
    case "leadership_staff_map":
      return `${renderParagraph(value.summary)}
        ${renderTable(value.people, [
          { label: "Person", keys: ["person"] },
          { label: "Role and basis", keys: ["role_and_basis"] },
          { label: "Decision-maker relevance", keys: ["decision_maker_relevance"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}
        <h3>Organization and Succession Clues</h3>${renderBullets(value.organization_and_succession_clues)}`;
    case "licensing_regulatory_records":
      return `<h3>Licensing and Registration</h3>${renderTable(value.licensing_and_registration, [
          { label: "Jurisdiction / area", keys: ["jurisdiction_area"] },
          { label: "Public record", keys: ["public_record"] },
          { label: "Status / date", keys: ["status_or_date"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}
        <h3>Environmental / UST Enforcement</h3>${renderTable(value.environmental_ust_enforcement, [
          { label: "Year", keys: ["year"] },
          { label: "Facility / location", keys: ["facility_location"] },
          { label: "Issue and outcome", keys: ["issue_and_outcome"] },
          { label: "Penalty", keys: ["penalty"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}
        <h3>Litigation, Liens, and Bankruptcy</h3>${renderTable(value.litigation_liens_bankruptcy, [
          { label: "Year", keys: ["year"] },
          { label: "Matter", keys: ["matter"] },
          { label: "Summary", keys: ["summary"] },
          { label: "Outcome / status", keys: ["outcome_or_status"] },
          { label: "Confidence", keys: ["confidence"] },
          { label: "Sources", keys: ["source_ids"] },
        ])}`;
    case "risk_assessment":
      return `<div class="score-card"><span>Strategic Fit Score</span><strong>${html(plain(value.strategic_fit_score_0_to_10) || "—")}</strong></div>
        ${renderParagraph(value.overall_acquisition_screen)}
        <h3>Risks</h3>${renderTable(value.risks, [
          { label: "Risk / topic", keys: ["risk_topic"] },
          { label: "Public signal", keys: ["public_signal"] },
          { label: "Severity", keys: ["severity"] },
          { label: "Diligence action", keys: ["diligence_action"] },
        ])}
        <h3>Opportunities</h3>${renderTable(value.opportunities, [
          { label: "Opportunity", keys: ["opportunity"] },
          { label: "Public basis", keys: ["public_basis"] },
          { label: "Validation needed", keys: ["validation_needed"] },
        ])}
        <h3>Red Flags and Data Gaps</h3>${renderBullets(value.red_flags_and_data_gaps)}`;
    case "acquisition_due_diligence":
      return `<h3>Questions by Category</h3>${renderQuestionGroups(value.questions_by_category)}
        <h3>Priority Documents</h3>${renderBullets(value.priority_documents)}
        <h3>First 30-Day Diligence Plan</h3>${renderTable(value.first_30_day_diligence_plan, [
          { label: "Period", keys: ["period"] },
          { label: "Actions", keys: ["actions"] },
        ])}`;
    default:
      return renderParagraph(value);
  }
}

function sourceRegisterHtml(report) {
  return renderTable(report?.appendices?.source_register, [
    { label: "ID", keys: ["id"] },
    { label: "Source", keys: ["title"] },
    { label: "Type", keys: ["source_type"] },
    { label: "URL", keys: ["url"], url: true },
    { label: "Why it matters", keys: ["why_it_matters"] },
    { label: "Confidence", keys: ["confidence"] },
  ]);
}

export function renderDistributorReport(report, { document = false } = {}) {
  const sections = REPORT_SECTIONS.map(([key, title], index) => `
    <section id="report-${key}">
      <h2>${index + 1}. ${html(title)}</h2>
      ${sectionHtml(key, report)}
    </section>`).join("");

  const appendices = `
    <section id="report-appendix-sites"><h2>Appendix A: Publicly Identified Sites</h2>${renderTable(report?.appendices?.publicly_identified_sites, [
      { label: "Relationship", keys: ["relationship_type"] },
      { label: "Site / account", keys: ["site_or_account"] },
      { label: "Address / location", keys: ["address_location"] },
      { label: "Evidence summary", keys: ["evidence_summary"] },
      { label: "Confidence", keys: ["confidence"] },
      { label: "Sources", keys: ["source_ids"] },
    ])}</section>
    <section id="report-appendix-urls"><h2>Appendix B: Station / Public URLs</h2>${renderTable(report?.appendices?.station_urls, [
      { label: "Market", keys: ["market"] },
      { label: "Address", keys: ["address"] },
      { label: "Public URL", keys: ["public_url"], url: true },
      { label: "Sources", keys: ["source_ids"] },
    ])}</section>
    <section id="report-appendix-sources"><h2>Appendix C: Source Register</h2>${sourceRegisterHtml(report)}</section>`;

  const styles = `
    :root{--navy:#0b1f33;--blue:#1f4e79;--line:#cbd5e1;--soft:#f4f7fb;--text:#16202a;}
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:var(--text);line-height:1.5;margin:0;background:#fff} .report-document{max-width:1180px;margin:0 auto;padding:30px}
    .report-cover{border-bottom:4px solid var(--blue);padding:8px 0 20px;margin-bottom:22px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:700;color:var(--blue)}
    h1{font-size:30px;line-height:1.15;margin:8px 0 10px;color:var(--navy)}h2{font-size:22px;color:var(--blue);border-bottom:1px solid var(--line);padding-bottom:6px;margin-top:34px}h3{font-size:16px;color:#245d8d;margin:22px 0 8px}h4{margin:16px 0 5px}
    p{margin:8px 0}.disclaimer{font-style:italic;color:#475569;background:var(--soft);border-left:4px solid var(--blue);padding:10px 12px}.empty{color:#64748b;font-style:italic}.meta{color:#475569;font-size:13px}.table-scroll{overflow:auto;margin:10px 0 18px}
    table{border-collapse:collapse;width:100%;font-size:12px}th{background:var(--blue);color:#fff;text-align:left}th,td{border:1px solid #94a3b8;padding:7px;vertical-align:top}tbody tr:nth-child(even) td{background:#f8fafc}ul{padding-left:22px}li{margin:5px 0}a{color:#075985;word-break:break-all}
    .score-card{display:inline-flex;align-items:center;gap:16px;background:var(--navy);color:#fff;border-radius:8px;padding:12px 18px;margin:8px 0}.score-card span{font-size:12px;text-transform:uppercase;letter-spacing:.08em}.score-card strong{font-size:24px}.question-group{break-inside:avoid}
    @media print{.report-document{max-width:none;padding:0}.table-scroll{overflow:visible}table{font-size:9pt}a{color:#000;text-decoration:none}section{break-inside:auto}h2{break-after:avoid}tr{break-inside:avoid}}
  `;

  const content = `<article class="report-document">
    <header class="report-cover">
      <div class="eyebrow">Fuel Distributor Intelligence</div>
      <h1>${html(report.title)}</h1>
      <div class="meta"><b>Prepared:</b> ${html(report.prepared_at)}${report?._meta?.model ? ` &nbsp; <b>ChatGPT model:</b> ${html(report._meta.model)}` : ""}</div>
      <p class="disclaimer">${html(report.disclaimer)}</p>
    </header>
    ${sections}${appendices}
  </article>`;

  if (!document) return `<style>${styles}</style>${content}`;
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${html(report.title)}</title><style>${styles}</style></head><body>${content}</body></html>`;
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

  router.get("/status", (_req, res) => {
    res.json({
      ok: true,
      openAiEnabled: Boolean(apiKey),
      configuredModel: process.env.OPENAI_DISTRIBUTOR_MODEL || "gpt-5.6 with fallbacks",
      reportCacheHours: CACHE_TTL_MS / 3600000,
    });
  });

  router.post("/research", async (req, res) => {
    const query = clean(req.body?.query, 500);
    const location = clean(req.body?.location, 300);
    const focus = clean(req.body?.focus, 4000);
    if (query.length < 2) return res.status(400).json({ ok: false, message: "Enter a fuel distributor name." });
    if (!apiKey) return res.status(503).json({ ok: false, message: "OPENAI_API_KEY is not configured on the server." });

    try {
      const result = await callOpenAI({ query, location, focus, apiKey, fetchWithTimeout });
      const report = normalizeReport(result.report, { ...result, query, location, focus });
      const reportId = saveReport(report);
      res.json({
        ok: true,
        reportId,
        report,
        html: renderDistributorReport(report),
        wordUrl: `/api/distributors/word/${reportId}`,
      });
    } catch (error) {
      console.error("Fuel distributor research failed:", error);
      res.status(502).json({
        ok: false,
        message: "ChatGPT could not complete the distributor research.",
        detail: process.env.NODE_ENV === "production" ? undefined : clean(error?.message, 3000),
      });
    }
  });

  router.get("/report/:id", (req, res) => {
    const report = readReport(req.params.id);
    if (!report) return res.status(404).json({ ok: false, message: "Report expired or was not found." });
    res.json({ ok: true, report, html: renderDistributorReport(report), wordUrl: `/api/distributors/word/${req.params.id}` });
  });

  router.get("/word/:id", (req, res) => {
    const report = readReport(req.params.id);
    if (!report) return res.status(404).send("Report expired or was not found.");
    const filename = `${slug(report.company_name)}-public-company-intelligence-deep-dive.doc`;
    res.setHeader("Content-Type", "application/msword; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(renderDistributorReport(report, { document: true }));
  });

  router.post("/word", (req, res) => {
    try {
      const report = normalizeReport(req.body?.report || {}, {
        query: req.body?.report?.query || req.body?.report?.company_name || "Fuel Distributor",
        model: req.body?.report?._meta?.model || "",
        webSearchTool: "",
        annotationSources: [],
      });
      const filename = `${slug(report.company_name)}-public-company-intelligence-deep-dive.doc`;
      res.setHeader("Content-Type", "application/msword; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(renderDistributorReport(report, { document: true }));
    } catch (error) {
      res.status(400).json({ ok: false, message: clean(error?.message, 1000) });
    }
  });

  app.use("/api/distributors", router);
}
