import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors({ origin: true }));

// quick health check
app.get("/", (_req, res) => res.send("OK"));

app.post("/chat", async (req, res) => {
  try {
    const { messages = [], system = "You are helpful." } = req.body;

    const oai = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [{ role: "system", content: system }, ...messages],
        stream: false
      })
    });

    const contentType = oai.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await oai.json() : await oai.text();

    // If OpenAI returned an error, surface it clearly
    if (!oai.ok) {
      const errMsg = typeof body === "string" ? body : (body.error?.message || JSON.stringify(body));
      return res.status(oai.status).json({ error: errMsg });
    }

    // Normalize to { output_text: "..." } for the frontend
    let text = "";

    if (typeof body === "string") {
      text = body;
    } else if (body.output_text) {
      text = body.output_text;
    } else if (Array.isArray(body.output)) {
      const msg = body.output.find(o => o.type === "message");
      if (msg && Array.isArray(msg.content)) {
        const parts = msg.content
          .filter(p => p.type === "output_text" || p.type === "text")
          .map(p => p.text)
          .join("");
        text = parts || "";
      }
    } else if (body.choices?.[0]?.message?.content) {
      text = body.choices[0].message.content; // fallback for chat-completions-shaped responses
    }

    if (!text) text = "[No text from model]";

    return res.json({ output_text: text });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

