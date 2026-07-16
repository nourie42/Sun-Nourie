import express from "express";

const JOB_ESTIMATES = new Map();
const REPORT_ESTIMATES = new Map();
const TTL_MS = 24 * 60 * 60 * 1000;

function prune(map, max = 150) {
  const now = Date.now();
  for (const [key, value] of map) if (!value || value.expiresAt <= now) map.delete(key);
  while (map.size > max) map.delete(map.keys().next().value);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactEstimate(value) {
  if (!value || typeof value !== "object") return null;
  const estimate = value.estimate && typeof value.estimate === "object" ? value.estimate : {};
  const inputs = value.inputs && typeof value.inputs === "object" ? value.inputs : {};
  const base = finite(value.base ?? estimate.base ?? estimate.low);
  const low = finite(value.low ?? estimate.low ?? (base == null ? null : Math.round(base * 0.86)));
  const high = finite(value.high ?? estimate.high ?? (base == null ? null : Math.round(base * 1.06)));
  const year2 = finite(value.year2 ?? estimate.year2);
  const year3 = finite(value.year3 ?? estimate.year3);
  const aadt = finite(inputs.aadt_used ?? value.calc_breakdown?.aadt);
  if ([base, low, high, year2, year3, aadt].every((item) => item == null)) return null;
  return {
    base,
    low,
    high,
    year2,
    year3,
    aadt,
    aadtText: String(value.aadtText || "").slice(0, 1000),
    method: String(inputs.aadt_components?.method || "").slice(0, 120),
  };
}

function number(value) {
  return value == null ? "—" : Math.round(Number(value)).toLocaleString("en-US");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function expectedGallonsHtml(estimate) {
  if (!estimate) return "";
  const range = estimate.low != null || estimate.high != null ? `${number(estimate.low)} – ${number(estimate.high)}` : "—";
  const context = estimate.aadtText || (estimate.aadt != null ? `AADT used: ${number(estimate.aadt)} vehicles/day${estimate.method ? ` (${estimate.method.replace(/_/g, " ")})` : ""}.` : "Fuel IQ estimate context supplied by the Site Analyzer.");
  return `<section id="fuel-iq-expected-gallons" class="expected-gallons-summary"><h2>Expected Gallons</h2><div class="expected-gallons-grid"><div class="expected-gallons-metric"><span>Base / month</span><strong>${number(estimate.base)}</strong></div><div class="expected-gallons-metric"><span>Expected range</span><strong>${range}</strong></div><div class="expected-gallons-metric"><span>Year 2</span><strong>${number(estimate.year2)}</strong></div><div class="expected-gallons-metric"><span>Year 3</span><strong>${number(estimate.year3)}</strong></div><div class="expected-gallons-metric"><span>AADT used</span><strong>${number(estimate.aadt)}</strong></div></div><p>${escapeHtml(context)}</p></section>`;
}

function enhanceHtml(body, estimate) {
  if (typeof body !== "string" || !body.includes("site-research-report")) return body;
  let output = body.replace('<section><h2>Source Register</h2><table>', '<section class="sources"><h2>Source Register</h2><table>');
  if (!estimate || output.includes('id="fuel-iq-expected-gallons"')) return output;
  const summary = expectedGallonsHtml(estimate);
  const disclaimer = /(<div class="site-report-disclaimer"[^>]*>[\s\S]*?<\/div>)/;
  if (disclaimer.test(output)) return output.replace(disclaimer, `$1${summary}`);
  if (output.includes("</header>")) return output.replace("</header>", `</header>${summary}`);
  return `${summary}${output}`;
}

function enrichPayload(payload, estimate) {
  if (!payload || typeof payload !== "object" || !estimate) return payload;
  if (payload.report && typeof payload.report === "object") {
    payload.report._meta = { ...(payload.report._meta || {}), expected_gallons: estimate };
  }
  if (typeof payload.html === "string") payload.html = enhanceHtml(payload.html, estimate);
  return payload;
}

function put(map, key, estimate) {
  if (!key || !estimate) return;
  prune(map);
  map.set(key, { estimate, expiresAt: Date.now() + TTL_MS });
}

function get(map, key) {
  prune(map);
  return map.get(key)?.estimate || null;
}

export function registerSiteResearchReportEnhancements(app) {
  const json = express.json({ limit: "4mb" });
  app.use("/api/site-research", json, (req, res, next) => {
    const path = req.path || "/";
    const submittedEstimate = req.method === "POST" && path === "/research" ? compactEstimate(req.body?.estimateContext) : null;
    const submittedWordEstimate = req.method === "POST" && path === "/word" ? compactEstimate(req.body?.report?._meta?.expected_gallons) : null;
    const researchMatch = path.match(/^\/research\/([^/]+)$/);
    const reportMatch = path.match(/^\/report\/([^/]+)$/);
    const wordMatch = path.match(/^\/word\/([^/]+)$/);

    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      if (submittedEstimate && payload?.jobId) put(JOB_ESTIMATES, payload.jobId, submittedEstimate);

      let estimate = submittedEstimate;
      if (researchMatch) estimate = get(JOB_ESTIMATES, researchMatch[1]);
      if (reportMatch) estimate = get(REPORT_ESTIMATES, reportMatch[1]) || compactEstimate(payload?.report?._meta?.expected_gallons);
      if (!estimate) estimate = compactEstimate(payload?.report?._meta?.expected_gallons);

      if (payload?.status === "completed" && payload?.reportId && estimate) put(REPORT_ESTIMATES, payload.reportId, estimate);
      if (payload?.reportId && estimate) put(REPORT_ESTIMATES, payload.reportId, estimate);
      return originalJson(enrichPayload(payload, estimate));
    };

    if (wordMatch || submittedWordEstimate) {
      const originalSend = res.send.bind(res);
      res.send = (body) => {
        const estimate = submittedWordEstimate || get(REPORT_ESTIMATES, wordMatch?.[1]);
        return originalSend(enhanceHtml(body, estimate));
      };
    }
    next();
  });
}
