import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());

// Allow your static site to call this API from the browser
app.use(cors({ origin: true })); // permissive; tighten later if you want

// Simple health check (visit / to see it's running)
app.get("/", (_req, res) => res.send("OK"));

// POST /chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const { messages = [], system = "You are helpful." } = req.body;

    // call OpenAI Responses API (Node 18+ has global fetch)
    const oai = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: system },
          ...messages
        ],
        stream: false
      })
    });

    // pass through JSON (or raw text if not JSON)
    const ct = oai.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const data = await oai.json();
      res.json(data);
    } else {
      const text = await oai.text();
      res
        .status(oai.ok ? 200 : oai.status)
        .type(ct || "text/plain")
        .send(text);
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
