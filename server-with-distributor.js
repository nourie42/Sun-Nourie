import express from "express";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { registerDistributorResearchRoutes } from "./src/distributorResearch.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPort = Number(process.env.PORT || 3000);
const legacyPort = Number(process.env.LEGACY_PORT || (publicPort === 65535 ? 65534 : publicPort + 1));
const app = express();

let legacyReady = false;
let shuttingDown = false;

const legacy = spawn(process.execPath, [path.join(__dirname, "server.js")], {
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

registerDistributorResearchRoutes(app, { openAiApiKey: process.env.OPENAI_API_KEY || "" });

app.get("/distributors", (_req, res) => res.redirect(302, "/distributors.html"));
app.get("/distributors.html", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "distributors.html"));
});

app.get("/health", (_req, res) => {
  res.status(legacyReady ? 200 : 503).json({
    ok: legacyReady,
    distributorIntelligence: true,
    legacyServerReady: legacyReady,
  });
});

const launchButton = `
<a id="fuel-distributor-intelligence-launch" href="/distributors.html" aria-label="Open Fuel Distributor Intelligence">
  <span class="fdi-icon">◆</span><span>Distributor Intelligence</span>
</a>
<style>
#fuel-distributor-intelligence-launch{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:9px;padding:13px 17px;border-radius:999px;background:#0b1f33;color:#fff!important;text-decoration:none!important;font:700 14px/1 Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.22);transition:transform .15s ease,box-shadow .15s ease}
#fuel-distributor-intelligence-launch:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(0,0,0,.34)}
#fuel-distributor-intelligence-launch .fdi-icon{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#fbbf24;color:#0b1f33;font-size:12px}
@media(max-width:640px){#fuel-distributor-intelligence-launch{right:12px;bottom:12px;padding:12px}#fuel-distributor-intelligence-launch span:last-child{display:none}}
</style>`;

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
        let page = Buffer.concat(chunks).toString("utf8");
        page = page.includes("</body>") ? page.replace("</body>", `${launchButton}</body>`) : `${page}${launchButton}`;
        res.status(proxyResponse.statusCode || 200);
        copyHeaders(proxyResponse.headers, res, { dropLength: true });
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
  console.log(`Fuel IQ gateway with Distributor Intelligence listening on :${publicPort}`);
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
