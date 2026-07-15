const DISTRIBUTOR_API_RE = /^\/api\/distributors(?:\/|$)/;
const DISTRIBUTOR_WORD_RE = /^\/api\/distributors\/word(?:\/|$)/;

function cleanUserText(value) {
  return String(value ?? "")
    .replace(/Chat\s*GPT/gi, "Fuel IQ")
    .replace(/OpenAI/gi, "Fuel IQ")
    .replace(/\s*•\s*gpt-[a-z0-9._-]+/gi, "")
    .replace(/\bgpt-[a-z0-9._-]+\b/gi, "")
    .replace(/\bAI Ready\b/gi, "Fuel IQ Ready")
    .replace(/Fuel IQ model:\s*[^•<\n]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizePayload(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item, key));
  if (value && typeof value === "object") {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (["model", "configuredModel", "formatterModel"].includes(childKey)) {
        output[childKey] = "";
        continue;
      }
      output[childKey] = sanitizePayload(childValue, childKey);
    }
    return output;
  }
  if (typeof value === "string") return cleanUserText(value);
  return value;
}

const WORD_LAYOUT_CSS = `
<style id="fuel-iq-distributor-word-layout-fix">
  @page { size: landscape; margin: 0.42in; }
  html, body { width: auto !important; max-width: 100% !important; }
  body { margin: 0 !important; overflow-wrap: anywhere !important; word-wrap: break-word !important; }
  .report-document { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
  .table-scroll { width: 100% !important; max-width: 100% !important; overflow: visible !important; }
  table { width: 100% !important; max-width: 100% !important; table-layout: fixed !important; border-collapse: collapse !important; }
  th, td {
    white-space: normal !important;
    overflow-wrap: anywhere !important;
    word-wrap: break-word !important;
    word-break: break-word !important;
    max-width: 0;
  }
  a { word-break: break-all !important; overflow-wrap: anywhere !important; }
  #report-appendix-sources table { font-size: 7.5pt !important; table-layout: fixed !important; }
  #report-appendix-sources th, #report-appendix-sources td { padding: 4px !important; }
  #report-appendix-sources th:nth-child(1), #report-appendix-sources td:nth-child(1) { width: 6% !important; }
  #report-appendix-sources th:nth-child(2), #report-appendix-sources td:nth-child(2) { width: 20% !important; }
  #report-appendix-sources th:nth-child(3), #report-appendix-sources td:nth-child(3) { width: 14% !important; }
  #report-appendix-sources th:nth-child(4), #report-appendix-sources td:nth-child(4) { width: 12% !important; }
  #report-appendix-sources th:nth-child(5), #report-appendix-sources td:nth-child(5) { width: 38% !important; }
  #report-appendix-sources th:nth-child(6), #report-appendix-sources td:nth-child(6) { width: 10% !important; }
</style>`;

function injectSourceRegisterColumns(html) {
  const colgroup = '<colgroup><col style="width:6%"><col style="width:20%"><col style="width:14%"><col style="width:12%"><col style="width:38%"><col style="width:10%"></colgroup>';
  return html.replace(
    /(<section id="report-appendix-sources"[\s\S]*?<table)(>)/i,
    `$1 style="width:100%;table-layout:fixed"$2${colgroup}`
  );
}

function fixWordDocument(body) {
  if (typeof body !== "string" || !body.includes("<html")) return body;
  let html = body
    .replace(/Chat\s*GPT/gi, "Fuel IQ")
    .replace(/OpenAI/gi, "Fuel IQ")
    .replace(/\s*&nbsp;\s*<b>[^<]*model:<\/b>\s*[^<]*/gi, "")
    .replace(/(<a\b[^>]*href="[^"]+"[^>]*>)[^<]*(<\/a>)/gi, "$1Open source$2");

  html = injectSourceRegisterColumns(html);
  if (!html.includes('id="fuel-iq-distributor-word-layout-fix"')) {
    html = html.includes("</head>")
      ? html.replace("</head>", `${WORD_LAYOUT_CSS}</head>`)
      : `${WORD_LAYOUT_CSS}${html}`;
  }
  return html;
}

export function transformDistributorPage(page) {
  return String(page ?? "")
    .replace(/Chat\s*GPT/gi, "Fuel IQ")
    .replace(/OpenAI/gi, "Fuel IQ")
    .replace(/AI-powered M&amp;A research/gi, "Fuel IQ M&amp;A research")
    .replace(/AI Ready/gi, "Fuel IQ Ready")
    .replace(/ChatGPT model/gi, "Research engine")
    .replace(/Fuel IQ model/gi, "Research engine");
}

export function registerDistributorPresentationFix(app) {
  app.use((req, res, next) => {
    if (!DISTRIBUTOR_API_RE.test(req.path)) return next();

    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(sanitizePayload(payload));

    if (DISTRIBUTOR_WORD_RE.test(req.path)) {
      const originalSend = res.send.bind(res);
      res.send = (body) => originalSend(fixWordDocument(body));
    }
    next();
  });
}

export { cleanUserText, fixWordDocument, sanitizePayload };
