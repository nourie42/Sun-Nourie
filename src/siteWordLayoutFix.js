const WORD_ROUTE = /^\/api\/site-research\/word\//;

const WORD_LAYOUT_CSS = `
<style id="fuel-iq-word-layout-fix">
  @page { size: 8.5in 11in; margin: 0.55in; }
  html, body { width: auto !important; max-width: 100% !important; }
  body { margin: 0 !important; overflow-wrap: anywhere !important; word-wrap: break-word !important; }
  table { width: 100% !important; max-width: 100% !important; table-layout: fixed !important; }
  th, td {
    max-width: 0;
    white-space: normal !important;
    overflow-wrap: anywhere !important;
    word-wrap: break-word !important;
    word-break: break-word !important;
  }
  a { overflow-wrap: anywhere !important; word-break: break-all !important; }
  .table-wrap { width: 100% !important; max-width: 100% !important; overflow: visible !important; }
  .sources table th:nth-child(1), .sources table td:nth-child(1) { width: 8% !important; }
  .sources table th:nth-child(2), .sources table td:nth-child(2) { width: 23% !important; }
  .sources table th:nth-child(3), .sources table td:nth-child(3) { width: 14% !important; }
  .sources table th:nth-child(4), .sources table td:nth-child(4) { width: 43% !important; }
  .sources table th:nth-child(5), .sources table td:nth-child(5) { width: 12% !important; }
</style>`;

function injectWordLayout(body) {
  if (typeof body !== "string" || !body.includes("<html")) return body;
  if (body.includes('id="fuel-iq-word-layout-fix"')) return body;
  if (body.includes("</head>")) return body.replace("</head>", `${WORD_LAYOUT_CSS}</head>`);
  return `${WORD_LAYOUT_CSS}${body}`;
}

export function registerSiteWordLayoutFix(app) {
  app.use((req, res, next) => {
    if (req.method !== "GET" || !WORD_ROUTE.test(req.path)) return next();

    const originalSend = res.send.bind(res);
    res.send = (body) => originalSend(injectWordLayout(body));
    next();
  });
}
