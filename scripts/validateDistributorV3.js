import assert from "node:assert/strict";
import { normalizeDistributorReport, renderDistributorReport } from "../src/distributorReportV3.js";
import { buildDistributorWordDocument } from "../src/distributorWordV3.js";

const rawReport = {
  prepared_at: new Date().toISOString(),
  query: "Example Fuel Distributor",
  company_name: "Example Fuel Distributor, Inc.",
  title: "Example Fuel Distributor Public Company Intelligence Deep Dive",
  disclaimer: "Public-source research only.",
  executive_findings: ["A verified operating fact. turn0search0"],
  identity_operating_model: {
    summary: "Wholesale fuel distribution.",
    facts: [
      {
        field: "Business nature",
        public_finding: "Petroleum transportation and fuel sales.",
        confidence: "High",
        source_ids: "turn0search0",
      },
      {
        field: "Headquarters",
        public_finding: "Example City, USA",
        confidence: "High",
        source_ids: "S1",
      },
    ],
    business_segments: [],
    ownership_and_history: [],
    contact_information: [],
  },
  revenue_sales_estimates: {
    limitations: "No audited financial statements were publicly found.",
    public_estimates: [],
    modeled_revenue_scenarios: [],
    modeled_capacity_cases: [],
    estimated_customer_site_count: [],
    ebitda_and_valuation_view: [],
  },
  sites_delivery_points: {
    summary: "One public site was identified.",
    publicly_attributable_count: "1",
    sites: [
      {
        relationship_type: "Public delivery evidence",
        site_or_account: "Example Site",
        address_location: "100 Main Street",
        public_evidence: "A public record links the distributor to this location.",
        what_it_does_not_prove: "Current volume was not publicly found.",
        confidence: "High",
        source_ids: "S1",
      },
    ],
    site_count_model: [],
    brands_and_programs: [],
  },
  geographic_footprint: { summary: "", markets: [], terminal_and_supply_clues: [], hiring_and_operational_clues: [] },
  fleet_drivers_capacity_safety: { summary: "", metrics: [], safety_and_insurance_clues: [], fleet_capacity_implications: [] },
  leadership_staff_map: { summary: "", people: [], organization_and_succession_clues: [] },
  licensing_regulatory_records: { licensing_and_registration: [], environmental_ust_enforcement: [], litigation_liens_bankruptcy: [] },
  risk_assessment: { overall_acquisition_screen: "", strategic_fit_score_0_to_10: "", risks: [], opportunities: [], red_flags_and_data_gaps: [] },
  acquisition_due_diligence: { questions_by_category: [], priority_documents: [], first_30_day_diligence_plan: [] },
  appendices: {
    publicly_identified_sites: [],
    station_urls: [],
    source_register: [
      {
        id: "S1",
        title: "Example official record",
        url: "https://example.com/source",
        source_type: "Official record",
        why_it_matters: "Supports the headquarters and site evidence.",
        confidence: "High",
      },
    ],
  },
};

const report = normalizeDistributorReport(rawReport, {
  query: rawReport.query,
  model: "test-model",
  formatterModel: "test-formatter",
  sources: rawReport.appendices.source_register,
});

assert.equal(report.identity_operating_model.facts[0].source_ids, "");
assert.equal(report.identity_operating_model.facts[1].source_ids, "S1");
assert.equal(report.executive_findings[0].includes("turn0search0"), false);

const rendered = renderDistributorReport(report);
assert.match(rendered, /<th>Field<\/th>/);
assert.match(rendered, /<th>Public finding<\/th>/);
assert.equal(rendered.includes("turn0search0"), false);
assert.equal(rendered.includes("Print \/ PDF"), false);
assert.equal(rendered.includes("Export JSON"), false);

const wordBuffer = await buildDistributorWordDocument(report);
assert.ok(Buffer.isBuffer(wordBuffer));
assert.ok(wordBuffer.length > 1000);
assert.equal(wordBuffer.subarray(0, 2).toString("utf8"), "PK");

console.log(`Distributor V3 validation passed (${wordBuffer.length} byte DOCX).`);
