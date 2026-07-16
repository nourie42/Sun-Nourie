const EXHAUSTIVE_WORD_ROUTE = /^\/api\/site-research\/word(?:\/[^/]+)?$/;
const BASIC_WORD_ROUTE = /^\/report\/word$/;

const WORD_LAYOUT_CSS = `
<style id="fuel-iq-word-layout-fix">
  @page Section1 { size: 8.5in 11in; margin: 0.55in 0.55in 0.6in 0.55in; mso-header-margin: 0.25in; mso-footer-margin: 0.25in; }
  html, body { width: auto !important; max-width: 100% !important; }
  body { margin: 0 !important; padding: 0 !important; overflow: visible !important; overflow-wrap: anywhere !important; word-wrap: break-word !important; }
  .Section1 { page: Section1; width: 100% !important; max-width: 7.4in !important; margin: 0 auto !important; }
  article, section, div, p, li, h1, h2, h3 { max-width: 100% !important; overflow-wrap: anywhere !important; word-wrap: break-word !important; }
  table { width: 100% !important; max-width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important; mso-table-layout-alt: fixed !important; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { max-width: 0 !important; white-space: normal !important; overflow: hidden !important; overflow-wrap: anywhere !important; word-wrap: break-word !important; word-break: break-word !important; vertical-align: top !important; }
  a { display: inline !important; max-width: 100% !important; overflow-wrap: anywhere !important; word-wrap: break-word !important; word-break: break-all !important; }
  img { max-width: 100% !important; height: auto !important; }
  pre, code { white-space: pre-wrap !important; overflow-wrap: anywhere !important; word-break: break-word !important; }
  .table-wrap { width: 100% !important; max-width: 100% !important; overflow: visible !important; }
  .key-value th { width: 28% !important; }
  .sources table th:nth-child(1), .sources table td:nth-child(1) { width: 7% !important; }
  .sources table th:nth-child(2), .sources table td:nth-child(2) { width: 24% !important; }
  .sources table th:nth-child(3), .sources table td:nth-child(3) { width: 14% !important; }
  .sources table th:nth-child(4), .sources table td:nth-child(4) { width: 43% !important; }
  .sources table th:nth-child(5), .sources table td:nth-child(5) { width: 12% !important; }
  .expected-gallons-grid { display: table !important; width: 100% !important; table-layout: fixed !important; border-collapse: separate !important; border-spacing: 4pt !important; }
  .expected-gallons-metric { display: table-cell !important; width: 20% !important; padding: 6pt !important; border: 1px solid #d5e4ee !important; }
</style>`;

function shortenDisplayedUrls(body) {
  let output = body;
  output = output.replace(/<a([^>]*href=["'](https?:\/\/[^"']+)["'][^>]*)>\s*https?:\/\/[^<]+<\/a>/gi, '<a$1>Open source</a>');
  output = output.replace(/<td([^>]*)>\s*(https?:\/\/[^<\s]+)\s*<\/td>/gi, (_match, attrs, url) => `<td${attrs}><a href="${url}">Open source</a></td>`);
  return output;
}

function wrapPrintablePage(body) {
  if (body.includes('class="Section1"')) return body;
  if (!body.includes("<body")) return body;
  const opened = body.replace(/<body([^>]*)>/i, '<body$1><div class="Section1">');
  return opened.replace(/<\/body>/i, "</div></body>");
}

function injectWordLayout(body) {
  if (typeof body !== "string" || !body.includes("<html")) return body;
  let output = shortenDisplayedUrls(body);
  if (!output.includes('id="fuel-iq-word-layout-fix"')) {
    output = output.includes("</head>") ? output.replace("</head>", `${WORD_LAYOUT_CSS}</head>`) : `${WORD_LAYOUT_CSS}${output}`;
  }
  return wrapPrintablePage(output);
}

export function registerSiteWordLayoutFix(app) {
  app.use((req, res, next) => {
    const exhaustive = (req.method === "GET" || req.method === "POST") && EXHAUSTIVE_WORD_ROUTE.test(req.path);
    const basic = req.method === "POST" && BASIC_WORD_ROUTE.test(req.path);
    if (!exhaustive && !basic) return next();

    const originalSend = res.send.bind(res);
    res.send = (body) => originalSend(injectWordLayout(body));
    next();
  });
}
