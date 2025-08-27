// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public")); // serve /public

function jerr(res, code, msg, detail) {
  console.error("[ERROR]", code, msg, detail || "");
  return res.status(code).json({ error: msg, detail });
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// Main estimator — delegates the full flow to GPT
app.post("/estimate", async (req, res) => {
  try {
    const { address, mpds, diesel } = req.body || {};
    if (!address) return jerr(res, 400, "Address required");
    if (!mpds) return jerr(res, 400, "Regular MPDs required");

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return jerr(res, 500, "Missing OPENAI_API_KEY");

    const userPrompt = `
You are a fuel volume analyst. Estimate monthly gasoline gallons for a proposed gas station.

Inputs:
- Address: ${address}
- Regular MPDs: ${mpds}
- Diesel positions: ${diesel ?? 0}

Follow this flow exactly:
1. AADT: find the nearest reliable traffic count to the address; prefer official DOT sources; if none, infer from road class/nearby counts.
2. Competition: list gas stations within 1 mile; apply distance decay (1/d) and heavy penalty if within 0.03 mi. Boost premium brands.
3. Developments: include planned/proposed/permit/coming-soon/construction only; exclude closed.
4. Compute gallons:
   - Split traffic autos vs trucks (use defaults if unknown).
   - Stop rates baseline: autos ~2.0%, trucks ~1.2%.
   - Gallons/stop: autos ~10.2, trucks ~16.
   - Convert to monthly (GPM = GPD × 365/12).
   - Capacity cap: positions × 25 cycles/day × gal/cycle × 365/12.
   - Cap the estimate at this.
5. Report:
   - Base Estimate (gal/mo), Low–High (−14%/+6%), Year-2 (+2.7%), Year-3 (+1.25%).
   - Inputs used (AADT + source/year/approx distance, MPDs, truck share).
   - Competition summary (count, nearest distance, notable brands, impact score).
   - Developments (planned/proposed only).
   - Assumptions (defaults used).
   - One-paragraph rationale (concise, numeric).

Output JSON only, with keys:
{
  "base": <number>,
  "low": <number>,
  "high": <number>,
  "year2": <number>,
  "year3": <number>,
  "inputs": {...},
  "competition": {...},
  "developments": [...],
  "assumptions": [...],
  "rationale": "<text>"
}
    `;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a precise fuel volume analyst. Always return valid JSON, no markdown." },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 900,
      }),
    });

    const txt = await r.text();
    if (!r.ok) return jerr(res, r.status, "OpenAI error", txt);

    let data;
    try { data = JSON.parse(txt); }
    catch (e) { return jerr(res, 502, "OpenAI JSON parse error", txt); }

    const content = data.choices?.[0]?.message?.content;
    if (!content) return jerr(res, 502, "No GPT content", txt);

    let parsed;
    try { parsed = JSON.parse(content); }
    catch (e) { return jerr(res, 502, "GPT returned invalid JSON", content); }

    return res.json(parsed);
  } catch (e) {
    return jerr(res, 500, "Estimate failed", String(e));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));
