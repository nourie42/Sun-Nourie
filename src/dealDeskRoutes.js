import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const json = express.json({ limit: "2mb" });

function clean(value, max = 120000) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);
}

function authorized(req) {
  const required = process.env.DEAL_DESK_PASSWORD || "";
  if (!required) return true;
  return String(req.get("x-deal-desk-passcode") || "") === required;
}

function systemPrompt() {
  return `You are Fuel IQ Deal Desk, a disciplined convenience-store and fuel-distribution M&A underwriting analyst supporting Sunoco-style acquisitions and dealer commission conversions.

Review the provided deal data. Never invent missing figures. Clearly distinguish:
1. Seller normalized EBITDA.
2. Sunoco/owner economics after conversion: fuel gross profit + distinct recurring benefits + rent - dealer commission - retained owner costs.
3. Dealer economics: inside gross profit + commission - dealer operating costs - rent.
4. Combined economics, where rent and dealer commission are transfer payments and cancel.
5. One-time conversion capex, which is not recurring EBITDA.

Return a concise investment-committee review with these exact headings:
EXECUTIVE VIEW
WHAT IS FILLED IN
MISSING OR UNRELIABLE INPUTS
ECONOMIC BRIDGE
SYNERGY OPPORTUNITIES
STRATEGIC FIT
KEY RISKS
DILIGENCE QUESTIONS
RECOMMENDATION

For each proposed synergy state the calculation, timing, confidence (high/medium/low), owner, dealer, or combined beneficiary, and evidence needed. Call out double counting, ownership ambiguity, unsupported margins, stale assumptions, and any apparent formula mismatch. Do not imply that operational control equals fee ownership.`;
}

export function registerDealDeskRoutes(app) {
  app.get("/deal-desk", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(publicDir, "deal-desk.html"));
  });
  app.get("/deal-desk.html", (_req, res) => res.redirect(302, "/deal-desk"));
  app.get("/deal-desk.js", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.type("application/javascript").sendFile(path.join(publicDir, "deal-desk.js"));
  });
  app.get("/api/deal-desk/status", (_req, res) => res.json({
    ok: true,
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    passcodeRequired: Boolean(process.env.DEAL_DESK_PASSWORD),
  }));
  app.post("/api/deal-desk/analyze", json, async (req, res) => {
    if (!authorized(req)) return res.status(401).json({ ok: false, message: "Incorrect Deal Desk passcode." });
    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    if (!apiKey) return res.status(503).json({ ok: false, message: "ANTHROPIC_API_KEY is not configured on this Render service." });
    const payload = JSON.stringify({ inputs: req.body?.inputs || {}, calculatedModel: req.body?.model || {} }, null, 2);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
          max_tokens: 3500,
          temperature: 0.2,
          system: systemPrompt(),
          messages: [{ role: "user", content: "Analyze this prospective deal and its calculated bridge:\n\n" + clean(payload) }],
        }),
        signal: AbortSignal.timeout(90000),
      });
      const data = await response.json();
      if (!response.ok) {
        console.error("Deal Desk Anthropic error:", response.status, data?.error?.message || "Unknown error");
        return res.status(502).json({ ok: false, message: "The AI provider could not complete the analysis." });
      }
      const analysis = Array.isArray(data.content) ? data.content.filter(item => item.type === "text").map(item => item.text).join("\n\n") : "";
      if (!analysis) return res.status(502).json({ ok: false, message: "The AI provider returned an empty analysis." });
      res.json({ ok: true, analysis });
    } catch (error) {
      console.error("Deal Desk analysis failed:", error);
      res.status(502).json({ ok: false, message: error?.name === "TimeoutError" ? "The analysis timed out. Try again." : "Deal analysis failed." });
    }
  });
}
