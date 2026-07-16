import express from "express";
import path from "path";
import fs from "fs/promises";
import http from "http";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { registerDistributorResearchRoutes } from "./src/distributorResearchCompat.js";
import { registerDistributorCompanySearchRoutes } from "./src/distributorCompanySearch.js";
import { registerDistributorPresentationFix, transformDistributorPage } from "./src/distributorPresentationFix.js";
import { registerSiteResearchRoutes } from "./src/siteResearchExhaustive.js";
import { registerSiteEnhancementRoutes } from "./src/siteEnhancements.js";
import { registerSiteWordLayoutFix } from "./src/siteWordLayoutFix.js";
import { transformSiteAnalyzerPage } from "./src/siteAnalyzerPresentation.js";
import { registerExpandedAadtRoutes } from "./src/aadtCoverage.js";
import { registerSiteResearchReportEnhancements } from "./src/siteResearchReportEnhancements.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPort = Number(process.env.PORT || 3000);
const legacyPort = Number(process.env.LEGACY_PORT || (publicPort === 65535 ? 65534 : publicPort + 1));
const app = express();

let legacyReady = false;
let shuttingDown = false;

const legacy = spawn(process.execPath, [path.join(__dirname, "legacy-server.js")], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(legacyPort) },
  stdio: ["ignore", "inherit", "inherit"],
});

legacy.on("error", (error) => {
  console.error("Could not start the legacy Fuel IQ server:", error);
});

legacy.on("exit", (code, signal) => {
  legacyReady = false;
  if (!shuttingDown) {
    console.error(`Legacy Fuel IQ server exited unexpectedly (code=${code}, signal=${signal}).`);
    process.exit(code || 1);
  }
});

