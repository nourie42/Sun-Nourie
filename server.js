// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// serve the front-end from /public
app.use(express.static("public"));

// --- helpers ---
function jerr(res, code, msg, detail) {
  console.error("[ERROR]", code, msg, detail || "");
  return res.status(code).json({ error: msg, detail });
}

// HEALTH
app.get("/health", (_req, res) => res.json({ ok: true }));

// AADT endpoint (placeholder logic for now)
app.get("/aadt", async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return jerr(res, 400, "Missing lat/lng");

    // Temporary heuristic so the app runs while you wire the real API:
    const approx = Math.round(8000 + (Math.abs(Number(lat) * 1000 + Number(lng) * 500) % 22000));
    return res.json({ aadt: approx, source: "placeholder" });
  } catch (e) {
    return jerr(res, 500, "AADT fetch failed", String(e));
  }
});

// Gallons estimate via GPT (server-side proxy to OpenAI)
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel } = req.body || {};
    if (!address || mpds === undefined) return jerr(res, 400, "Missing address or mpds");

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return jerr(res, 500, "Missing OPENAI_API_KEY");

    const prompt = `
You are an analyst. Estimate monthly gasoline gallons for:
- Address: ${address}
- Regular MPDs: ${mpds}
- Diesel positions: ${diesel ?? 0}

Rule of thumb baseline: Gallons = AADT × 8% × 2 × 30.
Then adjust down for heavy close competition within 1 mile (Sheetz, Wawa, Buc-ee's, RaceTrac, etc.) and up for limited competition.
Return ONLY a JSON object with:
{"monthly_gallons": <number>, "rationale": "<one short sentence>"}
`;

    // OpenAI Responses API
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.1-mini",
        input: prompt,
        response_format: { type: "json_object" },
        max_output_tokens: 300
      })
    });

    const ct = r.headers.get("content-type") || "";
    const bodyText = await r.text();
    if (!r.ok) return jerr(res, r.status, "OpenAI error", bodyText);
    if (!ct.includes("application/json")) return jerr(res, 502, "OpenAI returned non-JSON", bodyText);

    let data;
    try { data = JSON.parse(bodyText); }
    catch (e) { return jerr(res, 502, "OpenAI JSON parse error", bodyText); }

    const outputItem = data.output?.[0]?.content?.find?.(c => c.type === "output_text");
    if (!outputItem?.text) return jerr(res, 502, "Unexpected OpenAI shape", JSON.stringify(data).slice(0, 400));

    let gptJson;
    try { gptJson = JSON.parse(outputItem.text); }
    catch (e) { return jerr(res, 502, "Model did not return valid JSON", outputItem.text); }

    return res.json(gptJson);
  } catch (e) {
    return jerr(res, 500, "Estimate failed", String(e));
  }
});

// global error handler
app.use((err, _req, res, _next) => jerr(res, 500, "Unhandled error", String(err)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));
