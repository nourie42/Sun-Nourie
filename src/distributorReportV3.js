const STRING = { type: "string" };

function objectSchema(properties) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

function arrayOf(items) {
  return { type: "array", items };
}

export const REPORT_JSON_SCHEMA = objectSchema({
  prepared_at: STRING,
  query: STRING,
  company_name: STRING,
  title: STRING,
  disclaimer: STRING,
  executive_findings: arrayOf(STRING),
  identity_operating_model: objectSchema({
    summary: STRING,
    facts: arrayOf(objectSchema({
      field: STRING,
      public_finding: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
    business_segments: arrayOf(objectSchema({
      segment: STRING,
      evidence: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
    ownership_and_history: arrayOf(STRING),
    contact_information: arrayOf(objectSchema({
      type: STRING,
      value: STRING,
      source_ids: STRING,
    })),
  }),
  revenue_sales_estimates: objectSchema({
    limitations: STRING,
    public_estimates: arrayOf(objectSchema({
      source: STRING,
      estimate: STRING,
      interpretation: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
    modeled_revenue_scenarios: arrayOf(objectSchema({
      scenario: STRING,
      annual_revenue_or_billings: STRING,
      basis_and_arithmetic: STRING,
      confidence: STRING,
    })),
    modeled_capacity_cases: arrayOf(objectSchema({
      case: STRING,
      load_assumption: STRING,
      weekly_loads: STRING,
      weekly_gallons: STRING,
      annual_gallons: STRING,
      confidence: STRING,
    })),
    estimated_customer_site_count: arrayOf(objectSchema({
      scenario: STRING,
      estimate: STRING,
      basis: STRING,
      confidence: STRING,
    })),
    ebitda_and_valuation_view: arrayOf(STRING),
  }),
  sites_delivery_points: objectSchema({
    summary: STRING,
    publicly_attributable_count: STRING,
    sites: arrayOf(objectSchema({
      relationship_type: STRING,
      site_or_account: STRING,
      address_location: STRING,
      public_evidence: STRING,
      what_it_does_not_prove: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
    site_count_model: arrayOf(STRING),
    brands_and_programs: arrayOf(objectSchema({
      brand_or_program: STRING,
      evidence: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
  }),
  geographic_footprint: objectSchema({
    summary: STRING,
    markets: arrayOf(objectSchema({
      state_region: STRING,
      publicly_identified_markets: STRING,
      evidence: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
    terminal_and_supply_clues: arrayOf(objectSchema({
      terminal_supplier_market: STRING,
      evidence: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
    hiring_and_operational_clues: arrayOf(objectSchema({
      market: STRING,
      roles_or_clues: STRING,
      source_ids: STRING,
    })),
  }),
  fleet_drivers_capacity_safety: objectSchema({
    summary: STRING,
    metrics: arrayOf(objectSchema({
      metric: STRING,
      public_data: STRING,
      diligence_implication: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
    safety_and_insurance_clues: arrayOf(objectSchema({
      topic: STRING,
      finding: STRING,
      diligence_action: STRING,
      source_ids: STRING,
    })),
    fleet_capacity_implications: arrayOf(STRING),
  }),
  leadership_staff_map: objectSchema({
    summary: STRING,
    people: arrayOf(objectSchema({
      person: STRING,
      role_and_basis: STRING,
      decision_maker_relevance: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
    organization_and_succession_clues: arrayOf(STRING),
  }),
  licensing_regulatory_records: objectSchema({
    licensing_and_registration: arrayOf(objectSchema({
      jurisdiction_area: STRING,
      public_record: STRING,
      status_or_date: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
    environmental_ust_enforcement: arrayOf(objectSchema({
      year: STRING,
      facility_location: STRING,
      issue_and_outcome: STRING,
      penalty: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
    litigation_liens_bankruptcy: arrayOf(objectSchema({
      year: STRING,
      matter: STRING,
      summary: STRING,
      outcome_or_status: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
  }),
  risk_assessment: objectSchema({
    overall_acquisition_screen: STRING,
    strategic_fit_score_0_to_10: STRING,
    risks: arrayOf(objectSchema({
      risk_topic: STRING,
      public_signal: STRING,
      severity: STRING,
      diligence_action: STRING,
    })),
    opportunities: arrayOf(objectSchema({
      opportunity: STRING,
      public_basis: STRING,
      validation_needed: STRING,
    })),
    red_flags_and_data_gaps: arrayOf(STRING),
  }),
  acquisition_due_diligence: objectSchema({
    questions_by_category: arrayOf(objectSchema({
      category: STRING,
      questions: arrayOf(STRING),
    })),
    priority_documents: arrayOf(STRING),
    first_30_day_diligence_plan: arrayOf(objectSchema({
      period: STRING,
      actions: STRING,
    })),
  }),
  appendices: objectSchema({
    publicly_identified_sites: arrayOf(objectSchema({
      relationship_type: STRING,
      site_or_account: STRING,
      address_location: STRING,
      evidence_summary: STRING,
      confidence: STRING,
      source_ids: STRING,
    })),
    station_urls: arrayOf(objectSchema({
      market: STRING,
      address: STRING,
      public_url: STRING,
      source_ids: STRING,
    })),
    source_register: arrayOf(objectSchema({
      id: STRING,
      title: STRING,
      url: STRING,
      source_type: STRING,
      why_it_matters: STRING,
      confidence: STRING,
    })),
  }),
});

export const REPORT_SECTIONS = [
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

export function clean(value, max = 30000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

export function list(value) {
  if (Array.isArray(value)) return value;
  return value == null || value === "" ? [] : [value];
}

export function validUrl(value) {
  const url = clean(value, 3000);
  if (!/^https?:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function slug(value) {
  return clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "fuel-distributor-report";
}

const INTERNAL_TOKEN_RE = /(?:cite[^]+|【[^】]*\bturn\d+[a-z]+\d+\b[^】]*】|\bturn\d+(?:search|view|open|fetch|news|file|image|product|finance|sports|forecast|source)\d+\b)/gi;
const INTERNAL_TOKEN_ONLY_RE = /^\s*(?:\[?\s*)?(?:turn\d+[a-z]+\d+)(?:\s*\]?)?\s*$/i;

function domainLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "source link";
  }
}

export function scrubNarrative(value) {
  let text = clean(value, 100000);
  if (!text) return "";
  if (INTERNAL_TOKEN_ONLY_RE.test(text)) return "";

  text = text
    .replace(INTERNAL_TOKEN_RE, "")
    .replace(/\(\[([^\]]+)\]\)\((https?:\/\/[^)\s]+)\)/gi, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, "$1")
    .replace(/https?:\/\/[^\s\]\)>,;]+/gi, (url) => domainLabel(url))
    .replace(/\[\s*\]/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return INTERNAL_TOKEN_ONLY_RE.test(text) ? "" : text;
}

export function sanitizeSourceIds(value, validIds) {
  const matches = clean(value, 1000).toUpperCase().match(/\bS\d+\b/g) || [];
  const uniqueIds = [...new Set(matches)].filter((id) => validIds.has(id));
  return uniqueIds.join(", ");
}

function sanitizeValue(value, key, validIds) {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key, validIds));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeValue(childValue, childKey, validIds),
    ]));
  }
  if (typeof value !== "string") return value;

  if (key === "source_ids" || key === "source_id") return sanitizeSourceIds(value, validIds);
  if (["url", "public_url", "website"].includes(key)) return validUrl(value);
  return scrubNarrative(value);
}

export function buildSourceCatalog(rawSources) {
  const byUrl = new Map();
  for (const raw of list(rawSources)) {
    if (!raw || typeof raw !== "object") continue;
    const url = validUrl(raw.url || raw.public_url);
    if (!url || byUrl.has(url)) continue;
    byUrl.set(url, {
      id: "",
      title: scrubNarrative(raw.title || raw.source || raw.name || domainLabel(url)) || domainLabel(url),
      url,
      source_type: scrubNarrative(raw.source_type || raw.type || "Public web source"),
      why_it_matters: scrubNarrative(raw.why_it_matters || raw.notes || raw.description || ""),
      confidence: scrubNarrative(raw.confidence || "Supporting source"),
    });
  }
  return [...byUrl.values()].map((source, index) => ({ ...source, id: `S${index + 1}` }));
}

function mergeSourceDetails(catalog, reportSources) {
  const reportByUrl = new Map();
  for (const source of list(reportSources)) {
    if (!source || typeof source !== "object") continue;
    const url = validUrl(source.url || source.public_url);
    if (!url) continue;
    reportByUrl.set(url, source);
  }
  return catalog.map((source) => {
    const detail = reportByUrl.get(source.url) || {};
    return {
      ...source,
      title: scrubNarrative(detail.title || detail.source || source.title) || source.title,
      source_type: scrubNarrative(detail.source_type || detail.type || source.source_type) || source.source_type,
      why_it_matters: scrubNarrative(detail.why_it_matters || detail.notes || source.why_it_matters),
      confidence: scrubNarrative(detail.confidence || source.confidence) || source.confidence,
    };
  });
}

function emptyReportShape(query) {
  return {
    prepared_at: new Date().toISOString(),
    query,
    company_name: query,
    title: `${query || "Fuel Distributor"} Public Company Intelligence Deep Dive`,
    disclaimer: "Public-source ChatGPT research only; not audited financial, legal, environmental, customer, tax, valuation, or management-provided information. Validate all findings and model estimates in diligence.",
    executive_findings: [],
    identity_operating_model: { summary: "", facts: [], business_segments: [], ownership_and_history: [], contact_information: [] },
    revenue_sales_estimates: { limitations: "", public_estimates: [], modeled_revenue_scenarios: [], modeled_capacity_cases: [], estimated_customer_site_count: [], ebitda_and_valuation_view: [] },
    sites_delivery_points: { summary: "", publicly_attributable_count: "", sites: [], site_count_model: [], brands_and_programs: [] },
    geographic_footprint: { summary: "", markets: [], terminal_and_supply_clues: [], hiring_and_operational_clues: [] },
    fleet_drivers_capacity_safety: { summary: "", metrics: [], safety_and_insurance_clues: [], fleet_capacity_implications: [] },
    leadership_staff_map: { summary: "", people: [], organization_and_succession_clues: [] },
    licensing_regulatory_records: { licensing_and_registration: [], environmental_ust_enforcement: [], litigation_liens_bankruptcy: [] },
    risk_assessment: { overall_acquisition_screen: "", strategic_fit_score_0_to_10: "", risks: [], opportunities: [], red_flags_and_data_gaps: [] },
    acquisition_due_diligence: { questions_by_category: [], priority_documents: [], first_30_day_diligence_plan: [] },
    appendices: { publicly_identified_sites: [], station_urls: [], source_register: [] },
  };
}

function mergeShape(base, raw) {
  if (Array.isArray(base)) return Array.isArray(raw) ? raw : base;
  if (base && typeof base === "object") {
    const result = { ...base };
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const key of Object.keys(base)) result[key] = mergeShape(base[key], raw[key]);
    }
    return result;
  }
  return raw == null ? base : raw;
}

export function normalizeDistributorReport(raw, meta = {}) {
  const query = clean(meta.query || raw?.query || raw?.company_name || "Fuel Distributor", 500);
  const reportSourceRows = raw?.appendices?.source_register || raw?.sources || [];
  let catalog = buildSourceCatalog(meta.sources || []);
  if (!catalog.length) catalog = buildSourceCatalog(reportSourceRows);
  catalog = mergeSourceDetails(catalog, reportSourceRows);
  const validIds = new Set(catalog.map((source) => source.id));

  const merged = mergeShape(emptyReportShape(query), raw && typeof raw === "object" ? raw : {});
  const report = sanitizeValue(merged, "", validIds);

  report.query = scrubNarrative(report.query || query) || query;
  report.company_name = scrubNarrative(report.company_name || query) || query;
  report.prepared_at = clean(report.prepared_at || new Date().toISOString(), 100);
  report.title = scrubNarrative(report.title || `${report.company_name} Public Company Intelligence Deep Dive`);
  report.disclaimer = scrubNarrative(report.disclaimer || emptyReportShape(query).disclaimer);
  report.appendices.source_register = catalog;
  report.sources = catalog;
  report._meta = {
    generated_at: new Date().toISOString(),
    model: clean(meta.model || raw?._meta?.model || "", 100),
    formatter_model: clean(meta.formatterModel || raw?._meta?.formatter_model || "", 100),
    web_search_tool: "web_search",
    location_hint: scrubNarrative(meta.location || raw?._meta?.location_hint || ""),
    focus: scrubNarrative(meta.focus || raw?._meta?.focus || ""),
    background_response_id: clean(meta.responseId || "", 300),
    attempts: Array.isArray(meta.attempts) ? meta.attempts : [],
    pipeline_version: 3,
  };

  return report;
}

export function html(value) {
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

export function plain(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(plain).filter(Boolean).join("; ");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, child]) => `${key}: ${plain(child)}`)
      .filter((entry) => !entry.endsWith(": "))
      .join("; ");
  }
  return scrubNarrative(value);
}

function renderParagraph(value) {
  const text = plain(value);
  return text ? `<p>${html(text)}</p>` : '<p class="empty">No public information found.</p>';
}

function renderBullets(items) {
  const values = list(items).map(plain).filter(Boolean);
  if (!values.length) return '<p class="empty">No public information found.</p>';
  return `<ul>${values.map((value) => `<li>${html(value)}</li>`).join("")}</ul>`;
}

function displayLink(url, label = "Open source") {
  const safeUrl = validUrl(url);
  if (!safeUrl) return "";
  return `<a href="${attr(safeUrl)}" target="_blank" rel="noopener noreferrer">${html(label)}</a>`;
}

function renderTable(rows, columns) {
  const values = list(rows).filter((row) => row != null);
  if (!values.length) return '<p class="empty">No public records found.</p>';
  const colgroup = `<colgroup>${columns.map((column) => `<col style="width:${Number(column.width || (100 / columns.length)).toFixed(2)}%">`).join("")}</colgroup>`;
  const headers = columns.map((column) => `<th>${html(column.label)}</th>`).join("");
  const body = values.map((row) => {
    if (!row || typeof row !== "object") return `<tr><td colspan="${columns.length}">${html(plain(row))}</td></tr>`;
    return `<tr>${columns.map((column) => {
      let value = "";
      for (const key of column.keys || []) {
        if (row[key] != null && row[key] !== "") { value = row[key]; break; }
      }
      if (column.url) {
        const url = validUrl(value);
        return `<td>${url ? displayLink(url, column.linkLabel || "Open source") : ""}</td>`;
      }
      const text = plain(value);
      return `<td>${text ? html(text) : ""}</td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<div class="table-scroll"><table>${colgroup}<thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderQuestionGroups(groups) {
  const values = list(groups);
  if (!values.length) return '<p class="empty">No questions generated.</p>';
  return values.map((group) => {
    if (!group || typeof group !== "object") return `<p>${html(plain(group))}</p>`;
    return `<div class="question-group"><h4>${html(plain(group.category) || "Diligence")}</h4>${renderBullets(group.questions)}</div>`;
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
          { label: "Field", keys: ["field"], width: 18 },
          { label: "Public finding", keys: ["public_finding"], width: 51 },
          { label: "Confidence", keys: ["confidence"], width: 13 },
          { label: "Sources", keys: ["source_ids"], width: 18 },
        ])}
        <h3>Business Segments</h3>${renderTable(value.business_segments, [
          { label: "Segment", keys: ["segment"], width: 20 },
          { label: "Evidence", keys: ["evidence"], width: 55 },
          { label: "Confidence", keys: ["confidence"], width: 12 },
          { label: "Sources", keys: ["source_ids"], width: 13 },
        ])}
        <h3>Ownership and History</h3>${renderBullets(value.ownership_and_history)}
        <h3>Contact Information</h3>${renderTable(value.contact_information, [
          { label: "Type", keys: ["type"], width: 22 },
          { label: "Value", keys: ["value"], width: 60 },
          { label: "Sources", keys: ["source_ids"], width: 18 },
        ])}`;
    case "revenue_sales_estimates":
      return `${renderParagraph(value.limitations)}
        <h3>Public Third-Party Estimates</h3>${renderTable(value.public_estimates, [
          { label: "Source", keys: ["source"], width: 18 },
          { label: "Estimate", keys: ["estimate"], width: 19 },
          { label: "Interpretation", keys: ["interpretation"], width: 43 },
          { label: "Confidence", keys: ["confidence"], width: 10 },
          { label: "Sources", keys: ["source_ids"], width: 10 },
        ])}
        <h3>Modeled Revenue Scenarios</h3>${renderTable(value.modeled_revenue_scenarios, [
          { label: "Scenario", keys: ["scenario"], width: 18 },
          { label: "Annual revenue / billings", keys: ["annual_revenue_or_billings"], width: 20 },
          { label: "Basis and arithmetic", keys: ["basis_and_arithmetic"], width: 48 },
          { label: "Confidence", keys: ["confidence"], width: 14 },
        ])}
        <h3>Modeled Capacity Cases</h3>${renderTable(value.modeled_capacity_cases, [
          { label: "Case", keys: ["case"], width: 13 },
          { label: "Load assumption", keys: ["load_assumption"], width: 29 },
          { label: "Weekly loads", keys: ["weekly_loads"], width: 14 },
          { label: "Weekly gallons", keys: ["weekly_gallons"], width: 15 },
          { label: "Annual gallons", keys: ["annual_gallons"], width: 15 },
          { label: "Confidence", keys: ["confidence"], width: 14 },
        ])}
        <h3>Estimated Customer / Site Count</h3>${renderTable(value.estimated_customer_site_count, [
          { label: "Scenario", keys: ["scenario"], width: 18 },
          { label: "Estimate", keys: ["estimate"], width: 18 },
          { label: "Basis", keys: ["basis"], width: 50 },
          { label: "Confidence", keys: ["confidence"], width: 14 },
        ])}
        <h3>EBITDA and Valuation View</h3>${renderBullets(value.ebitda_and_valuation_view)}`;
    case "sites_delivery_points":
      return `${renderParagraph(value.summary)}<p><b>Publicly attributable count:</b> ${html(plain(value.publicly_attributable_count))}</p>
        ${renderTable(value.sites, [
          { label: "Relationship", keys: ["relationship_type"], width: 14 },
          { label: "Site / account", keys: ["site_or_account"], width: 16 },
          { label: "Address / location", keys: ["address_location"], width: 18 },
          { label: "Public evidence", keys: ["public_evidence"], width: 28 },
          { label: "What it does not prove", keys: ["what_it_does_not_prove"], width: 14 },
          { label: "Confidence", keys: ["confidence"], width: 5 },
          { label: "Sources", keys: ["source_ids"], width: 5 },
        ])}
        <h3>Site Count Model</h3>${renderBullets(value.site_count_model)}
        <h3>Brands and Programs</h3>${renderTable(value.brands_and_programs, [
          { label: "Brand / program", keys: ["brand_or_program"], width: 22 },
          { label: "Evidence", keys: ["evidence"], width: 55 },
          { label: "Confidence", keys: ["confidence"], width: 11 },
          { label: "Sources", keys: ["source_ids"], width: 12 },
        ])}`;
    case "geographic_footprint":
      return `${renderParagraph(value.summary)}
        <h3>Markets</h3>${renderTable(value.markets, [
          { label: "State / region", keys: ["state_region"], width: 18 },
          { label: "Publicly identified markets", keys: ["publicly_identified_markets"], width: 36 },
          { label: "Evidence", keys: ["evidence"], width: 28 },
          { label: "Confidence", keys: ["confidence"], width: 9 },
          { label: "Sources", keys: ["source_ids"], width: 9 },
        ])}
        <h3>Terminal and Supply Clues</h3>${renderTable(value.terminal_and_supply_clues, [
          { label: "Terminal / supplier / market", keys: ["terminal_supplier_market"], width: 25 },
          { label: "Evidence", keys: ["evidence"], width: 54 },
          { label: "Confidence", keys: ["confidence"], width: 10 },
          { label: "Sources", keys: ["source_ids"], width: 11 },
        ])}
        <h3>Hiring and Operational Clues</h3>${renderTable(value.hiring_and_operational_clues, [
          { label: "Market", keys: ["market"], width: 22 },
          { label: "Roles / clues", keys: ["roles_or_clues"], width: 62 },
          { label: "Sources", keys: ["source_ids"], width: 16 },
        ])}`;
    case "fleet_drivers_capacity_safety":
      return `${renderParagraph(value.summary)}
        ${renderTable(value.metrics, [
          { label: "Metric", keys: ["metric"], width: 18 },
          { label: "Public data", keys: ["public_data"], width: 28 },
          { label: "Diligence implication", keys: ["diligence_implication"], width: 38 },
          { label: "Confidence", keys: ["confidence"], width: 8 },
          { label: "Sources", keys: ["source_ids"], width: 8 },
        ])}
        <h3>Safety and Insurance Clues</h3>${renderTable(value.safety_and_insurance_clues, [
          { label: "Topic", keys: ["topic"], width: 20 },
          { label: "Finding", keys: ["finding"], width: 34 },
          { label: "Diligence action", keys: ["diligence_action"], width: 34 },
          { label: "Sources", keys: ["source_ids"], width: 12 },
        ])}
        <h3>Fleet Capacity Implications</h3>${renderBullets(value.fleet_capacity_implications)}`;
    case "leadership_staff_map":
      return `${renderParagraph(value.summary)}
        ${renderTable(value.people, [
          { label: "Person", keys: ["person"], width: 17 },
          { label: "Role and basis", keys: ["role_and_basis"], width: 37 },
          { label: "Decision-maker relevance", keys: ["decision_maker_relevance"], width: 28 },
          { label: "Confidence", keys: ["confidence"], width: 9 },
          { label: "Sources", keys: ["source_ids"], width: 9 },
        ])}
        <h3>Organization and Succession Clues</h3>${renderBullets(value.organization_and_succession_clues)}`;
    case "licensing_regulatory_records":
      return `<h3>Licensing and Registration</h3>${renderTable(value.licensing_and_registration, [
          { label: "Jurisdiction / area", keys: ["jurisdiction_area"], width: 20 },
          { label: "Public record", keys: ["public_record"], width: 46 },
          { label: "Status / date", keys: ["status_or_date"], width: 18 },
          { label: "Confidence", keys: ["confidence"], width: 8 },
          { label: "Sources", keys: ["source_ids"], width: 8 },
        ])}
        <h3>Environmental and UST Enforcement</h3>${renderTable(value.environmental_ust_enforcement, [
          { label: "Year", keys: ["year"], width: 8 },
          { label: "Facility / location", keys: ["facility_location"], width: 23 },
          { label: "Issue and outcome", keys: ["issue_and_outcome"], width: 45 },
          { label: "Penalty", keys: ["penalty"], width: 10 },
          { label: "Confidence", keys: ["confidence"], width: 7 },
          { label: "Sources", keys: ["source_ids"], width: 7 },
        ])}
        <h3>Litigation, Liens, and Bankruptcy</h3>${renderTable(value.litigation_liens_bankruptcy, [
          { label: "Year", keys: ["year"], width: 8 },
          { label: "Matter", keys: ["matter"], width: 20 },
          { label: "Summary", keys: ["summary"], width: 38 },
          { label: "Outcome / status", keys: ["outcome_or_status"], width: 20 },
          { label: "Confidence", keys: ["confidence"], width: 7 },
          { label: "Sources", keys: ["source_ids"], width: 7 },
        ])}`;
    case "risk_assessment":
      return `${renderParagraph(value.overall_acquisition_screen)}
        ${value.strategic_fit_score_0_to_10 ? `<div class="score-card"><span>Strategic fit</span><strong>${html(plain(value.strategic_fit_score_0_to_10))}</strong></div>` : ""}
        <h3>Risks</h3>${renderTable(value.risks, [
          { label: "Risk topic", keys: ["risk_topic"], width: 20 },
          { label: "Public signal", keys: ["public_signal"], width: 38 },
          { label: "Severity", keys: ["severity"], width: 12 },
          { label: "Diligence action", keys: ["diligence_action"], width: 30 },
        ])}
        <h3>Opportunities</h3>${renderTable(value.opportunities, [
          { label: "Opportunity", keys: ["opportunity"], width: 25 },
          { label: "Public basis", keys: ["public_basis"], width: 45 },
          { label: "Validation needed", keys: ["validation_needed"], width: 30 },
        ])}
        <h3>Red Flags and Data Gaps</h3>${renderBullets(value.red_flags_and_data_gaps)}`;
    case "acquisition_due_diligence":
      return `${renderQuestionGroups(value.questions_by_category)}
        <h3>Priority Documents</h3>${renderBullets(value.priority_documents)}
        <h3>First 30-Day Diligence Plan</h3>${renderTable(value.first_30_day_diligence_plan, [
          { label: "Period", keys: ["period"], width: 20 },
          { label: "Actions", keys: ["actions"], width: 80 },
        ])}`;
    default:
      return renderParagraph(value);
  }
}

function sourceRegisterHtml(report) {
  return renderTable(report?.appendices?.source_register, [
    { label: "ID", keys: ["id"], width: 7 },
    { label: "Source", keys: ["title"], width: 23 },
    { label: "Type", keys: ["source_type"], width: 16 },
    { label: "Link", keys: ["url"], url: true, linkLabel: "Open source", width: 12 },
    { label: "Why it matters", keys: ["why_it_matters"], width: 32 },
    { label: "Confidence", keys: ["confidence"], width: 10 },
  ]);
}

export function renderDistributorReport(report) {
  const sections = REPORT_SECTIONS.map(([key, title], index) => `
    <section id="report-${key}">
      <h2>${index + 1}. ${html(title)}</h2>
      ${sectionHtml(key, report)}
    </section>`).join("");

  const appendices = `
    <section id="report-appendix-sites"><h2>Appendix A: Publicly Identified Sites</h2>${renderTable(report?.appendices?.publicly_identified_sites, [
      { label: "Relationship", keys: ["relationship_type"], width: 16 },
      { label: "Site / account", keys: ["site_or_account"], width: 18 },
      { label: "Address / location", keys: ["address_location"], width: 20 },
      { label: "Evidence summary", keys: ["evidence_summary"], width: 30 },
      { label: "Confidence", keys: ["confidence"], width: 8 },
      { label: "Sources", keys: ["source_ids"], width: 8 },
    ])}</section>
    <section id="report-appendix-urls"><h2>Appendix B: Station / Public URLs</h2>${renderTable(report?.appendices?.station_urls, [
      { label: "Market", keys: ["market"], width: 25 },
      { label: "Address", keys: ["address"], width: 45 },
      { label: "Public link", keys: ["public_url"], url: true, linkLabel: "Open station page", width: 18 },
      { label: "Sources", keys: ["source_ids"], width: 12 },
    ])}</section>
    <section id="report-appendix-sources"><h2>Appendix C: Source Register</h2>${sourceRegisterHtml(report)}</section>`;

  const styles = `
    :root{--navy:#0b1f33;--blue:#1f4e79;--line:#94a3b8;--soft:#f4f7fb;--text:#16202a;}
    .report-document{max-width:1180px;margin:0 auto;padding:28px;color:var(--text);font-family:Arial,Helvetica,sans-serif;line-height:1.48;overflow-wrap:anywhere;word-break:break-word}
    .report-cover{border-bottom:4px solid var(--blue);padding:8px 0 20px;margin-bottom:22px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:700;color:var(--blue)}
    .report-document h1{font-size:30px;line-height:1.15;margin:8px 0 10px;color:var(--navy)}.report-document h2{font-size:22px;color:var(--blue);border-bottom:1px solid #cbd5e1;padding-bottom:6px;margin-top:34px}.report-document h3{font-size:16px;color:#245d8d;margin:22px 0 8px}.report-document h4{margin:16px 0 5px}
    .report-document p{margin:8px 0}.disclaimer{font-style:italic;color:#475569;background:var(--soft);border-left:4px solid var(--blue);padding:10px 12px}.empty{color:#64748b;font-style:italic}.meta{color:#475569;font-size:13px}.table-scroll{overflow-x:auto;margin:10px 0 18px;max-width:100%}
    .report-document table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:12px}.report-document th{background:#dbeaf5;color:#0b1f33;text-align:left;font-weight:700}.report-document th,.report-document td{border:1px solid var(--line);padding:7px;vertical-align:top;white-space:normal;overflow-wrap:anywhere;word-break:break-word}.report-document tbody tr:nth-child(even) td{background:#f8fafc}.report-document ul{padding-left:22px}.report-document li{margin:5px 0}.report-document a{color:#075985;overflow-wrap:anywhere}
    .score-card{display:inline-flex;align-items:center;gap:16px;background:var(--navy);color:#fff;border-radius:8px;padding:12px 18px;margin:8px 0}.score-card span{font-size:12px;text-transform:uppercase;letter-spacing:.08em}.score-card strong{font-size:24px}.question-group{break-inside:avoid}
  `;

  return `<style>${styles}</style><article class="report-document">
    <header class="report-cover">
      <div class="eyebrow">Fuel Distributor Intelligence</div>
      <h1>${html(report.title)}</h1>
      <div class="meta"><b>Prepared:</b> ${html(report.prepared_at)}${report?._meta?.model ? ` &nbsp; <b>Research model:</b> ${html(report._meta.model)}` : ""}</div>
      <p class="disclaimer">${html(report.disclaimer)}</p>
    </header>
    ${sections}${appendices}
  </article>`;
}