async function waitForLegacy() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${legacyPort}/health`, { signal: AbortSignal.timeout(1200) });
      if (response.ok) {
        legacyReady = true;
        console.log(`Legacy Fuel IQ server ready on internal port ${legacyPort}`);
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  console.error("Legacy Fuel IQ server did not become ready within 30 seconds.");
}
waitForLegacy();

registerDistributorPresentationFix(app);
registerDistributorResearchRoutes(app, { openAiApiKey: process.env.OPENAI_API_KEY || "" });
registerDistributorCompanySearchRoutes(app, {
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  googleApiKey: process.env.GOOGLE_API_KEY || "",
});
registerSiteWordLayoutFix(app);
registerSiteResearchReportEnhancements(app);
registerSiteResearchRoutes(app, { openAiApiKey: process.env.OPENAI_API_KEY || "" });
registerExpandedAadtRoutes(app, { legacyPort });
registerSiteEnhancementRoutes(app, {
  legacyPort,
  googleApiKey: process.env.GOOGLE_API_KEY || "",
});

app.get("/distributors", (_req, res) => res.redirect(302, "/distributors.html"));
app.get("/distributor-company-search.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "public", "distributor-company-search.js"));
});
app.get("/distributor-scope-ui.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "public", "distributor-scope-ui.js"));
});
app.get("/distributor-research-client-v2.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "public", "distributor-research-client-v2.js"));
});
app.get("/distributor-branding-ui.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "public", "distributor-branding-ui.js"));
});
app.get("/site-research-client.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "public", "site-research-client.js"));
});
app.get("/site-research-layout.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "public", "site-research-layout.js"));
});
app.get("/distributors.html", async (_req, res) => {
  try {
    const filename = path.join(__dirname, "public", "distributors.html");
    let page = transformDistributorPage(await fs.readFile(filename, "utf8"));
    const scripts = [
      '<script src="/distributor-company-search.js" defer></script>',
      '<script src="/distributor-scope-ui.js" defer></script>',
      '<script src="/distributor-research-client-v2.js" defer></script>',
      '<script src="/distributor-branding-ui.js" defer></script>',
    ];
    for (const script of scripts) {
      const src = script.match(/src="([^"]+)/)?.[1] || "";
      if (src && page.includes(src)) continue;
      page = page.includes("</body>") ? page.replace("</body>", `${script}</body>`) : `${page}${script}`;
    }
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(page);
  } catch (error) {
    console.error("Could not serve Distributor Intelligence page:", error);
    res.status(500).send("Distributor Intelligence could not be loaded.");
  }
});

app.get(["/developments", "/developments.html", "/prospector", "/Scraper.html"], (_req, res) => {
  res.redirect(302, "/");
});

app.get("/health", (_req, res) => {
  res.status(legacyReady ? 200 : 503).json({
    ok: legacyReady,
    distributorIntelligence: true,
    distributorCompanySearch: true,
    distributorAutomaticHeadquarters: true,
    distributorSearchDepthSelection: true,
    distributorFullSearchDefault: true,
    distributorLimitedSearch: true,
    distributorBackgroundResearch: true,
    distributorFuelIqOnlyBranding: true,
    distributorModelVersionHidden: true,
    distributorWordOnlyExport: true,
    distributorSourceRegisterMarginFix: true,
    siteResearch: true,
    siteResearchWordExport: true,
    estimateWordExport: true,
    siteAnalyzerProfessionalLayout: true,
    siteAnalyzerServerRenderedLayout: true,
    siteAnalyzerNoLegacyFlash: true,
    siteResearchResultsAtBottom: true,
    siteReportDualWordExport: true,
    siteReportStickyExportDock: true,
    siteResearchRadarLoading: true,
    siteResearchScrollToResults: true,
    siteResearchExpectedGallons: true,
    siteNotesRemovedFromUi: true,
    basicGoogleRatingHidden: true,
    basicDevelopmentsHidden: true,
    combinedSiteAndAadtMaps: true,
    recommendedAadtAboveResearchSelections: true,
    expandedAadtCoverage: true,
    propertyRecordsResearch: true,
    competitorRadiusMiles: 1.5,
    multiSourceCompetitorSearch: true,
    multiPassExhaustiveSiteResearch: true,
    wordSourceTableMarginFix: true,
    basicWordMarginFix: true,
    webSearchJsonModeCompatibility: true,
    legacyServerReady: legacyReady,
  });
});

const homeEnhancements = [
  '<script src="/site-research-client.js" defer></script>',
  '<script src="/site-research-layout.js" defer></script>',
  '<script src="/site-research-runtime-fix.js" defer></script>',
];

function copyHeaders(source, target, { dropLength = false } = {}) {
  for (const [name, value] of Object.entries(source)) {
    const lower = name.toLowerCase();
    if (["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authenticate", "proxy-authorization", "te", "trailers"].includes(lower)) continue;
    if (dropLength && lower === "content-length") continue;
    if (value != null) target.setHeader(name, value);
  }
}

function proxyToLegacy(req, res) {
  const isHome = req.method === "GET" && (req.path === "/" || req.path === "/index.html");
  const headers = { ...req.headers, host: `127.0.0.1:${legacyPort}`, "accept-encoding": "identity" };
  delete headers.connection;

  const proxyRequest = http.request({
    hostname: "127.0.0.1",
    port: legacyPort,
    method: req.method,
    path: req.originalUrl,
    headers,
  }, (proxyResponse) => {
    const contentType = String(proxyResponse.headers["content-type"] || "");
    if (isHome && contentType.includes("text/html")) {
      const chunks = [];
      proxyResponse.on("data", (chunk) => chunks.push(chunk));
      proxyResponse.on("end", () => {
        let page = transformSiteAnalyzerPage(Buffer.concat(chunks).toString("utf8"));
        for (const enhancement of homeEnhancements) {
          const src = enhancement.match(/src="([^"]+)/)?.[1] || "";
          if (src && page.includes(src)) continue;
          page = page.includes("</body>") ? page.replace("</body>", `${enhancement}</body>`) : `${page}${enhancement}`;
        }
        res.status(proxyResponse.statusCode || 200);
        copyHeaders(proxyResponse.headers, res, { dropLength: true });
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Length", Buffer.byteLength(page));
        res.send(page);
      });
      return;
    }

    res.status(proxyResponse.statusCode || 200);
    copyHeaders(proxyResponse.headers, res);
    proxyResponse.pipe(res);
  });

  proxyRequest.on("error", (error) => {
    if (res.headersSent) return res.end();
    res.status(502).json({
      ok: false,
      message: legacyReady ? "Fuel IQ proxy request failed." : "Fuel IQ is still starting. Refresh in a few seconds.",
      detail: process.env.NODE_ENV === "production" ? undefined : String(error.message || error),
    });
  });

  req.pipe(proxyRequest);
}

app.use(proxyToLegacy);

const server = app.listen(publicPort, "0.0.0.0", () => {
  console.log(`Fuel IQ gateway with server-rendered Site Analyzer, expanded AADT coverage, 1.5-mile competition verification, Word export, Distributor Intelligence, and multi-pass Site Research listening on :${publicPort}`);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => process.exit(0));
  if (!legacy.killed) legacy.kill("SIGTERM");
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
