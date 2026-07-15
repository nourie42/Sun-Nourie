import {
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { list, plain, validUrl } from "./distributorReportV3.js";

const NAVY = "0B1F33";
const BLUE = "1F4E79";
const LIGHT_BLUE = "DBEAF5";
const LIGHT_GRAY = "F5F7FA";
const BORDER = "94A3B8";
const TEXT = "16202A";
const MUTED = "5B6773";

function textRun(text, options = {}) {
  return new TextRun({
    text: String(text ?? ""),
    font: "Arial",
    size: options.size || 19,
    bold: Boolean(options.bold),
    italics: Boolean(options.italics),
    color: options.color || TEXT,
    break: options.break,
  });
}

function paragraph(value, options = {}) {
  const text = plain(value);
  return new Paragraph({
    children: [textRun(text || options.emptyText || "No public information found.", {
      size: options.size || 19,
      bold: options.bold,
      italics: options.italics || !text,
      color: options.color || (text ? TEXT : MUTED),
    })],
    spacing: { before: options.before ?? 40, after: options.after ?? 90, line: 260 },
    keepNext: Boolean(options.keepNext),
    alignment: options.alignment,
  });
}

function heading(text, level = 2) {
  const sizes = { 1: 34, 2: 28, 3: 23, 4: 20 };
  return new Paragraph({
    children: [textRun(text, { bold: true, size: sizes[level] || 22, color: level === 1 ? NAVY : BLUE })],
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : level === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
    spacing: { before: level === 1 ? 80 : 240, after: 100 },
    keepNext: true,
  });
}

function bulletParagraph(value, level = 0) {
  return new Paragraph({
    children: [textRun(plain(value), { size: 19 })],
    bullet: { level },
    spacing: { before: 20, after: 55, line: 250 },
  });
}

function bulletChildren(items) {
  const values = list(items).map(plain).filter(Boolean);
  return values.length ? values.map((value) => bulletParagraph(value)) : [paragraph("")];
}

function cellParagraph(value, { bold = false, link = "", linkLabel = "Open source" } = {}) {
  const url = validUrl(link);
  const children = url
    ? [new ExternalHyperlink({
        children: [new TextRun({ text: linkLabel, style: "Hyperlink", font: "Arial", size: 16 })],
        link: url,
      })]
    : [textRun(plain(value), { size: 16, bold, color: TEXT })];
  return new Paragraph({ children, spacing: { before: 0, after: 0, line: 220 } });
}

function tableCell(value, width, options = {}) {
  return new TableCell({
    children: [cellParagraph(value, options)],
    width: { size: width, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    shading: options.header ? { type: ShadingType.CLEAR, color: "auto", fill: LIGHT_BLUE } : undefined,
    margins: { top: 70, bottom: 70, left: 75, right: 75 },
  });
}

function dataTable(rows, columns) {
  const values = list(rows).filter((row) => row != null);
  if (!values.length) return [paragraph("")];
  const normalizedWidths = (() => {
    const requested = columns.map((column) => Number(column.width || 0));
    const total = requested.reduce((sum, value) => sum + value, 0) || 100;
    return requested.map((value) => (value || 100 / columns.length) * 100 / total);
  })();

  const header = new TableRow({
    tableHeader: true,
    children: columns.map((column, index) => tableCell(column.label, normalizedWidths[index], { header: true, bold: true })),
  });

  const bodyRows = values.map((row) => new TableRow({
    children: columns.map((column, index) => {
      let value = "";
      if (row && typeof row === "object") {
        for (const key of column.keys || []) {
          if (row[key] != null && row[key] !== "") { value = row[key]; break; }
        }
      } else {
        value = row;
      }
      if (column.url) {
        return tableCell("", normalizedWidths[index], { link: validUrl(value), linkLabel: column.linkLabel || "Open source" });
      }
      return tableCell(value, normalizedWidths[index]);
    }),
  }));

  return [
    new Table({
      rows: [header, ...bodyRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
        left: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
        right: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 3, color: BORDER },
        insideVertical: { style: BorderStyle.SINGLE, size: 3, color: BORDER },
      },
      margins: { top: 70, bottom: 70, left: 70, right: 70 },
    }),
    new Paragraph({ spacing: { after: 90 } }),
  ];
}

function questionGroups(groups) {
  const children = [];
  const values = list(groups);
  if (!values.length) return [paragraph("")];
  for (const group of values) {
    children.push(heading(plain(group?.category) || "Diligence", 4));
    children.push(...bulletChildren(group?.questions));
  }
  return children;
}

function sectionChildren(key, report) {
  const value = report[key] || {};
  switch (key) {
    case "executive_findings":
      return bulletChildren(value);
    case "identity_operating_model":
      return [
        paragraph(value.summary),
        ...dataTable(value.facts, [
          { label: "Field", keys: ["field"], width: 18 },
          { label: "Public finding", keys: ["public_finding"], width: 52 },
          { label: "Confidence", keys: ["confidence"], width: 13 },
          { label: "Sources", keys: ["source_ids"], width: 17 },
        ]),
        heading("Business Segments", 3),
        ...dataTable(value.business_segments, [
          { label: "Segment", keys: ["segment"], width: 20 },
          { label: "Evidence", keys: ["evidence"], width: 55 },
          { label: "Confidence", keys: ["confidence"], width: 12 },
          { label: "Sources", keys: ["source_ids"], width: 13 },
        ]),
        heading("Ownership and History", 3),
        ...bulletChildren(value.ownership_and_history),
        heading("Contact Information", 3),
        ...dataTable(value.contact_information, [
          { label: "Type", keys: ["type"], width: 22 },
          { label: "Value", keys: ["value"], width: 60 },
          { label: "Sources", keys: ["source_ids"], width: 18 },
        ]),
      ];
    case "revenue_sales_estimates":
      return [
        paragraph(value.limitations),
        heading("Public Third-Party Estimates", 3),
        ...dataTable(value.public_estimates, [
          { label: "Source", keys: ["source"], width: 18 },
          { label: "Estimate", keys: ["estimate"], width: 18 },
          { label: "Interpretation", keys: ["interpretation"], width: 44 },
          { label: "Confidence", keys: ["confidence"], width: 10 },
          { label: "Sources", keys: ["source_ids"], width: 10 },
        ]),
        heading("Modeled Revenue Scenarios", 3),
        ...dataTable(value.modeled_revenue_scenarios, [
          { label: "Scenario", keys: ["scenario"], width: 18 },
          { label: "Annual revenue / billings", keys: ["annual_revenue_or_billings"], width: 20 },
          { label: "Basis and arithmetic", keys: ["basis_and_arithmetic"], width: 48 },
          { label: "Confidence", keys: ["confidence"], width: 14 },
        ]),
        heading("Modeled Capacity Cases", 3),
        ...dataTable(value.modeled_capacity_cases, [
          { label: "Case", keys: ["case"], width: 12 },
          { label: "Load assumption", keys: ["load_assumption"], width: 28 },
          { label: "Weekly loads", keys: ["weekly_loads"], width: 14 },
          { label: "Weekly gallons", keys: ["weekly_gallons"], width: 15 },
          { label: "Annual gallons", keys: ["annual_gallons"], width: 16 },
          { label: "Confidence", keys: ["confidence"], width: 15 },
        ]),
        heading("Estimated Customer / Site Count", 3),
        ...dataTable(value.estimated_customer_site_count, [
          { label: "Scenario", keys: ["scenario"], width: 18 },
          { label: "Estimate", keys: ["estimate"], width: 18 },
          { label: "Basis", keys: ["basis"], width: 50 },
          { label: "Confidence", keys: ["confidence"], width: 14 },
        ]),
        heading("EBITDA and Valuation View", 3),
        ...bulletChildren(value.ebitda_and_valuation_view),
      ];
    case "sites_delivery_points":
      return [
        paragraph(value.summary),
        paragraph(`Publicly attributable count: ${plain(value.publicly_attributable_count) || "Not determined"}`, { bold: true }),
        ...dataTable(value.sites, [
          { label: "Relationship", keys: ["relationship_type"], width: 14 },
          { label: "Site / account", keys: ["site_or_account"], width: 15 },
          { label: "Address / location", keys: ["address_location"], width: 17 },
          { label: "Public evidence", keys: ["public_evidence"], width: 28 },
          { label: "What it does not prove", keys: ["what_it_does_not_prove"], width: 14 },
          { label: "Confidence", keys: ["confidence"], width: 6 },
          { label: "Sources", keys: ["source_ids"], width: 6 },
        ]),
        heading("Site Count Model", 3),
        ...bulletChildren(value.site_count_model),
        heading("Brands and Programs", 3),
        ...dataTable(value.brands_and_programs, [
          { label: "Brand / program", keys: ["brand_or_program"], width: 22 },
          { label: "Evidence", keys: ["evidence"], width: 55 },
          { label: "Confidence", keys: ["confidence"], width: 11 },
          { label: "Sources", keys: ["source_ids"], width: 12 },
        ]),
      ];
    case "geographic_footprint":
      return [
        paragraph(value.summary),
        heading("Markets", 3),
        ...dataTable(value.markets, [
          { label: "State / region", keys: ["state_region"], width: 18 },
          { label: "Publicly identified markets", keys: ["publicly_identified_markets"], width: 36 },
          { label: "Evidence", keys: ["evidence"], width: 28 },
          { label: "Confidence", keys: ["confidence"], width: 9 },
          { label: "Sources", keys: ["source_ids"], width: 9 },
        ]),
        heading("Terminal and Supply Clues", 3),
        ...dataTable(value.terminal_and_supply_clues, [
          { label: "Terminal / supplier / market", keys: ["terminal_supplier_market"], width: 25 },
          { label: "Evidence", keys: ["evidence"], width: 54 },
          { label: "Confidence", keys: ["confidence"], width: 10 },
          { label: "Sources", keys: ["source_ids"], width: 11 },
        ]),
        heading("Hiring and Operational Clues", 3),
        ...dataTable(value.hiring_and_operational_clues, [
          { label: "Market", keys: ["market"], width: 22 },
          { label: "Roles / clues", keys: ["roles_or_clues"], width: 62 },
          { label: "Sources", keys: ["source_ids"], width: 16 },
        ]),
      ];
    case "fleet_drivers_capacity_safety":
      return [
        paragraph(value.summary),
        ...dataTable(value.metrics, [
          { label: "Metric", keys: ["metric"], width: 18 },
          { label: "Public data", keys: ["public_data"], width: 28 },
          { label: "Diligence implication", keys: ["diligence_implication"], width: 38 },
          { label: "Confidence", keys: ["confidence"], width: 8 },
          { label: "Sources", keys: ["source_ids"], width: 8 },
        ]),
        heading("Safety and Insurance Clues", 3),
        ...dataTable(value.safety_and_insurance_clues, [
          { label: "Topic", keys: ["topic"], width: 20 },
          { label: "Finding", keys: ["finding"], width: 34 },
          { label: "Diligence action", keys: ["diligence_action"], width: 34 },
          { label: "Sources", keys: ["source_ids"], width: 12 },
        ]),
        heading("Fleet Capacity Implications", 3),
        ...bulletChildren(value.fleet_capacity_implications),
      ];
    case "leadership_staff_map":
      return [
        paragraph(value.summary),
        ...dataTable(value.people, [
          { label: "Person", keys: ["person"], width: 17 },
          { label: "Role and basis", keys: ["role_and_basis"], width: 37 },
          { label: "Decision-maker relevance", keys: ["decision_maker_relevance"], width: 28 },
          { label: "Confidence", keys: ["confidence"], width: 9 },
          { label: "Sources", keys: ["source_ids"], width: 9 },
        ]),
        heading("Organization and Succession Clues", 3),
        ...bulletChildren(value.organization_and_succession_clues),
      ];
    case "licensing_regulatory_records":
      return [
        heading("Licensing and Registration", 3),
        ...dataTable(value.licensing_and_registration, [
          { label: "Jurisdiction / area", keys: ["jurisdiction_area"], width: 20 },
          { label: "Public record", keys: ["public_record"], width: 46 },
          { label: "Status / date", keys: ["status_or_date"], width: 18 },
          { label: "Confidence", keys: ["confidence"], width: 8 },
          { label: "Sources", keys: ["source_ids"], width: 8 },
        ]),
        heading("Environmental and UST Enforcement", 3),
        ...dataTable(value.environmental_ust_enforcement, [
          { label: "Year", keys: ["year"], width: 8 },
          { label: "Facility / location", keys: ["facility_location"], width: 23 },
          { label: "Issue and outcome", keys: ["issue_and_outcome"], width: 45 },
          { label: "Penalty", keys: ["penalty"], width: 10 },
          { label: "Confidence", keys: ["confidence"], width: 7 },
          { label: "Sources", keys: ["source_ids"], width: 7 },
        ]),
        heading("Litigation, Liens, and Bankruptcy", 3),
        ...dataTable(value.litigation_liens_bankruptcy, [
          { label: "Year", keys: ["year"], width: 8 },
          { label: "Matter", keys: ["matter"], width: 20 },
          { label: "Summary", keys: ["summary"], width: 38 },
          { label: "Outcome / status", keys: ["outcome_or_status"], width: 20 },
          { label: "Confidence", keys: ["confidence"], width: 7 },
          { label: "Sources", keys: ["source_ids"], width: 7 },
        ]),
      ];
    case "risk_assessment":
      return [
        paragraph(value.overall_acquisition_screen),
        value.strategic_fit_score_0_to_10 ? paragraph(`Strategic fit: ${plain(value.strategic_fit_score_0_to_10)}`, { bold: true, color: NAVY }) : paragraph(""),
        heading("Risks", 3),
        ...dataTable(value.risks, [
          { label: "Risk topic", keys: ["risk_topic"], width: 20 },
          { label: "Public signal", keys: ["public_signal"], width: 38 },
          { label: "Severity", keys: ["severity"], width: 12 },
          { label: "Diligence action", keys: ["diligence_action"], width: 30 },
        ]),
        heading("Opportunities", 3),
        ...dataTable(value.opportunities, [
          { label: "Opportunity", keys: ["opportunity"], width: 25 },
          { label: "Public basis", keys: ["public_basis"], width: 45 },
          { label: "Validation needed", keys: ["validation_needed"], width: 30 },
        ]),
        heading("Red Flags and Data Gaps", 3),
        ...bulletChildren(value.red_flags_and_data_gaps),
      ];
    case "acquisition_due_diligence":
      return [
        ...questionGroups(value.questions_by_category),
        heading("Priority Documents", 3),
        ...bulletChildren(value.priority_documents),
        heading("First 30-Day Diligence Plan", 3),
        ...dataTable(value.first_30_day_diligence_plan, [
          { label: "Period", keys: ["period"], width: 20 },
          { label: "Actions", keys: ["actions"], width: 80 },
        ]),
      ];
    default:
      return [paragraph(value)];
  }
}

export async function buildDistributorWordDocument(report) {
  const children = [
    new Paragraph({
      children: [textRun("FUEL DISTRIBUTOR INTELLIGENCE", { bold: true, size: 18, color: BLUE })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [textRun(report.title, { bold: true, size: 38, color: NAVY })],
      spacing: { after: 100 },
    }),
    paragraph(`Prepared: ${plain(report.prepared_at)}`, { color: MUTED }),
    new Paragraph({
      children: [textRun(report.disclaimer, { italics: true, size: 18, color: MUTED })],
      shading: { type: ShadingType.CLEAR, color: "auto", fill: LIGHT_GRAY },
      spacing: { before: 80, after: 180, line: 250 },
      border: { left: { style: BorderStyle.SINGLE, color: BLUE, size: 18, space: 6 } },
      indent: { left: 120 },
    }),
  ];

  const sections = [
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

  sections.forEach(([key, title], index) => {
    children.push(heading(`${index + 1}. ${title}`, 2));
    children.push(...sectionChildren(key, report));
  });

  children.push(heading("Appendix A: Publicly Identified Sites", 2));
  children.push(...dataTable(report?.appendices?.publicly_identified_sites, [
    { label: "Relationship", keys: ["relationship_type"], width: 16 },
    { label: "Site / account", keys: ["site_or_account"], width: 18 },
    { label: "Address / location", keys: ["address_location"], width: 20 },
    { label: "Evidence summary", keys: ["evidence_summary"], width: 30 },
    { label: "Confidence", keys: ["confidence"], width: 8 },
    { label: "Sources", keys: ["source_ids"], width: 8 },
  ]));

  children.push(heading("Appendix B: Station / Public URLs", 2));
  children.push(...dataTable(report?.appendices?.station_urls, [
    { label: "Market", keys: ["market"], width: 25 },
    { label: "Address", keys: ["address"], width: 45 },
    { label: "Public link", keys: ["public_url"], url: true, linkLabel: "Open station page", width: 18 },
    { label: "Sources", keys: ["source_ids"], width: 12 },
  ]));

  children.push(heading("Appendix C: Source Register", 2));
  children.push(...dataTable(report?.appendices?.source_register, [
    { label: "ID", keys: ["id"], width: 7 },
    { label: "Source", keys: ["title"], width: 23 },
    { label: "Type", keys: ["source_type"], width: 16 },
    { label: "Link", keys: ["url"], url: true, linkLabel: "Open source", width: 12 },
    { label: "Why it matters", keys: ["why_it_matters"], width: 32 },
    { label: "Confidence", keys: ["confidence"], width: 10 },
  ]));

  const doc = new Document({
    creator: "Fuel IQ",
    title: report.title,
    description: "Public-source fuel distributor intelligence report",
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: 19, color: TEXT },
          paragraph: { spacing: { line: 250 } },
        },
      },
      characterStyles: [
        {
          id: "Hyperlink",
          name: "Hyperlink",
          basedOn: "DefaultParagraphFont",
          run: { color: "0563C1", underline: {} },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE },
          margin: { top: 650, right: 650, bottom: 650, left: 650, header: 300, footer: 300 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}
